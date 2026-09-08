// canvas 性能 harness 入口（MM-050）：真实 EditorCanvas + 真字体 FontResolver，
// 加载 dense-300-450 fixture，双 rAF 后置 __READY（采样脚本协议）。
// createElement 直写（不引 @vitejs/plugin-react；库内 JSX 由 vite 默认转换）。

import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { DocumentSession, type MindMapDocumentV1 } from "@mindmap/core";
import { createFontResolver } from "@mindmap/export/src/font-source.js";
import { EditorCanvas } from "@mindmap/ui";

// font-source 在 node/WebView 通用语境用了 Buffer.from；fontkit 的 create
// 本就接受 TypedArray —— harness 内透传 shim（不改 export 源码）。
(globalThis as { Buffer?: unknown }).Buffer ??= {
  from: (b: Uint8Array) => b,
};

async function boot() {
  const [fixtureRes, notoRegular, notoBold, lxgw] = await Promise.all([
    fetch("/dense-300-450.json"),
    fetch("/fonts/noto-sans-sc-regular.woff2"),
    fetch("/fonts/noto-sans-sc-bold.woff2"),
    fetch("/fonts/lxgw-wenkai-regular.woff2"),
  ]);
  const doc = (await fixtureRes.json()) as MindMapDocumentV1;
  const toBytes = async (r: Response) => new Uint8Array(await r.arrayBuffer());
  const fonts = createFontResolver({
    "noto-sans-sc-regular": await toBytes(notoRegular),
    "noto-sans-sc-bold": await toBytes(notoBold),
    "lxgw-wenkai-regular": await toBytes(lxgw),
  });

  const session = new DocumentSession(doc);
  createRoot(document.getElementById("root")!).render(
    createElement(EditorCanvas, { session, fonts }),
  );
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      (window as { __READY?: boolean }).__READY = true;
    }),
  );
}

void boot();
