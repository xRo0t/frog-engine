#version 450

layout(location = 0) in vec3 inPosition;
layout(location = 1) in vec3 inNormal;
layout(location = 2) in vec3 inColor;
layout(location = 3) in vec4 instanceColumn0;
layout(location = 4) in vec4 instanceColumn1;
layout(location = 5) in vec4 instanceColumn2;
layout(location = 6) in vec4 instanceColumn3;
layout(location = 7) in vec2 inUv;
layout(location = 8) in vec4 instanceMaterial;
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

layout(location = 0) out vec3 fragmentColor;
layout(location = 1) out vec2 fragmentUv;
layout(location = 2) out float fragmentFogDistance;
layout(location = 3) out vec3 fragmentWorldPosition;
layout(location = 4) flat out vec4 fragmentMaterial;
layout(location = 5) out vec4 fragmentShadowPosition0;
layout(location = 6) out vec4 fragmentShadowPosition1;
layout(location = 7) flat out vec4 fragmentShadowParams;
layout(location = 8) flat out vec4 fragmentShadowSplits;
layout(location = 9) out vec3 fragmentWorldNormal;

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
}
