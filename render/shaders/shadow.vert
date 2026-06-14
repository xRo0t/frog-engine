#version 450

layout(location = 0) in vec3 inPosition;
layout(location = 2) in vec4 instanceColumn0;
layout(location = 3) in vec4 instanceColumn1;
layout(location = 4) in vec4 instanceColumn2;
layout(location = 5) in vec4 instanceColumn3;

layout(push_constant) uniform ShadowPushConstants {
    mat4 lightViewProjection;
} pushConstants;

void main() {
    mat4 model = mat4(
        instanceColumn0,
        instanceColumn1,
        instanceColumn2,
        instanceColumn3
    );
    gl_Position = pushConstants.lightViewProjection * model * vec4(inPosition, 1.0);
}
