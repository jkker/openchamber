import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import type { WorktreeMetadata } from '@/types/worktree';
import { getProjectDirectories } from '@/lib/worktrees/projectDirectories';
import { dedupeSessionsById, isSessionRelatedToProject, normalizePath } from '../utils';
import { getCompatibleSessionArchivedAt, getCompatibleSessionDirectory, getCompatibleSessionProjectWorktree } from '@/sync/compat';

type Args = {
  isVSCode: boolean;
  includeWorktreesInVSCode?: boolean;
  sessions: Session[];
  archivedSessions: Session[];
  sessionsByDirectory: Map<string, Session[]>;
  getSessionsByDirectory: (directory: string) => Session[];
  availableWorktreesByProject: Map<string, WorktreeMetadata[]>;
};

export const useProjectSessionLists = (args: Args) => {
  const {
    isVSCode,
    includeWorktreesInVSCode,
    sessions,
    archivedSessions,
    availableWorktreesByProject,
  } = args;

  const sessionsByDirectory = React.useMemo(() => {
    const next = new Map<string, Session[]>();
    sessions.forEach((session) => {
      const directory = normalizePath((session as Session & { directory?: string | null }).directory ?? null)
        ?? normalizePath((session as Session & { project?: { worktree?: string | null } | null }).project?.worktree ?? null);
      if (!directory) {
        return;
      }

      const collection = next.get(directory) ?? [];
      collection.push(session);
      next.set(directory, collection);
    });
    return next;
  }, [sessions]);

  const sessionPools = React.useMemo(() => {
    const buildChildrenMap = (input: Session[]) => {
      const byParent = new Map<string, Session[]>();
      input.forEach((session) => {
        const parentID = (session as Session & { parentID?: string | null }).parentID;
        if (!parentID) {
          return;
        }
        const bucket = byParent.get(parentID);
        if (bucket) {
          bucket.push(session);
        } else {
          byParent.set(parentID, [session]);
        }
      });
      return byParent;
    };

    const active = dedupeSessionsById(sessions);
    const archivedLike = dedupeSessionsById([...archivedSessions, ...sessions.filter((session) => !session.time?.archived)]);
    return {
      active,
      activeChildrenByParent: buildChildrenMap(active),
      archivedLike,
      archivedLikeChildrenByParent: buildChildrenMap(archivedLike),
    };
  }, [archivedSessions, sessions]);

  // BFS expansion from `input` through `childrenByParent`. Descendants are kept
  // only if `keep` returns true; non-matching nodes also block their subtree
  // from being expanded, preserving the pre-branch invariant that off-project
  // sessions don't leak into a project's list via a parent linkage.
  const includeDescendants = React.useCallback((
    input: Session[],
    childrenByParent: Map<string, Session[]>,
    keep: (session: Session) => boolean,
  ): Session[] => {
    if (input.length === 0) {
      return input;
    }
    const out: Session[] = [];
    const seen = new Set<string>();
    const queue: Session[] = [...input];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current || seen.has(current.id)) {
        continue;
      }
      seen.add(current.id);
      if (!keep(current)) {
        continue;
      }
      out.push(current);
      const children = childrenByParent.get(current.id);
      if (children && children.length > 0) {
        children.forEach((child) => {
          if (!seen.has(child.id)) {
            queue.push(child);
          }
        });
      }
    }
    return out;
  }, []);

  const getSessionsForProject = React.useCallback(
    (project: { normalizedPath: string }) => {
      const worktreesForProject = isVSCode && !includeWorktreesInVSCode
        ? []
        : (availableWorktreesByProject.get(project.normalizedPath) ?? []);
      const directories = [
        project.normalizedPath,
        ...worktreesForProject
          .map((meta) => normalizePath(meta.path) ?? meta.path)
          .filter((value): value is string => Boolean(value)),
      ]);

      const matchedSessions = sessions.filter((session) =>
        isSessionRelatedToProject(session, project.normalizedPath, validDirectories),
      );

      directories.forEach((directory) => {
        const sessionsForDirectory = sessionsByDirectory.get(directory) ?? [];
        sessionsForDirectory.forEach((session) => {
          if (seen.has(session.id)) {
            return;
          }
          seen.add(session.id);
          collected.push(session);
        });
      });
      const validDirectories = new Set(directories);
      const result = includeDescendants(
        collected,
        sessionPools.activeChildrenByParent,
        (session) => isSessionRelatedToProject(session, project.normalizedPath, validDirectories),
      );
      return result;
    },
    [availableWorktreesByProject, includeDescendants, isVSCode, sessionPools.activeChildrenByParent, sessionsByDirectory],
  );

  const getArchivedSessionsForProject = React.useCallback(
    (project: { normalizedPath: string }) => {
      if (isVSCode) {
        const isVSCodeProjectMatch = (session: Session): boolean => {
          const sessionDirectory = normalizePath((session as Session & { directory?: string | null }).directory ?? null);
          const projectWorktree = normalizePath((session as Session & { project?: { worktree?: string | null } | null }).project?.worktree ?? null);
          if (sessionDirectory) {
            return sessionDirectory === project.normalizedPath;
          }
          return projectWorktree === project.normalizedPath;
        };

        const archived = archivedSessions.filter(isVSCodeProjectMatch);

        const unassignedLive = sessions.filter((session) => {
          if (getCompatibleSessionArchivedAt(session)) {
            return false;
          }
          const sessionDirectory = normalizePath(getCompatibleSessionDirectory(session));
          if (sessionDirectory) {
            return false;
          }
          const projectWorktree = normalizePath(getCompatibleSessionProjectWorktree(session));
          return projectWorktree === project.normalizedPath;
        });

        const base = dedupeSessionsById([...archived, ...unassignedLive]);
        const result = includeDescendants(
          base,
          sessionPools.archivedLikeChildrenByParent,
          isVSCodeProjectMatch,
        );
        return result;
      }

      const worktreesForProject = isVSCode && !includeWorktreesInVSCode
        ? []
        : (availableWorktreesByProject.get(project.normalizedPath) ?? []);
      const validDirectories = new Set<string>([
        project.normalizedPath,
        ...worktreesForProject
          .map((meta) => normalizePath(meta.path) ?? meta.path)
          .filter((value): value is string => Boolean(value)),
      ]);

      const collect = (input: Session[]): Session[] => input.filter((session) =>
        isSessionRelatedToProject(session, project.normalizedPath, validDirectories),
      );

      const archived = collect(archivedSessions);
      const unassignedLive = sessions.filter((session) => {
        if (getCompatibleSessionArchivedAt(session)) {
          return false;
        }
        const sessionDirectory = normalizePath(getCompatibleSessionDirectory(session));
        if (sessionDirectory) {
          return false;
        }
        const projectWorktree = normalizePath(getCompatibleSessionProjectWorktree(session));
        if (!projectWorktree) {
          return false;
        }
        return projectWorktree === project.normalizedPath || projectWorktree.startsWith(`${project.normalizedPath}/`);
      });

      const base = dedupeSessionsById([...archived, ...unassignedLive]);
      const result = includeDescendants(
        base,
        sessionPools.archivedLikeChildrenByParent,
        (session) => isSessionRelatedToProject(session, project.normalizedPath, validDirectories),
      );
      return result;
    },
    [archivedSessions, availableWorktreesByProject, includeDescendants, isVSCode, sessionPools.archivedLikeChildrenByParent, sessions],
  );

  return {
    getSessionsForProject,
    getArchivedSessionsForProject,
  };
};
