# Brave Workspaces v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the extension's core around stable tab-group IDs, add delayed memory suspension for inactive workspaces, replace destructive auto-restore with a manual backup, and add keyboard shortcuts, context menu, tab search, and a memory indicator — all behind settings toggles.

**Architecture:** Workspace = tab group in the main (last-focused normal) window. Runtime mapping `workspaceId → groupId` lives in `chrome.storage.session`; title matching is used only once at startup to re-link groups restored by Brave. The background service worker is a thin event router over focused modules; the popup talks to it via typed messages.

**Tech Stack:** TypeScript compiled with plain `tsc` (config emits `.js` next to `.ts` in repo root, both committed). Manifest V3, `chrome.alarms` for all timers. No bundler, no test framework.

**Verification policy:** This is a browser extension with no unit-test harness; per the approved spec, the gate for every task is `npx tsc` passing (exit 0, `noEmitOnError` is on), plus the manual test checklist in the final task. Do not introduce a test framework.

**Spec:** `docs/superpowers/specs/2026-06-11-brave-workspaces-v2-design.md`

---

## File map

| File | Action | Responsibility |
|---|---|---|
| `types.ts` | Rewrite | All shared interfaces, defaults, message types |
| `storage.ts` | Rewrite | Typed local + session storage access (migration code deleted) |
| `chrome-api.ts` | Create | Promisified-with-logging Chrome API helpers |
| `workspaces.ts` | Create | Group mapping, switch/assign/move/ungroup, startup re-link, stats |
| `suspend.ts` | Create | Suspend alarms + discard logic |
| `snapshot.ts` | Create | Snapshot capture (debounce + heartbeat) and manual restore |
| `features.ts` | Create | Context menu + keyboard command handling |
| `background.ts` | Rewrite | Thin entry: listeners + message router (all old logic deleted) |
| `manifest.json` | Modify | Permissions (`alarms`, `contextMenus`), `commands`, drop `host_permissions`/`windows` |
| `popup.html` | Rewrite | Adds search, settings panel, restore hint |
| `popup.css` | Modify | Styles for the new sections |
| `popup.ts` | Rewrite | Existing CRUD + search, settings, stats, restore |
| `README.MD` | Rewrite | Build, install, features, shortcuts |

Note on imports: always import relative modules **with the `.js` extension** (e.g. `from "./types.js"`). The emitted JS is loaded directly as browser ES modules; extensionless imports break at runtime. (`storage.ts` currently has an extensionless import — fix it during the rewrite.)

---

### Task 1: Types and storage rewrite

**Files:**
- Rewrite: `types.ts`
- Rewrite: `storage.ts`

- [ ] **Step 1: Replace the entire contents of `types.ts` with:**

```ts
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
```

- [ ] **Step 2: Replace the entire contents of `storage.ts` with** (this deletes the obsolete sync→local migration):

```ts
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
```

- [ ] **Step 3: Compile**

Run: `npx tsc`
Expected: exit 0, no output. (The old `background.ts`/`popup.ts` still compile — they only use `Workspace`, `getState`, `setState`, which all still exist.)

- [ ] **Step 4: Commit**

```bash
git add types.ts types.js storage.ts storage.js
git commit -m "refactor: settings + session maps in storage, drop sync migration"
```

---

### Task 2: Chrome API helpers

**Files:**
- Create: `chrome-api.ts`

- [ ] **Step 1: Create `chrome-api.ts` with:**

```ts
// Thin promise wrappers around chrome.* calls that may reject (closed tabs,
// stale group IDs, etc.). Failures are logged with context and surfaced as
// null/empty so callers degrade gracefully.

export async function safe<T>(operation: string, promise: Promise<T>): Promise<T | null> {
  try {
    return await promise;
  } catch (err) {
    console.warn(`[workspaces] ${operation} failed:`, err);
    return null;
  }
}

export async function queryTabs(query: chrome.tabs.QueryInfo): Promise<chrome.tabs.Tab[]> {
  return (await safe("tabs.query", chrome.tabs.query(query))) ?? [];
}

export async function queryTabGroups(
  query: chrome.tabGroups.QueryInfo
): Promise<chrome.tabGroups.TabGroup[]> {
  return (await safe("tabGroups.query", chrome.tabGroups.query(query))) ?? [];
}

export function getTab(tabId: number): Promise<chrome.tabs.Tab | null> {
  return safe(`tabs.get(${tabId})`, chrome.tabs.get(tabId));
}

export function getTabGroup(groupId: number): Promise<chrome.tabGroups.TabGroup | null> {
  return safe(`tabGroups.get(${groupId})`, chrome.tabGroups.get(groupId));
}

export function updateTab(
  tabId: number,
  props: chrome.tabs.UpdateProperties
): Promise<chrome.tabs.Tab | null> {
  return safe(`tabs.update(${tabId})`, chrome.tabs.update(tabId, props));
}

export function updateTabGroup(
  groupId: number,
  props: chrome.tabGroups.UpdateProperties
): Promise<chrome.tabGroups.TabGroup | null> {
  return safe(`tabGroups.update(${groupId})`, chrome.tabGroups.update(groupId, props));
}

export function groupTabs(options: chrome.tabs.GroupOptions): Promise<number | null> {
  return safe("tabs.group", chrome.tabs.group(options));
}

export async function ungroupTabs(tabIds: number[]): Promise<void> {
  if (!tabIds.length) return;
  await safe("tabs.ungroup", chrome.tabs.ungroup(tabIds as [number, ...number[]]));
}

export function createTab(
  props: chrome.tabs.CreateProperties
): Promise<chrome.tabs.Tab | null> {
  return safe("tabs.create", chrome.tabs.create(props));
}

export async function discardTab(tabId: number): Promise<void> {
  await safe(`tabs.discard(${tabId})`, chrome.tabs.discard(tabId));
}

// Single-window focus: the extension operates in the last-focused normal
// window and ignores all others.
export async function getMainWindow(): Promise<chrome.windows.Window | null> {
  const win = await safe(
    "windows.getLastFocused",
    chrome.windows.getLastFocused({ windowTypes: ["normal"] })
  );
  return win && win.type === "normal" ? win : null;
}

export function isInternalUrl(url: string): boolean {
  return (
    url.startsWith("chrome://") ||
    url.startsWith("brave://") ||
    url.startsWith("devtools://") ||
    url.startsWith("chrome-extension://")
  );
}
```

- [ ] **Step 2: Compile**

Run: `npx tsc`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add chrome-api.ts chrome-api.js
git commit -m "feat: promisified chrome API helpers with error logging"
```

---

### Task 3: Workspace core (group mapping, switching, assignment)

**Files:**
- Create: `workspaces.ts`

- [ ] **Step 1: Create `workspaces.ts` with:**

```ts
import type { Workspace, WorkspaceStats, WorkspaceSwitch } from "./types.js";
import {
  getState,
  setState,
  getGroupMap,
  setGroupMap,
  getLastActiveTabMap,
  setLastActiveTabMap
} from "./storage.js";
import {
  queryTabs,
  queryTabGroups,
  getTab,
  getTabGroup,
  updateTab,
  updateTabGroup,
  groupTabs,
  ungroupTabs,
  createTab,
  getMainWindow,
  isInternalUrl
} from "./chrome-api.js";

// ---------- color mapping (hex preset -> tab group color) ----------

