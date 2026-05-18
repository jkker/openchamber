import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { cn } from '@/lib/utils';

export type VoiceButtonState = 'idle' | 'recording' | 'processing' | 'success' | 'error';

const Waveform = ({ className }: { className?: string }) => (
  <span className={cn('flex items-center gap-0.5', className)} aria-hidden="true">
    {[0, 1, 2, 3].map((index) => (
      <span
        key={index}
        className="h-3 w-1 rounded-full bg-current opacity-80 animate-pulse"
        style={{ animationDelay: `${index * 120}ms` }}
      />
    ))}
  </span>
);

export const VoiceButton = ({
  state = 'idle',
  label,
  trailing,
  icon,
  size = 'default',
  className,
  waveformClassName,
  onPress,
  ...props
}: Omit<React.ComponentProps<typeof Button>, 'onClick'> & {
  state?: VoiceButtonState;
  label?: React.ReactNode;
  trailing?: React.ReactNode;
  icon?: React.ReactNode;
  waveformClassName?: string;
  onPress?: () => void;
}) => {
  const stateIcon = state === 'processing'
    ? <Icon name="loader-4" className="h-4 w-4 animate-spin" />
    : state === 'success'
      ? <Icon name="check" className="h-4 w-4" />
      : state === 'error'
        ? <Icon name="close" className="h-4 w-4" />
        : icon ?? <Icon name="microphone-line" className="h-4 w-4" />;

  return (
    <Button
      type="button"
      variant={state === 'error' ? 'destructive' : state === 'recording' ? 'secondary' : 'outline'}
      size={size}
      className={cn(
        'gap-2 rounded-full',
        state === 'recording' && 'border-primary/50 bg-primary/10 text-foreground',
        className,
      )}
      onClick={onPress}
      {...props}
    >
      {state === 'recording' ? <Waveform className={waveformClassName} /> : stateIcon}
      {size !== 'icon' ? (
        <>
          <span>{label}</span>
          {trailing ? <span className="text-muted-foreground">{trailing}</span> : null}
        </>
      ) : null}
    </Button>
  );
};
