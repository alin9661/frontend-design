// msdf-bmfont-xml ships no type declarations. This is a minimal shim
// covering exactly the callback shape scripts/gen-msdf.ts uses.
declare module "msdf-bmfont-xml" {
  interface GenerateBMFontOptions {
    charset?: string;
    fontSize?: number;
    textureSize?: [number, number];
    distanceRange?: number;
    fieldType?: "msdf" | "sdf" | "psdf" | "sdf-consistent";
    outputType?: "json" | "xml";
    smartSize?: boolean;
  }

  interface GenerateBMFontTexture {
    filename: string;
    texture: Buffer;
  }

  interface GenerateBMFontResult {
    filename: string;
    data: string;
  }

  type GenerateBMFontCallback = (
    error: Error | null,
    textures: GenerateBMFontTexture[],
    font: GenerateBMFontResult
  ) => void;

  function generateBMFont(
    fontPath: string,
    options: GenerateBMFontOptions,
    callback: GenerateBMFontCallback
  ): void;

  export default generateBMFont;
}
