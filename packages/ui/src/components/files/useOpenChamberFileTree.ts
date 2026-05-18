import React from 'react';
import { type FileTreeDirectoryHandle, type FileTreeIcons } from '@pierre/trees';
import { useFileTree } from '@pierre/trees/react';

import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { opencodeClient } from '@/lib/opencode/client';
import type { FilesAPI, GitStatus, RuntimeDescriptor } from '@/lib/api/types';
import { useFileSearchStore } from '@/stores/useFileSearchStore';

import {
  type DirectoryEntryLike,
  type OpenChamberFileNode,
  buildPreparedTreeInput,
  buildTreeGitStatus,
  fromTreePath,
  getAncestorPaths,
  isPathWithinRoot,
  mapDirectoryEntries,
  normalizePath,
  toTreePath,
} from './fileTreeOperations';

type UseOpenChamberFileTreeOptions = {
  expandedPaths: readonly string[];
  files: FilesAPI;
  gitStatus: GitStatus | null | undefined;
  onExpandedPathsChange?: (paths: string[]) => void;
  onFileOpen: (node: OpenChamberFileNode) => Promise<void> | void;
  openMode: 'context-panel' | 'files-editor';
  openPaths: ReadonlySet<string>;
  root: string;
  runtime: RuntimeDescriptor;
  selectedPath: string | null;
  showGitignored: boolean;
  showHidden: boolean;
};

type UseOpenChamberFileTreeResult = {
  childrenByDir: Record<string, OpenChamberFileNode[]>;
  ensurePathVisible: (targetPath: string, includeTarget: boolean) => Promise<void>;
  handleSearchResultOpen: (node: OpenChamberFileNode) => Promise<void>;
  hasTree: boolean;
  loadDirectory: (dirPath: string) => Promise<void>;
  model: ReturnType<typeof useFileTree>['model'];
  refreshDirectory: (dirPath: string) => Promise<void>;
  refreshRoot: () => Promise<void>;
  root: string;
  searchQuery: string;
  searchResults: OpenChamberFileNode[];
  searching: boolean;
  setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
};

const TREE_ICONS: FileTreeIcons = { colored: true, set: 'complete' };

