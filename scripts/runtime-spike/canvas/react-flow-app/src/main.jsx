import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

// Canvas spike: project fixture nodes onto React Flow. Interaction view only —
// no domain model, no commands (MM-010 canvas track).

function FixtureFlow({ doc }) {
  const [nodes, setNodes] = useState(
    doc.document.nodes.map((n) => ({
      id: n.id,
      position: n.position,
      data: { label: n.text.replace(/\n/g, " ") },
      style: { width: n.size.width },
    }))
  );
  const edges = doc.document.edges.map((e) => ({
    id: e.id,
    source: e.sourceNodeId,
    target: e.targetNodeId,
    type: "default",
  }));

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={(changes) => {
        setNodes((ns) => {
          let next = ns;
          for (const c of changes) {
            if (c.type === "position" && c.position) {
              next = next.map((n) => (n.id === c.id ? { ...n, position: c.position } : n));
            }
          }
          return next === ns ? ns : next;
        });
      }}
      fitView
      minZoom={0.1}
      maxZoom={4}
      nodesDraggable
      elementsSelectable
      panOnDrag
      zoomOnWheel
      proOptions={{ hideAttribution: false }}
    >
      <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
      <Controls />
    </ReactFlow>
  );
}

async function boot() {
  const res = await fetch("/dense-300-450.json");
  const doc = await res.json();
  createRoot(document.getElementById("root")).render(<FixtureFlow doc={doc} />);
  requestAnimationFrame(() => requestAnimationFrame(() => { window.__READY = true; }));
}
boot();
