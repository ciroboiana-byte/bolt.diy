import { useStore } from '@nanostores/react';
import { useState } from 'react';
import { toast } from 'react-toastify';
import { promptQueueStore, loadQueue, startQueue, stopQueue } from '~/lib/stores/promptQueue';
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

  const handleStart = () => {
    if (prompts.length === 0) {
      toast.error('Load prompts first');
      return;
    }

    if (isStreaming) {
      toast.error('Wait for the current response to finish');
      return;
    }

    startQueue();
  };

  const handleStop = () => {
    stopQueue();
    toast.info('Queue stopped');
  };

  const isAllDone = !isRunning && currentIndex === prompts.length && prompts.length > 0;
  const progressLabel = isAllDone
    ? `All ${prompts.length} prompts done ✓`
    : isRunning
      ? `Prompt ${currentIndex + 1} of ${prompts.length}`
      : prompts.length > 0
        ? `${prompts.length} prompt${prompts.length === 1 ? '' : 's'} loaded`
        : '';

  return (
    <div className="relative border-t border-bolt-elements-borderColor">
      {/* Toggle bar — always visible, minimal height */}
      <button
        onClick={() => setIsOpen((o) => !o)}
        className={classNames(
          'w-full flex items-center justify-between px-4 py-2 text-sm',
          'bg-bolt-elements-background-depth-1',
          'text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary',
          'hover:bg-bolt-elements-background-depth-2 transition-colors',
        )}
      >
        <span className="flex items-center gap-2">
          <span className="i-ph:queue w-4 h-4" />
          <span>Prompt Queue</span>
          {isRunning && (
            <span className="flex items-center gap-1 text-green-500 text-xs">
              <span className="i-ph:circle-notch w-3 h-3 animate-spin" />
              <span>{progressLabel || 'Running'}</span>
            </span>
          )}
          {!isRunning && progressLabel && (
            <span className="text-xs text-bolt-elements-textTertiary">{progressLabel}</span>
          )}
        </span>
        <span className={classNames('i-ph:caret-down w-4 h-4 transition-transform', isOpen ? 'rotate-180' : '')} />
      </button>

      {/* Expandable body — floats ABOVE the toggle, does not push chat layout */}
      {isOpen && (
        <div
          className={classNames(
            'absolute bottom-full left-0 right-0 z-50',
            'mb-1 mx-2 rounded-xl',
            'bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor',
            'shadow-lg px-4 pb-4 pt-3 flex flex-col gap-3',
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
          <div className="flex items-center gap-2">
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

            {!isRunning ? (
              <button
                onClick={handleStart}
                disabled={prompts.length === 0 || isStreaming}
                className={classNames(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm',
                  'bg-green-600 hover:bg-green-500 text-white',
                  'disabled:opacity-40 disabled:cursor-not-allowed transition-colors',
                )}
              >
                <span className="i-ph:play w-4 h-4" />
                Start
              </button>
            ) : (
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

            {prompts.length > 0 && !isRunning && (
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
