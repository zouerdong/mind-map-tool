// AppShellHeader（VRA-070）：极简 40px 常驻顶栏与下拉菜单
// 左侧：[文件 ▾] 下拉菜单（新建/打开/保存/存储为/热键/重放；OFR-2026-09-15 出口合并）
// 中间：文档标题 · 保存状态指示（非桌面环境附带 fake 指示供测试识别）
// 右侧：[整理 ⌘⇧L] 主动作 + [☰ 视图 ▾] 菜单 + [◐] 主题切换

import React, { useEffect, useRef, useState } from "react";
import type { Command, OrganizeDirection, ThemeName } from "@mindmap/core";
import { ThemeToggle } from "@mindmap/ui";
export interface AppHeaderProps {
  theme: ThemeName;
  docName: string;
  isDirty: boolean;
  statusSuffix?: string;
  onNew: () => void;
  onOpen: () => void;
  onSave: () => void;
  onSaveAs: () => void;
  onOrganize: () => void;
  organizeDirection: OrganizeDirection;
  onToggleOrganizeDirection: () => void;
  onFitView: () => void;
  onOpenShortcutPanel: () => void;
  onReplayOnboarding: () => void;
  onThemeCommand: (command: Command) => void;
}

export function AppHeader({
  theme,
  docName,
  isDirty,
  statusSuffix = "",
  onNew,
  onOpen,
  onSave,
  onSaveAs,
  onOrganize,
  organizeDirection,
  onToggleOrganizeDirection,
  onFitView,
  onOpenShortcutPanel,
  onReplayOnboarding,
  onThemeCommand,
}: AppHeaderProps) {
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);

  const fileMenuRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  // 点击外部自动关闭菜单
  useEffect(() => {
    if (!fileMenuOpen && !viewMenuOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (fileMenuOpen && fileMenuRef.current && !fileMenuRef.current.contains(target)) {
        setFileMenuOpen(false);
      }
      if (viewMenuOpen && viewMenuRef.current && !viewMenuRef.current.contains(target)) {
        setViewMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [fileMenuOpen, viewMenuOpen]);

  // Escape 键关闭菜单
  useEffect(() => {
    if (!fileMenuOpen && !viewMenuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setFileMenuOpen(false);
        setViewMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fileMenuOpen, viewMenuOpen]);

  const isDark = theme === "dark";
  const shellBarBg = isDark ? "#211E18" : "#F1EFE9";
  const shellBorder = isDark ? "#35312A" : "#E3DFD5";
  const shellTextColor = isDark ? "#EFEAE0" : "#3B372F";
  const shellSubtleColor = isDark ? "#A39C8E" : "#8A8478";
  const menuBg = isDark ? "#211E18" : "#FFFDF9";

  const btnStyle: React.CSSProperties = {
    font: "inherit",
    fontSize: 13,
    color: shellTextColor,
    background: "none",
    border: `1px solid ${shellBorder}`,
    padding: "4px 10px",
    borderRadius: 7,
    cursor: "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
  };

  const primaryBtnStyle: React.CSSProperties = {
    ...btnStyle,
    background: "#D97757",
    borderColor: "#D97757",
    color: "#331708",
    fontWeight: 600,
  };

  const dropdownStyle: React.CSSProperties = {
    position: "absolute",
    top: 36,
    minWidth: 210,
    background: menuBg,
    border: `1px solid ${shellBorder}`,
    borderRadius: 10,
    padding: 6,
    boxShadow: "0 8px 24px rgba(0,0,0,.18)",
    zIndex: 40,
    transition: "opacity 120ms ease, transform 120ms ease",
  };

  const menuItemStyle: React.CSSProperties = {
    width: "100%",
    padding: "6px 10px",
    borderRadius: 6,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 18,
    cursor: "pointer",
    background: "none",
    border: "none",
    font: "inherit",
    fontSize: 13,
    color: shellTextColor,
    textAlign: "left",
    boxSizing: "border-box",
  };

  const kbdStyle: React.CSSProperties = {
    color: shellSubtleColor,
    fontSize: 11,
  };

  const hrStyle: React.CSSProperties = {
    border: "none",
    borderTop: `1px solid ${shellBorder}`,
    margin: "5px 4px",
  };

  return (
    <header
      role="toolbar"
      aria-label="主工具条"
      style={{
        height: 40,
        minHeight: 40,
        maxHeight: 40,
        background: shellBarBg,
        borderBottom: `1px solid ${shellBorder}`,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 14px",
        fontSize: 13,
        position: "relative",
        zIndex: 30,
        boxSizing: "border-box",
      }}
    >
      {/* 左侧：文件菜单 */}
      <div
        ref={fileMenuRef}
        style={{ position: "relative" }}
        className={fileMenuOpen ? "open" : ""}
      >
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={fileMenuOpen}
          onClick={() => {
            setFileMenuOpen((v) => !v);
            setViewMenuOpen(false);
          }}
          style={{
            ...btnStyle,
            border: "none",
            background: fileMenuOpen ? "rgba(217,119,87,.16)" : "transparent",
            padding: "4px 8px",
          }}
        >
          文件 ▾
        </button>

        <div
          role="menu"
          aria-label="文件菜单"
          style={{
            ...dropdownStyle,
            left: 0,
            opacity: fileMenuOpen ? 1 : 0,
            pointerEvents: fileMenuOpen ? "auto" : "none",
            transform: fileMenuOpen ? "translateY(0)" : "translateY(-4px)",
          }}
        >
          <button
            type="button"
            aria-label="新建"
            style={menuItemStyle}
            data-onboarding-anchor="app.new"
            onClick={() => {
              setFileMenuOpen(false);
              onNew();
            }}
          >
            <span>新建</span>
            <span style={kbdStyle}>⌘N</span>
          </button>
          <button
            type="button"
            aria-label="打开…"
            style={menuItemStyle}
            data-onboarding-anchor="app.open"
            onClick={() => {
              setFileMenuOpen(false);
              onOpen();
            }}
          >
            <span>打开…</span>
            <span style={kbdStyle}>⌘O</span>
          </button>
          <hr style={hrStyle} />
          <button
            type="button"
            aria-label="保存"
            style={menuItemStyle}
            data-onboarding-anchor="app.save"
            onClick={() => {
              setFileMenuOpen(false);
              onSave();
            }}
          >
            <span>保存</span>
            <span style={kbdStyle}>⌘S</span>
          </button>
          <button
            type="button"
            aria-label="存储为…"
            style={menuItemStyle}
            onClick={() => {
              setFileMenuOpen(false);
              onSaveAs();
            }}
          >
            <span>存储为…</span>
            <span style={kbdStyle}>⌘⇧S</span>
          </button>
          <hr style={hrStyle} />
          <button
            type="button"
            aria-label="热键…"
            style={menuItemStyle}
            onClick={() => {
              setFileMenuOpen(false);
              onOpenShortcutPanel();
            }}
          >
            <span>热键…</span>
            <span style={kbdStyle}>⌥Space</span>
          </button>
          <button
            type="button"
            aria-label="重放引导"
            style={menuItemStyle}
            onClick={() => {
              setFileMenuOpen(false);
              onReplayOnboarding();
            }}
          >
            <span>重放引导</span>
          </button>
        </div>
      </div>

      {/* 中间：文档名 + 保存状态 */}
      <div
        className="doc-title"
        style={{
          flex: 1,
          textAlign: "center",
          fontSize: 13,
          color: shellSubtleColor,
          userSelect: "none",
        }}
      >
        <b>{docName}</b>
        {" · "}
        <span
          data-testid="save-status"
          aria-live="polite"
          className={`save-state ${isDirty ? "dirty" : "saved"}`}
          style={{
            fontSize: 12,
            color: isDirty ? "#D06B47" : shellSubtleColor,
          }}
        >
          {`${isDirty ? "未保存" : "已保存"}${statusSuffix}`}
        </span>
      </div>

      {/* 右侧：整理 + 视图 + 主题 */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <button
          type="button"
          onClick={onOrganize}
          data-onboarding-anchor="app.organize"
          title="整理为分层布局（⌘⇧L）"
          style={primaryBtnStyle}
        >
          整理 ⌘⇧L
        </button>

        <div
          ref={viewMenuRef}
          style={{ position: "relative" }}
          className={viewMenuOpen ? "open" : ""}
        >
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={viewMenuOpen}
            onClick={() => {
              setViewMenuOpen((v) => !v);
              setFileMenuOpen(false);
            }}
            style={btnStyle}
          >
            ☰ 视图 ▾
          </button>

          <div
            role="menu"
            aria-label="视图菜单"
            style={{
              ...dropdownStyle,
              right: 0,
              opacity: viewMenuOpen ? 1 : 0,
              pointerEvents: viewMenuOpen ? "auto" : "none",
              transform: viewMenuOpen ? "translateY(0)" : "translateY(-4px)",
            }}
          >
            <button
              type="button"
              style={menuItemStyle}
              onClick={() => {
                setViewMenuOpen(false);
                onFitView();
              }}
            >
              <span>适应画布</span>
            </button>
            <button
              type="button"
              aria-label="布局方向"
              style={menuItemStyle}
              onClick={() => {
                setViewMenuOpen(false);
                onToggleOrganizeDirection();
              }}
            >
              <span>布局方向</span>
              <span style={kbdStyle}>
                {organizeDirection === "horizontal"
                  ? "横向 (默认)"
                  : organizeDirection === "vertical"
                    ? "纵向"
                    : "发散"}
              </span>
            </button>
            <hr style={hrStyle} />
            <button
              type="button"
              style={menuItemStyle}
              onClick={() => {
                setViewMenuOpen(false);
                onOpenShortcutPanel();
              }}
            >
              <span>快捷键设置</span>
            </button>
            <button
              type="button"
              style={menuItemStyle}
              onClick={() => {
                setViewMenuOpen(false);
                onReplayOnboarding();
              }}
            >
              <span>重放引导</span>
            </button>
          </div>
        </div>

        <ThemeToggle currentTheme={theme} onCommand={onThemeCommand} />
      </div>
    </header>
  );
}
