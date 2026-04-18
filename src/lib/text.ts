const sentenceDelimiter = /(?<=[。！？!?])/u;
const DATE_LIKE_NUMERIC_PATTERN =
  /^[0-9０-９]{1,6}(?:年(?:[0-9０-９]{1,2}月(?:[0-9０-９]{1,2}日)?)?|月(?:[0-9０-９]{1,2}日)?|日)$/u;

export const cleanText = (value: string) =>
  value
    .replace(/<[^>]+>/g, ' ')
    .replace(/[｜|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[「」]/g, '')
    .trim();

export const truncate = (value: string, maxLength: number) => {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
};

export const splitIntoSentences = (value: string) =>
  cleanText(value)
    .split(sentenceDelimiter)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 12);

export const uniqueBy = <T>(items: T[], selector: (item: T) => string) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = selector(item);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
};

export const scoreKeywordMatches = (value: string, keywords: string[]) => {
  const haystack = cleanText(value).toLowerCase();
  return keywords.reduce((score, keyword) => {
    return score + (haystack.includes(keyword.toLowerCase()) ? 1 : 0);
  }, 0);
};

export const slugify = (value: string) =>
  cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9faf]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'item';

const HIGHLIGHT_STOPWORDS = new Set([
  'です', 'ます', 'こと', 'これ', 'それ', 'あれ', 'よう', 'もの',
  'ため', 'とき', 'ところ', 'という', 'しかし', 'そして', 'さらに',
  'について', 'において', 'など', 'だけ',
]);

const extractTokens = (text: string) => {
  return [
    ...new Set(
      text.match(/[\p{Script=Han}\p{Script=Katakana}ーA-Za-z0-9]{2,24}/gu) ?? [],
    ),
  ];
};

export const extractNumericPhrase = (text: string): string | null => {
  const patterns = [
    /約?[0-9０-９]{1,6}(?:,[0-9]{3})*(?:\.[0-9]+)?(?:℃|倍|%|％|倍以上|時間|分|秒|年|日|円|人|件|兆|億|万|千|位|種類|kg|m)/u,
    /[0-9０-９]+(?:\.[0-9]+)?(?:倍|%|％)/u,
    /(?:半分|倍増|激減|急増|急落|激変|爆増)/u,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match[0];
    }
  }
  return null;
};

export const isDateLikeNumericPhrase = (value: string) =>
  DATE_LIKE_NUMERIC_PATTERN.test(cleanText(value));

export const pickHighlight = (
  title: string,
  sentence: string,
  excludeTerms: string[] = [],
) => {
  const numeric = extractNumericPhrase(sentence);
  if (numeric && !isDateLikeNumericPhrase(numeric)) {
    return numeric;
  }

  const titleTokens = new Set(extractTokens(title));
  const excluded = new Set([...excludeTerms, ...titleTokens]);
  const tokens = extractTokens(sentence).filter(
    (token) =>
      !HIGHLIGHT_STOPWORDS.has(token) &&
      !excluded.has(token) &&
      !isDateLikeNumericPhrase(token),
  );
  if (tokens.length > 0) {
    return tokens.sort((left, right) => right.length - left.length)[0];
  }

  const fallback = extractTokens(sentence).filter(
    (token) => !HIGHLIGHT_STOPWORDS.has(token),
  );
  return (
    fallback.sort((left, right) => right.length - left.length)[0] ??
    title.slice(0, Math.min(4, title.length))
  );
};

export const emphasizeCaption = (sentence: string, highlight: string) => {
  const cleaned = cleanText(sentence).replace(/[。！？!?]+$/u, '');
  return truncate(cleaned, 34);
};

const CAPTION_MAX_LEN = 36;

const stripLeadingParticles = (text: string) =>
  text
    .replace(/^[、。！？!?・]+/u, '')
    .replace(/^(?:は|が|を|に|で|と|も|の|へ|から|まで|より)+/u, '')
    .trim();

const stripTrailingParticles = (text: string) =>
  text.replace(/[。、！？!?・]+$/u, '').replace(/(?:という|といった|といって|など)$/u, '').trim();

const compactAroundAnchor = (text: string, anchor: string) => {
  const anchorIndex = text.indexOf(anchor);
  if (anchorIndex === -1 || text.length <= CAPTION_MAX_LEN) {
    return stripTrailingParticles(stripLeadingParticles(text));
  }

  const beforeBudget = Math.min(
    anchorIndex,
    Math.max(4, Math.floor((CAPTION_MAX_LEN - anchor.length) * 0.35)),
  );
  const afterBudget = Math.max(0, CAPTION_MAX_LEN - anchor.length - beforeBudget);
  const start = Math.max(0, anchorIndex - beforeBudget);
  const end = Math.min(text.length, anchorIndex + anchor.length + afterBudget);
  return stripTrailingParticles(stripLeadingParticles(text.slice(start, end)));
};

export const buildCaption = (narration: string, highlight: string): string => {
  const cleaned = cleanText(narration).replace(/[。！？!?]+$/u, '');
  const numeric = extractNumericPhrase(cleaned);
  const anchor =
    numeric && !isDateLikeNumericPhrase(numeric) ? numeric : highlight;

  if (cleaned.length <= CAPTION_MAX_LEN) {
    return cleaned;
  }

  if (anchor && cleaned.includes(anchor)) {
    const segs = cleaned.split(/[、。]/u).map((s) => s.trim()).filter(Boolean);
    const withAnchor = segs.find((segment) => segment.includes(anchor));
    if (withAnchor) {
      return compactAroundAnchor(withAnchor, anchor);
    }
  }

  const firstClause = cleaned.split(/[、。]/u)[0] ?? cleaned;
  if (firstClause.length <= CAPTION_MAX_LEN) {
    return stripTrailingParticles(firstClause);
  }
  return stripTrailingParticles(firstClause.slice(0, CAPTION_MAX_LEN));
};

