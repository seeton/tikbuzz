import {
  BLOCKED_TOPIC_KEYWORDS,
  ENTERPRISE_TOPIC_KEYWORDS,
  POSITIVE_TOPIC_KEYWORDS,
  PROCESS_TOPIC_KEYWORDS,
  SHORTS_FRIENDLY_KEYWORDS,
  VISUAL_SHORTS_KEYWORDS,
  WEAK_TOPIC_KEYWORDS,
} from '../config';
import {cleanText, scoreKeywordMatches} from '../lib/text';
import {rankedTopicSchema, type CandidateTopic, type RankedTopic} from '../types';

const containsBlockedKeyword = (value: string) =>
  BLOCKED_TOPIC_KEYWORDS.some((keyword) => value.includes(keyword));

const looksLikeCorporateLaunch = (candidate: CandidateTopic) =>
  /^[A-Za-z0-9][^、]{1,24}、/u.test(candidate.title) &&
  /(発表|公開|販売|開発|提供|導入|対応|最適化|開始)/u.test(candidate.title);

const looksLikeProcessHeadline = (candidate: CandidateTopic) => {
  const haystack = `${candidate.title} ${candidate.summary}`;
  return (
    /(決定|命名|呼称|採用|合意)/u.test(candidate.title) &&
    /(アンケート|有識者|発表|検討|会合|方針)/u.test(haystack)
  );
};

const describeSourceBonus = (sourceType: CandidateTopic['sourceType']) => {
  switch (sourceType) {
    case 'trends':
      return 2.4;
    case 'community':
      return 1.6;
    case 'news':
      return 1.1;
  }
};

const scoreCandidate = (candidate: CandidateTopic) => {
  const haystack = `${candidate.title} ${candidate.summary}`;
  const reasons: string[] = [];
  let score = describeSourceBonus(candidate.sourceType);

  if (containsBlockedKeyword(haystack)) {
    return null;
  }

  const shortsFriendlyMatches = scoreKeywordMatches(
    haystack,
    SHORTS_FRIENDLY_KEYWORDS,
  );
  const visualMatches = scoreKeywordMatches(haystack, VISUAL_SHORTS_KEYWORDS);
  const enterpriseMatches = scoreKeywordMatches(
    haystack,
    ENTERPRISE_TOPIC_KEYWORDS,
  );
  const processMatches = scoreKeywordMatches(haystack, PROCESS_TOPIC_KEYWORDS);

  if ((enterpriseMatches >= 2 || looksLikeCorporateLaunch(candidate)) && shortsFriendlyMatches === 0) {
    return null;
  }

  if (looksLikeProcessHeadline(candidate) && visualMatches === 0) {
    score -= 3.2;
    reasons.push('too procedural for a short-form explainer');
  }

  const positiveMatches = scoreKeywordMatches(haystack, POSITIVE_TOPIC_KEYWORDS);
  if (positiveMatches > 0) {
    score += positiveMatches * 1.2;
    reasons.push('safe-interest keyword match');
  }

  if (shortsFriendlyMatches > 0) {
    score += shortsFriendlyMatches * 1.8;
    reasons.push('visually explainable for mass short-form');
  }

  if (visualMatches > 0) {
    score += visualMatches * 2.1;
    reasons.push('already has a strong visual payoff');
  }

  if (candidate.title.length >= 10 && candidate.title.length <= 36) {
    score += 1.1;
    reasons.push('title length fits short-form hook');
  }

  if (/なぜ|実は|世界初|初めて|仕組み|秘密|再び/u.test(candidate.title)) {
    score += 1.5;
    reasons.push('title already has a curiosity hook');
  }

  if (/[0-9０-９]/u.test(candidate.title)) {
    score += 0.4;
    reasons.push('numerical anchor');
  }

  if (candidate.summary.length >= 32 && candidate.summary.length <= 160) {
    score += 0.8;
    reasons.push('summary is compact enough for 25-35s');
  }

  if (/速報|ライブ|炎上|批判/u.test(candidate.title)) {
    score -= 1.8;
    reasons.push('volatile or argumentative topic');
  }

  const weakMatches = scoreKeywordMatches(haystack, WEAK_TOPIC_KEYWORDS);
  if (weakMatches > 0) {
    score -= weakMatches * 1.2;
    reasons.push('business/process headline');
  }

  if (processMatches > 0) {
    score -= processMatches * 1.05;
    reasons.push('headline is driven by process words');
  }

  if (enterpriseMatches > 0) {
    score -= enterpriseMatches * 1.4;
    reasons.push('too enterprise/devtools for short-form');
  }

  if (/宇宙|科学|歴史|技術|AI|動物|地理|文化/u.test(haystack)) {
    score += 1.3;
    reasons.push('visually explainable evergreen topic');
  }

  return rankedTopicSchema.parse({
    ...candidate,
    rankScore: Number(score.toFixed(2)),
    rankReasons: reasons,
  });
};

export const rankCandidateTopics = (candidates: CandidateTopic[]) => {
  const ranked = candidates
    .map((candidate) => scoreCandidate(candidate))
    .filter((candidate): candidate is RankedTopic => candidate != null)
    .sort((left, right) => right.rankScore - left.rankScore);

  if (ranked.length === 0) {
    const sample = candidates.map((candidate) => cleanText(candidate.title)).slice(0, 5);
    throw new Error(
      `All discovered topics were filtered out. Sample candidates: ${sample.join(', ')}`,
    );
  }

  return {
    ranked,
    selected: ranked[0],
  };
};
