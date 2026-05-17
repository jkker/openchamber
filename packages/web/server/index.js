import 'reflect-metadata';
import express from 'express';
import compression from 'compression';
import path from 'path';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import http from 'http';
import net from 'net';
import { fileURLToPath } from 'url';
import os from 'os';
import crypto from 'crypto';
import { createUiAuth } from './lib/ui-auth/ui-auth.js';
import { createTunnelAuth } from './lib/opencode/tunnel-auth.js';
import { createManagedTunnelConfigRuntime } from './lib/tunnels/managed-config.js';
import { createTunnelProviderRegistry } from './lib/tunnels/registry.js';
import { createCloudflareTunnelProvider } from './lib/tunnels/providers/cloudflare.js';
import { createRequestSecurityRuntime } from './lib/security/request-security.js';
import {
  TUNNEL_MODE_MANAGED_LOCAL,
  TUNNEL_MODE_MANAGED_REMOTE,
  TUNNEL_MODE_QUICK,
  TUNNEL_PROVIDER_CLOUDFLARE,
  TunnelServiceError,
  isSupportedTunnelMode,
  normalizeOptionalPath,
  normalizeTunnelStartRequest,
  normalizeTunnelMode,
  normalizeTunnelProvider,
} from './lib/tunnels/types.js';
import { prepareNotificationLastMessage } from './lib/notifications/index.js';
import { registerTtsRoutes } from './lib/tts/routes.js';
import { detectSayTtsCapability } from './lib/tts/capability-runtime.js';
import { createTerminalRuntime } from './lib/terminal/runtime.js';
import {
  createGlobalUiEventBroadcaster,
  createGlobalMessageStreamHub,
  createMessageStreamWsRuntime,
  DEFAULT_UPSTREAM_STALL_TIMEOUT_MS,
  UPSTREAM_STALL_TIMEOUT_CONCURRENT_MS,
} from './lib/event-stream/index.js';
import { createFsSearchRuntime as createFsSearchRuntimeFactory } from './lib/fs/search.js';
import { createOpenCodeLifecycleRuntime } from './lib/opencode/lifecycle.js';
import { createOpenCodeEnvRuntime } from './lib/opencode/env-runtime.js';
import { resolveOpenCodeEnvConfig } from './lib/opencode/env-config.js';
import { createHmrStateRuntime } from './lib/opencode/hmr-state-runtime.js';
import { createOpenCodeNetworkRuntime } from './lib/opencode/network-runtime.js';
import { createOpenCodeAuthStateRuntime } from './lib/opencode/auth-state-runtime.js';
import { createProjectDirectoryRuntime } from './lib/opencode/project-directory-runtime.js';
import { createSettingsNormalizationRuntime } from './lib/opencode/settings-normalization-runtime.js';
import { createSettingsHelpers } from './lib/opencode/settings-helpers.js';
import { createThemeRuntime } from './lib/opencode/theme-runtime.js';
import { createFeatureRoutesRuntime } from './lib/opencode/feature-routes-runtime.js';
import { parseServeCliOptions } from './lib/opencode/cli-options.js';
import {
  registerAuthAndAccessRoutes,
  registerCommonRequestMiddleware,
  registerServerStatusRoutes,
} from './lib/opencode/core-routes.js';
import { registerOpenChamberRoutes } from './lib/opencode/openchamber-routes.js';
import { createServerUtilsRuntime } from './lib/opencode/server-utils-runtime.js';
import { createStaticRoutesRuntime } from './lib/opencode/static-routes-runtime.js';
import { createSettingsRuntime } from './lib/opencode/settings-runtime.js';
import { createOpenCodeResolutionRuntime } from './lib/opencode/opencode-resolution-runtime.js';
import { createBootstrapRuntime } from './lib/opencode/bootstrap-runtime.js';
import { createSessionRuntime } from './lib/opencode/session-runtime.js';
import { createOpenCodeWatcherRuntime } from './lib/opencode/watcher.js';
import { createScheduledTasksRuntime } from './lib/scheduled-tasks/runtime.js';
import { createServerStartupRuntime } from './lib/opencode/server-startup-runtime.js';
import { createTunnelWiringRuntime } from './lib/opencode/tunnel-wiring-runtime.js';
import { createStartupPipelineRuntime } from './lib/opencode/startup-pipeline-runtime.js';
import { runCliEntryIfMain } from './lib/opencode/cli-entry-runtime.js';
import { registerNotificationRoutes } from './lib/notifications/routes.js';
import { createNotificationEmitterRuntime } from './lib/notifications/emitter-runtime.js';
import { createNotificationTriggerRuntime } from './lib/notifications/runtime.js';
import { createPushRuntime } from './lib/notifications/push-runtime.js';
import { createNotificationTemplateRuntime } from './lib/notifications/template-runtime.js';
import { createGracefulShutdownRuntime } from './lib/opencode/shutdown-runtime.js';
import { createProjectConfigRuntime } from './lib/projects/project-config.js';
import { createPreviewProxyRuntime } from './lib/preview/proxy-runtime.js';
import { createProxyMiddleware, responseInterceptor } from 'http-proxy-middleware';
import webPush from 'web-push';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_PORT = 3000;
const DESKTOP_NOTIFY_PREFIX = '[OpenChamberDesktopNotify] ';
const uiNotificationClients = new Set();
const uiNotificationWsClients = new Set();
const uiOpenChamberEventClients = new Set();
const HEALTH_CHECK_INTERVAL = 15000;
const SHUTDOWN_TIMEOUT = 10000;
const MODELS_DEV_API_URL = 'https://models.dev/api.json';
const MODELS_METADATA_CACHE_TTL = 5 * 60 * 1000;
const CLIENT_RELOAD_DELAY_MS = 800;
const OPEN_CODE_READY_GRACE_MS = 12000;
const LONG_REQUEST_TIMEOUT_MS = 4 * 60 * 1000;
const TUNNEL_BOOTSTRAP_TTL_DEFAULT_MS = 30 * 60 * 1000;
const TUNNEL_BOOTSTRAP_TTL_MIN_MS = 60 * 1000;
const TUNNEL_BOOTSTRAP_TTL_MAX_MS = 24 * 60 * 60 * 1000;
const TUNNEL_SESSION_TTL_DEFAULT_MS = 8 * 60 * 60 * 1000;
const TUNNEL_SESSION_TTL_MIN_MS = 5 * 60 * 1000;
const TUNNEL_SESSION_TTL_MAX_MS = 30 * 24 * 60 * 60 * 1000;

function headerIncludesEventStream(value) {
  if (typeof value === 'string') {
    return value.toLowerCase().includes('text/event-stream');
  }

  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === 'string' && entry.toLowerCase().includes('text/event-stream'));
  }

  return false;
}

/**
 * SSE endpoint paths that must never be compressed by the compression middleware.
 *
 * The compression middleware filter runs before route handlers, so
 * `res.getHeader('Content-Type')` is still undefined at that point.
 * This means the Accept-header check alone is not sufficient for
 * non-standard clients (e.g. curl, fetch) that omit Accept.
 * Path-based exclusion acts as a deterministic fallback.
 */
const SSE_PATH_PREFIXES = [
  '/api/event',
  '/api/global/event',
  '/api/notifications/stream',
  '/api/openchamber/events',
];

function shouldSkipCompression(req, res) {
  if (headerIncludesEventStream(req.headers.accept)) {
    return true;
  }

  const pathname = req.path || req.url || '';
  if ((pathname === '/api' || pathname.startsWith('/api/')) && shouldSkipApiCompression()) {
    return true;
  }

  if (pathname.startsWith('/api/terminal/') && pathname.endsWith('/stream')) {
    return true;
  }
  for (const prefix of SSE_PATH_PREFIXES) {
    if (pathname === prefix) {
      return true;
    }
  }

  return headerIncludesEventStream(res.getHeader('Content-Type'));
}

const OPENCHAMBER_VERSION = (() => {
  try {
    const packagePath = path.resolve(__dirname, '..', 'package.json');
    const raw = fs.readFileSync(packagePath, 'utf8');
    const pkg = JSON.parse(raw);
    if (pkg && typeof pkg.version === 'string' && pkg.version.trim().length > 0) {
      return pkg.version.trim();
    }
  } catch {
  }
  return 'unknown';
})();

const isEnvFlagEnabled = (value) => {
  if (value === true || value === 1) return true;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
};

const isEnvFlagDisabled = (value) => {
  if (value === false || value === 0) return true;
  if (typeof value !== 'string') return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '0' || normalized === 'false';
};

const shouldSkipApiCompression = () => {
  if (isEnvFlagEnabled(process.env.OPENCHAMBER_SKIP_API_COMPRESSION)) return true;
  if (isEnvFlagEnabled(process.env.OPENCHAMBER_COMPRESS_API)) return false;
  if (isEnvFlagDisabled(process.env.OPENCHAMBER_COMPRESS_API)) return true;
  return process.env.OPENCHAMBER_RUNTIME === 'desktop';
};

const OPENCHAMBER_VERBOSE_REQUEST_LOGS = isEnvFlagEnabled(process.env.OPENCHAMBER_VERBOSE_REQUEST_LOGS);

const PLAN_MODE_EXPERIMENT_ENABLED =
  isEnvFlagEnabled(process.env.OPENCODE_EXPERIMENTAL_PLAN_MODE)
  || isEnvFlagEnabled(process.env.OPENCODE_EXPERIMENTAL);

const fsPromises = fs.promises;

const settingsNormalizationRuntime = createSettingsNormalizationRuntime({
  os,
  path,
  processLike: process,
  tunnelBootstrapTtlDefaultMs: TUNNEL_BOOTSTRAP_TTL_DEFAULT_MS,
  tunnelBootstrapTtlMinMs: TUNNEL_BOOTSTRAP_TTL_MIN_MS,
  tunnelBootstrapTtlMaxMs: TUNNEL_BOOTSTRAP_TTL_MAX_MS,
  tunnelSessionTtlDefaultMs: TUNNEL_SESSION_TTL_DEFAULT_MS,
  tunnelSessionTtlMinMs: TUNNEL_SESSION_TTL_MIN_MS,
  tunnelSessionTtlMaxMs: TUNNEL_SESSION_TTL_MAX_MS,
});

const normalizeDirectoryPath = (...args) => settingsNormalizationRuntime.normalizeDirectoryPath(...args);
const normalizePathForPersistence = (...args) => settingsNormalizationRuntime.normalizePathForPersistence(...args);
const normalizeSettingsPaths = (...args) => settingsNormalizationRuntime.normalizeSettingsPaths(...args);
const normalizeTunnelBootstrapTtlMs = (...args) => settingsNormalizationRuntime.normalizeTunnelBootstrapTtlMs(...args);
const normalizeTunnelSessionTtlMs = (...args) => settingsNormalizationRuntime.normalizeTunnelSessionTtlMs(...args);
const normalizeManagedRemoteTunnelHostname = (...args) =>
  settingsNormalizationRuntime.normalizeManagedRemoteTunnelHostname(...args);
const normalizeManagedRemoteTunnelPresets = (...args) =>
  settingsNormalizationRuntime.normalizeManagedRemoteTunnelPresets(...args);
const normalizeManagedRemoteTunnelPresetTokens = (...args) =>
  settingsNormalizationRuntime.normalizeManagedRemoteTunnelPresetTokens(...args);
const isUnsafeSkillRelativePath = (...args) => settingsNormalizationRuntime.isUnsafeSkillRelativePath(...args);
const sanitizeTypographySizesPartial = (...args) =>
  settingsNormalizationRuntime.sanitizeTypographySizesPartial(...args);
const normalizeStringArray = (...args) => settingsNormalizationRuntime.normalizeStringArray(...args);
const sanitizeModelRefs = (...args) => settingsNormalizationRuntime.sanitizeModelRefs(...args);
const sanitizeSkillCatalogs = (...args) => settingsNormalizationRuntime.sanitizeSkillCatalogs(...args);
const sanitizeProjects = (...args) => settingsNormalizationRuntime.sanitizeProjects(...args);

const OPENCHAMBER_USER_CONFIG_ROOT = path.join(os.homedir(), '.config', 'openchamber');
const OPENCHAMBER_USER_THEMES_DIR = path.join(OPENCHAMBER_USER_CONFIG_ROOT, 'themes');
const OPENCHAMBER_PROJECTS_CONFIG_DIR = path.join(OPENCHAMBER_USER_CONFIG_ROOT, 'projects');

const MAX_THEME_JSON_BYTES = 512 * 1024;


const themeRuntime = createThemeRuntime({
  fsPromises,
  path,
  themesDir: OPENCHAMBER_USER_THEMES_DIR,
  maxThemeJsonBytes: MAX_THEME_JSON_BYTES,
  logger: console,
});

const readCustomThemesFromDisk = (...args) => themeRuntime.readCustomThemesFromDisk(...args);

let notificationTemplateRuntime = null;

const createTimeoutSignal = (...args) => notificationTemplateRuntime.createTimeoutSignal(...args);
const formatProjectLabel = (...args) => notificationTemplateRuntime.formatProjectLabel(...args);
const resolveNotificationTemplate = (...args) => notificationTemplateRuntime.resolveNotificationTemplate(...args);
const shouldApplyResolvedTemplateMessage = (...args) => notificationTemplateRuntime.shouldApplyResolvedTemplateMessage(...args);
const fetchFreeZenModels = (...args) => notificationTemplateRuntime.fetchFreeZenModels(...args);
const resolveZenModel = (...args) => notificationTemplateRuntime.resolveZenModel(...args);
const validateZenModelAtStartup = (...args) => notificationTemplateRuntime.validateZenModelAtStartup(...args);
const summarizeText = (...args) => notificationTemplateRuntime.summarizeText(...args);
const extractTextFromParts = (...args) => notificationTemplateRuntime.extractTextFromParts(...args);
const extractLastMessageText = (...args) => notificationTemplateRuntime.extractLastMessageText(...args);
const fetchLastAssistantMessageText = (...args) => notificationTemplateRuntime.fetchLastAssistantMessageText(...args);
const maybeCacheSessionInfoFromEvent = (...args) => notificationTemplateRuntime.maybeCacheSessionInfoFromEvent(...args);
const buildTemplateVariables = (...args) => notificationTemplateRuntime.buildTemplateVariables(...args);
const getCachedZenModels = (...args) => notificationTemplateRuntime.getCachedZenModels(...args);

const OPENCHAMBER_DATA_DIR = process.env.OPENCHAMBER_DATA_DIR
  ? path.resolve(process.env.OPENCHAMBER_DATA_DIR)
  : path.join(os.homedir(), '.config', 'openchamber');
const SETTINGS_FILE_PATH = path.join(OPENCHAMBER_DATA_DIR, 'settings.json');
const PUSH_SUBSCRIPTIONS_FILE_PATH = path.join(OPENCHAMBER_DATA_DIR, 'push-subscriptions.json');
const CLOUDFLARE_NAMED_TUNNELS_FILE_PATH = path.join(OPENCHAMBER_DATA_DIR, 'cloudflare-named-tunnels.json');
const CLOUDFLARE_NAMED_TUNNELS_VERSION = 1;
const PROJECT_ICONS_DIR_PATH = path.join(OPENCHAMBER_DATA_DIR, 'project-icons');
const PROJECT_ICON_MIME_TO_EXTENSION = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
  'image/x-icon': 'ico',
};
const PROJECT_ICON_EXTENSION_TO_MIME = Object.fromEntries(
  Object.entries(PROJECT_ICON_MIME_TO_EXTENSION).map(([mime, ext]) => [ext, mime])
);
const PROJECT_ICON_SUPPORTED_MIMES = new Set(Object.keys(PROJECT_ICON_MIME_TO_EXTENSION));
const PROJECT_ICON_MAX_BYTES = 5 * 1024 * 1024;

const normalizeProjectIconMime = (value) => {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'image/jpg') {
    return 'image/jpeg';
  }
  if (PROJECT_ICON_SUPPORTED_MIMES.has(normalized)) {
    return normalized;
  }
  return null;
};

const projectIconBaseName = (projectId) => {
  const hash = crypto.createHash('sha1').update(projectId).digest('hex');
  return `project-${hash}`;
};

const projectIconPathForMime = (projectId, mime) => {
  const normalizedMime = normalizeProjectIconMime(mime);
  if (!normalizedMime) {
    return null;
  }
  const ext = PROJECT_ICON_MIME_TO_EXTENSION[normalizedMime];
  return path.join(PROJECT_ICONS_DIR_PATH, `${projectIconBaseName(projectId)}.${ext}`);
};

const projectIconPathCandidates = (projectId) => {
  const base = projectIconBaseName(projectId);
  return Object.values(PROJECT_ICON_MIME_TO_EXTENSION).map((ext) => path.join(PROJECT_ICONS_DIR_PATH, `${base}.${ext}`));
};

const removeProjectIconFiles = async (projectId, keepPath) => {
  const candidates = projectIconPathCandidates(projectId);
  await Promise.all(candidates.map(async (candidatePath) => {
    if (keepPath && candidatePath === keepPath) {
      return;
    }
    try {
      await fsPromises.unlink(candidatePath);
    } catch (error) {
      if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
        throw error;
      }
    }
  }));
};

const parseProjectIconDataUrl = (value) => {
  if (typeof value !== 'string') {
    return { ok: false, error: 'dataUrl is required' };
  }

  const trimmed = value.trim();
  const match = trimmed.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i);
  if (!match) {
    return { ok: false, error: 'Invalid dataUrl format' };
  }

  const mime = normalizeProjectIconMime(match[1]);
  if (!mime || !['image/png', 'image/jpeg', 'image/svg+xml'].includes(mime)) {
    return { ok: false, error: 'Icon must be PNG, JPEG, or SVG' };
  }

  try {
    const base64 = match[2].replace(/\s+/g, '');
    const bytes = Buffer.from(base64, 'base64');
    if (bytes.length === 0) {
      return { ok: false, error: 'Icon content is empty' };
    }
    if (bytes.length > PROJECT_ICON_MAX_BYTES) {
      return { ok: false, error: 'Icon exceeds size limit (5 MB)' };
    }
    return { ok: true, mime, bytes };
  } catch {
    return { ok: false, error: 'Failed to decode icon data' };
  }
};

const findProjectById = (settings, projectId) => {
  const projects = sanitizeProjects(settings?.projects) || [];
  const index = projects.findIndex((project) => project.id === projectId);
  if (index === -1) {
    return { projects, index: -1, project: null };
  }
  return { projects, index, project: projects[index] };
};

const readSettingsFromDisk = async () => {
  try {
    const raw = await fsPromises.readFile(SETTINGS_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
    return {};
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return {};
    }
    console.warn('Failed to read settings file:', error);
    return {};
  }
};

const writeSettingsToDisk = async (settings) => {
  try {
    await fsPromises.mkdir(path.dirname(SETTINGS_FILE_PATH), { recursive: true });
    await fsPromises.writeFile(SETTINGS_FILE_PATH, JSON.stringify(settings, null, 2), 'utf8');
  } catch (error) {
    console.warn('Failed to write settings file:', error);
    throw error;
  }
};

const PUSH_SUBSCRIPTIONS_VERSION = 1;
let persistPushSubscriptionsLock = Promise.resolve();
let persistNamedTunnelConfigLock = Promise.resolve();

const readPushSubscriptionsFromDisk = async () => {
  try {
    const raw = await fsPromises.readFile(PUSH_SUBSCRIPTIONS_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { version: PUSH_SUBSCRIPTIONS_VERSION, subscriptionsBySession: {} };
    }
    if (typeof parsed.version !== 'number' || parsed.version !== PUSH_SUBSCRIPTIONS_VERSION) {
      return { version: PUSH_SUBSCRIPTIONS_VERSION, subscriptionsBySession: {} };
    }

    const subscriptionsBySession =
      parsed.subscriptionsBySession && typeof parsed.subscriptionsBySession === 'object'
        ? parsed.subscriptionsBySession
        : {};

    return { version: PUSH_SUBSCRIPTIONS_VERSION, subscriptionsBySession };
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { version: PUSH_SUBSCRIPTIONS_VERSION, subscriptionsBySession: {} };
    }
    console.warn('Failed to read push subscriptions file:', error);
    return { version: PUSH_SUBSCRIPTIONS_VERSION, subscriptionsBySession: {} };
  }
};

const writePushSubscriptionsToDisk = async (data) => {
  await fsPromises.mkdir(path.dirname(PUSH_SUBSCRIPTIONS_FILE_PATH), { recursive: true });
  await fsPromises.writeFile(PUSH_SUBSCRIPTIONS_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
};

const persistPushSubscriptionUpdate = async (mutate) => {
  persistPushSubscriptionsLock = persistPushSubscriptionsLock.then(async () => {
    await fsPromises.mkdir(path.dirname(PUSH_SUBSCRIPTIONS_FILE_PATH), { recursive: true });
    const current = await readPushSubscriptionsFromDisk();
    const next = mutate({
      version: PUSH_SUBSCRIPTIONS_VERSION,
      subscriptionsBySession: current.subscriptionsBySession || {},
    });
    await writePushSubscriptionsToDisk(next);
    return next;
  });

  return persistPushSubscriptionsLock;
};

const sanitizeNamedTunnelConfigEntries = (value) => {
  if (!Array.isArray(value)) {
    return [];
  }

  const result = [];
  const seenIds = new Set();
  const seenHostnames = new Set();
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    const hostname = normalizeNamedTunnelHostname(entry.hostname);
    const token = typeof entry.token === 'string' ? entry.token.trim() : '';
    const updatedAt = Number.isFinite(entry.updatedAt) ? entry.updatedAt : Date.now();

    if (!id || !name || !hostname || !token) {
      continue;
    }
    if (seenIds.has(id) || seenHostnames.has(hostname)) {
      continue;
    }

    seenIds.add(id);
    seenHostnames.add(hostname);
    result.push({ id, name, hostname, token, updatedAt });
  }

  return result;
};

const readNamedTunnelConfigFromDisk = async () => {
  try {
    const raw = await fsPromises.readFile(CLOUDFLARE_NAMED_TUNNELS_FILE_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return { version: CLOUDFLARE_NAMED_TUNNELS_VERSION, tunnels: [] };
    }

    const version = parsed.version === CLOUDFLARE_NAMED_TUNNELS_VERSION
      ? CLOUDFLARE_NAMED_TUNNELS_VERSION
      : CLOUDFLARE_NAMED_TUNNELS_VERSION;

    return {
      version,
      tunnels: sanitizeNamedTunnelConfigEntries(parsed.tunnels),
    };
  } catch (error) {
    if (error && typeof error === 'object' && error.code === 'ENOENT') {
      return { version: CLOUDFLARE_NAMED_TUNNELS_VERSION, tunnels: [] };
    }
    console.warn('Failed to read named tunnel config file:', error);
    return { version: CLOUDFLARE_NAMED_TUNNELS_VERSION, tunnels: [] };
  }
};

const writeNamedTunnelConfigToDisk = async (data) => {
  await fsPromises.mkdir(path.dirname(CLOUDFLARE_NAMED_TUNNELS_FILE_PATH), { recursive: true });
  await fsPromises.writeFile(CLOUDFLARE_NAMED_TUNNELS_FILE_PATH, JSON.stringify(data, null, 2), 'utf8');
};

const updateNamedTunnelConfig = async (mutate) => {
  persistNamedTunnelConfigLock = persistNamedTunnelConfigLock.then(async () => {
    const current = await readNamedTunnelConfigFromDisk();
    const next = mutate({
      version: CLOUDFLARE_NAMED_TUNNELS_VERSION,
      tunnels: sanitizeNamedTunnelConfigEntries(current.tunnels),
    });

    await writeNamedTunnelConfigToDisk({
      version: CLOUDFLARE_NAMED_TUNNELS_VERSION,
      tunnels: sanitizeNamedTunnelConfigEntries(next?.tunnels),
    });
  });

  return persistNamedTunnelConfigLock;
};

const syncNamedTunnelConfigWithPresets = async (presets) => {
  const sanitizedPresets = normalizeNamedTunnelPresets(presets) || [];

  await updateNamedTunnelConfig((current) => {
    const byId = new Map(current.tunnels.map((entry) => [entry.id, entry]));
    const byHostname = new Map(current.tunnels.map((entry) => [entry.hostname, entry]));

    const nextTunnels = [];
    for (const preset of sanitizedPresets) {
      const existing = byId.get(preset.id) || byHostname.get(preset.hostname) || null;
      if (!existing) {
        continue;
      }

      nextTunnels.push({
        ...existing,
        id: preset.id,
        name: preset.name,
        hostname: preset.hostname,
      });
    }

    return {
      version: CLOUDFLARE_NAMED_TUNNELS_VERSION,
      tunnels: nextTunnels,
    };
  });
};

const upsertNamedTunnelToken = async ({ id, name, hostname, token }) => {
  if (typeof id !== 'string' || typeof name !== 'string' || typeof hostname !== 'string' || typeof token !== 'string') {
    return;
  }
  const normalizedId = id.trim();
  const normalizedName = name.trim();
  const normalizedHostname = normalizeNamedTunnelHostname(hostname);
  const normalizedToken = token.trim();
  if (!normalizedId || !normalizedName || !normalizedHostname || !normalizedToken) {
    return;
  }

  await updateNamedTunnelConfig((current) => {
    const withoutConflicts = current.tunnels.filter((entry) => entry.id !== normalizedId && entry.hostname !== normalizedHostname);
    withoutConflicts.push({
      id: normalizedId,
      name: normalizedName,
      hostname: normalizedHostname,
      token: normalizedToken,
      updatedAt: Date.now(),
    });

    return {
      version: CLOUDFLARE_NAMED_TUNNELS_VERSION,
      tunnels: withoutConflicts,
    };
  });
};

const resolveNamedTunnelToken = async ({ presetId, hostname }) => {
  const normalizedPresetId = typeof presetId === 'string' ? presetId.trim() : '';
  const normalizedHostname = normalizeNamedTunnelHostname(hostname);
  const config = await readNamedTunnelConfigFromDisk();

  if (normalizedPresetId) {
    const byId = config.tunnels.find((entry) => entry.id === normalizedPresetId);
    if (byId?.token) {
      return byId.token;
    }
  }

  if (normalizedHostname) {
    const byHostname = config.tunnels.find((entry) => entry.hostname === normalizedHostname);
    if (byHostname?.token) {
      return byHostname.token;
    }
  }

  return '';
};

const resolveDirectoryCandidate = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const normalized = normalizeDirectoryPath(trimmed);
  return path.resolve(normalized);
};

const validateDirectoryPath = async (candidate) => {
  const resolved = resolveDirectoryCandidate(candidate);
  if (!resolved) {
    return { ok: false, error: 'Directory parameter is required' };
  }
  try {
    const stats = await fsPromises.stat(resolved);
    if (!stats.isDirectory()) {
      return { ok: false, error: 'Specified path is not a directory' };
    }
    return { ok: true, directory: resolved };
  } catch (error) {
    const err = error;
    if (err && typeof err === 'object' && err.code === 'ENOENT') {
      return { ok: false, error: 'Directory not found' };
    }
    if (err && typeof err === 'object' && err.code === 'EACCES') {
      return { ok: false, error: 'Access to directory denied' };
    }
    return { ok: false, error: 'Failed to validate directory' };
  }
};

const resolveProjectDirectory = async (req) => {
  const headerDirectory = typeof req.get === 'function' ? req.get('x-opencode-directory') : null;
  const queryDirectory = Array.isArray(req.query?.directory)
    ? req.query.directory[0]
    : req.query?.directory;
  const requested = headerDirectory || queryDirectory || null;

  if (requested) {
    const validated = await validateDirectoryPath(requested);
    if (!validated.ok) {
      return { directory: null, error: validated.error };
    }
    return { directory: validated.directory, error: null };
  }

  const settings = await readSettingsFromDiskMigrated();
  const projects = sanitizeProjects(settings.projects) || [];
  if (projects.length === 0) {
    return { directory: null, error: 'Directory parameter or active project is required' };
  }

  const activeId = typeof settings.activeProjectId === 'string' ? settings.activeProjectId : '';
  const active = projects.find((project) => project.id === activeId) || projects[0];
  if (!active || !active.path) {
    return { directory: null, error: 'Directory parameter or active project is required' };
  }

  const validated = await validateDirectoryPath(active.path);
  if (!validated.ok) {
    return { directory: null, error: validated.error };
  }

  return { directory: validated.directory, error: null };
};

const resolveOptionalProjectDirectory = async (req) => {
  const headerDirectory = typeof req.get === 'function' ? req.get('x-opencode-directory') : null;
  const queryDirectory = Array.isArray(req.query?.directory)
    ? req.query.directory[0]
    : req.query?.directory;
  const requested = headerDirectory || queryDirectory || null;

  if (!requested) {
    return { directory: null, error: null };
  }

  const validated = await validateDirectoryPath(requested);
  if (!validated.ok) {
    return { directory: null, error: validated.error };
  }

  return { directory: validated.directory, error: null };
};

const sanitizeTypographySizesPartial = (input) => {
  if (!input || typeof input !== 'object') {
    return undefined;
  }
  const candidate = input;
  const result = {};
  let populated = false;

  const assign = (key) => {
    if (typeof candidate[key] === 'string' && candidate[key].length > 0) {
      result[key] = candidate[key];
      populated = true;
    }
  };

  assign('markdown');
  assign('code');
  assign('uiHeader');
  assign('uiLabel');
  assign('meta');
  assign('micro');

  return populated ? result : undefined;
};

const normalizeStringArray = (input) => {
  if (!Array.isArray(input)) {
    return [];
  }
  return Array.from(
    new Set(
      input.filter((entry) => typeof entry === 'string' && entry.length > 0)
    )
  );
};

