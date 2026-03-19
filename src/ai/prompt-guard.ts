import { AI_HELPER_CONFIG } from './config';
import { aiLogger } from './openai-client';

export interface GuardResult {
  safe: boolean;
  reason?: 'injection' | 'offensive' | 'too_long';
  sanitizedMessage?: string;
}

function normalizeUnicode(text: string): string {
  return (
    text
      .normalize('NFKC')
      .replace(/[\u0430\u0410]/g, 'a')
      .replace(/[\u0435\u0415]/g, 'e')
      .replace(/[\u0456\u0406\u0457\u0407]/g, 'i')
      .replace(/[\u043E\u041E]/g, 'o')
      .replace(/[\u0440\u0420]/g, 'p')
      .replace(/[\u0441\u0421]/g, 'c')
      .replace(/[\u0443\u0423]/g, 'y')
      .replace(/[\u0445\u0425]/g, 'x')
      .replace(/[\u0455]/g, 's')
      .replace(/[\u0458]/g, 'j')
      .replace(/[\u0422\u0442]/g, 't')
      .replace(/[\u041C\u043C]/g, 'm')
      .replace(/[\u041D\u043D]/g, 'n')
      .replace(/[\u041A\u043A]/g, 'k')
      .replace(/[\u0412\u0432]/g, 'b')
      .replace(/[\u03B1\u0391]/g, 'a')
      .replace(/[\u03B5\u0395]/g, 'e')
      .replace(/[\u03B9\u0399]/g, 'i')
      .replace(/[\u03BF\u039F]/g, 'o')
      .replace(/[\u03C1\u03A1]/g, 'p')
      .replace(/[\u03C5\u03A5]/g, 'y')
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      .replace(/[\u00A0]/g, ' ')
      .toLowerCase()
  );
}

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /disregard\s+(all\s+)?(previous|prior|above)/i,
  /forget\s+(everything|all|your)\s+(instructions?|rules?|prompts?)/i,
  /you\s+are\s+(now|no longer)\s+a/i,
  /pretend\s+(to\s+be|you're|you\s+are)/i,
  /act\s+as\s+(if|a|an)/i,
  /roleplay\s+as/i,
  /from\s+now\s+on\s+(you|your)/i,
  /what\s+(is|are)\s+your\s+(system\s+)?(prompt|instructions?|rules?)/i,
  /show\s+(me\s+)?your\s+(system\s+)?(prompt|instructions?)/i,
  /reveal\s+your\s+(system\s+)?(prompt|instructions?)/i,
  /print\s+your\s+(system\s+)?(prompt|instructions?)/i,
  /\bdan\s+mode\b/i,
  /\bdeveloper\s+mode\b/i,
  /\bunlocked\s+mode\b/i,
  /\bjailbreak\b/i,
  /\bbypass\s+(filter|safety|restrictions?)\b/i,
  /execute\s+(this\s+)?(code|command|script)/i,
  /run\s+(this\s+)?(code|command|script)/i,
  /eval\s*\(/i,
  /\$\{[^}]*\}/i,
  /```\s*system/i,
  /\[system\]/i,
  /<system>/i,
];

const OFFENSIVE_PATTERNS = [
  /\b(n[i1]gg[ae3]r?s?|f[a4]gg?[o0]ts?|k[i1]k[e3]s?|sp[i1]cs?|ch[i1]nks?)\b/i,
  /\b(k[i1]ll\s+(yourself|urself|u)|murder|bomb\s+threat)\b/i,
  /(https?:\/\/\S+\s*){5,}/,
];

function hasExcessiveRepeats(text: string): boolean {
  const MAX_CHECK_LENGTH = 2000;
  const checkText = text.slice(0, MAX_CHECK_LENGTH);

  let count = 1;
  for (let i = 1; i < checkText.length; i++) {
    if (checkText[i] === checkText[i - 1]) {
      count++;
      if (count > 10) return true;
    } else {
      count = 1;
    }
  }
  return false;
}

function containsInjection(message: string): boolean {
  const normalized = normalizeUnicode(message);
  return INJECTION_PATTERNS.some((pattern) => pattern.test(normalized));
}

function containsOffensiveContent(message: string): boolean {
  const normalized = normalizeUnicode(message);
  if (hasExcessiveRepeats(message)) {
    return true;
  }
  return OFFENSIVE_PATTERNS.some((pattern) => pattern.test(normalized));
}

function sanitizeMessage(message: string): string {
  let sanitized = message.replace(/\s+/g, ' ').trim();

  if (sanitized.length > AI_HELPER_CONFIG.maxMessageLength) {
    sanitized = sanitized.slice(0, AI_HELPER_CONFIG.maxMessageLength);
  }

  sanitized = sanitized.replace(/```[\s\S]*?```/g, '[code removed]');

  return sanitized;
}

export function guardMessage(message: string): GuardResult {
  if (message.length > AI_HELPER_CONFIG.maxMessageLength * 2) {
    aiLogger.warn({ length: message.length }, 'Message too long, rejected');
    return { safe: false, reason: 'too_long' };
  }

  if (containsInjection(message)) {
    aiLogger.warn({ length: message.length }, 'Injection attempt detected');
    return { safe: false, reason: 'injection' };
  }

  if (containsOffensiveContent(message)) {
    aiLogger.warn({ length: message.length }, 'Offensive content detected');
    return { safe: false, reason: 'offensive' };
  }

  return {
    safe: true,
    sanitizedMessage: sanitizeMessage(message),
  };
}

export function getGuardErrorMessage(reason: GuardResult['reason']): string {
  switch (reason) {
    case 'injection':
      return '🚫 Your message contains patterns that I cannot process. Please rephrase your question.';
    case 'offensive':
      return '🚫 Please keep our community respectful. I cannot respond to this message.';
    case 'too_long':
      return `🚫 Your message is too long. Please keep it under ${AI_HELPER_CONFIG.maxMessageLength} characters.`;
    default:
      return '🚫 I cannot process this message. Please try again.';
  }
}
