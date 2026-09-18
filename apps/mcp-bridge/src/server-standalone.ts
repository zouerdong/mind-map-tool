// server-standalone.ts — MCP stdio 服务·安装包独立运行时入口（ADR 0018）。
// 与 server.ts 唯一差异：字体/WASM 字节来自 esbuild 内嵌（assets-inline），
// 使产物可在无仓库、无 node_modules 的机器上由随包 Node 运行时直接执行。

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createExportRenderer } from "@mindmap/export";
import { createMindmapMcpServer } from "./create-server.js";
import { loadInlineFontBundle, loadInlineResvgWasm } from "./assets-inline.js";

const renderer = await createExportRenderer({
  fonts: loadInlineFontBundle(),
  resvgWasm: loadInlineResvgWasm(),
});

const server = createMindmapMcpServer(renderer);

await server.connect(new StdioServerTransport());