const sanitizeModelRefs = (input, limit) => {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const result = [];
  const seen = new Set();

  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;
    const providerID = typeof entry.providerID === 'string' ? entry.providerID.trim() : '';
    const modelID = typeof entry.modelID === 'string' ? entry.modelID.trim() : '';
    if (!providerID || !modelID) continue;
    const key = `${providerID}/${modelID}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ providerID, modelID });
    if (result.length >= limit) break;
  }

  return result;
};

const sanitizeSkillCatalogs = (input) => {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const result = [];
  const seen = new Set();

  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;

    const id = typeof entry.id === 'string' ? entry.id.trim() : '';
    const label = typeof entry.label === 'string' ? entry.label.trim() : '';
    const source = typeof entry.source === 'string' ? entry.source.trim() : '';
    const subpath = typeof entry.subpath === 'string' ? entry.subpath.trim() : '';
    const gitIdentityId = typeof entry.gitIdentityId === 'string' ? entry.gitIdentityId.trim() : '';

    if (!id || !label || !source) continue;
    if (seen.has(id)) continue;
    seen.add(id);

    result.push({
      id,
      label,
      source,
      ...(subpath ? { subpath } : {}),
      ...(gitIdentityId ? { gitIdentityId } : {}),
    });
  }

  return result;
};

const sanitizeProjects = (input) => {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const hexColorPattern = /^#(?:[\da-fA-F]{3}|[\da-fA-F]{6})$/;
  const normalizeIconBackground = (value) => {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    return hexColorPattern.test(trimmed) ? trimmed.toLowerCase() : null;
  };

  const result = [];
  const seenIds = new Set();
  const seenPaths = new Set();

  for (const entry of input) {
    if (!entry || typeof entry !== 'object') continue;

    const candidate = entry;
    const id = typeof candidate.id === 'string' ? candidate.id.trim() : '';
    const rawPath = typeof candidate.path === 'string' ? candidate.path.trim() : '';
    const normalizedPath = rawPath ? path.resolve(normalizeDirectoryPath(rawPath)) : '';
    const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
    const icon = typeof candidate.icon === 'string' ? candidate.icon.trim() : '';
    const iconImage = candidate.iconImage && typeof candidate.iconImage === 'object'
      ? candidate.iconImage
      : null;
    const iconBackground = normalizeIconBackground(candidate.iconBackground);
    const color = typeof candidate.color === 'string' ? candidate.color.trim() : '';
    const addedAt = Number.isFinite(candidate.addedAt) ? Number(candidate.addedAt) : null;
    const lastOpenedAt = Number.isFinite(candidate.lastOpenedAt)
      ? Number(candidate.lastOpenedAt)
      : null;

    if (!id || !normalizedPath) continue;
    if (seenIds.has(id)) continue;
    if (seenPaths.has(normalizedPath)) continue;

    seenIds.add(id);
    seenPaths.add(normalizedPath);

    const project = {
      id,
      path: normalizedPath,
      ...(label ? { label } : {}),
      ...(icon ? { icon } : {}),
      ...(iconBackground ? { iconBackground } : {}),
      ...(color ? { color } : {}),
      ...(Number.isFinite(addedAt) && addedAt >= 0 ? { addedAt } : {}),
      ...(Number.isFinite(lastOpenedAt) && lastOpenedAt >= 0 ? { lastOpenedAt } : {}),
    };

    if (candidate.iconImage === null) {
      project.iconImage = null;
    } else if (iconImage) {
      const mime = typeof iconImage.mime === 'string' ? iconImage.mime.trim() : '';
      const updatedAt = typeof iconImage.updatedAt === 'number' && Number.isFinite(iconImage.updatedAt)
        ? Math.max(0, Math.round(iconImage.updatedAt))
        : 0;
      const source = iconImage.source === 'custom' || iconImage.source === 'auto'
        ? iconImage.source
        : null;
      if (mime && updatedAt > 0 && source) {
        project.iconImage = { mime, updatedAt, source };
      }
    }

    if (candidate.iconBackground === null) {
      project.iconBackground = null;
    }

    if (typeof candidate.sidebarCollapsed === 'boolean') {
      project.sidebarCollapsed = candidate.sidebarCollapsed;
    }

    result.push(project);
  }

  return result;
};

const sanitizeSettingsUpdate = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const candidate = payload;
  const result = {};

  if (typeof candidate.themeId === 'string' && candidate.themeId.length > 0) {
    result.themeId = candidate.themeId;
  }
  if (typeof candidate.themeVariant === 'string' && (candidate.themeVariant === 'light' || candidate.themeVariant === 'dark')) {
    result.themeVariant = candidate.themeVariant;
  }
  if (typeof candidate.useSystemTheme === 'boolean') {
    result.useSystemTheme = candidate.useSystemTheme;
  }
  if (typeof candidate.lightThemeId === 'string' && candidate.lightThemeId.length > 0) {
    result.lightThemeId = candidate.lightThemeId;
  }
  if (typeof candidate.darkThemeId === 'string' && candidate.darkThemeId.length > 0) {
    result.darkThemeId = candidate.darkThemeId;
  }
  if (typeof candidate.lastDirectory === 'string' && candidate.lastDirectory.length > 0) {
    result.lastDirectory = candidate.lastDirectory;
  }
  if (typeof candidate.homeDirectory === 'string' && candidate.homeDirectory.length > 0) {
    result.homeDirectory = candidate.homeDirectory;
  }

  // Absolute path to the opencode CLI binary (optional override).
  // Accept empty-string to clear (we persist an empty string sentinel so the running
  // process can reliably drop a previously applied OPENCODE_BINARY override).
  if (typeof candidate.opencodeBinary === 'string') {
    const normalized = normalizeDirectoryPath(candidate.opencodeBinary).trim();
    result.opencodeBinary = normalized;
  }
  if (Array.isArray(candidate.projects)) {
    const projects = sanitizeProjects(candidate.projects);
    if (projects) {
      result.projects = projects;
    }
  }
  if (typeof candidate.activeProjectId === 'string' && candidate.activeProjectId.length > 0) {
    result.activeProjectId = candidate.activeProjectId;
  }

  if (Array.isArray(candidate.approvedDirectories)) {
    result.approvedDirectories = normalizeStringArray(candidate.approvedDirectories);
  }
  if (Array.isArray(candidate.securityScopedBookmarks)) {
    result.securityScopedBookmarks = normalizeStringArray(candidate.securityScopedBookmarks);
  }
  if (Array.isArray(candidate.pinnedDirectories)) {
    result.pinnedDirectories = normalizeStringArray(candidate.pinnedDirectories);
  }
  if (Array.isArray(candidate.profiles)) {
    const sanitizedProfiles = candidate.profiles.reduce((acc, p) => {
      if (
        p &&
        typeof p === 'object' &&
        typeof p.id === 'string' && p.id.length > 0 &&
        typeof p.name === 'string' && p.name.length > 0 && p.name.length <= 64 &&
        p.agentModels && typeof p.agentModels === 'object' &&
        typeof p.createdAt === 'string' &&
        typeof p.updatedAt === 'string'
      ) {
        const agentModels = {};
        for (const [key, val] of Object.entries(p.agentModels)) {
          if (typeof key === 'string' && typeof val === 'string') {
            agentModels[key] = val;
          }
        }
        const sanitized = {
          id: p.id,
          name: p.name.trim().slice(0, 64),
          agentModels,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
        };
        if (p.categoryModels && typeof p.categoryModels === 'object' && !Array.isArray(p.categoryModels)) {
          const categoryModels = {};
          for (const [key, val] of Object.entries(p.categoryModels)) {
            if (typeof key === 'string' && typeof val === 'string') {
              categoryModels[key] = val;
            }
          }
          if (Object.keys(categoryModels).length > 0) {
            sanitized.categoryModels = categoryModels;
          }
        }
        if (p.omoAgentModels && typeof p.omoAgentModels === 'object' && !Array.isArray(p.omoAgentModels)) {
          const omoAgentModels = {};
          for (const [key, val] of Object.entries(p.omoAgentModels)) {
            if (typeof key === 'string' && typeof val === 'string') {
              omoAgentModels[key] = val;
            }
          }
          if (Object.keys(omoAgentModels).length > 0) {
            sanitized.omoAgentModels = omoAgentModels;
          }
        }
        acc.push(sanitized);
      }
      return acc;
    }, []);
    result.profiles = sanitizedProfiles;
  }


  if (typeof candidate.uiFont === 'string' && candidate.uiFont.length > 0) {
    result.uiFont = candidate.uiFont;
  }
  if (typeof candidate.monoFont === 'string' && candidate.monoFont.length > 0) {
    result.monoFont = candidate.monoFont;
  }
  if (typeof candidate.markdownDisplayMode === 'string' && candidate.markdownDisplayMode.length > 0) {
    result.markdownDisplayMode = candidate.markdownDisplayMode;
  }
  if (typeof candidate.githubClientId === 'string') {
    const trimmed = candidate.githubClientId.trim();
    if (trimmed.length > 0) {
      result.githubClientId = trimmed;
    }
  }
  if (typeof candidate.githubScopes === 'string') {
    const trimmed = candidate.githubScopes.trim();
    if (trimmed.length > 0) {
      result.githubScopes = trimmed;
    }
  }
  if (typeof candidate.showReasoningTraces === 'boolean') {
    result.showReasoningTraces = candidate.showReasoningTraces;
  }
  if (typeof candidate.showTextJustificationActivity === 'boolean') {
    result.showTextJustificationActivity = candidate.showTextJustificationActivity;
  }
  if (typeof candidate.showDeletionDialog === 'boolean') {
    result.showDeletionDialog = candidate.showDeletionDialog;
  }
  if (typeof candidate.nativeNotificationsEnabled === 'boolean') {
    result.nativeNotificationsEnabled = candidate.nativeNotificationsEnabled;
  }
  if (typeof candidate.notificationMode === 'string') {
    const mode = candidate.notificationMode.trim();
    if (mode === 'always' || mode === 'hidden-only') {
      result.notificationMode = mode;
    }
  }
  if (typeof candidate.mobileHapticsEnabled === 'boolean') {
    result.mobileHapticsEnabled = candidate.mobileHapticsEnabled;
  }
  if (typeof candidate.biometricLockEnabled === 'boolean') {
    result.biometricLockEnabled = candidate.biometricLockEnabled;
  }
  if (typeof candidate.notifyOnSubtasks === 'boolean') {
    result.notifyOnSubtasks = candidate.notifyOnSubtasks;
  }
  if (typeof candidate.notifyOnCompletion === 'boolean') {
    result.notifyOnCompletion = candidate.notifyOnCompletion;
  }
  if (typeof candidate.notifyOnError === 'boolean') {
    result.notifyOnError = candidate.notifyOnError;
  }
  if (typeof candidate.notifyOnQuestion === 'boolean') {
    result.notifyOnQuestion = candidate.notifyOnQuestion;
  }
  if (candidate.notificationTemplates && typeof candidate.notificationTemplates === 'object') {
    result.notificationTemplates = candidate.notificationTemplates;
  }
  if (typeof candidate.summarizeLastMessage === 'boolean') {
    result.summarizeLastMessage = candidate.summarizeLastMessage;
  }
  if (typeof candidate.summaryThreshold === 'number' && Number.isFinite(candidate.summaryThreshold)) {
    result.summaryThreshold = Math.max(0, Math.round(candidate.summaryThreshold));
  }
  if (typeof candidate.summaryLength === 'number' && Number.isFinite(candidate.summaryLength)) {
    result.summaryLength = Math.max(10, Math.round(candidate.summaryLength));
  }
  if (typeof candidate.maxLastMessageLength === 'number' && Number.isFinite(candidate.maxLastMessageLength)) {
    result.maxLastMessageLength = Math.max(10, Math.round(candidate.maxLastMessageLength));
  }
  if (typeof candidate.usageAutoRefresh === 'boolean') {
    result.usageAutoRefresh = candidate.usageAutoRefresh;
  }
  if (typeof candidate.usageRefreshIntervalMs === 'number' && Number.isFinite(candidate.usageRefreshIntervalMs)) {
    result.usageRefreshIntervalMs = Math.max(30000, Math.min(300000, Math.round(candidate.usageRefreshIntervalMs)));
  }
  if (candidate.usageDisplayMode === 'usage' || candidate.usageDisplayMode === 'remaining') {
    result.usageDisplayMode = candidate.usageDisplayMode;
  }
  if (Array.isArray(candidate.usageDropdownProviders)) {
    result.usageDropdownProviders = normalizeStringArray(candidate.usageDropdownProviders);
  }
  if (typeof candidate.autoDeleteEnabled === 'boolean') {
    result.autoDeleteEnabled = candidate.autoDeleteEnabled;
  }
  if (typeof candidate.autoDeleteAfterDays === 'number' && Number.isFinite(candidate.autoDeleteAfterDays)) {
    const normalizedDays = Math.max(1, Math.min(365, Math.round(candidate.autoDeleteAfterDays)));
    result.autoDeleteAfterDays = normalizedDays;
  }
  if (candidate.tunnelBootstrapTtlMs === null) {
    result.tunnelBootstrapTtlMs = null;
  } else if (typeof candidate.tunnelBootstrapTtlMs === 'number' && Number.isFinite(candidate.tunnelBootstrapTtlMs)) {
    result.tunnelBootstrapTtlMs = normalizeTunnelBootstrapTtlMs(candidate.tunnelBootstrapTtlMs);
  }
  if (typeof candidate.tunnelSessionTtlMs === 'number' && Number.isFinite(candidate.tunnelSessionTtlMs)) {
    result.tunnelSessionTtlMs = normalizeTunnelSessionTtlMs(candidate.tunnelSessionTtlMs);
  }
  if (typeof candidate.tunnelMode === 'string') {
    result.tunnelMode = normalizeTunnelMode(candidate.tunnelMode);
  }
  if (typeof candidate.namedTunnelHostname === 'string') {
    const hostname = normalizeNamedTunnelHostname(candidate.namedTunnelHostname);
    result.namedTunnelHostname = hostname;
  }
  if (candidate.namedTunnelToken === null) {
    result.namedTunnelToken = null;
  } else if (typeof candidate.namedTunnelToken === 'string') {
    result.namedTunnelToken = candidate.namedTunnelToken.trim();
  }
  const namedTunnelPresets = normalizeNamedTunnelPresets(candidate.namedTunnelPresets);
  if (namedTunnelPresets) {
    result.namedTunnelPresets = namedTunnelPresets;
  }
  const namedTunnelPresetTokens = normalizeNamedTunnelPresetTokens(candidate.namedTunnelPresetTokens);
  if (namedTunnelPresetTokens) {
    result.namedTunnelPresetTokens = namedTunnelPresetTokens;
  }
  if (typeof candidate.namedTunnelSelectedPresetId === 'string') {
    const id = candidate.namedTunnelSelectedPresetId.trim();
    result.namedTunnelSelectedPresetId = id || undefined;
  }

  const typography = sanitizeTypographySizesPartial(candidate.typographySizes);
  if (typography) {
    result.typographySizes = typography;
  }

  if (typeof candidate.defaultModel === 'string') {
    const trimmed = candidate.defaultModel.trim();
    result.defaultModel = trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof candidate.defaultVariant === 'string') {
    const trimmed = candidate.defaultVariant.trim();
    result.defaultVariant = trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof candidate.defaultAgent === 'string') {
    const trimmed = candidate.defaultAgent.trim();
    result.defaultAgent = trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof candidate.defaultGitIdentityId === 'string') {
    const trimmed = candidate.defaultGitIdentityId.trim();
    result.defaultGitIdentityId = trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof candidate.queueModeEnabled === 'boolean') {
    result.queueModeEnabled = candidate.queueModeEnabled;
  }
  if (typeof candidate.autoCreateWorktree === 'boolean') {
    result.autoCreateWorktree = candidate.autoCreateWorktree;
  }
  if (typeof candidate.gitmojiEnabled === 'boolean') {
    result.gitmojiEnabled = candidate.gitmojiEnabled;
  }
  if (typeof candidate.zenModel === 'string') {
    const trimmed = candidate.zenModel.trim();
    result.zenModel = trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof candidate.gitProviderId === 'string') {
    const trimmed = candidate.gitProviderId.trim();
    result.gitProviderId = trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof candidate.gitModelId === 'string') {
    const trimmed = candidate.gitModelId.trim();
    result.gitModelId = trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof candidate.toolCallExpansion === 'string') {
    const mode = candidate.toolCallExpansion.trim();
    if (mode === 'collapsed' || mode === 'activity' || mode === 'detailed') {
      result.toolCallExpansion = mode;
    }
  }
  if (typeof candidate.fontSize === 'number' && Number.isFinite(candidate.fontSize)) {
    result.fontSize = Math.max(50, Math.min(200, Math.round(candidate.fontSize)));
  }
  if (typeof candidate.terminalFontSize === 'number' && Number.isFinite(candidate.terminalFontSize)) {
    result.terminalFontSize = Math.max(9, Math.min(52, Math.round(candidate.terminalFontSize)));
  }
  if (typeof candidate.padding === 'number' && Number.isFinite(candidate.padding)) {
    result.padding = Math.max(50, Math.min(200, Math.round(candidate.padding)));
  }
  if (typeof candidate.cornerRadius === 'number' && Number.isFinite(candidate.cornerRadius)) {
    result.cornerRadius = Math.max(0, Math.min(32, Math.round(candidate.cornerRadius)));
  }
  if (typeof candidate.inputBarOffset === 'number' && Number.isFinite(candidate.inputBarOffset)) {
    result.inputBarOffset = Math.max(0, Math.min(100, Math.round(candidate.inputBarOffset)));
  }

  const favoriteModels = sanitizeModelRefs(candidate.favoriteModels, 64);
  if (favoriteModels) {
    result.favoriteModels = favoriteModels;
  }

  const recentModels = sanitizeModelRefs(candidate.recentModels, 16);
  if (recentModels) {
    result.recentModels = recentModels;
  }
  if (typeof candidate.diffLayoutPreference === 'string') {
    const mode = candidate.diffLayoutPreference.trim();
    if (mode === 'dynamic' || mode === 'inline' || mode === 'side-by-side') {
      result.diffLayoutPreference = mode;
    }
  }
  if (typeof candidate.diffViewMode === 'string') {
    const mode = candidate.diffViewMode.trim();
    if (mode === 'single' || mode === 'stacked') {
      result.diffViewMode = mode;
    }
  }
  if (typeof candidate.directoryShowHidden === 'boolean') {
    result.directoryShowHidden = candidate.directoryShowHidden;
  }
  if (typeof candidate.filesViewShowGitignored === 'boolean') {
    result.filesViewShowGitignored = candidate.filesViewShowGitignored;
  }
  if (typeof candidate.openInAppId === 'string') {
    const trimmed = candidate.openInAppId.trim();
    if (trimmed.length > 0) {
      result.openInAppId = trimmed;
    }
  }

  // Message limit — single setting for fetch / trim / Load More chunk
  if (typeof candidate.messageLimit === 'number' && Number.isFinite(candidate.messageLimit)) {
    result.messageLimit = Math.max(10, Math.min(500, Math.round(candidate.messageLimit)));
  }

  const skillCatalogs = sanitizeSkillCatalogs(candidate.skillCatalogs);
  if (skillCatalogs) {
    result.skillCatalogs = skillCatalogs;
  }

  // Usage model selections - which models appear in dropdown
  if (candidate.usageSelectedModels && typeof candidate.usageSelectedModels === 'object') {
    const sanitized = {};
    for (const [providerId, models] of Object.entries(candidate.usageSelectedModels)) {
      if (typeof providerId === 'string' && Array.isArray(models)) {
        const validModels = models.filter((m) => typeof m === 'string' && m.length > 0);
        if (validModels.length > 0) {
          sanitized[providerId] = validModels;
        }
      }
    }
    if (Object.keys(sanitized).length > 0) {
      result.usageSelectedModels = sanitized;
    }
  }

  // Usage page collapsed families - for "Other Models" section
  if (candidate.usageCollapsedFamilies && typeof candidate.usageCollapsedFamilies === 'object') {
    const sanitized = {};
    for (const [providerId, families] of Object.entries(candidate.usageCollapsedFamilies)) {
      if (typeof providerId === 'string' && Array.isArray(families)) {
        const validFamilies = families.filter((f) => typeof f === 'string' && f.length > 0);
        if (validFamilies.length > 0) {
          sanitized[providerId] = validFamilies;
        }
      }
    }
    if (Object.keys(sanitized).length > 0) {
      result.usageCollapsedFamilies = sanitized;
    }
  }

  // Header dropdown expanded families (inverted - stores EXPANDED, default all collapsed)
  if (candidate.usageExpandedFamilies && typeof candidate.usageExpandedFamilies === 'object') {
    const sanitized = {};
    for (const [providerId, families] of Object.entries(candidate.usageExpandedFamilies)) {
      if (typeof providerId === 'string' && Array.isArray(families)) {
        const validFamilies = families.filter((f) => typeof f === 'string' && f.length > 0);
        if (validFamilies.length > 0) {
          sanitized[providerId] = validFamilies;
        }
      }
    }
    if (Object.keys(sanitized).length > 0) {
      result.usageExpandedFamilies = sanitized;
    }
  }

  // Custom model groups configuration
  if (candidate.usageModelGroups && typeof candidate.usageModelGroups === 'object') {
    const sanitized = {};
    for (const [providerId, config] of Object.entries(candidate.usageModelGroups)) {
      if (typeof providerId !== 'string') continue;

      const providerConfig = {};

      // customGroups: array of {id, label, models, order}
      if (Array.isArray(config.customGroups)) {
        const validGroups = config.customGroups
          .filter((g) => g && typeof g.id === 'string' && typeof g.label === 'string')
          .map((g) => ({
            id: g.id.slice(0, 64),
            label: g.label.slice(0, 128),
            models: Array.isArray(g.models)
              ? g.models.filter((m) => typeof m === 'string').slice(0, 500)
              : [],
            order: typeof g.order === 'number' ? g.order : 0,
          }));
        if (validGroups.length > 0) {
          providerConfig.customGroups = validGroups;
        }
      }

      // modelAssignments: Record<modelName, groupId>
      if (config.modelAssignments && typeof config.modelAssignments === 'object') {
        const assignments = {};
        for (const [model, groupId] of Object.entries(config.modelAssignments)) {
          if (typeof model === 'string' && typeof groupId === 'string') {
            assignments[model] = groupId;
          }
        }
        if (Object.keys(assignments).length > 0) {
          providerConfig.modelAssignments = assignments;
        }
      }

      // renamedGroups: Record<groupId, label>
      if (config.renamedGroups && typeof config.renamedGroups === 'object') {
        const renamed = {};
        for (const [groupId, label] of Object.entries(config.renamedGroups)) {
          if (typeof groupId === 'string' && typeof label === 'string') {
            renamed[groupId] = label.slice(0, 128);
          }
        }
        if (Object.keys(renamed).length > 0) {
          providerConfig.renamedGroups = renamed;
        }
      }

      if (Object.keys(providerConfig).length > 0) {
        sanitized[providerId] = providerConfig;
      }
    }
    if (Object.keys(sanitized).length > 0) {
      result.usageModelGroups = sanitized;
    }
  }

  return result;
};

const mergePersistedSettings = (current, changes) => {
  const baseApproved = Array.isArray(changes.approvedDirectories)
    ? changes.approvedDirectories
    : Array.isArray(current.approvedDirectories)
      ? current.approvedDirectories
      : [];

  const additionalApproved = [];
  if (typeof changes.lastDirectory === 'string' && changes.lastDirectory.length > 0) {
    additionalApproved.push(changes.lastDirectory);
  }
  if (typeof changes.homeDirectory === 'string' && changes.homeDirectory.length > 0) {
    additionalApproved.push(changes.homeDirectory);
  }
  const projectEntries = Array.isArray(changes.projects)
    ? changes.projects
    : Array.isArray(current.projects)
      ? current.projects
      : [];
  projectEntries.forEach((project) => {
    if (project && typeof project.path === 'string' && project.path.length > 0) {
      additionalApproved.push(project.path);
    }
  });
  const approvedSource = [...baseApproved, ...additionalApproved];

  const baseBookmarks = Array.isArray(changes.securityScopedBookmarks)
    ? changes.securityScopedBookmarks
    : Array.isArray(current.securityScopedBookmarks)
      ? current.securityScopedBookmarks
      : [];

  const nextTypographySizes = changes.typographySizes
    ? {
        ...(current.typographySizes || {}),
        ...changes.typographySizes
      }
    : current.typographySizes;

  const next = {
    ...current,
    ...changes,
    approvedDirectories: Array.from(
      new Set(
        approvedSource.filter((entry) => typeof entry === 'string' && entry.length > 0)
      )
    ),
    securityScopedBookmarks: Array.from(
      new Set(
        baseBookmarks.filter((entry) => typeof entry === 'string' && entry.length > 0)
      )
    ),
    typographySizes: nextTypographySizes
  };

  return next;
};

const formatSettingsResponse = (settings) => {
  const sanitized = sanitizeSettingsUpdate(settings);
  delete sanitized.namedTunnelToken;
  const approved = normalizeStringArray(settings.approvedDirectories);
  const bookmarks = normalizeStringArray(settings.securityScopedBookmarks);
  const hasNamedTunnelToken = typeof settings?.namedTunnelToken === 'string' && settings.namedTunnelToken.trim().length > 0;

  return {
    ...sanitized,
    hasNamedTunnelToken,
    approvedDirectories: approved,
    securityScopedBookmarks: bookmarks,
    pinnedDirectories: normalizeStringArray(settings.pinnedDirectories),
    profiles: Array.isArray(settings.profiles) ? settings.profiles : [],
    typographySizes: sanitizeTypographySizesPartial(settings.typographySizes),
    showReasoningTraces:
      typeof settings.showReasoningTraces === 'boolean'
        ? settings.showReasoningTraces
        : typeof sanitized.showReasoningTraces === 'boolean'
          ? sanitized.showReasoningTraces
          : false
  };
};

const validateProjectEntries = async (projects) => {
  console.log(`[validateProjectEntries] Starting validation for ${projects.length} projects`);

  if (!Array.isArray(projects)) {
    console.warn(`[validateProjectEntries] Input is not an array, returning empty`);
    return [];
  }

  const validations = projects.map(async (project) => {
    if (!project || typeof project.path !== 'string' || project.path.length === 0) {
      console.error(`[validateProjectEntries] Invalid project entry: missing or empty path`, project);
      return null;
    }
    try {
      const stats = await fsPromises.stat(project.path);
      if (!stats.isDirectory()) {
        console.error(`[validateProjectEntries] Project path is not a directory: ${project.path}`);
        return null;
      }
      return project;
    } catch (error) {
      const err = error;
      console.error(`[validateProjectEntries] Failed to validate project "${project.path}": ${err.code || err.message || err}`);
      if (err && typeof err === 'object' && err.code === 'ENOENT') {
        console.log(`[validateProjectEntries] Removing project with ENOENT: ${project.path}`);
        return null;
      }
      console.log(`[validateProjectEntries] Keeping project despite non-ENOENT error: ${project.path}`);
      return project;
    }
  });

  const results = (await Promise.all(validations)).filter((p) => p !== null);

  console.log(`[validateProjectEntries] Validation complete: ${results.length}/${projects.length} projects valid`);
  return results;
};

const migrateSettingsFromLegacyLastDirectory = async (current) => {
  const settings = current && typeof current === 'object' ? current : {};
  const now = Date.now();

  const sanitizedProjects = sanitizeProjects(settings.projects) || [];
  let nextProjects = sanitizedProjects;
  let nextActiveProjectId =
    typeof settings.activeProjectId === 'string' ? settings.activeProjectId : undefined;

  let changed = false;

  if (nextProjects.length === 0) {
    const legacy = typeof settings.lastDirectory === 'string' ? settings.lastDirectory.trim() : '';
    const candidate = legacy ? resolveDirectoryCandidate(legacy) : null;

    if (candidate) {
      try {
        const stats = await fsPromises.stat(candidate);
        if (stats.isDirectory()) {
          const id = crypto.randomUUID();
          nextProjects = [
            {
              id,
              path: candidate,
              addedAt: now,
              lastOpenedAt: now,
            },
          ];
          nextActiveProjectId = id;
          changed = true;
        }
      } catch {
        // ignore invalid lastDirectory
      }
    }
  }

  if (nextProjects.length > 0) {
    const active = nextProjects.find((project) => project.id === nextActiveProjectId) || null;
    if (!active) {
      nextActiveProjectId = nextProjects[0].id;
      changed = true;
    }
  } else if (nextActiveProjectId) {
    nextActiveProjectId = undefined;
    changed = true;
  }

  if (!changed) {
    return { settings, changed: false };
  }

  const merged = mergePersistedSettings(settings, {
    ...settings,
    projects: nextProjects,
    ...(nextActiveProjectId ? { activeProjectId: nextActiveProjectId } : { activeProjectId: undefined }),
  });

  return { settings: merged, changed: true };
};

const migrateSettingsFromLegacyThemePreferences = async (current) => {
  const settings = current && typeof current === 'object' ? current : {};

  const themeId = typeof settings.themeId === 'string' ? settings.themeId.trim() : '';
  const themeVariant = typeof settings.themeVariant === 'string' ? settings.themeVariant.trim() : '';

  const hasLight = typeof settings.lightThemeId === 'string' && settings.lightThemeId.trim().length > 0;
  const hasDark = typeof settings.darkThemeId === 'string' && settings.darkThemeId.trim().length > 0;

  if (hasLight && hasDark) {
    return { settings, changed: false };
  }

  const defaultLight = 'flexoki-light';
  const defaultDark = 'flexoki-dark';

  let nextLightThemeId = hasLight ? settings.lightThemeId : undefined;
  let nextDarkThemeId = hasDark ? settings.darkThemeId : undefined;

  if (!hasLight) {
    if (themeId && themeVariant === 'light') {
      nextLightThemeId = themeId;
    } else {
      nextLightThemeId = defaultLight;
    }
  }

  if (!hasDark) {
    if (themeId && themeVariant === 'dark') {
      nextDarkThemeId = themeId;
    } else {
      nextDarkThemeId = defaultDark;
    }
  }

  const merged = mergePersistedSettings(settings, {
    ...settings,
    ...(nextLightThemeId ? { lightThemeId: nextLightThemeId } : {}),
    ...(nextDarkThemeId ? { darkThemeId: nextDarkThemeId } : {}),
  });

  return { settings: merged, changed: true };
};

const migrateSettingsFromLegacyCollapsedProjects = async (current) => {
  const settings = current && typeof current === 'object' ? current : {};
  const collapsed = Array.isArray(settings.collapsedProjects)
    ? normalizeStringArray(settings.collapsedProjects)
    : [];

  if (collapsed.length === 0 || !Array.isArray(settings.projects)) {
    if (collapsed.length === 0) {
      return { settings, changed: false };
    }
    // Nothing to apply to; drop legacy key.
    const next = { ...settings };
    delete next.collapsedProjects;
    return { settings: next, changed: true };
  }

  const set = new Set(collapsed);
  const projects = sanitizeProjects(settings.projects) || [];
  let changed = false;

  const nextProjects = projects.map((project) => {
    const shouldCollapse = set.has(project.id);
    if (project.sidebarCollapsed !== shouldCollapse) {
      changed = true;
      return { ...project, sidebarCollapsed: shouldCollapse };
    }
    return project;
  });

  if (!changed) {
    // Still drop legacy key if present.
    if (Object.prototype.hasOwnProperty.call(settings, 'collapsedProjects')) {
      const next = { ...settings };
      delete next.collapsedProjects;
      return { settings: next, changed: true };
    }
    return { settings, changed: false };
  }

  const next = { ...settings, projects: nextProjects };
  delete next.collapsedProjects;
  return { settings: next, changed: true };
};

const DEFAULT_NOTIFICATION_TEMPLATES = {
  completion: { title: '{agent_name} is ready', message: '{model_name} completed the task' },
  error: { title: 'Tool error', message: '{last_message}' },
  question: { title: 'Input needed', message: '{last_message}' },
  subtask: { title: '{agent_name} is ready', message: '{model_name} completed the task' },
};

const ensureNotificationTemplateShape = (templates) => {
  const input = templates && typeof templates === 'object' ? templates : {};
  let changed = false;
  const next = {};

  for (const event of Object.keys(DEFAULT_NOTIFICATION_TEMPLATES)) {
    const currentEntry = input[event];
    const base = DEFAULT_NOTIFICATION_TEMPLATES[event];
    const currentTitle = typeof currentEntry?.title === 'string' ? currentEntry.title : base.title;
    const currentMessage = typeof currentEntry?.message === 'string' ? currentEntry.message : base.message;
    if (!currentEntry || typeof currentEntry.title !== 'string' || typeof currentEntry.message !== 'string') {
      changed = true;
    }
    next[event] = { title: currentTitle, message: currentMessage };
  }

  return { templates: next, changed };
};

const migrateSettingsNotificationDefaults = async (current) => {
  const settings = current && typeof current === 'object' ? current : {};
  let changed = false;
  const next = { ...settings };

  if (typeof settings.notifyOnSubtasks !== 'boolean') {
    next.notifyOnSubtasks = true;
    changed = true;
  }
  if (typeof settings.notifyOnCompletion !== 'boolean') {
    next.notifyOnCompletion = true;
    changed = true;
  }
  if (typeof settings.notifyOnError !== 'boolean') {
    next.notifyOnError = true;
    changed = true;
  }
  if (typeof settings.notifyOnQuestion !== 'boolean') {
    next.notifyOnQuestion = true;
    changed = true;
  }

  const { templates, changed: templatesChanged } = ensureNotificationTemplateShape(settings.notificationTemplates);
  if (templatesChanged || !settings.notificationTemplates || typeof settings.notificationTemplates !== 'object') {
    next.notificationTemplates = templates;
    changed = true;
  }

  return { settings: changed ? next : settings, changed };
};

const readSettingsFromDiskMigrated = async () => {
  const current = await readSettingsFromDisk();
  const migration1 = await migrateSettingsFromLegacyLastDirectory(current);
  const migration2 = await migrateSettingsFromLegacyThemePreferences(migration1.settings);
  const migration3 = await migrateSettingsFromLegacyCollapsedProjects(migration2.settings);
  const migration4 = await migrateSettingsNotificationDefaults(migration3.settings);
  if (migration1.changed || migration2.changed || migration3.changed || migration4.changed) {
    await writeSettingsToDisk(migration4.settings);
  }
  return migration4.settings;
};

const getOrCreateVapidKeys = async () => {
  const settings = await readSettingsFromDiskMigrated();
  const existing = settings?.vapidKeys;
  if (existing && typeof existing.publicKey === 'string' && typeof existing.privateKey === 'string') {
    return { publicKey: existing.publicKey, privateKey: existing.privateKey };
  }

  const generated = webPush.generateVAPIDKeys();
  const next = {
    ...settings,
    vapidKeys: {
      publicKey: generated.publicKey,
      privateKey: generated.privateKey,
    },
  };

  await writeSettingsToDisk(next);
  return { publicKey: generated.publicKey, privateKey: generated.privateKey };
};

const getUiSessionTokenFromRequest = (req) => {
  const cookieHeader = req?.headers?.cookie;
  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return null;
  }
  const segments = cookieHeader.split(';');
  for (const segment of segments) {
    const [rawName, ...rest] = segment.split('=');
    const name = rawName?.trim();
    if (!name) continue;
    if (name !== 'oc_ui_session') continue;
    const value = rest.join('=').trim();
    try {
      return decodeURIComponent(value || '');
    } catch {
      return value || null;
    }
  }
  return null;
};

const TERMINAL_INPUT_WS_MAX_REBINDS_PER_WINDOW = 128;
const TERMINAL_INPUT_WS_REBIND_WINDOW_MS = 60 * 1000;
const TERMINAL_INPUT_WS_HEARTBEAT_INTERVAL_MS = 15 * 1000;

const rejectWebSocketUpgrade = (...args) => requestSecurityRuntime.rejectWebSocketUpgrade(...args);


const isRequestOriginAllowed = (...args) => requestSecurityRuntime.isRequestOriginAllowed(...args);

const notificationEmitterRuntime = createNotificationEmitterRuntime({
  process,
  getDesktopNotifyEnabled: () => ENV_DESKTOP_NOTIFY,
  desktopNotifyPrefix: DESKTOP_NOTIFY_PREFIX,
  getUiNotificationClients: () => uiNotificationClients,
  getBroadcastGlobalUiEvent: () => broadcastGlobalUiEvent,
});

const writeSseEvent = (...args) => notificationEmitterRuntime.writeSseEvent(...args);
const emitDesktopNotification = (...args) => notificationEmitterRuntime.emitDesktopNotification(...args);
const broadcastGlobalUiEvent = createGlobalUiEventBroadcaster({
  sseClients: uiNotificationClients,
  wsClients: uiNotificationWsClients,
  writeSseEvent,
});
const broadcastUiNotification = (...args) => notificationEmitterRuntime.broadcastUiNotification(...args);

const sessionRuntime = createSessionRuntime({
  writeSseEvent,
  getNotificationClients: () => uiNotificationClients,
  broadcastEvent: broadcastGlobalUiEvent,
});

const getActiveSessionCount = () => {
  const snapshot = sessionRuntime.getSessionActivitySnapshot();
  return Object.values(snapshot).filter((entry) => entry.type === 'busy').length;
};


const getRequestOriginCandidates = async (req) => {
  const origins = new Set();
  const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string'
    ? req.headers['x-forwarded-proto'].split(',')[0].trim().toLowerCase()
    : '';
  const protocol = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');

  const forwardedHost = typeof req.headers['x-forwarded-host'] === 'string'
    ? req.headers['x-forwarded-host'].split(',')[0].trim()
    : '';
  const host = forwardedHost || (typeof req.headers.host === 'string' ? req.headers.host.trim() : '');

  if (host) {
    origins.add(`${protocol}://${host}`);
    const [hostname, port] = host.split(':');
    const normalizedHost = typeof hostname === 'string' ? hostname.toLowerCase() : '';
    const portSuffix = typeof port === 'string' && port.length > 0 ? `:${port}` : '';
    if (normalizedHost === 'localhost') {
      origins.add(`${protocol}://127.0.0.1${portSuffix}`);
      origins.add(`${protocol}://[::1]${portSuffix}`);
    } else if (normalizedHost === '127.0.0.1' || normalizedHost === '[::1]') {
      origins.add(`${protocol}://localhost${portSuffix}`);
    }
  }

  try {
    const settings = await readSettingsFromDiskMigrated();
    if (typeof settings?.publicOrigin === 'string' && settings.publicOrigin.trim().length > 0) {
      origins.add(new URL(settings.publicOrigin.trim()).origin);
    }
  } catch {
  }

  return origins;
};

const isRequestOriginAllowed = async (req) => {
  const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
  if (!originHeader) {
    return false;
  }

  let parsedOrigin;
  try {
    parsedOrigin = new URL(originHeader);
  } catch {
    return false;
  }

  const protocol = parsedOrigin.protocol.toLowerCase();
  const hostname = parsedOrigin.hostname.toLowerCase();
  const isLocalTauriOrigin = (protocol === 'tauri:' || protocol === 'app:')
    && (hostname === 'localhost' || hostname === 'tauri.localhost' || hostname === 'app.localhost');
  if (isLocalTauriOrigin) {
    return true;
  }

  const normalizedOrigin = parsedOrigin.origin;
  if (normalizedOrigin === 'null') {
    return false;
  }

  const isSecureTauriLocalhost = (protocol === 'https:' || protocol === 'http:')
    && (hostname === 'tauri.localhost' || hostname === 'app.localhost');
  if (isSecureTauriLocalhost) {
    return true;
  }

  const allowedOrigins = await getRequestOriginCandidates(req);
  return allowedOrigins.has(normalizedOrigin);
};

const DEVICE_GRANT_TTL_MS = 10 * 60 * 1000;
const DEVICE_GRANT_DEFAULT_INTERVAL_SECONDS = 5;
const DEVICE_CODE_BYTES = 24;
const DEVICE_TOKEN_BYTES = 48;
const DEVICE_POLL_MIN_INTERVAL_MS = 1000;
const DEVICE_TOKEN_TTL_DAYS = Number.parseInt(process.env.OPENCHAMBER_DEVICE_TOKEN_TTL_DAYS || '30', 10);
const DEVICE_LAST_USED_TOUCH_MS = 60 * 1000;
const DEVICE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const pendingDeviceGrantsByCode = new Map();
const pendingDeviceGrantCodeByUserCode = new Map();
const deviceLastUsedTouchCache = new Map();

const normalizedDeviceTokenTtlMs = Math.max(1, Number.isFinite(DEVICE_TOKEN_TTL_DAYS) ? DEVICE_TOKEN_TTL_DAYS : 30) * 24 * 60 * 60 * 1000;

const normalizeUserCode = (value) => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
};

const formatUserCode = (value) => {
  const normalized = normalizeUserCode(value);
  if (normalized.length < 8) {
    return normalized;
  }
  return `${normalized.slice(0, 4)}-${normalized.slice(4, 8)}`;
};

const randomCode = (length) => {
  let output = '';
  for (let i = 0; i < length; i += 1) {
    output += DEVICE_CODE_CHARS[Math.floor(Math.random() * DEVICE_CODE_CHARS.length)];
  }
  return output;
};

const createUserCode = () => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const raw = randomCode(8);
    const normalized = normalizeUserCode(raw);
    if (!pendingDeviceGrantCodeByUserCode.has(normalized)) {
      return formatUserCode(normalized);
    }
  }
  return formatUserCode(`${Date.now().toString(36).toUpperCase()}${randomCode(8)}`.slice(0, 8));
};

const normalizeDeviceRecord = (entry) => {
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  const id = typeof entry.id === 'string' && entry.id.trim().length > 0 ? entry.id.trim() : null;
  const tokenHash = typeof entry.tokenHash === 'string' && entry.tokenHash.trim().length > 0 ? entry.tokenHash.trim() : null;
  const name = typeof entry.name === 'string' && entry.name.trim().length > 0 ? entry.name.trim() : 'Device';
  const createdAt = Number.isFinite(entry.createdAt) ? Number(entry.createdAt) : Date.now();
  const expiresAt = Number.isFinite(entry.expiresAt) ? Number(entry.expiresAt) : createdAt + normalizedDeviceTokenTtlMs;
  const lastUsedAt = Number.isFinite(entry.lastUsedAt) ? Number(entry.lastUsedAt) : null;
  const userAgent = typeof entry.userAgent === 'string' ? entry.userAgent : '';
  const platform = normalizeDevicePlatform(entry.platform);

  if (!id || !tokenHash) {
    return null;
  }

  return {
    id,
    name,
    createdAt,
    lastUsedAt,
    expiresAt,
    userAgent,
    platform,
    tokenHash,
  };
};

const normalizeDevicePlatformField = (value, maxLength = 120) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, maxLength);
};

const normalizeDevicePlatform = (value) => {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const platform = {
    ...(normalizeDevicePlatformField(value.os) ? { os: normalizeDevicePlatformField(value.os) } : {}),
    ...(normalizeDevicePlatformField(value.model) ? { model: normalizeDevicePlatformField(value.model) } : {}),
    ...(normalizeDevicePlatformField(value.version) ? { version: normalizeDevicePlatformField(value.version) } : {}),
    ...(normalizeDevicePlatformField(value.arch) ? { arch: normalizeDevicePlatformField(value.arch) } : {}),
    ...(normalizeDevicePlatformField(value.type) ? { type: normalizeDevicePlatformField(value.type) } : {}),
    ...(normalizeDevicePlatformField(value.runtime) ? { runtime: normalizeDevicePlatformField(value.runtime, 32) } : {}),
  };

  return platform;
};

const readDeviceRecordsFromSettings = async () => {
  const settings = await readSettingsFromDiskMigrated();
  const entries = Array.isArray(settings?.devices) ? settings.devices : [];
  return entries
    .map(normalizeDeviceRecord)
    .filter(Boolean);
};

const writeDeviceRecordsToSettings = async (devices) => {
  const settings = await readSettingsFromDiskMigrated();
  await writeSettingsToDisk({
    ...settings,
    devices,
  });
};

const hashDeviceToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

const parseDevicePlatform = (userAgent) => {
  if (typeof userAgent !== 'string' || userAgent.length === 0) {
    return {};
  }

  const ua = userAgent.toLowerCase();
  const os = ua.includes('windows')
    ? 'Windows'
    : ua.includes('mac os') || ua.includes('macintosh')
      ? 'macOS'
      : ua.includes('android')
        ? 'Android'
        : ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')
          ? 'iOS'
          : ua.includes('linux')
            ? 'Linux'
            : undefined;

  const model = ua.includes('iphone')
    ? 'iPhone'
    : ua.includes('ipad')
      ? 'iPad'
      : ua.includes('android')
        ? 'Android'
        : undefined;

  return {
    ...(os ? { os } : {}),
    ...(model ? { model } : {}),
  };
};

