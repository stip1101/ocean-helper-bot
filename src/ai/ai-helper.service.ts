import type { Message } from 'discord.js';
import OpenAI from 'openai';
import { openai, aiLogger } from './openai-client';
import { AI_HELPER_CONFIG } from './config';
import { acquireRateLimitSlot, type RateLimitResult } from './rate-limiter';
import { guardMessage, getGuardErrorMessage, type GuardResult } from './prompt-guard';
import { getTempInfoForPrompt } from './temp-info';
import { fetchConversationContext } from './context';

const OPENAI_TIMEOUT_MS = 30000;

const MENTION_REGEX = /<@!?\d+>/g;

export interface AiHelperResponse {
  success: boolean;
  message?: string;
  error?: string;
  rateLimitInfo?: RateLimitResult;
}

export function shouldRespond(message: Message, botId: string): boolean {
  if (message.mentions.has(botId)) {
    return true;
  }

  if (message.reference) {
    return false;
  }

  const content = message.content.toLowerCase().trim();

  const textOnly = content.replace(/https?:\/\/\S+/gi, '').trim();

  if (!textOnly) {
    return false;
  }

  const isQuestion =
    textOnly.includes('?') ||
    textOnly.startsWith('how') ||
    textOnly.startsWith('what') ||
    textOnly.startsWith('where') ||
    textOnly.startsWith('why') ||
    textOnly.startsWith('when') ||
    textOnly.startsWith('who') ||
    textOnly.startsWith('which') ||
    textOnly.startsWith('can i') ||
    textOnly.startsWith('can you') ||
    textOnly.startsWith('is there') ||
    textOnly.startsWith('are there') ||
    textOnly.startsWith('do i') ||
    textOnly.startsWith('does');

  if (!isQuestion) {
    return false;
  }

  const hasKeyword = AI_HELPER_CONFIG.programKeywords.some((keyword) =>
    textOnly.includes(keyword.toLowerCase())
  );

  return hasKeyword;
}

function getRateLimitErrorMessage(result: RateLimitResult): string {
  switch (result.reason) {
    case 'disabled':
      return '🔒 AI helper is temporarily disabled. Please try again later.';
    case 'cooldown':
      return `⏳ Please wait ${result.resetInSeconds} seconds before your next question.`;
    case 'rate_limit':
      return `🚫 You've reached the request limit. Try again in ${result.resetInSeconds} seconds.`;
    default:
      return '❌ An error occurred. Please try again later.';
  }
}

export async function processMessage(message: Message, botId: string): Promise<AiHelperResponse> {
  const userId = message.author.id;

  if (!openai) {
    aiLogger.error('OpenAI client not initialized - API key missing');
    return {
      success: false,
      error: '⚙️ AI helper is not configured. Please contact an administrator.',
    };
  }

  const rateLimitResult = await acquireRateLimitSlot(userId);
  if (!rateLimitResult.allowed) {
    return {
      success: false,
      error: getRateLimitErrorMessage(rateLimitResult),
      rateLimitInfo: rateLimitResult,
    };
  }

  let content = message.content.replace(MENTION_REGEX, '').trim();

  if (!content) {
    return {
      success: false,
      error: '❓ Please ask a question after mentioning the bot.',
    };
  }

  const guardResult: GuardResult = guardMessage(content);
  if (!guardResult.safe || !guardResult.sanitizedMessage) {
    return {
      success: false,
      error: getGuardErrorMessage(guardResult.reason),
    };
  }

  const sanitizedContent = guardResult.sanitizedMessage;

  const vectorStoreId = AI_HELPER_CONFIG.vectorStoreId;
  if (!vectorStoreId) {
    aiLogger.error('Vector store ID not configured');
    return {
      success: false,
      error: '⚙️ AI helper is not configured. Please contact an administrator.',
    };
  }

  try {
    aiLogger.info({ userId, contentLength: sanitizedContent.length }, 'Processing AI request');

    const tempInfo = await getTempInfoForPrompt();
    const systemPrompt = tempInfo
      ? `${AI_HELPER_CONFIG.systemPrompt}\n\nCURRENT UPDATES:\n${tempInfo}`
      : AI_HELPER_CONFIG.systemPrompt;

    // Fetch conversation context for follow-up questions
    const conversationContext = await fetchConversationContext(message, botId);
    const input = conversationContext
      ? `${conversationContext}${sanitizedContent}`
      : sanitizedContent;

    // Build request params — reasoning models don't support temperature
    const requestParams: OpenAI.Responses.ResponseCreateParams = {
      model: AI_HELPER_CONFIG.model,
      instructions: systemPrompt,
      input,
      max_output_tokens: AI_HELPER_CONFIG.maxTokens,
      tools: [
        {
          type: 'file_search',
          vector_store_ids: [vectorStoreId],
        },
      ],
    };

    const response = await openai.responses.create(requestParams, {
      timeout: OPENAI_TIMEOUT_MS,
    });

    const outputText = response.output_text;

    if (!outputText || outputText.trim().length === 0) {
      aiLogger.warn({ userId }, 'Empty response from OpenAI');
      return {
        success: false,
        error: "🤔 I couldn't find an answer to your question. Please try rephrasing it.",
      };
    }

    aiLogger.info(
      { userId, responseLength: outputText.length },
      'AI request processed successfully'
    );

    return {
      success: true,
      message: outputText,
      rateLimitInfo: rateLimitResult,
    };
  } catch (error) {
    aiLogger.error({ err: error, userId }, 'OpenAI API error');

    if (error instanceof OpenAI.RateLimitError) {
      return {
        success: false,
        error: '⚠️ Too many AI requests globally. Please try again in a minute.',
      };
    }

    if (error instanceof OpenAI.BadRequestError) {
      return {
        success: false,
        error: '📝 Your message could not be processed. Please try rephrasing it.',
      };
    }

    if (error instanceof OpenAI.AuthenticationError) {
      aiLogger.error('OpenAI authentication failed - check API key');
      return {
        success: false,
        error: '⚙️ AI helper configuration error. Please contact an administrator.',
      };
    }

    if (error instanceof OpenAI.APIConnectionError) {
      return {
        success: false,
        error: '🌐 Could not connect to AI service. Please try again later.',
      };
    }

    if (error instanceof OpenAI.APIError) {
      if (error.message.includes('timeout') || error.message.includes('ETIMEDOUT')) {
        return {
          success: false,
          error: '⏱️ AI request timed out. Please try a shorter question.',
        };
      }
    }

    return {
      success: false,
      error: '❌ An error occurred while processing your request. Please try again later.',
    };
  }
}

export function formatResponse(response: string, remaining?: number): string {
  const MAX_LENGTH = 1850;
  let formatted = response;

  if (formatted.length > MAX_LENGTH) {
    formatted = formatted.slice(0, MAX_LENGTH - 50) + '\n\n*...response was truncated*';
  }

  if (remaining !== undefined && remaining <= 3) {
    formatted += `\n\n*Requests remaining: ${remaining}/${AI_HELPER_CONFIG.rateLimitRequests}*`;
  }

  return formatted;
}
