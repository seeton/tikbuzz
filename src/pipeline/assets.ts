import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';
import {Brief} from '../types';
import {assetLogSchema, type AssetLog, type AssetLogEntry} from '../types';
import {fetchBytes, fetchJson, fetchText} from '../lib/http';
import {classifyAssetType, createSvgFallbackAsset} from '../lib/media';
import {cleanText, slugify, uniqueBy} from '../lib/text';

type DuckResult = {
  title: string;
  pageUrl: string;
  snippet: string;
};

type MediaCandidate = {
  query: string;
  mediaUrl: string;
  pageUrl: string;
  sourceUrl: string;
  host: string;
  assetType: 'image' | 'video';
  selectionScore: number;
  selectedReason: string;
};

const QUERY_TOKEN_STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'from',
  'close',
  'up',
  'replay',
]);

const extractQueryTokens = (value: string) =>
  [
    ...new Set(
      (cleanText(value).toLowerCase().match(/[a-z0-9]+|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{2,}/gu) ?? [])
        .filter((token) => !QUERY_TOKEN_STOPWORDS.has(token)),
    ),
  ];

const overlapTokenCount = (query: string, haystack: string) => {
  const tokens = extractQueryTokens(query);
  const normalized = cleanText(haystack).toLowerCase();
  return tokens.reduce((count, token) => count + (normalized.includes(token) ? 1 : 0), 0);
};

const decodeDuckUrl = (url: string) => {
  try {
    const parsed = new URL(url, 'https://duckduckgo.com');
    const redirect = parsed.searchParams.get('uddg');
    return redirect ? decodeURIComponent(redirect) : parsed.toString();
  } catch {
    return url;
  }
};

const searchDuckDuckGoPages = async (query: string, limit = 4): Promise<DuckResult[]> => {
  try {
    const html = await fetchText(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    );
    const $ = cheerio.load(html);
    const results: DuckResult[] = [];

    $('.result').each((_, element) => {
      const title = cleanText($(element).find('.result__title').text());
      const href = $(element).find('.result__title a').attr('href');
      const snippet = cleanText($(element).find('.result__snippet').text());
      if (!title || !href) {
        return;
      }

      results.push({
        title,
        pageUrl: decodeDuckUrl(href),
        snippet,
      });
    });

    return uniqueBy(results, (result) => result.pageUrl).slice(0, limit);
  } catch {
    return [];
  }
};

const absoluteUrl = (input: string, pageUrl: string) => {
  try {
    return new URL(input, pageUrl).toString();
  } catch {
    return null;
  }
};

const scoreMediaCandidate = (candidate: {
  query: string;
  mediaUrl: string;
  pageUrl: string;
  assetType: 'image' | 'video';
  signal: string;
  relevanceText: string;
}) => {
  let score = candidate.assetType === 'video' ? 4.2 : 3.1;
  if (candidate.mediaUrl.toLowerCase().includes(slugify(candidate.query))) {
    score += 0.6;
  }
  score += Math.min(2.4, overlapTokenCount(candidate.query, candidate.relevanceText) * 0.8);
  if (/og:video|video tag/u.test(candidate.signal)) {
    score += 1.5;
  }
  if (/og:image|twitter image/u.test(candidate.signal)) {
    score += 0.7;
  }
  return Number(score.toFixed(2));
};

const looksDecorative = (url: string, signal: string) =>
  /logo|icon|sprite|favicon|header/i.test(url) ||
  (signal === 'first image' && /\.svg(?:$|\?)/i.test(url));

