#version 450
#extension GL_EXT_nonuniform_qualifier : require

// GPU-driven variant of the bindless vertex shader. The per-instance record
// (model matrix + material + uv transform + bindless texture indices) is read
// from a STORAGE BUFFER indexed by gl_InstanceIndex — NOT from per-instance
// vertex attributes. This is what makes true multi-group batching work under a
// single vkCmdDrawIndexedIndirectCount: gl_InstanceIndex includes the draw
// command's firstInstance (per the Vulkan spec), so each command indexes its
// own slice of the shared culled-output buffer correctly — sidestepping the
// unreliable firstInstance-based vertex-attribute fetch.
//
// Per-vertex geometry (binding 0) and the global shadow data (binding 2) stay
// as vertex attributes; only the per-instance record moved to the SSBO.

layout(location = 0) in vec3 inPosition;
layout(location = 1) in vec3 inNormal;
layout(location = 2) in vec3 inColor;
layout(location = 7) in vec2 inUv;
// Global (stride-0) shadow data — same for every instance this frame.
layout(location = 9) in vec4 shadowColumn0;
layout(location = 10) in vec4 shadowColumn1;
layout(location = 11) in vec4 shadowColumn2;
layout(location = 12) in vec4 shadowColumn3;
layout(location = 13) in vec4 shadowColumn4;
layout(location = 14) in vec4 shadowColumn5;
layout(location = 15) in vec4 shadowColumn6;
layout(location = 16) in vec4 shadowColumn7;
layout(location = 17) in vec4 shadowParams;
layout(location = 18) in vec4 shadowSplits;
layout(location = 19) in vec4 shadowFilter;

// Per-instance record (128 bytes), read by gl_InstanceIndex from set 3.
struct InstanceRecord {
    vec4 col0;
    vec4 col1;
    vec4 col2;
    vec4 col3;
    vec4 material;
    vec4 uvTransform;
    uvec4 texIndex0;   // albedo, emissive, normal, metallicRoughness
    uvec4 texIndex1;   // occlusion, spare, spare, spare
};

layout(std430, set = 3, binding = 0) readonly buffer InstanceBuffer {
    InstanceRecord instances[];
};

layout(location = 0) out vec3 fragmentColor;
layout(location = 1) out vec2 fragmentUv;
layout(location = 2) out float fragmentFogDistance;
layout(location = 3) out vec3 fragmentWorldPosition;
layout(location = 4) flat out vec4 fragmentMaterial;
layout(location = 5) out vec4 fragmentShadowPosition0;
layout(location = 6) out vec4 fragmentShadowPosition1;
layout(location = 7) flat out vec4 fragmentShadowParams;
layout(location = 8) flat out vec4 fragmentShadowSplits;
layout(location = 9) flat out vec4 fragmentShadowFilter;
layout(location = 10) out vec3 fragmentWorldNormal;
layout(location = 11) flat out uvec4 fragmentTexIndex0;
layout(location = 12) flat out uvec4 fragmentTexIndex1;

layout(push_constant) uniform PushConstants {
    mat4 viewProjection;
    vec4 fogColor;
    vec4 fogParams;
    vec4 fogShapeProjectionLight;
    vec4 lightDirectionIntensity;
} pushConstants;

void main() {
    InstanceRecord inst = instances[gl_InstanceIndex];
    mat4 model = mat4(inst.col0, inst.col1, inst.col2, inst.col3);
    vec4 worldPosition = model * vec4(inPosition, 1.0);
    vec4 clipPosition = pushConstants.viewProjection * worldPosition;

    gl_Position = clipPosition;
    fragmentColor = inColor;
    fragmentUv = inUv * inst.uvTransform.xy + inst.uvTransform.zw;
    fragmentFogDistance = abs(clipPosition.w);
    fragmentWorldPosition = worldPosition.xyz;
    fragmentMaterial = inst.material;
    mat3 normalMatrix = transpose(inverse(mat3(model)));
    fragmentWorldNormal = normalMatrix * inNormal;
    fragmentShadowPosition0 = mat4(
        shadowColumn0,
        shadowColumn1,
        shadowColumn2,
        shadowColumn3
    ) * worldPosition;
    fragmentShadowPosition1 = mat4(
        shadowColumn4,
        shadowColumn5,
        shadowColumn6,
        shadowColumn7
    ) * worldPosition;
    fragmentShadowParams = shadowParams;
    fragmentShadowSplits = shadowSplits;
    fragmentShadowFilter = shadowFilter;
    fragmentTexIndex0 = inst.texIndex0;
    fragmentTexIndex1 = inst.texIndex1;
}
