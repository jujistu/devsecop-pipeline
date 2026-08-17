export {
  assembleExplainContext,
  MAX_SELECTED_TEXT,
  MAX_SURROUNDING_TEXT,
  MAX_USER_QUESTION,
  type ExplainEvidence,
  type AssembledExplainContext,
} from './assembleExplainContext';
export {
  createExplainHandler,
  type ExplainHandlerDeps,
  type ExplainAuthUser,
} from './explainHandler';
export {
  assembleAskContext,
  trimAskWindow,
  trimPriorAskMessages,
  MAX_ASK_MESSAGES,
  MAX_MESSAGE_CONTENT,
  MAX_BOOK_CONTEXT,
  MAX_USER_MESSAGE,
  type AskChatRole,
  type AskChatMessage,
  type AskRequestInput,
  type AssembledAskContext,
} from './assembleAskContext';
export {
  createAskHandler,
  type AskHandlerDeps,
  type AskAuthUser,
} from './askHandler';
export {
  assembleSummaryContext,
  MAX_BOOK_CONTEXT as MAX_SUMMARY_BOOK_CONTEXT,
  type AssembledSummaryContext,
} from './assembleSummaryContext';
export {
  createSummaryHandler,
  type SummaryHandlerDeps,
  type SummaryAuthUser,
} from './summaryHandler';
export {
  createBookIndex,
  notReadyMessage,
  type BookIndex,
  type BookIndexDeps,
  type BookIndexRow,
  type BookIndexNotReady,
  type BookIndexResolveResult,
} from './bookIndex';
export {
  groundCitations,
  parsePageMap,
  extractQuotedSpans,
  MAX_CITATIONS,
  type Citation,
} from './groundCitations';
export type { LlmClient, LlmMessage, LlmStreamRequest } from './llm/llm.interface';
export { FakeLlm } from './llm/fakeLlm';
export { DeepSeekLlm } from './llm/deepseekLlm';