type TabGroupColor =
  | "grey"
  | "blue"
  | "red"
  | "yellow"
  | "green"
  | "pink"
  | "purple"
  | "cyan";

const PRESET_GROUP_COLOR_MAP: Record<string, TabGroupColor> = {
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

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const trimmed = hex.trim();
  const m =
    /^#?([0-9a-fA-F]{6})$/.exec(trimmed) || /^#?([0-9a-fA-F]{3})$/.exec(trimmed);
  if (!m) return null;

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

function normalizeHex6(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const toHex = (v: number) => v.toString(16).padStart(2, "0").toUpperCase();
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
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

export function mapHexToGroupColor(hex: string): TabGroupColor {
  const key = normalizeHex6(hex);
  if (key && PRESET_GROUP_COLOR_MAP[key]) {
    return PRESET_GROUP_COLOR_MAP[key];
  }

  const rgb = hexToRgb(hex);
  if (!rgb) return "grey";

  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);
  if (s < 0.15) return "grey";
  if (l > 0.8) return "yellow";

  if (h < 15 || h >= 345) return "red";
  if (h < 60) return "yellow";
  if (h < 150) return "green";
  if (h < 200) return "cyan";
  if (h < 255) return "blue";
  if (h < 315) return "purple";
  return "pink";
}

// ---------- group mapping ----------

export function getWorkspaceGroupTitle(workspace: Workspace): string {
  return workspace.icon ? `${workspace.icon} ${workspace.name}` : workspace.name;
}

export async function getGroupIdForWorkspace(workspaceId: string): Promise<number | null> {
  const map = await getGroupMap();
  const groupId = map[workspaceId];
  if (groupId == null) return null;

  const group = await getTabGroup(groupId);
  if (!group) {
    delete map[workspaceId];
    await setGroupMap(map);
    return null;
  }
  return groupId;
}

export async function getWorkspaceIdForGroup(groupId: number): Promise<string | null> {
  const map = await getGroupMap();
  const entry = Object.entries(map).find(([, gid]) => gid === groupId);
  return entry ? entry[0] : null;
}

export async function registerGroup(workspaceId: string, groupId: number): Promise<void> {
  const map = await getGroupMap();
  map[workspaceId] = groupId;
  await setGroupMap(map);
}

export async function unregisterGroup(groupId: number): Promise<void> {
  const map = await getGroupMap();
  const entry = Object.entries(map).find(([, gid]) => gid === groupId);
  if (!entry) return;
  delete map[entry[0]];
  await setGroupMap(map);
}

// One-time re-link after browser startup: Brave's native session restore
// recreates groups (with titles/colors) but assigns new group IDs. Match by
// title once, then track by ID for the rest of the session.
export async function linkGroupsOnStartup(): Promise<void> {
  const win = await getMainWindow();
  if (win?.id == null) return;

  const state = await getState();
  const groups = await queryTabGroups({ windowId: win.id });
  const map: Record<string, number> = {};

  for (const workspace of state.workspaces) {
    const title = getWorkspaceGroupTitle(workspace);
    const group = groups.find((g) => g.title === title);
    if (group) map[workspace.id] = group.id;
  }

  await setGroupMap(map);
}

// ---------- core actions ----------

export async function addTabToWorkspace(
  tabId: number,
  windowId: number,
  workspace: Workspace
): Promise<void> {
  const existingGroupId = await getGroupIdForWorkspace(workspace.id);
  if (existingGroupId != null) {
    await groupTabs({ groupId: existingGroupId, tabIds: [tabId] });
    return;
  }

  const newGroupId = await groupTabs({ tabIds: [tabId], createProperties: { windowId } });
  if (newGroupId == null) return;

  await updateTabGroup(newGroupId, {
    title: getWorkspaceGroupTitle(workspace),
    color: mapHexToGroupColor(workspace.color),
    collapsed: false
  });
  await registerGroup(workspace.id, newGroupId);
}

export async function collapseOtherWorkspaceGroups(activeWorkspaceId: string): Promise<void> {
  const map = await getGroupMap();
  for (const [workspaceId, groupId] of Object.entries(map)) {
    await updateTabGroup(groupId, { collapsed: workspaceId !== activeWorkspaceId });
  }
}

export async function activateWorkspace(workspaceId: string): Promise<void> {
  const state = await getState();
  const workspace = state.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return;

  const win = await getMainWindow();
  if (win?.id == null) return;

  const groupId = await getGroupIdForWorkspace(workspaceId);
  if (groupId == null) {
    // Empty workspace: open a fresh tab and group it.
    const tab = await createTab({ windowId: win.id, active: true });
    if (tab?.id != null) {
      await addTabToWorkspace(tab.id, win.id, workspace);
    }
  } else {
    await updateTabGroup(groupId, { collapsed: false });
    const tabs = await queryTabs({ groupId });
    const lastActiveMap = await getLastActiveTabMap();
    const preferredId = lastActiveMap[workspaceId];
    const target =
      tabs.find((t) => t.id === preferredId) ?? tabs.find((t) => t.active) ?? tabs[0];
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
export async function syncActiveWorkspaceFromTab(tabId: number): Promise<WorkspaceSwitch | null> {
  const tab = await getTab(tabId);
  if (!tab || tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return null;

  const workspaceId = await getWorkspaceIdForGroup(tab.groupId);
  if (!workspaceId) return null;

  const lastActiveMap = await getLastActiveTabMap();
  lastActiveMap[workspaceId] = tabId;
  await setLastActiveTabMap(lastActiveMap);

  const state = await getState();
  if (state.activeWorkspaceId === workspaceId) return null;

  await setState({ activeWorkspaceId: workspaceId });
  await collapseOtherWorkspaceGroups(workspaceId);
  return { previousWorkspaceId: state.activeWorkspaceId, workspaceId };
}

// Called from tabs.onCreated. New tabs join the opener's workspace if the
// opener is grouped, otherwise the active workspace.
export async function autoAssignNewTab(tab: chrome.tabs.Tab): Promise<void> {
  if (tab.id == null || tab.windowId == null) return;
  if (tab.pinned) return;
  if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) return;

  const win = await getMainWindow();
  if (win?.id !== tab.windowId) return; // single-window focus

  const url = tab.pendingUrl ?? tab.url;
  // Fresh new-tab pages are assignable; other internal pages are not.
  if (url && url !== "chrome://newtab/" && isInternalUrl(url)) return;

  const state = await getState();
  let workspace: Workspace | null = null;

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
  if (!workspace) return;

  await addTabToWorkspace(tab.id, tab.windowId, workspace);
}

export async function moveTabToWorkspace(tabId: number, workspaceId: string): Promise<void> {
  const state = await getState();
  const workspace = state.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return;

  const tab = await getTab(tabId);
  if (!tab || tab.id == null || tab.windowId == null) return;

  await addTabToWorkspace(tab.id, tab.windowId, workspace);
}

export async function restyleWorkspaceGroup(workspace: Workspace): Promise<void> {
  const groupId = await getGroupIdForWorkspace(workspace.id);
  if (groupId == null) return;
  await updateTabGroup(groupId, {
    title: getWorkspaceGroupTitle(workspace),
    color: mapHexToGroupColor(workspace.color)
  });
}

export async function ungroupWorkspaceTabs(workspaceId: string): Promise<void> {
  const groupId = await getGroupIdForWorkspace(workspaceId);
  if (groupId == null) return;

  const tabs = await queryTabs({ groupId });
  const ids = tabs.map((t) => t.id).filter((id): id is number => id != null);
  await ungroupTabs(ids);

  const map = await getGroupMap();
  delete map[workspaceId];
  await setGroupMap(map);
}

// Activate a specific tab, switching workspace first if the tab belongs to
// one. Returns the workspace switched to, if any.
export async function focusTab(tabId: number): Promise<string | null> {
  const tab = await getTab(tabId);
  if (!tab || tab.id == null) return null;

  let switchedTo: string | null = null;
  if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
    const workspaceId = await getWorkspaceIdForGroup(tab.groupId);
    if (workspaceId) {
      await updateTabGroup(tab.groupId, { collapsed: false });
      await collapseOtherWorkspaceGroups(workspaceId);
      await setState({ activeWorkspaceId: workspaceId });
      switchedTo = workspaceId;
    }
  }

  await updateTab(tab.id, { active: true });
  return switchedTo;
}

export async function getWorkspaceStats(): Promise<WorkspaceStats[]> {
  const state = await getState();
  const map = await getGroupMap();
  const stats: WorkspaceStats[] = [];

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
```

- [ ] **Step 2: Compile**

Run: `npx tsc`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add workspaces.ts workspaces.js
git commit -m "feat: workspace core with stable group-ID mapping"
```

---

### Task 4: Memory suspension

**Files:**
- Create: `suspend.ts`

- [ ] **Step 1: Create `suspend.ts` with:**

```ts
import { getState, getSettings, getLastActiveTabMap } from "./storage.js";
import { getGroupIdForWorkspace } from "./workspaces.js";
import { queryTabs, discardTab } from "./chrome-api.js";

const SUSPEND_ALARM_PREFIX = "suspend:";

export async function scheduleSuspend(workspaceId: string): Promise<void> {
  const settings = await getSettings();
  if (!settings.suspendEnabled) return;
  await chrome.alarms.create(SUSPEND_ALARM_PREFIX + workspaceId, {
    delayInMinutes: Math.max(1, settings.suspendDelayMinutes)
  });
}

export async function cancelSuspend(workspaceId: string): Promise<void> {
  await chrome.alarms.clear(SUSPEND_ALARM_PREFIX + workspaceId);
}

export function isSuspendAlarm(alarmName: string): boolean {
  return alarmName.startsWith(SUSPEND_ALARM_PREFIX);
}

// Wire this to every workspace switch: the workspace we arrive at must not be
// suspended; the one we left starts its inactivity countdown.
export async function onWorkspaceSwitched(
  previousWorkspaceId: string | null,
  workspaceId: string
): Promise<void> {
  await cancelSuspend(workspaceId);
  if (previousWorkspaceId && previousWorkspaceId !== workspaceId) {
    await scheduleSuspend(previousWorkspaceId);
  }
}

export async function handleSuspendAlarm(alarmName: string): Promise<void> {
  const workspaceId = alarmName.slice(SUSPEND_ALARM_PREFIX.length);

  const settings = await getSettings();
  if (!settings.suspendEnabled) return;

  const state = await getState();
  if (state.activeWorkspaceId === workspaceId) return; // became active again

  const groupId = await getGroupIdForWorkspace(workspaceId);
  if (groupId == null) return;

  const tabs = await queryTabs({ groupId });
  const lastActiveMap = await getLastActiveTabMap();
  const lastActiveTabId = lastActiveMap[workspaceId];

  // Protected: audible (background music/video), pinned, opted-out, already
  // discarded, or currently active tabs.
  const candidates = tabs.filter(
    (t) =>
      t.id != null &&
      !t.active &&
      !t.discarded &&
      !t.audible &&
      !t.pinned &&
      t.autoDiscardable !== false
  );

  // Discard the workspace's last-active tab last.
  const ordered = [
    ...candidates.filter((t) => t.id !== lastActiveTabId),
    ...candidates.filter((t) => t.id === lastActiveTabId)
  ];

  for (const tab of ordered) {
    if (tab.id != null) {
      await discardTab(tab.id);
    }
  }
}
```

- [ ] **Step 2: Compile**

Run: `npx tsc`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add suspend.ts suspend.js
git commit -m "feat: delayed tab discard for inactive workspaces"
```

---

### Task 5: Snapshot (capture + manual restore)

**Files:**
- Create: `snapshot.ts`

- [ ] **Step 1: Create `snapshot.ts` with:**

```ts
import type { SessionSnapshot, SnapshotInfo, SnapshotTab } from "./types.js";
import { getState, getGroupMap } from "./storage.js";
import {
  getMainWindow,
  queryTabs,
  createTab,
  groupTabs,
  updateTabGroup,
  isInternalUrl
} from "./chrome-api.js";
import {
  getWorkspaceGroupTitle,
  mapHexToGroupColor,
  getGroupIdForWorkspace,
  registerGroup
} from "./workspaces.js";

const SNAPSHOT_KEY = "sessionSnapshotV2";
const HEARTBEAT_ALARM = "snapshot-heartbeat";
const DEBOUNCE_MS = 1000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let restoring = false;

// Guards autoAssignNewTab against grabbing tabs the restore is creating.
export function isRestoring(): boolean {
  return restoring;
}

export async function ensureHeartbeat(): Promise<void> {
  await chrome.alarms.create(HEARTBEAT_ALARM, { periodInMinutes: 5 });
}

export function isHeartbeatAlarm(alarmName: string): boolean {
  return alarmName === HEARTBEAT_ALARM;
}

// Short debounce only; the 5-minute alarm is the durable fallback if the
// service worker dies before the timer fires.
export function scheduleSnapshotSave(): void {
  if (restoring) return;
  if (debounceTimer != null) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void saveSnapshot();
  }, DEBOUNCE_MS);
}

export async function saveSnapshot(): Promise<void> {
  if (restoring) return;

  const win = await getMainWindow();
  if (win?.id == null) return;

  const tabs = await queryTabs({ windowId: win.id });
  const map = await getGroupMap();
  const groupToWorkspace = new Map(
    Object.entries(map).map(([workspaceId, groupId]) => [groupId, workspaceId])
  );
  const state = await getState();

  const snapshotTabs: SnapshotTab[] = [];
  for (const tab of [...tabs].sort((a, b) => a.index - b.index)) {
    const url = tab.pendingUrl ?? tab.url;
    if (!url || isInternalUrl(url)) continue;

    snapshotTabs.push({
      url,
      pinned: !!tab.pinned,
      workspaceId:
        tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE
          ? null
          : groupToWorkspace.get(tab.groupId) ?? null,
      active: !!tab.active
    });
  }

  if (!snapshotTabs.length) return;

  const snapshot: SessionSnapshot = {
    version: 2,
    savedAt: Date.now(),
    activeWorkspaceId: state.activeWorkspaceId,
    tabs: snapshotTabs
  };

  await chrome.storage.local.set({ [SNAPSHOT_KEY]: snapshot });
}

async function readSnapshot(): Promise<SessionSnapshot | null> {
  const data = await chrome.storage.local.get([SNAPSHOT_KEY]);
  const snapshot = data[SNAPSHOT_KEY] as SessionSnapshot | undefined;
  if (!snapshot || snapshot.version !== 2 || !Array.isArray(snapshot.tabs)) return null;
  return snapshot;
}

export async function getSnapshotInfo(): Promise<SnapshotInfo | null> {
  const snapshot = await readSnapshot();
  if (!snapshot) return null;
  return { savedAt: snapshot.savedAt, tabCount: snapshot.tabs.length };
}

// Manual restore only — never runs automatically. Appends tabs to the current
// window; never deletes anything.
export async function restoreFromBackup(): Promise<void> {
  const snapshot = await readSnapshot();
  if (!snapshot || !snapshot.tabs.length) return;

  const win = await getMainWindow();
  if (win?.id == null) return;
  const windowId = win.id;

  restoring = true;
  try {
    const state = await getState();
    const tabIdsByWorkspace = new Map<string | null, number[]>();

    for (const snapshotTab of snapshot.tabs) {
      const created = await createTab({
        windowId,
        url: snapshotTab.url,
        active: false,
        pinned: snapshotTab.pinned
      });
      if (created?.id == null) continue;

      const ids = tabIdsByWorkspace.get(snapshotTab.workspaceId) ?? [];
      ids.push(created.id);
      tabIdsByWorkspace.set(snapshotTab.workspaceId, ids);
    }

    for (const [workspaceId, tabIds] of tabIdsByWorkspace) {
      if (!workspaceId || !tabIds.length) continue;

      const workspace = state.workspaces.find((w) => w.id === workspaceId);
      if (!workspace) continue;

      const existingGroupId = await getGroupIdForWorkspace(workspaceId);
      if (existingGroupId != null) {
        await groupTabs({ groupId: existingGroupId, tabIds: tabIds as [number, ...number[]] });
        continue;
      }

      const newGroupId = await groupTabs({
        tabIds: tabIds as [number, ...number[]],
        createProperties: { windowId }
      });
      if (newGroupId == null) continue;

      await updateTabGroup(newGroupId, {
        title: getWorkspaceGroupTitle(workspace),
        color: mapHexToGroupColor(workspace.color),
        collapsed: true
      });
      await registerGroup(workspaceId, newGroupId);
    }
  } finally {
    restoring = false;
  }

  scheduleSnapshotSave();
}
```

- [ ] **Step 2: Compile**

Run: `npx tsc`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add snapshot.ts snapshot.js
git commit -m "feat: snapshot capture with manual-only restore"
```

---

### Task 6: Context menu and keyboard commands

**Files:**
- Create: `features.ts`

- [ ] **Step 1: Create `features.ts` with:**

```ts
import type { WorkspaceSwitch } from "./types.js";
import { getState, getSettings } from "./storage.js";
import { activateWorkspace, moveTabToWorkspace } from "./workspaces.js";

const MENU_ROOT_ID = "move-tab-root";
const MENU_ITEM_PREFIX = "move-tab-to:";

export async function rebuildContextMenu(): Promise<void> {
  await chrome.contextMenus.removeAll();

  const settings = await getSettings();
  if (!settings.contextMenuEnabled) return;

  const state = await getState();
  if (!state.workspaces.length) return;

  chrome.contextMenus.create({
    id: MENU_ROOT_ID,
    title: "Move tab to workspace",
    contexts: ["page"]
  });

  for (const workspace of state.workspaces) {
    chrome.contextMenus.create({
      id: MENU_ITEM_PREFIX + workspace.id,
      parentId: MENU_ROOT_ID,
      title: `${workspace.icon} ${workspace.name}`,
      contexts: ["page"]
    });
  }
}

export async function handleContextMenuClick(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined
): Promise<void> {
  if (typeof info.menuItemId !== "string") return;
  if (!info.menuItemId.startsWith(MENU_ITEM_PREFIX)) return;
  if (tab?.id == null) return;

  const workspaceId = info.menuItemId.slice(MENU_ITEM_PREFIX.length);
  await moveTabToWorkspace(tab.id, workspaceId);
}

// Commands: switch-workspace-1..4 and next-workspace. Commands can't be
// unregistered at runtime, so the settings toggle is enforced here.
export async function handleCommand(command: string): Promise<WorkspaceSwitch | null> {
  const settings = await getSettings();
  if (!settings.shortcutsEnabled) return null;

  const state = await getState();
  if (!state.workspaces.length) return null;

  let targetId: string | null = null;
  const numbered = /^switch-workspace-(\d)$/.exec(command);
  if (numbered) {
    const index = parseInt(numbered[1], 10) - 1;
    targetId = state.workspaces[index]?.id ?? null;
  } else if (command === "next-workspace") {
    const currentIndex = state.workspaces.findIndex((w) => w.id === state.activeWorkspaceId);
    targetId = state.workspaces[(currentIndex + 1) % state.workspaces.length]?.id ?? null;
  }

  if (!targetId || targetId === state.activeWorkspaceId) return null;

  await activateWorkspace(targetId);
  return { previousWorkspaceId: state.activeWorkspaceId, workspaceId: targetId };
}
```

- [ ] **Step 2: Compile**

Run: `npx tsc`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add features.ts features.js
git commit -m "feat: move-tab context menu and workspace keyboard commands"
```

---

### Task 7: Manifest update

**Files:**
- Modify: `manifest.json`

- [ ] **Step 1: Replace the entire contents of `manifest.json` with** (adds `alarms` + `contextMenus`, adds `commands`, removes the unnecessary `<all_urls>` host permission and the invalid `windows` permission):

```json
{
  "manifest_version": 3,
  "name": "Brave Workspaces",
  "description": "Opera-like workspaces for Brave using tab groups, with memory suspension for inactive workspaces.",
  "version": "0.2.0",
  "action": {
    "default_popup": "popup.html"
  },
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "permissions": [
    "tabs",
    "tabGroups",
    "storage",
    "alarms",
    "contextMenus"
  ],
  "commands": {
    "switch-workspace-1": {
      "suggested_key": { "default": "Ctrl+Shift+1" },
      "description": "Switch to workspace 1"
    },
    "switch-workspace-2": {
      "suggested_key": { "default": "Ctrl+Shift+2" },
      "description": "Switch to workspace 2"
    },
    "switch-workspace-3": {
      "suggested_key": { "default": "Ctrl+Shift+3" },
      "description": "Switch to workspace 3"
    },
    "switch-workspace-4": {
      "suggested_key": { "default": "Ctrl+Shift+4" },
      "description": "Switch to workspace 4"
    },
    "next-workspace": {
      "description": "Switch to next workspace"
    }
  }
}
```

(Chrome allows at most 4 suggested keys per extension — `next-workspace` ships unbound; users can map it at `brave://extensions/shortcuts`.)

- [ ] **Step 2: Validate JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add manifest.json
git commit -m "feat: manifest commands, alarms/contextMenus perms, drop all_urls"
```

---

### Task 8: Background rewrite (deletes all old broken logic)

**Files:**
- Rewrite: `background.ts`

This **replaces the entire file**, deleting: destructive startup restore, window reconciliation, `setInterval` heartbeat, `onSuspend` save, snapshot V1 format + conversion, title-based lookups, auto-assign pause timers, and the multi-window snapshot logic.

- [ ] **Step 1: Replace the entire contents of `background.ts` with:**

```ts
import type { BackgroundMessage } from "./types.js";
import { getState, setGroupMap, getGroupMap } from "./storage.js";
import {
  activateWorkspace,
  autoAssignNewTab,
  syncActiveWorkspaceFromTab,
  linkGroupsOnStartup,
  ungroupWorkspaceTabs,
  restyleWorkspaceGroup,
  getWorkspaceStats,
  moveTabToWorkspace,
  focusTab
} from "./workspaces.js";
import {
  onWorkspaceSwitched,
  isSuspendAlarm,
  handleSuspendAlarm
} from "./suspend.js";
import {
  scheduleSnapshotSave,
  ensureHeartbeat,
  saveSnapshot,
  isHeartbeatAlarm,
  getSnapshotInfo,
  restoreFromBackup,
  isRestoring
} from "./snapshot.js";
import {
  rebuildContextMenu,
  handleContextMenuClick,
  handleCommand
} from "./features.js";

// ---------- lifecycle ----------

async function initialize(): Promise<void> {
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
  const msg = message as BackgroundMessage;

  const respond = (work: Promise<unknown>): true => {
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
      return respond(
        (async () => {
          const previous = (await getState()).activeWorkspaceId;
          await activateWorkspace(msg.workspaceId);
          await onWorkspaceSwitched(previous, msg.workspaceId);
        })()
      );

    case "MOVE_TAB_TO_WORKSPACE":
      return respond(moveTabToWorkspace(msg.tabId, msg.workspaceId));

    case "UNGROUP_WORKSPACE_TABS":
      return respond(ungroupWorkspaceTabs(msg.workspaceId));

    case "WORKSPACES_CHANGED":
      return respond(
        (async () => {
          if (msg.updatedWorkspaceId) {
            const workspace = (await getState()).workspaces.find(
              (w) => w.id === msg.updatedWorkspaceId
            );
            if (workspace) {
              await restyleWorkspaceGroup(workspace);
            }
          }
          await rebuildContextMenu();
        })()
      );

    case "GET_WORKSPACE_STATS":
      return respond(getWorkspaceStats());

    case "GET_SNAPSHOT_INFO":
      return respond(getSnapshotInfo());

    case "RESTORE_FROM_BACKUP":
      return respond(restoreFromBackup());

    case "FOCUS_TAB":
      return respond(
        (async () => {
          const previous = (await getState()).activeWorkspaceId;
          const workspaceId = await focusTab(msg.tabId);
          if (workspaceId && workspaceId !== previous) {
            await onWorkspaceSwitched(previous, workspaceId);
          }
        })()
      );

    default:
      return false;
  }
});
```

- [ ] **Step 2: Compile**

Run: `npx tsc`
Expected: exit 0. (`popup.ts` still compiles — its old messages `ACTIVATE_WORKSPACE`/`UNGROUP_WORKSPACE_TABS` send extra fields the router now ignores; `INIT_WORKSPACE_GROUP` will get no handler until Task 10 rewrites the popup. That transient mismatch is fine — nothing is loaded in a browser between these commits.)

- [ ] **Step 3: Commit**

```bash
git add background.ts background.js
git commit -m "refactor: thin background router; delete destructive restore and setInterval"
```

---

### Task 9: Popup HTML and CSS

**Files:**
- Rewrite: `popup.html`
- Modify: `popup.css` (append new styles)

- [ ] **Step 1: Replace the entire contents of `popup.html` with:**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Brave Workspaces</title>
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <div id="popup-root">
      <header class="header">
        <h1>Workspaces</h1>
        <button id="settingsBtn" class="icon-btn" title="Settings">⚙️</button>
      </header>

      <div id="restoreHint" class="restore-hint hidden"></div>

      <section id="searchSection" class="search-section">
        <input id="searchInput" type="text" placeholder="Search tabs in all workspaces…" />
        <div id="searchResults" class="search-results"></div>
      </section>

      <section id="settingsPanel" class="settings-panel hidden">
        <h2 class="section-title">Settings</h2>
        <label class="setting-row">
          <input type="checkbox" id="setSuspendEnabled" />
          <span>Suspend inactive workspaces (free memory)</span>
        </label>
        <div class="setting-row setting-indent">
          <span>after</span>
          <input type="number" id="setSuspendDelay" min="1" max="240" />
          <span>minutes of inactivity</span>
        </div>
        <label class="setting-row">
          <input type="checkbox" id="setShortcutsEnabled" />
          <span>Keyboard shortcuts</span>
        </label>
        <label class="setting-row">
          <input type="checkbox" id="setContextMenuEnabled" />
          <span>"Move tab to workspace" right-click menu</span>
        </label>
        <label class="setting-row">
          <input type="checkbox" id="setSearchEnabled" />
          <span>Tab search</span>
        </label>
        <label class="setting-row">
          <input type="checkbox" id="setMemoryIndicatorEnabled" />
          <span>Memory indicator</span>
        </label>
        <div class="setting-row">
          <button id="restoreBtn" class="primary-btn">Restore from backup</button>
          <span id="snapshotAge" class="snapshot-age"></span>
        </div>
        <div class="setting-row shortcut-note">
          Remap shortcuts at brave://extensions/shortcuts
        </div>
      </section>

      <section class="form-section">
        <div class="field">
          <label for="wsName">Name</label>
          <input
            id="wsName"
            type="text"
            placeholder="e.g. Work, Gaming, YouTube"
          />
        </div>

        <div class="field">
          <label>Color</label>
          <div id="colorPresets" class="color-presets"></div>
        </div>

        <div class="field">
          <label for="iconSelect">Icon</label>
          <select id="iconSelect"></select>
        </div>

        <div class="actions-row">
          <button id="addWs" class="primary-btn">Create</button>
        </div>
        <div id="formError" class="form-error" role="alert" aria-live="polite"></div>
      </section>

      <section class="ws-list-section">
        <h2 class="ws-list-title">Workspaces</h2>
        <div id="wsList" class="ws-list"></div>
      </section>
    </div>

    <script type="module" src="popup.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Append to the end of `popup.css`:**

```css
/* ---------- v2 additions ---------- */

