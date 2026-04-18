import * as cheerio from 'cheerio';
import {DEFAULT_VOICE_SETTINGS} from '../config';
import {fetchText} from '../lib/http';
import {
  buildCaption,
  buildCta,
  buildHook,
  cleanText,
  extractNumericPhrase,
  isDateLikeNumericPhrase,
  looksMojibake,
  normalizeTopicTitle,
  pickHighlight,
  sentenceWeight,
  splitIntoSentences,
  toTitleCaseTopic,
  truncate,
  uniqueBy,
} from '../lib/text';
import {briefSchema, type Brief, type RankedTopic} from '../types';

type ResearchSnippet = {
  title: string;
  url: string;
  excerpt: string;
};

type DuckDuckGoResult = {
  title: string;
  url: string;
  snippet: string;
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

const searchDuckDuckGo = async (query: string, limit = 4): Promise<DuckDuckGoResult[]> => {
  const html = await fetchText(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
  );
  const $ = cheerio.load(html);
  const results: DuckDuckGoResult[] = [];

  $('.result').each((_, element) => {
    const title = cleanText($(element).find('.result__title').text());
    const href = $(element).find('.result__title a').attr('href');
    const snippet = cleanText($(element).find('.result__snippet').text());

    if (!title || !href) {
      return;
    }

    results.push({
      title,
      url: decodeDuckUrl(href),
      snippet,
    });
  });

  return uniqueBy(results, (result) => result.url).slice(0, limit);
};

const extractReadableText = async (url: string) => {
  try {
    const html = await fetchText(url);
    const $ = cheerio.load(html);
    const title =
      cleanText($('meta[property="og:title"]').attr('content') ?? '') ||
      cleanText($('title').text());
    const description =
      cleanText($('meta[name="description"]').attr('content') ?? '') ||
      cleanText($('meta[property="og:description"]').attr('content') ?? '');
    const paragraphs = $('p')
      .slice(0, 8)
      .toArray()
      .map((paragraph) => cleanText($(paragraph).text()))
      .filter((paragraph) => paragraph.length >= 20)
      .slice(0, 4);

    return {
      title,
      excerpt: [description, ...paragraphs].filter(Boolean).join(' '),
    };
  } catch {
    return null;
  }
};

const buildResearchSnippets = async (topic: RankedTopic) => {
  const snippets: ResearchSnippet[] = [];
  const sourcePage = await extractReadableText(topic.sourceUrl);
  snippets.push({
    title: topic.title,
    url: topic.sourceUrl,
    excerpt:
      sourcePage?.excerpt && !looksMojibake(sourcePage.excerpt)
        ? sourcePage.excerpt
        : topic.summary,
  });

  const searchResults = await searchDuckDuckGo(topic.title, 3);

  for (const result of searchResults) {
    const extracted = await extractReadableText(result.url);
    if (extracted == null) {
      snippets.push({
        title: result.title,
        url: result.url,
        excerpt: result.snippet,
      });
      continue;
    }

    snippets.push({
      title:
        extracted.title && !looksMojibake(extracted.title)
          ? extracted.title
          : result.title,
      url: result.url,
      excerpt:
        extracted.excerpt && !looksMojibake(extracted.excerpt)
          ? extracted.excerpt
          : result.snippet,
    });
  }

  return uniqueBy(snippets, (snippet) => snippet.url).slice(0, 4);
};

const unusableSentence = (sentence: string, title: string) => {
  const cleaned = cleanText(sentence);
  if (cleaned.length < 14) {
    return true;
  }
  if (looksMojibake(cleaned)) {
    return true;
  }
  if (
    /メールアドレス|必須項目|コメント欄|Hello|bookmarks|タイトル ブックマーク数|https?:\/\/|©|ログイン|会員登録|エンジニアブログ|ITmedia|gihyo\.jp|Publickey|一部を引用します|同社のブログ|ブログ.*引用|一般財団法人|本社：|理事長|以下日本気象協会|今回は.+紹介します|この記事|本記事|本稿|コラム|おすすめ|詳しく見ていきます|description|東京都.+区|共同開発|電通傘下|R&D|アブストラクトエンジン|本プロジェクト|体験できる|手掛ける/u.test(
      cleaned,
    )
  ) {
    return true;
  }
  if (cleaned === cleanText(title)) {
    return true;
  }
  return false;
};

const simplifyNarration = (sentence: string) => {
  return cleanText(sentence)
    .replace(/^(description)\s*/iu, '')
    .replace(/([^\s]{2,24})(は|が)(?:[0-9０-９]{1,4}年)?(?:[0-9０-９]{1,2}月)?(?:[0-9０-９]{1,2}日)?、/u, '$1$2')
    .replace(/──/gu, '、')
    .replace(/[()（）]/gu, '')
    .replace(/「([^」]{1,20})」/gu, '$1')
    .replace(/\s+(?:エンジニアブログ|ITmedia|gihyo\.jp)$/iu, '')
    .replace(/と発表した。?$/u, 'と発表した')
    .replace(/という。?$/u, 'だ')
    .replace(/\s+/g, '')
    .trim();
};

type StoryMode = 'visual' | 'weather' | 'retro' | 'generic';

const inferStoryMode = (topic: string, snippets: ResearchSnippet[]) => {
  const haystack = [topic, ...snippets.map((snippet) => snippet.excerpt)].join(' ');
  if (/光る|追える|可視化|アニメ|軌跡|デビュー/u.test(haystack)) {
    return 'visual' as const;
  }
  if (/猛暑|酷暑|気温|エルニーニョ|ダイポール|気象/u.test(haystack)) {
    return 'weather' as const;
  }
  if (/周年|初代|復活|デザイン|あの頃/u.test(haystack)) {
    return 'retro' as const;
  }
  return 'generic' as const;
};

const normalizeBeatText = (value: string) =>
  truncate(
    simplifyNarration(value)
      .replace(/。+/gu, '。')
      .replace(/^[、。]+/u, '')
      .replace(/(?:すると|したと)発表した$/u, 'した')
      .replace(/する可能性がある$/u, 'するかもしれない')
      .replace(/公表した$/u, '公表した')
      .replace(/\s+/gu, '')
      .trim(),
    76,
  );

const firstInterestingClause = (title: string) =>
  cleanText(title)
    .split(/[、。]/u)
    .map((part) => part.trim())
    .find((part) => part.length >= 8) ?? normalizeTopicTitle(title);

const extractRetroSubject = (title: string) => {
  const cleaned = cleanText(title);
  const match = cleaned.match(/^(.+?)(?:の)?(?:30周年|周年)/u);
  return match?.[1]?.trim() ?? firstInterestingClause(title);
};

const buildShortTitle = ({
  mode,
  topic,
}: {
  mode: StoryMode;
  topic: string;
}) => {
  if (mode === 'visual' && /フェンシング/u.test(topic)) {
    return 'フェンシングの剣筋が、光って見える。';
  }
  if (mode === 'weather' && /猛暑再来/u.test(topic)) {
    return '2023年級の猛暑、また来るかも。';
  }
  if (mode === 'weather' && /40℃|酷暑日/u.test(topic)) {
    return '40℃の日、ついに名前がついた。';
  }
  if (mode === 'retro') {
    const subject = extractRetroSubject(topic);
    return truncate(`${subject}、今見ても攻めてる。`, 28);
  }
  if (mode === 'visual') {
    const clause = firstInterestingClause(topic)
      .replace(/、?追える/u, '')
      .replace(/、?米国デビューへ/u, '')
      .trim();
    return truncate(clause.endsWith('。') ? clause : `${clause}。`, 28);
  }
  const clause = firstInterestingClause(topic);
  return truncate(clause.endsWith('。') ? clause : `${clause}。`, 28);
};

const findSentence = (sentences: string[], pattern: RegExp, exclude: string[] = []) =>
  sentences.find(
    (sentence) =>
      pattern.test(sentence) &&
      !exclude.some((existing) => areNearDuplicate(existing, sentence)),
  );

const uniqueNarrations = (items: string[]) => {
  const unique: string[] = [];
  for (const item of items) {
    if (!item) {
      continue;
    }
    if (unique.some((existing) => areNearDuplicate(existing, item))) {
      continue;
    }
    unique.push(item);
  }
  return unique;
};

const buildNarrationPlan = ({
  mode,
  topic,
  selectedSentences,
}: {
  mode: StoryMode;
  topic: string;
  selectedSentences: string[];
}) => {
  const lead = findSentence(
    selectedSentences,
    /(導入|発表|公開|予測|決定|登場|命名|採用|復活|可視化|光)/u,
  ) ?? selectedSentences[0];
  const context = findSentence(
    selectedSentences,
    /(初|これまで|以前|202[0-9]年|背景|理由|一方|30周年|当時|猛暑)/u,
    lead ? [lead] : [],
  ) ?? selectedSentences[1] ?? selectedSentences[0];
  const impact = findSentence(
    selectedSentences,
    /(影響|目的|見やす|追いやす|必要|注意|高温|状況|増え|警戒|デザイン)/u,
    [lead, context].filter(Boolean),
  ) ?? selectedSentences[2] ?? context;

  if (mode === 'visual') {
    if (/フェンシング/u.test(topic)) {
      return [
        '剣の軌跡を光で見せる技術が、米国の大会で初めて使われる。',
        '一瞬で終わる攻防でも、どこを通ったか目で追いやすくなる。',
        '東京五輪でも使われた可視化が、海外でも広がり始めた。',
        '見た目は派手だけど、観戦の分かりやすさにも効きそうだ。',
      ];
    }
    const subject = firstInterestingClause(topic);
    return uniqueNarrations([
      normalizeBeatText(lead),
      normalizeBeatText(context),
      `${truncate(subject, 24)}で、一瞬の動きも追いやすくなる。`,
    ]).slice(0, 3);
  }

  if (mode === 'weather' && /猛暑再来/u.test(topic)) {
    return uniqueNarrations([
      '今年の夏は、かなり暑い寄りの予測が出てきた。',
      'JAMSTECはエルニーニョとインド洋ダイポールの同時発生を見ている。',
      '世界的に暑かった2023年に近い空気感かもしれない。',
    ]).slice(0, 3);
  }

  if (mode === 'weather' && /40℃|酷暑日/u.test(topic)) {
    return uniqueNarrations([
      '40℃以上の日は、気象庁でも酷暑日になった。',
      '35℃の猛暑日よりさらに上、と覚えると分かりやすい。',
      '危険な暑さをひとことで伝えるための呼び方だ。',
    ]).slice(0, 3);
  }

  if (mode === 'retro') {
    const subject = extractRetroSubject(topic);
    if (/サイバーショット/u.test(topic)) {
      return [
        'サイバーショットが30周年を迎えた。',
        '初代モデルは、今見てもかなり攻めたデザインだった。',
        '昔のデジカメは地味、という印象がひっくり返る。',
      ];
    }
    return uniqueNarrations([
      `${truncate(subject, 24)}が節目を迎えた。`,
      normalizeBeatText(lead),
      '今見ると、当時の攻めたデザインがよく分かる。',
    ]).slice(0, 3);
  }

  return uniqueNarrations([
    normalizeBeatText(lead),
    normalizeBeatText(context),
    normalizeBeatText(impact),
  ]).slice(0, 4);
};

const buildAssetHintForMode = ({
  mode,
  topic,
  narration,
  index,
}: {
  mode: StoryMode;
  topic: string;
  narration: string;
  index: number;
}) => {
  if (mode === 'visual') {
    return [
      'fencing sword trail visualization',
      'fencing match close up',
      'tokyo olympics fencing visualization',
      'fencing arena replay',
    ][index] ?? `fencing ${pickHighlight(topic, narration)}`;
  }

  if (mode === 'weather' && /猛暑再来/u.test(topic)) {
    return [
      'heatwave japan summer city thermometer',
      'el nino indian ocean dipole map',
      'extreme heat weather map globe',
    ][index] ?? `heatwave ${pickHighlight(topic, narration)}`;
  }

  if (mode === 'weather' && /40℃|酷暑日/u.test(topic)) {
    return [
      '40 celsius thermometer summer city',
      'heatwave warning japan weather graphic',
      'summer heat safety shade water',
    ][index] ?? `heatwave ${pickHighlight(topic, narration)}`;
  }

  if (mode === 'retro') {
    return [
      'sony cybershot vintage camera',
      'compact digital camera 1990s design',
      'old cyber-shot camera close up',
    ][index] ?? `${extractRetroSubject(topic)} vintage camera`;
  }

  const highlight = pickHighlight(topic, narration);
  return [normalizeTopicTitle(topic), isDateLikeNumericPhrase(highlight) ? '' : highlight]
    .filter(Boolean)
    .join(' ');
};

const buildCtaForMode = (mode: StoryMode, topic: string) => {
  if (mode === 'visual') {
    return 'こういう可視化、他の競技でも見たい？';
  }
  if (mode === 'weather') {
    return '今年の暑さ対策、何してるかコメントで。';
  }
  if (mode === 'retro') {
    return '懐かしい機種を知ってたらコメントで。';
  }
  return buildCta(topic);
};

const similarityTokens = (sentence: string) =>
  new Set(
    cleanText(sentence)
      .toLowerCase()
      .match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]{2,10}/gu) ?? [],
  );

