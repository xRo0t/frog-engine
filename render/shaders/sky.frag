#version 450

layout(location = 0) out vec4 outColor;

layout(push_constant) uniform SkyPushConstants {
    mat4 view;
    vec4 zenithColor;
    vec4 horizonColor;
    vec4 lowerColor;
    vec4 projectionAndSize;
} sky;

float gradientNoise(vec2 position) {
    return fract(52.9829189 * fract(dot(position, vec2(0.06711056, 0.00583715))));
}

void main() {
    vec2 size = max(sky.projectionAndSize.zw, vec2(1.0));
    vec2 ndc = (gl_FragCoord.xy / size) * 2.0 - 1.0;
    float projectionX = max(abs(sky.projectionAndSize.x), 0.0001);
    float projectionY = sky.projectionAndSize.y;
    if (abs(projectionY) < 0.0001) {
        projectionY = -0.0001;
    }

    vec3 viewDirection = normalize(vec3(
        ndc.x / projectionX,
        ndc.y / projectionY,
        -1.0
    ));
    vec3 worldDirection = normalize(transpose(mat3(sky.view)) * viewDirection);

    float worldY = clamp(worldDirection.y, -1.0, 1.0);
    vec3 color;
    if (worldY >= 0.0) {
        color = mix(sky.horizonColor.rgb, sky.zenithColor.rgb, worldY);
    } else {
        color = mix(sky.horizonColor.rgb, sky.lowerColor.rgb, -worldY);
    }

    float dither = (gradientNoise(gl_FragCoord.xy) - 0.5) / 255.0;
    outColor = vec4(clamp(color + vec3(dither), 0.0, 1.0), 1.0);
}
