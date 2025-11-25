import type { Workspace } from "./types.js";
import { getState, setState } from "./storage.js";

// ---------- types ----------

type TabGroupColor =
  | "grey"
  | "blue"
  | "red"
  | "yellow"
  | "green"
  | "pink"
  | "purple"
  | "cyan";


// ---------- color helpers ----------

// same as before: parse #RGB / #RRGGBB
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const trimmed = hex.trim();
  const m =
    /^#?([0-9a-fA-F]{6})$/.exec(trimmed) ||
    /^#?([0-9a-fA-F]{3})$/.exec(trimmed);

  if (!m) return null;

  let value = m[1];

  if (value.length === 3) {
    // #abc -> #aabbcc
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

// normalize any hex to canonical "#RRGGBB" uppercase string
function normalizeHex6(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb.r.toString(16).padStart(2, "0").toUpperCase();
  const g = rgb.g.toString(16).padStart(2, "0").toUpperCase();
  const b = rgb.b.toString(16).padStart(2, "0").toUpperCase();
  return `#${r}${g}${b}`;
}

// explicit mapping for ALL popup presets
const PRESET_GROUP_COLOR_MAP: Record<string, TabGroupColor> = {
  "#FF5252": "red",
  "#FF7F50": "yellow", // coral → warm
  "#FFA726": "yellow", // orange
  "#FFEB3B": "yellow",
  "#C6FF00": "green",  // lime-y, treat as green
  "#00E676": "green",
  "#1DE9B6": "cyan",
  "#00E5FF": "cyan",
  "#2979FF": "blue",
  "#651FFF": "purple",
  "#D500F9": "purple",
  "#F06292": "pink",
  "#8D6E63": "grey",   // brownish → grey-ish
  "#BDBDBD": "grey",
  "#607D8B": "blue",   // blue-grey
  "#F44336": "red",
  "#FF9800": "yellow",
  "#FFEE58": "yellow",
  "#66BB6A": "green",
  "#42A5F5": "blue"
};

function rgbToHsl(r: number, g: number, b: number): {
  h: number;
  s: number;
  l: number;
} {
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

function mapHexToGroupColor(hex: string): TabGroupColor {
  // 1) exact mapping for our preset swatches
  const key = normalizeHex6(hex);
  if (key && PRESET_GROUP_COLOR_MAP[key]) {
    return PRESET_GROUP_COLOR_MAP[key];
  }

  // 2) fallback for arbitrary colors from the wheel
  const rgb = hexToRgb(hex);
  if (!rgb) return "grey";

  const { h, s, l } = rgbToHsl(rgb.r, rgb.g, rgb.b);

  // low saturation -> grey
  if (s < 0.15) {
    return "grey";
  }

  // very bright → yellow-ish
  if (l > 0.8) {
    return "yellow";
  }

  // hue-based buckets
  if (h < 15 || h >= 345) return "red";
  if (h < 60) return "yellow";
  if (h < 150) return "green";   // includes lime-y greens
  if (h < 200) return "cyan";
  if (h < 255) return "blue";
  if (h < 315) return "purple";
  return "pink";
}



// ---------- chrome.* promise helpers ----------

function queryTabGroups(query: chrome.tabGroups.QueryInfo) {
  return new Promise<chrome.tabGroups.TabGroup[]>((resolve) => {
    chrome.tabGroups.query(query, resolve);
  });
}

function updateTabGroup(
  groupId: number,
  updateProps: chrome.tabGroups.UpdateProperties
) {
  return new Promise<chrome.tabGroups.TabGroup>((resolve, reject) => {
    chrome.tabGroups.update(groupId, updateProps, (group) => {
      if (!group) {
        reject(new Error("tabGroups.update returned undefined"));
      } else {
        resolve(group);
      }
    });
  });
}

function groupTabs(opts: chrome.tabs.GroupOptions) {
  return new Promise<number>((resolve) => {
    chrome.tabs.group(opts, (groupId) => {
      resolve(groupId);
    });
  });
}

function queryTabs(query: chrome.tabs.QueryInfo) {
  return new Promise<chrome.tabs.Tab[]>((resolve) => {
    chrome.tabs.query(query, resolve);
  });
}

function getCurrentWindow() {
  return new Promise<chrome.windows.Window>((resolve) => {
    chrome.windows.getCurrent(resolve);
  });
}

function getTab(tabId: number) {
  return new Promise<chrome.tabs.Tab | null>((resolve) => {
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(tab);
      }
    });
  });
}

