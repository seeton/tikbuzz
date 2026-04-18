import React from 'react';
import {
  AbsoluteFill,
  Html5Audio,
  Img,
  OffthreadVideo,
  Sequence,
  interpolate,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import {RenderProps, TimelineSegment} from '../types';

const JP_FONT_STACK =
  '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", "Meiryo", system-ui, sans-serif';

const resolveMediaSource = (input: string) => {
  if (/^https?:\/\//u.test(input)) {
    return input;
  }

  return staticFile(input);
};

const seededFloat = (seed: number) => {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
};

const fitCaptionFontSize = (text: string, base: number, min: number) =>
  Math.max(min, Math.min(base, Math.round(base * 24 / Math.max(24, text.length))));

const sceneOpacity = (frame: number, durationInFrames: number) =>
  interpolate(frame, [0, 8, Math.max(8, durationInFrames - 8), durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

const BackgroundLayer: React.FC<{
  segment: TimelineSegment;
  durationInFrames: number;
  seed: number;
}> = ({segment, durationInFrames, seed}) => {
  const frame = useCurrentFrame();
  const driftX = interpolate(
    frame,
    [0, durationInFrames],
    [(seededFloat(seed) - 0.5) * 48, (seededFloat(seed + 11) - 0.5) * 48],
    {extrapolateRight: 'clamp'},
  );
  const driftY = interpolate(
    frame,
    [0, durationInFrames],
    [(seededFloat(seed + 3) - 0.5) * 36, (seededFloat(seed + 17) - 0.5) * 36],
    {extrapolateRight: 'clamp'},
  );
  const scale = interpolate(
    frame,
    [0, durationInFrames],
    [segment.backgroundAssetType === 'video' ? 1.06 : 1.14, 1.01],
    {extrapolateRight: 'clamp'},
  );
  const source = resolveMediaSource(segment.backgroundAsset);
  const style: React.CSSProperties = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transform: `scale(${scale}) translate(${driftX}px, ${driftY}px)`,
    filter: 'brightness(0.72) saturate(1.06) contrast(1.06)',
    willChange: 'transform',
  };

  if (segment.backgroundAssetType === 'video') {
    return <OffthreadVideo muted src={source} style={style} />;
  }

  return <Img src={source} style={style} />;
};

const HighlightedCaption: React.FC<{
  caption: string;
  highlight: string;
  fontSize: number;
}> = ({caption, highlight, fontSize}) => {
  const safeHighlight =
    highlight && highlight.length >= 2 && caption.includes(highlight) ? highlight : null;
  const parts = safeHighlight
    ? [
        caption.slice(0, caption.indexOf(safeHighlight)),
        safeHighlight,
        caption.slice(caption.indexOf(safeHighlight) + safeHighlight.length),
      ]
    : [caption];

  return (
    <div
      style={{
        maxWidth: 860,
        color: '#ff7ccf',
        fontFamily: JP_FONT_STACK,
        fontWeight: 900,
        fontSize,
        lineHeight: 1.08,
        letterSpacing: '-0.05em',
        textAlign: 'center',
        whiteSpace: 'pre-wrap',
        overflowWrap: 'break-word',
        textShadow:
          '0 1px 0 rgba(0,0,0,0.92), 0 2px 0 rgba(0,0,0,0.92), 0 4px 18px rgba(0,0,0,0.68)',
        WebkitTextStroke: '10px rgba(0, 0, 0, 0.78)',
        paintOrder: 'stroke fill',
      }}
    >
      {parts.map((part, index) => {
        const isHighlight = safeHighlight != null && index === 1;
        return (
          <span
            key={`${part}-${index}`}
            style={
              isHighlight
                ? {
                    color: '#ffd3ef',
                  }
                : undefined
            }
          >
            {part}
          </span>
        );
      })}
    </div>
  );
};

const SceneFrame: React.FC<{
  segment: TimelineSegment;
  index: number;
}> = ({segment, index}) => {
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const durationInFrames = Math.max(
    1,
    Math.round(((segment.endMs - segment.startMs) / 1000) * fps),
  );
  const opacity = sceneOpacity(frame, durationInFrames);
  const translateY = interpolate(frame, [0, 14], [24, 0], {
    extrapolateRight: 'clamp',
  });
  const captionScale = interpolate(frame, [0, 12], [0.96, 1], {
    extrapolateRight: 'clamp',
  });
  const isHook = segment.sectionType === 'hook';
  const isCta = segment.sectionType === 'cta';
  const caption = segment.caption;
  const fontSize = isHook
    ? fitCaptionFontSize(caption, 118, 82)
    : isCta
      ? fitCaptionFontSize(caption, 98, 68)
      : fitCaptionFontSize(caption, 92, 62);

  return (
    <AbsoluteFill style={{opacity}}>
      <BackgroundLayer segment={segment} durationInFrames={durationInFrames} seed={index + 1} />
      <AbsoluteFill
        style={{
          background:
            'linear-gradient(180deg, rgba(3, 7, 18, 0.22) 0%, rgba(3, 7, 18, 0.10) 28%, rgba(3, 7, 18, 0.36) 58%, rgba(3, 7, 18, 0.82) 100%)',
        }}
      />
      <AbsoluteFill
        style={{
          background:
            'radial-gradient(circle at 50% 18%, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0) 34%)',
        }}
      />
      <AbsoluteFill
        style={{
          justifyContent: isHook ? 'center' : 'flex-end',
          alignItems: 'center',
          paddingLeft: 56,
          paddingRight: 56,
          paddingTop: isHook ? 260 : 0,
          paddingBottom: isHook ? 0 : isCta ? 360 : 420,
          transform: `translateY(${translateY}px) scale(${captionScale})`,
        }}
      >
        <HighlightedCaption
          caption={caption}
          highlight={segment.highlight}
          fontSize={fontSize}
        />
      </AbsoluteFill>
      <Html5Audio src={resolveMediaSource(segment.audioPublicPath)} />
    </AbsoluteFill>
  );
};

export const AutoVideo: React.FC<RenderProps> = ({timeline, bgm}) => {
  const {fps} = useVideoConfig();

  return (
    <AbsoluteFill style={{backgroundColor: '#020617'}}>
      {timeline.segments.map((segment, index) => {
        const from = Math.round((segment.startMs / 1000) * fps);
        const durationInFrames = Math.max(
          1,
          Math.round(((segment.endMs - segment.startMs) / 1000) * fps),
        );

        return (
          <Sequence
            key={`${segment.sectionType}-${segment.startMs}-${index}`}
            from={from}
            durationInFrames={durationInFrames}
          >
            <SceneFrame index={index} segment={segment} />
          </Sequence>
        );
      })}
      {bgm ? (
        <Html5Audio
          src={resolveMediaSource(bgm.audioPublicPath)}
          volume={(_: number) => bgm.volume}
        />
      ) : null}
    </AbsoluteFill>
  );
};
