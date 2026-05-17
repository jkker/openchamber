export type PlaybackTextMode = 'summary' | 'original';

export interface SpeechPlaybackItem {
  messageId: string;
  sessionId: string;
  originalText: string;
  summaryText?: string;
  createdAt?: number;
}

export interface SpeechPlaybackConfigSnapshot {
  provider: string;
  speechSdkProvider?: string;
  model?: string;
  voice?: string;
  baseURL?: string;
  rate?: number;
  pitch?: number;
  volume?: number;
  timestamps?: boolean;
}

export const buildSpeechPlaybackCacheKey = (
  messageId: string,
  textMode: PlaybackTextMode,
  configHash: string,
) => `${messageId}:${textMode}:${configHash}`;

export const buildSpeechPlaybackConfigHash = (
  config: SpeechPlaybackConfigSnapshot,
) => JSON.stringify({
  provider: config.provider,
  speechSdkProvider: config.speechSdkProvider ?? '',
  model: config.model ?? '',
  voice: config.voice ?? '',
  baseURL: config.baseURL ?? '',
  rate: config.rate ?? 1,
  pitch: config.pitch ?? 1,
  volume: config.volume ?? 1,
  timestamps: config.timestamps === true,
});

export const getSpeakablePlaybackItems = (
  items: SpeechPlaybackItem[],
): SpeechPlaybackItem[] => items.filter((item) => item.originalText.trim().length > 0);

export const getAdjacentPlaybackItem = (
  queue: SpeechPlaybackItem[],
  activeMessageId: string | null | undefined,
  direction: -1 | 1,
): SpeechPlaybackItem | null => {
  if (!activeMessageId) return null;
  const currentIndex = queue.findIndex((item) => item.messageId === activeMessageId);
  if (currentIndex < 0) return null;
  return queue[currentIndex + direction] ?? null;
};

export const getDictationPlaybackAction = (
  status: 'idle' | 'listening' | 'processing' | 'speaking' | 'error',
  canTranscribeOnStop: boolean,
): 'start-dictation' | 'finish-dictation' | 'stop-dictation' => {
  if (status === 'idle' || status === 'error') {
    return 'start-dictation';
  }

  if (status === 'listening' && canTranscribeOnStop) {
    return 'finish-dictation';
  }

  return 'stop-dictation';
};
