import fs from 'node:fs/promises';
import {z} from 'zod';
import {ensureFreshToken} from './tiktok-token';

const INBOX_INIT_URL =
  'https://open.tiktokapis.com/v2/post/publish/inbox/video/init/';
const STATUS_URL =
  'https://open.tiktokapis.com/v2/post/publish/status/fetch/';

const PREFERRED_CHUNK_SIZE = 10 * 1024 * 1024;
const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_POLL_MS = 10 * 60 * 1000;

const TERMINAL_STATUSES = new Set([
  'SEND_TO_USER_INBOX',
  'PUBLISH_COMPLETE',
  'FAILED',
]);

export const publishLogSchema = z.object({
  runId: z.string().min(1),
  mode: z.enum(['inbox', 'direct-post']),
  videoPath: z.string().min(1),
  videoSize: z.number().int().positive(),
  publishId: z.string().min(1),
  status: z.string().min(1),
  failReason: z.string().nullable(),
  startedAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type PublishLog = z.infer<typeof publishLogSchema>;

const errorSchema = z.object({
  code: z.string(),
  message: z.string().default(''),
  log_id: z.string().optional(),
});

const inboxInitResponseSchema = z.object({
  data: z
    .object({
      publish_id: z.string(),
      upload_url: z.string(),
    })
    .optional(),
  error: errorSchema,
});

const statusResponseSchema = z.object({
  data: z
    .object({
      status: z.string(),
      fail_reason: z.string().optional(),
    })
    .optional(),
  error: errorSchema,
});

type Chunking = {chunkSize: number; totalChunkCount: number};

const computeChunking = (videoSize: number): Chunking => {
  if (videoSize <= PREFERRED_CHUNK_SIZE) {
    return {chunkSize: videoSize, totalChunkCount: 1};
  }
  const chunkSize = PREFERRED_CHUNK_SIZE;
  const totalChunkCount = Math.max(1, Math.floor(videoSize / chunkSize));
  return {chunkSize, totalChunkCount};
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const assertOk = (error: z.infer<typeof errorSchema>, context: string) => {
  if (error.code !== 'ok') {
    throw new Error(
      `${context} failed: ${error.code} ${error.message}${error.log_id ? ` (log_id=${error.log_id})` : ''}`,
    );
  }
};

export const publishInboxVideo = async (params: {
  rootDir: string;
  runId: string;
  videoPath: string;
  clientKey: string;
  clientSecret: string;
  pollIntervalMs?: number;
  maxPollMs?: number;
}): Promise<PublishLog> => {
  const pollIntervalMs = params.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const maxPollMs = params.maxPollMs ?? DEFAULT_MAX_POLL_MS;
  const startedAt = new Date().toISOString();

  const token = await ensureFreshToken({
    rootDir: params.rootDir,
    clientKey: params.clientKey,
    clientSecret: params.clientSecret,
  });

  const stat = await fs.stat(params.videoPath);
  const videoSize = stat.size;
  if (videoSize === 0) {
    throw new Error(`Video file is empty: ${params.videoPath}`);
  }
  const chunking = computeChunking(videoSize);

  const initResponse = await fetch(INBOX_INIT_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
    },
    body: JSON.stringify({
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: videoSize,
        chunk_size: chunking.chunkSize,
        total_chunk_count: chunking.totalChunkCount,
      },
    }),
  });
  const initJson = await initResponse.json().catch(() => ({}));
  const init = inboxInitResponseSchema.parse(initJson);
  assertOk(init.error, 'inbox init');
  if (!init.data) {
    throw new Error('inbox init returned no data.');
  }
  const {publish_id: publishId, upload_url: uploadUrl} = init.data;

  await uploadChunks({
    uploadUrl,
    videoPath: params.videoPath,
    videoSize,
    chunking,
  });

  const final = await pollStatus({
    accessToken: token.accessToken,
    publishId,
    pollIntervalMs,
    maxPollMs,
  });

  return {
    runId: params.runId,
    mode: 'inbox',
    videoPath: params.videoPath,
    videoSize,
    publishId,
    status: final.status,
    failReason: final.failReason ?? null,
    startedAt,
    updatedAt: new Date().toISOString(),
  };
};

const uploadChunks = async (params: {
  uploadUrl: string;
  videoPath: string;
  videoSize: number;
  chunking: Chunking;
}) => {
  const fileHandle = await fs.open(params.videoPath, 'r');
  try {
    for (let i = 0; i < params.chunking.totalChunkCount; i++) {
      const rangeStart = i * params.chunking.chunkSize;
      const isLast = i === params.chunking.totalChunkCount - 1;
      const rangeEnd = isLast
        ? params.videoSize - 1
        : rangeStart + params.chunking.chunkSize - 1;
      const byteLength = rangeEnd - rangeStart + 1;
      const buffer = Buffer.alloc(byteLength);
      await fileHandle.read(buffer, 0, byteLength, rangeStart);
      const response = await fetch(params.uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'video/mp4',
          'Content-Range': `bytes ${rangeStart}-${rangeEnd}/${params.videoSize}`,
          'Content-Length': String(byteLength),
        },
        body: buffer,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(
          `chunk upload failed at ${rangeStart}-${rangeEnd}: ${response.status} ${text}`,
        );
      }
    }
  } finally {
    await fileHandle.close();
  }
};

const pollStatus = async (params: {
  accessToken: string;
  publishId: string;
  pollIntervalMs: number;
  maxPollMs: number;
}): Promise<{status: string; failReason?: string}> => {
  const deadline = Date.now() + params.maxPollMs;
  let lastStatus = '';
  let lastFail: string | undefined;
  while (Date.now() < deadline) {
    const response = await fetch(STATUS_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify({publish_id: params.publishId}),
    });
    const json = await response.json().catch(() => ({}));
    const parsed = statusResponseSchema.parse(json);
    assertOk(parsed.error, 'status fetch');
    if (!parsed.data) {
      throw new Error('status fetch returned no data.');
    }
    lastStatus = parsed.data.status;
    lastFail = parsed.data.fail_reason;
    if (TERMINAL_STATUSES.has(lastStatus)) {
      return {status: lastStatus, failReason: lastFail};
    }
    await sleep(params.pollIntervalMs);
  }
  return {
    status: lastStatus || 'TIMEOUT',
    failReason: lastFail ?? 'Polling deadline exceeded.',
  };
};
