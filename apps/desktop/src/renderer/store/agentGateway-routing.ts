import type { AIProvider, ExternalAgent } from '../types/agent-registry';

/**
 * Use the main-process Izzi API bridge whenever the agent itself is Izzi-native
 * or the user explicitly picked an Izzi-hosted model. This keeps SmartRouter and
 * direct Grok/Sol choices working for every agent without exposing credentials
 * to the renderer or silently forcing the request back through a Docker proxy.
 */
export function shouldUseIzziApiRoute(
  runtime: ExternalAgent['runtime'],
  provider: AIProvider,
): boolean {
  return runtime === 'izzi' || provider === 'izzi';
}
