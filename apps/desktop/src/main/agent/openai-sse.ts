import type { ManagedProviderStreamChunk } from './types';

/**
 * Shared OpenAI-compatible SSE parser used by both ManagedAgentProvider and
 * CustomOpenAIProvider so the streaming contract stays identical (INV-9).
 *
 * Parses `data: {choices:[{delta:{content}}]}` chunks, handles `[DONE]` and
 * `finish_reason === 'stop'`, and yields `assistant_delta` / `assistant_done`.
 * The caller is responsible for emitting any lead-in events (`status`,
 * `assistant_start`) before delegating to this helper.
 */
export async function* streamOpenAISse(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<ManagedProviderStreamChunk> {
  let buffer = '';

  for await (const rawChunk of stream) {
    buffer += Buffer.isBuffer(rawChunk) ? rawChunk.toString('utf8') : String(rawChunk);

    // Process complete SSE lines, keep the incomplete tail in the buffer
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith(':')) continue; // skip comments / blanks

      if (trimmed === 'data: [DONE]') {
        yield { type: 'assistant_done' };
        return;
      }

      if (trimmed.startsWith('data: ')) {
        try {
          const parsed = JSON.parse(trimmed.slice(6));
          const delta = parsed.choices?.[0]?.delta?.content;
          if (delta) {
            yield { type: 'assistant_delta', delta };
          }

          const finishReason = parsed.choices?.[0]?.finish_reason;
          if (finishReason === 'stop') {
            yield { type: 'assistant_done' };
            return;
          }
        } catch {
          // Ignore malformed SSE chunks
        }
      }
    }
  }

  // Stream ended without an explicit [DONE]/stop — close out the message
  yield { type: 'assistant_done' };
}

/**
 * Drain a readable stream into a trimmed UTF-8 string. Used to read error
 * response bodies. Callers MUST redact secrets before logging/displaying.
 */
export async function readStreamBody(stream: NodeJS.ReadableStream): Promise<string> {
  let body = '';
  for await (const chunk of stream) {
    body += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
  }
  return body.trim();
}
