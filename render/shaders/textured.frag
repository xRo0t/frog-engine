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

    float slope = 1.0 - max(dot(normal, -lightDirection), 0.0);
    float compareDepth = projected.z - fragmentShadowParams.y - fragmentShadowParams.z * slope;
    float softness = clamp(fragmentShadowParams.w, 0.0, 1.0);
    if (softness <= 0.01) {
        return texture(shadowSampler, vec3(uv, compareDepth));
    }

    vec2 texel = 1.0 / vec2(textureSize(shadowSampler, 0));
    float radius = 0.75 + softness * 1.75;
    float visibility = 0.0;
    for (int y = -1; y <= 1; ++y) {
        for (int x = -1; x <= 1; ++x) {
            vec2 offset = vec2(x, y) * texel * radius;
            visibility += texture(shadowSampler, vec3(uv + offset, compareDepth));
        }
    }
    return visibility / 9.0;
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