.hidden {
  display: none !important;
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.icon-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 14px;
  padding: 2px 4px;
}

.search-section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.search-section input {
  width: 100%;
}

.search-results {
  display: flex;
  flex-direction: column;
  gap: 2px;
  max-height: 120px;
  overflow-y: auto;
}

.search-result {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 6px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  border: 1px solid #111827;
}

.search-result:hover {
  background: #111827;
}

.search-result img {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.search-result span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-panel {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border: 1px solid #1f2933;
  border-radius: 4px;
}

.section-title {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: #9ca3af;
}

.setting-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: #e5e7eb;
}

.setting-indent {
  padding-left: 20px;
  color: #9ca3af;
}

.setting-row input[type="number"] {
  width: 56px;
  font-size: 12px;
  padding: 2px 4px;
  border-radius: 4px;
  border: 1px solid #4b5563;
  background: #020617;
  color: #e5e7eb;
}

.snapshot-age {
  font-size: 11px;
  color: #9ca3af;
}

.shortcut-note {
  font-size: 11px;
  color: #9ca3af;
}

.restore-hint {
  font-size: 11px;
  color: #fbbf24;
  border: 1px solid #b45309;
  border-radius: 4px;
  padding: 6px;
}

.ws-meta {
  font-size: 10px;
  color: #9ca3af;
  margin-left: 4px;
}
```

- [ ] **Step 3: Commit**

```bash
git add popup.html popup.css
git commit -m "feat: popup markup/styles for search, settings, restore hint"
```

---

### Task 10: Popup logic rewrite

**Files:**
- Rewrite: `popup.ts`

- [ ] **Step 1: Replace the entire contents of `popup.ts` with:**

```ts
import type {
  BackgroundMessage,
  MessageResponse,
  Settings,
  SnapshotInfo,
  Workspace,
  WorkspaceStats
} from "./types.js";
import { getState, setState } from "./storage.js";

