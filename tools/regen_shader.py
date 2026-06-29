#!/usr/bin/env python3
"""Regenerate a single embedded shader block in gpu_shaders.dlt from a .spv.

Compiles nothing — takes an existing .spv and rewrites (or appends) the
`_frog_init_<name>_shader_pN` part functions plus the `get_<getter>()`
function, matching the embedding style already used in gpu_shaders.dlt.

The block for a shader is delimited by markers we insert:
    # >>> EMBED <name> BEGIN
    ... generated code ...
    # <<< EMBED <name> END

Usage:
  python regen_shader.py <spv_path> <name> <getter_name> [--file gpu_shaders.dlt]

  <name>       short id used in the part-fn names, e.g. "bindless_frag"
  <getter_name> full getter, e.g. "get_bindless_frag_shader"

If the markers already exist in the target file the block is replaced
in place; otherwise it is appended at end of file.
"""
import sys, struct, os

WRITES_PER_PART = 500  # keep each fn small (fsWrite-friendly, fast compile)


def emit_block(spv_path, name, getter):
    with open(spv_path, "rb") as f:
        data = f.read()
    if len(data) % 4 != 0:
        raise SystemExit(f"{spv_path}: length {len(data)} not multiple of 4")
    words = struct.unpack("<%dI" % (len(data) // 4), data)

    lines = []
    lines.append(f"# >>> EMBED {name} BEGIN")
    lines.append(f"# Generated from {os.path.basename(spv_path)}: "
                 f"{len(data)} bytes ({len(words)} i32 words). Do not edit by hand.")

    part_count = (len(words) + WRITES_PER_PART - 1) // WRITES_PER_PART
    for p in range(part_count):
        lines.append(f"fun _frog_init_{name}_shader_p{p}(buf: i64) -> void:")
        start = p * WRITES_PER_PART
        end = min(start + WRITES_PER_PART, len(words))
        for i in range(start, end):
            w = words[i]
            sw = w if w < 0x80000000 else w - 0x100000000
            lines.append(f"    Memory.write_i32(buf + {i * 4}, {sw})")
        lines.append("")

    # dispatcher init that calls every part
    lines.append(f"fun _frog_init_{name}_shader(buf: i64) -> void:")
    for p in range(part_count):
        lines.append(f"    _frog_init_{name}_shader_p{p}(buf)")
    lines.append("")

    lines.append(f"fun {getter}() -> EmbeddedShader:")
    lines.append("    shader: EmbeddedShader = EmbeddedShader()")
    lines.append(f"    buf: i64 = Memory.malloc_zeroed({len(data)})")
    lines.append("    if buf == 0:")
    lines.append("        return shader")
    lines.append(f"    _frog_init_{name}_shader(buf)")
    lines.append("    shader.data = buf")
    lines.append(f"    shader.size = {len(data)}")
    lines.append("    return shader")
    lines.append(f"# <<< EMBED {name} END")
    return "\n".join(lines)


def main():
    spv_path = sys.argv[1]
    name = sys.argv[2]
    getter = sys.argv[3]
    target = "gpu_shaders.dlt"
    if "--file" in sys.argv:
        target = sys.argv[sys.argv.index("--file") + 1]

    block = emit_block(spv_path, name, getter)
    begin = f"# >>> EMBED {name} BEGIN"
    end = f"# <<< EMBED {name} END"

    with open(target, "r", encoding="utf-8") as f:
        src = f.read()

    if begin in src and end in src:
        pre = src[: src.index(begin)]
        post = src[src.index(end) + len(end):]
        new = pre + block + post
    else:
        new = src.rstrip("\n") + "\n\n" + block + "\n"

    with open(target, "w", encoding="utf-8") as f:
        f.write(new)
    print(f"[regen] {getter} <- {os.path.basename(spv_path)} "
          f"({os.path.getsize(spv_path)} bytes) into {target}")


if __name__ == "__main__":
    main()
