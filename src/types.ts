import {z} from 'zod';

export const sourceTypeSchema = z.enum(['trends', 'news', 'community']);

export const candidateTopicSchema = z.object({
  title: z.string().min(1),
  summary: z.string().min(1),
  sourceType: sourceTypeSchema,
  sourceUrl: z.string().url(),
  scoreHints: z.array(z.string()),
  fetchedAt: z.string().min(1),
});

export type CandidateTopic = z.infer<typeof candidateTopicSchema>;

export const rankedTopicSchema = candidateTopicSchema.extend({
  rankScore: z.number(),
  rankReasons: z.array(z.string()),
});

export type RankedTopic = z.infer<typeof rankedTopicSchema>;

export const briefSourceSchema = z.object({
  title: z.string(),
  url: z.string().url(),
  excerpt: z.string(),
});

export const briefSegmentSchema = z.object({
  narration: z.string().min(1),
  caption: z.string().min(1),
  highlight: z.string().min(1),
  assetHint: z.string().min(1),
  targetDurationSec: z.number().positive(),
});

export type BriefSegment = z.infer<typeof briefSegmentSchema>;

export const briefSchema = z.object({
  topic: z.string().min(1),
  title: z.string().min(1),
  hook: z.string().min(1),
  segments: z.array(briefSegmentSchema).min(3).max(4),
  cta: z.string().min(1),
  assetQueries: z.array(z.string().min(1)).min(3),
  sources: z.array(briefSourceSchema).min(1),
  voice: z.object({
    speedScale: z.number().positive(),
    intonationScale: z.number().positive(),
    pitchScale: z.number(),
    volumeScale: z.number().positive(),
    prePhonemeLength: z.number().nonnegative(),
    postPhonemeLength: z.number().nonnegative(),
  }),
});

export type Brief = z.infer<typeof briefSchema>;

export const assetTypeSchema = z.enum(['image', 'video', 'svg-fallback']);

export const assetLogEntrySchema = z.object({
  segmentIndex: z.number().int().nonnegative(),
  query: z.string().min(1),
  selectedAssetPath: z.string().min(1),
  sourceUrl: z.string().url(),
  pageUrl: z.string().url(),
  host: z.string().min(1),
  assetType: assetTypeSchema,
  selectionScore: z.number(),
  selectedReason: z.string().min(1),
});

export type AssetLogEntry = z.infer<typeof assetLogEntrySchema>;

export const assetLogSchema = z.object({
  runId: z.string().min(1),
  createdAt: z.string().min(1),
  entries: z.array(assetLogEntrySchema),
});

export type AssetLog = z.infer<typeof assetLogSchema>;

export const timelineSegmentSchema = z.object({
  sectionType: z.enum(['hook', 'segment', 'cta']),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  audioPath: z.string().min(1),
  audioPublicPath: z.string().min(1),
  caption: z.string().min(1),
  highlight: z.string().min(1),
  backgroundAsset: z.string().min(1),
  backgroundAssetType: assetTypeSchema,
});

export type TimelineSegment = z.infer<typeof timelineSegmentSchema>;

export const timelineSchema = z.object({
  totalDurationMs: z.number().int().positive(),
  segments: z.array(timelineSegmentSchema).min(1),
});

export type Timeline = z.infer<typeof timelineSchema>;

export const bgmTrackSchema = z.object({
  audioPath: z.string().min(1),
  audioPublicPath: z.string().min(1),
  durationMs: z.number().int().positive(),
  volume: z.number().min(0).max(1),
});

export type BgmTrack = z.infer<typeof bgmTrackSchema>;

export const renderPropsSchema = z.object({
  runId: z.string().min(1),
  title: z.string().min(1),
  timeline: timelineSchema,
  bgm: bgmTrackSchema.optional(),
});

export type RenderProps = z.infer<typeof renderPropsSchema>;

export const voiceLogEntrySchema = z.object({
  sectionType: z.enum(['hook', 'segment', 'cta']),
  index: z.number().int().nonnegative(),
  text: z.string().min(1),
  audioPath: z.string().min(1),
  durationMs: z.number().int().positive(),
});

export const voiceLogSchema = z.object({
  runId: z.string().min(1),
  createdAt: z.string().min(1),
  entries: z.array(voiceLogEntrySchema).min(1),
});

export type VoiceLog = z.infer<typeof voiceLogSchema>;

export const sourceLogSchema = z.object({
  runId: z.string().min(1),
  createdAt: z.string().min(1),
  candidates: z.array(candidateTopicSchema),
  selectedTopic: rankedTopicSchema,
  researchSnippets: z.array(briefSourceSchema),
});

export type SourceLog = z.infer<typeof sourceLogSchema>;
