import { describe, expect, test } from 'bun:test';
import { buildRuntimeFetchUrl } from './runtime-fetch';
import { configureRuntimeUrlResolver, getRuntimeUrlResolver, setRuntimeUrlResolver } from './runtime-url';

describe('buildRuntimeFetchUrl', () => {
  test('preserves same-origin paths by default', () => {
    expect(buildRuntimeFetchUrl('/api/config/settings')).toBe('/api/config/settings');
    expect(buildRuntimeFetchUrl('/auth/session')).toBe('/auth/session');
    expect(buildRuntimeFetchUrl('/health')).toBe('/health');
  });

  test('resolves API/auth/health through configured runtime URL resolver', () => {
    const previous = getRuntimeUrlResolver();
    try {
      configureRuntimeUrlResolver({ apiBaseUrl: 'https://api.example' });

      expect(buildRuntimeFetchUrl('/api/config/settings')).toBe('https://api.example/api/config/settings');
      expect(buildRuntimeFetchUrl('/auth/session')).toBe('https://api.example/auth/session');
      expect(buildRuntimeFetchUrl('/health')).toBe('https://api.example/health');
      expect(buildRuntimeFetchUrl('/api/find/file', { query: 'x' })).toBe('https://api.example/api/find/file?query=x');
    } finally {
      setRuntimeUrlResolver(previous);
    }
  });

  test('rewrites current-origin absolute API URLs only', () => {
    const previous = getRuntimeUrlResolver();
    const originalWindow = globalThis.window;
    try {
      configureRuntimeUrlResolver({ apiBaseUrl: 'https://api.example' });
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: { location: { origin: 'openchamber-ui://app', href: 'openchamber-ui://app/index.html' } },
      });

      expect(buildRuntimeFetchUrl('openchamber-ui://app/api/config/settings')).toBe('https://api.example/api/config/settings');
      expect(buildRuntimeFetchUrl('https://external.example/api/config/settings')).toBe('https://external.example/api/config/settings');
    } finally {
      setRuntimeUrlResolver(previous);
      Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
    }
  });
});
