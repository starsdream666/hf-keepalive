import { listCurrentAccountSpaces } from './hf';
import { addSpace, listSpaces, putSpace } from './kv';
import type { Env, Space } from './types';
import { buildSpaceUrl, newId } from './utils';

const DEFAULT_INTERVAL_MINUTES = 10;

export interface ImportResult {
  found: number;
  imported: number;
  updated: number;
  skipped: number;
}

export async function importSpacesFromHfToken(
  env: Env,
  token: string,
): Promise<ImportResult> {
  const hfSpaces = await listCurrentAccountSpaces(token);
  const existing = await listSpaces(env);
  const existingByRepo = new Map(
    existing.map((space) => [repoKey(space.namespace, space.repo), space]),
  );

  let imported = 0;
  let updated = 0;
  let skipped = 0;

  for (const hfSpace of hfSpaces) {
    const parsed = parseRepoId(hfSpace.id);
    if (!parsed) {
      skipped += 1;
      continue;
    }

    const url = hfSpace.host || buildSpaceUrl(parsed.namespace, parsed.repo);
    const current = existingByRepo.get(repoKey(parsed.namespace, parsed.repo));
    if (current) {
      if (current.url !== url) {
        await putSpace(env, { ...current, url });
        updated += 1;
      } else {
        skipped += 1;
      }
      continue;
    }

    const space: Space = {
      id: newId(),
      name: hfSpace.id.slice(0, 80),
      namespace: parsed.namespace,
      repo: parsed.repo,
      url,
      intervalMinutes: DEFAULT_INTERVAL_MINUTES,
      enabled: true,
      autoRestart: true,
      lastRunAt: null,
      lastStatus: null,
      lastStage: null,
      lastStageAt: null,
      createdAt: Date.now(),
    };
    await addSpace(env, space);
    imported += 1;
  }

  return { found: hfSpaces.length, imported, updated, skipped };
}

function parseRepoId(id: string): { namespace: string; repo: string } | null {
  const parts = id.split('/');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { namespace: parts[0].toLowerCase(), repo: parts[1] };
}

function repoKey(namespace: string, repo: string): string {
  return `${namespace.toLowerCase()}/${repo.toLowerCase()}`;
}
