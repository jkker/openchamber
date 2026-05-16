/**
 * Edge TTS Universal provider adapter.
 *
 * Uses `edge-tts-universal` for server-side TTS synthesis via the Microsoft
 * Edge Read Aloud service. No API key required.
 *
 * LICENSE NOTE: edge-tts-universal is AGPL-3.0. This file is server-only and
 * is never bundled into the browser client. Review license implications before
 * distributing OpenChamber binaries that include this module.
 */

import { UniversalCommunicate, listVoicesUniversal } from 'edge-tts-universal';

const DEFAULT_VOICE = 'en-US-AvaNeural';

/** TTL for voice list cache (5 minutes). */
const VOICE_LIST_TTL_MS = 5 * 60 * 1000;
let _voiceCache = null;
let _voiceCacheAt = 0;

/**
 * Convert an OpenChamber speech-rate multiplier (0.5–2.0) to Edge TTS
 * percent-delta string (e.g., "+20%" / "-50%").
 * @param {number|undefined} rate
 * @returns {string}
 */
function rateToEdgePercent(rate) {
  if (typeof rate !== 'number') return '+0%';
  // Clamp to 0.25–4.0 range
  const clamped = Math.max(0.25, Math.min(4.0, rate));
  const percent = Math.round((clamped - 1.0) * 100);
  return percent >= 0 ? `+${percent}%` : `${percent}%`;
}

/**
 * Convert an OpenChamber pitch multiplier (0.5–2.0) to Edge TTS
 * percent-delta string (e.g., "+10Hz" style, relative).
 * Edge TTS uses "+NHz" relative pitch; we approximate via ratio.
 * @param {number|undefined} pitch
 * @returns {string}
 */
function pitchToEdge(pitch) {
  if (typeof pitch !== 'number') return '+0Hz';
  const clamped = Math.max(0.5, Math.min(2.0, pitch));
  const hz = Math.round((clamped - 1.0) * 50);
  return hz >= 0 ? `+${hz}Hz` : `${hz}Hz`;
}

/**
 * Convert an OpenChamber volume (0–1) to Edge TTS percent-delta string.
 * @param {number|undefined} volume
 * @returns {string}
 */
function volumeToEdgePercent(volume) {
  if (typeof volume !== 'number') return '+0%';
  const clamped = Math.max(0.0, Math.min(1.0, volume));
  const percent = Math.round((clamped - 1.0) * 100);
  return percent >= 0 ? `+${percent}%` : `${percent}%`;
}

/**
 * Generate speech using Edge TTS Universal.
 *
 * @param {object} req
 * @param {string} req.text
 * @param {string} [req.voice]
 * @param {number} [req.speed]
 * @param {number} [req.pitch]
 * @param {number} [req.volume]
 * @param {boolean} [req.timestamps]
 * @returns {Promise<{audio: Buffer, contentType: string, provider: string, voice: string, timestamps?: Array<{text:string,start:number,end:number}>}>}
 */
export async function generateEdgeTTS(req) {
  const {
    text,
    voice = DEFAULT_VOICE,
    speed,
    pitch,
    volume,
    timestamps: wantTimestamps = false,
  } = req;

  const rate = rateToEdgePercent(speed);
  const pitchStr = pitchToEdge(pitch);
  const volumeStr = volumeToEdgePercent(volume);

  const communicate = new UniversalCommunicate(text, {
    voice,
    rate,
    pitch: pitchStr,
    volume: volumeStr,
  });

  const audioChunks = [];
  const wordBoundaries = [];

  for await (const chunk of communicate.stream()) {
    if (chunk.type === 'audio') {
      audioChunks.push(Buffer.from(chunk.data));
    } else if (chunk.type === 'WordBoundary') {
      if (wantTimestamps) {
        // offset and duration are in 100-nanosecond units
        const start = chunk.offset / 10_000_000;
        const end = (chunk.offset + chunk.duration) / 10_000_000;
        wordBoundaries.push({ text: chunk.text, start, end });
      }
    }
  }

  const audio = Buffer.concat(audioChunks);
  if (audio.length === 0) {
    throw new Error('Edge TTS returned empty audio');
  }

  return {
    audio,
    contentType: 'audio/mpeg',
    provider: 'edge-tts',
    voice,
    ...(wantTimestamps && wordBoundaries.length > 0 ? { timestamps: wordBoundaries } : {}),
  };
}

/**
 * Return cached (or freshly fetched) list of Edge TTS voices.
 * @param {{locale?: string, gender?: string}} [filter]
 * @returns {Promise<Array<{Name:string,ShortName:string,Gender:string,Locale:string,FriendlyName:string}>>}
 */
export async function listEdgeVoices(filter = {}) {
  const now = Date.now();
  if (!_voiceCache || now - _voiceCacheAt > VOICE_LIST_TTL_MS) {
    try {
      const voices = await listVoicesUniversal();
      _voiceCache = Array.isArray(voices) ? voices : [];
      _voiceCacheAt = now;
    } catch (err) {
      console.warn('[TTS/edge] Failed to fetch voice list:', err.message);
      _voiceCache = _voiceCache ?? [];
    }
  }

  let result = _voiceCache;
  if (filter.locale) {
    const loc = filter.locale.toLowerCase();
    result = result.filter((v) => (v.Locale || v.locale || '').toLowerCase().startsWith(loc));
  }
  if (filter.gender) {
    const g = filter.gender.toLowerCase();
    result = result.filter((v) => (v.Gender || v.gender || '').toLowerCase() === g);
  }
  return result;
}
