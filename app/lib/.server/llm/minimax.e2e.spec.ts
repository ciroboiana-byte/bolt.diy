import { describe, expect, it } from 'vitest';
import { env } from 'node:process';

const API_KEY = env.MINIMAX_API_KEY;
const BASE_URL = env.MINIMAX_BASE_URL || 'https://api.minimax.io/v1';

describe.skipIf(!API_KEY)('MiniMax E2E', () => {
  it(
    'completes basic chat with MiniMax-M2.5',
    async () => {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: 'MiniMax-M2.5',
          messages: [{ role: 'user', content: 'Say "test passed"' }],
          max_tokens: 20,
          temperature: 1.0,
        }),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();

      expect(data.choices).toBeDefined();
      expect(data.choices[0].message.content).toBeTruthy();
    },
    30000,
  );

  it(
    'handles streaming response',
    async () => {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: 'MiniMax-M2.5',
          messages: [{ role: 'user', content: 'Count 1 to 3' }],
          max_tokens: 50,
          stream: true,
          temperature: 1.0,
        }),
      });

      expect(response.ok).toBe(true);

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let chunks = 0;
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data:') && !line.includes('[DONE]')) {
            chunks++;
          }
        }
      }

      expect(chunks).toBeGreaterThan(1);
    },
    30000,
  );

  it(
    'works with MiniMax-M2.5-highspeed model',
    async () => {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: 'MiniMax-M2.5-highspeed',
          messages: [{ role: 'user', content: 'Say "highspeed test passed"' }],
          max_tokens: 20,
          temperature: 1.0,
        }),
      });

      expect(response.ok).toBe(true);

      const data = await response.json();

      expect(data.choices).toBeDefined();
      expect(data.choices[0].message.content).toBeTruthy();
    },
    30000,
  );
});
