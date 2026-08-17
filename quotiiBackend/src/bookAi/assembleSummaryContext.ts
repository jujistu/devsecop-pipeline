/**
 * Chapter-to-chapter Summary assembler (ADR 0005, 0011).
 *
 * On-demand only: Book context from ObjectStore becomes the system prefix;
 * the user turn asks for a detailed chapter-to-chapter summary.
 */

export const MAX_BOOK_CONTEXT = 120_000;

export type AssembledSummaryContext = {
  systemPrompt: string;
  userPrompt: string;
  documentId: string;
  jobId: string;
};

const SYSTEM_PREFIX =
  'You write a detailed chapter-to-chapter summary of a book using only the ' +
  'Book context below. Walk through the book in order (chapter by chapter, ' +
  'or section by section when chapters are unclear). Be clear and thorough. ' +
  'Do not invent chapters or facts that are not supported by the Book context.\n\n' +
  '--- Book context ---\n';

const USER_PROMPT =
  'Please provide a detailed chapter-to-chapter summary of this book.';

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

/**
 * Build Summary prompts from Book context (ObjectStore).
 */
export function assembleSummaryContext(input: {
  bookContext: string;
  documentId: string;
  jobId: string;
  title?: string | null;
  author?: string | null;
}): AssembledSummaryContext {
  const contextBody = truncate(
    (input.bookContext || '').trim(),
    MAX_BOOK_CONTEXT
  );
  if (!contextBody) {
    throw new Error('Book context is empty');
  }

  let systemPrompt = SYSTEM_PREFIX + contextBody;
  if (input.title) {
    systemPrompt =
      `Book title: ${input.title}\n` +
      (input.author ? `Author: ${input.author}\n` : '') +
      '\n' +
      systemPrompt;
  }

  return {
    systemPrompt,
    userPrompt: USER_PROMPT,
    documentId: input.documentId,
    jobId: input.jobId,
  };
}
