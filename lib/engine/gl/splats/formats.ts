// lib/engine/gl/splats/formats.ts
//
// Gaussian splat file parsers → SplatData (design doc §4B). Two formats:
//
// - `.splat` (antimatter15's format): flat 32-byte records, already laid out
//   exactly like SplatData's own fields (pos f32×3, scale f32×3, rgba u8×4,
//   quat u8×4) — parsing is a straight memcpy per record, no decode step.
// - binary_little_endian `.ply` (the INRIA 3D Gaussian Splatting training
//   output): a text header naming arbitrarily-ordered per-vertex properties
//   followed by a flat binary blob. We parse the header to find each named
//   property's byte offset (order varies by exporter — SH `f_rest_*` terms,
//   normals, etc. are present in real files and must be skipped over via
//   their declared size, not assumed absent) and decode: color from the
//   0th-order spherical-harmonic DC term, opacity via sigmoid, scale via exp
//   (INRIA stores log-scale), rotation normalized then packed into our uint8
//   quat encoding (see `encodeUnitToByte`/`decodeByteToUnit` below).
//
// SOG (the third format oryzo.ai actually uses) is explicitly out of scope —
// it's a webp-tiled payload requiring an image decode pipeline, not a simple
// binary parse; documented here rather than stubbed, per design doc §4B.
//
// Pure, worker-safe: no three/DOM import, just ArrayBuffer/DataView.

import type { SplatData } from "../../types";

// ---------------------------------------------------------------------------
// Shared uint8 <-> unit-float [-1, 1] quaternion-component codec.
//
// SplatData.quats is deliberately left as opaque Uint8Array (matching the
// `.splat` format's own on-disk representation, which we pass through
// unchanged) rather than decoded Float32 — so every producer (this file's
// `.ply` decoder, synthesize.ts) and consumer (SplatMesh.ts's shader) must
// agree on one packing convention. We use the simple full-range affine map
// below. NOTE: this is *not* bit-identical to antimatter15's own real-world
// `.splat` files (which historically pack as `(byte - 128) / 128`, a
// slightly different center/scale) — since `.splat` bytes are passed through
// verbatim rather than decoded and re-encoded here, loading a genuine
// external `.splat` file will decode its quaternions with a barely-visible
// affine skew under our formula. Flagged as an assumption in the workstream
// return notes; harmless for our own synthesized/`.ply` content, which is
// encoded and decoded with the exact same formula end-to-end.
// ---------------------------------------------------------------------------

/** Maps a component in [-1, 1] to a quantized byte in [0, 255]. */
export function encodeUnitToByte(component: number): number {
  const clamped = Math.min(1, Math.max(-1, component));
  return Math.round((clamped * 0.5 + 0.5) * 255);
}

/** Inverse of `encodeUnitToByte`: byte in [0, 255] -> component in [-1, 1]. */
export function decodeByteToUnit(byte: number): number {
  return (byte / 255) * 2 - 1;
}

// ---------------------------------------------------------------------------
// .splat (antimatter15) — 32-byte flat records.
// ---------------------------------------------------------------------------

export const SPLAT_RECORD_BYTES = 32;

/**
 * Parses an antimatter15-format `.splat` buffer. Each 32-byte record is
 * `pos: f32×3, scale: f32×3, rgba: u8×4, quat: u8×4` (little-endian) — this
 * is already SplatData's exact byte layout, so parsing is direct field
 * extraction with no unit conversion.
 */
export function parseSplat(buffer: ArrayBuffer): SplatData {
  if (buffer.byteLength === 0 || buffer.byteLength % SPLAT_RECORD_BYTES !== 0) {
    throw new Error(
      `parseSplat: buffer length ${buffer.byteLength} is not a positive multiple of ${SPLAT_RECORD_BYTES} bytes`
    );
  }

  const count = buffer.byteLength / SPLAT_RECORD_BYTES;
  const view = new DataView(buffer);
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 4);
  const quats = new Uint8Array(count * 4);

  for (let i = 0; i < count; i++) {
    const base = i * SPLAT_RECORD_BYTES;

    positions[i * 3 + 0] = view.getFloat32(base + 0, true);
    positions[i * 3 + 1] = view.getFloat32(base + 4, true);
    positions[i * 3 + 2] = view.getFloat32(base + 8, true);

    scales[i * 3 + 0] = view.getFloat32(base + 12, true);
    scales[i * 3 + 1] = view.getFloat32(base + 16, true);
    scales[i * 3 + 2] = view.getFloat32(base + 20, true);

    colors[i * 4 + 0] = view.getUint8(base + 24);
    colors[i * 4 + 1] = view.getUint8(base + 25);
    colors[i * 4 + 2] = view.getUint8(base + 26);
    colors[i * 4 + 3] = view.getUint8(base + 27);

    quats[i * 4 + 0] = view.getUint8(base + 28);
    quats[i * 4 + 1] = view.getUint8(base + 29);
    quats[i * 4 + 2] = view.getUint8(base + 30);
    quats[i * 4 + 3] = view.getUint8(base + 31);
  }

  return { count, positions, scales, colors, quats };
}

