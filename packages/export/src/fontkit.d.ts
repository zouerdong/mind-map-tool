declare module "fontkit" {
  export interface FontkitGlyph {
    advanceWidth: number;
  }
  export interface FontkitFont {
    unitsPerEm: number;
    ascent: number;
    glyphsForString(s: string): FontkitGlyph[];
    hasGlyphForCodePoint(cp: number): boolean;
  }
  export function openSync(path: string | Buffer): FontkitFont;
  export function create(buffer: Buffer): FontkitFont;
  const _default: { openSync: typeof openSync };
  export default _default;
}
