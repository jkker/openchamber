import { afterEach, describe, expect, it, vi } from 'vitest';

const listVoicesUniversal = vi.fn();
const streamMock = vi.fn();

vi.mock('edge-tts-universal', () => ({
  listVoicesUniversal,
  UniversalCommunicate: vi.fn().mockImplementation(() => ({
    stream: streamMock,
  })),
}));

const { clearEdgeVoiceCacheForTests, createEdgeUniversalTtsProvider } = await import('./edge-universal.js');

describe('edge universal tts provider', () => {
  afterEach(() => {
    clearEdgeVoiceCacheForTests();
    listVoicesUniversal.mockReset();
    streamMock.mockReset();
  });

  it('filters voices by locale and gender', async () => {
    listVoicesUniversal.mockResolvedValue([
      { ShortName: 'en-US-AvaNeural', Locale: 'en-US', Gender: 'Female', FriendlyName: 'Ava' },
      { ShortName: 'en-GB-RyanNeural', Locale: 'en-GB', Gender: 'Male', FriendlyName: 'Ryan' },
    ]);

    const provider = createEdgeUniversalTtsProvider();
    const voices = await provider.listVoices({ locale: 'en-US', gender: 'female' });

    expect(voices).toEqual([
      {
        id: 'en-US-AvaNeural',
        name: 'Ava',
        shortName: 'en-US-AvaNeural',
        locale: 'en-US',
        gender: 'Female',
        label: 'en-US-AvaNeural (en-US)',
      },
    ]);
  });

  it('converts WordBoundary offsets into second timestamps', async () => {
    streamMock.mockReturnValue((async function* stream() {
      yield { type: 'WordBoundary', text: 'Hello', offset: 2_000_000, duration: 3_000_000 };
      yield { type: 'audio', data: new Uint8Array([1, 2, 3]) };
    })());

    const provider = createEdgeUniversalTtsProvider();
    const result = await provider.synthesize({
      text: 'Hello',
      voice: 'en-US-AvaNeural',
      model: 'edge-tts-universal',
      speed: 1,
      pitch: 1,
      volume: 1,
    });

    expect(Array.from(result.audio)).toEqual([1, 2, 3]);
    expect(result.timestamps).toEqual([
      { text: 'Hello', start: 0.2, end: 0.5 },
    ]);
  });
});