function getTabGroup(groupId: number) {
  return new Promise<chrome.tabGroups.TabGroup | null>((resolve) => {
    chrome.tabGroups.get(groupId, (group) => {
      if (chrome.runtime.lastError) {
        resolve(null);
      } else {
        resolve(group);
      }
    });
  });
}

function createTab(opts: chrome.tabs.CreateProperties) {
  return new Promise<chrome.tabs.Tab>((resolve) => {
    chrome.tabs.create(opts, (tab) => {
      resolve(tab);
    });
  });
}

// ensure we pass valid types to chrome.tabs.ungroup
function ungroupTabs(tabIds: number | number[]) {
  return new Promise<void>((resolve) => {
    if (Array.isArray(tabIds)) {
      if (tabIds.length === 0) {
        resolve();
        return;
      }
      const tuple = tabIds as [number, ...number[]];
      chrome.tabs.ungroup(tuple, () => resolve());
    } else {
      chrome.tabs.ungroup(tabIds, () => resolve());
    }
  });
}

// ---------- state helpers ----------

async function getWorkspaceById(id: string): Promise<Workspace | null> {
  const state = await getState();
  return state.workspaces.find((w) => w.id === id) ?? null;
}

async function getActiveWorkspace(): Promise<Workspace | null> {
  const state = await getState();
  if (!state.activeWorkspaceId) return null;
  return state.workspaces.find((w) => w.id === state.activeWorkspaceId) ?? null;
}

// Compute the tab group title we expect for a workspace
function getWorkspaceGroupTitle(workspace: Workspace): string {
  return workspace.icon
    ? `${workspace.icon} ${workspace.name}`
    : workspace.name;
}

// ---------- tab group logic ----------

async function getWorkspaceGroup(
  workspace: Workspace,
  windowId: number
): Promise<chrome.tabGroups.TabGroup | null> {
  const groups = await queryTabGroups({ windowId });
  const desiredTitle = getWorkspaceGroupTitle(workspace);
  const found = groups.find((g) => g.title === desiredTitle);
  return found ?? null;
}

/**
 * Ensure a tab group exists for this workspace in the given window.
 * If needed, it will group either:
 * - the active tab in that window, or
 * - a newly created blank tab (if somehow no active tab is found).
 */
async function ensureWorkspaceGroup(
  workspace: Workspace,
  windowId: number
): Promise<chrome.tabGroups.TabGroup> {
  const groupColor = mapHexToGroupColor(workspace.color);
  const title = getWorkspaceGroupTitle(workspace);

  const existing = await getWorkspaceGroup(workspace, windowId);
  if (existing) {
    const updated = await updateTabGroup(existing.id, {
      title,
      color: groupColor
    });
    return updated;
  }

  // 1) Try to use active tab in that window
  const tabs = await queryTabs({ active: true, windowId });
  let baseTabId = tabs[0]?.id;

  // 2) Fallback: create a new tab in that window
  if (baseTabId == null) {
    const newTab = await createTab({ windowId, active: true });
    baseTabId = newTab.id!;
  }

  const groupId = await groupTabs({
    tabIds: [baseTabId],
    createProperties: { windowId }
  });

  const updated = await updateTabGroup(groupId, {
    title,
    color: groupColor
  });

  return updated;
}

async function collapseOtherGroups(
  windowId: number,
  activeGroupId: number
): Promise<void> {
  const groups = await queryTabGroups({ windowId });
  await Promise.all(
    groups.map(
      (g) =>
        new Promise<void>((resolve) => {
          chrome.tabGroups.update(
            g.id,
            { collapsed: g.id !== activeGroupId },
            () => resolve()
          );
        })
    )
  );
}

async function addTabToWorkspace(
  tabId: number,
  windowId: number,
  workspace: Workspace
): Promise<void> {
  const group = await ensureWorkspaceGroup(workspace, windowId);
  await groupTabs({ groupId: group.id, tabIds: [tabId] });
  await collapseOtherGroups(windowId, group.id);
}

// ---------- activation / messages ----------

interface ActivateWorkspaceMessage {
  type: "ACTIVATE_WORKSPACE";
  workspaceId: string;
  moveCurrentTab?: boolean;
}

interface UngroupWorkspaceTabsMessage {
  type: "UNGROUP_WORKSPACE_TABS";
  workspaceId: string;
}

interface InitWorkspaceGroupMessage {
  type: "INIT_WORKSPACE_GROUP";
  workspaceId: string;
}

type IncomingMessage =
  | ActivateWorkspaceMessage
  | UngroupWorkspaceTabsMessage
  | InitWorkspaceGroupMessage;

