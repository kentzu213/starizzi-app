/**
 * Extension → Agent tool bridge.
 *
 * Turns installed+running extension commands (contributes.commands) into
 * OpenAI-style function tools so an in-process izzi agent can invoke them, and
 * routes a tool call back to the extension host's executeCommand.
 *
 * Security (security-baseline B): only RUNNING extensions the user installed are
 * exposed; the agent invokes a command exactly as the user would (the extension's
 * own granted permissions still gate what it can do). Tool exposure is opt-in per
 * chat (see IzziAgent). No secrets cross this layer.
 *
 * @module main/agents/extension-tools
 */

/** Minimal surface of ExtensionLoader this bridge needs (keeps it testable/decoupled). */
export interface ExtensionToolHost {
  getAllExtensions(): Array<{
    id: string;
    state: string;
    manifest: { displayName?: string; contributes?: { commands?: Array<{ id: string; title?: string }> } };
  }>;
  executeCommand(extensionId: string, commandId: string, ...args: unknown[]): Promise<unknown>;
}

export interface OpenAiTool {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ExtensionToolIndex {
  tools: OpenAiTool[];
  /** toolName → { extensionId, commandId } */
  map: Map<string, { extensionId: string; commandId: string }>;
}

/** OpenAI tool names allow [a-zA-Z0-9_-]{1,64}; command ids use dots → encode them. */
export function toToolName(commandId: string): string {
  return commandId.replace(/[^a-zA-Z0-9_-]/g, '__').slice(0, 64);
}

/**
 * Build tool defs for every command of every RUNNING extension.
 * Command args are a single freeform `params` object, so the schema is a
 * permissive object; the extension validates its own params.
 */
export function buildExtensionTools(host: ExtensionToolHost): ExtensionToolIndex {
  const tools: OpenAiTool[] = [];
  const map = new Map<string, { extensionId: string; commandId: string }>();

  for (const ext of host.getAllExtensions()) {
    if (ext.state !== 'running') continue; // only activated extensions
    const commands = ext.manifest?.contributes?.commands ?? [];
    for (const cmd of commands) {
      if (!cmd?.id) continue;
      const name = toToolName(cmd.id);
      if (map.has(name)) continue; // avoid dup names
      map.set(name, { extensionId: ext.id, commandId: cmd.id });
      const label = ext.manifest.displayName ? `${ext.manifest.displayName}: ` : '';
      tools.push({
        type: 'function',
        function: {
          name,
          description: `${label}${cmd.title || cmd.id}. Đối số là một object params (JSON) tuỳ command; xem tài liệu tiện ích.`,
          parameters: { type: 'object', properties: {}, additionalProperties: true },
        },
      });
    }
  }
  return { tools, map };
}

/**
 * Execute a tool call routed from the agent. Returns the command's result.
 * Throws if the tool name is unknown (fail-closed).
 */
export async function executeExtensionTool(
  host: ExtensionToolHost,
  index: ExtensionToolIndex,
  toolName: string,
  args: unknown,
): Promise<unknown> {
  const target = index.map.get(toolName);
  if (!target) throw new Error(`Unknown extension tool: ${toolName}`);
  const params = args && typeof args === 'object' ? args : {};
  return host.executeCommand(target.extensionId, target.commandId, params);
}
