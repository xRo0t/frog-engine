#version 450

layout(set = 0, binding = 0) uniform sampler2D textureSampler;
layout(set = 0, binding = 1) uniform sampler2DShadow shadowSampler;

layout(location = 0) in vec3 fragmentColor;
layout(location = 1) in vec2 fragmentUv;
layout(location = 2) in float fragmentFogDistance;
layout(location = 3) in vec3 fragmentWorldPosition;
layout(location = 4) flat in vec4 fragmentMaterial;
layout(location = 5) in vec4 fragmentShadowPosition0;
layout(location = 6) in vec4 fragmentShadowPosition1;
layout(location = 7) flat in vec4 fragmentShadowParams;
layout(location = 8) flat in vec4 fragmentShadowSplits;
layout(location = 9) in vec3 fragmentWorldNormal;

layout(location = 0) out vec4 outColor;

layout(push_constant) uniform PushConstants {
    mat4 viewProjection;
    vec4 fogColor;
    vec4 fogParams;
    vec4 fogShapeProjectionLight;
    vec4 lightDirectionIntensity;
} pushConstants;

vec4 unpackLight() {
    float packed = max(floor(pushConstants.fogShapeProjectionLight.w + 0.5), 0.0);
    float red = mod(packed, 64.0);
    packed = floor(packed / 64.0);
    float green = mod(packed, 64.0);
    packed = floor(packed / 64.0);
    float blue = mod(packed, 64.0);
    packed = floor(packed / 64.0);
    float ambient = mod(packed, 64.0);
    return vec4(red, green, blue, ambient) / 63.0;
}

vec4 unpackEmissive() {
    float packed = max(floor(fragmentMaterial.w + 0.5), 0.0);
    float red = mod(packed, 32.0);
    packed = floor(packed / 32.0);
    float green = mod(packed, 32.0);
    packed = floor(packed / 32.0);
    float blue = mod(packed, 32.0);
    packed = floor(packed / 32.0);
    float unlit = mod(packed, 2.0);
    return vec4(red / 31.0, green / 31.0, blue / 31.0, unlit);
}

float receivesShadow() {
    float packed = max(floor(fragmentMaterial.w + 0.5), 0.0);
    return mod(floor(packed / 65536.0), 2.0);
}

vec2 receiverPlaneDepthGradient(vec2 uv, float depth) {
    vec2 uvDx = dFdx(uv);
    vec2 uvDy = dFdy(uv);
    vec2 depthDerivatives = vec2(dFdx(depth), dFdy(depth));
    float determinant = uvDx.x * uvDy.y - uvDx.y * uvDy.x;
    if (abs(determinant) < 0.0000001) {
        return vec2(0.0);
    }

    return vec2(
        (uvDy.y * depthDerivatives.x - uvDx.y * depthDerivatives.y) / determinant,
        (-uvDy.x * depthDerivatives.x + uvDx.x * depthDerivatives.y) / determinant
    );
}

float shadowNoise(vec2 position) {
    return fract(52.9829189 * fract(dot(position, vec2(0.06711056, 0.00583715))));
}

