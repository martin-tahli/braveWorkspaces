import { DEFAULT_SETTINGS } from "./types.js";
export async function getState() {
    const data = await chrome.storage.local.get([
        "workspaces",
        "activeWorkspaceId",
        "settings"
    ]);
    const partial = data;
    return {
        workspaces: Array.isArray(partial.workspaces) ? partial.workspaces : [],
        activeWorkspaceId: typeof partial.activeWorkspaceId === "string" ? partial.activeWorkspaceId : null,
        settings: { ...DEFAULT_SETTINGS, ...(partial.settings ?? {}) }
    };
}
// Note: chrome.storage.local.set merges at the top level only — nested objects
// like `settings` must always be passed whole, never partially.
export async function setState(partial) {
    await chrome.storage.local.set(partial);
}
export async function getSettings() {
    return (await getState()).settings;
}
// ---------- session-scoped runtime maps ----------
// Group IDs are only valid for the lifetime of the browser session, so the
// workspace→group mapping lives in storage.session (it also survives
// service-worker restarts, which module-level variables do not).
const GROUP_MAP_KEY = "workspaceGroupMap";
const LAST_ACTIVE_TAB_KEY = "workspaceLastActiveTab";
export async function getGroupMap() {
    const data = await chrome.storage.session.get([GROUP_MAP_KEY]);
    return data[GROUP_MAP_KEY] ?? {};
}
export async function setGroupMap(map) {
    await chrome.storage.session.set({ [GROUP_MAP_KEY]: map });
}
export async function getLastActiveTabMap() {
    const data = await chrome.storage.session.get([LAST_ACTIVE_TAB_KEY]);
    return data[LAST_ACTIVE_TAB_KEY] ?? {};
}
export async function setLastActiveTabMap(map) {
    await chrome.storage.session.set({ [LAST_ACTIVE_TAB_KEY]: map });
}
