#version 300 es
precision highp float;

in  vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec2 uDir;      // (texelW * 3.0, 0) or (0, texelH * 3.0), texel = 1/quarter-res size

// 9-tap gaussian, sigma ~= 2.4 taps
const float W[5] = float[](0.2270270, 0.1945946, 0.1216216, 0.0540541, 0.0162162);

void main() {
  vec3 sum = texture(uTex, vUv).rgb * W[0];
  for (int i = 1; i < 5; ++i) {
    vec2 o = uDir * float(i);
    sum += texture(uTex, vUv + o).rgb * W[i];
    sum += texture(uTex, vUv - o).rgb * W[i];
  }
  fragColor = vec4(sum, 1.0);
}
