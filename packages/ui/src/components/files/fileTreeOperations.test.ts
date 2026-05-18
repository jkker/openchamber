import { describe, expect, test } from 'bun:test';

import {
  buildPreparedTreeInput,
  buildTreeGitStatus,
  fromTreePath,
  getMutationRefreshTargets,
  isPathWithinRoot,
  mapDirectoryEntries,
  normalizePath,
  rebaseExpandedPaths,
  toTreePath,
} from './fileTreeOperations';

describe('fileTreeOperations', () => {
  test('normalizes unix, windows, unc, and trailing slash paths', () => {
    expect(normalizePath('/repo/src/')).toBe('/repo/src');
    expect(normalizePath('C:\\Repo\\src\\')).toBe('C:/Repo/src');
    expect(normalizePath('C:\\')).toBe('C:/');
    expect(normalizePath('\\\\server\\share\\folder\\')).toBe('//server/share/folder');
    expect(normalizePath('/')).toBe('/');
  });

  test('checks root containment using normalized comparable paths', () => {
    expect(isPathWithinRoot('/repo/src/index.ts', '/repo')).toBe(true);
    expect(isPathWithinRoot('/repo-two/src/index.ts', '/repo')).toBe(false);
    expect(isPathWithinRoot('C:/Repo/src/index.ts', 'c:/repo')).toBe(true);
    expect(isPathWithinRoot('//server/share/folder/file.txt', '//server/share')).toBe(true);
  });

  test('maps directory entries to filtered file tree nodes', () => {
    const nodes = mapDirectoryEntries('/repo', [
      { isDirectory: true, name: 'src', path: '/repo/src' },
      { isDirectory: false, name: '.env', path: '/repo/.env' },
      { isDirectory: true, name: 'node_modules', path: '/repo/node_modules' },
      { isDirectory: false, name: 'README.md', path: 'README.md' },
    ], {
      showGitignored: false,
      showHidden: false,
    });

    expect(nodes).toEqual([
      { name: 'src', path: '/repo/src', type: 'directory' },
      { extension: 'md', name: 'README.md', path: '/repo/README.md', type: 'file' },
    ]);
  });

  test('builds prepared input with root-relative tree paths', () => {
    const result = buildPreparedTreeInput('/repo', {
      '/repo': [
        { name: 'src', path: '/repo/src', type: 'directory' },
        { extension: 'md', name: 'README.md', path: '/repo/README.md', type: 'file' },
      ],
      '/repo/src': [
        { extension: 'ts', name: 'index.ts', path: '/repo/src/index.ts', type: 'file' },
      ],
    });

    expect(result.paths).toEqual(['src/', 'src/index.ts', 'README.md']);
    expect(fromTreePath('/repo', 'src/index.ts')).toBe('/repo/src/index.ts');
    expect(toTreePath('/repo', '/repo/src', 'directory')).toBe('src/');
  });

  test('maps git status entries to tree status values', () => {
    const entries = buildTreeGitStatus('/repo', {
      ahead: 0,
      behind: 0,
      current: 'main',
      files: [
        { index: 'M', path: 'src/index.ts', working_dir: ' ' },
        { index: 'A', path: 'src/new.ts', working_dir: ' ' },
        { index: ' ', path: 'src/untracked.ts', working_dir: '?' },
        { index: ' ', path: 'src/ignored.ts', working_dir: '!' },
        { index: 'R', path: 'src/rename.ts', working_dir: ' ' },
        { index: 'D', path: 'src/deleted.ts', working_dir: ' ' },
      ],
      isClean: false,
      tracking: null,
    });

    expect(entries).toEqual([
      { path: 'src/index.ts', status: 'modified' },
      { path: 'src/new.ts', status: 'added' },
      { path: 'src/untracked.ts', status: 'untracked' },
      { path: 'src/ignored.ts', status: 'ignored' },
      { path: 'src/rename.ts', status: 'renamed' },
      { path: 'src/deleted.ts', status: 'deleted' },
    ]);
  });

  test('targets parent and expanded descendants for mutation refreshes', () => {
    expect(getMutationRefreshTargets({
      expandedPaths: ['/repo/src', '/repo/src/lib'],
      newPath: '/repo/src/components',
      parentPath: '/repo/src',
      type: 'create',
    })).toEqual(['/repo/src']);

    expect(getMutationRefreshTargets({
      expandedPaths: ['/repo/src', '/repo/src/lib'],
      oldPath: '/repo/src',
      parentPath: '/repo',
      type: 'delete',
    })).toEqual(['/repo', '/repo/src', '/repo/src/lib']);

    expect(getMutationRefreshTargets({
      expandedPaths: ['/repo/src', '/repo/src/lib'],
      newPath: '/repo/source',
      oldPath: '/repo/src',
      parentPath: '/repo',
      type: 'rename',
    })).toEqual(['/repo', '/repo/source', '/repo/source/lib']);
  });

  test('rebases expanded paths across rename or removal', () => {
    expect(rebaseExpandedPaths(['/repo/src', '/repo/src/lib', '/repo/docs'], '/repo/src', '/repo/source'))
      .toEqual(['/repo/source', '/repo/source/lib', '/repo/docs']);
    expect(rebaseExpandedPaths(['/repo/src', '/repo/src/lib', '/repo/docs'], '/repo/src', null))
      .toEqual(['/repo/docs']);
    expect(rebaseExpandedPaths(['C:/Repo/src'], 'c:/repo', 'C:/Source'))
      .toEqual(['C:/Source/src']);
  });
});
