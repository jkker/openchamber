/**
 * TTS Provider Registry
 *
 * Dispatches TTS synthesis requests to the appropriate backend adapter based on
 * the `provider` field. Keeps routes.js thin.
 *
 * Supported provider IDs:
 *   'openai-compatible' — OpenAI-compatible HTTP endpoint (local or remote with flag)
 *   'speech-sdk'        — @speech-sdk/core multi-provider (openai, elevenlabs, etc.)
 *   'edge-tts'          — edge-tts-universal (no API key, AGPL-3.0)
 *   'say'               — macOS `say` command (darwin only)
 *   'browser'           — client-side; no server synthesis needed
 */

import { generateOpenAICompatible } from './openai-compatible.js';
import { generateEdgeTTS, listEdgeVoices } from './edge-universal.js';
import { generateSpeechSdk, listSpeechSdkProviders } from './speech-sdk.js';
import { generateSay } from './say.js';
import { normalizeCustomOpenAIBaseURL } from '../base-url.js';

/**
 * @typedef {object} GenerateTtsRequest
 * @property {string} [provider]         TTS provider ID
 * @property {string} [sdkProvider]      Sub-provider for 'speech-sdk' (e.g. 'openai')
 * @property {string} [model]            Model ID
 * @property {string} [voice]            Voice ID
 * @property {string} text               Text to synthesize
 * @property {number} [speed]            Speech rate multiplier
 * @property {number} [pitch]            Pitch multiplier
 * @property {number} [volume]           Volume (0–1)
 * @property {boolean} [timestamps]      Whether to include word timestamps
 * @property {string} [apiKey]           Client-supplied API key
 * @property {string} [baseURL]          Base URL for openai-compatible provider
 * @property {string} [instructions]     Voice instructions (OpenAI only)
 */

/**
 * Generate TTS audio using the specified provider.
 *
 * Falls back to 'openai-compatible' when:
 * - No provider is specified but a baseURL is present (backward compat).
 * - No provider is specified and no baseURL is present (legacy OpenAI default).
 *
 * @param {GenerateTtsRequest} req
 * @returns {Promise<{audio: Buffer, contentType: string, provider: string, model?: string, voice: string, timestamps?: Array<{text:string,start:number,end:number}>, warnings?: string[]}>}
 */
export async function generateTTS(req) {
  let { provider } = req;

  // Backward-compat routing: if no explicit provider, infer from request shape.
  if (!provider) {
    if (req.baseURL) {
      provider = 'openai-compatible';
    } else {
      // Legacy default: OpenAI via service.js — route to openai-compatible with no baseURL.
      provider = 'openai-compatible';
    }
  }

  switch (provider) {
    case 'browser':
      // Browser synthesis is client-side; should not reach the server.
      throw new Error('Browser TTS is handled client-side and does not use a server endpoint.');

    case 'edge-tts':
      return generateEdgeTTS(req);

    case 'speech-sdk':
      return generateSpeechSdk(req);

    case 'openai-compatible':
      return generateOpenAICompatible(req);

    case 'say':
      return generateSay(req);

    default:
      throw new Error(`Unknown TTS provider: ${provider}`);
  }
}

/**
 * Return metadata for all registered providers and their availability.
 */
export function getProviderMetadata() {
  const isMacOS = process.platform === 'darwin';

  return [
    {
      id: 'browser',
      name: 'Browser Speech Synthesis',
      description: 'Uses built-in browser TTS. No API key or server required.',
      serverSide: false,
      requiresApiKey: false,
      available: true,
    },
    {
      id: 'edge-tts',
      name: 'Edge TTS',
      description: 'Microsoft Edge Read Aloud. No API key required. Runs on server.',
      note: 'edge-tts-universal is AGPL-3.0. Review license before distributing.',
      serverSide: true,
      requiresApiKey: false,
      available: true,
    },
    {
      id: 'speech-sdk',
      name: 'Speech SDK',
      description: 'Multi-provider TTS via @speech-sdk/core (OpenAI, ElevenLabs, Deepgram, …).',
      serverSide: true,
      requiresApiKey: true,
      available: true,
      subProviders: listSpeechSdkProviders(),
    },
    {
      id: 'openai-compatible',
      name: 'OpenAI-compatible Endpoint',
      description: 'Any OpenAI-compatible /audio/speech server (e.g. Kokoro, Speaches).',
      serverSide: true,
      requiresApiKey: false,
      available: true,
    },
    {
      id: 'say',
      name: 'macOS Say',
      description: 'macOS built-in text-to-speech via the `say` command.',
      serverSide: true,
      requiresApiKey: false,
      available: isMacOS,
    },
  ];
}

export { listEdgeVoices, listSpeechSdkProviders, normalizeCustomOpenAIBaseURL };
