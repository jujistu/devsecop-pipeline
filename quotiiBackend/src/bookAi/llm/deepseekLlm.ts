import axios from 'axios';
import { LlmClient, LlmStreamRequest } from './llm.interface';

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-v4-flash';

/**
 * DeepSeek chat-completions streaming adapter (OpenAI-compatible SSE).
 * Reads DEEPSEEK_API_KEY from the process env — never ship keys to mobile.
 */
export class DeepSeekLlm implements LlmClient {
  constructor(
    private readonly apiKey: string = process.env.DEEPSEEK_API_KEY || '',
    private readonly baseUrl: string =
      process.env.DEEPSEEK_BASE_URL || DEFAULT_BASE_URL,
    private readonly model: string =
      process.env.DEEPSEEK_MODEL || DEFAULT_MODEL
  ) {}

  async *streamTokens(request: LlmStreamRequest): AsyncIterable<string> {
    if (!this.apiKey) {
      throw new Error('DEEPSEEK_API_KEY is not configured');
    }

    const response = await axios.post(
      `${this.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        model: this.model,
        messages: request.messages,
        stream: true,
        // Prefer the cheap non-thinking path for short Explain turns.
        thinking: { type: 'disabled' },
      },
      {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        responseType: 'stream',
        signal: request.signal as any,
        timeout: 120_000,
      }
    );

    const stream = response.data as NodeJS.ReadableStream;
    let buffer = '';

    for await (const chunk of stream as AsyncIterable<Buffer | string>) {
      if (request.signal?.aborted) {
        return;
      }
      buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;

        let parsed: any;
        try {
          parsed = JSON.parse(payload);
        } catch {
          continue;
        }
        const text = parsed?.choices?.[0]?.delta?.content;
        if (typeof text === 'string' && text.length > 0) {
          yield text;
        }
      }
    }
  }
}
