import { afterEach, describe, expect, it, vi } from 'vitest';

const generateSpeech = vi.fn();
const createOpenAI = vi.fn(() => vi.fn((modelId) => ({ provider: 'openai', modelId })));

vi.mock('@speech-sdk/core', () => ({
  generateSpeech,
  ApiError: class ApiError extends Error {},
  MissingApiKeyError: class MissingApiKeyError extends Error {},
  SpeechSDKError: class SpeechSDKError extends Error {},
  TimestampKeyMissingError: class TimestampKeyMissingError extends Error {},
}));

vi.mock('@speech-sdk/core/providers', () => ({
  createCartesia: vi.fn(() => vi.fn((modelId) => ({ provider: 'cartesia', modelId }))),
  createDeepgram: vi.fn(() => vi.fn((modelId) => ({ provider: 'deepgram', modelId }))),
  createElevenLabs: vi.fn(() => vi.fn((modelId) => ({ provider: 'elevenlabs', modelId }))),
  createFal: vi.fn(() => vi.fn((modelId) => ({ provider: 'fal-ai', modelId }))),
  createFishAudio: vi.fn(() => vi.fn((modelId) => ({ provider: 'fish-audio', modelId }))),
  createGoogle: vi.fn(() => vi.fn((modelId) => ({ provider: 'google', modelId }))),
  createHume: vi.fn(() => vi.fn((modelId) => ({ provider: 'hume', modelId }))),
  createInworld: vi.fn(() => vi.fn((modelId) => ({ provider: 'inworld', modelId }))),
  createMistral: vi.fn(() => vi.fn((modelId) => ({ provider: 'mistral', modelId }))),
  createMurf: vi.fn(() => vi.fn((modelId) => ({ provider: 'murf', modelId }))),
  createOpenAI,
  createResemble: vi.fn(() => vi.fn((modelId) => ({ provider: 'resemble', modelId }))),
  createXai: vi.fn(() => vi.fn((modelId) => ({ provider: 'xai', modelId }))),
}));

const { createSpeechSdkTtsProvider } = await import('./speech-sdk.js');

describe('speech sdk tts provider', () => {
  afterEach(() => {
    generateSpeech.mockReset();
    createOpenAI.mockClear();
  });

  it('uses direct provider factories by default', async () => {
    generateSpeech.mockResolvedValue({
      audio: { uint8Array: new Uint8Array([1, 2]), mediaType: 'audio/mpeg' },
      timestamps: [{ text: 'Hello', start: 0, end: 0.2 }],
      warnings: ['demo'],
    });

    const provider = createSpeechSdkTtsProvider({ processLike: { env: {} } });
    await provider.synthesize({
      text: 'Hello',
      speechSdkProvider: 'openai',
      model: 'gpt-4o-mini-tts',
      voice: 'coral',
      speed: 1,
      timestamps: true,
      providerOptions: { style: 'calm' },
      apiKeyMode: 'server',
    });

    expect(createOpenAI).toHaveBeenCalled();
    expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({
      model: { provider: 'openai', modelId: 'gpt-4o-mini-tts' },
      voice: 'coral',
      timestamps: true,
      providerOptions: { style: 'calm' },
    }));
  });

  it('uses gateway model strings only when explicitly requested', async () => {
    generateSpeech.mockResolvedValue({
      audio: { uint8Array: new Uint8Array([1]), mediaType: 'audio/mpeg' },
    });

    const provider = createSpeechSdkTtsProvider({ processLike: { env: {} } });
    await provider.synthesize({
      text: 'Hello',
      speechSdkProvider: 'openai',
      model: 'gpt-4o-mini-tts',
      voice: 'coral',
      speed: 1,
      apiKeyMode: 'gateway',
      apiKey: 'gateway-key',
    });

    expect(generateSpeech).toHaveBeenCalledWith(expect.objectContaining({
      model: 'openai/gpt-4o-mini-tts',
      apiKey: 'gateway-key',
    }));
  });
});
