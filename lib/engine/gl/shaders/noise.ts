// lib/engine/gl/shaders/noise.ts
//
// GLSL noise chunks as plain strings, meant to be concatenated into a
// ShaderMaterial's vertex/fragment source (e.g. `` `${simplex3d}\n${curlNoise}\n...` ``).
// Pure data — no three/DOM dependency, so this file is worker-safe like the
// rest of gl/. `curlNoise` and `fbm` both call `simplex3d`'s function, so any
// shader using them must concatenate `simplex3d` first.
//
// Ashima/McEwan simplex noise, adapted (webgl-noise, MIT-style license,
// public-domain-equivalent — the canonical GLSL implementation used across
// the WebGL ecosystem).

/** `float simplex3d(vec3 v)` — classic 3D simplex noise, range ~[-1, 1]. */
export const simplex3d = /* glsl */ `
vec3 mod289_simplex3d(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289_simplex3d(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute_simplex3d(vec4 x) { return mod289_simplex3d(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt_simplex3d(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float simplex3d(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289_simplex3d(i);
  vec4 p = permute_simplex3d(permute_simplex3d(permute_simplex3d(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);

  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt_simplex3d(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

/** `float simplex4d(vec4 v)` — classic 4D simplex noise, range ~[-1, 1]. */
export const simplex4d = /* glsl */ `
vec4 mod289_simplex4d(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
float mod289_simplex4d(float x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute_simplex4d(vec4 x) { return mod289_simplex4d(((x * 34.0) + 1.0) * x); }
float permute_simplex4d(float x) { return mod289_simplex4d(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt_simplex4d(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float taylorInvSqrt_simplex4d(float r) { return 1.79284291400159 - 0.85373472095314 * r; }

vec4 grad4_simplex4d(float j, vec4 ip) {
  const vec4 ones = vec4(1.0, 1.0, 1.0, -1.0);
  vec4 p, s;

  p.xyz = floor(fract(vec3(j) * ip.xyz) * 7.0) * ip.z - 1.0;
  p.w = 1.5 - dot(abs(p.xyz), ones.xyz);
  s = vec4(lessThan(p, vec4(0.0)));
  p.xyz = p.xyz + (s.xyz * 2.0 - 1.0) * s.www;

  return p;
}

float simplex4d(vec4 v) {
  const vec4 C = vec4(0.138196601125011, 0.276393202250021, 0.414589803375032, -0.447213595499958);

  vec4 i = floor(v + dot(v, vec4(0.309016994374947451)));
  vec4 x0 = v - i + dot(i, C.xxxx);

  vec4 i0;
  vec3 isX = step(x0.yzw, x0.xxx);
  vec3 isYZ = step(x0.zww, x0.yyz);
  i0.x = isX.x + isX.y + isX.z;
  i0.yzw = 1.0 - isX;
  i0.y += isYZ.x + isYZ.y;
  i0.zw += 1.0 - isYZ.xy;
  i0.z += isYZ.z;
  i0.w += 1.0 - isYZ.z;

  vec4 i3 = clamp(i0, 0.0, 1.0);
  vec4 i2 = clamp(i0 - 1.0, 0.0, 1.0);
  vec4 i1 = clamp(i0 - 2.0, 0.0, 1.0);

  vec4 x1 = x0 - i1 + C.xxxx;
  vec4 x2 = x0 - i2 + C.yyyy;
  vec4 x3 = x0 - i3 + C.zzzz;
  vec4 x4 = x0 + C.wwww;

  i = mod289_simplex4d(i);
  float j0 = permute_simplex4d(permute_simplex4d(permute_simplex4d(permute_simplex4d(i.w) + i.z) + i.y) + i.x);
  vec4 j1 = permute_simplex4d(permute_simplex4d(permute_simplex4d(permute_simplex4d(
      i.w + vec4(i1.w, i2.w, i3.w, 1.0))
    + i.z + vec4(i1.z, i2.z, i3.z, 1.0))
    + i.y + vec4(i1.y, i2.y, i3.y, 1.0))
    + i.x + vec4(i1.x, i2.x, i3.x, 1.0));

  vec4 ip = vec4(1.0 / 294.0, 1.0 / 49.0, 1.0 / 7.0, 0.0);

  vec4 p0 = grad4_simplex4d(j0, ip);
  vec4 p1 = grad4_simplex4d(j1.x, ip);
  vec4 p2 = grad4_simplex4d(j1.y, ip);
  vec4 p3 = grad4_simplex4d(j1.z, ip);
  vec4 p4 = grad4_simplex4d(j1.w, ip);

  vec4 norm = taylorInvSqrt_simplex4d(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  p4 *= taylorInvSqrt_simplex4d(dot(p4, p4));

  vec3 m0 = max(0.6 - vec3(dot(x0, x0), dot(x1, x1), dot(x2, x2)), 0.0);
  vec2 m1 = max(0.6 - vec2(dot(x3, x3), dot(x4, x4)), 0.0);
  m0 = m0 * m0;
  m1 = m1 * m1;
  return 49.0 * (dot(m0 * m0, vec3(dot(p0, x0), dot(p1, x1), dot(p2, x2)))
    + dot(m1 * m1, vec2(dot(p3, x3), dot(p4, x4))));
}
`;

/**
 * `vec3 curlNoise(vec3 p)` — divergence-free curl of the simplex3d gradient
 * field, used for GPU particle flow (see docs §4 particles / gpgpu). Depends
 * on `simplex3d` being concatenated before it in the final shader source.
 */
export const curlNoise = /* glsl */ `
vec3 curlNoise(vec3 p) {
  const float e = 0.1;
  vec3 dx = vec3(e, 0.0, 0.0);
  vec3 dy = vec3(0.0, e, 0.0);
  vec3 dz = vec3(0.0, 0.0, e);

  float x0 = simplex3d(p - dx);
  float x1 = simplex3d(p + dx);
  float y0 = simplex3d(p - dy);
  float y1 = simplex3d(p + dy);
  float z0 = simplex3d(p - dz);
  float z1 = simplex3d(p + dz);

  float dydz = (y1 - y0) - (z1 - z0);
  float dzdx = (z1 - z0) - (x1 - x0);
  float dxdy = (x1 - x0) - (y1 - y0);

  return normalize(vec3(dydz, dzdx, dxdy) / (2.0 * e));
}
`;

/**
 * `float fbm(vec3 p)` — 5-octave fractal Brownian motion over simplex3d.
 * Depends on `simplex3d` being concatenated before it.
 */
export const fbm = /* glsl */ `
float fbm(vec3 p) {
  float sum = 0.0;
  float amp = 0.5;
  float freq = 1.0;
  for (int i = 0; i < 5; i++) {
    sum += amp * simplex3d(p * freq);
    freq *= 2.0;
    amp *= 0.5;
  }
  return sum;
}
`;
