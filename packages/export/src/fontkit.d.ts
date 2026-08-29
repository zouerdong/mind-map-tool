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
  // Uint8Array 即可（Buffer 是其子类）；声明用 Uint8Array 保持 WebView 可用。
  export function openSync(path: string | Uint8Array): FontkitFont;
  export function create(buffer: Uint8Array): FontkitFont;
  const _default: { openSync: typeof openSync };
  export default _default;
}
