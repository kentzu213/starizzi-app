/**
 * Pure decision logic for ExtensionServicePanel — extracted so it can be unit
 * tested in the node vitest env (the component itself needs a DOM). The panel
 * imports these; there is a single source of truth for the behavior.
 */

export type ServicePhase = 'checking' | 'idle' | 'starting' | 'running' | 'stopped' | 'error';

export interface ServiceStatusResult {
  success?: boolean;
  hasService?: boolean;
  running?: boolean;
  healthy?: boolean;
  ports?: Record<string, number>;
}

/** Cap the first-run log buffer to the newest N lines. */
export const MAX_LOG_LINES = 200;

/** "127.0.0.1:<port>" from a ports map — prefer the `api` port, else the first. */
export function deriveEndpoint(ports?: Record<string, number>): string | null {
  if (!ports) return null;
  const port = ports.api ?? Object.values(ports)[0];
  return port ? `127.0.0.1:${port}` : null;
}

/** Strip the scheme from a baseUrl → "host:port" for display (null when empty). */
export function endpointFromBaseUrl(baseUrl?: string): string | null {
  if (!baseUrl) return null;
  const stripped = baseUrl.replace(/^https?:\/\//, '');
  return stripped || null;
}

/** Append a log line, keeping only the newest `max` lines. Pure (new array). */
export function capLogs(prev: string[], line: string, max: number = MAX_LOG_LINES): string[] {
  const next = [...prev, line];
  return next.length > max ? next.slice(next.length - max) : next;
}

/** Phase implied by a status check for an extension that HAS a service. */
export function phaseFromStatus(status: ServiceStatusResult): ServicePhase {
  return status.running ? 'running' : 'idle';
}

/** Whether the status check indicates the extension actually declares a service. */
export function statusHasService(status: ServiceStatusResult): boolean {
  return !!status.success && !!status.hasService;
}

/**
 * Whether opening the extension should auto-boot its backend: only for an
 * installed extension that has a service, isn't already running, and hasn't
 * been auto-started this mount (guards the React StrictMode double-invoke).
 */
export function shouldAutoStart(args: {
  isInstalled: boolean;
  hasService: boolean;
  running: boolean;
  alreadyStarted: boolean;
}): boolean {
  return args.isInstalled && args.hasService && !args.running && !args.alreadyStarted;
}
