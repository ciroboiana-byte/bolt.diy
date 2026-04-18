import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(process.cwd(), 'data', 'chats');

function ensureDir() {
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function chatPath(id: string) {
  return join(DATA_DIR, `${id}.json`);
}

export function readChat(id: string) {
  const p = chatPath(id);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}

export function writeChat(data: object & { id: string }) {
  ensureDir();
  writeFileSync(chatPath(data.id), JSON.stringify(data, null, 2), 'utf8');
}

export function allChats() {
  ensureDir();

  return readdirSync(DATA_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function nextId(): string {
  const chats = allChats();
  const highest = chats.reduce((max: number, c: any) => Math.max(max, parseInt(c.id, 10) || 0), 0);

  return String(highest + 1);
}

export function allUrlIds(): string[] {
  return allChats()
    .map((c: any) => c.urlId)
    .filter(Boolean);
}

/** GET /api/chats — list all chats */
export async function loader() {
  return json(allChats());
}

/** POST /api/chats — create a new chat */
export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const body = await request.json();
  const { id: forcedId, description, messages, metadata } = body as any;

  /* Allow callers to supply an id (e.g. upsert from setMessages). */
  const id = forcedId ?? nextId();
  const existingUrlIds = allUrlIds();
  let urlId = id;
  let i = 2;

  while (existingUrlIds.includes(urlId)) {
    urlId = `${id}-${i++}`;
  }

  const chat = {
    id,
    urlId,
    description: description ?? '',
    messages: messages ?? [],
    timestamp: new Date().toISOString(),
    metadata: metadata ?? null,
  };

  writeChat(chat);

  return json({ id, urlId });
}
