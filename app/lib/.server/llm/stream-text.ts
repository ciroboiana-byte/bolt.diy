import { streamText as _streamText, convertToCoreMessages } from 'ai';
import { getProviderAPIKey } from '~/lib/.server/llm/api-key';
import { getModel } from '~/lib/.server/llm/model';
import { MAX_TOKENS } from './constants';
import { getSystemPrompt } from './prompts';

interface ToolResult<Name extends string, Args, Result> {
  toolCallId: string;
  toolName: Name;
  args: Args;
  result: Result;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolInvocations?: ToolResult<string, unknown, unknown>[];
}

export type Messages = Message[];

export type StreamingOptions = Omit<Parameters<typeof _streamText>[0], 'model'>;

export function streamText(messages: Messages, env: Env, options?: StreamingOptions) {
  const { provider, apiKey } = getProviderAPIKey(env);

  return _streamText({
    model: getModel(provider, apiKey),
    system: getSystemPrompt(),
    maxTokens: MAX_TOKENS,
    ...(provider === 'anthropic'
      ? {
          headers: {
            'anthropic-beta': 'max-tokens-3-5-sonnet-2024-07-15',
          },
        }
      : {}),
    messages: convertToCoreMessages(messages),
    ...options,
  });
}
