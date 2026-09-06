// AppNotice（VRA-070）：极简提示面
// 常规成功提示（info）：右下短浮层 Toast（2.5s 自动消失，不改变画布布局与坐标系）
// 错误/冲突提示（error）：顶栏持续横幅 Banner（不自动消失，持续可行动）

import React, { useEffect } from "react";
import type { ThemeName } from "@mindmap/core";

export interface NoticeData {
  tone: "info" | "error";
  text: string;
}

export interface AppNoticeProps {
  notice: NoticeData | null;
  theme: ThemeName;
  onDismiss: () => void;
}

export function AppNotice({ notice, theme, onDismiss }: AppNoticeProps) {
  useEffect(() => {
    if (!notice || notice.tone !== "info") return;
    const timer = setTimeout(() => {
      onDismiss();
    }, 2500);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);

  if (!notice) return null;

  const isDark = theme === "dark";

  if (notice.tone === "info") {
    return (
      <div
        role="status"
        data-testid="app-notice"
        style={{
          position: "absolute",
          right: 16,
          bottom: 16,
          zIndex: 35,
          background: isDark ? "#211E18" : "#FFFDF9",
          border: `1px solid ${isDark ? "#35312A" : "#E3DFD5"}`,
          color: isDark ? "#EFEAE0" : "#3B372F",
          borderRadius: 10,
          padding: "8px 14px",
          fontSize: 12.5,
          boxShadow: "0 6px 18px rgba(0,0,0,.12)",
          display: "flex",
          alignItems: "center",
          gap: 10,
          pointerEvents: "auto",
        }}
      >
        <span>{notice.text}</span>
        <button
          type="button"
          aria-label="关闭提示"
          onClick={onDismiss}
          style={{
            border: "none",
            background: "none",
            color: isDark ? "#A39C8E" : "#8A8478",
            cursor: "pointer",
            fontSize: 14,
            padding: 0,
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>
    );
  }

  return (
    <div
      role="alert"
      data-testid="app-notice"
      style={{
        position: "absolute",
        top: 48,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 35,
        maxWidth: "80%",
        background: isDark ? "#2A2018" : "#FFF4EF",
        border: "1px solid #D97757",
        color: isDark ? "#EFEAE0" : "#3B372F",
        borderRadius: 10,
        padding: "9px 14px",
        fontSize: 13,
        boxShadow: "0 8px 24px rgba(0,0,0,.2)",
        display: "flex",
        alignItems: "center",
        gap: 14,
        pointerEvents: "auto",
      }}
    >
      <span style={{ fontWeight: 500 }}>{notice.text}</span>
      <button
        type="button"
        aria-label="关闭提示"
        onClick={onDismiss}
        style={{
          border: "none",
          background: "none",
          color: isDark ? "#EFEAE0" : "#3B372F",
          cursor: "pointer",
          fontSize: 16,
          padding: 0,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
