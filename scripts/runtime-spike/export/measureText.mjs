// Shared text measurement via fontkit: advance-width line measurement +
// missing-glyph detection. Injected into scene.mjs via setTextMeasurement.

import { openSync as fontkitOpen } from "fontkit";

export function createMeasurement(fontPath, { fontSize }) {
  const font = fontkitOpen(fontPath);
  const cache = new Map();

  function advance(ch) {
    let w = cache.get(ch);
    if (w === undefined) {
      const glyph = font.glyphsForString(ch)[0];
      w = glyph ? glyph.advanceWidth : 0;
      cache.set(ch, w);
    }
    return w;
  }

  return {
    font,
    measure(line) {
      let units = 0;
      for (const ch of line) units += advance(ch);
      return (units / font.unitsPerEm) * fontSize;
    },
    missing(chars) {
      return chars.filter((ch) => !font.hasGlyphForCodePoint(ch.codePointAt(0)));
    },
  };
}
