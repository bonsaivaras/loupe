#version 300 es
out vec2 vUv;
uniform int  uRotate;   // 0,1,2,3 == 0,90,180,270 CW
uniform bool uFlipH;
uniform bool uFlipV;    // source rows are top-down; see note below
// Sub-rectangle of the source to draw, for zooming. (1,1)/(0,0) draws it all.
uniform vec2 uUvScale;
uniform vec2 uUvOffset;

void main() {
  // fullscreen triangle — no vertex attributes, no VBO
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);

  // uFlipH mirrors the OUTPUT, so the flip is always horizontal on screen.
  vec2 uv = p;
  if (uFlipH) uv.x = 1.0 - uv.x;

  // Output coord -> source coord. Sampling through R(+90) rotates the picture
  // by -90 in screen terms, i.e. clockwise. Verified against an asymmetric
  // test image: with uRotate == 1 the source top-left lands top-right.
  vec2 c = uv - 0.5;
  if      (uRotate == 1) c = vec2(-c.y,  c.x);   //  90 CW
  else if (uRotate == 2) c = vec2(-c.x, -c.y);   // 180
  else if (uRotate == 3) c = vec2( c.y, -c.x);   // 270 CW
  vUv = c + 0.5;

  // The WebGL pixel-store flag UNPACK_FLIP_Y_WEBGL is IGNORED for ImageBitmap
  // uploads, so the source texture holds its first (top) row at t = 0 while
  // vUv.y = 0 is the framebuffer bottom. Correcting the lookup here works for
  // every source type. Pass 1 sets this; passes 2-4 read render targets that
  // are already in GL's bottom-up order, so they leave it false.
  if (uFlipV) vUv.y = 1.0 - vUv.y;

  // Applied last so the window is in final image space: zooming never changes
  // the orientation, and filter radii stay in source texels, so what a zoomed
  // pixel shows is exactly what export writes.
  vUv = vUv * uUvScale + uUvOffset;
}
