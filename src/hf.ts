import type { HfStage } from './types';

const HF_BASE = 'https://huggingface.co';

export interface RuntimeInfo {
  stage: HfStage | string;
  hardware?: string;
  raw: unknown;
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
