import { ObjectStore } from '../objectStore';

/**
 * Backend BookIndex seam (ticket 03 — ADR 0018).
 *
 * One shared module owns Document lookup and readiness for Ask, Summary, and
 * GraphQL index status. Handlers keep their assemble + SSE streaming depth and
 * consume `resolve` instead of duplicating gate/lookup logic.
 *
 * Lookup accepts `jobId` (clients may still send `documentId` — same value).
 * Ready means `indexStatus === 'ready'`
 * AND the Book context blob loads from ObjectStore. A missing/unreadable blob
 * is not "still processing": the request fails and the row is persisted as
 * `failed` (with an error) so GraphQL status and SSE gates agree.
 */

/** Index row needed to gate Ask/Summary and load Book context. */
export type BookIndexRow = {
  jobId: string;
  /** Alias of jobId for assemble-context prompts (not a separate Mongo field). */
  documentId: string;
  indexStatus: string;
  indexError?: string | null;
  contextObjectKey?: string | null;
  title?: string | null;
};

/** Shared not-ready payload: explicit status + user-visible message. */
export type BookIndexNotReady = {
  indexStatus: string;
  indexError: string | null;
  message: string;
};

export type BookIndexResolveResult =
  | { kind: 'ready'; row: BookIndexRow; contextText: string }
  | { kind: 'not-ready'; notReady: BookIndexNotReady };

export type BookIndexDeps = {
  objectStore: ObjectStore;
  /**
   * Document lookup for this user. Returns null when no indexing job
   * matching `jobId` exists yet. Callers may pass the local Document id —
   * it is the jobId for this iteration.
   */
  lookup: (
    userId: string,
    documentOrJobId: string
  ) => Promise<BookIndexRow | null>;
  /**
   * Persist failed status (ADR 0018). Best-effort: a persistence failure must
   * not hide the failed readiness result from the client.
   */
  markFailed: (
    userId: string,
    documentOrJobId: string,
    error: string
  ) => Promise<void>;
};

/** Shared not-ready message dialect for the given status (and error, if failed). */
export function notReadyMessage(
  indexStatus: string,
  indexError?: string | null
): string {
  if (indexStatus === 'failed') {
    return (
      indexError ||
      'Indexing failed. Retry indexing from the Library, then try again.'
    );
  }
  if (indexStatus === 'processing') {
    return 'Still processing the book. Book AI unlocks when indexing finishes.';
  }
  if (indexStatus === 'queued') {
    return 'Book indexing is queued. Book AI unlocks when indexing finishes.';
  }
  return 'Still processing the book. Book AI unlocks when indexing is ready.';
}

export function createBookIndex(deps: BookIndexDeps) {
  /** Document lookup by jobId — shared by SSE + GraphQL rules. */
  async function lookup(
    userId: string,
    documentOrJobId: string
  ): Promise<BookIndexRow | null> {
    return deps.lookup(userId, documentOrJobId);
  }

  /**
   * Ready-gate for Book AI handlers (ADR 0011, 0018).
   * Returns a ready handle (row + loaded context text) or an explicit
   * not-ready payload with shared semantics. Never returns a hollow "ready".
   */
  async function resolve(
    userId: string,
    documentOrJobId: string
  ): Promise<BookIndexResolveResult> {
    const row = await deps.lookup(userId, documentOrJobId);

    if (!row) {
      return {
        kind: 'not-ready',
        notReady: {
          indexStatus: 'queued',
          indexError: null,
          message: notReadyMessage('queued'),
        },
      };
    }

    const indexStatus = row.indexStatus ?? 'queued';
    if (indexStatus !== 'ready') {
      return {
        kind: 'not-ready',
        notReady: {
          indexStatus,
          indexError: row.indexError ?? null,
          message: notReadyMessage(indexStatus, row.indexError),
        },
      };
    }

    // ADR 0018: ready requires loadable Book context. A row that reports ready
    // without an ObjectStore key is a failure, not "still processing".
    if (!row.contextObjectKey) {
      const error = 'Book context object not found';
      await persistFailed(userId, documentOrJobId, error);
      return {
        kind: 'not-ready',
        notReady: {
          indexStatus: 'failed',
          indexError: error,
          message: notReadyMessage('failed', error),
        },
      };
    }

    let contextBytes: Buffer | null;
    try {
      contextBytes = await deps.objectStore.get(row.contextObjectKey);
    } catch {
      contextBytes = null;
    }
    if (!contextBytes) {
      const error = 'Book context object missing or unreadable';
      await persistFailed(userId, documentOrJobId, error);
      return {
        kind: 'not-ready',
        notReady: {
          indexStatus: 'failed',
          indexError: error,
          message: notReadyMessage('failed', error),
        },
      };
    }

    return {
      kind: 'ready',
      row,
      contextText: contextBytes.toString('utf-8'),
    };
  }

  /** ADR 0018 — persist failed so GraphQL status and SSE gates agree. Best-effort. */
  async function persistFailed(
    userId: string,
    documentOrJobId: string,
    error: string
  ): Promise<void> {
    try {
      await deps.markFailed(userId, documentOrJobId, error);
    } catch {
      // The request already fails; a persistence error must not escalate.
    }
  }

  return { lookup, resolve };
}

export type BookIndex = ReturnType<typeof createBookIndex>;
