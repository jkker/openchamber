import React from 'react';
import { FILE_TREE_TAG_NAME, type ContextMenuItem, type ContextMenuOpenContext } from '@pierre/trees';
import { FileTree } from '@pierre/trees/react';

import { FileTypeIcon } from '@/components/icons/FileTypeIcon';
import { Icon } from '@/components/icon/Icon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { toast } from '@/components/ui';
import { useThemeSystem } from '@/contexts/useThemeSystem';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n';
import type { FilesAPI, GitStatus, RuntimeDescriptor } from '@/lib/api/types';
import { cn, getRevealLabelKey } from '@/lib/utils';

import {
  type OpenChamberFileNode,
  fromTreePath,
  getDisplayPath,
  getMutationRefreshTargets,
  getParentDirectoryPath,
  getRelativePath,
  normalizePath,
  rebaseExpandedPaths,
} from './fileTreeOperations';
import { createFileTreeTheme } from './fileTreeTheme';
import { useOpenChamberFileTree } from './useOpenChamberFileTree';

type OpenChamberFileTreeProps = {
  appearance: 'panel' | 'sidebar';
  expandedPaths: readonly string[];
  files: FilesAPI;
  gitStatus: GitStatus | null | undefined;
  isMobile?: boolean;
  onExpandedPathsChange?: (paths: string[]) => void;
  onFileOpen: (node: OpenChamberFileNode) => Promise<void> | void;
  onPathDeleted?: (deletedPath: string) => void;
  onPathRenamed?: (oldPath: string, newPath: string) => void;
  openMode: 'context-panel' | 'files-editor';
  openPaths: ReadonlySet<string>;
  root: string;
  runtime: RuntimeDescriptor;
  selectedPath: string | null;
  showGitignored: boolean;
  showHidden: boolean;
};

type DialogType = 'createFile' | 'createFolder' | 'rename' | 'delete';

type DialogState = {
  data: { name?: string; path: string; type?: 'file' | 'directory' } | null;
  inputValue: string;
  isSubmitting: boolean;
  type: DialogType | null;
};

const INITIAL_DIALOG_STATE: DialogState = {
  data: null,
  inputValue: '',
  isSubmitting: false,
  type: null,
};

