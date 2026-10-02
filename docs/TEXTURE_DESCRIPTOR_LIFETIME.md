# Texture descriptor lifetime

Classic material descriptors are cached by their five resolved image/sampler
pairs for one render-pass generation. Mesh instances with equal texture tuples
share the same set. Scalar material updates (brightness, roughness, alpha,
UVs) and rebinding the same texture do not invalidate that set.

Previously, each material rebind discarded the mesh's descriptor reference.
The next draw allocated another set from a fixed 8192-set pool, eventually
exhausting it and selecting the opaque white fallback. This could turn
alpha-cutout foliage into white rectangles despite its texture ID remaining
valid. Changing auxiliary maps also needed deduplication across meshes.

Genuinely distinct tuples can fill a pool. On Vulkan pool exhaustion or
fragmentation, a new bank is allocated; old banks remain alive until GPU-idle
render-pass cleanup. Device/host memory errors are not retried indefinitely.
Shadow target replacement refreshes the shared shadow binding in every cached
set, only after the caller has waited for GPU idle.

Swapchain recreation drains pending texture uploads before destroying their
command pool, rebuilds classic/bindless/SSBO graphics pipelines, and reuses the
persistent bindless texture table. Render-pass-local descriptors are rebuilt;
old banks and cache nodes are released. Culling metadata is marked dirty.

## Native regression

From this package, using the Dolet compiler and an available Vulkan desktop:

```powershell
../../bin/doletc.exe tests/texture_descriptor_lifetime_gpu_checks.dlt -o texture-lifetime.exe
./texture-lifetime.exe
```

The test uses generated RGBA cutout fixtures, not game assets. It asserts:

- 50,000 scalar/same-texture rebinds allocate no additional sampler sets;
- 50,000 actual texture/map switches reuse a bounded set of tuples;
- 9,000 distinct tuples roll over safely while old sets remain valid;
- shadow target replacement traverses every cached material bank;
- three swapchain recreations preserve texture IDs and restore native draw
  paths, followed by CPU/GPU-mode frames and clean shutdown.

Assertions exit nonzero on failure. This checks resource lifetime and pipeline
recreation; it is not a pixel-readback test or a claim of exhaustive GPU-driver
coverage.
