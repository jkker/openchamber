import * as React from 'react';

import { createPortal } from 'react-dom';

import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import { AudioPlayerSpeedButtonGroup } from '@/components/ui/audio-player';
import { TranscriptViewerPlayPauseButton, TranscriptViewerScrubBar, TranscriptViewerWords } from '@/components/ui/transcript-viewer';
import { VoiceButton, type VoiceButtonState } from '@/components/ui/voice-button';
import { cn } from '@/lib/utils';
import type { SpeechPlaybackItem } from '@/lib/voice/speechPlayback';

const PlaybackPanelInner = React.memo(({
  activeItem,
  providerLabel,
  modelLabel,
  voiceLabel,
  warningLabel,
  textMode,
  setTextMode,
  isGenerating,
  error,
  queue,
  onClose,
  onCollapse,
  onPrevious,
  onNext,
  onRewind,
  onForward,
  dictationButtonState,
  onDictationPress,
  onDictationStop,
  canTranscribeOnStop,
}: {
  activeItem: SpeechPlaybackItem;
  providerLabel: string;
  modelLabel: string;
  voiceLabel: string;
  warningLabel: string | null;
  textMode: 'summary' | 'original';
  setTextMode: (mode: 'summary' | 'original') => void;
  isGenerating: boolean;
  error: string | null;
  queue: SpeechPlaybackItem[];
  onClose: () => void;
  onCollapse: () => void;
  onPrevious: () => void;
  onNext: () => void;
  onRewind: () => void;
  onForward: () => void;
  dictationButtonState: VoiceButtonState;
  onDictationPress: () => void;
  onDictationStop: () => void;
  canTranscribeOnStop: boolean;
}) => {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const isBrowser = typeof window !== 'undefined' && typeof document !== 'undefined';
  const isMobile = isBrowser && window.matchMedia('(max-width: 767px)').matches;
  const currentIndex = queue.findIndex((item) => item.messageId === activeItem.messageId);
  const previewText = activeItem.originalText.length > 180
    ? `${activeItem.originalText.slice(0, 177)}...`
    : activeItem.originalText;

  React.useEffect(() => {
    if (!isBrowser) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      if (!panelRef.current) return;
      if (panelRef.current.contains(event.target as Node)) {
        return;
      }
      onCollapse();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [isBrowser, onCollapse]);

  if (!isBrowser) {
    return null;
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] pointer-events-none">
      <div
        ref={panelRef}
        className={cn(
          'pointer-events-auto fixed w-[min(42rem,calc(100vw-1.5rem))] rounded-3xl border border-[var(--interactive-border)] bg-background/95 shadow-2xl backdrop-blur-xl',
          isMobile ? 'inset-x-3 bottom-3 max-h-[82vh] overflow-hidden' : 'left-1/2 top-6 max-h-[min(80vh,44rem)] -translate-x-1/2 overflow-hidden',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-[var(--interactive-border)] px-5 py-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="rounded-full border border-[var(--interactive-border)] px-2 py-0.5 typography-meta text-muted-foreground">
                {currentIndex + 1} / {queue.length}
              </span>
              <span className="typography-meta text-muted-foreground">{providerLabel}{modelLabel ? ` · ${modelLabel}` : ''}{voiceLabel ? ` · ${voiceLabel}` : ''}</span>
            </div>
            <p className="mt-2 typography-ui-label text-foreground line-clamp-2">{previewText}</p>
            {warningLabel ? <p className="mt-1 typography-meta text-muted-foreground">{warningLabel}</p> : null}
          </div>
          <div className="flex items-center gap-1">
            <Button type="button" variant="ghost" size="icon" onClick={onCollapse} aria-label="Collapse playback">
              <Icon name="subtract-line" className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label="Close playback">
              <Icon name="close" className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="inline-flex rounded-full border border-[var(--interactive-border)] bg-background/70 p-1">
              <Button
                type="button"
                size="xs"
                variant={textMode === 'summary' ? 'secondary' : 'ghost'}
                className="rounded-full"
                onClick={() => setTextMode('summary')}
              >
                Summary
              </Button>
              <Button
                type="button"
                size="xs"
                variant={textMode === 'original' ? 'secondary' : 'ghost'}
                className="rounded-full"
                onClick={() => setTextMode('original')}
              >
                Original
              </Button>
            </div>
            {isGenerating ? <span className="typography-meta text-muted-foreground">Preparing playback…</span> : null}
          </div>

          {error ? (
            <div className="rounded-2xl border border-[var(--status-error)]/30 bg-[var(--status-error)]/5 px-4 py-3 typography-meta text-[var(--status-error)]">
              {error}
            </div>
          ) : null}

          <TranscriptViewerWords />

          <TranscriptViewerScrubBar />

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="ghost" size="icon" onClick={onPrevious} disabled={currentIndex <= 0} aria-label="Previous message">
              <Icon name="skip-back-mini-fill" className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onRewind} aria-label="Rewind 10 seconds">
              <Icon name="rewind-mini-fill" className="h-4 w-4" />
            </Button>
            <TranscriptViewerPlayPauseButton className="rounded-full px-4">
              {({ isPlaying }) => (
                <>
                  <Icon name={isPlaying ? 'pause-large-fill' : 'play-large-fill'} className="mr-2 h-4 w-4" />
                  {isPlaying ? 'Pause' : 'Play'}
                </>
              )}
            </TranscriptViewerPlayPauseButton>
            <Button type="button" variant="ghost" size="icon" onClick={onForward} aria-label="Forward 10 seconds">
              <Icon name="speed-up-fill" className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon" onClick={onNext} disabled={currentIndex >= queue.length - 1} aria-label="Next message">
              <Icon name="skip-forward-mini-fill" className="h-4 w-4" />
            </Button>
            <div className="ml-auto flex items-center gap-2">
              <VoiceButton
                state={dictationButtonState}
                label={dictationButtonState === 'recording' ? (canTranscribeOnStop ? 'Finish dictation' : 'Listening') : 'Dictate'}
                trailing={dictationButtonState === 'idle' ? 'Mic' : undefined}
                onPress={onDictationPress}
                className="min-w-[9.5rem]"
              />
              {dictationButtonState !== 'idle' ? (
                <Button type="button" variant="ghost" size="icon" onClick={onDictationStop} aria-label="Stop dictation">
                  <Icon name="stop-circle-line" className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          </div>

          <AudioPlayerSpeedButtonGroup className="self-start" />
        </div>
      </div>
    </div>,
    document.body,
  );
});

PlaybackPanelInner.displayName = 'PlaybackPanelInner';

export const SpeechPlaybackPanel = PlaybackPanelInner;
