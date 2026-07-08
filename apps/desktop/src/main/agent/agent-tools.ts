/**
 * Host-level agent tools — give an agent (running through the local codex-lb
 * router) the ability to actually DO things on the user's machine: run shell
 * commands, read/write files, and list directories. These are the same class of
 * capabilities a Codex/OpenClaw session has.
 *
 * Security (security-baseline B/C): these tools execute on the HOST. They are
 * only reachable when the user opts into an Agent permission mode, and RISKY
 * tools (run_command, write_file) are gated by an explicit approval prompt unless
 * the user chose full access. Command output is capped; nothing here logs secrets.
 *
 * The pure helpers (schemas, risk classification, call summaries) are unit-tested;
 * executeHostTool performs the actual IO.
 *
 * @module main/agent/agent-tools
 */
import { exec } from 'child_process';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

export interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export type ToolRisk = 'safe' | 'risky';

/** The tool names this module implements. */
export const HOST_TOOL_NAMES = ['run_command', 'read_file', 'write_file', 'list_dir'] as const;
export type HostToolName = (typeof HOST_TOOL_NAMES)[number];

/** OpenAI function-tool schemas advertised to the model. */
export const HOST_TOOLS: OpenAiTool[] = [
  {
    type: 'function',
    function: {
      name: 'run_command',
      description:
        "Run a shell command on the user's machine and return its stdout, stderr and exit code. " +
        'Use for builds, tests, git, running scripts, installing dependencies, inspecting the system, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to run.' },
          cwd: { type: 'string', description: 'Absolute working directory (optional; defaults to the user home).' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: "Read a UTF-8 text file from the user's machine and return its contents.",
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute file path.' } },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: "Create or overwrite a UTF-8 text file on the user's machine.",
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Absolute file path.' },
          content: { type: 'string', description: 'Full file content to write.' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_dir',
      description: "List the entries (files and folders) of a directory on the user's machine.",
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: 'Absolute directory path.' } },
        required: ['path'],
      },
    },
  },
];

/** Read-only tools are 'safe'; anything that mutates the machine or runs code is 'risky'. */
export function classifyToolRisk(name: string): ToolRisk {
  return name === 'read_file' || name === 'list_dir' ? 'safe' : 'risky';
}

/** A short, human-readable one-line summary of a tool call (for approval prompts + step labels). */
export function summarizeToolCall(name: string, args: Record<string, unknown> | null | undefined): string {
  const a = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  if (name === 'run_command') {
    const cwd = typeof a.cwd === 'string' && a.cwd ? `  (cwd: ${a.cwd})` : '';
    return `$ ${typeof a.command === 'string' ? a.command : ''}${cwd}`;
  }
  if (name === 'read_file') return `Đọc file: ${typeof a.path === 'string' ? a.path : ''}`;
  if (name === 'write_file') {
    const len = typeof a.content === 'string' ? a.content.length : 0;
    return `Ghi file: ${typeof a.path === 'string' ? a.path : ''} (${len} ký tự)`;
  }
  if (name === 'list_dir') return `Liệt kê thư mục: ${typeof a.path === 'string' ? a.path : ''}`;
  return name;
}

const MAX_OUTPUT = 12000;
const CMD_TIMEOUT_MS = 120000;
const MAX_BUFFER = 10 * 1024 * 1024;

/** Options controlling where host tools operate (the agent's working directory). */
export interface HostToolOptions {
  /** Absolute working directory: default cwd for commands + base for relative file paths. */
  workingDir?: string;
}

/**
 * Resolve a tool-supplied path to an absolute path. Absolute paths are used as-is;
 * relative paths resolve against the working directory (or the user home when none
 * is set). Pure + unit-tested so relative-path handling is predictable.
 */
export function resolveToolPath(p: string, workingDir?: string): string {
  if (!p) return p;
  if (path.isAbsolute(p)) return p;
  const base = workingDir && workingDir.trim() ? workingDir : os.homedir();
  return path.resolve(base, p);
}

/**
 * Execute a host tool call and return a string result to feed back to the model.
 * Never throws — errors are returned as an `error: ...` string so the loop
 * continues and the model can react.
 */
export async function executeHostTool(
  name: string,
  args: Record<string, unknown> | null | undefined,
  opts?: HostToolOptions,
): Promise<string> {
  const a = args && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  const workingDir = opts?.workingDir && opts.workingDir.trim() ? opts.workingDir : '';
  try {
    if (name === 'run_command') {
      const command = typeof a.command === 'string' ? a.command.trim() : '';
      if (!command) return 'error: empty command';
      const cwd =
        typeof a.cwd === 'string' && a.cwd.trim() ? a.cwd.trim() : workingDir || os.homedir();
      return await new Promise<string>((resolve) => {
        exec(
          command,
          { cwd, timeout: CMD_TIMEOUT_MS, windowsHide: true, maxBuffer: MAX_BUFFER },
          (err, stdout, stderr) => {
            const exitCode = err && typeof (err as { code?: unknown }).code === 'number' ? (err as { code: number }).code : err ? 1 : 0;
            resolve(
              JSON.stringify({
                exitCode,
                stdout: (stdout || '').slice(0, MAX_OUTPUT),
                stderr: (stderr || '').slice(0, MAX_OUTPUT),
              }),
            );
          },
        );
      });
    }
    if (name === 'read_file') {
      const p = resolveToolPath(typeof a.path === 'string' ? a.path : '', workingDir);
      if (!p) return 'error: missing path';
      const data = await fs.readFile(p, 'utf8');
      return data.length > MAX_OUTPUT ? data.slice(0, MAX_OUTPUT) + '\n…(truncated)' : data;
    }
    if (name === 'write_file') {
      const p = resolveToolPath(typeof a.path === 'string' ? a.path : '', workingDir);
      const content = typeof a.content === 'string' ? a.content : '';
      if (!p) return 'error: missing path';
      await fs.mkdir(path.dirname(p), { recursive: true });
      await fs.writeFile(p, content, 'utf8');
      return `ok: wrote ${content.length} chars to ${p}`;
    }
    if (name === 'list_dir') {
      const p = resolveToolPath(typeof a.path === 'string' ? a.path : '', workingDir);
      if (!p) return 'error: missing path';
      const entries = await fs.readdir(p, { withFileTypes: true });
      return (
        entries
          .slice(0, 300)
          .map((e) => (e.isDirectory() ? '[DIR]  ' : '[FILE] ') + e.name)
          .join('\n') || '(empty directory)'
      );
    }
    return `error: unknown tool "${name}"`;
  } catch (err) {
    return `error: ${(err as Error).message}`;
  }
}
