#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const USAGE = `
Usage:
  node tools/import_model.mjs <model.gltf> [--target-triangles 12000] [--out <model.frog.gltf>] [--preserve-materials]

Creates a runtime glTF cache next to the source by default:
  scene.gltf -> scene.frog.gltf + scene.frog.bin

The generated file is still glTF so the current Frog runtime can load it,
but geometry is pre-flattened, material-merged, and LOD-reduced offline.
`;

function fail(message) {
  console.error(`frog import_model: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = {
    source: "",
    out: "",
    targetTriangles: 12000,
    preserveMaterials: false,
  };
  for (let i = 2; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      console.log(USAGE.trim());
      process.exit(0);
    }
    if (a === "--out") {
      i += 1;
      args.out = argv[i] ?? "";
      continue;
    }
    if (a === "--target-triangles") {
      i += 1;
      args.targetTriangles = Number.parseInt(argv[i] ?? "", 10);
      continue;
    }
    if (a === "--preserve-materials") {
      args.preserveMaterials = true;
      continue;
    }
    if (!args.source) {
      args.source = a;
      continue;
    }
    fail(`unknown argument: ${a}`);
  }
  if (!args.source) {
    console.log(USAGE.trim());
    process.exit(1);
  }
  if (!Number.isFinite(args.targetTriangles) || args.targetTriangles < 256) {
    fail("--target-triangles must be >= 256");
  }
  return args;
}

function align4(value) {
  return (value + 3) & ~3;
}

function componentByteSize(componentType) {
  switch (componentType) {
    case 5120:
    case 5121:
      return 1;
    case 5122:
    case 5123:
      return 2;
    case 5125:
    case 5126:
      return 4;
    default:
      fail(`unsupported component type ${componentType}`);
  }
}

function typeComponentCount(type) {
  switch (type) {
    case "SCALAR":
      return 1;
    case "VEC2":
      return 2;
    case "VEC3":
      return 3;
    case "VEC4":
      return 4;
    case "MAT4":
      return 16;
    default:
      fail(`unsupported accessor type ${type}`);
  }
}

function readNumber(view, offset, componentType) {
  switch (componentType) {
    case 5120:
      return view.getInt8(offset);
    case 5121:
      return view.getUint8(offset);
    case 5122:
      return view.getInt16(offset, true);
    case 5123:
      return view.getUint16(offset, true);
    case 5125:
      return view.getUint32(offset, true);
    case 5126:
      return view.getFloat32(offset, true);
    default:
      fail(`unsupported component type ${componentType}`);
  }
}

function readAccessor(gltf, buffers, accessorIndex) {
  const accessor = gltf.accessors?.[accessorIndex];
  if (!accessor) {
    fail(`missing accessor ${accessorIndex}`);
  }
  if (accessor.sparse) {
    fail(`sparse accessor ${accessorIndex} is not supported by import_model yet`);
  }
  const viewInfo = gltf.bufferViews?.[accessor.bufferView];
  if (!viewInfo) {
    fail(`missing bufferView ${accessor.bufferView}`);
  }
  const buffer = buffers[viewInfo.buffer ?? 0];
  if (!buffer) {
    fail(`missing buffer ${viewInfo.buffer ?? 0}`);
  }
  const componentSize = componentByteSize(accessor.componentType);
  const componentCount = typeComponentCount(accessor.type);
  const stride = viewInfo.byteStride ?? componentSize * componentCount;
  const baseOffset = (viewInfo.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const rows = new Array(accessor.count);
  for (let i = 0; i < accessor.count; i += 1) {
    const row = new Array(componentCount);
    const rowOffset = baseOffset + i * stride;
    for (let c = 0; c < componentCount; c += 1) {
      row[c] = readNumber(view, rowOffset + c * componentSize, accessor.componentType);
    }
    rows[i] = row;
  }
  return rows;
}

function readIndices(gltf, buffers, accessorIndex) {
  if (accessorIndex === undefined || accessorIndex < 0) {
    return null;
  }
  const rows = readAccessor(gltf, buffers, accessorIndex);
  return rows.map((row) => row[0]);
}

function normalizeVec3(v, fallback) {
  if (!v) {
    return fallback;
  }
  const x = Number(v[0] ?? fallback[0]);
  const y = Number(v[1] ?? fallback[1]);
  const z = Number(v[2] ?? fallback[2]);
  const len = Math.hypot(x, y, z);
  if (len <= 0.000001) {
    return fallback;
  }
  return [x / len, y / len, z / len];
}

function flatNormal(a, b, c) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return normalizeVec3([
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0],
  ], [0, 1, 0]);
}

