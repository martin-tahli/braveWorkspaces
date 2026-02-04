import type { ExtensionState } from "./types";

const DEFAULT_STATE: ExtensionState = {
  workspaces: [],
  activeWorkspaceId: null
};

const STATE_KEYS: Array<keyof ExtensionState> = ["workspaces", "activeWorkspaceId"];

let migrationPromise: Promise<void> | null = null;

function hasValueForState(value: Partial<ExtensionState>): boolean {
  return (
    Array.isArray(value.workspaces) ||
    typeof value.activeWorkspaceId === "string" ||
    value.activeWorkspaceId === null
  );
}

function migrateSyncStateToLocalOnce(): Promise<void> {
  if (migrationPromise) return migrationPromise;

  migrationPromise = new Promise((resolve) => {
    chrome.storage.local.get(STATE_KEYS, (localData) => {
      const localState = localData as Partial<ExtensionState>;
      if (hasValueForState(localState)) {
        resolve();
        return;
      }

      chrome.storage.sync.get(STATE_KEYS, (syncData) => {
        const syncState = syncData as Partial<ExtensionState>;
        if (!hasValueForState(syncState)) {
          resolve();
          return;
        }

        const toCopy: Partial<ExtensionState> = {};
        if (Array.isArray(syncState.workspaces)) {
          toCopy.workspaces = syncState.workspaces;
        }
        if (
          typeof syncState.activeWorkspaceId === "string" ||
          syncState.activeWorkspaceId === null
        ) {
          toCopy.activeWorkspaceId = syncState.activeWorkspaceId;
        }

        const payload = toCopy as unknown as { [key: string]: unknown };
        chrome.storage.local.set(payload, () => resolve());
      });
    });
  });

  return migrationPromise;
}

export function getState(): Promise<ExtensionState> {
  return new Promise((resolve) => {
    void migrateSyncStateToLocalOnce().then(() => {
      chrome.storage.local.get(STATE_KEYS, (data) => {
        const partial = data as Partial<ExtensionState>;
        const merged: ExtensionState = {
          ...DEFAULT_STATE,
          ...partial
        };
        resolve(merged);
      });
    });
  });
}

export function setState(partial: Partial<ExtensionState>): Promise<void> {
  return new Promise((resolve) => {
    void migrateSyncStateToLocalOnce().then(() => {
      const toSave = partial as unknown as { [key: string]: unknown };
      chrome.storage.local.set(toSave, () => resolve());
    });
  });
}
