import { useStore } from '@nanostores/react';
import { useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { promptQueueStore, loadQueue, startQueue, stopQueue, resumeQueue, clearQueue } from '~/lib/stores/promptQueue';
import { classNames } from '~/utils/classNames';

/**
 * Parses a raw string into an array of prompts.
 *
 * Supported formats (auto-detected, tried in order):
 *  1. Code-block format  — content inside every ``` block is one prompt
 *     (handles the "## PROMPT NNN\n```\n...\n```" style)
 *  2. --- separator      — sections divided by horizontal rules
 *  3. ## heading format  — sections divided by markdown headings
 *  4. One prompt per line — plain newline-separated list (original fallback)
 */
function parsePrompts(raw: string): string[] {
  const trimmed = raw.trim();

  const codeBlockMatches = [...trimmed.matchAll(/```(?:\w+)?\n([\s\S]*?)```/g)];

  if (codeBlockMatches.length > 0) {
    return codeBlockMatches.map((m) => m[1].trim()).filter(Boolean);
  }

  if (/\n---+\n/.test(trimmed)) {
    return trimmed
      .split(/\n---+\n/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // ####Prompt N#### delimiter style
  if (/^####[^#\n]+####$/m.test(trimmed)) {
    return trimmed
      .split(/^####[^#\n]+####$/m)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (/^#{1,3} /m.test(trimmed)) {
    return trimmed
      .split(/^#{1,3} .+$/m)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  return trimmed
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

interface PromptQueuePanelProps {
  isStreaming: boolean;
}

export function PromptQueuePanel({ isStreaming }: PromptQueuePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({});
  const barRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState('');
  const { prompts, currentIndex, isRunning } = useStore(promptQueueStore);

  const handleLoad = () => {
    const parsed = parsePrompts(draft);

    if (parsed.length === 0) {
      toast.error('Enter at least one prompt');
      return;
    }

    loadQueue(parsed);
    toast.success(`Loaded ${parsed.length} prompt${parsed.length === 1 ? '' : 's'}`);
  };

  const isAllDone = !isRunning && prompts.length > 0 && currentIndex > 0 && currentIndex === prompts.length;
  const isPaused = !isRunning && currentIndex > 0 && currentIndex < prompts.length;
  const hasPrompts = prompts.length > 0;

  const progressLabel = isAllDone
    ? `All ${prompts.length} prompts done ✓`
    : isRunning
      ? `Prompt ${currentIndex + 1} of ${prompts.length}`
      : isPaused
        ? `Paused at ${currentIndex + 1} of ${prompts.length}`
        : hasPrompts
          ? `${prompts.length} prompt${prompts.length === 1 ? '' : 's'} loaded`
          : '';

  const handleStop = () => {
    stopQueue();
    toast.info('Queue paused — current response will finish');
  };

  const handleClear = () => {
    clearQueue();
    setDraft('');
    toast.info('Queue cleared');
  };

  return (
    <div ref={barRef} className="relative border-t border-bolt-elements-borderColor bg-gray-100 dark:bg-gray-900">
      {/* Toggle bar — always visible */}
      <div className="w-full flex items-center px-4 py-2 text-sm gap-2">
        {/* Clickable label area */}
        <button
          onClick={() => {
            if (!isOpen && barRef.current) {
              const rect = barRef.current.getBoundingClientRect();
              setPanelStyle({ bottom: window.innerHeight - rect.top, left: rect.left, width: rect.width });
            }

            setIsOpen((o) => !o);
          }}
          className={classNames(
            'flex items-center gap-2 flex-1 min-w-0 bg-transparent',
            'text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors',
          )}
        >
          <span className="i-ph:queue w-4 h-4 shrink-0" />
          <span className="shrink-0">Prompt Queue</span>
          {isRunning && (
            <span className="flex items-center gap-1 text-green-500 text-xs">
              <span className="i-ph:circle-notch w-3 h-3 animate-spin" />
              <span>{progressLabel}</span>
            </span>
          )}
          {!isRunning && progressLabel && (
            <span
              className={classNames(
                'text-xs truncate',
                isPaused ? 'text-yellow-500' : 'text-bolt-elements-textTertiary',
              )}
            >
              {progressLabel}
            </span>
          )}
        </button>

        {/* Inline action buttons on the collapsed bar */}
        <div className="flex items-center gap-1 shrink-0">
          {isRunning && (
            <button
              onClick={handleStop}
              title="Stop after this response"
              className={classNames(
                'flex items-center gap-1 px-2 py-1 rounded-lg text-xs',
                'bg-red-600 hover:bg-red-500 text-white transition-colors',
              )}
            >
              <span className="i-ph:stop w-3.5 h-3.5" />
              Stop
            </button>
          )}
          {!isRunning && isPaused && (
            <button
              onClick={() => {
                if (!isStreaming) {
                  resumeQueue();
                } else {
                  toast.error('Wait for the current response to finish');
                }
              }}
              title="Resume from current step"
              className={classNames(
                'flex items-center gap-1 px-2 py-1 rounded-lg text-xs',
                'bg-green-600 hover:bg-green-500 text-white transition-colors',
              )}
            >
              <span className="i-ph:play w-3.5 h-3.5" />
              Resume
            </button>
          )}
          {!isRunning && hasPrompts && !isAllDone && !isPaused && (
            <button
              onClick={() => {
                if (!isStreaming) {
                  startQueue();
                } else {
                  toast.error('Wait for the current response to finish');
                }
              }}
              title="Start queue"
              className={classNames(
                'flex items-center gap-1 px-2 py-1 rounded-lg text-xs',
                'bg-green-600 hover:bg-green-500 text-white transition-colors',
              )}
            >
              <span className="i-ph:play w-3.5 h-3.5" />
              Start
            </button>
          )}
        </div>

        <button
          onClick={() => {
            if (!isOpen && barRef.current) {
              const rect = barRef.current.getBoundingClientRect();
              setPanelStyle({ bottom: window.innerHeight - rect.top, left: rect.left, width: rect.width });
            }

            setIsOpen((o) => !o);
          }}
          className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors shrink-0"
        >
          <span
            className={classNames('i-ph:caret-down w-4 h-4 transition-transform block', isOpen ? 'rotate-180' : '')}
          />
        </button>
      </div>

      {/* Expandable body — floats ABOVE the toggle, does not push chat layout */}
      {isOpen && (
        <div
          style={panelStyle}
          className={classNames(
            'fixed z-[9999]',
            'mb-1 rounded-xl',
            'bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor',
            'shadow-lg px-4 pb-4 pt-3 flex flex-col gap-3',
            'max-h-[80vh] overflow-y-auto modern-scrollbar',
          )}
        >
          {/* Tip */}
          <p className="text-xs text-bolt-elements-textTertiary">
            Tip: queues of 10–15 prompts work well. Longer runs may stall if bolt hits context limits or errors — use
            Stop to recover and resume.
          </p>

          {/* Prompt editor */}
          <textarea
            className={classNames(
              'w-full h-40 p-2 text-sm rounded-lg resize-none',
              'bg-bolt-elements-background-depth-3',
              'border border-bolt-elements-borderColor',
              'text-bolt-elements-textPrimary placeholder:text-bolt-elements-textTertiary',
              'focus:outline-none focus:ring-1 focus:ring-bolt-elements-focus',
            )}
            placeholder={
              'Paste prompts in any format:\n• Code blocks (``` ... ```) — one prompt each\n• Sections divided by ---\n• ## Heading per prompt\n• Or just one prompt per line'
            }
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={isRunning}
          />

          {/* Controls */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleLoad}
              disabled={isRunning || !draft.trim()}
              className={classNames(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm',
                'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                'text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2',
                'disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
              )}
            >
              <span className="i-ph:upload-simple w-4 h-4" />
              Load
            </button>

            {!isRunning && isPaused && (
              <button
                onClick={() => {
                  if (!isStreaming) {
                    resumeQueue();
                  } else {
                    toast.error('Wait for the current response to finish');
                  }
                }}
                disabled={isStreaming}
                className={classNames(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm',
                  'bg-green-600 hover:bg-green-500 text-white',
                  'disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
                )}
              >
                <span className="i-ph:play w-4 h-4" />
                Resume
              </button>
            )}

            {isRunning && (
              <button
                onClick={handleStop}
                className={classNames(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm',
                  'bg-red-600 hover:bg-red-500 text-white transition-colors',
                )}
              >
                <span className="i-ph:stop w-4 h-4" />
                Stop
              </button>
            )}

            {hasPrompts && (
              <button
                onClick={handleClear}
                disabled={isRunning}
                title="Clear queue"
                className={classNames(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm',
                  'bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor',
                  'text-bolt-elements-textSecondary hover:text-red-400 hover:border-red-400',
                  'disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
                )}
              >
                <span className="i-ph:trash w-4 h-4" />
                Clear
              </button>
            )}

            {hasPrompts && !isRunning && (
              <span className="ml-auto text-xs text-bolt-elements-textTertiary">{progressLabel}</span>
            )}
          </div>

          {/* Prompt list with status */}
          {prompts.length > 0 && (
            <ol className="flex flex-col gap-1 max-h-48 overflow-y-auto modern-scrollbar">
              {prompts.map((prompt, i) => {
                const isAllDone = !isRunning && currentIndex === prompts.length;
                const isDone = isAllDone ? true : i < currentIndex;
                const isActive = isRunning && i === currentIndex;
                const isPending = !isDone && !isActive;

                return (
                  <li
                    key={i}
                    className={classNames(
                      'flex items-start gap-2 px-2 py-1.5 rounded-lg text-xs',
                      isActive ? 'bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary' : '',
                      isDone ? 'text-bolt-elements-textTertiary line-through' : '',
                      isPending && !isActive ? 'text-bolt-elements-textSecondary' : '',
                    )}
                  >
                    <span className="mt-0.5 shrink-0">
                      {isDone && <span className="i-ph:check-circle w-3.5 h-3.5 text-green-500" />}
                      {isActive && <span className="i-ph:circle-notch w-3.5 h-3.5 text-blue-400 animate-spin" />}
                      {isPending && !isActive && (
                        <span className="i-ph:circle w-3.5 h-3.5 text-bolt-elements-textTertiary" />
                      )}
                    </span>
                    <span className="truncate">{prompt}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
