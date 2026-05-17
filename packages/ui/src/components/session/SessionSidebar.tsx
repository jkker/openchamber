import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import { toast } from '@/components/ui';
import { copyTextToClipboard } from '@/lib/clipboard';
import { isDesktopLocalOriginActive, isDesktopShell, isTauriShell, requestDirectoryAccess } from '@/lib/desktop';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  useDroppable,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';

import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { GridLoader } from '@/components/ui/grid-loader';
import { MobileOverlayPanel } from '@/components/ui/MobileOverlayPanel';
import {
  RiAddLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiCheckboxBlankLine,
  RiCheckboxLine,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiErrorWarningLine,
  RiFileCopyLine,
  RiFolderAddLine,
  RiFolderLine,
  RiGitBranchLine,
  RiLoopLeftLine,
  RiNodeTree,
  RiStickyNoteLine,
  RiLinkUnlinkM,

  RiGithubLine,

  RiMore2Line,
  RiPencilAiLine,
  RiPushpinLine,
  RiShare2Line,
  RiShieldLine,
  RiUnpinLine,
} from '@remixicon/react';
import { sessionEvents } from '@/lib/sessionEvents';
import { formatDirectoryName, cn } from '@/lib/utils';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useAllLiveSessions, useAllSessionStatuses } from '@/sync/sync-context';
import { useDirectoryStore } from '@/stores/useDirectoryStore';
import { useSync } from '@/sync/use-sync';
import { useSessionPrefetch } from './sidebar/hooks/useSessionPrefetch';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useUIStore } from '@/stores/useUIStore';
import { useAgentLoopStore } from '@/stores/useAgentLoopStore';
import { useConfigStore } from '@/stores/useConfigStore';
import { useInstancesStore } from '@/stores/useInstancesStore';
import type { WorktreeMetadata } from '@/types/worktree';
import { opencodeClient } from '@/lib/opencode/client';
import { checkIsGitRepository } from '@/lib/gitApi';
import { getSafeStorage } from '@/stores/utils/safeStorage';
import { createWorktreeOnly, createWorktreeSession } from '@/lib/worktreeSessionCreator';
import { getRootBranch } from '@/lib/worktrees/worktreeStatus';
import { useGitStore } from '@/stores/useGitStore';
import { useDeviceInfo } from '@/lib/device';
import { updateDesktopSettings } from '@/lib/persistence';
import { GitHubIssuePickerDialog } from './GitHubIssuePickerDialog';
import { GitHubPullRequestPickerDialog } from './GitHubPullRequestPickerDialog';
import { ProjectNotesTodoPanel } from './ProjectNotesTodoPanel';
import { BranchPickerDialog } from './BranchPickerDialog';
import { useSessionFoldersStore } from '@/stores/useSessionFoldersStore';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useArchivedAutoFolders } from './sidebar/hooks/useArchivedAutoFolders';
import { useSessionSidebarSections } from './sidebar/hooks/useSessionSidebarSections';
import { useProjectSessionSelection } from './sidebar/hooks/useProjectSessionSelection';
import { useGroupOrdering } from './sidebar/hooks/useGroupOrdering';
import { useSessionGrouping } from './sidebar/hooks/useSessionGrouping';
import { useSessionSearchEffects } from './sidebar/hooks/useSessionSearchEffects';
import { useSessionActions } from './sidebar/hooks/useSessionActions';
import { useSidebarPersistence } from './sidebar/hooks/useSidebarPersistence';
import { useProjectRepoStatus } from './sidebar/hooks/useProjectRepoStatus';
import { useProjectSessionLists } from './sidebar/hooks/useProjectSessionLists';
import { useSessionFolderCleanup } from './sidebar/hooks/useSessionFolderCleanup';
import { getCompatibleSessionParentId } from '@/sync/compat';
import { useStickyProjectHeaders } from './sidebar/hooks/useStickyProjectHeaders';
import { getGitHubPrStatusKey, usePrVisualSummaryByKeys, useGitHubPrStatusStore } from '@/stores/useGitHubPrStatusStore';
import { ProjectEditDialog } from '@/components/layout/ProjectEditDialog';
import { UpdateDialog } from '@/components/ui/UpdateDialog';
import { Icon } from "@/components/icon/Icon";
import { SessionGroupSection } from './sidebar/SessionGroupSection';
import { SidebarHeader } from './sidebar/SidebarHeader';
import { SidebarActivitySections } from './sidebar/SidebarActivitySections';
import { SidebarFooter } from './sidebar/SidebarFooter';
import { SidebarProjectsList } from './sidebar/SidebarProjectsList';
import { SessionNodeItem } from './sidebar/SessionNodeItem';
import { useUpdateStore } from '@/stores/useUpdateStore';
import { useShallow } from 'zustand/react/shallow';
import { listProjectWorktrees } from '@/lib/worktrees/worktreeManager';
import type { WorktreeMetadata } from '@/types/worktree';
import type { SortableDragHandleProps } from './sidebar/sortableItems';
import {
  BulkSessionDeleteConfirmDialog,
  FolderDeleteConfirmDialog,
  SessionDeleteConfirmDialog,
  type BulkDeleteSessionsConfirmState,
  type DeleteFolderConfirmState,
  type DeleteSessionConfirmState,
} from './sidebar/ConfirmDialogs';
import { type SessionGroup, type SessionNode, getSessionParentId } from './sidebar/types';
import {
  addActiveNowSession,
  persistActiveNowEntries,
  pruneActiveNowEntries,
  readActiveNowEntries,
} from './sidebar/activitySections';
import { useActiveNowStore } from '@/stores/useActiveNowStore';
import { useSessionPinnedStore } from '@/stores/useSessionPinnedStore';
import {
  compareSessionsByPinnedAndTime,
  formatProjectLabel,
  normalizePath,
} from './sidebar/utils';
import { refreshGlobalSessions, resolveGlobalSessionDirectory, useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import { useGitHubAuthStore } from '@/stores/useGitHubAuthStore';
import { subscribeOpenchamberEvents } from '@/lib/openchamberEvents';

const PROJECT_COLLAPSE_STORAGE_KEY = 'oc.sessions.projectCollapse';
const GROUP_ORDER_STORAGE_KEY = 'oc.sessions.groupOrder';
const GROUP_COLLAPSE_STORAGE_KEY = 'oc.sessions.groupCollapse';
const PROJECT_ACTIVE_SESSION_STORAGE_KEY = 'oc.sessions.activeSessionByProject';
const SESSION_EXPANDED_STORAGE_KEY = 'oc.sessions.expandedParents';
const SESSION_PINNED_STORAGE_KEY = 'oc.sessions.pinned';

type PrVisualState = 'draft' | 'open' | 'blocked' | 'merged' | 'closed';

type PrIndicator = {
  visualState: PrVisualState;
  number: number;
  url: string | null;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  title: string | null;
  base: string | null;
  head: string | null;
  checks: {
    state: 'success' | 'failure' | 'pending' | 'unknown';
    total: number;
    success: number;
    failure: number;
    pending: number;
  } | null;
  canMerge: boolean | null;
  mergeableState: string | null;
  repo: {
    owner: string;
    repo: string;
  } | null;
};

const buildKnownSessionDirectories = (
  projects: Array<{ path: string }>,
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>,
): Set<string> => {
  const directories = new Set<string>();
  for (const project of projects) {
    const normalized = normalizePath(project.path)?.toLowerCase();
    if (normalized) directories.add(normalized);
  }
  for (const worktrees of availableWorktreesByProject.values()) {
    for (const worktree of worktrees) {
      const normalized = normalizePath(worktree.path)?.toLowerCase();
      if (normalized) directories.add(normalized);
    }
  }
  return directories;
};

const isKnownActiveSessionDirectory = (session: Session, knownDirectories: Set<string>): boolean => {
  if (session.time?.archived) return true;
  const directory = normalizePath(resolveGlobalSessionDirectory(session))?.toLowerCase();
  if (!directory) return true;
  if (knownDirectories.size === 0) return true;
  return knownDirectories.has(directory);
};

const getSessionUpdatedAt = (session: Session): number => {
  return toFiniteNumber(session.time?.updated) ?? toFiniteNumber(session.time?.created) ?? 0;
};

const compareSessionsByPinnedAndTime = (
  a: Session,
  b: Session,
  pinnedSessionIds: Set<string>
): number => {
  const aPinned = pinnedSessionIds.has(a.id);
  const bPinned = pinnedSessionIds.has(b.id);
  if (aPinned !== bPinned) {
    return aPinned ? -1 : 1;
  }

  if (aPinned && bPinned) {
    return getSessionCreatedAt(b) - getSessionCreatedAt(a);
  }

  return getSessionUpdatedAt(b) - getSessionUpdatedAt(a);
};

// Format project label: kebab-case/snake_case → Title Case
const formatProjectLabel = (label: string): string => {
  return label
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
};

const renderHighlightedText = (text: string, query: string): React.ReactNode => {
  if (!query) {
    return text;
  }

  const loweredText = text.toLowerCase();
  const loweredQuery = query.toLowerCase();
  const queryLength = loweredQuery.length;
  if (queryLength === 0) {
    return text;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let matchIndex = loweredText.indexOf(loweredQuery, cursor);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }
    const matchText = text.slice(matchIndex, matchIndex + queryLength);
    parts.push(
      <mark
        key={`${matchIndex}-${matchText}`}
        className="bg-primary text-primary-foreground ring-1 ring-primary/90"
      >
        {matchText}
      </mark>,
    );
    cursor = matchIndex + queryLength;
    matchIndex = loweredText.indexOf(loweredQuery, cursor);
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return parts.length > 0 ? parts : text;
};

type SessionNode = {
  session: Session;
  children: SessionNode[];
  worktree: WorktreeMetadata | null;
};

type SessionGroup = {
  id: string;
  label: string;
  branch: string | null;
  description: string | null;
  isMain: boolean;
  worktree: WorktreeMetadata | null;
  directory: string | null;
  sessions: SessionNode[];
};

type GroupSearchData = {
  filteredNodes: SessionNode[];
  matchedSessionCount: number;
  folderNameMatchCount: number;
  groupMatches: boolean;
  hasMatch: boolean;
};

// --- Session Folder DnD helpers ---

/**
 * Wraps a session row so the entire row is draggable onto folder drop zones.
 * Stops pointer propagation so the outer group-reorder DndContext does not
 * capture the drag (otherwise dragging a session moves the whole workspace group).
 */
const DraggableSessionRow: React.FC<{
  sessionId: string;
  sessionDirectory: string | null;
  sessionTitle: string;
  children: React.ReactNode;
}> = ({ sessionId, sessionDirectory, sessionTitle, children }) => {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `session-drag:${sessionId}`,
    data: { type: 'session', sessionId, sessionDirectory, sessionTitle },
  });

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Stop event from bubbling to the outer group-reorder DndContext
      e.stopPropagation();
      if (listeners?.onPointerDown) {
        (listeners.onPointerDown as (event: React.PointerEvent) => void)(e);
      }
    },
    [listeners],
  );

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      onPointerDown={handlePointerDown}
      className={isDragging ? 'opacity-30' : undefined}
    >
      {children}
    </div>
  );
};

/**
 * Wraps a <SessionFolderItem> and makes it a droppable target.
 * Uses a render-prop pattern so the ref/isOver state can be passed
 * down as props (avoids hooks-in-callbacks restrictions).
 */
const DroppableFolderWrapper: React.FC<{
  folderId: string;
  children: (
    droppableRef: (node: HTMLElement | null) => void,
    isOver: boolean,
  ) => React.ReactNode;
}> = ({ folderId, children }) => {
  const { setNodeRef, isOver } = useDroppable({
    id: `folder-drop:${folderId}`,
    data: { type: 'folder', folderId },
  });
  return <>{children(setNodeRef, isOver)}</>;
};

/**
 * Provides an inner DndContext scoped to one group, allowing sessions to be
 * dragged onto folder headers within that group.
 */
