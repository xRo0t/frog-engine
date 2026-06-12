#version 450

layout(location = 0) in vec3 inPosition;
layout(location = 1) in vec3 inColor;
layout(location = 2) in vec4 instanceColumn0;
layout(location = 3) in vec4 instanceColumn1;
layout(location = 4) in vec4 instanceColumn2;
layout(location = 5) in vec4 instanceColumn3;
layout(location = 6) in vec2 inUv;

layout(location = 0) out vec3 fragmentColor;
layout(location = 1) out vec2 fragmentUv;
layout(location = 2) out float fragmentFogDistance;

layout(push_constant) uniform PushConstants {
    mat4 viewProjection;
    vec4 fogColor;
    vec4 fogParams;
    vec4 fogShapeProjection;
} pushConstants;

void main() {
    mat4 modelViewProjection = mat4(
        instanceColumn0,
        instanceColumn1,
        instanceColumn2,
        instanceColumn3
    );
    vec4 clipPosition = modelViewProjection * vec4(inPosition, 1.0);

    float depthDistance = abs(clipPosition.w);
    float fogDistance = depthDistance;
    if (pushConstants.fogShapeProjection.x > 0.5) {
        float projectionX = max(abs(pushConstants.fogShapeProjection.y), 0.0001);
        float projectionY = max(abs(pushConstants.fogShapeProjection.z), 0.0001);
        vec3 viewPosition = vec3(
            clipPosition.x / projectionX,
            clipPosition.y / projectionY,
            clipPosition.w
        );
        fogDistance = length(viewPosition);
    }

    gl_Position = clipPosition;
    fragmentColor = inColor;
    fragmentUv = inUv;
    fragmentFogDistance = fogDistance;
}
