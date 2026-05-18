/**
 * useMessageTTS Hook
 * 
 * Hook for playing TTS on individual messages.
 * Uses the configured voice provider (browser, OpenAI, or macOS Say).
 */

import { useCallback, useState } from 'react';
import { useConfigStore } from '@/stores/useConfigStore';
import { useServerTTS } from './useServerTTS';
import { useSayTTS } from './useSayTTS';
import { browserVoiceService } from '@/lib/voice/browserVoiceService';
import { summarizeText, shouldSummarize, sanitizeForTTS } from '@/lib/voice/summarize';
import { isServerTtsProvider } from '@/lib/voice/ttsConfig';

export interface UseMessageTTSReturn {
    /** Whether TTS is currently playing for this message */
    isPlaying: boolean;
    /** Play the message text */
    play: (text: string) => Promise<void>;
    /** Stop playback */
    stop: () => void;
}

export function useMessageTTS(): UseMessageTTSReturn {
    const [isPlaying, setIsPlaying] = useState(false);
    
    const ttsProvider = useConfigStore((state) => state.ttsProvider);
    const ttsSpeechSdkProvider = useConfigStore((state) => state.ttsSpeechSdkProvider);
    const ttsModel = useConfigStore((state) => state.ttsModel);
    const ttsVoice = useConfigStore((state) => state.ttsVoice);
    const ttsBaseURL = useConfigStore((state) => state.ttsBaseURL);
    const ttsApiKeyMode = useConfigStore((state) => state.ttsApiKeyMode);
    const ttsTimestampsEnabled = useConfigStore((state) => state.ttsTimestampsEnabled);
    const ttsRate = useConfigStore((state) => state.ttsRate);
    const ttsPitch = useConfigStore((state) => state.ttsPitch);
    const ttsVolume = useConfigStore((state) => state.ttsVolume);
    const speechRate = useConfigStore((state) => state.speechRate);
    const speechPitch = useConfigStore((state) => state.speechPitch);
    const speechVolume = useConfigStore((state) => state.speechVolume);
    const sayVoice = useConfigStore((state) => state.sayVoice);
    const browserVoice = useConfigStore((state) => state.browserVoice);
    const summarizeMessageTTS = useConfigStore((state) => state.summarizeMessageTTS);
    const summarizeCharacterThreshold = useConfigStore((state) => state.summarizeCharacterThreshold);
    const showMessageTTSButtons = useConfigStore((state) => state.showMessageTTSButtons);

    const isServerProvider = isServerTtsProvider(ttsProvider);
    const shouldCheckOpenAIAvailability = showMessageTTSButtons && isServerProvider;
    const shouldCheckSayAvailability = showMessageTTSButtons && ttsProvider === 'say';

    const { speak: speakServerTTS, stop: stopServerTTS, isAvailable: isServerTTSAvailable } = useServerTTS({
        enabled: shouldCheckOpenAIAvailability,
        availabilityMode: isServerTtsProvider(ttsProvider) ? ttsProvider : 'auto',
    });
    const { speak: speakSayTTS, stop: stopSayTTS, isAvailable: isSayTTSAvailable } = useSayTTS({
        enabled: shouldCheckSayAvailability,
    });
    
    const stop = useCallback(() => {
        setIsPlaying(false);
        stopServerTTS();
        stopSayTTS();
        browserVoiceService.cancelSpeech();
    }, [stopServerTTS, stopSayTTS]);
    
    const play = useCallback(async (text: string) => {
        if (!text.trim()) return;
        
        // Stop any existing playback
        stop();
        
        setIsPlaying(true);
        
        try {
            // Summarize text if enabled and over threshold
            let textToSpeak = text;
            if (summarizeMessageTTS && shouldSummarize(text, 'message')) {
                textToSpeak = await summarizeText(text, {
                    threshold: summarizeCharacterThreshold,
                });
            } else {
                // Still sanitize for TTS even when not summarizing
                textToSpeak = sanitizeForTTS(text);
            }
            
            if (isServerProvider && isServerTTSAvailable) {
                await speakServerTTS(textToSpeak, {
                    provider: ttsProvider,
                    speechSdkProvider: ttsSpeechSdkProvider,
                    voice: ttsVoice,
                    model: ttsModel,
                    speed: ttsRate || speechRate,
                    pitch: ttsPitch || speechPitch,
                    volume: ttsVolume || speechVolume,
                    summarize: false, // We already summarized client-side
                    baseURL: ttsBaseURL || undefined,
                    apiKeyMode: ttsApiKeyMode,
                    timestamps: ttsTimestampsEnabled,
                    onEnd: () => setIsPlaying(false),
                    onError: () => setIsPlaying(false),
                });
            } else if (ttsProvider === 'say' && isSayTTSAvailable) {
                const wordsPerMinute = Math.round(100 + (speechRate - 0.5) * 200);
                await speakSayTTS(textToSpeak, {
                    voice: sayVoice,
                    rate: wordsPerMinute,
                    onEnd: () => setIsPlaying(false),
                    onError: () => setIsPlaying(false),
                });
            } else {
                // Browser TTS
                await browserVoiceService.waitForVoices();
                await browserVoiceService.resumeAudioContext();
                await browserVoiceService.speakText(
                    textToSpeak,
                    navigator.language || 'en-US',
                    () => setIsPlaying(false),
                    {
                        rate: speechRate,
                        pitch: speechPitch,
                        volume: speechVolume,
                        voiceName: browserVoice || undefined,
                    }
                );
            }
        } catch (err) {
            console.error('[useMessageTTS] Playback error:', err);
            setIsPlaying(false);
        }
    }, [
        ttsProvider,
        ttsSpeechSdkProvider,
        ttsModel,
        ttsVoice,
        ttsBaseURL,
        ttsApiKeyMode,
        ttsTimestampsEnabled,
        ttsRate,
        ttsPitch,
        ttsVolume,
        isServerProvider,
        speechRate,
        speechPitch,
        speechVolume,
        sayVoice,
        browserVoice,
        summarizeMessageTTS,
        summarizeCharacterThreshold,
        isServerTTSAvailable,
        isSayTTSAvailable,
        speakServerTTS,
        speakSayTTS,
        stop,
    ]);
    
    return {
        isPlaying,
        play,
        stop,
    };
}