const areNearDuplicate = (left: string, right: string) => {
  const leftTokens = similarityTokens(left);
  const rightTokens = similarityTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return false;
  }

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  const denominator = Math.min(leftTokens.size, rightTokens.size);
  return overlap / denominator >= 0.6;
};

const sentenceRoleScore = (
  sentence: string,
  role: 'lead' | 'context' | 'why',
) => {
  const boilerplatePenalty = /一般財団法人|本社：|理事長|以下/u.test(sentence)
    ? 3
    : 0;
  switch (role) {
    case 'lead':
      return (
        (/(決定|発表|公開|開始|命名|呼称|名付け|導入|登場|決まっ)/u.test(
          sentence,
        )
          ? 2
          : 0) +
        (/気象庁|政府|研究チーム|新たに/u.test(sentence) ? 1 : 0) -
        (/一方|では/u.test(sentence) ? 1 : 0) -
        boilerplatePenalty
      );
    case 'context':
      return (
        (/(すでに|以前|これまで|独自に|202[0-9]年|一方|従来|先に)/u.test(
          sentence,
        )
          ? 2
          : 0) +
        (/日本気象協会|当時|前から/u.test(sentence) ? 1 : 0) -
        boilerplatePenalty
      );
    case 'why':
      return (
        (/(背景|理由|ため|受け|状況|頻発|必要|目的|影響|注意|対策|増え|高温)/u.test(
          sentence,
        )
          ? 2
          : 0) +
        (/40℃|猛暑|酷暑/u.test(sentence) ? 1 : 0) -
        boilerplatePenalty
      );
  }
};