function materialName(gltf, materialIndex) {
  if (materialIndex === undefined || materialIndex < 0) {
    return "Material";
  }
  const material = gltf.materials?.[materialIndex];
  return material?.name || `Material_${materialIndex}`;
}

function materialBaseColor(gltf, materialIndex) {
  const material = materialIndex >= 0 ? gltf.materials?.[materialIndex] : null;
  const factor = material?.pbrMetallicRoughness?.baseColorFactor;
  if (Array.isArray(factor) && factor.length >= 3) {
    return [
      Number(factor[0] ?? 0.6),
      Number(factor[1] ?? 0.6),
      Number(factor[2] ?? 0.6),
      Number(factor[3] ?? 1.0),
    ];
  }
  return [0.6, 0.6, 0.6, 1.0];
}

function materialBucket(name) {
  const n = String(name ?? "").toLowerCase();
  if (n.includes("glass") || n.includes("window") || n.includes("light") || n.includes("screen") || n.includes("lamp")) {
    return "Glass";
  }
  if (n.includes("wheel") || n.includes("tire") || n.includes("tyre") || n.includes("rubber")) {
    return "WheelRubber";
  }
  if (n.includes("chrome") || n.includes("metal") || n.includes("rim") || n.includes("brake") || n.includes("bolt")) {
    return "Metal";
  }
  if (n.includes("interior") || n.includes("seat") || n.includes("leather") || n.includes("carpet") || n.includes("button") || n.includes("gauge") || n.includes("speaker")) {
    return "Interior";
  }
  if (n.includes("paint") || n.includes("body") || n.includes("carbon") || n.includes("badge") || n.includes("logo") || n.startsWith("ext")) {
    return "Body";
  }
  return "Detail";
}

function loadBuffers(gltf, sourcePath) {
  const baseDir = path.dirname(sourcePath);
  return (gltf.buffers ?? []).map((buffer, index) => {
    const uri = buffer.uri;
    if (!uri) {
      fail(`buffer ${index} has no URI; GLB import is not supported by this tool yet`);
    }
    if (uri.startsWith("data:")) {
      const comma = uri.indexOf(",");
      if (comma < 0) {
        fail(`buffer ${index} has invalid data URI`);
      }
      return Buffer.from(uri.slice(comma + 1), "base64");
    }
    const binPath = path.resolve(baseDir, uri);
    if (!fs.existsSync(binPath)) {
      fail(`buffer file not found: ${binPath}`);
    }
    return fs.readFileSync(binPath);
  });
}

function collectTriangles(gltf, buffers, preserveMaterials) {
  const groups = new Map();
  let totalTriangles = 0;

  for (const mesh of gltf.meshes ?? []) {
    for (const primitive of mesh.primitives ?? []) {
      if (primitive.mode !== undefined && primitive.mode !== 4) {
        continue;
      }
      const attrs = primitive.attributes ?? {};
      if (attrs.POSITION === undefined) {
        continue;
      }
      const positions = readAccessor(gltf, buffers, attrs.POSITION);
      const normals = attrs.NORMAL === undefined ? null : readAccessor(gltf, buffers, attrs.NORMAL);
      const uvs = attrs.TEXCOORD_0 === undefined ? null : readAccessor(gltf, buffers, attrs.TEXCOORD_0);
      const indices = readIndices(gltf, buffers, primitive.indices);
      const materialIndex = primitive.material ?? -1;
      const sourceName = materialName(gltf, materialIndex);
      const key = preserveMaterials ? String(materialIndex) : materialBucket(sourceName);
      if (!groups.has(key)) {
        groups.set(key, {
          materialIndex,
          name: preserveMaterials ? sourceName : key,
          color: [0, 0, 0, 0],
          colorWeight: 0,
          triangles: [],
        });
      }
      const group = groups.get(key);
      const indexCount = indices ? indices.length : positions.length;
      const triCount = Math.floor(indexCount / 3);
      totalTriangles += triCount;
      const color = materialBaseColor(gltf, materialIndex);
      group.color[0] += color[0] * triCount;
      group.color[1] += color[1] * triCount;
      group.color[2] += color[2] * triCount;
      group.color[3] += color[3] * triCount;
      group.colorWeight += triCount;
      for (let t = 0; t < triCount; t += 1) {
        const i0 = indices ? indices[t * 3] : t * 3;
        const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1;
        const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2;
        const p0 = positions[i0];
        const p1 = positions[i1];
        const p2 = positions[i2];
        if (!p0 || !p1 || !p2) {
          continue;
        }
        const fallbackNormal = flatNormal(p0, p1, p2);
        group.triangles.push({
          positions: [p0, p1, p2],
          normals: [
            normalizeVec3(normals?.[i0], fallbackNormal),
            normalizeVec3(normals?.[i1], fallbackNormal),
            normalizeVec3(normals?.[i2], fallbackNormal),
          ],
          uvs: [
            uvs?.[i0] ?? [0, 0],
            uvs?.[i1] ?? [0, 0],
            uvs?.[i2] ?? [0, 0],
          ],
        });
      }
    }
  }

  return { groups: [...groups.values()].filter((g) => g.triangles.length > 0), totalTriangles };
}

