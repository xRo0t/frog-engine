#version 450

layout(location = 0) out vec4 outColor;

layout(set = 0, binding = 0) uniform sampler2D sceneTexture;

layout(push_constant) uniform BloomPushConstants {
    vec4 params;     // threshold, intensity, radius pixels, scatter
    vec4 texelSize;  // 1/width, 1/height, width, height
    vec4 tone;       // exposure, tone mapper, reserved, reserved
} bloom;

vec3 brightPart(vec3 color, float threshold) {
    float peak = max(max(color.r, color.g), color.b);
    float knee = max(peak - threshold, 0.0);
    return color * (knee / max(peak, 0.0001));
}

vec3 toneMapAces(vec3 color) {
    const float a = 2.51;
    const float b = 0.03;
    const float c = 2.43;
    const float d = 0.59;
    const float e = 0.14;
    return clamp((color * (a * color + b)) / (color * (c * color + d) + e), 0.0, 1.0);
}

vec3 toneMap(vec3 color, int mode) {
    if (mode == 1) {
        return toneMapAces(color);
    }
    if (mode == 2) {
        return color / (vec3(1.0) + color);
    }
    return clamp(color, 0.0, 1.0);
}

void main() {
    vec2 uv = gl_FragCoord.xy * bloom.texelSize.xy;
    vec3 base = texture(sceneTexture, uv).rgb;

    float threshold = max(bloom.params.x, 0.0);
    float intensity = max(bloom.params.y, 0.0);
    float radius = max(bloom.params.z, 0.25);
    float scatter = clamp(bloom.params.w, 0.0, 1.0);

    // A normalized 5x5 Gaussian kernel makes the halo continuous. Radius is
    // specified in output pixels, so it remains visually stable with render scale.
    float sigma = mix(0.90, 1.65, scatter);
    float invTwoSigmaSquared = 0.5 / (sigma * sigma);
    vec2 sampleStep = bloom.texelSize.xy * (radius * 0.5);
    vec3 bloomColor = vec3(0.0);
    if (intensity > 0.0001) {
        float weightTotal = 0.0;
        for (int y = -2; y <= 2; y++) {
            for (int x = -2; x <= 2; x++) {
                float distanceSquared = float(x * x + y * y);
                float weight = exp(-distanceSquared * invTwoSigmaSquared);
                vec2 sampleUv = uv + vec2(float(x), float(y)) * sampleStep;
                vec3 sampleColor = texture(sceneTexture, sampleUv).rgb;
                bloomColor += brightPart(sampleColor, threshold) * weight;
                weightTotal += weight;
            }
        }
        bloomColor /= max(weightTotal, 0.0001);
    }

    vec3 hdrColor = base + bloomColor * intensity * mix(0.35, 1.0, scatter);
    float exposure = max(bloom.tone.x, 0.0);
    int toneMode = int(floor(bloom.tone.y + 0.5));
    vec3 color = toneMap(hdrColor * exposure, toneMode);
    outColor = vec4(color, 1.0);
}
