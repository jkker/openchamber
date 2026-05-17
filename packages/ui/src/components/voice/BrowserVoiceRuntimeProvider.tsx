import * as React from 'react';

import { useBrowserVoice } from '@/hooks/useBrowserVoice';
import { BrowserVoiceRuntimeContext } from '@/hooks/useBrowserVoiceRuntime';

export const BrowserVoiceRuntimeProvider = ({ children }: { children: React.ReactNode }) => {
  const voiceRuntime = useBrowserVoice();

  return (
    <BrowserVoiceRuntimeContext.Provider value={voiceRuntime}>
      {children}
    </BrowserVoiceRuntimeContext.Provider>
  );
};
