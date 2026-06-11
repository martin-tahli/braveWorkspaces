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

// Re-sync alarms after settings or workspace-list changes: clears every
// workspace's pending alarm and starts countdowns for the inactive ones
// (scheduleSuspend itself no-ops when suspension is disabled).
export async function rescheduleAllSuspends(): Promise<void> {
  const state = await getState();
  for (const workspace of state.workspaces) {
    await cancelSuspend(workspace.id);
    if (state.activeWorkspaceId !== workspace.id) {
      await scheduleSuspend(workspace.id);
    }
  }
}
