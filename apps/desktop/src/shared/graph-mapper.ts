/**
 * Graph & Memory mappers — PURE functions translating between Backend_Chia_Sẻ
 * JSON and the shared models / write payloads.
 *
 * Every read uses own-property checks (`Object.hasOwn`) + `typeof` guards and
 * NEVER follows the prototype chain (security-baseline C; mirrors the existing
 * `normalizeMemoryItems`). Untrusted keys are data, not selectors.
 *
 * Rules: no side effects, never throw, never fabricate data. Malformed input
 * maps to `null` (read) or is dropped from the payload (write).
 *
 * @module shared/graph-mapper
 * @see Requirements 1.2, 1.3, 1.6, 2.1, 2.3, 8.2, 9.3
 */

import type {
  GraphNode,
  GraphLink,
  NodeCreatePayload,
  NodePatchPayload,
  MemoryItemDTO,
} from './graph-types';

/** Narrow unknown to a plain object (not null, not array). */
function asObject(raw: unknown): Record<string, unknown> | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  return raw as Record<string, unknown>;
}

/** Read an own-property string, or undefined if absent / wrong type. */
function ownString(obj: Record<string, unknown>, key: string): string | undefined {
  if (!Object.hasOwn(obj, key)) return undefined;
  const value = obj[key];
  return typeof value === 'string' ? value : undefined;
}

/** Read an own-property finite number, or undefined if absent / wrong type. */
function ownNumber(obj: Record<string, unknown>, key: string): number | undefined {
  if (!Object.hasOwn(obj, key)) return undefined;
  const value = obj[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Read an own-property plain object, or undefined if absent / wrong type. */
function ownRecord(obj: Record<string, unknown>, key: string): Record<string, unknown> | undefined {
  if (!Object.hasOwn(obj, key)) return undefined;
  const value = obj[key];
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/**
 * Backend node JSON (unknown) → GraphNode | null.
 * Returns null if `id` or `title` is missing / not a string (Req 1.2, 1.3, 1.6).
 */
export function userNodeToModel(raw: unknown): GraphNode | null {
  const obj = asObject(raw);
  if (obj === null) return null;

  const id = ownString(obj, 'id');
  const title = ownString(obj, 'title');
  if (id === undefined || title === undefined) return null;

  const node: GraphNode = {
    id,
    title,
    nodeType: ownString(obj, 'nodeType') ?? '',
    color: ownString(obj, 'color') ?? '',
    createdAt: ownString(obj, 'createdAt') ?? '',
    updatedAt: ownString(obj, 'updatedAt') ?? '',
  };

  const content = ownString(obj, 'content');
  if (content !== undefined) node.content = content;
  const url = ownString(obj, 'url');
  if (url !== undefined) node.url = url;
  const parentId = ownString(obj, 'parentId');
  if (parentId !== undefined) node.parentId = parentId;
  const topicId = ownString(obj, 'topicId');
  if (topicId !== undefined) node.topicId = topicId;
  const x = ownNumber(obj, 'x');
  if (x !== undefined) node.x = x;
  const y = ownNumber(obj, 'y');
  if (y !== undefined) node.y = y;
  const metadata = ownRecord(obj, 'metadata');
  if (metadata !== undefined) node.metadata = metadata;

  return node;
}

/**
 * Backend link JSON (unknown) → GraphLink | null.
 * Returns null if `id`, `sourceId`, or `targetId` is missing / not a string.
 */
export function userLinkToModel(raw: unknown): GraphLink | null {
  const obj = asObject(raw);
  if (obj === null) return null;

  const id = ownString(obj, 'id');
  const sourceId = ownString(obj, 'sourceId');
  const targetId = ownString(obj, 'targetId');
  if (id === undefined || sourceId === undefined || targetId === undefined) return null;

  const link: GraphLink = { id, sourceId, targetId };

  const label = ownString(obj, 'label');
  if (label !== undefined) link.label = label;
  const color = ownString(obj, 'color');
  if (color !== undefined) link.color = color;

  return link;
}

/**
 * GraphNode (or create input) → POST body. Copies only create-whitelist keys,
 * drops `undefined`, and never includes server-owned fields
 * (id/createdAt/updatedAt/parentId) (Req 2.1).
 */
export function modelToCreatePayload(
  model: Partial<GraphNode> & { title: string },
): NodeCreatePayload {
  const payload: NodeCreatePayload = { title: model.title };

  if (model.nodeType !== undefined) payload.nodeType = model.nodeType;
  if (model.color !== undefined) payload.color = model.color;
  if (model.content !== undefined) payload.content = model.content;
  if (model.url !== undefined) payload.url = model.url;
  if (model.topicId !== undefined) payload.topicId = model.topicId;
  if (model.x !== undefined) payload.x = model.x;
  if (model.y !== undefined) payload.y = model.y;
  if (model.metadata !== undefined) payload.metadata = model.metadata;

  return payload;
}

/**
 * GraphNode (partial) → PATCH body. Copies only patch-whitelist keys and drops
 * `undefined`; server-owned fields are never included (Req 2.3).
 */
export function modelToPatchPayload(
  model: Partial<GraphNode> & { isPublic?: boolean },
): NodePatchPayload {
  const payload: NodePatchPayload = {};

  if (model.title !== undefined) payload.title = model.title;
  if (model.nodeType !== undefined) payload.nodeType = model.nodeType;
  if (model.color !== undefined) payload.color = model.color;
  if (model.content !== undefined) payload.content = model.content;
  if (model.url !== undefined) payload.url = model.url;
  if (model.x !== undefined) payload.x = model.x;
  if (model.y !== undefined) payload.y = model.y;
  if (model.topicId !== undefined) payload.topicId = model.topicId;
  if (model.isPublic !== undefined) payload.isPublic = model.isPublic;
  if (model.metadata !== undefined) payload.metadata = model.metadata;

  return payload;
}

/**
 * Memory node JSON (unknown) → MemoryItemDTO | null.
 * `source` is taken from `nodeType`. Returns null if any required field
 * (id/title/nodeType/createdAt) is missing / not a string (Req 8.2).
 */
export function memoryNodeToItem(raw: unknown): MemoryItemDTO | null {
  const obj = asObject(raw);
  if (obj === null) return null;

  const id = ownString(obj, 'id');
  const title = ownString(obj, 'title');
  const source = ownString(obj, 'nodeType');
  const createdAt = ownString(obj, 'createdAt');
  if (id === undefined || title === undefined || source === undefined || createdAt === undefined) {
    return null;
  }

  return { id, title, source, createdAt };
}
