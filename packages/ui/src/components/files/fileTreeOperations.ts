import { preparePresortedFileTreeInput, type FileTreePreparedInput, type GitStatusEntry } from '@pierre/trees';

import type { GitStatus } from '@/lib/api/types';

export type OpenChamberFileNode = {
  name: string;
  path: string;
  type: 'file' | 'directory';
  extension?: string;
  relativePath?: string;
};

export type DirectoryEntryLike = {
  name: string;
  path: string;
  isDirectory: boolean;
};

export type MutationRefreshInput = {
  expandedPaths: readonly string[];
  newPath?: string | null;
  oldPath?: string | null;
  parentPath?: string | null;
  type: 'create' | 'delete' | 'rename';
};

const DEFAULT_IGNORED_DIR_NAMES = new Set(['node_modules']);

export const sortFileNodes = (items: readonly OpenChamberFileNode[]): OpenChamberFileNode[] =>
  items.slice().sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === 'directory' ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });

export const normalizePath = (value: string): string => {
  if (!value) return '';

  const raw = value.replace(/\\/g, '/');
  const hadUncPrefix = raw.startsWith('//');

  let normalized = raw.replace(/\/+/g, '/');
  if (hadUncPrefix && !normalized.startsWith('//')) {
    normalized = `/${normalized}`;
  }

  const isUnixRoot = normalized === '/';
  const isWindowsDriveRoot = /^[A-Za-z]:\/$/.test(normalized);
  if (!isUnixRoot && !isWindowsDriveRoot) {
    normalized = normalized.replace(/\/+$/, '');
  }

  return normalized;
};

export const toComparablePath = (value: string): string => (
  /^[A-Za-z]:\//.test(value) ? value.toLowerCase() : value
);

export const isAbsolutePath = (value: string): boolean => (
  value.startsWith('/') || value.startsWith('//') || /^[A-Za-z]:\//.test(value)
);

export const isPathWithinRoot = (path: string, root: string): boolean => {
  const normalizedRoot = normalizePath(root);
  const normalizedPath = normalizePath(path);
  if (!normalizedRoot || !normalizedPath) return false;

  const comparableRoot = toComparablePath(normalizedRoot);
  const comparablePath = toComparablePath(normalizedPath);
  return comparablePath === comparableRoot || comparablePath.startsWith(`${comparableRoot}/`);
};

export const getParentDirectoryPath = (path: string): string => {
  const normalized = normalizePath(path);
  if (!normalized) return '';
  if (normalized === '/' || /^[A-Za-z]:\/$/.test(normalized)) {
    return normalized;
  }

  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash < 0) {
    return normalized;
  }
  if (lastSlash === 0) {
    return '/';
  }

  const parent = normalized.slice(0, lastSlash);
  if (/^[A-Za-z]:$/.test(parent)) {
    return `${parent}/`;
  }
  return parent;
};

