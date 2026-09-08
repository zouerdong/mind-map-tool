import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port; fail if it is not available.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
    // terser（dev 依赖，不进产物）：比 esbuild minify 多省 ~3-5%，
    // 为 entry 500KB 预算留出实质余量（RLS-013/PRR-020）。生产丢弃
    // console/debugger（仅语句级移除，不改变控制流）；dev 保留日志。
    minify: "terser",
    terserOptions: {
      compress: { passes: 2, drop_console: true, drop_debugger: true },
      format: { comments: false },
    },
  },
});