const SessionFolderDndScope: React.FC<{
  scopeKey: string | null;
  hasFolders: boolean;
  onSessionDroppedOnFolder: (sessionId: string, folderId: string) => void;
  children: React.ReactNode;
}> = ({ scopeKey, hasFolders, onSessionDroppedOnFolder, children }) => {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );
  const [activeDragId, setActiveDragId] = React.useState<string | null>(null);
  const [activeDragTitle, setActiveDragTitle] = React.useState<string>('Session');
  const [activeDragWidth, setActiveDragWidth] = React.useState<number | null>(null);
  const [activeDragHeight, setActiveDragHeight] = React.useState<number | null>(null);

  // Always need DndContext when scopeKey exists (DraggableSessionRow requires it).
  // When there are no folders the drag just has nowhere to land – that's fine.
  if (!scopeKey) {
    return <>{children}</>;
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveDragId(null);
    setActiveDragWidth(null);
    setActiveDragHeight(null);
    const { active, over } = event;
    if (!over) return;
    const activeData = active.data.current as { type?: string; sessionId?: string } | undefined;
    const overData = over.data.current as { type?: string; folderId?: string } | undefined;
    if (activeData?.type === 'session' && activeData.sessionId && overData?.type === 'folder' && overData.folderId) {
      onSessionDroppedOnFolder(activeData.sessionId, overData.folderId);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={(event) => {
        const data = event.active.data.current as { type?: string; sessionId?: string; sessionTitle?: string } | undefined;
        if (data?.type === 'session' && data.sessionId) {
          setActiveDragId(data.sessionId);
          setActiveDragTitle(data.sessionTitle ?? 'Session');
          const width = event.active.rect.current.initial?.width;
          const height = event.active.rect.current.initial?.height;
          setActiveDragWidth(typeof width === 'number' ? width : null);
          setActiveDragHeight(typeof height === 'number' ? height : null);
        }
      }}
      onDragCancel={() => {
        setActiveDragId(null);
        setActiveDragWidth(null);
        setActiveDragHeight(null);
      }}
      onDragEnd={handleDragEnd}
    >
      {children}
      <DragOverlay>
        {activeDragId && hasFolders ? (
          <div
            style={{
              width: activeDragWidth ? `${activeDragWidth}px` : 'auto',
              height: activeDragHeight ? `${activeDragHeight}px` : 'auto'
            }}
            className="flex items-center rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] px-2.5 py-1 shadow-none pointer-events-none"
          >
            <RiStickyNoteLine className="h-4 w-4 text-muted-foreground mr-2 flex-shrink-0" />
            <div className="min-w-0 flex-1 truncate typography-ui-label font-normal text-foreground">
              {activeDragTitle}
            </div>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
};

// --- End Session Folder DnD helpers ---

interface SortableProjectItemProps {
  id: string;
  projectLabel: string;
  projectDescription: string;
  isCollapsed: boolean;
  isActiveProject: boolean;
  isRepo: boolean;
  isHovered: boolean;
  isDesktopShell: boolean;
  isStuck: boolean;
  hideDirectoryControls: boolean;
  mobileVariant: boolean;
  onToggle: () => void;
  onHoverChange: (hovered: boolean) => void;
  onNewSession: () => void;
  onNewWorktreeSession?: () => void;
  onOpenMultiRunLauncher: () => void;
  onOpenAgentLoopLauncher: () => void;
  onRenameStart: () => void;
  onRenameSave: () => void;
  onRenameCancel: () => void;
  onRenameValueChange: (value: string) => void;
  renameValue: string;
  isRenaming: boolean;
  onClose: () => void;
  sentinelRef: (el: HTMLDivElement | null) => void;
  children?: React.ReactNode;
  settingsAutoCreateWorktree: boolean;
  showCreateButtons?: boolean;
  hideHeader?: boolean;
}

const SortableProjectItem: React.FC<SortableProjectItemProps> = ({
  id,
  projectLabel,
  projectDescription,
  isCollapsed,
  isActiveProject,
  isRepo,
  isHovered,
  isDesktopShell,
  isStuck,
  hideDirectoryControls,
  mobileVariant,
  onToggle,
  onHoverChange,
  onNewSession,
  onNewWorktreeSession,
  onOpenMultiRunLauncher,
  onOpenAgentLoopLauncher,
  onRenameStart,
  onRenameSave,
  onRenameCancel,
  onRenameValueChange,
  renameValue,
  isRenaming,
  onClose,
  sentinelRef,
  children,
  settingsAutoCreateWorktree,
  showCreateButtons = true,
  hideHeader = false,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const [isMenuOpen, setIsMenuOpen] = React.useState(false);

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('relative', isDragging && 'opacity-30')}
    >
      {!hideHeader ? (
        <>
          {/* Sentinel for sticky detection */}
          {isDesktopShell && (
            <div
              ref={sentinelRef}
              data-project-id={id}
              className="absolute top-0 h-px w-full pointer-events-none"
              aria-hidden="true"
            />
          )}

          {/* Project header - sticky like workspace groups */}
          <div
            className={cn(
              'sticky top-0 z-10 pt-2 pb-1.5 w-full text-left cursor-pointer group/project border-b select-none',
              !isDesktopShell && 'bg-transparent',
            )}
            style={{
              backgroundColor: isDesktopShell
                ? (isStuck ? 'transparent' : 'transparent')
                : undefined,
              borderColor: isHovered
                ? 'var(--color-border-hover)'
                : isCollapsed
                  ? 'color-mix(in srgb, var(--color-border) 35%, transparent)'
                  : 'var(--color-border)'
            }}
            onMouseEnter={() => onHoverChange(true)}
            onMouseLeave={() => onHoverChange(false)}
            onContextMenu={(event) => {
              event.preventDefault();
              if (!isRenaming) {
                setIsMenuOpen(true);
              }
            }}
          >
        <div className="relative flex items-center gap-1 px-1" {...attributes}>
          {isRenaming ? (
            <form
              className="flex min-w-0 flex-1 items-center gap-2"
              data-keyboard-avoid="true"
              onSubmit={(event) => {
                event.preventDefault();
                onRenameSave();
              }}
            >
              <input
                value={renameValue}
                onChange={(event) => onRenameValueChange(event.target.value)}
                className="flex-1 min-w-0 bg-transparent typography-ui-label outline-none placeholder:text-muted-foreground"
                autoFocus
                placeholder="Rename project"
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation();
                    onRenameCancel();
                    return;
                  }
                  if (event.key === ' ' || event.key === 'Enter') {
                    event.stopPropagation();
                  }
                }}
              />
              <button
                type="submit"
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <RiCheckLine className="size-4" />
              </button>
              <button
                type="button"
                onClick={onRenameCancel}
                className="shrink-0 text-muted-foreground hover:text-foreground"
              >
                <RiCloseLine className="size-4" />
              </button>
            </form>
          ) : (
            <Tooltip delayDuration={1500}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onToggle}
                  {...listeners}
                  className="flex-1 min-w-0 flex items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 rounded-sm cursor-grab active:cursor-grabbing"
                >
                  <span className={cn(
                    "typography-ui font-semibold truncate",
                    isActiveProject ? "text-primary" : "text-foreground group-hover/project:text-foreground"
                  )}>
                    {projectLabel}
                  </span>
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" sideOffset={8}>
                {projectDescription}
              </TooltipContent>
            </Tooltip>
          )}

          {!isRenaming ? (
            <DropdownMenu
              open={isMenuOpen}
              onOpenChange={setIsMenuOpen}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    'inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 hover:text-foreground',
                    mobileVariant ? 'opacity-70' : 'opacity-0 group-hover/project:opacity-100',
                  )}
                  aria-label="Project menu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <RiMore2Line className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[180px]">
                {showCreateButtons && isRepo && !hideDirectoryControls && settingsAutoCreateWorktree && onNewSession && (
                  <DropdownMenuItem onClick={onNewSession}>
                    <RiAddLine className="mr-1.5 h-4 w-4" />
                    New Session
                  </DropdownMenuItem>
                )}
                {showCreateButtons && isRepo && !hideDirectoryControls && !settingsAutoCreateWorktree && onNewWorktreeSession && (
                  <DropdownMenuItem onClick={onNewWorktreeSession}>
                    <RiGitBranchLine className="mr-1.5 h-4 w-4" />
                    New Session in Worktree
                  </DropdownMenuItem>
                )}
                {showCreateButtons && isRepo && !hideDirectoryControls && (
                  <DropdownMenuItem onClick={onOpenMultiRunLauncher}>
                    <ArrowsMerge className="mr-1.5 h-4 w-4" />
                    New Multi-Run
                  </DropdownMenuItem>
                )}
                {showCreateButtons && !hideDirectoryControls && (
                  <DropdownMenuItem onClick={onOpenAgentLoopLauncher}>
                    <RiLoopLeftLine className="mr-1.5 h-4 w-4" />
                    New Agent Loop
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={onRenameStart}>
                  <RiPencilAiLine className="mr-1.5 h-4 w-4" />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={onClose}
                  className="text-destructive focus:text-destructive"
                >
                  <RiCloseLine className="mr-1.5 h-4 w-4" />
                  Close Project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          {showCreateButtons && isRepo && !hideDirectoryControls && onNewWorktreeSession && settingsAutoCreateWorktree && !isRenaming && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNewWorktreeSession();
                  }}
                  className={cn(
                    'inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 hover:text-foreground hover:bg-interactive-hover/50 flex-shrink-0',
                    mobileVariant ? 'opacity-70' : 'opacity-100',
                  )}
                  aria-label="New session in worktree"
                >
                  <RiGitBranchLine className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                <p>New session in worktree</p>
              </TooltipContent>
            </Tooltip>
          )}
          {showCreateButtons && (!settingsAutoCreateWorktree || !isRepo) && !isRenaming && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onNewSession();
                  }}
                  className="inline-flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 flex-shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  aria-label="New session"
                >
                  <RiAddLine className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" sideOffset={4}>
                <p>New session</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
          </div>
        </>
      ) : null}

      {/* Children (workspace groups and sessions) */}
      {children}
    </div>
  );
};

const SortableGroupItemBase: React.FC<{
  id: string;
  children: React.ReactNode;
}> = ({ id, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        'space-y-0.5 rounded-md',
        isDragging && 'opacity-50',
      )}
      {...attributes}
      {...listeners}
    >
      {children}
    </div>
  );
};

const SortableGroupItem = React.memo(SortableGroupItemBase);



interface SessionSidebarProps {
  mobileVariant?: boolean;
  onSessionSelected?: (sessionId: string) => void;
  allowReselect?: boolean;
  hideDirectoryControls?: boolean;
  showOnlyMainWorkspace?: boolean;
}

