/**
 * put → get round-trip through the ObjectStore seam using the fake adapter.
 *
 * Run with: npx ts-node tests/objectStore.fake.test.ts
 * (no live R2 required - fake adapter only)
 */
import { FakeObjectStore } from '../src/objectStore/fakeObjectStore';
import { storeBookContext } from '../src/objectStore';

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function main(): Promise<void> {
  const store = new FakeObjectStore();
  await store.put('books/u1/b1/context.md', Buffer.from('page one\n\npage two'), 'text/markdown');

  const roundTrip = await store.get('books/u1/b1/context.md');
  assert(roundTrip !== null, 'get should return stored bytes');
  assert(roundTrip!.toString() === 'page one\n\npage two', 'round-trip content should match');
  assert(await store.exists('books/u1/b1/context.md'), 'exists should be true after put');

  assert((await store.get('missing/key')) === null, 'missing key should resolve null');

  const key = await storeBookContext('u2', 'job-2', ['only page'], store);
  assert(key === 'books/u2/job-2/context.md', 'spike should return expected key');
  const spike = await store.get(key);
  assert(spike !== null && spike.toString() === 'only page', 'spike blob should be retrievable');

  console.log('ObjectStore fake round-trip OK');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
