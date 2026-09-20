// create-server.ts — MCP 工具面装配（ADR 0014 §2 / ADR 0018）。
// server.ts（仓库开发态，fs 资产）与 server-standalone.ts（安装包内单文件
// 运行时，内嵌资产）共用本模块；差异只在渲染器字节来源。

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ExportRenderer } from "@mindmap/export";
import { renderOutlineToFile, OUTPUT_FORMATS, type OutlineNode } from "@mindmap/headless";

// 递归大纲 schema（契约细节与上限由 headless flattenOutline fail-closed 把关）
const outlineNodeSchema = z.lazy(() =>
  z.object({
    text: z.string().min(1),
    children: z.array(outlineNodeSchema).optional(),
  }),
) as z.ZodType<OutlineNode>;

export function createMindmapMcpServer(renderer: ExportRenderer): McpServer {
  const server = new McpServer({
    name: "mindmap-headless",
    version: "0.2.0",
  });

  server.registerTool(
    "render_mindmap",
    {
      title: "生成脑图文件",
      description:
        "把树状大纲渲染为脑图文件（默认 PNG 2x，可选 svg/pdf/json/mindmap）。同时自动写出同名 .mindmap 源文件，可在 Mind Map 桌面应用中继续编辑。不打开任何窗口，纯后台执行。",
      inputSchema: {
        outline: outlineNodeSchema.describe(
          "树状大纲：{ text, children?: [...] }，根节点为脑图中心主题",
        ),
        outPath: z
          .string()
          .min(1)
          .describe("输出文件的绝对路径，扩展名必须与 format 一致（如 /tmp/map.png）"),
        format: z.enum(OUTPUT_FORMATS).optional().describe("输出格式，默认 png"),
        font: z
          .enum(["lxgw-wenkai", "noto-sans-sc"])
          .optional()
          .describe("字体：lxgw-wenkai（手写，默认）/ noto-sans-sc（黑体）"),
        direction: z
          .enum(["balanced", "horizontal", "vertical"])
          .optional()
          .describe(
            "整理布局方向，默认 balanced（发散：主根居中、子节点左右两支展开，ADR 0019 v1.1.0 起跟随应用默认）；horizontal / vertical 为单侧层列",
          ),
        wide: z
          .boolean()
          .optional()
          .describe(
            "horizontal 时使用宽而浅自适应分栏布局（根在左、分支按宽高比分栏并排），默认 true",
          ),
        saveSource: z.boolean().optional().describe("是否同时写出 .mindmap 源文件，默认 true"),
        emphasisRoot: z.boolean().optional().describe("根节点是否强调角色（橙卡），默认 true"),
      },
    },
    async (args) => {
      const result = await renderOutlineToFile(renderer, {
        outline: args.outline,
        outPath: args.outPath,
        ...(args.format !== undefined ? { format: args.format } : {}),
        ...(args.font !== undefined ? { font: args.font } : {}),
        ...(args.direction !== undefined ? { direction: args.direction } : {}),
        ...(args.wide !== undefined ? { wide: args.wide } : {}),
        ...(args.saveSource !== undefined ? { saveSource: args.saveSource } : {}),
        ...(args.emphasisRoot !== undefined ? { emphasisRoot: args.emphasisRoot } : {}),
      });
      if (!result.ok) {
        return {
          isError: true,
          content: [{ type: "text", text: JSON.stringify(result.error) }],
        };
      }
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  );

  return server;
}
