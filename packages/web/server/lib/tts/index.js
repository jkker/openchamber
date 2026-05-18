/**
 * TTS Module Entry Point
 *
 * Public export surface for the Text-to-Speech domain module.
 */

export {
  ttsService,
  TTSService,
  TTSServiceError,
  TTS_VOICES,
  resolveTtsRequest,
} from './service.js';

export {
  summarizeText,
  sanitizeForTTS,
  sanitizeForNote,
} from '../text/summarization.js';

export { transcribeAudio } from './stt.js';