export const useOpenChamberFileTree = ({
  expandedPaths,
  files,
  gitStatus,
  onExpandedPathsChange,
  onFileOpen,
  openMode,
  openPaths,
  root,
  runtime,
  selectedPath,
  showGitignored,
  showHidden,
}: UseOpenChamberFileTreeOptions): UseOpenChamberFileTreeResult => {
  const normalizedRoot = React.useMemo(() => normalizePath(root.trim()), [root]);
  const searchFiles = useFileSearchStore((state) => state.searchFiles);
  const invalidateDirectory = useFileSearchStore((state) => state.invalidateDirectory);

  const [childrenByDir, setChildrenByDir] = React.useState<Record<string, OpenChamberFileNode[]>>({});
  const loadedDirsRef = React.useRef<Set<string>>(new Set());
  const inFlightDirsRef = React.useRef<Set<string>>(new Set());
  const activeDirectoryLoadIdsRef = React.useRef<Map<string, number>>(new Map());
  const nextDirectoryLoadIdRef = React.useRef(0);

  const [searchQuery, setSearchQuery] = React.useState('');
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 200);
  const [searchResults, setSearchResults] = React.useState<OpenChamberFileNode[]>([]);
  const [searching, setSearching] = React.useState(false);

  const openPathsRef = React.useRef(openPaths);
  openPathsRef.current = openPaths;

  const rootRef = React.useRef(normalizedRoot);
  rootRef.current = normalizedRoot;

  const onFileOpenRef = React.useRef(onFileOpen);
  onFileOpenRef.current = onFileOpen;

  const expandedPathsRef = React.useRef(expandedPaths);
  expandedPathsRef.current = expandedPaths;

  const syncingSelectionRef = React.useRef<string | null>(null);
  const previousExpandedTreePathsRef = React.useRef<Set<string>>(new Set());

  const renderRowDecoration = React.useCallback(({ item }: { item: { path: string } }) => {
    const rootPath = rootRef.current;
    if (!rootPath) {
      return null;
    }

    const absolutePath = fromTreePath(rootPath, item.path);
    if (!openPathsRef.current.has(absolutePath)) {
      return null;
    }

    return { text: '●', title: 'Open' };
  }, []);

  const handleSelectionChange = React.useCallback((selectedPaths: readonly string[]) => {
    const selectedTreePath = selectedPaths[selectedPaths.length - 1] ?? null;
    const rootPath = rootRef.current;
    if (!selectedTreePath || !rootPath) {
      return;
    }

    if (syncingSelectionRef.current === selectedTreePath) {
      return;
    }

    const absolutePath = fromTreePath(rootPath, selectedTreePath);
    const isDirectory = selectedTreePath.endsWith('/');
    if (isDirectory) {
      const normalizedPath = normalizePath(absolutePath);
      const comparableTarget = normalizePath(normalizedPath);
      const currentExpandedPaths = expandedPathsRef.current.map((path) => normalizePath(path));
      const nextExpandedPaths = currentExpandedPaths.includes(comparableTarget)
        ? currentExpandedPaths.filter((path) => path !== comparableTarget)
        : [...currentExpandedPaths, comparableTarget];
      onExpandedPathsChange?.(nextExpandedPaths);
      return;
    }

    const name = absolutePath.split('/').pop() || absolutePath;
    const extension = name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined;
    void onFileOpenRef.current({ extension, name, path: absolutePath, type: 'file' });
  }, [onExpandedPathsChange]);

  const { model } = useFileTree({
    composition: {
      contextMenu: {
        buttonVisibility: openMode === 'context-panel' ? 'when-needed' : 'always',
        triggerMode: 'both',
      },
    },
    density: openMode === 'context-panel' ? 'compact' : 'default',
    gitStatus: [],
    icons: TREE_ICONS,
    onSelectionChange: handleSelectionChange,
    paths: [],
    renderRowDecoration,
    search: false,
    stickyFolders: false,
  });

  const loadDirectory = React.useCallback(async (dirPath: string) => {
    const normalizedDir = normalizePath(dirPath.trim());
    if (!normalizedDir) {
      return;
    }

    if (loadedDirsRef.current.has(normalizedDir) || inFlightDirsRef.current.has(normalizedDir)) {
      return;
    }

    inFlightDirsRef.current = new Set(inFlightDirsRef.current);
    inFlightDirsRef.current.add(normalizedDir);
    const requestId = nextDirectoryLoadIdRef.current + 1;
    nextDirectoryLoadIdRef.current = requestId;
    activeDirectoryLoadIdsRef.current = new Map(activeDirectoryLoadIdsRef.current);
    activeDirectoryLoadIdsRef.current.set(normalizedDir, requestId);

    const isCurrentRequest = () => activeDirectoryLoadIdsRef.current.get(normalizedDir) === requestId;
    const respectGitignore = !showGitignored;
    const listPromise = runtime.isDesktop
      ? files.listDirectory(normalizedDir, { respectGitignore }).then((result) => result.entries.map<DirectoryEntryLike>((entry) => ({
        isDirectory: entry.isDirectory,
        name: entry.name,
        path: entry.path,
      })))
      : opencodeClient.listLocalDirectory(normalizedDir, { respectGitignore }).then((result) => result.map<DirectoryEntryLike>((entry) => ({
        isDirectory: entry.isDirectory,
        name: entry.name,
        path: entry.path,
      })));

    await listPromise
      .then((entries) => {
        if (!isCurrentRequest()) {
          return;
        }

        const mapped = mapDirectoryEntries(normalizedDir, entries, {
          showGitignored,
          showHidden,
        });

        loadedDirsRef.current = new Set(loadedDirsRef.current);
        loadedDirsRef.current.add(normalizedDir);
        setChildrenByDir((prev) => ({ ...prev, [normalizedDir]: mapped }));
      })
      .catch(() => {
        if (!isCurrentRequest()) {
          return;
        }
        setChildrenByDir((prev) => ({
          ...prev,
          [normalizedDir]: prev[normalizedDir] ?? [],
        }));
      })
      .finally(() => {
        if (!isCurrentRequest()) {
          return;
        }
        activeDirectoryLoadIdsRef.current = new Map(activeDirectoryLoadIdsRef.current);
        activeDirectoryLoadIdsRef.current.delete(normalizedDir);
        inFlightDirsRef.current = new Set(inFlightDirsRef.current);
        inFlightDirsRef.current.delete(normalizedDir);
      });
  }, [files, runtime.isDesktop, showGitignored, showHidden]);

  const refreshRoot = React.useCallback(async () => {
    if (!normalizedRoot) {
      return;
    }

    loadedDirsRef.current = new Set();
    inFlightDirsRef.current = new Set();
    activeDirectoryLoadIdsRef.current = new Map();
    setChildrenByDir((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    model.resetPaths([]);
    await loadDirectory(normalizedRoot);
  }, [loadDirectory, model, normalizedRoot]);

  const refreshDirectory = React.useCallback(async (dirPath: string) => {
    if (!dirPath) {
      await refreshRoot();
      return;
    }

    const normalizedDir = normalizePath(dirPath);
    loadedDirsRef.current = new Set(loadedDirsRef.current);
    loadedDirsRef.current.delete(normalizedDir);
    inFlightDirsRef.current = new Set(inFlightDirsRef.current);
    inFlightDirsRef.current.delete(normalizedDir);
    activeDirectoryLoadIdsRef.current = new Map(activeDirectoryLoadIdsRef.current);
    activeDirectoryLoadIdsRef.current.delete(normalizedDir);
    await loadDirectory(normalizedDir);
  }, [loadDirectory, refreshRoot]);

  const ensurePathVisible = React.useCallback(async (targetPath: string, includeTarget: boolean) => {
    if (!normalizedRoot || !isPathWithinRoot(targetPath, normalizedRoot)) {
      return;
    }

    const ancestors = getAncestorPaths(targetPath, normalizedRoot);
    const pathsToExpand = includeTarget ? [...ancestors, normalizePath(targetPath)] : ancestors;
    if (pathsToExpand.length > 0) {
      const currentExpanded = expandedPathsRef.current.map((path) => normalizePath(path));
      const nextExpanded = Array.from(new Set([...currentExpanded, ...pathsToExpand]));
      onExpandedPathsChange?.(nextExpanded);
    }

    await Promise.all(pathsToExpand.map((path) => {
      if (!loadedDirsRef.current.has(path)) {
        return loadDirectory(path);
      }
      return Promise.resolve();
    }));
  }, [loadDirectory, normalizedRoot, onExpandedPathsChange]);

  const handleSearchResultOpen = React.useCallback(async (node: OpenChamberFileNode) => {
    await ensurePathVisible(node.path, false);
    await onFileOpen(node);
  }, [ensurePathVisible, onFileOpen]);

  React.useEffect(() => {
    invalidateDirectory(normalizedRoot || undefined);
  }, [invalidateDirectory, normalizedRoot, showGitignored, showHidden]);

  React.useEffect(() => {
    if (!normalizedRoot) {
      setChildrenByDir({});
      setSearchResults([]);
      setSearching(false);
      model.resetPaths([]);
      model.setGitStatus([]);
      return;
    }

    loadedDirsRef.current = new Set();
    inFlightDirsRef.current = new Set();
    activeDirectoryLoadIdsRef.current = new Map();
    setChildrenByDir((prev) => (Object.keys(prev).length === 0 ? prev : {}));
    void loadDirectory(normalizedRoot);
  }, [loadDirectory, model, normalizedRoot, showGitignored, showHidden]);

  React.useEffect(() => {
    if (!normalizedRoot || expandedPaths.length === 0) {
      return;
    }

    const toLoad = expandedPaths
      .map((path) => normalizePath(path))
      .filter((path): path is string => (
        !!path
        && path !== normalizedRoot
        && isPathWithinRoot(path, normalizedRoot)
        && !loadedDirsRef.current.has(path)
        && !inFlightDirsRef.current.has(path)
      ))
      .sort((left, right) => left.split('/').length - right.split('/').length);

    if (toLoad.length === 0) {
      return;
    }

    let cancelled = false;
    void (async () => {
      for (let index = 0; index < toLoad.length && !cancelled; index += 3) {
        await Promise.all(toLoad.slice(index, index + 3).map((path) => loadDirectory(path)));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [expandedPaths, loadDirectory, normalizedRoot]);

  React.useEffect(() => {
    if (!normalizedRoot) {
      return;
    }

    const { paths, preparedInput } = buildPreparedTreeInput(normalizedRoot, childrenByDir);
    const expandedTreePaths = expandedPaths
      .map((path) => normalizePath(path))
      .filter((path) => path && path !== normalizedRoot && isPathWithinRoot(path, normalizedRoot))
      .map((path) => toTreePath(normalizedRoot, path, 'directory'))
      .filter(Boolean);

    previousExpandedTreePathsRef.current = new Set(expandedTreePaths);
    model.resetPaths(paths, {
      initialExpandedPaths: expandedTreePaths,
      preparedInput,
    });
  }, [childrenByDir, expandedPaths, model, normalizedRoot]);

  React.useEffect(() => {
    if (!normalizedRoot) {
      model.setGitStatus([]);
      return;
    }
    model.setGitStatus(buildTreeGitStatus(normalizedRoot, gitStatus));
  }, [gitStatus, model, normalizedRoot]);

  React.useEffect(() => {
    const expandedTreePaths = new Set(expandedPaths
      .map((path) => normalizePath(path))
      .filter((path) => path && path !== normalizedRoot && isPathWithinRoot(path, normalizedRoot))
      .map((path) => toTreePath(normalizedRoot, path, 'directory'))
      .filter(Boolean));

    const previousExpandedTreePaths = previousExpandedTreePathsRef.current;
    for (const treePath of expandedTreePaths) {
      if (previousExpandedTreePaths.has(treePath)) {
        continue;
      }
      const item = model.getItem(treePath);
      if (item?.isDirectory()) {
        (item as FileTreeDirectoryHandle).expand();
      }
    }
    for (const treePath of previousExpandedTreePaths) {
      if (expandedTreePaths.has(treePath)) {
        continue;
      }
      const item = model.getItem(treePath);
      if (item?.isDirectory()) {
        (item as FileTreeDirectoryHandle).collapse();
      }
    }

    previousExpandedTreePathsRef.current = expandedTreePaths;
  }, [expandedPaths, model, normalizedRoot]);

  React.useEffect(() => {
    if (!normalizedRoot || !selectedPath || !isPathWithinRoot(selectedPath, normalizedRoot)) {
      return;
    }

    const selectedTreePath = toTreePath(normalizedRoot, selectedPath, 'file');
    if (!selectedTreePath) {
      return;
    }

    syncingSelectionRef.current = selectedTreePath;
    model.getItem(selectedTreePath)?.select();
    model.focusPath(selectedTreePath);
    queueMicrotask(() => {
      if (syncingSelectionRef.current === selectedTreePath) {
        syncingSelectionRef.current = null;
      }
    });
  }, [model, normalizedRoot, selectedPath]);

  React.useEffect(() => {
    if (!normalizedRoot) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    const trimmedQuery = debouncedSearchQuery.trim();
    if (!trimmedQuery) {
      setSearchResults([]);
      setSearching(false);
      return;
    }

    let cancelled = false;
    setSearching(true);

    searchFiles(normalizedRoot, trimmedQuery, 150, {
      includeHidden: showHidden,
      respectGitignore: !showGitignored,
      type: 'file',
    })
      .then((hits) => {
        if (cancelled) {
          return;
        }
        setSearchResults(hits.map((hit) => ({
          extension: hit.extension,
          name: hit.name,
          path: normalizePath(hit.path),
          relativePath: hit.relativePath,
          type: 'file' as const,
        })));
      })
      .catch(() => {
        if (!cancelled) {
          setSearchResults([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setSearching(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedSearchQuery, normalizedRoot, searchFiles, showGitignored, showHidden]);

  return {
    childrenByDir,
    ensurePathVisible,
    handleSearchResultOpen,
    hasTree: Boolean(normalizedRoot && childrenByDir[normalizedRoot]),
    loadDirectory,
    model,
    refreshDirectory,
    refreshRoot,
    root: normalizedRoot,
    searchQuery,
    searchResults,
    searching,
    setSearchQuery,
  };
};
