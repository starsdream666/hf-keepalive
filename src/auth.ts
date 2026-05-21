import type { Env, SessionClaims } from './types';

const COOKIE_NAME = 'session';
const SESSION_TTL_SEC = 7 * 24 * 60 * 60;
const enc = new TextEncoder();
const dec = new TextDecoder();

function b64urlEncode(data: ArrayBuffer | Uint8Array | string): string {
  const bytes =
    typeof data === 'string'
      ? enc.encode(data)
      : data instanceof Uint8Array
        ? data
        : new Uint8Array(data);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlDecode(str: string): Uint8Array {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function sign(payload: string, secret: string): Promise<string> {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return b64urlEncode(sig);
}

async function verify(
  payload: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await hmacKey(secret);
  return crypto.subtle.verify(
    'HMAC',
    key,
    b64urlDecode(signature),
    enc.encode(payload),
  );
}

/** 常数时间字符串比较 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function issueSessionCookie(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const claims: SessionClaims = {
    sub: 'admin',
    iat: now,
    exp: now + SESSION_TTL_SEC,
  };
  const payload = b64urlEncode(JSON.stringify(claims));
  const sig = await sign(payload, env.SESSION_SECRET);
  const value = `${payload}.${sig}`;
  return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SEC}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.get('cookie');
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

export async function readSession(
  req: Request,
  env: Env,
): Promise<SessionClaims | null> {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  try {
    if (!(await verify(payload, sig, env.SESSION_SECRET))) return null;
    const claims = JSON.parse(dec.decode(b64urlDecode(payload))) as SessionClaims;
    if (!claims.exp || claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

export async function isAuthed(req: Request, env: Env): Promise<boolean> {
  return (await readSession(req, env)) !== null;
}
