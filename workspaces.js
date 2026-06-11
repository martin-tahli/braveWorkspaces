import { getState, setState, getGroupMap, setGroupMap, getLastActiveTabMap, setLastActiveTabMap } from "./storage.js";
import { queryTabs, queryTabGroups, getTab, getTabGroup, updateTab, updateTabGroup, groupTabs, ungroupTabs, createTab, getMainWindow, isInternalUrl } from "./chrome-api.js";
const PRESET_GROUP_COLOR_MAP = {
    "#FF5252": "red",
    "#FF7F50": "yellow",
    "#FFA726": "yellow",
    "#FFEB3B": "yellow",
    "#C6FF00": "green",
    "#00E676": "green",
    "#1DE9B6": "cyan",
    "#00E5FF": "cyan",
    "#2979FF": "blue",
    "#651FFF": "purple",
    "#D500F9": "purple",
    "#F06292": "pink",
    "#8D6E63": "grey",
    "#BDBDBD": "grey",
    "#607D8B": "blue",
    "#F44336": "red",
    "#FF9800": "yellow",
    "#FFEE58": "yellow",
    "#66BB6A": "green",
    "#42A5F5": "blue",
    "#FF9100": "yellow"
};
function hexToRgb(hex) {
    const trimmed = hex.trim();
    const m = /^#?([0-9a-fA-F]{6})$/.exec(trimmed) || /^#?([0-9a-fA-F]{3})$/.exec(trimmed);
    if (!m)
        return null;
    let value = m[1];
    if (value.length === 3) {
        value = value
            .split("")
            .map((c) => c + c)
            .join("");
    }
    const n = parseInt(value, 16);
    return { r: (n >> 16) & 0xff, g: (n >> 8) & 0xff, b: n & 0xff };
}
function normalizeHex6(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb)
        return null;
    const toHex = (v) => v.toString(16).padStart(2, "0").toUpperCase();
    return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}
