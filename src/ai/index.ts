export { openai, aiLogger } from './openai-client';
export { AI_HELPER_CONFIG } from './config';
export {
  acquireRateLimitSlot,
  resetUserRateLimit,
  getRateLimitStatus,
  isAiHelperDisabled,
  enableAiHelper,
  disableAiHelper,
  type RateLimitResult,
} from './rate-limiter';
export { guardMessage, getGuardErrorMessage, type GuardResult } from './prompt-guard';
export {
  processMessage,
  shouldRespond,
  formatResponse,
  type AiHelperResponse,
} from './ai-helper.service';
export {
  createVectorStore,
  uploadKnowledgeBase,
  getVectorStoreInfo,
  initializeVectorStore,
  clearVectorStoreFiles,
} from './vector-store';
export {
  addTempInfo,
  removeTempInfo,
  getTempInfo,
  listTempInfo,
  getTempInfoForPrompt,
  getTempInfoStats,
  MAX_TEMP_INFO_ENTRIES,
  MAX_TEMP_INFO_LENGTH,
  type TempInfo,
} from './temp-info';
export { fetchConversationContext } from './context';
