import { map } from 'nanostores';

export interface PromptQueueState {
  prompts: string[];
  currentIndex: number;
  isRunning: boolean;
  pendingPrompt: string | null;
}

export const promptQueueStore = map<PromptQueueState>({
  prompts: [],
  currentIndex: 0,
  isRunning: false,
  pendingPrompt: null,
});

/** Load a fresh list of prompts (replaces any existing queue). */
export function loadQueue(prompts: string[]) {
  promptQueueStore.set({
    prompts,
    currentIndex: 0,
    isRunning: false,
    pendingPrompt: null,
  });
}

/** Start the queue from the beginning and fire the first prompt. */
export function startQueue() {
  const { prompts } = promptQueueStore.get();

  if (prompts.length === 0) {
    return;
  }

  promptQueueStore.set({
    prompts,
    currentIndex: 0,
    isRunning: true,
    pendingPrompt: prompts[0],
  });
}

/** Stop the queue without clearing the prompt list or resetting the index. */
export function stopQueue() {
  promptQueueStore.setKey('isRunning', false);
  promptQueueStore.setKey('pendingPrompt', null);
}

/**
 * Resume a paused queue from the current index.
 * No-op if already running or if there are no remaining prompts.
 */
export function resumeQueue() {
  const { prompts, currentIndex, isRunning } = promptQueueStore.get();

  if (isRunning || currentIndex >= prompts.length) {
    return;
  }

  promptQueueStore.set({
    prompts,
    currentIndex,
    isRunning: true,
    pendingPrompt: prompts[currentIndex],
  });
}

/** Clear the queue entirely and reset all state. */
export function clearQueue() {
  promptQueueStore.set({
    prompts: [],
    currentIndex: 0,
    isRunning: false,
    pendingPrompt: null,
  });
}

/**
 * Called by ChatImpl after onFinish fires.
 * Advances to the next prompt or marks the queue done.
 * Returns the next prompt string, or null if the queue is finished.
 */
export function advanceQueue(): string | null {
  const { prompts, currentIndex, isRunning } = promptQueueStore.get();

  if (!isRunning) {
    return null;
  }

  const next = currentIndex + 1;

  if (next >= prompts.length) {
    /* Keep currentIndex at prompts.length so the UI shows all items as done */
    promptQueueStore.set({ prompts, currentIndex: prompts.length, isRunning: false, pendingPrompt: null });
    return null;
  }

  promptQueueStore.setKey('currentIndex', next);
  promptQueueStore.setKey('pendingPrompt', prompts[next]);

  return prompts[next];
}

/** Clear pending after ChatImpl has consumed it. */
export function clearPendingPrompt() {
  promptQueueStore.setKey('pendingPrompt', null);
}
