import type { Workspace } from "./types.js";
import { getState, setState } from "./storage.js";

// 20 premade colors
const COLOR_PRESETS: string[] = [
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
  "#42A5F5"
];

// ~50 emoji icons
const ICON_PRESETS: string[] = [
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

let wsNameInput: HTMLInputElement;
let colorPicker: HTMLInputElement;
let iconSelect: HTMLSelectElement;
let colorPresetsContainer: HTMLDivElement;
let wsList: HTMLDivElement;
let submitBtn: HTMLButtonElement;

// which workspace is currently being edited (null = create mode)
let editingWorkspaceId: string | null = null;

document.addEventListener("DOMContentLoaded", () => {
  wsNameInput = document.getElementById("wsName") as HTMLInputElement;
  colorPicker = document.getElementById("colorPicker") as HTMLInputElement;
  iconSelect = document.getElementById("iconSelect") as HTMLSelectElement;
  colorPresetsContainer = document.getElementById(
    "colorPresets"
  ) as HTMLDivElement;
  wsList = document.getElementById("wsList") as HTMLDivElement;
  submitBtn = document.getElementById("addWs") as HTMLButtonElement;

  setupColorPicker();
  setupIconSelect();
  setupSubmitButton();

  void renderWorkspaces();
});

// ---------- UI setup ----------

function setupColorPicker() {
  colorPicker.value = COLOR_PRESETS[0];

  colorPresetsContainer.innerHTML = "";
  COLOR_PRESETS.forEach((color) => {
    const swatch = document.createElement("div");
    swatch.className = "color-swatch";
    swatch.style.backgroundColor = color;
    swatch.addEventListener("click", () => {
      colorPicker.value = color;
    });
    colorPresetsContainer.appendChild(swatch);
  });
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

function setFormModeCreate() {
  editingWorkspaceId = null;
  submitBtn.textContent = "Create";
  submitBtn.title = "Create new workspace";
}

function setFormModeEdit(workspace: Workspace) {
  editingWorkspaceId = workspace.id;
  submitBtn.textContent = "Save";
  submitBtn.title = "Save changes to workspace";

  wsNameInput.value = workspace.name;
  colorPicker.value = workspace.color;

  // pick existing icon option if present, otherwise leave current
  const iconOption = Array.from(iconSelect.options).find(
    (opt) => opt.value === workspace.icon
  );
  if (iconOption) {
    iconSelect.value = workspace.icon;
  }
}

function resetForm() {
  wsNameInput.value = "";
  colorPicker.value = COLOR_PRESETS[0];
  iconSelect.value = ICON_PRESETS[0];
  setFormModeCreate();
}

function setupSubmitButton() {
  // default: Create mode
  setFormModeCreate();

  submitBtn.addEventListener("click", () => {
    void onSubmitWorkspace();
  });

  wsNameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      void onSubmitWorkspace();
    }
  });
}

// ---------- background communication helpers ----------

async function activateWorkspace(
  workspaceId: string,
  moveCurrentTab: boolean
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "ACTIVATE_WORKSPACE",
        workspaceId,
        moveCurrentTab
      },
      (resp) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else if (!resp?.ok) {
          reject(resp?.error ?? "Unknown error");
        } else {
          resolve();
        }
      }
    );
  });
}

async function ungroupWorkspaceTabs(workspaceId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "UNGROUP_WORKSPACE_TABS",
        workspaceId
      },
      (resp) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else if (!resp?.ok) {
          reject(resp?.error ?? "Unknown error");
        } else {
          resolve();
        }
      }
    );
  });
}

// tell background to (re)create group for this workspace (for name/color sync)
async function initWorkspaceGroup(workspaceId: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "INIT_WORKSPACE_GROUP",
        workspaceId
      },
      (resp) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else if (!resp?.ok) {
          reject(resp?.error ?? "Unknown error");
        } else {
          resolve();
        }
      }
    );
  });
}

// ---------- core actions ----------

async function onSubmitWorkspace() {
  if (editingWorkspaceId) {
    await onSaveWorkspaceEdit();
  } else {
    await onAddWorkspace();
  }
}

async function onAddWorkspace() {
  const name = wsNameInput.value.trim();
  if (!name) return;

  const color = colorPicker.value || COLOR_PRESETS[0];
  const icon = iconSelect.value || ICON_PRESETS[0];

  const state = await getState();
  const workspace: Workspace = {
    id: `ws-${Date.now()}`,
    name,
    color,
    icon
  };

  const workspaces = [...state.workspaces, workspace];

  // Creating a workspace shouldn't change the active one or move tabs
  await setState({
    workspaces
  });

  // Create underlying Chrome tab group so native "Add tab to group" sees it
  await initWorkspaceGroup(workspace.id);

  resetForm();
  await renderWorkspaces();
}

async function onSaveWorkspaceEdit() {
  if (!editingWorkspaceId) return;

  const name = wsNameInput.value.trim();
  if (!name) return;

  const color = colorPicker.value || COLOR_PRESETS[0];
  const icon = iconSelect.value || ICON_PRESETS[0];

  const state = await getState();
  const idx = state.workspaces.findIndex((w) => w.id === editingWorkspaceId);
  if (idx === -1) {
    // workspace disappeared (deleted) -> reset to create
    resetForm();
    await renderWorkspaces();
    return;
  }

  const oldWs = state.workspaces[idx];
  const updated: Workspace = {
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

  // Update underlying group title + color
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
      void renderWorkspaces(); // highlight editing row
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

    // clicking row = same as Use
    item.addEventListener("click", () => {
      void onUseWorkspace(ws.id);
    });

    wsList.appendChild(item);
  });
}

async function onUseWorkspace(workspaceId: string) {
  // Choose workspace: become last-used + move current tab there
  await activateWorkspace(workspaceId, true);
  await renderWorkspaces();
}

async function onDeleteWorkspace(workspaceId: string) {
  // If we were editing this workspace, reset the form
  if (editingWorkspaceId === workspaceId) {
    resetForm();
  }

  // 1) Ungroup all tabs that belong to this workspace
  await ungroupWorkspaceTabs(workspaceId);

  // 2) Then update state
  const state = await getState();
  const filtered = state.workspaces.filter((w) => w.id !== workspaceId);

  let nextActive: string | null = state.activeWorkspaceId;
  if (workspaceId === state.activeWorkspaceId) {
    nextActive = filtered.length ? filtered[0].id : null;
  }

  await setState({
    workspaces: filtered,
    activeWorkspaceId: nextActive
  });

  await renderWorkspaces();
}
