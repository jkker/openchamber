import * as React from 'react';

import type { UseBrowserVoiceReturn } from '@/hooks/useBrowserVoice';

export const BrowserVoiceRuntimeContext = React.createContext<UseBrowserVoiceReturn | null>(null);

export const useBrowserVoiceRuntime = () => {
  const context = React.useContext(BrowserVoiceRuntimeContext);
  if (!context) {
    throw new Error('useBrowserVoiceRuntime must be used within BrowserVoiceRuntimeProvider');
  }
  return context;
};
