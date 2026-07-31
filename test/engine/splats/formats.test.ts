// test/engine/splats/formats.test.ts
//
// gl/splats/formats.ts — both parsers against handcrafted fixture buffers
// (built in-test, byte-for-byte, rather than checked-in binary fixtures) plus
// the shared uint8<->unit-float quaternion codec.

import { describe, expect, it } from "vitest";
import {
  SH_C0,
  SPLAT_RECORD_BYTES,
  decodeByteToUnit,
  encodeUnitToByte,
  parsePly,
  parseSplat,
  sigmoid,
} from "@/lib/engine/gl/splats/formats";

describe("encodeUnitToByte / decodeByteToUnit", () => {
  it("round-trips endpoints and midpoint of [-1, 1] within 1/255 precision", () => {
    expect(encodeUnitToByte(-1)).toBe(0);
    expect(encodeUnitToByte(1)).toBe(255);
    expect(encodeUnitToByte(0)).toBe(128); // Math.round(127.5) rounds up

    expect(decodeByteToUnit(0)).toBeCloseTo(-1, 5);
    expect(decodeByteToUnit(255)).toBeCloseTo(1, 5);
    for (const v of [-1, -0.5, 0, 0.3333, 0.9, 1]) {
      expect(decodeByteToUnit(encodeUnitToByte(v))).toBeCloseTo(v, 2);
    }
  });

  it("clamps out-of-range components into [-1, 1] before encoding", () => {
    expect(encodeUnitToByte(5)).toBe(255);
    expect(encodeUnitToByte(-5)).toBe(0);
  });
});

describe("parseSplat — antimatter15 32-byte records", () => {
  function buildSplatBuffer(records: Array<{
    pos: [number, number, number];
    scale: [number, number, number];
    rgba: [number, number, number, number];
    quat: [number, number, number, number];
  }>): ArrayBuffer {
    const buffer = new ArrayBuffer(records.length * SPLAT_RECORD_BYTES);
    const view = new DataView(buffer);
    records.forEach((rec, i) => {
      const base = i * SPLAT_RECORD_BYTES;
      view.setFloat32(base + 0, rec.pos[0], true);
      view.setFloat32(base + 4, rec.pos[1], true);
      view.setFloat32(base + 8, rec.pos[2], true);
      view.setFloat32(base + 12, rec.scale[0], true);
      view.setFloat32(base + 16, rec.scale[1], true);
      view.setFloat32(base + 20, rec.scale[2], true);
      view.setUint8(base + 24, rec.rgba[0]);
      view.setUint8(base + 25, rec.rgba[1]);
      view.setUint8(base + 26, rec.rgba[2]);
      view.setUint8(base + 27, rec.rgba[3]);
      view.setUint8(base + 28, rec.quat[0]);
      view.setUint8(base + 29, rec.quat[1]);
      view.setUint8(base + 30, rec.quat[2]);
      view.setUint8(base + 31, rec.quat[3]);
    });
    return buffer;
  }

  it("parses a single handcrafted record exactly", () => {
    const buffer = buildSplatBuffer([
      { pos: [1, -2, 3.5], scale: [0.1, 0.2, 0.3], rgba: [10, 20, 30, 255], quat: [0, 0, 128, 255] },
    ]);
    const data = parseSplat(buffer);

    expect(data.count).toBe(1);
    expect(Array.from(data.positions)).toEqual([1, -2, 3.5]);
    expect(data.scales[0]).toBeCloseTo(0.1, 5);
    expect(data.scales[1]).toBeCloseTo(0.2, 5);
    expect(data.scales[2]).toBeCloseTo(0.3, 5);
    expect(Array.from(data.colors)).toEqual([10, 20, 30, 255]);
    expect(Array.from(data.quats)).toEqual([0, 0, 128, 255]);
  });

  it("parses multiple records in order", () => {
    const buffer = buildSplatBuffer([
      { pos: [0, 0, 0], scale: [1, 1, 1], rgba: [255, 0, 0, 255], quat: [128, 128, 128, 255] },
      { pos: [5, 6, 7], scale: [2, 2, 2], rgba: [0, 255, 0, 200], quat: [0, 128, 128, 255] },
    ]);
    const data = parseSplat(buffer);

    expect(data.count).toBe(2);
    expect(Array.from(data.positions.subarray(3, 6))).toEqual([5, 6, 7]);
    expect(data.colors[4]).toBe(0); // second record's r
    expect(data.colors[5]).toBe(255); // second record's g
  });

  it("throws on a buffer length that isn't a multiple of 32 bytes", () => {
    expect(() => parseSplat(new ArrayBuffer(31))).toThrow(/32/);
    expect(() => parseSplat(new ArrayBuffer(0))).toThrow();
  });
});

