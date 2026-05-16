import { describe, expect, test } from 'bun:test';

import { getStaticGroupToolName, isExpandableTool, isStandaloneTool, isStaticTool } from './toolRenderUtils';

describe('toolRenderUtils', () => {
    test('keeps built-in expandable tools expandable', () => {
        expect(isExpandableTool('bash')).toBe(true);
        expect(isExpandableTool('write')).toBe(true);
        expect(isExpandableTool('question')).toBe(true);
        expect(isStaticTool('bash')).toBe(false);
    });

    test('keeps task standalone', () => {
        expect(isStandaloneTool('task')).toBe(true);
        expect(isStandaloneTool('functions.task:1')).toBe(true);
        expect(isExpandableTool('task')).toBe(false);
        expect(isStaticTool('task')).toBe(false);
    });

    test('keeps known summary tools static', () => {
        expect(isStaticTool('read')).toBe(true);
        expect(isStaticTool('grep')).toBe(true);
        expect(isStaticTool('glob')).toBe(true);
        expect(isStaticTool('todowrite')).toBe(true);
        expect(isExpandableTool('grep')).toBe(false);
    });

    test('treats unknown custom tool names as expandable', () => {
        expect(isExpandableTool('custom-tool')).toBe(true);
        expect(isExpandableTool('functions.custom_tool')).toBe(true);
        expect(isExpandableTool('multi_tool_use.parallel:2')).toBe(true);
        expect(isStaticTool('custom-tool')).toBe(false);
        expect(isStandaloneTool('custom-tool')).toBe(false);
    });

    test('treats empty or missing tool names as non-expandable', () => {
        expect(isExpandableTool('')).toBe(false);
        expect(isExpandableTool('   ')).toBe(false);
        expect(isExpandableTool(null)).toBe(false);
        expect(isExpandableTool(undefined)).toBe(false);
        expect(isStaticTool(undefined)).toBe(false);
        expect(isStandaloneTool(undefined)).toBe(false);
    });

    test('normalizes grouped static search tool names', () => {
        expect(getStaticGroupToolName('ripgrep')).toBe('grep');
        expect(getStaticGroupToolName('functions.glob')).toBe('grep');
        expect(getStaticGroupToolName('custom-tool')).toBe('custom-tool');
    });
});
