# TTS Module Documentation

## Purpose

This module provides server-side Text-to-Speech services for OpenChamber via a provider registry backed by multiple adapters. Providers include:

- **edge-tts** — Microsoft Edge Read Aloud via `edge-tts-universal` (no API key, AGPL-3.0)
- **speech-sdk** — Multi-provider TTS via `@speech-sdk/core` (OpenAI, ElevenLabs, Deepgram, Cartesia, Google, Hume, Mistral, xAI, and more)
- **openai-compatible** — Any OpenAI-compatible `/audio/speech` endpoint (local or remote)
- **say** — macOS `say` command (darwin only)
- **browser** — client-side browser synthesis (no server synthesis; routing rejected with an error)

The legacy OpenAI-centric `service.js` remains the fallback for requests with no `provider` field and no client-supplied API key or `baseURL` (backward compatibility).

Shared text summarization lives in `packages/web/server/lib/text/` and is consumed here in `tts` mode.

## Entrypoints and structure

- `packages/web/server/lib/tts/index.js`: Public entrypoint imported by `packages/web/server/index.js`.
- `packages/web/server/lib/tts/routes.js`: Express route registration for `/api/voice/*`, `/api/tts/*`, and `/api/stt/*` endpoints.
- `packages/web/server/lib/tts/capability-runtime.js`: Runtime helper for probing local macOS `say` TTS voice capability.
- `packages/web/server/lib/tts/service.js`: Legacy TTS service implementation (OpenAI-only). Used as fallback for server-key-only requests.
- `packages/web/server/lib/tts/base-url.js`: Shared base URL validation and normalization for custom OpenAI-compatible endpoints.
- `packages/web/server/lib/tts/providers/index.js`: **Provider registry** — dispatches `generateTTS()` to the correct adapter.
- `packages/web/server/lib/tts/providers/speech-sdk.js`: `@speech-sdk/core` adapter (multi-provider).
- `packages/web/server/lib/tts/providers/edge-universal.js`: `edge-tts-universal` adapter (no API key).
- `packages/web/server/lib/tts/providers/openai-compatible.js`: OpenAI-compatible HTTP adapter.
- `packages/web/server/lib/tts/providers/say.js`: macOS `say` adapter.
- `packages/web/server/lib/text/summarization.js`: Shared text summarization and sanitization utilities using opencode.ai zen API.
- `packages/web/server/lib/tts/stt.js`: STT proxy for OpenAI-compatible transcription endpoints.

## API Routes

### `GET /api/tts/providers`

Returns metadata for all registered providers and their availability.

```json
{
  "providers": [
    {
      "id": "browser",
      "name": "Browser Speech Synthesis",
      "serverSide": false,
      "requiresApiKey": false,
      "available": true
    },
    {
      "id": "edge-tts",
      "name": "Edge TTS",
      "note": "edge-tts-universal is AGPL-3.0. Review license before distributing.",
      "serverSide": true,
      "requiresApiKey": false,
      "available": true
    },
    {
      "id": "speech-sdk",
      "name": "Speech SDK",
      "serverSide": true,
      "requiresApiKey": true,
      "available": true,
      "subProviders": [...]
    },
    {
      "id": "openai-compatible",
      "name": "OpenAI-compatible Endpoint",
      "serverSide": true,
      "requiresApiKey": false,
      "available": true
    },
    {
      "id": "say",
      "name": "macOS Say",
      "serverSide": true,
      "requiresApiKey": false,
      "available": false  // true only on macOS
    }
  ]
}
```

### `GET /api/tts/voices?provider=edge-tts&locale=en-US`

Returns voices for the specified provider. Currently only `provider=edge-tts` is supported.
Voices are cached with a short TTL to avoid repeated upstream fetches.

### `POST /api/tts/speak`

Generates TTS audio. Returns raw audio bytes (`audio/mpeg` or other content type).

**Backward compatible**: existing request bodies with `voice`, `model`, `speed`, `apiKey`, `baseURL` still work unchanged.

**New fields** (all optional):
- `provider`: Provider ID (`'browser'|'edge-tts'|'speech-sdk'|'openai-compatible'|'say'`). Omit for legacy auto-routing.
- `sdkProvider`: Sub-provider for `speech-sdk` (e.g. `'openai'`, `'elevenlabs'`).
- `pitch`: Pitch value for Edge TTS and browser TTS (0.5–2.0).
- `volume`: Volume value (0–1).
- `timestamps`: Boolean. If true, and provider supports it, word timestamps are computed.

When `timestamps=true` and timestamps were returned, the response includes `X-TTS-Has-Timestamps: 1` header.

**Backward compatibility routing**:
- If `provider` is omitted and `baseURL` is present → routes to `openai-compatible`.
- If `provider` is omitted, no `baseURL`, no client API key → routes through legacy `service.js` (uses server `OPENAI_API_KEY`).

## Provider registry (`providers/index.js`)

`generateTTS(req)` — dispatches to correct adapter.

