import { describe, expect, test } from 'bun:test';

import {
  buildSpeechPlaybackCacheKey,
  getAdjacentPlaybackItem,
  getDictationPlaybackAction,
  type SpeechPlaybackItem,
} from './speechPlayback';

const queue: SpeechPlaybackItem[] = [
  { messageId: 'm1', sessionId: 's1', originalText: 'First' },
  { messageId: 'm2', sessionId: 's1', originalText: 'Second' },
  { messageId: 'm3', sessionId: 's1', originalText: 'Third' },
];

describe('speech playback helpers', () => {
  test('creates distinct cache keys for text mode and config changes', () => {
    expect(buildSpeechPlaybackCacheKey('m1', 'summary', 'a')).not.toBe(
      buildSpeechPlaybackCacheKey('m1', 'original', 'a'),
    );
    expect(buildSpeechPlaybackCacheKey('m1', 'summary', 'a')).not.toBe(
      buildSpeechPlaybackCacheKey('m1', 'summary', 'b'),
    );
  });

  test('navigates previous and next queue items with boundaries', () => {
    expect(getAdjacentPlaybackItem(queue, 'm2', -1)?.messageId).toBe('m1');
    expect(getAdjacentPlaybackItem(queue, 'm2', 1)?.messageId).toBe('m3');
    expect(getAdjacentPlaybackItem(queue, 'm1', -1)).toBeNull();
    expect(getAdjacentPlaybackItem(queue, 'm3', 1)).toBeNull();
  });

  test('chooses dictation actions that avoid playback feedback loops', () => {
    expect(getDictationPlaybackAction('idle', false)).toBe('start-dictation');
    expect(getDictationPlaybackAction('listening', true)).toBe('finish-dictation');
    expect(getDictationPlaybackAction('processing', false)).toBe('stop-dictation');
  });
});
