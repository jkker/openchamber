import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useGitIdentitiesStore } from '@/stores/useGitIdentitiesStore';
import { useFileSystemAccess } from '@/hooks/useFileSystemAccess';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui';
import { IdentityDropdown } from '@/components/views/git/GitHeader';
import { useDeviceInfo } from '@/lib/device';
import { isVSCodeRuntime } from '@/lib/desktop';
import { MobileOverlayPanel } from '@/components/ui/MobileOverlayPanel';
import { Icon } from "@/components/icon/Icon";
import { opencodeClient } from '@/lib/opencode/client';
import {
  setDirectoryShowHidden,
  useDirectoryShowHidden,
} from '@/lib/directoryShowHidden';
import { normalizePath } from '@/lib/pathUtils';

interface DirectoryExplorerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type BrowseEntry = {
  name: string;
  path: string;
};

type BrowseRow =
  | { type: 'up'; value: 'browse:up'; name: string; path: string | null; disabled?: false }
  | { type: 'directory'; value: string; name: string; path: string; disabled: boolean };

const isRootPath = (value: string): boolean => value === '/';

const normalizeSeparators = (value: string): string => value.replace(/\\/g, '/');

const trimTrailingSeparators = (value: string): string => {
  if (!value || isRootPath(value)) return value;
  let result = value;
  while (result.length > 1 && result.endsWith('/')) {
    result = result.slice(0, -1);
  }
  return result;
};

const hasTrailingPathSeparator = (value: string): boolean => value.endsWith('/');

const ensureBrowseDirectoryPath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed || hasTrailingPathSeparator(trimmed)) return trimmed;
  return `${trimmed}/`;
};

const getLastPathSeparatorIndex = (value: string): number => value.lastIndexOf('/');

const getBrowseDirectoryPath = (value: string): string => {
  if (hasTrailingPathSeparator(value)) return value;
  const lastSeparator = getLastPathSeparatorIndex(value);
  if (lastSeparator < 0) return value;
  return value.slice(0, lastSeparator + 1);
};

const getBrowseLeafPathSegment = (value: string): string => {
  const lastSeparator = getLastPathSeparatorIndex(value);
  return value.slice(lastSeparator + 1);
};

const getBrowseParentPath = (value: string): string | null => {
  const trimmed = trimTrailingSeparators(value.trim());
  if (!trimmed || trimmed === '~' || trimmed === '~/' || trimmed === '/') return null;
  const lastSeparator = getLastPathSeparatorIndex(trimmed);
  if (lastSeparator < 0) return null;
  if (trimmed.startsWith('~/') && lastSeparator <= 1) return '~/';
  if (lastSeparator === 0) return '/';
  return `${trimmed.slice(0, lastSeparator)}/`;
};

const canNavigateUp = (value: string): boolean => hasTrailingPathSeparator(value) && getBrowseParentPath(value) !== null;

const appendBrowsePathSegment = (currentPath: string, segment: string): string => (
  `${getBrowseDirectoryPath(currentPath)}${segment}/`
);

const normalizeDirectoryPath = (path: string | null | undefined): string | null => {
  if (!path) return null;
  const normalized = trimTrailingSeparators(normalizeSeparators(path.trim()));
  if (!normalized) return null;
  return normalized.toLowerCase();
};

const displayPathToAbsolutePath = (value: string, homeDirectory: string): string => {
  const trimmed = value.trim();
  if (trimmed === '~') return homeDirectory;
  if (trimmed.startsWith('~/')) return `${homeDirectory}${trimmed.slice(1)}`;
  return trimmed;
};

const isPrimaryModifierPressed = (event: React.KeyboardEvent<HTMLInputElement>): boolean => {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
};

const focusPathInput = (input: HTMLInputElement | null): void => {
  if (!input) return;
  input.focus({ preventScroll: true });
  const valueLength = input.value.length;
  input.setSelectionRange(valueLength, valueLength);
  input.scrollLeft = input.scrollWidth;
};

