import React, { useRef, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";

// Canvas spike: minimal custom SVG canvas — pan/zoom/node-drag/selection.
// Deliberately built WITHOUT any canvas library to compare against React Flow
// (MM-010 canvas track, custom-react-view candidate).

function App({ doc }) {
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [nodes, setNodes] = useState(doc.document.nodes);
  const [selected, setSelected] = useState(new Set());
  const svgRef = useRef(null);
  const dragRef = useRef(null);

  const toWorld = useCallback(
    (clientX, clientY) => {
      const rect = svgRef.current.getBoundingClientRect();
      return {
        x: (clientX - rect.left - view.x) / view.k,
        y: (clientY - rect.top - view.y) / view.k,
      };
    },
    [view]
  );

  const onPointerDownBg = (e) => {
    if (e.target === svgRef.current || e.target.dataset.bg) {
      dragRef.current = { kind: "pan", startX: e.clientX, startY: e.clientY, origin: { ...view } };
      setSelected(new Set());
      svgRef.current.setPointerCapture(e.pointerId);
    }
  };
  const onPointerDownNode = (e, id) => {
    e.stopPropagation();
    const world = toWorld(e.clientX, e.clientY);
    const node = nodes.find((n) => n.id === id);
    dragRef.current = {
      kind: "node", id,
      startWorld: world,
      origins: new Map(
        [...nodes].map((n) => [n.id, { ...n.position }])
      ),
      moved: false,
    };
    setSelected(new Set([id]));
    svgRef.current.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = dragRef.current;
    if (!d) return;
    if (d.kind === "pan") {
      setView((v) => ({ ...v, x: d.origin.x + (e.clientX - d.startX), y: d.origin.y + (e.clientY - d.startY) }));
    } else if (d.kind === "node") {
      const world = toWorld(e.clientX, e.clientY);
      const dx = world.x - d.startWorld.x;
      const dy = world.y - d.startWorld.y;
      d.moved = true;
      setNodes((ns) =>
        ns.map((n) =>
          selected.has(n.id) || n.id === d.id
            ? { ...n, position: { x: d.origins.get(n.id).x + dx, y: d.origins.get(n.id).y + dy } }
            : n
        )
      );
    }
  };
  const onPointerUp = () => { dragRef.current = null; };
  const onWheel = (e) => {
    e.preventDefault();
    const rect = svgRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    setView((v) => {
      const k = Math.min(4, Math.max(0.1, v.k * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
      return { k, x: mx - ((mx - v.x) / v.k) * k, y: my - ((my - v.y) / v.k) * k };
    });
  };

  const byId = new Map(nodes.map((n) => [n.id, n]));

  return (
    <svg
      ref={svgRef}
      width="100%" height="100%"
      role="application"
      aria-label="自由画布"
      tabIndex={0}
      onPointerDown={onPointerDownBg}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onWheel={onWheel}
      style={{ touchAction: "none", background: "#ffffff", cursor: "grab" }}
    >
      <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`} data-bg="1">
        {doc.document.edges.map((e) => {
          const a = byId.get(e.sourceNodeId), b = byId.get(e.targetNodeId);
          if (!a || !b) return null;
          const x1 = a.position.x + a.size.width / 2, y1 = a.position.y + a.size.height / 2;
          const x2 = b.position.x + b.size.width / 2, y2 = b.position.y + b.size.height / 2;
          const dx = (x2 - x1) / 2;
          return (
            <path
              key={e.id}
              d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
              fill="none" stroke="#75746f" strokeWidth={1.5}
            />
          );
        })}
        {nodes.map((n) => {
          const lines = n.text.split("\n");
          const lh = 14 * 1.5;
          return (
            <g
              key={n.id}
              transform={`translate(${n.position.x} ${n.position.y})`}
              onPointerDown={(e) => onPointerDownNode(e, n.id)}
              role="button"
              aria-label={`节点 ${n.text}`}
              tabIndex={0}
            >
              <rect
                width={n.size.width} height={n.size.height} rx={6}
                fill={selected.has(n.id) ? "#dbeafe" : "#f7f7f5"}
                stroke={selected.has(n.id) ? "#2563eb" : "#3d3d3a"}
                strokeWidth={selected.has(n.id) ? 2 : 1}
                style={{ cursor: "move" }}
              />
              {lines.map((line, i) => (
                <text
                  key={i}
                  x={n.size.width / 2}
                  y={(n.size.height - lines.length * lh) / 2 + 14 + i * lh}
                  textAnchor="middle"
                  fontSize={14}
                  fill="#1a1a1a"
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {line}
                </text>
              ))}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

async function boot() {
  const res = await fetch("/dense-300-450.json");
  const doc = await res.json();
  createRoot(document.getElementById("root")).render(<App doc={doc} />);
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__READY = true; }));
}
boot();
