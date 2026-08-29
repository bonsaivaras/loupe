#version 300 es
precision highp float;

in  vec2 vUv;
out vec4 fragColor;

/**
 * One stage of a Van Cittert deconvolution.
 *
 * Deconvolution asks: what image, once blurred by the lens, would have produced
 * the pixels actually recorded? Van Cittert answers it by repeatedly nudging an
 * estimate toward the observation:
 *
 *     est <- est + alpha * (observed - blur(est))
 *
 * Unlike an unsharp mask, which just adds an edge halo, this genuinely inverts
 * a known blur — so mild defocus and lens softness recover real detail. It
 * cannot invent what the sensor never recorded, and it will amplify noise and
 * ring at hard edges, which is why the strength is bounded and the update is
 * clamped.
 *
 * uMode 0: separable gaussian blur of uTex along uDir.
 * uMode 1: the update step, reading the observation and the blurred estimate.
 */
uniform sampler2D uTex;       // mode 0: the image to blur; mode 1: current estimate
uniform sampler2D uObserved;  // mode 1 only
uniform sampler2D uBlurred;   // mode 1 only
uniform vec2  uDir;           // mode 0: texel step along one axis
uniform int   uMode;
uniform float uAlpha;         // feedback gain

// sigma ~= 1.1 taps: a tight kernel, because lens softness is a small radius.
const float W[3] = float[](0.4026, 0.2442, 0.0545);

void main() {
  if (uMode == 0) {
    vec3 sum = texture(uTex, vUv).rgb * W[0];
    for (int i = 1; i < 3; ++i) {
      vec2 o = uDir * float(i);
      sum += texture(uTex, vUv + o).rgb * W[i];
      sum += texture(uTex, vUv - o).rgb * W[i];
    }
    fragColor = vec4(sum, 1.0);
    return;
  }

  vec3 est = texture(uTex, vUv).rgb;
  vec3 obs = texture(uObserved, vUv).rgb;
  vec3 blurred = texture(uBlurred, vUv).rgb;

  // Bounding the correction per iteration is what keeps this from ringing into
  // hard black-and-white fringes at high-contrast edges.
  vec3 correction = clamp((obs - blurred) * uAlpha, -0.25, 0.25);
  fragColor = vec4(clamp(est + correction, 0.0, 1.0), 1.0);
}