const TreeContextMenu = ({
  canCopyRelativePath,
  canCreateFile,
  canCreateFolder,
  canDelete,
  canRename,
  canReveal,
  context,
  downloadFile,
  item,
  onOpenDialog,
  onRevealPath,
  root,
  t,
}: {
  canCopyRelativePath: boolean;
  canCreateFile: boolean;
  canCreateFolder: boolean;
  canDelete: boolean;
  canRename: boolean;
  canReveal: boolean;
  context: { anchorRect: DOMRect | { top: number; left: number; width: number; height: number }; close: (options?: { restoreFocus?: boolean }) => void };
  downloadFile?: (path: string) => Promise<void>;
  item: { kind: 'directory' | 'file'; path: string; name: string };
  onOpenDialog: (type: DialogType, data: { name?: string; path: string; type?: 'file' | 'directory' }) => void;
  onRevealPath: (path: string) => void;
  root: string;
  t: ReturnType<typeof useI18n>['t'];
}) => {
  const absolutePath = normalizePath(item.path);
  const isDirectory = item.kind === 'directory';
  const anchorStyle = React.useMemo(() => ({
    height: Math.max(1, context.anchorRect.height),
    left: context.anchorRect.left,
    opacity: 0,
    pointerEvents: 'none' as const,
    position: 'fixed' as const,
    top: context.anchorRect.top,
    width: Math.max(1, context.anchorRect.width),
  }), [context.anchorRect]);

  return (
    <DropdownMenu open onOpenChange={(open) => {
      if (!open) {
        context.close();
      }
    }}>
      <DropdownMenuTrigger asChild>
        <span aria-hidden="true" style={anchorStyle} />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        data-file-tree-context-menu-root="true"
        portalToBody
        side="bottom"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          context.close({ restoreFocus: true });
        }}
      >
        {canRename && (
          <DropdownMenuItem onClick={() => onOpenDialog('rename', { name: item.name, path: absolutePath, type: isDirectory ? 'directory' : 'file' })}>
            <Icon name="edit" className="mr-2 size-4" /> {t('sidebarFilesTree.menu.rename')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => {
          void copyTextToClipboard(absolutePath).then((result) => {
            if (result.ok) {
              toast.success(t('sidebarFilesTree.toast.pathCopied'));
              return;
            }
            toast.error(t('sidebarFilesTree.toast.copyFailed'));
          });
        }}>
          <Icon name="file-copy" className="mr-2 size-4" /> {t('sidebarFilesTree.menu.copyPath')}
        </DropdownMenuItem>
        {canCopyRelativePath && (
          <DropdownMenuItem onClick={() => {
            const relativePath = getDisplayPath(root, absolutePath) || absolutePath;
            void copyTextToClipboard(relativePath).then((result) => {
              if (result.ok) {
                toast.success(t('filesView.toast.relativePathCopied'));
                return;
              }
              toast.error(t('sidebarFilesTree.toast.copyFailed'));
            });
          }}>
            <Icon name="file-copy-2" className="mr-2 size-4" /> {t('filesView.tree.menu.copyRelativePath')}
          </DropdownMenuItem>
        )}
        {!isDirectory && downloadFile && (
          <DropdownMenuItem onClick={() => {
            void downloadFile(absolutePath);
          }}>
            <Icon name="download" className="mr-2 size-4" /> {t('sidebarFilesTree.menu.save')}
          </DropdownMenuItem>
        )}
        {canReveal && (
          <DropdownMenuItem onClick={() => onRevealPath(absolutePath)}>
            <Icon name="folder-received" className="mr-2 size-4" /> {t(getRevealLabelKey())}
          </DropdownMenuItem>
        )}
        {isDirectory && (canCreateFile || canCreateFolder) && (
          <>
            <DropdownMenuSeparator />
            {canCreateFile && (
              <DropdownMenuItem onClick={() => onOpenDialog('createFile', { path: absolutePath, type: 'directory' })}>
                <Icon name="file-add" className="mr-2 size-4" /> {t('sidebarFilesTree.menu.newFile')}
              </DropdownMenuItem>
            )}
            {canCreateFolder && (
              <DropdownMenuItem onClick={() => onOpenDialog('createFolder', { path: absolutePath, type: 'directory' })}>
                <Icon name="folder-add" className="mr-2 size-4" /> {t('sidebarFilesTree.menu.newFolder')}
              </DropdownMenuItem>
            )}
          </>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => onOpenDialog('delete', { name: item.name, path: absolutePath, type: isDirectory ? 'directory' : 'file' })}>
              <Icon name="delete-bin" className="mr-2 size-4" /> {t('sidebarFilesTree.menu.delete')}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

const getLabels = (mode: OpenChamberFileTreeProps['openMode']) => (
  mode === 'context-panel'
    ? {
      createFileDescription: 'sidebarFilesTree.dialog.createFile.description',
      createFileTitle: 'sidebarFilesTree.dialog.createFile.title',
      createFolderDescription: 'sidebarFilesTree.dialog.createFolder.description',
      createFolderTitle: 'sidebarFilesTree.dialog.createFolder.title',
      filenameRequired: 'sidebarFilesTree.toast.filenameRequired',
      folderNameRequired: 'sidebarFilesTree.toast.folderNameRequired',
      loading: 'sidebarFilesTree.state.loading',
      namePlaceholder: 'sidebarFilesTree.dialog.namePlaceholder',
      nameRequired: 'sidebarFilesTree.toast.nameRequired',
      newFileTitle: 'sidebarFilesTree.actions.newFileTitle',
      newFolderTitle: 'sidebarFilesTree.actions.newFolderTitle',
      operationFailed: 'sidebarFilesTree.toast.operationFailed',
      pathCopied: 'sidebarFilesTree.toast.pathCopied',
      refreshTitle: 'sidebarFilesTree.actions.refreshTitle',
      renameDescription: 'sidebarFilesTree.dialog.rename.description',
      renamePlaceholder: 'sidebarFilesTree.dialog.rename.placeholder',
      renameTitle: 'sidebarFilesTree.dialog.rename.title',
      revealFailed: 'sidebarFilesTree.toast.revealFailed',
      rootFallback: 'sidebarFilesTree.dialog.rootFallback',
      searchClearAria: 'sidebarFilesTree.search.clearAria',
      searchPlaceholder: 'sidebarFilesTree.search.placeholder',
      searchSearching: 'sidebarFilesTree.state.searching',
      toastDeleteSuccess: 'sidebarFilesTree.toast.deletedSuccessfully',
      toastFileCreated: 'sidebarFilesTree.toast.fileCreated',
      toastFolderCreated: 'sidebarFilesTree.toast.folderCreated',
      toastRenameSuccess: 'sidebarFilesTree.toast.renamedSuccessfully',
      writeNotSupported: 'sidebarFilesTree.toast.writeNotSupported',
      deleteDescription: 'sidebarFilesTree.dialog.delete.description',
      deleteTitle: 'sidebarFilesTree.dialog.delete.title',
      deleteNotSupported: 'sidebarFilesTree.toast.deleteNotSupported',
      renameNotSupported: 'sidebarFilesTree.toast.renameNotSupported',
    } as const
    : {
      createFileDescription: 'filesView.dialog.createFile.description',
      createFileTitle: 'filesView.dialog.createFile.title',
      createFolderDescription: 'filesView.dialog.createFolder.description',
      createFolderTitle: 'filesView.dialog.createFolder.title',
      filenameRequired: 'sidebarFilesTree.toast.filenameRequired',
      folderNameRequired: 'sidebarFilesTree.toast.folderNameRequired',
      loading: 'filesView.state.loading',
      namePlaceholder: 'filesView.dialog.namePlaceholder',
      nameRequired: 'sidebarFilesTree.toast.nameRequired',
      newFileTitle: 'filesView.tree.actions.newFileTitle',
      newFolderTitle: 'filesView.tree.actions.newFolderTitle',
      operationFailed: 'sidebarFilesTree.toast.operationFailed',
      pathCopied: 'sidebarFilesTree.toast.pathCopied',
      refreshTitle: 'sidebarFilesTree.actions.refreshTitle',
      renameDescription: 'filesView.dialog.rename.description',
      renamePlaceholder: 'filesView.dialog.rename.placeholder',
      renameTitle: 'filesView.dialog.rename.title',
      revealFailed: 'sidebarFilesTree.toast.revealFailed',
      rootFallback: 'filesView.dialog.rootFallback',
      searchClearAria: 'filesView.tree.search.clearAria',
      searchPlaceholder: 'filesView.tree.search.placeholder',
      searchSearching: 'filesView.tree.search.searching',
      toastDeleteSuccess: 'sidebarFilesTree.toast.deletedSuccessfully',
      toastFileCreated: 'sidebarFilesTree.toast.fileCreated',
      toastFolderCreated: 'sidebarFilesTree.toast.folderCreated',
      toastRenameSuccess: 'sidebarFilesTree.toast.renamedSuccessfully',
      writeNotSupported: 'sidebarFilesTree.toast.writeNotSupported',
      deleteDescription: 'filesView.dialog.delete.description',
      deleteTitle: 'filesView.dialog.delete.title',
      deleteNotSupported: 'sidebarFilesTree.toast.deleteNotSupported',
      renameNotSupported: 'sidebarFilesTree.toast.renameNotSupported',
    } as const
);

export const OpenChamberFileTree: React.FC<OpenChamberFileTreeProps> = ({
  appearance,
  expandedPaths,
  files,
  gitStatus,
  isMobile = false,
  onExpandedPathsChange,
  onFileOpen,
  onPathDeleted,
  onPathRenamed,
  openMode,
  openPaths,
  root,
  runtime,
  selectedPath,
  showGitignored,
  showHidden,
}) => {
  const { t } = useI18n();
  const { currentTheme } = useThemeSystem();
  const labels = React.useMemo(() => getLabels(openMode), [openMode]);
  const treeStyles = React.useMemo(() => ({
    ...createFileTreeTheme(currentTheme),
    height: '100%',
    width: '100%',
  }), [currentTheme]);

  const {
    handleSearchResultOpen,
    hasTree,
    model,
    refreshDirectory,
    refreshRoot,
    root: normalizedRoot,
    searchQuery,
    searchResults,
    searching,
    setSearchQuery,
  } = useOpenChamberFileTree({
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
  });

  const [dialogState, setDialogState] = React.useState<DialogState>(INITIAL_DIALOG_STATE);
  const searchInputRef = React.useRef<HTMLInputElement>(null);
  const treeContainerRef = React.useRef<HTMLDivElement | null>(null);

  const canCreateFile = Boolean(files.writeFile);
  const canCreateFolder = Boolean(files.createDirectory);
  const canDelete = Boolean(files.delete);
  const canRename = Boolean(files.rename);
  const canReveal = Boolean(files.revealPath);

  const handleRevealPath = React.useCallback((targetPath: string) => {
    if (!files.revealPath) {
      return;
    }
    void files.revealPath(targetPath).catch(() => {
      toast.error(t(labels.revealFailed));
    });
  }, [files, labels.revealFailed, t]);

  const handleOpenDialog = React.useCallback((type: DialogType, data: { name?: string; path: string; type?: 'file' | 'directory' }) => {
    setDialogState({
      data,
      inputValue: type === 'rename' ? data.name || '' : '',
      isSubmitting: false,
      type,
    });
  }, []);

  const handleCloseDialog = React.useCallback(() => {
    setDialogState(INITIAL_DIALOG_STATE);
  }, []);

  const handleDialogSubmit = React.useCallback(async () => {
    if (!dialogState.data || !dialogState.type) {
      return;
    }

    setDialogState((state) => ({ ...state, isSubmitting: true }));
    const finish = () => setDialogState((state) => ({ ...state, isSubmitting: false }));

    if (dialogState.type === 'createFile') {
      if (!dialogState.inputValue.trim()) {
        toast.error(t(labels.filenameRequired));
        finish();
        return;
      }
      if (!files.writeFile) {
        toast.error(t(labels.writeNotSupported));
        finish();
        return;
      }

      const parentPath = dialogState.data.path;
      const newPath = normalizePath(`${parentPath ? `${parentPath}/` : ''}${dialogState.inputValue.trim()}`);
      await files.writeFile(newPath, '')
        .then(async (result) => {
          if (result.success) {
            toast.success(t(labels.toastFileCreated));
            await Promise.all(getMutationRefreshTargets({
              expandedPaths,
              newPath,
              parentPath,
              type: 'create',
            }).map((path) => refreshDirectory(path)));
          }
          handleCloseDialog();
        })
        .catch(() => {
          toast.error(t(labels.operationFailed));
        })
        .finally(finish);
      return;
    }

    if (dialogState.type === 'createFolder') {
      if (!dialogState.inputValue.trim()) {
        toast.error(t(labels.folderNameRequired));
        finish();
        return;
      }

      const parentPath = dialogState.data.path;
      const newPath = normalizePath(`${parentPath ? `${parentPath}/` : ''}${dialogState.inputValue.trim()}`);
      await files.createDirectory(newPath)
        .then(async (result) => {
          if (result.success) {
            toast.success(t(labels.toastFolderCreated));
            await Promise.all(getMutationRefreshTargets({
              expandedPaths,
              newPath,
              parentPath,
              type: 'create',
            }).map((path) => refreshDirectory(path)));
          }
          handleCloseDialog();
        })
        .catch(() => {
          toast.error(t(labels.operationFailed));
        })
        .finally(finish);
      return;
    }

    if (dialogState.type === 'rename') {
      if (!dialogState.inputValue.trim()) {
        toast.error(t(labels.nameRequired));
        finish();
        return;
      }
      if (!files.rename) {
        toast.error(t(labels.renameNotSupported));
        finish();
        return;
      }

      const oldPath = dialogState.data.path;
      const parentPath = getParentDirectoryPath(oldPath);
      const newPath = normalizePath(`${parentPath ? `${parentPath}/` : ''}${dialogState.inputValue.trim()}`);

      await files.rename(oldPath, newPath)
        .then(async (result) => {
          if (result.success) {
            toast.success(t(labels.toastRenameSuccess));
            if (dialogState.data?.type === 'directory') {
              onExpandedPathsChange?.(rebaseExpandedPaths(expandedPaths, oldPath, newPath));
            }
            onPathRenamed?.(oldPath, newPath);
            await Promise.all(getMutationRefreshTargets({
              expandedPaths,
              newPath: dialogState.data?.type === 'directory' ? newPath : null,
              oldPath,
              parentPath,
              type: 'rename',
            }).map((path) => refreshDirectory(path)));
          }
          handleCloseDialog();
        })
        .catch(() => {
          toast.error(t(labels.operationFailed));
        })
        .finally(finish);
      return;
    }

    if (!files.delete) {
      toast.error(t(labels.deleteNotSupported));
      finish();
      return;
    }

    const deletedPath = dialogState.data.path;
    const parentPath = getParentDirectoryPath(deletedPath);
    await files.delete(deletedPath)
      .then(async (result) => {
        if (result.success) {
          toast.success(t(labels.toastDeleteSuccess));
          if (dialogState.data?.type === 'directory') {
            onExpandedPathsChange?.(rebaseExpandedPaths(expandedPaths, deletedPath, null));
          }
          onPathDeleted?.(deletedPath);
          await Promise.all(getMutationRefreshTargets({
            expandedPaths,
            oldPath: deletedPath,
            parentPath,
            type: 'delete',
          }).map((path) => refreshDirectory(path)));
        }
        handleCloseDialog();
      })
      .catch(() => {
        toast.error(t(labels.operationFailed));
      })
      .finally(finish);
  }, [
    dialogState.data,
    dialogState.inputValue,
    dialogState.type,
    expandedPaths,
    files,
    handleCloseDialog,
    labels.deleteNotSupported,
    labels.filenameRequired,
    labels.folderNameRequired,
    labels.nameRequired,
    labels.operationFailed,
    labels.renameNotSupported,
    labels.toastDeleteSuccess,
    labels.toastFileCreated,
    labels.toastFolderCreated,
    labels.toastRenameSuccess,
    labels.writeNotSupported,
    onExpandedPathsChange,
    onPathDeleted,
    onPathRenamed,
    refreshDirectory,
    t,
  ]);

  React.useEffect(() => {
    const treeHost = treeContainerRef.current?.querySelector(FILE_TREE_TAG_NAME) as HTMLElement | null;
    const shadowRoot = treeHost?.shadowRoot;
    if (!shadowRoot || !normalizedRoot) {
      return;
    }

    const applyDraggable = () => {
      shadowRoot.querySelectorAll<HTMLElement>('[data-item-path][data-item-type="file"]').forEach((element) => {
        element.setAttribute('draggable', 'true');
      });
    };

    const handleDragStart: EventListener = (event) => {
      if (!(event instanceof DragEvent)) {
        return;
      }
      const element = (event.target as Element | null)?.closest('[data-item-path][data-item-type="file"]') as HTMLElement | null;
      const treePath = element?.getAttribute('data-item-path');
      if (!treePath || !event.dataTransfer) {
        return;
      }

      const absolutePath = fromTreePath(normalizedRoot, treePath);
      const relativePath = getRelativePath(normalizedRoot, absolutePath);
      if (!relativePath || relativePath === '.') {
        return;
      }

      event.dataTransfer.setData('application/x-openchamber-file-path', relativePath);
      event.dataTransfer.effectAllowed = 'copy';
    };

    applyDraggable();
    const observer = new MutationObserver(applyDraggable);
    observer.observe(shadowRoot, { childList: true, subtree: true });
    shadowRoot.addEventListener('dragstart', handleDragStart);

    return () => {
      observer.disconnect();
      shadowRoot.removeEventListener('dragstart', handleDragStart);
    };
  }, [normalizedRoot, searchResults.length]);

  return (
    <section className={cn(
      'flex min-h-0 flex-col overflow-hidden',
      appearance === 'sidebar'
        ? 'h-full bg-sidebar'
        : isMobile
          ? 'h-full w-full bg-background'
          : 'h-full rounded-xl border border-border/60 bg-background/70',
    )}>
      <div className={cn(
        'flex items-center gap-2',
        appearance === 'sidebar' ? 'border-b border-border/40 px-3 py-2' : isMobile ? 'px-3 py-2' : 'px-2 py-2',
      )}>
        <div className="relative min-w-0 flex-1">
          <Icon name="search" className="pointer-events-none absolute left-2 top-2 size-4 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t(labels.searchPlaceholder)}
            className="h-8 pl-8 pr-8 typography-meta"
          />
          {searchQuery.trim().length > 0 ? (
            <button
              type="button"
              aria-label={t(labels.searchClearAria)}
              className="absolute right-2 top-2 inline-flex size-4 items-center justify-center text-muted-foreground hover:text-foreground"
              onClick={() => {
                setSearchQuery('');
                searchInputRef.current?.focus();
              }}
            >
              <Icon name="close" className="size-4" />
            </button>
          ) : null}
        </div>
        {canCreateFile && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleOpenDialog('createFile', { path: normalizedRoot, type: 'directory' })}
            className="size-8 flex-shrink-0 p-0"
            title={t(labels.newFileTitle)}
          >
            <Icon name="file-add" className="size-4" />
          </Button>
        )}
        {canCreateFolder && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleOpenDialog('createFolder', { path: normalizedRoot, type: 'directory' })}
            className="size-8 flex-shrink-0 p-0"
            title={t(labels.newFolderTitle)}
          >
            <Icon name="folder-add" className="size-4" />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void refreshRoot()}
          className="size-8 flex-shrink-0 p-0"
          title={t(labels.refreshTitle)}
        >
          <Icon name="refresh" className="size-4" />
        </Button>
      </div>

      <div ref={treeContainerRef} className="flex-1 min-h-0 overflow-hidden">
        {searching || searchResults.length > 0 ? (
          <ScrollableOverlay outerClassName="flex-1 min-h-0" className={cn('py-2', appearance === 'sidebar' ? 'px-2' : isMobile ? 'px-3' : 'px-2')}>
            <ul className="flex flex-col">
              {searching ? (
                <li className="flex items-center gap-1.5 px-2 py-1 typography-meta text-muted-foreground">
                  <Icon name="loader-4" className="size-4 animate-spin" />
                  {t(labels.searchSearching)}
                </li>
              ) : searchResults.map((node) => {
                const isActive = selectedPath === node.path;
                return (
                  <li key={node.path}>
                    <button
                      type="button"
                      onClick={() => void handleSearchResultOpen(node)}
                      draggable
                      onDragStart={(event) => {
                        const relativePath = node.relativePath || getRelativePath(normalizedRoot, node.path);
                        if (!relativePath || relativePath === '.') {
                          return;
                        }
                        event.dataTransfer.setData('application/x-openchamber-file-path', relativePath);
                        event.dataTransfer.effectAllowed = 'copy';
                      }}
                      className={cn(
                        'flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-foreground transition-colors',
                        isActive ? 'bg-interactive-selection/70' : 'hover:bg-interactive-hover/40',
                      )}
                      title={node.path}
                    >
                      <FileTypeIcon filePath={node.path} extension={node.extension} />
                      <span className="min-w-0 flex-1 truncate typography-meta" style={{ direction: 'rtl', textAlign: 'left' }}>
                        {node.relativePath ?? node.path}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </ScrollableOverlay>
        ) : hasTree ? (
          <FileTree
            model={model}
            renderContextMenu={(item: ContextMenuItem, context: ContextMenuOpenContext) => (
              <TreeContextMenu
                canCopyRelativePath={openMode === 'files-editor'}
                canCreateFile={canCreateFile}
                canCreateFolder={canCreateFolder}
                canDelete={canDelete}
                canRename={canRename}
                canReveal={canReveal}
                context={{
                  anchorRect: context.anchorRect as DOMRect,
                  close: context.close,
                }}
                downloadFile={files.downloadFile}
                item={{ kind: item.kind, name: item.name, path: fromTreePath(normalizedRoot, item.path) }}
                onOpenDialog={handleOpenDialog}
                onRevealPath={handleRevealPath}
                root={normalizedRoot}
                t={t}
              />
            )}
            className="h-full w-full"
            style={treeStyles}
          />
        ) : (
          <div className="px-3 py-2 typography-meta text-muted-foreground">{t(labels.loading)}</div>
        )}
      </div>

      <Dialog open={Boolean(dialogState.type)} onOpenChange={(open) => !open && handleCloseDialog()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {dialogState.type === 'createFile' && t(labels.createFileTitle)}
              {dialogState.type === 'createFolder' && t(labels.createFolderTitle)}
              {dialogState.type === 'rename' && t(labels.renameTitle)}
              {dialogState.type === 'delete' && t(labels.deleteTitle)}
            </DialogTitle>
            <DialogDescription>
              {dialogState.type === 'createFile' && t(labels.createFileDescription, { path: dialogState.data?.path ?? t(labels.rootFallback) })}
              {dialogState.type === 'createFolder' && t(labels.createFolderDescription, { path: dialogState.data?.path ?? t(labels.rootFallback) })}
              {dialogState.type === 'rename' && t(labels.renameDescription, { name: dialogState.data?.name ?? '' })}
              {dialogState.type === 'delete' && t(labels.deleteDescription, { name: dialogState.data?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          {dialogState.type !== 'delete' && (
            <div className="py-4">
              <Input
                value={dialogState.inputValue}
                onChange={(event) => setDialogState((state) => ({ ...state, inputValue: event.target.value }))}
                placeholder={dialogState.type === 'rename' ? t(labels.renamePlaceholder) : t(labels.namePlaceholder)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleDialogSubmit();
                  }
                }}
                autoFocus
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={handleCloseDialog} disabled={dialogState.isSubmitting}>
              {t('filesView.dialog.cancel')}
            </Button>
            <Button
              variant={dialogState.type === 'delete' ? 'destructive' : 'default'}
              onClick={() => void handleDialogSubmit()}
              disabled={dialogState.isSubmitting || (dialogState.type !== 'delete' && !dialogState.inputValue.trim())}
            >
              {dialogState.isSubmitting ? <Icon name="loader-4" className="animate-spin" /> : (
                dialogState.type === 'delete' ? t('filesView.dialog.delete.confirm') : t('filesView.dialog.confirm')
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
};
