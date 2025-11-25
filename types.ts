export interface Workspace {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export interface ExtensionState {
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
}
