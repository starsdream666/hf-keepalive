import { keepAlive } from './keepalive';
import { listSpaces } from './kv';
import type { Env, Space } from './types';
import { chunk } from './utils';

const BATCH_SIZE = 5;

/** cron 每分钟触发，按各 Space 的 intervalMinutes 判断是否真要保活 */
export async function runScheduler(env: Env, now: number): Promise<void> {
  const spaces = await listSpaces(env);
  const due = spaces.filter((s) => shouldRun(s, now));
  if (due.length === 0) return;
  for (const batch of chunk(due, BATCH_SIZE)) {
    await Promise.allSettled(batch.map((s) => keepAlive(env, s)));
  }
}

function shouldRun(space: Space, now: number): boolean {
  if (!space.enabled) return false;
  if (!space.lastRunAt) return true;
  return now - space.lastRunAt >= space.intervalMinutes * 60_000;
}