float sampleShadowCascade(
    vec4 shadowPosition,
    vec2 atlasOffset,
    vec2 atlasScale,
    vec3 normal,
    vec3 lightDirection,
    float bias,
    float normalBias,
    float softness
) {
    if (shadowPosition.w <= 0.0) {
        return -1.0;
    }

    vec3 projected = shadowPosition.xyz / shadowPosition.w;
    vec2 localUv = projected.xy * 0.5 + 0.5;
    if (localUv.x <= 0.0 || localUv.x >= 1.0 || localUv.y <= 0.0 || localUv.y >= 1.0) {
        return -1.0;
    }
    if (projected.z <= 0.0 || projected.z >= 1.0) {
        return -1.0;
    }

    float normalLight = max(dot(normal, -lightDirection), 0.0);
    if (normalLight <= 0.0001) {
        return 1.0;
    }

    float sine = sqrt(max(1.0 - normalLight * normalLight, 0.0));
    float slope = min(sine / max(normalLight, 0.08), 6.0);
    vec2 atlasUv = atlasOffset + localUv * atlasScale;
    vec2 texel = 1.0 / vec2(textureSize(shadowSampler, 0));
    vec2 localTexel = texel / max(atlasScale, vec2(0.0001));
    vec2 receiverGradient = receiverPlaneDepthGradient(localUv, projected.z);
    float receiverFootprint = abs(receiverGradient.x) * localTexel.x
        + abs(receiverGradient.y) * localTexel.y;
    float receiverBiasLimit = bias * 2.0 + normalBias * 4.0;
    float receiverBias = min(receiverFootprint * 0.75, receiverBiasLimit);
    float depthBias = bias + normalBias * slope + receiverBias;

    float clampedSoftness = clamp(softness, 0.0, 1.0);
    float grazingWeight = smoothstep(0.025, 0.16, normalLight);
    float edgeFade = smoothstep(0.0, 0.035, localUv.x)
        * smoothstep(0.0, 0.035, localUv.y)
        * smoothstep(0.0, 0.035, 1.0 - localUv.x)
        * smoothstep(0.0, 0.035, 1.0 - localUv.y);

    if (clampedSoftness <= 0.01) {
        float visibility = texture(shadowSampler, vec3(atlasUv, projected.z - depthBias));
        return mix(1.0, mix(1.0, visibility, grazingWeight), edgeFade);
    }

    const vec2 diskSamples[40] = vec2[](
        vec2( 0.000000,  0.000000),
        vec2( 0.350000,  0.000000),
        vec2( 0.247487,  0.247487),
        vec2( 0.000000,  0.350000),
        vec2(-0.247487,  0.247487),
        vec2(-0.350000,  0.000000),
        vec2(-0.247487, -0.247487),
        vec2( 0.000000, -0.350000),
        vec2( 0.247487, -0.247487),
        vec2( 0.650000,  0.000000),
        vec2( 0.562917,  0.325000),
        vec2( 0.325000,  0.562917),
        vec2( 0.000000,  0.650000),
        vec2(-0.325000,  0.562917),
        vec2(-0.562917,  0.325000),
        vec2(-0.650000,  0.000000),
        vec2(-0.562917, -0.325000),
        vec2(-0.325000, -0.562917),
        vec2( 0.000000, -0.650000),
        vec2( 0.325000, -0.562917),
        vec2( 0.562917, -0.325000),
        vec2( 1.000000,  0.000000),
        vec2( 0.923880,  0.382683),
        vec2( 0.707107,  0.707107),
        vec2( 0.382683,  0.923880),
        vec2( 0.000000,  1.000000),
        vec2(-0.382683,  0.923880),
        vec2(-0.707107,  0.707107),
        vec2(-0.923880,  0.382683),
        vec2(-1.000000,  0.000000),
        vec2(-0.923880, -0.382683),
        vec2(-0.707107, -0.707107),
        vec2(-0.382683, -0.923880),
        vec2( 0.000000, -1.000000),
        vec2( 0.382683, -0.923880),
        vec2( 0.707107, -0.707107),
        vec2( 0.923880, -0.382683),
        vec2( 0.180240,  0.830640),
        vec2(-0.830640,  0.180240),
        vec2( 0.830640, -0.180240)
    );

    int sampleCount = 8;
    if (clampedSoftness > 0.34) {
        sampleCount = 12;
    }
    if (clampedSoftness > 0.67) {
        sampleCount = 16;
    }
    if (clampedSoftness > 0.92) {
        sampleCount = 28;
    }

    float radius = 0.90 + clampedSoftness * 3.40;
    float visibility = 0.0;
    float totalWeight = 0.0;
    for (int index = 0; index < sampleCount; ++index) {
        vec2 disk = diskSamples[index];
        float weight = 1.15 - length(disk) * 0.35;
        vec2 atlasOffsetSample = disk * texel * radius;
        vec2 localOffsetSample = atlasOffsetSample / max(atlasScale, vec2(0.0001));
        float sampleDepth = projected.z
            + dot(receiverGradient, localOffsetSample)
            - depthBias;
        visibility += texture(shadowSampler, vec3(atlasUv + atlasOffsetSample, sampleDepth)) * weight;
        totalWeight += weight;
    }
    if (totalWeight > 0.0) {
        visibility /= totalWeight;
    } else {
        visibility = texture(shadowSampler, vec3(atlasUv, projected.z - depthBias));
    }

    return mix(1.0, mix(1.0, visibility, grazingWeight), edgeFade);
}

