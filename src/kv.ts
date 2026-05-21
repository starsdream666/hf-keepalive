import type {
  Env,
  GlobalConfig,
  LogEntry,
  Space,
  SpaceIndex,
  TaskLogEntry,
} from './types';

const KEY_INDEX = 'space:index';
const KEY_CONFIG = 'config:global';
const KEY_TASK_LOGS = 'task:logs';
const LOG_LIMIT = 50;
const TASK_LOG_LIMIT = 100;

const keySpace = (id: string) => `space:${id}`;
const keyLogs = (id: string) => `space:${id}:logs`;

export async function getIndex(env: Env): Promise<SpaceIndex> {
  const raw = await env.KV.get(KEY_INDEX, 'json');
  return (raw as SpaceIndex | null) ?? { ids: [] };
}

async function putIndex(env: Env, index: SpaceIndex): Promise<void> {
  await env.KV.put(KEY_INDEX, JSON.stringify(index));
}

export async function getSpace(env: Env, id: string): Promise<Space | null> {
  return (await env.KV.get(keySpace(id), 'json')) as Space | null;
}

export async function listSpaces(env: Env): Promise<Space[]> {
  const { ids } = await getIndex(env);
  if (ids.length === 0) return [];
  const results = await Promise.all(ids.map((id) => getSpace(env, id)));
  return results.filter((s): s is Space => s !== null);
}

export async function putSpace(env: Env, space: Space): Promise<void> {
  await env.KV.put(keySpace(space.id), JSON.stringify(space));
}

export async function addSpace(env: Env, space: Space): Promise<void> {
  await putSpace(env, space);
  const index = await getIndex(env);
  if (!index.ids.includes(space.id)) {
    index.ids.push(space.id);
    await putIndex(env, index);
  }
}

export async function deleteSpace(env: Env, id: string): Promise<void> {
  await env.KV.delete(keySpace(id));
  await env.KV.delete(keyLogs(id));
  const index = await getIndex(env);
  const next = index.ids.filter((x) => x !== id);
  if (next.length !== index.ids.length) {
    await putIndex(env, { ids: next });
  }
}

export async function getLogs(env: Env, id: string): Promise<LogEntry[]> {
  const raw = await env.KV.get(keyLogs(id), 'json');
  return (raw as LogEntry[] | null) ?? [];
}

export async function appendLog(
  env: Env,
  id: string,
  entry: LogEntry,
): Promise<void> {
  const logs = await getLogs(env, id);
  logs.unshift(entry);
  if (logs.length > LOG_LIMIT) logs.length = LOG_LIMIT;
  await env.KV.put(keyLogs(id), JSON.stringify(logs));
}

export async function getTaskLogs(env: Env): Promise<TaskLogEntry[]> {
  const raw = await env.KV.get(KEY_TASK_LOGS, 'json');
  return (raw as TaskLogEntry[] | null) ?? [];
}

export async function appendTaskLog(
  env: Env,
  entry: TaskLogEntry,
): Promise<void> {
  const logs = await getTaskLogs(env);
  logs.unshift(entry);
  if (logs.length > TASK_LOG_LIMIT) logs.length = TASK_LOG_LIMIT;
  await env.KV.put(KEY_TASK_LOGS, JSON.stringify(logs));
}

export async function getConfig(env: Env): Promise<GlobalConfig> {
  const raw = await env.KV.get(KEY_CONFIG, 'json');
  return (raw as GlobalConfig | null) ?? { updatedAt: 0 };
}

export async function putConfig(
  env: Env,
  config: GlobalConfig,
): Promise<void> {
  await env.KV.put(KEY_CONFIG, JSON.stringify(config));
}

/** 用 KV TTL 实现简单的 IP 限流（按分钟桶计数） */
export async function hitRateLimit(
  env: Env,
  ip: string,
  windowSec = 60,
  max = 10,
): Promise<boolean> {
  const key = `ratelimit:${ip}`;
  const cur = parseInt((await env.KV.get(key)) ?? '0', 10);
  if (cur >= max) return false;
  await env.KV.put(key, String(cur + 1), { expirationTtl: windowSec });
  return true;
}
