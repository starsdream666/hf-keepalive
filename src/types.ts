export interface Env {
  KV: KVNamespace;
  ASSETS: Fetcher;
  ADMIN_PASSWORD: string;
  SESSION_SECRET: string;
}

export interface SpaceIndex {
  ids: string[];
}

export interface Space {
  id: string;
  name: string;
  namespace: string;
  repo: string;
  url: string;
  intervalMinutes: number;
  enabled: boolean;
  autoRestart: boolean;
  lastRunAt: number | null;
  lastStatus: 'ok' | 'restart' | 'error' | null;
  lastStage?: string | null;
  lastStageAt?: number | null;
  createdAt: number;
}

export type SpaceInput = Pick<
  Space,
  'name' | 'url' | 'intervalMinutes' | 'enabled' | 'autoRestart'
>;

export interface LogEntry {
  ts: number;
  action: 'get' | 'restart' | 'skip';
  httpStatus?: number;
  stage?: string;
  durationMs: number;
  error?: string;
}

export interface TaskLogEntry {
  ts: number;
  action: 'tick';
  total: number;
  due: number;
  succeeded: number;
  failed: number;
  durationMs: number;
  error?: string;
}

export interface GlobalConfig {
  hfToken?: string;
  updatedAt: number;
}

export interface SessionClaims {
  sub: string;
  iat: number;
  exp: number;
}

export type HfStage =
  | 'NO_APP_FILE'
  | 'CONFIG_ERROR'
  | 'BUILDING'
  | 'BUILD_ERROR'
  | 'APP_STARTING'
  | 'RUNNING'
  | 'RUNNING_APP_STARTING'
  | 'RUNNING_BUILDING'
  | 'RUNTIME_ERROR'
  | 'DELETING'
  | 'STOPPED'
  | 'PAUSED'
  | 'SLEEPING';
