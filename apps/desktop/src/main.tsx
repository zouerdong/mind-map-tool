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
