// 引导文案清单（MM-070 交付物，zh-CN）。
// 单一事实源：OnboardingOverlay 渲染取此处文案；键位提示与 event-command-map.md
// 同步维护（R-012：文案与键位漂移）。

import type { OnboardingStepId } from "./onboarding-types.js";

export interface OnboardingCopy {
  title: string;
  body: string;
  /** 主按钮（welcome=开始；步骤内通常无主按钮——完成靠真实动作）。 */
  primary?: string;
  /** 次按钮（跳过/稍后）。 */
  secondary?: string;
  /** 完成条件提示（步骤内显示"还差什么"）。 */
  hint?: string;
}

export const ONBOARDING_COPY: Record<OnboardingStepId, OnboardingCopy> = {
  welcome: {
    title: "欢迎使用脑图",
    body: "用 2 分钟走一遍：创建、编辑、连接、撤销与保存。也可以跳过，所有功能不打折。",
    primary: "开始引导",
    secondary: "跳过",
  },
  "create-first": {
    title: "第 1 步 · 创建第一个节点",
    body: "在画布空白处双击（或按 ⌥Space）创建节点并直接输入文字，按 ⌘Enter 确认。",
    secondary: "跳过引导",
    hint: "完成：创建节点 ✓ 待输入内容",
  },
  "second-connect": {
    title: "第 2 步 · 第二个节点与连接",
    body: "再双击画布创建一个节点，拖动它换个位置，然后从一个节点边缘的圆点拖到另一个节点建立连接。",
    secondary: "跳过引导",
    hint: "完成：创建、移动、连接",
  },
  "undo-or-theme": {
    title: "第 3 步 · 撤销、整理或换主题",
    body: "按 ⌘Z 撤销、⇧⌘Z 重做；⇧⌘L 一键整理布局；或用主题按钮在白板/黑板间切换（任选其一）。",
    secondary: "跳过引导",
    hint: "完成：撤销 / 重做 / 整理 / 主题切换（任一）",
  },
  "save-or-export": {
    title: "第 4 步 · 保存或导出",
    body: "用 ⌘S 保存脑图（可选 .mindmap / .json 格式），或用 ⌘E 导出为图片/PDF。现在也可以稍后再做——引导到此完成。",
    primary: "稍后再说，完成引导",
    secondary: "跳过引导",
    hint: "完成：保存 / 导出（任一）",
  },
};

/** welcome 前的（重放）入口文案（帮助/设置菜单场景）。 */
export const ONBOARDING_REPLAY_LABEL = "重放首次引导";
