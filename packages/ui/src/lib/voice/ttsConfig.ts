export type TtsProviderId = 'browser' | 'edge-tts' | 'speech-sdk' | 'openai-compatible' | 'say';
export type SpeechSdkProviderId =
  | 'openai'
  | 'elevenlabs'
  | 'deepgram'
  | 'cartesia'
  | 'google'
  | 'hume'
  | 'fish-audio'
  | 'murf'
  | 'resemble'
  | 'fal-ai'
  | 'mistral'
  | 'xai'
  | 'inworld';
export type TtsApiKeyMode = 'server' | 'client' | 'gateway';

export const SPEECH_SDK_PROVIDER_OPTIONS: Array<{
  id: SpeechSdkProviderId;
  label: string;
  defaultModel: string;
  defaultVoice: string;
}> = [
  { id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini-tts', defaultVoice: 'coral' },
  { id: 'elevenlabs', label: 'ElevenLabs', defaultModel: 'eleven_multilingual_v2', defaultVoice: 'JBFqnCBsd6RMkjVDRZzb' },
  { id: 'deepgram', label: 'Deepgram', defaultModel: 'aura-2-thalia-en', defaultVoice: 'thalia' },
  { id: 'cartesia', label: 'Cartesia', defaultModel: 'sonic-3', defaultVoice: '248be419-c632-4f23-adf1-5324ed7dbf1d' },
  { id: 'google', label: 'Google Gemini TTS', defaultModel: 'gemini-2.5-flash-preview-tts', defaultVoice: 'Kore' },
  { id: 'hume', label: 'Hume', defaultModel: 'octave-tts', defaultVoice: 'Kora' },
  { id: 'fish-audio', label: 'Fish Audio', defaultModel: 'speech-1.6', defaultVoice: '9f8f6a16-3c1d-4f0c-85ea-4f34b9d6c6ac' },
  { id: 'murf', label: 'Murf', defaultModel: 'mist', defaultVoice: 'en-US-natalie' },
  { id: 'resemble', label: 'Resemble', defaultModel: 'resemble-v3', defaultVoice: 'maya' },
  { id: 'fal-ai', label: 'fal', defaultModel: 'fal-ai/minimax/speech-02-hd', defaultVoice: 'Wise_Woman' },
  { id: 'mistral', label: 'Mistral', defaultModel: 'mistral-tts', defaultVoice: 'alloy' },
  { id: 'xai', label: 'xAI', defaultModel: 'grok-3-mini-tts', defaultVoice: 'alloy' },
  { id: 'inworld', label: 'Inworld', defaultModel: 'inworld-tts-1', defaultVoice: 'voice-1' },
];

export const OPENAI_TTS_VOICE_OPTIONS = [
  { value: 'alloy', label: 'Alloy' },
  { value: 'ash', label: 'Ash' },
  { value: 'ballad', label: 'Ballad' },
  { value: 'coral', label: 'Coral' },
  { value: 'echo', label: 'Echo' },
  { value: 'fable', label: 'Fable' },
  { value: 'nova', label: 'Nova' },
  { value: 'onyx', label: 'Onyx' },
  { value: 'sage', label: 'Sage' },
  { value: 'shimmer', label: 'Shimmer' },
  { value: 'verse', label: 'Verse' },
  { value: 'marin', label: 'Marin' },
  { value: 'cedar', label: 'Cedar' },
] as const;

export const getSpeechSdkProviderDefaults = (providerId: string | undefined) =>
  SPEECH_SDK_PROVIDER_OPTIONS.find((option) => option.id === providerId)
  ?? SPEECH_SDK_PROVIDER_OPTIONS[0];

export const isServerTtsProvider = (
  provider: TtsProviderId | string | undefined
): provider is Extract<TtsProviderId, 'edge-tts' | 'speech-sdk' | 'openai-compatible'> =>
  provider === 'edge-tts' || provider === 'speech-sdk' || provider === 'openai-compatible';

export const getTtsProviderLabel = (provider: TtsProviderId | string | undefined): string => {
  switch (provider) {
    case 'edge-tts':
      return 'Edge TTS';
    case 'speech-sdk':
      return 'Speech SDK';
    case 'openai-compatible':
      return 'OpenAI-compatible';
    case 'say':
      return 'Say';
    case 'browser':
    default:
      return 'Browser';
  }
};