const COLOR_PRESETS: string[] = [
  "#FF5252",
  "#FF7F50",
  "#FFA726",
  "#FFEB3B",
  "#C6FF00",
  "#00E676",
  "#1DE9B6",
  "#00E5FF",
  "#2979FF",
  "#651FFF",
  "#D500F9",
  "#F06292",
  "#8D6E63",
  "#BDBDBD",
  "#607D8B",
  "#F44336",
  "#FF9800",
  "#FFEE58",
  "#66BB6A",
  "#42A5F5",
  "#FF9100"
];

const ICON_PRESETS: string[] = [
  "💼", "🎮", "📚", "🧠", "🎧", "🕹️", "💻", "📺", "📨", "📈",
  "📊", "📝", "🧪", "⚙️", "🛠️", "🏠", "🏢", "🏫", "🏥", "✈️",
  "🚗", "🚀", "🌍", "📷", "🎬", "🎵", "💬", "🔐", "🔍", "🧾",
  "💡", "🔥", "🌙", "☀️", "🌈", "🧑‍💻", "🧑‍🎓", "🧑‍🍳", "🧑‍🏫", "🧑‍🔬",
  "🐱", "🐶", "🐉", "🌲", "⚡", "🏋️", "⚽", "🏎️", "♟️", "🎲"
];

