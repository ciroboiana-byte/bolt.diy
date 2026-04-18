import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useRef, startTransition, useState } from 'react';
import { toast } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts } from '~/lib/hooks';
import { description, useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROMPT_COOKIE_KEY, PROVIDER_LIST } from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useSearchParams } from '@remix-run/react';
import { createSampler } from '~/utils/sampler';
import { getTemplates, selectStarterTemplate } from '~/utils/selectStarterTemplate';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { promptQueueStore, advanceQueue, clearPendingPrompt, stopQueue } from '~/lib/stores/promptQueue';
import { localLLMSettingsStore, getTokenBudget, estimateTokens } from '~/lib/stores/localLLMSettings';
import { filesToArtifacts } from '~/utils/fileUtils';
import { supabaseConnection } from '~/lib/stores/supabase';
import { defaultDesignScheme, type DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import type { TextUIPart, FileUIPart, Attachment } from '@ai-sdk/ui-utils';
import { useMCPStore } from '~/lib/stores/mcp';
import type { LlmErrorAlertType } from '~/types/actions';

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory, importChat, exportChat } = useChatHistory();
  const title = useStore(description);
  useEffect(() => {
    workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
  }, [initialMessages]);

  return (
    <>
      {ready && (
        <ChatImpl
          description={title}
          initialMessages={initialMessages}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
        />
      )}
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: Message[];
    initialMessages: Message[];
    isLoading: boolean;
    parseMessages: (messages: Message[], isLoading: boolean) => void;
    storeMessageHistory: (messages: Message[]) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, parseMessages, storeMessageHistory } = options;
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      /*
       * Defer IndexedDB writes to avoid blocking the render thread.
       * requestIdleCallback fires when the browser is idle between frames;
       * setTimeout(0) is the fallback for browsers that don't support it.
       */
      const saveHistory = () => {
        storeMessageHistory(messages).catch((error) => {
          /*
           * Suppress network/resource exhaustion errors — not actionable by the user
           * and cascade into a flood of toasts when the browser is under memory pressure.
           */
          const msg: string = error?.message ?? '';
          const isResourceError =
            msg.includes('Failed to fetch') || msg.includes('ERR_INSUFFICIENT') || msg.includes('NetworkError');

          if (!isResourceError) {
            toast.error(msg);
          } else {
            console.warn('Chat history save failed (resource pressure):', msg);
          }
        });
      };

      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(saveHistory, { timeout: 2000 });
      } else {
        setTimeout(saveHistory, 0);
      }
    }
  },
  50,
);

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
}

/**
 * Trims the WebContainer file map before it is JSON-serialised into the
 * request body. Without this, a large ZIP import (hundreds of source files,
 * or worse — a project that includes node_modules / android / ios) can produce
 * a multi-megabyte body that freezes the main thread for several seconds every
 * time the user hits Send.
 *
 * Rules (applied in order):
 *  1. Skip folder entries in heavy directories — they add no value.
 *  2. Skip any file whose path lives under a "never-send" directory.
 *  3. Skip any file whose content exceeds MAX_FILE_BYTES.
 *  4. Stop adding files once the running total exceeds MAX_TOTAL_BYTES.
 *
 * Source files (< 50 KB each) are almost always included; compiled bundles,
 * lock files, and native code are excluded.
 */
