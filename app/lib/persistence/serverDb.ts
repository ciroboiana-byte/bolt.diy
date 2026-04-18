/**
 * Server-backed persistence layer.
 *
 * Implements the same public interface as db.ts but stores chat data on the
 * local Remix server (data/chats/ and data/snapshots/) rather than in the
 * browser's IndexedDB. This lets any browser on the network — phone, tablet,
 * second laptop — share the exact same chat history.
 */
import type { Message } from 'ai';
import type { IChatMetadata } from './db';
import type { ChatHistoryItem } from './useChatHistory';
import type { Snapshot } from './types';

/*
 * We keep a dummy "db" token so useChatHistory.ts can continue to check
 * `if (!db)` as a persistence-enabled guard without any other changes.
 */
export const SERVER_DB = Symbol('serverDb');
export type ServerDb = typeof SERVER_DB;

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function apiFetch(path: string, options?: RequestInit) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new ApiError(`API ${options?.method ?? 'GET'} ${path} failed: ${text}`, res.status);
  }

  const text = await res.text();

  return text ? JSON.parse(text) : null;
}

/** Equivalent of openDatabase() — always succeeds. */
export async function openServerDatabase(): Promise<ServerDb> {
  return SERVER_DB;
}

export async function getAll(_db: ServerDb): Promise<ChatHistoryItem[]> {
  return apiFetch('/api/chats');
}

export async function setMessages(
  _db: ServerDb,
  id: string,
  messages: Message[],
  urlId?: string,
  description?: string,
  timestamp?: string,
  metadata?: IChatMetadata,
): Promise<void> {
  const payload = { messages, urlId, description, timestamp, metadata };

  try {
    await apiFetch(`/api/chats/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  } catch (err) {
    /*
     * If the chat doesn't exist on the server yet (e.g. old IndexedDB ID
     * or a brand-new chat whose POST hasn't fired), create it now.
     */
    if (err instanceof ApiError && err.status === 404) {
      await apiFetch('/api/chats', {
        method: 'POST',
        body: JSON.stringify({ id, ...payload }),
      });
    } else {
      throw err;
    }
  }
}

export async function getMessages(_db: ServerDb, id: string): Promise<ChatHistoryItem> {
  return apiFetch(`/api/chats/${id}`);
}

export async function getMessagesByUrlId(_db: ServerDb, id: string): Promise<ChatHistoryItem> {
  return getMessages(_db, id);
}

export async function getMessagesById(_db: ServerDb, id: string): Promise<ChatHistoryItem> {
  return getMessages(_db, id);
}

export async function deleteById(_db: ServerDb, id: string): Promise<void> {
  await apiFetch(`/api/chats/${id}`, { method: 'DELETE' });
}

export async function getNextId(_db: ServerDb): Promise<string> {
  const chats: ChatHistoryItem[] = await getAll(_db);
  const highest = chats.reduce((max, c) => Math.max(max, parseInt(c.id, 10) || 0), 0);

  return String(highest + 1);
}

export async function getUrlId(_db: ServerDb, id: string): Promise<string> {
  const chats: ChatHistoryItem[] = await getAll(_db);
  const urlIds = chats.map((c) => c.urlId).filter(Boolean) as string[];

  if (!urlIds.includes(id)) {
    return id;
  }

  let i = 2;

  while (urlIds.includes(`${id}-${i}`)) {
    i++;
  }

  return `${id}-${i}`;
}

export async function createChatFromMessages(
  db: ServerDb,
  description: string,
  messages: Message[],
  metadata?: IChatMetadata,
): Promise<string> {
  const result = await apiFetch('/api/chats', {
    method: 'POST',
    body: JSON.stringify({ description, messages, metadata }),
  });
  return result.urlId;
}

export async function duplicateChat(_db: ServerDb, id: string): Promise<string> {
  const result = await apiFetch(`/api/chats/${id}`, { method: 'POST' });
  return result.urlId;
}

export async function forkChat(_db: ServerDb, chatId: string, messageId: string): Promise<string> {
  const chat = await getMessages(_db, chatId);

  if (!chat) {
    throw new Error('Chat not found');
  }

  const messageIndex = chat.messages.findIndex((msg) => msg.id === messageId);

  if (messageIndex === -1) {
    throw new Error('Message not found');
  }

  return createChatFromMessages(
    _db,
    chat.description ? `${chat.description} (fork)` : 'Forked chat',
    chat.messages.slice(0, messageIndex + 1),
  );
}

export async function updateChatDescription(_db: ServerDb, id: string, description: string): Promise<void> {
  if (!description.trim()) {
    throw new Error('Description cannot be empty');
  }

  const chat = await getMessages(_db, id);

  await setMessages(_db, id, chat.messages, chat.urlId, description, chat.timestamp, chat.metadata);
}

export async function updateChatMetadata(
  _db: ServerDb,
  id: string,
  metadata: IChatMetadata | undefined,
): Promise<void> {
  const chat = await getMessages(_db, id);
  await setMessages(_db, id, chat.messages, chat.urlId, chat.description, chat.timestamp, metadata);
}

export async function getSnapshot(_db: ServerDb, chatId: string): Promise<Snapshot | undefined> {
  return apiFetch(`/api/chats/${chatId}/snapshot`);
}

export async function setSnapshot(_db: ServerDb, chatId: string, snapshot: Snapshot): Promise<void> {
  await apiFetch(`/api/chats/${chatId}/snapshot`, {
    method: 'PUT',
    body: JSON.stringify(snapshot),
  });
}

export async function deleteSnapshot(_db: ServerDb, chatId: string): Promise<void> {
  await apiFetch(`/api/chats/${chatId}`, { method: 'DELETE' });
}
