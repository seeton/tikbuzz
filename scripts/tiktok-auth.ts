import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import readline from 'node:readline/promises';
import {stdin as input, stdout as output} from 'node:process';
import {exchangeCodeForToken, saveToken} from '../src/pipeline/tiktok-token';

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const DEFAULT_REDIRECT = 'https://seeton.github.io/tikbuzz/callback.html';
const DEFAULT_SCOPE = 'user.info.basic,video.upload';

const readDotEnv = async (rootDir: string) => {
  const envPath = path.join(rootDir, '.env');
  try {
    const content = await fs.readFile(envPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) {
        continue;
      }
      const [key, ...rest] = trimmed.split('=');
      if (key && process.env[key] == null) {
        process.env[key] = rest.join('=').trim();
      }
    }
  } catch {
    // .env is optional.
  }
};

const base64Url = (buffer: Buffer) =>
  buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

const generatePkce = () => {
  const codeVerifier = base64Url(crypto.randomBytes(32));
  const codeChallenge = base64Url(
    crypto.createHash('sha256').update(codeVerifier).digest(),
  );
  return {codeVerifier, codeChallenge};
};

const parseCallback = (raw: string, expectedState: string) => {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('入力が空です。');
  }
  let params: URLSearchParams;
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    params = new URL(trimmed).searchParams;
  } else if (trimmed.startsWith('?') || trimmed.includes('=')) {
    params = new URLSearchParams(
      trimmed.startsWith('?') ? trimmed.slice(1) : trimmed,
    );
  } else {
    params = new URLSearchParams({code: trimmed});
  }
  const error = params.get('error');
  if (error) {
    const description = params.get('error_description') ?? '';
    throw new Error(`Authorization error: ${error} ${description}`.trim());
  }
  const code = params.get('code');
  if (!code) {
    throw new Error('code パラメータが見つかりません。');
  }
  const state = params.get('state');
  if (state && state !== expectedState) {
    throw new Error('state 不一致 (CSRF の可能性)。最初からやり直してください。');
  }
  if (!state) {
    console.warn(
      'warning: state が見つかりません。code のみの入力でも続行しますが、CSRF 対策の検証ができません。',
    );
  }
  return code;
};

const main = async () => {
  const rootDir = process.cwd();
  await readDotEnv(rootDir);

  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  const redirectUri = process.env.TIKTOK_REDIRECT_URI ?? DEFAULT_REDIRECT;
  const scope = process.env.TIKTOK_SCOPE ?? DEFAULT_SCOPE;

  if (!clientKey || !clientSecret) {
    throw new Error(
      'TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must be set in .env',
    );
  }

  const state = base64Url(crypto.randomBytes(16));
  const {codeVerifier, codeChallenge} = generatePkce();

  const authUrl = new URL(AUTHORIZE_URL);
  authUrl.searchParams.set('client_key', clientKey);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', scope);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  console.log('1) Open this URL in your browser and authorize tikbuzz:\n');
  console.log(authUrl.toString());
  console.log('');
  console.log(
    `2) After approval, TikTok redirects to ${redirectUri} with ?code=...&state=...`,
  );
  console.log('   Copy the FULL redirected URL from the address bar.');
  console.log('');

  const rl = readline.createInterface({input, output});
  const raw = await rl.question('3) Paste the redirected URL (or just the code) here:\n> ');
  rl.close();

  const code = parseCallback(raw, state);

  const token = await exchangeCodeForToken({
    clientKey,
    clientSecret,
    code,
    redirectUri,
    codeVerifier,
  });
  await saveToken(rootDir, token);
  console.log(`\nSaved token to ${path.join(rootDir, '.tiktok-token.json')}`);
  console.log(
    JSON.stringify(
      {
        openId: token.openId,
        scope: token.scope,
        expiresAt: token.expiresAt,
        refreshExpiresAt: token.refreshExpiresAt,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