// ---------------------------------------------------------------------------
// binary_little_endian .ply — INRIA 3D Gaussian Splatting fields.
// ---------------------------------------------------------------------------

/** 0th-order spherical-harmonic normalization constant (Y_0^0). */
export const SH_C0 = 0.28209479177387814;

export function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

const PLY_TYPE_SIZES: Record<string, number> = {
  char: 1,
  int8: 1,
  uchar: 1,
  uint8: 1,
  short: 2,
  int16: 2,
  ushort: 2,
  uint16: 2,
  int: 4,
  int32: 4,
  uint: 4,
  uint32: 4,
  float: 4,
  float32: 4,
  double: 8,
  float64: 8,
};

interface PlyProperty {
  name: string;
  type: string;
  offset: number;
  size: number;
}

interface PlyHeader {
  vertexCount: number;
  properties: Map<string, PlyProperty>;
  stride: number;
  dataStart: number;
}

/** Reads the ASCII header of a binary_little_endian PLY, up to `end_header`. */
function parsePlyHeader(buffer: ArrayBuffer): PlyHeader {
  // Headers are always ASCII regardless of body encoding; scan a generous
  // prefix (real gaussian-splat headers are a few dozen lines) as text.
  const headerScanBytes = Math.min(buffer.byteLength, 1 << 16);
  const prefix = new TextDecoder("ascii").decode(new Uint8Array(buffer, 0, headerScanBytes));

  const endMarker = "end_header";
  const endIdx = prefix.indexOf(endMarker);
  if (endIdx === -1) {
    throw new Error("parsePly: no end_header found (not a valid PLY, or header exceeds scan window)");
  }
  // Binary data starts immediately after the newline following "end_header".
  const newlineIdx = prefix.indexOf("\n", endIdx);
  if (newlineIdx === -1) {
    throw new Error("parsePly: malformed header (end_header not newline-terminated)");
  }
  const dataStart = newlineIdx + 1;

  const headerText = prefix.slice(0, endIdx);
  const lines = headerText.split("\n").map((l) => l.trim()).filter(Boolean);

  if (!lines[0]?.startsWith("ply")) {
    throw new Error("parsePly: missing 'ply' magic line");
  }
  const formatLine = lines.find((l) => l.startsWith("format"));
  if (!formatLine || !formatLine.includes("binary_little_endian")) {
    throw new Error(
      `parsePly: only 'format binary_little_endian' is supported, got: ${formatLine ?? "(none)"}`
    );
  }

  let vertexCount = -1;
  let inVertexElement = false;
  const properties = new Map<string, PlyProperty>();
  let offset = 0;

  for (const line of lines) {
    if (line.startsWith("element")) {
      const [, name, countStr] = line.split(/\s+/);
      inVertexElement = name === "vertex";
      if (inVertexElement) vertexCount = Number.parseInt(countStr ?? "", 10);
      continue;
    }
    if (line.startsWith("property") && inVertexElement) {
      const parts = line.split(/\s+/); // "property <type> <name>" (list properties unsupported/unexpected for gaussian fields)
      const type = parts[1] ?? "";
      const name = parts[2] ?? "";
      const size = PLY_TYPE_SIZES[type];
      if (size === undefined) {
        throw new Error(`parsePly: unsupported property type "${type}" for "${name}"`);
      }
      properties.set(name, { name, type, offset, size });
      offset += size;
    }
  }

  if (vertexCount < 0) {
    throw new Error("parsePly: no 'element vertex N' found");
  }

  return { vertexCount, properties, stride: offset, dataStart };
}

function requireProp(header: PlyHeader, name: string): PlyProperty {
  const prop = header.properties.get(name);
  if (!prop) {
    throw new Error(`parsePly: required property "${name}" missing from header`);
  }
  return prop;
}

