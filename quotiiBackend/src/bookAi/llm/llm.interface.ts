/**
 * Book AI LLM seam. DeepSeek (or any provider) is called only through this
 * interface so tests can inject a FakeLlm — no live keys required.
 */

export type LlmMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export type LlmStreamRequest = {
  messages: LlmMessage[];
  /** Abort when the client disconnects. */
  signal?: AbortSignal;
};

/**
 * Stream model tokens. Implementations must not buffer the full answer
 * before yielding (SSE needs incremental tokens).
 */
export interface LlmClient {
  streamTokens(request: LlmStreamRequest): AsyncIterable<string>;
}
