/**
 * Citation grounder: page markers, exact-then-fuzzy quotes, cap/dedup, fallback.
 *
 * Run: npx ts-node src/__tests__/groundCitations.test.ts
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  extractQuotedSpans,
  groundCitations,
  parsePageMap,
} from '../bookAi';

const MARKED =
  '<!-- page:1 -->\nCall me Ishmael. I stuffed a shirt or two into my old carpet-bag.\n\n' +
  '<!-- page:3 -->\nSome years ago—never mind how long precisely…';

test('parsePageMap reads filename-style markers, not list index', () => {
  const pages = parsePageMap(MARKED);
  assert.deepEqual(
    pages.map((p) => p.page),
    [1, 3]
  );
  assert.match(pages[0].text, /Call me Ishmael/);
  assert.match(pages[1].text, /Some years ago/);
});

test('parsePageMap returns empty for unmarked blobs', () => {
  assert.deepEqual(parsePageMap('Call me Ishmael.\n\nSome years ago'), []);
});

test('extractQuotedSpans reads straight and curly quotes', () => {
  assert.deepEqual(
    extractQuotedSpans('He says "Call me Ishmael." Later \u201CSome years ago\u201D.'),
    ['Call me Ishmael.', 'Some years ago']
  );
});

test('groundCitations exact-matches quotes and dedups identical quotes', () => {
  const citations = groundCitations(
    'The narrator says "Call me Ishmael." He repeats "Call me Ishmael."',
    MARKED
  );
  assert.deepEqual(citations, [{ page: 1, quote: 'Call me Ishmael.' }]);
});

test('groundCitations keeps two quotes on the same page', () => {
  const citations = groundCitations(
    'He says "Call me Ishmael." Then "I stuffed a shirt or two into my old carpet-bag."',
    MARKED
  );
  assert.deepEqual(citations, [
    { page: 1, quote: 'Call me Ishmael.' },
    { page: 1, quote: 'I stuffed a shirt or two into my old carpet-bag.' },
  ]);
});

test('groundCitations fuzzy-matches collapsed whitespace', () => {
  const citations = groundCitations(
    'He opens with "Call  me   Ishmael."',
    MARKED
  );
  assert.equal(citations.length, 1);
  assert.equal(citations[0].page, 1);
});

test('groundCitations omits quotes that do not appear in the Book context', () => {
  const citations = groundCitations(
    'Totally invented: "the purple whale danced on Mars."',
    MARKED
  );
  assert.deepEqual(citations, []);
});

test('groundCitations does not invent pages when the blob is unmarked', () => {
  const citations = groundCitations(
    'He says "Call me Ishmael."',
    'Call me Ishmael.\n\nSome years ago'
  );
  assert.deepEqual(citations, []);
});

test('groundCitations uses Explain fallback when grounding is empty', () => {
  const citations = groundCitations('No quotes here.', MARKED, {
    fallback: { page: 12, quote: 'selected passage' },
  });
  assert.deepEqual(citations, [{ page: 12, quote: 'selected passage' }]);
});

test('groundCitations ignores fallback when a quote already grounded', () => {
  const citations = groundCitations('He says "Call me Ishmael."', MARKED, {
    fallback: { page: 12, quote: 'selected passage' },
  });
  assert.deepEqual(citations, [{ page: 1, quote: 'Call me Ishmael.' }]);
});
