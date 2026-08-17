import { Request, Response } from 'express';
import { assembleSummaryContext } from './assembleSummaryContext';
import { BookIndex } from './bookIndex';
import { LlmClient } from './llm/llm.interface';

export type SummaryAuthUser = { id: string };

export type SummaryHandlerDeps = {
  llm: LlmClient;
  /** Resolve the authenticated user (guest JWT Bearer). */
  getUser: (req: Request) => Promise<SummaryAuthUser | null>;
  /**
   * Shared BookIndex seam: dual-id lookup + ready-gate (ADR 0018).
   * The handler never duplicates gate/lookup or loads Book context itself.
   */
  bookIndex: BookIndex;
  /**
   * Return cached chapter summary text for this Document/job, or null.
   * Server-side cache (Mongo) — not auto-filled at index ready.
   */
  getSummaryCache: (
    userId: string,
    documentOrJobId: string
  ) => Promise<string | null>;
  /** Persist generated summary for reuse (second open skips LLM). */
  saveSummaryCache: (
    userId: string,
    documentOrJobId: string,
    summaryText: string
  ) => Promise<void>;
};

function writeSse(
  res: Response,
  event: 'token' | 'done' | 'error',
  data: Record<string, unknown>
) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function parseSummaryBody(body: any): {
  documentId?: string;
  jobId?: string;
} {
  return {
    ...(typeof body?.documentId === 'string'
      ? { documentId: body.documentId }
      : {}),
    ...(typeof body?.jobId === 'string' ? { jobId: body.jobId } : {}),
  };
}

function beginSse(res: Response) {
  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  if (typeof (res as any).flushHeaders === 'function') {
    (res as any).flushHeaders();
  }
}

/**
 * POST /summary — guest-authenticated on-demand chapter summary over HTTP SSE.
 * BookIndex resolves readiness (status + loadable Book context, ADR 0018);
 * first request generates via LLM and caches; subsequent requests return the
 * cache without calling the LLM (ADR 0005). Does not auto-run when indexing
 * completes.
 */
export function createSummaryHandler(deps: SummaryHandlerDeps) {
  return async (req: Request, res: Response) => {
    const user = await deps.getUser(req);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const body = parseSummaryBody(req.body);
    const lookupId = (body.documentId || body.jobId || '').trim();
    if (!lookupId) {
      return res.status(400).json({
        error: 'documentId or jobId is required',
      });
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

    // Cache hit: return without ObjectStore load or LLM (AC: second open skips generation).
    let cached: string | null;
    try {
      cached = await deps.getSummaryCache(user.id, lookupId);
    } catch (err: any) {
      return res.status(500).json({
        error: err?.message || 'Failed to load summary cache',
      });
    }

    if (cached && cached.trim()) {
      beginSse(res);
      writeSse(res, 'token', { text: cached });
      writeSse(res, 'done', { cached: true });
      res.end();
      return;
    }

    let assembled;
    try {
      assembled = assembleSummaryContext({
        bookContext: contextText,
        documentId: row.documentId || lookupId,
        jobId: row.jobId || lookupId,
        title: row.title,
      });
    } catch (err: any) {
      return res.status(400).json({
        error: err?.message || 'Invalid Summary request',
      });
    }

    beginSse(res);

    const abort = new AbortController();
    req.on('close', () => {
      abort.abort();
    });

    try {
      let full = '';
      for await (const token of deps.llm.streamTokens({
        messages: [
          { role: 'system', content: assembled.systemPrompt },
          { role: 'user', content: assembled.userPrompt },
        ],
        signal: abort.signal,
      })) {
        if (abort.signal.aborted) break;
        full += token;
        writeSse(res, 'token', { text: token });
      }
      if (!abort.signal.aborted) {
        if (full.trim()) {
          try {
            await deps.saveSummaryCache(user.id, lookupId, full);
          } catch (err: any) {
            writeSse(res, 'error', {
              message: err?.message || 'Failed to cache summary',
            });
            res.end();
            return;
          }
        }
        writeSse(res, 'done', { cached: false });
      }
      res.end();
    } catch (err: any) {
      if (!res.headersSent) {
        return res.status(500).json({
          error: err?.message || 'Summary failed',
        });
      }
      writeSse(res, 'error', {
        message: err?.message || 'Summary failed',
      });
      res.end();
    }
  };
}
