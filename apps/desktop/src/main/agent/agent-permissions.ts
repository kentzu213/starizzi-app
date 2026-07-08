/**
 * Agent permission mode — the Codex-style control over what an agent may do.
 *
 *  - 'chat'       : no tools. Plain chat (reads images, answers). The safe default;
 *                   preserves the pre-agent behavior for existing users.
 *  - 'agent'      : tools ON. Safe tools (read/list) run automatically; RISKY tools
 *                   (run_command, write_file) require an explicit approval prompt.
 *                   Mirrors Codex "Approve for me".
 *  - 'agent-full' : tools ON, everything runs automatically. Mirrors Codex
 *                   "Full access". Explicit opt-in only.
 *
 * Security (security-baseline B): default is fail-safe ('chat', no host access).
 * The powerful modes are an explicit user choice, and 'agent' still gates every
 * risky action behind approval.
 *
 * @module main/agent/agent-permissions
 */
import type { DatabaseManager } from '../db/database';
import type { ToolRisk } from './agent-tools';

export type PermissionMode = 'chat' | 'agent' | 'agent-full';

export const PERMISSION_MODES: readonly PermissionMode[] = ['chat', 'agent', 'agent-full'];

const MODE_KEY = 'agent_permission_mode';
const WORKING_DIR_KEY = 'agent_working_dir';

export function isPermissionMode(v: unknown): v is PermissionMode {
  return v === 'chat' || v === 'agent' || v === 'agent-full';
}

/** True when tools should be advertised to the model (i.e. any agent mode). */
export function toolsEnabled(mode: PermissionMode): boolean {
  return mode === 'agent' || mode === 'agent-full';
}

/**
 * Whether a tool call of the given risk needs an explicit user approval before it
 * runs. 'agent-full' never asks; 'agent' asks only for risky actions; 'chat' has
 * no tools but conservatively requires approval if ever reached.
 */
export function needsApproval(mode: PermissionMode, risk: ToolRisk): boolean {
  if (mode === 'agent-full') return false;
  if (mode === 'agent') return risk === 'risky';
  return true; // 'chat' — should not run tools; fail closed.
}

/** Persisted permission-mode store, backed by the settings table. */
export class AgentPermissionStore {
  constructor(private readonly db: DatabaseManager) {}

  getMode(): PermissionMode {
    const raw = this.db.getSetting(MODE_KEY);
    return isPermissionMode(raw) ? raw : 'chat';
  }

  setMode(mode: PermissionMode): void {
    if (!isPermissionMode(mode)) return;
    this.db.setSetting(MODE_KEY, mode);
  }

  /** The agent's working directory (default cwd + base for relative paths). '' = user home. */
  getWorkingDir(): string {
    const raw = this.db.getSetting(WORKING_DIR_KEY);
    return typeof raw === 'string' ? raw : '';
  }

  setWorkingDir(dir: string): void {
    this.db.setSetting(WORKING_DIR_KEY, typeof dir === 'string' ? dir : '');
  }
}
