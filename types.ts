export interface Workspace {
  id: string;
  name: string;
  color: string; // hex or CSS color
  icon: string;  // emoji / short icon id
}

export interface ExtensionState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null; // last used workspace
}
