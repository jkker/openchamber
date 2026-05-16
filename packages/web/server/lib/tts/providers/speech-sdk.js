/**
 * Speech SDK provider adapter.
 *
 * Uses `@speech-sdk/core` for multi-provider TTS synthesis.
 * Supports direct provider factories (BYO API keys) and optionally
 * the Speech Gateway when explicitly selected.
 *
 * Supported SDK providers:
 *   openai, elevenlabs, deepgram, cartesia, google, hume, mistral,
 *   xai, fish-audio, murf, resemble, fal, inworld, speech-gateway
 */

import { generateSpeech } from '@speech-sdk/core';
import {
  createOpenAI,
  createElevenLabs,
  createDeepgram,
  createCartesia,
  createGoogle,
  createHume,
  createMistral,
  createXai,
  createFishAudio,
  createMurf,
  createResemble,
  createFal,
  createInworld,
  createSpeechGateway,
} from '@speech-sdk/core/providers';
import {
  ApiError,
  MissingApiKeyError,
  TimestampKeyMissingError,
  SpeechSDKError,
} from '@speech-sdk/core';

/**
 * Map of OpenChamber SDK provider IDs to their default models and voice defaults.
 * @type {Record<string, {defaultModel?: string, defaultVoice?: string}>}
 */
const SDK_PROVIDER_DEFAULTS = {
  openai: { defaultModel: 'tts-1', defaultVoice: 'nova' },
  elevenlabs: { defaultModel: 'eleven_multilingual_v2', defaultVoice: 'rachel' },
  deepgram: { defaultModel: 'aura-asteria-en', defaultVoice: 'aura-asteria-en' },
  cartesia: { defaultModel: 'sonic-english', defaultVoice: 'a0e99841-438c-4a64-b679-ae501e7d6091' },
  google: { defaultModel: 'en-US-Neural2-C', defaultVoice: 'en-US-Neural2-C' },
  hume: { defaultModel: 'octave', defaultVoice: '' },
  mistral: { defaultModel: 'mistral-tts', defaultVoice: '' },
  xai: { defaultModel: 'aurora', defaultVoice: '' },
  'fish-audio': { defaultModel: 'speech-1.6', defaultVoice: '' },
  murf: { defaultModel: 'GEN2', defaultVoice: 'en-US-natalie' },
  resemble: { defaultModel: 'resemble-tts', defaultVoice: '' },
  fal: { defaultModel: 'fal-ai/kokoro/american-english', defaultVoice: 'af_bella' },
  inworld: { defaultModel: 'speech-1', defaultVoice: '' },
  'speech-gateway': { defaultModel: 'openai/tts-1', defaultVoice: 'nova' },
};

/**
 * Env-var names for each provider's API key.
 * @type {Record<string, string>}
 */
const SDK_PROVIDER_ENV_KEYS = {
  openai: 'OPENAI_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
  deepgram: 'DEEPGRAM_API_KEY',
  cartesia: 'CARTESIA_API_KEY',
  google: 'GOOGLE_API_KEY',
  hume: 'HUME_API_KEY',
  mistral: 'MISTRAL_API_KEY',
  xai: 'XAI_API_KEY',
  'fish-audio': 'FISH_AUDIO_API_KEY',
  murf: 'MURF_API_KEY',
  resemble: 'RESEMBLE_API_KEY',
  fal: 'FAL_API_KEY',
  inworld: 'INWORLD_API_KEY',
  'speech-gateway': 'SPEECH_GATEWAY_API_KEY',
};

/**
 * Resolve the API key for a given provider.
 * Explicit client-supplied key takes precedence over env vars.
 * Returns undefined if neither is present (SDK will throw MissingApiKeyError).
 *
 * @param {string} providerId
 * @param {string|undefined} clientKey
 * @returns {string|undefined}
 */
function resolveApiKey(providerId, clientKey) {
  if (clientKey && typeof clientKey === 'string' && clientKey.trim().length > 0) {
    return clientKey.trim();
  }
  const envVar = SDK_PROVIDER_ENV_KEYS[providerId];
  if (envVar && process.env[envVar]) {
    return process.env[envVar];
  }
  return undefined;
}

/**
 * Build the Speech SDK model instance for a given provider.
 * @param {string} providerId
 * @param {string} modelId
 * @param {string|undefined} apiKey
 */
