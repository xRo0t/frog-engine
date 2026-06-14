# Frog Embedded Shaders

`textured.vert` and `textured.frag` are the source of the SPIR-V embedded in
`render/gpu_shaders.dlt`.

Regenerate the embedded shaders from the `packages/frog` directory:

```powershell
glslangValidator -V --target-env vulkan1.0 render/shaders/textured.vert -o render/shaders/textured.vert.spv
glslangValidator -V --target-env vulkan1.0 render/shaders/textured.frag -o render/shaders/textured.frag.spv
glslangValidator -V --target-env vulkan1.0 render/shaders/shadow.vert -o render/shaders/shadow.vert.spv
node tools/embed_spirv.mjs render/shaders/textured.vert.spv render/shaders/textured.frag.spv render/shaders/shadow.vert.spv
```

The `.spv` files are temporary build artifacts and should not be committed.
