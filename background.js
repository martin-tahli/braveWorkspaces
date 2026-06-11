import { getState, setGroupMap, getGroupMap } from "./storage.js";
import { activateWorkspace, autoAssignNewTab, syncActiveWorkspaceFromTab, linkGroupsOnStartup, ungroupWorkspaceTabs, restyleWorkspaceGroup, getWorkspaceStats, moveTabToWorkspace, focusTab } from "./workspaces.js";
import { onWorkspaceSwitched, isSuspendAlarm, handleSuspendAlarm, rescheduleAllSuspends } from "./suspend.js";
import { scheduleSnapshotSave, ensureHeartbeat, saveSnapshot, isHeartbeatAlarm, getSnapshotInfo, restoreFromBackup, isRestoring } from "./snapshot.js";
import { rebuildContextMenu, handleContextMenuClick, handleCommand } from "./features.js";
// ---------- lifecycle ----------
async function initialize() {
    await linkGroupsOnStartup();
    await ensureHeartbeat();
    await rebuildContextMenu();
}
chrome.runtime.onStartup.addListener(() => {
    void initialize();
});
chrome.runtime.onInstalled.addListener(() => {
    void initialize();
});
// ---------- tab events ----------
chrome.tabs.onCreated.addListener((tab) => {
    if (!isRestoring()) {
        void autoAssignNewTab(tab);
    }
    scheduleSnapshotSave();
});
chrome.tabs.onActivated.addListener((activeInfo) => {
    void (async () => {
        const switched = await syncActiveWorkspaceFromTab(activeInfo.tabId);
        if (switched) {
            await onWorkspaceSwitched(switched.previousWorkspaceId, switched.workspaceId);
        }
    })();
    scheduleSnapshotSave();
});
chrome.tabs.onRemoved.addListener(() => {
    scheduleSnapshotSave();
});
chrome.tabs.onMoved.addListener(() => {
    scheduleSnapshotSave();
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === "complete") {
        scheduleSnapshotSave();
    }
});
chrome.tabGroups.onUpdated.addListener(() => {
    scheduleSnapshotSave();
});
chrome.tabGroups.onRemoved.addListener((group) => {
    void (async () => {
        const map = await getGroupMap();
        const entry = Object.entries(map).find(([, gid]) => gid === group.id);
        if (entry) {
            delete map[entry[0]];
            await setGroupMap(map);
        }
    })();
    scheduleSnapshotSave();
});
// ---------- alarms ----------
chrome.alarms.onAlarm.addListener((alarm) => {
    if (isSuspendAlarm(alarm.name)) {
        void handleSuspendAlarm(alarm.name);
        return;
    }
    if (isHeartbeatAlarm(alarm.name)) {
        void saveSnapshot();
    }
});
// ---------- commands / context menu ----------
chrome.commands.onCommand.addListener((command) => {
    void (async () => {
        const switched = await handleCommand(command);
        if (switched) {
            await onWorkspaceSwitched(switched.previousWorkspaceId, switched.workspaceId);
        }
    })();
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
    void handleContextMenuClick(info, tab);
});
// ---------- message router ----------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const msg = message;
    const respond = (work) => {
        work
            .then((data) => sendResponse({ ok: true, data }))
            .catch((err) => {
            console.error(`[workspaces] ${msg.type} failed`, err);
            sendResponse({ ok: false, error: String(err) });
        });
        return true;
    };
    switch (msg.type) {
        case "ACTIVATE_WORKSPACE":
            return respond((async () => {
                const previous = (await getState()).activeWorkspaceId;
                await activateWorkspace(msg.workspaceId);
                await onWorkspaceSwitched(previous, msg.workspaceId);
            })());
        case "MOVE_TAB_TO_WORKSPACE":
            return respond(moveTabToWorkspace(msg.tabId, msg.workspaceId));
        case "UNGROUP_WORKSPACE_TABS":
            return respond(ungroupWorkspaceTabs(msg.workspaceId));
        case "WORKSPACES_CHANGED":
            return respond((async () => {
                if (msg.updatedWorkspaceId) {
                    const workspace = (await getState()).workspaces.find((w) => w.id === msg.updatedWorkspaceId);
                    if (workspace) {
                        await restyleWorkspaceGroup(workspace);
                    }
                }
                await rebuildContextMenu();
                await rescheduleAllSuspends();
            })());
        case "GET_WORKSPACE_STATS":
            return respond(getWorkspaceStats());
        case "GET_SNAPSHOT_INFO":
            return respond(getSnapshotInfo());
        case "RESTORE_FROM_BACKUP":
            return respond(restoreFromBackup());
        case "FOCUS_TAB":
            return respond((async () => {
                const previous = (await getState()).activeWorkspaceId;
                const workspaceId = await focusTab(msg.tabId);
                if (workspaceId && workspaceId !== previous) {
                    await onWorkspaceSwitched(previous, workspaceId);
                }
            })());
        default:
            return false;
    }
});
