export type ObjectStoreData = Buffer | Uint8Array;

/**
 * Thin blob-store seam used by Cloud indexing.
 *
 * Callers store/retrieve blobs through this interface. Vendor details
 * (Cloudflare R2 / S3-compatible) live only inside concrete adapters.
 */
export interface ObjectStore {
  /** Write `data` at `key` (overwriting if present). */
  put(key: string, data: ObjectStoreData, contentType?: string): Promise<void>;
  /** Return the bytes at `key`, or `null` when missing. */
  get(key: string): Promise<Buffer | null>;
  /** Delete `key`. Resolves `true` when it existed and was removed. */
  delete(key: string): Promise<boolean>;
  /** Resolve `true` when a blob exists at `key`. */
  exists(key: string): Promise<boolean>;
}
