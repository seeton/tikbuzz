import fs from 'node:fs/promises';
import path from 'node:path';
import {z} from 'zod';
import {PUBLIC_RUNS_DIR, RUNS_DIR} from '../config';

export const ensureDir = async (dirPath: string) => {
  await fs.mkdir(dirPath, {recursive: true});
};

export const writeJsonFile = async (filePath: string, data: unknown) => {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
};

export const readJsonFile = async <T>(
  filePath: string,
  schema: z.ZodType<T>,
): Promise<T> => {
  const raw = await fs.readFile(filePath, 'utf8');
  return schema.parse(JSON.parse(raw));
};

export const fileExists = async (filePath: string) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

export const createRunDir = async (rootDir: string, runId?: string) => {
  const timestamp =
    runId ??
    new Date()
      .toISOString()
      .replace(/[:]/g, '-')
      .replace(/\..+/, '');

  const runDir = path.join(rootDir, RUNS_DIR, timestamp);
  const publicRunDir = path.join(rootDir, PUBLIC_RUNS_DIR, timestamp);
  await ensureDir(runDir);
  await ensureDir(path.join(runDir, 'assets'));
  await ensureDir(path.join(runDir, 'audio'));
  await ensureDir(publicRunDir);
  return {runId: timestamp, runDir, publicRunDir};
};

export const copyIntoDir = async (
  fromPath: string,
  toDir: string,
  fileName?: string,
) => {
  await ensureDir(toDir);
  const destination = path.join(toDir, fileName ?? path.basename(fromPath));
  await fs.copyFile(fromPath, destination);
  return destination;
};

export const latestRunDir = async (rootDir: string) => {
  const runsPath = path.join(rootDir, RUNS_DIR);
  const entries = await fs.readdir(runsPath, {withFileTypes: true});
  const dirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  if (dirs.length === 0) {
    throw new Error('No run directories found. Run discover or run:auto-video first.');
  }

  dirs.sort();
  return path.join(runsPath, dirs.at(-1)!);
};
