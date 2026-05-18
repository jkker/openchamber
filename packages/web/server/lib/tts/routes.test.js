import { afterEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockTtsService = {
  isAvailable: vi.fn(() => true),
  listProviders: vi.fn(() => []),
  listVoices: vi.fn(async () => []),
  generateSpeechStream: vi.fn(async () => ({
    buffer: Buffer.from('audio'),
    contentType: 'audio/mpeg',
    provider: 'speech-sdk',
    model: 'gpt-4o-mini-tts',
    voice: 'coral',
  })),
};

vi.mock('./index.js', () => ({
  ttsService: mockTtsService,
}));

import { registerTtsRoutes } from './routes.js';

const createApp = () => {
  const app = express();
  app.use(express.json());
  registerTtsRoutes(app, {
    resolveZenModel: async () => 'gpt-5-nano',
    sayTTSCapability: null,
  });
  return app;
};

describe('tts routes', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mockTtsService.isAvailable.mockReset();
    mockTtsService.isAvailable.mockReturnValue(true);
    mockTtsService.listProviders.mockReset();
    mockTtsService.listProviders.mockReturnValue([]);
    mockTtsService.listVoices.mockReset();
    mockTtsService.listVoices.mockResolvedValue([]);
    mockTtsService.generateSpeechStream.mockReset();
    mockTtsService.generateSpeechStream.mockResolvedValue({
      buffer: Buffer.from('audio'),
      contentType: 'audio/mpeg',
      provider: 'speech-sdk',
      model: 'gpt-4o-mini-tts',
      voice: 'coral',
    });
  });

  it('retries note summarization with notification mode before failing', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'unavailable' }),
    }));

    const response = await request(createApp())
      .post('/api/text/summarize')
      .send({
        text: 'First sentence. Second sentence with the useful insight.',
        threshold: 0,
        maxLength: 100,
        mode: 'note',
      });

    expect(response.status).toBe(502);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(response.body).toEqual({
      error: 'Note summarization failed',
      reason: 'zen API returned 503',
    });
  });

  it('uses notification summarizer result when note mode falls back', async () => {
    globalThis.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({ error: 'unavailable' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          output: [{
            type: 'message',
            content: [{ type: 'output_text', text: '**Keep provider state stable** during streaming.' }],
          }],
        }),
      });

    const response = await request(createApp())
      .post('/api/text/summarize')
      .send({
        text: 'First sentence. Preserve provider state references during streaming to avoid wide rerenders.',
        threshold: 0,
        maxLength: 100,
        mode: 'note',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      summary: 'Keep provider state stable during streaming.',
      summarized: true,
    });
  });

  it('keeps notification fallback behavior', async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: 'unavailable' }),
    }));

    const response = await request(createApp())
      .post('/api/text/summarize')
      .send({
        text: 'Notification text that should fall back cleanly.',
        threshold: 0,
        maxLength: 100,
        mode: 'notification',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      summary: 'Notification text that should fall back cleanly.',
      summarized: false,
      reason: 'zen API returned 503',
    });
  });

  it('lists configured TTS providers', async () => {
    mockTtsService.listProviders.mockReturnValue([
      { id: 'browser', kind: 'client' },
      { id: 'edge-tts', kind: 'server', configured: true },
    ]);

    const response = await request(createApp()).get('/api/tts/providers');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      providers: [
        { id: 'browser', kind: 'client' },
        { id: 'edge-tts', kind: 'server', configured: true },
      ],
    });
  });

  it('lists provider voices with locale filters', async () => {
    mockTtsService.listVoices.mockResolvedValue([
      { id: 'en-US-AvaNeural', locale: 'en-US' },
    ]);

    const response = await request(createApp())
      .get('/api/tts/voices')
      .query({ provider: 'edge-tts', locale: 'en-US', gender: 'Female' });

    expect(response.status).toBe(200);
    expect(mockTtsService.listVoices).toHaveBeenCalledWith({
      provider: 'edge-tts',
      locale: 'en-US',
      gender: 'Female',
      sayTTSCapability: null,
    });
    expect(response.body).toEqual({
      provider: 'edge-tts',
      voices: [{ id: 'en-US-AvaNeural', locale: 'en-US' }],
    });
  });

  it('keeps /api/tts/speak backward compatible for custom base URLs', async () => {
    const response = await request(createApp())
      .post('/api/tts/speak')
      .send({
        text: 'Hello world',
        voice: 'af_sky',
        model: 'kokoro',
        baseURL: 'http://localhost:8880/v1',
      });

    expect(response.status).toBe(200);
    expect(mockTtsService.generateSpeechStream).toHaveBeenCalledWith(expect.objectContaining({
      text: 'Hello world',
      model: 'kokoro',
      voice: 'af_sky',
      baseURL: 'http://localhost:8880/v1',
      provider: undefined,
    }));
    expect(response.headers['content-type']).toContain('audio/mpeg');
  });

  it('returns metadata payloads when requested', async () => {
    mockTtsService.generateSpeechStream.mockResolvedValue({
      buffer: Buffer.from('audio'),
      contentType: 'audio/mpeg',
      provider: 'edge-tts',
      model: 'edge-tts-universal',
      voice: 'en-US-AvaNeural',
      timestamps: [{ text: 'Hello', start: 0, end: 0.3 }],
      warnings: ['demo'],
    });

    const response = await request(createApp())
      .post('/api/tts/speak')
      .send({
        provider: 'edge-tts',
        text: 'Hello world',
        returnMetadata: true,
        timestamps: true,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      contentType: 'audio/mpeg',
      provider: 'edge-tts',
      model: 'edge-tts-universal',
      voice: 'en-US-AvaNeural',
      timestamps: [{ text: 'Hello', start: 0, end: 0.3 }],
      warnings: ['demo'],
    });
    expect(typeof response.body.audioBase64).toBe('string');
  });
});
