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
import { nodeTypeMeta, nodeViewType, isSeedNode } from '../types/graph-workspace';
import type { GraphNode, GraphLink } from '../../shared/graph-types';
import { NodeWorkspacePanel } from '../components/NodeWorkspacePanel';

type RfNode = Node<{ node: GraphNode }, 'workspace'>;

function toRfNode(node: GraphNode): RfNode {
  return {
    id: node.id,
    type: 'workspace',
    position: { x: node.x ?? 0, y: node.y ?? 0 },
    data: { node },
  };
}

function toRfEdge(link: GraphLink): Edge {
  return { id: link.id, source: link.sourceId, target: link.targetId, className: 'gw-edge' };
}

/** Custom node — visually classified by its workspace type (color + icon). */
function WorkspaceFlowNode({ data }: NodeProps) {
  const node = (data as { node: GraphNode }).node;
  const type = nodeViewType(node);
  const seed = isSeedNode(node);
  const selected = useGraphWorkspaceStore((s) => s.selectedNodeId === node.id);
  const meta = nodeTypeMeta[type];
  return (
    <div
      className={`gw-node gw-node--${type} ${seed ? 'gw-node--seed' : ''} ${selected ? 'gw-node--selected' : ''}`}
    >
      <Handle type="target" position={Position.Left} className="gw-handle" />
      <span className="gw-node__icon" aria-hidden="true">{meta.icon}</span>
      <span className="gw-node__title">{node.title}</span>
      <Handle type="source" position={Position.Right} className="gw-handle" />
    </div>
  );
}

const nodeTypes = { workspace: WorkspaceFlowNode };

/**
 * AI Branching Graph Workspace — a native view over the SHARED /api/aibase graph
 * (decision B). Each node is an idea / session / question / insight / task /
 * artifact. Click a node to open its workspace panel (content + AI chat). The
 * agent branches new child nodes (real `user_node` + `user_link`) as subtopics
 * emerge, building the second-brain knowledge tree.
 */
export function GraphWorkspacePage() {
  const storeNodes = useGraphWorkspaceStore((s) => s.nodes);
  const storeLinks = useGraphWorkspaceStore((s) => s.links);
  const status = useGraphWorkspaceStore((s) => s.status);
  const bridge = useGraphWorkspaceStore((s) => s.bridge);
  const selectNode = useGraphWorkspaceStore((s) => s.selectNode);
  const setNodePosition = useGraphWorkspaceStore((s) => s.setNodePosition);
  const refresh = useGraphWorkspaceStore((s) => s.refresh);
  const loadUniverse = useGraphWorkspaceStore((s) => s.loadUniverse);
  const universeStatus = useGraphWorkspaceStore((s) => s.universeStatus);
  const seedCount = useGraphWorkspaceStore((s) => s.seedCount);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RfNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Load the graph (real backend or demo) once on mount.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Sync store -> React Flow: append new nodes/edges, refresh node data.
  useEffect(() => {
    setRfNodes((prev) => {
      const ids = new Set(prev.map((n) => n.id));
      const merged = prev.map((p) => {
        const node = storeNodes.find((n) => n.id === p.id);
        return node ? { ...p, data: { node } } : p;
      });
      const added = storeNodes.filter((n) => !ids.has(n.id)).map(toRfNode);
      // Drop RF nodes no longer in the store (e.g., after a real refresh).
      const live = merged.filter((p) => storeNodes.some((n) => n.id === p.id));
      return [...live, ...added];
    });
  }, [storeNodes, setRfNodes]);

  useEffect(() => {
    setRfEdges(() => storeLinks.map(toRfEdge));
  }, [storeLinks, setRfEdges]);

  return (
    <div className="gw-page">
      <div className="gw-canvas">
        <div className="gw-toolbar">
          <button
            type="button"
            className="gw-toolbar__btn"
            onClick={() => void loadUniverse()}
            disabled={universeStatus === 'loading'}
            title="Nạp toàn bộ vũ trụ tri thức cộng đồng vào workspace để bắt đầu làm việc"
          >
            <span aria-hidden="true">🌌</span>
            {universeStatus === 'loading' ? 'Đang nạp…' : 'Nạp Vũ trụ tri thức'}
          </button>
          {seedCount > 0 && (
            <span className="gw-toolbar__hint">
              {seedCount} node tri thức · bấm một node rồi “Bắt đầu làm việc”
            </span>
          )}
          {universeStatus === 'error' && (
            <span className="gw-toolbar__hint gw-toolbar__hint--error">
              Không nạp được vũ trụ tri thức (kiểm tra mạng).
            </span>
          )}
        </div>
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

        {status === 'loading' && (
          <div className="gw-overlay" aria-busy="true">Đang tải graph…</div>
        )}
        {status === 'empty' && bridge && (
          <div className="gw-overlay">
            <p>Graph của bạn đang trống.</p>
            <p className="gw-overlay__hint">Chọn một node rồi gõ /branch, hoặc chat để agent tạo nhánh.</p>
          </div>
        )}
      </div>
      <NodeWorkspacePanel />
    </div>
  );
}
