import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './i18n'
import './styles/fonts'
import './index.css'
import App from './App.tsx'
import { SessionAuthGate } from './components/auth/SessionAuthGate'
import { DeviceLoginGate } from './components/auth/DeviceLoginGate'
import { ThemeSystemProvider } from './contexts/ThemeSystemContext'
import { ThemeProvider } from './components/providers/ThemeProvider'
import './lib/debug'
import { syncDesktopSettings, initializeAppearancePreferences } from './lib/persistence'
import { startAppearanceAutoSave } from './lib/appearanceAutoSave'
import { applyPersistedDirectoryPreferences } from './lib/directoryPersistence'
import { startTypographyWatcher } from './lib/typographyWatcher'
import { startModelPrefsAutoSave } from './lib/modelPrefsAutoSave'
import { initializeLocale, I18nProvider } from './lib/i18n'
import type { RuntimeAPIs } from './lib/api/types'
import { registerRuntimeAPIs } from './contexts/runtimeAPIRegistry'
import { useInstancesStore } from './stores/useInstancesStore'

declare global {
  interface Window {
    __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs;
  }
}

const runtimeAPIs = (typeof window !== 'undefined' && window.__OPENCHAMBER_RUNTIME_APIS__) || (() => {
  throw new Error('Runtime APIs not provided for legacy UI entrypoint.');
})();

const waitForInstancesHydration = async (): Promise<void> => {
  if (useInstancesStore.getState().hydrated) {
    return;
  }

  const persistApi = (useInstancesStore as unknown as {
    persist?: {
      hasHydrated?: () => boolean;
      onFinishHydration?: (callback: () => void) => (() => void) | void;
    };
  }).persist;

  if (!persistApi?.onFinishHydration) {
    return;
  }

  if (persistApi.hasHydrated?.()) {
    return;
  }

  await new Promise<void>((resolve) => {
    const unsubscribe = persistApi.onFinishHydration?.(() => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
      resolve();
    });
  });
};

registerRuntimeAPIs(runtimeAPIs);
await waitForInstancesHydration();

await syncDesktopSettings();
await initializeAppearancePreferences();
startAppearanceAutoSave();
startModelPrefsAutoSave();
startTypographyWatcher();
await applyPersistedDirectoryPreferences();

// Initialize settings asynchronously — the app renders with defaults first
// and hydrates once persisted preferences are applied. Users with non-default
// themes may briefly see default appearance on cold start; accepted trade-off
// for faster time-to-first-paint.
void initializeAppearancePreferences().then(() => {
  void Promise.all([
    syncDesktopSettings(),
    applyPersistedDirectoryPreferences(),
  ]).catch((err) => {
    console.error('[main] settings init failed:', err);
  });

  // Start watchers regardless of whether secondary settings succeed.
  startAppearanceAutoSave();
  startModelPrefsAutoSave();
  startTypographyWatcher();
}).catch((err) => {
  console.error('[main] appearance init failed:', err);
});


const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <ThemeSystemProvider>
      <ThemeProvider>
        <DeviceLoginGate>
          <SessionAuthGate>
            <App apis={runtimeAPIs} />
          </SessionAuthGate>
        </DeviceLoginGate>
      </ThemeProvider>
    </ThemeSystemProvider>
  </StrictMode>,
);
