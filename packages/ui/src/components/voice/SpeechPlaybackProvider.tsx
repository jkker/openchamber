import * as React from 'react';

import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSessionMessageRecords } from '@/sync/sync-context';
import { useConfigStore } from '@/stores/useConfigStore';
import { useSpeechPlaybackStore } from '@/stores/useSpeechPlaybackStore';
import {
  buildSpeechPlaybackCacheKey,
  buildSpeechPlaybackConfigHash,
  getAdjacentPlaybackItem,
  type SpeechPlaybackItem,
} from '@/lib/voice/speechPlayback';
import {
  TranscriptViewerContainer,
  useTranscriptViewerContext,
} from '@/components/ui/transcript-viewer';
import { sanitizeForTTS, shouldSummarize, summarizeText } from '@/lib/voice/summarize';
import type { WordTimestamp } from '@/lib/voice/timestamps';
import { getTtsProviderLabel } from '@/lib/voice/ttsConfig';
import { useBrowserVoiceRuntime } from '@/hooks/useBrowserVoiceRuntime';
import { SpeechPlaybackContext, type SpeechPlaybackContextValue } from '@/hooks/useSpeechPlayback';
import { SpeechPlaybackPanel } from './SpeechPlaybackPanel';
import { SpeechPlaybackFloatingPill } from './SpeechPlaybackFloatingPill';
type SpeechPlaybackGeneratedResource = {
  audioUrl: string | null;
  contentType: string;
  transcriptText: string;
  timestamps: WordTimestamp[] | null;
  alignmentEstimated: boolean;
  providerLabel: string;
  modelLabel: string;
  voiceLabel: string;
  warningLabel: string | null;
};

type SpeechPlaybackPlayerSnapshot = {
  currentTime: number;
  duration: number;
  isPlaying: boolean;
};

const CACHE_LIMIT = 20;

const base64ToObjectUrl = (audioBase64: string, contentType: string) => {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return URL.createObjectURL(new Blob([bytes], { type: contentType }));
};

const clampCache = (cache: Map<string, SpeechPlaybackGeneratedResource>) => {
  while (cache.size > CACHE_LIMIT) {
    const firstKey = cache.keys().next().value;
    if (!firstKey) return;
    const entry = cache.get(firstKey);
    if (entry?.audioUrl) {
      URL.revokeObjectURL(entry.audioUrl);
    }
    cache.delete(firstKey);
  }
};

const buildAssistantPlaybackQueue = (records: ReturnType<typeof useSessionMessageRecords>): SpeechPlaybackItem[] => {
  const queue: SpeechPlaybackItem[] = [];

  for (const record of records) {
    if (record.info.role !== 'assistant') {
      continue;
    }

    const originalText = record.parts
      .filter((part) => part.type === 'text')
      .map((part) => ('text' in part && typeof part.text === 'string' ? part.text : ''))
      .join('');
    const normalizedText = sanitizeForTTS(originalText);

    if (!normalizedText.trim()) {
      continue;
    }

    queue.push({
      messageId: record.info.id,
      sessionId: record.info.sessionID,
      originalText: normalizedText,
      createdAt: record.info.time?.created,
    });
  }

  return queue;
};

const SpeechPlaybackBridge = ({
  onSnapshot,
  onControllerReady,
}: {
  onSnapshot: (snapshot: SpeechPlaybackPlayerSnapshot) => void;
  onControllerReady: (controller: Pick<ReturnType<typeof useTranscriptViewerContext>, 'play' | 'pause' | 'seek'> | null) => void;
}) => {
  const transcript = useTranscriptViewerContext();

  React.useEffect(() => {
    onControllerReady({
      play: transcript.play,
      pause: transcript.pause,
      seek: transcript.seek,
    });
    return () => onControllerReady(null);
  }, [onControllerReady, transcript.pause, transcript.play, transcript.seek]);

  React.useEffect(() => {
    onSnapshot({
      currentTime: transcript.currentTime,
      duration: transcript.duration,
      isPlaying: transcript.isPlaying,
    });
  }, [onSnapshot, transcript.currentTime, transcript.duration, transcript.isPlaying]);

  return null;
};

