/** Entry-level views only. Avoid barrel re-exports that pull heavy modules into the main chunk. */
export { ChatView } from './ChatView';
export { PlanView } from './PlanView';
export { GitView } from './GitView';
export { DiffView, useDiffFileCount } from './DiffView';
export { KanbanView } from './KanbanView';
export { TerminalView } from './TerminalView';
export { FilesView } from './FilesView';
export { SettingsView } from './SettingsView';
export { SettingsWindow } from './SettingsWindow';