float sampleShadow(vec3 normal, vec3 lightDirection) {
    if (fragmentShadowParams.x < 0.5 || receivesShadow() < 0.5) {
        return 1.0;
    }

    int cascadeCount = int(clamp(floor(fragmentShadowSplits.x + 0.5), 1.0, 2.0));
    float softness = fragmentShadowParams.w;
    if (cascadeCount <= 1) {
        float single = sampleShadowCascade(
            fragmentShadowPosition0,
            vec2(0.0, 0.0),
            vec2(1.0, 1.0),
            normal,
            lightDirection,
            fragmentShadowParams.y,
            fragmentShadowParams.z,
            softness
        );
        if (single < 0.0) {
            return 1.0;
        }
        return single;
    }

    int cascadeIndex = 0;
    if (fragmentFogDistance > fragmentShadowSplits.y) {
        cascadeIndex = 1;
    }

    float selected = -1.0;
    if (cascadeIndex == 0) {
        selected = sampleShadowCascade(
            fragmentShadowPosition0,
            vec2(0.0, 0.0),
            vec2(0.5, 0.5),
            normal,
            lightDirection,
            fragmentShadowParams.y,
            fragmentShadowParams.z,
            softness
        );
        if (selected < 0.0) {
            selected = sampleShadowCascade(
                fragmentShadowPosition1,
                vec2(0.5, 0.0),
                vec2(0.5, 0.5),
                normal,
                lightDirection,
                fragmentShadowSplits.z,
                fragmentShadowSplits.w,
                softness
            );
        }
    } else {
        selected = sampleShadowCascade(
            fragmentShadowPosition1,
            vec2(0.5, 0.0),
            vec2(0.5, 0.5),
            normal,
            lightDirection,
            fragmentShadowSplits.z,
            fragmentShadowSplits.w,
            softness
        );
    }

    if (selected < 0.0) {
        return 1.0;
    }
    return selected;
}

void main() {
    vec4 textureColor = texture(textureSampler, fragmentUv);
    vec4 surfaceColor = vec4(fragmentColor * textureColor.rgb, textureColor.a);

    vec4 emissive = unpackEmissive();
    float packedLight = max(pushConstants.fogShapeProjectionLight.w, 0.0);
    float lightIntensity = max(pushConstants.lightDirectionIntensity.w, 0.0);
    if (packedLight > 0.5 && emissive.a < 0.5) {
        vec3 lightDirection = normalize(pushConstants.lightDirectionIntensity.xyz);
        vec3 normal = normalize(fragmentWorldNormal);
        if (dot(normal, normal) < 0.0001) {
            vec3 dx = dFdx(fragmentWorldPosition);
            vec3 dy = dFdy(fragmentWorldPosition);
            normal = normalize(cross(dx, dy));
        }
        if (!gl_FrontFacing) {
            normal = -normal;
        }

        vec4 light = unpackLight();
        float diffuse = max(dot(normal, -lightDirection), 0.0);
        float wrappedDiffuse = diffuse * 0.85 + 0.15;
        float shadow = sampleShadow(normal, lightDirection);
        vec3 irradiance = vec3(light.a) + light.rgb * wrappedDiffuse * lightIntensity * shadow;
        surfaceColor.rgb *= irradiance;
    }
    surfaceColor.rgb += emissive.rgb * max(fragmentMaterial.z, 0.0);

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