const resolveGrantPlatform = (requestedPlatform, userAgent) => {
  const normalizedRequested = normalizeDevicePlatform(requestedPlatform);
  const parsedFallback = parseDevicePlatform(userAgent);
  return normalizeDevicePlatform({
    ...parsedFallback,
    ...normalizedRequested,
  });
};

const toPublicDeviceRecord = (record) => {
  if (!record) {
    return null;
  }
  return {
    id: record.id,
    name: record.name,
    createdAt: record.createdAt,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
    userAgent: record.userAgent,
    platform: record.platform,
  };
};

const prunePendingDeviceGrants = () => {
  const now = Date.now();
  for (const [deviceCode, grant] of pendingDeviceGrantsByCode.entries()) {
    if (!grant || typeof grant !== 'object') {
      pendingDeviceGrantsByCode.delete(deviceCode);
      continue;
    }
    if (grant.expiresAt <= now || grant.status === 'denied') {
      pendingDeviceGrantsByCode.delete(deviceCode);
      pendingDeviceGrantCodeByUserCode.delete(grant.userCodeNormalized);
    }
  }
};

const resolveRequestOrigin = async (req) => {
  const explicit = typeof process.env.OPENCHAMBER_PUBLIC_ORIGIN === 'string' && process.env.OPENCHAMBER_PUBLIC_ORIGIN.trim().length > 0
    ? process.env.OPENCHAMBER_PUBLIC_ORIGIN.trim()
    : null;
  if (explicit) {
    try {
      return new URL(explicit).origin;
    } catch {
    }
  }

  try {
    const settings = await readSettingsFromDiskMigrated();
    if (typeof settings?.publicOrigin === 'string' && settings.publicOrigin.trim().length > 0) {
      return new URL(settings.publicOrigin.trim()).origin;
    }
  } catch {
  }

  const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string'
    ? req.headers['x-forwarded-proto'].split(',')[0].trim().toLowerCase()
    : '';
  const protocol = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
  const forwardedHost = typeof req.headers['x-forwarded-host'] === 'string'
    ? req.headers['x-forwarded-host'].split(',')[0].trim()
    : '';
  const host = forwardedHost || (typeof req.headers.host === 'string' ? req.headers.host.trim() : '');
  if (host) {
    return `${protocol}://${host}`;
  }

  return null;
};

const parseHttpOrigin = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
};

const parseHttpApiBase = (value) => {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
    return {
      origin: parsed.origin,
      pathname: parsed.pathname || '/',
    };
  } catch {
    return null;
  }
};

const resolveRequestHostOrigin = (req) => {
  const forwardedProto = typeof req.headers['x-forwarded-proto'] === 'string'
    ? req.headers['x-forwarded-proto'].split(',')[0].trim().toLowerCase()
    : '';
  const protocol = forwardedProto || (req.socket?.encrypted ? 'https' : 'http');
  const forwardedHost = typeof req.headers['x-forwarded-host'] === 'string'
    ? req.headers['x-forwarded-host'].split(',')[0].trim()
    : '';
  const host = forwardedHost || (typeof req.headers.host === 'string' ? req.headers.host.trim() : '');
  if (!host) {
    return null;
  }
  return `${protocol}://${host}`;
};

const resolveDirectServerOrigin = (req) => {
  const localPort = Number.isFinite(req.socket?.localPort) ? Number(req.socket.localPort) : 0;
  if (!localPort || localPort < 1) {
    return null;
  }
  const protocol = req.socket?.encrypted ? 'https' : 'http';
  return `${protocol}://localhost:${localPort}`;
};

const normalizeVerificationOriginCandidate = (origin, req) => {
  if (typeof origin !== 'string' || !origin.trim()) {
    return null;
  }

  const directServerOrigin = resolveDirectServerOrigin(req);
  try {
    const parsed = new URL(origin);
    const hostName = parsed.hostname.toLowerCase();
    const hostPort = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
    const isLikelyUiDevProxy =
      (hostName === 'localhost' || hostName === '127.0.0.1' || hostName === '[::1]')
      && (hostPort === '5173' || hostPort === '4173' || hostPort === '8080');

    if (isLikelyUiDevProxy && directServerOrigin) {
      return directServerOrigin;
    }
  } catch {
    return null;
  }

  return origin;
};

const resolveDeviceVerificationOrigin = async (req, options = {}) => {
  const explicitApiBase = parseHttpApiBase(options.verificationApiBaseUrl);
  if (explicitApiBase) {
    const normalized = normalizeVerificationOriginCandidate(explicitApiBase.origin, req);
    if (normalized) {
      return normalized;
    }
  }

  const explicitOrigin = parseHttpOrigin(options.verificationOrigin);
  if (explicitOrigin) {
    const normalized = normalizeVerificationOriginCandidate(explicitOrigin, req);
    if (normalized) {
      return normalized;
    }
  }

  const hostOrigin = resolveRequestHostOrigin(req);
  const directServerOrigin = resolveDirectServerOrigin(req);

  if (hostOrigin) {
    const normalized = normalizeVerificationOriginCandidate(hostOrigin, req);
    if (normalized) {
      return normalized;
    }
  }

  if (directServerOrigin) {
    return directServerOrigin;
  }

  return await resolveRequestOrigin(req);
};

const getBearerTokenFromRequest = (req) => {
  const value = typeof req.headers.authorization === 'string' ? req.headers.authorization.trim() : '';
  if (value) {
    const match = value.match(/^Bearer\s+(.+)$/i);
    if (!match || !match[1]) {
      return null;
    }
    const token = match[1].trim();
    return token.length > 0 ? token : null;
  }

  const queryToken = (() => {
    const fromExpressQuery = req.query?.access_token;
    if (typeof fromExpressQuery === 'string' && fromExpressQuery.trim().length > 0) {
      return fromExpressQuery.trim();
    }
    if (Array.isArray(fromExpressQuery) && typeof fromExpressQuery[0] === 'string' && fromExpressQuery[0].trim().length > 0) {
      return fromExpressQuery[0].trim();
    }

    const rawUrl = typeof req.url === 'string' ? req.url : '';
    if (!rawUrl) {
      return null;
    }

    try {
      const parsed = new URL(rawUrl, 'http://localhost');
      const fromUrl = parsed.searchParams.get('access_token');
      if (typeof fromUrl === 'string' && fromUrl.trim().length > 0) {
        return fromUrl.trim();
      }
    } catch {
    }

    return null;
  })();

  return queryToken;
};

const authenticateBearerDevice = async (req) => {
  const token = getBearerTokenFromRequest(req);
  if (!token) {
    return null;
  }

  const tokenHash = hashDeviceToken(token);
  const now = Date.now();
  const devices = await readDeviceRecordsFromSettings();
  const device = devices.find((entry) => entry.tokenHash === tokenHash) || null;
  if (!device) {
    return null;
  }

  if (device.expiresAt <= now) {
    const nextDevices = devices.filter((entry) => entry.id !== device.id);
    await writeDeviceRecordsToSettings(nextDevices);
    return null;
  }

  const lastTouchAt = deviceLastUsedTouchCache.get(device.id) || 0;
  if (now - lastTouchAt >= DEVICE_LAST_USED_TOUCH_MS && (!device.lastUsedAt || now - device.lastUsedAt >= DEVICE_LAST_USED_TOUCH_MS)) {
    const nextDevices = devices.map((entry) => {
      if (entry.id !== device.id) {
        return entry;
      }
      return {
        ...entry,
        lastUsedAt: now,
      };
    });
    deviceLastUsedTouchCache.set(device.id, now);
    await writeDeviceRecordsToSettings(nextDevices);
  }

  return device;
};

const normalizePushSubscriptions = (record) => {
  if (!Array.isArray(record)) return [];
  return record
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const endpoint = entry.endpoint;
      const p256dh = entry.p256dh;
      const auth = entry.auth;
      if (typeof endpoint !== 'string' || typeof p256dh !== 'string' || typeof auth !== 'string') {
        return null;
      }
      return {
        endpoint,
        p256dh,
        auth,
        createdAt: typeof entry.createdAt === 'number' ? entry.createdAt : null,
      };
    })
    .filter(Boolean);
};

const getPushSubscriptionsForUiSession = async (uiSessionToken) => {
  if (!uiSessionToken) return [];
  const store = await readPushSubscriptionsFromDisk();
  const record = store.subscriptionsBySession?.[uiSessionToken];
  return normalizePushSubscriptions(record);
};

const addOrUpdatePushSubscription = async (uiSessionToken, subscription, userAgent) => {
  if (!uiSessionToken) {
    return;
  }

  await ensurePushInitialized();

  const now = Date.now();

  await persistPushSubscriptionUpdate((current) => {
    const subsBySession = { ...(current.subscriptionsBySession || {}) };
    const existing = Array.isArray(subsBySession[uiSessionToken]) ? subsBySession[uiSessionToken] : [];

    const filtered = existing.filter((entry) => entry && typeof entry.endpoint === 'string' && entry.endpoint !== subscription.endpoint);

    filtered.unshift({
      endpoint: subscription.endpoint,
      p256dh: subscription.p256dh,
      auth: subscription.auth,
      createdAt: now,
      lastSeenAt: now,
      userAgent: typeof userAgent === 'string' && userAgent.length > 0 ? userAgent : undefined,
    });

    subsBySession[uiSessionToken] = filtered.slice(0, 10);

    return { version: PUSH_SUBSCRIPTIONS_VERSION, subscriptionsBySession: subsBySession };
  });
};

const removePushSubscription = async (uiSessionToken, endpoint) => {
  if (!uiSessionToken || !endpoint) return;

  await ensurePushInitialized();

  await persistPushSubscriptionUpdate((current) => {
    const subsBySession = { ...(current.subscriptionsBySession || {}) };
    const existing = Array.isArray(subsBySession[uiSessionToken]) ? subsBySession[uiSessionToken] : [];
    const filtered = existing.filter((entry) => entry && typeof entry.endpoint === 'string' && entry.endpoint !== endpoint);
    if (filtered.length === 0) {
      delete subsBySession[uiSessionToken];
    } else {
      subsBySession[uiSessionToken] = filtered;
    }
    return { version: PUSH_SUBSCRIPTIONS_VERSION, subscriptionsBySession: subsBySession };
  });
};

const removePushSubscriptionFromAllSessions = async (endpoint) => {
  if (!endpoint) return;

  await ensurePushInitialized();

  await persistPushSubscriptionUpdate((current) => {
    const subsBySession = { ...(current.subscriptionsBySession || {}) };
    for (const [token, entries] of Object.entries(subsBySession)) {
      if (!Array.isArray(entries)) continue;
      const filtered = entries.filter((entry) => entry && typeof entry.endpoint === 'string' && entry.endpoint !== endpoint);
      if (filtered.length === 0) {
        delete subsBySession[token];
      } else {
        subsBySession[token] = filtered;
      }
    }
    return { version: PUSH_SUBSCRIPTIONS_VERSION, subscriptionsBySession: subsBySession };
  });
};

const buildSessionDeepLinkUrl = (sessionId) => {
  if (!sessionId || typeof sessionId !== 'string') {
    return '/';
  }
  return `/?session=${encodeURIComponent(sessionId)}`;
};

const sendPushToSubscription = async (sub, payload) => {
  await ensurePushInitialized();
  const body = JSON.stringify(payload);

  const pushSubscription = {
    endpoint: sub.endpoint,
    keys: {
      p256dh: sub.p256dh,
      auth: sub.auth,
    }
  };

  try {
    await webPush.sendNotification(pushSubscription, body);
  } catch (error) {
    const statusCode = typeof error?.statusCode === 'number' ? error.statusCode : null;
    if (statusCode === 410 || statusCode === 404) {
      await removePushSubscriptionFromAllSessions(sub.endpoint);
      return;
    }
    console.warn('[Push] Failed to send notification:', error);
  }
};

const sendPushToAllUiSessions = async (payload, options = {}) => {
  const requireNoSse = options.requireNoSse === true;
  const store = await readPushSubscriptionsFromDisk();
  const sessions = store.subscriptionsBySession || {};
  const subscriptionsByEndpoint = new Map();

  for (const [token, record] of Object.entries(sessions)) {
    const subscriptions = normalizePushSubscriptions(record);
    if (subscriptions.length === 0) continue;

    for (const sub of subscriptions) {
      if (!subscriptionsByEndpoint.has(sub.endpoint)) {
        subscriptionsByEndpoint.set(sub.endpoint, sub);
      }
    }
  }

  await Promise.all(Array.from(subscriptionsByEndpoint.entries()).map(async ([endpoint, sub]) => {
    if (requireNoSse && isAnyUiVisible()) {
      return;
    }
    await sendPushToSubscription(sub, payload);
  }));
};

let pushInitialized = false;



const uiVisibilityByToken = new Map();
let globalVisibilityState = false;

const updateUiVisibility = (token, visible) => {
  if (!token) return;
  const now = Date.now();
  const nextVisible = Boolean(visible);
  uiVisibilityByToken.set(token, { visible: nextVisible, updatedAt: now });
  globalVisibilityState = nextVisible;

};

const isAnyUiVisible = () => globalVisibilityState === true;

const isUiVisible = (token) => uiVisibilityByToken.get(token)?.visible === true;

// Session activity tracking (mirrors desktop session_activity.rs)
const sessionActivityPhases = new Map(); // sessionId -> { phase: 'idle'|'busy'|'cooldown', updatedAt: number }
const sessionActivityCooldowns = new Map(); // sessionId -> timeoutId
const SESSION_COOLDOWN_DURATION_MS = 2000;

// Complete session status tracking - source of truth for web clients
// This maintains the authoritative state, clients only cache it
const sessionStates = new Map(); // sessionId -> {
//   status: 'idle'|'busy'|'retry',
//   lastUpdateAt: number,
//   lastEventId: string,
//   metadata: { attempt?: number, message?: string, next?: number }
// }
const SESSION_STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_STATE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

const updateSessionState = (sessionId, status, eventId, metadata = {}) => {
  if (!sessionId || typeof sessionId !== 'string') return;

  const now = Date.now();
  const existing = sessionStates.get(sessionId);

  // Only update if this is a newer event (simple ordering protection)
  if (existing && existing.lastUpdateAt > now - 5000 && status === existing.status) {
    // Same status within 5 seconds, skip to reduce noise
    return;
  }

  sessionStates.set(sessionId, {
    status,
    lastUpdateAt: now,
    lastEventId: eventId || `server-${now}`,
    metadata: { ...existing?.metadata, ...metadata }
  });

  // Update attention tracking state (must be called before broadcasting)
  updateSessionAttentionStatus(sessionId, status, eventId);

  // Broadcast status change to connected web clients via SSE
  // This enables real-time updates without polling
  // Include needsAttention in the same event to ensure atomic updates
  if (uiNotificationClients.size > 0 && (!existing || existing.status !== status)) {
    const state = sessionStates.get(sessionId);
    const attentionState = sessionAttentionStates.get(sessionId);
    for (const res of uiNotificationClients) {
      try {
        writeSseEvent(res, {
          type: 'openchamber:session-status',
          properties: {
            sessionId,
            status: state.status,
            timestamp: state.lastUpdateAt,
            metadata: state.metadata,
            needsAttention: attentionState?.needsAttention ?? false
          }
        });
      } catch {
        // Client disconnected, will be cleaned up by close handler
      }
    }
  }

  // Also update activity phases for backward compatibility
  const phase = status === 'busy' || status === 'retry' ? 'busy' : 'idle';
  setSessionActivityPhase(sessionId, phase);
};

const getSessionStateSnapshot = () => {
  const result = {};
  const now = Date.now();

  for (const [sessionId, data] of sessionStates) {
    // Skip very old states (session likely gone)
    if (now - data.lastUpdateAt > SESSION_STATE_MAX_AGE_MS) continue;

    result[sessionId] = {
      status: data.status,
      lastUpdateAt: data.lastUpdateAt,
      metadata: data.metadata
    };
  }

  return result;
};

const getSessionState = (sessionId) => {
  if (!sessionId) return null;
  return sessionStates.get(sessionId) || null;
};

// Session attention tracking - authoritative source for unread/needs-attention state
// Tracks which sessions need user attention based on activity and view state
const sessionAttentionStates = new Map(); // sessionId -> {
//   needsAttention: boolean,
//   lastUserMessageAt: number | null,
//   lastStatusChangeAt: number,
//   viewedByClients: Set<clientId>,
//   status: 'idle' | 'busy' | 'retry'
// }
const SESSION_ATTENTION_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

const getOrCreateAttentionState = (sessionId) => {
  if (!sessionId || typeof sessionId !== 'string') return null;

  let state = sessionAttentionStates.get(sessionId);
  if (!state) {
    state = {
      needsAttention: false,
      lastUserMessageAt: null,
      lastStatusChangeAt: Date.now(),
      viewedByClients: new Set(),
      status: 'idle'
    };
    sessionAttentionStates.set(sessionId, state);
  }
  return state;
};

const updateSessionAttentionStatus = (sessionId, status, eventId) => {
  const state = getOrCreateAttentionState(sessionId);
  if (!state) return;

  const prevStatus = state.status;
  state.status = status;
  state.lastStatusChangeAt = Date.now();

  // Check if we need to mark as needsAttention
  // Condition: transitioning from busy/retry to idle + user sent message + not currently viewed
  // Note: The actual broadcast with needsAttention is done in updateSessionState
  // to ensure both status and attention are sent in a single event
  if ((prevStatus === 'busy' || prevStatus === 'retry') && status === 'idle') {
    if (state.lastUserMessageAt && state.viewedByClients.size === 0) {
      state.needsAttention = true;
    }
  }
};

const markSessionViewed = (sessionId, clientId) => {
  const state = getOrCreateAttentionState(sessionId);
  if (!state) return;

  const wasNeedsAttention = state.needsAttention;
  state.viewedByClients.add(clientId);

  // Clear needsAttention when viewed
  if (wasNeedsAttention) {
    state.needsAttention = false;

    // Broadcast attention cleared event
    if (uiNotificationClients.size > 0) {
      for (const res of uiNotificationClients) {
        try {
          writeSseEvent(res, {
            type: 'openchamber:session-status',
            properties: {
              sessionId,
              status: state.status,
              timestamp: Date.now(),
              metadata: {},
              needsAttention: false
            }
          });
        } catch {
          // Client disconnected
        }
      }
    }
  }
};

const markSessionUnviewed = (sessionId, clientId) => {
  const state = sessionAttentionStates.get(sessionId);
  if (!state) return;

  state.viewedByClients.delete(clientId);
};

const markUserMessageSent = (sessionId) => {
  const state = getOrCreateAttentionState(sessionId);
  if (!state) return;

  state.lastUserMessageAt = Date.now();
};

const getSessionAttentionSnapshot = () => {
  const result = {};
  const now = Date.now();

  for (const [sessionId, state] of sessionAttentionStates) {
    // Skip very old states
    if (now - state.lastStatusChangeAt > SESSION_ATTENTION_MAX_AGE_MS) continue;

    result[sessionId] = {
      needsAttention: state.needsAttention,
      lastUserMessageAt: state.lastUserMessageAt,
      lastStatusChangeAt: state.lastStatusChangeAt,
      status: state.status,
      isViewed: state.viewedByClients.size > 0
    };
  }

  return result;
};

const getSessionAttentionState = (sessionId) => {
  if (!sessionId) return null;
  const state = sessionAttentionStates.get(sessionId);
  if (!state) return null;

  return {
    needsAttention: state.needsAttention,
    lastUserMessageAt: state.lastUserMessageAt,
    lastStatusChangeAt: state.lastStatusChangeAt,
    status: state.status,
    isViewed: state.viewedByClients.size > 0
  };
};

const cleanupOldSessionStates = () => {
  const now = Date.now();
  let cleaned = 0;

  for (const [sessionId, data] of sessionStates) {
    if (now - data.lastUpdateAt > SESSION_STATE_MAX_AGE_MS) {
      sessionStates.delete(sessionId);
      cleaned++;
    }
  }

  // Also cleanup attention states
  for (const [sessionId, state] of sessionAttentionStates) {
    if (now - state.lastStatusChangeAt > SESSION_ATTENTION_MAX_AGE_MS) {
      sessionAttentionStates.delete(sessionId);
      cleaned++;
    }
  }

  if (cleaned > 0) {
    console.info(`[SessionState] Cleaned up ${cleaned} old session states`);
  }
};

// Start periodic cleanup
setInterval(cleanupOldSessionStates, SESSION_STATE_CLEANUP_INTERVAL_MS);

const setSessionActivityPhase = (sessionId, phase) => {
  if (!sessionId || typeof sessionId !== 'string') return false;

  const current = sessionActivityPhases.get(sessionId);
  if (current?.phase === phase) return false; // No change

  // Match desktop semantics: only enter cooldown from busy.
  if (phase === 'cooldown' && current?.phase !== 'busy') {
    return false;
  }

  // Cancel existing cooldown timer only on phase change.
  const existingTimer = sessionActivityCooldowns.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    sessionActivityCooldowns.delete(sessionId);
  }

  sessionActivityPhases.set(sessionId, { phase, updatedAt: Date.now() });

  // Schedule transition from cooldown to idle
  if (phase === 'cooldown') {
    const timer = setTimeout(() => {
      const now = sessionActivityPhases.get(sessionId);
      if (now?.phase === 'cooldown') {
        sessionActivityPhases.set(sessionId, { phase: 'idle', updatedAt: Date.now() });
      }
      sessionActivityCooldowns.delete(sessionId);
    }, SESSION_COOLDOWN_DURATION_MS);
    sessionActivityCooldowns.set(sessionId, timer);
  }

  return true;
};

const getSessionActivitySnapshot = () => {
  const result = {};
  for (const [sessionId, data] of sessionActivityPhases) {
    result[sessionId] = { type: data.phase };
  }
  return result;
};

const resetAllSessionActivityToIdle = () => {
  // Cancel all cooldown timers
  for (const timer of sessionActivityCooldowns.values()) {
    clearTimeout(timer);
  }
  sessionActivityCooldowns.clear();
  
  // Reset all phases to idle
  const now = Date.now();
  for (const [sessionId] of sessionActivityPhases) {
    sessionActivityPhases.set(sessionId, { phase: 'idle', updatedAt: now });
  }
};

const resolveVapidSubject = async () => {
  const configured = process.env.OPENCHAMBER_VAPID_SUBJECT;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim();
  }

  const originEnv = process.env.OPENCHAMBER_PUBLIC_ORIGIN;
  if (typeof originEnv === 'string' && originEnv.trim().length > 0) {
    const trimmed = originEnv.trim();
    // Convert http://localhost to mailto for VAPID compatibility
    if (trimmed.startsWith('http://localhost')) {
      return 'mailto:openchamber@localhost';
    }
    return trimmed;
  }

  try {
    const settings = await readSettingsFromDiskMigrated();
    const stored = settings?.publicOrigin;
    if (typeof stored === 'string' && stored.trim().length > 0) {
      const trimmed = stored.trim();
      // Convert http://localhost to mailto for VAPID compatibility
      if (trimmed.startsWith('http://localhost')) {
        return 'mailto:openchamber@localhost';
      }
      return trimmed;
    }
  } catch {
    // ignore
  }

  return 'mailto:openchamber@localhost';
};

const ensurePushInitialized = async () => {
  if (pushInitialized) return;
  const keys = await getOrCreateVapidKeys();
  const subject = await resolveVapidSubject();

  if (subject === 'mailto:openchamber@localhost') {
    console.warn('[Push] No public origin configured for VAPID; set OPENCHAMBER_VAPID_SUBJECT or enable push once from a real origin.');
  }

  webPush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
  pushInitialized = true;
};

const persistSettings = async (changes) => {
  // Serialize concurrent calls using lock
  persistSettingsLock = persistSettingsLock.then(async () => {
    console.log(`[persistSettings] Called with changes:`, JSON.stringify(changes, null, 2));
    const current = await readSettingsFromDisk();
    console.log(`[persistSettings] Current projects count:`, Array.isArray(current.projects) ? current.projects.length : 'N/A');
    const sanitized = sanitizeSettingsUpdate(changes);
    let next = mergePersistedSettings(current, sanitized);

    if (Array.isArray(next.projects)) {
      console.log(`[persistSettings] Validating ${next.projects.length} projects...`);
      const validated = await validateProjectEntries(next.projects);
      console.log(`[persistSettings] After validation: ${validated.length} projects remain`);
      next = { ...next, projects: validated };
    }

    if (Array.isArray(next.projects) && next.projects.length > 0) {
      const activeId = typeof next.activeProjectId === 'string' ? next.activeProjectId : '';
      const active = next.projects.find((project) => project.id === activeId) || null;
      if (!active) {
        console.log(`[persistSettings] Active project ID ${activeId} not found, switching to ${next.projects[0].id}`);
        next = { ...next, activeProjectId: next.projects[0].id };
      }
    } else if (next.activeProjectId) {
      console.log(`[persistSettings] No projects found, clearing activeProjectId ${next.activeProjectId}`);
      next = { ...next, activeProjectId: undefined };
    }

    if (Object.prototype.hasOwnProperty.call(sanitized, 'namedTunnelPresets')) {
      await syncNamedTunnelConfigWithPresets(next.namedTunnelPresets);
    }

    if (Object.prototype.hasOwnProperty.call(sanitized, 'namedTunnelPresetTokens') && sanitized.namedTunnelPresetTokens) {
      const presetsById = new Map((next.namedTunnelPresets || []).map((entry) => [entry.id, entry]));
      const updates = Object.entries(sanitized.namedTunnelPresetTokens)
        .map(([presetId, token]) => {
          const preset = presetsById.get(presetId);
          if (!preset || typeof token !== 'string' || token.trim().length === 0) {
            return null;
          }
          return {
            id: preset.id,
            name: preset.name,
            hostname: preset.hostname,
            token: token.trim(),
          };
        })
        .filter(Boolean);

      for (const update of updates) {
        await upsertNamedTunnelToken(update);
      }
    }

    await writeSettingsToDisk(next);
    console.log(`[persistSettings] Successfully saved ${next.projects?.length || 0} projects to disk`);
    return formatSettingsResponse(next);
  });

  return persistSettingsLock;
};

// HMR-persistent state via globalThis
// These values survive Vite HMR reloads to prevent zombie OpenCode processes
const hmrStateRuntime = createHmrStateRuntime({
  globalThisLike: globalThis,
  os,
  processLike: process,
  stateKey: '__openchamberHmrState',
});
const hmrState = hmrStateRuntime.getOrCreateHmrState();
hmrStateRuntime.ensureUserProvidedOpenCodePassword(hmrState);

// Non-HMR state (safe to reset on reload)
let healthCheckInterval = null;
let server = null;
let expressApp = null;
let currentRestartPromise = null;
let isRestartingOpenCode = false;
let openCodeApiPrefix = '';
let openCodeApiPrefixDetected = true;
let openCodeApiDetectionTimer = null;
let lastOpenCodeError = null;
let lastOpenCodeLaunchDiagnostics = null;
let isOpenCodeReady = false;
let openCodeNotReadySince = 0;
let isExternalOpenCode = false;
let exitOnShutdown = true;
let uiAuthController = null;
let activeTunnelController = null;
let globalWatcherStartPromise = null;
const tunnelProviderRegistry = createTunnelProviderRegistry([
  createCloudflareTunnelProvider(),
]);
tunnelProviderRegistry.seal();
const tunnelAuthController = createTunnelAuth();
let runtimeManagedRemoteTunnelToken = '';
let runtimeManagedRemoteTunnelHostname = '';
let terminalRuntime = null;
let messageStreamRuntime = null;
const userProvidedOpenCodePassword = hmrStateRuntime.getUserProvidedOpenCodePassword(hmrState);
const initialOpenCodeAuthState = hmrStateRuntime.resolveOpenCodeAuthFromState({
  hmrState,
  userProvidedOpenCodePassword,
});
let openCodeAuthPassword = initialOpenCodeAuthState.openCodeAuthPassword;
let openCodeAuthSource = initialOpenCodeAuthState.openCodeAuthSource;

// Sync helper - call after modifying any HMR state variable
const syncToHmrState = () => {
  hmrStateRuntime.syncStateFromRuntime(hmrState, {
    openCodeProcess,
    openCodePort,
    openCodeBaseUrl,
    isShuttingDown,
    signalsAttached,
    openCodeWorkingDirectory,
    openCodeAuthPassword,
    openCodeAuthSource,
  });
};

// Sync helper - call to restore state from HMR (e.g., on module reload)
const syncFromHmrState = () => {
  const restored = hmrStateRuntime.restoreRuntimeFromState({
    hmrState,
    userProvidedOpenCodePassword,
  });
  openCodeProcess = restored.openCodeProcess;
  openCodePort = restored.openCodePort;
  openCodeBaseUrl = restored.openCodeBaseUrl;
  isShuttingDown = restored.isShuttingDown;
  signalsAttached = restored.signalsAttached;
  openCodeWorkingDirectory = restored.openCodeWorkingDirectory;
  openCodeAuthPassword = restored.openCodeAuthPassword;
  openCodeAuthSource = restored.openCodeAuthSource;
};

// Module-level variables that shadow HMR state
// These are synced to/from hmrState to survive HMR reloads
let openCodeProcess = hmrState.openCodeProcess;
let openCodePort = hmrState.openCodePort;
let openCodeBaseUrl = hmrState.openCodeBaseUrl ?? null;
let isShuttingDown = hmrState.isShuttingDown;
let signalsAttached = hmrState.signalsAttached;
let openCodeWorkingDirectory = hmrState.openCodeWorkingDirectory;

const {
  configuredOpenCodePort: ENV_CONFIGURED_OPENCODE_PORT,
  configuredOpenCodeHost: ENV_CONFIGURED_OPENCODE_HOST,
  effectivePort: ENV_EFFECTIVE_PORT,
  configuredOpenCodeHostname: ENV_CONFIGURED_OPENCODE_HOSTNAME,
} = resolveOpenCodeEnvConfig({
  env: process.env,
  logger: console,
});

const ENV_SKIP_OPENCODE_START = process.env.OPENCODE_SKIP_START === 'true' ||
                                    process.env.OPENCHAMBER_SKIP_OPENCODE_START === 'true';
const ENV_DESKTOP_NOTIFY = (() => {
  if (process.env.OPENCHAMBER_DESKTOP_NOTIFY === 'true') {
    return true;
  }

  if (process.env.OPENCHAMBER_RUNTIME === 'desktop') {
    return true;
  }

  const argv0 = typeof process.argv?.[0] === 'string' ? process.argv[0] : '';
  const argv1 = typeof process.argv?.[1] === 'string' ? process.argv[1] : '';
  return /openchamber-server/i.test(argv0) || /openchamber-server/i.test(argv1);
})();
const ENV_CONFIGURED_OPENCODE_WSL_DISTRO =
  typeof process.env.OPENCODE_WSL_DISTRO === 'string' && process.env.OPENCODE_WSL_DISTRO.trim().length > 0
    ? process.env.OPENCODE_WSL_DISTRO.trim()
    : (
      typeof process.env.OPENCHAMBER_OPENCODE_WSL_DISTRO === 'string' &&
      process.env.OPENCHAMBER_OPENCODE_WSL_DISTRO.trim().length > 0
        ? process.env.OPENCHAMBER_OPENCODE_WSL_DISTRO.trim()
        : null
    );

const openCodeAuthStateRuntime = createOpenCodeAuthStateRuntime({
  crypto,
  process,
  getAuthPassword: () => openCodeAuthPassword,
  setAuthPassword: (value) => {
    openCodeAuthPassword = value;
  },
  getAuthSource: () => openCodeAuthSource,
  setAuthSource: (value) => {
    openCodeAuthSource = value;
  },
  getUserProvidedPassword: () => userProvidedOpenCodePassword,
  syncToHmrState,
});

const getOpenCodeAuthHeaders = (...args) => openCodeAuthStateRuntime.getOpenCodeAuthHeaders(...args);
const isOpenCodeConnectionSecure = (...args) => openCodeAuthStateRuntime.isOpenCodeConnectionSecure(...args);
const ensureLocalOpenCodeServerPassword = (...args) => openCodeAuthStateRuntime.ensureLocalOpenCodeServerPassword(...args);

const openCodeNetworkState = {};
Object.defineProperties(openCodeNetworkState, {
  openCodePort: { get: () => openCodePort, set: (value) => { openCodePort = value; } },
  openCodeBaseUrl: { get: () => openCodeBaseUrl, set: (value) => { openCodeBaseUrl = value; } },
  openCodeApiPrefix: { get: () => openCodeApiPrefix, set: (value) => { openCodeApiPrefix = value; } },
  openCodeApiPrefixDetected: { get: () => openCodeApiPrefixDetected, set: (value) => { openCodeApiPrefixDetected = value; } },
  openCodeApiDetectionTimer: { get: () => openCodeApiDetectionTimer, set: (value) => { openCodeApiDetectionTimer = value; } },
});

const openCodeNetworkRuntime = createOpenCodeNetworkRuntime({
  state: openCodeNetworkState,
  getOpenCodeAuthHeaders,
});

const waitForReady = (...args) => openCodeNetworkRuntime.waitForReady(...args);
const normalizeApiPrefix = (...args) => openCodeNetworkRuntime.normalizeApiPrefix(...args);
const setDetectedOpenCodeApiPrefix = (...args) => openCodeNetworkRuntime.setDetectedOpenCodeApiPrefix(...args);
const buildOpenCodeUrl = (...args) => openCodeNetworkRuntime.buildOpenCodeUrl(...args);
const ensureOpenCodeApiPrefix = (...args) => openCodeNetworkRuntime.ensureOpenCodeApiPrefix(...args);
const scheduleOpenCodeApiDetection = (...args) => openCodeNetworkRuntime.scheduleOpenCodeApiDetection(...args);

const ENV_CONFIGURED_API_PREFIX = normalizeApiPrefix(
  process.env.OPENCODE_API_PREFIX || process.env.OPENCHAMBER_API_PREFIX || ''
);

  if (ENV_CONFIGURED_API_PREFIX && ENV_CONFIGURED_API_PREFIX !== '') {
  console.warn('Ignoring configured OpenCode API prefix; API runs at root.');
}

let cachedLoginShellEnvSnapshot;
let resolvedOpencodeBinary = null;
let resolvedOpencodeBinarySource = null;
let resolvedNodeBinary = null;
let resolvedBunBinary = null;
let resolvedGitBinary = null;
let useWslForOpencode = false;
let resolvedWslBinary = null;
let resolvedWslOpencodePath = null;
let resolvedWslDistro = null;

const openCodeEnvState = {};
Object.defineProperties(openCodeEnvState, {
  cachedLoginShellEnvSnapshot: { get: () => cachedLoginShellEnvSnapshot, set: (value) => { cachedLoginShellEnvSnapshot = value; } },
  resolvedOpencodeBinary: { get: () => resolvedOpencodeBinary, set: (value) => { resolvedOpencodeBinary = value; } },
  resolvedOpencodeBinarySource: { get: () => resolvedOpencodeBinarySource, set: (value) => { resolvedOpencodeBinarySource = value; } },
  resolvedNodeBinary: { get: () => resolvedNodeBinary, set: (value) => { resolvedNodeBinary = value; } },
  resolvedBunBinary: { get: () => resolvedBunBinary, set: (value) => { resolvedBunBinary = value; } },
  resolvedGitBinary: { get: () => resolvedGitBinary, set: (value) => { resolvedGitBinary = value; } },
  useWslForOpencode: { get: () => useWslForOpencode, set: (value) => { useWslForOpencode = value; } },
  resolvedWslBinary: { get: () => resolvedWslBinary, set: (value) => { resolvedWslBinary = value; } },
  resolvedWslOpencodePath: { get: () => resolvedWslOpencodePath, set: (value) => { resolvedWslOpencodePath = value; } },
  resolvedWslDistro: { get: () => resolvedWslDistro, set: (value) => { resolvedWslDistro = value; } },
});

const openCodeEnvRuntime = createOpenCodeEnvRuntime({
  state: openCodeEnvState,
  normalizeDirectoryPath,
  readSettingsFromDiskMigrated,
  ENV_CONFIGURED_OPENCODE_WSL_DISTRO,
});

