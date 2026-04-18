import { json, type ActionFunctionArgs, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const SNAPSHOT_DIR = join(process.cwd(), 'data', 'snapshots');

function ensureDir() {
  if (!existsSync(SNAPSHOT_DIR)) {
    mkdirSync(SNAPSHOT_DIR, { recursive: true });
  }
}

function snapshotPath(chatId: string) {
  return join(SNAPSHOT_DIR, `${chatId}.json`);
}

/** GET /api/chats/:id/snapshot */
export async function loader({ params }: LoaderFunctionArgs) {
  const { id } = params;

  if (!id) {
    return json({ error: 'Missing id' }, { status: 400 });
  }

  const p = snapshotPath(id);

  if (!existsSync(p)) {
    return json(null);
  }

  return json(JSON.parse(readFileSync(p, 'utf8')));
}

/** PUT /api/chats/:id/snapshot */
export async function action({ request, params }: ActionFunctionArgs) {
  const { id } = params;

  if (!id) {
    return json({ error: 'Missing id' }, { status: 400 });
  }

  if (request.method !== 'PUT') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const snapshot = await request.json();
  ensureDir();
  writeFileSync(snapshotPath(id), JSON.stringify(snapshot, null, 2), 'utf8');

  return json({ ok: true });
}