export const SessionSidebar: React.FC<SessionSidebarProps> = ({
  mobileVariant = false,
  onSessionSelected,
  allowReselect = false,
  hideDirectoryControls = false,
  showOnlyMainWorkspace = false,
}) => {
  const { t } = useI18n();
  const [isSessionSearchOpen, setIsSessionSearchOpen] = React.useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = React.useState('');
  const sessionSearchContainerRef = React.useRef<HTMLDivElement | null>(null);
  const sessionSearchInputRef = React.useRef<HTMLInputElement | null>(null);
  const retriedNoPrStatusKeysRef = React.useRef<Set<string>>(new Set());
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editTitle, setEditTitle] = React.useState('');
  const [editingProjectDialogId, setEditingProjectDialogId] = React.useState<string | null>(null);
  const [expandedParents, setExpandedParents] = React.useState<Set<string>>(new Set());
  const [directoryStatus] = React.useState<Map<string, 'unknown' | 'exists' | 'missing'>>(
    () => new Map(),
  );
  const safeStorage = React.useMemo(() => getSafeStorage(), []);
  const activeNowEntries = useActiveNowStore((state) => state.entries);
  const addActiveNowSessionToStore = useActiveNowStore((state) => state.addSession);
  const pruneActiveNowEntriesInStore = useActiveNowStore((state) => state.prune);
  const [collapsedProjects, setCollapsedProjects] = React.useState<Set<string>>(new Set());

  const [projectRepoStatus, setProjectRepoStatus] = React.useState<Map<string, boolean | null>>(new Map());
  const [expandedSessionGroups, setExpandedSessionGroups] = React.useState<Set<string>>(new Set());
  const [newWorktreeDialogOpen, setNewWorktreeDialogOpen] = React.useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = React.useState(false);
  const [openSidebarMenuKey, setOpenSidebarMenuKey] = React.useState<string | null>(null);
  const [renamingFolderId, setRenamingFolderId] = React.useState<string | null>(null);
  const [renameFolderDraft, setRenameFolderDraft] = React.useState('');
  const [deleteSessionConfirm, setDeleteSessionConfirm] = React.useState<DeleteSessionConfirmState>(null);
  const [deleteFolderConfirm, setDeleteFolderConfirm] = React.useState<DeleteFolderConfirmState>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = React.useState<BulkDeleteSessionsConfirmState>(null);
  const pinnedSessionIds = useSessionPinnedStore((state) => state.ids);
  const setPinnedSessionIds = useSessionPinnedStore((state) => state.setIds);
  const togglePinnedSession = useSessionPinnedStore((state) => state.toggle);
  const [collapsedGroups, setCollapsedGroups] = React.useState<Set<string>>(() => {
    try {
      const raw = getSafeStorage().getItem(GROUP_COLLAPSE_STORAGE_KEY);
      if (!raw) {
        return new Set();
      }
      const parsed = JSON.parse(raw) as string[];
      return new Set(Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []);
    } catch {
      return new Set();
    }
  });
  const [groupOrderByProject, setGroupOrderByProject] = React.useState<Map<string, string[]>>(() => {
    try {
      const raw = getSafeStorage().getItem(GROUP_ORDER_STORAGE_KEY);
      if (!raw) {
        return new Map();
      }
      const parsed = JSON.parse(raw) as Record<string, string[]>;
      const next = new Map<string, string[]>();
      Object.entries(parsed).forEach(([projectId, order]) => {
        if (Array.isArray(order)) {
          next.set(projectId, order.filter((item) => typeof item === 'string'));
        }
      });
      return next;
    } catch {
      return new Map();
    }
  });
  const [activeSessionByProject, setActiveSessionByProject] = React.useState<Map<string, string>>(() => {
    try {
      const raw = getSafeStorage().getItem(PROJECT_ACTIVE_SESSION_STORAGE_KEY);
      if (!raw) {
        return new Map();
      }
      const parsed = JSON.parse(raw) as Record<string, string>;
      const next = new Map<string, string>();
      Object.entries(parsed).forEach(([projectId, sessionId]) => {
        if (typeof sessionId === 'string' && sessionId.length > 0) {
          next.set(projectId, sessionId);
        }
      });
      return next;
    } catch {
      return new Map();
    }
  });

  const [projectRootBranches, setProjectRootBranches] = React.useState<Map<string, string>>(new Map());
  const projectHeaderSentinelRefs = React.useRef<Map<string, HTMLDivElement | null>>(new Map());
  const ignoreIntersectionUntil = React.useRef<number>(0);

  const homeDirectory = useDirectoryStore((state) => state.homeDirectory);
  const currentDirectory = useDirectoryStore((state) => state.currentDirectory);
  const setDirectory = useDirectoryStore((state) => state.setDirectory);

  const projects = useProjectsStore((state) => state.projects);
  const includeProjectWorktreesInVSCode = projects.length > 1;
  const activeProjectId = useProjectsStore((state) => state.activeProjectId);
  const addProject = useProjectsStore((state) => state.addProject);
  const removeProject = useProjectsStore((state) => state.removeProject);
  const setActiveProjectIdOnly = useProjectsStore((state) => state.setActiveProjectIdOnly);
  const updateProjectMeta = useProjectsStore((state) => state.updateProjectMeta);
  const reorderProjects = useProjectsStore((state) => state.reorderProjects);

  const {
    setActiveMainTab, openContextPanelTab, setSettingsDialogOpen,
    toggleHelpDialog, setAboutDialogOpen, setSessionSwitcherOpen,
    setScheduledTasksDialogOpen, toggleSidebar, openMultiRunLauncher, notifyOnSubtasks,
    showDeletionDialog, setShowDeletionDialog,
  } = useUIStore(useShallow((state) => ({
    setActiveMainTab: state.setActiveMainTab,
    openContextPanelTab: state.openContextPanelTab,
    setSettingsDialogOpen: state.setSettingsDialogOpen,
    toggleHelpDialog: state.toggleHelpDialog,
    setAboutDialogOpen: state.setAboutDialogOpen,
    setSessionSwitcherOpen: state.setSessionSwitcherOpen,
    setScheduledTasksDialogOpen: state.setScheduledTasksDialogOpen,
    toggleSidebar: state.toggleSidebar,
    openMultiRunLauncher: state.openMultiRunLauncher,
    notifyOnSubtasks: state.notifyOnSubtasks,
    showDeletionDialog: state.showDeletionDialog,
    setShowDeletionDialog: state.setShowDeletionDialog,
  })));

  const debouncedSessionSearchQuery = useDebouncedValue(sessionSearchQuery, 120);
  const normalizedSessionSearchQuery = React.useMemo(
    () => debouncedSessionSearchQuery.trim().toLowerCase(),
    [debouncedSessionSearchQuery],
  );

  const hasSessionSearchQuery = normalizedSessionSearchQuery.length > 0;

  const instances = useInstancesStore((state) => state.instances);
  const currentInstanceId = useInstancesStore((state) => state.currentInstanceId);
  const setCurrentInstance = useInstancesStore((state) => state.setCurrentInstance);
  const touchInstance = useInstancesStore((state) => state.touchInstance);

  // Session Folders store
  const {
    collapsedFolderIds, foldersMap, getFoldersForScope,
    createFolder, renameFolder, deleteFolder,
    addSessionToFolder, addSessionsToFolder, removeSessionFromFolder, removeSessionsFromFolders,
    toggleFolderCollapse, cleanupSessions, getSessionFolderId,
  } = useSessionFoldersStore(useShallow((state) => ({
    collapsedFolderIds: state.collapsedFolderIds,
    foldersMap: state.foldersMap,
    getFoldersForScope: state.getFoldersForScope,
    createFolder: state.createFolder,
    renameFolder: state.renameFolder,
    deleteFolder: state.deleteFolder,
    addSessionToFolder: state.addSessionToFolder,
    addSessionsToFolder: state.addSessionsToFolder,
    removeSessionFromFolder: state.removeSessionFromFolder,
    removeSessionsFromFolders: state.removeSessionsFromFolders,
    toggleFolderCollapse: state.toggleFolderCollapse,
    cleanupSessions: state.cleanupSessions,
    getSessionFolderId: state.getSessionFolderId,
  })));

  useSessionSearchEffects({
    isSessionSearchOpen,
    setIsSessionSearchOpen,
    sessionSearchInputRef,
    sessionSearchContainerRef,
  });

  const gitBranches = useGitAllBranches();

  const sync = useSync();
  const liveSessions = useAllLiveSessions();
  const { globalActiveSessions, archivedSessions, hasLoadedGlobalSessions } = useGlobalSessionsStore(
    useShallow((state) => ({
      globalActiveSessions: state.activeSessions,
      archivedSessions: state.archivedSessions,
      hasLoadedGlobalSessions: state.hasLoaded,
    })),
  );
  const {
    currentSessionId, newSessionDraftOpen, setCurrentSession,
    updateSessionTitle, shareSession, unshareSession,
    worktreeMetadata, availableWorktreesByProject, openNewSessionDraft,
  } = useSessionUIStore(useShallow((state) => ({
    currentSessionId: state.currentSessionId,
    newSessionDraftOpen: Boolean(state.newSessionDraft?.open),
    setCurrentSession: state.setCurrentSession,
    updateSessionTitle: state.updateSessionTitle,
    shareSession: state.shareSession,
    unshareSession: state.unshareSession,
    worktreeMetadata: state.worktreeMetadata,
    availableWorktreesByProject: state.availableWorktreesByProject,
    openNewSessionDraft: state.openNewSessionDraft,
  })));
  const liveSessionStatuses = useAllSessionStatuses();
  const updateStore = useUpdateStore(useShallow((s) => ({
    checkForUpdates: s.checkForUpdates,
    available: s.available,
    runtimeType: s.runtimeType,
    info: s.info,
    downloading: s.downloading,
    downloaded: s.downloaded,
    progress: s.progress,
    error: s.error,
    downloadUpdate: s.downloadUpdate,
    restartToUpdate: s.restartToUpdate,
  })));

  const knownSessionDirectories = React.useMemo(
    () => buildKnownSessionDirectories(projects, availableWorktreesByProject),
    [availableWorktreesByProject, projects],
  );

  const sessions = React.useMemo(() => {
    const getSessionUpdatedAt = (session: Session): number => {
      if (typeof session.time?.updated === 'number' && Number.isFinite(session.time.updated)) {
        return session.time.updated;
      }
      if (typeof session.time?.created === 'number' && Number.isFinite(session.time.created)) {
        return session.time.created;
      }
      return 0;
    };

    const liveById = new Map(liveSessions.map((session) => [session.id, session]));
    const merged = globalActiveSessions.map((session) => {
      const liveSession = liveById.get(session.id);
      if (!liveSession) {
        return session;
      }
      const globalUpdatedAt = getSessionUpdatedAt(session);
      const liveUpdatedAt = getSessionUpdatedAt(liveSession);
      return liveUpdatedAt >= globalUpdatedAt ? liveSession : session;
    });
    const seenIds = new Set(merged.map((session) => session.id));

    liveSessions.forEach((session) => {
      if (seenIds.has(session.id)) {
        return;
      }
      merged.push(session);
    });

    return merged.filter((session) => isKnownActiveSessionDirectory(session, knownSessionDirectories));
  }, [globalActiveSessions, knownSessionDirectories, liveSessions]);

  const syncSessionStructureSignature = React.useMemo(
    () => liveSessions
      .map((session) => {
        const directory = normalizePath((session as Session & { directory?: string | null }).directory ?? null) ?? '';
        return `${session.id}:${session.title ?? ''}:${session.time?.archived ? 1 : 0}:${directory}`;
      })
      .join('|'),
    [liveSessions],
  );

  const syncSessionsSnapshotRef = React.useRef<Session[]>(liveSessions);
  React.useEffect(() => {
    syncSessionsSnapshotRef.current = liveSessions;
  }, [syncSessionStructureSignature, liveSessions]);

  React.useEffect(() => {
    let cancelled = false;

    const discoverWorktrees = async () => {
      const projectEntries = useProjectsStore.getState().projects;
      if (projectEntries.length === 0) return;

      const worktreesByProject = new Map<string, WorktreeMetadata[]>();
      const allWorktrees: WorktreeMetadata[] = [];

      await Promise.all(
        projectEntries.map(async (project) => {
          const projectPath = normalizePath(project.path);
          if (!projectPath) return;
          try {
            // Use store-cached isGitRepo when available; fall back to direct check for initial worktree discovery
            const cachedIsGitRepo = useGitStore.getState().directories.get(projectPath)?.isGitRepo;
            const isGitRepo = cachedIsGitRepo ?? await import('@/lib/gitApi').then(m => m.checkIsGitRepository(projectPath));
            if (!isGitRepo) return;
            const worktrees = await listProjectWorktrees({ id: project.id, path: projectPath });
            if (cancelled || worktrees.length === 0) return;
            worktreesByProject.set(projectPath, worktrees);
            allWorktrees.push(...worktrees);
          } catch {
            // ignore discovery errors
          }
        }),
      );

      if (cancelled) return;

      useSessionUIStore.setState({
        availableWorktrees: allWorktrees,
        availableWorktreesByProject: worktreesByProject,
      });
    };

    void refreshGlobalSessions(syncSessionsSnapshotRef.current);
    void discoverWorktrees();

    return () => {
      cancelled = true;
    };
  }, [currentDirectory, syncSessionStructureSignature, projects]);

  React.useEffect(() => {
    let refreshTimeout: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeOpenchamberEvents((event) => {
      if (event.type !== 'scheduled-task-ran') {
        return;
      }
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      refreshTimeout = setTimeout(() => {
        void refreshGlobalSessions(syncSessionsSnapshotRef.current);
      }, 500);
    });
    return () => {
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
      unsubscribe();
    };
  }, []);

  const isDesktopShellRuntime = React.useMemo(() => isDesktopShell(), []);
  const isTabletStandalonePwa = useTabletStandalonePwaRuntime();
  const [isDesktopWindowFullscreen, setIsDesktopWindowFullscreen] = React.useState(false);

  const isVSCode = React.useMemo(() => isVSCodeRuntime(), []);
  const { isTablet } = useDeviceInfo();
  const alwaysShowSidebarActions = mobileVariant || isTablet;
  const isMacPlatform = React.useMemo(() => {
    if (typeof navigator === 'undefined') {
      return false;
    }
    return /Macintosh|Mac OS X/.test(navigator.userAgent || '');
  }, []);
  const isWebRuntime = !mobileVariant && !isVSCode && !isDesktopShellRuntime;
  const showDesktopSidebarChrome = !mobileVariant && !isVSCode && !isWebRuntime;
  const desktopSidebarTopPaddingClass = (isDesktopShellRuntime && isMacPlatform && !isDesktopWindowFullscreen) || isTabletStandalonePwa ? 'pl-[5.5rem]' : 'pl-3';
  const desktopSidebarToggleButtonClass = 'app-region-no-drag inline-flex h-8 w-8 items-center justify-center rounded-md typography-ui-label font-medium text-foreground transition-colors hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:pointer-events-none disabled:opacity-50';

  React.useEffect(() => {
    if (!isDesktopShellRuntime || !isMacPlatform) {
      setIsDesktopWindowFullscreen(false);
      return;
    }

    let disposed = false;
    let unlistenResize: (() => void) | null = null;

    const syncFullscreenState = async () => {
      try {
        const fullscreen = await getDesktopWindowFullscreen();
        if (!disposed) {
          setIsDesktopWindowFullscreen(fullscreen);
        }
      } catch {
        if (!disposed) {
          setIsDesktopWindowFullscreen(false);
        }
      }
    };

    const attach = async () => {
      try {
        unlistenResize = onDesktopWindowResized(() => {
          void syncFullscreenState();
        });
      } catch {
        // Ignore listener setup failures; fallback state remains false.
      }
    };

    void syncFullscreenState();
    void attach();

    return () => {
      disposed = true;
      if (unlistenResize) {
        unlistenResize();
      }
    };
  }, [isDesktopShellRuntime, isMacPlatform]);

  const handleDesktopSidebarDragStart = React.useCallback(async (event: React.MouseEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest('.app-region-no-drag')) {
      return;
    }
    if (target.closest('button, a, input, select, textarea')) {
      return;
    }
    if (event.button !== 0) {
      return;
    }
    if (!isDesktopShellRuntime) {
      return;
    }

    await startDesktopWindowDrag();
  }, [isDesktopShellRuntime]);

  const {
    buildGroupSearchText,
    filterSessionNodesForSearch,
    buildGroupedSessions,
  } = useSessionGrouping({
    homeDirectory,
    worktreeMetadata,
    pinnedSessionIds,
    gitBranches,
    isVSCode,
  });

  const { scheduleCollapsedProjectsPersist } = useSidebarPersistence({
    isVSCode,
    hasLoadedGlobalSessions,
    safeStorage,
    keys: {
      sessionExpanded: SESSION_EXPANDED_STORAGE_KEY,
      projectCollapse: PROJECT_COLLAPSE_STORAGE_KEY,
      sessionPinned: SESSION_PINNED_STORAGE_KEY,
      groupOrder: GROUP_ORDER_STORAGE_KEY,
      projectActiveSession: PROJECT_ACTIVE_SESSION_STORAGE_KEY,
      groupCollapse: GROUP_COLLAPSE_STORAGE_KEY,
    },
    sessions,
    pinnedSessionIds,
    setPinnedSessionIds,
    groupOrderByProject,
    activeSessionByProject,
    collapsedGroups,
    setExpandedParents,
    setCollapsedProjects,
  });

  const sortedSessions = React.useMemo(() => {
    return [...sessions].sort((a, b) => compareSessionsByPinnedAndTime(a, b, pinnedSessionIds));
  }, [sessions, pinnedSessionIds]);

  const allKnownSessionsById = React.useMemo(() => {
    const next = new Map<string, Session>();
    [...sessions, ...archivedSessions].forEach((session) => {
      next.set(session.id, session);
    });
    return next;
  }, [sessions, archivedSessions]);

  React.useEffect(() => {
    const pruned = pruneActiveNowEntries(activeNowEntries, allKnownSessionsById);
    if (pruned.length === activeNowEntries.length && pruned.every((entry, index) => entry.sessionId === activeNowEntries[index]?.sessionId)) {
      return;
    }
    setActiveNowEntries(pruned);
    persistActiveNowEntries(safeStorage, pruned);
  }, [activeNowEntries, allKnownSessionsById, safeStorage]);

  const previousStreamingIdsRef = React.useRef<Set<string>>(new Set());
  React.useEffect(() => {
    const nextStreamingIds = new Set<string>();
    sessionStatus?.forEach((status, sessionId) => {
      if (status?.type === 'busy' || status?.type === 'retry') {
        nextStreamingIds.add(sessionId);
      }
    });

    const previousStreamingIds = previousStreamingIdsRef.current;
    const startedStreamingIds = Array.from(nextStreamingIds).filter((sessionId) => !previousStreamingIds.has(sessionId));
    if (startedStreamingIds.length > 0) {
      setActiveNowEntries((prev) => {
        const next = startedStreamingIds.reduce((entries, sessionId) => addActiveNowSession(entries, sessionId), prev);
        if (next === prev) {
          return prev;
        }
        persistActiveNowEntries(safeStorage, next);
        return next;
      });
    }

    previousStreamingIdsRef.current = nextStreamingIds;
  }, [sessionStatus, safeStorage]);

  React.useEffect(() => {
    const busyIds: string[] = [];
    sessionStatus?.forEach((status, sessionId) => {
      if (status?.type === 'busy' || status?.type === 'retry') {
        busyIds.push(sessionId);
      }
    });

    if (busyIds.length === 0) {
      return;
    }

    setActiveNowEntries((prev) => {
      const known = new Set(prev.map((entry) => entry.sessionId));
      let next = prev;
      let changed = false;

      busyIds.forEach((sessionId) => {
        if (known.has(sessionId)) {
          return;
        }

        const session = allKnownSessionsById.get(sessionId);
        if (!session || session.time?.archived) {
          return;
        }

        const isSubtask = Boolean(getSessionParentId(session));
        if (isSubtask) {
          return;
        }

        next = addActiveNowSession(next, sessionId);
        known.add(sessionId);
        changed = true;
      });

      if (!changed) {
        return prev;
      }

      persistActiveNowEntries(safeStorage, next);
      return next;
    });
  }, [sessionStatus, allKnownSessionsById, safeStorage]);

  const childrenMap = React.useMemo(() => {
    const map = new Map<string, Session[]>();
    sortedSessions.forEach((session) => {
      const parentID = getCompatibleSessionParentId(session);
      if (!parentID) {
        return;
      }
      const collection = map.get(parentID) ?? [];
      collection.push(session);
      map.set(parentID, collection);
    });
    map.forEach((list) => list.sort((a, b) => compareSessionsByPinnedAndTime(a, b, pinnedSessionIds)));
    return map;
  }, [sortedSessions, pinnedSessionIds]);

  const emptyState = (
    <div className="py-6 text-center text-muted-foreground">
      <p className="typography-ui-label font-semibold">{t('sessions.sidebar.empty.noSessions.title')}</p>
      <p className="typography-meta mt-1">{t('sessions.sidebar.empty.noSessions.description')}</p>
    </div>
  );

  const editingProject = React.useMemo(
    () => projects.find((project) => project.id === editingProjectDialogId) ?? null,
    [projects, editingProjectDialogId],
  );

  const handleSaveProjectEdit = React.useCallback((data: { label: string; icon: string | null; color: string | null; iconBackground: string | null }) => {
    if (!editingProjectDialogId) {
      return;
    }
    updateProjectMeta(editingProjectDialogId, data);
    setEditingProjectDialogId(null);
  }, [editingProjectDialogId, updateProjectMeta]);

  const openNewWorktreeDialog = React.useCallback(() => {
    setNewWorktreeDialogOpen(true);
  }, []);

  const handleOpenUpdateDialog = React.useCallback(() => {
    const current = useUpdateStore.getState();
    if (current.available && current.info) {
      setUpdateDialogOpen(true);
      return;
    }

    void updateStore.checkForUpdates().then(() => {
      const { available, error } = useUpdateStore.getState();
      if (error) {
        toast.error(t('sessions.sidebar.updateCheck.errorTitle'), { description: error });
        return;
      }
      if (!available) {
        toast.success(t('sessions.sidebar.updateCheck.latestVersion'));
        return;
      }
      setUpdateDialogOpen(true);
    });
  }, [t, updateStore]);

  const handleOpenSettings = React.useCallback(() => {
    if (mobileVariant) {
      setSessionSwitcherOpen(false);
    }
    setSettingsDialogOpen(true);
  }, [mobileVariant, setSessionSwitcherOpen, setSettingsDialogOpen]);

  const showSidebarUpdateButton =
    updateStore.available &&
    (updateStore.runtimeType === 'desktop' || updateStore.runtimeType === 'web');

  const deleteSession = useSessionUIStore((state) => state.deleteSession);
  const deleteSessions = useSessionUIStore((state) => state.deleteSessions);
  const archiveSession = useSessionUIStore((state) => state.archiveSession);
  const archiveSessions = useSessionUIStore((state) => state.archiveSessions);

  const {
    copiedSessionId,
    handleSessionSelect,
    handleSessionDoubleClick,
    handleSaveEdit,
    handleCancelEdit,
    handleShareSession,
    handleCopyShareUrl,
    handleUnshareSession,
    handleDeleteSession,
    confirmDeleteSession,
  } = useSessionActions({
    activeProjectId,
    currentDirectory,
    currentSessionId,
    mobileVariant,
    allowReselect,
    onSessionSelected,
    isSessionSearchOpen,
    sessionSearchQuery,
    setSessionSearchQuery,
    setIsSessionSearchOpen,
    setActiveProjectIdOnly,
    setDirectory,
    setActiveMainTab,
    setSessionSwitcherOpen,
    setCurrentSession,
    updateSessionTitle,
    shareSession,
    unshareSession,
    deleteSession,
    deleteSessions,
    archiveSession,
    archiveSessions,
    childrenMap,
    showDeletionDialog,
    setDeleteSessionConfirm,
    deleteSessionConfirm,
    setEditingId,
    setEditTitle,
    editingId,
    editTitle,
  });

  const confirmDeleteFolder = React.useCallback(() => {
    if (!deleteFolderConfirm) return;
    const { scopeKey, folderId } = deleteFolderConfirm;
    setDeleteFolderConfirm(null);
    deleteFolder(scopeKey, folderId);
  }, [deleteFolderConfirm, deleteFolder]);

  const handleOpenDirectoryDialog = React.useCallback(() => {
    sessionEvents.requestDirectoryDialog();
  }, []);

  // Auto-expand parent session when navigating to a subagent (child) session
  React.useEffect(() => {
    if (!currentSessionId) return;
    const current = sessions.find((s) => s.id === currentSessionId);
    const parentID = current ? getCompatibleSessionParentId(current) : null;
    if (!parentID) return;
    setExpandedParents((prev) => {
      if (prev.has(parentID)) return prev;
      const next = new Set(prev);
      next.add(parentID);
      try {
        safeStorage.setItem(SESSION_EXPANDED_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch { /* ignored */ }
      return next;
    });
  }, [currentSessionId, sessions, safeStorage]);

  const toggleParent = React.useCallback((sessionId: string) => {
    setExpandedParents((prev) => {
      const next = new Set(prev);
      if (next.has(sessionId)) {
        next.delete(sessionId);
      } else {
        next.add(sessionId);
      }
      try {
        safeStorage.setItem(SESSION_EXPANDED_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch { /* ignored */ }
      return next;
    });
  }, [safeStorage]);

  const createFolderAndStartRename = React.useCallback(
    (scopeKey: string, parentId?: string | null) => {
      if (!scopeKey) {
        return null;
      }

      if (parentId && collapsedFolderIds.has(parentId)) {
        toggleFolderCollapse(parentId);
      }

      const newFolder = createFolder(scopeKey, t('sessions.sidebar.folder.newFolderName'), parentId);
      setRenamingFolderId(newFolder.id);
      setRenameFolderDraft(newFolder.name);
      return newFolder;
    },
    [collapsedFolderIds, toggleFolderCollapse, createFolder, t],
  );

  const toggleGroupSessionLimit = React.useCallback((groupId: string) => {
    setExpandedSessionGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const collapseAllProjects = React.useCallback(() => {
    ignoreIntersectionUntil.current = Date.now() + 150;
    setCollapsedProjects(() => {
      const allIds = new Set(projects.map((p) => p.id));
      try {
        safeStorage.setItem(PROJECT_COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(allIds)));
      } catch { /* ignored */ }
      if (!isVSCode) {
        scheduleCollapsedProjectsPersist(allIds);
      }
      return allIds;
    });
  }, [projects, isVSCode, safeStorage, scheduleCollapsedProjectsPersist]);

  const expandAllProjects = React.useCallback(() => {
    ignoreIntersectionUntil.current = Date.now() + 150;
    setCollapsedProjects(() => {
      const empty = new Set<string>();
      try {
        safeStorage.setItem(PROJECT_COLLAPSE_STORAGE_KEY, JSON.stringify([]));
      } catch { /* ignored */ }
      if (!isVSCode) {
        scheduleCollapsedProjectsPersist(empty);
      }
      return empty;
    });
  }, [isVSCode, safeStorage, scheduleCollapsedProjectsPersist]);

  const toggleProject = React.useCallback((projectId: string) => {
    // Ignore intersection events for a short period after toggling
    ignoreIntersectionUntil.current = Date.now() + 150;
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      try {
        safeStorage.setItem(PROJECT_COLLAPSE_STORAGE_KEY, JSON.stringify(Array.from(next)));
      } catch { /* ignored */ }

      // Persist collapse state to server settings (web + desktop local/remote).
      if (!isVSCode) {
        scheduleCollapsedProjectsPersist(next);
      }
      return next;
    });
  }, [isVSCode, safeStorage, scheduleCollapsedProjectsPersist]);

  const normalizedProjects = React.useMemo(() => {
    return projects
      .map((project) => ({
        ...project,
        normalizedPath: normalizePath(project.path),
      }))
      .filter((project) => Boolean(project.normalizedPath)) as Array<{
        id: string;
        path: string;
        label?: string;
        normalizedPath: string;
        icon?: string;
        color?: string;
        iconImage?: { mime: string; updatedAt: number; source: 'custom' | 'auto' };
        iconBackground?: string;
      }>;
  }, [projects]);

  const normalizedProjectPaths = React.useMemo(
    () => normalizedProjects.map((project) => project.normalizedPath),
    [normalizedProjects],
  );

  const { github } = useRuntimeAPIs();
  const githubAuthStatus = useGitHubAuthStore((state) => state.status);
  const githubAuthChecked = useGitHubAuthStore((state) => state.hasChecked);
  const gitRepoStatus = useGitRepoStatusMap(normalizedProjectPaths);
  const ensurePrStatusEntry = useGitHubPrStatusStore((state) => state.ensureEntry);
  const setPrStatusParams = useGitHubPrStatusStore((state) => state.setParams);
  const refreshPrStatusTargets = useGitHubPrStatusStore((state) => state.refreshTargets);

  useProjectRepoStatus({
    normalizedProjects,
    gitRepoStatus,
    setProjectRepoStatus,
    setProjectRootBranches,
  });

  const isSessionsLoading = useSessionUIStore((state) => state.isLoading);
  useSessionFolderCleanup({
    isSessionsLoading,
    sessions,
    archivedSessions,
    normalizedProjects,
    isVSCode,
    includeWorktreesInVSCode: includeProjectWorktreesInVSCode,
    availableWorktreesByProject,
    cleanupSessions,
  });

  const { getSessionsForProject, getArchivedSessionsForProject } = useProjectSessionLists({
    isVSCode,
    includeWorktreesInVSCode: includeProjectWorktreesInVSCode,
    sessions,
    archivedSessions,
    availableWorktreesByProject,
  });

  useArchivedAutoFolders({
    normalizedProjects,
    sessions,
    archivedSessions,
    availableWorktreesByProject,
    isVSCode,
    includeWorktreesInVSCode: includeProjectWorktreesInVSCode,
    isSessionsLoading,
    foldersMap,
    createFolder,
    addSessionToFolder,
    cleanupSessions,
  });

  // Keep last-known repo status to avoid UI jiggling during project switch
  const lastRepoStatusRef = React.useRef(false);
  if (activeProjectId && projectRepoStatus.has(activeProjectId)) {
    lastRepoStatusRef.current = Boolean(projectRepoStatus.get(activeProjectId));
  }

  const {
    projectSections,
    groupSearchDataByGroup,
    sectionsForRender,
  } = useSessionSidebarSections({
    normalizedProjects,
    getSessionsForProject,
    getArchivedSessionsForProject,
    availableWorktreesByProject,
    projectRepoStatus,
    projectRootBranches,
    lastRepoStatus: lastRepoStatusRef.current,
    buildGroupedSessions,
    hasSessionSearchQuery,
    normalizedSessionSearchQuery,
    filterSessionNodesForSearch,
    buildGroupSearchText,
    foldersMap,
  });

  const searchEmptyState = (
    <div className="py-6 text-center text-muted-foreground">
      <p className="typography-ui-label font-semibold">{t('sessions.sidebar.empty.noMatches.title')}</p>
      <p className="typography-meta mt-1">{t('sessions.sidebar.empty.noMatches.description')}</p>
    </div>
  );

  const reserveHeaderActionsSpace = true;

  const { currentSessionDirectory } = useProjectSessionSelection({
    projectSections,
    activeProjectId,
    activeSessionByProject,
    setActiveSessionByProject,
    currentSessionId,
    handleSessionSelect,
    newSessionDraftOpen,
    mobileVariant,
    openNewSessionDraft,
    setActiveMainTab,
    setSessionSwitcherOpen,
    sessions,
    worktreeMetadata,
  });

  const { getOrderedGroups } = useGroupOrdering(groupOrderByProject);
  const hasInitializedArchivedCollapseRef = React.useRef(false);

  React.useEffect(() => {
    if (hasInitializedArchivedCollapseRef.current || projectSections.length === 0) {
      return;
    }
    const projectMap = projectSessionMeta.metaByProject.get(activeProjectId);
    if (!projectMap || !projectMap.has(currentSessionId)) {
      return;
    }
    setActiveSessionByProject((prev) => {
      if (prev.get(activeProjectId) === currentSessionId) {
        return prev;
      }
      const next = new Map(prev);
      next.set(activeProjectId, currentSessionId);
      return next;
    });
  }, [activeProjectId, currentSessionId, projectSessionMeta]);

  const currentSessionDirectory = React.useMemo(() => {
    if (!currentSessionId) {
      return null;
    }
    const metadataPath = worktreeMetadata.get(currentSessionId)?.path;
    if (metadataPath) {
      return normalizePath(metadataPath) ?? metadataPath;
    }
    const activeSession = sessions.find((session) => session.id === currentSessionId);
    if (!activeSession) {
      return null;
    }
    return normalizePath((activeSession as Session & { directory?: string | null }).directory ?? null);
  }, [currentSessionId, sessions, worktreeMetadata]);

  const getOrderedGroups = React.useCallback(
    (projectId: string, groups: SessionGroup[]) => {
      const preferredOrder = groupOrderByProject.get(projectId);
      if (!preferredOrder || preferredOrder.length === 0) {
        return groups;
      }
      const groupById = new Map(groups.map((group) => [group.id, group]));
      const ordered: SessionGroup[] = [];
      preferredOrder.forEach((id) => {
        const group = groupById.get(id);
        if (group) {
          ordered.push(group);
          groupById.delete(id);
        }
      });
      groups.forEach((group) => {
        if (groupById.has(group.id)) {
          ordered.push(group);
        }
      });
      return ordered;
    },
    [groupOrderByProject],
  );

  const handleStartInlineProjectRename = React.useCallback(() => {
    if (!activeProjectForHeader) {
      return;
    }
    setProjectRenameDraft(formatProjectLabel(
      activeProjectForHeader.label?.trim()
      || formatDirectoryName(activeProjectForHeader.normalizedPath, homeDirectory)
      || activeProjectForHeader.normalizedPath,
    ));
    setIsProjectRenameInline(true);
  }, [activeProjectForHeader, homeDirectory]);

  const handleSaveInlineProjectRename = React.useCallback(() => {
    if (!activeProjectForHeader) {
      return;
    }
    const trimmed = projectRenameDraft.trim();
    if (!trimmed) {
      return;
    }
    renameProject(activeProjectForHeader.id, trimmed);
    setIsProjectRenameInline(false);
  }, [activeProjectForHeader, projectRenameDraft, renameProject]);

  const desktopHeaderActionButtonClass =
    'inline-flex h-6 w-6 items-center justify-center rounded-md leading-none text-foreground hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50';
  const mobileHeaderActionButtonClass =
    'inline-flex h-6 w-6 items-center justify-center rounded-md leading-none text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50';
  const headerActionButtonClass = mobileVariant ? mobileHeaderActionButtonClass : desktopHeaderActionButtonClass;
  const headerActionIconClass = 'h-4.5 w-4.5';
  const addProjectButtonClass = cn(
    'inline-flex items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
    mobileVariant
      ? 'h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50'
      : 'h-8 w-8 text-foreground hover:bg-interactive-hover',
    !isDesktopShellRuntime && 'bg-transparent hover:bg-sidebar/40',
  );

  const isMobileRuntime = React.useMemo(() => {
    return detectMobileRuntime();
  }, []);

  const showMobileInstanceSwitcher = mobileVariant && isMobileRuntime;

  const sortedInstances = React.useMemo(() => {
    return [...instances].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0));
  }, [instances]);

  const activeInstanceLabel = React.useMemo(() => {
    const selected = sortedInstances.find((instance) => instance.id === currentInstanceId) ?? sortedInstances[0] ?? null;
    if (!selected) {
      return 'Add instance';
    }
    return selected.label?.trim() || selected.origin;
  }, [currentInstanceId, sortedInstances]);

  const handleSwitchInstance = React.useCallback((instanceId: string) => {
    if (!instanceId || instanceId === currentInstanceId) {
      return;
    }
    setCurrentInstance(instanceId);
    touchInstance(instanceId);
    window.location.reload();
  }, [currentInstanceId, setCurrentInstance, touchInstance]);

  const handleAddInstance = React.useCallback(() => {
    setDeviceLoginOpen(true);
    if (mobileVariant) {
      setSessionSwitcherOpen(false);
    }
  }, [mobileVariant, setDeviceLoginOpen, setSessionSwitcherOpen]);

  // Track when project sticky headers become "stuck"
  React.useEffect(() => {
    if (!isDesktopShellRuntime) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const projectId = (entry.target as HTMLElement).dataset.projectId;
          if (!projectId) return;
          
          setStuckProjectHeaders((prev) => {
            const next = new Set(prev);
            if (!entry.isIntersecting) {
              next.add(projectId);
            } else {
              next.delete(projectId);
            }
            return next;
          });
        });
      },
      { threshold: 0 }
    );
    if (archivedGroupKeys.length > 0) {
      setCollapsedGroups((prev) => new Set([...prev, ...archivedGroupKeys]));
    }
    hasInitializedArchivedCollapseRef.current = true;
  }, [projectSections]);

  const sessionSidebarMetaById = React.useMemo(() => {
    const meta = new Map<string, {
      node: SessionNode;
      projectId: string | null;
      groupDirectory: string | null;
      secondaryMeta: {
        projectLabel?: string | null;
        branchLabel?: string | null;
      } | null;
    }>();
    const projectPathLengthBySessionId = new Map<string, number>();

    return () => observer.disconnect();
  }, [isDesktopShellRuntime, projectSections]);

  const renderSessionNode = React.useCallback(
    (node: SessionNode, depth = 0, groupDirectory?: string | null, projectId?: string | null): React.ReactNode => {
      const session = node.session;
      const sessionDirectory =
        normalizePath((session as Session & { directory?: string | null }).directory ?? null) ??
        normalizePath(groupDirectory ?? null);
      const directoryState = sessionDirectory ? directoryStatus.get(sessionDirectory) : null;
      const isMissingDirectory = directoryState === 'missing';
      const memoryState = sessionMemoryState.get(session.id);
      const isActive = currentSessionId === session.id;
      const sessionTitle = session.title || 'Untitled Session';
      const hasChildren = node.children.length > 0;
      const isPinnedSession = pinnedSessionIds.has(session.id);
      const isExpanded = hasSessionSearchQuery ? true : expandedParents.has(session.id);
      const isSubtaskSession = Boolean((session as Session & { parentID?: string | null }).parentID);
      const rawNeedsAttention = sessionAttentionStates.get(session.id)?.needsAttention === true;
      // When notifyOnSubtasks is disabled, suppress attention dots for child sessions.
      const needsAttention = rawNeedsAttention && (!isSubtaskSession || notifyOnSubtasks);
      const sessionSummary = session.summary as
        | {
          additions?: number | string | null;
          deletions?: number | string | null;
          files?: number | null;
          diffs?: Array<{ additions?: number | string | null; deletions?: number | string | null }>;
        }
        | undefined;

      if (editingId === session.id) {
        return (
          <div
            key={session.id}
            className={cn(
              'group relative flex items-center rounded-md px-1.5 py-1',
              'bg-interactive-selection',
              depth > 0 && 'pl-[20px]',
            )}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-0">
              <form
                className="flex w-full items-center gap-2"
                data-keyboard-avoid="true"
                onSubmit={(event) => {
                  event.preventDefault();
                  handleSaveEdit();
                }}
              >
                <input
                  value={editTitle}
                  onChange={(event) => setEditTitle(event.target.value)}
                  className="flex-1 min-w-0 bg-transparent typography-ui-label outline-none placeholder:text-muted-foreground"
                  autoFocus
                  placeholder="Rename session"
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.stopPropagation();
                      handleCancelEdit();
                      return;
                    }
                    if (event.key === ' ' || event.key === 'Enter') {
                      event.stopPropagation();
                    }
                  }}
                />
                <button
                  type="submit"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <RiCheckLine className="size-4" />
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                >
                  <RiCloseLine className="size-4" />
                </button>
              </form>
              <div className="flex items-center gap-2 typography-micro text-muted-foreground/60 min-w-0 overflow-hidden leading-tight">
                {hasChildren ? (
                  <span className="inline-flex items-center justify-center flex-shrink-0">
                    {isExpanded ? (
                      <RiArrowDownSLine className="h-3 w-3" />
                    ) : (
                      <RiArrowRightSLine className="h-3 w-3" />
                    )}
                  </span>
                ) : null}
                <span className="flex-shrink-0">{formatSessionDateLabel(session.time?.updated || session.time?.created || Date.now())}</span>
                {session.share ? (
                  <RiShare2Line className="h-3 w-3 text-[color:var(--status-info)] flex-shrink-0" />
                ) : null}
                {(sessionSummary?.files ?? 0) > 0 ? (
                  <span className="flex-shrink-0">
                    · {sessionSummary!.files} {sessionSummary!.files === 1 ? 'file' : 'files'} changed
                  </span>
                ) : null}
                {hasChildren ? (
                  <span className="truncate">
                    {node.children.length} {node.children.length === 1 ? 'task' : 'tasks'}
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        );
      }

      const statusType = sessionStatus?.get(session.id)?.type ?? 'idle';
      const isStreaming = statusType === 'busy' || statusType === 'retry';
      const pendingPermissionCount = permissions.get(session.id)?.length ?? 0;
      const showUnreadStatus = !isStreaming && needsAttention && !isActive;
      const showStatusMarker = isStreaming || showUnreadStatus;

      const streamingIndicator = (() => {
        if (!memoryState) return null;
        if (memoryState.isZombie) {
          return <RiErrorWarningLine className="h-4 w-4 text-status-warning" />;
        }
        return null;
      })();

      return (
        <React.Fragment key={session.id}>
          <DraggableSessionRow sessionId={session.id} sessionDirectory={sessionDirectory ?? null} sessionTitle={sessionTitle}>
          <div
            className={cn(
              'group relative flex items-center rounded-md px-1.5 py-1',
              isActive ? 'bg-interactive-selection' : 'hover:bg-interactive-hover',
              isMissingDirectory ? 'opacity-75' : '',
              depth > 0 && 'pl-[20px]',
            )}
            onContextMenu={(e) => {
              e.preventDefault();
              setOpenMenuSessionId(session.id);
            }}
          >
            <div className="flex min-w-0 flex-1 items-center">
              <button
                type="button"
                disabled={isMissingDirectory}
                onClick={() => handleSessionSelect(session.id, sessionDirectory, isMissingDirectory, projectId)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleSessionDoubleClick();
                }}
                  className={cn(
                    'flex min-w-0 flex-1 cursor-pointer flex-col gap-0 overflow-hidden rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-foreground select-none disabled:cursor-not-allowed',
                  )}
              >
                {}
                  <div className="flex w-full items-center gap-2 min-w-0 flex-1 overflow-hidden">
                    {showStatusMarker ? (
                    <span className="inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
                      {isStreaming ? (
                        <GridLoader size="xs" className="text-primary" />
                      ) : (
                        <span className="grid grid-cols-3 gap-[1px] text-[var(--status-info)]" aria-label="Unread updates" title="Unread updates">
                          {Array.from({ length: 9 }, (_, i) => (
                            ATTENTION_DIAMOND_INDICES.has(i) ? (
                              <span
                                key={i}
                                className="h-[3px] w-[3px] rounded-full bg-current animate-attention-diamond-pulse"
                                style={{ animationDelay: getAttentionDiamondDelay(i) }}
                              />
                            ) : (
                              <span key={i} className="h-[3px] w-[3px]" />
                            )
                          ))}
                        </span>
                      )}
                    </span>
                  ) : null}
                  {isPinnedSession ? (
                    <RiPushpinLine className="h-3 w-3 flex-shrink-0 text-primary" aria-label="Pinned session" />
                  ) : null}
                  {loopTrackedSessionIds.has(session.id) ? (
                    <RiLoopLeftLine className="h-3 w-3 flex-shrink-0 text-muted-foreground" aria-label="Agent loop session" />
                  ) : null}
                  <div className="block min-w-0 flex-1 truncate typography-ui-label font-normal text-foreground">
                    {renderHighlightedText(sessionTitle, normalizedSessionSearchQuery)}
                  </div>

                  {pendingPermissionCount > 0 ? (
                    <span
                      className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1 py-0.5 text-[0.7rem] text-destructive flex-shrink-0"
                      title="Permission required"
                      aria-label="Permission required"
                    >
                      <RiShieldLine className="h-3 w-3" />
                      <span className="leading-none">{pendingPermissionCount}</span>
                    </span>
                  ) : null}
                </div>

                {}
                <div className="flex items-center gap-2 typography-micro text-muted-foreground/60 min-w-0 overflow-hidden leading-tight">
                  {hasChildren ? (
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleParent(session.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          event.stopPropagation();
                          toggleParent(session.id);
                        }
                      }}
                      className="inline-flex items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 flex-shrink-0 rounded-sm"
                      aria-label={isExpanded ? 'Collapse subsessions' : 'Expand subsessions'}
                    >
                      {isExpanded ? (
                        <RiArrowDownSLine className="h-3 w-3" />
                      ) : (
                        <RiArrowRightSLine className="h-3 w-3" />
                      )}
                    </span>
                  ) : null}
                  <span className="flex-shrink-0">{formatSessionDateLabel(session.time?.updated || session.time?.created || Date.now())}</span>
                  {session.share ? (
                    <RiShare2Line className="h-3 w-3 text-[color:var(--status-info)] flex-shrink-0" />
                  ) : null}
                  {(sessionSummary?.files ?? 0) > 0 ? (
                    <span className="flex-shrink-0">
                      · {sessionSummary!.files} {sessionSummary!.files === 1 ? 'file' : 'files'} changed
                    </span>
                  ) : null}
                  {hasChildren ? (
                    <span className="truncate">
                      {node.children.length} {node.children.length === 1 ? 'task' : 'tasks'}
                    </span>
                  ) : null}
                  {isMissingDirectory ? (
                    <span className="inline-flex items-center gap-0.5 text-status-warning flex-shrink-0">
                      <RiErrorWarningLine className="h-3 w-3" />
                      Missing
                    </span>
                  ) : null}
                </div>
              </button>

              <div className="flex items-center gap-1.5 self-stretch">
                {streamingIndicator}
                <DropdownMenu
                  open={openMenuSessionId === session.id}
                  onOpenChange={(open) => setOpenMenuSessionId(open ? session.id : null)}
                >
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      className={cn(
                        'inline-flex h-3.5 w-[18px] items-center justify-center rounded-md text-muted-foreground transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                        mobileVariant ? 'opacity-70' : 'opacity-0 group-hover:opacity-100',
                      )}
                      aria-label="Session menu"
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <RiMore2Line className={mobileVariant ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="end"
                    className="min-w-[180px]"
                    onCloseAutoFocus={(event) => {
                      if (renamingFolderId) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <DropdownMenuItem
                      onClick={() => {
                        setEditingId(session.id);
                        setEditTitle(sessionTitle);
                      }}
                      className="[&>svg]:mr-1"
                    >
                      <RiPencilAiLine className="mr-1 h-4 w-4" />
                      Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => togglePinnedSession(session.id)} className="[&>svg]:mr-1">
                      {isPinnedSession ? (
                        <RiUnpinLine className="mr-1 h-4 w-4" />
                      ) : (
                        <RiPushpinLine className="mr-1 h-4 w-4" />
                      )}
                      {isPinnedSession ? 'Unpin session' : 'Pin session'}
                    </DropdownMenuItem>
                    {!session.share ? (
                      <DropdownMenuItem onClick={() => handleShareSession(session)} className="[&>svg]:mr-1">
                        <RiShare2Line className="mr-1 h-4 w-4" />
                        Share
                      </DropdownMenuItem>
                    ) : (
                      <>
                        <DropdownMenuItem
                          onClick={() => {
                            if (session.share?.url) {
                              handleCopyShareUrl(session.share.url, session.id);
                            }
                          }}
                          className="[&>svg]:mr-1"
                        >
                          {copiedSessionId === session.id ? (
                            <>
                              <RiCheckLine className="mr-1 h-4 w-4" style={{ color: 'var(--status-success)' }} />
                              Copied
                            </>
                          ) : (
                            <>
                              <RiFileCopyLine className="mr-1 h-4 w-4" />
                              Copy link
                            </>
                          )}
                        </DropdownMenuItem>
                        <DropdownMenuItem onClick={() => handleUnshareSession(session.id)} className="[&>svg]:mr-1">
                          <RiLinkUnlinkM className="mr-1 h-4 w-4" />
                          Unshare
                        </DropdownMenuItem>
                      </>
                    )}
                    {/* Move to folder submenu */}
                    {sessionDirectory ? (() => {
                      const scopeFolders = getFoldersForScope(sessionDirectory);
                      const currentFolderId = getSessionFolderId(sessionDirectory, session.id);
                      return (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuSub>
                            <DropdownMenuSubTrigger className="[&>svg]:mr-1">
                              <RiFolderLine className="h-4 w-4" />
                              Move to folder
                            </DropdownMenuSubTrigger>
                            <DropdownMenuSubContent className="min-w-[180px]">
                              {scopeFolders.length === 0 ? (
                                <DropdownMenuItem disabled className="text-muted-foreground">
                                  No folders yet
                                </DropdownMenuItem>
                              ) : (
                                scopeFolders.map((folder) => (
                                  <DropdownMenuItem
                                    key={folder.id}
                                    onClick={() => {
                                      if (currentFolderId === folder.id) {
                                        removeSessionFromFolder(sessionDirectory, session.id);
                                      } else {
                                        addSessionToFolder(sessionDirectory, folder.id, session.id);
                                      }
                                    }}
                                  >
                                    <span className="flex-1 truncate">{folder.name}</span>
                                    {currentFolderId === folder.id ? (
                                      <RiCheckLine className="ml-2 h-3.5 w-3.5 text-primary flex-shrink-0" />
                                    ) : null}
                                  </DropdownMenuItem>
                                ))
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                 onClick={() => {
                                    const newFolder = createFolderAndStartRename(sessionDirectory);
                                    if (!newFolder) {
                                      return;
                                    }
                                    addSessionToFolder(sessionDirectory, newFolder.id, session.id);
                                  }}
                              >
                                <RiAddLine className="mr-1 h-4 w-4" />
                                New folder...
                              </DropdownMenuItem>
                              {currentFolderId ? (
                                <DropdownMenuItem
                                  onClick={() => {
                                    removeSessionFromFolder(sessionDirectory, session.id);
                                  }}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <RiCloseLine className="mr-1 h-4 w-4" />
                                  Remove from folder
                                </DropdownMenuItem>
                              ) : null}
                            </DropdownMenuSubContent>
                          </DropdownMenuSub>
                        </>
                      );
                    })() : null}
                    <DropdownMenuItem
                      disabled={!sessionDirectory}
                      onClick={() => {
                        if (!sessionDirectory) {
                          return;
                        }

                        openContextPanelTab(sessionDirectory, {
                          mode: 'chat',
                          dedupeKey: `session:${session.id}`,
                          label: sessionTitle,
                        });
                      }}
                      className="[&>svg]:mr-1"
                    >
                      <RiChat4Line className="mr-1 h-4 w-4" />
                      <span className="truncate">Open in Side Panel</span>
                      <span className="shrink-0 typography-micro px-1 rounded leading-none pb-px text-[var(--status-warning)] bg-[var(--status-warning)]/10">
                        beta
                      </span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive [&>svg]:mr-1"
                      onClick={() => handleDeleteSession(session)}
                    >
                      <RiDeleteBinLine className="mr-1 h-4 w-4" />
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
          </DraggableSessionRow>
          {hasChildren && isExpanded
            ? node.children.map((child) =>
                renderSessionNode(child, depth + 1, sessionDirectory ?? groupDirectory, projectId),
              )
            : null}
        </React.Fragment>
      );
    },
    [
      directoryStatus,
      sessionMemoryState,
      sessionStatus,
      sessionAttentionStates,
      permissions,
      currentSessionId,
      hasSessionSearchQuery,
      normalizedSessionSearchQuery,
      expandedParents,
      editingId,
      editTitle,
      handleSaveEdit,
      handleCancelEdit,
      toggleParent,
      handleSessionSelect,
      handleSessionDoubleClick,
      pinnedSessionIds,
      togglePinnedSession,
      handleShareSession,
      handleCopyShareUrl,
      handleUnshareSession,
      handleDeleteSession,
      copiedSessionId,
      mobileVariant,
      openMenuSessionId,
      renamingFolderId,
      getFoldersForScope,
      getSessionFolderId,
      addSessionToFolder,
      removeSessionFromFolder,
      createFolderAndStartRename,
      openContextPanelTab,
      notifyOnSubtasks,
      loopTrackedSessionIds,
    ],
  );

        const visit = (nodes: SessionNode[]) => {
          nodes.forEach((node) => {
            const nextProjectPathLength = section.project.normalizedPath.length;
            const currentProjectPathLength = projectPathLengthBySessionId.get(node.session.id) ?? -1;
            if (nextProjectPathLength < currentProjectPathLength) {
              return;
            }

            meta.set(node.session.id, {
              node,
              projectId: section.project.id,
              groupDirectory: group.directory,
              secondaryMeta,
            });
            projectPathLengthBySessionId.set(node.session.id, nextProjectPathLength);
            if (node.children.length > 0) {
              visit(node.children);
            }
          });
        };

        visit(group.sessions);
      });
    });

    return meta;
  }, [projectSections, homeDirectory]);

  // Prefetch is wired below, after recentSessionIds is computed.

  const projectColorById = React.useMemo(() => {
    const map = new Map<string, string>();
    normalizedProjects.forEach((p) => {
      if (p.color) {
        map.set(p.id, p.color);
      }
    });
    return map;
  }, [normalizedProjects]);

  // Recently updated: non-archived, non-subtask sessions from the configured time window sorted by updated_at desc
  const recentSessions = React.useMemo(() => {
    const cutoff = Date.now() - recentSessionHours * 60 * 60 * 1000;
    return sortedSessions.filter((session) => {
      if (session.time?.archived) return false;
      // Kiểm tra tất cả các khả năng tên trường để xác định session con (sub-session)
      const parentID = getSessionParentId(session);
      if (parentID) return false;
      const sessionTimestamp = session.time?.updated || session.time?.created || 0;
      if (sessionTimestamp < cutoff) return false;
      return true;
    });
  }, [sortedSessions, recentSessionHours]);

  const activitySections = React.useMemo(() => {
    if (!showRecentSection) {
      return [];
    }

    const toItem = (session: Session) => {
      const existing = sessionSidebarMetaById.get(session.id);
      const sessionDirectory = normalizePath((session as Session & { directory?: string | null }).directory ?? null);
      const projectId = existing?.projectId ?? null;
      return {
        node: existing?.node ?? { session, children: [], worktree: null },
        projectId,
        projectColor: projectId ? (projectColorById.get(projectId) ?? null) : null,
        groupDirectory: existing?.groupDirectory ?? sessionDirectory,
        secondaryMeta: existing?.secondaryMeta ?? null,
      };
    };

    return [
      { key: 'active-now' as const, title: 'RECENT', items: recentSessions.map(toItem) },
    ];
  }, [recentSessions, sessionSidebarMetaById, projectColorById]);

  const recentSessionIds = React.useMemo(() => {
    return new Set(activeNowSessions.map((session) => session.id));
  }, [activeNowSessions]);

  const recentSessionIdsList = React.useMemo(() => [...recentSessionIds], [recentSessionIds]);

  useSessionPrefetch({
    currentSessionId,
    sortedSessions,
    recentSessionIds: recentSessionIdsList,
    ensureSessionRenderable: sync.ensureSessionRenderable,
  });

  const sectionsForSidebarRender = React.useMemo(() => {
    if (
      !isVSCode
      || showOnlyMainWorkspace
      || hasSessionSearchQuery
      || recentSessionIds.size === 0
    ) {
      return sectionsForRender;
    }

    const filterNodes = (nodes: SessionNode[]): SessionNode[] => {
      return nodes.reduce<SessionNode[]>((acc, node) => {
        if (recentSessionIds.has(node.session.id)) {
          return acc;
        }

        const filteredChildren = filterNodes(node.children);
        if (filteredChildren.length === node.children.length) {
          acc.push(node);
          return acc;
        }

        acc.push({
          ...node,
          children: filteredChildren,
        });
        return acc;
      }, []);
    };

    return sectionsForRender.map((section) => ({
      ...section,
      groups: section.groups.map((group) => ({
        ...group,
        sessions: filterNodes(group.sessions),
      })),
    }));
  }, [
    isVSCode,
    showOnlyMainWorkspace,
    hasSessionSearchQuery,
    recentSessionIds,
    sectionsForRender,
  ]);

  const prLookupKeys = React.useMemo(() => {
    const keys = new Set<string>();
    sectionsForSidebarRender.forEach((section) => {
      section.groups.forEach((group) => {
        const directory = normalizePath(group.directory ?? null);
        const branch = group.branch?.trim() || gitBranches.get(directory || '')?.trim();
        if (!directory || !branch) {
          return;
        }
        keys.add(getGitHubPrStatusKey(directory, branch));
      });
    });
    return [...keys];
  }, [gitBranches, sectionsForSidebarRender]);

  const prVisualSummaryMap = usePrVisualSummaryByKeys(prLookupKeys);

  React.useEffect(() => {
    if (!githubAuthChecked || !githubAuthStatus?.connected || !github) {
      return;
    }

    const missingTargets: Array<{ directory: string; branch: string; remoteName?: string | null }> = [];
    const now = Date.now();

    sectionsForSidebarRender.forEach((section) => {
      if (collapsedProjects.has(section.project.id)) {
        return;
      }

      section.groups.forEach((group) => {
        const directory = normalizePath(group.directory ?? null);
        const branch = group.branch?.trim() || gitBranches.get(directory || '')?.trim();
        if (!directory || !branch) {
          return;
        }
        const key = getGitHubPrStatusKey(directory, branch);
        const entry = useGitHubPrStatusStore.getState().entries[key];
        const hasPr = Boolean(entry?.status?.pr);
        const retryKey = `${directory}::${branch}`;
        const noPrLastCheckedAt = Math.max(entry?.lastRefreshAt ?? 0, entry?.lastDiscoveryPollAt ?? 0);
        const shouldRetryNoPr = Boolean(
          entry?.isInitialStatusResolved
          && !hasPr
          && (
            !retriedNoPrStatusKeysRef.current.has(retryKey)
            || now - noPrLastCheckedAt >= SIDEBAR_PR_NO_PR_RETRY_MS
          ),
        );

        if (!entry || !entry.isInitialStatusResolved || shouldRetryNoPr) {
          if (shouldRetryNoPr) {
            retriedNoPrStatusKeysRef.current.add(retryKey);
          }
          missingTargets.push({ directory, branch });
        }
      });
    });

    if (missingTargets.length === 0) {
      return;
    }

    const uniqueTargets = new Map<string, { directory: string; branch: string; remoteName?: string | null }>();
    missingTargets.forEach((target) => {
      const key = getGitHubPrStatusKey(target.directory, target.branch, target.remoteName ?? null);
      if (!uniqueTargets.has(key)) {
        uniqueTargets.set(key, target);
      }
    });

    uniqueTargets.forEach((target, key) => {
      ensurePrStatusEntry(key);
      setPrStatusParams(key, {
        directory: target.directory,
        branch: target.branch,
        remoteName: target.remoteName ?? null,
        canShow: true,
        github,
        githubAuthChecked,
        githubConnected: githubAuthStatus.connected,
      });
    });

    void refreshPrStatusTargets([...uniqueTargets.values()], {
      force: true,
      silent: true,
      markInitialResolved: true,
    });
  }, [
    collapsedProjects,
    ensurePrStatusEntry,
    github,
    githubAuthChecked,
    githubAuthStatus?.connected,
    gitBranches,
    refreshPrStatusTargets,
    sectionsForSidebarRender,
    setPrStatusParams,
  ]);

  const desktopHeaderActionButtonClass =
    'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md leading-none text-foreground hover:bg-interactive-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed';
  const mobileHeaderActionButtonClass =
    'inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md leading-none text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 disabled:cursor-not-allowed';
  const headerActionButtonClass = mobileVariant ? mobileHeaderActionButtonClass : desktopHeaderActionButtonClass;
  const headerActionIconClass = 'h-4.5 w-4.5';
  const stuckProjectHeaders = useStickyProjectHeaders({
    isDesktopShellRuntime,
    projectSections,
    projectHeaderSentinelRefs,
  });

  const renderSessionNode = React.useCallback(
    (
      node: SessionNode,
      depth = 0,
      groupDirectory?: string | null,
      projectId?: string | null,
      archivedBucket = false,
      secondaryMeta?: { projectLabel?: string | null; branchLabel?: string | null } | null,
      renderContext: 'project' | 'recent' = 'project',
      projectColor?: string | null,
    ): React.ReactNode => (
      <SessionNodeItem
        key={node.session.id}
        node={node}
        depth={depth}
        groupDirectory={groupDirectory}
        projectId={projectId}
        archivedBucket={archivedBucket}
        directoryStatus={directoryStatus}
        currentSessionId={currentSessionId}
        pinnedSessionIds={pinnedSessionIds}
        expandedParents={expandedParents}
        hasSessionSearchQuery={hasSessionSearchQuery}
        normalizedSessionSearchQuery={normalizedSessionSearchQuery}
        notifyOnSubtasks={notifyOnSubtasks}
        editingId={editingId}
        setEditingId={setEditingId}
        editTitle={editTitle}
        setEditTitle={setEditTitle}
        handleSaveEdit={handleSaveEdit}
        handleCancelEdit={handleCancelEdit}
        toggleParent={toggleParent}
        handleSessionSelect={handleSessionSelect}
        handleSessionDoubleClick={handleSessionDoubleClick}
        togglePinnedSession={togglePinnedSession}
        handleShareSession={handleShareSession}
        copiedSessionId={copiedSessionId}
        handleCopyShareUrl={handleCopyShareUrl}
        handleUnshareSession={handleUnshareSession}
        openSidebarMenuKey={openSidebarMenuKey}
        setOpenSidebarMenuKey={setOpenSidebarMenuKey}
        renamingFolderId={renamingFolderId}
        getFoldersForScope={getFoldersForScope}
        getSessionFolderId={getSessionFolderId}
        removeSessionFromFolder={removeSessionFromFolder}
        addSessionToFolder={addSessionToFolder}
        createFolderAndStartRename={createFolderAndStartRename}
        openContextPanelTab={openContextPanelTab}
        handleDeleteSession={handleDeleteSession}
        mobileVariant={mobileVariant}
        alwaysShowActions={alwaysShowSidebarActions}
        renderSessionNode={renderSessionNode}
        secondaryMeta={secondaryMeta}
        renderContext={renderContext}
        projectColor={projectColor}
      />
    ),
    [
      directoryStatus,
      currentSessionId,
      pinnedSessionIds,
      expandedParents,
      hasSessionSearchQuery,
      normalizedSessionSearchQuery,
      notifyOnSubtasks,
      editingId,
      setEditingId,
      editTitle,
      setEditTitle,
      handleSaveEdit,
      handleCancelEdit,
      toggleParent,
      handleSessionSelect,
      handleSessionDoubleClick,
      togglePinnedSession,
      handleShareSession,
      copiedSessionId,
      handleCopyShareUrl,
      handleUnshareSession,
      openSidebarMenuKey,
      setOpenSidebarMenuKey,
      renamingFolderId,
      getFoldersForScope,
      getSessionFolderId,
      removeSessionFromFolder,
      addSessionToFolder,
      createFolderAndStartRename,
      openContextPanelTab,
      handleDeleteSession,
      mobileVariant,
      alwaysShowSidebarActions,
    ],
  );

  const toggleCollapsedGroup = React.useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const prVisualStateByDirectoryBranch = React.useMemo(() => {
    const result = new Map<string, PrIndicator>();
    for (const [key, summary] of prVisualSummaryMap) {
      result.set(key, {
        visualState: summary.visualState as PrVisualState,
        number: summary.number,
        url: summary.url,
        state: summary.prState as 'open' | 'closed' | 'merged',
        draft: summary.draft,
        title: summary.title,
        base: summary.base,
        head: summary.head,
        checks: summary.checks as PrIndicator['checks'],
        canMerge: summary.canMerge,
        mergeableState: summary.mergeableState,
        repo: summary.repo,
      });
    }
    return result;
  }, [prVisualSummaryMap]);

  const renderGroupSessions = React.useCallback(
    (group: SessionGroup, groupKey: string, projectId?: string | null, hideGroupLabel?: boolean, dragHandleProps?: SortableDragHandleProps | null, compactBodyPadding?: boolean) => (
      <SessionGroupSection
        group={group}
        groupKey={groupKey}
        projectId={projectId}
        hideGroupLabel={hideGroupLabel}
        compactBodyPadding={compactBodyPadding}
        hasSessionSearchQuery={hasSessionSearchQuery}
        normalizedSessionSearchQuery={normalizedSessionSearchQuery}
        groupSearchDataByGroup={groupSearchDataByGroup}
        expandedSessionGroups={expandedSessionGroups}
        collapsedGroups={collapsedGroups}
        hideDirectoryControls={hideDirectoryControls}
        collapsedFolderIds={collapsedFolderIds}
        toggleFolderCollapse={toggleFolderCollapse}
        renameFolder={renameFolder}
        deleteFolder={deleteFolder}
        showDeletionDialog={showDeletionDialog}
        setDeleteFolderConfirm={setDeleteFolderConfirm}
        renderSessionNode={renderSessionNode}
        currentSessionDirectory={currentSessionDirectory}
        projectRepoStatus={projectRepoStatus}
        lastRepoStatus={lastRepoStatusRef.current}
        toggleGroupSessionLimit={toggleGroupSessionLimit}
        mobileVariant={mobileVariant}
        alwaysShowActions={alwaysShowSidebarActions}
        activeProjectId={activeProjectId}
        setActiveProjectIdOnly={setActiveProjectIdOnly}
        setActiveMainTab={setActiveMainTab}
        setSessionSwitcherOpen={setSessionSwitcherOpen}
        openNewSessionDraft={openNewSessionDraft}
        addSessionToFolder={addSessionToFolder}
        createFolderAndStartRename={createFolderAndStartRename}
        renamingFolderId={renamingFolderId}
        renameFolderDraft={renameFolderDraft}
        setRenameFolderDraft={setRenameFolderDraft}
        setRenamingFolderId={setRenamingFolderId}
        pinnedSessionIds={pinnedSessionIds}
        sessionOrderIndex={sessionOrderIndex}
        prVisualStateByDirectoryBranch={prVisualStateByDirectoryBranch}
        onToggleCollapsedGroup={toggleCollapsedGroup}
        dragHandleProps={dragHandleProps}
      />
    ),
    [
      hasSessionSearchQuery,
      normalizedSessionSearchQuery,
      groupSearchDataByGroup,
      expandedSessionGroups,
      collapsedGroups,
      hideDirectoryControls,
      collapsedFolderIds,
      toggleFolderCollapse,
      renameFolder,
      deleteFolder,
      showDeletionDialog,
      renderSessionNode,
      currentSessionDirectory,
      projectRepoStatus,
      toggleGroupSessionLimit,
      mobileVariant,
      alwaysShowSidebarActions,
      activeProjectId,
      setActiveProjectIdOnly,
      setActiveMainTab,
      setSessionSwitcherOpen,
      openNewSessionDraft,
      addSessionToFolder,
      createFolderAndStartRename,
      renamingFolderId,
      renameFolderDraft,
      pinnedSessionIds,
      sessionOrderIndex,
      prVisualStateByDirectoryBranch,
      toggleCollapsedGroup,
    ],
  );

  const topContent = showRecentSection && !hasSessionSearchQuery ? (
    <SidebarActivitySections
      sections={activitySections}
      renderSessionNode={renderSessionNode}
    />
  ) : null;
  const isInlineEditing = Boolean(renamingFolderId || editingId || editingProjectDialogId);

  const selectionModeEnabled = useSessionMultiSelectStore((state) => state.enabled);
  const selectedIds = useSessionMultiSelectStore((state) => state.selectedIds);
  const selectionScopeKey = useSessionMultiSelectStore((state) => state.scopeKey);
  const multiSelectStoreApi = useSessionMultiSelectStore;

  const handleToggleSelectionMode = React.useCallback(() => {
    useSessionMultiSelectStore.getState().toggleMode();
  }, []);
  const handleExitSelectionMode = React.useCallback(() => {
    useSessionMultiSelectStore.getState().disable();
  }, []);

  const bulkScopeIsArchived = React.useMemo(() => {
    if (selectedIds.size === 0) return false;
    if (typeof document === 'undefined') return false;
    let sawActive = false;
    let sawArchived = false;
    for (const id of selectedIds) {
      const rows = document.querySelectorAll<HTMLElement>(`[data-session-row="${CSS.escape(id)}"]`);
      for (const row of rows) {
        if (row.getAttribute('data-session-archived') === '1') sawArchived = true;
        else sawActive = true;
      }
    }
    return sawArchived && !sawActive;
  }, [selectedIds]);

  const derivedSelectionScope = React.useMemo(() => {
    if (selectionScopeKey) return selectionScopeKey;
    if (selectedIds.size === 0) return null;
    if (typeof document === 'undefined') return null;
    for (const id of selectedIds) {
      const row = document.querySelector<HTMLElement>(`[data-session-row="${CSS.escape(id)}"]`);
      const scope = row?.getAttribute('data-session-scope');
      if (scope && scope.length > 0) return scope;
    }
    return null;
  }, [selectedIds, selectionScopeKey]);

  const bulkScopeFolders = React.useMemo(() => {
    if (!derivedSelectionScope) return [];
    return foldersMap[derivedSelectionScope] ?? [];
  }, [foldersMap, derivedSelectionScope]);

  const bulkCanRemoveFromFolder = React.useMemo(() => {
    if (!derivedSelectionScope || selectedIds.size === 0) return false;
    const scopeFolders = foldersMap[derivedSelectionScope] ?? [];
    for (const folder of scopeFolders) {
      for (const id of folder.sessionIds) {
        if (selectedIds.has(id)) return true;
      }
    }
    return false;
  }, [foldersMap, derivedSelectionScope, selectedIds]);

  const handleBulkMoveToFolder = React.useCallback((folderId: string) => {
    if (!derivedSelectionScope || selectedIds.size === 0) return;
    addSessionsToFolder(derivedSelectionScope, folderId, Array.from(selectedIds));
  }, [addSessionsToFolder, selectedIds, derivedSelectionScope]);

  const handleBulkCreateFolderAndMove = React.useCallback(() => {
    if (!derivedSelectionScope || selectedIds.size === 0) return;
    const newFolder = createFolderAndStartRename(derivedSelectionScope);
    if (!newFolder) return;
    addSessionsToFolder(derivedSelectionScope, newFolder.id, Array.from(selectedIds));
  }, [addSessionsToFolder, createFolderAndStartRename, selectedIds, derivedSelectionScope]);

  const handleBulkRemoveFromFolder = React.useCallback(() => {
    if (!derivedSelectionScope || selectedIds.size === 0) return;
    removeSessionsFromFolders(derivedSelectionScope, Array.from(selectedIds));
  }, [removeSessionsFromFolders, selectedIds, derivedSelectionScope]);

  const executeBulkDelete = React.useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (bulkScopeIsArchived) {
      const { deletedIds, failedIds } = await deleteSessions(ids);
      if (deletedIds.length > 0) {
        toast.success(deletedIds.length === 1
          ? t('sessions.sidebar.bulkActions.deletedSingle', { count: deletedIds.length })
          : t('sessions.sidebar.bulkActions.deletedPlural', { count: deletedIds.length }));
      }
      if (failedIds.length > 0) {
        toast.error(failedIds.length === 1
          ? t('sessions.sidebar.bulkActions.failedDeleteSingle', { count: failedIds.length })
          : t('sessions.sidebar.bulkActions.failedDeletePlural', { count: failedIds.length }));
      }
    } else {
      const { archivedIds, failedIds } = await archiveSessions(ids);
      if (archivedIds.length > 0) {
        toast.success(archivedIds.length === 1
          ? t('sessions.sidebar.bulkActions.archivedSingle', { count: archivedIds.length })
          : t('sessions.sidebar.bulkActions.archivedPlural', { count: archivedIds.length }));
      }
      if (failedIds.length > 0) {
        toast.error(failedIds.length === 1
          ? t('sessions.sidebar.bulkActions.failedArchiveSingle', { count: failedIds.length })
          : t('sessions.sidebar.bulkActions.failedArchivePlural', { count: failedIds.length }));
      }
    }
    useSessionMultiSelectStore.getState().clear();
  }, [archiveSessions, bulkScopeIsArchived, deleteSessions, selectedIds, t]);

  const handleBulkDelete = React.useCallback(() => {
    const count = selectedIds.size;
    if (count === 0) return;
    if (!showDeletionDialog) {
      void executeBulkDelete();
      return;
    }
    setBulkDeleteConfirm({ sessionCount: count, archivedBucket: bulkScopeIsArchived });
  }, [bulkScopeIsArchived, executeBulkDelete, selectedIds, showDeletionDialog]);

  const confirmBulkDelete = React.useCallback(async () => {
    setBulkDeleteConfirm(null);
    await executeBulkDelete();
  }, [executeBulkDelete]);

  React.useEffect(() => {
    if (!selectionModeEnabled) return;
    const isMac = typeof navigator !== 'undefined' && /Macintosh|Mac OS X/.test(navigator.userAgent || '');
    const listener = (event: KeyboardEvent) => {
      if (isInlineEditing) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
        return;
      }
      const modifier = isMac ? event.metaKey : event.ctrlKey;
      if (event.key === 'Escape') {
        event.preventDefault();
        useSessionMultiSelectStore.getState().disable();
        return;
      }
      if (modifier && event.key === 'Backspace') {
        event.preventDefault();
        handleBulkDelete();
        return;
      }
      if (modifier && (event.key === 'a' || event.key === 'A')) {
        const rows = typeof document !== 'undefined'
          ? Array.from(document.querySelectorAll<HTMLElement>('[data-session-row]'))
          : [];
        if (rows.length === 0) return;
        event.preventDefault();
        const currentScope = multiSelectStoreApi.getState().scopeKey;
        const targetScope = currentScope
          ?? rows[0]?.getAttribute('data-session-scope')
          ?? null;
        const scopeFilter = (el: HTMLElement): boolean => {
          if (!targetScope) return true;
          return el.getAttribute('data-session-scope') === targetScope;
        };
        const ids = rows
          .filter(scopeFilter)
          .map((el) => el.getAttribute('data-session-row'))
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        if (ids.length === 0) return;
        multiSelectStoreApi.getState().replaceAll(ids, targetScope || null);
      }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [handleBulkDelete, isInlineEditing, multiSelectStoreApi, selectionModeEnabled]);
  const handleSidebarNewSession = React.useCallback(() => {
    setActiveMainTab('chat');
    if (mobileVariant) {
      setSessionSwitcherOpen(false);
    }
    openNewSessionDraft();
  }, [mobileVariant, openNewSessionDraft, setActiveMainTab, setSessionSwitcherOpen]);

  const handleOpenMultiRunFromHeader = React.useCallback(() => {
    setActiveMainTab('chat');
    if (mobileVariant) {
      setSessionSwitcherOpen(false);
    }
    openMultiRunLauncher();
  }, [mobileVariant, openMultiRunLauncher, setActiveMainTab, setSessionSwitcherOpen]);

  return (
    <div
      ref={sessionSearchContainerRef}
      className={cn(
        'relative flex h-full flex-col text-foreground overflow-x-hidden',
        mobileVariant ? '' : 'bg-transparent',
      )}
    >
      {!hideDirectoryControls && (
        <div className={cn('select-none pl-3.5 pr-2 flex-shrink-0 border-b border-border/60', hideProjectSelector ? 'py-1' : 'py-1.5')}>
          {showMobileInstanceSwitcher ? (
            <div className="mb-1 flex h-8 items-center justify-between gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="flex h-8 min-w-0 flex-1 items-center gap-1 rounded-md px-2 text-left text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                  >
                    <span className="truncate typography-ui-label font-medium">{activeInstanceLabel}</span>
                    <RiArrowDownSLine className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[220px] max-w-[320px]">
                  {sortedInstances.length > 0 ? (
                    sortedInstances.map((instance) => (
                      <DropdownMenuItem
                        key={instance.id}
                        onClick={() => handleSwitchInstance(instance.id)}
                        className="gap-2"
                      >
                        {instance.id === currentInstanceId ? <RiCheckLine className="h-4 w-4 text-primary" /> : <span className="h-4 w-4" />}
                        <span className="truncate">{instance.label || instance.origin}</span>
                      </DropdownMenuItem>
                    ))
                  ) : (
                    <DropdownMenuItem disabled>No instances yet</DropdownMenuItem>
                  )}
                  <div className="my-1 h-px bg-border/70" />
                  <DropdownMenuItem onClick={handleAddInstance} className="gap-2">
                    <RiAddLine className="h-4 w-4" />
                    Add instance
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <button
                type="button"
                onClick={handleAddInstance}
                className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                aria-label="Add instance"
              >
                <RiAddLine className="h-4.5 w-4.5" />
              </button>
            </div>
          ) : null}
          {!hideProjectSelector && (
          <div className="flex h-8 items-center justify-between gap-2">
            <DropdownMenu
              onOpenChange={(open) => {
                if (!open) {
                  setIsProjectRenameInline(false);
                }
              }}
            >
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="flex h-8 min-w-0 max-w-[calc(100%-2.5rem)] items-center gap-1 rounded-md px-2 text-left text-foreground hover:bg-interactive-hover/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                >
                  <span className="text-base font-semibold truncate">
                    {activeProjectForHeader
                      ? formatProjectLabel(
                        activeProjectForHeader.label?.trim()
                        || formatDirectoryName(activeProjectForHeader.normalizedPath, homeDirectory)
                        || activeProjectForHeader.normalizedPath,
                      )
                      : 'Projects'}
                  </span>
                  <RiArrowDownSLine className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[220px] max-w-[320px]">
                {normalizedProjects.map((project) => {
                  const label = formatProjectLabel(
                    project.label?.trim()
                    || formatDirectoryName(project.normalizedPath, homeDirectory)
                    || project.normalizedPath
                  );
                  return (
                    <DropdownMenuItem
                      key={project.id}
                      onClick={() => setActiveProjectIdOnly(project.id)}
                      className={cn('truncate', project.id === activeProjectId && 'text-primary')}
                    >
                      <span className="truncate">{label}</span>
                    </DropdownMenuItem>
                  );
                })}
                <div className="my-1 h-px bg-border/70" />
                {!isProjectRenameInline ? (
                  <DropdownMenuItem
                    onClick={(event) => {
                      event.preventDefault();
                      handleStartInlineProjectRename();
                    }}
                    className="gap-2"
                  >
                    <RiPencilAiLine className="h-4 w-4" />
                    Rename project
                  </DropdownMenuItem>
                ) : (
                  <div className="px-2 py-1.5">
                    <form
                      className="flex items-center gap-1"
                      onSubmit={(event) => {
                        event.preventDefault();
                        handleSaveInlineProjectRename();
                      }}
                    >
                      <input
                        value={projectRenameDraft}
                        onChange={(event) => setProjectRenameDraft(event.target.value)}
                        className="h-7 flex-1 rounded border border-border bg-transparent px-2 typography-ui-label text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                        placeholder="Rename project"
                        autoFocus
                        onKeyDown={(event) => {
                          if (event.key === 'Escape') {
                            event.stopPropagation();
                            setIsProjectRenameInline(false);
                            return;
                          }
                          if (event.key === ' ' || event.key === 'Enter') {
                            event.stopPropagation();
                          }
                        }}
                      />
                      <button type="submit" className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground">
                        <RiCheckLine className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsProjectRenameInline(false)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                      >
                        <RiCloseLine className="h-4 w-4" />
                      </button>
                    </form>
                  </div>
                )}
                <DropdownMenuItem
                  onClick={() => {
                    if (!activeProjectForHeader) {
                      return;
                    }
                    removeProject(activeProjectForHeader.id);
                  }}
                  className="text-destructive focus:text-destructive gap-2"
                >
                  <RiCloseLine className="h-4 w-4" />
                  Close project
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button
              type="button"
              onClick={handleOpenDirectoryDialog}
              className={addProjectButtonClass}
              aria-label="Add project"
              title="Add project"
            >
              <RiFolderAddLine className={headerActionIconClass} />
            </button>
          </div>
          )}
          {reserveHeaderActionsSpace ? (
            <div className="-ml-1 flex h-auto min-h-8 flex-col gap-1">
              {activeProjectForHeader ? (
              <>
              <div className="flex h-8 -translate-y-px items-center gap-1.5 rounded-md pl-0 pr-1">
              {stableActiveProjectIsRepo ? (
                <>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!activeProjectForHeader) {
                        return;
                      }
                      if (activeProjectForHeader.id !== activeProjectId) {
                        setActiveProjectIdOnly(activeProjectForHeader.id);
                      }
                      setNewWorktreeDialogOpen(true);
                    }}
                    className={headerActionButtonClass}
                    aria-label="New worktree"
                  >
                    <RiNodeTree className={headerActionIconClass} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}><p>New worktree</p></TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={openMultiRunLauncher}
                    className={headerActionButtonClass}
                    aria-label="New multi-run"
                  >
                    <ArrowsMerge className={headerActionIconClass} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}><p>New multi-run</p></TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={openAgentLoopLauncher}
                    className={headerActionButtonClass}
                    aria-label="New agent loop"
                  >
                    <RiLoopLeftLine className={headerActionIconClass} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}><p>New agent loop</p></TooltipContent>
              </Tooltip>
                </>
              ) : null}
              {useMobileNotesPanel ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => setProjectNotesPanelOpen(true)}
                      className={headerActionButtonClass}
                      aria-label="Project notes and todos"
                    >
                      <RiStickyNoteLine className={headerActionIconClass} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" sideOffset={4}><p>Project notes</p></TooltipContent>
                </Tooltip>
              ) : (
                <DropdownMenu open={projectNotesPanelOpen} onOpenChange={setProjectNotesPanelOpen} modal={false}>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className={headerActionButtonClass}
                          aria-label="Project notes and todos"
                        >
                          <RiStickyNoteLine className={headerActionIconClass} />
                        </button>
                      </DropdownMenuTrigger>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" sideOffset={4}><p>Project notes</p></TooltipContent>
                  </Tooltip>
                  <DropdownMenuContent align="start" className="w-[340px] p-0">
                    <ProjectNotesTodoPanel
                      projectRef={activeProjectRefForHeader}
                      canCreateWorktree={stableActiveProjectIsRepo}
                      onActionComplete={() => setProjectNotesPanelOpen(false)}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={() => setIsSessionSearchOpen((prev) => !prev)}
                    className={headerActionButtonClass}
                    aria-label="Search sessions"
                    aria-expanded={isSessionSearchOpen}
                  >
                    <RiSearchLine className={headerActionIconClass} />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={4}><p>Search sessions</p></TooltipContent>
              </Tooltip>
              </div>
              {isSessionSearchOpen ? (
                <div className="px-1 pb-1">
                  <div className="mb-1 flex items-center justify-between px-0.5 typography-micro text-muted-foreground/80">
                    {hasSessionSearchQuery ? (
                      <span>{searchMatchCount} {searchMatchCount === 1 ? 'match' : 'matches'}</span>
                    ) : <span />}
                    <span>Esc to clear</span>
                  </div>
                  <div className="relative">
                    <RiSearchLine className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <input
                      ref={sessionSearchInputRef}
                      value={sessionSearchQuery}
                      onChange={(event) => setSessionSearchQuery(event.target.value)}
                      placeholder="Search sessions..."
                      className="h-8 w-full rounded-md border border-border bg-transparent pl-8 pr-8 typography-ui-label text-foreground outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                      onKeyDown={(event) => {
                        if (event.key === 'Escape') {
                          event.stopPropagation();
                          if (hasSessionSearchQuery) {
                            setSessionSearchQuery('');
                          } else {
                            setIsSessionSearchOpen(false);
                          }
                        }
                      }}
                    />
                    {sessionSearchQuery.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setSessionSearchQuery('')}
                        className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-interactive-hover/60 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
                        aria-label="Clear search"
                      >
                        <RiCloseLine className="h-3.5 w-3.5" />
                      </button>
                    ) : null}
                  </div>
                </div>
              ) : null}
              </>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <SidebarHeader
        hideDirectoryControls={hideDirectoryControls}
        handleOpenDirectoryDialog={handleOpenDirectoryDialog}
        handleNewSession={handleSidebarNewSession}
        useMobileNotesPanel={useMobileNotesPanel}
        projectNotesPanelOpen={projectNotesPanelOpen}
        setProjectNotesPanelOpen={setProjectNotesPanelOpen}
        activeProjectRefForHeader={activeProjectRefForHeader}
        canOpenMultiRun={projects.length > 0}
        openMultiRunLauncher={handleOpenMultiRunFromHeader}
        headerActionIconClass={headerActionIconClass}
        reserveHeaderActionsSpace={reserveHeaderActionsSpace}
        headerActionButtonClass={headerActionButtonClass}
        isSessionSearchOpen={isSessionSearchOpen}
        setIsSessionSearchOpen={setIsSessionSearchOpen}
        sessionSearchInputRef={sessionSearchInputRef}
        sessionSearchQuery={sessionSearchQuery}
        setSessionSearchQuery={setSessionSearchQuery}
        hasSessionSearchQuery={hasSessionSearchQuery}
        collapseAllProjects={collapseAllProjects}
        expandAllProjects={expandAllProjects}
        openScheduledTasksDialog={() => setScheduledTasksDialogOpen(true)}
        selectionModeEnabled={selectionModeEnabled}
        onToggleSelectionMode={handleToggleSelectionMode}
        showSidebarToggle={isWebRuntime}
        onToggleSidebar={toggleSidebar}
        avoidWindowControlsOverlay={isTabletStandalonePwa}
      />

                return (
                  <SortableProjectItem
                    key={projectKey}
                    id={projectKey}
                    projectLabel={projectLabel}
                    projectDescription={projectDescription}
                    isCollapsed={isCollapsed}
                    isActiveProject={isActiveProject}
                    isRepo={Boolean(isRepo)}
                    isHovered={isHovered}
                    isDesktopShell={isDesktopShellRuntime}
                    isStuck={stuckProjectHeaders.has(projectKey)}
                    hideDirectoryControls={hideDirectoryControls}
                    mobileVariant={mobileVariant}
                    onToggle={() => toggleProject(projectKey)}
                    onHoverChange={(hovered) => setHoveredProjectId(hovered ? projectKey : null)}
                    onNewSession={() => {
                      if (projectKey !== activeProjectId) {
                        setActiveProjectIdOnly(projectKey);
                      }
                      setActiveMainTab('chat');
                      if (mobileVariant) {
                        setSessionSwitcherOpen(false);
                      }
                      openNewSessionDraft({ directoryOverride: project.normalizedPath });
                    }}
                    onNewWorktreeSession={() => {
                      if (projectKey !== activeProjectId) {
                        setActiveProjectIdOnly(projectKey);
                      }
                      setActiveMainTab('chat');
                      if (mobileVariant) {
                        setSessionSwitcherOpen(false);
                      }
                      createWorktreeSession();
                    }}
                    onOpenMultiRunLauncher={() => {
                      if (projectKey !== activeProjectId) {
                        setActiveProjectIdOnly(projectKey);
                      }
                      openMultiRunLauncher();
                    }}
                    onOpenAgentLoopLauncher={() => {
                      if (projectKey !== activeProjectId) {
                        setActiveProjectIdOnly(projectKey);
                      }
                      openAgentLoopLauncher();
                    }}
                    onRenameStart={() => {
                      setEditingProjectId(projectKey);
                      setEditProjectTitle(project.label?.trim() || formatDirectoryName(project.normalizedPath, homeDirectory) || project.normalizedPath);
                    }}
                    onRenameSave={handleSaveProjectEdit}
                    onRenameCancel={handleCancelProjectEdit}
                    onRenameValueChange={setEditProjectTitle}
                    renameValue={editingProjectId === projectKey ? editProjectTitle : ''}
                    isRenaming={editingProjectId === projectKey}
                    onClose={() => removeProject(projectKey)}
                    sentinelRef={(el) => { projectHeaderSentinelRefs.current.set(projectKey, el); }}
                    settingsAutoCreateWorktree={settingsAutoCreateWorktree}
                    showCreateButtons={false}
                    hideHeader
                  >
                    {!isCollapsed ? (
                      <div className="space-y-[0.6rem] py-1">
                        {section.groups.length > 0 ? (
                          <DndContext
                            sensors={sensors}
                            collisionDetection={closestCenter}
                            onDragEnd={(event) => {
                              const { active, over } = event;
                              if (!over || active.id === over.id) {
                                return;
                              }
                              const oldIndex = orderedGroups.findIndex((item) => item.id === active.id);
                              const newIndex = orderedGroups.findIndex((item) => item.id === over.id);
                              if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) {
                                return;
                              }
                              const next = arrayMove(orderedGroups, oldIndex, newIndex).map((item) => item.id);
                              setGroupOrderByProject((prev) => {
                                const map = new Map(prev);
                                map.set(projectKey, next);
                                return map;
                              });
                            }}
                          >
                            <SortableContext
                              items={orderedGroups.map((group) => group.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              {orderedGroups.map((group) => {
                                const groupKey = `${projectKey}:${group.id}`;
                                return (
                                  <SortableGroupItem key={group.id} id={group.id}>
                                    {renderGroupSessions(group, groupKey, projectKey)}
                                  </SortableGroupItem>
                                );
                              })}
                            </SortableContext>
                            <DragOverlay dropAnimation={null} />
                          </DndContext>
                        ) : (
                          <div className="py-1 text-left typography-micro text-muted-foreground">
                            No sessions yet.
                          </div>
                        )}
                      </div>
                    ) : null}
                  </SortableProjectItem>
                );
              })}
          </>
        )}
      </ScrollableOverlay>

      <NewWorktreeDialog
        open={newWorktreeDialogOpen}
        onOpenChange={setNewWorktreeDialogOpen}
        onWorktreeCreated={(worktreePath, options) => {
          setActiveMainTab('chat');
          if (mobileVariant) {
            setSessionSwitcherOpen(false);
          }
          if (options?.sessionId) {
            setCurrentSession(options.sessionId);
            return;
          }
          openNewSessionDraft({ directoryOverride: worktreePath });
        }}
      />

      <ScheduledTasksDialog />

      <SessionDeleteConfirmDialog
        value={deleteSessionConfirm}
        setValue={setDeleteSessionConfirm}
        showDeletionDialog={showDeletionDialog}
        setShowDeletionDialog={setShowDeletionDialog}
        onConfirm={confirmDeleteSession}
      />

      <FolderDeleteConfirmDialog
        value={deleteFolderConfirm}
        setValue={setDeleteFolderConfirm}
        onConfirm={confirmDeleteFolder}
      />

    </div>
  );
};
