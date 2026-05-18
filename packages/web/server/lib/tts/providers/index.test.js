import { describe, expect, it } from 'vitest';

import { resolveTtsRequest } from './index.js';

describe('resolveTtsRequest', () => {
  it('defaults legacy requests to Speech SDK OpenAI', () => {
    expect(resolveTtsRequest({
      text: 'Hello',
      voice: 'coral',
    })).toMatchObject({
      provider: 'speech-sdk',
      speechSdkProvider: 'openai',
      model: 'gpt-4o-mini-tts',
      voice: 'coral',
    });
  });

  it('routes explicit base URLs to OpenAI-compatible mode', () => {
    expect(resolveTtsRequest({
      text: 'Hello',
      baseURL: 'http://localhost:8880/v1',
    })).toMatchObject({
      provider: 'openai-compatible',
      baseURL: 'http://localhost:8880/v1',
      model: 'kokoro',
      voice: 'af_sky',
    });
  });

  it('uses provider defaults for Edge TTS', () => {
    expect(resolveTtsRequest({
      provider: 'edge-tts',
      text: 'Hello',
    })).toMatchObject({
      provider: 'edge-tts',
      model: 'edge-tts-universal',
      voice: 'en-US-AvaNeural',
    });
  });

  it('maps say requests to words-per-minute provider options', () => {
    expect(resolveTtsRequest({
      provider: 'say',
      text: 'Hello',
      speed: 1.5,
    })).toMatchObject({
      provider: 'say',
      voice: 'Samantha',
      providerOptions: {
        rate: 300,
      },
    });
  });
});
