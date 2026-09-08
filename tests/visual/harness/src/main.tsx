// tests/visual/harness/src/main.tsx — VRA-080 视觉与动效真实验收宿主
// 渲染真实 React Flow EditorCanvas + 真字体 FontResolver + 交互采样协议。

import { createElement, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { DocumentSession, type MindMapDocumentV1, type Point } from "@mindmap/core";
import { createFontResolver } from "@mindmap/export/src/font-source.js";
import { EditorCanvas } from "@mindmap/ui";

(globalThis as { Buffer?: unknown }).Buffer ??= {
  from: (b: Uint8Array) => b,
};

interface HarnessWindow extends Window {
  __READY?: boolean;
  __session?: DocumentSession;
  __organize?: (direction?: "horizontal" | "vertical") => void;
  __getNodes?: () => Array<{
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    text: string;
    bg: string;
    color: string;
  }>;
  __getEdges?: () => Array<{ id: string; d: string; stroke: string; arrowD?: string }>;
  __getOrganizeResult?: () => { movedCount: number; targetPositions: Map<string, Point> } | null;
}

declare const window: HarnessWindow;

function App() {
  const url = new URL(window.location.href);
  const fixtureName = url.searchParams.get("fixture") || "reference-dag-12";
  const initialTheme = (url.searchParams.get("theme") as "light" | "dark") || "light";
  const initialDirection =
    (url.searchParams.get("direction") as "horizontal" | "vertical") || "horizontal";
  const reducedMotion = url.searchParams.get("reducedMotion") === "1";

  const [session, setSession] = useState<DocumentSession | null>(null);
  const [fonts, setFonts] = useState<ReturnType<typeof createFontResolver> | null>(null);
  const [theme, setTheme] = useState<"light" | "dark">(initialTheme);
  const [direction, setDirection] = useState<"horizontal" | "vertical">(initialDirection);
  const [organizeSignal, setOrganizeSignal] = useState<number>(0);
  const [lastOrganizeResult, setLastOrganizeResult] = useState<{
    movedCount: number;
    targetPositions: Map<string, Point>;
  } | null>(null);

  useEffect(() => {
    async function init() {
      const [fixtureRes, notoRegular, notoBold, lxgw] = await Promise.all([
        fetch(`/fixtures/${fixtureName}.json`),
        fetch("/fonts/noto-sans-sc-regular.woff2"),
        fetch("/fonts/noto-sans-sc-bold.woff2"),
        fetch("/fonts/lxgw-wenkai-regular.woff2"),
      ]);

      const doc = (await fixtureRes.json()) as MindMapDocumentV1;
      const toBytes = async (r: Response) => new Uint8Array(await r.arrayBuffer());
      const fontResolver = createFontResolver({
        "noto-sans-sc-regular": await toBytes(notoRegular),
        "noto-sans-sc-bold": await toBytes(notoBold),
        "lxgw-wenkai-regular": await toBytes(lxgw),
      });

      const s = new DocumentSession(doc);
      setSession(s);
      setFonts(fontResolver);
      window.__session = s;
    }

    void init();
  }, [fixtureName]);

  useEffect(() => {
    if (!session || !fonts) return;

    window.__organize = (dir) => {
      if (dir) setDirection(dir);
      setOrganizeSignal((prev) => prev + 1);
    };

    window.__getOrganizeResult = () => lastOrganizeResult;

    window.__getNodes = () => {
      const nodeEls = document.querySelectorAll(".react-flow__node");
      const list: Array<{
        id: string;
        x: number;
        y: number;
        width: number;
        height: number;
        text: string;
        bg: string;
        color: string;
      }> = [];
      nodeEls.forEach((el) => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        const cardEl = el.querySelector(".mind-node-card") || el;
        const cardStyle = window.getComputedStyle(cardEl);
        list.push({
          id: el.getAttribute("data-id") || "",
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
          text: (el.textContent || "").trim(),
          bg: cardStyle.backgroundColor,
          color: cardStyle.color,
        });
      });
      return list;
    };

    window.__getEdges = () => {
      const edgeEls = document.querySelectorAll(".react-flow__edge");
      const list: Array<{ id: string; d: string; stroke: string; arrowD?: string }> = [];
      edgeEls.forEach((el) => {
        const pathEl = el.querySelector("path.react-flow__edge-path") as SVGPathElement | null;
        const arrowEl = el.querySelector("path[stroke='none']") as SVGPathElement | null;
        if (pathEl) {
          list.push({
            id: el.getAttribute("data-id") || "",
            d: pathEl.getAttribute("d") || "",
            stroke: pathEl.getAttribute("stroke") || "",
            arrowD: arrowEl?.getAttribute("d") || undefined,
          });
        }
      });
      return list;
    };

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        window.__READY = true;
      });
    });
  }, [session, fonts, lastOrganizeResult]);

  if (!session || !fonts) {
    return createElement("div", { style: { padding: 20, color: "#888" } }, "Loading harness...");
  }

  return createElement(
    "div",
    {
      style: {
        width: "100vw",
        height: "100vh",
        background: theme === "dark" ? "#16140F" : "#F9F8F4",
      },
    },
    createElement(EditorCanvas, {
      session,
      fonts,
      theme,
      organizeSignal,
      organizeDirection: direction,
      reducedMotion,
      onOrganizeResult: (res) => {
        setLastOrganizeResult(res);
      },
    }),
  );
}

createRoot(document.getElementById("root")!).render(createElement(App));
