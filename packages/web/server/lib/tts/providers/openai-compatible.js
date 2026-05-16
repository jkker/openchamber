/**
 * OpenAI-compatible TTS provider adapter.
 *
 * Routes requests to any OpenAI-compatible /audio/speech endpoint, including
 * local servers such as Kokoro, Speaches, or remote OpenAI. Preserves the
 * remote-URL safety check enforced by base-url.js.
 */

import OpenAI from 'openai';
import { normalizeCustomOpenAIBaseURL } from '../base-url.js';

/**
 * @param {object} req
 * @param {string} req.voice
 * @param {string} req.text
 * @param {string} [req.model]
 * @param {number} [req.speed]
 * @param {string} [req.instructions]
 * @param {string} [req.apiKey]
 * @param {string} [req.baseURL]
 * @returns {Promise<{audio: Buffer, contentType: string, provider: string, model: string, voice: string}>}
 */
export async function generateOpenAICompatible(req) {
  const {
    voice = 'nova',
    text,
    model = 'gpt-4o-mini-tts',
    speed = 1.0,
    instructions,
    apiKey,
    baseURL,
  } = req;

  const normalizedResult = normalizeCustomOpenAIBaseURL(baseURL);
  if (normalizedResult.error) {
    throw new Error(normalizedResult.error);
  }
  const normalizedBaseURL = normalizedResult.value;

  const clientOpts = {};
  if (apiKey && typeof apiKey === 'string' && apiKey.trim().length > 0) {
    clientOpts.apiKey = apiKey.trim();
  } else {
    clientOpts.apiKey = 'not-required';
  }
  if (normalizedBaseURL) {
    clientOpts.baseURL = normalizedBaseURL;
  }

  const client = new OpenAI(clientOpts);

  // OpenAI-compatible servers (custom baseURL) may not support `instructions`
  // or `response_format`, but do support `speed`.
  const speechParams = normalizedBaseURL
    ? { model, voice, input: text, speed }
    : {
        model,
        voice,
        input: text,
        speed,
        ...(instructions && { instructions }),
        response_format: 'mp3',
      };

  console.log('[TTS/openai-compatible] model:', model, 'voice:', voice, 'baseURL:', normalizedBaseURL ?? '(openai)');
  const response = await client.audio.speech.create(speechParams);
  const arrayBuffer = await response.arrayBuffer();

  return {
    audio: Buffer.from(arrayBuffer),
    contentType: 'audio/mpeg',
    provider: 'openai-compatible',
    model,
    voice,
  };
}
