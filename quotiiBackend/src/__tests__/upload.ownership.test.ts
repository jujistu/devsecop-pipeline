/**
 * Wave B — issue 19.  Upload/index jobId ownership binding.
 *
 * Exercises `canWriteJobId` with a faked Book model — no live Mongo required.
 *
 * Run: npx ts-node src/__tests__/upload.ownership.test.ts
 */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { Book } from '../database/schemas/book.schema';
import { canWriteJobId } from '../repository/book.repository';

const USER = 'user-1';
const OTHER = 'user-2';
const JOB = 'doc-local-uuid-1';

let existingBook: any;

beforeEach(() => {
  existingBook = null;
  (Book as any).findOne = (filter: any) => {
    const doc =
      existingBook && filter.jobId === existingBook.jobId ? existingBook : null;
    return { lean: async () => doc };
  };
});

test('unclaimed jobId is writable (first poster becomes owner)', async () => {
  assert.equal(await canWriteJobId(USER, JOB), true);
});

test('jobId owned by the same user is writable', async () => {
  existingBook = { jobId: JOB, userId: USER };
  assert.equal(await canWriteJobId(USER, JOB), true);
});

test('foreign jobId owned by another user is rejected', async () => {
  existingBook = { jobId: JOB, userId: OTHER };
  assert.equal(await canWriteJobId(USER, JOB), false);
});

test('missing jobId or userId is rejected', async () => {
  assert.equal(await canWriteJobId('', JOB), false);
  assert.equal(await canWriteJobId(USER, ''), false);
});
