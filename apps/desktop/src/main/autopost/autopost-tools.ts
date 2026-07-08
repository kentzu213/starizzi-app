/**
 * Auto-Post agent tools (autopost-unification, Phase 2).
 *
 * Exposes the Auto-Post Tool's capabilities to the Starizzi agent as OpenAI
 * function tools, executed via the REST `AutopostClient`. Mirrors the shape of
 * `agent-tools.ts` (schemas + risk classification + executor) so the host-agent
 * loop can treat them uniformly.
 *
 * Risk (drives the approval gate): read/draft = safe; scheduling (which publishes
 * at the set time) = risky → requires user approval in Agent mode.
 *
 * @module main/autopost/autopost-tools
 */
import type { OpenAiTool, ToolRisk } from '../agent/agent-tools';
import type { AutopostClient } from './autopost-client';

export const AUTOPOST_TOOL_NAMES = [
  'autopost_list_accounts',
  'autopost_list_posts',
  'autopost_create_draft',
  'autopost_schedule_post',
] as const;

export const AUTOPOST_TOOLS: OpenAiTool[] = [
  {
    type: 'function',
    function: {
      name: 'autopost_list_accounts',
      description:
        'List the social media accounts (Facebook/YouTube/TikTok) connected in the Auto-Post workspace. Use to find an account id before scheduling.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'autopost_list_posts',
      description:
        'List posts in the Auto-Post workspace, optionally filtered by status (draft, scheduled, published, failed).',
      parameters: {
        type: 'object',
        properties: { status: { type: 'string', description: 'draft | scheduled | published | failed' } },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'autopost_create_draft',
      description:
        'Create a DRAFT social post (caption/content + optional title) in the Auto-Post workspace. It stays a DRAFT for the user to review, schedule and publish — it is NOT published by this tool.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The post caption/content.' },
          title: { type: 'string', description: 'Optional title (for YouTube/TikTok).' },
        },
        required: ['content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'autopost_schedule_post',
      description:
        'Schedule an EXISTING draft post to publish at a future time, optionally to specific connected accounts. This WILL publish at that time.',
      parameters: {
        type: 'object',
        properties: {
          postId: { type: 'string', description: 'Id of an existing draft post.' },
          scheduledAt: { type: 'string', description: 'ISO 8601 future datetime.' },
          socialAccountIds: { type: 'array', items: { type: 'string' }, description: 'Account ids to publish to.' },
        },
        required: ['postId', 'scheduledAt'],
      },
    },
  },
];

/** Scheduling publishes → risky; listing + drafting are safe. */
export function classifyAutopostRisk(name: string): ToolRisk {
  return name === 'autopost_schedule_post' ? 'risky' : 'safe';
}

export function isAutopostTool(name: string): boolean {
  return name.startsWith('autopost_');
}

const MAX_OUTPUT = 8000;

/** Execute an Auto-Post agent tool. Never throws — returns a string result/error. */
export async function executeAutopostTool(
  client: AutopostClient,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const clip = (s: string) => (s.length > MAX_OUTPUT ? s.slice(0, MAX_OUTPUT) + '…(truncated)' : s);
  const done = (r: { ok: boolean; error?: string; data?: unknown }): string =>
    r.ok ? clip(JSON.stringify(r.data ?? { ok: true })) : `error: ${r.error || 'unknown'}`;
  try {
    if (name === 'autopost_list_accounts') return done(await client.listAccounts());
    if (name === 'autopost_list_posts') {
      const status = typeof args.status === 'string' ? args.status : undefined;
      return done(await client.listPosts(status));
    }
    if (name === 'autopost_create_draft') {
      const content = typeof args.content === 'string' ? args.content.trim() : '';
      if (!content) return 'error: missing content';
      const title = typeof args.title === 'string' ? args.title : undefined;
      return done(await client.createDraft({ content, title }));
    }
    if (name === 'autopost_schedule_post') {
      const postId = typeof args.postId === 'string' ? args.postId : '';
      const scheduledAt = typeof args.scheduledAt === 'string' ? args.scheduledAt : '';
      if (!postId || !scheduledAt) return 'error: postId and scheduledAt are required';
      const socialAccountIds = Array.isArray(args.socialAccountIds)
        ? (args.socialAccountIds.filter((x) => typeof x === 'string') as string[])
        : undefined;
      return done(await client.schedulePost({ postId, scheduledAt, socialAccountIds }));
    }
    return `error: unknown autopost tool "${name}"`;
  } catch (err) {
    return `error: ${(err as Error).message}`;
  }
}
