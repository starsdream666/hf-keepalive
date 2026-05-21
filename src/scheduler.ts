import { keepAlive } from './keepalive';
import { appendTaskLog, listSpaces } from './kv';
import type { Env, LogEntry, Space } from './types';
import { chunk } from './utils';

const BATCH_SIZE = 5;

export interface SchedulerResult {
  total: number;
  due: number;
  succeeded: number;
  failed: number;
  durationMs: number;
}

/** 由已登录前端定期触发，按各 Space 的 intervalMinutes 判断是否真要保活 */
export async function runScheduler(
  env: Env,
  now: number,
): Promise<SchedulerResult> {
  const start = Date.now();
  const spaces = await listSpaces(env);
  const due = spaces.filter((s) => shouldRun(s, now));
  let succeeded = 0;
  let failed = 0;

  for (const batch of chunk(due, BATCH_SIZE)) {
    const results = await Promise.allSettled(batch.map((s) => keepAlive(env, s)));
    for (const result of results) {
      if (result.status === 'rejected') {
        failed += 1;
      } else if (hasActionError(result.value)) {
        failed += 1;
      } else {
        succeeded += 1;
      }
    }
  }

  const summary = {
    total: spaces.length,
    due: due.length,
    succeeded,
    failed,
    durationMs: Date.now() - start,
  };
  await appendTaskLog(env, {
    ts: Date.now(),
    action: 'tick',
    ...summary,
  });
  return summary;
}

function shouldRun(space: Space, now: number): boolean {
  if (!space.enabled) return false;
  if (!space.lastRunAt) return true;
  return now - space.lastRunAt >= space.intervalMinutes * 60_000;
}

function hasActionError(entry: LogEntry): boolean {
  return !!entry.error || entry.stage === 'RUNTIME_ERROR' || entry.stage === 'BUILD_ERROR';
}
