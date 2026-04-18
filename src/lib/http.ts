const DEFAULT_HEADERS = {
  'user-agent':
    'tikbuzz/0.1 (+https://example.invalid; autonomous tiktok video pipeline)',
  accept:
    'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7',
};

const normalizeCharset = (value: string | null) => {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'utf8') {
    return 'utf-8';
  }
  if (
    normalized === 'shift-jis' ||
    normalized === 'shift_jis' ||
    normalized === 'windows-31j' ||
    normalized === 'x-sjis' ||
    normalized === 'sjis'
  ) {
    return 'shift_jis';
  }

  return normalized;
};

const detectHtmlCharset = (bytes: Buffer) => {
  const preview = bytes.toString('latin1', 0, Math.min(bytes.length, 4096));
  const metaCharset =
    preview.match(/<meta[^>]+charset=["']?\s*([^"'>\s]+)/iu)?.[1] ??
    preview.match(
      /<meta[^>]+content=["'][^"']*charset=([^"'>;\s]+)[^"']*["']/iu,
    )?.[1] ??
    null;
  return normalizeCharset(metaCharset);
};

const decodeText = (bytes: Buffer, contentType: string | null) => {
  const headerCharset =
    contentType?.match(/charset=([^;]+)/iu)?.[1]?.trim() ?? null;
  const preferredCharset =
    normalizeCharset(headerCharset) ?? detectHtmlCharset(bytes) ?? 'utf-8';

  try {
    return new TextDecoder(preferredCharset).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
};

const withTimeout = async (url: string, init?: RequestInit) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    return await fetch(url, {
      ...init,
      headers: {
        ...DEFAULT_HEADERS,
        ...(init?.headers ?? {}),
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
};

export const fetchText = async (url: string, init?: RequestInit) => {
  const response = await withTimeout(url, init);
  if (!response.ok) {
    throw new Error(`Failed to fetch text from ${url}: ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return decodeText(bytes, response.headers.get('content-type'));
};

export const fetchJson = async <T>(url: string, init?: RequestInit) => {
  const response = await withTimeout(url, init);
  if (!response.ok) {
    throw new Error(`Failed to fetch JSON from ${url}: ${response.status}`);
  }

  return (await response.json()) as T;
};

export const fetchBytes = async (url: string, init?: RequestInit) => {
  const response = await withTimeout(url, init);
  if (!response.ok) {
    throw new Error(`Failed to fetch bytes from ${url}: ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return {
    bytes,
    contentType: response.headers.get('content-type') ?? 'application/octet-stream',
  };
};
