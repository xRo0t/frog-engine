#version 450

layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 0) uniform sampler2D skyTexture;

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

vec2 skyObjectUv(vec3 worldDirection, vec3 objectDirection, float radius) {
    vec3 guide = abs(objectDirection.y) > 0.94 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0);
    vec3 right = normalize(cross(guide, objectDirection));
    vec3 up = normalize(cross(objectDirection, right));
    float scale = max(tan(max(radius, 0.001)), 0.0001);
    return vec2(dot(worldDirection, right), dot(worldDirection, up)) / scale * 0.5 + 0.5;
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

    float objectMode = sky.view[3][3];
    if (objectMode > 1.5) {
        vec3 objectDirection = normalize(vec3(sky.view[0][3], sky.view[1][3], sky.view[2][3]));
        float radius = max(sky.zenithColor.a, 0.001);
        float textureScale = max(sky.horizonColor.a, 0.05);
        float textureRadius = radius * textureScale;
        float cosAngle = clamp(dot(worldDirection, objectDirection), -1.0, 1.0);
        if (acos(cosAngle) > textureRadius * 1.45) {
            discard;
        }
        vec2 uv = skyObjectUv(worldDirection, objectDirection, textureRadius);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
            discard;
        }
        vec4 texel = texture(skyTexture, uv);
        float key = max(max(texel.r, texel.g), texel.b);
        float keyedAlpha = smoothstep(0.004, 0.040, key);
        float alpha = texel.a * keyedAlpha;
        if (alpha <= 0.01) {
            discard;
        }
        vec3 tint = sky.view[3].xyz;
        outColor = vec4(clamp(texel.rgb * tint, 0.0, 1.0), alpha);
        return;
    }

    if (objectMode > 0.5) {
        vec3 sunDirection = normalize(vec3(sky.view[0][3], sky.view[1][3], sky.view[2][3]));
        vec3 sunColor = sky.view[3].xyz;
        float cosAngle = clamp(dot(worldDirection, sunDirection), -1.0, 1.0);
        float angle = acos(cosAngle);
        float radius = max(sky.zenithColor.a, 0.001);
        float glow = clamp(sky.horizonColor.a, 0.0, 1.0);
        float softness = clamp(sky.lowerColor.a, 0.0, 1.0);
        float glowRadius = radius * (2.0 + glow * 4.0);
        float aa = max(fwidth(angle), 0.0006);
        float edgeSoftness = mix(aa * 1.5, max(radius * 0.45, aa * 2.5), softness);

        float disc = 1.0 - smoothstep(radius - edgeSoftness, radius + edgeSoftness, angle);
        float halo = 1.0 - smoothstep(radius, glowRadius, angle);
        halo = halo * halo * glow;

        color = mix(color, sunColor, halo * 0.35);
        color = mix(color, sunColor, disc);
    }

    float dither = (gradientNoise(gl_FragCoord.xy) - 0.5) / 255.0;
    outColor = vec4(clamp(color + vec3(dither), 0.0, 1.0), 1.0);
}
