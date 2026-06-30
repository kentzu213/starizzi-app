"use client";
import "../styles/knowledge-universe.css";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import type { CSSProperties } from "react";
import type { ForceGraphMethods } from "react-force-graph-2d";
import ForceGraph2D from "react-force-graph-2d";
import {
  fetchMe, fetchNodes, fetchLinks, fetchContributions,
  createNode as apiCreateNode, updateNode as apiUpdateNode, removeNode as apiRemoveNode,
  createLink as apiCreateLink, updateLink as apiUpdateLink, removeLink as apiRemoveLink,
  searchNodes as apiSearchNodes, fetchCommunities as apiFetchCommunities,
  importUrl as apiImportUrl, extractDocument as apiExtractDocument,
  synthesizeTopic as apiSynthesizeTopic,
  nodeTypeConfig, graphTopics,
  type UserNode, type UserLink, type Community, type SearchHit,
} from "../lib/aibase-api";

/**
 * Electron in-app navigation shim. The web used Next.js <Link>/useRouter to
 * cross-link to other AIBase pages; in the desktop those live on izziapi.com,
 * so internal links open the canonical web page in the user's browser.
 */
const IZZI_WEB = "https://izziapi.com";
function openWeb(path: string) {
  const url = path.startsWith("http") ? path : `${IZZI_WEB}${path.startsWith("/") ? "" : "/"}${path}`;
  void (window as unknown as { electronAPI?: { shell?: { openExternal?: (u: string) => void } } })
    .electronAPI?.shell?.openExternal?.(url);
}
function Link(props: { href: string; className?: string; children: React.ReactNode }) {
  return (
    <button type="button" className={props.className} onClick={() => openWeb(props.href)}>
      {props.children}
    </button>
  );
}

type GraphNodeRender = {
  [others: string]: unknown;
  id?: string | number;
  name?: string;
  color?: string;
  size?: number;
  type?: string;
  val?: number;
  primary?: boolean;
  demo?: boolean;
  degree?: number;
  tags?: string[];
  tagColor?: string;
  filteredOut?: boolean;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number;
  fy?: number;
};

type GraphLinkRender = {
  [others: string]: unknown;
  source?: string | number | GraphNodeRender;
  target?: string | number | GraphNodeRender;
  color?: string;
  sourceColor?: string;
  targetColor?: string;
  label?: string;
  demo?: boolean;
  bridge?: boolean;
  crossTag?: boolean;
};

type ExtractedPreviewNode = {
  title: string;
  content: string;
  nodeType: string;
  color: string;
  level: number;
  selected?: boolean;
};

