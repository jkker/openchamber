import { describe, expect, test } from 'bun:test';

import { VoiceButton } from './voice-button';

describe('VoiceButton', () => {
  test('renders idle buttons as standard button elements', () => {
    const element = VoiceButton({ state: 'idle', label: 'Dictate' });

    expect(element.props.type).toBe('button');
  });

  test('uses destructive styling for error state', () => {
    const element = VoiceButton({ state: 'error', label: 'Dictate' });

    expect(element.props.variant).toBe('destructive');
  });
});
