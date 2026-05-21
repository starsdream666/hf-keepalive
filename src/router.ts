import {
  clearSessionCookie,
  isAuthed,
  issueSessionCookie,
  safeEqual,
} from './auth';
import { importSpacesFromHfToken } from './importer';
import { keepAlive } from './keepalive';
import {
  addSpace,
  deleteSpace,
  getConfig,
  getLogs,
  getSpace,
  getTaskLogs,
  hitRateLimit,
  listSpaces,
  putConfig,
  putSpace,
} from './kv';
import { runScheduler } from './scheduler';
import type { Env, Space, SpaceInput } from './types';
import {
  clientIp,
  errorResponse,
  jsonResponse,
  newId,
  parseSpaceInput,
} from './utils';

export async function handleApi(
  req: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  const { pathname } = url;
  if (!pathname.startsWith('/api/')) return null;

  // -- public route: login
  if (pathname === '/api/login' && req.method === 'POST') {
    return handleLogin(req, env);
  }

  // -- auth gate
  if (!(await isAuthed(req, env))) {
    return errorResponse(401, 'unauthorized');
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    return new Response(null, {
      status: 204,
      headers: { 'set-cookie': clearSessionCookie() },
    });
  }
  if (pathname === '/api/me' && req.method === 'GET') {
    return jsonResponse({ authed: true });
  }
  if (pathname === '/api/tick' && req.method === 'POST') {
    return jsonResponse(await runScheduler(env, Date.now()));
  }
  if (pathname === '/api/task-logs' && req.method === 'GET') {
    return jsonResponse(await getTaskLogs(env));
  }
  if (pathname === '/api/spaces') {
    if (req.method === 'GET') return jsonResponse(await listSpaces(env));
    if (req.method === 'POST') return handleCreateSpace(req, env);
  }

  const spaceMatch = pathname.match(/^\/api\/spaces\/([^/]+)(\/[^/]+)?$/);
  if (spaceMatch) {
    const id = spaceMatch[1];
    const sub = spaceMatch[2];
    if (!sub) {
      if (req.method === 'PATCH') return handlePatchSpace(req, env, id);
      if (req.method === 'DELETE') return handleDeleteSpace(env, id);
    } else if (sub === '/ping' && req.method === 'POST') {
      return handlePing(env, id);
    } else if (sub === '/logs' && req.method === 'GET') {
      return jsonResponse(await getLogs(env, id));
    }
  }

  if (pathname === '/api/config') {
    if (req.method === 'GET') {
      const cfg = await getConfig(env);
      return jsonResponse({
        hasToken: !!cfg.hfToken,
        updatedAt: cfg.updatedAt,
      });
    }
    if (req.method === 'PUT') return handlePutConfig(req, env);
  }
  if (pathname === '/api/config/sync-spaces' && req.method === 'POST') {
    return handleSyncSpaces(env);
  }

  return errorResponse(404, 'not found');
}

async function handleLogin(req: Request, env: Env): Promise<Response> {
  const ip = clientIp(req);
  if (!(await hitRateLimit(env, ip, 60, 10))) {
    return errorResponse(429, 'too many attempts, try later');
  }
  let body: { password?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'invalid body');
  }
  const password = (body.password ?? '').toString();
  if (!password || !safeEqual(password, env.ADMIN_PASSWORD)) {
    return errorResponse(401, 'invalid password');
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'set-cookie': await issueSessionCookie(env),
    },
  });
}

async function handleCreateSpace(req: Request, env: Env): Promise<Response> {
  let body: Partial<SpaceInput>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'invalid body');
  }
  const parsed = parseSpaceInput(String(body.url ?? ''));
  if (!parsed) return errorResponse(400, 'invalid Space URL');
  const interval = Number(body.intervalMinutes);
  if (!Number.isFinite(interval) || interval < 1 || interval > 1440) {
    return errorResponse(400, 'intervalMinutes must be 1..1440');
  }
  const space: Space = {
    id: newId(),
    name: (body.name ?? `${parsed.namespace}/${parsed.repo}`).toString().slice(0, 80),
    namespace: parsed.namespace,
    repo: parsed.repo,
    url: parsed.url,
    intervalMinutes: Math.floor(interval),
    enabled: body.enabled !== false,
    autoRestart: !!body.autoRestart,
    lastRunAt: null,
    lastStatus: null,
    lastStage: null,
    lastStageAt: null,
    createdAt: Date.now(),
  };
  await addSpace(env, space);
  return jsonResponse(space, { status: 201 });
}

async function handlePatchSpace(
  req: Request,
  env: Env,
  id: string,
): Promise<Response> {
  const existing = await getSpace(env, id);
  if (!existing) return errorResponse(404, 'space not found');
  let body: Partial<SpaceInput>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'invalid body');
  }
  const next: Space = { ...existing };
  if (body.name !== undefined) next.name = String(body.name).slice(0, 80);
  if (body.url !== undefined) {
    const parsed = parseSpaceInput(String(body.url));
    if (!parsed) return errorResponse(400, 'invalid Space URL');
    next.namespace = parsed.namespace;
    next.repo = parsed.repo;
    next.url = parsed.url;
  }
  if (body.intervalMinutes !== undefined) {
    const v = Number(body.intervalMinutes);
    if (!Number.isFinite(v) || v < 1 || v > 1440) {
      return errorResponse(400, 'intervalMinutes must be 1..1440');
    }
    next.intervalMinutes = Math.floor(v);
  }
  if (body.enabled !== undefined) next.enabled = !!body.enabled;
  if (body.autoRestart !== undefined) next.autoRestart = !!body.autoRestart;
  await putSpace(env, next);
  return jsonResponse(next);
}

async function handleDeleteSpace(env: Env, id: string): Promise<Response> {
  await deleteSpace(env, id);
  return jsonResponse({ ok: true });
}

async function handlePing(env: Env, id: string): Promise<Response> {
  const space = await getSpace(env, id);
  if (!space) return errorResponse(404, 'space not found');
  const entry = await keepAlive(env, space);
  return jsonResponse(entry);
}

async function handlePutConfig(req: Request, env: Env): Promise<Response> {
  let body: { hfToken?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'invalid body');
  }
  const cur = await getConfig(env);
  const token = body.hfToken;
  if (token === undefined) return errorResponse(400, 'hfToken field required');
  if (!token) {
    await putConfig(env, {
      hfToken: undefined,
      updatedAt: Date.now(),
    });
    return jsonResponse({ ok: true, hasToken: false, prevHadToken: !!cur.hfToken });
  }

  const hfToken = String(token);
  const sync = await importSpacesFromHfToken(env, hfToken);
  await putConfig(env, {
    hfToken,
    updatedAt: Date.now(),
  });
  return jsonResponse({
    ok: true,
    hasToken: true,
    prevHadToken: !!cur.hfToken,
    sync,
  });
}

async function handleSyncSpaces(env: Env): Promise<Response> {
  const cfg = await getConfig(env);
  if (!cfg.hfToken) return errorResponse(400, 'HF token not configured');
  return jsonResponse(await importSpacesFromHfToken(env, cfg.hfToken));
}
