import type { ExtensionState } from "./types";

const DEFAULT_STATE: ExtensionState = {
  workspaces: [],
  activeWorkspaceId: null
};

export function getState(): Promise<ExtensionState> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(null, (data) => {
      const partial = data as Partial<ExtensionState>;
      const merged: ExtensionState = {
        ...DEFAULT_STATE,
        ...partial
      };
      resolve(merged);
    });
  });
}

export function setState(partial: Partial<ExtensionState>): Promise<void> {
  return new Promise(async (resolve) => {
    const current = await getState();
    const next: ExtensionState = {
      ...current,
      ...partial
    };

    const toSave = next as unknown as { [key: string]: unknown };

    chrome.storage.sync.set(toSave, () => resolve());
  });
}
