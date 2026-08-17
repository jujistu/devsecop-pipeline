import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';

import { createBookIndex, FakeLlm, type BookIndexRow } from '../bookAi';
import { createHttpApp } from '../httpApp';
import { User, SignUpType } from '../database/schemas/user.schema';
import { FakeObjectStore } from '../objectStore';

const AUTH = 'Bearer test-token';
const USER_ID = '507f1f77bcf86cd799439011';
const JOB_ID = 'job-http-1';
const CONTEXT_KEY = `books/${USER_ID}/${JOB_ID}/context.md`;

process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || 'test-access-secret';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET || 'test-refresh-secret';
process.env.JWT_REFRESH_EXPIRATION =
  process.env.JWT_REFRESH_EXPIRATION || '7d';

let uploadDir: string;
let appHandle: Awaited<ReturnType<typeof createHttpApp>>;
let proxyCalls: { path: string }[];
let indexRow: BookIndexRow | null;
let summaryCache: string | null;

function createTestBookIndex() {
  const store = new FakeObjectStore();
  return (async () => {
    await store.put(CONTEXT_KEY, Buffer.from('<!-- page:1 -->\nCall me Ishmael.'));
    return createBookIndex({
      objectStore: store,
      lookup: async (_userId, id) => {
        if (!indexRow) return null;
        if (id !== indexRow.jobId && id !== indexRow.documentId) return null;
        return { ...indexRow };
      },
      markFailed: async () => {},
    });
  })();
}

beforeEach(async () => {
  uploadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quotii-http-'));
  proxyCalls = [];
  summaryCache = null;
  indexRow = {
    jobId: JOB_ID,
    documentId: JOB_ID,
    indexStatus: 'ready',
    indexError: null,
    contextObjectKey: CONTEXT_KEY,
    title: 'Moby-Dick',
  };

  (User as any).findOneAndUpdate = async (_filter: unknown) => ({
    _id: USER_ID,
    externalAuthId: 'guest-http-1',
    signUpType: SignUpType.GUEST,
    isGuest: true,
    email: 'guest_http_1@guest.quotii.local',
  });
  (User as any).findById = () => ({
    exec: async () => ({
      _id: USER_ID,
      isGuest: true,
      email: 'guest_http_1@guest.quotii.local',
    }),
  });

  appHandle = await createHttpApp({
    createContext: async ({ req }) => ({
      user:
        req.headers.authorization === AUTH
          ? { id: USER_ID, email: 'guest_http_1@guest.quotii.local' }
          : null,
    }),
    canWriteJobId: async (_userId, jobId) => jobId !== 'foreign-job',
    postToPdfProcessor: async (targetPath) => {
      proxyCalls.push({ path: targetPath });
      if (targetPath === '/index-pdf') {
        return {
          status: 202,
          data: { job_id: JOB_ID, index_status: 'queued' },
        };
      }
      return {
        status: 202,
        data: { documentId: JOB_ID, status: 'queued' },
      };
    },
    bookIndex: await createTestBookIndex(),
    askLlm: new FakeLlm(['Ishmael']),
    explainLlm: new FakeLlm(['Meaning']),
    summaryLlm: new FakeLlm(['Summary text']),
    getSummaryCache: async () => summaryCache,
    saveSummaryCache: async (_userId, _jobId, text) => {
      summaryCache = text;
    },
    uploadDir,
    enableWebSocket: false,
  });
});

afterEach(async () => {
  await appHandle.close();
  fs.rmSync(uploadDir, { recursive: true, force: true });
});

test('GET /health returns ok', async () => {
  const response = await request(appHandle.app).get('/health');

  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { status: 'ok' });
});

test('POST /index requires auth before upload', async () => {
  const response = await request(appHandle.app)
    .post('/index')
    .attach('file', Buffer.from('%PDF-1.4 fake'), {
      filename: 'book.pdf',
      contentType: 'application/pdf',
    })
    .field('title', 'Book')
    .field('jobId', JOB_ID);

  assert.equal(response.status, 401);
});

test('POST /index rejects non-PDF uploads', async () => {
  const response = await request(appHandle.app)
    .post('/index')
    .set('Authorization', AUTH)
    .attach('file', Buffer.from('hello'), {
      filename: 'book.txt',
      contentType: 'text/plain',
    })
    .field('title', 'Book')
    .field('jobId', JOB_ID);

  assert.equal(response.status, 400);
  assert.match(response.text, /Only PDF files are allowed/);
});