function trimFilesForBody(fileMap: Record<string, any>): Record<string, any> {
  const BLOCKED_DIRS = [
    'node_modules/',
    '.git/',
    'dist/',
    'build/',
    '.expo/',
    'android/',
    'ios/',
    '.gradle/',
    '.idea/',
    '__pycache__/',
  ];
  const MAX_FILE_BYTES = 50_000; // 50 KB per file — compiled artefacts tend to be larger
  const MAX_TOTAL_BYTES = 500_000; // 500 KB total across all files

  let totalBytes = 0;
  const result: Record<string, any> = {};

  for (const [path, dirent] of Object.entries(fileMap)) {
    if (!dirent) {
      continue;
    }

    // Always skip paths inside heavy directories
    if (BLOCKED_DIRS.some((d) => path.includes(d))) {
      continue;
    }

    if (dirent.type === 'folder') {
      result[path] = dirent;
      continue;
    }

    // File entry — gate on size
    const content: string = typeof dirent.content === 'string' ? dirent.content : '';
    const bytes = content.length;

    if (bytes > MAX_FILE_BYTES) {
      continue; // individual file too large
    }

    if (totalBytes + bytes > MAX_TOTAL_BYTES) {
      continue; // total budget exhausted — skip remaining files
    }

    totalBytes += bytes;
    result[path] = dirent;
  }

  return result;
}