const applyLoginShellEnvSnapshot = (...args) => openCodeEnvRuntime.applyLoginShellEnvSnapshot(...args);
const getLoginShellEnvSnapshot = (...args) => openCodeEnvRuntime.getLoginShellEnvSnapshot(...args);
const ensureOpencodeCliEnv = (...args) => openCodeEnvRuntime.ensureOpencodeCliEnv(...args);
const applyOpencodeBinaryFromSettings = (...args) => openCodeEnvRuntime.applyOpencodeBinaryFromSettings(...args);
const resolveOpencodeCliPath = (...args) => openCodeEnvRuntime.resolveOpencodeCliPath(...args);
const isExecutable = (...args) => openCodeEnvRuntime.isExecutable(...args);
const searchPathFor = (...args) => openCodeEnvRuntime.searchPathFor(...args);
const resolveGitBinaryForSpawn = (...args) => openCodeEnvRuntime.resolveGitBinaryForSpawn(...args);
const resolveWslExecutablePath = (...args) => openCodeEnvRuntime.resolveWslExecutablePath(...args);
const buildWslExecArgs = (...args) => openCodeEnvRuntime.buildWslExecArgs(...args);
const resolveManagedOpenCodeLaunchSpec = (...args) => openCodeEnvRuntime.resolveManagedOpenCodeLaunchSpec(...args);
const clearResolvedOpenCodeBinary = (...args) => openCodeEnvRuntime.clearResolvedOpenCodeBinary(...args);
const openCodeResolutionRuntime = createOpenCodeResolutionRuntime({
  path,
  resolveOpencodeCliPath,
  applyOpencodeBinaryFromSettings,
  ensureOpencodeCliEnv,
  resolveManagedOpenCodeLaunchSpec,
  getResolvedState: () => ({
    resolvedOpencodeBinary,
    resolvedOpencodeBinarySource,
    useWslForOpencode,
    resolvedWslBinary,
    resolvedWslOpencodePath,
    resolvedWslDistro,
    resolvedNodeBinary,
    resolvedBunBinary,
  }),
  setResolvedOpencodeBinarySource: (value) => {
    resolvedOpencodeBinarySource = value;
  },
});
const getOpenCodeResolutionSnapshot = (...args) =>
  openCodeResolutionRuntime.getOpenCodeResolutionSnapshot(...args);

applyLoginShellEnvSnapshot();

notificationTemplateRuntime = createNotificationTemplateRuntime({
  readSettingsFromDisk,
  persistSettings,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  resolveGitBinaryForSpawn,
});

const notificationTriggerRuntime = createNotificationTriggerRuntime({
  readSettingsFromDisk,
  prepareNotificationLastMessage,
  summarizeText,
  resolveZenModel,
  buildTemplateVariables,
  extractLastMessageText,
  fetchLastAssistantMessageText,
  resolveNotificationTemplate,
  shouldApplyResolvedTemplateMessage,
  emitDesktopNotification,
  broadcastUiNotification,
  sendPushToAllUiSessions,
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
});

const maybeSendPushForTrigger = (...args) => notificationTriggerRuntime.maybeSendPushForTrigger(...args);
const setAutoAcceptSession = (...args) => notificationTriggerRuntime.setAutoAcceptSession(...args);

const globalMessageStreamHub = createGlobalMessageStreamHub({
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  upstreamStallTimeoutMs: getUpstreamStallTimeoutMs,
});

const openCodeWatcherRuntime = createOpenCodeWatcherRuntime({
  waitForOpenCodePort: (...args) => waitForOpenCodePort(...args),
  buildOpenCodeUrl,
  getOpenCodeAuthHeaders,
  parseSseDataPayload: (...args) => parseSseDataPayload(...args),
  globalEventHub: globalMessageStreamHub,
  onPayload: (payload) => {
    maybeCacheSessionInfoFromEvent(payload);
    void maybeSendPushForTrigger(payload);
    sessionRuntime.processOpenCodeSsePayload(payload);
  },
});

const processForwardedEventPayload = (payload, emitSyntheticEvent) => {
  if (!payload || typeof payload !== 'object' || typeof emitSyntheticEvent !== 'function') {
    return;
  }

  maybeCacheSessionInfoFromEvent(payload);

  if (payload.type !== 'session.status') {
    return;
  }

  const properties = payload.properties && typeof payload.properties === 'object' ? payload.properties : {};
  const statusInfo = properties.status && typeof properties.status === 'object' ? properties.status : {};
  const info = properties.info && typeof properties.info === 'object' ? properties.info : {};
  const sessionId = typeof properties.sessionID === 'string' ? properties.sessionID.trim() : '';
  const status = typeof statusInfo.type === 'string'
    ? statusInfo.type.trim()
    : (typeof info.type === 'string' ? info.type.trim() : '');

  if (!sessionId || !status) {
    return;
  }

  emitSyntheticEvent({
    type: 'openchamber:session-status',
    properties: {
      sessionId,
      status,
      timestamp: Date.now(),
      metadata: {
        attempt: typeof statusInfo.attempt === 'number'
          ? statusInfo.attempt
          : (typeof info.attempt === 'number' ? info.attempt : undefined),
        message: typeof statusInfo.message === 'string'
          ? statusInfo.message
          : (typeof info.message === 'string' ? info.message : undefined),
        next: typeof statusInfo.next === 'number'
          ? statusInfo.next
          : (typeof info.next === 'number' ? info.next : undefined),
      },
      needsAttention: false,
    },
  });

  emitSyntheticEvent({
    type: 'openchamber:session-activity',
    properties: {
      sessionId,
      phase: status === 'busy' || status === 'retry' ? 'busy' : 'idle',
    },
  });
};


const serverUtilsRuntime = createServerUtilsRuntime({
  fs,
  os,
  path,
  process,
  openCodeReadyGraceMs: OPEN_CODE_READY_GRACE_MS,
  longRequestTimeoutMs: LONG_REQUEST_TIMEOUT_MS,
  getRuntime: () => ({
    openCodePort,
    openCodeBaseUrl,
    openCodeNotReadySince,
    isOpenCodeReady,
    isRestartingOpenCode,
  }),
  getOpenCodeAuthHeaders,
  buildOpenCodeUrl,
  ensureOpenCodeApiPrefix,
  getUiNotificationClients: () => uiNotificationClients,
  getOpenCodePort: () => openCodePort,
  setOpenCodePortState: (value) => {
    openCodePort = value;
  },
  syncToHmrState,
  markOpenCodeNotReady: () => {
    isOpenCodeReady = false;
  },
  setOpenCodeNotReadySince: (value) => {
    openCodeNotReadySince = value;
  },
  clearLastOpenCodeError: () => {
    lastOpenCodeError = null;
  },
  getLoginShellPath: () => {
    const snapshot = getLoginShellEnvSnapshot();
    if (!snapshot || typeof snapshot.PATH !== 'string' || snapshot.PATH.length === 0) {
      return null;
    }
  })();

  try {
    await currentRestartPromise;
  } catch (error) {
    console.error(`Failed to restart OpenCode: ${error.message}`);
    lastOpenCodeError = error.message;
    if (!ENV_CONFIGURED_OPENCODE_PORT) {
      openCodePort = null;
      syncToHmrState();
    }
    openCodeApiPrefixDetected = true;
    openCodeApiPrefix = '';
    throw error;
  } finally {
    currentRestartPromise = null;
    isRestartingOpenCode = false;
  }
}

async function waitForOpenCodeReady(timeoutMs = 20000, intervalMs = 400) {
  if (!openCodePort) {
    throw new Error('OpenCode port is not available');
  }

  const deadline = Date.now() + timeoutMs;
  let lastError = null;

  while (Date.now() < deadline) {
    try {
      const [configResult, agentResult] = await Promise.all([
        fetch(buildOpenCodeUrl('/config', ''), {
          method: 'GET',
          headers: { Accept: 'application/json',  ...getOpenCodeAuthHeaders()  }
        }).catch((error) => error),
        fetch(buildOpenCodeUrl('/agent', ''), {
          method: 'GET',
          headers: { Accept: 'application/json',  ...getOpenCodeAuthHeaders()  }
        }).catch((error) => error)
      ]);

      if (configResult instanceof Error) {
        lastError = configResult;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        continue;
      }

      if (!configResult.ok) {
        lastError = new Error(`OpenCode config endpoint responded with status ${configResult.status}`);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        continue;
      }

      await configResult.json().catch(() => null);

      if (agentResult instanceof Error) {
        lastError = agentResult;
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        continue;
      }

      if (!agentResult.ok) {
        lastError = new Error(`Agent endpoint responded with status ${agentResult.status}`);
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
        continue;
      }

      await agentResult.json().catch(() => []);

      isOpenCodeReady = true;
      lastOpenCodeError = null;
      return;
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  if (lastError) {
    lastOpenCodeError = lastError.message || String(lastError);
    throw lastError;
  }

  const timeoutError = new Error('Timed out waiting for OpenCode to become ready');
  lastOpenCodeError = timeoutError.message;
  throw timeoutError;
}

async function waitForAgentPresence(agentName, timeoutMs = 15000, intervalMs = 300) {
  if (!openCodePort) {
    throw new Error('OpenCode port is not available');
  }

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(buildOpenCodeUrl('/agent'), {
        method: 'GET',
        headers: { Accept: 'application/json',  ...getOpenCodeAuthHeaders()  }
      });

      if (response.ok) {
        const agents = await response.json();
        if (Array.isArray(agents) && agents.some((agent) => agent?.name === agentName)) {
          return;
        }
      }
    } catch (error) {

    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Agent "${agentName}" not available after OpenCode restart`);
}

async function fetchAgentsSnapshot() {
  if (!openCodePort) {
    throw new Error('OpenCode port is not available');
  }

  const response = await fetch(buildOpenCodeUrl('/agent'), {
    method: 'GET',
    headers: { Accept: 'application/json',  ...getOpenCodeAuthHeaders()  }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch agents snapshot (status ${response.status})`);
  }

  const agents = await response.json().catch(() => null);
  if (!Array.isArray(agents)) {
    throw new Error('Invalid agents payload from OpenCode');
  }
  return agents;
}

async function fetchProvidersSnapshot() {
  if (!openCodePort) {
    throw new Error('OpenCode port is not available');
  }

  const response = await fetch(buildOpenCodeUrl('/provider'), {
    method: 'GET',
    headers: { Accept: 'application/json',  ...getOpenCodeAuthHeaders()  }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch providers snapshot (status ${response.status})`);
  }

  const providers = await response.json().catch(() => null);
  if (!Array.isArray(providers)) {
    throw new Error('Invalid providers payload from OpenCode');
  }
  return providers;
}

async function fetchModelsSnapshot() {
  if (!openCodePort) {
    throw new Error('OpenCode port is not available');
  }

  const response = await fetch(buildOpenCodeUrl('/model'), {
    method: 'GET',
    headers: { Accept: 'application/json',  ...getOpenCodeAuthHeaders()  }
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch models snapshot (status ${response.status})`);
  }

  const models = await response.json().catch(() => null);
  if (!Array.isArray(models)) {
    throw new Error('Invalid models payload from OpenCode');
  }
  return models;
}

async function refreshOpenCodeAfterConfigChange(reason, options = {}) {
  const { agentName } = options;

  console.log(`Refreshing OpenCode after ${reason}`);

  // Settings might include a new opencodeBinary; drop cache before restart.
  resolvedOpencodeBinary = null;
  await applyOpencodeBinaryFromSettings();

  await restartOpenCode();

  try {
    await waitForOpenCodeReady();
    isOpenCodeReady = true;
    openCodeNotReadySince = 0;

    if (agentName) {
      await waitForAgentPresence(agentName);
    }

    isOpenCodeReady = true;
    openCodeNotReadySince = 0;
  } catch (error) {

    isOpenCodeReady = false;
    openCodeNotReadySince = Date.now();
    console.error(`Failed to refresh OpenCode after ${reason}:`, error.message);
    throw error;
  }
}

function setupProxy(app) {
  if (app.get('opencodeProxyConfigured')) {
    return;
  }

  if (openCodePort) {
    console.log(`Setting up proxy to OpenCode on port ${openCodePort}`);
  } else {
    console.log('Setting up OpenCode API gate (OpenCode not started yet)');
  }
  app.set('opencodeProxyConfigured', true);

  const stripApiPrefix = (rawUrl) => {
    if (typeof rawUrl !== 'string' || !rawUrl) {
      return '/';
    }
    if (rawUrl === '/api') {
      return '/';
    }
    if (rawUrl.startsWith('/api/')) {
      return rawUrl.slice(4);
    }
    return rawUrl;
  };

  // Keep route matching stable; only rewrite the proxied upstream path.
  const rewriteWindowsDirectoryParam = (upstreamPath) => {
    if (process.platform !== 'win32') {
      return upstreamPath;
    }
    try {
      const parsed = new URL(upstreamPath, 'http://openchamber.local');
      const pathname = parsed.pathname || '/';
      if (pathname === '/session' || pathname.startsWith('/session/')) {
        return upstreamPath;
      }
      const directory = parsed.searchParams.get('directory');
      if (!directory || !directory.includes('/')) {
        return upstreamPath;
      }
      const fixed = directory.replace(/\//g, '\\');
      parsed.searchParams.set('directory', fixed);
      const rewritten = `${parsed.pathname}${parsed.search}${parsed.hash}`;
      if (rewritten !== upstreamPath) {
        console.log(`[Win32PathFix] Rewrote directory: "${directory}" → "${fixed}"`);
        console.log(`[Win32PathFix] URL: "${upstreamPath}" → "${rewritten}"`);
      }
      return rewritten;
    } catch {
      return upstreamPath;
    }
  };

  const getUpstreamPathForRequest = (req) => {
    const rawUrl = (typeof req.originalUrl === 'string' && req.originalUrl)
      ? req.originalUrl
      : (typeof req.url === 'string' ? req.url : '/');
    return rewriteWindowsDirectoryParam(stripApiPrefix(rawUrl));
  };

  app.use('/api', (req, res, next) => {
    if (
      req.path.startsWith('/themes/custom') ||
      req.path.startsWith('/push') ||
      req.path.startsWith('/auth/device') ||
      req.path.startsWith('/auth/devices') ||
      req.path.startsWith('/config/agents') ||
      req.path.startsWith('/config/opencode-resolution') ||
      req.path.startsWith('/config/settings') ||
      req.path.startsWith('/config/skills') ||
      req.path === '/config/reload' ||
      req.path === '/health'
    ) {
      return next();
    }

    const waitElapsed = openCodeNotReadySince === 0 ? 0 : Date.now() - openCodeNotReadySince;
    const stillWaiting =
      (!isOpenCodeReady && (openCodeNotReadySince === 0 || waitElapsed < OPEN_CODE_READY_GRACE_MS)) ||
      isRestartingOpenCode ||
      !openCodePort;

    if (stillWaiting) {
      return res.status(503).json({
        error: 'OpenCode is restarting',
        restarting: true,
      });
    }

    next();
  });

  const isSseApiPath = (path) => path === '/event' || path === '/global/event';

  const forwardSseRequest = async (req, res) => {
    const startedAt = Date.now();
    const upstreamPath = getUpstreamPathForRequest(req);
    const targetUrl = buildOpenCodeUrl(upstreamPath, '');
    const authHeaders = getOpenCodeAuthHeaders();

    const requestHeaders = {
      ...(typeof req.headers.accept === 'string' ? { accept: req.headers.accept } : { accept: 'text/event-stream' }),
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      ...(authHeaders.Authorization ? { Authorization: authHeaders.Authorization } : {}),
    };

    const controller = new AbortController();
    let connectTimer = null;
    let idleTimer = null;
    let heartbeatTimer = null;
    let endedBy = 'upstream-end';

    const cleanup = () => {
      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }
      if (idleTimer) {
        clearTimeout(idleTimer);
        idleTimer = null;
      }
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      req.off('close', onClientClose);
    };

    const resetIdleTimeout = () => {
      if (idleTimer) {
        clearTimeout(idleTimer);
      }
      idleTimer = setTimeout(() => {
        endedBy = 'idle-timeout';
        controller.abort();
      }, 5 * 60 * 1000);
    };

    const onClientClose = () => {
      endedBy = 'client-disconnect';
      controller.abort();
    };

    req.on('close', onClientClose);

    try {
      connectTimer = setTimeout(() => {
        endedBy = 'connect-timeout';
        controller.abort();
      }, 10 * 1000);

      const upstreamResponse = await fetch(targetUrl, {
        method: 'GET',
        headers: requestHeaders,
        signal: controller.signal,
      });

      if (connectTimer) {
        clearTimeout(connectTimer);
        connectTimer = null;
      }

      if (!upstreamResponse.ok || !upstreamResponse.body) {
        const body = await upstreamResponse.text().catch(() => '');
        cleanup();
        if (!res.headersSent) {
          if (upstreamResponse.headers.has('content-type')) {
            res.setHeader('content-type', upstreamResponse.headers.get('content-type'));
          }
          res.status(upstreamResponse.status).send(body);
        }
        return;
      }

      const upstreamContentType = upstreamResponse.headers.get('content-type') || 'text/event-stream';
      res.status(upstreamResponse.status);
      res.setHeader('content-type', upstreamContentType);
      res.setHeader('cache-control', 'no-cache');
      res.setHeader('connection', 'keep-alive');
      res.setHeader('x-accel-buffering', 'no');
      res.setHeader('x-content-type-options', 'nosniff');
      if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
      }

      resetIdleTimeout();
      heartbeatTimer = setInterval(() => {
        if (res.writableEnded || controller.signal.aborted) {
          return;
        }
        try {
          res.write(': ping\n\n');
          resetIdleTimeout();
        } catch {
        }
      }, 30 * 1000);

      const reader = upstreamResponse.body.getReader();
      try {
        writeSseEvent(client, {
          type: 'openchamber:scheduled-task-ran',
          properties: {
            projectId: event.projectID,
            taskId: event.taskID,
            ranAt: event.ranAt,
            status: event.status,
            ...(event.sessionID ? { sessionId: event.sessionID } : {}),
          },
        });
      } catch {
        uiOpenChamberEventClients.delete(client);
      }
    }
  },
  logger: console,
});

const ensureGlobalWatcherStarted = async () => {
  if (globalWatcherStartPromise) {
    return globalWatcherStartPromise;
  }

  globalWatcherStartPromise = openCodeWatcherRuntime.start().catch((error) => {
    globalWatcherStartPromise = null;
    throw error;
  });

  return globalWatcherStartPromise;
};
const bootstrapOpenCodeAtStartup = async (...args) => {
  await openCodeLifecycleRuntime.bootstrapOpenCodeAtStartup(...args);
  scheduleOpenCodeApiDetection();
  if (openCodeLifecycleState.openCodeProcess && !openCodeLifecycleState.isExternalOpenCode) {
    startHealthMonitoring();
  }
  if (ENV_DESKTOP_NOTIFY) {
    void ensureGlobalWatcherStarted().catch((error) => {
      console.warn(`Global event watcher startup failed: ${error?.message || error}`);
    });
  }
};
const killProcessOnPort = (...args) => openCodeLifecycleRuntime.killProcessOnPort(...args);
const waitForPortRelease = (...args) => openCodeLifecycleRuntime.waitForPortRelease(...args);

const fetchAgentsSnapshot = (...args) => serverUtilsRuntime.fetchAgentsSnapshot(...args);
const fetchProvidersSnapshot = (...args) => serverUtilsRuntime.fetchProvidersSnapshot(...args);
const fetchModelsSnapshot = (...args) => serverUtilsRuntime.fetchModelsSnapshot(...args);
const setupProxy = (...args) => serverUtilsRuntime.setupProxy(...args);
const gracefulShutdownRuntime = createGracefulShutdownRuntime({
  process,
  shutdownTimeoutMs: SHUTDOWN_TIMEOUT,
  getExitOnShutdown: () => exitOnShutdown,
  getIsShuttingDown: () => isShuttingDown,
  setIsShuttingDown: (value) => {
    isShuttingDown = value;
  },
  syncToHmrState,
  openCodeWatcherRuntime,
  sessionRuntime,
  getHealthCheckInterval: () => healthCheckInterval,
  clearHealthCheckInterval: (value) => clearInterval(value),
  getTerminalRuntime: () => terminalRuntime,
  setTerminalRuntime: (value) => {
    terminalRuntime = value;
  },
  getMessageStreamRuntime: () => messageStreamRuntime,
  setMessageStreamRuntime: (value) => {
    messageStreamRuntime = value;
  },
  shouldSkipOpenCodeStop: () => ENV_SKIP_OPENCODE_START || isExternalOpenCode,
  getOpenCodePort: () => openCodePort,
  getOpenCodeProcess: () => openCodeProcess,
  setOpenCodeProcess: (value) => {
    openCodeProcess = value;
  },
  killProcessOnPort,
  waitForPortRelease,
  getServer: () => server,
  getUiAuthController: () => uiAuthController,
  setUiAuthController: (value) => {
    uiAuthController = value;
  },
  getActiveTunnelController: () => activeTunnelController,
  setActiveTunnelController: (value) => {
    activeTunnelController = value;
  },
  tunnelAuthController,
  scheduledTasksRuntime,
});

const gracefulShutdown = (...args) => gracefulShutdownRuntime.gracefulShutdown(...args);

