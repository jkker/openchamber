import * as React from 'react';

import type { SpeechPlaybackItem } from '@/lib/voice/speechPlayback';

export type SpeechPlaybackContextValue = {
  activeItem: SpeechPlaybackItem | null;
  panelState: 'closed' | 'expanded' | 'collapsed';
  isPlaying: boolean;
  isGenerating: boolean;
  activeMessageId: string | null;
  queue: SpeechPlaybackItem[];
  openMessage: (item: SpeechPlaybackItem) => void;
  play: () => Promise<void>;
  pause: () => void;
  close: () => void;
  collapse: () => void;
  expand: () => void;
  seekBy: (seconds: number) => void;
  playAdjacent: (direction: -1 | 1) => void;
};

export const SpeechPlaybackContext = React.createContext<SpeechPlaybackContextValue | null>(null);

export const useSpeechPlayback = () => {
  const context = React.useContext(SpeechPlaybackContext);
  if (!context) {
    throw new Error('useSpeechPlayback must be used within SpeechPlaybackProvider');
  }
  return context;
};
