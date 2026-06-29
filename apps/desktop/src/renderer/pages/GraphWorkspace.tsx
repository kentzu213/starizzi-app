import React, { useEffect, useMemo, useRef, useState } from 'react';
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
  type ReactFlowInstance,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import '../styles/graph-workspace.css';
import { useGraphWorkspaceStore } from '../store/graphWorkspace';
import { nodeTypeMeta, nodeViewType, isSeedNode, universeTypeOf } from '../types/graph-workspace';
import type { GraphNode, GraphLink } from '../../shared/graph-types';
import { NodeWorkspacePanel } from '../components/NodeWorkspacePanel';

type RfNode = Node<{ node: GraphNode }, 'workspace'>;
type GraphView = 'graph' | 'list';

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
 * (decision B), styled toward the web "Vũ trụ tri thức" dashboard: a topic
 * sidebar, Graph/List view tabs, and a stats footer. Click a node to open its
 * workspace panel (content + AI chat); the agent branches child nodes as
 * subtopics emerge. "Nạp Vũ trụ tri thức" overlays the shared community graph.
 */
export function GraphWorkspacePage() {
  const storeNodes = useGraphWorkspaceStore((s) => s.nodes);
  const storeLinks = useGraphWorkspaceStore((s) => s.links);
  const status = useGraphWorkspaceStore((s) => s.status);
  const bridge = useGraphWorkspaceStore((s) => s.bridge);
  const seedCount = useGraphWorkspaceStore((s) => s.seedCount);
  const selectedNodeId = useGraphWorkspaceStore((s) => s.selectedNodeId);
  const selectNode = useGraphWorkspaceStore((s) => s.selectNode);
  const setNodePosition = useGraphWorkspaceStore((s) => s.setNodePosition);
  const refresh = useGraphWorkspaceStore((s) => s.refresh);
  const loadUniverse = useGraphWorkspaceStore((s) => s.loadUniverse);
  const universeStatus = useGraphWorkspaceStore((s) => s.universeStatus);

  const [view, setView] = useState<GraphView>('graph');
  const rfRef = useRef<ReactFlowInstance<RfNode, Edge> | null>(null);

  const [rfNodes, setRfNodes, onNodesChange] = useNodesState<RfNode>([]);
  const [rfEdges, setRfEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Load the graph (real backend or demo) once on mount.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Sync store -> React Flow: append new nodes/edges, refresh node data, drop removed.
  useEffect(() => {
    setRfNodes((prev) => {
      const ids = new Set(prev.map((n) => n.id));
      const merged = prev.map((p) => {
        const node = storeNodes.find((n) => n.id === p.id);
        return node ? { ...p, data: { node } } : p;
      });
      const added = storeNodes.filter((n) => !ids.has(n.id)).map(toRfNode);
      const live = merged.filter((p) => storeNodes.some((n) => n.id === p.id));
      return [...live, ...added];
    });
  }, [storeNodes, setRfNodes]);

  useEffect(() => {
    setRfEdges(() => storeLinks.map(toRfEdge));
  }, [storeLinks, setRfEdges]);

  // Topic chips for the sidebar = topic-type universe seeds (web "chủ đề" parity).
  const topics = useMemo(
    () =>
      storeNodes
        .filter((n) => isSeedNode(n) && universeTypeOf(n) === 'topic')
        .sort((a, b) => a.title.localeCompare(b.title)),
    [storeNodes],
  );

  const ownedCount = useMemo(() => storeNodes.filter((n) => !isSeedNode(n)).length, [storeNodes]);

  function focusNode(id: string) {
    selectNode(id);
    if (view !== 'graph') setView('graph');
    // Best-effort centre on the node (after the graph view is mounted).
    window.setTimeout(() => {
      rfRef.current?.fitView({ nodes: [{ id }], duration: 600, maxZoom: 1.3, padding: 0.5 });
    }, 60);
  }

  return (
    <div className="gw-page">
      <aside className="gw-sidebar" aria-label="Chủ đề tri thức">
        <div className="gw-sidebar__head">Chủ đề</div>
        {topics.length === 0 ? (
          <p className="gw-sidebar__empty">
            Bấm <strong>Nạp Vũ trụ tri thức</strong> để xem các chủ đề.
          </p>
        ) : (
          <div className="gw-sidebar__list">
            {topics.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`gw-sidebar__item ${selectedNodeId === t.id ? 'gw-sidebar__item--active' : ''}`}
                onClick={() => focusNode(t.id)}
                title={t.title}
              >
                <span aria-hidden="true">{nodeTypeMeta[nodeViewType(t)].icon}</span>
                <span className="gw-sidebar__item-name">{t.title}</span>
              </button>
            ))}
          </div>
        )}
      </aside>

      <div className="gw-main">
        <div className="gw-tabs" role="tablist" aria-label="Chế độ xem graph">
          <button
            type="button"
            role="tab"
            aria-selected={view === 'graph'}
            className={`gw-tab ${view === 'graph' ? 'gw-tab--active' : ''}`}
            onClick={() => setView('graph')}
          >
            🌌 Graph
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={view === 'list'}
            className={`gw-tab ${view === 'list' ? 'gw-tab--active' : ''}`}
            onClick={() => setView('list')}
          >
            📋 Danh sách
          </button>
        </div>

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
            <button
              type="button"
              className="gw-toolbar__btn gw-toolbar__btn--ghost"
              onClick={() => void window.electronAPI?.graph?.openMyGraphWeb?.()}
              title="Mở graph cá nhân của bạn trên izziapi.com (cùng dữ liệu)"
            >
              <span aria-hidden="true">🔗</span>
              Mở trên web
            </button>
            {universeStatus === 'error' && (
              <span className="gw-toolbar__hint gw-toolbar__hint--error">
                Không nạp được vũ trụ tri thức (kiểm tra mạng).
              </span>
            )}
          </div>

          {view === 'graph' ? (
            <ReactFlow
              nodes={rfNodes}
              edges={rfEdges}
              nodeTypes={nodeTypes}
              onInit={(inst) => {
                rfRef.current = inst as ReactFlowInstance<RfNode, Edge>;
              }}
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
          ) : (
            <div className="gw-list" role="list">
              {storeNodes.length === 0 ? (
                <p className="gw-list__empty">Chưa có node nào.</p>
              ) : (
                storeNodes.map((n) => {
                  const t = nodeViewType(n);
                  return (
                    <button
                      key={n.id}
                      type="button"
                      role="listitem"
                      className={`gw-list__row ${selectedNodeId === n.id ? 'gw-list__row--active' : ''}`}
                      onClick={() => focusNode(n.id)}
                      title={n.title}
                    >
                      <span aria-hidden="true">{nodeTypeMeta[t].icon}</span>
                      <span className="gw-list__row-name">{n.title}</span>
                      <span className="gw-list__row-meta">
                        {isSeedNode(n) ? 'Vũ trụ' : nodeTypeMeta[t].label}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {status === 'loading' && (
            <div className="gw-overlay" aria-busy="true">Đang tải graph…</div>
          )}
          {status === 'empty' && bridge && seedCount === 0 && (
            <div className="gw-overlay">
              <p>Graph của bạn đang trống.</p>
              <p className="gw-overlay__hint">
                Bấm “Nạp Vũ trụ tri thức”, hoặc chọn một node rồi chat để agent tạo nhánh.
              </p>
            </div>
          )}
        </div>

        <div className="gw-stats" aria-label="Thống kê graph">
          <span><strong>{ownedCount}</strong> của bạn</span>
          <span><strong>{seedCount}</strong> tri thức</span>
          <span><strong>{storeLinks.length}</strong> liên kết</span>
          <span><strong>{topics.length}</strong> chủ đề</span>
        </div>
      </div>

      <NodeWorkspacePanel />
    </div>
  );
}
