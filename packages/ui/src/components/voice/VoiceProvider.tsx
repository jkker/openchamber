import React from 'react';
import { useVoiceContext } from '@/hooks/useVoiceContext';
import { useConfigStore } from '@/stores/useConfigStore';
import { BrowserVoiceRuntimeProvider } from './BrowserVoiceRuntimeProvider';
import { SpeechPlaybackProvider } from './SpeechPlaybackProvider';

const VoiceContextBridge = React.memo(function VoiceContextBridge() {
    useVoiceContext();
    return null;
});

/**
 * Provider component that initializes voice context sync.
 * Wrap the app with this to enable voice session awareness.
 * 
 * @example
 * ```tsx
 * <VoiceProvider>
 *   <App />
 * </VoiceProvider>
 * ```
 */
export function VoiceProvider({ children }: { children: React.ReactNode }) {
    const voiceModeEnabled = useConfigStore((state) => state.voiceModeEnabled);

    return (
        <BrowserVoiceRuntimeProvider>
            {voiceModeEnabled ? <VoiceContextBridge /> : null}
            <SpeechPlaybackProvider>
                {children}
            </SpeechPlaybackProvider>
        </BrowserVoiceRuntimeProvider>
    );
}
