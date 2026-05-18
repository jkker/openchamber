export interface WordTimestamp {
  text: string;
  start: number;
  end: number;
}

export interface CharacterAlignmentResponseModel {
  characters: string[];
  characterStartTimesSeconds: number[];
  characterEndTimesSeconds: number[];
}

const DEFAULT_CHARS_PER_SECOND = 14;
const getLastTimestampEnd = (timestamps: WordTimestamp[]) => timestamps[timestamps.length - 1]?.end;

const clampTime = (value: number, fallback = 0) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, value);
};

const distributeInterval = (
  text: string,
  start: number,
  end: number,
  starts: number[],
  ends: number[],
  characters: string[],
) => {
  if (text.length === 0) {
    return;
  }

  const safeStart = clampTime(start);
  const safeEnd = Math.max(safeStart, clampTime(end, safeStart));
  const duration = safeEnd - safeStart;
  const step = text.length > 0 ? duration / text.length : 0;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character == null) {
      break;
    }
    characters.push(character);
    const charStart = safeStart + (step * index);
    const charEnd = index === text.length - 1 ? safeEnd : safeStart + (step * (index + 1));
    starts.push(charStart);
    ends.push(Math.max(charStart, charEnd));
  }
};

const findTimestampWordStart = (text: string, word: string, fromIndex: number): number => {
  if (!word) return -1;

  const directMatch = text.indexOf(word, fromIndex);
  if (directMatch >= 0) {
    return directMatch;
  }

  // Some providers preserve timing but normalize transcript casing differently than
  // the visible message text. Fall back to case-insensitive matching so alignment
  // still succeeds for common "Hello" vs "hello" differences.
  return text.toLowerCase().indexOf(word.toLowerCase(), fromIndex);
};

export const estimatePlaybackDuration = (text: string, rate = 1): number => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return 0;
  const charsPerSecond = Math.max(4, DEFAULT_CHARS_PER_SECOND * Math.max(0.5, Math.min(2, rate)));
  return normalized.length / charsPerSecond;
};

export const estimateCharacterAlignment = (
  text: string,
  durationSeconds?: number,
): CharacterAlignmentResponseModel => {
  const characters: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const totalDuration = Math.max(0, durationSeconds ?? estimatePlaybackDuration(text));

  distributeInterval(text, 0, totalDuration, starts, ends, characters);

  return {
    characters,
    characterStartTimesSeconds: starts,
    characterEndTimesSeconds: ends,
  };
};

export const timestampsToCharacterAlignment = (
  text: string,
  timestamps: WordTimestamp[] | null | undefined,
  options?: {
    audioDurationSeconds?: number;
  },
): CharacterAlignmentResponseModel => {
  if (!timestamps || timestamps.length === 0) {
    return estimateCharacterAlignment(text, options?.audioDurationSeconds);
  }

  const characters: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let cursor = 0;
  let previousEnd = 0;

  for (const timestamp of timestamps) {
    const wordText = timestamp.text ?? '';
    const startIndex = findTimestampWordStart(text, wordText, cursor);
    if (startIndex < 0) {
      return estimateCharacterAlignment(text, options?.audioDurationSeconds ?? getLastTimestampEnd(timestamps));
    }

    const gap = text.slice(cursor, startIndex);
    if (gap.length > 0) {
      distributeInterval(gap, previousEnd, timestamp.start, starts, ends, characters);
    }

    const matchedWord = text.slice(startIndex, startIndex + wordText.length);
    distributeInterval(matchedWord, timestamp.start, timestamp.end, starts, ends, characters);

    cursor = startIndex + matchedWord.length;
    previousEnd = timestamp.end;
  }

  const trailing = text.slice(cursor);
  if (trailing.length > 0) {
    const duration = Math.max(previousEnd, options?.audioDurationSeconds ?? previousEnd);
    distributeInterval(trailing, previousEnd, duration, starts, ends, characters);
  }

  if (characters.join('') !== text) {
    return estimateCharacterAlignment(text, options?.audioDurationSeconds ?? getLastTimestampEnd(timestamps) ?? previousEnd);
  }

  return {
    characters,
    characterStartTimesSeconds: starts,
    characterEndTimesSeconds: ends,
  };
};

export const formatPlaybackTime = (seconds: number): string => {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const minutes = Math.floor(safeSeconds / 60);
  const remainingSeconds = safeSeconds % 60;
  return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
};
