import { create } from 'zustand';

import type { SpeechPlaybackItem } from '@/lib/voice/speechPlayback';
import type { WordTimestamp } from '@/lib/voice/timestamps';

export type PlaybackPanelState = 'closed' | 'expanded' | 'collapsed';
export type PlaybackTextMode = 'summary' | 'original';

export interface SpeechPlaybackFloatingPosition {
  x: number;
  y: number;
}

interface SpeechPlaybackStore {
  panelState: PlaybackPanelState;
  activeItem: SpeechPlaybackItem | null;
  queue: SpeechPlaybackItem[];
  textMode: PlaybackTextMode;
  autoPlayNonce: number;
  audioUrl: string | null;
  contentType: string | null;
  transcriptText: string;
  timestamps: WordTimestamp[] | null;
  alignmentEstimated: boolean;
  providerLabel: string;
  modelLabel: string;
  voiceLabel: string;
  warningLabel: string | null;
  isGenerating: boolean;
  error: string | null;
  floatingPosition: SpeechPlaybackFloatingPosition | null;
  setQueue: (queue: SpeechPlaybackItem[]) => void;
  openForItem: (item: SpeechPlaybackItem, autoPlay?: boolean) => void;
  closePanel: () => void;
  collapsePanel: () => void;
  expandPanel: () => void;
  setTextMode: (mode: PlaybackTextMode) => void;
  setGenerating: (isGenerating: boolean) => void;
  setError: (error: string | null) => void;
  setPlaybackResource: (resource: {
    audioUrl: string | null;
    contentType: string | null;
    transcriptText: string;
    timestamps: WordTimestamp[] | null;
    alignmentEstimated: boolean;
    providerLabel: string;
    modelLabel: string;
    voiceLabel: string;
    warningLabel?: string | null;
  }) => void;
  clearPlaybackResource: () => void;
  setFloatingPosition: (position: SpeechPlaybackFloatingPosition) => void;
}

const EMPTY_RESOURCE = {
  audioUrl: null,
  contentType: null,
  transcriptText: '',
  timestamps: null,
  alignmentEstimated: false,
  providerLabel: '',
  modelLabel: '',
  voiceLabel: '',
  warningLabel: null,
} as const;

export const useSpeechPlaybackStore = create<SpeechPlaybackStore>()((set, get) => ({
  panelState: 'closed',
  activeItem: null,
  queue: [],
  textMode: 'summary',
  autoPlayNonce: 0,
  ...EMPTY_RESOURCE,
  isGenerating: false,
  error: null,
  floatingPosition: null,
  setQueue: (queue) => {
    const speakableQueue = queue.filter((item) => item.originalText.trim().length > 0);
    const activeMessageId = get().activeItem?.messageId;
    const nextActiveItem = activeMessageId
      ? speakableQueue.find((item) => item.messageId === activeMessageId) ?? null
      : null;

    set({
      queue: speakableQueue,
      activeItem: nextActiveItem,
      ...(nextActiveItem ? {} : { panelState: 'closed', ...EMPTY_RESOURCE }),
    });
  },
  openForItem: (item, autoPlay = true) => {
    set((state) => ({
      panelState: 'expanded',
      activeItem: item,
      autoPlayNonce: autoPlay ? state.autoPlayNonce + 1 : state.autoPlayNonce,
      error: null,
    }));
  },
  closePanel: () => {
    set({
      panelState: 'closed',
      activeItem: null,
      isGenerating: false,
      error: null,
      ...EMPTY_RESOURCE,
    });
  },
  collapsePanel: () => set((state) => state.activeItem ? { panelState: 'collapsed' } : state),
  expandPanel: () => set((state) => state.activeItem ? { panelState: 'expanded' } : state),
  setTextMode: (mode) => set({ textMode: mode }),
  setGenerating: (isGenerating) => set({ isGenerating }),
  setError: (error) => set({ error }),
  setPlaybackResource: (resource) => set({
    audioUrl: resource.audioUrl,
    contentType: resource.contentType,
    transcriptText: resource.transcriptText,
    timestamps: resource.timestamps,
    alignmentEstimated: resource.alignmentEstimated,
    providerLabel: resource.providerLabel,
    modelLabel: resource.modelLabel,
    voiceLabel: resource.voiceLabel,
    warningLabel: resource.warningLabel ?? null,
    error: null,
  }),
  clearPlaybackResource: () => set({ ...EMPTY_RESOURCE, isGenerating: false, error: null }),
  setFloatingPosition: (floatingPosition) => set({ floatingPosition }),
}));
