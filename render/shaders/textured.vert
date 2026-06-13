#version 450

layout(location = 0) in vec3 inPosition;
layout(location = 1) in vec3 inColor;
layout(location = 2) in vec4 instanceColumn0;
layout(location = 3) in vec4 instanceColumn1;
layout(location = 4) in vec4 instanceColumn2;
layout(location = 5) in vec4 instanceColumn3;
layout(location = 6) in vec2 inUv;
layout(location = 7) in vec4 instanceMaterial;

layout(location = 0) out vec3 fragmentColor;
layout(location = 1) out vec2 fragmentUv;
layout(location = 2) out float fragmentFogDistance;
layout(location = 3) out vec3 fragmentWorldPosition;
layout(location = 4) flat out vec4 fragmentMaterial;

layout(push_constant) uniform PushConstants {
    mat4 viewProjection;
    vec4 fogColor;
    vec4 fogParams;
    vec4 fogShapeProjectionLight;
    vec4 lightDirectionIntensity;
} pushConstants;

void main() {
    mat4 model = mat4(
        instanceColumn0,
        instanceColumn1,
        instanceColumn2,
        instanceColumn3
    );
    vec4 worldPosition = model * vec4(inPosition, 1.0);
    vec4 clipPosition = pushConstants.viewProjection * worldPosition;

    float projectionX = max(abs(pushConstants.fogShapeProjectionLight.y), 0.0001);
    float projectionY = max(abs(pushConstants.fogShapeProjectionLight.z), 0.0001);
    vec3 viewPosition = vec3(
        clipPosition.x / projectionX,
        clipPosition.y / projectionY,
        -clipPosition.w
    );

    float fogDistance = abs(clipPosition.w);
    if (pushConstants.fogShapeProjectionLight.x > 0.5) {
        fogDistance = length(viewPosition);
    }

    gl_Position = clipPosition;
    fragmentColor = inColor;
    fragmentUv = inUv;
    fragmentFogDistance = fogDistance;
    fragmentWorldPosition = worldPosition.xyz;
    fragmentMaterial = instanceMaterial;
}
