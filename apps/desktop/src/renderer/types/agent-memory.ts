/**
 * Agent Memory Types — read-only memory items for the Context/Memory panel.
 *
 * This module models the READ side of "second brain" agent memory. Items displayed
 * are title + source only (no secrets/PII — Req 10.3). Every displayed item MUST
 * have a `source` (no-orphan read — Req 10.4).
 *
 * Pure module: no side effects, no network calls, no writes.
 *
 * @module types/agent-memory
 * @see Requirements 10.3, 10.4
 */

/**
 * A single memory item safe for display. Contains only non-sensitive metadata.
 *
 * Validates: Req 10.3 (no secret/PII — title and source are non-sensitive display data)
 * Validates: Req 10.4 (source is required — no-orphan read)
 */
export interface MemoryItem {
  id: string;
  title: string;
  source: string;
  createdAt: string;
}

/**
 * Normalize raw memory data into validated MemoryItem[].
 *
 * Uses own-property checks (Object.hasOwn) to prevent prototype pollution.
 * Filters out any item missing a valid `source` field (no-orphan read — Req 10.4).
 * Only items where all four fields (id, title, source, createdAt) are own-property
 * strings pass through.
 *
 * Pure function: no side effects, does not mutate input, does not fabricate data.
 *
 * @param raw - Untrusted array of unknown items (e.g. from electronAPI or network)
 * @returns Validated MemoryItem[] — only items with all required string fields
 *
 * Validates: Req 10.3, 10.4
 */
export function normalizeMemoryItems(raw: unknown[]): MemoryItem[] {
  const result: MemoryItem[] = [];

  for (const item of raw) {
    // Must be a non-null object (not array, not primitive)
    if (item === null || typeof item !== 'object' || Array.isArray(item)) {
      continue;
    }

    // Own-property checks — do NOT follow prototype chain (security-baseline C)
    const obj = item as Record<string, unknown>;

    if (!Object.hasOwn(obj, 'id') || typeof obj.id !== 'string') continue;
    if (!Object.hasOwn(obj, 'title') || typeof obj.title !== 'string') continue;
    if (!Object.hasOwn(obj, 'source') || typeof obj.source !== 'string') continue;
    if (!Object.hasOwn(obj, 'createdAt') || typeof obj.createdAt !== 'string') continue;

    // No-orphan read: source must be non-empty (Req 10.4)
    if (obj.source.length === 0) continue;

    result.push({
      id: obj.id,
      title: obj.title,
      source: obj.source,
      createdAt: obj.createdAt,
    });
  }

  return result;
}
