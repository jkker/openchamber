/* eslint-disable react-refresh/only-export-components */
import * as React from 'react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/icon/Icon';
import { ScrubBarContainer, ScrubBarProgress, ScrubBarThumb, ScrubBarTimeLabel, ScrubBarTrack } from '@/components/ui/scrub-bar';

type AudioPlayerContextValue = {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  isBuffering: boolean;
  playbackRate: number;
  play: () => Promise<void>;
  pause: () => void;
  seek: (time: number) => void;
  setPlaybackRate: (rate: number) => void;
};

const AudioPlayerContext = React.createContext<AudioPlayerContextValue | null>(null);

export const useAudioPlayer = () => {
  const context = React.useContext(AudioPlayerContext);
  if (!context) {
    throw new Error('Audio player components must be used within AudioPlayerProvider');
  }
  return context;
};

export const useAudioPlayerTime = () => useAudioPlayer().currentTime;

export const AudioPlayerProvider = ({
  src,
  type = 'audio/mpeg',
  autoPlayNonce = 0,
  playbackRate = 1,
  onBeforePlay,
  onEnded,
  children,
}: React.PropsWithChildren<{
  src: string | null;
  type?: string;
  autoPlayNonce?: number;
  playbackRate?: number;
  onBeforePlay?: () => void;
  onEnded?: () => void;
}>) => {
  const audioRef = React.useRef<HTMLAudioElement | null>(null);
  const [duration, setDuration] = React.useState(0);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [isBuffering, setIsBuffering] = React.useState(false);
  const [rate, setRate] = React.useState(playbackRate);
  const animationFrameRef = React.useRef<number | null>(null);

  const cancelFrame = React.useCallback(() => {
    if (animationFrameRef.current !== null && typeof window !== 'undefined') {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  }, []);

  const updateCurrentTime = React.useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    if (!audio.paused) {
      animationFrameRef.current = window.requestAnimationFrame(updateCurrentTime);
    }
  }, []);

  const pause = React.useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setIsPlaying(false);
    cancelFrame();
  }, [cancelFrame]);

  const play = React.useCallback(async () => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    onBeforePlay?.();
    await audio.play();
    setIsPlaying(true);
    cancelFrame();
    animationFrameRef.current = window.requestAnimationFrame(updateCurrentTime);
  }, [cancelFrame, onBeforePlay, src, updateCurrentTime]);

  const seek = React.useCallback((time: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(time, duration || time));
    setCurrentTime(audio.currentTime);
  }, [duration]);

  const setPlaybackRate = React.useCallback((nextRate: number) => {
    const clampedRate = Math.max(0.5, Math.min(2, nextRate));
    setRate(clampedRate);
    if (audioRef.current) {
      audioRef.current.playbackRate = clampedRate;
    }
  }, []);

  React.useEffect(() => {
    setPlaybackRate(playbackRate);
  }, [playbackRate, setPlaybackRate]);

  React.useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.load();
    setCurrentTime(0);
    setDuration(0);
    setIsPlaying(false);
    cancelFrame();
  }, [cancelFrame, src, type]);

  React.useEffect(() => {
    if (!src || autoPlayNonce <= 0) {
      return;
    }

    const audio = audioRef.current;
    if (!audio) return;

    const tryPlay = () => {
      void play().catch(() => {
        setIsPlaying(false);
      });
    };

    if (audio.readyState >= 2) {
      tryPlay();
      return;
    }

    audio.addEventListener('canplay', tryPlay, { once: true });
    return () => audio.removeEventListener('canplay', tryPlay);
  }, [autoPlayNonce, play, src]);

  React.useEffect(() => () => cancelFrame(), [cancelFrame]);

  const value = React.useMemo<AudioPlayerContextValue>(() => ({
    audioRef,
    duration,
    currentTime,
    isPlaying,
    isBuffering,
    playbackRate: rate,
    play,
    pause,
    seek,
    setPlaybackRate,
  }), [currentTime, duration, isBuffering, isPlaying, pause, play, rate, seek, setPlaybackRate]);

  return (
    <AudioPlayerContext.Provider value={value}>
      <audio
        ref={audioRef}
        preload="auto"
        onLoadedMetadata={(event) => {
          setDuration(event.currentTarget.duration || 0);
          event.currentTarget.playbackRate = rate;
        }}
        onPlay={() => {
          setIsPlaying(true);
          cancelFrame();
          animationFrameRef.current = window.requestAnimationFrame(updateCurrentTime);
        }}
        onPause={() => {
          setIsPlaying(false);
          cancelFrame();
        }}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onEnded={() => {
          setIsPlaying(false);
          cancelFrame();
          setCurrentTime(0);
          onEnded?.();
        }}
        className="sr-only"
      >
        {src ? <source src={src} type={type} /> : null}
      </audio>
      {children}
    </AudioPlayerContext.Provider>
  );
};

export const AudioPlayerButton = ({
  className,
  ...props
}: React.ComponentProps<typeof Button>) => {
  const { isBuffering, isPlaying, pause, play } = useAudioPlayer();

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('h-9 w-9 rounded-full', className)}
      onClick={() => {
        if (isPlaying) {
          pause();
          return;
        }
        void play();
      }}
      {...props}
    >
      {isBuffering ? (
        <Icon name="loader-4" className="h-4 w-4 animate-spin" />
      ) : isPlaying ? (
        <Icon name="pause-large" className="h-4 w-4" />
      ) : (
        <Icon name="play-large-fill" className="h-4 w-4" />
      )}
    </Button>
  );
};

export const AudioPlayerProgress = ({ className }: { className?: string }) => {
  const { currentTime, duration, seek } = useAudioPlayer();

  return (
    <ScrubBarContainer duration={duration} value={currentTime} onScrub={seek} className={className}>
      <ScrubBarTrack>
        <ScrubBarProgress />
        <ScrubBarThumb />
      </ScrubBarTrack>
    </ScrubBarContainer>
  );
};

export const AudioPlayerTime = ({ className }: { className?: string }) => {
  const { currentTime } = useAudioPlayer();
  return <ScrubBarTimeLabel time={currentTime} className={className} />;
};

export const AudioPlayerDuration = ({ className }: { className?: string }) => {
  const { duration } = useAudioPlayer();
  return <ScrubBarTimeLabel time={duration} className={className} />;
};

export const AudioPlayerSpeedButtonGroup = ({
  speeds = [0.75, 1, 1.25, 1.5],
  className,
}: {
  speeds?: readonly number[];
  className?: string;
}) => {
  const { playbackRate, setPlaybackRate } = useAudioPlayer();

  return (
    <div className={cn('flex items-center gap-1 rounded-full border border-[var(--interactive-border)] bg-background/80 p-1', className)}>
      {speeds.map((speed) => (
        <Button
          key={speed}
          type="button"
          variant={playbackRate === speed ? 'secondary' : 'ghost'}
          size="xs"
          className="rounded-full px-2.5"
          onClick={() => setPlaybackRate(speed)}
        >
          {speed === 1 ? '1x' : `${speed}x`}
        </Button>
      ))}
    </div>
  );
};
