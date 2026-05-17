/* eslint-disable react-refresh/only-export-components */
import * as React from 'react';

import {
  AudioPlayerDuration,
  AudioPlayerProgress,
  AudioPlayerProvider,
  AudioPlayerTime,
  useAudioPlayer,
} from '@/components/ui/audio-player';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  estimateCharacterAlignment,
  timestampsToCharacterAlignment,
  type CharacterAlignmentResponseModel,
  type WordTimestamp,
} from '@/lib/voice/timestamps';

type TranscriptWord = {
  text: string;
  start: number;
  end: number;
  index: number;
};

type TranscriptGap = {
  text: string;
  start: number;
  end: number;
  index: number;
};

type TranscriptSegment = TranscriptWord | TranscriptGap;

type TranscriptViewerContextValue = {
  alignment: CharacterAlignmentResponseModel;
  words: TranscriptWord[];
  segments: TranscriptSegment[];
  currentWord: TranscriptWord | null;
  isEstimated: boolean;
  audioType: string;
  audioSrc: string | null;
} & ReturnType<typeof useAudioPlayer>;

const TranscriptViewerContext = React.createContext<TranscriptViewerContextValue | null>(null);

export const useTranscriptViewerContext = () => {
  const context = React.useContext(TranscriptViewerContext);
  if (!context) {
    throw new Error('Transcript viewer components must be used within TranscriptViewerContainer');
  }
  return context;
};

const buildSegments = (alignment: CharacterAlignmentResponseModel): TranscriptSegment[] => {
  const segments: TranscriptSegment[] = [];
  let buffer = '';
  let bufferStart = 0;
  let bufferEnd = 0;
  let wordIndex = 0;

  const flushBuffer = (type: 'word' | 'gap') => {
    if (!buffer) return;
    if (type === 'word') {
      segments.push({ text: buffer, start: bufferStart, end: bufferEnd, index: wordIndex++ });
    } else {
      segments.push({ text: buffer, start: bufferStart, end: bufferEnd, index: segments.length });
    }
    buffer = '';
  };

  for (let index = 0; index < alignment.characters.length; index += 1) {
    const character = alignment.characters[index] ?? '';
    const start = alignment.characterStartTimesSeconds[index] ?? bufferEnd;
    const end = alignment.characterEndTimesSeconds[index] ?? start;
    const isGap = /\s/.test(character);

    if (!buffer) {
      buffer = character;
      bufferStart = start;
      bufferEnd = end;
      continue;
    }

    const bufferIsGap = /\s/.test(buffer[0] ?? '');
    if (bufferIsGap === isGap) {
      buffer += character;
      bufferEnd = end;
      continue;
    }

    flushBuffer(bufferIsGap ? 'gap' : 'word');
    buffer = character;
    bufferStart = start;
    bufferEnd = end;
  }

  if (buffer) {
    flushBuffer(/\s/.test(buffer[0] ?? '') ? 'gap' : 'word');
  }

  return segments;
};

const TranscriptViewerInner = ({
  audioSrc,
  audioType,
  transcriptText,
  timestamps,
  alignmentEstimated,
  children,
}: React.PropsWithChildren<{
  audioSrc: string | null;
  audioType: string;
  transcriptText: string;
  timestamps: WordTimestamp[] | null;
  alignmentEstimated: boolean;
}>) => {
  const audioPlayer = useAudioPlayer();

  const alignment = React.useMemo(() => {
    if (!transcriptText) {
      return {
        characters: [],
        characterStartTimesSeconds: [],
        characterEndTimesSeconds: [],
      };
    }

    if (timestamps && timestamps.length > 0) {
      return timestampsToCharacterAlignment(transcriptText, timestamps, {
        audioDurationSeconds: audioPlayer.duration,
      });
    }

    return estimateCharacterAlignment(transcriptText, audioPlayer.duration || undefined);
  }, [audioPlayer.duration, timestamps, transcriptText]);

  const segments = React.useMemo(() => buildSegments(alignment), [alignment]);
  const words = React.useMemo(
    () => segments.filter((segment): segment is TranscriptWord => !/\s/.test(segment.text)),
    [segments],
  );
  const currentWord = React.useMemo(
    () => words.find((word) => audioPlayer.currentTime >= word.start && audioPlayer.currentTime <= word.end) ?? null,
    [audioPlayer.currentTime, words],
  );

  const value = React.useMemo<TranscriptViewerContextValue>(() => ({
    ...audioPlayer,
    alignment,
    words,
    segments,
    currentWord,
    isEstimated: alignmentEstimated || !timestamps || timestamps.length === 0,
    audioType,
    audioSrc,
  }), [alignment, alignmentEstimated, audioPlayer, audioSrc, audioType, currentWord, segments, timestamps, words]);

  return (
    <TranscriptViewerContext.Provider value={value}>
      {children}
    </TranscriptViewerContext.Provider>
  );
};

