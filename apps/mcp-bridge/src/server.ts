// server.ts — MCP stdio 服务·仓库开发态入口（ADR 0014 §2）。
// 工具面 v0 收敛为单个 render_mindmap；stdio 是唯一通道，零网络端点。
// 渲染管线与 GUI/golden 字节级同源（packages/headless → core 命令层 → export）。
// 资产（字体/WASM）从仓库文件系统读取；安装包内嵌形态见 server-standalone.ts。

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createExportRenderer } from "@mindmap/export";
import { loadFontBundle, loadResvgWasm } from "@mindmap/headless";
import { createMindmapMcpServer } from "./create-server.js";

const renderer = await createExportRenderer({
  fonts: loadFontBundle(),
  resvgWasm: loadResvgWasm(),
});

const server = createMindmapMcpServer(renderer);

await server.connect(new StdioServerTransport());