function sampleTriangles(triangles, globalStep, groupTargetMin) {
  if (globalStep <= 1) {
    return triangles;
  }
  if (triangles.length <= groupTargetMin) {
    return triangles;
  }
  const picked = [];
  for (let i = 0; i < triangles.length; i += globalStep) {
    picked.push(triangles[i]);
  }
  if (picked.length === 0 && triangles.length > 0) {
    picked.push(triangles[0]);
  }
  return picked;
}

function pushAligned(chunks, cursor) {
  const aligned = align4(cursor.value);
  if (aligned > cursor.value) {
    chunks.push(Buffer.alloc(aligned - cursor.value));
    cursor.value = aligned;
  }
  return aligned;
}

function appendFloatArray(chunks, cursor, values) {
  const offset = pushAligned(chunks, cursor);
  const buf = Buffer.alloc(values.length * 4);
  for (let i = 0; i < values.length; i += 1) {
    buf.writeFloatLE(Number(values[i] ?? 0), i * 4);
  }
  chunks.push(buf);
  cursor.value += buf.length;
  return { offset, length: buf.length };
}

function appendUint32Array(chunks, cursor, values) {
  const offset = pushAligned(chunks, cursor);
  const buf = Buffer.alloc(values.length * 4);
  for (let i = 0; i < values.length; i += 1) {
    buf.writeUInt32LE(values[i] >>> 0, i * 4);
  }
  chunks.push(buf);
  cursor.value += buf.length;
  return { offset, length: buf.length };
}

function boundsVec3(values) {
  const min = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
  const max = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
  for (let i = 0; i < values.length; i += 3) {
    for (let c = 0; c < 3; c += 1) {
      const v = values[i + c];
      if (v < min[c]) min[c] = v;
      if (v > max[c]) max[c] = v;
    }
  }
  return { min, max };
}

function cloneMaterials(gltf) {
  return JSON.parse(JSON.stringify(gltf.materials ?? [{ name: "Material" }]));
}

function buildRuntimeMaterials(sourceGltf, groups, preserveMaterials) {
  if (preserveMaterials) {
    return cloneMaterials(sourceGltf);
  }
  const materials = [];
  for (let i = 0; i < groups.length; i += 1) {
    const group = groups[i];
    const w = group.colorWeight > 0 ? group.colorWeight : 1;
    const color = [
      group.color[0] / w,
      group.color[1] / w,
      group.color[2] / w,
      group.color[3] / w,
    ];
    materials.push({
      name: group.name,
      pbrMetallicRoughness: {
        baseColorFactor: color,
        metallicFactor: group.name === "Metal" ? 0.25 : 0.0,
        roughnessFactor: group.name === "Glass" ? 0.28 : 0.72,
      },
    });
    group.materialOutIndex = i;
  }
  return materials.length > 0 ? materials : [{ name: "Material" }];
}

