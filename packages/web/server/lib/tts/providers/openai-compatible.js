import OpenAI from 'openai';

export function createOpenAICompatibleTtsProvider({
  getOpenAIApiKey,
}) {
  return {
    id: 'openai-compatible',
    label: 'OpenAI-compatible endpoint',
    kind: 'server',
    requiresApiKey: false,
    supportsVoices: false,
    supportsTimestamps: false,
    defaultModel: 'kokoro',
    defaultVoice: 'af_sky',
    isConfigured() {
      return Boolean(getOpenAIApiKey());
    },
    async synthesize(request) {
      const client = new OpenAI({
        apiKey: request.apiKey || 'not-required',
        ...(request.baseURL ? { baseURL: request.baseURL } : {}),
      });

      const params = request.baseURL
        ? {
            model: request.model,
            voice: request.voice,
            input: request.text,
            speed: request.speed,
          }
        : {
            model: request.model,
            voice: request.voice,
            input: request.text,
            speed: request.speed,
            ...(request.instructions ? { instructions: request.instructions } : {}),
            response_format: 'mp3',
          };

      const response = await client.audio.speech.create(params);
      const arrayBuffer = await response.arrayBuffer();

      return {
        audio: Buffer.from(arrayBuffer),
        contentType: 'audio/mpeg',
        provider: this.id,
        model: request.model,
        voice: request.voice,
      };
    },
  };
}