```js
import { generateTTS, getProviderMetadata, listEdgeVoices } from './providers/index.js';

const result = await generateTTS({
  provider: 'edge-tts',
  voice: 'en-US-AvaNeural',
  text: 'Hello world',
  speed: 1.0,
  pitch: 1.0,
  volume: 1.0,
  timestamps: true,
});

// result: { audio: Buffer, contentType: 'audio/mpeg', provider: 'edge-tts', voice, timestamps: [{text, start, end}] }
```

## Speech SDK adapter (`providers/speech-sdk.js`)

Uses `@speech-sdk/core` for multi-provider TTS.

**Supported SDK providers**: `openai`, `elevenlabs`, `deepgram`, `cartesia`, `google`, `hume`, `mistral`, `xai`, `fish-audio`, `murf`, `resemble`, `fal`, `inworld`, `speech-gateway`.

**Key behavior**:
- Prefers direct provider factories (BYO keys) over Speech Gateway by default.
- Resolves API key: explicit client `apiKey` > matching env var (e.g. `OPENAI_API_KEY`).
- Passes `timestamps: true` when requested; returns `result.timestamps` (seconds, `{text, start, end}`).
- Handles `MissingApiKeyError`, `TimestampKeyMissingError`, `ApiError`, `SpeechSDKError` with stable user-facing messages (no secrets exposed).

## Edge TTS adapter (`providers/edge-universal.js`)

Uses `edge-tts-universal` server-side.

**⚠️ License**: `edge-tts-universal` is **AGPL-3.0**. Review license implications before distributing.

**Key behavior**:
- Default voice: `en-US-AvaNeural`. No API key required.
- Rate/pitch/volume are converted from OpenChamber numeric values to Edge TTS percent strings.
- Word boundaries (`WordBoundary` chunks) are converted to seconds: `start = offset / 10_000_000`, `end = (offset + duration) / 10_000_000`.
- Returns `contentType: 'audio/mpeg'`.
- Voice list is cached with a 5-minute TTL.

## OpenAI-compatible adapter (`providers/openai-compatible.js`)

Preserves existing custom endpoint behavior, renamed from OpenAI-centric.

**Key safety rules**:
- `normalizeCustomOpenAIBaseURL()` from `base-url.js` is applied before any request.
- Server `OPENAI_API_KEY` is never sent to arbitrary remote URLs.
- No timestamps returned by default (endpoint has no guarantee).

## macOS Say adapter (`providers/say.js`)

Preserved from prior implementation. Only available on `process.platform === 'darwin'`.

## Key resolution

Explicit `apiKey` in request body always takes precedence over server env vars.
**API keys from request body are not logged.**
No server env vars are leaked in responses.

## Remote URL safety

Custom `baseURL` values are validated by `normalizeCustomOpenAIBaseURL()` before use. Remote URLs are blocked unless explicitly allowed by configuration.

## Timestamp behavior

| Provider | Timestamps | Notes |
|---|---|---|
| `speech-sdk` | ✓ (where supported) | Seconds, `{text, start, end}`. `TimestampKeyMissingError` handled. |
| `edge-tts` | ✓ | Converted from 100ns `WordBoundary` events. |
| `openai-compatible` | ✗ | Not guaranteed by endpoint protocol. |
| `say` | ✗ | No word boundary data available. |
| `browser` | ✗ | Client-side only. |

## Backward compatibility

- All existing `/api/tts/speak` request shapes continue to work unchanged.
- `voiceProvider='openai'` in UI is migrated to `ttsProvider='speech-sdk'` with `ttsSpeechSdkProvider='openai'` on first load.
- `voiceProvider='openai-compatible'` → `ttsProvider='openai-compatible'`.
- `openaiCompatibleUrl` → `ttsBaseURL`.
- `openaiCompatibleVoice` → `ttsVoice`.
- `openaiCompatibleTtsModel` → `ttsModel`.

## Validation commands

```bash
bun run type-check
bun run lint
bun run build
```


## Public exports

### TTS Service (from service.js)
- `ttsService`: Singleton instance of TTSService class.
- `TTSService`: TTS service class for OpenAI audio generation.
- `TTS_VOICES`: Array of supported OpenAI voice identifiers.

### Shared text summarization (re-exported from ../text/summarization.js)
- `summarizeText({ text, threshold, maxLength, zenModel, mode })`: Shared text summarizer. TTS uses `mode: 'tts'`.
- `sanitizeForTTS(text)`: Sanitizes text by removing markdown, URLs, file paths, and other non-speakable content.
- `sanitizeForNote(text)`: Re-exported for note-mode callers that still import through the TTS surface.

### Capability runtime (capability-runtime.js)
- `detectSayTtsCapability(processLike)`: probes local `say -v "?"` support and returns `{ available, voices, reason }`.

## Constants

### Voice identifiers
- `TTS_VOICES`: Array of supported OpenAI voices: `['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar']`.

### Summarization defaults
- `SUMMARIZE_TIMEOUT_MS`: 30000 (30 seconds timeout for zen API requests).

