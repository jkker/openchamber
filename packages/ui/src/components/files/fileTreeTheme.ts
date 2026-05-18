import { themeToTreeStyles, type TreeThemeStyles } from '@pierre/trees';

import type { Theme } from '@/types/theme';

export const createFileTreeTheme = (theme: Theme): TreeThemeStyles => ({
  ...themeToTreeStyles({
    bg: theme.colors.syntax.base.background,
    colors: {
      'focusBorder': theme.colors.interactive.focusRing,
      'foreground': theme.colors.syntax.base.foreground,
      'gitDecoration.addedResourceForeground': theme.colors.status.success,
      'gitDecoration.deletedResourceForeground': theme.colors.status.error,
      'gitDecoration.ignoredResourceForeground': theme.colors.surface.mutedForeground,
      'gitDecoration.modifiedResourceForeground': theme.colors.status.warning,
      'gitDecoration.renamedResourceForeground': theme.colors.status.info,
      'gitDecoration.untrackedResourceForeground': theme.colors.status.success,
      'list.activeSelectionBackground': theme.colors.interactive.selection,
      'list.activeSelectionForeground': theme.colors.interactive.selectionForeground,
      'list.focusOutline': theme.colors.interactive.focusRing,
      'list.hoverBackground': theme.colors.interactive.hover,
      'sideBar.background': theme.colors.surface.background,
      'sideBar.foreground': theme.colors.surface.foreground,
      'sideBarSectionHeader.foreground': theme.colors.surface.foreground,
    },
    fg: theme.colors.syntax.base.foreground,
    type: theme.metadata.variant,
  }),
  '--trees-accent-override': theme.colors.primary.base,
  '--trees-bg-muted-override': theme.colors.surface.muted,
  '--trees-bg-override': theme.colors.surface.background,
  '--trees-border-color-override': theme.colors.interactive.border,
  '--trees-fg-muted-override': theme.colors.surface.mutedForeground,
  '--trees-fg-override': theme.colors.surface.foreground,
  '--trees-focus-ring-color-override': theme.colors.interactive.focusRing,
  '--trees-search-bg-override': theme.colors.surface.elevated,
  '--trees-search-fg-override': theme.colors.surface.foreground,
  '--trees-search-font-weight-override': '500',
  '--trees-selected-bg-override': theme.colors.interactive.selection,
  '--trees-selected-fg-override': theme.colors.interactive.selectionForeground,
  '--trees-selected-focused-border-color-override': theme.colors.interactive.focusRing,
});
