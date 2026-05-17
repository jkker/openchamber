import { describe, expect, test } from 'bun:test';

import {
  estimateCharacterAlignment,
  timestampsToCharacterAlignment,
} from './timestamps';

describe('timestampsToCharacterAlignment', () => {
  test('converts word timestamps into monotonic character timings', () => {
    const alignment = timestampsToCharacterAlignment('Hello world', [
      { text: 'Hello', start: 0, end: 0.5 },
      { text: 'world', start: 0.6, end: 1.2 },
    ]);

    expect(alignment.characters.join('')).toBe('Hello world');
    expect(alignment.characterStartTimesSeconds[0]).toBe(0);
    expect(alignment.characterEndTimesSeconds.at(-1)).toBe(1.2);
    for (let index = 1; index < alignment.characters.length; index += 1) {
      expect(
        alignment.characterStartTimesSeconds[index]! >= alignment.characterStartTimesSeconds[index - 1]!,
      ).toBe(true);
      expect(
        alignment.characterEndTimesSeconds[index]! >= alignment.characterStartTimesSeconds[index]!,
      ).toBe(true);
    }
  });

  test('preserves punctuation and spaces in the visible transcript', () => {
    const alignment = timestampsToCharacterAlignment('Hello, world!', [
      { text: 'Hello', start: 0, end: 0.5 },
      { text: 'world', start: 0.6, end: 1.2 },
    ]);

    expect(alignment.characters.join('')).toBe('Hello, world!');
  });

  test('falls back to an estimated alignment when timestamps are absent', () => {
    const alignment = estimateCharacterAlignment('Estimated fallback', 4);

    expect(alignment.characters.join('')).toBe('Estimated fallback');
    expect(alignment.characterStartTimesSeconds[0]).toBe(0);
    expect(alignment.characterEndTimesSeconds.at(-1)).toBe(4);
  });
});
