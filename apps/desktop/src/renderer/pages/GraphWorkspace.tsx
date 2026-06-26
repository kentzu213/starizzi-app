import React, { useEffect } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../styles/graph-workspace.css';
import { useGraphWorkspaceStore } from '../store/graphWorkspace';
import { nodeTypeMeta, type WorkspaceNode, type WorkspaceEdge } from '../types/graph-workspace';
import { NodeWorkspacePanel } from '../components/NodeWorkspacePanel';

type RfNode = Node<{ wn: WorkspaceNode }, 'workspace'>;

function toRfNode(wn: WorkspaceNode): RfNode {
  return { id: wn.id, type: 'workspace', position: { x: wn.x, y: wn.y }, data: { wn } };
}

function toRfEdge(e: WorkspaceEdge): Edge {
  return { id: e.id, source: e.sourceId, target: e.targetId, className: 'gw-edge' };
}

/** Custom node — visually classified by type (color + icon). */
function WorkspaceFlowNode({ data }: NodeProps) {
  const wn = (data as { wn: WorkspaceNode }).wn;
  const selected = useGraphWorkspaceStore((s) => s.selectedNodeId === wn.id);
  const meta = nodeTypeMeta[wn.type];
  return (
    <div className={`gw-node gw-node--${wn.type} ${selected ? 'gw-node--selected' : ''}`}>
      <Handle type="target" position={Position.Left} className="gw-handle" />
      <span className="gw-node__icon" aria-hidden="true">{meta.icon}</span>
      <span className="gw-node__title">{wn.title}</span>
      <Handle type="source" position={Position.Right} className="gw-handle" />
    </div>
  );
}

const nodeTypes = { workspace: WorkspaceFlowNode };

/**
 * AI Branching Graph Workspace — the first-class graph view. Each node is an
 * idea / session / question / insight / task / artifact. Click a node to open its
 * workspace panel (content + AI chat). The agent branches new child nodes as new
 * subtopics emerge, building a knowledge tree.
 */
export function GraphWorkspacePage() {
  const storeNodes = useGraphWorkspaceStore((s) => s.nodes);
  const storeEdges = useGraphWorkspaceStore((s) => s.edges);
  const selectNode = useGraphWorkspaceStore((s) => s.selectNode);
  const setNodePosition = useGraphWorkspaceStore((s) => s.setNodePosition);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RfNode>(storeNodes.map(toRfNode));
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>(storeEdges.map(toRfEdge));

  // Sync store -> React Flow: append newly created branch nodes and refresh data.
  useEffect(() => {
    setRfNodes((prev) => {
      const ids = new Set(prev.map((n) => n.id));
      const merged = prev.map((p) => {
        const wn = storeNodes.find((n) => n.id === p.id);
        return wn ? { ...p, data: { wn } } : p;
      });
      const added = storeNodes.filter((n) => !ids.has(n.id)).map(toRfNode);
      return added.length > 0 ? [...merged, ...added] : merged;
    });
  }, [storeNodes, setRfNodes]);

  useEffect(() => {
    setRfEdges((prev) => {
      const ids = new Set(prev.map((e) => e.id));
      const added = storeEdges.filter((e) => !ids.has(e.id)).map(toRfEdge);
      return added.length > 0 ? [...prev, ...added] : prev;
    });
  }, [storeEdges, setRfEdges]);

  return (
    <div className="gw-page">
      <div className="gw-canvas">
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={(_, n) => selectNode(n.id)}
          onNodeDragStop={(_, n) => setNodePosition(n.id, n.position.x, n.position.y)}
          onPaneClick={() => selectNode(null)}
          fitView
          colorMode="dark"
          minZoom={0.2}
          maxZoom={2.5}
          nodesConnectable={false}
        >
          <Background gap={28} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
      <NodeWorkspacePanel />
    </div>
  );
}
