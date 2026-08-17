/**
 * Ask / Book chat context assembler (ADR 0011, 0016).
 *
 * History-stateless: the client sends the conversation window for this turn.
 * Book context from ObjectStore is the stable system prefix; chat turns follow.
 * Server does not persist transcripts.
 */

export const MAX_ASK_MESSAGES = 20;
export const MAX_MESSAGE_CONTENT = 4_000;
export const MAX_BOOK_CONTEXT = 120_000;
export const MAX_USER_MESSAGE = 4_000;

export type AskChatRole = 'user' | 'assistant';

export type AskChatMessage = {
  role: AskChatRole;
  content: string;
};

export type AskRequestInput = {
  documentId?: string;
  jobId?: string;
  /** Prior turns (oldest → newest). Trimmed server-side if huge. */
  messages?: AskChatMessage[];
  userMessage: string;
};

export type AssembledAskContext = {
  systemPrompt: string;
  /** Prior window + the new user message, ready for the LLM. */
  messages: AskChatMessage[];
  documentId: string;
  jobId: string;
};

const SYSTEM_PREFIX =
  'You answer questions about a book using only the Book context below. ' +
  'Be clear and concise. If the context does not support an answer, say so. ' +
  'Do not invent facts that are not in the Book context. ' +
  'When you support a claim, include a short verbatim quote from the Book context in double quotes. ' +
  'Do not invent page numbers.\n\n' +
  '--- Book context ---\n';

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max);
}

function normalizeRole(role: unknown): AskChatRole | null {
  if (role === 'user' || role === 'assistant') return role;
  return null;
}

/**
 * Cap prior messages to the last N turns and truncate oversized content.
 * Does not include the new user turn (Explain keeps a longer passage prompt).
 */
export function trimPriorAskMessages(
  messages: AskChatMessage[] | undefined
): AskChatMessage[] {
  return (messages ?? [])
    .map((m) => {
      const role = normalizeRole(m?.role);
      if (!role || typeof m?.content !== 'string') return null;
      const content = truncate(m.content.trim(), MAX_MESSAGE_CONTENT);
      if (!content) return null;
      return { role, content } as AskChatMessage;
    })
    .filter((m): m is AskChatMessage => m != null)
    .slice(-MAX_ASK_MESSAGES);
}

/**
 * Cap prior messages to the last N turns and append the new user turn.
 */
export function trimAskWindow(
  messages: AskChatMessage[] | undefined,
  userMessage: string
): AskChatMessage[] {
  const nextUser = truncate(userMessage.trim(), MAX_USER_MESSAGE);
  return [...trimPriorAskMessages(messages), { role: 'user', content: nextUser }];
}

/**
 * Build Ask prompts from Book context (ObjectStore) + client conversation window.
 */
export function assembleAskContext(input: {
  bookContext: string;
  documentId: string;
  jobId: string;
  messages?: AskChatMessage[];
  userMessage: string;
  title?: string | null;
  author?: string | null;
}): AssembledAskContext {
  const userMessage = input.userMessage?.trim();
  if (!userMessage) {
    throw new Error('userMessage is required');
  }

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
    messages: trimAskWindow(input.messages, userMessage),
    documentId: input.documentId,
    jobId: input.jobId,
  };
}
