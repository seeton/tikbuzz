import fs from 'node:fs/promises';
import path from 'node:path';
import {Brief, VoiceLog, voiceLogSchema} from '../types';
import {ensureDir} from '../lib/fs';
import {getAudioDurationMs} from '../lib/media';
import {normalizeSpeechText} from '../lib/text';

const requiredEnv = (name: string) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required. Copy .env.example to .env and fill it in.`);
  }
  return value;
};

type AudioQuery = Record<string, unknown>;

const synthesizeText = async ({
  text,
  outputPath,
  brief,
}: {
  text: string;
  outputPath: string;
  brief: Brief;
}) => {
  const normalizedText = normalizeSpeechText(text);
  const baseUrl = requiredEnv('AIVIS_BASE_URL');
  const styleId = Number(requiredEnv('AIVIS_STYLE_ID'));
  const audioQueryUrl = new URL('/audio_query', baseUrl);
  audioQueryUrl.searchParams.set('text', normalizedText);
  audioQueryUrl.searchParams.set('speaker', String(styleId));

  const audioQueryResponse = await fetch(audioQueryUrl, {method: 'POST'});
  if (!audioQueryResponse.ok) {
    const body = await audioQueryResponse.text();
    throw new Error(
      `Aivis audio_query failed: ${audioQueryResponse.status} for "${normalizedText}" ${body}`,
    );
  }

  const audioQuery = (await audioQueryResponse.json()) as AudioQuery;
  Object.assign(audioQuery, brief.voice);

  const synthesisUrl = new URL('/synthesis', baseUrl);
  synthesisUrl.searchParams.set('speaker', String(styleId));

  const synthesisResponse = await fetch(synthesisUrl, {
    method: 'POST',
    headers: {'content-type': 'application/json'},
    body: JSON.stringify(audioQuery),
  });

  if (!synthesisResponse.ok) {
    throw new Error(`Aivis synthesis failed: ${synthesisResponse.status}`);
  }

  const bytes = Buffer.from(await synthesisResponse.arrayBuffer());
  await fs.writeFile(outputPath, bytes);
  return getAudioDurationMs(outputPath);
};

export const listAivisSpeakers = async () => {
  const baseUrl = requiredEnv('AIVIS_BASE_URL');
  const url = new URL('/speakers', baseUrl);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Aivis speakers failed: ${response.status}`);
  }

  return response.json();
};

export const synthesizeBriefVoice = async ({
  runId,
  runDir,
  brief,
}: {
  runId: string;
  runDir: string;
  brief: Brief;
}) => {
  const audioDir = path.join(runDir, 'audio');
  await ensureDir(audioDir);

  const entries: VoiceLog['entries'] = [];

  const sections = [
    {sectionType: 'hook' as const, index: 0, text: brief.hook},
    ...brief.segments.map((segment, index) => ({
      sectionType: 'segment' as const,
      index,
      text: segment.narration,
    })),
    {sectionType: 'cta' as const, index: 0, text: brief.cta},
  ];

  for (const section of sections) {
    const fileBase =
      section.sectionType === 'segment'
        ? `segment-${section.index}`
        : section.sectionType;
    const audioPath = path.join(audioDir, `${fileBase}.wav`);
    const durationMs = await synthesizeText({
      text: section.text,
      outputPath: audioPath,
      brief,
    });

    entries.push({
      sectionType: section.sectionType,
      index: section.index,
      text: section.text,
      audioPath,
      durationMs,
    });
  }

  return voiceLogSchema.parse({
    runId,
    createdAt: new Date().toISOString(),
    entries,
  });
};
