import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {REMOTION_COMPOSITION_ID, VIDEO_FPS} from '../config';
import {copyIntoDir, ensureDir, writeJsonFile} from '../lib/fs';
import {assetLogSchema, briefSchema, renderPropsSchema, timelineSchema, voiceLogSchema, type AssetLog, type Brief, type Timeline, type VoiceLog} from '../types';
import {generateBgmWav} from './bgm';

const findVoiceEntry = (
  voiceLog: VoiceLog,
  sectionType: 'hook' | 'segment' | 'cta',
  index: number,
) => {
  const entry = voiceLog.entries.find(
    (voiceEntry) => voiceEntry.sectionType === sectionType && voiceEntry.index === index,
  );
  if (!entry) {
    throw new Error(`Missing voice entry for ${sectionType}:${index}`);
  }
  return entry;
};

const buildTimeline = async ({
  runId,
  publicRunDir,
  brief,
  assetLog,
  voiceLog,
}: {
  runId: string;
  publicRunDir: string;
  brief: Brief;
  assetLog: AssetLog;
  voiceLog: VoiceLog;
}) => {
  const publicAssetDir = path.join(publicRunDir, 'assets');
  const publicAudioDir = path.join(publicRunDir, 'audio');
  await ensureDir(publicAssetDir);
  await ensureDir(publicAudioDir);

  let cursorMs = 0;
  const segments: Timeline['segments'] = [];

  const hookVoice = findVoiceEntry(voiceLog, 'hook', 0);
  const hookAsset = assetLog.entries[0];
  const hookAudioPublic = await copyIntoDir(
    hookVoice.audioPath,
    publicAudioDir,
    path.basename(hookVoice.audioPath),
  );
  const hookAssetPublic = await copyIntoDir(
    hookAsset.selectedAssetPath,
    publicAssetDir,
    path.basename(hookAsset.selectedAssetPath),
  );

  segments.push({
    sectionType: 'hook',
    startMs: cursorMs,
    endMs: cursorMs + hookVoice.durationMs,
    audioPath: hookVoice.audioPath,
    audioPublicPath: path.relative(path.join(publicRunDir, '..', '..'), hookAudioPublic).replace(/\\/g, '/'),
    caption: brief.hook,
    highlight: brief.title,
    backgroundAsset: path.relative(path.join(publicRunDir, '..', '..'), hookAssetPublic).replace(/\\/g, '/'),
    backgroundAssetType: hookAsset.assetType,
  });
  cursorMs += hookVoice.durationMs;

  for (const [index, segment] of brief.segments.entries()) {
    const voiceEntry = findVoiceEntry(voiceLog, 'segment', index);
    const assetEntry = assetLog.entries[index] ?? assetLog.entries.at(-1)!;
    const audioPublic = await copyIntoDir(
      voiceEntry.audioPath,
      publicAudioDir,
      path.basename(voiceEntry.audioPath),
    );
    const assetPublic = await copyIntoDir(
      assetEntry.selectedAssetPath,
      publicAssetDir,
      path.basename(assetEntry.selectedAssetPath),
    );

    segments.push({
      sectionType: 'segment',
      startMs: cursorMs,
      endMs: cursorMs + voiceEntry.durationMs,
      audioPath: voiceEntry.audioPath,
      audioPublicPath: path.relative(path.join(publicRunDir, '..', '..'), audioPublic).replace(/\\/g, '/'),
      caption: segment.caption,
      highlight: segment.highlight,
      backgroundAsset: path.relative(path.join(publicRunDir, '..', '..'), assetPublic).replace(/\\/g, '/'),
      backgroundAssetType: assetEntry.assetType,
    });
    cursorMs += voiceEntry.durationMs;
  }

  const ctaVoice = findVoiceEntry(voiceLog, 'cta', 0);
  const ctaAsset = assetLog.entries.at(-1)!;
  const ctaAudioPublic = await copyIntoDir(
    ctaVoice.audioPath,
    publicAudioDir,
    path.basename(ctaVoice.audioPath),
  );
  const ctaAssetPublic = await copyIntoDir(
    ctaAsset.selectedAssetPath,
    publicAssetDir,
    path.basename(ctaAsset.selectedAssetPath),
  );

  segments.push({
    sectionType: 'cta',
    startMs: cursorMs,
    endMs: cursorMs + ctaVoice.durationMs,
    audioPath: ctaVoice.audioPath,
    audioPublicPath: path.relative(path.join(publicRunDir, '..', '..'), ctaAudioPublic).replace(/\\/g, '/'),
    caption: brief.cta,
    highlight: '保存',
    backgroundAsset: path.relative(path.join(publicRunDir, '..', '..'), ctaAssetPublic).replace(/\\/g, '/'),
    backgroundAssetType: ctaAsset.assetType,
  });
  cursorMs += ctaVoice.durationMs;

  return timelineSchema.parse({
    totalDurationMs: cursorMs,
    segments,
  });
};

const runCommand = async ({
  command,
  args,
  cwd,
  env,
}: {
  command: string;
  args: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}) => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: 'inherit',
    });
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed: ${command} ${args.join(' ')} (${code ?? 'null'})`));
      }
    });
    child.on('error', reject);
  });
};

export const renderRun = async ({
  rootDir,
  runId,
  runDir,
  publicRunDir,
  brief,
  assetLog,
  voiceLog,
}: {
  rootDir: string;
  runId: string;
  runDir: string;
  publicRunDir: string;
  brief: Brief;
  assetLog: AssetLog;
  voiceLog: VoiceLog;
}) => {
  const timeline = await buildTimeline({runId, publicRunDir, brief, assetLog, voiceLog});

  const bgmPath = path.join(runDir, 'bgm.wav');
  const {durationMs: bgmDurationMs} = await generateBgmWav({
    outputPath: bgmPath,
    durationMs: timeline.totalDurationMs,
  });
  const bgmPublicDir = path.join(publicRunDir, 'audio');
  await ensureDir(bgmPublicDir);
  const bgmPublicAbsolute = await copyIntoDir(bgmPath, bgmPublicDir, 'bgm.wav');
  const bgmPublicPath = path
    .relative(path.join(publicRunDir, '..', '..'), bgmPublicAbsolute)
    .replace(/\\/g, '/');

  const renderProps = renderPropsSchema.parse({
    runId,
    title: brief.title,
    timeline,
    bgm: {
      audioPath: bgmPath,
      audioPublicPath: bgmPublicPath,
      durationMs: bgmDurationMs,
      volume: 0.18,
    },
  });

  const timelinePath = path.join(runDir, 'timeline.json');
  const renderPropsPath = path.join(runDir, 'render-props.json');
  const outputPath = path.join(runDir, 'final.mp4');
  await writeJsonFile(timelinePath, timeline);
  await writeJsonFile(renderPropsPath, renderProps);

  const localNodeBin = path.join(rootDir, '.local', 'node-v24.14.1-darwin-arm64', 'bin');
  const env = {
    ...process.env,
    PATH: `${localNodeBin}:${process.env.PATH ?? ''}`,
  };

  await runCommand({
    command: path.join(rootDir, 'node_modules', '.bin', 'remotion'),
    args: [
      'render',
      'src/index.ts',
      REMOTION_COMPOSITION_ID,
      outputPath,
      '--props',
      renderPropsPath,
      '--fps',
      String(VIDEO_FPS),
    ],
    cwd: rootDir,
    env,
  });

  return {timelinePath, renderPropsPath, outputPath};
};
