import mongoose from 'mongoose';
const { Schema } = mongoose;

/**
 * Cloud indexing readiness (ADR 0004).
 * ``ready`` means Book context exists for Book AI.
 */
export enum IndexStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

const bookSchema = new Schema({
  userId: String,
  /** Cloud job id — same as the local Library Document id for this iteration. */
  jobId: String,
  title: String,
  /** Cloud indexing readiness: queued | processing | ready | failed */
  indexStatus: { type: String, default: null },
  /** User-visible indexing failure message (when indexStatus is failed). */
  indexError: String,
  /** ObjectStore key for durable Book context text. */
  contextObjectKey: String,
  /**
   * Cached chapter-to-chapter summary text (ADR 0005 / 0010).
   * Filled on first on-demand Summary request — never at index ready.
   */
  summaryText: String,
  /** When the summary cache was last written. */
  summaryGeneratedAt: Date,
  /** ObjectStore key for the source PDF used for indexing / retry. */
  sourceObjectKey: String,
  createdAt: { type: Date, default: Date.now },
});

export const Book = mongoose.model('Book', bookSchema);
