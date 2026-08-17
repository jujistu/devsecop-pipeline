import { Request, Response } from 'express';
import {
  assembleExplainContext,
  ExplainEvidence,
} from './assembleExplainContext';
import { AskChatMessage } from './assembleAskContext';
import { BookIndex } from './bookIndex';
import { groundCitations } from './groundCitations';
import { LlmClient } from './llm/llm.interface';

export type ExplainAuthUser = { id: string };

export type ExplainHandlerDeps = {
  llm: LlmClient;
  /** Resolve the authenticated user (guest JWT Bearer). */
  getUser: (req: Request) => Promise<ExplainAuthUser | null>;
  /**
   * Shared BookIndex seam: dual-id lookup + ready-gate (ADR 0018).
   * Same not-ready family as Ask (HTTP 409 + indexStatus).
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

type ParsedExplainBody = ExplainEvidence & {
  jobId?: string;
  messages?: AskChatMessage[];
};

function parseExplainBody(body: any): ParsedExplainBody {
  const messages: AskChatMessage[] | undefined = Array.isArray(body?.messages)
    ? body.messages
    : undefined;

  return {
    selectedText: typeof body?.selectedText === 'string' ? body.selectedText : '',
    userQuestion:
      typeof body?.userQuestion === 'string' ? body.userQuestion : '',
    ...(typeof body?.surroundingText === 'string'
      ? { surroundingText: body.surroundingText }
      : {}),
    ...(typeof body?.page === 'number' ? { page: body.page } : {}),
    ...(typeof body?.documentId === 'string'
      ? { documentId: body.documentId }
      : {}),
    ...(typeof body?.jobId === 'string' ? { jobId: body.jobId } : {}),
    ...(typeof body?.title === 'string' ? { title: body.title } : {}),
    ...(typeof body?.author === 'string' ? { author: body.author } : {}),
    ...(messages ? { messages } : {}),
  };
}

/**
 * POST /explain — guest-authenticated Explain over HTTP SSE.
 * Requires Cloud index ready (BookIndex) and a typed userQuestion with
 * selection evidence (ADR 0015). Optional prior window is history-stateless
 * (ADR 0016), same as Ask. Not-ready shape matches Ask (409).
 */
export function createExplainHandler(deps: ExplainHandlerDeps) {
  return async (req: Request, res: Response) => {
    const user = await deps.getUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = parseExplainBody(req.body);
    const lookupId = (body.documentId || body.jobId || '').trim();
    if (!lookupId) {
      return res.status(400).json({
        error: 'documentId or jobId is required',
      });
    }
    if (!body.selectedText.trim()) {
      return res.status(400).json({ error: 'selectedText is required' });
    }
    if (!body.userQuestion.trim()) {
      return res.status(400).json({ error: 'userQuestion is required' });
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
      // Explicit status for the client — do not call the LLM (same as Ask).
      return res.status(409).json({
        error: result.notReady.message,
        indexStatus: result.notReady.indexStatus,
        indexError: result.notReady.indexError,
      });
    }

    const { row, contextText } = result;

    let assembled;
    try {
      assembled = assembleExplainContext(
        {
          ...body,
          documentId: row.documentId || lookupId,
          ...(row.title ? { title: row.title } : {}),
        },
        {
          bookContext: contextText,
          messages: body.messages,
        }
      );
    } catch (err: any) {
      return res.status(400).json({
        error: err?.message || 'Invalid Explain request',
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
        const selectedText = body.selectedText.trim();
        writeSse(res, 'citations', {
          citations: groundCitations(full, contextText, {
            fallback:
              body.page != null && selectedText
                ? { page: body.page, quote: selectedText }
                : null,
          }),
        });
        writeSse(res, 'done', {});
      }
      res.end();
    } catch (err: any) {
      if (!res.headersSent) {
        return res.status(500).json({
          error: err?.message || 'Explain failed',
        });
      }
      writeSse(res, 'error', {
        message: err?.message || 'Explain failed',
      });
      res.end();
    }
  };
}
