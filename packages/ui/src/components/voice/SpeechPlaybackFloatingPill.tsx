import * as React from 'react';

import { createPortal } from 'react-dom';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { VoiceButton, type VoiceButtonState } from '@/components/ui/voice-button';
import { useTranscriptViewerContext } from '@/components/ui/transcript-viewer';
import { useSpeechPlaybackStore } from '@/stores/useSpeechPlaybackStore';
import { formatPlaybackTime } from '@/lib/voice/timestamps';
import type { SpeechPlaybackItem } from '@/lib/voice/speechPlayback';
import { cn } from '@/lib/utils';

const FLOATING_PILL_STORAGE_KEY = 'openchamber:speech-playback-pill-position';

const readStoredPosition = () => {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(FLOATING_PILL_STORAGE_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as { x?: number; y?: number };
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x!, y: parsed.y! };
  } catch {
    return null;
  }
};

const clampPosition = (position: { x: number; y: number }) => {
  const width = typeof window !== 'undefined' ? window.innerWidth : 1024;
  const height = typeof window !== 'undefined' ? window.innerHeight : 768;
  const maxX = Math.max(16, width - 280);
  const maxY = Math.max(16, height - 96);
  return {
    x: Math.min(Math.max(16, position.x), maxX),
    y: Math.min(Math.max(16, position.y), maxY),
  };
};

export const SpeechPlaybackFloatingPill = ({
  activeItem,
  playerSnapshot,
  onExpand,
  onClose,
  dictationButtonState,
  onDictationPress,
  onDictationStop,
}: {
  activeItem: SpeechPlaybackItem;
  playerSnapshot: { currentTime: number; duration: number; isPlaying: boolean };
  onExpand: () => void;
  onClose: () => void;
  dictationButtonState: VoiceButtonState;
  onDictationPress: () => void;
  onDictationStop: () => void;
}) => {
  const isBrowser = typeof document !== 'undefined' && typeof window !== 'undefined';

  const { pause, play } = useTranscriptViewerContext();
  const floatingPosition = useSpeechPlaybackStore((state) => state.floatingPosition);
  const setFloatingPosition = useSpeechPlaybackStore((state) => state.setFloatingPosition);
  const draggingRef = React.useRef<{ offsetX: number; offsetY: number } | null>(null);

  React.useEffect(() => {
    if (!isBrowser) return;
    const storedPosition = readStoredPosition();
    if (storedPosition && !floatingPosition) {
      setFloatingPosition(clampPosition(storedPosition));
    }
  }, [floatingPosition, isBrowser, setFloatingPosition]);

  React.useEffect(() => {
    if (!isBrowser) return;
    if (!floatingPosition || typeof window === 'undefined') return;
    window.localStorage.setItem(FLOATING_PILL_STORAGE_KEY, JSON.stringify(floatingPosition));
  }, [floatingPosition, isBrowser]);

  React.useEffect(() => {
    if (!isBrowser) return;
    const handleResize = () => {
      if (!floatingPosition) return;
      setFloatingPosition(clampPosition(floatingPosition));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [floatingPosition, isBrowser, setFloatingPosition]);

  if (!isBrowser) {
    return null;
  }

  const position = clampPosition(floatingPosition ?? { x: Math.max(16, window.innerWidth - 312), y: Math.max(16, window.innerHeight - 120) });
  const progress = playerSnapshot.duration > 0
    ? Math.min(100, (playerSnapshot.currentTime / playerSnapshot.duration) * 100)
    : 0;

  return createPortal(
    <div
      className="fixed z-[70] cursor-move"
      style={{ left: position.x, top: position.y }}
      onPointerDown={(event) => {
        const currentTarget = event.currentTarget;
        draggingRef.current = {
          offsetX: event.clientX - currentTarget.getBoundingClientRect().left,
          offsetY: event.clientY - currentTarget.getBoundingClientRect().top,
        };
        currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!draggingRef.current) return;
        setFloatingPosition(clampPosition({
          x: event.clientX - draggingRef.current.offsetX,
          y: event.clientY - draggingRef.current.offsetY,
        }));
      }}
      onPointerUp={() => {
        draggingRef.current = null;
      }}
    >
      <div className="w-[min(18rem,calc(100vw-1rem))] rounded-full border border-[var(--interactive-border)] bg-background/95 px-3 py-2 shadow-xl backdrop-blur-xl">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => {
              if (playerSnapshot.isPlaying) {
                pause();
                return;
              }
              void play();
            }}
            aria-label={playerSnapshot.isPlaying ? 'Pause playback' : 'Play playback'}
          >
            <Icon name={playerSnapshot.isPlaying ? 'pause-large-fill' : 'play-large-fill'} className="h-4 w-4" />
          </Button>
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onExpand}
          >
            <p className="truncate typography-ui-label text-foreground">{activeItem.originalText}</p>
            <p className="typography-meta text-muted-foreground">
              {formatPlaybackTime(playerSnapshot.currentTime)} / {formatPlaybackTime(playerSnapshot.duration || 0)}
            </p>
          </button>
          <VoiceButton
            state={dictationButtonState}
            size="icon"
            onPress={onDictationPress}
            className="h-8 w-8 rounded-full"
          />
          {dictationButtonState !== 'idle' ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full"
              onPointerDown={(event) => event.stopPropagation()}
              onClick={onDictationStop}
              aria-label="Stop dictation"
            >
              <Icon name="stop-circle-line" className="h-4 w-4" />
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onClose}
            aria-label="Close playback"
          >
            <Icon name="close" className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full rounded-full bg-primary transition-[width] duration-100')} style={{ width: `${progress}%` }} />
        </div>
      </div>
    </div>,
    document.body,
  );
};
