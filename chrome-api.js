// Thin promise wrappers around chrome.* calls that may reject (closed tabs,
// stale group IDs, etc.). Failures are logged with context and surfaced as
// null/empty so callers degrade gracefully.
export async function safe(operation, promise) {
    try {
        return await promise;
    }
    catch (err) {
        console.warn(`[workspaces] ${operation} failed:`, err);
        return null;
    }
}
export async function queryTabs(query) {
    return (await safe("tabs.query", chrome.tabs.query(query))) ?? [];
}
export async function queryTabGroups(query) {
    return (await safe("tabGroups.query", chrome.tabGroups.query(query))) ?? [];
}
export function getTab(tabId) {
    return safe(`tabs.get(${tabId})`, chrome.tabs.get(tabId));
}
export function getTabGroup(groupId) {
    return safe(`tabGroups.get(${groupId})`, chrome.tabGroups.get(groupId));
}
export async function updateTab(tabId, props) {
    return (await safe(`tabs.update(${tabId})`, chrome.tabs.update(tabId, props))) ?? null;
}
export async function updateTabGroup(groupId, props) {
    return (await safe(`tabGroups.update(${groupId})`, chrome.tabGroups.update(groupId, props))) ?? null;
}
export function groupTabs(options) {
    return safe("tabs.group", chrome.tabs.group(options));
}
export async function ungroupTabs(tabIds) {
    if (!tabIds.length)
        return;
    await safe("tabs.ungroup", chrome.tabs.ungroup(tabIds));
}
export function createTab(props) {
    return safe("tabs.create", chrome.tabs.create(props));
}
export async function discardTab(tabId) {
    await safe(`tabs.discard(${tabId})`, chrome.tabs.discard(tabId));
}
// Single-window focus: the extension operates in the last-focused normal
// window and ignores all others.
export async function getMainWindow() {
    const win = await safe("windows.getLastFocused", chrome.windows.getLastFocused({ windowTypes: ["normal"] }));
    return win && win.type === "normal" ? win : null;
}
export function isInternalUrl(url) {
    return (url.startsWith("chrome://") ||
        url.startsWith("brave://") ||
        url.startsWith("devtools://") ||
        url.startsWith("chrome-extension://"));
}
