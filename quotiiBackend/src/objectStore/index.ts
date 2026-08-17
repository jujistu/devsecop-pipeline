import { ObjectStore } from './objectStore.interface';
import { FakeObjectStore } from './fakeObjectStore';
import { R2ObjectStore } from './r2ObjectStore';

export { ObjectStore } from './objectStore.interface';
export { FakeObjectStore } from './fakeObjectStore';
export { R2ObjectStore } from './r2ObjectStore';
export type { ObjectStoreData } from './objectStore.interface';
export type { R2Config } from './r2ObjectStore';

/**
 * Build the appropriate ObjectStore for the current environment.
 * When R2 env config is absent (or OBJECT_STORE=fake), returns the in-memory
 * fake so callers and tests never depend on live infrastructure.
 */
export function getObjectStore(env: NodeJS.ProcessEnv = process.env): ObjectStore {
  if (env.OBJECT_STORE === 'fake') {
    return new FakeObjectStore();
  }
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const endpoint = env.R2_ENDPOINT;
  const bucket = env.R2_BUCKET;
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket) {
    return new FakeObjectStore();
  }
  return new R2ObjectStore({
    accessKeyId,
    secretAccessKey,
    endpoint,
    bucket,
    region: env.R2_REGION,
  });
}

/**
 * Thin spike: persist page-aware Book context Markdown through ObjectStore.
 * Used by Cloud indexing to write durable Book context into R2 (instead of
 * ad-hoc S3 calls). Returns the object key written.
 */
export async function storeBookContext(
  userId: string,
  jobId: string,
  pageTexts: string[],
  store: ObjectStore = getObjectStore()
): Promise<string> {
  const key = `books/${userId}/${jobId}/context.md`;
  await store.put(
    key,
    Buffer.from(pageTexts.join('\n\n'), 'utf-8'),
    'text/markdown'
  );
  return key;
}
