import { BaseProvider, getOpenAILikeModel } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';

interface FuturMixModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

interface FuturMixModelsResponse {
  object: string;
  data: FuturMixModel[];
}

export default class FuturMixProvider extends BaseProvider {
  name = 'FuturMix';
  getApiKeyLink = 'https://futurmix.ai';

  config = {
    apiTokenKey: 'FUTURMIX_API_KEY',
    baseUrl: 'https://futurmix.ai/v1',
  };

  staticModels: ModelInfo[] = [
    {
      name: 'claude-4-opus-20250514',
      label: 'Claude 4 Opus',
      provider: 'FuturMix',
      maxTokenAllowed: 200000,
    },
    {
      name: 'claude-sonnet-4-5-20250929',
      label: 'Claude Sonnet 4.5',
      provider: 'FuturMix',
      maxTokenAllowed: 200000,
    },
    {
      name: 'gpt-4o',
      label: 'GPT-4o',
      provider: 'FuturMix',
      maxTokenAllowed: 128000,
    },
    {
      name: 'gpt-4o-mini',
      label: 'GPT-4o Mini',
      provider: 'FuturMix',
      maxTokenAllowed: 128000,
    },
    {
      name: 'gemini-2.5-pro-exp-03-25',
      label: 'Gemini 2.5 Pro',
      provider: 'FuturMix',
      maxTokenAllowed: 2097152,
    },
    {
      name: 'gemini-2.5-flash-exp-03-25',
      label: 'Gemini 2.5 Flash',
      provider: 'FuturMix',
      maxTokenAllowed: 1048576,
    },
    {
      name: 'deepseek-chat',
      label: 'DeepSeek Chat',
      provider: 'FuturMix',
      maxTokenAllowed: 64000,
    },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]> {
    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'FUTURMIX_API_KEY',
    });

    if (!apiKey) {
      return [];
    }

    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        signal: this.createTimeoutSignal(5000),
      });

      if (!response.ok) {
        console.error(`FuturMix API error: ${response.statusText}`);
        return [];
      }

      const data = (await response.json()) as FuturMixModelsResponse;
      const staticModelIds = this.staticModels.map((m) => m.name);

      // Filter out models we already have in staticModels
      const dynamicModels =
        data.data
          ?.filter((model: any) => !staticModelIds.includes(model.id))
          .map((m: any) => ({
            name: m.id,
            label: `${m.id} (Dynamic)`,
            provider: this.name,
            maxTokenAllowed: 128000, // Default context window
          })) || [];

      return dynamicModels;
    } catch (error) {
      console.error(`Failed to fetch FuturMix models:`, error);
      return [];
    }
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'FUTURMIX_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    return getOpenAILikeModel(baseUrl!, apiKey, model);
  }
}
