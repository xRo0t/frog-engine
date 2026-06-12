#version 450

layout(set = 0, binding = 0) uniform sampler2D textureSampler;

layout(location = 0) in vec3 fragmentColor;
layout(location = 1) in vec2 fragmentUv;
layout(location = 2) in float fragmentFogDistance;

layout(location = 0) out vec4 outColor;

layout(push_constant) uniform PushConstants {
    mat4 viewProjection;
    vec4 fogColor;
    vec4 fogParams;
    vec4 fogShapeProjection;
} pushConstants;

void main() {
    vec4 textureColor = texture(textureSampler, fragmentUv);
    vec4 surfaceColor = vec4(fragmentColor * textureColor.rgb, textureColor.a);

    float fogFactor = 0.0;
    int fogMode = int(pushConstants.fogParams.x + 0.5);
    float fogStart = pushConstants.fogParams.y;
    float fogEnd = pushConstants.fogParams.z;
    float fogDensity = max(pushConstants.fogParams.w, 0.0);

    if (fogMode == 1) {
        float fogRange = max(fogEnd - fogStart, 0.0001);
        fogFactor = clamp((fragmentFogDistance - fogStart) / fogRange, 0.0, 1.0);
    } else if (fogMode == 2) {
        fogFactor = 1.0 - exp(-fogDensity * fragmentFogDistance);
    } else if (fogMode == 3) {
        float scaledDistance = fogDensity * fragmentFogDistance;
        fogFactor = 1.0 - exp(-(scaledDistance * scaledDistance));
    }

    fogFactor = clamp(fogFactor, 0.0, 1.0);
    outColor = vec4(
        mix(surfaceColor.rgb, pushConstants.fogColor.rgb, fogFactor),
        surfaceColor.a
    );
}
