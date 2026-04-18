import {describe, expect, it} from 'vitest';
import {rankCandidateTopics} from '../src/pipeline/rank';
import {CandidateTopic} from '../src/types';

describe('rankCandidateTopics', () => {
  it('filters unsafe topics and prefers evergreen explainable ones', () => {
    const candidates: CandidateTopic[] = [
      {
        title: '首相が新方針を表明',
        summary: '政治の動きに関するニュース。',
        sourceType: 'news',
        sourceUrl: 'https://example.com/politics',
        scoreHints: ['news'],
        fetchedAt: new Date().toISOString(),
      },
      {
        title: 'コンタクトセンターでAI導入',
        summary: '問い合わせ対応の効率化と顧客体験の向上を図る。',
        sourceType: 'news',
        sourceUrl: 'https://example.com/contact-center',
        scoreHints: ['news'],
        fetchedAt: new Date().toISOString(),
      },
      {
        title: 'Cloudflare、全サービスに対応するCLI開発へ AIエージェントへの最適化目指す',
        summary: '開発者向け統合CLIをテクニカルプレビューとして公開。',
        sourceType: 'news',
        sourceUrl: 'https://example.com/cloudflare',
        scoreHints: ['news'],
        fetchedAt: new Date().toISOString(),
      },
      {
        title: '生成AIの動画・音声 深刻化する無断利用の権利侵害を整理 法務省が検討会設置',
        summary: '法務省がガイドライン整備に向けた検討会を設置。',
        sourceType: 'news',
        sourceUrl: 'https://example.com/legal',
        scoreHints: ['news'],
        fetchedAt: new Date().toISOString(),
      },
      {
        title: '最高気温が40℃以上の日は酷暑日、気象庁も決定',
        summary: '最高気温が40℃以上の日を酷暑日と呼称すると発表した。',
        sourceType: 'news',
        sourceUrl: 'https://example.com/heat',
        scoreHints: ['news'],
        fetchedAt: new Date().toISOString(),
      },
    ];

    const {selected, ranked} = rankCandidateTopics(candidates);
    expect(ranked).toHaveLength(1);
    expect(selected.title).toContain('酷暑日');
  });
});