// ---------- element refs ----------

let wsNameInput: HTMLInputElement;
let iconSelect: HTMLSelectElement;
let colorPresetsContainer: HTMLDivElement;
let wsList: HTMLDivElement;
let submitBtn: HTMLButtonElement;
let formErrorEl: HTMLDivElement;
let settingsBtn: HTMLButtonElement;
let settingsPanel: HTMLElement;
let searchSection: HTMLElement;
let searchInput: HTMLInputElement;
let searchResults: HTMLDivElement;
let restoreBtn: HTMLButtonElement;
let snapshotAgeEl: HTMLSpanElement;
let restoreHintEl: HTMLDivElement;

let editingWorkspaceId: string | null = null;
let selectedColor: string = COLOR_PRESETS[0];
let currentSettings: Settings | null = null;

document.addEventListener("DOMContentLoaded", () => {
  wsNameInput = document.getElementById("wsName") as HTMLInputElement;
  iconSelect = document.getElementById("iconSelect") as HTMLSelectElement;
  colorPresetsContainer = document.getElementById("colorPresets") as HTMLDivElement;
  wsList = document.getElementById("wsList") as HTMLDivElement;
  submitBtn = document.getElementById("addWs") as HTMLButtonElement;
  formErrorEl = document.getElementById("formError") as HTMLDivElement;
  settingsBtn = document.getElementById("settingsBtn") as HTMLButtonElement;
  settingsPanel = document.getElementById("settingsPanel") as HTMLElement;
  searchSection = document.getElementById("searchSection") as HTMLElement;
  searchInput = document.getElementById("searchInput") as HTMLInputElement;
  searchResults = document.getElementById("searchResults") as HTMLDivElement;
  restoreBtn = document.getElementById("restoreBtn") as HTMLButtonElement;
  snapshotAgeEl = document.getElementById("snapshotAge") as HTMLSpanElement;
  restoreHintEl = document.getElementById("restoreHint") as HTMLDivElement;

  void init();
});