type HookContext = {
  topic: string;
  numericPhrase: string | null;
  segments: Array<{narration: string; highlight: string}>;
};

const hookTemplates: Array<(ctx: HookContext) => string | null> = [
  ({numericPhrase, topic}) =>
    numericPhrase &&
    /呼称|名称|名付け|命名|決定/u.test(topic)
      ? `${numericPhrase}の日に名前がついた。`
      : null,
  ({numericPhrase, topic}) =>
    numericPhrase && !isDateLikeNumericPhrase(numericPhrase)
      ? `${numericPhrase}、知ってた？`
      : null,
  ({topic}) => `知らないと損する「${topic}」の話。`,
  ({topic}) => `${topic}、ちょっと見方が変わる。`,
  ({segments}) =>
    segments[0]?.highlight ? `${segments[0].highlight}で見方が変わる。` : null,
  ({topic}) => `${topic}の裏側、30秒でまとめた。`,
  ({topic}) => `${topic}? 1本で全部分かる。`,
  ({segments}) =>
    segments[0]?.highlight ? `${segments[0].highlight}が基準になる。` : null,
];

export const buildHook = (context: HookContext): string => {
  const candidates = hookTemplates
    .map((template) => template(context))
    .filter((value): value is string => Boolean(value))
    .filter((value) => value.length >= 8 && value.length <= 32);
  if (candidates.length === 0) {
    return `${context.topic}、知ると面白い話。`;
  }
  const seed = context.topic.length + context.segments.length;
  return candidates[seed % candidates.length];
};

const ctaTemplates = [
  '保存して寝る前に見返して。',
  'フォローで続きも届くよ。',
  '役に立ったら「1」でコメントして。',
  '明日も濃い話、プロフから。',
  '続編出すから保存しといて。',
  'コメントで感想くれたら続き作る。',
];

export const buildCta = (topic: string): string => {
  const seed = topic.length;
  return ctaTemplates[seed % ctaTemplates.length];
};

export const splitCaptionIntoPhrases = (caption: string): string[] => {
  const cleaned = cleanText(caption)
    .replace(/[…\.]{2,}$/u, '')
    .replace(/[。！？!?]+$/u, '')
    .replace(/…/gu, '');
  const byPunct = cleaned
    .split(/[、。・]+/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const phrases: string[] = [];
  const tokenPattern =
    /[A-Za-z][A-Za-z0-9.+/_-]*|[0-9０-９][0-9０-９,./%％年月日人件兆億万千位kgm]*|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]{1,3}/gu;
  const chunkLen = 14;
  for (const part of byPunct.length > 0 ? byPunct : [cleaned]) {
    if (part.length <= chunkLen) {
      phrases.push(part);
      continue;
    }
    const tokens = part.match(tokenPattern) ?? [part];
    let current = '';
    for (const token of tokens) {
      if (!current) {
        current = token;
        continue;
      }
      if ((current + token).length > chunkLen) {
        phrases.push(current);
        current = token;
        continue;
      }
      current += token;
    }
    if (current) {
      phrases.push(current);
    }
  }
  return phrases.filter(Boolean);
};

export const sentenceWeight = (sentence: string, title: string) => {
  let score = 0;
  if (sentence.length >= 18 && sentence.length <= 72) {
    score += 2;
  }
  if (sentence.includes(title.slice(0, 4))) {
    score += 1.5;
  }
  if (/[0-9０-９]/u.test(sentence)) {
    score += 0.4;
  }
  if (/世界|日本|初|最大|最古|最速|秘密|なぜ|実は/u.test(sentence)) {
    score += 1;
  }
  return score;
};

export const toTitleCaseTopic = (title: string) => truncate(cleanText(title), 42);

export const normalizeTopicTitle = (title: string) => {
  const cleaned = cleanText(title)
    .replace(/\s[-–—]\s[^-–—]+$/u, '')
    .replace(/\s[｜|]\s[^｜|]+$/u, '')
    .replace(/[🐴📝🔥⭐️✨]+/gu, '')
    .trim();
  return truncate(cleaned || cleanText(title), 52);
};

export const looksMojibake = (value: string) => {
  const cleaned = cleanText(value);
  const replacementCount = cleaned.match(/�/gu)?.length ?? 0;
  if (replacementCount >= 2) {
    return true;
  }

  const nonSpaceLength = cleaned.replace(/\s+/g, '').length;
  if (nonSpaceLength < 24) {
    return false;
  }

  const readableLength =
    cleaned.match(
      /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}A-Za-z0-9]/gu,
    )?.length ?? 0;
  return readableLength / nonSpaceLength < 0.7;
};

export const normalizeSpeechText = (value: string) =>
  cleanText(value)
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/[（）]/gu, ' ')
    .replace(/[()]/gu, ' ')
    .replace(/──|—|–/gu, '、')
    .replace(/…+/gu, '、')
    .replace(/→/gu, ' その結果 ')
    .replace(/-/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
