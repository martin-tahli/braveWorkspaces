const DEFAULT_STATE = {
    workspaces: [],
    activeWorkspaceId: null
};
export function getState() {
    return new Promise((resolve) => {
        // get everything, then merge with defaults
        chrome.storage.sync.get(null, (data) => {
            const partial = data;
            const merged = {
                ...DEFAULT_STATE,
                ...partial
            };
            resolve(merged);
        });
    });
}
export function setState(partial) {
    return new Promise(async (resolve) => {
        const current = await getState();
        const next = {
            ...current,
            ...partial
        };
        // Cast via unknown to satisfy TS (storage wants an index-signature object)
        const toSave = next;
        chrome.storage.sync.set(toSave, () => resolve());
    });
}