export const getAncestorPaths = (filePath: string, root: string): string[] => {
  const normalizedRoot = normalizePath(root);
  const normalizedFile = normalizePath(filePath);
  if (!isPathWithinRoot(normalizedFile, normalizedRoot)) {
    return [];
  }

  const relative = normalizedFile.slice(normalizedRoot.length).replace(/^\//, '');
  if (!relative) {
    return [];
  }

  const parts = relative.split('/');
  const ancestors: string[] = [];
  let current = normalizedRoot;

  for (let index = 0; index < parts.length - 1; index += 1) {
    current = normalizePath(`${current === '/' ? '' : current}/${parts[index]}`);
    ancestors.push(current);
  }

  return ancestors;
};

export const getDisplayPath = (root: string | null, path: string): string => {
  if (!path) {
    return '';
  }

  const normalizedPath = normalizePath(path);
  if (!root || !isPathWithinRoot(normalizedPath, root)) {
    return normalizedPath;
  }

  const relative = normalizedPath.slice(normalizePath(root).length);
  return relative.startsWith('/') ? relative.slice(1) : relative;
};

export const getRelativePath = (root: string, path: string): string => {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  if (normalizedPath === normalizedRoot) {
    return '.';
  }
  if (!normalizedRoot || !isPathWithinRoot(normalizedPath, normalizedRoot)) {
    return normalizedPath;
  }
  return normalizedPath.slice(normalizedRoot.length + 1);
};

export const shouldIgnoreEntryName = (name: string): boolean => DEFAULT_IGNORED_DIR_NAMES.has(name);

export const shouldIgnorePath = (path: string): boolean => {
  const normalized = normalizePath(path);
  return normalized === 'node_modules'
    || normalized.endsWith('/node_modules')
    || normalized.includes('/node_modules/');
};

export const mapDirectoryEntries = (
  dirPath: string,
  entries: readonly DirectoryEntryLike[],
  options: { showGitignored: boolean; showHidden: boolean },
): OpenChamberFileNode[] => {
  const nodes = entries
    .filter((entry) => entry && typeof entry.name === 'string' && entry.name.length > 0)
    .filter((entry) => options.showHidden || !entry.name.startsWith('.'))
    .filter((entry) => options.showGitignored || !shouldIgnoreEntryName(entry.name))
    .map<OpenChamberFileNode>((entry) => {
      const name = entry.name;
      const normalizedEntryPath = normalizePath(entry.path || '');
      const path = normalizedEntryPath
        ? (isAbsolutePath(normalizedEntryPath)
          ? normalizedEntryPath
          : normalizePath(`${dirPath}/${normalizedEntryPath}`))
        : normalizePath(`${dirPath}/${name}`);
      const type = entry.isDirectory ? 'directory' : 'file';
      const extension = type === 'file' && name.includes('.') ? name.split('.').pop()?.toLowerCase() : undefined;
      return { extension, name, path, type };
    });

  return sortFileNodes(nodes);
};

export const toTreePath = (
  root: string,
  absolutePath: string,
  kind: 'file' | 'directory',
): string => {
  const relativePath = getRelativePath(root, absolutePath);
  if (!relativePath || relativePath === '.') {
    return kind === 'directory' ? '' : '.';
  }
  return kind === 'directory' ? `${relativePath.replace(/\/+$/, '')}/` : relativePath;
};

export const fromTreePath = (root: string, treePath: string): string => {
  const normalizedRoot = normalizePath(root);
  const normalizedTreePath = treePath.replace(/\/+$/, '');
  if (!normalizedTreePath) {
    return normalizedRoot;
  }
  return normalizePath(`${normalizedRoot}/${normalizedTreePath}`);
};

export const buildPreparedTreeInput = (
  root: string,
  childrenByDir: Readonly<Record<string, readonly OpenChamberFileNode[]>>,
): { paths: string[]; preparedInput: FileTreePreparedInput } => {
  const normalizedRoot = normalizePath(root);
  const orderedPaths: string[] = [];

  const visit = (directoryPath: string) => {
    const children = childrenByDir[directoryPath] ?? [];
    for (const child of children) {
      const treePath = toTreePath(normalizedRoot, child.path, child.type);
      if (!treePath) {
        continue;
      }
      orderedPaths.push(treePath);
      if (child.type === 'directory') {
        visit(child.path);
      }
    }
  };

  if (normalizedRoot) {
    visit(normalizedRoot);
  }

  return {
    paths: orderedPaths,
    preparedInput: preparePresortedFileTreeInput(orderedPaths),
  };
};

const toTreeGitStatus = (file: GitStatus['files'][number]): GitStatusEntry['status'] | null => {
  // Preserve a stable precedence so combined porcelain states still collapse to
  // one Trees status. Added/deleted/renamed take priority over modified.
  // Git reports staged additions as index === 'A'; working_dir === 'A' is not
  // used by this codebase's git status contract, so only the staged marker
  // maps to Trees' added state here.
  if (file.index === 'R' || file.working_dir === 'R') return 'renamed';
  if (file.index === 'D' || file.working_dir === 'D') return 'deleted';
  if (file.index === 'A') return 'added';
  if (file.working_dir === '?') return 'untracked';
  if (file.working_dir === '!') return 'ignored';
  if (file.index === 'M' || file.working_dir === 'M') return 'modified';
  return null;
};

export const buildTreeGitStatus = (
  root: string,
  gitStatus: GitStatus | null | undefined,
): GitStatusEntry[] => {
  if (!root || !gitStatus?.files?.length) {
    return [];
  }

  return gitStatus.files.flatMap((file) => {
    const status = toTreeGitStatus(file);
    if (!status) {
      return [];
    }

    const absolutePath = normalizePath(`${normalizePath(root)}/${file.path}`);
    const treePath = toTreePath(root, absolutePath, 'file');
    if (!treePath) {
      return [];
    }

    return [{ path: treePath, status } satisfies GitStatusEntry];
  });
};

const collectExpandedDescendants = (
  expandedPaths: readonly string[],
  prefixPath: string,
): string[] => {
  const normalizedPrefix = normalizePath(prefixPath);
  const comparablePrefix = toComparablePath(normalizedPrefix);
  const comparablePrefixWithSlash = `${comparablePrefix}/`;

  return expandedPaths
    .map((path) => normalizePath(path))
    .filter((path) => {
      const comparable = toComparablePath(path);
      return comparable === comparablePrefix || comparable.startsWith(comparablePrefixWithSlash);
    });
};

export const getMutationRefreshTargets = ({
  expandedPaths,
  newPath,
  oldPath,
  parentPath,
  type,
}: MutationRefreshInput): string[] => {
  const targets = new Set<string>();

  if (parentPath) {
    targets.add(normalizePath(parentPath));
  }

  switch (type) {
    case 'create': {
      if (newPath) {
        const normalizedNewPath = normalizePath(newPath);
        if (collectExpandedDescendants(expandedPaths, normalizedNewPath).length > 0) {
          targets.add(normalizedNewPath);
        }
      }
      return Array.from(targets).filter(Boolean);
    }
    case 'delete': {
      if (oldPath) {
        for (const path of collectExpandedDescendants(expandedPaths, oldPath)) {
          targets.add(path);
        }
      }
      return Array.from(targets).filter(Boolean);
    }
    case 'rename': {
      if (oldPath && newPath) {
        const normalizedOldPath = normalizePath(oldPath);
        const normalizedNewPath = normalizePath(newPath);
        for (const path of collectExpandedDescendants(expandedPaths, normalizedOldPath)) {
          const suffix = path.slice(normalizedOldPath.length);
          targets.add(normalizePath(`${normalizedNewPath}${suffix}`));
        }
        targets.add(getParentDirectoryPath(normalizedNewPath));
      }
      return Array.from(targets).filter(Boolean);
    }
  }
};

export const rebaseExpandedPaths = (
  paths: readonly string[],
  oldPrefix: string,
  newPrefix?: string | null,
): string[] => {
  const normalizedOldPrefix = normalizePath(oldPrefix);
  const comparablePrefix = toComparablePath(normalizedOldPrefix);
  const comparablePrefixWithSlash = `${comparablePrefix}/`;

  return Array.from(new Set(paths.flatMap((candidate) => {
    const normalizedCandidate = normalizePath(candidate);
    const comparableCandidate = toComparablePath(normalizedCandidate);
    const matches = comparableCandidate === comparablePrefix || comparableCandidate.startsWith(comparablePrefixWithSlash);
    if (!matches) {
      return [normalizedCandidate];
    }
    if (!newPrefix) {
      return [];
    }
    const suffix = normalizedCandidate.slice(normalizedOldPrefix.length);
    return [normalizePath(`${normalizePath(newPrefix)}${suffix}`)];
  })));
};
