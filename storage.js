const DEFAULT_STATE = {
    workspaces: [],
    activeWorkspaceId: null
};
const STATE_KEYS = ["workspaces", "activeWorkspaceId"];
let migrationPromise = null;
function hasValueForState(value) {
    return (Array.isArray(value.workspaces) ||
        typeof value.activeWorkspaceId === "string" ||
        value.activeWorkspaceId === null);
}
function migrateSyncStateToLocalOnce() {
    if (migrationPromise)
        return migrationPromise;
    migrationPromise = new Promise((resolve) => {
        chrome.storage.local.get(STATE_KEYS, (localData) => {
            const localState = localData;
            if (hasValueForState(localState)) {
                resolve();
                return;
            }
            chrome.storage.sync.get(STATE_KEYS, (syncData) => {
                const syncState = syncData;
                if (!hasValueForState(syncState)) {
                    resolve();
                    return;
                }
                const toCopy = {};
                if (Array.isArray(syncState.workspaces)) {
                    toCopy.workspaces = syncState.workspaces;
                }
                if (typeof syncState.activeWorkspaceId === "string" ||
                    syncState.activeWorkspaceId === null) {
                    toCopy.activeWorkspaceId = syncState.activeWorkspaceId;
                }
                const payload = toCopy;
                chrome.storage.local.set(payload, () => resolve());
            });
        });
    });
    return migrationPromise;
}
export function getState() {
    return new Promise((resolve) => {
        void migrateSyncStateToLocalOnce().then(() => {
            chrome.storage.local.get(STATE_KEYS, (data) => {
                const partial = data;
                const merged = {
                    ...DEFAULT_STATE,
                    ...partial
                };
                resolve(merged);
            });
        });
    });
}
export function setState(partial) {
    return new Promise((resolve) => {
        void migrateSyncStateToLocalOnce().then(() => {
            const toSave = partial;
            chrome.storage.local.set(toSave, () => resolve());
        });
    });
}