async function init(): Promise<void> {
  const state = await getState();
  currentSettings = state.settings;

  setupColorPresets();
  setupIconSelect();
  setupSubmitButton();
  setupSettingsPanel();
  setupSearch();
  applyFeatureVisibility();

  await renderWorkspaces();
  await updateSnapshotInfo();
  await maybeShowRestoreHint();
}

// ---------- messaging ----------

async function sendMessage<T = undefined>(message: BackgroundMessage): Promise<T> {
  const resp = (await chrome.runtime.sendMessage(message)) as MessageResponse<T> | undefined;
  if (!resp?.ok) {
    throw new Error(resp?.error ?? "Unknown error");
  }
  return resp.data as T;
}

// ---------- form ----------

function setupColorPresets(): void {
  colorPresetsContainer.innerHTML = "";
  COLOR_PRESETS.forEach((color) => {
    const swatch = document.createElement("div");
    swatch.className = "color-swatch";
    swatch.style.backgroundColor = color;
    if (color === selectedColor) {
      swatch.classList.add("selected");
    }
    swatch.addEventListener("click", () => {
      selectedColor = color;
      setupColorPresets();
    });
    colorPresetsContainer.appendChild(swatch);
  });
}

function setupIconSelect(): void {
  iconSelect.innerHTML = "";
  ICON_PRESETS.forEach((icon) => {
    const option = document.createElement("option");
    option.value = icon;
    option.textContent = icon;
    iconSelect.appendChild(option);
  });
}

function clearFormError(): void {
  formErrorEl.textContent = "";
}

function setFormError(message: string): void {
  formErrorEl.textContent = message;
}

function normalizedWorkspaceName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function isDuplicateWorkspaceDisplayKey(
  workspaces: Workspace[],
  name: string,
  icon: string,
  ignoreWorkspaceId: string | null = null
): boolean {
  const normalizedName = normalizedWorkspaceName(name);
  return workspaces.some((workspace) => {
    if (ignoreWorkspaceId && workspace.id === ignoreWorkspaceId) return false;
    return (
      normalizedWorkspaceName(workspace.name) === normalizedName &&
      workspace.icon === icon
    );
  });
}

function setFormModeCreate(): void {
  editingWorkspaceId = null;
  submitBtn.textContent = "Create";
  submitBtn.title = "Create new workspace";
  clearFormError();
}

function setFormModeEdit(workspace: Workspace): void {
  editingWorkspaceId = workspace.id;
  submitBtn.textContent = "Save";
  submitBtn.title = "Save changes to workspace";
  clearFormError();

  wsNameInput.value = workspace.name;
  selectedColor = workspace.color;
  setupColorPresets();

  const iconOption = Array.from(iconSelect.options).find(
    (opt) => opt.value === workspace.icon
  );
  if (iconOption) {
    iconSelect.value = workspace.icon;
  }
}

function resetForm(): void {
  wsNameInput.value = "";
  selectedColor = COLOR_PRESETS[0];
  iconSelect.value = ICON_PRESETS[0];
  setFormModeCreate();
  setupColorPresets();
}

function setupSubmitButton(): void {
  setFormModeCreate();

  submitBtn.addEventListener("click", () => {
    void onSubmitWorkspace();
  });

  wsNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      void onSubmitWorkspace();
    }
  });

  wsNameInput.addEventListener("input", clearFormError);
  iconSelect.addEventListener("change", clearFormError);
}

async function onSubmitWorkspace(): Promise<void> {
  if (editingWorkspaceId) {
    await onSaveWorkspaceEdit();
  } else {
    await onAddWorkspace();
  }
}

async function onAddWorkspace(): Promise<void> {
  const name = wsNameInput.value.trim();
  if (!name) return;

  const icon = iconSelect.value || ICON_PRESETS[0];
  const state = await getState();

  if (isDuplicateWorkspaceDisplayKey(state.workspaces, name, icon)) {
    setFormError("Workspace with the same icon and name already exists.");
    return;
  }

  const workspace: Workspace = {
    id: `ws-${Date.now()}`,
    name,
    color: selectedColor,
    icon
  };

  await setState({ workspaces: [...state.workspaces, workspace] });
  await sendMessage({ type: "WORKSPACES_CHANGED", updatedWorkspaceId: workspace.id });

  resetForm();
  await renderWorkspaces();
}

