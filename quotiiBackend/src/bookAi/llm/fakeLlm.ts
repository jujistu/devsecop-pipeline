import { LlmClient, LlmStreamRequest } from './llm.interface';

/**
 * Deterministic LLM for tests. Yields fixed token chunks; records calls.
 */
export class FakeLlm implements LlmClient {
  readonly calls: LlmStreamRequest[] = [];

  constructor(
    private readonly tokens: string[] = ['Hello', ' from', ' Explain']
  ) {}

  async *streamTokens(request: LlmStreamRequest): AsyncIterable<string> {
    this.calls.push(request);
    for (const token of this.tokens) {
      if (request.signal?.aborted) {
        return;
      }
      yield token;
    }
  }
}