const pageMediaCandidates = async (query: string, result: DuckResult): Promise<MediaCandidate[]> => {
  try {
    if (overlapTokenCount(query, `${result.title} ${result.snippet} ${result.pageUrl}`) === 0) {
      return [];
    }
    const html = await fetchText(result.pageUrl);
    const $ = cheerio.load(html);
    const rawCandidates = [
      {
        mediaUrl: $('meta[property="og:video"]').attr('content'),
        signal: 'og:video',
      },
      {
        mediaUrl: $('meta[property="og:video:url"]').attr('content'),
        signal: 'og:video:url',
      },
      {
        mediaUrl: $('meta[name="twitter:player:stream"]').attr('content'),
        signal: 'twitter player stream',
      },
      {
        mediaUrl: $('video source').first().attr('src') ?? $('video').first().attr('src'),
        signal: 'video tag',
      },
      {
        mediaUrl: $('meta[property="og:image"]').attr('content'),
        signal: 'og:image',
      },
      {
        mediaUrl: $('meta[name="twitter:image"]').attr('content'),
        signal: 'twitter image',
      },
      {
        mediaUrl: $('img').first().attr('src'),
        signal: 'first image',
      },
    ];

    return rawCandidates
      .map((candidate) => {
        if (!candidate.mediaUrl) {
          return null;
        }
        const resolved = absoluteUrl(candidate.mediaUrl, result.pageUrl);
        if (!resolved) {
          return null;
        }
        if (looksDecorative(resolved, candidate.signal)) {
          return null;
        }
        const assetType = classifyAssetType(resolved);
        if (!assetType) {
          return null;
        }

        return {
          query,
          mediaUrl: resolved,
          pageUrl: result.pageUrl,
          sourceUrl: resolved,
          host: new URL(resolved).host,
          assetType,
          selectionScore: scoreMediaCandidate({
            query,
              mediaUrl: resolved,
              pageUrl: result.pageUrl,
              assetType,
              signal: candidate.signal,
              relevanceText: `${result.title} ${result.snippet} ${result.pageUrl} ${resolved}`,
            }),
          selectedReason: `${candidate.signal} extracted from ${result.title}`,
        } satisfies MediaCandidate;
      })
      .filter((candidate): candidate is MediaCandidate => candidate != null);
  } catch {
    return [];
  }
};

type WikimediaResponse = {
  query?: {
    pages?: Record<
      string,
      {
        title?: string;
        imageinfo?: Array<{
          url?: string;
          mime?: string;
        }>;
      }
    >;
  };
};

const wikimediaCandidates = async (query: string): Promise<MediaCandidate[]> => {
  const url =
    'https://commons.wikimedia.org/w/api.php?' +
    new URLSearchParams({
      action: 'query',
      generator: 'search',
      gsrsearch: query,
      gsrnamespace: '6',
      gsrlimit: '4',
      prop: 'imageinfo',
      iiprop: 'url|mime',
      format: 'json',
      origin: '*',
    }).toString();

  try {
    const response = await fetchJson<WikimediaResponse>(url);
    const pages = Object.values(response.query?.pages ?? {});
    return pages
      .map((page) => {
        const info = page.imageinfo?.[0];
        if (!info?.url) {
          return null;
        }
        const relevanceText = `${page.title ?? ''} ${info.url}`;
        if (overlapTokenCount(query, relevanceText) === 0) {
          return null;
        }
        const assetType = classifyAssetType(info.url, info.mime);
        if (!assetType) {
          return null;
        }
        return {
          query,
          mediaUrl: info.url,
          pageUrl: `https://commons.wikimedia.org/wiki/${encodeURIComponent(page.title ?? '')}`,
          sourceUrl: info.url,
          host: 'commons.wikimedia.org',
          assetType,
          selectionScore: assetType === 'video' ? 4.6 : 3.8,
          selectedReason: `Wikimedia Commons search match for ${query}`,
        } satisfies MediaCandidate;
      })
      .filter((candidate): candidate is MediaCandidate => candidate != null);
  } catch {
    return [];
  }
};

type WikipediaSummary = {
  thumbnail?: {source?: string};
  originalimage?: {source?: string};
  content_urls?: {desktop?: {page?: string}};
  title?: string;
};

const wikipediaJaCandidates = async (query: string): Promise<MediaCandidate[]> => {
  try {
    const url = `https://ja.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
    const summary = await fetchJson<WikipediaSummary>(url);
    const image = summary.originalimage?.source ?? summary.thumbnail?.source;
    if (!image) {
      return [];
    }
    if (
      overlapTokenCount(
        query,
        `${summary.title ?? ''} ${summary.content_urls?.desktop?.page ?? ''} ${image}`,
      ) === 0
    ) {
      return [];
    }
    const assetType = classifyAssetType(image);
    if (!assetType) {
      return [];
    }
    return [
      {
        query,
        mediaUrl: image,
        pageUrl: summary.content_urls?.desktop?.page ?? `https://ja.wikipedia.org/wiki/${encodeURIComponent(query)}`,
        sourceUrl: image,
        host: 'ja.wikipedia.org',
        assetType,
        selectionScore: 4.0,
        selectedReason: `Wikipedia JA lead image for ${query}`,
      },
    ];
  } catch {
    return [];
  }
};

const picsumCandidate = (query: string, segmentIndex: number): MediaCandidate => {
  const seed = `${slugify(query)}-${segmentIndex}`;
  const url = `https://picsum.photos/seed/${encodeURIComponent(seed)}/1080/1920`;
  return {
    query,
    mediaUrl: url,
    pageUrl: url,
    sourceUrl: url,
    host: 'picsum.photos',
    assetType: 'image',
    selectionScore: 1.5,
    selectedReason: `Deterministic Picsum fallback seeded by "${seed}"`,
  };
};

