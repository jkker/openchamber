const STANDALONE_TOOL_NAMES = new Set<string>(['task']);

const STATIC_TOOL_NAMES = new Set<string>([
    'read', 'file_read',
    'grep', 'search', 'find', 'ripgrep', 'glob',
    'list',
    'webfetch', 'fetch', 'curl', 'wget',
    'websearch', 'web-search', 'search_web', 'codesearch', 'perplexity',
    'skill',
    'todowrite', 'todoread',
    'plan_enter', 'plan_exit',
    'structuredoutput',
]);

const SEARCH_TOOL_NAMES = new Set<string>(['grep', 'search', 'find', 'ripgrep', 'glob']);

const normalizeToolName = (toolName: unknown): string => {
    if (typeof toolName !== 'string') return '';
    const trimmed = toolName.trim().toLowerCase();
    if (!trimmed) return '';

    const withoutIndex = trimmed.replace(/:\d+$/, '');
    if (withoutIndex.includes('.')) {
        const parts = withoutIndex.split('.').filter(Boolean);
        return parts[parts.length - 1] ?? withoutIndex;
    }
    return withoutIndex;
};

export const isExpandableTool = (toolName: unknown): boolean => {
    const normalizedToolName = normalizeToolName(toolName);
    if (!normalizedToolName) {
        return false;
    }

    return !STANDALONE_TOOL_NAMES.has(normalizedToolName) && !STATIC_TOOL_NAMES.has(normalizedToolName);
};

export const isStandaloneTool = (toolName: unknown): boolean => {
    return STANDALONE_TOOL_NAMES.has(normalizeToolName(toolName));
};

export const isStaticTool = (toolName: unknown): boolean => {
    return STATIC_TOOL_NAMES.has(normalizeToolName(toolName));
};

export const getStaticGroupToolName = (toolName: string): string => {
    const normalized = normalizeToolName(toolName);
    if (SEARCH_TOOL_NAMES.has(normalized)) {
        return 'grep';
    }
    return normalized;
};