async function main(options = {}) {
  const port = Number.isFinite(options.port) && options.port >= 0 ? Math.trunc(options.port) : DEFAULT_PORT;
  const host = typeof options.host === 'string' && options.host.length > 0 ? options.host : undefined;
  const tryCfTunnel = options.tryCfTunnel === true;
  const shouldUseCanonicalTunnelConfig = typeof options.tunnelMode === 'string'
    || typeof options.tunnelProvider === 'string'
    || options.tunnelConfigPath === null
    || typeof options.tunnelConfigPath === 'string'
    || typeof options.tunnelToken === 'string'
    || typeof options.tunnelHostname === 'string';
  const startupTunnelRequest = shouldUseCanonicalTunnelConfig
    ? normalizeTunnelStartRequest({
        provider: normalizeTunnelProvider(options.tunnelProvider),
        mode: options.tunnelMode,
        configPath: normalizeOptionalPath(options.tunnelConfigPath),
        token: typeof options.tunnelToken === 'string' ? options.tunnelToken.trim() : '',
        hostname: normalizeManagedRemoteTunnelHostname(options.tunnelHostname),
      })
    : (tryCfTunnel
      ? {
          provider: TUNNEL_PROVIDER_CLOUDFLARE,
          mode: TUNNEL_MODE_QUICK,
          configPath: undefined,
          token: '',
          hostname: undefined,
        }
      : null);
  const attachSignals = options.attachSignals !== false;
  const onTunnelReady = typeof options.onTunnelReady === 'function' ? options.onTunnelReady : null;
  if (typeof options.exitOnShutdown === 'boolean') {
    exitOnShutdown = options.exitOnShutdown;
  }
  if (typeof options.onDesktopNotification === 'function') {
    notificationEmitterRuntime.setOnDesktopNotification(options.onDesktopNotification);
  }
  if (typeof options.getIsWindowFocused === 'function') {
    notificationTriggerRuntime.setGetIsWindowFocused(options.getIsWindowFocused);
  }

  console.log(`Starting OpenChamber on port ${port === 0 ? 'auto' : port}`);

  const sayTTSCapability = await detectSayTtsCapability(process);

  // Startup model validation is best-effort and runs in background.
  void validateZenModelAtStartup();

  const app = express();
  const serverStartedAt = new Date().toISOString();
  app.set('trust proxy', true);
  app.use(compression({
    filter: (req, res) => {
      if (shouldSkipCompression(req, res)) return false;
      return compression.filter(req, res);
    },
    threshold: 1024,
  }));
  expressApp = app;
  server = http.createServer(app);

  const appendVaryHeader = (res, value) => {
    const current = res.getHeader('Vary');
    if (!current) {
      res.setHeader('Vary', value);
      return;
    }
    const values = String(current)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
    if (!values.includes(value)) {
      values.push(value);
      res.setHeader('Vary', values.join(', '));
    }
  };

  const applyTrustedCorsHeaders = async (req, res, allowedMethods, allowCredentials = false) => {
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    if (!originHeader) {
      return false;
    }

    const allowed = await isRequestOriginAllowed(req);
    if (!allowed) {
      return false;
    }

    res.setHeader('Access-Control-Allow-Origin', originHeader);
    appendVaryHeader(res, 'Origin');
    res.setHeader('Access-Control-Allow-Methods', allowedMethods);
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept, X-Requested-With');
    if (allowCredentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }

    return true;
  };

  app.use('/health', async (req, res, next) => {
    const corsApplied = await applyTrustedCorsHeaders(req, res, 'GET,OPTIONS');
    if (req.method === 'OPTIONS') {
      const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
      console.log(`[health] preflight origin=${originHeader || 'none'} allowed=${corsApplied ? 'yes' : 'no'}`);
      return res.status(corsApplied ? 204 : 403).end();
    }
    return next();
  });

  app.use('/api', async (req, res, next) => {
    if (req.path.startsWith('/auth/device') || req.path.startsWith('/auth/devices')) {
      return next();
    }
    const corsApplied = await applyTrustedCorsHeaders(req, res, 'GET,POST,PATCH,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') {
      return res.status(corsApplied ? 204 : 403).end();
    }
    return next();
  });

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      openCodePort: openCodePort,
      openCodeRunning: Boolean(openCodePort && isOpenCodeReady && !isRestartingOpenCode),
      openCodeSecureConnection: isOpenCodeConnectionSecure(),
      openCodeAuthSource: openCodeAuthSource || null,
      openCodeApiPrefix: '',
      openCodeApiPrefixDetected: true,
      isOpenCodeReady,
      lastOpenCodeError,
      opencodeBinaryResolved: resolvedOpencodeBinary || null,
      opencodeBinarySource: resolvedOpencodeBinarySource || null,
      opencodeShimInterpreter: resolvedOpencodeBinary ? opencodeShimInterpreter(resolvedOpencodeBinary) : null,
      opencodeViaWsl: useWslForOpencode,
      opencodeWslBinary: resolvedWslBinary || null,
      opencodeWslPath: resolvedWslOpencodePath || null,
      opencodeWslDistro: resolvedWslDistro || null,
      nodeBinaryResolved: resolvedNodeBinary || null,
      bunBinaryResolved: resolvedBunBinary || null,
    });
  });

  app.post('/api/system/shutdown', (req, res) => {
    res.json({ ok: true });
    gracefulShutdown({ exitProcess: false }).catch((error) => {
      console.error('Shutdown request failed:', error?.message || error);
    });
  });

  app.get('/api/system/info', (req, res) => {
    res.json({
      openchamberVersion: OPENCHAMBER_VERSION,
      runtime: process.env.OPENCHAMBER_RUNTIME || 'web',
      pid: process.pid,
      startedAt: serverStartedAt,
    });
  });

  app.use((req, res, next) => {
    if (
      req.path.startsWith('/api/config/agents') ||
      req.path.startsWith('/api/config/commands') ||
      req.path.startsWith('/api/config/mcp') ||
      req.path.startsWith('/api/config/settings') ||
      req.path.startsWith('/api/config/profiles') ||
      req.path.startsWith('/api/config/oh-my-opencode') ||
      req.path.startsWith('/api/config/skills') ||
      req.path.startsWith('/api/auth') ||
      req.path.startsWith('/api/projects') ||
      req.path.startsWith('/api/auth') ||
      req.path.startsWith('/api/fs') ||
      req.path.startsWith('/api/git') ||
      req.path.startsWith('/api/prompts') ||
      req.path.startsWith('/api/terminal') ||
      req.path.startsWith('/api/opencode') ||
      req.path.startsWith('/api/push') ||
      req.path.startsWith('/api/voice') ||
      req.path.startsWith('/api/tts') ||
      req.path.startsWith('/api/openchamber/tunnel')
    ) {

      express.json({ limit: '50mb' })(req, res, next);
    } else if (req.path.startsWith('/api')) {

      next();
    } else {

      express.json({ limit: '50mb' })(req, res, next);
    }
  });
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });

  const uiPassword = typeof options.uiPassword === 'string' ? options.uiPassword : null;
  uiAuthController = createUiAuth({ password: uiPassword });
  if (uiAuthController.enabled) {
    console.log('UI password protection enabled for browser sessions');
  }

  app.get('/auth/session', async (req, res) => {
    const requestScope = tunnelAuthController.classifyRequestScope(req);
    if (requestScope === 'tunnel' || requestScope === 'unknown-public') {
      const tunnelSession = tunnelAuthController.getTunnelSessionFromRequest(req);
      if (tunnelSession) {
        return res.json({ authenticated: true, scope: 'tunnel' });
      }
      tunnelAuthController.clearTunnelSessionCookie(req, res);
      return res.status(401).json({ authenticated: false, locked: true, tunnelLocked: true });
    }

    try {
      await uiAuthController.handleSessionStatus(req, res);
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });
  app.post('/auth/session', (req, res) => {
    const requestScope = tunnelAuthController.classifyRequestScope(req);
    if (requestScope === 'tunnel' || requestScope === 'unknown-public') {
      return res.status(403).json({ error: 'Password login is disabled for tunnel scope', tunnelLocked: true });
    }
    return uiAuthController.handleSessionCreate(req, res);
  });

  app.get('/connect', async (req, res) => {
    try {
      const token = typeof req.query?.t === 'string' ? req.query.t : '';
      const settings = await readSettingsFromDiskMigrated();
      const tunnelSessionTtlMs = normalizeTunnelSessionTtlMs(settings?.tunnelSessionTtlMs);

      const exchange = tunnelAuthController.exchangeBootstrapToken({
        req,
        res,
        token,
        sessionTtlMs: tunnelSessionTtlMs,
      });

      res.setHeader('Cache-Control', 'no-store');

      if (!exchange.ok) {
        if (exchange.reason === 'rate-limited') {
          res.setHeader('Retry-After', String(exchange.retryAfter || 60));
          return res.status(429).type('text/plain').send('Too many attempts. Please try again later.');
        }
        return res.status(401).type('text/plain').send('Connection link is invalid or expired.');
      }

      return res.redirect(302, '/');
    } catch (error) {
      return res.status(500).type('text/plain').send('Failed to process connect request.');
    }
  });

  const isDevicePublicAuthPath = (req) => {
    const normalizedPath = typeof req.path === 'string' ? req.path : '';
    if (normalizedPath === '/auth/device/start' || normalizedPath === '/auth/device/token') {
      return true;
    }
    if (normalizedPath === '/auth/device/start/' || normalizedPath === '/auth/device/token/') {
      return true;
    }
    return false;
  };

  const isDevicesAdminPath = (req) => {
    const normalizedPath = typeof req.path === 'string' ? req.path : '';
    return normalizedPath.startsWith('/auth/devices');
  };

  const requireUiCookieAuth = (req, res, next) => {
    uiAuthController.requireAuth(req, res, next);
  };

  const authDeviceCorsMiddleware = async (req, res, next) => {
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    if (originHeader) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    }
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  };

  const authDevicesCorsMiddleware = async (req, res, next) => {
    const originHeader = typeof req.headers.origin === 'string' ? req.headers.origin.trim() : '';
    if (originHeader) {
      const allowed = await isRequestOriginAllowed(req);
      if (allowed) {
        res.setHeader('Access-Control-Allow-Origin', originHeader);
        res.setHeader('Vary', 'Origin');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
      }
    }
    if (req.method === 'OPTIONS') {
      return res.status(204).end();
    }
    return next();
  };

  app.use('/api/auth/device', authDeviceCorsMiddleware);
  app.use('/api/auth/devices', authDevicesCorsMiddleware);

  app.use('/api', async (req, res, next) => {
    if (isDevicePublicAuthPath(req)) {
      return next();
    }

    try {
      const requestScope = tunnelAuthController.classifyRequestScope(req);
      if (requestScope === 'tunnel' || requestScope === 'unknown-public') {
        return tunnelAuthController.requireTunnelSession(req, res, next);
      }
    } catch (err) {
      return next(err);
    }

    if (isDevicesAdminPath(req)) {
      return requireUiCookieAuth(req, res, next);
    }

    try {
      const authenticatedDevice = await authenticateBearerDevice(req);
      if (authenticatedDevice) {
        req.openchamberDevice = authenticatedDevice;
        return next();
      }
    } catch (error) {
      console.warn('Bearer authentication failed:', error);
    }

    return requireUiCookieAuth(req, res, next);
  });

  const parsePushSubscribeBody = (body) => {
    if (!body || typeof body !== 'object') return null;
    const endpoint = body.endpoint;
    const keys = body.keys;
    const p256dh = keys?.p256dh;
    const auth = keys?.auth;

    if (typeof endpoint !== 'string' || endpoint.trim().length === 0) return null;
    if (typeof p256dh !== 'string' || p256dh.trim().length === 0) return null;
    if (typeof auth !== 'string' || auth.trim().length === 0) return null;

    return {
      endpoint: endpoint.trim(),
      keys: { p256dh: p256dh.trim(), auth: auth.trim() },
    };
  };

  const parsePushUnsubscribeBody = (body) => {
    if (!body || typeof body !== 'object') return null;
    const endpoint = body.endpoint;
    if (typeof endpoint !== 'string' || endpoint.trim().length === 0) return null;
    return { endpoint: endpoint.trim() };
  };

  app.get('/api/push/vapid-public-key', async (req, res) => {
    try {
      await ensurePushInitialized();
      const keys = await getOrCreateVapidKeys();
      res.json({ publicKey: keys.publicKey });
    } catch (error) {
      console.warn('[Push] Failed to load VAPID key:', error);
      res.status(500).json({ error: 'Failed to load push key' });
    }
  });

  app.post('/api/push/subscribe', async (req, res) => {
    await ensurePushInitialized();

    const uiToken = uiAuthController?.ensureSessionToken
      ? await uiAuthController.ensureSessionToken(req, res)
      : getUiSessionTokenFromRequest(req);
    if (!uiToken) {
      return res.status(401).json({ error: 'UI session missing' });
    }

    const parsed = parsePushSubscribeBody(req.body);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid body' });
    }

    const { endpoint, keys } = parsed;

    const origin = typeof req.body?.origin === 'string' ? req.body.origin.trim() : '';
    if (origin.startsWith('http://') || origin.startsWith('https://')) {
      try {
        const settings = await readSettingsFromDiskMigrated();
        if (typeof settings?.publicOrigin !== 'string' || settings.publicOrigin.trim().length === 0) {
          await writeSettingsToDisk({
            ...settings,
            publicOrigin: origin,
          });
          // allow next sends to pick it up
          pushInitialized = false;
        }
      } catch {
        // ignore
      }
    }

    await addOrUpdatePushSubscription(
      uiToken,
      {
        endpoint,
        p256dh: keys.p256dh,
        auth: keys.auth,
      },
      req.headers['user-agent']
    );

    res.json({ ok: true });
  });


  app.delete('/api/push/subscribe', async (req, res) => {
    await ensurePushInitialized();

    const uiToken = uiAuthController?.ensureSessionToken
      ? await uiAuthController.ensureSessionToken(req, res)
      : getUiSessionTokenFromRequest(req);
    if (!uiToken) {
      return res.status(401).json({ error: 'UI session missing' });
    }

    const parsed = parsePushUnsubscribeBody(req.body);
    if (!parsed) {
      return res.status(400).json({ error: 'Invalid body' });
    }

    await removePushSubscription(uiToken, parsed.endpoint);
    res.json({ ok: true });
  });

  app.post('/api/push/visibility', async (req, res) => {
    const uiToken = uiAuthController?.ensureSessionToken
      ? await uiAuthController.ensureSessionToken(req, res)
      : getUiSessionTokenFromRequest(req);
    if (!uiToken) {
      return res.status(401).json({ error: 'UI session missing' });
    }

    const visible = req.body && typeof req.body === 'object' ? req.body.visible : null;
    updateUiVisibility(uiToken, visible === true);
    res.json({ ok: true });
  });

  app.get('/api/push/visibility', (req, res) => {
    const uiToken = getUiSessionTokenFromRequest(req);
    if (!uiToken) {
      return res.status(401).json({ error: 'UI session missing' });
    }

    res.json({
      ok: true,
      visible: isUiVisible(uiToken),
    });
  });

  // Session activity status endpoint - returns tracked activity phases for all sessions
  // Used by UI on visibility restore to get accurate status without waiting for SSE
  app.get('/api/session-activity', (_req, res) => {
    res.json(getSessionActivitySnapshot());
  });

  // Voice token endpoint - returns OpenAI TTS availability status
  app.post('/api/voice/token', async (req, res) => {
    console.log('[Voice] Token request received:', { body: req.body, headers: req.headers['content-type'] });
    try {
      const openaiApiKey = process.env.OPENAI_API_KEY;
      console.log('[Voice] OpenAI API Key present:', !!openaiApiKey);

      if (!openaiApiKey) {
        return res.status(503).json({
          allowed: false,
          error: 'OpenAI voice service not configured. Set OPENAI_API_KEY environment variable.'
        });
      }

      // Return success - OpenAI TTS is available
      res.json({
        allowed: true,
        provider: 'openai',
        message: 'OpenAI TTS is available'
      });
    } catch (error) {
      console.error('[Voice] Token generation error:', error);
      res.status(500).json({
        allowed: false,
        error: 'Voice service error'
      });
    }
  });

  // Server-side TTS endpoint - streams audio from OpenAI TTS API
  app.post('/api/tts/speak', async (req, res) => {
    try {
      const { text, voice = 'nova', model = 'gpt-4o-mini-tts', speed = 0.9, instructions, summarize = false, providerId, modelId, threshold = 200, maxLength = 500, apiKey } = req.body || {};

      console.log('[TTS] Request received:', { voice, model, speed, textLength: text?.length, hasApiKey: !!apiKey });

      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Text is required' });
      }

      // Dynamically import the TTS service (ESM)
      const { ttsService } = await import('./lib/tts/index.js');

      // Check availability - either server-configured or client-provided API key
      const hasServerKey = ttsService.isAvailable();
      const hasClientKey = apiKey && typeof apiKey === 'string' && apiKey.trim().length > 0;
      
      if (!hasServerKey && !hasClientKey) {
        return res.status(503).json({ 
          error: 'TTS service not available. Please configure OpenAI in OpenCode or provide an API key in settings.' 
        });
      }

      let textToSpeak = text.trim();

      // Optionally summarize long text before speaking using zen API
      if (summarize && textToSpeak.length > threshold) {
        try {
          const { summarizeText } = await import('./lib/tts/index.js');
          const speakZenModel = await resolveZenModel(typeof req.body?.zenModel === 'string' ? req.body.zenModel : undefined);
          const result = await summarizeText({ text: textToSpeak, threshold, maxLength, zenModel: speakZenModel });
          
          if (result.summarized && result.summary) {
            textToSpeak = result.summary;
          }
        } catch (summarizeError) {
          console.error('[TTS/speak] Summarization failed:', summarizeError);
          // Continue with original text if summarization fails
        }
      }

      const result = await ttsService.generateSpeechStream({
        text: textToSpeak,
        voice,
        model,
        speed,
        instructions,
        apiKey: hasClientKey ? apiKey.trim() : undefined
      });

      // Set headers for audio streaming
      // Note: Don't set Transfer-Encoding manually - Express handles it automatically
      res.setHeader('Content-Type', result.contentType);
      res.setHeader('Cache-Control', 'no-cache');

      // Collect the full audio buffer and send it
      // This avoids chunked encoding issues with proxies
      const reader = result.stream.getReader();
      const chunks = [];
      
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(Buffer.from(value));
        }
        const audioBuffer = Buffer.concat(chunks);
        res.setHeader('Content-Length', audioBuffer.length);
        res.send(audioBuffer);
      } catch (streamError) {
        console.error('[TTS] Stream error:', streamError);
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error' });
        } else {
          res.end();
        }
      }
    } catch (error) {
      console.error('[TTS] Error:', error);
      if (!res.headersSent) {
        res.status(500).json({ 
          error: error instanceof Error ? error.message : 'TTS generation failed' 
        });
      }
    }
  });

  // Import summarization service
  const { summarizeText, sanitizeForTTS } = await import('./lib/tts/index.js');

  app.post('/api/tts/summarize', async (req, res) => {
    try {
      const { text, threshold = 200, maxLength = 500 } = req.body || {};

      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Text is required' });
      }

      const sumZenModel = await resolveZenModel(typeof req.body?.zenModel === 'string' ? req.body.zenModel : undefined);
      const result = await summarizeText({ text, threshold, maxLength, zenModel: sumZenModel });

      return res.json(result);
    } catch (error) {
      console.error('[Summarize] Error:', error);
      const sanitized = sanitizeForTTS(req.body?.text || '');
      return res.json({ summary: sanitized, summarized: false, reason: error.message });
    }
  });

       
  // TTS status endpoint
  app.get('/api/tts/status', async (_req, res) => {
    try {
      const { ttsService } = await import('./lib/tts/index.js');
      res.json({
        available: ttsService.isAvailable(),
        voices: [
          'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable',
          'nova', 'onyx', 'sage', 'shimmer', 'verse', 'marin', 'cedar'
        ]
      });
    } catch (error) {
      res.status(500).json({ error: 'Failed to check TTS status' });
    }
  });

  // macOS 'say' command TTS status endpoint - returns cached capability from startup
  app.get('/api/tts/say/status', (_req, res) => {
    res.json(sayTTSCapability);
  });

  // macOS 'say' command TTS speak endpoint
  app.post('/api/tts/say/speak', async (req, res) => {
    try {
      const { text, voice = 'Samantha', rate = 200 } = req.body || {};
      
      if (!text || typeof text !== 'string' || !text.trim()) {
        return res.status(400).json({ error: 'Text is required' });
      }
      
      // Check if we're on macOS
      if (process.platform !== 'darwin') {
        return res.status(503).json({ error: 'macOS say command not available on this platform' });
      }
      
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const fs = await import('fs');
      const os = await import('os');
      const path = await import('path');
      const execAsync = promisify(exec);
      
      // Create temp file for audio output (use m4a for browser compatibility)
      const tempDir = os.tmpdir();
      const tempFile = path.join(tempDir, `say-${Date.now()}.m4a`);
      
      // Escape text for shell - escape both single quotes and double quotes
      const escapedText = text.trim().replace(/'/g, "'\\''").replace(/"/g, '\\"');
      
      // Generate audio file using 'say' command
      // -o outputs to file, -r sets rate (words per minute)
      // --data-format=aac outputs as m4a which browsers can decode
      const cmd = `say -v "${voice}" -r ${rate} -o "${tempFile}" --data-format=aac '${escapedText}'`;
      console.log('[TTS-Say] Generating speech:', { textLength: text.length, voice, rate });
      
      await execAsync(cmd);
      
      // Read the generated audio file
      const audioBuffer = await fs.promises.readFile(tempFile);
      
      // Clean up temp file
      fs.promises.unlink(tempFile).catch(() => {});
      
      // Send audio response
      res.setHeader('Content-Type', 'audio/mp4');
      res.setHeader('Content-Length', audioBuffer.length);
      res.send(audioBuffer);
      
    } catch (error) {
      console.error('[TTS-Say] Error:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Say command failed'
      });
    }
  });

  // New authoritative session status endpoints
  // Server maintains the source of truth, clients only query

  // GET /api/sessions/snapshot - Combined status + attention snapshot
  app.get('/api/sessions/snapshot', (_req, res) => {
    res.json({
      statusSessions: getSessionStateSnapshot(),
      attentionSessions: getSessionAttentionSnapshot(),
      serverTime: Date.now()
    });
  });

  // GET /api/sessions/status - Get status for all sessions
  app.get('/api/sessions/status', (_req, res) => {
    const snapshot = getSessionStateSnapshot();
    res.json({
      sessions: snapshot,
      serverTime: Date.now()
    });
  });

  // GET /api/sessions/:id/status - Get status for a specific session
  app.get('/api/sessions/:id/status', (req, res) => {
    const sessionId = req.params.id;
    const state = getSessionState(sessionId);

    if (!state) {
      return res.status(404).json({
        error: 'Session not found or no state available',
        sessionId
      });
    }

    res.json({
      sessionId,
      ...state
    });
  });

  // Session attention tracking endpoints
  // GET /api/sessions/attention - Get attention state for all sessions
  app.get('/api/sessions/attention', (_req, res) => {
    const snapshot = getSessionAttentionSnapshot();
    res.json({
      sessions: snapshot,
      serverTime: Date.now()
    });
  });

  // GET /api/sessions/:id/attention - Get attention state for a specific session
  app.get('/api/sessions/:id/attention', (req, res) => {
    const sessionId = req.params.id;
    const state = getSessionAttentionState(sessionId);

    if (!state) {
      return res.status(404).json({
        error: 'Session not found or no attention state available',
        sessionId
      });
    }

    res.json({
      sessionId,
      ...state
    });
  });

  // POST /api/sessions/:id/view - Client reports viewing this session
  app.post('/api/sessions/:id/view', (req, res) => {
    const sessionId = req.params.id;
    const clientId = req.headers['x-client-id'] || req.ip || 'anonymous';

    markSessionViewed(sessionId, clientId);

    res.json({
      success: true,
      sessionId,
      viewed: true
    });
  });

  // POST /api/sessions/:id/unview - Client reports leaving this session
  app.post('/api/sessions/:id/unview', (req, res) => {
    const sessionId = req.params.id;
    const clientId = req.headers['x-client-id'] || req.ip || 'anonymous';

    markSessionUnviewed(sessionId, clientId);

    res.json({
      success: true,
      sessionId,
      viewed: false
    });
  });

  // POST /api/sessions/:id/message-sent - User sent a message in this session
  app.post('/api/sessions/:id/message-sent', (req, res) => {
    const sessionId = req.params.id;

    markUserMessageSent(sessionId);

    res.json({
      success: true,
      sessionId,
      messageSent: true
    });
  });

  app.get('/api/openchamber/update-check', async (_req, res) => {
    try {
      const { checkForUpdates } = await import('./lib/package-manager.js');
      const updateInfo = await checkForUpdates();
      res.json(updateInfo);
    } catch (error) {
      console.error('Failed to check for updates:', error);
      res.status(500).json({
        available: false,
        error: error instanceof Error ? error.message : 'Failed to check for updates',
      });
    }
  });

  app.post('/api/openchamber/update-install', async (_req, res) => {
    try {
      const { spawn: spawnChild } = await import('child_process');
      const {
        checkForUpdates,
        getUpdateCommand,
        detectPackageManager,
      } = await import('./lib/package-manager.js');

      // Verify update is available
      const updateInfo = await checkForUpdates();
      if (!updateInfo.available) {
        return res.status(400).json({ error: 'No update available' });
      }

      const pm = detectPackageManager();
      const updateCmd = getUpdateCommand(pm);
      const isContainer =
        fs.existsSync('/.dockerenv') ||
        Boolean(process.env.CONTAINER) ||
        process.env.container === 'docker';

      if (isContainer) {
        res.json({
          success: true,
          message: 'Update starting, server will stay online',
          version: updateInfo.version,
          packageManager: pm,
          autoRestart: false,
        });

        setTimeout(() => {
          console.log(`\nInstalling update using ${pm} (container mode)...`);
          console.log(`Running: ${updateCmd}`);

          const shell = process.platform === 'win32' ? (process.env.ComSpec || 'cmd.exe') : 'sh';
          const shellFlag = process.platform === 'win32' ? '/c' : '-c';
          const child = spawnChild(shell, [shellFlag, updateCmd], {
            detached: true,
            stdio: 'ignore',
            env: process.env,
          });
          child.unref();
        }, 500);

        return;
      }

      // Get current server port for restart
      const currentPort = server.address()?.port || 3000;

      // Try to read stored instance options for restart
      const tmpDir = os.tmpdir();
      const instanceFilePath = path.join(tmpDir, `openchamber-${currentPort}.json`);
      let storedOptions = { port: currentPort, daemon: true };
      try {
        const content = await fs.promises.readFile(instanceFilePath, 'utf8');
        storedOptions = JSON.parse(content);
      } catch {
        // Use defaults
      }

      const isWindows = process.platform === 'win32';

      const quotePosix = (value) => `'${String(value).replace(/'/g, "'\\''")}'`;
      const quoteCmd = (value) => {
        const stringValue = String(value);
        return `"${stringValue.replace(/"/g, '""')}"`;
      };

      // Build restart command using explicit runtime + CLI path.
      // Avoids relying on `openchamber` being in PATH for service environments.
      const cliPath = path.resolve(__dirname, '..', 'bin', 'cli.js');
      const restartParts = [
        isWindows ? quoteCmd(process.execPath) : quotePosix(process.execPath),
        isWindows ? quoteCmd(cliPath) : quotePosix(cliPath),
        'serve',
        '--port',
        String(storedOptions.port),
        '--daemon',
      ];
      let restartCmdPrimary = restartParts.join(' ');
      let restartCmdFallback = `openchamber serve --port ${storedOptions.port} --daemon`;
      if (storedOptions.uiPassword) {
        if (isWindows) {
          // Escape for cmd.exe quoted argument
          const escapedPw = storedOptions.uiPassword.replace(/"/g, '""');
          restartCmdPrimary += ` --ui-password "${escapedPw}"`;
          restartCmdFallback += ` --ui-password "${escapedPw}"`;
        } else {
          // Escape for POSIX single-quoted argument
          const escapedPw = storedOptions.uiPassword.replace(/'/g, "'\\''");
          restartCmdPrimary += ` --ui-password '${escapedPw}'`;
          restartCmdFallback += ` --ui-password '${escapedPw}'`;
        }
      }
      const restartCmd = `(${restartCmdPrimary}) || (${restartCmdFallback})`;

      // Respond immediately - update will happen after response
      res.json({
        success: true,
        message: 'Update starting, server will restart shortly',
        version: updateInfo.version,
        packageManager: pm,
        autoRestart: true,
      });

      // Give time for response to be sent
      setTimeout(() => {
        console.log(`\nInstalling update using ${pm}...`);
        console.log(`Running: ${updateCmd}`);

        // Create a script that will:
        // 1. Wait for current process to exit
        // 2. Run the update
        // 3. Restart the server with original options
        const shell = isWindows ? (process.env.ComSpec || 'cmd.exe') : 'sh';
        const shellFlag = isWindows ? '/c' : '-c';
        const script = isWindows
          ? `
            timeout /t 2 /nobreak >nul
            ${updateCmd}
            if %ERRORLEVEL% EQU 0 (
              echo Update successful, restarting OpenChamber...
              ${restartCmd}
            ) else (
              echo Update failed
              exit /b 1
            )
          `
          : `
            sleep 2
            ${updateCmd}
            if [ $? -eq 0 ]; then
              echo "Update successful, restarting OpenChamber..."
              ${restartCmd}
            else
              echo "Update failed"
              exit 1
            fi
          `;

        // Spawn detached shell to run update after we exit.
        // Capture output to disk so restart failures are diagnosable.
        const updateLogPath = path.join(OPENCHAMBER_DATA_DIR, 'update-install.log');
        let logFd = null;
        try {
          fs.mkdirSync(path.dirname(updateLogPath), { recursive: true });
          logFd = fs.openSync(updateLogPath, 'a');
        } catch (logError) {
          console.warn('Failed to open update log file, continuing without log capture:', logError);
        }

        const child = spawnChild(shell, [shellFlag, script], {
          detached: true,
          stdio: logFd !== null ? ['ignore', logFd, logFd] : 'ignore',
          env: process.env,
        });
        child.unref();

        if (logFd !== null) {
          try {
            fs.closeSync(logFd);
          } catch {
            // ignore
          }
        }

        console.log('Update process spawned, shutting down server...');

        // Give child process time to start, then exit
        setTimeout(() => {
          process.exit(0);
        }, 500);
      }, 500);
    } catch (error) {
      console.error('Failed to install update:', error);
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to install update',
      });
    }
  });

  app.get('/api/openchamber/models-metadata', async (req, res) => {
    const now = Date.now();

    if (cachedModelsMetadata && now - cachedModelsMetadataTimestamp < MODELS_METADATA_CACHE_TTL) {
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.json(cachedModelsMetadata);
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), 8000) : null;

    try {
      const response = await fetch(MODELS_DEV_API_URL, {
        signal: controller?.signal,
        headers: {
          Accept: 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(`models.dev responded with status ${response.status}`);
      }

      const metadata = await response.json();
      cachedModelsMetadata = metadata;
      cachedModelsMetadataTimestamp = Date.now();

      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json(metadata);
    } catch (error) {
      console.warn('Failed to fetch models.dev metadata via server:', error);

      if (cachedModelsMetadata) {
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json(cachedModelsMetadata);
      } else {
        const statusCode = error?.name === 'AbortError' ? 504 : 502;
        res.status(statusCode).json({ error: 'Failed to retrieve model metadata' });
      }
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  });

  // Zen models endpoint - returns available free models from the zen API
  app.get('/api/zen/models', async (_req, res) => {
    try {
      const models = await fetchFreeZenModels();
      res.setHeader('Cache-Control', 'public, max-age=300');
      res.json({ models });
    } catch (error) {
      console.warn('Failed to fetch zen models:', error);
      // Serve stale cache if available
      if (cachedZenModels) {
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json(cachedZenModels);
      } else {
        const statusCode = error?.name === 'AbortError' ? 504 : 502;
        res.status(statusCode).json({ error: 'Failed to retrieve zen models' });
      }
    }
  });

  // ── Cloudflare Tunnel API ──────────────────────────────────────────

  app.get('/api/openchamber/tunnel/check', async (_req, res) => {
    try {
      const result = await checkCloudflaredAvailable();
      res.json({ available: result.available, version: result.version || null });
    } catch (error) {
      console.warn('Cloudflare tunnel check failed:', error);
      res.json({ available: false, version: null });
    }
  });

  app.get('/api/openchamber/tunnel/status', async (_req, res) => {
    try {
      const settings = await readSettingsFromDiskMigrated();
      const mode = normalizeTunnelMode(settings?.tunnelMode);
      const namedHostname = normalizeNamedTunnelHostname(settings?.namedTunnelHostname);
      const namedTunnelConfig = await readNamedTunnelConfigFromDisk();
      const hasLegacyNamedToken = typeof settings?.namedTunnelToken === 'string' && settings.namedTunnelToken.trim().length > 0;
      const hasNamedTunnelToken = runtimeNamedTunnelToken.length > 0 || namedTunnelConfig.tunnels.length > 0 || hasLegacyNamedToken;
      const bootstrapTtlMs = settings?.tunnelBootstrapTtlMs === null
        ? null
        : normalizeTunnelBootstrapTtlMs(settings?.tunnelBootstrapTtlMs);
      const sessionTtlMs = normalizeTunnelSessionTtlMs(settings?.tunnelSessionTtlMs);
      const activeSessions = tunnelAuthController.listTunnelSessions();

      const publicUrl = cloudflareTunnelController?.getPublicUrl?.() ?? null;
      if (!publicUrl) {
        return res.json({
          active: false,
          url: null,
          mode,
          hasNamedTunnelToken,
          namedTunnelHostname: namedHostname || null,
          namedTunnelTokenPresetIds: namedTunnelConfig.tunnels.map((entry) => entry.id),
          hasBootstrapToken: false,
          bootstrapExpiresAt: null,
          policy: 'tunnel-gated',
          activeTunnelMode: tunnelAuthController.getActiveTunnelMode() || null,
          activeSessions,
          localPort: activePort,
          ttlConfig: {
            bootstrapTtlMs,
            sessionTtlMs,
          },
        });
      }

      const activeMode = cloudflareTunnelController?.mode === TUNNEL_MODE_NAMED ? TUNNEL_MODE_NAMED : TUNNEL_MODE_QUICK;

      if (!tunnelAuthController.getActiveTunnelId() || !tunnelAuthController.getActiveTunnelHost()) {
        tunnelAuthController.setActiveTunnel({ tunnelId: crypto.randomUUID(), publicUrl, mode: activeMode });
      }

      const bootstrapStatus = tunnelAuthController.getBootstrapStatus();

      return res.json({
        active: true,
        url: publicUrl,
        mode: activeMode,
        hasNamedTunnelToken,
        namedTunnelHostname: namedHostname || null,
        namedTunnelTokenPresetIds: namedTunnelConfig.tunnels.map((entry) => entry.id),
        hasBootstrapToken: bootstrapStatus.hasBootstrapToken,
        bootstrapExpiresAt: bootstrapStatus.bootstrapExpiresAt,
        policy: 'tunnel-gated',
        activeTunnelMode: activeMode,
        activeSessions: tunnelAuthController.listTunnelSessions(),
        localPort: activePort,
        ttlConfig: {
          bootstrapTtlMs,
          sessionTtlMs,
        },
      });
    } catch (error) {
      return res.status(500).json({ error: 'Failed to get tunnel status' });
    }
  });

  app.put('/api/openchamber/tunnel/named-token', async (req, res) => {
    try {
      const presetId = typeof req?.body?.presetId === 'string' ? req.body.presetId.trim() : '';
      const presetName = typeof req?.body?.presetName === 'string' ? req.body.presetName.trim() : '';
      const namedTunnelHostname = normalizeNamedTunnelHostname(req?.body?.namedTunnelHostname);
      const namedTunnelToken = typeof req?.body?.namedTunnelToken === 'string' ? req.body.namedTunnelToken.trim() : '';

      if (!presetId || !presetName || !namedTunnelHostname || !namedTunnelToken) {
        return res.status(400).json({ ok: false, error: 'presetId, presetName, namedTunnelHostname and namedTunnelToken are required' });
      }

      await upsertNamedTunnelToken({
        id: presetId,
        name: presetName,
        hostname: namedTunnelHostname,
        token: namedTunnelToken,
      });

      const namedTunnelConfig = await readNamedTunnelConfigFromDisk();
      return res.json({ ok: true, namedTunnelTokenPresetIds: namedTunnelConfig.tunnels.map((entry) => entry.id) });
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Failed to save named tunnel token' });
    }
  });

  app.post('/api/openchamber/tunnel/start', async (_req, res) => {
    try {
      const settings = await readSettingsFromDiskMigrated();
      const mode = normalizeTunnelMode(_req?.body?.mode ?? settings?.tunnelMode);
      const selectedPresetId = typeof _req?.body?.namedTunnelPresetId === 'string' ? _req.body.namedTunnelPresetId.trim() : '';
      const selectedPresetName = typeof _req?.body?.namedTunnelPresetName === 'string' ? _req.body.namedTunnelPresetName.trim() : '';
      const requestNamedHostname = normalizeNamedTunnelHostname(_req?.body?.namedTunnelHostname);
      const namedHostname = requestNamedHostname || normalizeNamedTunnelHostname(settings?.namedTunnelHostname);
      const requestNamedToken = typeof _req?.body?.namedTunnelToken === 'string' ? _req.body.namedTunnelToken.trim() : '';
      const legacyNamedToken = typeof settings?.namedTunnelToken === 'string' ? settings.namedTunnelToken.trim() : '';
      const configNamedToken = await resolveNamedTunnelToken({ presetId: selectedPresetId, hostname: namedHostname });
      const namedToken = requestNamedToken
        || ((runtimeNamedTunnelHostname && namedHostname && runtimeNamedTunnelHostname === namedHostname) ? runtimeNamedTunnelToken : '')
        || configNamedToken
        || legacyNamedToken
        ;
      const bootstrapTtlMs = settings?.tunnelBootstrapTtlMs === null
        ? null
        : normalizeTunnelBootstrapTtlMs(settings?.tunnelBootstrapTtlMs);
      const sessionTtlMs = normalizeTunnelSessionTtlMs(settings?.tunnelSessionTtlMs);

      let publicUrl = cloudflareTunnelController?.getPublicUrl?.() ?? null;
      const activeMode = cloudflareTunnelController?.mode === TUNNEL_MODE_NAMED ? TUNNEL_MODE_NAMED : TUNNEL_MODE_QUICK;

      if (publicUrl && activeMode !== mode) {
        cloudflareTunnelController.stop();
        cloudflareTunnelController = null;
        tunnelAuthController.clearActiveTunnel();
        publicUrl = null;
      }

      if (!publicUrl) {
        const cfCheck = await checkCloudflaredAvailable();
        if (!cfCheck.available) {
          return res.status(400).json({
            ok: false,
            error: 'cloudflared is not installed. Install it with: brew install cloudflared',
          });
        }

        if (mode === TUNNEL_MODE_NAMED) {
          if (!namedHostname) {
            return res.status(400).json({ ok: false, error: 'Named tunnel hostname is required' });
          }
          if (!namedToken) {
            return res.status(400).json({ ok: false, error: 'Named tunnel token is required' });
          }

          runtimeNamedTunnelHostname = namedHostname;
          runtimeNamedTunnelToken = namedToken;

          if (requestNamedToken && namedHostname) {
            await upsertNamedTunnelToken({
              id: selectedPresetId || namedHostname,
              name: selectedPresetName || namedHostname,
              hostname: namedHostname,
              token: requestNamedToken,
            });
          }

          cloudflareTunnelController = await startCloudflareNamedTunnel({
            token: namedToken,
            hostname: namedHostname,
          });
        } else {
          const originUrl = `http://127.0.0.1:${activePort}`;
          cloudflareTunnelController = await startCloudflareQuickTunnel({ originUrl, port: activePort });
        }

        publicUrl = cloudflareTunnelController.getPublicUrl();

        if (!publicUrl) {
          cloudflareTunnelController.stop();
          cloudflareTunnelController = null;
          tunnelAuthController.clearActiveTunnel();
          return res.status(500).json({ ok: false, error: 'Tunnel started but no public URL was assigned' });
        }

        if (mode === TUNNEL_MODE_QUICK) {
          printTunnelWarning();
        }
        console.log(`Cloudflare tunnel active: ${publicUrl}`);
      }

      if (!tunnelAuthController.getActiveTunnelId() || !tunnelAuthController.getActiveTunnelHost()) {
        tunnelAuthController.setActiveTunnel({ tunnelId: crypto.randomUUID(), publicUrl, mode });
      }

      const bootstrapToken = tunnelAuthController.issueBootstrapToken({ ttlMs: bootstrapTtlMs });
      const connectUrl = `${publicUrl.replace(/\/$/, '')}/connect?t=${encodeURIComponent(bootstrapToken.token)}`;
      const namedTunnelConfig = await readNamedTunnelConfigFromDisk();

      return res.json({
        ok: true,
        url: publicUrl,
        mode,
        namedTunnelHostname: namedHostname || null,
        namedTunnelTokenPresetIds: namedTunnelConfig.tunnels.map((entry) => entry.id),
        connectUrl,
        bootstrapExpiresAt: bootstrapToken.expiresAt,
        policy: 'tunnel-gated',
        activeTunnelMode: mode,
        activeSessions: tunnelAuthController.listTunnelSessions(),
        localPort: activePort,
        ttlConfig: {
          bootstrapTtlMs,
          sessionTtlMs,
        },
      });
    } catch (error) {
      console.error('Failed to start Cloudflare tunnel:', error);
      cloudflareTunnelController = null;
      tunnelAuthController.clearActiveTunnel();
      return res.status(500).json({ ok: false, error: error?.message || 'Failed to start tunnel' });
    }
  });

  app.post('/api/openchamber/tunnel/stop', (_req, res) => {
    let revokedBootstrapCount = 0;
    let invalidatedSessionCount = 0;
    const activeTunnelId = tunnelAuthController.getActiveTunnelId();

    if (activeTunnelId) {
      const revoked = tunnelAuthController.revokeTunnelArtifacts(activeTunnelId);
      revokedBootstrapCount = revoked.revokedBootstrapCount;
      invalidatedSessionCount = revoked.invalidatedSessionCount;
    }

    if (cloudflareTunnelController) {
      console.log('Stopping Cloudflare tunnel (user requested)...');
      cloudflareTunnelController.stop();
      cloudflareTunnelController = null;
    }

    tunnelAuthController.clearActiveTunnel();
    res.json({ ok: true, revokedBootstrapCount, invalidatedSessionCount });
  });

  // ── End Cloudflare Tunnel API ─────────────────────────────────────

  app.get('/api/global/event', async (req, res) => {
    let targetUrl;
    try {
      targetUrl = new URL(buildOpenCodeUrl('/global/event', ''));
    } catch {
      return res.status(503).json({ error: 'OpenCode service unavailable' });
    }

    const headers = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...getOpenCodeAuthHeaders(),
    };

    const lastEventId = req.header('Last-Event-ID');
    if (typeof lastEventId === 'string' && lastEventId.length > 0) {
      headers['Last-Event-ID'] = lastEventId;
    }

    const controller = new AbortController();
    const cleanup = () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };

    req.on('close', cleanup);
    req.on('error', cleanup);

    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      return res.status(502).json({ error: 'Failed to connect to OpenCode event stream' });
    }

    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: `OpenCode event stream unavailable (${upstream.status})` });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    uiNotificationClients.add(res);
    const cleanupClient = () => {
      uiNotificationClients.delete(res);
    };
    req.on('close', cleanupClient);
    req.on('error', cleanupClient);

    const heartbeatInterval = setInterval(() => {
      writeSseEvent(res, { type: 'openchamber:heartbeat', timestamp: Date.now() });
    }, 15000);

    const decoder = new TextDecoder();
    const reader = upstream.body.getReader();
    let buffer = '';

    const forwardBlock = (block) => {
      if (!block) return;
      res.write(`${block}

`);
      const payload = parseSseDataPayload(block);
      // Cache session titles from session.updated/session.created events (global stream)
      maybeCacheSessionInfoFromEvent(payload);

      // Keep server-authoritative session state fresh even if the
      // background watcher is disconnected.
      if (payload && payload.type === 'session.status') {
        const update = extractSessionStatusUpdate(payload);
        if (update) {
          updateSessionState(update.sessionId, update.type, update.eventId || `proxy-${Date.now()}`, {
            attempt: update.attempt,
            message: update.message,
            next: update.next,
          });
        }
      }

      const transitions = deriveSessionActivityTransitions(payload);
      if (transitions && transitions.length > 0) {
        for (const activity of transitions) {
          if (setSessionActivityPhase(activity.sessionId, activity.phase)) {
            writeSseEvent(res, {
              type: 'openchamber:session-activity',
              properties: {
                sessionId: activity.sessionId,
                phase: activity.phase,
              }
            });
          }
        }
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

        let separatorIndex = buffer.indexOf('\n\n');
        while (separatorIndex !== -1) {
          const block = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          forwardBlock(block);
          separatorIndex = buffer.indexOf('\n\n');
        }
      }

      if (buffer.trim().length > 0) {
        forwardBlock(buffer.trim());
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.warn('SSE proxy stream error:', error);
      }
    } finally {
      clearInterval(heartbeatInterval);
      cleanupClient();
      cleanup();
      try {
        res.end();
      } catch {
        // ignore
      }
    }
  });

  app.get('/api/event', async (req, res) => {
    let targetUrl;
    try {
      targetUrl = new URL(buildOpenCodeUrl('/event', ''));
    } catch {
      return res.status(503).json({ error: 'OpenCode service unavailable' });
    }

    const headerDirectory = typeof req.get === 'function' ? req.get('x-opencode-directory') : null;
    const directoryParam = Array.isArray(req.query.directory)
      ? req.query.directory[0]
      : req.query.directory;
    const resolvedDirectory = headerDirectory || directoryParam || null;
    if (typeof resolvedDirectory === 'string' && resolvedDirectory.trim().length > 0) {
      targetUrl.searchParams.set('directory', resolvedDirectory.trim());
    }

    const headers = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      ...getOpenCodeAuthHeaders(),
    };

    const lastEventId = req.header('Last-Event-ID');
    if (typeof lastEventId === 'string' && lastEventId.length > 0) {
      headers['Last-Event-ID'] = lastEventId;
    }

    const controller = new AbortController();
    const cleanup = () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };

    req.on('close', cleanup);
    req.on('error', cleanup);

    let upstream;
    try {
      upstream = await fetch(targetUrl.toString(), {
        headers,
        signal: controller.signal,
      });
    } catch (error) {
      return res.status(502).json({ error: 'Failed to connect to OpenCode event stream' });
    }

    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: `OpenCode event stream unavailable (${upstream.status})` });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    if (typeof res.flushHeaders === 'function') {
      res.flushHeaders();
    }

    const heartbeatInterval = setInterval(() => {
      writeSseEvent(res, { type: 'openchamber:heartbeat', timestamp: Date.now() });
    }, 15000);

    const decoder = new TextDecoder();
    const reader = upstream.body.getReader();
    let buffer = '';

    const forwardBlock = (block) => {
      if (!block) return;
      res.write(`${block}

`);
      const payload = parseSseDataPayload(block);
      // Cache session titles from session.updated/session.created events (per-session stream)
      maybeCacheSessionInfoFromEvent(payload);

      if (payload && payload.type === 'session.status') {
        const update = extractSessionStatusUpdate(payload);
        if (update) {
          updateSessionState(update.sessionId, update.type, update.eventId || `proxy-${Date.now()}`, {
            attempt: update.attempt,
            message: update.message,
            next: update.next,
          });
        }
      }

      const transitions = deriveSessionActivityTransitions(payload);
      if (transitions && transitions.length > 0) {
        for (const activity of transitions) {
          if (setSessionActivityPhase(activity.sessionId, activity.phase)) {
            writeSseEvent(res, {
              type: 'openchamber:session-activity',
              properties: {
                sessionId: activity.sessionId,
                phase: activity.phase,
              }
            });
          }
        }
      }
    };

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

        let separatorIndex = buffer.indexOf('\n\n');
        while (separatorIndex !== -1) {
          const block = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          forwardBlock(block);
          separatorIndex = buffer.indexOf('\n\n');
        }
      }

      if (buffer.trim().length > 0) {
        forwardBlock(buffer.trim());
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        console.warn('SSE proxy stream error:', error);
      }
    } finally {
      clearInterval(heartbeatInterval);
      cleanup();
      try {
        res.end();
      } catch {
        // ignore
      }
    }
  });

  app.get('/api/config/settings', async (_req, res) => {
    try {
      const settings = await readSettingsFromDiskMigrated();
      res.json(formatSettingsResponse(settings));
    } catch (error) {
      console.error('Failed to load settings:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load settings' });
    }
  });

  app.get('/api/config/opencode-resolution', async (_req, res) => {
    try {
      const settings = await readSettingsFromDiskMigrated();
      const configured = typeof settings?.opencodeBinary === 'string' ? settings.opencodeBinary : null;

      const previousSource = resolvedOpencodeBinarySource;
      const detectedNow = resolveOpencodeCliPath();
      const rawDetectedSourceNow = resolvedOpencodeBinarySource;
      resolvedOpencodeBinarySource = previousSource;

      // Best-effort: apply configured override (if any) and resolve.
      await applyOpencodeBinaryFromSettings();
      ensureOpencodeCliEnv();

      const resolved = resolvedOpencodeBinary || null;
      const source = resolvedOpencodeBinarySource || null;
      const detectedSourceNow =
        detectedNow &&
        resolved &&
        detectedNow === resolved &&
        rawDetectedSourceNow === 'env' &&
        source &&
        source !== 'env'
          ? source
          : rawDetectedSourceNow;
      const shim = resolved ? opencodeShimInterpreter(resolved) : null;

      res.json({
        configured,
        resolved,
        resolvedDir: resolved ? path.dirname(resolved) : null,
        source,
        detectedNow,
        detectedSourceNow,
        shim,
        viaWsl: useWslForOpencode,
        wslBinary: resolvedWslBinary || null,
        wslPath: resolvedWslOpencodePath || null,
        wslDistro: resolvedWslDistro || null,
        node: resolvedNodeBinary || null,
        bun: resolvedBunBinary || null,
      });
    } catch (error) {
      console.error('Failed to build opencode resolution snapshot:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to build snapshot' });
    }
  });

  app.get('/api/config/themes', async (_req, res) => {
    try {
      const customThemes = await readCustomThemesFromDisk();
      res.json({ themes: customThemes });
    } catch (error) {
      console.error('Failed to load custom themes:', error);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to load custom themes' });
    }
  });

  app.put('/api/config/settings', async (req, res) => {
    console.log(`[API:PUT /api/config/settings] Received request`);
    try {
      const updated = await persistSettings(req.body ?? {});
      console.log(`[API:PUT /api/config/settings] Success, returning ${updated.projects?.length || 0} projects`);
      res.json(updated);
    } catch (error) {
      console.error(`[API:PUT /api/config/settings] Failed to save settings:`, error);
      console.error(`[API:PUT /api/config/settings] Error stack:`, error.stack);
      res.status(500).json({ error: error instanceof Error ? error.message : 'Failed to save settings' });
    }
  });

  app.get('/api/projects/:projectId/icon', async (req, res) => {
    const projectId = typeof req.params.projectId === 'string' ? req.params.projectId.trim() : '';
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    try {
      const settings = await readSettingsFromDiskMigrated();
      const { project } = findProjectById(settings, projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const metadataMime = normalizeProjectIconMime(project.iconImage?.mime);
      const preferredPath = metadataMime ? projectIconPathForMime(projectId, metadataMime) : null;
      const candidates = preferredPath
        ? [preferredPath, ...projectIconPathCandidates(projectId).filter((candidate) => candidate !== preferredPath)]
        : projectIconPathCandidates(projectId);

      for (const iconPath of candidates) {
        try {
          const data = await fsPromises.readFile(iconPath);
          const ext = path.extname(iconPath).slice(1).toLowerCase();
          const contentType = metadataMime || PROJECT_ICON_EXTENSION_TO_MIME[ext] || 'application/octet-stream';
          res.setHeader('Content-Type', contentType);
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          return res.send(data);
        } catch (error) {
          if (!error || typeof error !== 'object' || error.code !== 'ENOENT') {
            console.warn('Failed to read project icon:', error);
            return res.status(500).json({ error: 'Failed to read project icon' });
          }
        }
      }

      return res.status(404).json({ error: 'Project icon not found' });
    } catch (error) {
      console.warn('Failed to load project icon:', error);
      return res.status(500).json({ error: 'Failed to load project icon' });
    }
  });

  app.put('/api/projects/:projectId/icon', async (req, res) => {
    const projectId = typeof req.params.projectId === 'string' ? req.params.projectId.trim() : '';
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    const parsed = parseProjectIconDataUrl(req.body?.dataUrl);
    if (!parsed.ok) {
      return res.status(400).json({ error: parsed.error });
    }

    try {
      const settings = await readSettingsFromDiskMigrated();
      const { projects, project } = findProjectById(settings, projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const iconPath = projectIconPathForMime(projectId, parsed.mime);
      if (!iconPath) {
        return res.status(400).json({ error: 'Unsupported icon format' });
      }

      await fsPromises.mkdir(PROJECT_ICONS_DIR_PATH, { recursive: true });
      await fsPromises.writeFile(iconPath, parsed.bytes);
      await removeProjectIconFiles(projectId, iconPath);

      const updatedAt = Date.now();
      const nextProjects = projects.map((entry) => (
        entry.id === projectId
          ? { ...entry, iconImage: { mime: parsed.mime, updatedAt, source: 'custom' } }
          : entry
      ));
      const updatedSettings = await persistSettings({ projects: nextProjects });
      const updatedProject = (updatedSettings.projects || []).find((entry) => entry.id === projectId) || null;

      return res.json({ project: updatedProject, settings: updatedSettings });
    } catch (error) {
      console.warn('Failed to upload project icon:', error);
      return res.status(500).json({ error: 'Failed to upload project icon' });
    }
  });

  app.delete('/api/projects/:projectId/icon', async (req, res) => {
    const projectId = typeof req.params.projectId === 'string' ? req.params.projectId.trim() : '';
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    try {
      const settings = await readSettingsFromDiskMigrated();
      const { projects, project } = findProjectById(settings, projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      await removeProjectIconFiles(projectId);

      const nextProjects = projects.map((entry) => (
        entry.id === projectId
          ? { ...entry, iconImage: null }
          : entry
      ));
      const updatedSettings = await persistSettings({ projects: nextProjects });
      const updatedProject = (updatedSettings.projects || []).find((entry) => entry.id === projectId) || null;

      return res.json({ project: updatedProject, settings: updatedSettings });
    } catch (error) {
      console.warn('Failed to remove project icon:', error);
      return res.status(500).json({ error: 'Failed to remove project icon' });
    }
  });

  app.post('/api/projects/:projectId/icon/discover', async (req, res) => {
    const projectId = typeof req.params.projectId === 'string' ? req.params.projectId.trim() : '';
    if (!projectId) {
      return res.status(400).json({ error: 'projectId is required' });
    }

    try {
      const settings = await readSettingsFromDiskMigrated();
      const { projects, project } = findProjectById(settings, projectId);
      if (!project) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const force = req.body?.force === true;
      if (project.iconImage?.source === 'custom' && !force) {
        return res.json({
          project,
          skipped: true,
          reason: 'custom-icon-present',
        });
      }

      const faviconCandidates = await searchFilesystemFiles(project.path, {
        limit: 200,
        query: 'favicon',
        includeHidden: true,
        respectGitignore: false,
      });

      const filtered = faviconCandidates
        .filter((entry) => /(^|\/)favicon\.(ico|png|svg|jpg|jpeg|webp)$/i.test(entry.path))
        .sort((a, b) => a.path.length - b.path.length);

      const selected = filtered[0];
      if (!selected) {
        return res.status(404).json({ error: 'No favicon found in project' });
      }

      const ext = path.extname(selected.path).slice(1).toLowerCase();
      const mime = PROJECT_ICON_EXTENSION_TO_MIME[ext] || null;
      if (!mime) {
        return res.status(415).json({ error: 'Unsupported favicon format' });
      }

      const bytes = await fsPromises.readFile(selected.path);
      if (bytes.length === 0) {
        return res.status(400).json({ error: 'Discovered icon is empty' });
      }
      if (bytes.length > PROJECT_ICON_MAX_BYTES) {
        return res.status(400).json({ error: 'Discovered icon exceeds size limit (5 MB)' });
      }

      const iconPath = projectIconPathForMime(projectId, mime);
      if (!iconPath) {
        return res.status(415).json({ error: 'Unsupported favicon format' });
      }

      await fsPromises.mkdir(PROJECT_ICONS_DIR_PATH, { recursive: true });
      await fsPromises.writeFile(iconPath, bytes);
      await removeProjectIconFiles(projectId, iconPath);

      const updatedAt = Date.now();
      const nextProjects = projects.map((entry) => (
        entry.id === projectId
          ? { ...entry, iconImage: { mime, updatedAt, source: 'auto' } }
          : entry
      ));
      const updatedSettings = await persistSettings({ projects: nextProjects });
      const updatedProject = (updatedSettings.projects || []).find((entry) => entry.id === projectId) || null;

      return res.json({
        project: updatedProject,
        settings: updatedSettings,
        discoveredPath: selected.path,
      });
    } catch (error) {
      console.warn('Failed to discover project icon:', error);
      return res.status(500).json({ error: 'Failed to discover project icon' });
    }
  });

  const {
    getAgentSources,
    getAgentScope,
    getAgentConfig,
    createAgent,
    updateAgent,
    deleteAgent,
    getCommandSources,
    getCommandScope,
    createCommand,
    updateCommand,
    deleteCommand,
    getProviderSources,
    removeProviderConfig,
    AGENT_SCOPE,
    COMMAND_SCOPE,
    listMcpConfigs,
    getMcpConfig,
    createMcpConfig,
    updateMcpConfig,
    deleteMcpConfig,
    isOhMyOpencodeInstalled,
    readOhMyOpencodeConfig,
    writeOhMyOpencodeCategories,
    writeOhMyOpencodeAgents,
  } = await import('./lib/opencode/index.js');

  app.get('/api/config/agents/:name', async (req, res) => {
    try {
      const agentName = req.params.name;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }
      const sources = getAgentSources(agentName, directory);

      const scope = sources.md.exists
        ? sources.md.scope
        : (sources.json.exists ? sources.json.scope : null);

      res.json({
        name: agentName,
        sources: sources,
        scope,
        isBuiltIn: !sources.md.exists && !sources.json.exists
      });
    } catch (error) {
      console.error('Failed to get agent sources:', error);
      res.status(500).json({ error: 'Failed to get agent configuration metadata' });
    }
  });

  app.get('/api/config/agents/:name/config', async (req, res) => {
    try {
      const agentName = req.params.name;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }

      const configInfo = getAgentConfig(agentName, directory);
      res.json(configInfo);
    } catch (error) {
      console.error('Failed to get agent config:', error);
      res.status(500).json({ error: 'Failed to get agent configuration' });
    }
  });

  app.post('/api/config/agents/batch-update', async (req, res) => {
    try {
      const { agents } = req.body;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }
      if (!agents || typeof agents !== 'object' || Array.isArray(agents)) {
        return res.status(400).json({ error: 'agents must be an object mapping agent names to updates' });
      }

      const updated = [];
      const failed = [];
      for (const [agentName, updates] of Object.entries(agents)) {
        try {
          updateAgent(agentName, updates, directory);
          updated.push(agentName);
        } catch (agentError) {
          failed.push({ name: agentName, error: agentError.message || String(agentError) });
        }
      }

      await refreshOpenCodeAfterConfigChange('batch agent update');

      console.log(`[Server] Batch agent update complete: ${updated.length} updated, ${failed.length} failed`);

      res.json({
        success: true,
        updated,
        failed,
        requiresReload: true,
        reloadDelayMs: CLIENT_RELOAD_DELAY_MS,
      });
    } catch (error) {
      console.error('[Server] Failed to batch-update agents:', error);
      res.status(500).json({ error: error.message || 'Failed to batch-update agents' });
    }
  });

  app.post('/api/config/agents/:name', async (req, res) => {
    try {
      const agentName = req.params.name;
      const { scope, ...config } = req.body;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }

      console.log('[Server] Creating agent:', agentName);
      console.log('[Server] Config received:', JSON.stringify(config, null, 2));
      console.log('[Server] Scope:', scope, 'Working directory:', directory);

      createAgent(agentName, config, directory, scope);
      await refreshOpenCodeAfterConfigChange('agent creation', {
        agentName
      });

      res.json({
        success: true,
        requiresReload: true,
        message: `Agent ${agentName} created successfully. Reloading interface…`,
        reloadDelayMs: CLIENT_RELOAD_DELAY_MS,
      });
    } catch (error) {
      console.error('Failed to create agent:', error);
      res.status(500).json({ error: error.message || 'Failed to create agent' });
    }
  });

  app.patch('/api/config/agents/:name', async (req, res) => {
    try {
      const agentName = req.params.name;
      const updates = req.body;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }

      console.log(`[Server] Updating agent: ${agentName}`);
      console.log('[Server] Updates:', JSON.stringify(updates, null, 2));
      console.log('[Server] Working directory:', directory);

      updateAgent(agentName, updates, directory);
      await refreshOpenCodeAfterConfigChange('agent update');

      console.log(`[Server] Agent ${agentName} updated successfully`);

      res.json({
        success: true,
        requiresReload: true,
        message: `Agent ${agentName} updated successfully. Reloading interface…`,
        reloadDelayMs: CLIENT_RELOAD_DELAY_MS,
      });
    } catch (error) {
      console.error('[Server] Failed to update agent:', error);
      console.error('[Server] Error stack:', error.stack);
      res.status(500).json({ error: error.message || 'Failed to update agent' });
    }
  });

  app.delete('/api/config/agents/:name', async (req, res) => {
    try {
      const agentName = req.params.name;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }

      deleteAgent(agentName, directory);
      await refreshOpenCodeAfterConfigChange('agent deletion');

      res.json({
        success: true,
        requiresReload: true,
        message: `Agent ${agentName} deleted successfully. Reloading interface…`,
        reloadDelayMs: CLIENT_RELOAD_DELAY_MS,
      });
    } catch (error) {
      console.error('Failed to delete agent:', error);
      res.status(500).json({ error: error.message || 'Failed to delete agent' });
    }
  });

  // ============================================================
  // Profile Routes
  // ============================================================

  app.get('/api/config/profiles', async (req, res) => {
    try {
      const settings = await readSettingsFromDiskMigrated();
      const profiles = settings.profiles || [];
      res.json({ profiles });
    } catch (error) {
      console.error('[Server] Failed to get profiles:', error);
      res.status(500).json({ error: error.message || 'Failed to get profiles' });
    }
  });

  app.post('/api/config/profiles', async (req, res) => {
    try {
      const settings = await readSettingsFromDiskMigrated();
      const { name, agentModels, categoryModels, omoAgentModels } = req.body;

      const trimmedName = typeof name === 'string' ? name.trim() : '';
      if (trimmedName.length === 0 || trimmedName.length > 64) {
        return res.status(400).json({ error: 'name must be a string of 1–64 characters' });
      }
      const existingProfiles = settings.profiles || [];
      if (existingProfiles.some((p) => p.name.toLowerCase() === trimmedName.toLowerCase())) {
        return res.status(400).json({ error: 'A profile with this name already exists' });
      }
      if (!agentModels || typeof agentModels !== 'object' || Array.isArray(agentModels)) {
        return res.status(400).json({ error: 'agentModels must be an object with string values' });
      }
      for (const [key, val] of Object.entries(agentModels)) {
        if (typeof key !== 'string' || typeof val !== 'string') {
          return res.status(400).json({ error: 'agentModels must be an object with string values' });
        }
      }

      const now = new Date().toISOString();
      const profile = {
        id: crypto.randomUUID(),
        name: trimmedName,
        agentModels,
        createdAt: now,
        updatedAt: now,
      };
      if (categoryModels && typeof categoryModels === 'object' && !Array.isArray(categoryModels)) {
        const validCategoryModels = {};
        for (const [key, val] of Object.entries(categoryModels)) {
          if (typeof key === 'string' && typeof val === 'string') {
            validCategoryModels[key] = val;
          }
        }
        if (Object.keys(validCategoryModels).length > 0) {
          profile.categoryModels = validCategoryModels;
        }
      }
      if (omoAgentModels && typeof omoAgentModels === 'object' && !Array.isArray(omoAgentModels)) {
        const validOmoAgentModels = {};
        for (const [key, val] of Object.entries(omoAgentModels)) {
          if (typeof key === 'string' && typeof val === 'string') {
            validOmoAgentModels[key] = val;
          }
        }
        if (Object.keys(validOmoAgentModels).length > 0) {
          profile.omoAgentModels = validOmoAgentModels;
        }
      }

      const profiles = [...(settings.profiles || []), profile];
      console.log(`[Server] Creating profile: ${profile.name} (${profile.id})`);
      await persistSettings({ profiles });

      res.json({ success: true, profile });
    } catch (error) {
      console.error('[Server] Failed to create profile:', error);
      res.status(500).json({ error: error.message || 'Failed to create profile' });
    }
  });

  app.patch('/api/config/profiles/:id', async (req, res) => {
    try {
      const settings = await readSettingsFromDiskMigrated();
      const profileId = req.params.id;
      const { name, agentModels, categoryModels, omoAgentModels } = req.body;
      const profiles = settings.profiles || [];
      const index = profiles.findIndex((p) => p.id === profileId);
      if (index === -1) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      const existing = profiles[index];
      const updatedProfile = { ...existing };

      if (name !== undefined) {
        const trimmedName = typeof name === 'string' ? name.trim() : '';
        if (trimmedName.length === 0 || trimmedName.length > 64) {
          return res.status(400).json({ error: 'name must be a string of 1–64 characters' });
        }
        if (profiles.some((p, i) => i !== index && p.name.toLowerCase() === trimmedName.toLowerCase())) {
          return res.status(400).json({ error: 'A profile with this name already exists' });
        }
        updatedProfile.name = trimmedName;
      }
      if (agentModels !== undefined) {
        if (!agentModels || typeof agentModels !== 'object' || Array.isArray(agentModels)) {
          return res.status(400).json({ error: 'agentModels must be an object with string values' });
        }
        for (const [key, val] of Object.entries(agentModels)) {
          if (typeof key !== 'string' || typeof val !== 'string') {
            return res.status(400).json({ error: 'agentModels must be an object with string values' });
          }
        }
      updatedProfile.agentModels = agentModels;
      }
      if (categoryModels !== undefined) {
        if (categoryModels === null) {
          delete updatedProfile.categoryModels;
        } else if (typeof categoryModels === 'object' && !Array.isArray(categoryModels)) {
          const validCategoryModels = {};
          for (const [key, val] of Object.entries(categoryModels)) {
            if (typeof key === 'string' && typeof val === 'string') {
              validCategoryModels[key] = val;
            }
          }
          if (Object.keys(validCategoryModels).length > 0) {
            updatedProfile.categoryModels = validCategoryModels;
          } else {
            delete updatedProfile.categoryModels;
          }
        }
      }
      if (omoAgentModels !== undefined) {
        if (omoAgentModels === null) {
          delete updatedProfile.omoAgentModels;
        } else if (typeof omoAgentModels === 'object' && !Array.isArray(omoAgentModels)) {
          const validOmoAgentModels = {};
          for (const [key, val] of Object.entries(omoAgentModels)) {
            if (typeof key === 'string' && typeof val === 'string') {
              validOmoAgentModels[key] = val;
            }
          }
          if (Object.keys(validOmoAgentModels).length > 0) {
            updatedProfile.omoAgentModels = validOmoAgentModels;
          } else {
            delete updatedProfile.omoAgentModels;
          }
        }
      }
      updatedProfile.updatedAt = new Date().toISOString();

      const updatedProfiles = [...profiles];
      updatedProfiles[index] = updatedProfile;

      console.log(`[Server] Updating profile: ${updatedProfile.name} (${profileId})`);
      await persistSettings({ profiles: updatedProfiles });

      res.json({ success: true, profile: updatedProfile });
    } catch (error) {
      console.error('[Server] Failed to update profile:', error);
      res.status(500).json({ error: error.message || 'Failed to update profile' });
    }
  });

  app.delete('/api/config/profiles/:id', async (req, res) => {
    try {
      const settings = await readSettingsFromDiskMigrated();
      const profileId = req.params.id;
      const profiles = settings.profiles || [];
      const index = profiles.findIndex((p) => p.id === profileId);
      if (index === -1) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      const updatedProfiles = profiles.filter((p) => p.id !== profileId);
      console.log(`[Server] Deleting profile: ${profileId}`);
      await persistSettings({ profiles: updatedProfiles });

      res.json({ success: true });
    } catch (error) {
      console.error('[Server] Failed to delete profile:', error);
      res.status(500).json({ error: error.message || 'Failed to delete profile' });
    }
  });


  // ============================================================
  // oh-my-opencode Plugin Routes
  // ============================================================

  app.get('/api/config/oh-my-opencode', async (req, res) => {
    try {
      const installed = isOhMyOpencodeInstalled();
      if (!installed) {
        return res.json({ installed: false, categories: {}, agents: {} });
      }
      const config = readOhMyOpencodeConfig();
      res.json({
        installed: true,
        categories: config?.categories || {},
        agents: config?.agents || {},
      });
    } catch (error) {
      console.error('[Server] Failed to get oh-my-opencode config:', error);
      res.status(500).json({ error: error.message || 'Failed to get oh-my-opencode config' });
    }
  });

  app.post('/api/config/oh-my-opencode/categories', async (req, res) => {
    try {
      const installed = isOhMyOpencodeInstalled();
      if (!installed) {
        return res.status(400).json({ error: 'oh-my-opencode plugin is not installed' });
      }
      const { categories } = req.body;
      if (!categories || typeof categories !== 'object' || Array.isArray(categories)) {
        return res.status(400).json({ error: 'categories must be an object' });
      }
      writeOhMyOpencodeCategories(categories);
      await refreshOpenCodeAfterConfigChange('oh-my-opencode categories update');
      res.json({ success: true });
    } catch (error) {
      console.error('[Server] Failed to update oh-my-opencode categories:', error);
      res.status(500).json({ error: error.message || 'Failed to update oh-my-opencode categories' });
    }
  });

  app.post('/api/config/oh-my-opencode/agents', async (req, res) => {
    try {
      const installed = isOhMyOpencodeInstalled();
      if (!installed) {
        return res.status(400).json({ error: 'oh-my-opencode plugin is not installed' });
      }
      const { agents } = req.body;
      if (!agents || typeof agents !== 'object' || Array.isArray(agents)) {
        return res.status(400).json({ error: 'agents must be an object' });
      }
      writeOhMyOpencodeAgents(agents);
      await refreshOpenCodeAfterConfigChange('oh-my-opencode agents update');
      res.json({ success: true });
    } catch (error) {
      console.error('[Server] Failed to update oh-my-opencode agents:', error);
      res.status(500).json({ error: error.message || 'Failed to update oh-my-opencode agents' });
    }
  });

  // ============================================================
  // MCP Config Routes
  // ============================================================

  app.get('/api/config/mcp', async (req, res) => {
    try {
      const { directory, error } = await resolveOptionalProjectDirectory(req);
      if (error) {
        return res.status(400).json({ error });
      }
      const configs = listMcpConfigs(directory);
      res.json(configs);
    } catch (error) {
      console.error('[API:GET /api/config/mcp] Failed:', error);
      res.status(500).json({ error: error.message || 'Failed to list MCP configs' });
    }
  });

  app.get('/api/config/mcp/:name', async (req, res) => {
    try {
      const name = req.params.name;
      const { directory, error } = await resolveOptionalProjectDirectory(req);
      if (error) {
        return res.status(400).json({ error });
      }
      const config = getMcpConfig(name, directory);
      if (!config) {
        return res.status(404).json({ error: `MCP server "${name}" not found` });
      }
      res.json(config);
    } catch (error) {
      console.error('[API:GET /api/config/mcp/:name] Failed:', error);
      res.status(500).json({ error: error.message || 'Failed to get MCP config' });
    }
  });

  app.post('/api/config/mcp/:name', async (req, res) => {
    try {
      const name = req.params.name;
      const { scope, ...config } = req.body || {};
      const { directory, error } = await resolveOptionalProjectDirectory(req);
      if (error) {
        return res.status(400).json({ error });
      }
      console.log(`[API:POST /api/config/mcp] Creating MCP server: ${name}`);

      createMcpConfig(name, config, directory, scope);
      await refreshOpenCodeAfterConfigChange('mcp creation', { mcpName: name });

      res.json({
        success: true,
        requiresReload: true,
        message: `MCP server "${name}" created. Reloading interface…`,
        reloadDelayMs: CLIENT_RELOAD_DELAY_MS,
      });
    } catch (error) {
      console.error('[API:POST /api/config/mcp/:name] Failed:', error);
      res.status(500).json({ error: error.message || 'Failed to create MCP server' });
    }
  });

  app.patch('/api/config/mcp/:name', async (req, res) => {
    try {
      const name = req.params.name;
      const updates = req.body;
      const { directory, error } = await resolveOptionalProjectDirectory(req);
      if (error) {
        return res.status(400).json({ error });
      }
      console.log(`[API:PATCH /api/config/mcp] Updating MCP server: ${name}`);

      updateMcpConfig(name, updates, directory);
      await refreshOpenCodeAfterConfigChange('mcp update');

      res.json({
        success: true,
        requiresReload: true,
        message: `MCP server "${name}" updated. Reloading interface…`,
        reloadDelayMs: CLIENT_RELOAD_DELAY_MS,
      });
    } catch (error) {
      console.error('[API:PATCH /api/config/mcp/:name] Failed:', error);
      res.status(500).json({ error: error.message || 'Failed to update MCP server' });
    }
  });

  app.delete('/api/config/mcp/:name', async (req, res) => {
    try {
      const name = req.params.name;
      const { directory, error } = await resolveOptionalProjectDirectory(req);
      if (error) {
        return res.status(400).json({ error });
      }
      console.log(`[API:DELETE /api/config/mcp] Deleting MCP server: ${name}`);

      deleteMcpConfig(name, directory);
      await refreshOpenCodeAfterConfigChange('mcp deletion');

      res.json({
        success: true,
        requiresReload: true,
        message: `MCP server "${name}" deleted. Reloading interface…`,
        reloadDelayMs: CLIENT_RELOAD_DELAY_MS,
      });
    } catch (error) {
      console.error('[API:DELETE /api/config/mcp/:name] Failed:', error);
      res.status(500).json({ error: error.message || 'Failed to delete MCP server' });
    }
  });

  app.get('/api/config/commands/:name', async (req, res) => {
    try {
      const commandName = req.params.name;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }
      const sources = getCommandSources(commandName, directory);

      const scope = sources.md.exists
        ? sources.md.scope
        : (sources.json.exists ? sources.json.scope : null);

      res.json({
        name: commandName,
        sources: sources,
        scope,
        isBuiltIn: !sources.md.exists && !sources.json.exists
      });
    } catch (error) {
      console.error('Failed to get command sources:', error);
      res.status(500).json({ error: 'Failed to get command configuration metadata' });
    }
  });

  app.post('/api/config/commands/:name', async (req, res) => {
    try {
      const commandName = req.params.name;
      const { scope, ...config } = req.body;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }

      console.log('[Server] Creating command:', commandName);
      console.log('[Server] Config received:', JSON.stringify(config, null, 2));
      console.log('[Server] Scope:', scope, 'Working directory:', directory);

      createCommand(commandName, config, directory, scope);
      await refreshOpenCodeAfterConfigChange('command creation', {
        commandName
      });

      res.json({
        success: true,
        requiresReload: true,
        message: `Command ${commandName} created successfully. Reloading interface…`,
        reloadDelayMs: CLIENT_RELOAD_DELAY_MS,
      });
    } catch (error) {
      console.error('Failed to create command:', error);
      res.status(500).json({ error: error.message || 'Failed to create command' });
    }
  });

  app.patch('/api/config/commands/:name', async (req, res) => {
    try {
      const commandName = req.params.name;
      const updates = req.body;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }

      console.log(`[Server] Updating command: ${commandName}`);
      console.log('[Server] Updates:', JSON.stringify(updates, null, 2));
      console.log('[Server] Working directory:', directory);

      updateCommand(commandName, updates, directory);
      await refreshOpenCodeAfterConfigChange('command update');

      console.log(`[Server] Command ${commandName} updated successfully`);

      res.json({
        success: true,
        requiresReload: true,
        message: `Command ${commandName} updated successfully. Reloading interface…`,
        reloadDelayMs: CLIENT_RELOAD_DELAY_MS,
      });
    } catch (error) {
      console.error('[Server] Failed to update command:', error);
      console.error('[Server] Error stack:', error.stack);
      res.status(500).json({ error: error.message || 'Failed to update command' });
    }
  });

  app.delete('/api/config/commands/:name', async (req, res) => {
    try {
      const commandName = req.params.name;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }

      deleteCommand(commandName, directory);
      await refreshOpenCodeAfterConfigChange('command deletion');

      res.json({
        success: true,
        requiresReload: true,
        message: `Command ${commandName} deleted successfully. Reloading interface…`,
        reloadDelayMs: CLIENT_RELOAD_DELAY_MS,
      });
    } catch (error) {
      console.error('Failed to delete command:', error);
      res.status(500).json({ error: error.message || 'Failed to delete command' });
    }
  });

  // ============== SKILL ENDPOINTS ==============

  const {
    getSkillSources,
    discoverSkills,
    createSkill,
    updateSkill,
    deleteSkill,
    readSkillSupportingFile,
    writeSkillSupportingFile,
    deleteSkillSupportingFile,
    SKILL_SCOPE,
    SKILL_DIR,
  } = await import('./lib/opencode/index.js');

  const findWorktreeRootForSkills = (workingDirectory) => {
    if (!workingDirectory) return null;
    let current = path.resolve(workingDirectory);
    while (true) {
      if (fs.existsSync(path.join(current, '.git'))) {
        return current;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  };

  const getSkillProjectAncestors = (workingDirectory) => {
    if (!workingDirectory) return [];
    const result = [];
    let current = path.resolve(workingDirectory);
    const stop = findWorktreeRootForSkills(workingDirectory) || current;
    while (true) {
      result.push(current);
      if (current === stop) break;
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return result;
  };

  const isPathInside = (candidatePath, parentPath) => {
    if (!candidatePath || !parentPath) return false;
    const normalizedCandidate = path.resolve(candidatePath);
    const normalizedParent = path.resolve(parentPath);
    return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
  };

  const inferSkillScopeAndSourceFromPath = (skillPath, workingDirectory) => {
    const resolvedPath = typeof skillPath === 'string' ? path.resolve(skillPath) : '';
    const home = os.homedir();
    const source = resolvedPath.includes(`${path.sep}.agents${path.sep}skills${path.sep}`)
      ? 'agents'
      : resolvedPath.includes(`${path.sep}.claude${path.sep}skills${path.sep}`)
        ? 'claude'
        : 'opencode';

    const projectAncestors = getSkillProjectAncestors(workingDirectory);
    const isProjectScoped = projectAncestors.some((ancestor) => {
      const candidates = [
        path.join(ancestor, '.opencode'),
        path.join(ancestor, '.claude', 'skills'),
        path.join(ancestor, '.agents', 'skills'),
      ];
      return candidates.some((candidate) => isPathInside(resolvedPath, candidate));
    });

    if (isProjectScoped) {
      return { scope: SKILL_SCOPE.PROJECT, source };
    }

    const userRoots = [
      path.join(home, '.config', 'opencode'),
      path.join(home, '.opencode'),
      path.join(home, '.claude', 'skills'),
      path.join(home, '.agents', 'skills'),
      process.env.OPENCODE_CONFIG_DIR ? path.resolve(process.env.OPENCODE_CONFIG_DIR) : null,
    ].filter(Boolean);

    if (userRoots.some((root) => isPathInside(resolvedPath, root))) {
      return { scope: SKILL_SCOPE.USER, source };
    }

    return { scope: SKILL_SCOPE.USER, source };
  };

  const fetchOpenCodeDiscoveredSkills = async (workingDirectory) => {
    if (!openCodePort) {
      return null;
    }

    try {
      const url = new URL(buildOpenCodeUrl('/skill', ''));
      if (workingDirectory) {
        url.searchParams.set('directory', workingDirectory);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...getOpenCodeAuthHeaders(),
        },
        signal: AbortSignal.timeout(8_000),
      });

      if (!response.ok) {
        return null;
      }

      const payload = await response.json();
      if (!Array.isArray(payload)) {
        return null;
      }

      return payload
        .map((item) => {
          const name = typeof item?.name === 'string' ? item.name.trim() : '';
          const location = typeof item?.location === 'string' ? item.location : '';
          const description = typeof item?.description === 'string' ? item.description : '';
          if (!name || !location) {
            return null;
          }
          const inferred = inferSkillScopeAndSourceFromPath(location, workingDirectory);
          return {
            name,
            path: location,
            scope: inferred.scope,
            source: inferred.source,
            description,
          };
        })
        .filter(Boolean);
    } catch {
      return null;
    }
  };

  // List all discovered skills
  app.get('/api/config/skills', async (req, res) => {
    try {
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }
      const skills = (await fetchOpenCodeDiscoveredSkills(directory)) || discoverSkills(directory);

      // Enrich with full sources info
      const enrichedSkills = skills.map(skill => {
        const sources = getSkillSources(skill.name, directory, skill);
        return {
          ...skill,
          sources
        };
      });

      res.json({ skills: enrichedSkills });
    } catch (error) {
      console.error('Failed to list skills:', error);
      res.status(500).json({ error: 'Failed to list skills' });
    }
  });

  // ============== SKILLS CATALOG + INSTALL ENDPOINTS ==============

  const {
    getCuratedSkillsSources,
    getCacheKey,
    getCachedScan,
    setCachedScan,
    parseSkillRepoSource,
    scanSkillsRepository,
    installSkillsFromRepository,
    scanClawdHubPage,
    installSkillsFromClawdHub,
    isClawdHubSource,
  } = await import('./lib/skills-catalog/index.js');
  const { getProfiles, getProfile } = await import('./lib/git/index.js');

  const listGitIdentitiesForResponse = () => {
    try {
      const profiles = getProfiles();
      return profiles.map((p) => ({ id: p.id, name: p.name }));
    } catch {
      return [];
    }
  };

  const resolveGitIdentity = (profileId) => {
    if (!profileId) {
      return null;
    }
    try {
      const profile = getProfile(profileId);
      const sshKey = profile?.sshKey;
      if (typeof sshKey === 'string' && sshKey.trim()) {
        return { sshKey: sshKey.trim() };
      }
    } catch {
      // ignore
    }
    return null;
  };

  app.get('/api/config/skills/catalog', async (req, res) => {
    try {
      const { error } = await resolveOptionalProjectDirectory(req);
      if (error) {
        return res.status(400).json({ error });
      }

      const curatedSources = getCuratedSkillsSources();
      const settings = await readSettingsFromDisk();
      const customSourcesRaw = sanitizeSkillCatalogs(settings.skillCatalogs) || [];

      const customSources = customSourcesRaw.map((entry) => ({
        id: entry.id,
        label: entry.label,
        description: entry.source,
        source: entry.source,
        defaultSubpath: entry.subpath,
        gitIdentityId: entry.gitIdentityId,
      }));

      const sources = [...curatedSources, ...customSources];
      const sourcesForUi = sources.map(({ gitIdentityId, ...rest }) => rest);

      res.json({ ok: true, sources: sourcesForUi, itemsBySource: {}, pageInfoBySource: {} });
    } catch (error) {
      console.error('Failed to load skills catalog:', error);
      res.status(500).json({ ok: false, error: { kind: 'unknown', message: error.message || 'Failed to load catalog' } });
    }
  });

  app.get('/api/config/skills/catalog/source', async (req, res) => {
    try {
      const { directory, error } = await resolveOptionalProjectDirectory(req);
      if (error) {
        return res.status(400).json({ ok: false, error: { kind: 'invalidSource', message: error } });
      }

      const sourceId = typeof req.query.sourceId === 'string' ? req.query.sourceId : null;
      if (!sourceId) {
        return res.status(400).json({ ok: false, error: { kind: 'invalidSource', message: 'Missing sourceId' } });
      }

      const refresh = String(req.query.refresh || '').toLowerCase() === 'true';
      const cursor = typeof req.query.cursor === 'string' ? req.query.cursor : null;

      const curatedSources = getCuratedSkillsSources();
      const settings = await readSettingsFromDisk();
      const customSourcesRaw = sanitizeSkillCatalogs(settings.skillCatalogs) || [];

      const customSources = customSourcesRaw.map((entry) => ({
        id: entry.id,
        label: entry.label,
        description: entry.source,
        source: entry.source,
        defaultSubpath: entry.subpath,
        gitIdentityId: entry.gitIdentityId,
      }));

      const sources = [...curatedSources, ...customSources];
      const src = sources.find((entry) => entry.id === sourceId);

      if (!src) {
        return res.status(404).json({ ok: false, error: { kind: 'invalidSource', message: 'Unknown source' } });
      }

      const discovered = directory
        ? ((await fetchOpenCodeDiscoveredSkills(directory)) || discoverSkills(directory))
        : [];
      const installedByName = new Map(discovered.map((s) => [s.name, s]));

      if (src.sourceType === 'clawdhub' || isClawdHubSource(src.source)) {
        const scanned = await scanClawdHubPage({ cursor: cursor || null });
        if (!scanned.ok) {
          return res.status(500).json({ ok: false, error: scanned.error });
        }

        const items = (scanned.items || []).map((item) => {
          const installed = installedByName.get(item.skillName);
          return {
            ...item,
            sourceId: src.id,
            installed: installed
              ? { isInstalled: true, scope: installed.scope, source: installed.source }
              : { isInstalled: false },
          };
        });

        return res.json({ ok: true, items, nextCursor: scanned.nextCursor || null });
      }

      const parsed = parseSkillRepoSource(src.source);
      if (!parsed.ok) {
        return res.status(400).json({ ok: false, error: parsed.error });
      }

      const effectiveSubpath = src.defaultSubpath || parsed.effectiveSubpath || null;
      const cacheKey = getCacheKey({
        normalizedRepo: parsed.normalizedRepo,
        subpath: effectiveSubpath || '',
        identityId: src.gitIdentityId || '',
      });

      let scanResult = !refresh ? getCachedScan(cacheKey) : null;
      if (!scanResult) {
        const scanned = await scanSkillsRepository({
          source: src.source,
          subpath: src.defaultSubpath,
          defaultSubpath: src.defaultSubpath,
          identity: resolveGitIdentity(src.gitIdentityId),
        });

        if (!scanned.ok) {
          return res.status(500).json({ ok: false, error: scanned.error });
        }

        scanResult = scanned;
        setCachedScan(cacheKey, scanResult);
      }

      const items = (scanResult.items || []).map((item) => {
        const installed = installedByName.get(item.skillName);
        return {
          sourceId: src.id,
          ...item,
          gitIdentityId: src.gitIdentityId,
          installed: installed
            ? { isInstalled: true, scope: installed.scope, source: installed.source }
            : { isInstalled: false },
        };
      });

      return res.json({ ok: true, items });
    } catch (error) {
      console.error('Failed to load catalog source:', error);
      return res.status(500).json({
        ok: false,
        error: { kind: 'unknown', message: error.message || 'Failed to load catalog source' },
      });
    }
  });

  app.post('/api/config/skills/scan', async (req, res) => {
    try {
      const { source, subpath, gitIdentityId } = req.body || {};
      const identity = resolveGitIdentity(gitIdentityId);

      const result = await scanSkillsRepository({
        source,
        subpath,
        identity,
      });

      if (!result.ok) {
        if (result.error?.kind === 'authRequired') {
          return res.status(401).json({
            ok: false,
            error: {
              ...result.error,
              identities: listGitIdentitiesForResponse(),
            },
          });
        }

        return res.status(400).json({ ok: false, error: result.error });
      }

      res.json({ ok: true, items: result.items });
    } catch (error) {
      console.error('Failed to scan skills repository:', error);
      res.status(500).json({ ok: false, error: { kind: 'unknown', message: error.message || 'Failed to scan repository' } });
    }
  });

  app.post('/api/config/skills/install', async (req, res) => {
    try {
      const {
        source,
        subpath,
        gitIdentityId,
        scope,
        targetSource,
        selections,
        conflictPolicy,
        conflictDecisions,
      } = req.body || {};

      let workingDirectory = null;
      if (scope === 'project') {
        const resolved = await resolveProjectDirectory(req);
        if (!resolved.directory) {
          return res.status(400).json({
            ok: false,
            error: { kind: 'invalidSource', message: resolved.error || 'Project installs require a directory parameter' },
          });
        }
        workingDirectory = resolved.directory;
      }

      // Handle ClawdHub sources (ZIP download based)
      if (isClawdHubSource(source)) {
        const result = await installSkillsFromClawdHub({
          scope,
          targetSource,
          workingDirectory,
          userSkillDir: SKILL_DIR,
          selections,
          conflictPolicy,
          conflictDecisions,
        });

        if (!result.ok) {
          if (result.error?.kind === 'conflicts') {
            return res.status(409).json({ ok: false, error: result.error });
          }
          return res.status(400).json({ ok: false, error: result.error });
        }

        const installed = result.installed || [];
        const skipped = result.skipped || [];
        const requiresReload = installed.length > 0;

        if (requiresReload) {
          await refreshOpenCodeAfterConfigChange('skills install');
        }

        return res.json({
          ok: true,
          installed,
          skipped,
          requiresReload,
          message: requiresReload ? 'Skills installed successfully. Reloading interface…' : 'No skills were installed',
          reloadDelayMs: requiresReload ? CLIENT_RELOAD_DELAY_MS : undefined,
        });
      }

      // Handle GitHub sources (git clone based)
      const identity = resolveGitIdentity(gitIdentityId);

      const result = await installSkillsFromRepository({
        source,
        subpath,
        identity,
        scope,
        targetSource,
        workingDirectory,
        userSkillDir: SKILL_DIR,
        selections,
        conflictPolicy,
        conflictDecisions,
      });

      if (!result.ok) {
        if (result.error?.kind === 'conflicts') {
          return res.status(409).json({ ok: false, error: result.error });
        }

        if (result.error?.kind === 'authRequired') {
          return res.status(401).json({
            ok: false,
            error: {
              ...result.error,
              identities: listGitIdentitiesForResponse(),
            },
          });
        }

        return res.status(400).json({ ok: false, error: result.error });
      }

      const installed = result.installed || [];
      const skipped = result.skipped || [];
      const requiresReload = installed.length > 0;

      if (requiresReload) {
        await refreshOpenCodeAfterConfigChange('skills install');
      }

      res.json({
        ok: true,
        installed,
        skipped,
        requiresReload,
        message: requiresReload ? 'Skills installed successfully. Reloading interface…' : 'No skills were installed',
        reloadDelayMs: requiresReload ? CLIENT_RELOAD_DELAY_MS : undefined,
      });
    } catch (error) {
      console.error('Failed to install skills:', error);
      res.status(500).json({ ok: false, error: { kind: 'unknown', message: error.message || 'Failed to install skills' } });
    }
  });

  // Get single skill sources
  app.get('/api/config/skills/:name', async (req, res) => {
    try {
      const skillName = req.params.name;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }
      const discoveredSkill = ((await fetchOpenCodeDiscoveredSkills(directory)) || [])
        .find((skill) => skill.name === skillName) || null;
      const sources = getSkillSources(skillName, directory, discoveredSkill);

      res.json({
        name: skillName,
        sources: sources,
        scope: sources.md.scope,
        source: sources.md.source,
        exists: sources.md.exists
      });
    } catch (error) {
      console.error('Failed to get skill sources:', error);
      res.status(500).json({ error: 'Failed to get skill configuration metadata' });
    }
  });

  // Get skill supporting file content
  app.get('/api/config/skills/:name/files/*filePath', async (req, res) => {
    try {
      const skillName = req.params.name;
      const filePath = decodeURIComponent(req.params.filePath); // Decode URL-encoded path
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }

        const discoveredSkill = ((await fetchOpenCodeDiscoveredSkills(directory)) || [])
          .find((skill) => skill.name === skillName) || null;
        const sources = getSkillSources(skillName, directory, discoveredSkill);
      if (!sources.md.exists || !sources.md.dir) {
        return res.status(404).json({ error: 'Skill not found' });
      }

      const content = readSkillSupportingFile(sources.md.dir, filePath);
      if (content === null) {
        return res.status(404).json({ error: 'File not found' });
      }

      res.json({ path: filePath, content });
    } catch (error) {
      console.error('Failed to read skill file:', error);
      res.status(500).json({ error: 'Failed to read skill file' });
    }
  });

  // Create new skill
  app.post('/api/config/skills/:name', async (req, res) => {
    try {
      const skillName = req.params.name;
      const { scope, source: skillSource, ...config } = req.body;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }

      console.log('[Server] Creating skill:', skillName);
      console.log('[Server] Scope:', scope, 'Working directory:', directory);

      createSkill(skillName, { ...config, source: skillSource }, directory, scope);
      await refreshOpenCodeAfterConfigChange('skill creation');

      res.json({
        success: true,
        requiresReload: true,
        message: `Skill ${skillName} created successfully. Reloading interface…`,
        reloadDelayMs: CLIENT_RELOAD_DELAY_MS,
      });
    } catch (error) {
      console.error('Failed to create skill:', error);
      res.status(500).json({ error: error.message || 'Failed to create skill' });
    }
  });

  // Update existing skill
  app.patch('/api/config/skills/:name', async (req, res) => {
    try {
      const skillName = req.params.name;
      const updates = req.body;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }

      console.log(`[Server] Updating skill: ${skillName}`);
      console.log('[Server] Working directory:', directory);

      updateSkill(skillName, updates, directory);
      await refreshOpenCodeAfterConfigChange('skill update');

      res.json({
        success: true,
        requiresReload: true,
        message: `Skill ${skillName} updated successfully. Reloading interface…`,
        reloadDelayMs: CLIENT_RELOAD_DELAY_MS,
      });
    } catch (error) {
      console.error('[Server] Failed to update skill:', error);
      res.status(500).json({ error: error.message || 'Failed to update skill' });
    }
  });

  // Update/create supporting file
  app.put('/api/config/skills/:name/files/*filePath', async (req, res) => {
    try {
      const skillName = req.params.name;
      const filePath = decodeURIComponent(req.params.filePath); // Decode URL-encoded path
      const { content } = req.body;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }

      const discoveredSkill = ((await fetchOpenCodeDiscoveredSkills(directory)) || [])
        .find((skill) => skill.name === skillName) || null;
      const sources = getSkillSources(skillName, directory, discoveredSkill);
      if (!sources.md.exists || !sources.md.dir) {
        return res.status(404).json({ error: 'Skill not found' });
      }

      writeSkillSupportingFile(sources.md.dir, filePath, content || '');

      res.json({
        success: true,
        message: `File ${filePath} saved successfully`,
      });
    } catch (error) {
      console.error('Failed to write skill file:', error);
      res.status(500).json({ error: error.message || 'Failed to write skill file' });
    }
  });

  // Delete supporting file
  app.delete('/api/config/skills/:name/files/*filePath', async (req, res) => {
    try {
      const skillName = req.params.name;
      const filePath = decodeURIComponent(req.params.filePath); // Decode URL-encoded path
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }

      const discoveredSkill = ((await fetchOpenCodeDiscoveredSkills(directory)) || [])
        .find((skill) => skill.name === skillName) || null;
      const sources = getSkillSources(skillName, directory, discoveredSkill);
      if (!sources.md.exists || !sources.md.dir) {
        return res.status(404).json({ error: 'Skill not found' });
      }

      deleteSkillSupportingFile(sources.md.dir, filePath);

      res.json({
        success: true,
        message: `File ${filePath} deleted successfully`,
      });
    } catch (error) {
      console.error('Failed to delete skill file:', error);
      res.status(500).json({ error: error.message || 'Failed to delete skill file' });
    }
  });

  // Delete skill
  app.delete('/api/config/skills/:name', async (req, res) => {
    try {
      const skillName = req.params.name;
      const { directory, error } = await resolveProjectDirectory(req);
      if (!directory) {
        return res.status(400).json({ error });
      }

      deleteSkill(skillName, directory);
      await refreshOpenCodeAfterConfigChange('skill deletion');

      res.json({
        success: true,
        requiresReload: true,
        message: `Skill ${skillName} deleted successfully. Reloading interface…`,
        reloadDelayMs: CLIENT_RELOAD_DELAY_MS,
      });
    } catch (error) {
      console.error('Failed to delete skill:', error);
      res.status(500).json({ error: error.message || 'Failed to delete skill' });
    }
  });

  app.post('/api/config/reload', async (req, res) => {
    try {
      console.log('[Server] Manual configuration reload requested');

      await refreshOpenCodeAfterConfigChange('manual configuration reload');

      res.json({
        success: true,
        requiresReload: true,
        message: 'Configuration reloaded successfully. Refreshing interface…',
        reloadDelayMs: CLIENT_RELOAD_DELAY_MS,
      });
    } catch (error) {
      console.error('[Server] Failed to reload configuration:', error);
      res.status(500).json({
        error: error.message || 'Failed to reload configuration',
        success: false
      });
    }
  });

  let authLibrary = null;
  const getAuthLibrary = async () => {
    if (!authLibrary) {
      authLibrary = await import('./lib/opencode/auth.js');
    }
    return authLibrary;
  };

  let quotaProviders = null;
  const getQuotaProviders = async () => {
    if (!quotaProviders) {
      quotaProviders = await import('./lib/quota/index.js');
    }
    return quotaProviders;
  };

  // ================= GitHub OAuth (Device Flow) =================

  // Note: scopes may be overridden via OPENCHAMBER_GITHUB_SCOPES or settings.json (see lib/github/auth.js).

  let githubLibraries = null;
  const getGitHubLibraries = async () => {
    if (!githubLibraries) {
      githubLibraries = await import('./lib/github/index.js');
    }
    return githubLibraries;
  };

  const getGitHubUserSummary = async (octokit) => {
    const me = await octokit.rest.users.getAuthenticated();

    let email = typeof me.data.email === 'string' ? me.data.email : null;
    if (!email) {
      try {
        const emails = await octokit.rest.users.listEmailsForAuthenticatedUser({ per_page: 100 });
        const list = Array.isArray(emails?.data) ? emails.data : [];
        const primaryVerified = list.find((e) => e && e.primary && e.verified && typeof e.email === 'string');
        const anyVerified = list.find((e) => e && e.verified && typeof e.email === 'string');
        email = primaryVerified?.email || anyVerified?.email || null;
      } catch {
        // ignore (scope might be missing)
      }
    }

    return {
      login: me.data.login,
      id: me.data.id,
      avatarUrl: me.data.avatar_url,
      name: typeof me.data.name === 'string' ? me.data.name : null,
      email,
    };
  };

  app.get('/api/github/auth/status', async (_req, res) => {
    try {
      const { getGitHubAuth, getOctokitOrNull, clearGitHubAuth, getGitHubAuthAccounts } = await getGitHubLibraries();
      const auth = getGitHubAuth();
      const accounts = getGitHubAuthAccounts();
      if (!auth?.accessToken) {
        return res.json({ connected: false, accounts });
      }

      const octokit = getOctokitOrNull();
      if (!octokit) {
        return res.json({ connected: false, accounts });
      }

      let user = null;
      try {
        user = await getGitHubUserSummary(octokit);
      } catch (error) {
        if (error?.status === 401) {
          clearGitHubAuth();
          return res.json({ connected: false, accounts: getGitHubAuthAccounts() });
        }
      }

      const fallback = auth.user;
      const mergedUser = user || fallback;

      return res.json({
        connected: true,
        user: mergedUser,
        scope: auth.scope,
        accounts,
      });
    } catch (error) {
      console.error('Failed to get GitHub auth status:', error);
      return res.status(500).json({ error: error.message || 'Failed to get GitHub auth status' });
    }
  });

  app.post('/api/github/auth/start', async (_req, res) => {
    try {
      const { getGitHubClientId, getGitHubScopes, startDeviceFlow } = await getGitHubLibraries();
      const clientId = getGitHubClientId();
      if (!clientId) {
        return res.status(400).json({
          error: 'GitHub OAuth client not configured. Set OPENCHAMBER_GITHUB_CLIENT_ID.',
        });
      }

      const scope = getGitHubScopes();

      const payload = await startDeviceFlow({
        clientId,
        scope,
      });

      return res.json({
        deviceCode: payload.device_code,
        userCode: payload.user_code,
        verificationUri: payload.verification_uri,
        verificationUriComplete: payload.verification_uri_complete,
        expiresIn: payload.expires_in,
        interval: payload.interval,
        scope,
      });
    } catch (error) {
      console.error('Failed to start GitHub device flow:', error);
      return res.status(500).json({ error: error.message || 'Failed to start GitHub device flow' });
    }
  });

  app.post('/api/github/auth/complete', async (req, res) => {
    try {
      const { getGitHubClientId, exchangeDeviceCode, setGitHubAuth, getGitHubAuthAccounts } = await getGitHubLibraries();
      const clientId = getGitHubClientId();
      if (!clientId) {
        return res.status(400).json({
          error: 'GitHub OAuth client not configured. Set OPENCHAMBER_GITHUB_CLIENT_ID.',
        });
      }

      const deviceCode = typeof req.body?.deviceCode === 'string'
        ? req.body.deviceCode
        : (typeof req.body?.device_code === 'string' ? req.body.device_code : '');

      if (!deviceCode) {
        return res.status(400).json({ error: 'deviceCode is required' });
      }

      const payload = await exchangeDeviceCode({ clientId, deviceCode });

      if (payload?.error) {
        return res.json({
          connected: false,
          status: payload.error,
          error: payload.error_description || payload.error,
        });
      }

      const accessToken = payload?.access_token;
      if (!accessToken) {
        return res.status(500).json({ error: 'Missing access_token from GitHub' });
      }

      const { Octokit } = await import('@octokit/rest');
      const octokit = new Octokit({ auth: accessToken });
      const user = await getGitHubUserSummary(octokit);

      setGitHubAuth({
        accessToken,
        scope: typeof payload.scope === 'string' ? payload.scope : '',
        tokenType: typeof payload.token_type === 'string' ? payload.token_type : 'bearer',
        user,
      });

      return res.json({
        connected: true,
        user,
        scope: typeof payload.scope === 'string' ? payload.scope : '',
        accounts: getGitHubAuthAccounts(),
      });
    } catch (error) {
      console.error('Failed to complete GitHub device flow:', error);
      return res.status(500).json({ error: error.message || 'Failed to complete GitHub device flow' });
    }
  });

  app.post('/api/github/auth/activate', async (req, res) => {
    try {
      const { activateGitHubAuth, getGitHubAuth, getOctokitOrNull, clearGitHubAuth, getGitHubAuthAccounts } = await getGitHubLibraries();
      const accountId = typeof req.body?.accountId === 'string' ? req.body.accountId : '';
      if (!accountId) {
        return res.status(400).json({ error: 'accountId is required' });
      }
      const activated = activateGitHubAuth(accountId);
      if (!activated) {
        return res.status(404).json({ error: 'GitHub account not found' });
      }

      const auth = getGitHubAuth();
      const accounts = getGitHubAuthAccounts();
      if (!auth?.accessToken) {
        return res.json({ connected: false, accounts });
      }

      const octokit = getOctokitOrNull();
      if (!octokit) {
        return res.json({ connected: false, accounts });
      }

      let user = auth.user || null;
      try {
        user = await getGitHubUserSummary(octokit);
      } catch (error) {
        if (error?.status === 401) {
          clearGitHubAuth();
          return res.json({ connected: false, accounts: getGitHubAuthAccounts() });
        }
      }

      return res.json({
        connected: true,
        user,
        scope: auth.scope,
        accounts,
      });
    } catch (error) {
      console.error('Failed to activate GitHub account:', error);
      return res.status(500).json({ error: error.message || 'Failed to activate GitHub account' });
    }
  });

  app.delete('/api/github/auth', async (_req, res) => {
    try {
      const { clearGitHubAuth } = await getGitHubLibraries();
      const removed = clearGitHubAuth();
      return res.json({ success: true, removed });
    } catch (error) {
      console.error('Failed to disconnect GitHub:', error);
      return res.status(500).json({ error: error.message || 'Failed to disconnect GitHub' });
    }
  });

  app.post('/api/auth/device/start', async (req, res) => {
    try {
      prunePendingDeviceGrants();

      const requestedName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const requestedPlatform = normalizeDevicePlatform(req.body?.platform);
      const requestedVerificationOrigin = typeof req.body?.verification_origin === 'string'
        ? req.body.verification_origin.trim()
        : '';
      const requestedVerificationApiBaseUrl = typeof req.body?.verification_api_base_url === 'string'
        ? req.body.verification_api_base_url.trim()
        : '';
      const userAgent = typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : '';
      const now = Date.now();
      const deviceCode = crypto.randomBytes(DEVICE_CODE_BYTES).toString('base64url');
      const userCode = createUserCode();
      const userCodeNormalized = normalizeUserCode(userCode);
      const intervalSeconds = DEVICE_GRANT_DEFAULT_INTERVAL_SECONDS;
      const expiresAt = now + DEVICE_GRANT_TTL_MS;

      const origin = await resolveDeviceVerificationOrigin(req, {
        verificationOrigin: requestedVerificationOrigin,
        verificationApiBaseUrl: requestedVerificationApiBaseUrl,
      });
      const verificationPath = '/?settings=devices&devices=1';
      const verificationUri = origin ? `${origin}${verificationPath}` : verificationPath;
      const verificationUriComplete = `${verificationUri}${verificationUri.includes('?') ? '&' : '?'}user_code=${encodeURIComponent(userCode)}`;

      pendingDeviceGrantsByCode.set(deviceCode, {
        deviceCode,
        userCode,
        userCodeNormalized,
        createdAt: now,
        expiresAt,
        intervalSeconds,
        status: 'pending',
        requestedName: requestedName || null,
        requestedPlatform,
        requestedUa: userAgent,
        verificationUri,
        verificationUriComplete,
        nextPollAllowedAt: now,
        lastPollAt: 0,
      });
      pendingDeviceGrantCodeByUserCode.set(userCodeNormalized, deviceCode);

      return res.json({
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: verificationUri,
        verification_uri_complete: verificationUriComplete,
        expires_in: Math.floor((expiresAt - now) / 1000),
        interval: intervalSeconds,
      });
    } catch (error) {
      console.error('Failed to start device auth flow:', error);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.post('/api/auth/device/token', async (req, res) => {
    try {
      prunePendingDeviceGrants();

      const grantType = typeof req.body?.grant_type === 'string' ? req.body.grant_type.trim() : '';
      const deviceCode = typeof req.body?.device_code === 'string' ? req.body.device_code.trim() : '';

      if (!grantType || grantType !== 'urn:ietf:params:oauth:grant-type:device_code') {
        return res.status(400).json({ error: 'unsupported_grant_type' });
      }
      if (!deviceCode) {
        return res.status(400).json({ error: 'invalid_request' });
      }

      const grant = pendingDeviceGrantsByCode.get(deviceCode);
      if (!grant) {
        return res.status(400).json({ error: 'expired_token' });
      }

      const now = Date.now();
      if (grant.expiresAt <= now) {
        pendingDeviceGrantsByCode.delete(deviceCode);
        pendingDeviceGrantCodeByUserCode.delete(grant.userCodeNormalized);
        return res.status(400).json({ error: 'expired_token' });
      }

      if (grant.nextPollAllowedAt && now < grant.nextPollAllowedAt) {
        const nextIntervalSeconds = (grant.intervalSeconds || DEVICE_GRANT_DEFAULT_INTERVAL_SECONDS) + 5;
        grant.intervalSeconds = nextIntervalSeconds;
        grant.nextPollAllowedAt = now + (nextIntervalSeconds * 1000);
        pendingDeviceGrantsByCode.set(deviceCode, grant);
        return res.status(400).json({ error: 'slow_down' });
      }

      grant.lastPollAt = now;
      grant.nextPollAllowedAt = now + Math.max(DEVICE_POLL_MIN_INTERVAL_MS, (grant.intervalSeconds || DEVICE_GRANT_DEFAULT_INTERVAL_SECONDS) * 1000);

      if (grant.status === 'denied') {
        pendingDeviceGrantsByCode.delete(deviceCode);
        pendingDeviceGrantCodeByUserCode.delete(grant.userCodeNormalized);
        return res.status(400).json({ error: 'access_denied' });
      }

      if (grant.status !== 'approved' || !grant.approvedToken || !grant.approvedExpiresInSeconds) {
        pendingDeviceGrantsByCode.set(deviceCode, grant);
        return res.status(400).json({ error: 'authorization_pending' });
      }

      const accessToken = grant.approvedToken;
      const expiresIn = grant.approvedExpiresInSeconds;
      pendingDeviceGrantsByCode.delete(deviceCode);
      pendingDeviceGrantCodeByUserCode.delete(grant.userCodeNormalized);

      return res.json({
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: expiresIn,
      });
    } catch (error) {
      console.error('Failed to exchange device auth token:', error);
      return res.status(500).json({ error: 'server_error' });
    }
  });

  app.get('/api/auth/device/pairing-base', requireUiCookieAuth, async (req, res) => {
    try {
      const origin = await resolveDeviceVerificationOrigin(req);
      if (!origin) {
        return res.status(500).json({ ok: false, error: 'origin_unavailable' });
      }
      return res.json({
        ok: true,
        origin,
        api_base_url: `${origin}/api`,
      });
    } catch (error) {
      console.error('Failed to resolve pairing base URL:', error);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.get('/api/auth/devices', requireUiCookieAuth, async (_req, res) => {
    try {
      const devices = await readDeviceRecordsFromSettings();
      return res.json({
        devices: devices.map(toPublicDeviceRecord).filter(Boolean),
      });
    } catch (error) {
      console.error('Failed to list devices:', error);
      return res.status(500).json({ error: 'Failed to list devices' });
    }
  });

  app.get('/api/auth/devices/pending', requireUiCookieAuth, async (req, res) => {
    try {
      prunePendingDeviceGrants();

      const rawUserCode = typeof req.query?.user_code === 'string' ? req.query.user_code : '';
      const normalizedUserCode = normalizeUserCode(rawUserCode);
      if (!normalizedUserCode) {
        const pending = [];
        for (const grant of pendingDeviceGrantsByCode.values()) {
          if (!grant || typeof grant !== 'object') {
            continue;
          }
          if (grant.status !== 'pending') {
            continue;
          }
          pending.push({
            userCode: grant.userCode,
            requestedName: grant.requestedName || null,
            userAgent: typeof grant.requestedUa === 'string' ? grant.requestedUa : '',
            platform: resolveGrantPlatform(grant.requestedPlatform, grant.requestedUa),
            createdAt: Number.isFinite(grant.createdAt) ? Number(grant.createdAt) : Date.now(),
          });
        }

        pending.sort((a, b) => b.createdAt - a.createdAt);
        return res.json({ ok: true, pending });
      }

      const deviceCode = pendingDeviceGrantCodeByUserCode.get(normalizedUserCode);
      if (!deviceCode) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      const grant = pendingDeviceGrantsByCode.get(deviceCode);
      if (!grant) {
        pendingDeviceGrantCodeByUserCode.delete(normalizedUserCode);
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      const now = Date.now();
      if (grant.expiresAt <= now) {
        pendingDeviceGrantsByCode.delete(deviceCode);
        pendingDeviceGrantCodeByUserCode.delete(normalizedUserCode);
        return res.status(400).json({ ok: false, error: 'expired_token' });
      }

      return res.json({
        ok: true,
        pending: {
          userCode: grant.userCode,
          requestedName: grant.requestedName || null,
          userAgent: typeof grant.requestedUa === 'string' ? grant.requestedUa : '',
          platform: resolveGrantPlatform(grant.requestedPlatform, grant.requestedUa),
        },
      });
    } catch (error) {
      console.error('Failed to fetch pending device grant:', error);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/auth/devices/deny', requireUiCookieAuth, async (req, res) => {
    try {
      prunePendingDeviceGrants();

      const rawUserCode = typeof req.body?.user_code === 'string' ? req.body.user_code : '';
      const normalizedUserCode = normalizeUserCode(rawUserCode);
      if (!normalizedUserCode) {
        return res.status(400).json({ ok: false, error: 'invalid_code' });
      }

      const deviceCode = pendingDeviceGrantCodeByUserCode.get(normalizedUserCode);
      if (!deviceCode) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      const grant = pendingDeviceGrantsByCode.get(deviceCode);
      if (!grant) {
        pendingDeviceGrantCodeByUserCode.delete(normalizedUserCode);
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      if (grant.status === 'approved') {
        return res.status(409).json({ ok: false, error: 'already_approved' });
      }

      grant.status = 'denied';
      grant.nextPollAllowedAt = Date.now();
      pendingDeviceGrantsByCode.set(deviceCode, grant);

      return res.json({ ok: true });
    } catch (error) {
      console.error('Failed to deny device:', error);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.post('/api/auth/devices/approve', requireUiCookieAuth, async (req, res) => {
    try {
      prunePendingDeviceGrants();

      const rawUserCode = typeof req.body?.user_code === 'string' ? req.body.user_code : '';
      const normalizedUserCode = normalizeUserCode(rawUserCode);
      if (!normalizedUserCode) {
        return res.status(400).json({ ok: false, error: 'invalid_code' });
      }

      const deviceCode = pendingDeviceGrantCodeByUserCode.get(normalizedUserCode);
      if (!deviceCode) {
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      const grant = pendingDeviceGrantsByCode.get(deviceCode);
      if (!grant) {
        pendingDeviceGrantCodeByUserCode.delete(normalizedUserCode);
        return res.status(404).json({ ok: false, error: 'not_found' });
      }

      const now = Date.now();
      if (grant.expiresAt <= now) {
        pendingDeviceGrantsByCode.delete(deviceCode);
        pendingDeviceGrantCodeByUserCode.delete(normalizedUserCode);
        return res.status(400).json({ ok: false, error: 'expired_token' });
      }

      if (grant.status === 'approved') {
        return res.json({ ok: true });
      }

      const devices = await readDeviceRecordsFromSettings();
      const token = crypto.randomBytes(DEVICE_TOKEN_BYTES).toString('base64url');
      const tokenHash = hashDeviceToken(token);
      const expiresAt = now + normalizedDeviceTokenTtlMs;
      const expiresInSeconds = Math.floor((expiresAt - now) / 1000);

      const nameFromBody = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const deviceName = nameFromBody || grant.requestedName || 'Device';
      const userAgent = typeof grant.requestedUa === 'string' ? grant.requestedUa : '';
      const platform = resolveGrantPlatform(grant.requestedPlatform, userAgent);

      const record = {
        id: crypto.randomUUID(),
        name: deviceName,
        createdAt: now,
        lastUsedAt: null,
        expiresAt,
        userAgent,
        platform,
        tokenHash,
      };

      await writeDeviceRecordsToSettings([record, ...devices]);

      grant.status = 'approved';
      grant.approvedDeviceId = record.id;
      grant.approvedToken = token;
      grant.approvedExpiresInSeconds = expiresInSeconds;
      grant.nextPollAllowedAt = now;
      pendingDeviceGrantsByCode.set(deviceCode, grant);

      return res.json({ ok: true });
    } catch (error) {
      console.error('Failed to approve device:', error);
      return res.status(500).json({ ok: false, error: 'server_error' });
    }
  });

  app.patch('/api/auth/devices/:id', requireUiCookieAuth, async (req, res) => {
    try {
      const deviceId = typeof req.params?.id === 'string' ? req.params.id.trim() : '';
      const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      if (!deviceId || !name) {
        return res.status(400).json({ error: 'id and name are required' });
      }

      const devices = await readDeviceRecordsFromSettings();
      let found = false;
      const nextDevices = devices.map((entry) => {
        if (entry.id !== deviceId) {
          return entry;
        }
        found = true;
        return {
          ...entry,
          name,
        };
      });

      if (!found) {
        return res.status(404).json({ error: 'Device not found' });
      }

      await writeDeviceRecordsToSettings(nextDevices);
      const updated = nextDevices.find((entry) => entry.id === deviceId) || null;
      return res.json({
        ok: true,
        device: toPublicDeviceRecord(updated),
      });
    } catch (error) {
      console.error('Failed to update device:', error);
      return res.status(500).json({ error: 'Failed to update device' });
    }
  });

  app.delete('/api/auth/devices/:id', requireUiCookieAuth, async (req, res) => {
    try {
      const deviceId = typeof req.params?.id === 'string' ? req.params.id.trim() : '';
      if (!deviceId) {
        return res.status(400).json({ error: 'id is required' });
      }

      const devices = await readDeviceRecordsFromSettings();
      const nextDevices = devices.filter((entry) => entry.id !== deviceId);
      if (nextDevices.length === devices.length) {
        return res.status(404).json({ error: 'Device not found' });
      }

      await writeDeviceRecordsToSettings(nextDevices);
      deviceLastUsedTouchCache.delete(deviceId);
      return res.json({ ok: true });
    } catch (error) {
      console.error('Failed to revoke device:', error);
      return res.status(500).json({ error: 'Failed to revoke device' });
    }
  });

  app.get('/api/github/me', async (_req, res) => {
    try {
      const { getOctokitOrNull, clearGitHubAuth } = await getGitHubLibraries();
      const octokit = getOctokitOrNull();
      if (!octokit) {
        return res.status(401).json({ error: 'GitHub not connected' });
      }
      let user;
      try {
        user = await getGitHubUserSummary(octokit);
      } catch (error) {
        if (error?.status === 401) {
          clearGitHubAuth();
          return res.status(401).json({ error: 'GitHub token expired or revoked' });
        }
        throw error;
      }
      return res.json(user);
    } catch (error) {
      console.error('Failed to fetch GitHub user:', error);
      return res.status(500).json({ error: error.message || 'Failed to fetch GitHub user' });
    }
  });

  // ================= GitHub PR APIs =================

  app.get('/api/github/pr/status', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      const branch = typeof req.query?.branch === 'string' ? req.query.branch.trim() : '';
      const remote = typeof req.query?.remote === 'string' ? req.query.remote.trim() : 'origin';
      if (!directory || !branch) {
        return res.status(400).json({ error: 'directory and branch are required' });
      }

      const { getOctokitOrNull, getGitHubAuth } = await getGitHubLibraries();
      const octokit = getOctokitOrNull();
      if (!octokit) {
        return res.json({ connected: false });
      }

      const { resolveGitHubRepoFromDirectory } = await import('./lib/github/index.js');
      const { repo } = await resolveGitHubRepoFromDirectory(directory, remote);
      if (!repo) {
        return res.json({ connected: true, repo: null, branch, pr: null, checks: null, canMerge: false });
      }

       // Determine the head owner for PR search
       // Priority: 1) tracking branch remote, 2) origin (if different from target), 3) target repo owner
       let headOwnerForSearch = null;
       
       // First, check the branch's tracking info to see which remote it's on
       const { getStatus } = await import('./lib/git/index.js');
       const status = await getStatus(directory).catch(() => null);
       if (status?.tracking) {
         const trackingRemote = status.tracking.split('/')[0];
         if (trackingRemote && trackingRemote !== remote) {
           // Branch is tracked on a different remote - get that remote's owner
           const { repo: trackingRepo } = await resolveGitHubRepoFromDirectory(directory, trackingRemote);
           if (trackingRepo && trackingRepo.owner !== repo.owner) {
             headOwnerForSearch = trackingRepo.owner;
           }
         }
       }
       
       // Fallback: if targeting non-origin, check if origin has a different owner (fork scenario)
       if (!headOwnerForSearch && remote !== 'origin') {
         const { repo: originRepo } = await resolveGitHubRepoFromDirectory(directory, 'origin');
         if (originRepo && originRepo.owner !== repo.owner) {
           headOwnerForSearch = originRepo.owner;
         }
       }

       const listByHead = async (state, headOwner = repo.owner) => {
         const resp = await octokit.rest.pulls.list({
           owner: repo.owner,
           repo: repo.repo,
           state,
           head: `${headOwner}:${branch}`,
           per_page: 10,
         });
         return Array.isArray(resp?.data) ? resp.data[0] : null;
       };

       const listByHeadRef = async (state) => {
         const resp = await octokit.rest.pulls.list({
           owner: repo.owner,
           repo: repo.repo,
           state,
           per_page: 100,
         });
         const matches = Array.isArray(resp?.data)
           ? resp.data.filter((pr) => pr?.head?.ref === branch)
           : [];
         return matches[0] ?? null;
       };

       // PR status by branch:
       // - Prefer open PRs.
       // - If none, also surface closed/merged PRs.
       // - For cross-repo PRs: first try with head owner, then fall back to target owner, then ref match.
       let first = null;
       
       // For cross-repo workflows, try head owner first
       if (headOwnerForSearch) {
         first = await listByHead('open', headOwnerForSearch);
         if (!first) first = await listByHead('closed', headOwnerForSearch);
       }
       
       // Try with target repo owner (same-repo PRs)
       if (!first) first = await listByHead('open');
       if (!first) first = await listByHead('closed');
       
       // Fall back to matching head.ref directly (handles edge cases)
       if (!first) first = await listByHeadRef('open');
       if (!first) first = await listByHeadRef('closed');
      if (!first) {
        return res.json({ connected: true, repo, branch, pr: null, checks: null, canMerge: false });
      }

      // Enrich with mergeability fields
      const prFull = await octokit.rest.pulls.get({ owner: repo.owner, repo: repo.repo, pull_number: first.number });
      const prData = prFull?.data;
      if (!prData) {
        return res.json({ connected: true, repo, branch, pr: null, checks: null, canMerge: false });
      }

      // Checks summary: prefer check-runs (Actions), fallback to classic statuses.
      let checks = null;
      const sha = prData.head?.sha;
      if (sha) {
        try {
          const runs = await octokit.rest.checks.listForRef({
            owner: repo.owner,
            repo: repo.repo,
            ref: sha,
            per_page: 100,
          });
          const checkRuns = Array.isArray(runs?.data?.check_runs) ? runs.data.check_runs : [];
          if (checkRuns.length > 0) {
            const counts = { success: 0, failure: 0, pending: 0 };
            for (const run of checkRuns) {
              const status = run?.status;
              const conclusion = run?.conclusion;
              if (status === 'queued' || status === 'in_progress') {
                counts.pending += 1;
                continue;
              }
              if (!conclusion) {
                counts.pending += 1;
                continue;
              }
              if (conclusion === 'success' || conclusion === 'neutral' || conclusion === 'skipped') {
                counts.success += 1;
              } else {
                counts.failure += 1;
              }
            }
            const total = counts.success + counts.failure + counts.pending;
            const state = counts.failure > 0
              ? 'failure'
              : (counts.pending > 0 ? 'pending' : (total > 0 ? 'success' : 'unknown'));
            checks = { state, total, ...counts };
          }
        } catch {
          // ignore and fall back
        }

        if (!checks) {
          try {
            const combined = await octokit.rest.repos.getCombinedStatusForRef({
              owner: repo.owner,
              repo: repo.repo,
              ref: sha,
            });
            const statuses = Array.isArray(combined?.data?.statuses) ? combined.data.statuses : [];
            const counts = { success: 0, failure: 0, pending: 0 };
            statuses.forEach((s) => {
              if (s.state === 'success') counts.success += 1;
              else if (s.state === 'failure' || s.state === 'error') counts.failure += 1;
              else if (s.state === 'pending') counts.pending += 1;
            });
            const total = counts.success + counts.failure + counts.pending;
            const state = counts.failure > 0
              ? 'failure'
              : (counts.pending > 0 ? 'pending' : (total > 0 ? 'success' : 'unknown'));
            checks = { state, total, ...counts };
          } catch {
            checks = null;
          }
        }
      }

      // Permission check (best-effort)
      let canMerge = false;
      try {
        const auth = getGitHubAuth();
        const username = auth?.user?.login;
        if (username) {
          const perm = await octokit.rest.repos.getCollaboratorPermissionLevel({
            owner: repo.owner,
            repo: repo.repo,
            username,
          });
          const level = perm?.data?.permission;
          canMerge = level === 'admin' || level === 'maintain' || level === 'write';
        }
      } catch {
        canMerge = false;
      }

       const isMerged = Boolean(prData.merged || prData.merged_at);
       const mergedState = isMerged ? 'merged' : (prData.state === 'closed' ? 'closed' : 'open');

      return res.json({
        connected: true,
        repo,
        branch,
        pr: {
          number: prData.number,
          title: prData.title,
          body: prData.body || '',
          url: prData.html_url,
          state: mergedState,
          draft: Boolean(prData.draft),
          base: prData.base?.ref,
          head: prData.head?.ref,
          headSha: prData.head?.sha,
          mergeable: prData.mergeable,
          mergeableState: prData.mergeable_state,
        },
        checks,
        canMerge,
      });
    } catch (error) {
      if (error?.status === 401) {
        const { clearGitHubAuth } = await getGitHubLibraries();
        clearGitHubAuth();
        return res.json({ connected: false });
      }
      console.error('Failed to load GitHub PR status:', error);
      return res.status(500).json({ error: error.message || 'Failed to load GitHub PR status' });
    }
  });

  app.post('/api/github/pr/create', async (req, res) => {
    try {
      const directory = typeof req.body?.directory === 'string' ? req.body.directory.trim() : '';
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const head = typeof req.body?.head === 'string' ? req.body.head.trim() : '';
      const requestedBase = typeof req.body?.base === 'string' ? req.body.base.trim() : '';
      const body = typeof req.body?.body === 'string' ? req.body.body : undefined;
      const draft = typeof req.body?.draft === 'boolean' ? req.body.draft : undefined;
      // remote = target repo (where PR is created, e.g., 'upstream' for forks)
      const remote = typeof req.body?.remote === 'string' ? req.body.remote.trim() : 'origin';
      // headRemote = source repo (where head branch lives, e.g., 'origin' for forks)
      const headRemote = typeof req.body?.headRemote === 'string' ? req.body.headRemote.trim() : '';
      if (!directory || !title || !head || !requestedBase) {
        return res.status(400).json({ error: 'directory, title, head, base are required' });
      }

      const { getOctokitOrNull } = await getGitHubLibraries();
      const octokit = getOctokitOrNull();
      if (!octokit) {
        return res.status(401).json({ error: 'GitHub not connected' });
      }

      const { resolveGitHubRepoFromDirectory } = await import('./lib/github/index.js');
      const { repo } = await resolveGitHubRepoFromDirectory(directory, remote);
      if (!repo) {
        return res.status(400).json({ error: 'Unable to resolve GitHub repo from git remote' });
      }

      const normalizeBranchRef = (value, remoteNames = new Set()) => {
        if (!value) {
          return value;
        }
        let normalized = value.trim();
        if (normalized.startsWith('refs/heads/')) {
          normalized = normalized.substring('refs/heads/'.length);
        }
        if (normalized.startsWith('heads/')) {
          normalized = normalized.substring('heads/'.length);
        }
        if (normalized.startsWith('remotes/')) {
          normalized = normalized.substring('remotes/'.length);
        }

        const slashIndex = normalized.indexOf('/');
        if (slashIndex > 0) {
          const maybeRemote = normalized.slice(0, slashIndex);
          if (remoteNames.has(maybeRemote)) {
            const withoutRemotePrefix = normalized.slice(slashIndex + 1).trim();
            if (withoutRemotePrefix) {
              normalized = withoutRemotePrefix;
            }
          }
        }

        return normalized;
      };

      // Determine the source remote for the head branch
      // Priority: 1) explicit headRemote, 2) tracking branch remote, 3) 'origin' if targeting non-origin
      let sourceRemote = headRemote;
      const { getStatus, getRemotes } = await import('./lib/git/index.js');
      
      // If no explicit headRemote, check the branch's tracking info
      if (!sourceRemote) {
        const status = await getStatus(directory).catch(() => null);
        if (status?.tracking) {
          // tracking is like "gsxdsm/fix/multi-remote-branch-creation" or "origin/main"
          const trackingRemote = status.tracking.split('/')[0];
          if (trackingRemote) {
            sourceRemote = trackingRemote;
          }
        }
      }
      
      // Fallback: if targeting non-origin and no tracking info, try 'origin'
      if (!sourceRemote && remote !== 'origin') {
        sourceRemote = 'origin';
      }

      const remoteNames = new Set([remote]);
      const remotes = await getRemotes(directory).catch(() => []);
      for (const item of remotes) {
        if (item?.name) {
          remoteNames.add(item.name);
        }
      }
      if (sourceRemote) {
        remoteNames.add(sourceRemote);
      }

      const base = normalizeBranchRef(requestedBase, remoteNames);
      if (!base) {
        return res.status(400).json({ error: 'Invalid base branch name' });
      }

      // For fork workflows: we need to determine the correct head reference
      let headRef = head;
      
      if (sourceRemote && sourceRemote !== remote) {
        // The branch is on a different remote than the target - this is a cross-repo PR
        const { repo: headRepo } = await resolveGitHubRepoFromDirectory(directory, sourceRemote);
        if (headRepo) {
          // Always use owner:branch format for cross-repo PRs
          // GitHub API requires this when head is from a different repo/fork
          if (headRepo.owner !== repo.owner || headRepo.repo !== repo.repo) {
            headRef = `${headRepo.owner}:${head}`;
          }
        }
      }

      // For cross-repo PRs, verify the branch exists on the head repo first
      if (headRef.includes(':')) {
        const [headOwner] = headRef.split(':');
        const headRepoName = sourceRemote 
          ? (await resolveGitHubRepoFromDirectory(directory, sourceRemote)).repo?.repo 
          : repo.repo;
        
        if (headRepoName) {
          try {
            await octokit.rest.repos.getBranch({
              owner: headOwner,
              repo: headRepoName,
              branch: head,
            });
          } catch (branchError) {
            if (branchError?.status === 404) {
              return res.status(400).json({
                error: `Branch "${head}" not found on ${headOwner}/${headRepoName}. Please push your branch first: git push ${sourceRemote || 'origin'} ${head}`,
              });
            }
            // For other errors, continue - let the PR create attempt handle it
          }
        }
      }

      const created = await octokit.rest.pulls.create({
        owner: repo.owner,
        repo: repo.repo,
        title,
        head: headRef,
        base,
        ...(typeof body === 'string' ? { body } : {}),
        ...(typeof draft === 'boolean' ? { draft } : {}),
      });

      const pr = created?.data;
      if (!pr) {
        return res.status(500).json({ error: 'Failed to create PR' });
      }

      return res.json({
        number: pr.number,
        title: pr.title,
        body: pr.body || '',
        url: pr.html_url,
        state: pr.state === 'closed' ? 'closed' : 'open',
        draft: Boolean(pr.draft),
        base: pr.base?.ref,
        head: pr.head?.ref,
        headSha: pr.head?.sha,
        mergeable: pr.mergeable,
        mergeableState: pr.mergeable_state,
      });
    } catch (error) {
      console.error('Failed to create GitHub PR:', error);
      
      // Check for head validation error (common with fork PRs)
      const errorMessage = error.message || '';
      const isHeadValidationError = 
        errorMessage.includes('Validation Failed') && 
        errorMessage.includes('"field":"head"') &&
        errorMessage.includes('"code":"invalid"');
      
      if (isHeadValidationError) {
        return res.status(400).json({ 
          error: 'Unable to create PR: You must have write access to the source repository. Make sure you have pushed your branch to a repository you own (your fork), and that the branch exists on the remote.' 
        });
      }
      
      return res.status(500).json({ error: error.message || 'Failed to create GitHub PR' });
    }
  });

  app.post('/api/github/pr/update', async (req, res) => {
    try {
      const directory = typeof req.body?.directory === 'string' ? req.body.directory.trim() : '';
      const number = typeof req.body?.number === 'number' ? req.body.number : null;
      const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
      const body = typeof req.body?.body === 'string' ? req.body.body : undefined;
      if (!directory || !number || !title) {
        return res.status(400).json({ error: 'directory, number, title are required' });
      }

      const { getOctokitOrNull } = await getGitHubLibraries();
      const octokit = getOctokitOrNull();
      if (!octokit) {
        return res.status(401).json({ error: 'GitHub not connected' });
      }

      const { resolveGitHubRepoFromDirectory } = await import('./lib/github/index.js');
      const { repo } = await resolveGitHubRepoFromDirectory(directory);
      if (!repo) {
        return res.status(400).json({ error: 'Unable to resolve GitHub repo from git remote' });
      }

      let updated;
      try {
        updated = await octokit.rest.pulls.update({
          owner: repo.owner,
          repo: repo.repo,
          pull_number: number,
          title,
          ...(typeof body === 'string' ? { body } : {}),
        });
      } catch (error) {
        if (error?.status === 401) {
          return res.status(401).json({ error: 'GitHub not connected' });
        }
        if (error?.status === 403) {
          return res.status(403).json({ error: 'Not authorized to edit this PR' });
        }
        if (error?.status === 404) {
          return res.status(404).json({ error: 'PR not found in this repository' });
        }
        if (error?.status === 422) {
          const apiMessage = error?.response?.data?.message;
          const firstError = Array.isArray(error?.response?.data?.errors) && error.response.data.errors.length > 0
            ? (error.response.data.errors[0]?.message || error.response.data.errors[0]?.code)
            : null;
          const message = [apiMessage, firstError].filter(Boolean).join(' · ') || 'Invalid PR update payload';
          return res.status(422).json({ error: message });
        }
        throw error;
      }

      const pr = updated?.data;
      if (!pr) {
        return res.status(500).json({ error: 'Failed to update PR' });
      }

      return res.json({
        number: pr.number,
        title: pr.title,
        body: pr.body || '',
        url: pr.html_url,
        state: pr.merged_at ? 'merged' : (pr.state === 'closed' ? 'closed' : 'open'),
        draft: Boolean(pr.draft),
        base: pr.base?.ref,
        head: pr.head?.ref,
        headSha: pr.head?.sha,
        mergeable: pr.mergeable,
        mergeableState: pr.mergeable_state,
      });
    } catch (error) {
      console.error('Failed to update GitHub PR:', error);
      return res.status(500).json({ error: error.message || 'Failed to update GitHub PR' });
    }
  });

  app.post('/api/github/pr/merge', async (req, res) => {
    try {
      const directory = typeof req.body?.directory === 'string' ? req.body.directory.trim() : '';
      const number = typeof req.body?.number === 'number' ? req.body.number : null;
      const method = typeof req.body?.method === 'string' ? req.body.method : 'merge';
      if (!directory || !number) {
        return res.status(400).json({ error: 'directory and number are required' });
      }

      const { getOctokitOrNull } = await getGitHubLibraries();
      const octokit = getOctokitOrNull();
      if (!octokit) {
        return res.status(401).json({ error: 'GitHub not connected' });
      }

      const { resolveGitHubRepoFromDirectory } = await import('./lib/github/index.js');
      const { repo } = await resolveGitHubRepoFromDirectory(directory);
      if (!repo) {
        return res.status(400).json({ error: 'Unable to resolve GitHub repo from git remote' });
      }

      try {
        const result = await octokit.rest.pulls.merge({
          owner: repo.owner,
          repo: repo.repo,
          pull_number: number,
          merge_method: method,
        });
        return res.json({ merged: Boolean(result?.data?.merged), message: result?.data?.message });
      } catch (error) {
        if (error?.status === 403) {
          return res.status(403).json({ error: 'Not authorized to merge this PR' });
        }
        if (error?.status === 405 || error?.status === 409) {
          return res.json({ merged: false, message: error?.message || 'PR not mergeable' });
        }
        throw error;
      }
    } catch (error) {
      console.error('Failed to merge GitHub PR:', error);
      return res.status(500).json({ error: error.message || 'Failed to merge GitHub PR' });
    }
  });

  app.post('/api/github/pr/ready', async (req, res) => {
    try {
      const directory = typeof req.body?.directory === 'string' ? req.body.directory.trim() : '';
      const number = typeof req.body?.number === 'number' ? req.body.number : null;
      if (!directory || !number) {
        return res.status(400).json({ error: 'directory and number are required' });
      }

      const { getOctokitOrNull } = await getGitHubLibraries();
      const octokit = getOctokitOrNull();
      if (!octokit) {
        return res.status(401).json({ error: 'GitHub not connected' });
      }

      const { resolveGitHubRepoFromDirectory } = await import('./lib/github/index.js');
      const { repo } = await resolveGitHubRepoFromDirectory(directory);
      if (!repo) {
        return res.status(400).json({ error: 'Unable to resolve GitHub repo from git remote' });
      }

      const pr = await octokit.rest.pulls.get({ owner: repo.owner, repo: repo.repo, pull_number: number });
      const nodeId = pr?.data?.node_id;
      if (!nodeId) {
        return res.status(500).json({ error: 'Failed to resolve PR node id' });
      }

      if (pr?.data?.draft === false) {
        return res.json({ ready: true });
      }

      try {
        await octokit.graphql(
          `mutation($pullRequestId: ID!) {\n  markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {\n    pullRequest {\n      id\n      isDraft\n    }\n  }\n}`,
          { pullRequestId: nodeId }
        );
      } catch (error) {
        if (error?.status === 403) {
          return res.status(403).json({ error: 'Not authorized to mark PR ready' });
        }
        throw error;
      }

      return res.json({ ready: true });
    } catch (error) {
      console.error('Failed to mark PR ready:', error);
      return res.status(500).json({ error: error.message || 'Failed to mark PR ready' });
    }
  });

  // ================= GitHub Issue APIs =================

  app.get('/api/github/issues/list', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      const page = typeof req.query?.page === 'string' ? Number(req.query.page) : 1;
      if (!directory) {
        return res.status(400).json({ error: 'directory is required' });
      }

      const { getOctokitOrNull } = await getGitHubLibraries();
      const octokit = getOctokitOrNull();
      if (!octokit) {
        return res.json({ connected: false });
      }

      const { resolveGitHubRepoFromDirectory } = await import('./lib/github/index.js');
      const { repo } = await resolveGitHubRepoFromDirectory(directory);
      if (!repo) {
        return res.json({ connected: true, repo: null, issues: [] });
      }

      const list = await octokit.rest.issues.listForRepo({
        owner: repo.owner,
        repo: repo.repo,
        state: 'open',
        per_page: 50,
        page: Number.isFinite(page) && page > 0 ? page : 1,
      });
      const link = typeof list?.headers?.link === 'string' ? list.headers.link : '';
      const hasMore = /rel="next"/.test(link);
      const issues = (Array.isArray(list?.data) ? list.data : [])
        .filter((item) => !item?.pull_request)
        .map((item) => ({
          number: item.number,
          title: item.title,
          url: item.html_url,
          state: item.state === 'closed' ? 'closed' : 'open',
          author: item.user ? { login: item.user.login, id: item.user.id, avatarUrl: item.user.avatar_url } : null,
          labels: Array.isArray(item.labels)
            ? item.labels
                .map((label) => {
                  if (typeof label === 'string') return null;
                  const name = typeof label?.name === 'string' ? label.name : '';
                  if (!name) return null;
                  return { name, color: typeof label?.color === 'string' ? label.color : undefined };
                })
                .filter(Boolean)
            : [],
        }));

      return res.json({ connected: true, repo, issues, page: Number.isFinite(page) && page > 0 ? page : 1, hasMore });
    } catch (error) {
      console.error('Failed to list GitHub issues:', error);
      return res.status(500).json({ error: error.message || 'Failed to list GitHub issues' });
    }
  });

  app.get('/api/github/issues/get', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      const number = typeof req.query?.number === 'string' ? Number(req.query.number) : null;
      if (!directory || !number) {
        return res.status(400).json({ error: 'directory and number are required' });
      }

      const { getOctokitOrNull } = await getGitHubLibraries();
      const octokit = getOctokitOrNull();
      if (!octokit) {
        return res.json({ connected: false });
      }

      const { resolveGitHubRepoFromDirectory } = await import('./lib/github/index.js');
      const { repo } = await resolveGitHubRepoFromDirectory(directory);
      if (!repo) {
        return res.json({ connected: true, repo: null, issue: null });
      }

      const result = await octokit.rest.issues.get({ owner: repo.owner, repo: repo.repo, issue_number: number });
      const issue = result?.data;
      if (!issue || issue.pull_request) {
        return res.status(400).json({ error: 'Not a GitHub issue' });
      }

      return res.json({
        connected: true,
        repo,
        issue: {
          number: issue.number,
          title: issue.title,
          url: issue.html_url,
          state: issue.state === 'closed' ? 'closed' : 'open',
          body: issue.body || '',
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          author: issue.user ? { login: issue.user.login, id: issue.user.id, avatarUrl: issue.user.avatar_url } : null,
          assignees: Array.isArray(issue.assignees)
            ? issue.assignees
                .map((u) => (u ? { login: u.login, id: u.id, avatarUrl: u.avatar_url } : null))
                .filter(Boolean)
            : [],
          labels: Array.isArray(issue.labels)
            ? issue.labels
                .map((label) => {
                  if (typeof label === 'string') return null;
                  const name = typeof label?.name === 'string' ? label.name : '';
                  if (!name) return null;
                  return { name, color: typeof label?.color === 'string' ? label.color : undefined };
                })
                .filter(Boolean)
            : [],
        },
      });
    } catch (error) {
      console.error('Failed to fetch GitHub issue:', error);
      return res.status(500).json({ error: error.message || 'Failed to fetch GitHub issue' });
    }
  });

  app.get('/api/github/issues/comments', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      const number = typeof req.query?.number === 'string' ? Number(req.query.number) : null;
      if (!directory || !number) {
        return res.status(400).json({ error: 'directory and number are required' });
      }

      const { getOctokitOrNull } = await getGitHubLibraries();
      const octokit = getOctokitOrNull();
      if (!octokit) {
        return res.json({ connected: false });
      }

      const { resolveGitHubRepoFromDirectory } = await import('./lib/github/index.js');
      const { repo } = await resolveGitHubRepoFromDirectory(directory);
      if (!repo) {
        return res.json({ connected: true, repo: null, comments: [] });
      }

      const result = await octokit.rest.issues.listComments({
        owner: repo.owner,
        repo: repo.repo,
        issue_number: number,
        per_page: 100,
      });
      const comments = (Array.isArray(result?.data) ? result.data : [])
        .map((comment) => ({
          id: comment.id,
          url: comment.html_url,
          body: comment.body || '',
          createdAt: comment.created_at,
          updatedAt: comment.updated_at,
          author: comment.user ? { login: comment.user.login, id: comment.user.id, avatarUrl: comment.user.avatar_url } : null,
        }));

      return res.json({ connected: true, repo, comments });
    } catch (error) {
      console.error('Failed to fetch GitHub issue comments:', error);
      return res.status(500).json({ error: error.message || 'Failed to fetch GitHub issue comments' });
    }
  });

  // ================= GitHub Pull Request Context APIs =================

  app.get('/api/github/pulls/list', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      const page = typeof req.query?.page === 'string' ? Number(req.query.page) : 1;
      if (!directory) {
        return res.status(400).json({ error: 'directory is required' });
      }

      const { getOctokitOrNull } = await getGitHubLibraries();
      const octokit = getOctokitOrNull();
      if (!octokit) {
        return res.json({ connected: false });
      }

      const { resolveGitHubRepoFromDirectory } = await import('./lib/github/index.js');
      const { repo } = await resolveGitHubRepoFromDirectory(directory);
      if (!repo) {
        return res.json({ connected: true, repo: null, prs: [] });
      }

      const list = await octokit.rest.pulls.list({
        owner: repo.owner,
        repo: repo.repo,
        state: 'open',
        per_page: 50,
        page: Number.isFinite(page) && page > 0 ? page : 1,
      });

      const link = typeof list?.headers?.link === 'string' ? list.headers.link : '';
      const hasMore = /rel="next"/.test(link);

      const prs = (Array.isArray(list?.data) ? list.data : []).map((pr) => {
        const mergedState = pr.merged_at ? 'merged' : (pr.state === 'closed' ? 'closed' : 'open');
        const headRepo = pr.head?.repo
          ? {
              owner: pr.head.repo.owner?.login,
              repo: pr.head.repo.name,
              url: pr.head.repo.html_url,
              cloneUrl: pr.head.repo.clone_url,
              sshUrl: pr.head.repo.ssh_url,
            }
          : null;
        return {
          number: pr.number,
          title: pr.title,
          url: pr.html_url,
          state: mergedState,
          draft: Boolean(pr.draft),
          base: pr.base?.ref,
          head: pr.head?.ref,
          headSha: pr.head?.sha,
          mergeable: pr.mergeable,
          mergeableState: pr.mergeable_state,
          author: pr.user ? { login: pr.user.login, id: pr.user.id, avatarUrl: pr.user.avatar_url } : null,
          headLabel: pr.head?.label,
          headRepo: headRepo && headRepo.owner && headRepo.repo && headRepo.url
            ? headRepo
            : null,
        };
      });

      return res.json({ connected: true, repo, prs, page: Number.isFinite(page) && page > 0 ? page : 1, hasMore });
    } catch (error) {
      if (error?.status === 401) {
        const { clearGitHubAuth } = await getGitHubLibraries();
        clearGitHubAuth();
        return res.json({ connected: false });
      }
      console.error('Failed to list GitHub PRs:', error);
      return res.status(500).json({ error: error.message || 'Failed to list GitHub PRs' });
    }
  });

  app.get('/api/github/pulls/context', async (req, res) => {
    try {
      const directory = typeof req.query?.directory === 'string' ? req.query.directory.trim() : '';
      const number = typeof req.query?.number === 'string' ? Number(req.query.number) : null;
      const includeDiff = req.query?.diff === '1' || req.query?.diff === 'true';
      const includeCheckDetails = req.query?.checkDetails === '1' || req.query?.checkDetails === 'true';
      if (!directory || !number) {
        return res.status(400).json({ error: 'directory and number are required' });
      }

      const { getOctokitOrNull } = await getGitHubLibraries();
      const octokit = getOctokitOrNull();
      if (!octokit) {
        return res.json({ connected: false });
      }

      const { resolveGitHubRepoFromDirectory } = await import('./lib/github/index.js');
      const { repo } = await resolveGitHubRepoFromDirectory(directory);
      if (!repo) {
        return res.json({ connected: true, repo: null, pr: null });
      }

      const prResp = await octokit.rest.pulls.get({ owner: repo.owner, repo: repo.repo, pull_number: number });
      const prData = prResp?.data;
      if (!prData) {
        return res.status(404).json({ error: 'PR not found' });
      }

      const headRepo = prData.head?.repo
        ? {
            owner: prData.head.repo.owner?.login,
            repo: prData.head.repo.name,
            url: prData.head.repo.html_url,
            cloneUrl: prData.head.repo.clone_url,
            sshUrl: prData.head.repo.ssh_url,
          }
        : null;
      return {
        openCodePort,
        openCodeRunning: Boolean(openCodePort && isOpenCodeReady && !isRestartingOpenCode),
        openCodeSecureConnection: isOpenCodeConnectionSecure(),
        openCodeAuthSource: openCodeAuthSource || null,
        openCodeApiPrefix: '',
        openCodeApiPrefixDetected: true,
        isOpenCodeReady,
        lastOpenCodeError,
        lastOpenCodeLaunchDiagnostics,
        opencodeBinaryResolved: resolvedOpencodeBinary || null,
        opencodeBinarySource: resolvedOpencodeBinarySource || null,
        opencodeLaunchBinary: launchSpec?.binary || null,
        opencodeLaunchArgs: launchSpec?.args || [],
        opencodeLaunchWrapperType: launchSpec?.wrapperType || null,
        opencodeViaWsl: useWslForOpencode,
        opencodeWslBinary: resolvedWslBinary || null,
        opencodeWslPath: resolvedWslOpencodePath || null,
        opencodeWslDistro: resolvedWslDistro || null,
        nodeBinaryResolved: resolvedNodeBinary || null,
        bunBinaryResolved: resolvedBunBinary || null,
        desktopNotifyEnabled: ENV_DESKTOP_NOTIFY,
        planModeExperimentalEnabled: PLAN_MODE_EXPERIMENT_ENABLED,
      };
    },
    verboseRequestLogs: OPENCHAMBER_VERBOSE_REQUEST_LOGS,
    uiPassword,
    tunnelAuthController,
    readSettingsFromDiskMigrated,
    normalizeTunnelSessionTtlMs,
    resolveZenModel,
    sayTTSCapability,
    ensurePushInitialized,
    ensureGlobalWatcherStarted,
    getOrCreateVapidKeys,
    getUiSessionTokenFromRequest,
    writeSettingsToDisk,
    addOrUpdatePushSubscription,
    removePushSubscription,
    updateUiVisibility,
    isUiVisible,
    getUiNotificationClients: () => uiNotificationClients,
    writeSseEvent,
    sessionRuntime,
    setPushInitialized,
    fs,
    os,
    path,
    server,
    __dirname,
    openchamberDataDir: OPENCHAMBER_DATA_DIR,
    modelsDevApiUrl: MODELS_DEV_API_URL,
    modelsMetadataCacheTtl: MODELS_METADATA_CACHE_TTL,
    fetchFreeZenModels,
    getCachedZenModels,
    setAutoAcceptSession,
  });
  uiAuthController = bootstrapResult.uiAuthController;

  const tunnelRuntimeContext = tunnelWiringRuntime.initialize(app, port);
  const { tunnelService, startTunnelWithNormalizedRequest } = tunnelRuntimeContext;

  await featureRoutesRuntime.registerRoutes(app, {
    crypto,
    fs,
    os,
    path,
    fsPromises,
    spawn,
    resolveGitBinaryForSpawn,
    createFsSearchRuntime: createFsSearchRuntimeFactory,
    openchamberDataDir: OPENCHAMBER_DATA_DIR,
    openchamberUserConfigRoot: OPENCHAMBER_USER_CONFIG_ROOT,
    normalizeDirectoryPath,
    resolveProjectDirectory,
    resolveOptionalProjectDirectory,
    validateDirectoryPath,
    readCustomThemesFromDisk,
    refreshOpenCodeAfterConfigChange,
    getOpenCodeResolutionSnapshot,
    formatSettingsResponse,
    readSettingsFromDisk,
    readSettingsFromDiskMigrated,
    persistSettings,
    sanitizeProjects,
    sanitizeSkillCatalogs,
    isUnsafeSkillRelativePath,
    buildOpenCodeUrl,
    getOpenCodeAuthHeaders,
    getOpenCodePort: () => openCodePort,
    buildAugmentedPath,
    projectConfigRuntime,
    scheduledTasksRuntime,
    getOpenChamberEventClients: () => uiOpenChamberEventClients,
    writeSseEvent,
  });

  const previewProxyRuntime = createPreviewProxyRuntime({
    crypto,
    URL,
    createProxyMiddleware,
    responseInterceptor,
  });
  previewProxyRuntime.attach(app, {
    server,
    express,
    uiAuthController,
    isRequestOriginAllowed,
    rejectWebSocketUpgrade,
  });

  server.on('upgrade', (req, socket, head) => {
    const pathname = parseRequestPathname(req.url);
    if (pathname !== TERMINAL_INPUT_WS_PATH) {
      return;
    }

    const handleUpgrade = async () => {
      try {
        const requestScope = tunnelAuthController.classifyRequestScope(req);
        if (requestScope === 'tunnel' || requestScope === 'unknown-public') {
          const tunnelSession = tunnelAuthController.getTunnelSessionFromRequest(req);
          if (!tunnelSession) {
            rejectWebSocketUpgrade(socket, 401, 'Tunnel authentication required');
            return;
          }
        }

        const authenticatedDevice = await authenticateBearerDevice(req);
        if (authenticatedDevice) {
          req.openchamberDevice = authenticatedDevice;
        }

        if (uiAuthController?.enabled) {
          if (!authenticatedDevice) {
            const sessionToken = uiAuthController?.ensureSessionToken?.(req, null);
            if (!sessionToken) {
              rejectWebSocketUpgrade(socket, 401, 'UI authentication required');
              return;
            }

            const originAllowed = await isRequestOriginAllowed(req);
            if (!originAllowed) {
              rejectWebSocketUpgrade(socket, 403, 'Invalid origin');
              return;
            }
          }
        }

        if (!terminalInputWsServer) {
          rejectWebSocketUpgrade(socket, 500, 'Terminal WebSocket unavailable');
          return;
        }

        terminalInputWsServer.handleUpgrade(req, socket, head, (ws) => {
          terminalInputWsServer.emit('connection', ws, req);
        });
      } catch {
        rejectWebSocketUpgrade(socket, 500, 'Upgrade failed');
      }
    };

    void handleUpgrade();
  });

  setInterval(() => {
    const now = Date.now();
    for (const [sessionId, session] of terminalSessions.entries()) {
      if (now - session.lastActivity > TERMINAL_IDLE_TIMEOUT) {
        console.log(`Cleaning up idle terminal session: ${sessionId}`);
        try {
          session.ptyProcess.kill();
        } catch (error) {

        }
        terminalSessions.delete(sessionId);
      }
    }
  }, 5 * 60 * 1000);

  app.post('/api/terminal/create', async (req, res) => {
    try {
      if (terminalSessions.size >= MAX_TERMINAL_SESSIONS) {
        return res.status(429).json({ error: 'Maximum terminal sessions reached' });
      }

      const { cwd, cols, rows } = req.body;
      if (!cwd) {
        return res.status(400).json({ error: 'cwd is required' });
      }

      try {
        await fs.promises.access(cwd);
      } catch {
        return res.status(400).json({ error: 'Invalid working directory' });
      }

      const sessionId = Math.random().toString(36).substring(2, 15) +
                        Math.random().toString(36).substring(2, 15);

      const envPath = buildAugmentedPath();
      const resolvedEnv = sanitizeTerminalEnv({ ...process.env, PATH: envPath });

      const pty = await getPtyProvider();
      const { ptyProcess, shell } = spawnTerminalPtyWithFallback(pty, {
        cols,
        rows,
        cwd,
        env: resolvedEnv,
      });

      const session = {
        ptyProcess,
        ptyBackend: pty.backend,
        cwd,
        lastActivity: Date.now(),
        clients: new Set(),
      };

      terminalSessions.set(sessionId, session);

      ptyProcess.onExit(({ exitCode, signal }) => {
        console.log(`Terminal session ${sessionId} exited with code ${exitCode}, signal ${signal}`);
        terminalSessions.delete(sessionId);
      });

      console.log(`Created terminal session: ${sessionId} in ${cwd} using shell ${shell}`);
      res.json({ sessionId, cols: cols || 80, rows: rows || 24, capabilities: terminalInputCapabilities });
    } catch (error) {
      console.error('Failed to create terminal session:', error);
      res.status(500).json({ error: error.message || 'Failed to create terminal session' });
    }
  });

  app.get('/api/terminal/:sessionId/stream', (req, res) => {
    const { sessionId } = req.params;
    const session = terminalSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Terminal session not found' });
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const clientId = Math.random().toString(36).substring(7);
    session.clients.add(clientId);
    session.lastActivity = Date.now();

    const runtime = typeof globalThis.Bun === 'undefined' ? 'node' : 'bun';
    const ptyBackend = session.ptyBackend || 'unknown';
    res.write(`data: ${JSON.stringify({ type: 'connected', runtime, ptyBackend })}\n\n`);

    const heartbeatInterval = setInterval(() => {
      try {

        res.write(': heartbeat\n\n');
      } catch (error) {
        console.error(`Heartbeat failed for client ${clientId}:`, error);
        clearInterval(heartbeatInterval);
      }
    }, 15000);

    const dataHandler = (data) => {
      try {
        session.lastActivity = Date.now();
        const ok = res.write(`data: ${JSON.stringify({ type: 'data', data })}\n\n`);
        if (!ok && session.ptyProcess && typeof session.ptyProcess.pause === 'function') {
          session.ptyProcess.pause();
          res.once('drain', () => {
            if (session.ptyProcess && typeof session.ptyProcess.resume === 'function') {
              session.ptyProcess.resume();
            }
          });
        }
      } catch (error) {
        console.error(`Error sending data to client ${clientId}:`, error);
        cleanup();
      }
    };

    const exitHandler = ({ exitCode, signal }) => {
      try {
        res.write(`data: ${JSON.stringify({ type: 'exit', exitCode, signal })}\n\n`);
        res.end();
      } catch (error) {

      }
      cleanup();
    };

    const dataDisposable = session.ptyProcess.onData(dataHandler);
    const exitDisposable = session.ptyProcess.onExit(exitHandler);

    const cleanup = () => {
      clearInterval(heartbeatInterval);
      session.clients.delete(clientId);

      if (dataDisposable && typeof dataDisposable.dispose === 'function') {
        dataDisposable.dispose();
      }
      if (exitDisposable && typeof exitDisposable.dispose === 'function') {
        exitDisposable.dispose();
      }

      try {
        res.end();
      } catch (error) {

      }

      console.log(`Client ${clientId} disconnected from terminal session ${sessionId}`);
    };

    req.on('close', cleanup);
    req.on('error', cleanup);

    console.log(`Terminal connected: session=${sessionId} client=${clientId} runtime=${runtime} pty=${ptyBackend}`);
  });

  app.post('/api/terminal/:sessionId/input', express.text({ type: '*/*' }), (req, res) => {
    const { sessionId } = req.params;
    const session = terminalSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Terminal session not found' });
    }

    const data = typeof req.body === 'string' ? req.body : '';

    try {
      session.ptyProcess.write(data);
      session.lastActivity = Date.now();
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to write to terminal:', error);
      res.status(500).json({ error: error.message || 'Failed to write to terminal' });
    }
  });

  app.post('/api/terminal/:sessionId/resize', (req, res) => {
    const { sessionId } = req.params;
    const session = terminalSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Terminal session not found' });
    }

    const { cols, rows } = req.body;
    if (!cols || !rows) {
      return res.status(400).json({ error: 'cols and rows are required' });
    }

    try {
      session.ptyProcess.resize(cols, rows);
      session.lastActivity = Date.now();
      res.json({ success: true, cols, rows });
    } catch (error) {
      console.error('Failed to resize terminal:', error);
      res.status(500).json({ error: error.message || 'Failed to resize terminal' });
    }
  });

  app.delete('/api/terminal/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    const session = terminalSessions.get(sessionId);

    if (!session) {
      return res.status(404).json({ error: 'Terminal session not found' });
    }

    try {
      session.ptyProcess.kill();
      terminalSessions.delete(sessionId);
      console.log(`Closed terminal session: ${sessionId}`);
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to close terminal:', error);
      res.status(500).json({ error: error.message || 'Failed to close terminal' });
    }
  });

  app.post('/api/terminal/:sessionId/restart', async (req, res) => {
    const { sessionId } = req.params;
    const { cwd, cols, rows } = req.body;

    if (!cwd) {
      return res.status(400).json({ error: 'cwd is required' });
    }

    const existingSession = terminalSessions.get(sessionId);
    if (existingSession) {
      try {
        existingSession.ptyProcess.kill();
      } catch (error) {
      }
      terminalSessions.delete(sessionId);
    }

    try {
      try {
        const stats = await fs.promises.stat(cwd);
        if (!stats.isDirectory()) {
          return res.status(400).json({ error: 'Invalid working directory: not a directory' });
        }
      } catch (error) {
        return res.status(400).json({ error: 'Invalid working directory: not accessible' });
      }

      const newSessionId = Math.random().toString(36).substring(2, 15) +
                          Math.random().toString(36).substring(2, 15);

      const envPath = buildAugmentedPath();
      const resolvedEnv = sanitizeTerminalEnv({ ...process.env, PATH: envPath });

      const pty = await getPtyProvider();
      const { ptyProcess, shell } = spawnTerminalPtyWithFallback(pty, {
        cols,
        rows,
        cwd,
        env: resolvedEnv,
      });

      const session = {
        ptyProcess,
        ptyBackend: pty.backend,
        cwd,
        lastActivity: Date.now(),
        clients: new Set(),
      };

      terminalSessions.set(newSessionId, session);

      ptyProcess.onExit(({ exitCode, signal }) => {
        console.log(`Terminal session ${newSessionId} exited with code ${exitCode}, signal ${signal}`);
        terminalSessions.delete(newSessionId);
      });

      console.log(`Restarted terminal session: ${sessionId} -> ${newSessionId} in ${cwd} using shell ${shell}`);
      res.json({ sessionId: newSessionId, cols: cols || 80, rows: rows || 24, capabilities: terminalInputCapabilities });
    } catch (error) {
      console.error('Failed to restart terminal session:', error);
      res.status(500).json({ error: error.message || 'Failed to restart terminal session' });
    }
  });

  app.post('/api/terminal/force-kill', (req, res) => {
    const { sessionId, cwd } = req.body;
    let killedCount = 0;

    if (sessionId) {
      const session = terminalSessions.get(sessionId);
      if (session) {
        try {
          session.ptyProcess.kill();
        } catch (error) {
        }
        terminalSessions.delete(sessionId);
        killedCount++;
      }
    } else if (cwd) {
      for (const [id, session] of terminalSessions) {
        if (session.cwd === cwd) {
          try {
            session.ptyProcess.kill();
          } catch (error) {
          }
          terminalSessions.delete(id);
          killedCount++;
        }
      }
    } else {
      for (const [id, session] of terminalSessions) {
        try {
          session.ptyProcess.kill();
        } catch (error) {
        }
        terminalSessions.delete(id);
        killedCount++;
      }
    }

    console.log(`Force killed ${killedCount} terminal session(s)`);
    res.json({ success: true, killedCount });
  });
  terminalRuntime = startupPipelineResult.terminalRuntime;
  messageStreamRuntime = startupPipelineResult.messageStreamRuntime;

  try {
    await scheduledTasksRuntime.start();
  } catch (error) {
    console.warn('[ScheduledTasks] Failed to start runtime:', error?.message || error);
  }

  return {
    expressApp: app,
    httpServer: server,
    getPort: () => tunnelRuntimeContext.getActivePort(),
    getOpenCodePort: () => openCodePort,
    getTunnelUrl: () => tunnelService.getPublicUrl(),
    getQuitRiskStatus: () => ({
      tunnel: {
        active: Boolean(tunnelService.getPublicUrl()),
      },
      scheduledTasks: scheduledTasksRuntime.getStatus(),
    }),
    isReady: () => isOpenCodeReady,
    restartOpenCode: () => restartOpenCode(),
    stop: (shutdownOptions = {}) =>
      gracefulShutdown({ exitProcess: shutdownOptions.exitProcess ?? false })
  };
}

