/**
 * Book AI Ask SSE seam (ticket 09).
 *
 * Covers:
 *  - not-ready gate (no LLM call; explicit indexStatus for the client)
 *  - ready multi-turn path with Book context from FakeObjectStore + FakeLlm
 *  - history-stateless window trimming (no transcript persistence)
 *  - guest JWT required
 *
 * Run: npx ts-node src/__tests__/ask.sse.test.ts
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  assembleAskContext,
  createAskHandler,
  createBookIndex,
  FakeLlm,
  MAX_ASK_MESSAGES,
  trimAskWindow,
  type BookIndexRow,
} from '../bookAi';
import { FakeObjectStore } from '../objectStore';

const USER_ID = 'guest-user-1';
const JOB_ID = 'doc-local-uuid-1';
const CONTEXT_KEY = `books/${USER_ID}/${JOB_ID}/context.md`;
const BOOK_CONTEXT =
  'Page 1\nCall me Ishmael.\n\nPage 2\nSome years ago—never mind how long precisely…';

function makeRes() {
  const chunks: string[] = [];
  let statusCode = 200;
  const headers: Record<string, string> = {};
  let ended = false;
  const res: any = {
    status(code: number) {
      statusCode = code;
      return res;
    },
    setHeader(key: string, value: string) {
      headers[key.toLowerCase()] = value;
    },
    json(body: unknown) {
      chunks.push(JSON.stringify(body));
      ended = true;
      return res;
    },
    write(chunk: string) {
      chunks.push(chunk);
      return true;
    },
    end() {
      ended = true;
    },
    get statusCode() {
      return statusCode;
    },
    get headersSent() {
      return Object.keys(headers).length > 0 || chunks.length > 0;
    },
    _chunks: chunks,
    _headers: headers,
    get ended() {
      return ended;
    },
  };
  return res;
}

function makeReq(body: unknown, authed = true) {
  const req: any = new EventEmitter();
  req.body = body;
  req.headers = authed ? { authorization: 'Bearer guest-token' } : {};
  return req;
}

function parseSse(chunks: string[]) {
  const raw = chunks.join('');
  const events: { event: string; data: any }[] = [];
  const parts = raw.split('\n\n').filter(Boolean);
  for (const part of parts) {
    const lines = part.split('\n');
    let event = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (data) {
      events.push({ event, data: JSON.parse(data) });
    }
  }
  return events;
}

let llm: FakeLlm;
let store: FakeObjectStore;
let indexRow: BookIndexRow | null;

beforeEach(async () => {
  llm = new FakeLlm(['Ishmael', ' is', ' the', ' narrator.']);
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
});

function handler() {
  const bookIndex = createBookIndex({
    objectStore: store,
    lookup: async (_userId, id) => {
      if (!indexRow) return null;
      if (id !== indexRow.jobId && id !== indexRow.documentId) return null;
      return { ...indexRow };
    },
    markFailed: async () => {},
  });
  return createAskHandler({
    llm,
    bookIndex,
    getUser: async () => ({ id: USER_ID }),
  });
}

test('assembleAskContext puts Book context in the system prefix and appends the turn window', () => {
  const assembled = assembleAskContext({
    bookContext: BOOK_CONTEXT,
    documentId: JOB_ID,
    jobId: JOB_ID,
    messages: [{ role: 'user', content: 'Who is speaking?' }],
    userMessage: 'And where?',
    title: 'Moby-Dick',
  });

  assert.match(assembled.systemPrompt, /Book context/);
  assert.match(assembled.systemPrompt, /Call me Ishmael/);
  assert.match(assembled.systemPrompt, /Moby-Dick/);
  assert.equal(assembled.messages.length, 2);
  assert.equal(assembled.messages[0].content, 'Who is speaking?');
  assert.equal(assembled.messages[1].role, 'user');
  assert.equal(assembled.messages[1].content, 'And where?');
});

test('trimAskWindow keeps only the last N prior messages plus the new user turn', () => {
  const prior = Array.from({ length: MAX_ASK_MESSAGES + 8 }, (_, i) => ({
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `m-${i}`,
  }));
  const window = trimAskWindow(prior, 'latest question');
  assert.equal(window.length, MAX_ASK_MESSAGES + 1);
  assert.equal(window[window.length - 1].content, 'latest question');
  assert.equal(window[0].content, `m-${prior.length - MAX_ASK_MESSAGES}`);
});

test('Ask rejects when indexStatus is not ready and does not call the LLM', async () => {
  indexRow = {
    ...indexRow!,
    indexStatus: 'processing',
    contextObjectKey: null,
  };

  const req = makeReq({
    documentId: JOB_ID,
    userMessage: 'Who is Ishmael?',
  });
  const res = makeRes();
  await handler()(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(llm.calls.length, 0, 'LLM must not run while not ready');
  const body = JSON.parse(res._chunks.join(''));
  assert.equal(body.indexStatus, 'processing');
  assert.match(body.error, /processing the book/i);
});

test('Ask rejects failed indexing with an explicit failed status', async () => {
  indexRow = {
    ...indexRow!,
    indexStatus: 'failed',
    indexError: 'inspector exploded',
    contextObjectKey: null,
  };

  const req = makeReq({ jobId: JOB_ID, userMessage: 'Summarize chapter 1' });
  const res = makeRes();
  await handler()(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(llm.calls.length, 0);
  const body = JSON.parse(res._chunks.join(''));
  assert.equal(body.indexStatus, 'failed');
  assert.match(body.error, /inspector exploded|Indexing failed/i);
});

test('Ask treats a missing index job as not-ready (queued)', async () => {
  indexRow = null;

  const req = makeReq({ documentId: 'unknown-doc', userMessage: 'Hello?' });
  const res = makeRes();
  await handler()(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(llm.calls.length, 0);
  const body = JSON.parse(res._chunks.join(''));
  assert.equal(body.indexStatus, 'queued');
});

test('Ask ready path streams tokens grounded in ObjectStore Book context (multi-turn)', async () => {
  const req = makeReq({
    documentId: JOB_ID,
    messages: [
      { role: 'user', content: 'Who narrates?' },
      { role: 'assistant', content: 'Ishmael narrates.' },
    ],
    userMessage: 'Quote the opening line.',
  });
  const res = makeRes();
  await handler()(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(res._headers['content-type'], /text\/event-stream/);
  assert.equal(llm.calls.length, 1);

  const llmMessages = llm.calls[0].messages;
  assert.equal(llmMessages[0].role, 'system');
  assert.match(llmMessages[0].content, /Call me Ishmael/);
  // Prior window + new user message — no server-side transcript store.
  assert.equal(llmMessages.length, 4); // system + 2 prior + new user
  assert.equal(llmMessages[llmMessages.length - 1].content, 'Quote the opening line.');

  const events = parseSse(res._chunks);
  const tokens = events
    .filter((e) => e.event === 'token')
    .map((e) => e.data.text);
  assert.deepEqual(tokens, ['Ishmael', ' is', ' the', ' narrator.']);
  const citationsIdx = events.findIndex((e) => e.event === 'citations');
  const doneIdx = events.findIndex((e) => e.event === 'done');
  assert.ok(citationsIdx >= 0, 'citations event required');
  assert.ok(doneIdx > citationsIdx, 'citations must precede done');
  assert.ok(Array.isArray(events[citationsIdx].data.citations));
  assert.ok(!events.some((e) => e.event === 'error'));
});

test('Ask citations event grounds a verbatim quote against page markers', async () => {
  llm = new FakeLlm(['He says "', 'Call me Ishmael.', '"']);
  await store.put(
    CONTEXT_KEY,
    Buffer.from(
      '<!-- page:1 -->\nCall me Ishmael.\n\n<!-- page:2 -->\nSome years ago',
      'utf-8'
    ),
    'text/markdown'
  );

  const req = makeReq({
    documentId: JOB_ID,
    userMessage: 'Quote the opening line.',
  });
  const res = makeRes();
  await handler()(req, res);

  const events = parseSse(res._chunks);
  const citations = events.find((e) => e.event === 'citations')?.data.citations;
  assert.deepEqual(citations, [{ page: 1, quote: 'Call me Ishmael.' }]);
});

test('Ask rejects unauthenticated requests', async () => {
  const h = createAskHandler({
    llm,
    getUser: async () => null,
    bookIndex: createBookIndex({
      objectStore: store,
      lookup: async () => indexRow,
      markFailed: async () => {},
    }),
  });

  const req = makeReq({ documentId: JOB_ID, userMessage: 'hi' }, false);
  const res = makeRes();
  await h(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(llm.calls.length, 0);
});

test('Ask returns 400 when userMessage is missing', async () => {
  const req = makeReq({ documentId: JOB_ID, messages: [] });
  const res = makeRes();
  await handler()(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(llm.calls.length, 0);
});
