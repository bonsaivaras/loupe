#version 300 es
precision highp float;

in  vec2 vUv;
out vec4 fragColor;

uniform sampler2D uImage;

// Spot healing runs here, before anything else, because vUv is still SOURCE
// space at this point — so spots follow rotation and flip with no extra work,
// and the patched pixels get the same tone treatment as their surroundings.
#define MAX_SPOTS 24
uniform int   uSpotCount;
uniform float uSpotAspect;          // source width / height
uniform vec4  uSpots[MAX_SPOTS];    // xy = blemish centre, zw = source centre
uniform float uSpotRadius[MAX_SPOTS];

/**
 * Mean of eight taps on a ring just outside the patch. The difference between
 * the destination's ring and the source's ring is the tone step between the two
 * areas; adding it to the copied pixels is a cheap stand-in for a Poisson
 * solve, and it is what stops a heal showing up as a lighter or darker disc.
 */
vec3 ringMean(vec2 centre, float radius) {
  vec2 aspect = vec2(1.0 / uSpotAspect, 1.0);
  vec3 sum = vec3(0.0);
  for (int i = 0; i < 8; ++i) {
    float a = 6.2831853 * float(i) / 8.0;
    sum += texture(uImage, centre + vec2(cos(a), sin(a)) * radius * 1.3 * aspect).rgb;
  }
  return sum / 8.0;
}

vec3 healSpots(vec3 colour, vec2 uv) {
  for (int i = 0; i < MAX_SPOTS; ++i) {
    if (i >= uSpotCount) break;
    vec2 dst = uSpots[i].xy;
    vec2 src = uSpots[i].zw;
    float radius = uSpotRadius[i];
    // Circular in pixels, not in UV, so a spot is round on any aspect ratio.
    vec2 d = (uv - dst) * vec2(uSpotAspect, 1.0);
    float t = length(d) / radius;
    if (t >= 1.0) continue;

    vec3 donor = texture(uImage, uv + (src - dst)).rgb;
    vec3 tone = ringMean(dst, radius) - ringMean(src, radius);
    // Feather the last quarter so the patch edge never shows as a hard rim.
    float w = 1.0 - smoothstep(0.75, 1.0, t);
    colour = mix(colour, clamp(donor + tone, 0.0, 1.0), w);
  }
  return colour;
}
uniform float uTemp;        // -100..100
uniform float uTint;        // -100..100
uniform float uExposure;    //   -5..5   (EV)
uniform float uContrast;    // -100..100
uniform float uHighlights;  // -100..100
uniform float uShadows;     // -100..100
uniform float uWhites;      // -100..100
uniform float uBlacks;      // -100..100

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec3 srgbToLinear(vec3 c) {
  return mix(c / 12.92,
             pow((c + 0.055) / 1.055, vec3(2.4)),
             step(vec3(0.04045), c));
}

vec3 linearToSrgb(vec3 c) {
  c = max(c, 0.0);
  return mix(c * 12.92,
             1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055,
             step(vec3(0.0031308), c));
}

void main() {
  vec3 source = texture(uImage, vUv).rgb;
  if (uSpotCount > 0) source = healSpots(source, vUv);
  vec3 lin = srgbToLinear(source);

  // ---- white balance -------------------------------------------------------
  float t = uTemp / 100.0;   // + warmer
  float g = uTint / 100.0;   // + magenta
  vec3 wb = vec3(1.0 + 0.30 * t + 0.10 * g,
                 1.0             - 0.20 * g,
                 1.0 - 0.30 * t + 0.10 * g);
  wb /= max(dot(wb, LUMA), 1e-4);
  lin *= wb;

  // ---- exposure ------------------------------------------------------------
  lin *= exp2(uExposure);

  // ---- tonal regions -------------------------------------------------------
  // Tonal position on a 6-stop log scale anchored so that y=1 -> ly=1.
  float y  = max(dot(lin, LUMA), 1e-5);
  float ly = clamp(log2(y) / 6.0 + 1.0, 0.0, 1.0);

  float mHi  =       smoothstep(0.55, 1.00, ly);
  float mSh  = 1.0 - smoothstep(0.15, 0.65, ly);
  float mWh  =       smoothstep(0.80, 1.00, ly);
  float mBl  = 1.0 - smoothstep(0.00, 0.30, ly);

  float ev = (uHighlights / 100.0) * 1.5 * mHi
           + (uShadows    / 100.0) * 1.5 * mSh
           + (uWhites     / 100.0) * 1.0 * mWh
           + (uBlacks     / 100.0) * 1.0 * mBl;
  lin *= exp2(ev);

  // ---- to display space ----------------------------------------------------
  vec3 d = clamp(linearToSrgb(lin), 0.0, 1.0);

  // ---- contrast (S-curve about 0.5) ---------------------------------------
  // NOTE: `flat` is a reserved interpolation qualifier in GLSL ES 3.00 — hence
  // `flatten`. Do not "tidy" this name.
  float c = uContrast / 100.0;
  vec3 sCurve  = d * d * (3.0 - 2.0 * d);
  vec3 flatten = 0.5 + (d - 0.5) * 0.5;
  d = (c >= 0.0) ? mix(d, sCurve, c) : mix(d, flatten, -c);

  fragColor = vec4(d, 1.0);
}
