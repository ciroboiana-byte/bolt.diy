import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { readChat, writeChat, allChats, nextId, allUrlIds } from './api.chats';

const SNAPSHOT_DIR = join(process.cwd(), 'data', 'snapshots');

/** GET /api/chats/:id */
export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;

  if (!id) {
    return json({ error: 'Missing id' }, { status: 400 });
  }

  // Try by id first, then by urlId
  let chat = readChat(id);

  if (!chat) {
    chat = allChats().find((c: any) => c.urlId === id) ?? null;
  }

  if (!chat) {
    return json({ error: 'Not found' }, { status: 404 });
  }

  return json(chat);
}

export async function action({ request, params }: ActionFunctionArgs) {
  const { id } = params;

  if (!id) {
    return json({ error: 'Missing id' }, { status: 400 });
  }

  if (request.method === 'PUT') {
    const body = (await request.json()) as Record<string, unknown>;
    const existing: Record<string, unknown> | null =
      readChat(id) ?? allChats().find((c: any) => c.urlId === id) ?? null;

    if (!existing) {
      return json({ error: 'Not found' }, { status: 404 });
    }

    const updated = {
      ...existing,
      ...body,
      id: existing.id as string, // never overwrite the real id
      timestamp: (body.timestamp as string | undefined) ?? new Date().toISOString(),
    };

    writeChat(updated);

    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    const chatPath = join(process.cwd(), 'data', 'chats', `${id}.json`);
    const snapshotPath = join(SNAPSHOT_DIR, `${id}.json`);

    if (existsSync(chatPath)) {
      unlinkSync(chatPath);
    }

    if (existsSync(snapshotPath)) {
      unlinkSync(snapshotPath);
    }

    return json({ ok: true });
  }

  if (request.method === 'POST') {
    // duplicate
    const chat = readChat(id) ?? allChats().find((c: any) => c.urlId === id);

    if (!chat) {
      return json({ error: 'Not found' }, { status: 404 });
    }

    const newId = nextId();
    const existingUrlIds = allUrlIds();
    let newUrlId = newId;
    let i = 2;

    while (existingUrlIds.includes(newUrlId)) {
      newUrlId = `${newId}-${i++}`;
    }

    writeChat({
      ...chat,
      id: newId,
      urlId: newUrlId,
      description: `${chat.description || 'Chat'} (copy)`,
      timestamp: new Date().toISOString(),
    });

    return json({ id: newId, urlId: newUrlId });
  }

  return json({ error: 'Method not allowed' }, { status: 405 });
}