const resolveFreshFilesystemHome = async (): Promise<string | null> => {
  try {
    const response = await fetch('/api/fs/home', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    if (response.ok) {
      const data = await response.json() as { home?: unknown };
      if (typeof data.home === 'string' && data.home.trim().length > 0) {
        return normalizeSeparators(data.home.trim());
      }
    }
  } catch {
    // Fall back to the client helper below.
  }

  return opencodeClient.getFilesystemHome().catch(() => null);
};

export const DirectoryExplorerDialog: React.FC<DirectoryExplorerDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { currentDirectory, homeDirectory, isHomeReady } = useDirectoryStore();
  const { addProject, getActiveProject } = useProjectsStore();
  const isVSCode = React.useMemo(() => isVSCodeRuntime(), []);
  const isWindowsRuntime = React.useMemo(
    () => typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent),
    []
  );
  const [pendingPath, setPendingPath] = React.useState<string | null>(null);
  const [pathInputValue, setPathInputValue] = React.useState('');
  const [hasUserSelection, setHasUserSelection] = React.useState(false);
  const [isConfirming, setIsConfirming] = React.useState(false);
  const showHidden = useDirectoryShowHidden();
  const { isDesktop, requestAccess, startAccessing } = useFileSystemAccess();
  const { isMobile } = useDeviceInfo();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const addButtonRef = React.useRef<HTMLButtonElement>(null);
  const rowRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const [dialogHomeDirectory, setDialogHomeDirectory] = React.useState('');
  const [query, setQuery] = React.useState('~/');
  const [entries, setEntries] = React.useState<BrowseEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [isBrowseDirectoryMissing, setIsBrowseDirectoryMissing] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const [isConfirming, setIsConfirming] = React.useState(false);
  const [isOpeningFinder, setIsOpeningFinder] = React.useState(false);
  const [addButtonWidth, setAddButtonWidth] = React.useState(0);
  const [isCloneMode, setIsCloneMode] = React.useState(false);
  const [cloneRemoteUrl, setCloneRemoteUrl] = React.useState('');
  const [selectedGitIdentityId, setSelectedGitIdentityId] = React.useState<string | null>(null);

  const normalizeDirectoryPath = React.useCallback((value: string | null | undefined) => {
    if (typeof value !== 'string') {
      return null;
    }

    const normalized = normalizePath(value);
    if (normalized) {
      return normalized;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed.replace(/\\/g, '/') : null;
  }, []);

  const toDirectoryRequestPath = React.useCallback((value: string) => {
    const normalized = normalizeDirectoryPath(value) ?? value.trim().replace(/\\/g, '/');
    const converted = normalized.replace(/^\/([A-Za-z])(?=\/|$)/, (_, drive: string) => `${drive.toUpperCase()}:`);
    return /^[A-Za-z]:$/.test(converted) ? `${converted}/` : converted;
  }, [normalizeDirectoryPath]);

  const workspaceBoundary = React.useMemo(() => {
    if (!isVSCode || typeof window === 'undefined') {
      return null;
    }

    const workspaceFolder = (window as unknown as { __VSCODE_CONFIG__?: { workspaceFolder?: unknown } })
      .__VSCODE_CONFIG__?.workspaceFolder;
    return typeof workspaceFolder === 'string'
      ? normalizeDirectoryPath(workspaceFolder)
      : null;
  }, [isVSCode, normalizeDirectoryPath]);

  const defaultPickerPath = isVSCode ? workspaceBoundary : homeDirectory;
  const isDefaultPickerPathReady = isVSCode ? Boolean(workspaceBoundary) : isHomeReady;

  const isWindowsPathLike = React.useCallback((value: string | null | undefined) => {
    if (typeof value !== 'string') {
      return false;
    }

    const trimmed = value.trim();
    return /^\/[A-Za-z](?:\/|$)?/.test(trimmed) || /^[A-Za-z]:(?:[\\/]|$)?/.test(trimmed);
  }, []);

  const isWindowsPathContext = React.useMemo(() => {
    if (!isWindowsRuntime) {
      return false;
    }

    return [currentDirectory, homeDirectory, workspaceBoundary, pathInputValue].some((value) => isWindowsPathLike(value));
  }, [currentDirectory, homeDirectory, isWindowsPathLike, isWindowsRuntime, pathInputValue, workspaceBoundary]);

  const supportsPathAutocomplete = React.useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return false;
    }

    if (trimmed.startsWith('/') || trimmed.startsWith('\\') || trimmed.startsWith('~')) {
      return true;
    }

    if (/^[A-Za-z]:(?:[\\/]|$)/.test(trimmed)) {
      return true;
    }

    return /^%userprofile%(?:[\\/]|$)/i.test(trimmed);
  }, []);

  const expandTypedPath = React.useCallback((value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return '';
    }

    let expanded = trimmed.replace(/\\/g, '/');
    if (/^[A-Za-z]:$/.test(expanded)) {
      expanded = `${expanded}/`;
    }

    if (/^%userprofile%(?:[\\/]|$)/i.test(trimmed) && homeDirectory) {
      expanded = expanded.replace(/^%userprofile%/i, homeDirectory);
    } else if (expanded.startsWith('~') && homeDirectory) {
      expanded = expanded.replace(/^~/, homeDirectory);
    }

    return normalizeDirectoryPath(expanded) ?? expanded;
  }, [homeDirectory, normalizeDirectoryPath]);

  const formatInputPath = React.useCallback((
    path: string | null | undefined,
    options?: { preserveTrailingSeparator?: boolean }
  ) => {
    const normalizedPath = normalizeDirectoryPath(path);
    if (!normalizedPath) {
      return '';
    }

    if (isWindowsPathContext || isWindowsPathLike(normalizedPath)) {
      const windowsPath = toDirectoryRequestPath(normalizedPath);
      let formatted = windowsPath === '/'
        ? '\\'
        : windowsPath.replace(/\//g, '\\');

      if (options?.preserveTrailingSeparator && !formatted.endsWith('\\')) {
        formatted = `${formatted}\\`;
      }

      return formatted;
    }

    if (options?.preserveTrailingSeparator) {
      if (!normalizedPath.endsWith('/')) {
        return `${normalizedPath}/`;
      }
    }

    return normalizedPath;
  }, [isWindowsPathContext, isWindowsPathLike, normalizeDirectoryPath, toDirectoryRequestPath]);

  React.useEffect(() => {
    if (open) {
      setHasUserSelection(false);
      setIsConfirming(false);
      setAutocompleteVisible(false);
      // Initialize with active project or current directory
      const activeProject = getActiveProject();
      const initialPath = activeProject?.path || currentDirectory || defaultPickerPath || '';
      const initialInputValue = formatInputPath(initialPath);
      setPendingPath(initialPath);
      setPathInputValue(initialInputValue);
    }
  }, [open, currentDirectory, defaultPickerPath, formatInputPath, getActiveProject]);

  // Fill the input once the default picker path is ready and nothing has been selected yet.
  React.useEffect(() => {
    if (!open || !isCloneMode || selectedGitIdentityId !== null) return;
    const defaultId = typeof defaultGitIdentityId === 'string' ? defaultGitIdentityId.trim() : '';
    if (defaultId && availableGitIdentities.some((identity) => identity.id === defaultId)) {
      setSelectedGitIdentityId(defaultId);
      return;
    }
    if (defaultPickerPath && isDefaultPickerPathReady) {
      const initialInputValue = formatInputPath(defaultPickerPath);
      setPendingPath(defaultPickerPath);
      setHasUserSelection(true);
      setPathInputValue(initialInputValue);
    }
  }, [defaultPickerPath, formatInputPath, hasUserSelection, isDefaultPickerPathReady, open, pendingPath]);

  const selectedGitIdentity = React.useMemo(
    () => availableGitIdentities.find((identity) => identity.id === selectedGitIdentityId) ?? null,
    [availableGitIdentities, selectedGitIdentityId]
  );

  const browseDirectoryDisplayPath = React.useMemo(() => getBrowseDirectoryPath(query), [query]);
  const browseFilterQuery = React.useMemo(
    () => (hasTrailingPathSeparator(query) ? '' : getBrowseLeafPathSegment(query)),
    [query]
  );
  const browseDirectoryAbsolutePath = React.useMemo(
    () => explorerRootDirectory ? displayPathToAbsolutePath(browseDirectoryDisplayPath, explorerRootDirectory) : '',
    [browseDirectoryDisplayPath, explorerRootDirectory]
  );

  React.useEffect(() => {
    if (!open || !browseDirectoryAbsolutePath) {
      setEntries([]);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setIsBrowseDirectoryMissing(false);
    opencodeClient.listLocalDirectory(browseDirectoryAbsolutePath)
      .then((result) => {
        if (cancelled) return;
        setIsBrowseDirectoryMissing(false);
        const nextEntries = result
          .filter((entry) => entry.isDirectory)
          .map((entry) => ({
            name: entry.name,
            path: normalizeSeparators(entry.path),
          }))
          .sort((left, right) => left.name.localeCompare(right.name));
        setEntries(nextEntries);
      })
      .catch(() => {
        if (!cancelled) {
          setEntries([]);
          setIsBrowseDirectoryMissing(true);
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [browseDirectoryAbsolutePath, open]);

  const filteredEntries = React.useMemo(() => {
    const lowerFilter = browseFilterQuery.toLowerCase();
    const includeHidden = showHidden || browseFilterQuery.startsWith('.');
    return entries.filter((entry) => (
      entry.name.toLowerCase().startsWith(lowerFilter) && (includeHidden || !entry.name.startsWith('.'))
    ));
  }, [browseFilterQuery, entries, showHidden]);

  const rows = React.useMemo<BrowseRow[]>(() => {
    const nextRows: BrowseRow[] = [];
    if (canNavigateUp(query)) {
      nextRows.push({ type: 'up', value: 'browse:up', name: '..', path: getBrowseParentPath(query) });
    }
    for (const entry of filteredEntries) {
      const normalized = normalizeDirectoryPath(entry.path);
      nextRows.push({
        type: 'directory',
        value: `browse:${entry.path}`,
        name: entry.name,
        path: entry.path,
        disabled: Boolean(normalized && addedProjectPaths.has(normalized)),
      });
    }
    return nextRows;
  }, [addedProjectPaths, filteredEntries, query]);

  React.useEffect(() => {
    setHighlightedIndex(0);
  }, [query, rows.length]);

  const targetPath = React.useMemo(() => {
    if (!explorerRootDirectory) return '';
    return trimTrailingSeparators(displayPathToAbsolutePath(query, explorerRootDirectory));
  }, [explorerRootDirectory, query]);
  const normalizedTargetPath = normalizeDirectoryPath(targetPath);
  const isAlreadyAdded = Boolean(normalizedTargetPath && addedProjectPaths.has(normalizedTargetPath));
  const exactEntry = React.useMemo(() => {
    if (!browseFilterQuery) return null;
    return filteredEntries.find((entry) => entry.name === browseFilterQuery) ?? null;
  }, [browseFilterQuery, filteredEntries]);
  const shouldCreateTarget = Boolean(
    targetPath
    && !isAlreadyAdded
    && (
      (hasTrailingPathSeparator(query) && isBrowseDirectoryMissing)
      || (!hasTrailingPathSeparator(query) && browseFilterQuery.trim().length > 0 && exactEntry === null)
    )
  );
  const canAddProject = !isConfirming && !isOpeningFinder && !isAlreadyAdded && Boolean(targetPath);
  const canSubmitClone = canAddProject && cloneRemoteUrl.trim().length > 0;
  const highlightedRow = rows[highlightedIndex] ?? null;
  const hasHighlightedBrowseItem = Boolean(
    highlightedRow && (highlightedRow.type === 'up' || (highlightedRow.type === 'directory' && !highlightedRow.disabled))
  );
  const submitModifierLabel = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl';
  const submitActionLabel = isAlreadyAdded
    ? t('directoryExplorerDialog.actions.alreadyAdded')
    : isCloneMode
      ? isConfirming
        ? t('directoryExplorerDialog.actions.cloning')
        : t('directoryExplorerDialog.actions.cloneAndAdd')
    : isConfirming
      ? t('directoryExplorerDialog.actions.adding')
    : shouldCreateTarget
      ? t('directoryExplorerDialog.actions.createAndAdd')
      : t('directoryExplorerDialog.actions.addProject');

  React.useLayoutEffect(() => {
    const button = addButtonRef.current;
    if (!button) return;

    const updateWidth = () => setAddButtonWidth(Math.ceil(button.getBoundingClientRect().width));
    updateWidth();

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(updateWidth);
    observer.observe(button);
    return () => observer.disconnect();
  }, [submitActionLabel]);

  React.useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.scrollLeft = input.scrollWidth;
  }, [addButtonWidth, query]);

  React.useLayoutEffect(() => {
    if (!open) return;
    focusPathInput(inputRef.current);
  }, [open]);

  React.useLayoutEffect(() => {
    const row = rows[highlightedIndex];
    if (!row) return;
    rowRefs.current.get(row.value)?.scrollIntoView({ block: 'nearest' });
  }, [highlightedIndex, rows]);

  const handleClose = React.useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const isWindowsDrivePickerPath = React.useCallback((path: string | null | undefined) => {
    const normalized = normalizeDirectoryPath(path);
    return Boolean(!workspaceBoundary && isWindowsPathContext && normalized === '/');
  }, [isWindowsPathContext, normalizeDirectoryPath, workspaceBoundary]);

  const isPathWithinWorkspaceBoundary = React.useCallback((path: string) => {
    if (!workspaceBoundary) {
      return true;
    }

    const normalizedTarget = normalizeDirectoryPath(path);
    if (!normalizedTarget) {
      return false;
    }

    if (workspaceBoundary === '/') {
      return normalizedTarget.startsWith('/');
    }

    return normalizedTarget === workspaceBoundary || normalizedTarget.startsWith(`${workspaceBoundary}/`);
  }, [workspaceBoundary, normalizeDirectoryPath]);

  const finalizeSelection = React.useCallback(async (targetPath: string) => {
    const normalizedTargetPath = expandTypedPath(targetPath);
    if (!normalizedTargetPath || isConfirming) {
      return;
    }

    setIsConfirming(true);
    try {
      if (isWindowsDrivePickerPath(normalizedTargetPath)) {
        return;
      }

      if (isVSCode && workspaceBoundary && !isPathWithinWorkspaceBoundary(normalizedTargetPath)) {
        toast.error('Directory must stay inside the workspace', {
          description: 'VS Code can only browse within the current workspace folder.',
        });
        return;
      }

      let resolvedPath = normalizedTargetPath;
      let projectId: string | undefined;

      if (isDesktop) {
        const accessResult = await requestAccess(toDirectoryRequestPath(normalizedTargetPath));
        if (!accessResult.success) {
          toast.error('Unable to access directory', {
            description: accessResult.error || 'Desktop denied directory access.',
          });
          return;
        }
        resolvedPath = normalizeDirectoryPath(accessResult.path ?? normalizedTargetPath) ?? normalizedTargetPath;
        projectId = accessResult.projectId;

        const startResult = await startAccessing(toDirectoryRequestPath(resolvedPath));
        if (!startResult.success) {
          toast.error('Failed to open directory', {
            description: startResult.error || 'Desktop could not grant file access.',
          });
          return;
        }
        const result = await opencodeClient.cloneRepository({
          remoteUrl,
          destinationPath: target,
          gitIdentityId: selectedGitIdentity?.id ?? null,
        });
        selectedTarget = result.path;
      } else if (shouldCreateSelection) {
        await opencodeClient.createDirectory(target, { allowOutsideWorkspace: true });
      }
      const added = addProject(selectedTarget);
      if (!added) {
        toast.error(t('directoryExplorerDialog.toast.failedToAddProject'), {
          description: t('directoryExplorerDialog.toast.selectValidDirectoryPath'),
        });
        return;
      }
      handleClose();
    } catch (error) {
      toast.error(t('directoryExplorerDialog.toast.failedToSelectDirectory'), {
        description: error instanceof Error ? error.message : t('directoryExplorerDialog.toast.unknownError'),
      });
    } finally {
      setIsConfirming(false);
    }
  }, [
    addProject,
    handleClose,
    isDesktop,
    requestAccess,
    startAccessing,
    isConfirming,
    expandTypedPath,
    isPathWithinWorkspaceBoundary,
    isVSCode,
    isWindowsDrivePickerPath,
    normalizeDirectoryPath,
    toDirectoryRequestPath,
    workspaceBoundary,
  ]);

  const handleConfirm = React.useCallback(async () => {
    const typedPath = pathInputValue.trim();
    const pathToUse = typedPath ? expandTypedPath(typedPath) : pendingPath;
    if (!pathToUse) {
      return;
    }
    await finalizeSelection(pathToUse);
  }, [expandTypedPath, finalizeSelection, pathInputValue, pendingPath]);

  const handleSelectPath = React.useCallback((path: string) => {
    setPendingPath(path);
    setHasUserSelection(true);
    setPathInputValue(formatInputPath(path));
  }, [formatInputPath]);

  const handleDoubleClickPath = React.useCallback(async (path: string) => {
    setPendingPath(path);
    setHasUserSelection(true);
    setPathInputValue(formatInputPath(path));
    await finalizeSelection(path);
  }, [finalizeSelection, formatInputPath]);

  const handlePathInputChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setPathInputValue(value);
    setHasUserSelection(true);
    // Show autocomplete when typing a path
    const supportsAutocomplete = supportsPathAutocomplete(value);
    setAutocompleteVisible(supportsAutocomplete);
    // Update pending path if it looks like a valid path
    if (supportsAutocomplete) {
      setPendingPath(expandTypedPath(value));
    }
  }, [expandTypedPath, supportsPathAutocomplete]);

  const handlePathInputKeyDown = React.useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    // Let autocomplete handle the key first if visible
    if (autocompleteRef.current?.handleKeyDown(e)) {
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      handleConfirm();
    }
  }, [handleConfirm]);

  const handleAutocompleteSuggestion = React.useCallback((path: string) => {
    setPendingPath(normalizeDirectoryPath(path));
    setHasUserSelection(true);
    setPathInputValue(formatInputPath(path, { preserveTrailingSeparator: true }));
    // Keep autocomplete open to allow further drilling down
  }, [formatInputPath, normalizeDirectoryPath]);

  const handleAutocompleteClose = React.useCallback(() => {
    setAutocompleteVisible(false);
  }, []);

  const browseToEntry = React.useCallback((entry: BrowseEntry) => {
    setQuery(appendBrowsePathSegment(query, entry.name));
  }, [query]);

  const executeRow = React.useCallback((row: BrowseRow | null) => {
    if (!row) return;
    if (row.type === 'up') {
      if (row.path) browseToDisplayPath(row.path);
      return;
    }
    if (row.disabled) return;
    browseToEntry(row);
  }, [browseToDisplayPath, browseToEntry]);

  const handleOpenInFinder = React.useCallback(async () => {
    if (!isDesktop || isOpeningFinder) return;
    setIsOpeningFinder(true);
    try {
      const result = await requestAccess(targetPath);
      if (!result.success || !result.path) {
        if (result.error && result.error !== 'Directory selection cancelled') {
          toast.error(t('directoryExplorerDialog.toast.failedToSelectDirectory'), {
            description: result.error,
          });
        }
        return;
      }

      const accessResult = await startAccessing(result.path);
      if (!accessResult.success) {
        toast.error(t('directoryExplorerDialog.toast.failedToOpenDirectory'), {
          description: accessResult.error || t('directoryExplorerDialog.toast.desktopCouldNotGrantAccess'),
        });
        return;
      }

      await finalizeSelection(result.path);
    } catch (error) {
      toast.error(t('directoryExplorerDialog.toast.failedToSelectDirectory'), {
        description: error instanceof Error ? error.message : t('directoryExplorerDialog.toast.unknownError'),
      });
    } finally {
      setIsOpeningFinder(false);
    }
  }, [finalizeSelection, isDesktop, isOpeningFinder, requestAccess, startAccessing, t, targetPath]);

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(rows.length - 1, index + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (isPrimaryModifierPressed(event)) {
        void finalizeSelection(targetPath);
        return;
      }
      if (hasHighlightedBrowseItem) {
        executeRow(highlightedRow);
      }
      return;
    }
    if (event.key === 'Backspace' && query === '') {
      event.preventDefault();
      handleClose();
    }
  }, [executeRow, finalizeSelection, handleClose, hasHighlightedBrowseItem, highlightedRow, query, rows.length, targetPath]);

  const showHiddenToggle = (
    <button
      type="button"
      onClick={() => setDirectoryShowHidden(!showHidden)}
      className="flex flex-shrink-0 items-center gap-2 rounded-lg px-2 py-1 typography-meta text-muted-foreground transition-colors hover:bg-interactive-hover/40"
    >
      {showHidden ? <Icon name="checkbox" className="h-4 w-4 text-primary" /> : <Icon name="checkbox-blank" className="h-4 w-4" />}
      {t('directoryExplorerDialog.toggle.showHidden')}
    </button>
  );

  const dialogHeader = (
    <DialogHeader className="flex-shrink-0 px-4 pb-2 pt-[calc(var(--oc-safe-area-top,0px)+0.5rem)] sm:px-0 sm:pb-3 sm:pt-0">
      <DialogTitle>Add project directory</DialogTitle>
      <div className="hidden sm:flex sm:items-center sm:justify-between sm:gap-4">
        <DialogDescription className="flex-1">
          Choose a folder to add as a project.
        </DialogDescription>
        {showHiddenToggle}
      </div>
    </DialogHeader>
  );

  const pathInputSection = (
    <div className="relative">
      <Input
        value={pathInputValue}
        onChange={handlePathInputChange}
        onKeyDown={handlePathInputKeyDown}
        placeholder="Enter path or select from tree..."
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        className="font-mono typography-meta"
      />
      <DirectoryAutocomplete
        ref={autocompleteRef}
        inputValue={pathInputValue}
        homeDirectory={homeDirectory}
        scopeBoundary={workspaceBoundary}
        onSelectSuggestion={handleAutocompleteSuggestion}
        visible={autocompleteVisible}
        onClose={handleAutocompleteClose}
        showHidden={showHidden}
      />
    </div>
  );

  const treeSection = (
    <div className="flex-1 min-h-0 rounded-xl border border-border/40 bg-sidebar/70 overflow-hidden flex flex-col">
        <DirectoryTree
        variant="inline"
        currentPath={pendingPath ?? currentDirectory}
        onSelectPath={handleSelectPath}
        onDoubleClickPath={handleDoubleClickPath}
        className="flex-1 min-h-0 sm:min-h-[280px] sm:max-h-[380px]"
        selectionBehavior="deferred"
        showHidden={showHidden}
        rootDirectory={isVSCode ? workspaceBoundary : null}
        isRootReady={isVSCode ? Boolean(workspaceBoundary) : true}
      />
    </div>
  );

  // Mobile: use flex layout where tree takes remaining space
  const mobileContent = (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex-shrink-0">{pathInputSection}</div>
      <div className="flex-shrink-0 flex items-center justify-end">
        {showHiddenToggle}
      </div>
      <div className="flex-1 min-h-0 rounded-xl border border-border/40 bg-sidebar/70 overflow-hidden flex flex-col">
        <DirectoryTree
          variant="inline"
          currentPath={pendingPath ?? currentDirectory}
          onSelectPath={handleSelectPath}
          onDoubleClickPath={handleDoubleClickPath}
          className="flex-1 min-h-0"
          selectionBehavior="deferred"
          showHidden={showHidden}
          rootDirectory={isVSCode ? workspaceBoundary : null}
          isRootReady={isVSCode ? Boolean(workspaceBoundary) : true}
          alwaysShowActions
        />
        {!isMobile ? (
          <Button
            ref={addButtonRef}
            variant="outline"
            size="xs"
            tabIndex={-1}
            className="absolute right-1.5 top-1/2 h-7 -translate-y-1/2 gap-1 px-2 typography-meta"
            disabled={isCloneMode ? !canSubmitClone : !canAddProject}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => void finalizeSelection(targetPath)}
            title={submitActionLabel}
          >
            {submitActionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );

  const resultsSection = (
    <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-[var(--surface-elevated)] shadow-sm">
      <div className="max-h-[min(28rem,58vh)] overflow-y-auto p-2">
        <div className="px-2 pb-1 pt-0.5 typography-meta font-medium uppercase tracking-wide text-muted-foreground/80">
          {t('directoryExplorerDialog.browse.directories')}
        </div>
        {isLoading ? (
          <div className="py-10 text-center typography-ui-label text-muted-foreground">
            {t('directoryExplorerDialog.browse.loading')}
          </div>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center typography-ui-label text-muted-foreground">
            {t('directoryExplorerDialog.browse.empty')}
          </div>
        ) : (
          <div className="space-y-0.5">
            {rows.map((row, index) => {
              const isActive = index === highlightedIndex;
              return (
                <button
                  key={row.value}
                  ref={(node) => {
                    if (node) {
                      rowRefs.current.set(row.value, node);
                    } else {
                      rowRefs.current.delete(row.value);
                    }
                  }}
                  type="button"
                  disabled={row.type === 'directory' && row.disabled}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => executeRow(row)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                    isActive && 'bg-interactive-selection text-interactive-selection-foreground',
                    !isActive && 'hover:bg-interactive-hover/50',
                    row.type === 'directory' && row.disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent'
                  )}
                >
                  {row.type === 'up' ? (
                    <Icon name="arrow-left-s" className="h-4 w-4 flex-shrink-0 text-muted-foreground/80" />
                  ) : (
                    <Icon name="folder-6" className="h-4 w-4 flex-shrink-0 text-muted-foreground/80" />
                  )}
                  <span className="flex min-w-0 flex-1 items-center gap-1.5">
                    <span className="truncate typography-ui-label text-foreground">{row.name}</span>
                  </span>
                  {row.type === 'directory' && row.disabled ? (
                    <span className="rounded-full border border-border/60 px-2 py-0.5 typography-meta text-muted-foreground">
                      {t('directoryExplorerDialog.browse.addedBadge')}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const content = (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {inputSection}
      {resultsSection}
    </div>
  );

  const footerHints = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 typography-micro text-muted-foreground">
      <span className="inline-flex items-center gap-1">
        <Icon name="arrow-up-s" className="h-3.5 w-3.5" />
        <Icon name="arrow-down-s" className="-ml-1 h-3.5 w-3.5" />
        {t('directoryExplorerDialog.footer.navigate')}
      </span>
      <span className="inline-flex items-center gap-1">
        <Icon name="corner-down-left" className="h-3.5 w-3.5" />
        {t('directoryExplorerDialog.footer.select')}
      </span>
      <span className="inline-flex items-center gap-1">
        <span>{submitModifierLabel}</span>
        <Icon name="corner-down-left" className="h-3.5 w-3.5" />
        {t('directoryExplorerDialog.footer.add')}
      </span>
    </div>
  );

  const renderFooter = () => (
    <>
      <Button
        variant="ghost"
        onClick={handleClose}
        disabled={isConfirming}
        className="flex-1 sm:flex-none sm:w-auto"
      >
        Cancel
      </Button>
      <Button
        onClick={handleConfirm}
        disabled={
          isConfirming
          || !hasUserSelection
          || (!pendingPath && !pathInputValue.trim())
          || isWindowsDrivePickerPath(pathInputValue.trim() || pendingPath)
        }
        className="flex-1 sm:flex-none sm:w-auto sm:min-w-[140px]"
      >
        {isConfirming ? 'Adding...' : 'Add Project'}
      </Button>
    </>
  );

  if (isMobile) {
    return (
      <MobileOverlayPanel
        open={open}
        onClose={handleClose}
        title={t('directoryExplorerDialog.title')}
        className="h-[88dvh] max-h-[720px] max-w-full"
        contentMaxHeightClassName="flex-1"
        footer={<div className="flex flex-col gap-2">{renderFooter()}</div>}
      >
        <div className="flex h-full min-h-0 flex-col gap-3">
          <div className="flex justify-end">{showHiddenToggle}</div>
          {content}
        </div>
      </MobileOverlayPanel>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-full max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[80vh]"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="px-5 pb-2 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <DialogTitle>{t('directoryExplorerDialog.title')}</DialogTitle>
              <DialogDescription className="mt-2">{t('directoryExplorerDialog.description')}</DialogDescription>
            </div>
            {showHiddenToggle}
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 px-2 pb-0">{content}</div>
        <DialogFooter className="flex w-full flex-col gap-3 px-5 py-3 sm:flex-row sm:items-center sm:justify-between">
          {renderFooter()}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
