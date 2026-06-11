import { getState, setState } from "./storage.js";
const COLOR_PRESETS = [
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
const ICON_PRESETS = [
    "💼", "🎮", "📚", "🧠", "🎧", "🕹️", "💻", "📺", "📨", "📈",
    "📊", "📝", "🧪", "⚙️", "🛠️", "🏠", "🏢", "🏫", "🏥", "✈️",
    "🚗", "🚀", "🌍", "📷", "🎬", "🎵", "💬", "🔐", "🔍", "🧾",
    "💡", "🔥", "🌙", "☀️", "🌈", "🧑‍💻", "🧑‍🎓", "🧑‍🍳", "🧑‍🏫", "🧑‍🔬",
    "🐱", "🐶", "🐉", "🌲", "⚡", "🏋️", "⚽", "🏎️", "♟️", "🎲"
];
// ---------- element refs ----------
let wsNameInput;
let iconSelect;
let colorPresetsContainer;
let wsList;
let submitBtn;
let formErrorEl;
let settingsBtn;
let settingsPanel;
let searchSection;
let searchInput;
let searchResults;
let restoreBtn;
let snapshotAgeEl;
let restoreHintEl;
let editingWorkspaceId = null;
let selectedColor = COLOR_PRESETS[0];
let currentSettings = null;
document.addEventListener("DOMContentLoaded", () => {
    wsNameInput = document.getElementById("wsName");
    iconSelect = document.getElementById("iconSelect");
    colorPresetsContainer = document.getElementById("colorPresets");
    wsList = document.getElementById("wsList");
    submitBtn = document.getElementById("addWs");
    formErrorEl = document.getElementById("formError");
    settingsBtn = document.getElementById("settingsBtn");
    settingsPanel = document.getElementById("settingsPanel");
    searchSection = document.getElementById("searchSection");
    searchInput = document.getElementById("searchInput");
    searchResults = document.getElementById("searchResults");
    restoreBtn = document.getElementById("restoreBtn");
    snapshotAgeEl = document.getElementById("snapshotAge");
    restoreHintEl = document.getElementById("restoreHint");
    void init();
});
async function init() {
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
async function sendMessage(message) {
    const resp = (await chrome.runtime.sendMessage(message));
    if (!resp?.ok) {
        throw new Error(resp?.error ?? "Unknown error");
    }
    return resp.data;
}
// ---------- form ----------
function setupColorPresets() {
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
function setupIconSelect() {
    iconSelect.innerHTML = "";
    ICON_PRESETS.forEach((icon) => {
        const option = document.createElement("option");
        option.value = icon;
        option.textContent = icon;
        iconSelect.appendChild(option);
    });
}
function clearFormError() {
    formErrorEl.textContent = "";
}
function setFormError(message) {
    formErrorEl.textContent = message;
}
function normalizedWorkspaceName(name) {
    return name.trim().toLocaleLowerCase();
}
function isDuplicateWorkspaceDisplayKey(workspaces, name, icon, ignoreWorkspaceId = null) {
    const normalizedName = normalizedWorkspaceName(name);
    return workspaces.some((workspace) => {
        if (ignoreWorkspaceId && workspace.id === ignoreWorkspaceId)
            return false;
        return (normalizedWorkspaceName(workspace.name) === normalizedName &&
            workspace.icon === icon);
    });
}
function setFormModeCreate() {
    editingWorkspaceId = null;
    submitBtn.textContent = "Create";
    submitBtn.title = "Create new workspace";
    clearFormError();
}
function setFormModeEdit(workspace) {
    editingWorkspaceId = workspace.id;
    submitBtn.textContent = "Save";
    submitBtn.title = "Save changes to workspace";
    clearFormError();
    wsNameInput.value = workspace.name;
    selectedColor = workspace.color;
    setupColorPresets();
    const iconOption = Array.from(iconSelect.options).find((opt) => opt.value === workspace.icon);
    if (iconOption) {
        iconSelect.value = workspace.icon;
    }
}
function resetForm() {
    wsNameInput.value = "";
    selectedColor = COLOR_PRESETS[0];
    iconSelect.value = ICON_PRESETS[0];
    setFormModeCreate();
    setupColorPresets();
}
function setupSubmitButton() {
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
async function onSubmitWorkspace() {
    if (editingWorkspaceId) {
        await onSaveWorkspaceEdit();
    }
    else {
        await onAddWorkspace();
    }
}
async function onAddWorkspace() {
    const name = wsNameInput.value.trim();
    if (!name)
        return;
    const icon = iconSelect.value || ICON_PRESETS[0];
    const state = await getState();
    if (isDuplicateWorkspaceDisplayKey(state.workspaces, name, icon)) {
        setFormError("Workspace with the same icon and name already exists.");
        return;
    }
    const workspace = {
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
async function onSaveWorkspaceEdit() {
    if (!editingWorkspaceId)
        return;
    const name = wsNameInput.value.trim();
    if (!name)
        return;
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
    const updated = { ...state.workspaces[idx], name, color: selectedColor, icon };
    const updatedWorkspaces = [...state.workspaces];
    updatedWorkspaces[idx] = updated;
    await setState({ workspaces: updatedWorkspaces });
    await sendMessage({ type: "WORKSPACES_CHANGED", updatedWorkspaceId: updated.id });
    resetForm();
    await renderWorkspaces();
}
// ---------- workspace list ----------
async function renderWorkspaces() {
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
    let statsById = new Map();
    if (state.settings.memoryIndicatorEnabled) {
        try {
            const stats = await sendMessage({ type: "GET_WORKSPACE_STATS" });
            statsById = new Map(stats.map((s) => [s.workspaceId, s]));
        }
        catch {
            // indicator is best-effort
        }
    }
    workspaces.forEach((ws) => {
        const item = document.createElement("div");
        item.className = "ws-item";
        if (ws.id === activeWorkspaceId)
            item.classList.add("active");
        if (ws.id === editingWorkspaceId)
            item.classList.add("editing");
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
async function onUseWorkspace(workspaceId) {
    try {
        await sendMessage({ type: "ACTIVATE_WORKSPACE", workspaceId });
    }
    catch (err) {
        setFormError(String(err));
    }
    await renderWorkspaces();
}
async function onDeleteWorkspace(workspaceId) {
    if (editingWorkspaceId === workspaceId) {
        resetForm();
    }
    try {
        await sendMessage({ type: "UNGROUP_WORKSPACE_TABS", workspaceId });
    }
    catch (err) {
        setFormError(String(err));
    }
    const state = await getState();
    const filtered = state.workspaces.filter((w) => w.id !== workspaceId);
    let nextActive = state.activeWorkspaceId;
    if (workspaceId === state.activeWorkspaceId) {
        nextActive = filtered.length ? filtered[0].id : null;
    }
    await setState({ workspaces: filtered, activeWorkspaceId: nextActive });
    await sendMessage({ type: "WORKSPACES_CHANGED" });
    await renderWorkspaces();
}
// ---------- settings panel ----------
function setupSettingsPanel() {
    settingsBtn.addEventListener("click", () => {
        settingsPanel.classList.toggle("hidden");
    });
    bindCheckbox("setSuspendEnabled", "suspendEnabled");
    bindCheckbox("setShortcutsEnabled", "shortcutsEnabled");
    bindCheckbox("setContextMenuEnabled", "contextMenuEnabled");
    bindCheckbox("setSearchEnabled", "searchEnabled");
    bindCheckbox("setMemoryIndicatorEnabled", "memoryIndicatorEnabled");
    const delayInput = document.getElementById("setSuspendDelay");
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
            }
            catch (err) {
                setFormError(String(err));
            }
            restoreBtn.textContent = "Restore from backup";
            restoreBtn.disabled = false;
            await renderWorkspaces();
            await updateSnapshotInfo();
        })();
    });
}
function bindCheckbox(elementId, key) {
    const checkbox = document.getElementById(elementId);
    if (currentSettings) {
        checkbox.checked = currentSettings[key];
    }
    checkbox.addEventListener("change", () => {
        void saveSettings({ [key]: checkbox.checked });
    });
}
async function saveSettings(patch) {
    if (!currentSettings)
        return;
    currentSettings = { ...currentSettings, ...patch };
    await setState({ settings: currentSettings });
    applyFeatureVisibility();
    if ("contextMenuEnabled" in patch) {
        try {
            await sendMessage({ type: "WORKSPACES_CHANGED" });
        }
        catch {
            // menu rebuild is best-effort
        }
    }
    if ("memoryIndicatorEnabled" in patch) {
        await renderWorkspaces();
    }
}
function applyFeatureVisibility() {
    if (!currentSettings)
        return;
    searchSection.classList.toggle("hidden", !currentSettings.searchEnabled);
}
// ---------- tab search ----------
function setupSearch() {
    searchInput.addEventListener("input", () => {
        void runSearch();
    });
}
async function runSearch() {
    const query = searchInput.value.trim().toLowerCase();
    searchResults.innerHTML = "";
    if (query.length < 2)
        return;
    const tabs = await chrome.tabs.query({ currentWindow: true });
    const matches = tabs
        .filter((t) => (t.title ?? "").toLowerCase().includes(query) ||
        (t.url ?? "").toLowerCase().includes(query))
        .slice(0, 8);
    for (const tab of matches) {
        if (tab.id == null)
            continue;
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
                }
                catch {
                    // tab may have closed
                }
                window.close();
            })();
        });
        searchResults.appendChild(row);
    }
}
// ---------- snapshot info + restore hint ----------
function formatAge(savedAt) {
    const minutes = Math.floor((Date.now() - savedAt) / 60_000);
    if (minutes < 1)
        return "just now";
    if (minutes < 60)
        return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24)
        return `${hours} h ago`;
    return `${Math.floor(hours / 24)} d ago`;
}
async function updateSnapshotInfo() {
    try {
        const info = await sendMessage({ type: "GET_SNAPSHOT_INFO" });
        if (info) {
            snapshotAgeEl.textContent = `backup from ${formatAge(info.savedAt)} · ${info.tabCount} tabs`;
            restoreBtn.disabled = false;
        }
        else {
            snapshotAgeEl.textContent = "no backup yet";
            restoreBtn.disabled = true;
        }
    }
    catch {
        snapshotAgeEl.textContent = "";
    }
}
async function maybeShowRestoreHint() {
    try {
        const info = await sendMessage({ type: "GET_SNAPSHOT_INFO" });
        if (!info || info.tabCount < 3)
            return;
        const tabs = await chrome.tabs.query({ currentWindow: true });
        const realTabs = tabs.filter((t) => {
            const url = t.url ?? t.pendingUrl ?? "";
            return (url &&
                !url.startsWith("chrome://") &&
                !url.startsWith("brave://") &&
                !url.startsWith("chrome-extension://"));
        });
        if (realTabs.length <= 1) {
            restoreHintEl.textContent =
                `Your session looks empty but a backup with ${info.tabCount} tabs exists. ` +
                    `Open ⚙️ Settings → "Restore from backup". Tip: enable "Continue where you ` +
                    `left off" in Brave settings so tabs survive restarts.`;
            restoreHintEl.classList.remove("hidden");
        }
    }
    catch {
        // hint is best-effort
    }
}
