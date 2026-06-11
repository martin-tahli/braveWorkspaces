import { getState, getSettings } from "./storage.js";
import { activateWorkspace, moveTabToWorkspace, getWorkspaceGroupTitle } from "./workspaces.js";
const MENU_ROOT_ID = "move-tab-root";
const MENU_ITEM_PREFIX = "move-tab-to:";
// Serializes rebuilds so an overlapping call can't interleave its removeAll
// with another call's create()s.
let menuRebuildChain = Promise.resolve();
export function rebuildContextMenu() {
    menuRebuildChain = menuRebuildChain.catch(() => undefined).then(doRebuildContextMenu);
    return menuRebuildChain;
}
async function doRebuildContextMenu() {
    await chrome.contextMenus.removeAll();
    const settings = await getSettings();
    if (!settings.contextMenuEnabled)
        return;
    const state = await getState();
    if (!state.workspaces.length)
        return;
    chrome.contextMenus.create({
        id: MENU_ROOT_ID,
        title: "Move tab to workspace",
        contexts: ["page"]
    }, () => void chrome.runtime.lastError);
    for (const workspace of state.workspaces) {
        chrome.contextMenus.create({
            id: MENU_ITEM_PREFIX + workspace.id,
            parentId: MENU_ROOT_ID,
            title: getWorkspaceGroupTitle(workspace),
            contexts: ["page"]
        }, () => void chrome.runtime.lastError);
    }
}
export async function handleContextMenuClick(info, tab) {
    if (typeof info.menuItemId !== "string")
        return;
    if (!info.menuItemId.startsWith(MENU_ITEM_PREFIX))
        return;
    if (tab?.id == null)
        return;
    const workspaceId = info.menuItemId.slice(MENU_ITEM_PREFIX.length);
    await moveTabToWorkspace(tab.id, workspaceId);
}
// Commands: switch-workspace-1..4 and next-workspace. Commands can't be
// unregistered at runtime, so the settings toggle is enforced here.
export async function handleCommand(command) {
    const settings = await getSettings();
    if (!settings.shortcutsEnabled)
        return null;
    const state = await getState();
    if (!state.workspaces.length)
        return null;
    let targetId = null;
    const numbered = /^switch-workspace-([1-4])$/.exec(command);
    if (numbered) {
        const index = parseInt(numbered[1], 10) - 1;
        targetId = state.workspaces[index]?.id ?? null;
    }
    else if (command === "next-workspace") {
        const currentIndex = state.workspaces.findIndex((w) => w.id === state.activeWorkspaceId);
        targetId = state.workspaces[(currentIndex + 1) % state.workspaces.length]?.id ?? null;
    }
    if (!targetId || targetId === state.activeWorkspaceId)
        return null;
    await activateWorkspace(targetId);
    return { previousWorkspaceId: state.activeWorkspaceId, workspaceId: targetId };
}