### Default values
- `summarizeText` defaults: `threshold` = 200, `maxLength` = 500, `zenModel` = 'gpt-5-nano', `mode` = 'tts'.
- `generateSpeechStream` defaults: `voice` = 'coral', `model` = 'gpt-4o-mini-tts', `speed` = 1.0.
- `generateSpeechBuffer` defaults: `voice` = 'coral', `model` = 'gpt-4o-mini-tts', `speed` = 1.0.

## TTSService methods

### `isAvailable()`
Returns boolean indicating whether OpenAI API key is configured (checks environment variable `OPENAI_API_KEY` or OpenCode auth file).

### `generateSpeechStream(options)`
Generates speech and returns as a web stream for direct streaming to clients.
- Options: `text` (required), `voice`, `model`, `speed`, `instructions`, `apiKey`.
- Returns: `{ stream: ReadableStream, contentType: 'audio/mpeg' }`.
- Throws: Error if API key not configured or text is empty.

### `generateSpeechBuffer(options)`
Generates speech and returns as Buffer for caching purposes.
- Options: `text` (required), `voice`, `model`, `speed`, `instructions`.
- Returns: Buffer containing MP3 audio data.
- Throws: Error if API key not configured or text is empty.

## Response contracts

### `summarizeText`
Returns object with:
- `summary`: Sanitized summary text or original text (if not summarized).
- `summarized`: Boolean indicating if summarization was performed.
- `reason`: Optional string explaining why summarization was skipped (e.g., 'Text under threshold', 'Request timed out').
- `originalLength`: Optional number for original text length.
- `summaryLength`: Optional number for summarized text length.

The route-level text summarize API is now `/api/text/summarize`.

### `sanitizeForTTS`
Returns sanitized string with markdown, URLs, file paths, and special characters removed.

### `generateSpeechStream`
Returns object with:
- `stream`: ReadableStream of MP3 audio data.
- `contentType`: Always 'audio/mpeg'.

### `generateSpeechBuffer`
Returns Buffer containing MP3 audio data.

## API key resolution
OpenAI API keys are resolved in order:
1. Environment variable `OPENAI_API_KEY`.
2. OpenCode auth file (`auth.openai`, `auth.codex`, or `auth.chatgpt`).
3. Supports both string format (just token) and object format (with `access` or `token` fields).

## Usage in web server
The TTS module is used by `packages/web/server/index.js` for:
- Generating speech streams for client playback.
- Generating speech buffers for caching.
- Summarizing long messages before TTS synthesis.
- Sanitizing text to remove non-speakable content.

The summarization logic itself is shared with notifications and notes, but this module uses it only in `tts` mode.

The server-side TTS approach bypasses mobile Safari's audio context restrictions by generating audio on the server and streaming to clients.

## Notes for contributors

### Adding new TTS features
1. Add new methods to `packages/web/server/lib/tts/service.js` TTSService class.
2. Export public functions from `packages/web/server/lib/tts/index.js`.
3. Follow existing patterns for API key resolution and error handling.
4. Ensure all text is sanitized before TTS synthesis.
5. Consider adding new voice options to `TTS_VOICES` constant.

### Text sanitization
- Always call `sanitizeForTTS` on text before passing to TTS generation.
- The sanitization removes markdown, code blocks, URLs, file paths, shell commands, and special characters.
- This prevents the TTS from reading out technical formatting that sounds unnatural.

### Error handling
- `generateSpeechStream` and `generateSpeechBuffer` throw descriptive errors for missing API keys or empty text.
- `summarizeText` catches zen API errors and returns mode-specific fallback text with `summarized: false`.
- All errors are logged to console with `[TTSService]` or `[Summarize]` prefix.

### API key management
- TTSService caches OpenAI client instance and recreates when API key changes.
- API key changes are detected by comparing with `_lastApiKey` property.
- This allows dynamic API key updates without server restart.

### Testing
- Run `bun run type-check`, `bun run lint`, and `bun run build` before finalizing changes.
- Test API key resolution with environment variable and auth file.
- Test speech generation with various text lengths and voice options.
- Test summarization behavior above and below threshold.
- Test sanitization with markdown, URLs, and code blocks.
- Verify streaming and buffer generation produce valid MP3 audio.

## Verification notes

### Manual verification
1. Configure OpenAI API key via environment variable or OpenCode settings.
2. Test `ttsService.isAvailable()` returns true.
3. Call `ttsService.generateSpeechStream({ text: 'Hello world' })` and verify stream is returned.
4. Call `ttsService.generateSpeechBuffer({ text: 'Hello world' })` and verify Buffer is returned.
5. Test `summarizeText` with text above and below threshold.
6. Test `sanitizeForTTS` with markdown, URLs, and code blocks.

### API endpoint verification
1. Start web server and access TTS endpoint via client.
2. Verify audio plays correctly in browser.
3. Test on mobile Safari to verify bypass of audio context restrictions.
4. Test with long messages to verify summarization is triggered.
