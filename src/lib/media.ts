import fs from 'node:fs/promises';
import path from 'node:path';
import {parseBuffer} from 'music-metadata';
import {fileTypeFromBuffer} from 'file-type';
import {fetchBytes} from './http';
import {ensureDir} from './fs';
import {slugify} from './text';

export const classifyAssetType = (
  url: string,
  contentType?: string,
): 'image' | 'video' | null => {
  const lowerUrl = url.toLowerCase();
  const lowerType = (contentType ?? '').toLowerCase();
  if (
    lowerType.startsWith('video/') ||
    /\.(mp4|webm|mov|m4v)$/u.test(lowerUrl)
  ) {
    return 'video';
  }

  if (
    lowerType.startsWith('image/') ||
    /\.(jpg|jpeg|png|webp|gif|svg)$/u.test(lowerUrl)
  ) {
    return 'image';
  }

  return null;
};

const extFromMime = (mime: string) => {
  if (mime.includes('jpeg')) {
    return '.jpg';
  }
  if (mime.includes('png')) {
    return '.png';
  }
  if (mime.includes('webp')) {
    return '.webp';
  }
  if (mime.includes('gif')) {
    return '.gif';
  }
  if (mime.includes('svg')) {
    return '.svg';
  }
  if (mime.includes('mp4')) {
    return '.mp4';
  }
  if (mime.includes('webm')) {
    return '.webm';
  }
  if (mime.includes('quicktime')) {
    return '.mov';
  }
  if (mime.includes('wav')) {
    return '.wav';
  }
  return '';
};

export const downloadAsset = async ({
  url,
  baseName,
  directory,
}: {
  url: string;
  baseName: string;
  directory: string;
}) => {
  const {bytes, contentType} = await fetchBytes(url);
  const detected = await fileTypeFromBuffer(bytes);
  const extension =
    detected?.ext != null
      ? `.${detected.ext}`
      : extFromMime(contentType) || path.extname(new URL(url).pathname) || '.bin';
  const fileName = `${slugify(baseName)}${extension}`;
  const filePath = path.join(directory, fileName);
  await ensureDir(directory);
  await fs.writeFile(filePath, bytes);
  return {filePath, contentType};
};

export const getAudioDurationMs = async (filePath: string) => {
  const bytes = await fs.readFile(filePath);
  const metadata = await parseBuffer(bytes, undefined, {duration: true});
  if (metadata.format.duration == null) {
    throw new Error(`Could not determine audio duration for ${filePath}`);
  }

  return Math.max(1, Math.round(metadata.format.duration * 1000));
};

export const createSvgFallbackAsset = async ({
  query,
  filePath,
}: {
  query: string;
  filePath: string;
}) => {
  await ensureDir(path.dirname(filePath));
  const lines = [query, 'AUTO VISUAL FILL'].map((line) => line.replace(/[&<>]/g, ''));
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#07111f"/>
      <stop offset="45%" stop-color="#10355d"/>
      <stop offset="100%" stop-color="#f45d01"/>
    </linearGradient>
  </defs>
  <rect width="1080" height="1920" fill="url(#bg)"/>
  <circle cx="840" cy="420" r="260" fill="rgba(255,255,255,0.10)"/>
  <circle cx="260" cy="1480" r="220" fill="rgba(255,255,255,0.08)"/>
  <rect x="88" y="88" width="904" height="1744" rx="56" fill="rgba(0,0,0,0.18)" stroke="rgba(255,255,255,0.16)"/>
  <text x="120" y="520" fill="#ffffff" font-family="Avenir Next, Hiragino Sans, sans-serif" font-size="84" font-weight="700">${lines[0]}</text>
  <text x="120" y="680" fill="#f5f7ff" font-family="Avenir Next, Hiragino Sans, sans-serif" font-size="48" font-weight="500">${lines[1]}</text>
  <text x="120" y="1610" fill="#ffffff" font-family="Avenir Next, Hiragino Sans, sans-serif" font-size="34" opacity="0.85">No source media found, generated fallback background.</text>
</svg>`;
  await fs.writeFile(filePath, svg, 'utf8');
  return filePath;
};
