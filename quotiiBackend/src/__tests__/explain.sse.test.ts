/**
 * Book AI Explain SSE seam (Nuggets-vtp / ADR 0015).
 *
 * Covers:
 *  - assembleExplainContext with required userQuestion + Book context + prior window
 *  - Explain SSE ready success (LLM faked, BookIndex ready)
 *  - missing userQuestion → 400
 *  - not-ready rejection → 409 (same family as Ask)
 *  - Guest JWT / auth required
 *
 * Run: npx ts-node src/__tests__/explain.sse.test.ts
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  assembleExplainContext,
  createExplainHandler,
  createBookIndex,
  FakeLlm,
  MAX_SELECTED_TEXT,
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
  req.headers = authed
    ? { authorization: 'Bearer guest-token' }
    : {};
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
  llm = new FakeLlm(['The', ' passage', ' means', ' X.']);
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
  return createExplainHandler({
    llm,
    bookIndex,
    getUser: async () => ({ id: USER_ID }),
  });
}

const BOOK = { bookContext: BOOK_CONTEXT };

test('assembleExplainContext includes selection, page, user question, and directional system copy', () => {
  const assembled = assembleExplainContext(
    {
      selectedText: 'Call me Ishmael.',
      userQuestion: 'Why does this line matter?',
      surroundingText: 'Some years ago…',
      page: 1,
      documentId: 'doc-1',
      title: 'Moby-Dick',
    },
    BOOK
  );

  assert.match(assembled.systemPrompt, /reader's question/i);
  assert.match(assembled.systemPrompt, /Book context/);
  assert.match(assembled.systemPrompt, /Call me Ishmael/);
  assert.match(assembled.systemPrompt, /Moby-Dick/);
  assert.match(assembled.userPrompt, /Call me Ishmael/);
  assert.match(assembled.userPrompt, /Surrounding context/);
  assert.match(assembled.userPrompt, /Page: 1/);
  assert.match(assembled.userPrompt, /Reader question/);
  assert.match(assembled.userPrompt, /Why does this line matter/);
  assert.doesNotMatch(assembled.userPrompt, /Explain this passage\./);
  assert.equal(assembled.messages.at(-1)?.role, 'user');
  assert.equal(assembled.messages.at(-1)?.content, assembled.userPrompt);
});

test('assembleExplainContext prepends prior chat turns before the passage prompt', () => {
  const assembled = assembleExplainContext(
    {
      selectedText: 'Call me Ishmael.',
      userQuestion: 'What does this mean?',
    },
    {
      bookContext: BOOK_CONTEXT,
      messages: [
        { role: 'user', content: 'Who is Ahab?' },
        { role: 'assistant', content: 'The captain.' },
      ],
    }
  );

  assert.equal(assembled.messages.length, 3);
  assert.equal(assembled.messages[0].content, 'Who is Ahab?');
  assert.equal(assembled.messages[1].content, 'The captain.');
  assert.match(assembled.messages[2].content, /What does this mean/);
  assert.match(assembled.messages[2].content, /Call me Ishmael/);
});

test('assembleExplainContext requires selectedText', () => {
  assert.throws(
    () =>
      assembleExplainContext(
        {
          selectedText: '   ',
          userQuestion: 'What does this mean?',
        },
        BOOK
      ),
    /selectedText is required/
  );
});

test('assembleExplainContext requires userQuestion', () => {
  assert.throws(
    () =>
      assembleExplainContext(
        {
          selectedText: 'Call me Ishmael.',
          userQuestion: '   ',
        },
        BOOK
      ),
    /userQuestion is required/
  );
});

test('assembleExplainContext requires Book context', () => {
  assert.throws(
    () =>
      assembleExplainContext(
        {
          selectedText: 'Call me Ishmael.',
          userQuestion: 'What does this mean?',
        },
        { bookContext: '   ' }
      ),
    /Book context is empty/
  );
});

test('assembleExplainContext caps oversized selectedText', () => {
  const huge = 'a'.repeat(MAX_SELECTED_TEXT + 500);
  const assembled = assembleExplainContext(
    {
      selectedText: huge,
      userQuestion: 'Summarize this.',
    },
    BOOK
  );
  assert.equal(assembled.evidence.selectedText.length, MAX_SELECTED_TEXT);
});

test('Explain ready path streams tokens when authenticated with userQuestion (LLM faked)', async () => {
  const req = makeReq({
    selectedText: 'The only thing we have to fear is fear itself.',
    userQuestion: 'What does Roosevelt mean here?',
    page: 12,
    documentId: JOB_ID,
  });
  const res = makeRes();

  await handler()(req, res);

  assert.equal(res.statusCode, 200);
  assert.match(res._headers['content-type'], /text\/event-stream/);
  assert.equal(llm.calls.length, 1, 'DeepSeek seam invoked once via FakeLlm');

  const llmMessages = llm.calls[0].messages;
  const systemContent = llmMessages.find((m) => m.role === 'system')?.content;
  const userContent = llmMessages.filter((m) => m.role === 'user').at(-1)?.content;
  assert.match(systemContent || '', /Book context/);
  assert.match(systemContent || '', /Call me Ishmael/);
  assert.match(userContent || '', /fear itself/);
  assert.match(userContent || '', /What does Roosevelt mean here/);
  assert.doesNotMatch(userContent || '', /Nearby pages/);

  const events = parseSse(res._chunks);
  const tokens = events.filter((e) => e.event === 'token').map((e) => e.data.text);
  assert.deepEqual(tokens, ['The', ' passage', ' means', ' X.']);
  const citationsIdx = events.findIndex((e) => e.event === 'citations');
  const doneIdx = events.findIndex((e) => e.event === 'done');
  assert.ok(citationsIdx >= 0, 'citations event required');
  assert.ok(doneIdx > citationsIdx, 'citations must precede done');
  assert.deepEqual(events[citationsIdx].data.citations, [
    { page: 12, quote: 'The only thing we have to fear is fear itself.' },
  ]);
  assert.ok(!events.some((e) => e.event === 'error'));
});

test('Explain omits hallucinated quotes and keeps selection fallback', async () => {
  llm = new FakeLlm(['Totally invented: "', 'the purple whale danced', '"']);
  await store.put(
    CONTEXT_KEY,
    Buffer.from('<!-- page:1 -->\nCall me Ishmael.', 'utf-8'),
    'text/markdown'
  );

  const req = makeReq({
    selectedText: 'Call me Ishmael.',
    userQuestion: 'What does this mean?',
    page: 1,
    documentId: JOB_ID,
  });
  const res = makeRes();
  await handler()(req, res);

  const events = parseSse(res._chunks);
  const citations = events.find((e) => e.event === 'citations')?.data.citations;
  assert.deepEqual(citations, [{ page: 1, quote: 'Call me Ishmael.' }]);
});

test('Explain ready path sends prior turns then the passage prompt', async () => {
  const req = makeReq({
    selectedText: 'Call me Ishmael.',
    userQuestion: 'What does this mean?',
    documentId: JOB_ID,
    messages: [
      { role: 'user', content: 'Who is Ahab?' },
      { role: 'assistant', content: 'The captain.' },
    ],
  });
  const res = makeRes();

  await handler()(req, res);

  assert.equal(res.statusCode, 200);
  const llmMessages = llm.calls[0].messages;
  assert.equal(llmMessages[0].role, 'system');
  assert.equal(llmMessages[1].role, 'user');
  assert.equal(llmMessages[1].content, 'Who is Ahab?');
  assert.equal(llmMessages[2].role, 'assistant');
  assert.equal(llmMessages[2].content, 'The captain.');
  assert.equal(llmMessages[3].role, 'user');
  assert.match(llmMessages[3].content, /Call me Ishmael/);
  assert.match(llmMessages[3].content, /What does this mean/);
});

test('Explain rejects when indexStatus is not ready and does not call the LLM', async () => {
  indexRow = {
    ...indexRow!,
    indexStatus: 'processing',
    contextObjectKey: null,
  };

  const req = makeReq({
    documentId: JOB_ID,
    selectedText: 'A line.',
    userQuestion: 'What does this mean?',
  });
  const res = makeRes();
  await handler()(req, res);

  assert.equal(res.statusCode, 409);
  assert.equal(llm.calls.length, 0, 'LLM must not run while not ready');
  const body = JSON.parse(res._chunks.join(''));
  assert.equal(body.indexStatus, 'processing');
  assert.match(body.error, /processing the book/i);
});

test('Explain rejects unauthenticated requests at the Book AI seam', async () => {
  const h = createExplainHandler({
    llm,
    getUser: async () => null,
    bookIndex: createBookIndex({
      objectStore: store,
      lookup: async () => indexRow,
      markFailed: async () => {},
    }),
  });

  const req = makeReq(
    {
      selectedText: 'hello',
      userQuestion: 'why?',
      documentId: JOB_ID,
    },
    false
  );
  const res = makeRes();

  await h(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(llm.calls.length, 0, 'LLM must not run without auth');
  assert.match(res._chunks.join(''), /Unauthorized/);
});

test('Explain returns 400 when selectedText is missing', async () => {
  const req = makeReq({
    page: 1,
    documentId: JOB_ID,
    userQuestion: 'What is this?',
  });
  const res = makeRes();

  await handler()(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(llm.calls.length, 0);
  assert.match(res._chunks.join(''), /selectedText is required/);
});

test('Explain returns 400 when userQuestion is missing', async () => {
  const req = makeReq({
    selectedText: 'Call me Ishmael.',
    documentId: JOB_ID,
  });
  const res = makeRes();

  await handler()(req, res);

  assert.equal(res.statusCode, 400);
  assert.equal(llm.calls.length, 0);
  assert.match(res._chunks.join(''), /userQuestion is required/);
});