async function handleActivateWorkspace(
  workspaceId: string,
  moveCurrentTab: boolean = true
): Promise<void> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return;

  const win = await getCurrentWindow();
  const windowId = win.id;
  if (windowId == null) return;

  if (moveCurrentTab) {
    const tabs = await queryTabs({ active: true, windowId });
    const tab = tabs[0];
    if (tab && tab.id != null) {
      await addTabToWorkspace(tab.id, windowId, workspace);
    }
  } else {
    const group = await ensureWorkspaceGroup(workspace, windowId);
    await collapseOtherGroups(windowId, group.id);
  }

  await setState({ activeWorkspaceId: workspaceId });
}

// Create a real tab group for this workspace in the current window,
// so it shows up in Chrome/Brave's native "Add tab to group" list.
async function initWorkspaceGroup(workspaceId: string): Promise<void> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return;

  const win = await getCurrentWindow();
  const windowId = win.id;
  if (windowId == null) return;

  await ensureWorkspaceGroup(workspace, windowId);
}

// Move a specific tab to the given workspace (used internally if needed)
async function moveTabToWorkspace(tabId: number, workspaceId: string) {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return;

  const tab = await getTab(tabId);
  if (!tab || tab.windowId == null) return;

  await addTabToWorkspace(tabId, tab.windowId, workspace);
  await setState({ activeWorkspaceId: workspaceId });
}

// ---------- ungroup all tabs for a workspace (on delete) ----------

async function ungroupWorkspaceTabs(workspaceId: string): Promise<void> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return;

  const title = getWorkspaceGroupTitle(workspace);

  // query all groups in all windows
  const groups = await queryTabGroups({});
  const targetGroups = groups.filter((g) => g.title === title);
  if (!targetGroups.length) return;

  for (const group of targetGroups) {
    const tabs = await queryTabs({ groupId: group.id });
    const ids = tabs
      .map((t) => t.id)
      .filter((id): id is number => id != null);
    if (ids.length) {
      await ungroupTabs(ids);
    }
  }
}

// ---------- keep activeWorkspaceId in sync with active tab ----------

async function syncActiveWorkspaceFromTab(activeInfo: {
  tabId: number;
  windowId: number;
}) {
  const tab = await getTab(activeInfo.tabId);
  if (!tab) return;

  const groupId = tab.groupId;
  if (groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) return;

  const group = await getTabGroup(groupId);
  if (!group) return;

  const state = await getState();
  const workspace = state.workspaces.find((ws) => {
    const title = getWorkspaceGroupTitle(ws);
    return title === group.title;
  });

  if (!workspace) return;

  if (state.activeWorkspaceId !== workspace.id) {
    await setState({ activeWorkspaceId: workspace.id });
  }
}

// Whenever user switches tab (or tab group), update last-used workspace
chrome.tabs.onActivated.addListener((activeInfo) => {
  void syncActiveWorkspaceFromTab(activeInfo);
});

// ---------- auto-assign new tabs to last workspace ----------

async function autoAssignTabToActiveWorkspace(tab: chrome.tabs.Tab) {
  if (tab.id == null || tab.windowId == null) return;
  if (tab.pinned) return;
  if (tab.url && tab.url.startsWith("chrome://")) return;

  const workspace = await getActiveWorkspace();
  if (!workspace) return;

  await addTabToWorkspace(tab.id, tab.windowId, workspace);
}

chrome.tabs.onCreated.addListener((tab) => {
  void autoAssignTabToActiveWorkspace(tab);
});

// ---------- message bridge (popup -> background) ----------

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const msg = message as IncomingMessage;

  if (msg.type === "ACTIVATE_WORKSPACE") {
    void handleActivateWorkspace(msg.workspaceId, msg.moveCurrentTab ?? true)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("ACTIVATE_WORKSPACE error", err);
        sendResponse({ ok: false, error: String(err) });
      });

    return true; // async response
  }

  if (msg.type === "UNGROUP_WORKSPACE_TABS") {
    void ungroupWorkspaceTabs(msg.workspaceId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("UNGROUP_WORKSPACE_TABS error", err);
        sendResponse({ ok: false, error: String(err) });
      });

    return true; // async response
  }

  if (msg.type === "INIT_WORKSPACE_GROUP") {
    void initWorkspaceGroup(msg.workspaceId)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => {
        console.error("INIT_WORKSPACE_GROUP error", err);
        sendResponse({ ok: false, error: String(err) });
      });

    return true; // async response
  }

  return false;
});
