import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import {exchangeCodeForToken, saveToken} from '../src/pipeline/tiktok-token';

const AUTHORIZE_URL = 'https://www.tiktok.com/v2/auth/authorize/';
const DEFAULT_REDIRECT = 'http://localhost:5173/callback';
const DEFAULT_SCOPE = 'user.info.basic,video.upload,video.publish';

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

const waitForCallback = (params: {
  redirect: URL;
  expectedState: string;
}): Promise<string> =>
  new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (!req.url) {
        res.statusCode = 400;
        res.end('Bad request');
        return;
      }
      const reqUrl = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
      if (reqUrl.pathname !== params.redirect.pathname) {
        res.statusCode = 404;
        res.end('Not found');
        return;
      }
      const error = reqUrl.searchParams.get('error');
      if (error) {
        const description = reqUrl.searchParams.get('error_description') ?? '';
        res.statusCode = 400;
        res.end(`Authorization failed: ${error} ${description}`);
        server.close();
        reject(new Error(`${error}: ${description}`));
        return;
      }
      const receivedState = reqUrl.searchParams.get('state');
      const code = reqUrl.searchParams.get('code');
      if (receivedState !== params.expectedState) {
        res.statusCode = 400;
        res.end('Invalid state parameter.');
        server.close();
        reject(new Error('State mismatch (possible CSRF).'));
        return;
      }
      if (!code) {
        res.statusCode = 400;
        res.end('Missing authorization code.');
        server.close();
        reject(new Error('Authorization code missing in callback.'));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        '<!doctype html><html lang="ja"><body style="font-family:sans-serif;padding:2rem"><h1>認可完了</h1><p>ターミナルに戻って処理の続きを確認してください。このタブは閉じて構いません。</p></body></html>',
      );
      server.close();
      resolve(code);
    });
    server.on('error', reject);
    const port = Number(params.redirect.port) || 80;
    server.listen(port, params.redirect.hostname);
  });

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

  const redirect = new URL(redirectUri);
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

  console.log('Open this URL in your browser to authorize tikbuzz:\n');
  console.log(authUrl.toString());
  console.log('');
  console.log(`Waiting for callback at ${redirectUri} ...`);

  const code = await waitForCallback({redirect, expectedState: state});

  const token = await exchangeCodeForToken({
    clientKey,
    clientSecret,
    code,
    redirectUri,
    codeVerifier,
  });
  await saveToken(rootDir, token);
  console.log(`Saved token to ${path.join(rootDir, '.tiktok-token.json')}`);
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
