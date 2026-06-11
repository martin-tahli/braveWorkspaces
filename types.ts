export interface Workspace {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export interface Settings {
  suspendEnabled: boolean;
  suspendDelayMinutes: number;
  shortcutsEnabled: boolean;
  contextMenuEnabled: boolean;
  searchEnabled: boolean;
  memoryIndicatorEnabled: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  suspendEnabled: true,
  suspendDelayMinutes: 10,
  shortcutsEnabled: true,
  contextMenuEnabled: true,
  searchEnabled: true,
  memoryIndicatorEnabled: true
};

export interface ExtensionState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  settings: Settings;
}

export interface SnapshotTab {
  url: string;
  pinned: boolean;
  workspaceId: string | null;
  active: boolean;
}

export interface SessionSnapshot {
  version: 2;
  savedAt: number;
  activeWorkspaceId: string | null;
  tabs: SnapshotTab[];
}

export interface SnapshotInfo {
  savedAt: number;
  tabCount: number;
}

export interface WorkspaceStats {
  workspaceId: string;
  tabCount: number;
  discardedCount: number;
}

export interface WorkspaceSwitch {
  previousWorkspaceId: string | null;
  workspaceId: string;
}

export type WorkspaceGroupMap = Record<string, number>;
export type WorkspaceTabMap = Record<string, number>;

export type BackgroundMessage =
  | { type: "ACTIVATE_WORKSPACE"; workspaceId: string }
  | { type: "MOVE_TAB_TO_WORKSPACE"; tabId: number; workspaceId: string }
  | { type: "UNGROUP_WORKSPACE_TABS"; workspaceId: string }
  | { type: "WORKSPACES_CHANGED"; updatedWorkspaceId?: string }
  | { type: "GET_WORKSPACE_STATS" }
  | { type: "GET_SNAPSHOT_INFO" }
  | { type: "RESTORE_FROM_BACKUP" }
  | { type: "FOCUS_TAB"; tabId: number };

export interface MessageResponse<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}
