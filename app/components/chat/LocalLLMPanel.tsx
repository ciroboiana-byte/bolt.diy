import { useStore } from '@nanostores/react';
import { useRef, useState } from 'react';
import { localLLMSettingsStore, updateLocalLLMSettings, type TokenBudget } from '~/lib/stores/localLLMSettings';
import { classNames } from '~/utils/classNames';

export function LocalLlmPanel() {
  const [isOpen, setIsOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const barRef = useRef<HTMLDivElement>(null);
  const settings = useStore(localLLMSettingsStore);

  const handleToggle = () => {
    if (!isOpen && barRef.current) {
      const rect = barRef.current.getBoundingClientRect();
      setPanelStyle({
        bottom: window.innerHeight - rect.top,
        left: rect.left,
        width: rect.width,

        // Clamp height so panel never overflows above the viewport
        maxHeight: Math.min(rect.top - 8, window.innerHeight * 0.85),
      });
    }

    setIsOpen((o) => !o);
  };

  const toggle = (key: keyof typeof settings) => {
    updateLocalLLMSettings({ [key]: !settings[key] } as any);
  };

  const handleTokenBudget = (value: TokenBudget) => {
    updateLocalLLMSettings({ tokenBudget: value });
  };

  return (
    <div ref={barRef} className="relative border-t border-bolt-elements-borderColor bg-gray-100 dark:bg-gray-900">
      {/* Toggle bar */}
      <button
        onClick={handleToggle}
        className={classNames(
          'w-full flex items-center justify-between px-4 py-2 text-sm',
          'bg-transparent text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary',
          'hover:bg-bolt-elements-background-depth-2 transition-colors',
        )}
      >
        <span className="flex items-center gap-2">
          <span className="i-ph:cpu w-4 h-4" />
          <span>Local Models</span>
          {settings.enableLocalModels && (
            <span className="flex items-center gap-1 text-green-500 text-xs">
              <span className="i-ph:check-circle w-3 h-3" />
              <span>enabled</span>
            </span>
          )}
        </span>
        <span className={classNames('i-ph:caret-down w-4 h-4 transition-transform', isOpen ? 'rotate-180' : '')} />
      </button>

      {/* Expandable panel — floats above the bar, does not push chat layout */}
      {isOpen && (
        <div
          style={panelStyle}
          className={classNames(
            'fixed z-[9999]',
            'mb-1 rounded-xl',
            'bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor',
            'shadow-lg px-4 pb-4 pt-3 flex flex-col gap-3',
            'overflow-y-auto modern-scrollbar',
          )}
        >
          {/* Enable local models */}
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={settings.enableLocalModels}
                onChange={() => toggle('enableLocalModels')}
                className="w-4 h-4 rounded accent-green-500"
              />
              <span className="text-sm text-bolt-elements-textPrimary font-medium">Enable Local Models</span>
              <span className="text-xs text-bolt-elements-textTertiary">(Ollama &amp; LMStudio)</span>
            </label>

            {settings.enableLocalModels && (
              <div className="ml-6 flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-bolt-elements-textTertiary w-20 shrink-0">Ollama URL</span>
                  <input
                    type="text"
                    value={settings.ollamaBaseUrl}
                    onChange={(e) => updateLocalLLMSettings({ ollamaBaseUrl: e.target.value })}
                    onBlur={(e) => updateLocalLLMSettings({ ollamaBaseUrl: e.target.value })}
                    className={classNames(
                      'flex-1 px-2 py-1 text-xs rounded-lg',
                      'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                      'text-bolt-elements-textPrimary',
                      'focus:outline-none focus:ring-1 focus:ring-bolt-elements-focus',
                    )}
                    placeholder="http://localhost:11434"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-bolt-elements-textTertiary w-20 shrink-0">LMStudio URL</span>
                  <input
                    type="text"
                    value={settings.lmstudioBaseUrl}
                    onChange={(e) => updateLocalLLMSettings({ lmstudioBaseUrl: e.target.value })}
                    onBlur={(e) => updateLocalLLMSettings({ lmstudioBaseUrl: e.target.value })}
                    className={classNames(
                      'flex-1 px-2 py-1 text-xs rounded-lg',
                      'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                      'text-bolt-elements-textPrimary',
                      'focus:outline-none focus:ring-1 focus:ring-bolt-elements-focus',
                    )}
                    placeholder="http://localhost:1234"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-bolt-elements-borderColor" />

          {/* Context optimizations — 2-column grid, descriptions as tooltips */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-bolt-elements-textTertiary uppercase tracking-wide">
              Context Optimizations
            </span>

            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {(
                [
                  {
                    key: 'slimSystemPrompt',
                    label: 'Slim system prompt',
                    tip: 'Stripped-down system prompt for models under 13B. Removes WebContainer constraints and verbose copy.',
                  },
                  {
                    key: 'dedupFileWrites',
                    label: 'Dedup file writes',
                    tip: 'Keeps only the most recent write per file in history — removes stale older versions from context.',
                  },
                  {
                    key: 'stripOldProse',
                    label: 'Strip old prose',
                    tip: 'Removes explanation text from older assistant messages, keeping only boltArtifact blocks.',
                  },
                  {
                    key: 'disableContextOptimization',
                    label: 'Skip context pre-pass',
                    tip: 'Skips the LLM file-selection pre-pass entirely. Use if the pre-pass is causing timeouts.',
                  },
                  {
                    key: 'extendedStreamTimeout',
                    label: 'Extended timeout (3 min)',
                    tip: 'Uses 3-minute stream timeout instead of 45 s. Needed for local models with slow startup. Disable for cloud APIs.',
                  },
                  {
                    key: 'blockHangingCommands',
                    label: 'Block install/server cmds',
                    tip: 'Blocks npm install, expo start, yarn, etc. — commands that hang WebContainer. Run them locally instead.',
                  },
                ] as { key: keyof typeof settings; label: string; tip: string }[]
              ).map(({ key, label, tip }) => (
                <label key={key} title={tip} className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!settings[key]}
                    onChange={() => toggle(key)}
                    className="w-4 h-4 rounded accent-green-500 shrink-0"
                  />
                  <span className="text-xs text-bolt-elements-textPrimary leading-tight">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="border-t border-bolt-elements-borderColor" />

          {/* Token budget */}
          <div className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-bolt-elements-textTertiary uppercase tracking-wide">
              Token Budget
              <span className="ml-2 normal-case font-normal text-bolt-elements-textTertiary">
                — prune history when over limit
              </span>
            </span>

            <div className="flex gap-4">
              {(['off', '20k', '40k', 'custom'] as TokenBudget[]).map((val) => (
                <label key={val} className="flex items-center gap-1.5 cursor-pointer select-none">
                  <input
                    type="radio"
                    name="tokenBudget"
                    value={val}
                    checked={settings.tokenBudget === val}
                    onChange={() => handleTokenBudget(val)}
                    className="w-3.5 h-3.5 accent-green-500"
                  />
                  <span className="text-xs text-bolt-elements-textPrimary capitalize">{val}</span>
                </label>
              ))}
              {settings.tokenBudget === 'custom' && (
                <input
                  type="number"
                  min={4000}
                  max={200000}
                  step={1000}
                  value={settings.tokenBudgetCustom}
                  onChange={(e) => updateLocalLLMSettings({ tokenBudgetCustom: Number(e.target.value) })}
                  className={classNames(
                    'w-24 px-2 py-0.5 text-xs rounded-lg',
                    'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                    'text-bolt-elements-textPrimary',
                    'focus:outline-none focus:ring-1 focus:ring-bolt-elements-focus',
                  )}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
