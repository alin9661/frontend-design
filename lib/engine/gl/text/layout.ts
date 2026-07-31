// lib/engine/gl/text/layout.ts
//
// PURE text layout (design doc §4C): kerning, letterSpacing, maxWidth
// greedy word-wrap, align, uppercase — turns a string + FontMetrics into
// packed glyph quads plus the block's total width/height/line count. No
// three, no DOM, no canvas: this file is safe to unit-test with nothing but
// hand-built FontMetrics fixtures (test/engine/text/layout.test.ts).
//
// Quad packing (an internal detail of gl/text/, not part of the
// cross-workstream contract): 8 floats per visible glyph —
// `[x, y, w, h, u0, v0, u1, v1]` — in a top-left-origin, x-right/y-down
// space, already scaled to `opts.fontSize` px. `x`/`y` is each glyph's
// top-left corner. MsdfText.ts is the only consumer and owns converting
// this into instance-matrix + UV-rect attributes.

import type { FontMetrics } from "./font";

export type TextAlign = "left" | "center";

export interface LayoutOptions {
  fontSize: number;
  letterSpacing?: number; // px, added after every glyph except a line's last
  maxWidth?: number; // px; omit for a single line (still honors explicit "\n")
  align?: TextAlign;
  uppercase?: boolean;
}

export interface LayoutResult {
  /** 8 floats/glyph: x,y,w,h,u0,v0,u1,v1. Only glyphs with atlas metrics and non-space chars are included. */
  quads: Float32Array;
  glyphCount: number;
  width: number;
  height: number;
  lines: number;
}

const FLOATS_PER_GLYPH = 8;

/** Sums one line's advance width (px, already scaled), including kerning and letterSpacing, excluding trailing letterSpacing. */
function measureLine(chars: string[], font: FontMetrics, scale: number, letterSpacing: number): number {
  let x = 0;
  let prev: string | null = null;
  for (const ch of chars) {
    const glyph = font.glyphs.get(ch);
    const advance = glyph ? glyph.xadvance * scale : 0;
    const kern = prev !== null ? (font.kernings.get(prev + ch) ?? 0) * scale : 0;
    x += kern + advance;
    prev = ch;
    x += letterSpacing;
  }
  if (chars.length > 0) x -= letterSpacing; // no trailing spacing after the last glyph
  return x;
}

/** Splits text into forced-newline paragraphs, each split into words (spaces dropped, re-inserted during wrapping). */
function tokenize(text: string): string[][] {
  return text.split("\n").map((paragraph) => paragraph.split(" ").filter((w) => w.length > 0));
}

/** Greedy word-wrap: packs words into lines constrained by maxWidth (px, already scaled space). Always produces >=1 line per paragraph, even if a single word overflows (unbreakable). */
function wrapParagraph(
  words: string[],
  font: FontMetrics,
  scale: number,
  letterSpacing: number,
  maxWidth: number | undefined
): string[][] {
  if (words.length === 0) return [[]];
  if (maxWidth === undefined) {
    return [words.join(" ").split("")];
  }

  const lines: string[][] = [];
  let currentWords: string[] = [];

  for (const word of words) {
    const candidateWords = [...currentWords, word];
    const candidateWidth = measureLine(candidateWords.join(" ").split(""), font, scale, letterSpacing);

    if (currentWords.length > 0 && candidateWidth > maxWidth) {
      lines.push(currentWords.join(" ").split(""));
      currentWords = [word];
    } else {
      currentWords = candidateWords;
    }
  }
  if (currentWords.length > 0 || lines.length === 0) {
    lines.push(currentWords.join(" ").split(""));
  }
  return lines;
}

/**
 * Lays out `text` against `font` at `opts.fontSize`, returning packed quads
 * ready for MsdfText.ts to upload as instance attributes.
 */
export function layout(text: string, font: FontMetrics, opts: LayoutOptions): LayoutResult {
  const scale = font.size > 0 ? opts.fontSize / font.size : 1;
  const letterSpacing = opts.letterSpacing ?? 0;
  const align = opts.align ?? "left";
  const source = opts.uppercase ? text.toUpperCase() : text;
  const lineHeightPx = font.lineHeight * scale;

  const paragraphs = tokenize(source);
  const lineWordLists: string[][] = [];
  for (const words of paragraphs) {
    lineWordLists.push(...wrapParagraph(words, font, scale, letterSpacing, opts.maxWidth));
  }

  const lineWidths = lineWordLists.map((chars) => measureLine(chars, font, scale, letterSpacing));
  const blockWidth = lineWidths.length > 0 ? Math.max(0, ...lineWidths) : 0;

  const quads: number[] = [];
  let glyphCount = 0;

  lineWordLists.forEach((chars, lineIndex) => {
    const lineWidth = lineWidths[lineIndex] ?? 0;
    const offsetX = align === "center" ? (blockWidth - lineWidth) / 2 : 0;
    let penX = offsetX;
    let prev: string | null = null;
    const lineTopY = lineIndex * lineHeightPx;

    for (const ch of chars) {
      const glyph = font.glyphs.get(ch);
      const kern = prev !== null ? (font.kernings.get(prev + ch) ?? 0) * scale : 0;
      penX += kern;

      if (glyph && ch !== " ") {
        const x = penX + glyph.xoffset * scale;
        const y = lineTopY + glyph.yoffset * scale;
        const w = glyph.width * scale;
        const h = glyph.height * scale;
        const u0 = glyph.x / font.scaleW;
        const v0 = glyph.y / font.scaleH;
        const u1 = (glyph.x + glyph.width) / font.scaleW;
        const v1 = (glyph.y + glyph.height) / font.scaleH;
        quads.push(x, y, w, h, u0, v0, u1, v1);
        glyphCount++;
      }

      penX += (glyph ? glyph.xadvance * scale : 0) + letterSpacing;
      prev = ch;
    }
  });

  return {
    quads: Float32Array.from(quads),
    glyphCount,
    width: blockWidth,
    height: lineWordLists.length * lineHeightPx,
    lines: lineWordLists.length,
  };
}

export { FLOATS_PER_GLYPH };
