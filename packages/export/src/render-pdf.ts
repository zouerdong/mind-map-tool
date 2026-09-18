// PDF renderer（web-ts-wasm 分支唯一 owner；单页适合内容）。
// Spike 已验证：pdf-lib 必须注册 @pdf-lib/fontkit，且内嵌字体对象不可跨文档复用。
// VRA-040：从同一 scene primitives 绘制（圆角矩形/正交折线/箭头/线型 dash），
// 不另猜曲线或圆角；scene 的 y-down 坐标经 drawSvgPath 的 translate+scale(1,-1) 映射进 PDF
// （路径 y 直接用 scene 值，起点 y 传页高 —— 不再手工翻转，避免双重翻转到页外）。

import { LineCapStyle, PDFDocument, rgb, type PDFFont } from "pdf-lib";
import fontkitForPdf from "@pdf-lib/fontkit";
import type { ExportScene } from "./scene.js";
import { THEME_TOKENS } from "./scene.js";
import { LAYOUT } from "./layout.js";
import { validateFontBundle, type FontBundle, type FontResourceLimitError } from "./font-source.js";

function hexToRgb(hex: string) {
  const v = parseInt(hex.slice(1), 16);
  return rgb(((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255);
}

/** 圆角矩形 path（局部坐标，左上为原点、y 向下；drawSvgPath 负责翻转）。 */
function roundedRectPath(w: number, h: number, rx: number): string {
  const r = Math.max(0, Math.min(rx, w / 2, h / 2));
  if (r === 0) return `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
  return (
    `M ${r} 0 L ${w - r} 0 Q ${w} 0 ${w} ${r} L ${w} ${h - r} Q ${w} ${h} ${w - r} ${h}` +
    ` L ${r} ${h} Q 0 ${h} 0 ${h - r} L 0 ${r} Q 0 0 ${r} 0 Z`
  );
}

export async function renderPdf(
  scene: ExportScene,
  bundle: FontBundle,
): Promise<
  | { ok: true; bytes: Uint8Array }
  | { ok: false; error: { code: "PDF_LAYOUT_FAILED"; message: string } }
  | { ok: false; error: FontResourceLimitError }
> {
  const fontGuard = validateFontBundle(bundle);
  if (!fontGuard.ok) return fontGuard;
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkitForPdf);
  pdf.setProducer("mind-map-tool");
  pdf.setCreator("mind-map-tool");
  pdf.setCreationDate(new Date(0));
  pdf.setModificationDate(new Date(0));
  const page = pdf.addPage([scene.width, scene.height]);
  const colors = THEME_TOKENS[scene.theme];
  const pageH = scene.height;

  // 每文档重新内嵌（不跨文档复用——Spike 教训）。
  // 两条互斥路径（pdf-lib 的 CFF subsetter 与第二块 CJK 字体共存时会崩溃，
  // 已实测：混合子集+全量 → save() RangeError；全全量 → 通过）：
  //   · Noto 文档：noto regular(+bold) 子集化 → PDF 几十 KB（快且小）。
  //   · 文楷文档：仅嵌文楷全量（~12MB PDF，1.1s）；加粗双绘模拟，不需要 Noto。
  const needsLxgw = scene.items.some((it) => it.kind === "text" && it.family === "LXGW WenKai");
  const needsNotoBold =
    !needsLxgw &&
    scene.items.some((it) => it.kind === "text" && it.segments.some((s) => s.bold && !s.fauxBold));
  // embedFont 官方签名收 Uint8Array；禁用 Node Buffer（WKWebView 无全局，
  // MM-090 E2E 缺陷 #1 同源）。
  const lxgwRegular = needsLxgw
    ? await pdf.embedFont(bundle["lxgw-wenkai-regular"], { subset: false })
    : null;
  const notoRegular = lxgwRegular
    ? lxgwRegular
    : await pdf.embedFont(bundle["noto-sans-sc-regular"], { subset: true });
  const notoBold = needsNotoBold
    ? await pdf.embedFont(bundle["noto-sans-sc-bold"], { subset: true })
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
    color: hexToRgb(colors.canvas),
  });

  try {
    for (const item of scene.items) {
      switch (item.kind) {
        case "edge": {
          // scene 路径为 y-down 绝对坐标；drawSvgPath 内部 scale(1,-1)，起点 y = 页高即可
          const dash = item.dash ? [...item.dash] : null;
          page.drawSvgPath(item.d, {
            x: 0,
            y: pageH,
            borderColor: hexToRgb(item.stroke),
            borderWidth: item.width,
            ...(dash ? { borderDashArray: dash } : {}),
            borderLineCap: item.roundCap ? LineCapStyle.Round : LineCapStyle.Butt,
          });
          // 箭头：独立实心三角（与主线同色、同几何源）
          page.drawSvgPath(item.arrowD, {
            x: 0,
            y: pageH,
            color: hexToRgb(item.stroke),
          });
          break;
        }
        case "frame-rect":
          // 圆角矩形从共同 primitives 绘制（rx 与 SVG 同值）；
          // ADR 0020 第二轮：depth≥4 卡有镜像描边（SVG 侧 stroke-width 1 同源）
          page.drawSvgPath(roundedRectPath(item.w, item.h, item.rx), {
            x: item.x,
            y: pageH - item.y,
            color: hexToRgb(item.fill),
            ...(item.stroke !== null ? { borderColor: hexToRgb(item.stroke), borderWidth: 1 } : {}),
          });
          break;
        case "frame-ellipse":
          page.drawEllipse({
            x: item.cx,
            y: pageH - item.cy,
            xScale: item.rx,
            yScale: item.ry,
            color: hexToRgb(item.fill),
            ...(item.stroke !== null ? { borderColor: hexToRgb(item.stroke), borderWidth: 1 } : {}),
          });
          break;
        case "text":
          for (const seg of item.segments) {
            const font = fontFor(item.family, seg.bold);
            const draw = (dx: number) =>
              page.drawText(seg.text, {
                x: seg.x + dx,
                y: pageH - seg.baselineY,
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
            start: { x: item.x1, y: pageH - item.y1 },
            end: { x: item.x2, y: pageH - item.y2 },
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
