// 应用入口（MM-080 组合根）：按环境装配端口（Tauri / 浏览器 dev），
// 端口装配完成后立即挂载 MindMapApp；字体/WASM 在首帧之后按需加载。

import { useEffect, useState } from "react";
import { createAppPorts, type AppPorts } from "./app/ports.js";
import { MindMapApp } from "./app/mindmap-app.js";

export function App() {
  const [ports, setPorts] = useState<AppPorts | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    createAppPorts()
      .then((p) => {
        if (!cancelled) setPorts(p);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <main style={{ padding: 24 }}>初始化失败：{error}</main>;
  if (ports === null) return <main style={{ padding: 24 }}>正在装配脑图画布…</main>;
  return <MindMapApp ports={ports} />;
}
