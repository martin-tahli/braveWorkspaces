import { getState, setState } from "./storage.js";
// ---------- constants ----------
const SESSION_SNAPSHOT_KEY = "workspaceSessionSnapshotV1";
const SESSION_SNAPSHOT_VERSION_V2 = 2;
const SESSION_SAVE_DEBOUNCE_MS = 800;
const SESSION_HEARTBEAT_SAVE_MS = 10_000;
const STARTUP_AUTO_ASSIGN_PAUSE_MS = 15_000;
const STARTUP_RESTORE_DELAY_MS = 1_200;
const STARTUP_FINAL_SAVE_DELAY_MS = STARTUP_AUTO_ASSIGN_PAUSE_MS + 1_000;
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
// ---------- color helpers ----------
function hexToRgb(hex) {
    const trimmed = hex.trim();
    const m = /^#?([0-9a-fA-F]{6})$/.exec(trimmed) ||
        /^#?([0-9a-fA-F]{3})$/.exec(trimmed);
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
    const r = (n >> 16) & 0xff;
    const g = (n >> 8) & 0xff;
    const b = n & 0xff;
    return { r, g, b };
}
function normalizeHex6(hex) {
    const rgb = hexToRgb(hex);
    if (!rgb)
        return null;
    const r = rgb.r.toString(16).padStart(2, "0").toUpperCase();
    const g = rgb.g.toString(16).padStart(2, "0").toUpperCase();
    const b = rgb.b.toString(16).padStart(2, "0").toUpperCase();
    return `#${r}${g}${b}`;
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
function mapHexToGroupColor(hex) {
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
// ---------- promise helpers ----------
function toTabTuple(tabIds) {
    if (!tabIds.length)
        return null;
    return tabIds;
}
function queryTabGroups(query) {
    return new Promise((resolve) => {
        chrome.tabGroups.query(query, (groups) => resolve(groups ?? []));
    });
}
function updateTabGroup(groupId, updateProps) {
    return new Promise((resolve) => {
        chrome.tabGroups.update(groupId, updateProps, (group) => {
            if (chrome.runtime.lastError) {
                resolve(null);
            }
            else {
                resolve(group ?? null);
            }
        });
    });
}
function groupTabs(opts) {
    return new Promise((resolve) => {
        chrome.tabs.group(opts, (groupId) => {
            if (chrome.runtime.lastError) {
                resolve(null);
            }
            else {
                resolve(groupId);
            }
        });
    });
}
function queryTabs(query) {
    return new Promise((resolve) => {
        chrome.tabs.query(query, (tabs) => resolve(tabs ?? []));
    });
}
function getCurrentWindow() {
    return new Promise((resolve) => {
        chrome.windows.getCurrent((window) => {
            if (chrome.runtime.lastError) {
                resolve(null);
            }
            else {
                resolve(window ?? null);
            }
        });
    });
}
function getAllNormalWindows() {
    return new Promise((resolve) => {
        chrome.windows.getAll({
            populate: true,
            windowTypes: ["normal"]
        }, (windows) => {
            if (chrome.runtime.lastError) {
                resolve([]);
            }
            else {
                resolve((windows ?? []).filter((win) => win.type === "normal"));
            }
        });
    });
}
function createWindow(createData) {
    return new Promise((resolve) => {
        chrome.windows.create(createData, (window) => {
            if (chrome.runtime.lastError) {
                resolve(null);
            }
            else {
                resolve(window ?? null);
            }
        });
    });
}
function removeWindow(windowId) {
    return new Promise((resolve) => {
        chrome.windows.remove(windowId, () => resolve());
    });
}
function updateWindow(windowId, updateInfo) {
    return new Promise((resolve) => {
        chrome.windows.update(windowId, updateInfo, (window) => {
            if (chrome.runtime.lastError) {
                resolve(null);
            }
            else {
                resolve(window ?? null);
            }
        });
    });
}
function getTab(tabId) {
    return new Promise((resolve) => {
        chrome.tabs.get(tabId, (tab) => {
            if (chrome.runtime.lastError) {
                resolve(null);
            }
            else {
                resolve(tab ?? null);
            }
        });
    });
}
function getTabGroup(groupId) {
    return new Promise((resolve) => {
        chrome.tabGroups.get(groupId, (group) => {
            if (chrome.runtime.lastError) {
                resolve(null);
            }
            else {
                resolve(group ?? null);
            }
        });
    });
}
function createTab(createProps) {
    return new Promise((resolve) => {
        chrome.tabs.create(createProps, (tab) => {
            if (chrome.runtime.lastError) {
                resolve(null);
            }
            else {
                resolve(tab ?? null);
            }
        });
    });
}
function updateTab(tabId, updateProps) {
    return new Promise((resolve) => {
        chrome.tabs.update(tabId, updateProps, (tab) => {
            if (chrome.runtime.lastError) {
                resolve(null);
            }
            else {
                resolve(tab ?? null);
            }
        });
    });
}
function removeTabs(tabIds) {
    return new Promise((resolve) => {
        if (Array.isArray(tabIds)) {
            const tuple = toTabTuple(tabIds);
            if (!tuple) {
                resolve();
                return;
            }
            chrome.tabs.remove(tuple, () => resolve());
            return;
        }
        chrome.tabs.remove(tabIds, () => resolve());
    });
}
function ungroupTabs(tabIds) {
    return new Promise((resolve) => {
        if (Array.isArray(tabIds)) {
            const tuple = toTabTuple(tabIds);
            if (!tuple) {
                resolve();
                return;
            }
            chrome.tabs.ungroup(tuple, () => resolve());
            return;
        }
        chrome.tabs.ungroup(tabIds, () => resolve());
    });
}
function getLocalStorageValue(key) {
    return new Promise((resolve) => {
        chrome.storage.local.get([key], (data) => {
            resolve(data[key]);
        });
    });
}
function setLocalStorageValue(key, value) {
    return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, () => resolve());
    });
}
// ---------- state helpers ----------
async function getWorkspaceById(id) {
    const state = await getState();
    return state.workspaces.find((workspace) => workspace.id === id) ?? null;
}
async function getActiveWorkspace() {
    const state = await getState();
    if (!state.activeWorkspaceId)
        return null;
    return state.workspaces.find((workspace) => workspace.id === state.activeWorkspaceId) ?? null;
}
function getWorkspaceGroupTitle(workspace) {
    return workspace.icon ? `${workspace.icon} ${workspace.name}` : workspace.name;
}
function getWorkspaceByGroupTitle(workspaces, groupTitle) {
    if (!groupTitle)
        return null;
    return (workspaces.find((workspace) => getWorkspaceGroupTitle(workspace) === groupTitle) ?? null);
}
function isInternalBrowserUrl(url) {
    return (url.startsWith("chrome://") ||
        url.startsWith("brave://") ||
        url.startsWith("devtools://") ||
        url.startsWith("chrome-extension://"));
}
function getRestorableUrl(tab) {
    const url = tab.pendingUrl ?? tab.url;
    if (!url)
        return null;
    return isInternalBrowserUrl(url) ? null : url;
}
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}
function normalizeWindowState(state) {
    if (state === "maximized" ||
        state === "fullscreen" ||
        state === "normal" ||
        state === "minimized") {
        return state;
    }
    return "normal";
}
function toChromeWindowState(state) {
    switch (state) {
        case "maximized":
            return chrome.windows.WindowState.MAXIMIZED;
        case "fullscreen":
            return chrome.windows.WindowState.FULLSCREEN;
        case "minimized":
            return chrome.windows.WindowState.MINIMIZED;
        default:
            return chrome.windows.WindowState.NORMAL;
    }
}
// ---------- snapshot parsing ----------
function normalizeSnapshotV1(value) {
    if (!value || typeof value !== "object")
        return null;
    const snapshot = value;
    if (snapshot.version !== 1)
        return null;
    if (!Array.isArray(snapshot.workspaces))
        return null;
    const workspaces = snapshot.workspaces
        .filter((workspace) => !!workspace &&
        typeof workspace === "object" &&
        typeof workspace.workspaceId === "string" &&
        Array.isArray(workspace.tabUrls))
        .map((workspace) => {
        const tabUrls = workspace.tabUrls.filter((url) => typeof url === "string");
        const activeTabIndex = typeof workspace.activeTabIndex === "number" && workspace.activeTabIndex >= 0
            ? workspace.activeTabIndex
            : null;
        return {
            workspaceId: workspace.workspaceId,
            tabUrls,
            activeTabIndex
        };
    });
    return {
        version: 1,
        savedAt: typeof snapshot.savedAt === "number" ? snapshot.savedAt : Date.now(),
        activeWorkspaceId: typeof snapshot.activeWorkspaceId === "string" ? snapshot.activeWorkspaceId : null,
        workspaces
    };
}
function normalizeSnapshotV2(value) {
    if (!value || typeof value !== "object")
        return null;
    const snapshot = value;
    if (snapshot.version !== SESSION_SNAPSHOT_VERSION_V2)
        return null;
    if (!Array.isArray(snapshot.windows))
        return null;
    const windows = snapshot.windows
        .filter((window) => !!window && typeof window === "object")
        .map((window) => {
        const tabs = Array.isArray(window.tabs)
            ? window.tabs
                .filter((tab) => !!tab &&
                typeof tab === "object" &&
                typeof tab.url === "string" &&
                typeof tab.pinned === "boolean")
                .map((tab) => ({
                url: tab.url,
                pinned: !!tab.pinned,
                workspaceId: typeof tab.workspaceId === "string" ? tab.workspaceId : null,
                active: !!tab.active
            }))
            : [];
        if (tabs.length > 0 && !tabs.some((tab) => tab.active)) {
            tabs[0].active = true;
        }
        const state = normalizeWindowState(window.state);
        return {
            tabs,
            focused: !!window.focused,
            state,
            left: typeof window.left === "number" ? window.left : undefined,
            top: typeof window.top === "number" ? window.top : undefined,
            width: typeof window.width === "number" ? window.width : undefined,
            height: typeof window.height === "number" ? window.height : undefined
        };
    });
    return {
        version: SESSION_SNAPSHOT_VERSION_V2,
        savedAt: typeof snapshot.savedAt === "number" ? snapshot.savedAt : Date.now(),
        activeWorkspaceId: typeof snapshot.activeWorkspaceId === "string" ? snapshot.activeWorkspaceId : null,
        windows
    };
}
function convertSnapshotV1ToV2(v1) {
    const tabs = [];
    for (const workspace of v1.workspaces) {
        workspace.tabUrls.forEach((url, index) => {
            if (isInternalBrowserUrl(url))
                return;
            tabs.push({
                url,
                pinned: false,
                workspaceId: workspace.workspaceId,
                active: false
            });
            if (v1.activeWorkspaceId === workspace.workspaceId && workspace.activeTabIndex === index) {
                tabs[tabs.length - 1].active = true;
            }
        });
    }
    if (tabs.length > 0 && !tabs.some((tab) => tab.active)) {
        tabs[0].active = true;
    }
    return {
        version: SESSION_SNAPSHOT_VERSION_V2,
        savedAt: v1.savedAt,
        activeWorkspaceId: v1.activeWorkspaceId,
        windows: [
            {
                tabs,
                focused: true,
                state: "normal"
            }
        ]
    };
}
async function readWorkspaceSessionSnapshot() {
    const raw = await getLocalStorageValue(SESSION_SNAPSHOT_KEY);
    const v2 = normalizeSnapshotV2(raw);
    if (v2)
        return v2;
    const v1 = normalizeSnapshotV1(raw);
    if (v1)
        return convertSnapshotV1ToV2(v1);
    return null;
}
// ---------- snapshot capture / scheduling ----------
let isRestoringWorkspaceSession = false;
let saveSessionTimer = null;
let snapshotSavePausedUntil = 0;
let autoAssignPausedUntil = 0;
function pauseAutoAssignFor(ms) {
    autoAssignPausedUntil = Math.max(autoAssignPausedUntil, Date.now() + ms);
}
function isAutoAssignPaused() {
    return Date.now() < autoAssignPausedUntil;
}
function pauseWorkspaceSessionSnapshotSave(ms) {
    snapshotSavePausedUntil = Math.max(snapshotSavePausedUntil, Date.now() + ms);
}
async function persistWorkspaceSessionSnapshot() {
    if (isRestoringWorkspaceSession)
        return;
    const state = await getState();
    const windows = await getAllNormalWindows();
    if (!windows.length)
        return;
    const windowSnapshots = [];
    for (const window of windows) {
        const windowId = window.id;
        if (windowId == null)
            continue;
        const groups = await queryTabGroups({ windowId });
        const groupIdToWorkspaceId = new Map();
        for (const group of groups) {
            const workspace = getWorkspaceByGroupTitle(state.workspaces, group.title);
            if (workspace) {
                groupIdToWorkspaceId.set(group.id, workspace.id);
            }
        }
        const tabsInWindow = (window.tabs ?? [])
            .filter((tab) => !!tab)
            .slice()
            .sort((a, b) => a.index - b.index);
        const tabSnapshots = [];
        for (const tab of tabsInWindow) {
            const url = getRestorableUrl(tab);
            if (!url)
                continue;
            const workspaceId = tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
                ? null
                : groupIdToWorkspaceId.get(tab.groupId) ?? null;
            tabSnapshots.push({
                url,
                pinned: !!tab.pinned,
                workspaceId,
                active: !!tab.active
            });
        }
        if (tabSnapshots.length > 0 && !tabSnapshots.some((tab) => tab.active)) {
            tabSnapshots[0].active = true;
        }
        windowSnapshots.push({
            tabs: tabSnapshots,
            focused: !!window.focused,
            state: normalizeWindowState(window.state),
            left: typeof window.left === "number" ? window.left : undefined,
            top: typeof window.top === "number" ? window.top : undefined,
            width: typeof window.width === "number" ? window.width : undefined,
            height: typeof window.height === "number" ? window.height : undefined
        });
    }
    if (!windowSnapshots.length)
        return;
    const snapshot = {
        version: SESSION_SNAPSHOT_VERSION_V2,
        savedAt: Date.now(),
        activeWorkspaceId: state.activeWorkspaceId,
        windows: windowSnapshots
    };
    await setLocalStorageValue(SESSION_SNAPSHOT_KEY, snapshot);
}
function scheduleWorkspaceSessionSnapshotSave() {
    if (isRestoringWorkspaceSession)
        return;
    if (Date.now() < snapshotSavePausedUntil)
        return;
    if (saveSessionTimer != null) {
        clearTimeout(saveSessionTimer);
    }
    saveSessionTimer = setTimeout(() => {
        saveSessionTimer = null;
        void persistWorkspaceSessionSnapshot();
    }, SESSION_SAVE_DEBOUNCE_MS);
}
// ---------- tab-group helpers ----------
async function getWorkspaceGroup(workspace, windowId) {
    const groups = await queryTabGroups({ windowId });
    const title = getWorkspaceGroupTitle(workspace);
    return groups.find((group) => group.title === title) ?? null;
}
async function collapseOtherGroups(windowId, activeGroupId) {
    const groups = await queryTabGroups({ windowId });
    await Promise.all(groups.map((group) => new Promise((resolve) => {
        chrome.tabGroups.update(group.id, { collapsed: group.id !== activeGroupId }, () => resolve());
    })));
}
async function addTabToWorkspace(tabId, windowId, workspace) {
    const title = getWorkspaceGroupTitle(workspace);
    const color = mapHexToGroupColor(workspace.color);
    const existing = await getWorkspaceGroup(workspace, windowId);
    if (existing) {
        const updated = await updateTabGroup(existing.id, { title, color });
        const groupId = updated?.id ?? existing.id;
        await groupTabs({ groupId, tabIds: [tabId] });
        await collapseOtherGroups(windowId, groupId);
        return;
    }
    const newGroupId = await groupTabs({
        tabIds: [tabId],
        createProperties: { windowId }
    });
    if (newGroupId == null)
        return;
    await updateTabGroup(newGroupId, {
        title,
        color,
        collapsed: false
    });
    await collapseOtherGroups(windowId, newGroupId);
}
// ---------- restore helpers ----------
function buildWindowCreateData(snapshotWindow) {
    const createData = {
        focused: false,
        url: "about:blank",
        type: "normal"
    };
    if (snapshotWindow.state === "maximized" || snapshotWindow.state === "fullscreen") {
        createData.state = toChromeWindowState(snapshotWindow.state);
        return createData;
    }
    createData.state = chrome.windows.WindowState.NORMAL;
    if (typeof snapshotWindow.left === "number")
        createData.left = snapshotWindow.left;
    if (typeof snapshotWindow.top === "number")
        createData.top = snapshotWindow.top;
    if (typeof snapshotWindow.width === "number")
        createData.width = snapshotWindow.width;
    if (typeof snapshotWindow.height === "number")
        createData.height = snapshotWindow.height;
    return createData;
}
async function applyWindowLayout(windowId, snapshotWindow) {
    if (snapshotWindow.state === "maximized" || snapshotWindow.state === "fullscreen") {
        await updateWindow(windowId, { state: toChromeWindowState(snapshotWindow.state) });
        return;
    }
    const updateInfo = { state: chrome.windows.WindowState.NORMAL };
    if (typeof snapshotWindow.left === "number")
        updateInfo.left = snapshotWindow.left;
    if (typeof snapshotWindow.top === "number")
        updateInfo.top = snapshotWindow.top;
    if (typeof snapshotWindow.width === "number")
        updateInfo.width = snapshotWindow.width;
    if (typeof snapshotWindow.height === "number")
        updateInfo.height = snapshotWindow.height;
    await updateWindow(windowId, updateInfo);
}
async function reconcileWindowsForRestore(snapshotWindows) {
    const existing = await getAllNormalWindows();
    const target = existing.slice(0, snapshotWindows.length);
    while (target.length < snapshotWindows.length) {
        const createData = buildWindowCreateData(snapshotWindows[target.length]);
        const created = await createWindow(createData);
        if (!created)
            break;
        target.push(created);
    }
    const extras = existing
        .slice(snapshotWindows.length)
        .map((window) => window.id)
        .filter((id) => id != null);
    for (const windowId of extras) {
        await removeWindow(windowId);
    }
    return target;
}
async function restoreWindowTabs(windowId, snapshotWindow, workspaceById) {
    const existingTabs = await queryTabs({ windowId });
    const existingTabIds = existingTabs
        .map((tab) => tab.id)
        .filter((id) => id != null);
    const anchorTab = await createTab({
        windowId,
        url: "about:blank",
        active: false
    });
    const anchorTabId = anchorTab?.id ?? null;
    if (existingTabIds.length) {
        await removeTabs(existingTabIds);
    }
    const filteredSnapshotTabs = snapshotWindow.tabs.filter((tab) => !isInternalBrowserUrl(tab.url));
    const desiredTabs = filteredSnapshotTabs.length > 0
        ? filteredSnapshotTabs
        : [
            {
                url: "about:blank",
                pinned: false,
                workspaceId: null,
                active: true
            }
        ];
    const createdTabs = [];
    for (let index = 0; index < desiredTabs.length; index += 1) {
        const snapshotTab = desiredTabs[index];
        const created = await createTab({
            windowId,
            url: snapshotTab.url,
            index,
            active: false,
            pinned: snapshotTab.pinned
        });
        if (!created?.id)
            continue;
        createdTabs.push({
            tabId: created.id,
            workspaceId: snapshotTab.workspaceId,
            active: snapshotTab.active
        });
    }
    let anchorConsumedAsFallback = false;
    if (!createdTabs.length && anchorTabId != null) {
        anchorConsumedAsFallback = true;
        await updateTab(anchorTabId, { url: "about:blank", active: false, pinned: false });
        createdTabs.push({
            tabId: anchorTabId,
            workspaceId: null,
            active: true
        });
    }
    if (anchorTabId != null && !anchorConsumedAsFallback) {
        await removeTabs(anchorTabId);
    }
    const workspaceTabIds = new Map();
    for (const tab of createdTabs) {
        if (!tab.workspaceId)
            continue;
        if (!workspaceById.has(tab.workspaceId))
            continue;
        const ids = workspaceTabIds.get(tab.workspaceId) ?? [];
        ids.push(tab.tabId);
        workspaceTabIds.set(tab.workspaceId, ids);
    }
    for (const [workspaceId, tabIds] of workspaceTabIds) {
        const tuple = toTabTuple(tabIds);
        const workspace = workspaceById.get(workspaceId);
        if (!tuple || !workspace)
            continue;
        const groupId = await groupTabs({
            tabIds: tuple,
            createProperties: { windowId }
        });
        if (groupId == null)
            continue;
        await updateTabGroup(groupId, {
            title: getWorkspaceGroupTitle(workspace),
            color: mapHexToGroupColor(workspace.color),
            collapsed: false
        });
    }
    const activeCandidate = createdTabs.find((tab) => tab.active) ?? createdTabs[0];
    if (activeCandidate) {
        await updateTab(activeCandidate.tabId, { active: true });
    }
    if (activeCandidate?.workspaceId && workspaceById.has(activeCandidate.workspaceId)) {
        return activeCandidate.workspaceId;
    }
    return null;
}
async function restoreWorkspaceSessionFromSnapshot() {
    await sleep(STARTUP_RESTORE_DELAY_MS);
    const snapshot = await readWorkspaceSessionSnapshot();
    if (!snapshot)
        return;
    if (!snapshot.windows.length)
        return;
    const state = await getState();
    const workspaceById = new Map(state.workspaces.map((workspace) => [workspace.id, workspace]));
    isRestoringWorkspaceSession = true;
    pauseAutoAssignFor(STARTUP_AUTO_ASSIGN_PAUSE_MS);
    pauseWorkspaceSessionSnapshotSave(STARTUP_AUTO_ASSIGN_PAUSE_MS);
    try {
        const targetWindows = await reconcileWindowsForRestore(snapshot.windows);
        if (!targetWindows.length)
            return;
        let derivedActiveWorkspaceId = null;
        let focusedWindowId = null;
        for (let index = 0; index < snapshot.windows.length; index += 1) {
            const targetWindow = targetWindows[index];
            const snapshotWindow = snapshot.windows[index];
            if (!targetWindow?.id)
                continue;
            const activeWorkspaceFromWindow = await restoreWindowTabs(targetWindow.id, snapshotWindow, workspaceById);
            await applyWindowLayout(targetWindow.id, snapshotWindow);
            if (!derivedActiveWorkspaceId && activeWorkspaceFromWindow) {
                derivedActiveWorkspaceId = activeWorkspaceFromWindow;
            }
            if (snapshotWindow.focused) {
                focusedWindowId = targetWindow.id;
            }
        }
        if (focusedWindowId == null) {
            focusedWindowId = targetWindows[0]?.id ?? null;
        }
        if (focusedWindowId != null) {
            await updateWindow(focusedWindowId, { focused: true });
        }
        const activeWorkspaceId = snapshot.activeWorkspaceId && workspaceById.has(snapshot.activeWorkspaceId)
            ? snapshot.activeWorkspaceId
            : derivedActiveWorkspaceId;
        await setState({ activeWorkspaceId: activeWorkspaceId ?? null });
    }
    catch (err) {
        console.error("restoreWorkspaceSessionFromSnapshot error", err);
    }
    finally {
        isRestoringWorkspaceSession = false;
        snapshotSavePausedUntil = Date.now();
    }
    await persistWorkspaceSessionSnapshot();
}
// ---------- activation / messages ----------
async function handleActivateWorkspace(workspaceId, moveCurrentTab = true) {
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace)
        return;
    const win = await getCurrentWindow();
    const windowId = win?.id;
    if (windowId == null)
        return;
    if (moveCurrentTab) {
        const tabs = await queryTabs({ active: true, windowId });
        const activeTab = tabs[0];
        if (activeTab?.id != null) {
            await addTabToWorkspace(activeTab.id, windowId, workspace);
        }
    }
    else {
        const group = await getWorkspaceGroup(workspace, windowId);
        if (group) {
            const tabs = await queryTabs({ windowId, groupId: group.id });
            const targetTab = tabs.find((tab) => tab.active) ?? tabs[0];
            if (targetTab?.id != null) {
                await updateTab(targetTab.id, { active: true });
            }
            await collapseOtherGroups(windowId, group.id);
        }
    }
    await setState({ activeWorkspaceId: workspaceId });
    scheduleWorkspaceSessionSnapshotSave();
}
async function initWorkspaceGroup(workspaceId) {
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace)
        return;
    const title = getWorkspaceGroupTitle(workspace);
    const color = mapHexToGroupColor(workspace.color);
    const groups = await queryTabGroups({});
    for (const group of groups) {
        if (group.title !== title)
            continue;
        await updateTabGroup(group.id, { title, color });
    }
    scheduleWorkspaceSessionSnapshotSave();
}
async function ungroupWorkspaceTabs(workspaceId) {
    const workspace = await getWorkspaceById(workspaceId);
    if (!workspace)
        return;
    const title = getWorkspaceGroupTitle(workspace);
    const groups = await queryTabGroups({});
    const targetGroups = groups.filter((group) => group.title === title);
    for (const group of targetGroups) {
        const tabs = await queryTabs({ groupId: group.id });
        const ids = tabs
            .map((tab) => tab.id)
            .filter((id) => id != null);
        if (ids.length) {
            await ungroupTabs(ids);
        }
    }
    scheduleWorkspaceSessionSnapshotSave();
}
// ---------- keep active workspace in sync ----------
async function syncActiveWorkspaceFromTab(activeInfo) {
    const tab = await getTab(activeInfo.tabId);
    if (!tab)
        return;
    if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE)
        return;
    const group = await getTabGroup(tab.groupId);
    if (!group)
        return;
    const state = await getState();
    const workspace = getWorkspaceByGroupTitle(state.workspaces, group.title);
    if (!workspace)
        return;
    if (state.activeWorkspaceId !== workspace.id) {
        await setState({ activeWorkspaceId: workspace.id });
        scheduleWorkspaceSessionSnapshotSave();
    }
}
chrome.tabs.onActivated.addListener((activeInfo) => {
    void syncActiveWorkspaceFromTab(activeInfo);
    scheduleWorkspaceSessionSnapshotSave();
});
// ---------- auto-assign new tabs ----------
async function getWorkspaceFromTab(tab) {
    if (tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE)
        return null;
    const group = await getTabGroup(tab.groupId);
    if (!group)
        return null;
    const state = await getState();
    return getWorkspaceByGroupTitle(state.workspaces, group.title);
}
async function resolveWorkspaceForNewTab(tab) {
    if (tab.openerTabId != null) {
        const openerTab = await getTab(tab.openerTabId);
        if (openerTab) {
            const openerWorkspace = await getWorkspaceFromTab(openerTab);
            if (openerWorkspace) {
                return openerWorkspace;
            }
        }
    }
    return getActiveWorkspace();
}
async function autoAssignTabToWorkspace(tab) {
    if (isRestoringWorkspaceSession)
        return;
    if (isAutoAssignPaused())
        return;
    if (tab.id == null || tab.windowId == null)
        return;
    if (tab.pinned)
        return;
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE)
        return;
    const url = tab.pendingUrl ?? tab.url;
    if (url && isInternalBrowserUrl(url))
        return;
    const workspace = await resolveWorkspaceForNewTab(tab);
    if (!workspace)
        return;
    await addTabToWorkspace(tab.id, tab.windowId, workspace);
    scheduleWorkspaceSessionSnapshotSave();
}
// ---------- startup / lifecycle ----------
chrome.runtime.onStartup.addListener(() => {
    pauseAutoAssignFor(STARTUP_AUTO_ASSIGN_PAUSE_MS);
    pauseWorkspaceSessionSnapshotSave(STARTUP_AUTO_ASSIGN_PAUSE_MS);
    void restoreWorkspaceSessionFromSnapshot();
    setTimeout(() => {
        void persistWorkspaceSessionSnapshot();
    }, STARTUP_FINAL_SAVE_DELAY_MS);
});
chrome.tabs.onCreated.addListener((tab) => {
    void autoAssignTabToWorkspace(tab);
    scheduleWorkspaceSessionSnapshotSave();
});
chrome.tabs.onRemoved.addListener(() => {
    scheduleWorkspaceSessionSnapshotSave();
});
chrome.tabs.onMoved.addListener(() => {
    scheduleWorkspaceSessionSnapshotSave();
});
chrome.tabs.onAttached.addListener(() => {
    scheduleWorkspaceSessionSnapshotSave();
});
chrome.tabs.onDetached.addListener(() => {
    scheduleWorkspaceSessionSnapshotSave();
});
chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
    if (changeInfo.url || changeInfo.status === "complete") {
        scheduleWorkspaceSessionSnapshotSave();
    }
});
chrome.tabGroups.onCreated.addListener(() => {
    scheduleWorkspaceSessionSnapshotSave();
});
chrome.tabGroups.onUpdated.addListener(() => {
    scheduleWorkspaceSessionSnapshotSave();
});
chrome.tabGroups.onRemoved.addListener(() => {
    scheduleWorkspaceSessionSnapshotSave();
});
setInterval(() => {
    void persistWorkspaceSessionSnapshot();
}, SESSION_HEARTBEAT_SAVE_MS);
chrome.runtime.onSuspend.addListener(() => {
    if (saveSessionTimer != null) {
        clearTimeout(saveSessionTimer);
        saveSessionTimer = null;
    }
    void persistWorkspaceSessionSnapshot();
});
// ---------- message bridge ----------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const msg = message;
    if (msg.type === "ACTIVATE_WORKSPACE") {
        void handleActivateWorkspace(msg.workspaceId, msg.moveCurrentTab ?? true)
            .then(() => sendResponse({ ok: true }))
            .catch((err) => {
            console.error("ACTIVATE_WORKSPACE error", err);
            sendResponse({ ok: false, error: String(err) });
        });
        return true;
    }
    if (msg.type === "UNGROUP_WORKSPACE_TABS") {
        void ungroupWorkspaceTabs(msg.workspaceId)
            .then(() => sendResponse({ ok: true }))
            .catch((err) => {
            console.error("UNGROUP_WORKSPACE_TABS error", err);
            sendResponse({ ok: false, error: String(err) });
        });
        return true;
    }
    if (msg.type === "INIT_WORKSPACE_GROUP") {
        void initWorkspaceGroup(msg.workspaceId)
            .then(() => sendResponse({ ok: true }))
            .catch((err) => {
            console.error("INIT_WORKSPACE_GROUP error", err);
            sendResponse({ ok: false, error: String(err) });
        });
        return true;
    }
    return false;
});
