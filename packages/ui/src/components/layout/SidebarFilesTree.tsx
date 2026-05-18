import React from 'react';

import { OpenChamberFileTree } from '@/components/files/OpenChamberFileTree';
import { getContextFileOpenFailureMessage, validateContextFileOpen } from '@/lib/contextFileOpenGuard';
import { useDirectoryShowHidden } from '@/lib/directoryShowHidden';
import { useFilesViewShowGitignored } from '@/lib/filesViewShowGitignored';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { toast } from '@/components/ui';
import { useGitStatus } from '@/stores/useGitStore';
import { useFilesViewTabsStore } from '@/stores/useFilesViewTabsStore';
import { useUIStore } from '@/stores/useUIStore';

import type { OpenChamberFileNode } from '@/components/files/fileTreeOperations';

export const SidebarFilesTree: React.FC = () => {
  const { files, runtime } = useRuntimeAPIs();
  const currentDirectory = useEffectiveDirectory() ?? '';
  const root = currentDirectory.trim();
  const showHidden = useDirectoryShowHidden();
  const showGitignored = useFilesViewShowGitignored();
  const gitStatus = useGitStatus(currentDirectory);

  const openContextFile = useUIStore((state) => state.openContextFile);
  const EMPTY_PATHS = React.useMemo<string[]>(() => [], []);
  const EMPTY_CONTEXT_TABS = React.useMemo<Array<{ mode: string; targetPath: string | null }>>(() => [], []);
  const expandedPaths = useFilesViewTabsStore((state) => (root ? (state.byRoot[root]?.expandedPaths ?? EMPTY_PATHS) : EMPTY_PATHS));
  const selectedPath = useFilesViewTabsStore((state) => (root ? (state.byRoot[root]?.selectedPath ?? null) : null));
  const removeOpenPathsByPrefix = useFilesViewTabsStore((state) => state.removeOpenPathsByPrefix);
  const setExpandedPaths = useFilesViewTabsStore((state) => state.setExpandedPaths);
  const setSelectedPath = useFilesViewTabsStore((state) => state.setSelectedPath);
  const addOpenPath = useFilesViewTabsStore((state) => state.addOpenPath);
  const contextTabs = useUIStore((state) => (root ? (state.contextPanelByDirectory[root]?.tabs ?? EMPTY_CONTEXT_TABS) : EMPTY_CONTEXT_TABS));

  const openContextFilePaths = React.useMemo(() => new Set(
    contextTabs
      .map((tab) => (tab.mode === 'file' ? tab.targetPath : null))
      .filter((targetPath): targetPath is string => typeof targetPath === 'string' && targetPath.length > 0),
  ), [contextTabs]);

  const handleFileOpen = React.useCallback(async (node: OpenChamberFileNode) => {
    if (!root) {
      return;
    }

    const openValidation = await validateContextFileOpen(files, node.path);
    if (!openValidation.ok) {
      toast.error(getContextFileOpenFailureMessage(openValidation.reason));
      return;
    }

    setSelectedPath(root, node.path);
    addOpenPath(root, node.path);
    openContextFile(root, node.path);
  }, [addOpenPath, files, openContextFile, root, setSelectedPath]);

  const handleDeletedPath = React.useCallback((deletedPath: string) => {
    if (!root) {
      return;
    }
    removeOpenPathsByPrefix(root, deletedPath);
    if (selectedPath === deletedPath || (selectedPath && selectedPath.startsWith(`${deletedPath}/`))) {
      setSelectedPath(root, null);
    }
  }, [removeOpenPathsByPrefix, root, selectedPath, setSelectedPath]);

  const handleRenamedPath = React.useCallback((oldPath: string) => {
    if (!root) {
      return;
    }
    removeOpenPathsByPrefix(root, oldPath);
    if (selectedPath === oldPath || (selectedPath && selectedPath.startsWith(`${oldPath}/`))) {
      setSelectedPath(root, null);
    }
  }, [removeOpenPathsByPrefix, root, selectedPath, setSelectedPath]);

  return (
    <OpenChamberFileTree
      appearance="sidebar"
      expandedPaths={expandedPaths}
      files={files}
      gitStatus={gitStatus}
      onExpandedPathsChange={(paths) => setExpandedPaths(root, paths)}
      onFileOpen={handleFileOpen}
      onPathDeleted={handleDeletedPath}
      onPathRenamed={handleRenamedPath}
      openMode="context-panel"
      openPaths={openContextFilePaths}
      root={root}
      runtime={runtime}
      selectedPath={selectedPath}
      showGitignored={showGitignored}
      showHidden={showHidden}
    />
  );
};
