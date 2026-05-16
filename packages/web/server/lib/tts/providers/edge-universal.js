import { UniversalCommunicate, listVoicesUniversal } from 'edge-tts-universal';

const EDGE_VOICE_CACHE_TTL_MS = 5 * 60 * 1000;
const EDGE_DEFAULT_VOICE = 'en-US-AvaNeural';
const EDGE_DEFAULT_MODEL = 'edge-tts-universal';

let edgeVoiceCache = null;

const normalizeEdgeRate = (value) => {
  const clamped = Math.max(0.5, Math.min(2, Number.isFinite(value) ? value : 1));
  const delta = Math.round((clamped - 1) * 100);
  return `${delta >= 0 ? '+' : ''}${delta}%`;
};

const normalizeEdgePitch = (value) => {
  const clamped = Math.max(0.5, Math.min(2, Number.isFinite(value) ? value : 1));
  const delta = Math.round((clamped - 1) * 100);
  return `${delta >= 0 ? '+' : ''}${delta}Hz`;
};

const normalizeEdgeVolume = (value) => {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
  const delta = Math.round((clamped - 1) * 100);
  return `${delta >= 0 ? '+' : ''}${delta}%`;
};

const normalizeVoice = (voice) => ({
  id: voice.ShortName,
  name: voice.FriendlyName || voice.Name || voice.ShortName,
  shortName: voice.ShortName,
  locale: voice.Locale,
  gender: voice.Gender,
  label: `${voice.ShortName} (${voice.Locale})`,
});

export function clearEdgeVoiceCacheForTests() {
  edgeVoiceCache = null;
}

async function getCachedVoices() {
  const now = Date.now();
  if (edgeVoiceCache && now - edgeVoiceCache.loadedAt < EDGE_VOICE_CACHE_TTL_MS) {
    return edgeVoiceCache.voices;
  }

  const voices = await listVoicesUniversal();
  edgeVoiceCache = {
    loadedAt: now,
    voices,
  };
  return voices;
}

export function createEdgeUniversalTtsProvider() {
  return {
    id: 'edge-tts',
    label: 'Edge TTS',
    kind: 'server',
    requiresApiKey: false,
    supportsVoices: true,
    supportsTimestamps: true,
    license: 'AGPL-3.0',
    defaultModel: EDGE_DEFAULT_MODEL,
    defaultVoice: EDGE_DEFAULT_VOICE,
    isConfigured() {
      return true;
    },
    async listVoices({ locale, gender } = {}) {
      const voices = await getCachedVoices();
      const normalizedLocale = typeof locale === 'string' ? locale.trim().toLowerCase() : '';
      const normalizedGender = typeof gender === 'string' ? gender.trim().toLowerCase() : '';

      return voices
        .filter((voice) => {
          if (normalizedLocale && !voice.Locale?.toLowerCase().startsWith(normalizedLocale)) {
            return false;
          }
          if (normalizedGender && voice.Gender?.toLowerCase() !== normalizedGender) {
            return false;
          }
          return true;
        })
        .map(normalizeVoice);
    },
    async synthesize(request) {
      const communicate = new UniversalCommunicate(request.text, {
        voice: request.voice || EDGE_DEFAULT_VOICE,
        rate: normalizeEdgeRate(request.speed),
        pitch: normalizeEdgePitch(request.pitch),
        volume: normalizeEdgeVolume(request.volume),
      });

      const audioChunks = [];
      const timestamps = [];

      for await (const chunk of communicate.stream()) {
        if (chunk.type === 'audio' && chunk.data) {
          audioChunks.push(Buffer.from(chunk.data));
          continue;
        }

        if (chunk.type === 'WordBoundary') {
          timestamps.push({
            text: chunk.text,
            start: chunk.offset / 10_000_000,
            end: (chunk.offset + chunk.duration) / 10_000_000,
          });
        }
      }

      const audio = Buffer.concat(audioChunks);
      if (audio.length === 0) {
        throw new Error('Edge TTS returned no audio data');
      }

      return {
        audio,
        contentType: 'audio/mpeg',
        provider: this.id,
        model: request.model || EDGE_DEFAULT_MODEL,
        voice: request.voice || EDGE_DEFAULT_VOICE,
        timestamps,
      };
    },
  };
}
