/**
 * protolab: main application.
 *
 * 3-panel layout: Palette (left) | Canvas (center) | Inspector (right)
 * with Toolbar on top. Full interactive editing via WASM backend.
 */

import { useEffect, useCallback, useRef } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Connection,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  ReactFlowProvider,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import { ComponentNode } from "./nodes/ComponentNode";
import { WireEdge } from "./edges/WireEdge";
import { Palette } from "./panels/Palette";
import { Inspector } from "./panels/Inspector";
import { Toolbar } from "./panels/Toolbar";
import { DataPanel } from "./panels/DataPanel";
import { useCircuitStore } from "./store/circuitStore";

const nodeTypes = { component: ComponentNode };
const edgeTypes = { wire: WireEdge };

function CircuitCanvas() {
  const {
    nodes: storeNodes,
    edges: storeEdges,
    addComponent,
    connectPorts,
    removeComponent,
    removeWire,
    selectNode,
    selectEdge,
    selectWire,
  } = useCircuitStore();

  const [nodes, setNodes, onNodesChange] = useNodesState(storeNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(storeEdges);
  const reactFlowWrapper = useRef<HTMLDivElement>(null);

  // Sync store → local state when store changes.
  useEffect(() => {
    setNodes(storeNodes);
  }, [storeNodes, setNodes]);

  useEffect(() => {
    setEdges(storeEdges);
  }, [storeEdges, setEdges]);

  // Handle new connections.
  const onConnect = useCallback(
    (connection: Connection) => {
      if (connection.sourceHandle && connection.targetHandle) {
        connectPorts(connection.sourceHandle, connection.targetHandle);
      }
    },
    [connectPorts],
  );

  // Handle node selection.
  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      onNodesChange(changes);
      for (const change of changes) {
        if (change.type === "select" && change.selected) {
          selectNode(change.id);
        }
      }
    },
    [onNodesChange, selectNode],
  );

  // Handle edge selection.
  const handleEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      onEdgesChange(changes);
      for (const change of changes) {
        if (change.type === "select" && change.selected) {
          selectEdge(change.id);
          selectWire(change.id);
        }
      }
    },
    [onEdgesChange, selectEdge, selectWire],
  );

  // Handle node deletion.
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      for (const node of deleted) {
        removeComponent(node.id);
      }
    },
    [removeComponent],
  );

  // Handle edge deletion.
  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      for (const edge of deleted) {
        removeWire(edge.id);
      }
    },
    [removeWire],
  );

  // Handle drop from palette.
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/lens-circuit-component");
      if (!type) return;

      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;

      const x = e.clientX - bounds.left - 80;
      const y = e.clientY - bounds.top - 40;
      addComponent(type, x, y);
    },
    [addComponent],
  );

  // Click on canvas background deselects.
  const onPaneClick = useCallback(() => {
    selectNode(null);
    selectEdge(null);
  }, [selectNode, selectEdge]);

  return (
    <div ref={reactFlowWrapper} style={{ flex: 1 }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={onConnect}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onDragOver={onDragOver}
        onDrop={onDrop}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode="Backspace"
        fitView
        style={{ background: "oklch(0.15 0.01 250)" }}
      >
        <Background color="oklch(0.22 0.01 250)" gap={20} />
        <Controls
          style={{
            background: "oklch(0.18 0.01 250)",
            border: "1px solid oklch(0.3 0.01 250)",
            borderRadius: 6,
          }}
        />
        <MiniMap
          style={{
            background: "oklch(0.12 0.01 250)",
            border: "1px solid oklch(0.25 0.01 250)",
            borderRadius: 6,
          }}
          nodeColor={(n) => {
            const optic = (n.data as any)?.opticKind;
            const colors: Record<string, string> = {
              iso: "#4CAF50",
              lens: "#2196F3",
              prism: "#9C27B0",
              affine: "#FF9800",
              traversal: "#F44336",
            };
            return colors[optic] ?? "#666";
          }}
          maskColor="rgba(0,0,0,0.6)"
        />
      </ReactFlow>
    </div>
  );
}

export default function App() {
  const { loading, error, initDemo } = useCircuitStore();

  useEffect(() => {
    initDemo();
  }, [initDemo]);

  if (error) {
    return (
      <div style={{ color: "#F44336", padding: 32, fontFamily: "monospace", fontSize: 14 }}>
        Error: {error}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ color: "#999", padding: 32, fontFamily: "monospace", fontSize: 14 }}>
        Loading WASM…
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <div style={{ width: "100vw", height: "100vh", display: "flex", flexDirection: "column" }}>
        <Toolbar />
        <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
          <Palette />
          <CircuitCanvas />
          <Inspector />
        </div>
        <DataPanel />
      </div>
    </ReactFlowProvider>
  );
}