function buildModel(providerId, modelId, apiKey) {
  const key = apiKey;
  const cfg = key ? { apiKey: key } : {};

  switch (providerId) {
    case 'openai':          return createOpenAI(cfg)(modelId);
    case 'elevenlabs':      return createElevenLabs(cfg)(modelId);
    case 'deepgram':        return createDeepgram(cfg)(modelId);
    case 'cartesia':        return createCartesia(cfg)(modelId);
    case 'google':          return createGoogle(cfg)(modelId);
    case 'hume':            return createHume(cfg)(modelId);
    case 'mistral':         return createMistral(cfg)(modelId);
    case 'xai':             return createXai(cfg)(modelId);
    case 'fish-audio':      return createFishAudio(cfg)(modelId);
    case 'murf':            return createMurf(cfg)(modelId);
    case 'resemble':        return createResemble(cfg)(modelId);
    case 'fal':             return createFal(cfg)(modelId);
    case 'inworld':         return createInworld(cfg)(modelId);
    case 'speech-gateway':  return createSpeechGateway(cfg)(modelId);
    default:
      throw new Error(`Unsupported Speech SDK provider: ${providerId}`);
  }
}

/**
 * Generate speech using @speech-sdk/core.
 *
 * @param {object} req
 * @param {string} [req.sdkProvider]  SDK provider ID (e.g. 'openai', 'elevenlabs')
 * @param {string} [req.model]        Model ID for the chosen provider
 * @param {string} [req.voice]        Voice ID
 * @param {string} req.text           Text to synthesize
 * @param {number} [req.speed]        Speech speed multiplier
 * @param {boolean} [req.timestamps]  Whether to request word timestamps
 * @param {string} [req.apiKey]       Client-supplied API key (optional)
 * @returns {Promise<{audio: Buffer, contentType: string, provider: string, model: string, voice: string, timestamps?: Array<{text:string,start:number,end:number}>, warnings?: string[]}>}
 */
export async function generateSpeechSdk(req) {
  const {
    sdkProvider = 'openai',
    text,
    speed,
    timestamps: wantTimestamps = false,
    apiKey: clientKey,
  } = req;

  const defaults = SDK_PROVIDER_DEFAULTS[sdkProvider] ?? {};
  const model = req.model || defaults.defaultModel || 'tts-1';
  const voice = req.voice || defaults.defaultVoice || 'nova';

  const resolvedKey = resolveApiKey(sdkProvider, clientKey);
  const modelInstance = buildModel(sdkProvider, model, resolvedKey);

  console.log('[TTS/speech-sdk] provider:', sdkProvider, 'model:', model, 'voice:', voice, 'timestamps:', wantTimestamps);

  try {
    const result = await generateSpeech({
      model: modelInstance,
      voice,
      text,
      ...(typeof speed === 'number' ? { speed } : {}),
      timestamps: wantTimestamps,
    });

    const audioBytes = result.audio.uint8Array;
    const contentType = result.audio.mediaType || 'audio/mpeg';
    const tsArray = result.timestamps
      ? result.timestamps.map((t) => ({ text: t.word ?? t.text ?? '', start: t.start, end: t.end }))
      : undefined;

    return {
      audio: Buffer.from(audioBytes),
      contentType,
      provider: `speech-sdk/${sdkProvider}`,
      model,
      voice,
      ...(tsArray && tsArray.length > 0 ? { timestamps: tsArray } : {}),
      ...(result.warnings && result.warnings.length > 0 ? { warnings: result.warnings } : {}),
    };
  } catch (err) {
    if (err instanceof MissingApiKeyError) {
      const envVar = SDK_PROVIDER_ENV_KEYS[sdkProvider] ?? `${sdkProvider.toUpperCase()}_API_KEY`;
      throw new Error(
        `API key required for Speech SDK provider '${sdkProvider}'. ` +
        `Set the ${envVar} environment variable or provide it in settings.`
      );
    }
    if (err instanceof TimestampKeyMissingError) {
      throw new Error(
        `Timestamps requested but no timestamp API key is configured for provider '${sdkProvider}'.`
      );
    }
    if (err instanceof ApiError) {
      throw new Error(
        `Speech SDK API error from provider '${sdkProvider}': HTTP ${err.statusCode ?? 'unknown'}`
      );
    }
    if (err instanceof SpeechSDKError) {
      throw new Error(`Speech SDK error: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Return the list of supported Speech SDK provider IDs with metadata.
 * @returns {Array<{id: string, name: string, defaultModel: string, defaultVoice: string, requiresApiKey: boolean, envVar: string}>}
 */
export function listSpeechSdkProviders() {
  return Object.entries(SDK_PROVIDER_DEFAULTS).map(([id, defaults]) => ({
    id,
    name: id
      .split('-')
      .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
      .join(' '),
    defaultModel: defaults.defaultModel ?? '',
    defaultVoice: defaults.defaultVoice ?? '',
    requiresApiKey: id !== 'speech-gateway' || !process.env.SPEECH_GATEWAY_API_KEY,
    hasServerKey: Boolean(process.env[SDK_PROVIDER_ENV_KEYS[id]]),
    envVar: SDK_PROVIDER_ENV_KEYS[id] ?? '',
  }));
}
