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
      entry = await tryRestart(env, space, {
        ts: Date.now(),
        action: 'get',
        httpStatus: res.status,
        durationMs,
        error: `HTTP ${res.status}`,
      });
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
    entry = await tryRestart(env, space, {
      ts: Date.now(),
      action: 'get',
      durationMs,
      error: errMsg,
    });
  }

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

async function tryRestart(
  env: Env,
  space: Space,
  baseEntry: LogEntry,
): Promise<LogEntry> {
  if (!space.autoRestart) return baseEntry;
  const cfg = await getConfig(env);
  if (!cfg.hfToken) {
    return { ...baseEntry, error: `${baseEntry.error ?? 'fetch failed'}; no HF token` };
  }
  const cooldown = lastRestartAt.get(space.id);
  if (cooldown && Date.now() - cooldown < RESTART_COOLDOWN_MS) {
    return { ...baseEntry, error: `${baseEntry.error ?? 'fetch failed'}; restart cooldown` };
  }

  try {
    const rt = await getRuntime(space.namespace, space.repo, cfg.hfToken);
    if (!needsRestart(rt.stage)) {
      return { ...baseEntry, stage: rt.stage };
    }
    const restartStart = Date.now();
    await restartSpace(space.namespace, space.repo, cfg.hfToken);
    lastRestartAt.set(space.id, Date.now());
    return {
      ts: Date.now(),
      action: 'restart',
      stage: rt.stage,
      durationMs: baseEntry.durationMs + (Date.now() - restartStart),
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return { ...baseEntry, error: `${baseEntry.error ?? ''}; restart failed: ${errMsg}` };
  }
}
