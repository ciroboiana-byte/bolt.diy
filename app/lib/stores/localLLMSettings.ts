import { map } from 'nanostores';
import { providersStore, updateProviderSettings } from './settings';

export type TokenBudget = 'off' | '20k' | '40k' | 'custom';

export interface LocalLLMSettings {
  /** Whether Ollama / LMStudio are enabled in the providers store */
  enableLocalModels: boolean;
  ollamaBaseUrl: string;
  lmstudioBaseUrl: string;

  /** Use the slim system prompt instead of the default */
  slimSystemPrompt: boolean;

  /** Deduplicate file writes — keep only the most-recent write per file path in context */
  dedupFileWrites: boolean;

  /** Strip prose text from older assistant messages, keeping only boltArtifact blocks */
  stripOldProse: boolean;

  /** Disable bolt's context-file-selection pass (recommended for local models) */
  disableContextOptimization: boolean;

  /** Estimated token budget for message-history pruning */
  tokenBudget: TokenBudget;

  /** Used when tokenBudget === 'custom' */
  tokenBudgetCustom: number;

  /** Use a 3-minute stream timeout instead of 45 s — needed for local models with slow TTFT */
  extendedStreamTimeout: boolean;

  /** Block npm install, expo start, and other commands that hang in WebContainer */
  blockHangingCommands: boolean;
}

const STORAGE_KEY = 'local_llm_settings';
const isBrowser = typeof window !== 'undefined';

export const LOCAL_LLM_DEFAULTS: LocalLLMSettings = {
  enableLocalModels: false,
  ollamaBaseUrl: 'http://localhost:11434',
  lmstudioBaseUrl: 'http://localhost:1234',
  slimSystemPrompt: false,
  dedupFileWrites: false,
  stripOldProse: false,
  disableContextOptimization: true,
  tokenBudget: 'off',
  tokenBudgetCustom: 32000,
  extendedStreamTimeout: true,
  blockHangingCommands: true,
};

function loadSettings(): LocalLLMSettings {
  if (!isBrowser) {
    return LOCAL_LLM_DEFAULTS;
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? { ...LOCAL_LLM_DEFAULTS, ...JSON.parse(saved) } : LOCAL_LLM_DEFAULTS;
  } catch {
    return LOCAL_LLM_DEFAULTS;
  }
}

export const localLLMSettingsStore = map<LocalLLMSettings>(loadSettings());

export function updateLocalLLMSettings(patch: Partial<LocalLLMSettings>) {
  const current = localLLMSettingsStore.get();
  const next = { ...current, ...patch };
  localLLMSettingsStore.set(next);

  if (isBrowser) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }

  /*
   * Only sync provider_settings when the user explicitly changes the enable
   * flag or URLs — never on passive reads or other setting changes.
   * This prevents clobbering the user's existing provider config on init.
   */
  if ('enableLocalModels' in patch || 'ollamaBaseUrl' in patch || 'lmstudioBaseUrl' in patch) {
    syncProvidersStore(next);
  }
}

function syncProvidersStore(settings: LocalLLMSettings) {
  const currentProviders = providersStore.get();

  if (currentProviders.Ollama) {
    updateProviderSettings('Ollama', {
      ...currentProviders.Ollama.settings,
      enabled: settings.enableLocalModels,
      baseUrl: settings.ollamaBaseUrl,
    } as any);
  }

  if (currentProviders.LMStudio) {
    updateProviderSettings('LMStudio', {
      ...currentProviders.LMStudio.settings,
      enabled: settings.enableLocalModels,
      baseUrl: settings.lmstudioBaseUrl,
    } as any);
  }
}

/** Returns the numeric token budget, or null if budgeting is off. */
export function getTokenBudget(settings: LocalLLMSettings): number | null {
  switch (settings.tokenBudget) {
    case '20k':
      return 20_000;
    case '40k':
      return 40_000;
    case 'custom':
      return settings.tokenBudgetCustom > 0 ? settings.tokenBudgetCustom : null;
    default:
      return null;
  }
}

/** Rough token estimator: ~4 chars per token */
export function estimateTokens(content: string): number {
  return Math.ceil(content.length / 4);
}
