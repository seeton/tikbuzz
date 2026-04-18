import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {fileExists} from '../lib/fs';

const TOKEN_FILE_NAME = '.tiktok-token.json';
const TOKEN_ENDPOINT = 'https://open.tiktokapis.com/v2/oauth/token/';
const REFRESH_MARGIN_MS = 120_000;

export const tiktokTokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  expiresAt: z.string().min(1),
  refreshExpiresAt: z.string().min(1),
  openId: z.string().min(1),
  scope: z.string().min(1),
  tokenType: z.string().min(1),
  obtainedAt: z.string().min(1),
});

export type TiktokToken = z.infer<typeof tiktokTokenSchema>;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  expires_in: z.number(),
  refresh_expires_in: z.number(),
  open_id: z.string(),
  scope: z.string(),
  token_type: z.string(),
});

type TokenResponse = z.infer<typeof tokenResponseSchema>;

export const tokenFilePath = (rootDir: string) =>
  path.join(rootDir, TOKEN_FILE_NAME);

export const saveToken = async (rootDir: string, token: TiktokToken) => {
  const filePath = tokenFilePath(rootDir);
  await fs.writeFile(filePath, JSON.stringify(token, null, 2) + '\n', {
    encoding: 'utf8',
    mode: 0o600,
  });
};

export const loadToken = async (rootDir: string): Promise<TiktokToken> => {
  const filePath = tokenFilePath(rootDir);
  if (!(await fileExists(filePath))) {
    throw new Error(
      `TikTok token file not found at ${filePath}. Run tiktok:auth first.`,
    );
  }
  const raw = await fs.readFile(filePath, 'utf8');
  return tiktokTokenSchema.parse(JSON.parse(raw));
};

const normalizeToken = (response: TokenResponse): TiktokToken => {
  const now = Date.now();
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    expiresAt: new Date(now + response.expires_in * 1000).toISOString(),
    refreshExpiresAt: new Date(
      now + response.refresh_expires_in * 1000,
    ).toISOString(),
    openId: response.open_id,
    scope: response.scope,
    tokenType: response.token_type,
    obtainedAt: new Date(now).toISOString(),
  };
};

const postTokenEndpoint = async (body: URLSearchParams): Promise<TiktokToken> => {
  const response = await fetch(TOKEN_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Cache-Control': 'no-cache',
    },
    body,
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(
      `TikTok token endpoint returned non-JSON (${response.status}): ${text}`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `TikTok token endpoint failed (${response.status}): ${JSON.stringify(json)}`,
    );
  }
  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `TikTok token response did not match schema: ${JSON.stringify(json)}`,
    );
  }
  return normalizeToken(parsed.data);
};

export const exchangeCodeForToken = async (params: {
  clientKey: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}): Promise<TiktokToken> => {
  const body = new URLSearchParams({
    client_key: params.clientKey,
    client_secret: params.clientSecret,
    code: params.code,
    grant_type: 'authorization_code',
    redirect_uri: params.redirectUri,
  });
  if (params.codeVerifier) {
    body.set('code_verifier', params.codeVerifier);
  }
  return postTokenEndpoint(body);
};

export const refreshAccessToken = async (params: {
  clientKey: string;
  clientSecret: string;
  refreshToken: string;
}): Promise<TiktokToken> => {
  const body = new URLSearchParams({
    client_key: params.clientKey,
    client_secret: params.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
  });
  return postTokenEndpoint(body);
};

export const ensureFreshToken = async (params: {
  rootDir: string;
  clientKey: string;
  clientSecret: string;
}): Promise<TiktokToken> => {
  const token = await loadToken(params.rootDir);
  const expiresAtMs = new Date(token.expiresAt).getTime();
  if (expiresAtMs - Date.now() > REFRESH_MARGIN_MS) {
    return token;
  }
  const refreshExpiresAtMs = new Date(token.refreshExpiresAt).getTime();
  if (refreshExpiresAtMs <= Date.now()) {
    throw new Error(
      'TikTok refresh token has expired. Run tiktok:auth to re-authorize.',
    );
  }
  const refreshed = await refreshAccessToken({
    clientKey: params.clientKey,
    clientSecret: params.clientSecret,
    refreshToken: token.refreshToken,
  });
  await saveToken(params.rootDir, refreshed);
  return refreshed;
};