const gatherCandidates = async (query: string, segmentIndex: number) => {
  const [wikimedia, wikipediaJa, pages] = await Promise.all([
    wikimediaCandidates(query),
    wikipediaJaCandidates(query),
    searchDuckDuckGoPages(query, 4),
  ]);
  const pageCandidates = (await Promise.all(pages.map((page) => pageMediaCandidates(query, page)))).flat();
  const all = [...wikimedia, ...wikipediaJa, ...pageCandidates, picsumCandidate(query, segmentIndex)];
  return uniqueBy(all, (candidate) => candidate.mediaUrl).sort(
    (left, right) => right.selectionScore - left.selectionScore,
  );
};

const fileSha1 = (bytes: Buffer) => crypto.createHash('sha1').update(bytes).digest('hex');

const downloadUniqueAsset = async ({
  url,
  baseName,
  directory,
  usedHashes,
}: {
  url: string;
  baseName: string;
  directory: string;
  usedHashes: Set<string>;
}): Promise<{filePath: string; hash: string} | null> => {
  const {bytes, contentType} = await fetchBytes(url);
  if (bytes.length < 2048) {
    return null;
  }
  const hash = fileSha1(bytes);
  if (usedHashes.has(hash)) {
    return null;
  }
  const extension = (() => {
    const lower = contentType.toLowerCase();
    if (lower.includes('jpeg')) return '.jpg';
    if (lower.includes('png')) return '.png';
    if (lower.includes('webp')) return '.webp';
    if (lower.includes('gif')) return '.gif';
    if (lower.includes('svg')) return '.svg';
    if (lower.includes('mp4')) return '.mp4';
    if (lower.includes('webm')) return '.webm';
    if (lower.includes('quicktime')) return '.mov';
    const pathExt = path.extname(new URL(url).pathname).toLowerCase();
    return pathExt || '.bin';
  })();

  const fileName = `${slugify(baseName)}${extension}`;
  const filePath = path.join(directory, fileName);
  await fs.mkdir(directory, {recursive: true});
  await fs.writeFile(filePath, bytes);
  return {filePath, hash};
};

export const buildAssetLog = async ({
  runId,
  runDir,
  brief,
}: {
  runId: string;
  runDir: string;
  brief: Brief;
}) => {
  const assetDir = path.join(runDir, 'assets');
  const entries: AssetLogEntry[] = [];
  const usedHashes = new Set<string>();

  for (const [index, segment] of brief.segments.entries()) {
    const query = segment.assetHint;
    const candidates = await gatherCandidates(query, index);

    let chosen: MediaCandidate | null = null;
    let downloaded: {filePath: string; hash: string} | null = null;

    for (const candidate of candidates) {
      try {
        const result = await downloadUniqueAsset({
          url: candidate.mediaUrl,
          baseName: `segment-${index}-${query}`,
          directory: assetDir,
          usedHashes,
        });
        if (result) {
          chosen = candidate;
          downloaded = result;
          break;
        }
      } catch {
        continue;
      }
    }

    if (!chosen || !downloaded) {
      const fallbackPath = path.join(assetDir, `segment-${index}.svg`);
      await createSvgFallbackAsset({query, filePath: fallbackPath});
      entries.push({
        segmentIndex: index,
        query,
        selectedAssetPath: fallbackPath,
        sourceUrl: `https://generated.local/fallback/${slugify(query)}`,
        pageUrl: `https://generated.local/fallback/${slugify(query)}`,
        host: 'generated.local',
        assetType: 'svg-fallback',
        selectionScore: 0.1,
        selectedReason: 'No unique remote media candidate resolved, generated SVG fallback.',
      });
      continue;
    }

    usedHashes.add(downloaded.hash);
    entries.push(
      assetLogSchema.shape.entries.element.parse({
        segmentIndex: index,
        query,
        selectedAssetPath: downloaded.filePath,
        sourceUrl: chosen.sourceUrl,
        pageUrl: chosen.pageUrl,
        host: chosen.host,
        assetType: chosen.assetType,
        selectionScore: chosen.selectionScore,
        selectedReason: chosen.selectedReason,
      }),
    );
  }

  return assetLogSchema.parse({
    runId,
    createdAt: new Date().toISOString(),
    entries,
  }) satisfies AssetLog;
};
