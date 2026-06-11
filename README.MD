# Brave Workspaces

Opera-like workspaces for Brave/Chrome, built on tab groups, with automatic
memory suspension for inactive workspaces.

## Features

- Workspaces with name, color, and icon — each is a tab group in your main window
- Switching collapses other workspaces and focuses your last-used tab
- New tabs join the active workspace; tabs opened from a page follow their opener
- Inactive workspaces are suspended after a delay (default 10 min): tabs are
  discarded to free memory, but audible tabs (music/video), pinned tabs, and
  opted-out tabs keep running. Discarded tabs reload instantly when clicked.
- Keyboard shortcuts: Ctrl+Shift+1..4 to switch workspaces (remap at
  brave://extensions/shortcuts)
- Right-click a page → "Move tab to workspace"
- Search tabs across all workspaces from the popup
- Memory indicator: see how many tabs per workspace are sleeping
- Session backup: a snapshot is saved continuously; restore it manually from
  ⚙️ Settings if a session is ever lost. The extension never deletes or
  restores tabs automatically — enable Brave's "Continue where you left off"
  for normal restarts.

All features can be toggled in the popup's ⚙️ Settings panel.

## Build

```
npm install
npx tsc          # or: npx tsc --watch
```

## Install

1. Build (above)
2. Open brave://extensions, enable Developer mode
3. "Load unpacked" → select this folder
```