describe("parsePly — binary_little_endian INRIA gaussian fields", () => {
  /** Properties are written in a deliberately "real-world" order (position, an
   * unused normal triple, DC color, opacity, scale, rotation) to exercise
   * offset computation rather than assuming a fixed field order. */
  function buildPlyBuffer(vertices: Array<{
    pos: [number, number, number];
    dc: [number, number, number];
    opacity: number;
    scale: [number, number, number]; // log-scale, as stored
    rot: [number, number, number, number]; // unnormalized, as stored
  }>): ArrayBuffer {
    const header =
      "ply\n" +
      "format binary_little_endian 1.0\n" +
      `element vertex ${vertices.length}\n` +
      "property float x\n" +
      "property float y\n" +
      "property float z\n" +
      "property float nx\n" +
      "property float ny\n" +
      "property float nz\n" +
      "property float f_dc_0\n" +
      "property float f_dc_1\n" +
      "property float f_dc_2\n" +
      "property float opacity\n" +
      "property float scale_0\n" +
      "property float scale_1\n" +
      "property float scale_2\n" +
      "property float rot_0\n" +
      "property float rot_1\n" +
      "property float rot_2\n" +
      "property float rot_3\n" +
      "end_header\n";
    const headerBytes = new TextEncoder().encode(header);
    const stride = 17 * 4; // 17 float32 properties
    const body = new ArrayBuffer(vertices.length * stride);
    const view = new DataView(body);

    vertices.forEach((v, i) => {
      const base = i * stride;
      view.setFloat32(base + 0, v.pos[0], true);
      view.setFloat32(base + 4, v.pos[1], true);
      view.setFloat32(base + 8, v.pos[2], true);
      view.setFloat32(base + 12, 0, true); // nx
      view.setFloat32(base + 16, 0, true); // ny
      view.setFloat32(base + 20, 0, true); // nz
      view.setFloat32(base + 24, v.dc[0], true);
      view.setFloat32(base + 28, v.dc[1], true);
      view.setFloat32(base + 32, v.dc[2], true);
      view.setFloat32(base + 36, v.opacity, true);
      view.setFloat32(base + 40, v.scale[0], true);
      view.setFloat32(base + 44, v.scale[1], true);
      view.setFloat32(base + 48, v.scale[2], true);
      view.setFloat32(base + 52, v.rot[0], true);
      view.setFloat32(base + 56, v.rot[1], true);
      view.setFloat32(base + 60, v.rot[2], true);
      view.setFloat32(base + 64, v.rot[3], true);
    });

    const combined = new Uint8Array(headerBytes.length + body.byteLength);
    combined.set(headerBytes, 0);
    combined.set(new Uint8Array(body), headerBytes.length);
    return combined.buffer;
  }

  it("decodes position, log-scale, sigmoid-opacity, SH-DC color, and normalized rotation", () => {
    const buffer = buildPlyBuffer([
      {
        pos: [1, 2, 3],
        dc: [0, 0, 0], // 0.5 + SH_C0*0 = 0.5 -> byte 128 (rounded)
        opacity: 0, // sigmoid(0) = 0.5 -> byte 128 (rounded)
        scale: [0, Math.log(2), Math.log(4)], // exp -> 1, 2, 4
        rot: [1, 0, 0, 0], // already unit length, w-first convention (order is opaque/pass-through)
      },
    ]);

    const data = parsePly(buffer);
    expect(data.count).toBe(1);
    expect(Array.from(data.positions)).toEqual([1, 2, 3]);

    expect(data.scales[0]).toBeCloseTo(1, 4);
    expect(data.scales[1]).toBeCloseTo(2, 4);
    expect(data.scales[2]).toBeCloseTo(4, 4);

    // 0.5 + SH_C0*0 = 0.5 -> round(0.5*255) = 128 (banker's-adjacent, but Math.round(127.5)=128 in JS)
    expect(data.colors[0]).toBe(128);
    expect(data.colors[1]).toBe(128);
    expect(data.colors[2]).toBe(128);
    expect(data.colors[3]).toBe(Math.round(sigmoid(0) * 255));

    // rotation already unit length: [1,0,0,0] -> byte 255 for the 1-component, 128 for the zeros
    expect(data.quats[0]).toBe(255);
    expect(data.quats[1]).toBe(128);
    expect(data.quats[2]).toBe(128);
    expect(data.quats[3]).toBe(128);
  });

  it("normalizes a non-unit rotation before packing", () => {
    const buffer = buildPlyBuffer([
      {
        pos: [0, 0, 0],
        dc: [1, 1, 1],
        opacity: 10, // sigmoid(10) ~= 1 -> byte 255
        scale: [0, 0, 0], // exp(0) = 1
        rot: [3, 4, 0, 0], // norm = 5 -> normalized (0.6, 0.8, 0, 0)
      },
    ]);
    const data = parsePly(buffer);

    expect(decodeByteToUnit(data.quats[0]!)).toBeCloseTo(0.6, 1);
    expect(decodeByteToUnit(data.quats[1]!)).toBeCloseTo(0.8, 1);
    expect(data.colors[3]).toBe(255);
    // f_dc = 1 -> 0.5 + SH_C0*1 ~= 0.782 -> clamped/rounded, well under 255
    expect(data.colors[0]).toBeGreaterThan(128);
    expect(data.colors[0]).toBeLessThan(255);
  });

  it("clamps SH-derived color to [0, 255] for extreme DC terms", () => {
    const buffer = buildPlyBuffer([
      { pos: [0, 0, 0], dc: [10, -10, 0], opacity: 0, scale: [0, 0, 0], rot: [1, 0, 0, 0] },
    ]);
    const data = parsePly(buffer);
    expect(data.colors[0]).toBe(255); // massively over-bright DC clamps to 255
    expect(data.colors[1]).toBe(0); // massively negative DC clamps to 0
  });

  it("parses multiple vertices at the correct strides", () => {
    const buffer = buildPlyBuffer([
      { pos: [1, 1, 1], dc: [0, 0, 0], opacity: 0, scale: [0, 0, 0], rot: [1, 0, 0, 0] },
      { pos: [9, 8, 7], dc: [0, 0, 0], opacity: 0, scale: [0, 0, 0], rot: [1, 0, 0, 0] },
    ]);
    const data = parsePly(buffer);
    expect(data.count).toBe(2);
    expect(Array.from(data.positions.subarray(3, 6))).toEqual([9, 8, 7]);
  });

  it("throws when a required property is missing from the header", () => {
    // Declares x/y/z but omits every scale_*/rot_*/f_dc_*/opacity property.
    const header =
      "ply\nformat binary_little_endian 1.0\nelement vertex 1\n" +
      "property float x\nproperty float y\nproperty float z\nend_header\n";
    const body = new Uint8Array(12); // one vertex's worth of x/y/z
    const combined = new Uint8Array(new TextEncoder().encode(header).length + body.length);
    combined.set(new TextEncoder().encode(header), 0);
    combined.set(body, new TextEncoder().encode(header).length);
    expect(() => parsePly(combined.buffer)).toThrow(/scale_0/);
  });

  it("throws on a non-binary_little_endian format line", () => {
    const header =
      "ply\nformat ascii 1.0\nelement vertex 1\nproperty float x\nend_header\n";
    const buffer = new TextEncoder().encode(header).buffer;
    expect(() => parsePly(buffer)).toThrow(/binary_little_endian/);
  });

  it("SH_C0 matches the standard Y_0^0 normalization constant", () => {
    expect(SH_C0).toBeCloseTo(0.28209479177387814, 10);
  });
});
