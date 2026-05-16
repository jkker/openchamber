/**
 * useMessageTTS Hook
 * 
 * Hook for playing TTS on individual messages.
 * Uses the configured voice provider (browser, edge-tts, speech-sdk, openai-compatible, or macOS Say).
 */

import { useCallback, useState } from 'react';
import { useConfigStore } from '@/stores/useConfigStore';
import { useServerTTS } from './useServerTTS';
import { useSayTTS } from './useSayTTS';
import { browserVoiceService } from '@/lib/voice/browserVoiceService';
import { summarizeText, shouldSummarize, sanitizeForTTS } from '@/lib/voice/summarize';

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
    const voiceProvider = useConfigStore((state) => state.voiceProvider);
    const speechRate = useConfigStore((state) => state.speechRate);
    const speechPitch = useConfigStore((state) => state.speechPitch);
    const speechVolume = useConfigStore((state) => state.speechVolume);
    const sayVoice = useConfigStore((state) => state.sayVoice);
    const browserVoice = useConfigStore((state) => state.browserVoice);
    // New provider-agnostic fields
    const ttsVoice = useConfigStore((state) => state.ttsVoice);
    const ttsModel = useConfigStore((state) => state.ttsModel);
    const ttsSpeechSdkProvider = useConfigStore((state) => state.ttsSpeechSdkProvider);
    const ttsBaseURL = useConfigStore((state) => state.ttsBaseURL);
    const ttsApiKey = useConfigStore((state) => state.ttsApiKey);
    const ttsTimestampsEnabled = useConfigStore((state) => state.ttsTimestampsEnabled);
    // Legacy fields (backward compat for openai/openai-compatible voiceProvider)
    const openaiVoice = useConfigStore((state) => state.openaiVoice);
    const openaiCompatibleVoice = useConfigStore((state) => state.openaiCompatibleVoice);
    const openaiCompatibleUrl = useConfigStore((state) => state.openaiCompatibleUrl);
    const openaiCompatibleTtsModel = useConfigStore((state) => state.openaiCompatibleTtsModel);
    const summarizeMessageTTS = useConfigStore((state) => state.summarizeMessageTTS);
    const summarizeCharacterThreshold = useConfigStore((state) => state.summarizeCharacterThreshold);
    const showMessageTTSButtons = useConfigStore((state) => state.showMessageTTSButtons);

    // Resolve the effective provider (prefer new ttsProvider, fall back to legacy voiceProvider migration)
    const effectiveProvider = ttsProvider !== 'browser' ? ttsProvider : voiceProvider === 'say' ? 'say' : ttsProvider;

    const isServerProvider = effectiveProvider !== 'browser' && effectiveProvider !== 'say';
    const shouldCheckServerAvailability = showMessageTTSButtons && isServerProvider;
    const shouldCheckSayAvailability = showMessageTTSButtons && effectiveProvider === 'say';

    const { speak: speakServerTTS, stop: stopServerTTS, isAvailable: isServerTTSAvailable } = useServerTTS({
        enabled: shouldCheckServerAvailability,
        availabilityMode: effectiveProvider === 'openai-compatible' ? 'openai-compatible' : 'auto',
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
        
        stop();
        setIsPlaying(true);
        
        try {
            let textToSpeak = text;
            if (summarizeMessageTTS && shouldSummarize(text, 'message')) {
                textToSpeak = await summarizeText(text, {
                    threshold: summarizeCharacterThreshold,
                });
            } else {
                textToSpeak = sanitizeForTTS(text);
            }
            
            if (isServerProvider && isServerTTSAvailable) {
                // Resolve voice, model, and baseURL from new provider-agnostic fields
                let resolvedVoice = ttsVoice;
                let resolvedModel = ttsModel || undefined;
                let resolvedBaseURL: string | undefined;

                // Backward-compat: if no new ttsVoice set, fall back to legacy fields
                if (!resolvedVoice) {
                    if (effectiveProvider === 'openai-compatible' || voiceProvider === 'openai-compatible') {
                        resolvedVoice = openaiCompatibleVoice;
                        if (!resolvedModel) resolvedModel = openaiCompatibleTtsModel || undefined;
                    } else if (voiceProvider === 'openai') {
                        resolvedVoice = openaiVoice;
                    }
                }
                if (effectiveProvider === 'openai-compatible' && !ttsBaseURL) {
                    resolvedBaseURL = openaiCompatibleUrl || undefined;
                } else if (ttsBaseURL) {
                    resolvedBaseURL = ttsBaseURL;
                }

                await speakServerTTS(textToSpeak, {
                    provider: effectiveProvider,
                    sdkProvider: effectiveProvider === 'speech-sdk' ? ttsSpeechSdkProvider : undefined,
                    voice: resolvedVoice || undefined,
                    model: resolvedModel,
                    speed: speechRate,
                    pitch: speechPitch,
                    volume: speechVolume,
                    timestamps: ttsTimestampsEnabled,
                    summarize: false, // We already summarized client-side
                    baseURL: resolvedBaseURL,
                    apiKey: ttsApiKey || undefined,
                    onEnd: () => setIsPlaying(false),
                    onError: () => setIsPlaying(false),
                });
            } else if (effectiveProvider === 'say' && isSayTTSAvailable) {
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
        effectiveProvider,
        voiceProvider,
        isServerProvider,
        speechRate,
        speechPitch,
        speechVolume,
        sayVoice,
        browserVoice,
        ttsVoice,
        ttsModel,
        ttsSpeechSdkProvider,
        ttsBaseURL,
        ttsApiKey,
        ttsTimestampsEnabled,
        openaiVoice,
        openaiCompatibleVoice,
        openaiCompatibleUrl,
        openaiCompatibleTtsModel,
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
