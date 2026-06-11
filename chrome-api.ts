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

export async function updateTab(
  tabId: number,
  props: chrome.tabs.UpdateProperties
): Promise<chrome.tabs.Tab | null> {
  return (await safe(`tabs.update(${tabId})`, chrome.tabs.update(tabId, props))) ?? null;
}

export async function updateTabGroup(
  groupId: number,
  props: chrome.tabGroups.UpdateProperties
): Promise<chrome.tabGroups.TabGroup | null> {
  return (await safe(`tabGroups.update(${groupId})`, chrome.tabGroups.update(groupId, props))) ?? null;
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
