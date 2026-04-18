import path from 'node:path';
import {z} from 'zod';
import {createRunDir, latestRunDir, readJsonFile, writeJsonFile} from '../src/lib/fs';
import {buildAssetLog} from '../src/pipeline/assets';
import {buildBriefFromTopic} from '../src/pipeline/brief';
import {discoverCandidateTopics} from '../src/pipeline/discover';
import {rankCandidateTopics} from '../src/pipeline/rank';
import {renderRun} from '../src/pipeline/render';
import {publishInboxVideo} from '../src/pipeline/tiktok-publish';
import {listAivisSpeakers, synthesizeBriefVoice} from '../src/pipeline/voice';
import {assetLogSchema, briefSchema, candidateTopicSchema, rankedTopicSchema, sourceLogSchema, voiceLogSchema} from '../src/types';

type Command =
  | 'discover'
  | 'rank'
  | 'brief'
  | 'assets'
  | 'voice'
  | 'render'
  | 'run:auto-video'
  | 'tiktok:publish'
  | 'aivis:list-speakers';

const rootDir = process.cwd();

const readDotEnv = async () => {
  const envPath = path.join(rootDir, '.env');
  try {
    const fs = await import('node:fs/promises');
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
    // Optional in early stages.
  }
};

const requireRunDir = async () => {
  const argIndex = process.argv.indexOf('--run-dir');
  if (argIndex !== -1) {
    return path.resolve(process.argv[argIndex + 1]);
  }
  return latestRunDir(rootDir);
};

const runIdFromDir = (runDir: string) => path.basename(runDir);
const rankedFileSchema = z.object({
  selected: rankedTopicSchema,
});

const discover = async () => {
  const {runId, runDir} = await createRunDir(rootDir);
  const candidates = await discoverCandidateTopics();
  const candidatesPath = path.join(runDir, 'candidates.json');
  await writeJsonFile(candidatesPath, candidates);
  console.log(JSON.stringify({runId, runDir, candidatesPath, count: candidates.length}, null, 2));
};

const rank = async () => {
  const runDir = await requireRunDir();
  const candidates = await readJsonFile(
    path.join(runDir, 'candidates.json'),
    candidateTopicSchema.array(),
  );
  const {ranked, selected} = rankCandidateTopics(candidates);
  const rankedPath = path.join(runDir, 'ranked-topic.json');
  await writeJsonFile(rankedPath, {ranked, selected});
  console.log(JSON.stringify({runDir, rankedPath, selected}, null, 2));
};

const brief = async () => {
  const runDir = await requireRunDir();
  const candidates = await readJsonFile(
    path.join(runDir, 'candidates.json'),
    candidateTopicSchema.array(),
  );
  const {selected} = await readJsonFile(
    path.join(runDir, 'ranked-topic.json'),
    rankedFileSchema,
  );
  const {brief, researchSnippets} = await buildBriefFromTopic(selected);
  await writeJsonFile(path.join(runDir, 'brief.json'), brief);
  await writeJsonFile(
    path.join(runDir, 'source-log.json'),
    sourceLogSchema.parse({
      runId: runIdFromDir(runDir),
      createdAt: new Date().toISOString(),
      candidates,
      selectedTopic: selected,
      researchSnippets,
    }),
  );
  console.log(JSON.stringify({runDir, brief: brief.title}, null, 2));
};

const assets = async () => {
  const runDir = await requireRunDir();
  const briefFile = await readJsonFile(path.join(runDir, 'brief.json'), briefSchema);
  const assetLog = await buildAssetLog({
    runId: runIdFromDir(runDir),
    runDir,
    brief: briefFile,
  });
  await writeJsonFile(path.join(runDir, 'asset-log.json'), assetLog);
  console.log(JSON.stringify({runDir, assets: assetLog.entries.length}, null, 2));
};

