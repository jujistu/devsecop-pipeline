/**
 * Backend BookIndex seam (ticket 03 — ADR 0018).
 *
 * Covers:
 *  - lookup by jobId (clients may still send documentId — same value)
 *  - shared not-ready dialects (missing/queued/processing/failed)
 *  - ready path returns usable Book context text for handlers
 *  - ADR 0018: ready status with missing/unreadable blob → fail AND persist
 *    Mongo `failed` (with error) so GraphQL and SSE gates agree
 *
 * Run: npx ts-node src/__tests__/bookIndex.test.ts
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  createBookIndex,
  notReadyMessage,
  type BookIndexRow,
} from '../bookAi';
import { FakeObjectStore } from '../objectStore';

const USER_ID = 'guest-user-1';
const JOB_ID = 'doc-local-uuid-1';
const CONTEXT_KEY = `books/${USER_ID}/${JOB_ID}/context.md`;
const BOOK_CONTEXT = 'Page 1\nCall me Ishmael.';

let store: FakeObjectStore;
let indexRow: BookIndexRow | null;
let markFailedCalls: { documentOrJobId: string; error: string }[];

beforeEach(async () => {
  store = new FakeObjectStore();
  await store.put(CONTEXT_KEY, Buffer.from(BOOK_CONTEXT, 'utf-8'), 'text/markdown');
  indexRow = {
    jobId: JOB_ID,
    documentId: JOB_ID,
    indexStatus: 'ready',
    indexError: null,
    contextObjectKey: CONTEXT_KEY,
    title: 'Moby-Dick',
  };
  markFailedCalls = [];
});

function bookIndex() {
  return createBookIndex({
    objectStore: store,
    lookup: async (_userId, id) => {
      if (!indexRow) return null;
      if (id !== indexRow.jobId) return null;
      return { ...indexRow };
    },
    markFailed: async (_userId, documentOrJobId, error) => {
      markFailedCalls.push({ documentOrJobId, error });
    },
  });
}

test('notReadyMessage exposes explicit status dialects', () => {
  assert.match(notReadyMessage('queued'), /queued/i);
  assert.match(notReadyMessage('processing'), /processing the book/i);
  assert.match(notReadyMessage('failed', 'inspector exploded'), /inspector exploded/);
  assert.match(notReadyMessage('failed'), /Indexing failed/i);
});

test('lookup resolves by jobId', async () => {
  const row = await bookIndex().lookup(USER_ID, JOB_ID);
  assert.ok(row);
  assert.equal(row!.jobId, JOB_ID);
  assert.equal(row!.documentId, JOB_ID);
});

test('lookup returns null when no matching indexing job exists', async () => {
  const row = await bookIndex().lookup(USER_ID, 'unknown-id');
  assert.equal(row, null);
});

test('resolve returns queued not-ready for a missing job', async () => {
  indexRow = null;
  const result = await bookIndex().resolve(USER_ID, 'unknown-id');
  assert.equal(result.kind, 'not-ready');
  if (result.kind === 'not-ready') {
    assert.equal(result.notReady.indexStatus, 'queued');
  }
});

test('resolve returns processing not-ready dialect', async () => {
  indexRow = { ...indexRow!, indexStatus: 'processing', contextObjectKey: null };
  const result = await bookIndex().resolve(USER_ID, JOB_ID);
  assert.equal(result.kind, 'not-ready');
  if (result.kind === 'not-ready') {
    assert.equal(result.notReady.indexStatus, 'processing');
    assert.match(result.notReady.message, /processing the book/i);
  }
});

test('resolve returns failed not-ready dialect with the persisted error', async () => {
  indexRow = {
    ...indexRow!,
    indexStatus: 'failed',
    indexError: 'inspector exploded',
    contextObjectKey: null,
  };
  const result = await bookIndex().resolve(USER_ID, JOB_ID);
  assert.equal(result.kind, 'not-ready');
  if (result.kind === 'not-ready') {
    assert.equal(result.notReady.indexStatus, 'failed');
    assert.equal(result.notReady.indexError, 'inspector exploded');
  }
});

test('resolve returns ready with usable context text when blob loads', async () => {
  const result = await bookIndex().resolve(USER_ID, JOB_ID);
  assert.equal(result.kind, 'ready');
  if (result.kind === 'ready') {
    assert.equal(result.row.jobId, JOB_ID);
    assert.match(result.contextText, /Call me Ishmael/);
  }
});

test('ADR 0018: ready status with missing context key fails and persists failed', async () => {
  indexRow = { ...indexRow!, contextObjectKey: null };
  const result = await bookIndex().resolve(USER_ID, JOB_ID);

  assert.equal(result.kind, 'not-ready');
  if (result.kind === 'not-ready') {
    assert.equal(result.notReady.indexStatus, 'failed');
  }
  // Failure persisted with error so GraphQL status and SSE gates agree.
  assert.equal(markFailedCalls.length, 1);
  assert.equal(markFailedCalls[0].documentOrJobId, JOB_ID);
  assert.match(markFailedCalls[0].error, /not found/i);
});

test('ADR 0018: ready status with unreadable/missing blob fails and persists failed', async () => {
  // Row points at a key with no blob in the ObjectStore.
  indexRow = { ...indexRow!, contextObjectKey: `${JOB_ID}/missing.md` };
  const result = await bookIndex().resolve(USER_ID, JOB_ID);

  assert.equal(result.kind, 'not-ready');
  if (result.kind === 'not-ready') {
    assert.equal(result.notReady.indexStatus, 'failed');
    assert.equal(result.notReady.indexError, 'Book context object missing or unreadable');
  }
  assert.equal(markFailedCalls.length, 1);
  assert.match(markFailedCalls[0].error, /missing or unreadable/i);
});
