import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { env } from 'node:process';
import { getAPIKey, getMiniMaxAPIKey, getLLMProvider, getProviderAPIKey } from './api-key';

describe('api-key', () => {
  const savedAnthropicKey = env.ANTHROPIC_API_KEY;
  const savedMiniMaxKey = env.MINIMAX_API_KEY;
  const savedProvider = env.DEFAULT_LLM_PROVIDER;

  beforeEach(() => {
    delete env.ANTHROPIC_API_KEY;
    delete env.MINIMAX_API_KEY;
    delete env.DEFAULT_LLM_PROVIDER;
  });

  afterEach(() => {
    // Restore original values
    if (savedAnthropicKey !== undefined) {
      env.ANTHROPIC_API_KEY = savedAnthropicKey;
    } else {
      delete env.ANTHROPIC_API_KEY;
    }

    if (savedMiniMaxKey !== undefined) {
      env.MINIMAX_API_KEY = savedMiniMaxKey;
    } else {
      delete env.MINIMAX_API_KEY;
    }

    if (savedProvider !== undefined) {
      env.DEFAULT_LLM_PROVIDER = savedProvider;
    } else {
      delete env.DEFAULT_LLM_PROVIDER;
    }
  });

  const createMockEnv = (overrides: Partial<Env> = {}): Env => ({
    ANTHROPIC_API_KEY: '',
    ...overrides,
  });

  describe('getAPIKey', () => {
    it('returns Anthropic API key from process.env', () => {
      env.ANTHROPIC_API_KEY = 'env-anthropic-key';

      expect(getAPIKey(createMockEnv())).toBe('env-anthropic-key');
    });

    it('falls back to cloudflare env', () => {
      expect(getAPIKey(createMockEnv({ ANTHROPIC_API_KEY: 'cf-key' }))).toBe('cf-key');
    });

    it('prefers process.env over cloudflare env', () => {
      env.ANTHROPIC_API_KEY = 'env-key';

      expect(getAPIKey(createMockEnv({ ANTHROPIC_API_KEY: 'cf-key' }))).toBe('env-key');
    });
  });

  describe('getMiniMaxAPIKey', () => {
    it('returns MiniMax API key from process.env', () => {
      env.MINIMAX_API_KEY = 'env-minimax-key';

      expect(getMiniMaxAPIKey(createMockEnv())).toBe('env-minimax-key');
    });

    it('falls back to cloudflare env', () => {
      const cfEnv = createMockEnv() as Env & { MINIMAX_API_KEY: string };
      cfEnv.MINIMAX_API_KEY = 'cf-minimax-key';

      expect(getMiniMaxAPIKey(cfEnv)).toBe('cf-minimax-key');
    });

    it('returns empty string when not configured', () => {
      expect(getMiniMaxAPIKey(createMockEnv())).toBe('');
    });
  });

  describe('getLLMProvider', () => {
    it('defaults to anthropic', () => {
      expect(getLLMProvider(createMockEnv())).toBe('anthropic');
    });

    it('returns minimax when configured via process.env', () => {
      env.DEFAULT_LLM_PROVIDER = 'minimax';

      expect(getLLMProvider(createMockEnv())).toBe('minimax');
    });

    it('is case-insensitive', () => {
      env.DEFAULT_LLM_PROVIDER = 'MiniMax';

      expect(getLLMProvider(createMockEnv())).toBe('minimax');
    });

    it('falls back to cloudflare env', () => {
      const cfEnv = createMockEnv() as Env & { DEFAULT_LLM_PROVIDER: string };
      cfEnv.DEFAULT_LLM_PROVIDER = 'minimax';

      expect(getLLMProvider(cfEnv)).toBe('minimax');
    });

    it('returns anthropic for unknown providers', () => {
      env.DEFAULT_LLM_PROVIDER = 'unknown-provider';

      expect(getLLMProvider(createMockEnv())).toBe('anthropic');
    });
  });

  describe('getProviderAPIKey', () => {
    it('returns anthropic provider and key by default', () => {
      env.ANTHROPIC_API_KEY = 'anthropic-key';

      const result = getProviderAPIKey(createMockEnv());

      expect(result).toEqual({ provider: 'anthropic', apiKey: 'anthropic-key' });
    });

    it('returns minimax provider and key when configured', () => {
      env.DEFAULT_LLM_PROVIDER = 'minimax';
      env.MINIMAX_API_KEY = 'minimax-key';

      const result = getProviderAPIKey(createMockEnv());

      expect(result).toEqual({ provider: 'minimax', apiKey: 'minimax-key' });
    });
  });
});