async function onSaveWorkspaceEdit(): Promise<void> {
  if (!editingWorkspaceId) return;

  const name = wsNameInput.value.trim();
  if (!name) return;

  const icon = iconSelect.value || ICON_PRESETS[0];
  const state = await getState();

  if (isDuplicateWorkspaceDisplayKey(state.workspaces, name, icon, editingWorkspaceId)) {
    setFormError("Workspace with the same icon and name already exists.");
    return;
  }

  const idx = state.workspaces.findIndex((w) => w.id === editingWorkspaceId);
  if (idx === -1) {
    resetForm();
    await renderWorkspaces();
    return;
  }

  const updated: Workspace = { ...state.workspaces[idx], name, color: selectedColor, icon };
  const updatedWorkspaces = [...state.workspaces];
  updatedWorkspaces[idx] = updated;

  await setState({ workspaces: updatedWorkspaces });
  await sendMessage({ type: "WORKSPACES_CHANGED", updatedWorkspaceId: updated.id });

  resetForm();
  await renderWorkspaces();
}

// ---------- workspace list ----------

async function renderWorkspaces(): Promise<void> {
  const state = await getState();
  currentSettings = state.settings;
  const { workspaces, activeWorkspaceId } = state;

  wsList.innerHTML = "";

  if (workspaces.length === 0) {
    const info = document.createElement("div");
    info.textContent = "No workspaces yet. Create one above.";
    info.style.fontSize = "12px";
    info.style.opacity = "0.8";
    wsList.appendChild(info);
    return;
  }

  let statsById = new Map<string, WorkspaceStats>();
  if (state.settings.memoryIndicatorEnabled) {
    try {
      const stats = await sendMessage<WorkspaceStats[]>({ type: "GET_WORKSPACE_STATS" });
      statsById = new Map(stats.map((s) => [s.workspaceId, s]));
    } catch {
      // indicator is best-effort
    }
  }

  workspaces.forEach((ws) => {
    const item = document.createElement("div");
    item.className = "ws-item";
    if (ws.id === activeWorkspaceId) item.classList.add("active");
    if (ws.id === editingWorkspaceId) item.classList.add("editing");

    const left = document.createElement("div");
    left.className = "ws-left";

    const colorDot = document.createElement("div");
    colorDot.className = "ws-color-dot";
    colorDot.style.backgroundColor = ws.color;

    const iconSpan = document.createElement("span");
    iconSpan.className = "ws-icon";
    iconSpan.textContent = ws.icon;

    const nameSpan = document.createElement("span");
    nameSpan.className = "ws-name";
    nameSpan.textContent = ws.name;

    left.appendChild(colorDot);
    left.appendChild(iconSpan);
    left.appendChild(nameSpan);

    const stats = statsById.get(ws.id);
    if (stats && stats.tabCount > 0) {
      const metaSpan = document.createElement("span");
      metaSpan.className = "ws-meta";
      metaSpan.textContent =
        stats.discardedCount > 0
          ? `${stats.tabCount} tabs · ${stats.discardedCount} sleeping`
          : `${stats.tabCount} tabs`;
      left.appendChild(metaSpan);
    }

    const actions = document.createElement("div");
    actions.className = "ws-actions";

    const useBtn = document.createElement("button");
    useBtn.textContent = "Use";
    useBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void onUseWorkspace(ws.id);
    });

    const editBtn = document.createElement("button");
    editBtn.textContent = "Edit";
    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      setFormModeEdit(ws);
      void renderWorkspaces();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "✕";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      void onDeleteWorkspace(ws.id);
    });

    actions.appendChild(useBtn);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    item.appendChild(left);
    item.appendChild(actions);

    item.addEventListener("click", () => {
      void onUseWorkspace(ws.id);
    });

    wsList.appendChild(item);
  });
}

async function onUseWorkspace(workspaceId: string): Promise<void> {
  try {
    await sendMessage({ type: "ACTIVATE_WORKSPACE", workspaceId });
  } catch (err) {
    setFormError(String(err));
  }
  await renderWorkspaces();
}

async function onDeleteWorkspace(workspaceId: string): Promise<void> {
  if (editingWorkspaceId === workspaceId) {
    resetForm();
  }

  try {
    await sendMessage({ type: "UNGROUP_WORKSPACE_TABS", workspaceId });
  } catch (err) {
    setFormError(String(err));
  }

  const state = await getState();
  const filtered = state.workspaces.filter((w) => w.id !== workspaceId);

  let nextActive: string | null = state.activeWorkspaceId;
  if (workspaceId === state.activeWorkspaceId) {
    nextActive = filtered.length ? filtered[0].id : null;
  }

  await setState({ workspaces: filtered, activeWorkspaceId: nextActive });
  await sendMessage({ type: "WORKSPACES_CHANGED" });
  await renderWorkspaces();
}

// ---------- settings panel ----------

function setupSettingsPanel(): void {
  settingsBtn.addEventListener("click", () => {
    settingsPanel.classList.toggle("hidden");
  });

  bindCheckbox("setSuspendEnabled", "suspendEnabled");
  bindCheckbox("setShortcutsEnabled", "shortcutsEnabled");
  bindCheckbox("setContextMenuEnabled", "contextMenuEnabled");
  bindCheckbox("setSearchEnabled", "searchEnabled");
  bindCheckbox("setMemoryIndicatorEnabled", "memoryIndicatorEnabled");

  const delayInput = document.getElementById("setSuspendDelay") as HTMLInputElement;
  if (currentSettings) {
    delayInput.value = String(currentSettings.suspendDelayMinutes);
  }
  delayInput.addEventListener("change", () => {
    const value = parseInt(delayInput.value, 10);
    if (Number.isFinite(value) && value >= 1 && value <= 240) {
      void saveSettings({ suspendDelayMinutes: value });
    }
  });

  restoreBtn.addEventListener("click", () => {
    void (async () => {
      restoreBtn.disabled = true;
      restoreBtn.textContent = "Restoring…";
      try {
        await sendMessage({ type: "RESTORE_FROM_BACKUP" });
      } catch (err) {
        setFormError(String(err));
      }
      restoreBtn.textContent = "Restore from backup";
      restoreBtn.disabled = false;
      await renderWorkspaces();
      await updateSnapshotInfo();
    })();
  });
}

function bindCheckbox(elementId: string, key: keyof Settings): void {
  const checkbox = document.getElementById(elementId) as HTMLInputElement;
  if (currentSettings) {
    checkbox.checked = currentSettings[key] as boolean;
  }
  checkbox.addEventListener("change", () => {
    void saveSettings({ [key]: checkbox.checked } as Partial<Settings>);
  });
}

async function saveSettings(patch: Partial<Settings>): Promise<void> {
  if (!currentSettings) return;
  currentSettings = { ...currentSettings, ...patch };
  await setState({ settings: currentSettings });
  applyFeatureVisibility();

  if ("contextMenuEnabled" in patch) {
    try {
      await sendMessage({ type: "WORKSPACES_CHANGED" });
    } catch {
      // menu rebuild is best-effort
    }
  }
  if ("memoryIndicatorEnabled" in patch) {
    await renderWorkspaces();
  }
}

