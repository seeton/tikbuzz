import React from 'react';
import {Composition} from 'remotion';
import {REMOTION_COMPOSITION_ID, VIDEO_FPS, VIDEO_HEIGHT, VIDEO_WIDTH} from './config';
import {AutoVideo} from './remotion/AutoVideo';
import {sampleRenderProps} from './remotion/sample-props';
import {renderPropsSchema, type RenderProps} from './types';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id={REMOTION_COMPOSITION_ID}
      component={AutoVideo}
      fps={VIDEO_FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
      durationInFrames={Math.ceil((sampleRenderProps.timeline.totalDurationMs / 1000) * VIDEO_FPS)}
      defaultProps={sampleRenderProps}
      calculateMetadata={async ({props}) => {
        const parsed = renderPropsSchema.parse(props as RenderProps);
        return {
          durationInFrames: Math.ceil(
            (parsed.timeline.totalDurationMs / 1000) * VIDEO_FPS,
          ),
          props: parsed,
        };
      }}
    />
  );
};
