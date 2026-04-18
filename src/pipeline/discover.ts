import Parser from 'rss-parser';
import {DISCOVER_TARGET_COUNT, DISCOVERY_SOURCES} from '../config';
import {fetchText} from '../lib/http';
import {cleanText, uniqueBy} from '../lib/text';
import {candidateTopicSchema, type CandidateTopic} from '../types';

type FeedItem = {
  title?: string;
  link?: string;
  contentSnippet?: string;
  content?: string;
  isoDate?: string;
  pubDate?: string;
};

const parser = new Parser<Record<string, never>, FeedItem>();

const normalizeSummary = (item: FeedItem) => {
  const raw = item.contentSnippet ?? item.content ?? item.title ?? '';
  return cleanText(raw).slice(0, 220);
};

export const discoverCandidateTopics = async () => {
  const collected: CandidateTopic[] = [];

  for (const source of DISCOVERY_SOURCES) {
    try {
      const xml = await fetchText(source.url);
      const feed = await parser.parseString(xml);
      const items = (feed.items ?? []).slice(0, 8);

      for (const item of items) {
        if (!item.title || !item.link) {
          continue;
        }

        const summary = normalizeSummary(item);
        if (!summary) {
          continue;
        }

        collected.push(
          candidateTopicSchema.parse({
            title: cleanText(item.title),
            summary,
            sourceType: source.sourceType,
            sourceUrl: item.link,
            scoreHints: [source.name],
            fetchedAt: item.isoDate ?? item.pubDate ?? new Date().toISOString(),
          }),
        );
      }
    } catch (error) {
      console.warn(`discover: failed to fetch ${source.url}`, error);
    }
  }

  const unique = uniqueBy(collected, (candidate) => candidate.title.toLowerCase());
  return unique.slice(0, DISCOVER_TARGET_COUNT);
};
