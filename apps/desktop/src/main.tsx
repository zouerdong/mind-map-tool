// PRR-067：保持第一行 import——模块体采样 renderer 早期分段（perf-only
// 数据，纯本地；见 perf-early.ts 头注释）。
import "./app/perf-early.js";
import React from "react";
import { createRoot } from "react-dom/client";
import "./fonts.css";
import { App } from "./App.js";
import { AppErrorBoundary, installGlobalErrorTrap } from "./app/error-boundary.js";

installGlobalErrorTrap();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </React.StrictMode>,
);