export const TranscriptViewerContainer = ({
  audioSrc,
  audioType = 'audio/mpeg',
  transcriptText,
  timestamps,
  alignmentEstimated = false,
  autoPlayNonce = 0,
  onBeforePlay,
  onEnded,
  className,
  children,
}: React.PropsWithChildren<{
  audioSrc: string | null;
  audioType?: string;
  transcriptText: string;
  timestamps: WordTimestamp[] | null;
  alignmentEstimated?: boolean;
  autoPlayNonce?: number;
  onBeforePlay?: () => void;
  onEnded?: () => void;
  className?: string;
}>) => (
  <AudioPlayerProvider
    src={audioSrc}
    type={audioType}
    autoPlayNonce={autoPlayNonce}
    onBeforePlay={onBeforePlay}
    onEnded={onEnded}
  >
    <TranscriptViewerInner
      audioSrc={audioSrc}
      audioType={audioType}
      transcriptText={transcriptText}
      timestamps={timestamps}
      alignmentEstimated={alignmentEstimated}
    >
      <div className={className}>
        {children}
      </div>
    </TranscriptViewerInner>
  </AudioPlayerProvider>
);

export const TranscriptViewerAudio = ({ className }: { className?: string }) => (
  <div className={className} aria-hidden="true" />
);

export const TranscriptViewerWords = ({
  className,
}: {
  className?: string;
}) => {
  const { currentWord, isEstimated, seek, segments } = useTranscriptViewerContext();

  return (
    <div className={cn('max-h-52 overflow-auto rounded-2xl border border-[var(--interactive-border)] bg-background/70 p-4', className)}>
      <div className="flex flex-wrap gap-x-1 gap-y-2">
        {segments.map((segment) => {
          const isGap = /\s/.test(segment.text);
          if (isGap) {
            return <span key={`gap-${segment.index}`} className="whitespace-pre-wrap text-transparent select-none">{segment.text}</span>;
          }

          const isCurrent = currentWord?.index === segment.index;
          const isSpoken = currentWord ? segment.index < currentWord.index : false;
          return (
            <button
              key={`word-${segment.index}`}
              type="button"
              className={cn(
                'rounded-md px-1 py-0.5 text-left transition-colors',
                isCurrent && 'bg-primary text-primary-foreground',
                !isCurrent && isSpoken && 'text-foreground',
                !isCurrent && !isSpoken && 'text-muted-foreground',
              )}
              onClick={() => seek(segment.start)}
            >
              {segment.text}
            </button>
          );
        })}
      </div>
      {isEstimated ? (
        <p className="mt-3 typography-meta text-muted-foreground">Estimated transcript timing</p>
      ) : null}
    </div>
  );
};

export const TranscriptViewerScrubBar = ({ className }: { className?: string }) => (
  <div className={cn('flex items-center gap-3', className)}>
    <AudioPlayerTime className="w-10 text-right" />
    <AudioPlayerProgress className="flex-1" />
    <AudioPlayerDuration className="w-10" />
  </div>
);

export const TranscriptViewerPlayPauseButton = ({
  className,
  children,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'children'> & {
  children?: React.ReactNode | ((state: { isPlaying: boolean }) => React.ReactNode);
}) => {
  const { isPlaying, pause, play } = useTranscriptViewerContext();

  return (
    <Button
      type="button"
      variant="secondary"
      className={className}
      onClick={() => {
        if (isPlaying) {
          pause();
          return;
        }
        void play();
      }}
      {...props}
    >
      {typeof children === 'function' ? children({ isPlaying }) : children}
      {!children ? (
        <>
          {isPlaying ? 'Pause' : 'Play'}
        </>
      ) : null}
    </Button>
  );
};