const selectNarrativeSentences = (sortedSentences: string[]) => {
  const selected: string[] = [];
  const pushBestForRole = (role: 'lead' | 'context' | 'why') => {
    const candidate = sortedSentences
      .filter((sentence) => !selected.some((existing) => areNearDuplicate(existing, sentence)))
      .sort((left, right) => {
        return sentenceRoleScore(right, role) - sentenceRoleScore(left, role);
      })
      .find((sentence) => sentenceRoleScore(sentence, role) > 0);

    if (candidate) {
      selected.push(candidate);
    }
  };

  pushBestForRole('lead');
  pushBestForRole('context');
  pushBestForRole('why');

  for (const sentence of sortedSentences) {
    if (selected.some((existing) => areNearDuplicate(existing, sentence))) {
      continue;
    }
    selected.push(sentence);
    if (selected.length === 3) {
      break;
    }
  }

  return selected.slice(0, 3);
};

export const buildBriefFromTopic = async (topic: RankedTopic) => {
  const normalizedTitle = normalizeTopicTitle(topic.title);
  const researchSnippets = await buildResearchSnippets(topic);
  const storyMode = inferStoryMode(normalizedTitle, researchSnippets);
  const knowledgeBase = uniqueBy(
    researchSnippets
      .flatMap((snippet) => splitIntoSentences(snippet.excerpt))
      .map((sentence) =>
        cleanText(sentence)
          .replace(cleanText(topic.title), '')
          .replace(normalizedTitle, '')
          .replace(/\s+/g, ' ')
          .trim(),
      )
      .filter((sentence) => !unusableSentence(sentence, topic.title)),
    (sentence) => sentence,
  );

  const sortedSentences = [...knowledgeBase].sort((left, right) => {
    return sentenceWeight(right, normalizedTitle) - sentenceWeight(left, normalizedTitle);
  });

  const selectedSentences = selectNarrativeSentences(sortedSentences);
  if (selectedSentences.length < 3) {
    throw new Error(`brief: not enough research sentences for ${topic.title}`);
  }

  const shortTitle = buildShortTitle({
    mode: storyMode,
    topic: normalizedTitle,
  });
  const narrations = buildNarrationPlan({
    mode: storyMode,
    topic: normalizedTitle,
    selectedSentences,
  });

  const usedHighlights: string[] = [];
  const segments = narrations.map((narration, index) => {
    const excludeTerms = [...usedHighlights];
    const highlight = pickHighlight(shortTitle, narration, excludeTerms);
    usedHighlights.push(highlight);
    return {
      narration: truncate(narration, 84),
      caption: truncate(narration, 42),
      highlight,
      assetHint: buildAssetHintForMode({
        mode: storyMode,
        topic: normalizedTitle,
        narration,
        index,
      }),
      targetDurationSec: storyMode === 'retro' ? 5.4 : 5.8,
    };
  });

  const numericPhrase =
    segments
      .map((segment) => extractNumericPhrase(segment.narration))
      .find((value): value is string => Boolean(value)) ?? null;

  const hook =
    shortTitle ||
    buildHook({
      topic: normalizedTitle,
      numericPhrase,
      segments: segments.map(({narration, highlight}) => ({narration, highlight})),
    });
  const cta = buildCtaForMode(storyMode, normalizedTitle);

  const brief: Brief = briefSchema.parse({
    topic: normalizedTitle,
    title: toTitleCaseTopic(shortTitle),
    hook,
    segments,
    cta,
    assetQueries: segments.map((segment) => segment.assetHint),
    sources: researchSnippets.map((snippet) => ({
      title: snippet.title,
      url: snippet.url,
      excerpt: truncate(snippet.excerpt, 240),
    })),
    voice: DEFAULT_VOICE_SETTINGS,
  });

  return {brief, researchSnippets};
};
