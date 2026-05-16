# TTS Module Documentation

## Purpose

This module provides provider-agnostic server-side text-to-speech for OpenChamber.
It preserves the existing OpenAI-compatible `/api/tts/speak` contract, adds a provider registry,
and exposes first-class Edge TTS synthesis with word timestamps.

## Entrypoints and structure

- `packages/web/server/lib/tts/index.js`: public entrypoint.
- `packages/web/server/lib/tts/routes.js`: thin Express routes for `/api/tts/*`, `/api/stt/*`, and summarization helpers.
- `packages/web/server/lib/tts/service.js`: orchestration surface used by routes.
- `packages/web/server/lib/tts/base-url.js`: OpenAI-compatible base URL validation and remote-host safety.
- `packages/web/server/lib/tts/capability-runtime.js`: cached macOS `say` capability probe.
- `packages/web/server/lib/tts/providers/index.js`: provider registry and request normalization.
- `packages/web/server/lib/tts/providers/speech-sdk.js`: `@speech-sdk/core` adapter for direct-provider and explicit gateway routing.
- `packages/web/server/lib/tts/providers/edge-universal.js`: `edge-tts-universal` adapter with voice caching and `WordBoundary` timestamps.
- `packages/web/server/lib/tts/providers/openai-compatible.js`: OpenAI-compatible HTTP adapter.
- `packages/web/server/lib/tts/providers/say.js`: macOS `say` adapter.
- `packages/web/server/lib/tts/stt.js`: STT proxy for OpenAI-compatible transcription endpoints.
- `packages/web/server/lib/text/summarization.js`: shared summarization and TTS sanitization.

## Provider registry

The internal provider ids are:

- `speech-sdk`
- `edge-tts`
- `openai-compatible`
- `say`

Routes also expose a client-only `browser` entry in `/api/tts/providers` so the shared UI can present the full TTS menu.

`resolveTtsRequest()` normalizes incoming payloads onto the internal contract and keeps the following compatibility behavior:

- if `provider` is omitted and `baseURL` is set, route to `openai-compatible`
- if `provider` is omitted and no `baseURL` is set, route to `speech-sdk` with the OpenAI provider
- legacy `voice`, `model`, `speed`, `apiKey`, and `baseURL` request bodies still work

## Public service API

### `ttsService.isAvailable()`

Returns whether the legacy default OpenAI path is server-configured via `OPENAI_API_KEY` or OpenCode auth.

### `ttsService.listProviders({ sayTTSCapability })`

Returns metadata for browser, Speech SDK, Edge TTS, OpenAI-compatible, and Say.
Metadata includes availability, configuration booleans, default model/voice, and Speech SDK sub-provider status.

### `ttsService.listVoices({ provider, locale, gender, sayTTSCapability })`

Lists normalized voices for providers that support it.

- `edge-tts`: supports locale and gender filtering
- `say`: returns the cached startup probe voices
- `speech-sdk` / `openai-compatible`: currently return an empty list because they do not expose a stable generic voice catalog here

### `ttsService.generateSpeechStream(options)`

Normalizes a request, dispatches it through the provider registry, and returns:

- `buffer`
- `contentType`
- `provider`
- `model`
- `voice`
- `timestamps?`
- `warnings?`

### `ttsService.generateSpeechBuffer(options)`

Compatibility helper that returns only the synthesized `Buffer`.

## Routes

### `GET /api/tts/providers`

Returns provider metadata for the TTS settings UI.

### `GET /api/tts/voices?provider=edge-tts&locale=en-US&gender=Female`

Returns normalized voice metadata for providers that support listing.

### `POST /api/tts/speak`

Backwards-compatible binary audio response by default.

Accepted fields include:

- `provider`
- `speechSdkProvider`
- `voice`
- `model`
- `speed`
- `pitch`
- `volume`
- `timestamps`
- `providerOptions`
- `apiKeyMode`
- `apiKey`
- `baseURL`
- legacy summarization fields (`summarize`, `threshold`, `maxLength`, `providerId`, `modelId`, `zenModel`)

If `returnMetadata: true` is passed, the route returns JSON with:

- `audioBase64`
- `contentType`
- `provider`
- `model`
- `voice`
- `timestamps?`
- `warnings?`

### `GET /api/tts/status`

Legacy status route retained for existing clients. It now also includes provider metadata.

### `POST /api/tts/say/speak`

Retained for existing macOS Say callers, but it now delegates through the provider registry.

## Speech SDK behavior

`packages/web/server/lib/tts/providers/speech-sdk.js` uses `@speech-sdk/core` as the compatibility layer.

- Direct provider factories are preferred by default.
- Explicit gateway routing is enabled only when `apiKeyMode === 'gateway'`.
- Supported provider ids currently include OpenAI, ElevenLabs, Deepgram, Cartesia, Google, Hume, Fish Audio, Murf, Resemble, fal, Mistral, xAI, and Inworld.
- When `timestamps: true` is enabled, returned timestamps are passed through unchanged from Speech SDK.

Error mapping:

- `MissingApiKeyError` → deterministic 503 without secret leakage
- `TimestampKeyMissingError` → deterministic 400 explaining fallback STT key requirements
- `ApiError` → provider request failure with status/code only
- other `SpeechSDKError`s → deterministic 400

## Edge TTS behavior

`packages/web/server/lib/tts/providers/edge-universal.js` uses `edge-tts-universal` server-side only.

- default model: `edge-tts-universal`
- default voice: `en-US-AvaNeural`
- no API key required
- voice lists are cached with a short TTL
- `WordBoundary.offset` and `duration` values are converted from 100ns units to seconds
- responses are returned as `audio/mpeg`

## OpenAI-compatible safety

`normalizeCustomOpenAIBaseURL()` is still the source of truth for remote URL safety.

- only local loopback-style hosts are allowed by default
- remote hosts remain blocked unless `OPENCHAMBER_ALLOW_REMOTE_OPENAI_COMPAT_URLS=true`
- server OpenAI credentials are not forwarded to arbitrary remote base URLs automatically
- when a custom endpoint does not need a key, the adapter uses `apiKey: 'not-required'`

## Secrets

- API key presence is surfaced only via booleans/status labels
- TTS routes do not echo or log raw API keys
- error responses avoid returning sensitive upstream headers or credentials

## License note

`edge-tts-universal` is licensed under AGPL-3.0.
That license constraint applies to the current implementation and should be reviewed by maintainers as part of release and distribution decisions.

## Verification

Required repository validation:

```bash
bun run type-check
bun run lint
bun run build
```

Targeted backend tests added for:

- provider request normalization
- Speech SDK direct vs gateway dispatch
- Edge TTS timestamp conversion and voice filtering
- provider/status/metadata route behavior
