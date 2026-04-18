import fs from 'node:fs/promises';
import path from 'node:path';
import {ensureDir} from '../lib/fs';

const SAMPLE_RATE = 44_100;
const BITS_PER_SAMPLE = 16;
const NUM_CHANNELS = 1;

const note = (semitonesFromA4: number) => 440 * Math.pow(2, semitonesFromA4 / 12);

const CHORD_PROGRESSION: number[][] = [
  [note(-24), note(-12), note(-9), note(-5)],
  [note(-29), note(-17), note(-14), note(-10)],
  [note(-21), note(-9), note(-5), note(-2)],
  [note(-26), note(-14), note(-10), note(-7)],
];

const CHORD_DURATION_SEC = 8;

const encodeWavHeader = (numSamples: number) => {
  const byteRate = (SAMPLE_RATE * NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  const blockAlign = (NUM_CHANNELS * BITS_PER_SAMPLE) / 8;
  const dataSize = numSamples * NUM_CHANNELS * (BITS_PER_SAMPLE / 8);
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(NUM_CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(BITS_PER_SAMPLE, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  return header;
};

const attackReleaseGain = (tInChord: number, chordDurSec: number) => {
  const attack = 1.5;
  const release = 1.5;
  if (tInChord < attack) {
    return tInChord / attack;
  }
  if (tInChord > chordDurSec - release) {
    return Math.max(0, (chordDurSec - tInChord) / release);
  }
  return 1;
};

const partialVoice = (freq: number, t: number) => {
  const fundamental = Math.sin(2 * Math.PI * freq * t);
  const second = 0.32 * Math.sin(2 * Math.PI * freq * 2 * t + 0.4);
  const third = 0.12 * Math.sin(2 * Math.PI * freq * 3 * t + 1.1);
  const sub = 0.25 * Math.sin(2 * Math.PI * (freq / 2) * t);
  return fundamental + second + third + sub;
};

const renderSample = (tSec: number, totalSec: number): number => {
  const progressionDur = CHORD_DURATION_SEC * CHORD_PROGRESSION.length;
  const positionInProgression = tSec % progressionDur;
  const chordIndex = Math.floor(positionInProgression / CHORD_DURATION_SEC);
  const nextChordIndex = (chordIndex + 1) % CHORD_PROGRESSION.length;
  const tInChord = positionInProgression - chordIndex * CHORD_DURATION_SEC;

  const currentChord = CHORD_PROGRESSION[chordIndex];
  const nextChord = CHORD_PROGRESSION[nextChordIndex];

  const crossfadeLen = 1.2;
  const fadeProgress =
    tInChord > CHORD_DURATION_SEC - crossfadeLen
      ? (tInChord - (CHORD_DURATION_SEC - crossfadeLen)) / crossfadeLen
      : 0;

  let sample = 0;
  for (const freq of currentChord) {
    sample += partialVoice(freq, tSec) * (1 - fadeProgress);
  }
  for (const freq of nextChord) {
    sample += partialVoice(freq, tSec) * fadeProgress;
  }

  sample /= currentChord.length * 1.6;

  const chordEnv = attackReleaseGain(tInChord, CHORD_DURATION_SEC);
  const slowLfo = 0.88 + 0.12 * Math.sin(2 * Math.PI * 0.18 * tSec);
  const globalFadeIn = Math.min(1, tSec / 1.8);
  const globalFadeOut = Math.min(1, Math.max(0, (totalSec - tSec) / 2.2));

  const airNoise = (Math.random() - 0.5) * 0.012;

  return sample * chordEnv * slowLfo * globalFadeIn * globalFadeOut + airNoise;
};

export const generateBgmWav = async ({
  outputPath,
  durationMs,
}: {
  outputPath: string;
  durationMs: number;
}) => {
  await ensureDir(path.dirname(outputPath));
  const durationSec = Math.max(2, durationMs / 1000);
  const totalSamples = Math.ceil(durationSec * SAMPLE_RATE);
  const samples = Buffer.alloc(totalSamples * 2);

  let peak = 0;
  const floatBuffer = new Float32Array(totalSamples);
  for (let i = 0; i < totalSamples; i += 1) {
    const t = i / SAMPLE_RATE;
    const value = renderSample(t, durationSec);
    floatBuffer[i] = value;
    const abs = Math.abs(value);
    if (abs > peak) peak = abs;
  }

  const targetPeak = 0.42;
  const normalizeGain = peak > 0 ? targetPeak / peak : 1;

  for (let i = 0; i < totalSamples; i += 1) {
    const normalized = Math.max(-1, Math.min(1, floatBuffer[i] * normalizeGain));
    samples.writeInt16LE(Math.round(normalized * 32_767), i * 2);
  }

  const header = encodeWavHeader(totalSamples);
  await fs.writeFile(outputPath, Buffer.concat([header, samples]));

  return {outputPath, durationMs: Math.round(durationSec * 1000)};
};
