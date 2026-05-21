import type { HfStage } from './types';

const HF_BASE = 'https://huggingface.co';

export interface RuntimeInfo {
  stage: HfStage | string;
  hardware?: string;
  raw: unknown;
}

export interface HfSpaceInfo {
  id: string;
  host?: string;
  subdomain?: string;
  private?: boolean;
}

export interface HfAccountInfo {
  names: string[];
  raw: unknown;
}

function authHeaders(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

export async function getCurrentAccount(token: string): Promise<HfAccountInfo> {
  const res = await fetch(`${HF_BASE}/api/whoami-v2`, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HF auth ${res.status}: ${text.slice(0, 200) || res.statusText}`);
  }
  const data = (await res.json()) as {
    name?: string;
    orgs?: Array<{ name?: string }>;
  };
  const names = [
    data.name,
    ...(Array.isArray(data.orgs) ? data.orgs.map((org) => org.name) : []),
  ].filter((name): name is string => !!name);
  if (names.length === 0) throw new Error('HF account has no user or org name');
  return { names: Array.from(new Set(names)), raw: data };
}

export async function listSpacesByAuthor(
  author: string,
  token: string,
): Promise<HfSpaceInfo[]> {
  const url = `${HF_BASE}/api/spaces?author=${encodeURIComponent(author)}&limit=100`;
  const res = await fetch(url, {
    headers: authHeaders(token),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `HF spaces ${author} ${res.status}: ${text.slice(0, 200) || res.statusText}`,
    );
  }
  const data = (await res.json()) as HfSpaceInfo[];
  return Array.isArray(data) ? data.filter((item) => !!item.id) : [];
}

export async function listCurrentAccountSpaces(token: string): Promise<HfSpaceInfo[]> {
  const account = await getCurrentAccount(token);
  const all = await Promise.all(
    account.names.map((name) => listSpacesByAuthor(name, token)),
  );
  const byId = new Map<string, HfSpaceInfo>();
  for (const space of all.flat()) byId.set(space.id, space);
  return [...byId.values()];
}

/** GET /api/spaces/{ns}/{repo}/runtime */
export async function getRuntime(
  namespace: string,
  repo: string,
  token?: string,
): Promise<RuntimeInfo> {
  const url = `${HF_BASE}/api/spaces/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/runtime`;
  const res = await fetch(url, {
    headers: token ? { authorization: `Bearer ${token}` } : undefined,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `HF runtime ${res.status}: ${text.slice(0, 200) || res.statusText}`,
    );
  }
  const data = (await res.json()) as { stage?: string; hardware?: { current?: string } };
  return {
    stage: data.stage ?? 'UNKNOWN',
    hardware: data.hardware?.current,
    raw: data,
  };
}

/** POST /api/spaces/{ns}/{repo}/restart */
export async function restartSpace(
  namespace: string,
  repo: string,
  token: string,
): Promise<void> {
  const url = `${HF_BASE}/api/spaces/${encodeURIComponent(namespace)}/${encodeURIComponent(repo)}/restart`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `HF restart ${res.status}: ${text.slice(0, 200) || res.statusText}`,
    );
  }
}

/** 已休眠 / 停止 / 异常状态需要 restart */
export function needsRestart(stage: string): boolean {
  return (
    stage === 'SLEEPING' ||
    stage === 'STOPPED' ||
    stage === 'PAUSED' ||
    stage === 'RUNTIME_ERROR' ||
    stage === 'NO_APP_FILE' ||
    stage === 'BUILD_ERROR'
  );
}
