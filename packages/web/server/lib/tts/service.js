import { readAuthFile } from '../opencode/auth.js';
import { ApiError, MissingApiKeyError, SpeechSDKError, TimestampKeyMissingError } from '@speech-sdk/core';
import { createTtsProviderRegistry, resolveTtsRequest } from './providers/index.js';

export const TTS_VOICES = [
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable',
  'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'
];

export function getOpenAIApiKey() {
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) {
    return envKey;
  }

  try {
    const auth = readAuthFile();
    const openaiAuth = auth.openai || auth.codex || auth.chatgpt;
    if (openaiAuth) {
      if (typeof openaiAuth === 'string') {
        return openaiAuth;
      }
      if (openaiAuth.access) {
        return openaiAuth.access;
      }
      if (openaiAuth.token) {
        return openaiAuth.token;
      }
    }
  } catch (error) {
    console.warn('[TTSService] Failed to read auth file:', error.message);
  }

  return null;
}

const ttsProviderRegistry = createTtsProviderRegistry({
  processLike: process,
  getOpenAIApiKey,
});

class TTSServiceError extends Error {
  constructor(message, { status = 500, code, cause } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = 'TTSServiceError';
    this.status = status;
    this.code = code;
  }
}

const toTtsServiceError = (error) => {
  if (error instanceof TTSServiceError) {
    return error;
  }

  if (error instanceof MissingApiKeyError) {
    return new TTSServiceError(
      `${error.providerName} TTS requires an API key. Configure ${error.envVar} on the server or supply a client key.`,
      { status: 503, code: 'missing_api_key', cause: error }
    );
  }

  if (error instanceof TimestampKeyMissingError) {
    return new TTSServiceError(
      `Timestamps require a fallback STT key. Configure ${error.envVar} or disable timestamps.`,
      { status: 400, code: 'timestamps_missing_key', cause: error }
    );
  }

  if (error instanceof ApiError) {
    const detail = error.code ? ` (${error.code})` : '';
    return new TTSServiceError(`TTS provider request failed${detail}.`, {
      status: error.statusCode || 502,
      code: error.code,
      cause: error,
    });
  }

  if (error instanceof SpeechSDKError) {
    return new TTSServiceError(error.message, { status: 400, cause: error });
  }

  if (error instanceof Error) {
    return new TTSServiceError(error.message, { status: 500, cause: error });
  }

  return new TTSServiceError('TTS generation failed');
};

class TTSService {
  isAvailable() {
    return getOpenAIApiKey() !== null;
  }

  listProviders(options = {}) {
    return ttsProviderRegistry.listProviders(options);
  }

  async listVoices(options = {}) {
    return await ttsProviderRegistry.listVoices(options);
  }

  resolveRequest(options = {}) {
    return resolveTtsRequest(options);
  }

  async generateSpeechStream(options) {
    try {
      const resolvedRequest = resolveTtsRequest(options);
      if (!resolvedRequest.text) {
        throw new TTSServiceError('Text is required', { status: 400 });
      }

      const response = await ttsProviderRegistry.synthesize(resolvedRequest);
      return {
        buffer: response.audio,
        contentType: response.contentType,
        provider: response.provider,
        model: response.model,
        voice: response.voice,
        timestamps: response.timestamps,
        warnings: response.warnings,
      };
    } catch (error) {
      throw toTtsServiceError(error);
    }
  }

  async generateSpeechBuffer(options) {
    const result = await this.generateSpeechStream(options);
    return result.buffer;
  }
}

export const ttsService = new TTSService();
export { TTSService, TTSServiceError, resolveTtsRequest };