function colorWithAlpha(color: string, alpha: number) {
  if (color.startsWith("#")) {
    const hex = color.slice(1);
    const full = hex.length === 3
      ? hex.split("").map((ch) => ch + ch).join("")
      : hex;
    const value = Number.parseInt(full, 16);
    if (Number.isFinite(value)) {
      const r = (value >> 16) & 255;
      const g = (value >> 8) & 255;
      const b = value & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  if (color.startsWith("rgb(")) return color.replace("rgb(", "rgba(").replace(")", `, ${alpha})`);
  return color;
}

const tagPalette = [
  "#ff1744",
  "#ff3d00",
  "#ff9100",
  "#ffd600",
  "#76ff03",
  "#00e676",
  "#00e5ff",
  "#448aff",
  "#7c4dff",
  "#e040fb",
  "#ff4081",
  "#aeb8c5",
] as const;

const canonicalTagOrder = [
  "agent-memory",
  "agent-session",
  "agents",
  "ai",
  "ai-agent",
  "ai-knowledge",
  "aibase",
  "api",
  "automation",
  "backend",
  "billing",
  "bugs",
  "business",
  "claude-code",
  "code",
  "embedding",
  "graph",
  "llm",
  "memory",
  "mcp",
  "prompt-engineering",
  "rag",
  "search",
  "security",
  "vector-db",
  "workflow",
];

function normalizeTag(tag: string) {
  return tag
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 34);
}

function tagColor(tag: string) {
  const normalized = normalizeTag(tag);
  const knownIndex = canonicalTagOrder.indexOf(normalized);
  if (knownIndex >= 0) return tagPalette[knownIndex % tagPalette.length];
  let hash = 0;
  for (let i = 0; i < normalized.length; i += 1) hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0;
  return tagPalette[hash % tagPalette.length];
}

function uniqueTags(tags: string[]) {
  return [...new Set(tags.map(normalizeTag).filter(Boolean))];
}

function inferTagsFromText(text: string) {
  const source = text.toLowerCase();
  const tags: string[] = [];
  const rules: Array<[string, RegExp]> = [
    ["prompt-engineering", /prompt/],
    ["rag", /\brag\b|retrieval|grounding/],
    ["vector-db", /vector|pinecone|milvus|chroma|embedding/],
    ["llm", /\bllm\b|language model|openai|anthropic|gemini|deepseek/],
    ["agents", /agent|workflow|tool call|browser action/],
    ["mcp", /\bmcp\b/],
    ["claude-code", /claude code|cli|terminal|hook|pull request/],
    ["api", /\bapi\b|route|endpoint/],
    ["memory", /memory|recall|session/],
    ["search", /search|rerank|bm25/],
    ["automation", /automation|auto|workflow/],
    ["security", /permission|guard|policy/],
  ];
  rules.forEach(([tag, pattern]) => {
    if (pattern.test(source)) tags.push(tag);
  });
  return tags;
}

function tagsFromUserNode(node: UserNode) {
  const metadataTags: string[] = [];
  if (node.metadata) {
    try {
      const metadata = JSON.parse(node.metadata) as { tags?: unknown; tag?: unknown };
      if (Array.isArray(metadata.tags)) metadataTags.push(...metadata.tags.filter((tag): tag is string => typeof tag === "string"));
      if (typeof metadata.tag === "string") metadataTags.push(metadata.tag);
    } catch {
      // Metadata is user-provided JSON-ish content; ignore malformed tag payloads.
    }
  }

  return uniqueTags([
    node.nodeType,
    node.topicId ? "graph" : "",
    ...metadataTags,
    ...inferTagsFromText(`${node.title} ${node.content ?? ""} ${node.url ?? ""}`),
  ]);
}

function linkEndpointId(endpoint: GraphLinkRender["source"]) {
  return typeof endpoint === "object" ? String(endpoint.id ?? "") : String(endpoint ?? "");
}

function hexToRgb(color: string): [number, number, number] | null {
  if (!color.startsWith("#")) return null;
  const hex = color.slice(1);
  const full = hex.length === 3
    ? hex.split("").map((ch) => ch + ch).join("")
    : hex;
  if (full.length !== 6) return null;
  const value = Number.parseInt(full, 16);
  if (!Number.isFinite(value)) return null;
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function mixTagColors(a: string, b: string, ratio = 0.5) {
  const rgbA = hexToRgb(a);
  const rgbB = hexToRgb(b);
  if (!rgbA || !rgbB) return a || b || "#22dcc2";
  const mix = rgbA.map((channel, index) =>
    Math.round(channel * (1 - ratio) + rgbB[index] * ratio),
  );
  return `#${mix.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

const graphViewTokens = {
  bg0: "#061018",
  bg1: "#02040a",
  bg2: "#03070a",
  cyan: [35, 232, 255] as const,
  teal: [34, 220, 194] as const,
  violet: [139, 108, 255] as const,
  amber: [255, 196, 92] as const,
  graphite: [75, 105, 118] as const,
};

function tokenRgba(rgb: readonly [number, number, number], alpha: number) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

function seededUnit(index: number, salt = 0) {
  const value = Math.sin(index * 127.1 + salt * 311.7) * 43758.5453123;
  return value - Math.floor(value);
}

function stringHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function semanticGraphSeed(
  nodeId: string,
  index: number,
  total: number,
  tags: string[],
  degree: number,
) {
  const primaryTag = normalizeTag(tags[0] || "graph");
  const knownIndex = canonicalTagOrder.indexOf(primaryTag);
  const clusterIndex = knownIndex >= 0 ? knownIndex : stringHash(primaryTag) % 14;
  const clusterAngle = (clusterIndex / 14) * Math.PI * 2 - Math.PI * 0.64;
  const clusterLane = 120 + (clusterIndex % 4) * 48;
  const nodeHash = stringHash(`${nodeId}:${primaryTag}:${index}`);
  const scatterAngle = (nodeHash / 0xffffffff) * Math.PI * 2;
  const densityRank = Math.sqrt(index + 1) / Math.sqrt(Math.max(total, 1));
  const localRadius = 26 + densityRank * 118 + seededUnit(index, clusterIndex + 9) * 34;
  const hubPull = Math.min(0.56, Math.sqrt(Math.max(degree, 0)) * 0.055);
  const orbitX = Math.cos(clusterAngle) * clusterLane * (1 - hubPull);
  const orbitY = Math.sin(clusterAngle) * clusterLane * 0.64 * (1 - hubPull);

  return {
    x: orbitX + Math.cos(scatterAngle) * localRadius,
    y: orbitY + Math.sin(scatterAngle) * localRadius * 0.74,
  };
}

function drawGraphViewCanvasField(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const isCompactField = width < 760;
  const fieldTime = performance.now();
  const fieldBase = Math.min(width, height);

  const fieldBg = ctx.createLinearGradient(0, 0, width, height);
  fieldBg.addColorStop(0, "#05080d");
  fieldBg.addColorStop(0.38, "#020509");
  fieldBg.addColorStop(1, "#010307");
  ctx.fillStyle = fieldBg;
  ctx.fillRect(0, 0, width, height);

  const cloudX = width * (isCompactField ? 0.52 : 0.54);
  const cloudY = height * (isCompactField ? 0.58 : 0.63);
  const aura = ctx.createRadialGradient(cloudX, cloudY, fieldBase * 0.08, cloudX, cloudY, fieldBase * 0.56);
  aura.addColorStop(0, "rgba(35, 232, 255, 0.07)");
  aura.addColorStop(0.28, "rgba(34, 220, 194, 0.042)");
  aura.addColorStop(0.56, "rgba(139, 108, 255, 0.032)");
  aura.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = aura;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < (isCompactField ? 82 : 150); i += 1) {
    const x = seededUnit(i, 1) * width;
    const y = seededUnit(i, 2) * height;
    const twinkle = 0.72 + Math.sin(fieldTime * 0.0011 + i) * 0.18;
    const r = 0.32 + seededUnit(i, 3) * (isCompactField ? 0.85 : 1.18);
    ctx.fillStyle = `rgba(226, 240, 248, ${(0.05 + seededUnit(i, 4) * 0.2) * twinkle})`;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.translate(cloudX, cloudY);
  ctx.rotate(isCompactField ? -0.12 : -0.08);
  for (let ring = 0; ring < (isCompactField ? 5 : 7); ring += 1) {
    const rx = fieldBase * (0.12 + ring * 0.034);
    const ry = fieldBase * (0.04 + ring * 0.014);
    ctx.strokeStyle = tokenRgba(ring % 2 ? graphViewTokens.teal : graphViewTokens.graphite, 0.035 + ring * 0.012);
    ctx.lineWidth = 0.55 + ring * 0.08;
    ctx.setLineDash([4 + ring, 12 + ring * 3]);
    ctx.lineDashOffset = -((fieldTime * 0.008) % 64);
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  const fieldShade = ctx.createRadialGradient(width * 0.52, height * 0.56, 0, width * 0.52, height * 0.56, fieldBase * 0.86);
  fieldShade.addColorStop(0, "rgba(0,0,0,0)");
  fieldShade.addColorStop(0.72, "rgba(2,6,10,0.18)");
  fieldShade.addColorStop(1, "rgba(0,0,0,0.72)");
  ctx.fillStyle = fieldShade;
  ctx.fillRect(0, 0, width, height);
}

const demoGraphClusters = [
  {
    id: "prompt",
    label: "Prompt Engineering",
    color: "#46a9ff",
    x: 78,
    y: -196,
    rx: 78,
    ry: 58,
    count: 18,
    tags: ["prompt-engineering", "ai", "beginner", "automation"],
    labels: [
      "Prompt Engineering - Beginner's",
      "Prompt Engineering Guide",
      "Introduction to Prompt Engine",
      "Prompt Engineering on Reddit",
      "Prompt Requests on Reddit",
      "Prompt Designing Guide",
      "AI and SEO",
      "Practical Prompt Engineering",
      "Learn Prompting",
    ],
  },
  {
    id: "llm",
    label: "LLM Stack",
    color: "#46a9ff",
    x: -74,
    y: -56,
    rx: 96,
    ry: 62,
    count: 21,
    tags: ["llm", "ai-models", "api", "agents"],
    labels: [
      "What are Large Language Models?",
      "Introduction to LLMs",
      "LLM for Beginners",
      "LangChain Chat Loop",
      "OpenAI Format",
      "Anthropic Route",
      "Gemini Flash",
      "DeepSeek route",
      "Feedback loop in chat",
      "Agents with tools",
    ],
  },
  {
    id: "rag",
    label: "RAG + Vector DB",
    color: "#ffc45c",
    x: -10,
    y: 42,
    rx: 108,
    ry: 68,
    count: 25,
    tags: ["rag", "vector-db", "embedding", "search"],
    labels: [
      "Retrieval Augmented Generation",
      "Introduction to RAG",
      "Vector Databases for RAG",
      "RAG best practices",
      "Chunking strategies",
      "Hybrid search",
      "Embedding pipeline",
      "Pinecone Vector DB",
      "Milvus index",
      "Chroma DB",
      "BM25 reranking",
      "Knowledge grounding",
    ],
  },
  {
    id: "agents",
    label: "Agent Workflows",
    color: "#45d982",
    x: 52,
    y: 146,
    rx: 112,
    ry: 76,
    count: 25,
    tags: ["agents", "workflow", "mcp", "automation", "security"],
    labels: [
      "AI Agent permissions",
      "Choose a permission mode",
      "MCP install and configure",
      "Agent memory store",
      "Task trace",
      "Browser action replay",
      "Hook workflows",
      "Claude Code works",
      "Terminal automation",
      "Tool call planning",
      "Evaluate answer",
      "Auto recall",
    ],
  },
  {
    id: "code",
    label: "Claude Code",
    color: "#aeb8c5",
    x: 86,
    y: 224,
    rx: 82,
    ry: 54,
    count: 24,
    tags: ["claude-code", "code", "backend", "bugs"],
    labels: [
      "Cài đặt Claude Code",
      "Claude Code hooks",
      "CLI agents",
      "Review pull request",
      "Fix terminal error",
      "Manage context",
      "Code workspace",
      "Commit checklist",
      "Troubleshoot MCP",
      "Local browser preview",
    ],
  },
] as const;

function buildLocalDemoGraph(): { nodes: GraphNodeRender[]; links: GraphLinkRender[] } {
  const nodes: GraphNodeRender[] = [];
  const links: GraphLinkRender[] = [];

  demoGraphClusters.forEach((cluster, clusterIndex) => {
    for (let i = 0; i < cluster.count; i += 1) {
      const id = `demo-${cluster.id}-${i}`;
      const angle = (i / Math.max(1, cluster.count - 1)) * Math.PI * 2.36 + clusterIndex * 0.84;
      const ring = i < 3 ? 0.16 + i * 0.08 : 0.28 + seededUnit(i, clusterIndex + 20) * 0.9;
      const spine = (i - cluster.count / 2) / cluster.count;
      const x =
        cluster.x +
        Math.cos(angle) * cluster.rx * ring +
        (seededUnit(i, clusterIndex + 31) - 0.5) * cluster.rx * 0.46 +
        spine * 42;
      const y =
        cluster.y +
        Math.sin(angle) * cluster.ry * ring +
        (seededUnit(i, clusterIndex + 42) - 0.5) * cluster.ry * 0.62 +
        spine * 28;
      const primary = i === 0 || i === 4 || i === 7 || (cluster.id === "rag" && i === 3) || (cluster.id === "agents" && i === 5);
      const tags = uniqueTags([
        ...cluster.tags,
        ...inferTagsFromText(cluster.labels[i % cluster.labels.length]),
        i % 4 === 0 ? "advanced" : "",
        i % 7 === 0 ? "beginner" : "",
      ]);
      const primaryTag = tags[0] || cluster.id;
      nodes.push({
        id,
        name: cluster.labels[i % cluster.labels.length],
        color: tagColor(primaryTag),
        type: cluster.id,
        val: primary ? 8 : 4,
        primary,
        demo: true,
        tags,
        tagColor: tagColor(primaryTag),
        x,
        y,
      });
    }
  });

  demoGraphClusters.forEach((cluster) => {
    for (let i = 1; i < cluster.count; i += 1) {
      links.push({
        source: `demo-${cluster.id}-${i - 1}`,
        target: `demo-${cluster.id}-${i}`,
        color: colorWithAlpha(cluster.color, 0.24),
        demo: true,
      });
    }
    for (let i = 2; i < cluster.count; i += 3) {
      links.push({
        source: `demo-${cluster.id}-0`,
        target: `demo-${cluster.id}-${i}`,
        color: colorWithAlpha(cluster.color, 0.26),
        demo: true,
      });
    }
  });

  const internalLinks = links.splice(0);
  const bridges = [
    ["demo-prompt-0", "demo-llm-0", "shapes"],
    ["demo-prompt-3", "demo-rag-0", "retrieves"],
    ["demo-prompt-7", "demo-agents-10", "drives"],
    ["demo-prompt-12", "demo-code-7", "codifies"],
    ["demo-prompt-15", "demo-rag-11", "grounds"],
    ["demo-llm-4", "demo-rag-0", "grounds"],
    ["demo-llm-5", "demo-rag-3", "indexes"],
    ["demo-llm-9", "demo-code-6", "implements"],
    ["demo-llm-13", "demo-agents-2", "orchestrates"],
    ["demo-llm-18", "demo-prompt-5", "refines"],
    ["demo-rag-0", "demo-agents-0", "feeds"],
    ["demo-rag-7", "demo-agents-5", "retrieves"],
    ["demo-rag-11", "demo-code-9", "validates"],
    ["demo-rag-16", "demo-prompt-8", "cites"],
    ["demo-rag-21", "demo-llm-15", "context"],
    ["demo-agents-0", "demo-code-0", "executes"],
    ["demo-agents-4", "demo-llm-8", "plans"],
    ["demo-agents-9", "demo-code-4", "replays"],
    ["demo-agents-14", "demo-prompt-2", "improves"],
    ["demo-agents-18", "demo-rag-14", "recalls"],
    ["demo-agents-22", "demo-code-18", "checks"],
    ["demo-code-3", "demo-prompt-9", "reviews"],
    ["demo-code-8", "demo-rag-19", "tests"],
    ["demo-code-13", "demo-llm-2", "routes"],
    ["demo-code-20", "demo-agents-12", "automates"],
  ] as const;

  bridges.forEach(([source, target, label], index) => {
    links.push({
      source,
      target,
      color: index % 2 ? "rgba(139,108,255,0.56)" : "rgba(35,232,255,0.5)",
      label,
      demo: true,
      bridge: true,
    });
  });

  links.push(...internalLinks);

  let cursor = 0;
  while (links.length < 188) {
    const source = nodes[(cursor * 7 + 3) % nodes.length];
    const target = nodes[(cursor * 13 + 17) % nodes.length];
    if (source.id !== target.id && source.type !== target.type) {
      links.push({
        source: String(source.id),
        target: String(target.id),
        color: cursor % 2 ? "rgba(34,220,194,0.18)" : "rgba(139,108,255,0.16)",
        label: cursor % 6 === 0 ? "related" : "",
        demo: true,
        bridge: true,
      });
    }
    cursor += 1;
  }

  return { nodes, links: links.slice(0, 188) };
}

function isLocalGraphPreviewHost() {
  // Desktop is always the authenticated production graph — never the web's
  // localhost demo-preview mode.
  return false;
}


export default function MyGraphPage() {
  const graphRef = useRef<ForceGraphMethods | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [nodes, setNodes] = useState<UserNode[]>([]);
  const [links, setLinks] = useState<UserLink[]>([]);
  const [contribStats, setContribStats] = useState<{ pending: number; approved: number; rejected: number }>({ pending: 0, approved: 0, rejected: 0 });
  const [showContribCard, setShowContribCard] = useState(false);
  const [selectedNode, setSelectedNode] = useState<UserNode | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [linkSource, setLinkSource] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [showTagPanel, setShowTagPanel] = useState(true);
  const [activeTags, setActiveTags] = useState<string[]>([]);
  const [tagMode, setTagMode] = useState<"AND" | "OR">("OR");
  const [selectedLink, setSelectedLink] = useState<UserLink | null>(null);
  const [editLinkLabel, setEditLinkLabel] = useState("");
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; node: UserNode } | null>(null);

  // Add modal state
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState("note");
  const [newUrl, setNewUrl] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newColor, setNewColor] = useState("#5ca7ff");
  const [newTopicId, setNewTopicId] = useState("");
  const [importing, setImporting] = useState(false);

  // Enhanced import modal state
  const [importTab, setImportTab] = useState<"url" | "pdf" | "paste">("url");
  const [pasteText, setPasteText] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [previewNodes, setPreviewNodes] = useState<Array<{ title: string; content: string; nodeType: string; color: string; level: number; selected: boolean }>>([]);
  const [previewLinks, setPreviewLinks] = useState<Array<{ sourceIndex: number; targetIndex: number; label: string }>>([]);
  const [extracting, setExtracting] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Auto-synthesis modal ("build a learning path" from web search)
  const [showSynthModal, setShowSynthModal] = useState(false);
  const [synthTopic, setSynthTopic] = useState("");
  const [synthLoading, setSynthLoading] = useState(false);

  // Community detection
  const [communities, setCommunities] = useState<Community[]>([]);
  const [showCommunities, setShowCommunities] = useState(false);

  // API-powered search results
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const searchTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Canvas dimensions (responsive)
  const [canvasW, setCanvasW] = useState(typeof window !== "undefined" ? window.innerWidth : 1200);
  const [canvasH, setCanvasH] = useState(typeof window !== "undefined" ? window.innerHeight : 800);
  const [detachedGraphView, setDetachedGraphView] = useState(false);

  // Edit panel state
  const [editTitle, setEditTitle] = useState("");
  const [editColor, setEditColor] = useState("");
  const [editContent, setEditContent] = useState("");

  async function loadGraph() {
    try {
      if (isLocalGraphPreviewHost()) {
        setNodes([]);
        setLinks([]);
        setLoading(false);
        return;
      }
      const meRes = await fetchMe();
      if (!meRes.data) {
        // Desktop has its own auth gate; if no session, just show empty.
        setNodes([]);
        setLinks([]);
        setLoading(false);
        return;
      }
      const [nodeRes, linkRes, contribRes] = await Promise.all([
        fetchNodes(),
        fetchLinks(),
        fetchContributions().catch(() => ({ data: { contributions: [] }, error: null })),
      ]);
      setNodes(nodeRes.data?.nodes || []);
      setLinks(linkRes.data?.links || []);

      // Compute contribution stats
      const stats = { pending: 0, approved: 0, rejected: 0 };
      (contribRes.data?.contributions || []).forEach((c: { status: string }) => {
        if (c.status === "pending") stats.pending++;
        else if (c.status === "approved") stats.approved++;
        else if (c.status === "rejected") stats.rejected++;
      });
      setContribStats(stats);

      setLoading(false);
    } catch {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadGraph();
    // `loadGraph` is intentionally invoked once on mount; subsequent refreshes are
    // explicit after graph mutations so the force layout does not reset mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Detached/focus view was a web URL-param mode; the desktop always renders
    // the full in-app graph, so this is a no-op kept for layout parity.
    setDetachedGraphView(false);
  }, []);

  useEffect(() => {
    if (detachedGraphView) setShowTagPanel(false);
  }, [detachedGraphView]);

  // Window resize listener
  useEffect(() => {
    const onResize = () => { setCanvasW(window.innerWidth); setCanvasH(window.innerHeight); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Toast auto-dismiss
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(""), 3500);
    return () => clearTimeout(t);
  }, [message]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.ctrlKey && e.key === "n") { e.preventDefault(); setShowAddModal(true); }
      if (e.ctrlKey && e.key === "f") { e.preventDefault(); setShowSearch(true); }
      if (e.key === "Escape") { setSelectedNode(null); setShowSearch(false); setShowAddModal(false); setLinkMode(false); }
      if (e.key === "Delete" && selectedNode && !showAddModal) { deleteNode(); }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // Keyboard handling reads the current selected node/modal state; graph delete
    // itself remains the route's existing mutation helper.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNode, showAddModal]);

  // Build graph data for visualization. Live user data keeps the real node/link
  // content, but the visual layer owns layout: persisted x/y from older sessions
  // are not pinned as fx/fy because that makes production diverge from the local
  // motion system and can lock real graphs into tall stale chains.
  const degreeByNode = useMemo(() => links.reduce<Record<string, number>>((acc, link) => {
    acc[link.sourceId] = (acc[link.sourceId] || 0) + 1;
    acc[link.targetId] = (acc[link.targetId] || 0) + 1;
    return acc;
  }, {}), [links]);

  const liveGraphData: { nodes: GraphNodeRender[]; links: GraphLinkRender[] } = useMemo(() => {
    const renderNodes = nodes.map((n, index) => {
      const tags = tagsFromUserNode(n);
      const degree = degreeByNode[n.id] || 0;
      const seed = semanticGraphSeed(n.id, index, nodes.length, tags, degree);
      const primaryTag = tags[0] || n.nodeType;
      return {
        id: n.id,
        name: n.title,
        color: tagColor(primaryTag),
        typeIcon: nodeTypeConfig[n.nodeType]?.icon || "",
        size: 8,
        type: n.nodeType,
        val: 9 + Math.min(8, degree),
        degree,
        tags,
        tagColor: tagColor(primaryTag),
        primary: n.nodeType === "agent-memory-root" || n.nodeType === "topic" || degree >= 3,
        x: seed.x,
        y: seed.y,
      };
    });
    const renderNodeById = new Map(renderNodes.map((node) => [String(node.id ?? ""), node]));

    return {
      nodes: renderNodes,
      links: links.map(l => {
        const sourceNode = renderNodeById.get(l.sourceId);
        const targetNode = renderNodeById.get(l.targetId);
        const sourceColor = sourceNode?.tagColor || sourceNode?.color || "#22dcc2";
        const targetColor = targetNode?.tagColor || targetNode?.color || "#22dcc2";
        const mixedColor = mixTagColors(sourceColor, targetColor, 0.48);
        return {
          source: l.sourceId,
          target: l.targetId,
          color: l.color || colorWithAlpha(mixedColor, 0.38),
          sourceColor,
          targetColor,
          crossTag: sourceColor !== targetColor,
          label: l.label || "",
        };
      }),
    };
  }, [degreeByNode, links, nodes]);
  const localhostDemoMode =
    isLocalGraphPreviewHost() &&
    nodes.length < 30;
  const demoGraphData = useMemo(() => buildLocalDemoGraph(), []);
  const sourceGraphData = localhostDemoMode ? demoGraphData : liveGraphData;
  const sourceDegrees = useMemo(() => {
    const degrees = new Map<string, number>();
    sourceGraphData.links.forEach((link) => {
      const sourceId = linkEndpointId(link.source);
      const targetId = linkEndpointId(link.target);
      if (sourceId) degrees.set(sourceId, (degrees.get(sourceId) || 0) + 1);
      if (targetId) degrees.set(targetId, (degrees.get(targetId) || 0) + 1);
    });
    return degrees;
  }, [sourceGraphData.links]);
  const availableTags = useMemo(() => {
    const counts = new Map<string, number>();
    sourceGraphData.nodes.forEach((node) => {
      (node.tags || []).forEach((tag) => {
        const normalized = normalizeTag(tag);
        if (normalized) counts.set(normalized, (counts.get(normalized) || 0) + 1);
      });
    });
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count, color: tagColor(tag) }))
      .sort((a, b) => {
        const orderA = canonicalTagOrder.indexOf(a.tag);
        const orderB = canonicalTagOrder.indexOf(b.tag);
        if (orderA >= 0 || orderB >= 0) return (orderA >= 0 ? orderA : 999) - (orderB >= 0 ? orderB : 999);
        return b.count - a.count || a.tag.localeCompare(b.tag);
      });
  }, [sourceGraphData.nodes]);
  const filteredNodeIds = useMemo(() => {
    if (activeTags.length === 0) return new Set(sourceGraphData.nodes.map((node) => String(node.id ?? "")));
    return new Set(
      sourceGraphData.nodes
        .filter((node) => {
          const nodeTags = new Set((node.tags || []).map(normalizeTag));
          return tagMode === "AND"
            ? activeTags.every((tag) => nodeTags.has(tag))
            : activeTags.some((tag) => nodeTags.has(tag));
        })
        .map((node) => String(node.id ?? "")),
    );
  }, [activeTags, sourceGraphData.nodes, tagMode]);
  const graphData = useMemo(() => {
    const shouldDim = activeTags.length > 0;
    return {
      nodes: sourceGraphData.nodes.map((node) => {
        const nodeId = String(node.id ?? "");
        const degree = sourceDegrees.get(nodeId) || 0;
        const nodeTags = node.tags || [];
        const primaryTag = nodeTags[0] || String(node.type || "node");
        return {
          ...node,
          degree,
          val: 6 + Math.min(26, degree * 2.1),
          primary: Boolean(node.primary) || degree >= 5,
          tagColor: node.tagColor || tagColor(primaryTag),
          color: node.tagColor || tagColor(primaryTag),
          filteredOut: shouldDim && !filteredNodeIds.has(nodeId),
        };
      }),
      links: sourceGraphData.links.map((link) => {
        const sourceId = linkEndpointId(link.source);
        const targetId = linkEndpointId(link.target);
        return {
          ...link,
          filteredOut: shouldDim && (!filteredNodeIds.has(sourceId) || !filteredNodeIds.has(targetId)),
        };
      }),
    };
  }, [activeTags.length, filteredNodeIds, sourceDegrees, sourceGraphData.links, sourceGraphData.nodes]);
  const visualNodeCount = graphData.nodes.length;
  const visualLinkCount = graphData.links.length;
  const activeVisualNodeCount = activeTags.length > 0 ? filteredNodeIds.size : visualNodeCount;

  function toggleTag(tag: string) {
    const normalized = normalizeTag(tag);
    setActiveTags((current) =>
      current.includes(normalized)
        ? current.filter((item) => item !== normalized)
        : [...current, normalized],
    );
  }

  function handleNodeClick(node: GraphNodeRender) {
    const nodeId = String(node.id ?? "");
    if (node.demo) {
      setSelectedNode(null);
      setSelectedLink(null);
      setMessage("Demo preview — dữ liệu thật vẫn được giữ nguyên trong database.");
      return;
    }
    if (linkMode) {
      if (linkSource === null) {
        setLinkSource(nodeId);
        setMessage(`Chọn node đích để kết nối từ "${nodes.find(n => n.id === node.id)?.title}"`);
      } else if (linkSource !== nodeId) {
        createLink(linkSource, nodeId);
        setLinkSource(null);
        setLinkMode(false);
      }
      return;
    }

    const userNode = nodes.find(n => n.id === nodeId);
    if (userNode) {
      setSelectedNode(userNode);
      setEditTitle(userNode.title);
      setEditColor(userNode.color);
      setEditContent(userNode.content || "");
    }
  }

  async function handleNodeDragEnd(node: GraphNodeRender) {
    const nodeId = String(node.id ?? "");
    if (!node.demo && nodeId && node.x != null && node.y != null) {
      await apiUpdateNode(nodeId, { x: node.x, y: node.y });
    }
  }

  function handleLinkClick(link: GraphLinkRender) {
    if (link.demo) {
      setSelectedLink(null);
      setMessage("Demo preview — link mẫu chỉ dùng để cân thiết kế trên localhost.");
      return;
    }
    const sourceId = linkEndpointId(link.source);
    const targetId = linkEndpointId(link.target);
    const userLink = links.find(l => l.sourceId === sourceId && l.targetId === targetId);
    if (userLink) {
      setSelectedLink(userLink);
      setEditLinkLabel(userLink.label || "");
      setSelectedNode(null);
    }
  }

  function clearGraphFocus() {
    setHoveredNode(null);
    setSelectedNode(null);
    setSelectedLink(null);
    setCtxMenu(null);
    setShowExportMenu(false);
    if (linkMode) {
      setLinkMode(false);
      setLinkSource(null);
    }
  }

  async function updateLinkLabel() {
    if (!selectedLink) return;
    try {
      await apiUpdateLink(selectedLink.id, { label: editLinkLabel });
      await loadGraph();
      setSelectedLink(null);
      setMessage("Đã cập nhật link");
    } catch { setMessage("Lỗi cập nhật link"); }
  }

  async function deleteLink() {
    if (!selectedLink) return;
    try {
      await apiRemoveLink(selectedLink.id);
      await loadGraph();
      setSelectedLink(null);
      setMessage("Đã xóa link");
    } catch { setMessage("Lỗi xóa link"); }
  }

  async function createNode() {
    if (!newTitle.trim()) return;
    try {
      const payload: Record<string, unknown> = {
        title: newTitle, nodeType: newType, color: newColor,
        content: newContent || null, topicId: newTopicId || null,
      };

      if (newType !== "note" && newUrl) {
        payload.url = newUrl;
      }

      await apiCreateNode(payload);
      setShowAddModal(false);
      resetAddForm();
      await loadGraph();
      setMessage("Đã thêm node mới");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Lỗi");
    }
  }

  async function importUrl() {
    if (!newUrl.trim()) return;
    setImporting(true);
    try {
      const res = await apiImportUrl(newUrl);
      const meta = res.data!;

      setNewTitle(meta.title);
      setNewType(meta.nodeType);
      setNewContent(meta.description);
      setNewColor(nodeTypeConfig[meta.nodeType]?.defaultColor || "#5ca7ff");
      setMessage("Đã tải metadata từ URL");
    } catch {
      setMessage("Không thể tải metadata");
    } finally {
      setImporting(false);
    }
  }

  // Auto-build a learning-path topic from web search into the user's graph (10-30s).
  async function runSynthesis() {
    const topic = synthTopic.trim();
    if (!topic || synthLoading) return;
    setSynthLoading(true);
    setMessage("🪄 Đang tìm tài liệu và dựng lộ trình…");
    try {
      const res = await apiSynthesizeTopic({ topic, rootTitle: topic });
      if (res.error) {
        setMessage(res.error);
      } else {
        setShowSynthModal(false);
        setSynthTopic("");
        await loadGraph();
        const d = res.data;
        const costNote = d?.free ? " · miễn phí" : d?.charged ? ` · trừ ${d.charged} credit` : "";
        setMessage(`Đã tạo lộ trình "${d?.rootTitle}" — ${d?.milestones} chặng · ${d?.nodesAdded} node${costNote}`);
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Lỗi tạo lộ trình");
    } finally {
      setSynthLoading(false);
    }
  }

  async function createLink(sourceId: string, targetId: string) {
    try {
      await apiCreateLink({ sourceId, targetId });
      await loadGraph();
      setMessage("Đã tạo liên kết");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Lỗi");
    }
  }

  async function updateNode() {
    if (!selectedNode) return;
    try {
      await apiUpdateNode(selectedNode.id, {
        title: editTitle, color: editColor, content: editContent,
      });
      await loadGraph();
      setSelectedNode(null);
      setMessage("Đã cập nhật node");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Lỗi");
    }
  }

  async function deleteNode() {
    if (!selectedNode) return;
    try {
      await apiRemoveNode(selectedNode.id);
      setSelectedNode(null);
      await loadGraph();
      setMessage("Đã xóa node");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Lỗi");
    }
  }

  function resetAddForm() {
    setNewTitle(""); setNewType("note"); setNewUrl("");
    setNewContent(""); setNewColor("#5ca7ff"); setNewTopicId("");
    setPasteText(""); setPdfFile(null); setImportTab("url");
    setShowPreview(false); setPreviewNodes([]); setPreviewLinks([]);
  }

  // ═══ EXTRACTION PIPELINE ═══
  async function extractFromUrl() {
    if (!newUrl.trim()) return;
    setExtracting(true);
    try {
      const result = await apiExtractDocument({ url: newUrl });
      const res = result.data!;
      if (res.isDuplicate) {
        setMessage(`⚠️ ${res.warning}`);
        setExtracting(false);
        return;
      }
      setPreviewNodes(res.nodes.map((n: ExtractedPreviewNode) => ({ ...n, selected: true })));
      setPreviewLinks(res.links);
      setShowPreview(true);
      const crossCount = res.crossLinks?.length || 0;
      setMessage(`Trích xuất ${res.nodes.length} nodes từ URL${crossCount ? ` (${crossCount} liên kết tự động)` : ""}`);
    } catch { setMessage("Lỗi trích xuất URL"); }
    finally { setExtracting(false); }
  }

  async function extractFromPdf() {
    if (!pdfFile) return;
    setExtracting(true);
    try {
      const formData = new FormData();
      formData.append("file", pdfFile);
      const API_BASE = process.env.NEXT_PUBLIC_API_URL || "https://api.izziapi.com";
      const res = await fetch(`${API_BASE}/api/aibase/extract-pdf`, {
        method: "POST", body: formData, credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Lỗi");
      if (json.isDuplicate) {
        setMessage(`⚠️ ${json.warning}`);
        setExtracting(false);
        return;
      }
      setPreviewNodes(json.nodes.map((n: ExtractedPreviewNode) => ({ ...n, selected: true })));
      setPreviewLinks(json.links);
      setShowPreview(true);
      const crossCount = json.crossLinks?.length || 0;
      setMessage(`Trích xuất ${json.nodes.length} nodes từ PDF (${json.pageCount} trang)${crossCount ? ` • ${crossCount} liên kết` : ""}`);
    } catch (err) { setMessage(err instanceof Error ? err.message : "Lỗi trích xuất PDF"); }
    finally { setExtracting(false); }
  }

  async function extractFromPaste() {
    if (!pasteText.trim() || pasteText.length < 50) {
      setMessage("Cần ít nhất 50 ký tự để trích xuất");
      return;
    }
    setExtracting(true);
    try {
      const result = await apiExtractDocument({ text: pasteText });
      const res = result.data!;
      setPreviewNodes(res.nodes.map((n: ExtractedPreviewNode) => ({ ...n, selected: true })));
      setPreviewLinks(res.links);
      setShowPreview(true);
      setMessage(`Trích xuất ${res.nodes.length} nodes từ văn bản`);
    } catch { setMessage("Lỗi trích xuất văn bản"); }
    finally { setExtracting(false); }
  }

  function togglePreviewNode(idx: number) {
    setPreviewNodes(prev => prev.map((n, i) => i === idx ? { ...n, selected: !n.selected } : n));
  }

  async function confirmBulkAdd() {
    const selected = previewNodes.filter(n => n.selected);
    if (selected.length === 0) { setMessage("Chọn ít nhất 1 node"); return; }
    setExtracting(true);
    try {
      // Create nodes and collect IDs
      const createdIds: string[] = [];
      const indexMap = new Map<number, number>(); // original index → createdIds index
      for (let i = 0; i < previewNodes.length; i++) {
        if (!previewNodes[i].selected) continue;
        const n = previewNodes[i];
        const result = await apiCreateNode({
          title: n.title, nodeType: n.nodeType, color: n.color,
          content: n.content || null,
        });
        indexMap.set(i, createdIds.length);
        createdIds.push(result.data!.node.id);
      }
      // Create links between selected nodes
      for (const link of previewLinks) {
        const srcIdx = indexMap.get(link.sourceIndex);
        const tgtIdx = indexMap.get(link.targetIndex);
        if (srcIdx !== undefined && tgtIdx !== undefined) {
          try {
            await apiCreateLink({
              sourceId: createdIds[srcIdx],
              targetId: createdIds[tgtIdx],
              label: link.label,
            });
          } catch { /* skip duplicate links */ }
        }
      }
      // Scatter imported nodes around center so they don't pile at 0,0
      const count = createdIds.length;
      for (let i = 0; i < count; i++) {
        const angle = (2 * Math.PI * i) / count;
        const radius = 60 + Math.random() * 40;
        try {
          await apiUpdateNode(createdIds[i], {
            x: Math.cos(angle) * radius,
            y: Math.sin(angle) * radius,
          });
        } catch { /* non-critical */ }
      }

      // Auto-create cross-links to existing graph nodes
      let crossLinkCount = 0;
      try {
        // Re-extract to get crossLinks (the extraction response had them)
        // Use the first created node's title to find potential links
        const allExistingNodes = nodes.filter(n => !createdIds.includes(n.id));
        for (const newId of createdIds) {
          const newNode = previewNodes.find((_, idx) => {
            const mappedIdx = indexMap.get(idx);
            return mappedIdx !== undefined && createdIds[mappedIdx] === newId;
          });
          if (!newNode) continue;
          const newTitle = newNode.title.toLowerCase();
          for (const existing of allExistingNodes) {
            const existTitle = existing.title.toLowerCase();
            const existContent = (existing.content || "").toLowerCase();
            if (
              (newTitle.length > 4 && existContent.includes(newTitle)) ||
              (existTitle.length > 4 && (newNode.content || "").toLowerCase().includes(existTitle))
            ) {
              try {
                await apiCreateLink({
                  sourceId: newId, targetId: existing.id, label: "related",
                });
                crossLinkCount++;
              } catch { /* skip if duplicate */ }
              if (crossLinkCount >= 10) break; // cap auto-links
            }
          }
          if (crossLinkCount >= 10) break;
        }
      } catch { /* non-critical */ }

      await loadGraph();
      setShowAddModal(false);
      resetAddForm();
      const crossMsg = crossLinkCount > 0 ? ` + ${crossLinkCount} liên kết tự động` : "";
      setMessage(`Đã thêm ${createdIds.length} nodes vào graph!${crossMsg}`);
    } catch (err) { setMessage(err instanceof Error ? err.message : "Lỗi bulk add"); }
    finally { setExtracting(false); }
  }

  // ═══ GEOMETRY UTILS (for community hulls) ═══
  function convexHull(points: number[][]): number[][] {
    if (points.length < 3) return [...points];
    const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (O: number[], A: number[], B: number[]) =>
      (A[0] - O[0]) * (B[1] - O[1]) - (A[1] - O[1]) * (B[0] - O[0]);
    const lower: number[][] = [];
    for (const p of sorted) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
        lower.pop();
      lower.push(p);
    }
    const upper: number[][] = [];
    for (let i = sorted.length - 1; i >= 0; i--) {
      const p = sorted[i];
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
        upper.pop();
      upper.push(p);
    }
    lower.pop();
    upper.pop();
    return lower.concat(upper);
  }

  function expandHull(hull: number[][], padding: number): number[][] {
    if (hull.length < 2) return hull;
    const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length;
    const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length;
    return hull.map(([x, y]) => {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      return [x + (dx / d) * padding, y + (dy / d) * padding];
    });
  }

  // ═══ EXPORT ═══
  function exportJSON() {
    const data = {
      exportedAt: new Date().toISOString(),
      nodes: nodes.map(n => ({
        id: n.id, title: n.title, type: n.nodeType, color: n.color,
        content: n.content, url: n.url, x: n.x, y: n.y,
      })),
      links: links.map(l => ({
        source: l.sourceId, target: l.targetId, label: l.label,
      })),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `izzi-graph-${Date.now()}.json`;
    a.click(); URL.revokeObjectURL(url);
    setShowExportMenu(false);
    setMessage("Đã xuất graph JSON");
  }

  function exportPNG() {
    const canvas = document.querySelector("canvas");
    if (!canvas) { setMessage("Không tìm thấy canvas"); return; }
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `izzi-graph-${Date.now()}.png`;
      a.click(); URL.revokeObjectURL(url);
      setShowExportMenu(false);
      setMessage("Đã xuất graph PNG");
    }, "image/png");
  }

  // Build neighbor set for hover highlighting
  const neighborSet = useCallback((nodeId: string | null) => {
    if (!nodeId) return new Set<string>();
    const s = new Set<string>([nodeId]);
    graphData.links.forEach(l => {
      const sourceId = linkEndpointId(l.source);
      const targetId = linkEndpointId(l.target);
      if (sourceId === nodeId) s.add(targetId);
      if (targetId === nodeId) s.add(sourceId);
    });
    return s;
  }, [graphData.links]);

  const focusNodeId = hoveredNode || selectedNode?.id || null;
  const hoveredNeighbors = neighborSet(focusNodeId);

  const fitGraphToReadableScale = useCallback(() => {
    if (!graphRef.current || visualNodeCount === 0) return;
    const padding = window.innerWidth < 768 ? 44 : 96;
    graphRef.current.zoomToFit(650, padding);
    window.setTimeout(() => {
      const currentZoom = graphRef.current?.zoom?.() ?? 1;
      const minZoom = localhostDemoMode ? 1.18 : 0.78;
      const maxZoom = localhostDemoMode ? 2.35 : 2.8;
      if (currentZoom < minZoom) graphRef.current?.zoom(minZoom, 420);
      if (currentZoom > maxZoom) graphRef.current?.zoom(maxZoom, 420);
    }, 680);
  }, [localhostDemoMode, visualNodeCount]);

  useEffect(() => {
    if (!graphRef.current || visualNodeCount === 0) return;
    const timer = window.setTimeout(() => {
      const graph = graphRef.current;
      if (!graph) return;

      const chargeForce = graph.d3Force("charge");
      if (chargeForce && typeof chargeForce.strength === "function") {
        chargeForce.strength(localhostDemoMode ? -62 : -96);
      }
      if (chargeForce && typeof chargeForce.distanceMax === "function") {
        chargeForce.distanceMax(localhostDemoMode ? 360 : 540);
      }

      const linkForce = graph.d3Force("link");
      if (linkForce && typeof linkForce.distance === "function") {
        linkForce.distance((link: GraphLinkRender) => {
          const sourceId = linkEndpointId(link.source);
          const targetId = linkEndpointId(link.target);
          const sourceDegree = sourceDegrees.get(sourceId) || 0;
          const targetDegree = sourceDegrees.get(targetId) || 0;
          const hubLink = sourceDegree >= 8 || targetDegree >= 8;
          if (localhostDemoMode) return link.bridge ? 56 : 34;
          return hubLink ? 38 : 54;
        });
      }
      if (linkForce && typeof linkForce.strength === "function") {
        linkForce.strength(localhostDemoMode ? 0.34 : 0.42);
      }

      graph.d3ReheatSimulation();
      window.setTimeout(fitGraphToReadableScale, 420);
    }, 120);

    return () => window.clearTimeout(timer);
  }, [fitGraphToReadableScale, localhostDemoMode, sourceDegrees, visualLinkCount, visualNodeCount]);

  useEffect(() => {
    const timer = window.setTimeout(fitGraphToReadableScale, 280);
    return () => window.clearTimeout(timer);
  }, [fitGraphToReadableScale, canvasW, canvasH]);

  const nodeCanvasObject = useCallback((node: GraphNodeRender, ctx: CanvasRenderingContext2D, globalScale = 1) => {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    const nodeTags = Array.isArray(node.tags) ? node.tags.map(String).filter(Boolean) : [];
    const primaryTagColor = node.tagColor || (nodeTags[0] ? tagColor(nodeTags[0]) : "");
    const color = primaryTagColor || node.color || "#22dcc2";
    const secondaryTagColors = uniqueTags(nodeTags.slice(1, 5)).map(tagColor);
    const nodeId = String(node.id ?? "");
    const isDemoNode = Boolean(node.demo);
    const isHovered = nodeId === hoveredNode;
    const isSelected = nodeId === selectedNode?.id;
    const isNeighbor = hoveredNeighbors.has(nodeId);
    const isPrimary = Boolean(node.primary);
    const isFilteredOut = Boolean(node.filteredOut);
    const isDimmed = isFilteredOut || (focusNodeId !== null && !isNeighbor);
    const degree = Number(node.degree || 0);
    const degreeBoost = Math.min(isDemoNode ? 7.5 : 9, Math.sqrt(degree) * (isDemoNode ? 1.45 : 1.7));
    const alpha = isDimmed ? 0.13 : isDemoNode ? 0.96 : isPrimary ? 0.96 : 0.86;
    const baseSize = isDemoNode ? (isPrimary ? 5.2 : 3.2) + degreeBoost * 0.18 : (isPrimary ? 5.8 : 3.9) + degreeBoost * 0.2;
    const size = (isHovered || isSelected) ? baseSize + 2.1 : (isNeighbor && focusNodeId ? baseSize + 0.9 : baseSize);
    const labelFont = Math.max(
      canvasW < 760 ? 4.6 : 5.2,
      Math.min(canvasW < 760 ? 8 : 8.4, 13 / globalScale),
    );

    if (node.name) {
      const zoomCompact = globalScale < 1.05;
      const zoomTiny = globalScale < 0.82;
      const rawLabel = String(node.name ?? "");
      const label = rawLabel.slice(0, zoomTiny ? 10 : zoomCompact ? 16 : isHovered || isSelected ? 34 : 24);
      const fontSize = zoomTiny ? 4.2 : zoomCompact ? 5.2 : Math.max(4.8, Math.min(7.6, 10.5 / globalScale));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.font = `${isPrimary ? 800 : 720} ${fontSize}px 'Inter', sans-serif`;
      const textWidth = ctx.measureText(label).width;
      const width = Math.max((zoomTiny ? 24 : 38) / globalScale, Math.min((isPrimary ? 132 : 110) / globalScale, textWidth + (zoomTiny ? 10 : 16) / globalScale));
      const height = Math.max((zoomTiny ? 10 : 14) / globalScale, Math.min((isPrimary ? 22 : 18) / globalScale, (zoomTiny ? 11 : 15) / globalScale + degreeBoost * 0.06));
      const isWarm = String(node.type).includes("rag") || String(node.type).includes("prompt");
      const shell = ctx.createLinearGradient(x - width / 2, y - height / 2, x + width / 2, y + height / 2);
      shell.addColorStop(0, colorWithAlpha(color, isHovered || isSelected ? 0.52 : 0.38));
      shell.addColorStop(0.16, colorWithAlpha(color, isHovered || isSelected ? 0.34 : 0.24));
      shell.addColorStop(0.48, isWarm ? "rgba(7, 18, 25, 0.95)" : "rgba(9, 16, 23, 0.95)");
      shell.addColorStop(1, "rgba(2, 6, 10, 0.96)");
      ctx.shadowColor = colorWithAlpha(color, isHovered || isSelected ? 0.56 : 0.36);
      ctx.shadowBlur = isHovered || isSelected ? 23 / globalScale : 15 / globalScale;
      ctx.beginPath();
      ctx.roundRect(x - width / 2, y - height / 2, width, height, 999);
      ctx.fillStyle = shell;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = isSelected
        ? "rgba(35,232,255,0.86)"
        : isHovered
          ? "rgba(246,255,255,0.52)"
          : colorWithAlpha(color, isPrimary ? 0.72 : 0.48);
      ctx.lineWidth = (isSelected ? 1.35 : isPrimary ? 1.16 : 0.86) / globalScale;
      ctx.stroke();

      const tagStripW = Math.max(3.4 / globalScale, Math.min(6.5 / globalScale, width * 0.08));
      const tagStrip = ctx.createLinearGradient(x - width / 2, y - height / 2, x - width / 2 + tagStripW, y + height / 2);
      tagStrip.addColorStop(0, colorWithAlpha(color, 0.95));
      tagStrip.addColorStop(1, colorWithAlpha(color, 0.46));
      ctx.beginPath();
      ctx.roundRect(x - width / 2 + 1 / globalScale, y - height / 2 + 1 / globalScale, tagStripW, height - 2 / globalScale, 999);
      ctx.fillStyle = tagStrip;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(x - width / 2 + 8 / globalScale, y, (isPrimary ? 3.2 : 2.2) / globalScale, 0, 2 * Math.PI);
      ctx.fillStyle = colorWithAlpha(color, isHovered || isSelected ? 0.88 : 0.74);
      ctx.fill();

      if (isPrimary || degree >= 8) {
        ctx.beginPath();
        ctx.arc(x - width / 2 + 8 / globalScale, y, (5.4 + Math.min(7, degree * 0.22)) / globalScale, 0, 2 * Math.PI);
        ctx.strokeStyle = colorWithAlpha(color, isDimmed ? 0.12 : 0.66);
        ctx.lineWidth = 1.2 / globalScale;
        ctx.stroke();
      }

      if (!zoomTiny && secondaryTagColors.length > 0) {
        const dotRadius = Math.max(1.25 / globalScale, Math.min(2.2 / globalScale, height * 0.12));
        const dotGap = 5 / globalScale;
        const totalDotWidth = (secondaryTagColors.length - 1) * dotGap;
        let dotX = x + width / 2 - 9 / globalScale - totalDotWidth;
        const dotY = y + height / 2 - 4.6 / globalScale;
        secondaryTagColors.forEach((tagTone) => {
          ctx.beginPath();
          ctx.arc(dotX, dotY, dotRadius, 0, 2 * Math.PI);
          ctx.fillStyle = colorWithAlpha(tagTone, isDimmed ? 0.22 : 0.82);
          ctx.fill();
          dotX += dotGap;
        });
      }

      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillStyle = isDimmed ? "rgba(255,255,255,0.2)" : "rgba(246,250,255,0.94)";
      if (!zoomTiny || isPrimary || isHovered || isSelected) {
        ctx.fillText(label, x - width / 2 + 13 / globalScale, y + 0.3 / globalScale, width - 18 / globalScale);
      }

      if (linkMode && linkSource === nodeId) {
        ctx.beginPath();
        ctx.roundRect(x - width / 2 - 4 / globalScale, y - height / 2 - 4 / globalScale, width + 8 / globalScale, height + 8 / globalScale, 999);
        ctx.strokeStyle = "rgba(69, 217, 130, 0.9)";
        ctx.lineWidth = 1.3 / globalScale;
        ctx.setLineDash([4 / globalScale, 4 / globalScale]);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      ctx.globalAlpha = 1;
      return;
    }

    // Outer glow
    if (isHovered || isSelected) {
      const grad = ctx.createRadialGradient(x, y, size, x, y, size + 12);
      grad.addColorStop(0, colorWithAlpha(color, isSelected ? 0.34 : 0.22));
      grad.addColorStop(1, colorWithAlpha(color, 0));
      ctx.beginPath();
      ctx.arc(x, y, size + (isSelected ? 12 : 9), 0, 2 * Math.PI);
      ctx.fillStyle = grad;
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, size + 4.6, 0, 2 * Math.PI);
      ctx.fillStyle = colorWithAlpha(color, isDimmed ? 0.035 : isPrimary ? 0.18 : 0.1);
      ctx.fill();
    }

    // Main circle
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.arc(x, y, size, 0, 2 * Math.PI);
    const nodeGradient = ctx.createRadialGradient(x - size * 0.35, y - size * 0.45, 0, x, y, size * 1.8);
    nodeGradient.addColorStop(0, "rgba(246,255,255,0.62)");
    nodeGradient.addColorStop(0.2, colorWithAlpha(color, isDimmed ? 0.28 : 0.9));
    nodeGradient.addColorStop(0.76, colorWithAlpha(color, isDimmed ? 0.16 : 0.48));
    nodeGradient.addColorStop(1, isPrimary ? "rgba(4,18,23,0.94)" : "rgba(18,24,31,0.95)");
    ctx.fillStyle = nodeGradient;
    ctx.fill();
    ctx.strokeStyle = isSelected
      ? "rgba(35,232,255,0.86)"
      : isHovered
        ? "rgba(246,255,255,0.48)"
        : colorWithAlpha(color, isPrimary ? 0.74 : 0.44);
    ctx.lineWidth = isSelected ? 1.6 : isHovered ? 1.1 : 0.82;
    ctx.stroke();

    if (secondaryTagColors.length > 0 && !isDimmed) {
      const ringRadius = size + 2.8;
      const arcLength = (Math.PI * 1.62) / Math.max(secondaryTagColors.length, 1);
      secondaryTagColors.forEach((tagTone, index) => {
        const start = -Math.PI / 2 + index * arcLength;
        ctx.beginPath();
        ctx.arc(x, y, ringRadius + index * 0.35, start, start + arcLength * 0.64);
        ctx.strokeStyle = colorWithAlpha(tagTone, 0.72);
        ctx.lineWidth = 1.1 / globalScale;
        ctx.stroke();
      });
    }

    // Label: zoom-out stays restrained; zoom-in and focus reveal context.
    const shouldShowLabel =
      isDemoNode ||
      isPrimary ||
      isHovered ||
      isSelected ||
      (focusNodeId && isNeighbor) ||
      (canvasW >= 760 && globalScale > 1.28) ||
      globalScale > 1.85;
    if (shouldShowLabel && !isDimmed) {
      const label = String(node.name).slice(0, isDemoNode ? 36 : isHovered || isSelected ? 34 : 26);
      const fontSize = isHovered || isSelected ? labelFont * 1.08 : labelFont;
      ctx.font = `${isDemoNode ? 800 : 720} ${fontSize}px 'Inter', sans-serif`;
      const textWidth = ctx.measureText(label).width;
      const labelX = isDemoNode ? x + size + 5 / globalScale : x;
      const labelY = isDemoNode ? y : y + size + 7 / globalScale;
      const boxW = textWidth + 9 / globalScale;
      const boxH = fontSize + 5.5 / globalScale;
      ctx.beginPath();
      ctx.roundRect(
        isDemoNode ? labelX - 3 / globalScale : labelX - boxW / 2,
        labelY - boxH / 2,
        boxW,
        boxH,
        4 / globalScale,
      );
      ctx.fillStyle = isHovered || isSelected ? "rgba(3, 8, 12, 0.82)" : isDemoNode ? "rgba(3, 8, 12, 0.48)" : "rgba(3, 8, 12, 0.58)";
      ctx.fill();
      ctx.strokeStyle = colorWithAlpha(color, isHovered || isSelected ? 0.52 : 0.24);
      ctx.lineWidth = 0.6 / globalScale;
      ctx.stroke();
      ctx.fillStyle = isDimmed ? "rgba(255,255,255,0.18)" : isDemoNode ? "rgba(246,250,255,0.92)" : "rgba(238,242,238,0.84)";
      ctx.textAlign = isDemoNode ? "left" : "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, isDemoNode ? labelX + 2 / globalScale : labelX, labelY + 0.5 / globalScale);
    }
    ctx.globalAlpha = 1;

    // Link mode: pulsing ring on source node
    if (linkMode && linkSource === nodeId) {
      ctx.beginPath();
      ctx.arc(x, y, size + 5, 0, 2 * Math.PI);
      ctx.strokeStyle = "#45d982";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }, [canvasW, focusNodeId, hoveredNode, hoveredNeighbors, linkMode, linkSource, selectedNode?.id]);

  const openDetachedGraphView = useCallback(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("view", "focus");
    const opened = window.open(url.toString(), "_blank", "noopener,noreferrer");
    if (!opened) {
      setMessage("Không mở được tab mới. Hãy cho phép popup để tách Graphview.");
    }
  }, []);

  if (loading) {
    return (
      <section className="section" style={{ padding: 0 }}>
        <div className="container" style={{ textAlign: "center", padding: "80px 0" }}>
          <div className="shimmer-loader">
            <div className="shimmer-circle" />
            <div className="shimmer-line" style={{ width: "60%" }} />
            <div className="shimmer-line" style={{ width: "40%" }} />
          </div>
          <p className="muted" style={{ marginTop: 16 }}>Đang tải graph…</p>
        </div>

      </section>
    );
  }

  return (
    <section className={`section ${detachedGraphView ? "graph-detached-section" : ""}`} style={{ padding: 0 }}>
      <div className={`graph-canvas-shell ${detachedGraphView ? "graph-canvas-shell--detached" : ""}`} style={{ position: "relative", width: "100%", height: "100vh" }}>
        {/* Toolbar */}
        <div className="graph-toolbar" role="toolbar" aria-label="Graph controls">
          <Link href="/aibase/contribute" className="toolbar-btn contrib-nav">
            ✍️ Contribute
            {contribStats.pending > 0 && <span className="contrib-badge">{contribStats.pending}</span>}
          </Link>
          <Link href="/dashboard/overview" className="toolbar-btn">📊 Dashboard</Link>
          <Link href="/aibase/memory" className="toolbar-btn">🧠 Memory</Link>
          <div className="toolbar-divider" />
          <button className="toolbar-btn primary" onClick={() => { setShowAddModal(true); setShowExportMenu(false); }}>
            ＋ Add Node
          </button>
          <button className="toolbar-btn synth" onClick={() => { setShowSynthModal(true); setShowExportMenu(false); }}>
            🪄 Build Path
          </button>
          <button
            className={`toolbar-btn ${linkMode ? "active" : ""}`}
            onClick={() => { setLinkMode(!linkMode); setLinkSource(null); setMessage(""); }}
          >
            🔗 {linkMode ? "Cancel link" : "Link nodes"}
          </button>
          <button className="toolbar-btn" onClick={() => setShowSearch(!showSearch)}>
            🔍 Search
          </button>
          <button
            className={`toolbar-btn detach-toggle ${detachedGraphView ? "active" : ""}`}
            onClick={openDetachedGraphView}
            title="Tách Graphview sang tab riêng để theo dõi"
          >
            🧭 {detachedGraphView ? "Focus View" : "Focus Tab"}
          </button>
          <button
            className={`toolbar-btn tag-toggle ${showTagPanel ? "active" : ""}`}
            onClick={() => setShowTagPanel((value) => !value)}
          >
            ◍ Tags
          </button>
          <button className="toolbar-btn" onClick={() => {
            if (graphRef.current) {
              graphRef.current.d3ReheatSimulation();
              setMessage("Reheating graph layout…");
            }
          }}>⟳ Arrange</button>
          <button
            className={`toolbar-btn ${showCommunities ? "active" : ""}`}
            onClick={async () => {
              if (!showCommunities && communities.length === 0) {
                try {
                  const result = await apiFetchCommunities();
                  setCommunities(result.data?.communities || []);
                  setMessage(`Found ${result.data?.communities?.length || 0} clusters`);
                } catch { setMessage("Could not load clusters"); }
              }
              setShowCommunities(!showCommunities);
            }}
          >🧩 Clusters</button>
          <div style={{ position: "relative" }}>
            <button className="toolbar-btn" onClick={() => setShowExportMenu(!showExportMenu)}>
              📤 Xuất
            </button>
            {showExportMenu && (
              <div className="export-menu">
                <div className="export-item" onClick={exportJSON}>📋 JSON (dữ liệu)</div>
                <div className="export-item" onClick={exportPNG}>🖼️ PNG (ảnh)</div>
              </div>
            )}
          </div>
          <div className="toolbar-stats">
            {activeTags.length > 0 ? `${activeVisualNodeCount}/${visualNodeCount}` : visualNodeCount} nodes · {visualLinkCount} links
          </div>
          {(contribStats.pending + contribStats.approved + contribStats.rejected) > 0 && (
            <button className="toolbar-btn contrib-toggle" onClick={() => setShowContribCard(!showContribCard)}>
              📝 {contribStats.pending + contribStats.approved + contribStats.rejected}
            </button>
          )}
        </div>

        {/* Auto-synthesis modal — build a learning path from web search */}
        {showTagPanel && (
          <aside className="graph-filter-panel" aria-label="Graph tag filters">
            <div className="filter-state-card">
              <span className="filter-state-label">States</span>
              <button className="filter-state-select" type="button">
                Default state <span aria-hidden="true">v</span>
              </button>
              <button className="filter-state-add" type="button" aria-label="Add graph state">+</button>
            </div>

            <div className="filter-section-title">
              <span>Tag</span>
              <span aria-hidden="true">v</span>
            </div>

            <div className="filter-mode-toggle" role="group" aria-label="Tag filter mode">
              <button
                type="button"
                className={tagMode === "AND" ? "active" : ""}
                onClick={() => setTagMode("AND")}
              >
                AND
              </button>
              <button
                type="button"
                className={tagMode === "OR" ? "active" : ""}
                onClick={() => setTagMode("OR")}
              >
                OR
              </button>
            </div>

            <button
              type="button"
              className="filter-clear"
              onClick={() => setActiveTags([])}
              aria-label="Clear tag filters"
            >
              x
            </button>

            <div className="filter-tag-list">
              {availableTags.map(({ tag, count, color }) => {
                const active = activeTags.includes(tag);
                return (
                  <button
                    key={tag}
                    type="button"
                    className={`filter-tag ${active ? "active" : ""}`}
                    style={{ "--tag-color": color } as CSSProperties}
                    onClick={() => toggleTag(tag)}
                    title={`${tag} - ${count} nodes`}
                  >
                    <span>{tag}</span>
                    <small>{count}</small>
                  </button>
                );
              })}
            </div>
          </aside>
        )}

        {showSynthModal && (
          <div className="modal-overlay" onClick={() => { if (!synthLoading) setShowSynthModal(false); }}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <h3>🪄 Tạo lộ trình học tự động</h3>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", margin: 0, lineHeight: 1.6 }}>
                Nhập một chủ đề. AI sẽ tìm tài liệu thật trên web và dựng thành lộ trình học
                (các chặng + tài liệu) ngay trong graph của bạn.
              </p>
              <input
                className="panel-input"
                value={synthTopic}
                onChange={(e) => setSynthTopic(e.target.value)}
                placeholder="VD: Prompt Engineering, RAG, Kubernetes…"
                autoFocus
                disabled={synthLoading}
                onKeyDown={(e) => { if (e.key === "Enter") runSynthesis(); }}
              />
              <p style={{ fontSize: 11.5, color: "rgba(255,255,255,0.35)", margin: 0 }}>
                3 lộ trình đầu miễn phí, sau đó ~0.02 credit mỗi lộ trình.
              </p>
              <div className="modal-actions">
                <button className="toolbar-btn" onClick={() => setShowSynthModal(false)} disabled={synthLoading}>
                  Hủy
                </button>
                <button className="toolbar-btn synth" onClick={runSynthesis} disabled={synthLoading || !synthTopic.trim()}>
                  {synthLoading ? "Đang dựng… (10-30s)" : "Tạo lộ trình"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Search bar — API-powered with debounce */}
        {showSearch && (
          <div className="search-bar">
            <span style={{ color: "rgba(255,255,255,0.3)", fontSize: 14 }}>🔍</span>
            <input
              className="search-input"
              value={searchQuery}
              onChange={(e) => {
                const q = e.target.value;
                setSearchQuery(q);
                // Debounced API search (300ms)
                if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
                if (q.trim().length >= 1) {
                  searchTimerRef.current = setTimeout(async () => {
                    try {
                      const result = await apiSearchNodes(q, 10);
                      setSearchResults(result.data?.results || []);
                    } catch { setSearchResults([]); }
                  }, 300);
                } else {
                  setSearchResults([]);
                }
              }}
              placeholder="Tìm node (fuzzy + nội dung)…"
              autoFocus
            />
            <button className="search-close" onClick={() => { setShowSearch(false); setSearchQuery(""); setSearchResults([]); }}>✕</button>
            {searchQuery.length > 0 && (
              <div className="search-results">
                {searchResults.map(hit => (
                  <div key={hit.id} className="search-item" onClick={() => {
                    if (graphRef.current) {
                      graphRef.current.centerAt(hit.x ?? 0, hit.y ?? 0, 600);
                      graphRef.current.zoom(3, 600);
                    }
                    setHoveredNode(hit.id);
                    setShowSearch(false);
                    setSearchQuery("");
                    setSearchResults([]);
                    setTimeout(() => setHoveredNode(null), 3000);
                  }}>
                    <span style={{ color: hit.color, fontSize: 10 }}>●</span>
                    <span style={{ flex: 1 }}>
                      {nodeTypeConfig[hit.nodeType]?.icon} {hit.title}
                      {hit.matchedField !== "title" && (
                        <span style={{ display: "block", fontSize: 10, color: "rgba(255,255,255,0.3)", marginTop: 2 }}>
                          {hit.matchedField === "content" ? "📝" : hit.matchedField === "url" ? "🔗" : "📋"} {hit.matchSnippet.slice(0, 80)}
                        </span>
                      )}
                    </span>
                    <span style={{ fontSize: 9, color: "rgba(255,255,255,0.2)" }}>{hit.score}</span>
                  </div>
                ))}
                {searchResults.length === 0 && searchQuery.length > 0 && (
                  <div className="search-item" style={{ color: "rgba(255,255,255,0.25)" }}>Không tìm thấy</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Contribution stats card */}
        {showContribCard && (
          <div className="contrib-card">
            <div className="contrib-card-header">
              <span>📝 Bài đóng góp</span>
              <button className="panel-close" onClick={() => setShowContribCard(false)}>✕</button>
            </div>
            <div className="contrib-card-body">
              <div className="contrib-stat">
                <span className="contrib-stat-dot pending" />
                <span className="contrib-stat-label">Chờ duyệt</span>
                <span className="contrib-stat-val">{contribStats.pending}</span>
              </div>
              <div className="contrib-stat">
                <span className="contrib-stat-dot approved" />
                <span className="contrib-stat-label">Đã duyệt</span>
                <span className="contrib-stat-val">{contribStats.approved}</span>
              </div>
              <div className="contrib-stat">
                <span className="contrib-stat-dot rejected" />
                <span className="contrib-stat-label">Từ chối</span>
                <span className="contrib-stat-val">{contribStats.rejected}</span>
              </div>
            </div>
            <Link href="/contribute" className="contrib-card-link">Quản lý bài viết →</Link>
          </div>
        )}

        {/* Message toast */}
        {message && (
          <div className="graph-toast" onClick={() => setMessage("")}>
            {message}
          </div>
        )}

        {/* Link mode indicator */}
        {linkMode && (
          <div className="link-mode-banner">
            <span className="link-mode-dot" />
            {linkSource
              ? `Chọn node đích để kết nối…`
              : `Chế độ nối — click node nguồn`
            }
            <button className="link-mode-cancel" onClick={() => { setLinkMode(false); setLinkSource(null); setMessage(""); }}>Hủy</button>
          </div>
        )}

        {/* Graph */}
        {visualNodeCount === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🧠</div>
            <h3 className="empty-title">Graph của bạn đang trống</h3>
            <p className="empty-desc">
              Thêm node đầu tiên — ghi chú, URL, hoặc import tài liệu. Ký ức của AI agent
              cũng tự động xuất hiện ở đây khi agent hoàn thành một phiên làm việc cho bạn.
            </p>
            <button className="btn btn-teal" onClick={() => setShowAddModal(true)}>＋ Thêm Node đầu tiên</button>
            <Link href="/aibase/memory" className="toolbar-btn">🧠 Xem Bộ nhớ Agent</Link>
          </div>
        ) : (
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          nodeCanvasObject={nodeCanvasObject}
          onNodeClick={handleNodeClick}
          onNodeDragEnd={handleNodeDragEnd}
          onNodeHover={(node: GraphNodeRender | null) => setHoveredNode(node?.id ? String(node.id) : null)}
          onNodeRightClick={(node: GraphNodeRender, event: MouseEvent) => {
            event.preventDefault();
            const userNode = nodes.find(n => n.id === String(node.id ?? ""));
            if (userNode) {
              setCtxMenu({ x: event.clientX, y: event.clientY, node: userNode });
            }
          }}
          onBackgroundClick={clearGraphFocus}
          linkColor={(link: GraphLinkRender) => {
            if (link.filteredOut) return "rgba(75,105,118,0.035)";
            if (link.demo && !focusNodeId) return link.color || "rgba(75,105,118,0.2)";
            const mixedColor = link.sourceColor && link.targetColor
              ? mixTagColors(link.sourceColor, link.targetColor, 0.5)
              : "#22dcc2";
            if (!focusNodeId) return link.color || colorWithAlpha(mixedColor, link.crossTag ? 0.42 : 0.32);
            const s = linkEndpointId(link.source);
            const t = linkEndpointId(link.target);
            if (hoveredNeighbors.has(s) && hoveredNeighbors.has(t)) return colorWithAlpha(mixedColor, 0.78);
            return colorWithAlpha(mixedColor, 0.1);
          }}
          linkWidth={(link: GraphLinkRender) => {
            if (link.filteredOut) return 0.22;
            if (link.demo && !focusNodeId) return 0.72;
            if (!focusNodeId) return link.crossTag ? 1.28 : 1.08;
            const s = linkEndpointId(link.source);
            const t = linkEndpointId(link.target);
            if (hoveredNeighbors.has(s) && hoveredNeighbors.has(t)) return link.crossTag ? 2.7 : 2.35;
            return 0.56;
          }}
          linkDirectionalParticles={(link: GraphLinkRender) => {
            if (link.filteredOut) return 0;
            if (!focusNodeId) return 0;
            const s = linkEndpointId(link.source);
            const t = linkEndpointId(link.target);
            return hoveredNeighbors.has(s) && hoveredNeighbors.has(t) ? 1 : 0;
          }}
          linkDirectionalParticleWidth={1.8}
          linkDirectionalParticleColor={() => "rgba(139,108,255,0.86)"}
          onLinkClick={handleLinkClick}
          backgroundColor="rgba(0,0,0,0)"
          width={canvasW}
          height={canvasH}
          cooldownTicks={visualNodeCount > 0 ? 100 : 0}
          d3VelocityDecay={0.3}
          warmupTicks={50}
          minZoom={localhostDemoMode ? 0.88 : 0.62}
          maxZoom={localhostDemoMode ? 2.55 : 3.2}
          onEngineStop={fitGraphToReadableScale}
          onRenderFramePre={(ctx: CanvasRenderingContext2D) => {
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            drawGraphViewCanvasField(ctx, canvasW, canvasH);
            ctx.restore();
          }}
          onRenderFramePost={(ctx: CanvasRenderingContext2D, globalScale: number) => {
            if (!showCommunities || communities.length === 0) return;
            for (const community of communities) {
              // Gather positions of community nodes from the current graph data
              const memberPositions: { x: number; y: number }[] = [];
              for (const gNode of graphData.nodes) {
                if (community.nodeIds.includes(String(gNode.id ?? ""))) {
                  const n = gNode as GraphNodeRender;
                  if (n.x != null && n.y != null) {
                    memberPositions.push({ x: n.x, y: n.y });
                  }
                }
              }
              if (memberPositions.length < 2) continue;

              // Draw convex hull with padding
              const pad = 20 / globalScale;
              const hull = convexHull(memberPositions.map(p => [p.x, p.y]));
              if (hull.length < 2) continue;

              ctx.save();
              ctx.globalAlpha = 0.08;
              ctx.fillStyle = community.color;
              ctx.beginPath();
              const expanded = expandHull(hull, pad);
              ctx.moveTo(expanded[0][0], expanded[0][1]);
              for (let i = 1; i < expanded.length; i++) {
                ctx.lineTo(expanded[i][0], expanded[i][1]);
              }
              ctx.closePath();
              ctx.fill();

              // Draw hull border
              ctx.globalAlpha = 0.3;
              ctx.strokeStyle = community.color;
              ctx.lineWidth = 1.5 / globalScale;
              ctx.setLineDash([4 / globalScale, 4 / globalScale]);
              ctx.stroke();
              ctx.setLineDash([]);

              // Draw label at centroid
              const cx = memberPositions.reduce((s, p) => s + p.x, 0) / memberPositions.length;
              const cy = memberPositions.reduce((s, p) => s + p.y, 0) / memberPositions.length;
              ctx.globalAlpha = 0.5;
              ctx.fillStyle = community.color;
              ctx.font = `${10 / globalScale}px Inter, sans-serif`;
              ctx.textAlign = "center";
              ctx.fillText(community.label, cx, cy - 12 / globalScale);
              ctx.restore();
            }
          }}
        />
        )}

        {/* ═══ LINK PANEL ═══ */}
        {selectedLink && (
          <div className="link-panel">
            <span className="link-panel-label">
              {nodes.find(n => n.id === selectedLink.sourceId)?.title?.slice(0, 15)}
              {" → "}
              {nodes.find(n => n.id === selectedLink.targetId)?.title?.slice(0, 15)}
            </span>
            <input
              className="link-panel-input"
              value={editLinkLabel}
              onChange={(e) => setEditLinkLabel(e.target.value)}
              placeholder="Nhãn link…"
            />
            <button className="link-panel-btn" onClick={updateLinkLabel}>Lưu</button>
            <button className="link-panel-btn danger" onClick={deleteLink}>Xóa</button>
            <button className="link-panel-btn" onClick={() => setSelectedLink(null)}>✕</button>
          </div>
        )}

        {/* ═══ CONTEXT MENU ═══ */}
        {ctxMenu && (
          <div className="ctx-menu" style={{ top: ctxMenu.y, left: ctxMenu.x }}>
            <div className="ctx-item" onClick={() => {
              setSelectedNode(ctxMenu.node);
              setEditTitle(ctxMenu.node.title);
              setEditContent(ctxMenu.node.content || "");
              setEditColor(ctxMenu.node.color);
              setCtxMenu(null);
            }}>✏️ Chỉnh sửa</div>
            <div className="ctx-item" onClick={() => {
              setLinkMode(true);
              setLinkSource(ctxMenu.node.id);
              setMessage(`Chọn node đích để kết nối từ "${ctxMenu.node.title}"`);
              setCtxMenu(null);
            }}>🔗 Kết nối từ đây</div>
            {ctxMenu.node.url && (
              <div className="ctx-item" onClick={() => {
                window.open(ctxMenu.node.url!, "_blank");
                setCtxMenu(null);
              }}>🌐 Mở URL</div>
            )}
            <div className="ctx-item danger" onClick={async () => {
              const n = ctxMenu.node;
              setCtxMenu(null);
              try {
                await apiRemoveNode(n.id);
                await loadGraph();
                setMessage(`Đã xóa "${n.title}"`);
              } catch { setMessage("Lỗi xóa node"); }
            }}>🗑️ Xóa node</div>
          </div>
        )}

        {selectedNode && (
          <div className="node-panel">
            <div className="node-panel-header">
              <span>{nodeTypeConfig[selectedNode.nodeType]?.icon} {nodeTypeConfig[selectedNode.nodeType]?.label}</span>
              <button className="panel-close" onClick={() => setSelectedNode(null)}>✕</button>
            </div>
            <input
              className="panel-input"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Tiêu đề"
            />
            {selectedNode.url && (
              <a href={selectedNode.url} target="_blank" rel="noopener noreferrer" className="panel-url">
                🔗 {selectedNode.url}
              </a>
            )}
            <textarea
              className="panel-textarea"
              value={editContent}
              onChange={(e) => setEditContent(e.target.value)}
              placeholder="Nội dung / ghi chú…"
              rows={4}
            />
            <div className="panel-color-row">
              <span>Màu:</span>
              <input type="color" value={editColor} onChange={(e) => setEditColor(e.target.value)} />
            </div>
            {/* Connected count + timestamps */}
            <div className="panel-stats">
              <span>🔗 {links.filter(l => l.sourceId === selectedNode.id || l.targetId === selectedNode.id).length} kết nối</span>
              <span>📅 {new Date(selectedNode.createdAt).toLocaleDateString("vi-VN")}</span>
            </div>
            {/* Metadata display */}
            {selectedNode.metadata && (() => {
              try {
                const meta = JSON.parse(selectedNode.metadata);
                return (
                  <div className="panel-meta">
                    {meta.stars !== undefined && <span>⭐ {meta.stars}</span>}
                    {meta.language && <span>💻 {meta.language}</span>}
                    {meta.forks !== undefined && <span>🍴 {meta.forks}</span>}
                    {meta.siteName && <span>🌐 {meta.siteName}</span>}
                  </div>
                );
              } catch { return null; }
            })()}
            <div className="panel-actions">
              <button className="btn btn-teal btn-small" onClick={updateNode}>Lưu</button>
              <button className="btn btn-red btn-small" onClick={deleteNode}>Xóa</button>
            </div>
          </div>
        )}

        {/* ═══ ENHANCED IMPORT MODAL ═══ */}
        {showAddModal && (
          <div className="modal-overlay" onClick={() => { setShowAddModal(false); resetAddForm(); }}>
            <div className="modal-content modal-lg" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h3>{showPreview ? "📋 Preview — Xác nhận nodes" : "📥 Thêm vào Graph"}</h3>
                <button className="panel-close" onClick={() => { setShowAddModal(false); resetAddForm(); }}>✕</button>
              </div>

              {/* ──── PREVIEW STEP ──── */}
              {showPreview ? (
                <div className="preview-container">
                  <div className="preview-summary">
                    <span>✅ {previewNodes.filter(n => n.selected).length} / {previewNodes.length} nodes được chọn</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn btn-small" onClick={() => setPreviewNodes(p => p.map(n => ({ ...n, selected: true })))}>Chọn tất cả</button>
                      <button className="btn btn-small" onClick={() => setPreviewNodes(p => p.map(n => ({ ...n, selected: false })))}>Bỏ chọn</button>
                    </div>
                  </div>
                  <div className="preview-list">
                    {previewNodes.map((n, i) => (
                      <div key={i} className={`preview-node ${n.selected ? "selected" : "dimmed"}`} onClick={() => togglePreviewNode(i)}>
                        <span className="preview-check">{n.selected ? "☑" : "☐"}</span>
                        <span className="preview-dot" style={{ background: n.color }} />
                        <div className="preview-info">
                          <span className="preview-title">{n.title.slice(0, 60)}</span>
                          {n.content && <span className="preview-desc">{n.content.slice(0, 80)}…</span>}
                        </div>
                        <span className="preview-type">{nodeTypeConfig[n.nodeType]?.icon || "📄"}</span>
                      </div>
                    ))}
                  </div>
                  <div className="preview-links-info">
                    🔗 {previewLinks.length} liên kết sẽ được tạo tự động
                  </div>
                  <div className="modal-actions">
                    <button className="btn" onClick={() => { setShowPreview(false); setPreviewNodes([]); setPreviewLinks([]); }}>← Quay lại</button>
                    <button className="btn btn-teal" onClick={confirmBulkAdd} disabled={extracting || previewNodes.filter(n => n.selected).length === 0}>
                      {extracting ? "Đang thêm…" : `Thêm ${previewNodes.filter(n => n.selected).length} nodes`}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* ──── TAB SELECTOR ──── */}
                  <div className="import-tabs">
                    <button className={`import-tab ${importTab === "url" ? "active" : ""}`} onClick={() => setImportTab("url")}>🌐 URL</button>
                    <button className={`import-tab ${importTab === "pdf" ? "active" : ""}`} onClick={() => setImportTab("pdf")}>📄 PDF</button>
                    <button className={`import-tab ${importTab === "paste" ? "active" : ""}`} onClick={() => setImportTab("paste")}>📋 Dán text</button>
                  </div>

                  {/* ──── URL TAB ──── */}
                  {importTab === "url" && (
                    <div className="import-tab-body">
                      <p className="import-hint">Dán URL bài viết, GitHub repo, hoặc trang web — hệ thống tự trích xuất nội dung thành graph nodes.</p>
                      <div className="modal-import">
                        <input
                          className="panel-input"
                          value={newUrl}
                          onChange={(e) => setNewUrl(e.target.value)}
                          placeholder="https://example.com/article..."
                        />
                        <button className="btn btn-small btn-teal" onClick={extractFromUrl} disabled={extracting || !newUrl.trim()}>
                          {extracting ? "⏳ Đang trích…" : "🔍 Trích xuất"}
                        </button>
                      </div>
                      <div className="import-or">
                        <button className="btn btn-small" onClick={importUrl} disabled={importing || !newUrl.trim()}>
                          {importing ? "Đang tải…" : "➕ Thêm nhanh 1 node (auto-fetch)"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ──── PDF TAB ──── */}
                  {importTab === "pdf" && (
                    <div className="import-tab-body">
                      <p className="import-hint">Upload PDF (tối đa 10MB) — tự động phân tách thành nodes theo heading/section.</p>
                      <label className="pdf-upload">
                        <input
                          type="file"
                          accept=".pdf"
                          style={{ display: "none" }}
                          onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                        />
                        <span className="pdf-upload-text">
                          {pdfFile ? `📎 ${pdfFile.name} (${(pdfFile.size / 1024).toFixed(0)}KB)` : "📁 Chọn file PDF…"}
                        </span>
                      </label>
                      {pdfFile && (
                        <button className="btn btn-teal" onClick={extractFromPdf} disabled={extracting}>
                          {extracting ? "⏳ Đang trích xuất…" : "🔍 Trích xuất PDF"}
                        </button>
                      )}
                    </div>
                  )}

                  {/* ──── PASTE TAB ──── */}
                  {importTab === "paste" && (
                    <div className="import-tab-body">
                      <p className="import-hint">Dán nội dung văn bản (markdown, text) — tự động phân tách theo heading.</p>
                      <textarea
                        className="panel-textarea"
                        value={pasteText}
                        onChange={(e) => setPasteText(e.target.value)}
                        placeholder="Dán nội dung tài liệu tại đây…"
                        rows={6}
                        style={{ minHeight: 120 }}
                      />
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "rgba(255,255,255,0.3)" }}>{pasteText.length} ký tự</span>
                        <button className="btn btn-teal btn-small" onClick={extractFromPaste} disabled={extracting || pasteText.length < 50}>
                          {extracting ? "⏳ Đang trích…" : "🔍 Trích xuất"}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="modal-divider">hoặc tạo thủ công</div>

                  {/* ──── MANUAL CREATE ──── */}
                  <select className="panel-input" value={newType} onChange={(e) => setNewType(e.target.value)}>
                    {Object.entries(nodeTypeConfig).map(([key, val]) => (
                      <option key={key} value={key}>{val.icon} {val.label}</option>
                    ))}
                  </select>
                  <input
                    className="panel-input"
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    placeholder="Tiêu đề"
                  />
                  <textarea
                    className="panel-textarea"
                    value={newContent}
                    onChange={(e) => setNewContent(e.target.value)}
                    placeholder="Nội dung / mô tả…"
                    rows={3}
                  />
                  <select className="panel-input" value={newTopicId} onChange={(e) => setNewTopicId(e.target.value)}>
                    <option value="">— Liên kết Topic (tùy chọn) —</option>
                    {graphTopics.map(t => <option key={t.id} value={t.id}>{t.title}</option>)}
                  </select>
                  <div className="panel-color-row">
                    <span>Màu:</span>
                    <input type="color" value={newColor} onChange={(e) => setNewColor(e.target.value)} />
                  </div>
                  <div className="modal-actions">
                    <button className="btn" onClick={() => { setShowAddModal(false); resetAddForm(); }}>Hủy</button>
                    <button className="btn btn-red" onClick={createNode} disabled={!newTitle.trim()}>
                      Thêm Node
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Zoom controls */}
        <div className="zoom-controls">
          <button className="zoom-btn" onClick={() => graphRef.current?.zoom(graphRef.current.zoom() * 1.4, 300)}>+</button>
          <button className="zoom-btn" onClick={() => graphRef.current?.zoom(graphRef.current.zoom() / 1.4, 300)}>−</button>
          <button className="zoom-btn" onClick={() => graphRef.current?.zoomToFit(400, 60)} title="Fit to screen">⊡</button>
        </div>

        {/* Community legend */}
        {showCommunities && communities.length > 0 && (
          <div style={{
            position: "fixed", bottom: 80, left: 20, zIndex: 100,
            background: "rgba(10,12,20,0.9)", backdropFilter: "blur(16px)",
            border: "1px solid rgba(92,167,255,0.12)", borderRadius: 12,
            padding: "12px 16px", display: "flex", flexDirection: "column", gap: 6,
            maxHeight: 200, overflowY: "auto",
          }}>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", fontWeight: 600, marginBottom: 2 }}>
              🧩 {communities.length} Clusters
            </span>
            {communities.map(c => (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: c.color, flexShrink: 0 }} />
                <span style={{ color: "rgba(255,255,255,0.6)", flex: 1 }}>{c.label}</span>
                <span style={{ color: "rgba(255,255,255,0.25)" }}>{c.size}</span>
              </div>
            ))}
          </div>
        )}

        {/* Keyboard hint */}
        <div className="kbd-hint">
          <span><span className="kbd">Ctrl+N</span> Thêm node</span>
          <span><span className="kbd">Ctrl+F</span> Tìm kiếm</span>
          <span><span className="kbd">Del</span> Xóa node</span>
          <span><span className="kbd">Esc</span> Đóng panel</span>
        </div>
      </div>


    </section>
  );
}
