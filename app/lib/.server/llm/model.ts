import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';

export type LLMProvider = 'anthropic' | 'minimax';

export function getAnthropicModel(apiKey: string) {
  const anthropic = createAnthropic({
    apiKey,
  });

  return anthropic('claude-3-5-sonnet-20240620');
}

export function getMiniMaxModel(apiKey: string, baseURL?: string) {
  const openai = createOpenAI({
    apiKey,
    baseURL: baseURL || 'https://api.minimax.io/v1',
  });

  return openai('MiniMax-M2.5');
}

export function getModel(provider: LLMProvider, apiKey: string, baseURL?: string) {
  switch (provider) {
    case 'minimax':
      return getMiniMaxModel(apiKey, baseURL);
    case 'anthropic':
    default:
      return getAnthropicModel(apiKey);
  }
}