const voice = async () => {
  const runDir = await requireRunDir();
  const briefFile = await readJsonFile(path.join(runDir, 'brief.json'), briefSchema);
  const voiceLog = await synthesizeBriefVoice({
    runId: runIdFromDir(runDir),
    runDir,
    brief: briefFile,
  });
  await writeJsonFile(path.join(runDir, 'voice-log.json'), voiceLog);
  console.log(JSON.stringify({runDir, audioSections: voiceLog.entries.length}, null, 2));
};

const render = async () => {
  const runDir = await requireRunDir();
  const runId = runIdFromDir(runDir);
  const publicRunDir = path.join(rootDir, 'public', 'runs', runId);
  const briefFile = await readJsonFile(path.join(runDir, 'brief.json'), briefSchema);
  const assetLog = await readJsonFile(path.join(runDir, 'asset-log.json'), assetLogSchema);
  const voiceLog = await readJsonFile(path.join(runDir, 'voice-log.json'), voiceLogSchema);
  const result = await renderRun({
    rootDir,
    runId,
    runDir,
    publicRunDir,
    brief: briefFile,
    assetLog,
    voiceLog,
  });
  console.log(JSON.stringify({runDir, ...result}, null, 2));
};

const tiktokPublish = async () => {
  const runDir = await requireRunDir();
  const runId = runIdFromDir(runDir);
  const videoPath = path.join(runDir, 'final.mp4');
  const clientKey = process.env.TIKTOK_CLIENT_KEY;
  const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
  if (!clientKey || !clientSecret) {
    throw new Error(
      'TIKTOK_CLIENT_KEY and TIKTOK_CLIENT_SECRET must be set in .env',
    );
  }
  const result = await publishInboxVideo({
    rootDir,
    runId,
    videoPath,
    clientKey,
    clientSecret,
  });
  const publishLogPath = path.join(runDir, 'publish-log.json');
  await writeJsonFile(publishLogPath, result);
  console.log(JSON.stringify({runDir, publishLogPath, ...result}, null, 2));
};

const runAutoVideo = async () => {
  const {runId, runDir, publicRunDir} = await createRunDir(rootDir);
  const candidates = await discoverCandidateTopics();
  await writeJsonFile(path.join(runDir, 'candidates.json'), candidates);
  const {selected} = rankCandidateTopics(candidates);
  await writeJsonFile(path.join(runDir, 'ranked-topic.json'), {selected});
  const {brief, researchSnippets} = await buildBriefFromTopic(selected);
  await writeJsonFile(path.join(runDir, 'brief.json'), brief);
  await writeJsonFile(
    path.join(runDir, 'source-log.json'),
    sourceLogSchema.parse({
      runId,
      createdAt: new Date().toISOString(),
      candidates,
      selectedTopic: selected,
      researchSnippets,
    }),
  );
  const assetLog = await buildAssetLog({runId, runDir, brief});
  await writeJsonFile(path.join(runDir, 'asset-log.json'), assetLog);
  const voiceLog = await synthesizeBriefVoice({runId, runDir, brief});
  await writeJsonFile(path.join(runDir, 'voice-log.json'), voiceLog);
  const result = await renderRun({
    rootDir,
    runId,
    runDir,
    publicRunDir,
    brief,
    assetLog,
    voiceLog,
  });
  console.log(JSON.stringify({runId, runDir, ...result}, null, 2));
};

const main = async () => {
  await readDotEnv();
  const command = process.argv[2] as Command | undefined;
  if (!command) {
    throw new Error('Command is required.');
  }

  switch (command) {
    case 'discover':
      await discover();
      return;
    case 'rank':
      await rank();
      return;
    case 'brief':
      await brief();
      return;
    case 'assets':
      await assets();
      return;
    case 'voice':
      await voice();
      return;
    case 'render':
      await render();
      return;
    case 'run:auto-video':
      await runAutoVideo();
      return;
    case 'tiktok:publish':
      await tiktokPublish();
      return;
    case 'aivis:list-speakers':
      console.log(JSON.stringify(await listAivisSpeakers(), null, 2));
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
