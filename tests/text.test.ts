import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {describe, expect, it} from 'vitest';
import {createSvgFallbackAsset, classifyAssetType} from '../src/lib/media';
import {
  buildCaption,
  extractNumericPhrase,
  normalizeTopicTitle,
  pickHighlight,
  splitCaptionIntoPhrases,
} from '../src/lib/text';

describe('normalizeTopicTitle', () => {
  it('drops feed suffixes and emoji noise', () => {
    expect(normalizeTopicTitle('ソフトウェアや知能が安くなったときに起きること - 🐴 (馬)')).toBe(
      'ソフトウェアや知能が安くなったときに起きること',
    );
  });
});

describe('text shaping', () => {
  it('keeps four-digit years intact when extracting numbers', () => {
    expect(extractNumericPhrase('Cloudflareは2026年4月に統合CLIを公開した。')).toBe(
      '2026年',
    );
  });

  it('extracts temperature thresholds as numeric anchors', () => {
    expect(extractNumericPhrase('最高気温が40℃以上の日を酷暑日と呼ぶ。')).toBe('40℃');
  });

  it('avoids date-only highlights when a stronger token exists', () => {
    expect(
      pickHighlight(
        'Cloudflare、全サービスに対応するCLI開発へ',
        'Cloudflareは2026年4月、Wranglerを再構築した統合CLIを公開しました。',
      ),
    ).toBe('Wrangler');
  });

  it('does not split latin tokens in caption chunks', () => {
    expect(
      splitCaptionIntoPhrases('開発者の多くは、WranglerというCLIツールに馴染みがある').some(
        (phrase) => phrase.includes('Wrangler'),
      ),
    ).toBe(true);
  });

  it('keeps meaningful caption text instead of clipping too aggressively', () => {
    expect(
      buildCaption(
        'Cloudflareのサービスを日常的に利用している開発者の多くは、WranglerというCLIツールに馴染みがあるでしょう。',
        'Wrangler',
      ),
    ).toContain('Wrangler');
  });

  it('keeps the anchor visible even when it appears late in the sentence', () => {
    expect(
      buildCaption(
        '2026年4月、Cloudflareは開発者とAIエージェントの双方を対象とした統合CLIツールcfをテクニカルプレビューとして公開しました。',
        '統合CLIツールcf',
      ),
    ).toContain('統合CLIツールcf');
  });
});

describe('classifyAssetType', () => {
  it('classifies video and image URLs', () => {
    expect(classifyAssetType('https://example.com/movie.mp4')).toBe('video');
    expect(classifyAssetType('https://example.com/cover.jpg')).toBe('image');
  });
});

describe('createSvgFallbackAsset', () => {
  it('writes a fallback svg when no remote asset exists', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tikbuzz-'));
    const svgPath = path.join(tempDir, 'fallback.svg');
    await createSvgFallbackAsset({query: '深海 生物', filePath: svgPath});
    const content = await fs.readFile(svgPath, 'utf8');
    expect(content).toContain('<svg');
    expect(content).toContain('深海 生物');
  });
});
