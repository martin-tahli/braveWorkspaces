// chrome.storage.sync
{
  workspaces: [
    { id: 'ws-main', name: 'Main', color: 'blue' },
    { id: 'ws-games', name: 'Games', color: 'red' }
  ];
  activeWorkspaceId: 'ws-main'
}
// Simple helper to promisify chrome.storage
function getState() {
  return new Promise((resolve) => {
    chrome.storage.sync.get(
      { workspaces: [], activeWorkspaceId: null },
      resolve
    );
  });
}

function setState(partial) {
  return new Promise(async (resolve) => {
    const current = await getState();
    chrome.storage.sync.set({ ...current, ...partial }, resolve);
  });
}

function randomColor() {
  const colors = [
    "grey",
    "blue",
    "red",
    "yellow",
    "green",
    "pink",
    "purple",
    "cyan",
    "orange"
  ];
  return colors[Math.floor(Math.random() * colors.length)];
}

async function ensureDefaultWorkspace() {
  const state = await getState();
  if (!state.workspaces.length) {
    const ws = { id: "ws-main", name: "Main", color: "blue" };
    await setState({ workspaces: [ws], activeWorkspaceId: ws.id });
    return { workspaces: [ws], activeWorkspaceId: ws.id };
  }
  return state;
}

// --- Tab group helpers ---

async function getWorkspaceGroup(workspace, windowId) {
  const title = `WS: ${workspace.name}`;
  const groups = await chrome.tabGroups.query({ windowId });
  const existing = groups.find((g) => g.title === title);
  return existing || null;
}

async function createWorkspaceGroup(workspace, windowId) {
  // group the active tab into a new group as a starting point
  const [tab] = await chrome.tabs.query({
    active: true,
    windowId
  });
  const groupId = await chrome.tabs.group({ tabIds: [tab.id], createProperties: { windowId } });
  const updated = await chrome.tabGroups.update(groupId, {
    title: `WS: ${workspace.name}`,
    color: workspace.color
  });
  return updated;
}

async function collapseOtherGroups(activeGroupId, windowId) {
  const groups = await chrome.tabGroups.query({ windowId });
  await Promise.all(
    groups.map((g) =>
      chrome.tabGroups.update(g.id, {
        collapsed: g.id === activeGroupId ? false : true
      })
    )
  );
}

// --- Actions ---

async function activateWorkspace(workspaceId) {
  const state = await getState();
  const workspace = state.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return;

  const win = await chrome.windows.getCurrent();
  let group = await getWorkspaceGroup(workspace, win.id);

  if (!group) {
    group = await createWorkspaceGroup(workspace, win.id);
  }

  await collapseOtherGroups(group.id, win.id);
  await setState({ activeWorkspaceId: workspaceId });
}

async function moveCurrentTabToWorkspace(workspaceId) {
  const state = await getState();
  const workspace = state.workspaces.find((w) => w.id === workspaceId);
  if (!workspace) return;

  const win = await chrome.windows.getCurrent();
  const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });

  let group = await getWorkspaceGroup(workspace, win.id);
  if (!group) {
    // Create group using this tab
    const groupId = await chrome.tabs.group({
      tabIds: [tab.id],
      createProperties: { windowId: win.id }
    });
    group = await chrome.tabGroups.update(groupId, {
      title: `WS: ${workspace.name}`,
      color: workspace.color
    });
  } else {
    // Add tab to existing group
    await chrome.tabs.group({
      groupId: group.id,
      tabIds: [tab.id]
    });
  }

  await collapseOtherGroups(group.id, win.id);
  await setState({ activeWorkspaceId: workspaceId });
}

// --- UI wiring ---

async function render() {
  const { workspaces, activeWorkspaceId } = await ensureDefaultWorkspace();
  const list = document.getElementById("wsList");
  list.innerHTML = "";

  workspaces.forEach((ws) => {
    const item = document.createElement("div");
    item.className = "ws-item" + (ws.id === activeWorkspaceId ? " active" : "");
    item.dataset.id = ws.id;

    const name = document.createElement("div");
    name.className = "ws-name";
    name.textContent = ws.name;

    const actions = document.createElement("div");
    actions.className = "ws-actions";

    const btnSwitch = document.createElement("button");
    btnSwitch.textContent = "Switch";
    btnSwitch.addEventListener("click", async (e) => {
      e.stopPropagation();
      await activateWorkspace(ws.id);
      await render();
    });

    const btnMove = document.createElement("button");
    btnMove.textContent = "Move tab";
    btnMove.addEventListener("click", async (e) => {
      e.stopPropagation();
      await moveCurrentTabToWorkspace(ws.id);
      await render();
    });

    const btnDelete = document.createElement("button");
    btnDelete.textContent = "✕";
    btnDelete.addEventListener("click", async (e) => {
      e.stopPropagation();
      const state = await getState();
      const filtered = state.workspaces.filter((w) => w.id !== ws.id);
      let newActive = state.activeWorkspaceId;
      if (ws.id === state.activeWorkspaceId && filtered.length) {
        newActive = filtered[0].id;
      }
      await setState({ workspaces: filtered, activeWorkspaceId: newActive });
      await render();
    });

    actions.appendChild(btnSwitch);
    actions.appendChild(btnMove);
    actions.appendChild(btnDelete);

    item.appendChild(name);
    item.appendChild(actions);
    list.appendChild(item);
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("addWs").addEventListener("click", async () => {
    const input = document.getElementById("newName");
    const name = input.value.trim();
    if (!name) return;
    const state = await getState();
    const ws = {
      id: "ws-" + Date.now(),
      name,
      color: randomColor()
    };
    await setState({
      workspaces: [...state.workspaces, ws],
      activeWorkspaceId: ws.id
    });
    input.value = "";
    await render();
  });

  await render();
});