function readPlyFloat(view: DataView, base: number, prop: PlyProperty): number {
  switch (prop.type) {
    case "float":
    case "float32":
      return view.getFloat32(base + prop.offset, true);
    case "double":
    case "float64":
      return view.getFloat64(base + prop.offset, true);
    case "uchar":
    case "uint8":
      return view.getUint8(base + prop.offset);
    case "char":
    case "int8":
      return view.getInt8(base + prop.offset);
    case "short":
    case "int16":
      return view.getInt16(base + prop.offset, true);
    case "ushort":
    case "uint16":
      return view.getUint16(base + prop.offset, true);
    case "int":
    case "int32":
      return view.getInt32(base + prop.offset, true);
    case "uint":
    case "uint32":
      return view.getUint32(base + prop.offset, true);
    default:
      throw new Error(`parsePly: unsupported property type "${prop.type}"`);
  }
}

/**
 * Parses a binary_little_endian INRIA 3D Gaussian Splatting `.ply`. Property
 * order in the header is read generically (not assumed) so unrelated fields
 * (normals, higher-order `f_rest_*` SH coefficients, etc.) are stepped over
 * correctly via their declared byte size even though we only extract:
 * position (x,y,z), scale (scale_0..2, stored log-scale -> exp), rotation
 * (rot_0..3, normalized then packed via `encodeUnitToByte`), color (f_dc_0..2
 * via the SH DC term: `0.5 + SH_C0 * dc`), and opacity (sigmoid activation).
 */
export function parsePly(buffer: ArrayBuffer): SplatData {
  const header = parsePlyHeader(buffer);
  const count = header.vertexCount;

  const px = requireProp(header, "x");
  const py = requireProp(header, "y");
  const pz = requireProp(header, "z");
  const s0 = requireProp(header, "scale_0");
  const s1 = requireProp(header, "scale_1");
  const s2 = requireProp(header, "scale_2");
  const r0 = requireProp(header, "rot_0");
  const r1 = requireProp(header, "rot_1");
  const r2 = requireProp(header, "rot_2");
  const r3 = requireProp(header, "rot_3");
  const dc0 = requireProp(header, "f_dc_0");
  const dc1 = requireProp(header, "f_dc_1");
  const dc2 = requireProp(header, "f_dc_2");
  const opacityProp = requireProp(header, "opacity");

  const expectedBytes = header.dataStart + count * header.stride;
  if (buffer.byteLength < expectedBytes) {
    throw new Error(
      `parsePly: buffer too short — header declares ${count} vertices x ${header.stride} bytes ` +
        `starting at ${header.dataStart}, need ${expectedBytes} bytes, got ${buffer.byteLength}`
    );
  }

  const view = new DataView(buffer);
  const positions = new Float32Array(count * 3);
  const scales = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 4);
  const quats = new Uint8Array(count * 4);

  for (let i = 0; i < count; i++) {
    const base = header.dataStart + i * header.stride;

    positions[i * 3 + 0] = readPlyFloat(view, base, px);
    positions[i * 3 + 1] = readPlyFloat(view, base, py);
    positions[i * 3 + 2] = readPlyFloat(view, base, pz);

    scales[i * 3 + 0] = Math.exp(readPlyFloat(view, base, s0));
    scales[i * 3 + 1] = Math.exp(readPlyFloat(view, base, s1));
    scales[i * 3 + 2] = Math.exp(readPlyFloat(view, base, s2));

    const rawR0 = readPlyFloat(view, base, r0);
    const rawR1 = readPlyFloat(view, base, r1);
    const rawR2 = readPlyFloat(view, base, r2);
    const rawR3 = readPlyFloat(view, base, r3);
    const rNorm = Math.sqrt(rawR0 * rawR0 + rawR1 * rawR1 + rawR2 * rawR2 + rawR3 * rawR3) || 1;
    quats[i * 4 + 0] = encodeUnitToByte(rawR0 / rNorm);
    quats[i * 4 + 1] = encodeUnitToByte(rawR1 / rNorm);
    quats[i * 4 + 2] = encodeUnitToByte(rawR2 / rNorm);
    quats[i * 4 + 3] = encodeUnitToByte(rawR3 / rNorm);

    const dcR = readPlyFloat(view, base, dc0);
    const dcG = readPlyFloat(view, base, dc1);
    const dcB = readPlyFloat(view, base, dc2);
    colors[i * 4 + 0] = Math.round(clamp01(0.5 + SH_C0 * dcR) * 255);
    colors[i * 4 + 1] = Math.round(clamp01(0.5 + SH_C0 * dcG) * 255);
    colors[i * 4 + 2] = Math.round(clamp01(0.5 + SH_C0 * dcB) * 255);
    colors[i * 4 + 3] = Math.round(sigmoid(readPlyFloat(view, base, opacityProp)) * 255);
  }

  return { count, positions, scales, colors, quats };
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}
