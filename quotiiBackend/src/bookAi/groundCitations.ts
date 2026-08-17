/**
 * Ground assistant quotes against stamped Book context page markers.
 * Model page numbers are never the tap target — only quote matches are.
 */

export const MAX_CITATIONS = 5;
export const MIN_QUOTE_LEN = 8;
export const MAX_QUOTE_LEN = 400;

export type Citation = {
  page: number;
  quote: string;
};

const PAGE_MARKER = /<!--\s*page:(\d+)\s*-->/g;
const STRAIGHT_QUOTE = /"([^"\n]{8,400})"/g;
const CURLY_QUOTE = /\u201C([^\u201D\n]{8,400})\u201D/g;

export type PageSlice = {
  page: number;
  text: string;
};

/** Split Book context on `<!-- page:N -->`. Empty when the blob has no markers. */
export function parsePageMap(bookContext: string): PageSlice[] {
  const text = bookContext || '';
  const slices: PageSlice[] = [];
  let match: RegExpExecArray | null;
  const starts: Array<{ page: number; index: number; end: number }> = [];
  PAGE_MARKER.lastIndex = 0;
  while ((match = PAGE_MARKER.exec(text)) != null) {
    starts.push({
      page: Number(match[1]),
      index: match.index,
      end: match.index + match[0].length,
    });
  }
  for (let i = 0; i < starts.length; i++) {
    const cur = starts[i];
    if (!Number.isFinite(cur.page) || cur.page < 1) continue;
    const next = starts[i + 1];
    const body = text.slice(cur.end, next ? next.index : text.length);
    slices.push({ page: cur.page, text: body });
  }
  return slices;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function extractQuotedSpans(answer: string): string[] {
  const spans: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    const quote = raw.trim();
    if (quote.length < MIN_QUOTE_LEN) return;
    const key = normalize(quote);
    if (!key || seen.has(key)) return;
    seen.add(key);
    spans.push(quote.length > MAX_QUOTE_LEN ? quote.slice(0, MAX_QUOTE_LEN) : quote);
  };
  STRAIGHT_QUOTE.lastIndex = 0;
  CURLY_QUOTE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = STRAIGHT_QUOTE.exec(answer || '')) != null) {
    push(match[1]);
  }
  while ((match = CURLY_QUOTE.exec(answer || '')) != null) {
    push(match[1]);
  }
  return spans;
}

function matchQuoteToPage(quote: string, pages: PageSlice[]): PageSlice | null {
  for (const page of pages) {
    if (page.text.includes(quote)) return page;
  }
  const folded = normalize(quote);
  if (folded.length < MIN_QUOTE_LEN) return null;
  for (const page of pages) {
    if (normalize(page.text).includes(folded)) return page;
  }
  if (folded.length > 80) {
    const head = folded.slice(0, 80);
    for (const page of pages) {
      if (normalize(page.text).includes(head)) return page;
    }
  }
  return null;
}

function validFallback(fallback: Citation | null | undefined): Citation | null {
  if (!fallback) return null;
  const page = fallback.page;
  const quote = (fallback.quote || '').trim();
  if (!Number.isFinite(page) || page < 1 || quote.length < 1) return null;
  return {
    page,
    quote: quote.length > MAX_QUOTE_LEN ? quote.slice(0, MAX_QUOTE_LEN) : quote,
  };
}

/**
 * Exact-then-fuzzy quote match, cap 5, dedup by quote.
 * Unmarked blobs yield no matches (caller may pass Explain fallback).
 */
export function groundCitations(
  answer: string,
  bookContext: string,
  options?: { fallback?: Citation | null }
): Citation[] {
  const pages = parsePageMap(bookContext);
  const found: Citation[] = [];
  const seenQuotes = new Set<string>();

  if (pages.length > 0) {
    for (const quote of extractQuotedSpans(answer)) {
      if (found.length >= MAX_CITATIONS) break;
      const key = normalize(quote);
      if (!key || seenQuotes.has(key)) continue;
      const hit = matchQuoteToPage(quote, pages);
      if (!hit) continue;
      seenQuotes.add(key);
      found.push({ page: hit.page, quote });
    }
  }

  if (found.length === 0) {
    const fallback = validFallback(options?.fallback);
    return fallback ? [fallback] : [];
  }
  return found;
}