test('POST /index rejects ownership conflicts', async () => {
  const response = await request(appHandle.app)
    .post('/index')
    .set('Authorization', AUTH)
    .attach('file', Buffer.from('%PDF-1.4 fake'), 'book.pdf')
    .field('title', 'Book')
    .field('jobId', 'foreign-job');

  assert.equal(response.status, 403);
  assert.match(response.text, /jobId not owned by this user/i);
});

test('POST /index forwards to the PDF processor and returns its response', async () => {
  const response = await request(appHandle.app)
    .post('/index')
    .set('Authorization', AUTH)
    .attach('file', Buffer.from('%PDF-1.4 fake'), 'book.pdf')
    .field('title', 'Book')
    .field('jobId', JOB_ID);

  assert.equal(response.status, 202);
  assert.deepEqual(response.body, { job_id: JOB_ID, index_status: 'queued' });
  assert.deepEqual(proxyCalls, [{ path: '/index-pdf' }]);
});

test('POST /explain validates the request body and streams SSE', async () => {
  const invalid = await request(appHandle.app)
    .post('/explain')
    .set('Authorization', AUTH)
    .send({ jobId: JOB_ID, selectedText: 'Call me Ishmael.' });

  assert.equal(invalid.status, 400);
  assert.deepEqual(invalid.body, { error: 'userQuestion is required' });

  const response = await request(appHandle.app)
    .post('/explain')
    .set('Authorization', AUTH)
    .send({
      jobId: JOB_ID,
      selectedText: 'Call me Ishmael.',
      userQuestion: 'Why does this matter?',
      page: 1,
    });

  assert.equal(response.status, 200);
  assert.match(response.headers['content-type'], /text\/event-stream/);
  assert.match(response.text, /event: token/);
  assert.match(response.text, /event: citations/);
  assert.match(response.text, /event: done/);
});

test('POST /ask returns 409 when indexing is not ready', async () => {
  indexRow = {
    ...indexRow!,
    indexStatus: 'processing',
    contextObjectKey: null,
  };

  const notReadyApp = await createHttpApp({
    createContext: async ({ req }) => ({
      user:
        req.headers.authorization === AUTH
          ? { id: USER_ID, email: 'guest_http_1@guest.quotii.local' }
          : null,
    }),
    bookIndex: await createTestBookIndex(),
    askLlm: new FakeLlm(['unused']),
    explainLlm: new FakeLlm(['unused']),
    summaryLlm: new FakeLlm(['unused']),
    getSummaryCache: async () => null,
    saveSummaryCache: async () => {},
    uploadDir,
    enableWebSocket: false,
  });

  try {
    const response = await request(notReadyApp.app)
      .post('/ask')
      .set('Authorization', AUTH)
      .send({ jobId: JOB_ID, userMessage: 'Hello?' });

    assert.equal(response.status, 409);
    assert.equal(response.body.indexStatus, 'processing');
  } finally {
    await notReadyApp.close();
  }
});

test('POST /summary streams cached or generated content', async () => {
  const first = await request(appHandle.app)
    .post('/summary')
    .set('Authorization', AUTH)
    .send({ jobId: JOB_ID });

  assert.equal(first.status, 200);
  assert.match(first.text, /Summary text/);
  assert.match(first.text, /"cached":false/);

  const second = await request(appHandle.app)
    .post('/summary')
    .set('Authorization', AUTH)
    .send({ jobId: JOB_ID });

  assert.equal(second.status, 200);
  assert.match(second.text, /"cached":true/);
});

test('GraphQL registerGuest and whoAmI work through the HTTP endpoint', async () => {
  const registerGuestResponse = await request(appHandle.app)
    .post('/')
    .send({
      query:
        'mutation($guestId: String!) { registerGuest(guestId: $guestId) { accessToken refreshToken user { email isGuest } } }',
      variables: { guestId: 'guest-http-1' },
    });

  assert.equal(registerGuestResponse.status, 200);
  assert.ok(registerGuestResponse.body.data.registerGuest.accessToken);
  assert.equal(
    registerGuestResponse.body.data.registerGuest.user.email,
    'guest_http_1@guest.quotii.local'
  );

  const unauthenticated = await request(appHandle.app)
    .post('/')
    .send({ query: '{ whoAmI { email } }' });
  assert.equal(unauthenticated.status, 200);
  assert.match(unauthenticated.body.errors[0].message, /Authentication required/);

  const whoAmI = await request(appHandle.app)
    .post('/')
    .set('Authorization', AUTH)
    .send({ query: '{ whoAmI { email isGuest } }' });

  assert.equal(whoAmI.status, 200);
  assert.equal(whoAmI.body.data.whoAmI.email, 'guest_http_1@guest.quotii.local');
  assert.equal(whoAmI.body.data.whoAmI.isGuest, true);
});
