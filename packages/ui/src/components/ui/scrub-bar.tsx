import * as React from 'react';

import { cn } from '@/lib/utils';
import { formatPlaybackTime } from '@/lib/voice/timestamps';

type ScrubBarContextValue = {
  duration: number;
  value: number;
  onScrub?: (time: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
};

const ScrubBarContext = React.createContext<ScrubBarContextValue | null>(null);

const useScrubBarContext = () => {
  const context = React.useContext(ScrubBarContext);
  if (!context) {
    throw new Error('Scrub bar components must be used within ScrubBarContainer');
  }
  return context;
};

export const ScrubBarContainer = ({
  duration,
  value,
  onScrub,
  onScrubStart,
  onScrubEnd,
  className,
  children,
}: React.PropsWithChildren<{
  duration: number;
  value: number;
  onScrub?: (time: number) => void;
  onScrubStart?: () => void;
  onScrubEnd?: () => void;
  className?: string;
}>) => (
  <ScrubBarContext.Provider value={{ duration, value, onScrub, onScrubStart, onScrubEnd }}>
    <div className={cn('flex items-center gap-3', className)}>
      {children}
    </div>
  </ScrubBarContext.Provider>
);

export const ScrubBarTrack = ({
  className,
  children,
}: React.PropsWithChildren<{ className?: string }>) => {
  const { duration, value, onScrub, onScrubStart, onScrubEnd } = useScrubBarContext();

  return (
    <div className={cn('relative flex-1', className)}>
      <input
        type="range"
        min={0}
        max={Math.max(duration, 0.1)}
        step={0.01}
        value={Math.min(value, Math.max(duration, 0.1))}
        onMouseDown={() => onScrubStart?.()}
        onTouchStart={() => onScrubStart?.()}
        onChange={(event) => onScrub?.(Number.parseFloat(event.target.value))}
        onMouseUp={() => onScrubEnd?.()}
        onTouchEnd={() => onScrubEnd?.()}
        className={cn(
          'absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none bg-transparent',
          '[&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-transparent',
          '[&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:appearance-none [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-none [&::-moz-range-thumb]:bg-transparent',
        )}
        aria-label="Playback progress"
      />
      <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
        {children}
      </div>
    </div>
  );
};

export const ScrubBarProgress = ({ className }: { className?: string }) => {
  const { duration, value } = useScrubBarContext();
  const percentage = duration > 0 ? Math.min(100, (value / duration) * 100) : 0;

  return (
    <div
      className={cn('h-full rounded-full bg-primary transition-[width] duration-75', className)}
      style={{ width: `${percentage}%` }}
    />
  );
};

export const ScrubBarThumb = ({ className }: { className?: string }) => {
  const { duration, value } = useScrubBarContext();
  const percentage = duration > 0 ? Math.min(100, (value / duration) * 100) : 0;

  return (
    <div
      className={cn(
        'pointer-events-none absolute top-1/2 z-20 h-3.5 w-3.5 -translate-y-1/2 rounded-full border border-background bg-primary shadow-sm',
        className,
      )}
      style={{ left: `calc(${percentage}% - 7px)` }}
    />
  );
};

export const ScrubBarTimeLabel = ({
  time,
  className,
  format = formatPlaybackTime,
}: {
  time: number;
  className?: string;
  format?: (time: number) => string;
}) => (
  <span className={cn('typography-mono text-xs text-muted-foreground', className)}>
    {format(time)}
  </span>
);
