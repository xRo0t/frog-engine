#version 450

layout(set = 0, binding = 0) uniform sampler2D textureSampler;
layout(set = 0, binding = 1) uniform sampler2DShadow shadowSampler;

layout(location = 0) in vec3 fragmentColor;
layout(location = 1) in vec2 fragmentUv;
layout(location = 2) in float fragmentFogDistance;
layout(location = 3) in vec3 fragmentWorldPosition;
layout(location = 4) flat in vec4 fragmentMaterial;
layout(location = 5) in vec4 fragmentShadowPosition;
layout(location = 6) flat in vec4 fragmentShadowParams;

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

float sampleShadow(vec3 normal, vec3 lightDirection) {
    if (fragmentShadowParams.x < 0.5 || receivesShadow() < 0.5) {
        return 1.0;
    }
    if (fragmentShadowPosition.w <= 0.0) {
        return 1.0;
    }

    vec3 projected = fragmentShadowPosition.xyz / fragmentShadowPosition.w;
    vec2 uv = projected.xy * 0.5 + 0.5;
    if (uv.x <= 0.0 || uv.x >= 1.0 || uv.y <= 0.0 || uv.y >= 1.0) {
        return 1.0;
    }
    if (projected.z <= 0.0 || projected.z >= 1.0) {
        return 1.0;
    }

    float normalLight = max(dot(normal, -lightDirection), 0.0);
    if (normalLight <= 0.0001) {
        return 1.0;
    }

    float sine = sqrt(max(1.0 - normalLight * normalLight, 0.0));
    float slope = min(sine / max(normalLight, 0.08), 6.0);
    vec2 texel = 1.0 / vec2(textureSize(shadowSampler, 0));
    vec2 receiverGradient = receiverPlaneDepthGradient(uv, projected.z);
    float receiverFootprint = abs(receiverGradient.x) * texel.x
        + abs(receiverGradient.y) * texel.y;
    float receiverBiasLimit = fragmentShadowParams.y * 2.0
        + fragmentShadowParams.z * 4.0;
    float receiverBias = min(receiverFootprint * 0.75, receiverBiasLimit);
    float depthBias = fragmentShadowParams.y
        + fragmentShadowParams.z * slope
        + receiverBias;

    float softness = clamp(fragmentShadowParams.w, 0.0, 1.0);
    if (softness <= 0.01) {
        float visibility = texture(
            shadowSampler,
            vec3(uv, projected.z - depthBias)
        );
        float grazingWeight = smoothstep(0.025, 0.16, normalLight);
        return mix(1.0, visibility, grazingWeight);
    }

    const vec2 poissonDisk[12] = vec2[](
        vec2(-0.326212, -0.405810),
        vec2(-0.840144, -0.073580),
        vec2(-0.695914,  0.457137),
        vec2(-0.203345,  0.620716),
        vec2( 0.962340, -0.194983),
        vec2( 0.473434, -0.480026),
        vec2( 0.519456,  0.767022),
        vec2( 0.185461, -0.893124),
        vec2( 0.507431,  0.064425),
        vec2( 0.896420,  0.412458),
        vec2(-0.321940, -0.932615),
        vec2(-0.791559, -0.597710)
    );

    int sampleCount = 4;
    if (softness > 0.34) {
        sampleCount = 8;
    }
    if (softness > 0.67) {
        sampleCount = 12;
    }

    float radius = 0.70 + softness * 1.80;
    float visibility = 0.0;
    for (int index = 0; index < sampleCount; ++index) {
        vec2 offset = poissonDisk[index] * texel * radius;
        float sampleDepth = projected.z
            + dot(receiverGradient, offset)
            - depthBias;
        visibility += texture(shadowSampler, vec3(uv + offset, sampleDepth));
    }
    visibility /= float(sampleCount);

    // Directional shadow maps lose useful precision when a receiver is
    // almost parallel to the light. Fade only that unreliable contribution;
    // direct lighting is already close to zero at the same angle.
    float grazingWeight = smoothstep(0.025, 0.16, normalLight);
    return mix(1.0, visibility, grazingWeight);
}

void main() {
    vec4 textureColor = texture(textureSampler, fragmentUv);
    vec4 surfaceColor = vec4(fragmentColor * textureColor.rgb, textureColor.a);

    vec4 emissive = unpackEmissive();
    float packedLight = max(pushConstants.fogShapeProjectionLight.w, 0.0);
    float lightIntensity = max(pushConstants.lightDirectionIntensity.w, 0.0);
    if (packedLight > 0.5 && emissive.a < 0.5) {
        vec3 lightDirection = normalize(pushConstants.lightDirectionIntensity.xyz);
        vec3 dx = dFdx(fragmentWorldPosition);
        vec3 dy = dFdy(fragmentWorldPosition);
        vec3 normal = normalize(cross(dx, dy));
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
