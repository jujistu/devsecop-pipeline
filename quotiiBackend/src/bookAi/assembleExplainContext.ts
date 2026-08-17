/**
 * Explain context assembler (ADR 0015, 0016).
 *
 * Client sends selection evidence + required typed userQuestion + optional
 * prior chat window. Backend builds the model prompt: Book context as the
 * stable system prefix (same blob as Ask), then prior turns, then a user
 * prompt that still carries the selected passage and question.
 */

import {
  MAX_BOOK_CONTEXT,
  trimPriorAskMessages,
  type AskChatMessage,
} from './assembleAskContext';

export const MAX_SELECTED_TEXT = 8_000;
export const MAX_SURROUNDING_TEXT = 4_000;
export const MAX_USER_QUESTION = 4_000;

/** Evidence from the mobile client (Explain request body). */
export type ExplainEvidence = {
  selectedText: string;
  /** Required typed question about the selection (ADR 0015). */
  userQuestion: string;
  surroundingText?: string;
  page?: number;
  documentId?: string;
  title?: string;
  author?: string;
};

export type AssembledExplainContext = {
  systemPrompt: string;
  /** Passage + question for the current user turn. */
  userPrompt: string;
  /** Prior window + current user prompt, ready for the LLM. */
  messages: AskChatMessage[];
  evidence: ExplainEvidence;
};

const SYSTEM_PREFIX =
  "You explain short passages from books in response to the reader's question. " +
  'Use the selected passage first. Use the Book context and prior chat turns when they help. ' +
  'Be clear and concise. If those sources do not support an answer, say so. ' +
  'Do not invent facts that are not in the passage, Book context, or prior turns. ' +
  'When you support a claim, include a short verbatim quote from the Book context in double quotes. ' +
  'Do not invent page numbers.\n\n' +
  '--- Book context ---\n';

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

function capEvidence(evidence: ExplainEvidence): ExplainEvidence {
  const selectedText = truncate(evidence.selectedText.trim(), MAX_SELECTED_TEXT);
  const userQuestion = truncate(
    evidence.userQuestion.trim(),
    MAX_USER_QUESTION
  );
  const surroundingText = evidence.surroundingText
    ? truncate(evidence.surroundingText.trim(), MAX_SURROUNDING_TEXT)
    : undefined;

  return {
    selectedText,
    userQuestion,
    ...(surroundingText ? { surroundingText } : {}),
    ...(evidence.page != null ? { page: evidence.page } : {}),
    ...(evidence.documentId ? { documentId: evidence.documentId } : {}),
    ...(evidence.title ? { title: evidence.title } : {}),
    ...(evidence.author ? { author: evidence.author } : {}),
  };
}

function buildUserPrompt(evidence: ExplainEvidence): string {
  const parts: string[] = [];

  if (evidence.title) {
    parts.push(`Book: ${evidence.title}`);
  }
  if (evidence.author) {
    parts.push(`Author: ${evidence.author}`);
  }
  if (evidence.page != null) {
    parts.push(`Page: ${evidence.page}`);
  }

  parts.push('Selected passage:');
  parts.push(evidence.selectedText);

  if (evidence.surroundingText) {
    parts.push('');
    parts.push('Surrounding context:');
    parts.push(evidence.surroundingText);
  }

  parts.push('');
  parts.push('Reader question:');
  parts.push(evidence.userQuestion);

  return parts.join('\n');
}

/**
 * Build the Explain prompt from Book context + client evidence + prior window.
 * Index readiness is enforced by the handler (BookIndex), not here.
 */
export function assembleExplainContext(
  evidence: ExplainEvidence,
  options: {
    bookContext: string;
    messages?: AskChatMessage[];
  }
): AssembledExplainContext {
  if (!evidence?.selectedText || !evidence.selectedText.trim()) {
    throw new Error('selectedText is required');
  }
  if (!evidence?.userQuestion || !evidence.userQuestion.trim()) {
    throw new Error('userQuestion is required');
  }

  const capped = capEvidence(evidence);
  const contextBody = truncate(
    (options.bookContext || '').trim(),
    MAX_BOOK_CONTEXT
  );
  if (!contextBody) {
    throw new Error('Book context is empty');
  }

  let systemPrompt = SYSTEM_PREFIX + contextBody;
  if (capped.title) {
    systemPrompt =
      `Book title: ${capped.title}\n` +
      (capped.author ? `Author: ${capped.author}\n` : '') +
      '\n' +
      systemPrompt;
  }

  const userPrompt = buildUserPrompt(capped);

  return {
    systemPrompt,
    userPrompt,
    messages: [
      ...trimPriorAskMessages(options.messages),
      { role: 'user', content: userPrompt },
    ],
    evidence: capped,
  };
}
