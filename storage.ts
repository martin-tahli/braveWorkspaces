import { DEFAULT_SETTINGS, type ExtensionState, type Settings } from "./types.js";

export async function getState(): Promise<ExtensionState> {
  const data = await chrome.storage.local.get([
    "workspaces",
    "activeWorkspaceId",
    "settings"
  ]);
  const partial = data as Partial<ExtensionState>;
  return {
    workspaces: Array.isArray(partial.workspaces) ? partial.workspaces : [],
    activeWorkspaceId:
      typeof partial.activeWorkspaceId === "string" ? partial.activeWorkspaceId : null,
    settings: { ...DEFAULT_SETTINGS, ...(partial.settings ?? {}) }
  };
}

export async function setState(partial: Partial<ExtensionState>): Promise<void> {
  await chrome.storage.local.set(partial as Record<string, unknown>);
}

export async function getSettings(): Promise<Settings> {
  return (await getState()).settings;
}

// ---------- session-scoped runtime maps ----------
// Group IDs are only valid for the lifetime of the browser session, so the
// workspace→group mapping lives in storage.session (it also survives
// service-worker restarts, which module-level variables do not).

const GROUP_MAP_KEY = "workspaceGroupMap";
const LAST_ACTIVE_TAB_KEY = "workspaceLastActiveTab";

export type WorkspaceGroupMap = Record<string, number>;
export type WorkspaceTabMap = Record<string, number>;

export async function getGroupMap(): Promise<WorkspaceGroupMap> {
  const data = await chrome.storage.session.get([GROUP_MAP_KEY]);
  return (data[GROUP_MAP_KEY] as WorkspaceGroupMap | undefined) ?? {};
}

export async function setGroupMap(map: WorkspaceGroupMap): Promise<void> {
  await chrome.storage.session.set({ [GROUP_MAP_KEY]: map });
}

export async function getLastActiveTabMap(): Promise<WorkspaceTabMap> {
  const data = await chrome.storage.session.get([LAST_ACTIVE_TAB_KEY]);
  return (data[LAST_ACTIVE_TAB_KEY] as WorkspaceTabMap | undefined) ?? {};
}

export async function setLastActiveTabMap(map: WorkspaceTabMap): Promise<void> {
  await chrome.storage.session.set({ [LAST_ACTIVE_TAB_KEY]: map });
}