function rgbToHsl(r, g, b) {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case r:
                h = (g - b) / d + (g < b ? 6 : 0);
                break;
            case g:
                h = (b - r) / d + 2;
                break;
            case b:
                h = (r - g) / d + 4;
                break;
        }
        h *= 60;
    }
    return { h, s, l };
}
export function mapHexToGroupColor(hex) {
    const key = normalizeHex6(hex);
    if (key && PRESET_GROUP_COLOR_MAP[key]) {
        return PRESET_GROUP_COLOR_MAP[key];
    }
    const rgb = hexToRgb(hex);
    if (!rgb)
        return "grey";
    const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
    if (s < 0.15)
        return "grey";
    if (l > 0.8)
        return "yellow";
    if (h < 15 || h >= 345)
        return "red";
    if (h < 60)
        return "yellow";
    if (h < 150)
        return "green";
    if (h < 200)
        return "cyan";
    if (h < 255)
        return "blue";
    if (h < 315)
        return "purple";
    return "pink";
}
// ---------- group mapping ----------
export function getWorkspaceGroupTitle(workspace) {
    return workspace.icon ? `${workspace.icon} ${workspace.name}` : workspace.name;
}
export async function getGroupIdForWorkspace(workspaceId) {
    const map = await getGroupMap();
    const groupId = map[workspaceId];
    if (groupId == null)
        return null;
    const group = await getTabGroup(groupId);
    if (!group) {
        delete map[workspaceId];
        await setGroupMap(map);
        return null;
    }
    return groupId;
}
export async function getWorkspaceIdForGroup(groupId) {
    const map = await getGroupMap();
    const entry = Object.entries(map).find(([, gid]) => gid === groupId);
    return entry ? entry[0] : null;
}
export async function registerGroup(workspaceId, groupId) {
    const map = await getGroupMap();
    map[workspaceId] = groupId;
    await setGroupMap(map);
}
export async function unregisterGroup(groupId) {
    const map = await getGroupMap();
    const entry = Object.entries(map).find(([, gid]) => gid === groupId);
    if (!entry)
        return;
    delete map[entry[0]];
    await setGroupMap(map);
}
// One-time re-link after browser startup: Brave's native session restore
// recreates groups (with titles/colors) but assigns new group IDs. Match by
// title once, then track by ID for the rest of the session.
export async function linkGroupsOnStartup() {
    const win = await getMainWindow();
    if (win?.id == null)
        return;
    const state = await getState();
    const groups = await queryTabGroups({ windowId: win.id });
    const map = {};
    for (const workspace of state.workspaces) {
        const title = getWorkspaceGroupTitle(workspace);
        const group = groups.find((g) => g.title === title);
        if (group)
            map[workspace.id] = group.id;
    }
    await setGroupMap(map);
}
// ---------- core actions ----------
// Serializes group creation/assignment per workspace so two rapid
// tabs.onCreated events can't both see "no group yet" and create duplicates.
const pendingByWorkspace = new Map();
async function withWorkspaceLock(workspaceId, fn) {
    const previous = pendingByWorkspace.get(workspaceId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(fn);
    pendingByWorkspace.set(workspaceId, current);
    try {
        await current;
    }
    finally {
        if (pendingByWorkspace.get(workspaceId) === current) {
            pendingByWorkspace.delete(workspaceId);
        }
    }
}
export async function addTabToWorkspace(tabId, windowId, workspace) {
    await withWorkspaceLock(workspace.id, async () => {
        const existingGroupId = await getGroupIdForWorkspace(workspace.id);
        if (existingGroupId != null) {
            await groupTabs({ groupId: existingGroupId, tabIds: [tabId] });
            return;
        }
        const newGroupId = await groupTabs({ tabIds: [tabId], createProperties: { windowId } });
        if (newGroupId == null)
            return;
        await updateTabGroup(newGroupId, {
            title: getWorkspaceGroupTitle(workspace),
            color: mapHexToGroupColor(workspace.color),
            collapsed: false
        });
        await registerGroup(workspace.id, newGroupId);
    });
}
export async function collapseOtherWorkspaceGroups(activeWorkspaceId) {
    const map = await getGroupMap();
    for (const [workspaceId, groupId] of Object.entries(map)) {
        await updateTabGroup(groupId, { collapsed: workspaceId !== activeWorkspaceId });
    }
}
export async function activateWorkspace(workspaceId) {
    const state = await getState();
    const workspace = state.workspaces.find((w) => w.id === workspaceId);
    if (!workspace)
        return;
    const win = await getMainWindow();
    if (win?.id == null)
        return;
    const groupId = await getGroupIdForWorkspace(workspaceId);
    if (groupId == null) {
        // Empty workspace: open a fresh tab and group it.
        const tab = await createTab({ windowId: win.id, active: true });
        if (tab?.id != null) {
            await addTabToWorkspace(tab.id, win.id, workspace);
        }
    }
    else {
        await updateTabGroup(groupId, { collapsed: false });
        const tabs = await queryTabs({ groupId });
        const lastActiveMap = await getLastActiveTabMap();
        const preferredId = lastActiveMap[workspaceId];
        const target = tabs.find((t) => t.id === preferredId) ?? tabs.find((t) => t.active) ?? tabs[0];
        if (target?.id != null) {
            await updateTab(target.id, { active: true });
        }
    }
    await collapseOtherWorkspaceGroups(workspaceId);
    await setState({ activeWorkspaceId: workspaceId });
}
// Called from tabs.onActivated. Tracks the last active tab per workspace and
// follows the user when they click into another workspace's group directly in
// the tab strip. Returns the switch if the active workspace changed.
export async function syncActiveWorkspaceFromTab(tabId) {
    const tab = await getTab(tabId);
    if (!tab || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE)
        return null;
    const workspaceId = await getWorkspaceIdForGroup(tab.groupId);
    if (!workspaceId)
        return null;
    const lastActiveMap = await getLastActiveTabMap();
    lastActiveMap[workspaceId] = tabId;
    await setLastActiveTabMap(lastActiveMap);
    const state = await getState();
    if (state.activeWorkspaceId === workspaceId)
        return null;
    await setState({ activeWorkspaceId: workspaceId });
    await updateTabGroup(tab.groupId, { collapsed: false });
    await collapseOtherWorkspaceGroups(workspaceId);
    return { previousWorkspaceId: state.activeWorkspaceId, workspaceId };
}
// Called from tabs.onCreated. New tabs join the opener's workspace if the
// opener is grouped, otherwise the active workspace.
export async function autoAssignNewTab(tab) {
    if (tab.id == null || tab.windowId == null)
        return;
    if (tab.pinned)
        return;
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)
        return;
    const win = await getMainWindow();
    if (win?.id !== tab.windowId)
        return; // single-window focus
    const url = tab.pendingUrl ?? tab.url;
    // Fresh new-tab pages are assignable; other internal pages are not.
    if (url && url !== "chrome://newtab/" && isInternalUrl(url))
        return;
    const state = await getState();
    let workspace = null;
    if (tab.openerTabId != null) {
        const opener = await getTab(tab.openerTabId);
        if (opener && opener.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
            const openerWorkspaceId = await getWorkspaceIdForGroup(opener.groupId);
            if (openerWorkspaceId) {
                workspace = state.workspaces.find((w) => w.id === openerWorkspaceId) ?? null;
            }
        }
    }
    if (!workspace && state.activeWorkspaceId) {
        workspace = state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? null;
    }
    if (!workspace)
        return;
    await addTabToWorkspace(tab.id, tab.windowId, workspace);
}
export async function moveTabToWorkspace(tabId, workspaceId) {
    const state = await getState();
    const workspace = state.workspaces.find((w) => w.id === workspaceId);
    if (!workspace)
        return;
    const tab = await getTab(tabId);
    if (!tab || tab.id == null || tab.windowId == null)
        return;
    await addTabToWorkspace(tab.id, tab.windowId, workspace);
}
export async function restyleWorkspaceGroup(workspace) {
    const groupId = await getGroupIdForWorkspace(workspace.id);
    if (groupId == null)
        return;
    await updateTabGroup(groupId, {
        title: getWorkspaceGroupTitle(workspace),
        color: mapHexToGroupColor(workspace.color)
    });
}
export async function ungroupWorkspaceTabs(workspaceId) {
    const groupId = await getGroupIdForWorkspace(workspaceId);
    if (groupId == null)
        return;
    const tabs = await queryTabs({ groupId });
    const ids = tabs.map((t) => t.id).filter((id) => id != null);
    await ungroupTabs(ids);
    const map = await getGroupMap();
    delete map[workspaceId];
    await setGroupMap(map);
}
// Activate a specific tab, switching workspace first if the tab belongs to
// one. Returns the workspace switched to, if any.
export async function focusTab(tabId) {
    const tab = await getTab(tabId);
    if (!tab || tab.id == null)
        return null;
    let switchedTo = null;
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
        const workspaceId = await getWorkspaceIdForGroup(tab.groupId);
        if (workspaceId) {
            await updateTabGroup(tab.groupId, { collapsed: false });
            await collapseOtherWorkspaceGroups(workspaceId);
            await setState({ activeWorkspaceId: workspaceId });
            const lastActiveMap = await getLastActiveTabMap();
            lastActiveMap[workspaceId] = tab.id;
            await setLastActiveTabMap(lastActiveMap);
            switchedTo = workspaceId;
        }
    }
    await updateTab(tab.id, { active: true });
    return switchedTo;
}
export async function getWorkspaceStats() {
    const state = await getState();
    const map = await getGroupMap();
    const stats = [];
    for (const workspace of state.workspaces) {
        const groupId = map[workspace.id];
        let tabCount = 0;
        let discardedCount = 0;
        if (groupId != null) {
            const tabs = await queryTabs({ groupId });
            tabCount = tabs.length;
            discardedCount = tabs.filter((t) => t.discarded).length;
        }
        stats.push({ workspaceId: workspace.id, tabCount, discardedCount });
    }
    return stats;
}
