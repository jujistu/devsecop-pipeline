import { Request, Response } from 'express';
import {
  assembleAskContext,
  AskChatMessage,
  AskRequestInput,
} from './assembleAskContext';
import { BookIndex } from './bookIndex';
import { groundCitations } from './groundCitations';
import { LlmClient } from './llm/llm.interface';

export type AskAuthUser = { id: string };

export type AskHandlerDeps = {
  llm: LlmClient;
  /** Resolve the authenticated user (guest JWT Bearer). */
  getUser: (req: Request) => Promise<AskAuthUser | null>;
  /**
   * Shared BookIndex seam: dual-id lookup + ready-gate (ADR 0018).
   * The handler never duplicates gate/lookup or loads Book context itself.
   */
  bookIndex: BookIndex;
};

function writeSse(
  res: Response,
  event: 'token' | 'citations' | 'done' | 'error',
  data: Record<string, unknown>
) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function parseAskBody(body: any): AskRequestInput {
  const messages: AskChatMessage[] | undefined = Array.isArray(body?.messages)
    ? body.messages
    : undefined;

  return {
    ...(typeof body?.documentId === 'string'
      ? { documentId: body.documentId }
      : {}),
    ...(typeof body?.jobId === 'string' ? { jobId: body.jobId } : {}),
    ...(messages ? { messages } : {}),
    userMessage: typeof body?.userMessage === 'string' ? body.userMessage : '',
  };
}

/**
 * POST /ask — guest-authenticated Book chat Ask over HTTP SSE.
 * History-stateless (ADR 0016): client sends the turn window; server does not
 * persist transcripts. BookIndex resolves readiness (status + loadable Book
 * context, ADR 0018); the handler assembles and streams.
 */
export function createAskHandler(deps: AskHandlerDeps) {
  return async (req: Request, res: Response) => {
    const user = await deps.getUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = parseAskBody(req.body);
    const lookupId = (body.documentId || body.jobId || '').trim();
    if (!lookupId) {
      return res.status(400).json({
        error: 'documentId or jobId is required',
      });
    }
    if (!body.userMessage.trim()) {
      return res.status(400).json({ error: 'userMessage is required' });
    }

    let result;
    try {
      result = await deps.bookIndex.resolve(user.id, lookupId);
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Failed to load index status',
      });
    }

    if (result.kind === 'not-ready') {
      // Explicit status for the client — do not call the LLM.
      return res.status(409).json({
        error: result.notReady.message,
        indexStatus: result.notReady.indexStatus,
        indexError: result.notReady.indexError,
      });
    }

    const { row, contextText } = result;

    let assembled;
    try {
      assembled = assembleAskContext({
        bookContext: contextText,
        documentId: row.documentId || lookupId,
        jobId: row.jobId || lookupId,
        messages: body.messages,
        userMessage: body.userMessage,
        title: row.title,
      });
    } catch (err: any) {
      return res.status(400).json({
        error: err?.message || 'Invalid Ask request',
      });
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }

    const abort = new AbortController();
    req.on('close', () => {
      abort.abort();
    });

    try {
      let full = '';
      for await (const token of deps.llm.streamTokens({
        messages: [
          { role: 'system', content: assembled.systemPrompt },
          ...assembled.messages.map((m) => ({
            role: m.role,
            content: m.content,
          })),
        ],
        signal: abort.signal,
      })) {
        if (abort.signal.aborted) break;
        full += token;
        writeSse(res, 'token', { text: token });
      }
      if (!abort.signal.aborted) {
        writeSse(res, 'citations', {
          citations: groundCitations(full, contextText),
        });
        writeSse(res, 'done', {});
      }
      res.end();
    } catch (err: any) {
      if (!res.headersSent) {
        return res.status(500).json({
          error: err?.message || 'Ask failed',
        });
      }
      writeSse(res, 'error', {
        message: err?.message || 'Ask failed',
      });
      res.end();
    }
  };
}

