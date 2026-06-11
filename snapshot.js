import { getState, getGroupMap } from "./storage.js";
import { getMainWindow, queryTabs, createTab, groupTabs, updateTabGroup, isInternalUrl } from "./chrome-api.js";
import { getWorkspaceGroupTitle, mapHexToGroupColor, getGroupIdForWorkspace, registerGroup } from "./workspaces.js";
const SNAPSHOT_KEY = "sessionSnapshotV2";
const HEARTBEAT_ALARM = "snapshot-heartbeat";
const DEBOUNCE_MS = 1000;
let debounceTimer = null;
let restoring = false;
// Guards autoAssignNewTab against grabbing tabs the restore is creating.
export function isRestoring() {
    return restoring;
}
export async function ensureHeartbeat() {
    await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 5 });
}
export function isHeartbeatAlarm(alarmName) {
    return alarmName === HEARTBEAT_ALARM;
}
// Short debounce only; the 5-minute alarm is the durable fallback if the
// service worker dies before the timer fires.
export function scheduleSnapshotSave() {
    if (restoring)
        return;
    if (debounceTimer != null)
        clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        debounceTimer = null;
        void saveSnapshot();
    }, DEBOUNCE_MS);
}
export async function saveSnapshot() {
    if (restoring)
        return;
    const win = await getMainWindow();
    if (win?.id == null)
        return;
    const tabs = await queryTabs({ windowId: win.id });
    const map = await getGroupMap();
    const groupToWorkspace = new Map(Object.entries(map).map(([workspaceId, groupId]) => [groupId, workspaceId]));
    const state = await getState();
    const snapshotTabs = [];
    for (const tab of [...tabs].sort((a, b) => a.index - b.index)) {
        const url = tab.pendingUrl ?? tab.url;
        if (!url || isInternalUrl(url))
            continue;
        snapshotTabs.push({
            url,
            pinned: !!tab.pinned,
            workspaceId: tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
                ? null
                : groupToWorkspace.get(tab.groupId) ?? null,
            active: !!tab.active
        });
    }
    if (!snapshotTabs.length)
        return;
    const snapshot = {
        version: 2,
        savedAt: Date.now(),
        activeWorkspaceId: state.activeWorkspaceId,
        tabs: snapshotTabs
    };
    await chrome.storage.local.set({ [SNAPSHOT_KEY]: snapshot });
}
async function readSnapshot() {
    const data = await chrome.storage.local.get([SNAPSHOT_KEY]);
    const snapshot = data[SNAPSHOT_KEY];
    if (!snapshot || snapshot.version !== 2 || !Array.isArray(snapshot.tabs))
        return null;
    return snapshot;
}
export async function getSnapshotInfo() {
    const snapshot = await readSnapshot();
    if (!snapshot)
        return null;
    return { savedAt: snapshot.savedAt, tabCount: snapshot.tabs.length };
}
// Manual restore only — never runs automatically. Appends tabs to the current
// window; never deletes anything.
export async function restoreFromBackup() {
    const snapshot = await readSnapshot();
    if (!snapshot || !snapshot.tabs.length)
        return;
    const win = await getMainWindow();
    if (win?.id == null)
        return;
    const windowId = win.id;
    restoring = true;
    try {
        const state = await getState();
        const tabIdsByWorkspace = new Map();
        for (const snapshotTab of snapshot.tabs) {
            const created = await createTab({
                windowId,
                url: snapshotTab.url,
                active: false,
                pinned: snapshotTab.pinned
            });
            if (created?.id == null)
                continue;
            const ids = tabIdsByWorkspace.get(snapshotTab.workspaceId) ?? [];
            ids.push(created.id);
            tabIdsByWorkspace.set(snapshotTab.workspaceId, ids);
        }
        for (const [workspaceId, tabIds] of tabIdsByWorkspace) {
            if (!workspaceId || !tabIds.length)
                continue;
            const workspace = state.workspaces.find((w) => w.id === workspaceId);
            if (!workspace)
                continue;
            const existingGroupId = await getGroupIdForWorkspace(workspaceId);
            if (existingGroupId != null) {
                await groupTabs({ groupId: existingGroupId, tabIds: tabIds });
                continue;
            }
            const newGroupId = await groupTabs({
                tabIds: tabIds,
                createProperties: { windowId }
            });
            if (newGroupId == null)
                continue;
            await updateTabGroup(newGroupId, {
                title: getWorkspaceGroupTitle(workspace),
                color: mapHexToGroupColor(workspace.color),
                collapsed: true
            });
            await registerGroup(workspaceId, newGroupId);
        }
    }
    finally {
        restoring = false;
    }
    scheduleSnapshotSave();
}