function buildRuntimeGltf(sourceGltf, groups, totalTriangles, targetTriangles, outBinName, preserveMaterials) {
  const step = Math.max(1, Math.ceil(totalTriangles / targetTriangles));
  const chunks = [];
  const cursor = { value: 0 };
  const bufferViews = [];
  const accessors = [];
  const primitives = [];
  let runtimeTriangles = 0;
  const materials = buildRuntimeMaterials(sourceGltf, groups, preserveMaterials);

  for (const group of groups) {
    const selected = sampleTriangles(group.triangles, step, 16);
    if (selected.length <= 0) {
      continue;
    }
    const positions = [];
    const normals = [];
    const texcoords = [];
    const indices = [];

    for (const tri of selected) {
      const base = indices.length;
      for (let i = 0; i < 3; i += 1) {
        positions.push(tri.positions[i][0] ?? 0, tri.positions[i][1] ?? 0, tri.positions[i][2] ?? 0);
        normals.push(tri.normals[i][0] ?? 0, tri.normals[i][1] ?? 1, tri.normals[i][2] ?? 0);
        texcoords.push(tri.uvs[i][0] ?? 0, tri.uvs[i][1] ?? 0);
        indices.push(base + i);
      }
      runtimeTriangles += 1;
    }

    const positionData = appendFloatArray(chunks, cursor, positions);
    const positionView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: positionData.offset, byteLength: positionData.length });
    const positionAccessor = accessors.length;
    const bounds = boundsVec3(positions);
    accessors.push({
      bufferView: positionView,
      componentType: 5126,
      count: positions.length / 3,
      type: "VEC3",
      min: bounds.min,
      max: bounds.max,
    });

    const normalData = appendFloatArray(chunks, cursor, normals);
    const normalView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: normalData.offset, byteLength: normalData.length });
    const normalAccessor = accessors.length;
    accessors.push({
      bufferView: normalView,
      componentType: 5126,
      count: normals.length / 3,
      type: "VEC3",
    });

    const uvData = appendFloatArray(chunks, cursor, texcoords);
    const uvView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: uvData.offset, byteLength: uvData.length });
    const uvAccessor = accessors.length;
    accessors.push({
      bufferView: uvView,
      componentType: 5126,
      count: texcoords.length / 2,
      type: "VEC2",
    });

    const indexData = appendUint32Array(chunks, cursor, indices);
    const indexView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: indexData.offset, byteLength: indexData.length, target: 34963 });
    const indexAccessor = accessors.length;
    accessors.push({
      bufferView: indexView,
      componentType: 5125,
      count: indices.length,
      type: "SCALAR",
    });

    primitives.push({
      attributes: {
        POSITION: positionAccessor,
        NORMAL: normalAccessor,
        TEXCOORD_0: uvAccessor,
      },
      indices: indexAccessor,
      material: preserveMaterials ? (group.materialIndex >= 0 ? group.materialIndex : 0) : group.materialOutIndex,
    });
  }

  const finalLength = pushAligned(chunks, cursor);
  const bin = Buffer.concat(chunks, finalLength);

  const runtime = {
    asset: {
      version: "2.0",
      generator: "Frog import_model",
      extras: {
        sourceTriangles: totalTriangles,
        runtimeTriangles,
        targetTriangles,
        reductionStep: step,
      },
    },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, name: "FrogRuntimeModel" }],
    meshes: [{ name: "FrogRuntimeMesh", primitives }],
    materials,
    buffers: [{ uri: outBinName, byteLength: bin.length }],
    bufferViews,
    accessors,
  };

  if (preserveMaterials) {
    if (sourceGltf.samplers) runtime.samplers = sourceGltf.samplers;
    if (sourceGltf.images) runtime.images = sourceGltf.images;
    if (sourceGltf.textures) runtime.textures = sourceGltf.textures;
  }

  return { runtime, bin, runtimeTriangles, step };
}

function defaultOutPath(source) {
  const ext = path.extname(source);
  return path.join(path.dirname(source), `${path.basename(source, ext)}.frog${ext}`);
}

function main() {
  const args = parseArgs(process.argv);
  const source = path.resolve(args.source);
  if (!fs.existsSync(source)) {
    fail(`source model not found: ${source}`);
  }
  if (path.extname(source).toLowerCase() !== ".gltf") {
    fail("only .gltf input is supported right now");
  }

  const out = path.resolve(args.out || defaultOutPath(source));
  const outBin = out.replace(/\.gltf$/i, ".bin");
  const gltf = JSON.parse(fs.readFileSync(source, "utf8"));
  const buffers = loadBuffers(gltf, source);
  const { groups, totalTriangles } = collectTriangles(gltf, buffers, args.preserveMaterials);
  if (groups.length <= 0 || totalTriangles <= 0) {
    fail("no triangle primitives found");
  }

  const { runtime, bin, runtimeTriangles, step } = buildRuntimeGltf(
    gltf,
    groups,
    totalTriangles,
    args.targetTriangles,
    path.basename(outBin),
    args.preserveMaterials,
  );

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(outBin, bin);
  fs.writeFileSync(out, `${JSON.stringify(runtime, null, 2)}\n`);

  console.log(`source: ${source}`);
  console.log(`output: ${out}`);
  console.log(`triangles: ${totalTriangles} -> ${runtimeTriangles} (step ${step})`);
  console.log(`material mode: ${args.preserveMaterials ? "preserve" : "merge"}`);
  console.log(`materials/primitives: ${runtime.materials?.length ?? 0}/${runtime.meshes[0].primitives.length}`);
}

main();
