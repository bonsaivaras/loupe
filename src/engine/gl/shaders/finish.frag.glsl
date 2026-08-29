#version 300 es
precision highp float;

in  vec2 vUv;
out vec4 fragColor;

uniform sampler2D uBase;     // T1
uniform sampler2D uBlur;     // T3 (== T1 when clarity == 0)
uniform vec2  uTexel;        // 1.0 / textureSize(uBase)
uniform float uAspect;       // width / height
uniform float uClarity;      // -100..100
uniform float uSharpen;      //    0..100
uniform float uDenoise;      //    0..100
uniform float uSharpRadius;  // texels; = max(1.0, longEdge / 2560.0)
uniform float uVibrance;     // -100..100
uniform float uSaturation;   // -100..100
uniform float uVignette;     // -100..100

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

// Two rings: the inner eight neighbours plus four at double the radius, which
// reaches the low-frequency blotches without a full 5x5's 25 taps.
const vec2 DENOISE_TAPS[12] = vec2[](
  vec2( 1.0,  0.0), vec2(-1.0,  0.0), vec2( 0.0,  1.0), vec2( 0.0, -1.0),
  vec2( 1.0,  1.0), vec2(-1.0,  1.0), vec2( 1.0, -1.0), vec2(-1.0, -1.0),
  vec2( 2.0,  0.0), vec2(-2.0,  0.0), vec2( 0.0,  2.0), vec2( 0.0, -2.0)
);

void main() {
  vec3 base = texture(uBase, vUv).rgb;

  // ---- noise reduction: bilateral, runs before anything that adds detail ---
  // Edge-preserving: neighbours far from the centre in colour get little weight,
  // so flat areas smooth out while edges survive. Chroma noise is the ugly kind
  // on RAW, so it is smoothed harder than luminance.
  if (uDenoise > 0.0) {
    float s = uDenoise / 100.0;
    vec2 r = uTexel * uSharpRadius;
    // The colour tolerance has to be WIDER than the noise, or the bilateral
    // preserves the noise as if it were edge detail and nothing is removed.
    // Half-weight distance runs from about 3% of range at the low end to 18% at
    // full strength; interpolated in log space so the slider ramps evenly.
    float sigma = exp(mix(6.0, 1.95, s));

    vec3 sum = base;
    float wsum = 1.0;
    for (int i = 0; i < 12; ++i) {
      vec3 c = texture(uBase, vUv + DENOISE_TAPS[i] * r).rgb;
      vec3 d = c - base;
      float w = exp(-dot(d, d) * sigma);
      sum += c * w;
      wsum += w;
    }
    vec3 avg = sum / wsum;

    float yBase = dot(base, LUMA);
    float yAvg  = dot(avg, LUMA);
    // Luminance carries the detail, so it is smoothed less than chroma — but
    // at full strength it still needs to move, or the slider looks inert.
    float luma = mix(yBase, yAvg, s * 0.9);
    vec3 chroma = mix(base - vec3(yBase), avg - vec3(yAvg), s);
    base = clamp(vec3(luma) + chroma, 0.0, 1.0);
  }

  vec3 col  = base;

  // ---- clarity: large-radius local contrast, luminance only ---------------
  if (uClarity != 0.0) {
    float detail = dot(base, LUMA) - dot(texture(uBlur, vUv).rgb, LUMA);
    col += detail * (uClarity / 100.0) * 0.8;
  }

  // ---- sharpen: small-radius unsharp mask, luminance only -----------------
  if (uSharpen > 0.0) {
    vec2 o = uTexel * uSharpRadius;
    vec3 n = texture(uBase, vUv + vec2(o.x, 0.0)).rgb
           + texture(uBase, vUv - vec2(o.x, 0.0)).rgb
           + texture(uBase, vUv + vec2(0.0, o.y)).rgb
           + texture(uBase, vUv - vec2(0.0, o.y)).rgb;
    float hi = dot(base, LUMA) - dot(n * 0.25, LUMA);
    col += hi * (uSharpen / 100.0) * 1.5;
  }

  col = clamp(col, 0.0, 1.0);

  // ---- vibrance: weighted toward already-muted pixels ---------------------
  if (uVibrance != 0.0) {
    float mx  = max(max(col.r, col.g), col.b);
    float mn  = min(min(col.r, col.g), col.b);
    float sat = mx - mn;
    float amt = (uVibrance / 100.0) * (1.0 - sat);
    col = mix(vec3(dot(col, LUMA)), col, 1.0 + amt);
  }

  // ---- saturation: uniform ------------------------------------------------
  if (uSaturation != 0.0) {
    col = mix(vec3(dot(col, LUMA)), col, 1.0 + uSaturation / 100.0);
  }

  // ---- vignette -----------------------------------------------------------
  if (uVignette != 0.0) {
    vec2  d = (vUv - 0.5) * vec2(uAspect, 1.0);
    float r = length(d) / (0.5 * length(vec2(uAspect, 1.0)));
    col *= 1.0 - (uVignette / 100.0) * smoothstep(0.35, 1.05, r);
  }

  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
