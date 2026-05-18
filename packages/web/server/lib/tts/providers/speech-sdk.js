import {
  ApiError,
  MissingApiKeyError,
  SpeechSDKError,
  TimestampKeyMissingError,
  generateSpeech,
} from '@speech-sdk/core';
import {
  createCartesia,
  createDeepgram,
  createElevenLabs,
  createFal,
  createFishAudio,
  createGoogle,
  createHume,
  createInworld,
  createMistral,
  createMurf,
  createOpenAI,
  createResemble,
  createXai,
} from '@speech-sdk/core/providers';

export const SPEECH_SDK_PROVIDER_DEFINITIONS = [
  { id: 'openai', label: 'OpenAI', envVar: 'OPENAI_API_KEY', defaultModel: 'gpt-4o-mini-tts', defaultVoice: 'coral', createModel: ({ apiKey, baseURL }) => createOpenAI({ ...(apiKey ? { apiKey } : {}), ...(baseURL ? { baseURL } : {}) }) },
  { id: 'elevenlabs', label: 'ElevenLabs', envVar: 'ELEVENLABS_API_KEY', defaultModel: 'eleven_multilingual_v2', defaultVoice: 'JBFqnCBsd6RMkjVDRZzb', createModel: ({ apiKey }) => createElevenLabs({ ...(apiKey ? { apiKey } : {}) }) },
  { id: 'deepgram', label: 'Deepgram', envVar: 'DEEPGRAM_API_KEY', defaultModel: 'aura-2-thalia-en', defaultVoice: 'thalia', createModel: ({ apiKey }) => createDeepgram({ ...(apiKey ? { apiKey } : {}) }) },
  { id: 'cartesia', label: 'Cartesia', envVar: 'CARTESIA_API_KEY', defaultModel: 'sonic-3', defaultVoice: '248be419-c632-4f23-adf1-5324ed7dbf1d', createModel: ({ apiKey }) => createCartesia({ ...(apiKey ? { apiKey } : {}) }) },
  { id: 'google', label: 'Google Gemini TTS', envVar: 'GOOGLE_API_KEY', defaultModel: 'gemini-2.5-flash-preview-tts', defaultVoice: 'Kore', createModel: ({ apiKey }) => createGoogle({ ...(apiKey ? { apiKey } : {}) }) },
  { id: 'hume', label: 'Hume', envVar: 'HUME_API_KEY', defaultModel: 'octave-tts', defaultVoice: 'Kora', createModel: ({ apiKey }) => createHume({ ...(apiKey ? { apiKey } : {}) }) },
  { id: 'fish-audio', label: 'Fish Audio', envVar: 'FISH_AUDIO_API_KEY', defaultModel: 'speech-1.6', defaultVoice: '9f8f6a16-3c1d-4f0c-85ea-4f34b9d6c6ac', createModel: ({ apiKey }) => createFishAudio({ ...(apiKey ? { apiKey } : {}) }) },
  { id: 'murf', label: 'Murf', envVar: 'MURF_API_KEY', defaultModel: 'mist', defaultVoice: 'en-US-natalie', createModel: ({ apiKey }) => createMurf({ ...(apiKey ? { apiKey } : {}) }) },
  { id: 'resemble', label: 'Resemble', envVar: 'RESEMBLE_API_KEY', defaultModel: 'resemble-v3', defaultVoice: 'maya', createModel: ({ apiKey }) => createResemble({ ...(apiKey ? { apiKey } : {}) }) },
  { id: 'fal-ai', label: 'fal', envVar: 'FAL_API_KEY', defaultModel: 'fal-ai/minimax/speech-02-hd', defaultVoice: 'Wise_Woman', createModel: ({ apiKey }) => createFal({ ...(apiKey ? { apiKey } : {}) }) },
  { id: 'mistral', label: 'Mistral', envVar: 'MISTRAL_API_KEY', defaultModel: 'mistral-tts', defaultVoice: 'alloy', createModel: ({ apiKey }) => createMistral({ ...(apiKey ? { apiKey } : {}) }) },
  { id: 'xai', label: 'xAI', envVar: 'XAI_API_KEY', defaultModel: 'grok-3-mini-tts', defaultVoice: 'alloy', createModel: ({ apiKey }) => createXai({ ...(apiKey ? { apiKey } : {}) }) },
  { id: 'inworld', label: 'Inworld', envVar: 'INWORLD_API_KEY', defaultModel: 'inworld-tts-1', defaultVoice: 'voice-1', createModel: ({ apiKey }) => createInworld({ ...(apiKey ? { apiKey } : {}) }) },
];

const providerDefinitionMap = new Map(SPEECH_SDK_PROVIDER_DEFINITIONS.map((definition) => [definition.id, definition]));

export function isSpeechSdkApiError(error) {
  return error instanceof ApiError
    || error instanceof MissingApiKeyError
    || error instanceof TimestampKeyMissingError
    || error instanceof SpeechSDKError;
}

export function getSpeechSdkProviderDefinition(providerId) {
  return providerDefinitionMap.get(providerId) ?? providerDefinitionMap.get('openai');
}

export function createSpeechSdkTtsProvider({
  processLike,
}) {
  return {
    id: 'speech-sdk',
    label: 'Speech SDK',
    kind: 'server',
    requiresApiKey: true,
    supportsVoices: false,
    supportsTimestamps: true,
    isConfigured() {
      return SPEECH_SDK_PROVIDER_DEFINITIONS.some((definition) => {
        const value = processLike.env?.[definition.envVar];
        return typeof value === 'string' && value.trim().length > 0;
      }) || Boolean(processLike.env?.SPEECH_GATEWAY_API_KEY);
    },
    getConfiguredProviders() {
      return SPEECH_SDK_PROVIDER_DEFINITIONS.map((definition) => ({
        id: definition.id,
        label: definition.label,
        envVar: definition.envVar,
        defaultModel: definition.defaultModel,
        defaultVoice: definition.defaultVoice,
        configured: typeof processLike.env?.[definition.envVar] === 'string' && processLike.env[definition.envVar].trim().length > 0,
      }));
    },
    async synthesize(request) {
      const definition = getSpeechSdkProviderDefinition(request.speechSdkProvider);
      const useGateway = request.apiKeyMode === 'gateway';
      const model = useGateway
        ? `${definition.id}/${request.model}`
        : definition.createModel({
            apiKey: request.apiKey,
            baseURL: definition.id === 'openai' ? request.baseURL : undefined,
          })(request.model);

      const result = await generateSpeech({
        model,
        text: request.text,
        voice: request.voice,
        speed: request.speed,
        timestamps: request.timestamps === true,
        ...(request.providerOptions ? { providerOptions: request.providerOptions } : {}),
        ...(request.apiKeyMode === 'gateway' && request.apiKey ? { apiKey: request.apiKey } : {}),
      });

      return {
        audio: Buffer.from(result.audio.uint8Array),
        contentType: result.audio.mediaType,
        provider: this.id,
        model: request.model,
        voice: request.voice,
        timestamps: result.timestamps ? Array.from(result.timestamps) : undefined,
        warnings: result.warnings ? Array.from(result.warnings) : undefined,
      };
    },
  };
}
