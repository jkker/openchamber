import { createEdgeUniversalTtsProvider } from './edge-universal.js';
import { createOpenAICompatibleTtsProvider } from './openai-compatible.js';
import { createSayTtsProvider } from './say.js';
import { SPEECH_SDK_PROVIDER_DEFINITIONS, createSpeechSdkTtsProvider } from './speech-sdk.js';

const TTS_PROVIDER_IDS = new Set(['speech-sdk', 'edge-tts', 'openai-compatible', 'say']);
const TTS_API_KEY_MODES = new Set(['server', 'client', 'gateway']);

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeOptionalString = (value) => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeSpeechSdkProvider = (value) => {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  return SPEECH_SDK_PROVIDER_DEFINITIONS.some((definition) => definition.id === normalized)
    ? normalized
    : 'openai';
};

const normalizeApiKeyMode = (value) => {
  const normalized = normalizeOptionalString(value)?.toLowerCase();
  return normalized && TTS_API_KEY_MODES.has(normalized) ? normalized : 'server';
};

const clampRate = (value) => Math.max(0.5, Math.min(2, Number.isFinite(value) ? value : 1));
const clampPitch = (value) => Math.max(0.5, Math.min(2, Number.isFinite(value) ? value : 1));
const clampVolume = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));

const defaultSpeechSdkModel = (providerId) =>
  SPEECH_SDK_PROVIDER_DEFINITIONS.find((definition) => definition.id === providerId)?.defaultModel
  ?? 'gpt-4o-mini-tts';

const defaultSpeechSdkVoice = (providerId) =>
  SPEECH_SDK_PROVIDER_DEFINITIONS.find((definition) => definition.id === providerId)?.defaultVoice
  ?? 'coral';

export function resolveTtsRequest(rawRequest = {}) {
  const rawProvider = normalizeOptionalString(rawRequest.provider)?.toLowerCase();
  const provider = rawProvider && TTS_PROVIDER_IDS.has(rawProvider)
    ? rawProvider
    : normalizeOptionalString(rawRequest.baseURL)
      ? 'openai-compatible'
      : 'speech-sdk';
  const speechSdkProvider = normalizeSpeechSdkProvider(rawRequest.speechSdkProvider);
  const providerOptions = isRecord(rawRequest.providerOptions) ? rawRequest.providerOptions : {};

  const resolved = {
    provider,
    speechSdkProvider,
    apiKeyMode: normalizeApiKeyMode(rawRequest.apiKeyMode),
    model: normalizeOptionalString(rawRequest.model),
    voice: normalizeOptionalString(rawRequest.voice),
    text: typeof rawRequest.text === 'string' ? rawRequest.text.trim() : '',
    speed: clampRate(rawRequest.speed),
    pitch: clampPitch(rawRequest.pitch),
    volume: clampVolume(rawRequest.volume),
    timestamps: rawRequest.timestamps === true,
    providerOptions,
    baseURL: normalizeOptionalString(rawRequest.baseURL),
    apiKey: normalizeOptionalString(rawRequest.apiKey),
    instructions: normalizeOptionalString(rawRequest.instructions),
    returnMetadata: rawRequest.returnMetadata === true,
  };

  if (provider === 'speech-sdk') {
    return {
      ...resolved,
      model: resolved.model ?? defaultSpeechSdkModel(speechSdkProvider),
      voice: resolved.voice ?? defaultSpeechSdkVoice(speechSdkProvider),
    };
  }

  if (provider === 'edge-tts') {
    return {
      ...resolved,
      model: resolved.model ?? 'edge-tts-universal',
      voice: resolved.voice ?? 'en-US-AvaNeural',
    };
  }

  if (provider === 'say') {
    // Legacy say callers use a normalized 0.5-2.0 speed slider. Convert that to the
    // words-per-minute rate expected by the macOS `say` command.
    const rate = Number.isFinite(providerOptions.rate)
      ? Math.round(providerOptions.rate)
      : Math.round(100 + (resolved.speed - 0.5) * 200);
    return {
      ...resolved,
      voice: resolved.voice ?? 'Samantha',
      providerOptions: {
        ...providerOptions,
        rate,
      },
    };
  }

  return {
    ...resolved,
    model: resolved.model ?? 'kokoro',
    voice: resolved.voice ?? 'af_sky',
  };
}

export function createTtsProviderRegistry({
  processLike,
  getOpenAIApiKey,
}) {
  const providers = new Map();
  const registry = [
    createSpeechSdkTtsProvider({ processLike }),
    createEdgeUniversalTtsProvider(),
    createOpenAICompatibleTtsProvider({ getOpenAIApiKey }),
    createSayTtsProvider({ processLike }),
  ];

  for (const provider of registry) {
    providers.set(provider.id, provider);
  }

  return {
    getProvider(providerId) {
      return providers.get(providerId);
    },
    listProviders({ sayTTSCapability } = {}) {
      return [
        {
          id: 'browser',
          label: 'Browser Speech Synthesis',
          kind: 'client',
          available: true,
          configured: true,
          requiresApiKey: false,
          supportsVoices: true,
          supportsTimestamps: false,
        },
        ...registry.map((provider) => ({
          id: provider.id,
          label: provider.label,
          kind: provider.kind,
          available: provider.id === 'say'
            ? Boolean(sayTTSCapability?.available)
            : true,
          configured: provider.isConfigured?.({ sayTTSCapability }) ?? true,
          requiresApiKey: provider.requiresApiKey ?? false,
          supportsVoices: provider.supportsVoices ?? false,
          supportsTimestamps: provider.supportsTimestamps ?? false,
          defaultModel: provider.defaultModel,
          defaultVoice: provider.defaultVoice,
          ...(provider.id === 'say' ? { reason: sayTTSCapability?.reason, voiceCount: sayTTSCapability?.voices?.length ?? 0 } : {}),
          ...(provider.id === 'edge-tts' ? { license: provider.license } : {}),
          ...(provider.id === 'speech-sdk'
            ? {
                configuredProviders: provider.getConfiguredProviders?.() ?? [],
                gatewayConfigured: Boolean(processLike.env?.SPEECH_GATEWAY_API_KEY),
              }
            : {}),
        })),
      ];
    },
    async listVoices({ provider, locale, gender, sayTTSCapability } = {}) {
      const target = providers.get(provider);
      if (!target) {
        throw new Error(`Unsupported TTS provider: ${provider}`);
      }

      if (provider === 'say') {
        return Array.isArray(sayTTSCapability?.voices)
          ? sayTTSCapability.voices.map((voice) => ({
              id: voice.name,
              name: voice.name,
              locale: voice.locale,
              label: `${voice.name} (${voice.locale})`,
            }))
          : [];
      }

      if (typeof target.listVoices !== 'function') {
        return [];
      }

      return await target.listVoices({ locale, gender });
    },
    async synthesize(rawRequest) {
      const request = resolveTtsRequest(rawRequest);
      const provider = providers.get(request.provider);
      if (!provider) {
        throw new Error(`Unsupported TTS provider: ${request.provider}`);
      }
      return await provider.synthesize(request);
    },
  };
}
