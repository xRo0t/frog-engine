# Frog Engine

**100% OOP 3D game engine for Dolet. No ECS.**

Frog is a deliberate architectural counterpart to Kobic: same engine scope
(3D rendering, input, math, scene graph) but organised as a classic
object-oriented framework instead of an Entity-Component-System.

Every "thing" in a Frog game is used through an object-style API:

```dolet
scene: Scene = Scene.create(20000)
goblin: GameObject = scene.spawn("goblin")
goblin.position(1.0, 0.0, 3.0)
goblin.velocity(2.0, 0.0, 0.0)
scene.update_all(dt)
```

## What it is NOT

- **Not an ECS.** No archetypes, no component storages, no queries.
- **Not a thin wrapper around Kobic.** Frog imports zero Kobic source files.
  It only shares the same OS-level packages (Vulkan bindings, window
  bindings, input bindings) that any independent engine would need.

## Status

**Alpha - under active construction.** See `ROADMAP.md` for the build plan.

Phase 0 (directory structure + roadmap) is complete. Phase 1 (math library)
and the first OOP shell are now in place.

Current local shape:

- Math primitives are available (`Vec3`, `Mat4`, `Quat`, `Color`).
- `AppWindow`, `Clock`, `App`, and `Input` provide the first app shell.
- `Scene` + `GameObject` provide OOP user code over packed object storage.
- `SoftwareRenderer` provides a basic framebuffer renderer for early demos.
- `Engine` owns the public static lifecycle and hides the Vulkan runtime backend.
- `Engine.window`, `Engine.properties`, and `Engine.scene` group public setup APIs.
- `Engine.properties.set_vsync(1/0)` controls synced vs uncapped swapchain presentation.
- `Engine.properties.set_present_mode(PresentMode.mailbox())` can explicitly request Vulkan presentation mode.
- `Engine.properties.active_present_mode()` reports the Vulkan mode actually selected by the swapchain after startup.
- `Engine.debug.frame_pacing(1)` prints frame-time min/avg/max, spikes, present mode, target FPS, and render scale.
- `Assets` groups public resource loading APIs for models, textures, audio, and shaders.
- `ObjectBench` measures update throughput before rendering.

Vulkan rendering is available through the `Engine` facade while lower-level
runtime/backend types remain internal package plumbing.

## Dependencies

- `json` package - general JSON parsing for glTF metadata
- `vulkan` package - Vulkan C API bindings
- `window` package - Win32 window + vulkan surface

## Philosophy

Frog exists to make the ECS vs OOP performance / ergonomics trade-off
concrete. The companion game project `simple-game-frog-oop-3d/` is a
line-for-line port of `simple-game-kubic-ecs-3d/` so the two can be
compared fairly.
