import express from 'express';
import { normalizeCustomOpenAIBaseURL } from './base-url.js';
import { summarizeText, sanitizeForTTS, sanitizeForNote, sanitizeForNotification } from '../text/summarization.js';

export function registerTtsRoutes(app, { resolveZenModel, sayTTSCapability }) {
  let ttsModulePromise = null;
  const getTtsModule = async () => {
    if (!ttsModulePromise) {
      ttsModulePromise = import('./index.js');
    }
    return ttsModulePromise;
  };

  app.post('/api/voice/token', async (req, res) => {
    console.log('[Voice] Token request received:', {
      contentType: req.headers['content-type'] || null,
    });
    try {
      const openaiApiKey = process.env.OPENAI_API_KEY;
      console.log('[Voice] OpenAI API Key present:', !!openaiApiKey);

      if (!openaiApiKey) {
        return res.status(503).json({
          allowed: false,
          error: 'OpenAI voice service not configured. Set OPENAI_API_KEY environment variable.'
        });
      }

      // Return success - OpenAI TTS is available
      res.json({
        allowed: true,
        provider: 'openai',
        message: 'OpenAI TTS is available'
      });
    } catch (error) {
      console.error('[Voice] Token generation error:', error);
      res.status(500).json({
        allowed: false,
        error: 'Voice service error'
      });
    }
  });

  app.get('/api/tts/providers', async (_req, res) => {
    try {
      const { ttsService } = await getTtsModule();
      res.json({
        providers: ttsService.listProviders({ sayTTSCapability }),
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load TTS providers' });
    }
  });

  app.get('/api/tts/voices', async (req, res) => {
    try {
      const provider = typeof req.query.provider === 'string' ? req.query.provider.trim() : '';
      if (!provider) {
        return res.status(400).json({ error: 'provider query parameter is required' });
      }

      const { ttsService } = await getTtsModule();
      const voices = await ttsService.listVoices({
        provider,
        locale: typeof req.query.locale === 'string' ? req.query.locale : undefined,
        gender: typeof req.query.gender === 'string' ? req.query.gender : undefined,
        sayTTSCapability,
      });

      return res.json({ provider, voices });
    } catch (error) {
      return res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load TTS voices' });
    }
  });

  app.post('/api/tts/speak', async (req, res) => {
    try {
      const {
        text,
        summarize = false,
        providerId,
        modelId,
        threshold = 200,
        maxLength = 500,
        apiKey,
        baseURL,
      } = req.body || {};

      const normalizedBaseURLResult = normalizeCustomOpenAIBaseURL(baseURL);
      if (normalizedBaseURLResult.error) {
        return res.status(400).json({ error: normalizedBaseURLResult.error });
      }
      const normalizedBaseURL = normalizedBaseURLResult.value;

      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Text is required' });
      }

      const { ttsService } = await getTtsModule();

      let textToSpeak = text.trim();

      if (summarize && textToSpeak.length > threshold) {
        try {
          const speakZenModel = await resolveZenModel(typeof req.body?.zenModel === 'string' ? req.body.zenModel : undefined);
          const result = await summarizeText({ text: textToSpeak, threshold, maxLength, zenModel: speakZenModel, mode: 'tts' });
          
          if (result.summarized && result.summary) {
            textToSpeak = result.summary;
          }
        } catch (summarizeError) {
          console.error('[TTS/speak] Summarization failed:', summarizeError);
        }
      }

      const result = await ttsService.generateSpeechStream({
        text: textToSpeak,
        provider: typeof req.body?.provider === 'string' ? req.body.provider : undefined,
        speechSdkProvider: typeof req.body?.speechSdkProvider === 'string' ? req.body.speechSdkProvider : undefined,
        voice: typeof req.body?.voice === 'string' ? req.body.voice : undefined,
        model: typeof req.body?.model === 'string' ? req.body.model : undefined,
        speed: typeof req.body?.speed === 'number' ? req.body.speed : undefined,
        pitch: typeof req.body?.pitch === 'number' ? req.body.pitch : undefined,
        volume: typeof req.body?.volume === 'number' ? req.body.volume : undefined,
        timestamps: req.body?.timestamps === true,
        providerOptions: req.body?.providerOptions,
        apiKeyMode: typeof req.body?.apiKeyMode === 'string' ? req.body.apiKeyMode : undefined,
        instructions: typeof req.body?.instructions === 'string' ? req.body.instructions : undefined,
        apiKey: typeof apiKey === 'string' && apiKey.trim().length > 0 ? apiKey.trim() : undefined,
        baseURL: typeof normalizedBaseURL === 'string' && normalizedBaseURL.length > 0 ? normalizedBaseURL : undefined,
        returnMetadata: req.body?.returnMetadata === true,
      });

      if (req.body?.returnMetadata === true) {
        return res.json({
          audioBase64: result.buffer.toString('base64'),
          contentType: result.contentType,
          provider: result.provider,
          model: result.model,
          voice: result.voice,
          timestamps: result.timestamps,
          warnings: result.warnings,
        });
      }

      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Length', result.buffer.length);
      res.send(result.buffer);
    } catch (error) {
      console.error('[TTS] Error:', error);
      if (!res.headersSent) {
        const status = typeof error?.status === 'number' ? error.status : 500;
        res.status(status).json({
          error: error instanceof Error ? error.message : 'TTS generation failed',
          ...(typeof error?.code === 'string' ? { code: error.code } : {}),
        });
      }
    }
  });

  app.post('/api/text/summarize', async (req, res) => {
    try {
      const { text, threshold = 200, maxLength = 500, mode } = req.body || {};

      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Text is required' });
      }

      const sumZenModel = await resolveZenModel(typeof req.body?.zenModel === 'string' ? req.body.zenModel : undefined);
      let result = await summarizeText({
        text,
        threshold,
        maxLength,
        zenModel: sumZenModel,
        mode: typeof mode === 'string' ? mode : 'tts',
      });

      if (mode === 'note' && !result.summarized) {
        const notificationResult = await summarizeText({
          text,
          threshold,
          maxLength,
          zenModel: sumZenModel,
          mode: 'notification',
        });
        if (notificationResult.summarized && notificationResult.summary) {
          result = {
            ...notificationResult,
            summary: sanitizeForNote(sanitizeForNotification(notificationResult.summary)),
          };
        } else {
          return res.status(502).json({
            error: 'Note summarization failed',
            reason: notificationResult.reason || result.reason || 'No distilled result from model',
          });
        }
      }

      return res.json(result);
    } catch (error) {
      console.error('[Summarize] Error:', error);
      const sanitized = typeof req.body?.mode === 'string' && req.body.mode === 'note'
        ? sanitizeForNote(req.body?.text || '')
        : sanitizeForTTS(req.body?.text || '');
      return res.json({ summary: sanitized, summarized: false, reason: error.message });
    }
  });

       
  // TTS status endpoint
  app.get('/api/tts/status', async (_req, res) => {
    try {
      const { ttsService } = await getTtsModule();
      res.json({
        available: ttsService.isAvailable(),
        voices: [
          'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable',
          'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'
        ],
        providers: ttsService.listProviders({ sayTTSCapability }),
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to check TTS status' });
    }
  });

  // macOS 'say' command TTS status endpoint - returns cached capability from startup
  app.get('/api/tts/say/status', (_req, res) => {
    res.json(sayTTSCapability);
  });

  // macOS 'say' command TTS speak endpoint
  app.post('/api/tts/say/speak', async (req, res) => {
    try {
      const { text, voice = 'Samantha', rate = 200 } = req.body || {};
      
      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Text is required' });
      }
      const { ttsService } = await getTtsModule();
      const result = await ttsService.generateSpeechStream({
        provider: 'say',
        text,
        voice,
        providerOptions: { rate },
      });
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Content-Length', result.buffer.length);
      res.send(result.buffer);
    } catch (error) {
      console.error('[TTS-Say] Error:', error);
      res.status(typeof error?.status === 'number' ? error.status : 500).json({
        error: error instanceof Error ? error.message : 'Say command failed'
      });
    }
  });

  // Server-side STT: receive raw audio, proxy to OpenAI-compatible transcription endpoint
  app.post(
    '/api/stt/transcribe',
    express.raw({ type: (req) => (req.headers['content-type'] || '').startsWith('audio/'), limit: '20mb' }),
    async (req, res) => {
      try {
        const { transcribeAudio } = await import('./stt.js');

        const mimeType = (req.headers['content-type'] || 'audio/webm').split(',')[0].trim();
        const baseURL = typeof req.headers['x-base-url'] === 'string' ? req.headers['x-base-url'].trim() : '';
        const model = typeof req.headers['x-model'] === 'string' && req.headers['x-model'].trim().length > 0
          ? req.headers['x-model'].trim()
          : 'deepdml/faster-whisper-large-v3-turbo-ct2';
        const language = typeof req.headers['x-language'] === 'string' && req.headers['x-language'].trim().length > 0
          ? req.headers['x-language'].trim()
          : undefined;

        if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
          return res.status(400).json({ error: 'Audio data is required' });
        }

        if (!baseURL) {
          return res.status(400).json({ error: 'X-Base-URL header is required' });
        }

        console.log('[STT] Transcribing audio:', {
          bytes: req.body.length,
          mimeType,
          model,
          baseURL,
          language,
        });

        const transcript = await transcribeAudio({
          audioBuffer: req.body,
          mimeType,
          model,
          baseURL,
          language,
        });

        console.log('[STT] Transcript:', transcript?.slice(0, 120));
        res.json({ transcript: transcript ?? '' });
      } catch (error) {
        console.error('[STT] Error:', error);
        if (!res.headersSent) {
          res.status(500).json({
            error: error instanceof Error ? error.message : 'Transcription failed',
          });
        }
      }
    }
  );
}
