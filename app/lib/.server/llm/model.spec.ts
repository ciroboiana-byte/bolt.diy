import { describe, expect, it, vi } from 'vitest';

// Mock @ai-sdk/anthropic
vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn((config: { apiKey: string }) => {
    return vi.fn((modelId: string) => ({
      provider: 'anthropic',
      modelId,
      apiKey: config.apiKey,
    }));
  }),
}));

// Mock @ai-sdk/openai
vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn((config: { apiKey: string; baseURL: string }) => {
    return vi.fn((modelId: string) => ({
      provider: 'openai-compatible',
      modelId,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    }));
  }),
}));

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { getAnthropicModel, getMiniMaxModel, getModel } from './model';

describe('model', () => {
  describe('getAnthropicModel', () => {
    it('creates Anthropic model with correct apiKey', () => {
      const model = getAnthropicModel('test-anthropic-key');

      expect(createAnthropic).toHaveBeenCalledWith({ apiKey: 'test-anthropic-key' });
      expect(model).toBeDefined();
    });

    it('uses claude-3-5-sonnet-20240620 model', () => {
      getAnthropicModel('test-key');

      const mockFn = vi.mocked(createAnthropic).mock.results[0].value;
      expect(mockFn).toHaveBeenCalledWith('claude-3-5-sonnet-20240620');
    });
  });

  describe('getMiniMaxModel', () => {
    it('creates MiniMax model with correct apiKey and default baseURL', () => {
      const model = getMiniMaxModel('test-minimax-key');

      expect(createOpenAI).toHaveBeenCalledWith({
        apiKey: 'test-minimax-key',
        baseURL: 'https://api.minimax.io/v1',
      });
      expect(model).toBeDefined();
    });

    it('uses custom baseURL when provided', () => {
      getMiniMaxModel('test-key', 'https://api.minimaxi.com/v1');

      expect(createOpenAI).toHaveBeenCalledWith({
        apiKey: 'test-key',
        baseURL: 'https://api.minimaxi.com/v1',
      });
    });

    it('uses MiniMax-M2.7 model', () => {
      getMiniMaxModel('test-key');

      const mockFn = vi.mocked(createOpenAI).mock.results[0].value;
      expect(mockFn).toHaveBeenCalledWith('MiniMax-M2.7');
    });
  });

  describe('getModel', () => {
    it('returns Anthropic model for anthropic provider', () => {
      const model = getModel('anthropic', 'test-key');

      expect(createAnthropic).toHaveBeenCalled();
      expect(model).toBeDefined();
    });

    it('returns MiniMax model for minimax provider', () => {
      const model = getModel('minimax', 'test-key');

      expect(createOpenAI).toHaveBeenCalled();
      expect(model).toBeDefined();
    });

    it('defaults to Anthropic for unknown provider', () => {
      const model = getModel('anthropic', 'test-key');

      expect(createAnthropic).toHaveBeenCalled();
      expect(model).toBeDefined();
    });

    it('passes baseURL for MiniMax', () => {
      getModel('minimax', 'test-key', 'https://custom.api.com/v1');

      expect(createOpenAI).toHaveBeenCalledWith({
        apiKey: 'test-key',
        baseURL: 'https://custom.api.com/v1',
      });
    });
  });
});
