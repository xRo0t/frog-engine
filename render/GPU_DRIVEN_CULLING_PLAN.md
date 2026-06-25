# GPU-Driven Culling — Implementation Plan

> Goal: move per-instance frustum culling from the CPU (serial loop in
> `gpu_renderer_core.dlt`) onto the GPU via a compute shader that writes
> an indirect draw command buffer. The graphics pass then issues a single
> `vkCmdDrawIndexedIndirectCount` per mesh group instead of per-instance
> CPU culling + per-instance draw recording.
>
> Status legend: ⬜ TODO · 🟡 IN PROGRESS · ✅ DONE · ⚠️ BLOCKED

## Why
Measured on collision-demo: `draws == instances` (up to ~3240 draws/frame)
and CPU does `_frog_instance_visible` per instance every frame, single
threaded. At 830 FPS today it is not a bottleneck, but it caps how many
objects the engine can ever handle. GPU-driven culling is the AAA-standard
approach (UE5, Frostbite): the GPU decides what to draw.

## Architecture (target)
```
CPU (once per frame):
  - upload instance data (model matrix + bounds) to a STORAGE buffer
  - upload frustum planes (6 x vec4) as a uniform/push constant
  - vkCmdDispatch(culling_compute)         <- GPU culls
  - memory barrier (compute write -> indirect read)
  - vkCmdDrawIndexedIndirectCount(...)      <- GPU-driven draw
GPU compute shader (per instance, parallel):
  - test instance bounds vs frustum planes
  - if visible: atomicAdd draw count, append VkDrawIndexedIndirectCommand
```

## Vulkan bindings — VERIFIED AVAILABLE
- vkCmdDispatch ✅
- vkCmdDrawIndexedIndirect / ...IndirectCount ✅
- vkCreateComputePipelines (in the 698-fn binding) ✅
- vkCreateBuffer / vkAllocateMemory / vkMapMemory ✅ (pattern in core)

## Phases (each builds + boots + game still renders before next)

### Phase 0 — Infrastructure: compute pipeline can be created ✅ DONE
- Storage-buffer + compute descriptor set layout creation. ✅
- Compute shader (cull.comp) compiled to SPIR-V, embedded in gpu_shaders. ✅
- Compute pipeline created and VERIFIED on real GPU: prints
  "[frog.cull] GPU culling pipeline ready" at startup. ✅
- Fixed: dolet-vulkan-1.lib was missing compute symbols (vkCmdDispatch,
  vkCreateComputePipelines) — replaced with the full VulkanSDK vulkan-1.lib.
- Fixed struct layouts (shader module sType=12 + codeSize@24/pCode@32,
  pipeline layout setLayoutCount@20, compute pipeline stage@24/layout@72,
  shader-stage struct stage@20).

### Phase 1 — GPU buffers for instance data ⬜
- Define GPU instance struct: mat4 (64B) + bounds vec4 (16B) = 80B.
- Storage buffer holding all instances for a mesh group.
- Indirect command buffer (VkDrawIndexedIndirectCommand = 20B each).
- Count buffer (u32) for IndirectCount.

### Phase 2 — Culling compute shader ⬜
- GLSL: read instance bounds, test vs 6 frustum planes, append cmd.
- Compile to SPIR-V, embed like the other shaders.

### Phase 3 — Wire dispatch + indirect draw into render loop ⬜
- Replace the per-instance CPU cull loop with: upload, dispatch, barrier,
  drawIndexedIndirectCount.
- Keep the old CPU path behind a flag for fallback/comparison.

### Phase 4 — Validate + measure ⬜
- render_stats: draws should collapse (1 indirect draw per group).
- frame_pacing: compare avg_ms before/after at high instance counts.
- Stress test: thousands of instances.

## Risks / notes
- Vulkan errors are silent (black screen). Validate each phase via boot+render.
- compute<->graphics sync barriers are the hardest part (Phase 3).
- Frustum planes must be extracted from view*proj (already have VP matrix).
- Keep CPU fallback path until GPU path proven on the real game.

## Frustum plane extraction (reference)
From a column-major VP matrix m (Gribb/Hartmann):
  left   = row3 + row0
  right  = row3 - row0
  bottom = row3 + row1
  top    = row3 - row1
  near   = row3 + row2
  far    = row3 - row2
(normalize each plane by its xyz length)
