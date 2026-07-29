#version 450

layout(location = 0) flat out mat4 inverseViewProjection;

layout(push_constant) uniform TemporalVertexPushConstants {
    mat4 currentViewProjection;
} temporalVertex;

void main() {
    vec2 positions[3] = vec2[](
        vec2(-1.0, -1.0),
        vec2(3.0, -1.0),
        vec2(-1.0, 3.0)
    );
    // Matrix inversion is performed three times per fullscreen draw instead
    // of once per fragment. All vertices produce the same flat value.
    inverseViewProjection = inverse(temporalVertex.currentViewProjection);
    gl_Position = vec4(positions[gl_VertexIndex], 0.0, 1.0);
}
