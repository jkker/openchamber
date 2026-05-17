import { beforeEach, describe, expect, test } from 'bun:test';

import { useSpeechPlaybackStore } from './useSpeechPlaybackStore';

describe('useSpeechPlaybackStore', () => {
  beforeEach(() => {
    useSpeechPlaybackStore.setState({
      panelState: 'closed',
      activeItem: null,
      queue: [],
      textMode: 'summary',
      autoPlayNonce: 0,
      audioUrl: null,
      contentType: null,
      transcriptText: '',
      timestamps: null,
      alignmentEstimated: false,
      providerLabel: '',
      modelLabel: '',
      voiceLabel: '',
      warningLabel: null,
      isGenerating: false,
      error: null,
      floatingPosition: null,
    });
  });

  test('opens, collapses, and closes playback state', () => {
    const store = useSpeechPlaybackStore.getState();
    store.openForItem({ messageId: 'm1', sessionId: 's1', originalText: 'Hello' });
    expect(useSpeechPlaybackStore.getState().panelState).toBe('expanded');

    useSpeechPlaybackStore.getState().collapsePanel();
    expect(useSpeechPlaybackStore.getState().panelState).toBe('collapsed');

    useSpeechPlaybackStore.getState().closePanel();
    expect(useSpeechPlaybackStore.getState().panelState).toBe('closed');
    expect(useSpeechPlaybackStore.getState().activeItem).toBeNull();
  });

  test('drops empty queue items and clears missing active items', () => {
    const store = useSpeechPlaybackStore.getState();
    store.openForItem({ messageId: 'keep', sessionId: 's1', originalText: 'Hello' }, false);
    store.setQueue([
      { messageId: 'keep', sessionId: 's1', originalText: 'Hello' },
      { messageId: 'empty', sessionId: 's1', originalText: '   ' },
    ]);

    expect(useSpeechPlaybackStore.getState().queue).toHaveLength(1);

    store.setQueue([]);
    expect(useSpeechPlaybackStore.getState().activeItem).toBeNull();
    expect(useSpeechPlaybackStore.getState().panelState).toBe('closed');
  });
});
