// PDF renderer（web-ts-wasm 分支唯一 owner；单页适合内容）。
// Spike 已验证：pdf-lib 必须注册 @pdf-lib/fontkit，且内嵌字体对象不可跨文档复用。

import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkitForPdf from "@pdf-lib/fontkit";
import type { ExportScene } from "./scene.js";
import { THEME_TOKENS } from "./scene.js";
import { LAYOUT } from "./layout.js";
import type { FontBundle } from "./font-source.js";

function hexToRgb(hex: string) {
  const v = parseInt(hex.slice(1), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

/** y 翻转：scene 是 y-down，PDF 是 y-up。 */
const flipY = (y: number, pageH: number) => pageH - y;

export async function renderPdf(
  scene: ExportScene,
  bundle: FontBundle,
): Promise<
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: { code: "PDF_LAYOUT_FAILED"; message: string } }
> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkitForPdf);
  pdf.setProducer("mind-map-tool");
  pdf.setCreator("mind-map-tool");
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  const page = pdf.addPage([scene.width, scene.height]);
  const colors = THEME_TOKENS[scene.theme];

  // 每文档重新内嵌（不跨文档复用——Spike 教训）。
  // 两条互斥路径（pdf-lib 的 CFF subsetter 与第二块 CJK 字体共存时会崩溃，
  // 已实测：混合子集+全量 → save() RangeError；全全量 → 通过）：
  //   · Noto 文档：noto regular(+bold) 子集化 → PDF 几十 KB（快且小）。
  //   · 文楷文档：仅嵌文楷全量（~12MB PDF，1.1s）；加粗双绘模拟，不需要 Noto。
  const needsLxgw = scene.items.some((it) => it.kind === "text" && it.family === "LXGW WenKai");
  const needsNotoBold =
    !needsLxgw &&
    scene.items.some((it) => it.kind === "text" && it.segments.some((s) => s.bold && !s.fauxBold));
  const lxgwRegular = needsLxgw
    ? await pdf.embedFont(Buffer.from(bundle["lxgw-wenkai-regular"]), { subset: false })
    : null;
  const notoRegular = lxgwRegular
    ? lxgwRegular
    : await pdf.embedFont(Buffer.from(bundle["noto-sans-sc-regular"]), { subset: true });
  const notoBold = needsNotoBold
    ? await pdf.embedFont(Buffer.from(bundle["noto-sans-sc-bold"]), { subset: true })
    : notoRegular;
  const fontFor = (family: string, bold: boolean): PDFFont => {
    if (family === "LXGW WenKai") return lxgwRegular!; // 无真粗体 → 双绘模拟
    return bold ? notoBold : notoRegular;
  };

  page.drawRectangle({
    x: 0,
    y: 0,
    width: scene.width,
    height: scene.height,
    color: hexToRgb(colors.bg),
  });

  try {
    for (const item of scene.items) {
      switch (item.kind) {
        case "edge": {
          // scene 路径为 y-down 绝对坐标（M x y C cx1 cy1, cx2 cy2, x y）→ 手动翻转为 PDF y-up
          const nums = item.d.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
          if (nums.length === 8) {
            const f = (i: number) =>
              Math.round((i % 2 === 1 ? scene.height - nums[i]! : nums[i]!) * 1000) / 1000;
            const flipped = `M ${f(0)} ${f(1)} C ${f(2)} ${f(3)}, ${f(4)} ${f(5)}, ${f(6)} ${f(7)}`;
            page.drawSvgPath(flipped, {
              x: 0,
              y: 0,
              borderColor: hexToRgb(item.stroke),
              borderWidth: LAYOUT.strokeWidth,
            });
          }
          break;
        }
        case "frame-rect":
          page.drawRectangle({
            x: item.x,
            y: flipY(item.y + item.h, scene.height),
            width: item.w,
            height: item.h,
            color: hexToRgb(item.fill),
            borderColor: hexToRgb(item.stroke),
            borderWidth: 1,
          });
          break;
        case "frame-ellipse":
          page.drawEllipse({
            x: item.cx,
            y: flipY(item.cy, scene.height),
            xScale: item.rx,
            yScale: item.ry,
            color: hexToRgb(item.fill),
            borderColor: hexToRgb(item.stroke),
            borderWidth: 1,
          });
          break;
        case "text":
          for (const seg of item.segments) {
            const font = fontFor(item.family, seg.bold);
            const draw = (dx: number) =>
              page.drawText(seg.text, {
                x: seg.x + dx,
                y: flipY(seg.baselineY, scene.height),
                font,
                size: seg.fontSize,
                color: hexToRgb(item.color),
              });
            draw(0);
            if (seg.fauxBold) draw(LAYOUT.fauxBoldPdfOffset); // 双绘模拟粗体
          }
          break;
        case "underline":
          page.drawLine({
            start: { x: item.x1, y: flipY(item.y1, scene.height) },
            end: { x: item.x2, y: flipY(item.y2, scene.height) },
            thickness: LAYOUT.underlineThickness,
            color: hexToRgb(item.color),
          });
          break;
      }
    }
  } catch (e) {
    return {
      ok: false,
      error: { code: "PDF_LAYOUT_FAILED", message: String((e as Error).message).slice(0, 200) },
    };
  }

  return { ok: true, bytes: await pdf.save() };
}