export const SpeechPlaybackProvider = ({ children }: { children: React.ReactNode }) => {
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const records = useSessionMessageRecords(currentSessionId ?? '');
  const queue = React.useMemo(() => buildAssistantPlaybackQueue(records), [records]);

  const activeItem = useSpeechPlaybackStore((state) => state.activeItem);
  const panelState = useSpeechPlaybackStore((state) => state.panelState);
  const textMode = useSpeechPlaybackStore((state) => state.textMode);
  const autoPlayNonce = useSpeechPlaybackStore((state) => state.autoPlayNonce);
  const audioUrl = useSpeechPlaybackStore((state) => state.audioUrl);
  const contentType = useSpeechPlaybackStore((state) => state.contentType);
  const transcriptText = useSpeechPlaybackStore((state) => state.transcriptText);
  const timestamps = useSpeechPlaybackStore((state) => state.timestamps);
  const alignmentEstimated = useSpeechPlaybackStore((state) => state.alignmentEstimated);
  const providerLabel = useSpeechPlaybackStore((state) => state.providerLabel);
  const modelLabel = useSpeechPlaybackStore((state) => state.modelLabel);
  const voiceLabel = useSpeechPlaybackStore((state) => state.voiceLabel);
  const warningLabel = useSpeechPlaybackStore((state) => state.warningLabel);
  const isGenerating = useSpeechPlaybackStore((state) => state.isGenerating);
  const error = useSpeechPlaybackStore((state) => state.error);
  const setQueue = useSpeechPlaybackStore((state) => state.setQueue);
  const openForItem = useSpeechPlaybackStore((state) => state.openForItem);
  const closePanel = useSpeechPlaybackStore((state) => state.closePanel);
  const collapsePanel = useSpeechPlaybackStore((state) => state.collapsePanel);
  const expandPanel = useSpeechPlaybackStore((state) => state.expandPanel);
  const setTextMode = useSpeechPlaybackStore((state) => state.setTextMode);
  const setGenerating = useSpeechPlaybackStore((state) => state.setGenerating);
  const setError = useSpeechPlaybackStore((state) => state.setError);
  const setPlaybackResource = useSpeechPlaybackStore((state) => state.setPlaybackResource);

  const ttsProvider = useConfigStore((state) => state.ttsProvider);
  const ttsSpeechSdkProvider = useConfigStore((state) => state.ttsSpeechSdkProvider);
  const ttsModel = useConfigStore((state) => state.ttsModel);
  const ttsVoice = useConfigStore((state) => state.ttsVoice);
  const ttsApiKey = useConfigStore((state) => state.ttsApiKey);
  const ttsApiKeyMode = useConfigStore((state) => state.ttsApiKeyMode);
  const ttsBaseURL = useConfigStore((state) => state.ttsBaseURL);
  const ttsTimestampsEnabled = useConfigStore((state) => state.ttsTimestampsEnabled);
  const ttsRate = useConfigStore((state) => state.ttsRate);
  const ttsPitch = useConfigStore((state) => state.ttsPitch);
  const ttsVolume = useConfigStore((state) => state.ttsVolume);
  const ttsProviderOptions = useConfigStore((state) => state.ttsProviderOptions);
  const summarizeMessageTTS = useConfigStore((state) => state.summarizeMessageTTS);
  const summarizeCharacterThreshold = useConfigStore((state) => state.summarizeCharacterThreshold);
  const summarizeMaxLength = useConfigStore((state) => state.summarizeMaxLength);
  const settingsZenModel = useConfigStore((state) => state.settingsZenModel);
  const sttProvider = useConfigStore((state) => state.sttProvider);
  const sttTranscribeOnStop = useConfigStore((state) => state.sttTranscribeOnStop);

  const voiceRuntime = useBrowserVoiceRuntime();
  const playerControllerRef = React.useRef<Pick<ReturnType<typeof useTranscriptViewerContext>, 'play' | 'pause' | 'seek'> | null>(null);
  const [playerSnapshot, setPlayerSnapshot] = React.useState<SpeechPlaybackPlayerSnapshot>({
    currentTime: 0,
    duration: 0,
    isPlaying: false,
  });
  const summaryCacheRef = React.useRef(new Map<string, string>());
  const playbackCacheRef = React.useRef(new Map<string, SpeechPlaybackGeneratedResource>());

  const configHash = React.useMemo(() => buildSpeechPlaybackConfigHash({
    provider: ttsProvider,
    speechSdkProvider: ttsSpeechSdkProvider,
    model: ttsModel,
    voice: ttsVoice,
    baseURL: ttsBaseURL,
    rate: ttsRate,
    pitch: ttsPitch,
    volume: ttsVolume,
    timestamps: ttsTimestampsEnabled,
  }), [ttsBaseURL, ttsModel, ttsPitch, ttsProvider, ttsRate, ttsSpeechSdkProvider, ttsTimestampsEnabled, ttsVoice, ttsVolume]);

  React.useEffect(() => {
    setQueue(queue);
  }, [queue, setQueue]);

  React.useEffect(() => () => {
    for (const entry of playbackCacheRef.current.values()) {
      if (entry.audioUrl) {
        URL.revokeObjectURL(entry.audioUrl);
      }
    }
    playbackCacheRef.current.clear();
  }, []);

  const canTranscribeOnStop = sttProvider === 'wasm' || (sttProvider === 'server' && sttTranscribeOnStop);

  const stopDictationIfNeeded = React.useCallback(() => {
    if (voiceRuntime.status === 'idle') return;
    voiceRuntime.stopVoice();
  }, [voiceRuntime]);

  const resolveTextForMode = React.useCallback(async (item: SpeechPlaybackItem, mode: 'summary' | 'original') => {
    if (mode === 'original') {
      return item.originalText;
    }

    if (!summarizeMessageTTS || !shouldSummarize(item.originalText, 'message')) {
      return item.originalText;
    }

    const cachedSummary = summaryCacheRef.current.get(item.messageId);
    if (cachedSummary) {
      return cachedSummary;
    }

    const summary = await summarizeText(item.originalText, {
      threshold: summarizeCharacterThreshold,
      maxLength: summarizeMaxLength,
    });

    summaryCacheRef.current.set(item.messageId, summary);
    return summary;
  }, [summarizeCharacterThreshold, summarizeMaxLength, summarizeMessageTTS]);

    const generatePlaybackResource = React.useCallback(async (
    item: SpeechPlaybackItem,
    mode: 'summary' | 'original',
  ): Promise<SpeechPlaybackGeneratedResource> => {
    const transcript = await resolveTextForMode(item, mode);
    const cacheKey = buildSpeechPlaybackCacheKey(item.messageId, mode, configHash);
    const cached = playbackCacheRef.current.get(cacheKey);
    if (cached) {
      return cached;
    }

    const response = await fetch('/api/tts/speak', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text: transcript,
        provider: ttsProvider === 'browser' ? 'edge-tts' : ttsProvider,
        speechSdkProvider: ttsSpeechSdkProvider,
        voice: ttsVoice,
        model: ttsModel,
        speed: ttsRate,
        pitch: ttsPitch,
        volume: ttsVolume,
        baseURL: ttsBaseURL || undefined,
        apiKeyMode: ttsApiKeyMode,
        apiKey: ttsApiKeyMode !== 'server' ? (ttsApiKey || undefined) : undefined,
        timestamps: ttsTimestampsEnabled,
        providerOptions: ttsProviderOptions,
        summarize: false,
        returnMetadata: true,
        ...(settingsZenModel ? { zenModel: settingsZenModel } : {}),
      }),
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
      throw new Error(errorPayload.error || `Failed to generate playback (${response.status})`);
    }

    const payload = await response.json() as {
      audioBase64: string;
      contentType: string;
      provider?: string;
      model?: string;
      voice?: string;
      timestamps?: WordTimestamp[];
      warnings?: string[];
    };

    const resource: SpeechPlaybackGeneratedResource = {
      audioUrl: base64ToObjectUrl(payload.audioBase64, payload.contentType),
      contentType: payload.contentType,
      transcriptText: transcript,
      timestamps: Array.isArray(payload.timestamps) ? payload.timestamps : null,
      alignmentEstimated: !Array.isArray(payload.timestamps) || payload.timestamps.length === 0,
      providerLabel: getTtsProviderLabel(payload.provider || ttsProvider),
      modelLabel: payload.model || ttsModel || '',
      voiceLabel: payload.voice || ttsVoice || '',
      warningLabel: payload.warnings?.[0]
        ?? (ttsProvider === 'browser'
          ? 'Seekable playback uses Edge TTS because browser speech synthesis does not expose audio timelines.'
          : null),
    };

    playbackCacheRef.current.set(cacheKey, resource);
    clampCache(playbackCacheRef.current);
    return resource;
  }, [configHash, resolveTextForMode, settingsZenModel, ttsApiKey, ttsApiKeyMode, ttsBaseURL, ttsModel, ttsPitch, ttsProvider, ttsProviderOptions, ttsRate, ttsSpeechSdkProvider, ttsTimestampsEnabled, ttsVoice, ttsVolume]);

  React.useEffect(() => {
    if (!activeItem || panelState === 'closed') {
      return;
    }

    let cancelled = false;
    setGenerating(true);
    setError(null);

    void generatePlaybackResource(activeItem, textMode)
      .then((resource) => {
        if (cancelled) return;
        setPlaybackResource(resource);
      })
      .catch((generationError) => {
        if (cancelled) return;
        setError(generationError instanceof Error ? generationError.message : 'Failed to prepare playback');
      })
      .finally(() => {
        if (!cancelled) {
          setGenerating(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeItem, generatePlaybackResource, panelState, setError, setGenerating, setPlaybackResource, textMode]);

  const play = React.useCallback(async () => {
    stopDictationIfNeeded();
    await playerControllerRef.current?.play();
  }, [stopDictationIfNeeded]);

  const pause = React.useCallback(() => {
    playerControllerRef.current?.pause();
  }, []);

  const close = React.useCallback(() => {
    pause();
    closePanel();
  }, [closePanel, pause]);

  const expand = React.useCallback(() => {
    expandPanel();
  }, [expandPanel]);

  const collapse = React.useCallback(() => {
    collapsePanel();
  }, [collapsePanel]);

  const seekBy = React.useCallback((seconds: number) => {
    if (!playerControllerRef.current) return;
    playerControllerRef.current.seek(playerSnapshot.currentTime + seconds);
  }, [playerSnapshot.currentTime]);

  const playAdjacent = React.useCallback((direction: -1 | 1) => {
    const nextItem = getAdjacentPlaybackItem(queue, activeItem?.messageId, direction);
    if (nextItem) {
      openForItem(nextItem, true);
    }
  }, [activeItem?.messageId, openForItem, queue]);

  const openMessage = React.useCallback((item: SpeechPlaybackItem) => {
    setTextMode(summarizeMessageTTS ? 'summary' : 'original');

    if (activeItem?.messageId === item.messageId) {
      if (playerSnapshot.isPlaying) {
        pause();
        expandPanel();
        return;
      }
      openForItem(item, true);
      return;
    }

    openForItem(item, true);
  }, [activeItem?.messageId, expandPanel, openForItem, pause, playerSnapshot.isPlaying, setTextMode, summarizeMessageTTS]);

  const handleBeforePlay = React.useCallback(() => {
    stopDictationIfNeeded();
  }, [stopDictationIfNeeded]);

  const dictationButtonState = voiceRuntime.status === 'listening'
    ? 'recording'
    : voiceRuntime.status === 'processing' || voiceRuntime.status === 'speaking'
      ? 'processing'
      : voiceRuntime.status === 'error'
        ? 'error'
        : 'idle';

  const handleDictationPress = React.useCallback(async () => {
    if (playerSnapshot.isPlaying) {
      pause();
    }

    if (voiceRuntime.status === 'listening' && canTranscribeOnStop) {
      voiceRuntime.finishVoiceInput();
      return;
    }

    if (voiceRuntime.status === 'idle' || voiceRuntime.status === 'error') {
      await voiceRuntime.startVoice();
      return;
    }

    voiceRuntime.stopVoice();
  }, [canTranscribeOnStop, pause, playerSnapshot.isPlaying, voiceRuntime]);

  const contextValue = React.useMemo<SpeechPlaybackContextValue>(() => ({
    activeItem,
    panelState,
    isPlaying: playerSnapshot.isPlaying,
    isGenerating,
    activeMessageId: activeItem?.messageId ?? null,
    queue,
    openMessage,
    play,
    pause,
    close,
    collapse,
    expand,
    seekBy,
    playAdjacent,
  }), [activeItem, close, collapse, expand, isGenerating, openMessage, panelState, pause, play, playAdjacent, playerSnapshot.isPlaying, queue, seekBy]);

  return (
    <SpeechPlaybackContext.Provider value={contextValue}>
      {children}
      {activeItem ? (
        <TranscriptViewerContainer
          key={`${activeItem.messageId}:${textMode}:${configHash}:${audioUrl ?? 'loading'}`}
          audioSrc={audioUrl}
          audioType={contentType || 'audio/mpeg'}
          transcriptText={transcriptText || activeItem.originalText}
          timestamps={timestamps}
          alignmentEstimated={alignmentEstimated}
          autoPlayNonce={autoPlayNonce}
          onBeforePlay={handleBeforePlay}
        >
          <SpeechPlaybackBridge
            onSnapshot={setPlayerSnapshot}
            onControllerReady={(controller) => {
              playerControllerRef.current = controller;
            }}
          />
          {panelState === 'expanded' ? (
            <SpeechPlaybackPanel
              activeItem={activeItem}
              providerLabel={providerLabel}
              modelLabel={modelLabel}
              voiceLabel={voiceLabel}
              warningLabel={warningLabel}
              textMode={textMode}
              setTextMode={setTextMode}
              isGenerating={isGenerating}
              error={error}
              queue={queue}
              onClose={close}
              onCollapse={collapse}
              onPrevious={() => playAdjacent(-1)}
              onNext={() => playAdjacent(1)}
              onRewind={() => seekBy(-10)}
              onForward={() => seekBy(10)}
              dictationButtonState={dictationButtonState}
              onDictationPress={() => { void handleDictationPress(); }}
              onDictationStop={voiceRuntime.stopVoice}
              canTranscribeOnStop={canTranscribeOnStop}
            />
          ) : null}
          {panelState === 'collapsed' ? (
            <SpeechPlaybackFloatingPill
              activeItem={activeItem}
              playerSnapshot={playerSnapshot}
              onExpand={expand}
              onClose={close}
              dictationButtonState={dictationButtonState}
              onDictationPress={() => { void handleDictationPress(); }}
              onDictationStop={voiceRuntime.stopVoice}
            />
          ) : null}
        </TranscriptViewerContainer>
      ) : null}
    </SpeechPlaybackContext.Provider>
  );
};
