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
    "💼",
    "🎮",
    "📚",
    "🧠",
    "🎧",
    "🕹️",
    "💻",
    "📺",
    "📨",
    "📈",
    "📊",
    "📝",
    "🧪",
    "⚙️",
    "🛠️",
    "🏠",
    "🏢",
    "🏫",
    "🏥",
    "✈️",
    "🚗",
    "🚀",
    "🌍",
    "📷",
    "🎬",
    "🎵",
    "💬",
    "🔐",
    "🔍",
    "🧾",
    "💡",
    "🔥",
    "🌙",
    "☀️",
    "🌈",
    "🧑‍💻",
    "🧑‍🎓",
    "🧑‍🍳",
    "🧑‍🏫",
    "🧑‍🔬",
    "🐱",
    "🐶",
    "🐉",
    "🌲",
    "⚡",
    "🏋️",
    "⚽",
    "🏎️",
    "♟️",
    "🎲"
];
let wsNameInput;
let iconSelect;
let colorPresetsContainer;
let wsList;
let submitBtn;
let formErrorEl;
let editingWorkspaceId = null;
let selectedColor = COLOR_PRESETS[0];
document.addEventListener("DOMContentLoaded", () => {
    wsNameInput = document.getElementById("wsName");
    iconSelect = document.getElementById("iconSelect");
    colorPresetsContainer = document.getElementById("colorPresets");
    wsList = document.getElementById("wsList");
    submitBtn = document.getElementById("addWs");
    formErrorEl = document.getElementById("formError");
    setupColorPresets();
    setupIconSelect();
    setupSubmitButton();
    void renderWorkspaces();
});
// ---------- UI setup ----------
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
            updateSelectedSwatch();
        });
        colorPresetsContainer.appendChild(swatch);
    });
}
function updateSelectedSwatch() {
    const children = Array.from(colorPresetsContainer.querySelectorAll(".color-swatch"));
    children.forEach((sw) => {
        const bg = sw.style.backgroundColor;
        sw.classList.remove("selected");
    });
    setupColorPresets();
}
function setupIconSelect() {
    iconSelect.innerHTML = "";
    ICON_PRESETS.forEach((icon, idx) => {
        const option = document.createElement("option");
        option.value = icon;
        option.textContent = `${icon}`;
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
    clearFormError();
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
    wsNameInput.addEventListener("input", () => {
        clearFormError();
    });
    iconSelect.addEventListener("change", () => {
        clearFormError();
    });
}
// ---------- background communication helpers ----------
async function activateWorkspace(workspaceId, moveCurrentTab) {
    await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: "ACTIVATE_WORKSPACE",
            workspaceId,
            moveCurrentTab
        }, (resp) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            }
            else if (!resp?.ok) {
                reject(resp?.error ?? "Unknown error");
            }
            else {
                resolve();
            }
        });
    });
}
async function ungroupWorkspaceTabs(workspaceId) {
    await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: "UNGROUP_WORKSPACE_TABS",
            workspaceId
        }, (resp) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            }
            else if (!resp?.ok) {
                reject(resp?.error ?? "Unknown error");
            }
            else {
                resolve();
            }
        });
    });
}
async function initWorkspaceGroup(workspaceId) {
    await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
            type: "INIT_WORKSPACE_GROUP",
            workspaceId
        }, (resp) => {
            if (chrome.runtime.lastError) {
                reject(chrome.runtime.lastError);
            }
            else if (!resp?.ok) {
                reject(resp?.error ?? "Unknown error");
            }
            else {
                resolve();
            }
        });
    });
}
// ---------- core actions ----------
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
    const color = selectedColor;
    const icon = iconSelect.value || ICON_PRESETS[0];
    const state = await getState();
    if (isDuplicateWorkspaceDisplayKey(state.workspaces, name, icon)) {
        setFormError("Workspace with the same icon and name already exists.");
        return;
    }
    const workspace = {
        id: `ws-${Date.now()}`,
        name,
        color,
        icon
    };
    const workspaces = [...state.workspaces, workspace];
    await setState({
        workspaces
    });
    await initWorkspaceGroup(workspace.id);
    resetForm();
    await renderWorkspaces();
}
async function onSaveWorkspaceEdit() {
    if (!editingWorkspaceId)
        return;
    const name = wsNameInput.value.trim();
    if (!name)
        return;
    const color = selectedColor;
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
    const oldWs = state.workspaces[idx];
    const updated = {
        ...oldWs,
        name,
        color,
        icon
    };
    const updatedWorkspaces = [...state.workspaces];
    updatedWorkspaces[idx] = updated;
    await setState({
        workspaces: updatedWorkspaces
    });
    await initWorkspaceGroup(updated.id);
    resetForm();
    await renderWorkspaces();
}
async function renderWorkspaces() {
    const state = await getState();
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
    workspaces.forEach((ws) => {
        const item = document.createElement("div");
        item.className = "ws-item";
        if (ws.id === activeWorkspaceId) {
            item.classList.add("active");
        }
        if (ws.id === editingWorkspaceId) {
            item.classList.add("editing");
        }
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
        // clicking the row = Use
        item.addEventListener("click", () => {
            void onUseWorkspace(ws.id);
        });
        wsList.appendChild(item);
    });
}
async function onUseWorkspace(workspaceId) {
    await activateWorkspace(workspaceId, false);
    await renderWorkspaces();
}
async function onDeleteWorkspace(workspaceId) {
    if (editingWorkspaceId === workspaceId) {
        resetForm();
    }
    await ungroupWorkspaceTabs(workspaceId);
    const state = await getState();
    const filtered = state.workspaces.filter((w) => w.id !== workspaceId);
    let nextActive = state.activeWorkspaceId;
    if (workspaceId === state.activeWorkspaceId) {
        nextActive = filtered.length ? filtered[0].id : null;
    }
    await setState({
        workspaces: filtered,
        activeWorkspaceId: nextActive
    });
    await renderWorkspaces();
}