function applyFeatureVisibility(): void {
  if (!currentSettings) return;
  searchSection.classList.toggle("hidden", !currentSettings.searchEnabled);
}

// ---------- tab search ----------

function setupSearch(): void {
  searchInput.addEventListener("input", () => {
    void runSearch();
  });
}

async function runSearch(): Promise<void> {
  const query = searchInput.value.trim().toLowerCase();
  searchResults.innerHTML = "";
  if (query.length < 2) return;

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const matches = tabs
    .filter(
      (t) =>
        (t.title ?? "").toLowerCase().includes(query) ||
        (t.url ?? "").toLowerCase().includes(query)
    )
    .slice(0, 8);

  for (const tab of matches) {
    if (tab.id == null) continue;
    const tabId = tab.id;

    const row = document.createElement("div");
    row.className = "search-result";

    if (tab.favIconUrl) {
      const img = document.createElement("img");
      img.src = tab.favIconUrl;
      row.appendChild(img);
    }

    const span = document.createElement("span");
    span.textContent = tab.title || tab.url || "";
    row.appendChild(span);

    row.addEventListener("click", () => {
      void (async () => {
        try {
          await sendMessage({ type: "FOCUS_TAB", tabId });
        } catch {
          // tab may have closed
        }
        window.close();
      })();
    });

    searchResults.appendChild(row);
  }
}

// ---------- snapshot info + restore hint ----------

function formatAge(savedAt: number): string {
  const minutes = Math.floor((Date.now() - savedAt) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

async function updateSnapshotInfo(): Promise<void> {
  try {
    const info = await sendMessage<SnapshotInfo | null>({ type: "GET_SNAPSHOT_INFO" });
    if (info) {
      snapshotAgeEl.textContent = `backup from ${formatAge(info.savedAt)} · ${info.tabCount} tabs`;
      restoreBtn.disabled = false;
    } else {
      snapshotAgeEl.textContent = "no backup yet";
      restoreBtn.disabled = true;
    }
  } catch {
    snapshotAgeEl.textContent = "";
  }
}

async function maybeShowRestoreHint(): Promise<void> {
  try {
    const info = await sendMessage<SnapshotInfo | null>({ type: "GET_SNAPSHOT_INFO" });
    if (!info || info.tabCount < 3) return;

    const tabs = await chrome.tabs.query({ currentWindow: true });
    const realTabs = tabs.filter((t) => {
      const url = t.url ?? t.pendingUrl ?? "";
      return (
        url &&
        !url.startsWith("chrome://") &&
        !url.startsWith("brave://") &&
        !url.startsWith("chrome-extension://")
      );
    });

    if (realTabs.length <= 1) {
      restoreHintEl.textContent =
        `Your session looks empty but a backup with ${info.tabCount} tabs exists. ` +
        `Open ⚙️ Settings → "Restore from backup". Tip: enable "Continue where you ` +
        `left off" in Brave settings so tabs survive restarts.`;
      restoreHintEl.classList.remove("hidden");
    }
  } catch {
    // hint is best-effort
  }
}
```

- [ ] **Step 2: Compile**

Run: `npx tsc`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add popup.ts popup.js
git commit -m "feat: popup with search, settings panel, stats, manual restore"
```

---

### Task 11: README, final verification, manual test pass

**Files:**
- Rewrite: `README.MD`

- [ ] **Step 1: Replace the entire contents of `README.MD` with:**

```markdown
# Brave Workspaces

Opera-like workspaces for Brave/Chrome, built on tab groups, with automatic
memory suspension for inactive workspaces.

## Features

- Workspaces with name, color, and icon — each is a tab group in your main window
- Switching collapses other workspaces and focuses your last-used tab
- New tabs join the active workspace; tabs opened from a page follow their opener
- Inactive workspaces are suspended after a delay (default 10 min): tabs are
  discarded to free memory, but audible tabs (music/video), pinned tabs, and
  opted-out tabs keep running. Discarded tabs reload instantly when clicked.
- Keyboard shortcuts: Ctrl+Shift+1..4 to switch workspaces (remap at
  brave://extensions/shortcuts)
- Right-click a page → "Move tab to workspace"
- Search tabs across all workspaces from the popup
- Memory indicator: see how many tabs per workspace are sleeping
- Session backup: a snapshot is saved continuously; restore it manually from
  ⚙️ Settings if a session is ever lost. The extension never deletes or
  restores tabs automatically — enable Brave's "Continue where you left off"
  for normal restarts.

All features can be toggled in the popup's ⚙️ Settings panel.

## Build

```
npm install
npx tsc          # or: npx tsc --watch
```

## Install

1. Build (above)
2. Open brave://extensions, enable Developer mode
3. "Load unpacked" → select this folder
```

- [ ] **Step 2: Full compile from clean state**

Run: `npx tsc`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add README.MD
git commit -m "docs: v2 README"
```

- [ ] **Step 4: Manual test checklist (requires loading the extension in Brave — ask the user to run through this; items map 1:1 to the spec's test list):**

1. Load unpacked at `brave://extensions` (or hit reload if already loaded). No errors on the extension card.
2. Create two workspaces; duplicate name+icon is rejected with the inline error.
3. "Use" a workspace → a new tab opens grouped under it; switch between the two → other group collapses, last-used tab focused.
4. Open a new tab (Ctrl+T) → it joins the active workspace. Open a link in a new tab from a grouped page → it follows the opener's group.
5. Set suspend delay to 1 minute in ⚙️ Settings. Play a YouTube video in workspace A, switch to workspace B, wait ~90s → workspace A's tabs show as discarded (check the "sleeping" count in the popup), but the YouTube tab keeps playing.
6. Click a discarded tab → it reloads in place.
7. Edit a workspace's name/color → the group's title/color update live.
8. Right-click a page → "Move tab to workspace" → tab moves groups.
9. Press Ctrl+Shift+1 / Ctrl+Shift+2 → workspaces switch.
10. Type in the search box → matching tabs from a collapsed workspace appear; clicking one switches workspace and focuses it.
11. With Brave's "Continue where you left off" ON, restart the browser → groups come back and the popup shows the correct active workspace after clicking around.
12. ⚙️ Settings → "Restore from backup" → snapshot tabs are appended and grouped; nothing existing is closed.
13. Toggle each setting off and confirm its feature stops (menu disappears, shortcuts ignored, search hidden, indicator hidden, no discarding).
14. Delete a workspace → its tabs are ungrouped, not closed.

---

## Self-review notes (completed)

- **Spec coverage:** core model (Task 3), suspension (Task 4), snapshot/manual restore + hint (Tasks 5, 10), QoL ×4 (Tasks 6, 7, 10), settings (Tasks 1, 10), deletions (Tasks 1, 7, 8), error handling (Task 2 + router), testing (Task 11). Restore-hint heuristic lives in the popup (`maybeShowRestoreHint`), satisfying the spec's hint requirement.
- **Type consistency:** `WorkspaceSwitch` shared by `syncActiveWorkspaceFromTab`/`handleCommand`/`onWorkspaceSwitched`; `SnapshotInfo` shared by snapshot module and popup; message names match between popup `sendMessage` calls and the background router.
- **Known intentional gaps (YAGNI):** no drag-reorder of workspaces, no per-workspace suspend overrides, no multi-window support — all deferred per spec.