export const ChatImpl = memo(
  ({ description, initialMessages, storeMessageHistory, importChat, exportChat }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading, setFakeLoading] = useState(false);
    const files = useStore(workbenchStore.files);
    const [designScheme, setDesignScheme] = useState<DesignScheme>(defaultDesignScheme);
    const actionAlert = useStore(workbenchStore.alert);
    const deployAlert = useStore(workbenchStore.deployAlert);
    const supabaseConn = useStore(supabaseConnection);
    const selectedProject = supabaseConn.stats?.projects?.find(
      (project) => project.id === supabaseConn.selectedProjectId,
    );
    const supabaseAlert = useStore(workbenchStore.supabaseAlert);
    const { activeProviders, promptId, autoSelectTemplate, contextOptimizationEnabled } = useSettings();
    const localLLMSettings = useStore(localLLMSettingsStore);

    // When slim system prompt is enabled, override promptId to 'slim'
    const effectivePromptId = localLLMSettings.slimSystemPrompt ? 'slim' : promptId;
    const [llmErrorAlert, setLlmErrorAlert] = useState<LlmErrorAlertType | undefined>(undefined);
    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });
    const { showChat } = useStore(chatStore);
    const [animationScope, animate] = useAnimate();
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
    const [chatMode, setChatMode] = useState<'discuss' | 'build'>('build');
    const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
    const mcpSettings = useMCPStore((state) => state.settings);

    const {
      messages,
      isLoading,
      input,
      handleInputChange,
      setInput,
      stop,
      append,
      setMessages,
      reload,
      error,
      data: chatData,
      setData,
      addToolResult,
    } = useChat({
      api: '/api/chat',
      body: {
        apiKeys,
        files: trimFilesForBody(files),
        promptId: effectivePromptId,

        /*
         * Disable bolt's context-file-selection pass when local models are
         * active — it runs a separate LLM call that times out with Ollama,
         * and fails on new files that don't exist in WebContainer yet.
         */
        /*
         * Context optimization is now safe for local models — the server wraps both
         * LLM pre-passes in a timeout and falls back to keyword-based file selection
         * if Ollama is too slow. Only hard-disable if the user explicitly opted out.
         */
        contextOptimization: localLLMSettings.disableContextOptimization ? false : contextOptimizationEnabled,
        isLocalModel: localLLMSettings.enableLocalModels && localLLMSettings.extendedStreamTimeout,
        chatMode,
        designScheme,
        supabase: {
          isConnected: supabaseConn.isConnected,
          hasSelectedProject: !!selectedProject,
          credentials: {
            supabaseUrl: supabaseConn?.credentials?.supabaseUrl,
            anonKey: supabaseConn?.credentials?.anonKey,
          },
        },
        maxLLMSteps: mcpSettings.maxLLMSteps,
      },
      sendExtraMessageFields: true,
      onError: (e) => {
        setFakeLoading(false);
        handleError(e, 'chat');
        stopQueue();
      },
      onFinish: (message, response) => {
        const usage = response.usage;
        setData(undefined);

        if (usage) {
          console.log('Token usage:', usage);
          logStore.logProvider('Chat response completed', {
            component: 'Chat',
            action: 'response',
            model,
            provider: provider.name,
            usage,
            messageLength: message.content.length,
          });
        }

        logger.debug('Finished streaming');

        /*
         * Collect all transformation inputs synchronously (before any async yields),
         * then apply all message mutations in a SINGLE startTransition-wrapped setMessages
         * call. This prevents 4 separate render cycles for each queue step and keeps the
         * UI responsive — startTransition marks this batch as non-urgent so React can
         * yield to user interactions (clicks, scrolls) between work chunks.
         */

        // Inputs for pass 1: ZIP import compaction
        const zipFiletreeRaw = localStorage.getItem('bolt_zip_filetree');

        if (zipFiletreeRaw) {
          localStorage.removeItem('bolt_zip_filetree');
        }

        // Inputs for pass 2+: queue state and settings
        const { isRunning } = promptQueueStore.get();
        const llmSettings = localLLMSettingsStore.get();
        const tokenBudget = getTokenBudget(llmSettings);

        startTransition(() => {
          setMessages((prev) => {
            let msgs = prev;

            // --- Pass 1: ZIP import — replace giant boltArtifact with compact file tree ---
            if (zipFiletreeRaw) {
              try {
                const { folderName, fileCount, tree } = JSON.parse(zipFiletreeRaw);
                const compactContent = `I've imported the "${folderName}" project (${fileCount} files). All files have been written to the WebContainer filesystem.\n\nProject structure:\n${tree}\n\nFiles are ready — I'll use context selection to pull relevant files as needed for each task.`;
                msgs = msgs.map((m) =>
                  m.content.includes('boltArtifact id="imported-files"') ? { ...m, content: compactContent } : m,
                );
              } catch {
                /* ignore parse errors */
              }
            }

            // --- Pass 2: Queue artifact pruning — strip boltArtifact from older messages ---
            if (isRunning) {
              const assistantMsgs = msgs.filter((m) => m.role === 'assistant');
              const keepRecent = 2;
              const pruneCount = Math.max(0, assistantMsgs.length - keepRecent);

              if (pruneCount > 0) {
                let pruned = 0;
                msgs = msgs.map((m) => {
                  if (m.role !== 'assistant' || pruned >= pruneCount) {
                    return m;
                  }

                  if (m.content.includes('<boltArtifact')) {
                    pruned++;
                    return {
                      ...m,
                      content: m.content.replace(
                        /<boltArtifact[\s\S]*?<\/boltArtifact>/g,
                        '[files applied to WebContainer]',
                      ),
                    };
                  }

                  return m;
                });
              }
            }

            // --- Pass 3: Local LLM optimizations — dedup file writes and strip old prose ---
            if (llmSettings.dedupFileWrites || llmSettings.stripOldProse) {
              if (llmSettings.dedupFileWrites) {
                /*
                 * Walk messages newest-first, track file paths already seen.
                 * For any older write of the same path, replace with a stub so
                 * the model doesn't re-read stale file versions.
                 */
                const seenPaths = new Set<string>();

                msgs = msgs
                  .slice()
                  .reverse()
                  .map((m) => {
                    if (m.role !== 'assistant' || !m.content.includes('<boltArtifact')) {
                      return m;
                    }

                    const newContent = m.content.replace(
                      /<boltAction type="file" filePath="([^"]+)">([\s\S]*?)<\/boltAction>/g,
                      (match, filePath) => {
                        if (seenPaths.has(filePath)) {
                          return `<boltAction type="file" filePath="${filePath}">[superseded by later write]</boltAction>`;
                        }

                        seenPaths.add(filePath);

                        return match;
                      },
                    );

                    return newContent !== m.content ? { ...m, content: newContent } : m;
                  })
                  .reverse();
              }

              if (llmSettings.stripOldProse) {
                /*
                 * For assistant messages older than the last 2, strip everything
                 * outside <boltArtifact> tags. The prose is already read — keeping
                 * it is pure token cost.
                 */
                const assistantIndices = msgs.map((m, i) => (m.role === 'assistant' ? i : -1)).filter((i) => i >= 0);
                const pruneSet = new Set(assistantIndices.slice(0, Math.max(0, assistantIndices.length - 2)));

                msgs = msgs.map((m, i) => {
                  if (!pruneSet.has(i)) {
                    return m;
                  }

                  if (!m.content.includes('<boltArtifact')) {
                    return { ...m, content: '[response]' };
                  }

                  const artifacts = [...m.content.matchAll(/<boltArtifact[\s\S]*?<\/boltArtifact>/g)]
                    .map((match) => match[0])
                    .join('\n');

                  return { ...m, content: artifacts || '[response]' };
                });
              }
            }

            // --- Pass 4: Token-budget pruning — trim oldest messages until under budget ---
            if (tokenBudget !== null) {
              const totalTokens = msgs.reduce((sum, m) => sum + estimateTokens(String(m.content)), 0);

              if (totalTokens > tokenBudget) {
                const KEEP_TAIL = 4;

                if (msgs.length > KEEP_TAIL + 1) {
                  const head = msgs.slice(0, 1);
                  const tail = msgs.slice(-KEEP_TAIL);
                  let middle = msgs.slice(1, -KEEP_TAIL);

                  while (
                    middle.length > 0 &&
                    head.concat(middle, tail).reduce((sum, m) => sum + estimateTokens(String(m.content)), 0) >
                      tokenBudget
                  ) {
                    middle = middle.slice(1);
                  }

                  msgs = [...head, ...middle, ...tail];
                }
              }
            }

            return msgs;
          });
        });

        /* Advance the prompt queue if one is running */
        const nextPrompt = advanceQueue();

        if (nextPrompt) {
          /* Small delay so the UI can settle before the next message fires */
          /*
           * Wait for the action runner to fully settle (all file writes / shell
           * commands reach a terminal state) before firing the next prompt.
           * This prevents WebContainer from being overwhelmed by rapid-fire writes.
           * Falls back after maxWaitMs regardless so the queue never stalls forever.
           */
          const waitForActionsToSettle = (maxWaitMs = 60_000): Promise<void> =>
            new Promise((resolve) => {
              const deadline = Date.now() + maxWaitMs;

              const check = () => {
                const artifacts = workbenchStore.artifacts.get();
                const anyBusy = Object.values(artifacts).some((artifact) =>
                  Object.values(artifact.runner.actions.get()).some(
                    (action) => action.status === 'running' || action.status === 'pending',
                  ),
                );

                if (!anyBusy || Date.now() >= deadline) {
                  // Extra breathing room after actions settle so WebContainer can flush I/O
                  setTimeout(resolve, 1500);
                } else {
                  setTimeout(check, 500);
                }
              };

              // Give the action runner a moment to start before we start polling
              setTimeout(check, 1000);
            });

          waitForActionsToSettle().then(() => {
            promptQueueStore.setKey('pendingPrompt', nextPrompt);
          });
        }
      },
      initialMessages,
      initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    });
    useEffect(() => {
      const prompt = searchParams.get('prompt');

      // console.log(prompt, searchParams, model, provider);

      if (prompt) {
        setSearchParams({});
        runAnimation();
        append({
          role: 'user',
          content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
        });
      }
    }, [model, provider, searchParams]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    /*
     * Pre-fill the textarea with the follow-up prompt set by ImportZipButton before the
     * full-page navigation. Using setInput instead of append so the user confirms with
     * one Enter keystroke — avoids model-state race conditions on chat initialisation.
     */
    useEffect(() => {
      if (initialMessages.length === 0) {
        return;
      }

      const autorun = localStorage.getItem('bolt_zip_autorun');

      if (autorun) {
        localStorage.removeItem('bolt_zip_autorun');
        setInput(autorun);
      }
    }, []);

    /*
     * Pre-send ZIP compaction.
     *
     * The boltArtifact id="imported-files" message can be hundreds of KB of
     * raw file content. The onFinish handler compacts it AFTER the response,
     * but on the VERY FIRST prompt it's still in the messages array when
     * JSON.stringify is called to build the fetch body. That stringify blocks
     * the main thread for several seconds, freezing the UI.
     *
     * setMessages() in @ai-sdk/react updates messagesRef.current synchronously
     * (confirmed in the SDK source) before scheduling a re-render. Calling it
     * immediately before append() means the hook reads the compacted array when
     * it builds the request body — same content, a fraction of the size.
     *
     * Uses the functional form so it always reads the live ref (safe inside
     * stale-closure callbacks like the queue subscription below).
     */
    const compactZipIfPresent = useCallback(() => {
      setMessages((prev) => {
        const hasZip = prev.some(
          (m) => typeof m.content === 'string' && m.content.includes('boltArtifact id="imported-files"'),
        );

        if (!hasZip) {
          return prev;
        }

        return prev.map((m) => {
          if (typeof m.content !== 'string' || !m.content.includes('boltArtifact id="imported-files"')) {
            return m;
          }

          const paths = [...m.content.matchAll(/filePath="([^"]+)"/g)].map((match) => match[1]);
          const count = paths.length;
          const list = paths.map((p) => `  ${p}`).join('\n');

          return {
            ...m,
            content:
              `[Project imported to WebContainer — ${count} file${count === 1 ? '' : 's'}]\n\n` +
              `Files available:\n${list}\n\n` +
              `All files are in the WebContainer filesystem. ` +
              `Use context selection to read relevant files as needed.`,
          };
        });
      });
    }, [setMessages]);

    /* Fire the next queued prompt whenever the store signals one is ready */
    useEffect(() => {
      const unsubscribe = promptQueueStore.subscribe((state) => {
        if (state.pendingPrompt) {
          clearPendingPrompt();

          const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${state.pendingPrompt}`;
          compactZipIfPresent();
          append({ role: 'user', content: messageText });
        }
      });

      return unsubscribe;
    }, [append, compactZipIfPresent, model, provider]);

    useEffect(() => {
      processSampledMessages({
        messages,
        initialMessages,
        isLoading,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, parseMessages]);

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    const handleError = useCallback(
      (error: any, context: 'chat' | 'template' | 'llmcall' = 'chat') => {
        logger.error(`${context} request failed`, error);

        stop();
        setFakeLoading(false);

        let errorInfo = {
          message: 'An unexpected error occurred',
          isRetryable: true,
          statusCode: 500,
          provider: provider.name,
          type: 'unknown' as const,
          retryDelay: 0,
        };

        if (error.message) {
          try {
            const parsed = JSON.parse(error.message);

            if (parsed.error || parsed.message) {
              errorInfo = { ...errorInfo, ...parsed };
            } else {
              errorInfo.message = error.message;
            }
          } catch {
            errorInfo.message = error.message;
          }
        }

        let errorType: LlmErrorAlertType['errorType'] = 'unknown';
        let title = 'Request Failed';

        if (errorInfo.statusCode === 401 || errorInfo.message.toLowerCase().includes('api key')) {
          errorType = 'authentication';
          title = 'Authentication Error';
        } else if (errorInfo.statusCode === 429 || errorInfo.message.toLowerCase().includes('rate limit')) {
          errorType = 'rate_limit';
          title = 'Rate Limit Exceeded';
        } else if (errorInfo.message.toLowerCase().includes('quota')) {
          errorType = 'quota';
          title = 'Quota Exceeded';
        } else if (errorInfo.statusCode >= 500) {
          errorType = 'network';
          title = 'Server Error';
        }

        logStore.logError(`${context} request failed`, error, {
          component: 'Chat',
          action: 'request',
          error: errorInfo.message,
          context,
          retryable: errorInfo.isRetryable,
          errorType,
          provider: provider.name,
        });

        // Create API error alert
        setLlmErrorAlert({
          type: 'error',
          title,
          description: errorInfo.message,
          provider: provider.name,
          errorType,
        });
        setData([]);
      },
      [provider.name, stop],
    );

    const clearApiErrorAlert = useCallback(() => {
      setLlmErrorAlert(undefined);
    }, []);

    useEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      await Promise.all([
        animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
        animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
      ]);

      chatStore.setKey('started', true);

      setChatStarted(true);
    };

    // Helper function to create message parts array from text and images
    const createMessageParts = (text: string, images: string[] = []): Array<TextUIPart | FileUIPart> => {
      // Create an array of properly typed message parts
      const parts: Array<TextUIPart | FileUIPart> = [
        {
          type: 'text',
          text,
        },
      ];

      // Add image parts if any
      images.forEach((imageData) => {
        // Extract correct MIME type from the data URL
        const mimeType = imageData.split(';')[0].split(':')[1] || 'image/jpeg';

        // Create file part according to AI SDK format
        parts.push({
          type: 'file',
          mimeType,
          data: imageData.replace(/^data:image\/[^;]+;base64,/, ''),
        });
      });

      return parts;
    };

    // Helper function to convert File[] to Attachment[] for AI SDK
    const filesToAttachments = async (files: File[]): Promise<Attachment[] | undefined> => {
      if (files.length === 0) {
        return undefined;
      }

      const attachments = await Promise.all(
        files.map(
          (file) =>
            new Promise<Attachment>((resolve) => {
              const reader = new FileReader();

              reader.onloadend = () => {
                resolve({
                  name: file.name,
                  contentType: file.type,
                  url: reader.result as string,
                });
              };
              reader.readAsDataURL(file);
            }),
        ),
      );

      return attachments;
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        return;
      }

      if (isLoading) {
        abort();
        return;
      }

      let finalMessageContent = messageContent;

      if (selectedElement) {
        console.log('Selected Element:', selectedElement);

        const elementInfo = `<div class=\"__boltSelectedElement__\" data-element='${JSON.stringify(selectedElement)}'>${JSON.stringify(`${selectedElement.displayText}`)}</div>`;
        finalMessageContent = messageContent + elementInfo;
      }

      runAnimation();

      if (!chatStarted) {
        setFakeLoading(true);

        if (autoSelectTemplate) {
          const { template, title } = await selectStarterTemplate({
            message: finalMessageContent,
            model,
            provider,
          });

          if (template !== 'blank') {
            const temResp = await getTemplates(template, title).catch((e) => {
              if (e.message.includes('rate limit')) {
                toast.warning('Rate limit exceeded. Skipping starter template\n Continuing with blank template');
              } else {
                toast.warning('Failed to import starter template\n Continuing with blank template');
              }

              return null;
            });

            if (temResp) {
              const { assistantMessage, userMessage } = temResp;
              const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

              setMessages([
                {
                  id: `1-${new Date().getTime()}`,
                  role: 'user',
                  content: userMessageText,
                  parts: createMessageParts(userMessageText, imageDataList),
                },
                {
                  id: `2-${new Date().getTime()}`,
                  role: 'assistant',
                  content: assistantMessage,
                },
                {
                  id: `3-${new Date().getTime()}`,
                  role: 'user',
                  content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userMessage}`,
                  annotations: ['hidden'],
                },
              ]);

              const reloadOptions =
                uploadedFiles.length > 0
                  ? { experimental_attachments: await filesToAttachments(uploadedFiles) }
                  : undefined;

              reload(reloadOptions);
              setInput('');
              Cookies.remove(PROMPT_COOKIE_KEY);

              setUploadedFiles([]);
              setImageDataList([]);

              resetEnhancer();

              textareaRef.current?.blur();
              setFakeLoading(false);

              return;
            }
          }
        }

        // If autoSelectTemplate is disabled or template selection failed, proceed with normal message
        const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;
        const attachments = uploadedFiles.length > 0 ? await filesToAttachments(uploadedFiles) : undefined;

        setMessages([
          {
            id: `${new Date().getTime()}`,
            role: 'user',
            content: userMessageText,
            parts: createMessageParts(userMessageText, imageDataList),
            experimental_attachments: attachments,
          },
        ]);
        reload(attachments ? { experimental_attachments: attachments } : undefined);
        setFakeLoading(false);
        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);

        setUploadedFiles([]);
        setImageDataList([]);

        resetEnhancer();

        textareaRef.current?.blur();

        return;
      }

      if (error != null) {
        setMessages(messages.slice(0, -1));
      }

      const modifiedFiles = workbenchStore.getModifiedFiles();

      chatStore.setKey('aborted', false);

      if (modifiedFiles !== undefined) {
        const userUpdateArtifact = filesToArtifacts(modifiedFiles, `${Date.now()}`);
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userUpdateArtifact}${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        compactZipIfPresent();
        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );

        workbenchStore.resetAllFileModifications();
      } else {
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        compactZipIfPresent();
        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );
      }

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);

      setUploadedFiles([]);
      setImageDataList([]);

      resetEnhancer();

      textareaRef.current?.blur();
    };

    /**
     * Handles the change event for the textarea and updates the input state.
     * @param event - The change event from the textarea.
     */
    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleInputChange(event);
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    useEffect(() => {
      const storedApiKeys = Cookies.get('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
      }
    }, []);

    const handleModelChange = (newModel: string) => {
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
    };

    const handleWebSearchResult = useCallback(
      (result: string) => {
        const currentInput = input || '';
        const newInput = currentInput.length > 0 ? `${result}\n\n${currentInput}` : result;

        // Update the input via the same mechanism as handleInputChange
        const syntheticEvent = {
          target: { value: newInput },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        handleInputChange(syntheticEvent);
      },
      [input, handleInputChange],
    );

    return (
      <BaseChat
        ref={animationScope}
        textareaRef={textareaRef}
        input={input}
        showChat={showChat}
        chatStarted={chatStarted}
        isStreaming={isLoading || fakeLoading}
        onStreamingChange={(streaming) => {
          streamingState.set(streaming);
        }}
        enhancingPrompt={enhancingPrompt}
        promptEnhanced={promptEnhanced}
        sendMessage={sendMessage}
        model={model}
        setModel={handleModelChange}
        provider={provider}
        setProvider={handleProviderChange}
        providerList={activeProviders}
        handleInputChange={(e) => {
          onTextareaChange(e);
          debouncedCachePrompt(e);
        }}
        handleStop={abort}
        description={description}
        importChat={importChat}
        exportChat={exportChat}
        messages={messages.map((message, i) => {
          if (message.role === 'user') {
            return message;
          }

          return {
            ...message,
            content: parsedMessages[i] || '',
          };
        })}
        enhancePrompt={() => {
          enhancePrompt(
            input,
            (input) => {
              setInput(input);
              scrollTextArea();
            },
            model,
            provider,
            apiKeys,
          );
        }}
        uploadedFiles={uploadedFiles}
        setUploadedFiles={setUploadedFiles}
        imageDataList={imageDataList}
        setImageDataList={setImageDataList}
        actionAlert={actionAlert}
        clearAlert={() => workbenchStore.clearAlert()}
        supabaseAlert={supabaseAlert}
        clearSupabaseAlert={() => workbenchStore.clearSupabaseAlert()}
        deployAlert={deployAlert}
        clearDeployAlert={() => workbenchStore.clearDeployAlert()}
        llmErrorAlert={llmErrorAlert}
        clearLlmErrorAlert={clearApiErrorAlert}
        data={chatData}
        chatMode={chatMode}
        setChatMode={setChatMode}
        append={append}
        designScheme={designScheme}
        setDesignScheme={setDesignScheme}
        selectedElement={selectedElement}
        setSelectedElement={setSelectedElement}
        addToolResult={addToolResult}
        onWebSearchResult={handleWebSearchResult}
      />
    );
  },
);