runCliEntryIfMain({
  process,
  currentFilename: __filename,
  parseServeCliOptions,
  defaultPort: DEFAULT_PORT,
  cloudflareProvider: TUNNEL_PROVIDER_CLOUDFLARE,
  managedLocalMode: TUNNEL_MODE_MANAGED_LOCAL,
  setExitOnShutdown: (value) => {
    exitOnShutdown = value;
  },
  startServer: main,
});

if (isCliExecution) {
  const cliOptions = parseArgs();
  exitOnShutdown = true;

  // Attach signal handlers immediately for CLI mode
  const handleSignal = (signal) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    gracefulShutdown().catch((error) => {
      console.error('Graceful shutdown failed:', error);
      process.exit(1);
    });
  };

  process.on('SIGINT', () => handleSignal('SIGINT'));
  process.on('SIGTERM', () => handleSignal('SIGTERM'));
  process.on('SIGQUIT', () => handleSignal('SIGQUIT'));

  // Handle stdin EOF (when piping input)
  process.stdin.on('end', () => {
    console.log('STDIN closed, initiating graceful shutdown...');
    gracefulShutdown().catch((error) => {
      console.error('Graceful shutdown failed:', error);
      process.exit(1);
    });
  });

  main({
    port: cliOptions.port,
    tryCfTunnel: cliOptions.tryCfTunnel,
    attachSignals: false, // Already attached above
    exitOnShutdown: true,
    uiPassword: cliOptions.uiPassword
  }).catch(error => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}

export { gracefulShutdown, setupProxy, restartOpenCode, main as startWebUiServer, parseArgs };
