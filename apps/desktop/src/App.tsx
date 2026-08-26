// MM-020 Bootstrap 空壳：只验证工具链与窗口装配，不含任何产品功能。
// MM-080 将在此组合 core/ui/platform/export 的完整闭环。

export function App() {
  return (
    <main
      style={{
        height: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#ffffff",
        color: "#1a1a1a",
        fontFamily: "system-ui, sans-serif",
      }}
    >
      <p style={{ margin: 0 }}>Mind Map — 空白画布占位（MM-020 Bootstrap）</p>
    </main>
  );
}
