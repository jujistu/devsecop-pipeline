/**
 * Cloud indexing status seam (ticket 06).
 *
 * Exercises GraphQL-facing repository helpers with a faked Book model and a
 * faked PdfProcessor retry HTTP call — no live Mongo / R2 required.
 *
 * Run: npx ts-node src/__tests__/cloudIndex.status.test.ts
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Book, IndexStatus } from '../database/schemas/book.schema';
import {
  getBookIndexStatuses,
  retryCloudIndex,
  toBookIndexStatus,
} from '../repository/book.repository';
import { bookIndexStatusTopic } from '../graphql/types/book.type';
import { pdfProcessorUrl } from '../utils/pdfProcessor.util';

const USER_ID = 'guest-user-1';
const JOB_ID = 'doc-local-uuid-1';

let fakeBook: any;
let axiosPostCalls: any[];

beforeEach(() => {
  fakeBook = {
    jobId: JOB_ID,
    userId: USER_ID,
    indexStatus: IndexStatus.QUEUED,
    indexError: null,
    contextObjectKey: null,
  };
  axiosPostCalls = [];

  (Book as any).findOne = (filter: any) => {
    const idMatch = filter.jobId === JOB_ID;
    const doc = filter.userId === USER_ID && idMatch ? { ...fakeBook } : null;
    return {
      lean: async () => doc,
    };
  };
  (Book as any).find = (filter: any) => {
    const ids: string[] = filter.jobId?.$in ?? [];
    const rows = ids
      .map((id) => {
        if (id === JOB_ID && filter.userId === USER_ID) return { ...fakeBook };
        return null;
      })
      .filter(Boolean);
    return {
      lean: async () => rows,
    };
  };
  (Book as any).updateOne = async (_filter: any, update: any) => {
    Object.assign(fakeBook, update.$set || {});
    return { modifiedCount: 1 };
  };

  // Stub axios used by retryCloudIndex without touching node_modules.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const axios = require('axios');
  axios.post = async (url: string, body: any) => {
    axiosPostCalls.push({ url, body });
    return { status: 202, data: { job_id: JOB_ID, index_status: 'queued' } };
  };
});

test('pdfProcessorUrl strips legacy /process-pdf suffix', () => {
  assert.equal(
    pdfProcessorUrl('/index-pdf', 'http://localhost:5000/process-pdf'),
    'http://localhost:5000/index-pdf'
  );
  assert.equal(
    pdfProcessorUrl('/retry-index', 'http://localhost:5000'),
    'http://localhost:5000/retry-index'
  );
});

test('toBookIndexStatus exposes explicit queued|processing|ready|failed', () => {
  const ready = toBookIndexStatus({
    jobId: JOB_ID,
    userId: USER_ID,
    indexStatus: IndexStatus.READY,
    indexError: null,
    contextObjectKey: `books/${USER_ID}/${JOB_ID}/context.md`,
  });
  assert.equal(ready.indexStatus, 'ready');
  assert.ok(ready.contextObjectKey?.endsWith('/context.md'));
  // Ready is Book context — not legacy quote ACTIVE.
  assert.notEqual(ready.indexStatus, 'ACTIVE');
});

test('getBookIndexStatuses returns owned snapshots and omits other users', async () => {
  fakeBook.indexStatus = IndexStatus.PROCESSING;
  const rows = await getBookIndexStatuses(USER_ID, [
    JOB_ID,
    'other-job',
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].jobId, JOB_ID);
  assert.equal(rows[0].userId, USER_ID);
  assert.equal(rows[0].indexStatus, 'processing');
});

test('getBookIndexStatuses returns empty for an empty id list', async () => {
  const rows = await getBookIndexStatuses(USER_ID, []);
  assert.equal(rows.length, 0);
});

test('bookIndexStatusTopic is one channel per user', () => {
  assert.equal(bookIndexStatusTopic(USER_ID), `BOOK_INDEX_STATUS.${USER_ID}`);
  assert.notEqual(
    bookIndexStatusTopic(USER_ID),
    bookIndexStatusTopic('other-user')
  );
});

test('retryCloudIndex re-enters the pipeline from failed', async () => {
  fakeBook.indexStatus = IndexStatus.FAILED;
  fakeBook.indexError = 'inspector exploded';
  fakeBook.contextObjectKey = null;

  process.env.PDF_PROCESSOR_ENDPOINT = 'http://processor:5000/process-pdf';

  const status = await retryCloudIndex(USER_ID, JOB_ID);

  assert.equal(status.indexStatus, 'queued');
  assert.equal(status.indexError, null);
  assert.equal(axiosPostCalls.length, 1);
  assert.equal(axiosPostCalls[0].url, 'http://processor:5000/retry-index');
  assert.equal(axiosPostCalls[0].body.jobId, JOB_ID);
});

test('retryCloudIndex is a no-op when already ready', async () => {
  fakeBook.indexStatus = IndexStatus.READY;
  fakeBook.contextObjectKey = `books/${USER_ID}/${JOB_ID}/context.md`;

  const status = await retryCloudIndex(USER_ID, JOB_ID);
  assert.equal(status.indexStatus, 'ready');
  assert.equal(axiosPostCalls.length, 0);
});
