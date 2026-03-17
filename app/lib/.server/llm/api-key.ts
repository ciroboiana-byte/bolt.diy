import { env } from 'node:process';
import type { LLMProvider } from './model';

export function getAPIKey(cloudflareEnv: Env) {
  /**
   * The `cloudflareEnv` is only used when deployed or when previewing locally.
   * In development the environment variables are available through `env`.
   */
  return env.ANTHROPIC_API_KEY || cloudflareEnv.ANTHROPIC_API_KEY;
}

export function getMiniMaxAPIKey(cloudflareEnv: Env) {
  return env.MINIMAX_API_KEY || cloudflareEnv.MINIMAX_API_KEY || '';
}

export function getLLMProvider(cloudflareEnv: Env): LLMProvider {
  const provider = (env.DEFAULT_LLM_PROVIDER || cloudflareEnv.DEFAULT_LLM_PROVIDER || 'anthropic').toLowerCase();

  if (provider === 'minimax') {
    return 'minimax';
  }

  return 'anthropic';
}

export function getProviderAPIKey(cloudflareEnv: Env): { provider: LLMProvider; apiKey: string } {
  const provider = getLLMProvider(cloudflareEnv);

  switch (provider) {
    case 'minimax':
      return { provider, apiKey: getMiniMaxAPIKey(cloudflareEnv) };
    case 'anthropic':
    default:
      return { provider: 'anthropic', apiKey: getAPIKey(cloudflareEnv) };
  }
}
