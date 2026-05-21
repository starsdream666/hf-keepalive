const HF_HOST_RE = /^https?:\/\/([a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?)-([a-z0-9._-]+)\.hf\.space\/?$/i;
const HF_PAGE_RE = /^https?:\/\/huggingface\.co\/spaces\/([^/\s]+)\/([^/\s?#]+)/i;
const REPO_PATH_RE = /^([^/\s]+)\/([^/\s]+)$/;

export interface ParsedSpace {
  namespace: string;
  repo: string;
  url: string;
}

/**
 * 兼容三种用户输入：
 *   https://{ns}-{repo}.hf.space
 *   https://huggingface.co/spaces/{ns}/{repo}
 *   {ns}/{repo}
 * 统一返回 { namespace, repo, url }，url 总是 .hf.space 形式。
 */
export function parseSpaceInput(raw: string): ParsedSpace | null {
  const input = raw.trim();
  if (!input) return null;

  const pageMatch = input.match(HF_PAGE_RE);
  if (pageMatch) {
    const namespace = pageMatch[1].toLowerCase();
    const repo = pageMatch[2];
    return { namespace, repo, url: buildSpaceUrl(namespace, repo) };
  }

  const hostMatch = input.match(HF_HOST_RE);
  if (hostMatch) {
    const namespace = hostMatch[1].toLowerCase();
    const repo = hostMatch[2];
    return { namespace, repo, url: buildSpaceUrl(namespace, repo) };
  }

  const pathMatch = input.match(REPO_PATH_RE);
  if (pathMatch) {
    const namespace = pathMatch[1].toLowerCase();
    const repo = pathMatch[2];
    return { namespace, repo, url: buildSpaceUrl(namespace, repo) };
  }

  return null;
}

export function buildSpaceUrl(namespace: string, repo: string): string {
  // HF Space 子域名规则：repo 中的下划线/点会被映射；这里保持用户输入原样，HF 通常会重定向。
  const safeRepo = repo.replace(/[^a-z0-9._-]/gi, '-');
  return `https://${namespace}-${safeRepo}.hf.space`;
}

export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers ?? {}),
    },
  });
}

export function errorResponse(status: number, message: string): Response {
  return jsonResponse({ error: message }, { status });
}

export function newId(): string {
  return crypto.randomUUID();
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function clientIp(req: Request): string {
  return (
    req.headers.get('cf-connecting-ip') ||
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}
