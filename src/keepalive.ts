import { appendLog, getConfig, putSpace } from './kv';
import { getRuntime, needsRestart, restartSpace } from './hf';
import type { Env, LogEntry, Space } from './types';

const RESTART_COOLDOWN_MS = 5 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15000;

/** 进程内冷却，避免同 Space 短时间内多次 restart */
const lastRestartAt = new Map<string, number>();

/**
 * 单 Space 保活动作。
 * 1. GET space.url —— 2xx 即视为成功
 * 2. 失败 / 5xx / 超时 + autoRestart + 有 token → 查 runtime；若 stage 需要 restart，则 POST restart
 * 3. 所有情况都写入日志，并更新 space.lastRunAt / lastStatus
 */
export async function keepAlive(env: Env, space: Space): Promise<LogEntry> {
  const start = Date.now();
  const cfg = await getConfig(env);
  let entry: LogEntry;

  try {
    const res = await fetch(space.url, {
      method: 'GET',
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { 'user-agent': 'hf-keepalive/1.0 (+cloudflare-workers)' },
    });
    const durationMs = Date.now() - start;

    if (res.ok) {
      entry = {
        ts: Date.now(),
        action: 'get',
        httpStatus: res.status,
        durationMs,
      };
      space.lastStatus = 'ok';
    } else if (res.status >= 500 || res.status === 503) {
      entry = {
        ts: Date.now(),
        action: 'get',
        httpStatus: res.status,
        durationMs,
        error: `HTTP ${res.status}`,
      };
    } else {
      // 4xx：Space 可能存在但路由 404，对保活而言已是活动；记为 get 成功
      entry = {
        ts: Date.now(),
        action: 'get',
        httpStatus: res.status,
        durationMs,
      };
      space.lastStatus = 'ok';
    }
  } catch (err) {
    const durationMs = Date.now() - start;
    const errMsg = err instanceof Error ? err.message : String(err);
    entry = {
      ts: Date.now(),
      action: 'get',
      durationMs,
      error: errMsg,
    };
  }

  entry = await detectRuntimeAndMaybeRestart(env, space, entry, cfg.hfToken);

  // 根据最终 entry 决定 lastStatus
  if (entry.action === 'restart' && !entry.error) {
    space.lastStatus = 'restart';
  } else if (entry.error) {
    space.lastStatus = 'error';
  } else if (!space.lastStatus) {
    space.lastStatus = 'ok';
  }

  space.lastRunAt = entry.ts;
  await Promise.all([putSpace(env, space), appendLog(env, space.id, entry)]);
  return entry;
}

async function detectRuntimeAndMaybeRestart(
  env: Env,
  space: Space,
  baseEntry: LogEntry,
  token?: string,
): Promise<LogEntry> {
  let entry = baseEntry;
  let stage = entry.stage;

  try {
    const rt = await getRuntime(space.namespace, space.repo, token);
    stage = rt.stage;
    entry = { ...entry, stage };
    space.lastStage = stage;
    space.lastStageAt = Date.now();
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (entry.error) {
      entry = { ...entry, error: `${entry.error}; runtime status failed: ${errMsg}` };
    }
  }

  if (!space.autoRestart) return entry;
  if (!entry.error && (!stage || !needsRestart(stage))) return entry;
  if (!token) return { ...entry, error: `${entry.error ?? 'needs restart'}; no HF token` };

  const cooldown = lastRestartAt.get(space.id);
  if (cooldown && Date.now() - cooldown < RESTART_COOLDOWN_MS) {
    return { ...entry, error: `${entry.error ?? 'needs restart'}; restart cooldown` };
  }

  try {
    if (!stage) {
      const rt = await getRuntime(space.namespace, space.repo, token);
      stage = rt.stage;
      space.lastStage = stage;
      space.lastStageAt = Date.now();
      entry = { ...entry, stage };
    }
    if (!needsRestart(stage)) {
      return entry;
    }
    const restartStart = Date.now();
    await restartSpace(space.namespace, space.repo, token);
    lastRestartAt.set(space.id, Date.now());
    space.lastStage = 'APP_STARTING';
    space.lastStageAt = Date.now();
    return {
      ts: Date.now(),
      action: 'restart',
      stage,
      durationMs: entry.durationMs + (Date.now() - restartStart),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { ...entry, error: `${entry.error ?? ''}; restart failed: ${errMsg}` };
  }
}
