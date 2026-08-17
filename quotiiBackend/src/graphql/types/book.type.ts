import { objectType } from 'nexus';

export const BookType = objectType({
  name: 'Book',
  definition(t) {
    t.nonNull.string('_id');
    t.nonNull.string('jobId');
    t.nonNull.string('userId');
    t.nonNull.string('title');
    /** Cloud indexing readiness: queued | processing | ready | failed */
    t.nullable.string('indexStatus');
    t.nullable.string('indexError');
    t.nullable.string('contextObjectKey');
    t.nullable.boolean('isSubscribed');
  },
});

export const BookIndexStatusType = objectType({
  name: 'BookIndexStatus',
  definition(t) {
    t.nonNull.string('jobId');
    t.nonNull.string('userId');
    t.nonNull.string('indexStatus');
    t.nullable.string('indexError');
    t.nullable.string('contextObjectKey');
  },
});

/** Per-user Cloud index-status topic — one iterator per signed-in user. */
export function bookIndexStatusTopic(userId: string): string {
  return `BOOK_INDEX_STATUS.${userId}`;
}
/** Retired quote-progress stream — kept so legacy clients can subscribe without schema errors. */
export const BOOK_PROGRESS_SUBSCRIPTION_EVENT = 'BOOK_PROGRESS_EVENT';
