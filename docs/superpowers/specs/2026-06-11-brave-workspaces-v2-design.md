# Brave Workspaces v2 — Design

**Date:** 2026-06-11
**Status:** Approved

## Goal

Make the extension reliably mimic Opera workspaces in Brave/Chrome, reduce memory
consumption of inactive workspaces, and add quality-of-life features. Remove all
code paths that are broken or built on fragile foundations.

## Constraints

- Chrome/Brave extensions have no `tabs.hide()` API. Workspaces are implemented as
  tab groups; inactive workspaces are collapsed groups.
- Manifest V3 service worker: no `setInterval` for long-lived timers; use
  `chrome.alarms`.
- Toolchain stays plain `tsc` (no bundler).

## Decisions (agreed with user)

| Topic | Decision |
|---|---|
| Core mechanism | Tab groups + `chrome.tabs.discard()` for inactive workspaces |
| Audible tabs | Never discarded (background YouTube/music keeps playing) |
| Discard timing | After a configurable inactivity delay (default 10 min) |
| Browser restart | Rely on Brave native session restore; snapshot is a manual backup only |
| Windows | Single-window focus: operate in the last focused normal window, ignore others |
| QoL | Keyboard shortcuts, move-tab context menu, cross-workspace tab search, memory indicator — all individually toggleable in settings |

## Architecture

### Core model

- `Workspace = { id, name, color, icon }` persisted in `chrome.storage.local`,
  plus a `settings` object (see Settings below).
- Runtime mapping `workspaceId → groupId` lives in `chrome.storage.session`
  (survives service-worker restarts, dies with the browser — same lifetime as
  group IDs). All workspace/group lookups go through this mapping.
- On browser startup, groups restored by Brave's session restore are re-linked
  to workspaces **once by group title** (`icon + name`), then tracked by ID.
  Title matching exists only in this one startup re-link step.
- Single-window focus: the extension operates in the last focused normal
  window. Tabs/groups in other windows are never touched.
- Switching workspace: expand its group, activate its last-active tab, collapse
  other workspace-owned groups, update `activeWorkspaceId`.
- New tabs auto-join the active workspace; a tab opened from another tab
  (opener) joins the opener's workspace instead. Pinned tabs, internal pages
  (`chrome://`, `brave://`, etc.), and already-grouped tabs are never moved.
- Non-workspace groups (created manually by the user) are left alone:
  collapse/discard/ungroup logic only ever targets groups present in the
  `workspaceId → groupId` mapping.

### Memory suspension

- When a workspace becomes inactive, schedule a `chrome.alarms` alarm named
  `suspend:<workspaceId>` for `settings.suspendDelayMinutes` (default 10).
- On fire, discard every tab in that workspace's group via
  `chrome.tabs.discard()` **except**:
  - audible tabs (`tab.audible === true`)
  - pinned tabs
  - tabs with `autoDiscardable === false`
  - tabs already discarded
- The group's last-active tab is discarded last (kept in metadata) so the tab
  the user returns to is the most recently freed.
- Activating a workspace cancels its pending alarm.
- Discarded tabs reload on click; URL, history, and scroll survive (native
  Chrome discard behavior).

### Session safety net (manual backup)

- Background saves lightweight snapshots: debounced (~1 s) on tab/group events
  plus a `chrome.alarms` heartbeat (every 5 min). Snapshot format (V2-style,
  single window): list of `{ url, pinned, workspaceId, active }`.
- **No automatic restore — ever.** The popup offers "Restore from backup"
  showing snapshot age (e.g. "from 2 hours ago"); clicking it recreates tabs
  and groups in the current window without deleting existing tabs first
  (restored tabs are appended; user cleans up duplicates if any).
- Heuristic hint: if startup finds a lone new-tab page while a rich snapshot
  exists, the popup shows a non-blocking hint suggesting the restore button and
  enabling Brave's "continue where you left off".

### QoL features (each behind a settings toggle)

1. **Keyboard shortcuts** — `chrome.commands`: `switch-workspace-1..4`
   (suggested `Ctrl+Shift+1..4`) and `next-workspace` cycle. Remappable at
   `brave://extensions/shortcuts`. Toggle = commands ignored when disabled
   (commands themselves can't be unregistered).
2. **Context menu** — right-click page → "Move tab to workspace → [list]".
   Menu rebuilt on workspace create/edit/delete and on toggle.
3. **Tab search** — input at top of popup; filters tabs across all workspaces
   by title/URL; selecting a result activates the tab and switches workspace
   if needed.
4. **Memory indicator** — per-workspace line in the popup: `N tabs · M sleeping`.

### Settings

Stored in `chrome.storage.local` under `settings`:

```ts
interface Settings {
  suspendEnabled: boolean;      // default true
  suspendDelayMinutes: number;  // default 10
  shortcutsEnabled: boolean;    // default true
  contextMenuEnabled: boolean;  // default true
  searchEnabled: boolean;       // default true
  memoryIndicatorEnabled: boolean; // default true
}
```

Settings panel: gear icon in the popup toggles a settings section containing
the toggles, the delay input, and the Restore-from-backup button.

## Module layout

| File | Responsibility |
|---|---|
| `types.ts` | Shared interfaces (Workspace, Settings, Snapshot, messages) |
| `storage.ts` | Typed get/set for local + session storage (drop sync→local migration) |
| `chrome-api.ts` | Promisified Chrome API wrappers with error logging |
| `workspaces.ts` | Group mapping, switch/assign/ungroup logic, startup re-link |
| `suspend.ts` | Alarm scheduling + discard logic |
| `snapshot.ts` | Snapshot capture + manual restore |
| `features.ts` | Commands, context menu wiring (respecting toggles) |
| `background.ts` | Thin entry: event listener registration + message routing |
| `popup.ts` / `popup.html` / `popup.css` | UI: list, create/edit form, search, settings panel |

## Deletions (broken / obsolete code removed entirely)

- Destructive automatic startup restore (`restoreWorkspaceSessionFromSnapshot`
  auto-run, window reconciliation that closes windows, tab wiping).
- `setInterval` heartbeat and `onSuspend` save (replaced by `chrome.alarms`).
- Snapshot V1 format + V1→V2 conversion.
- `chrome.storage.sync` → `local` migration.
- Title-based group lookup as the primary mechanism (kept only in startup
  re-link).
- Multi-window snapshot/restore logic (single-window focus).
- Auto-assign pause timers tied to the removed startup restore.

## Error handling

- Promisified wrappers log failures with operation context (`console.warn`
  with operation name + args) instead of silently resolving null in critical
  paths; callers still receive null and degrade gracefully.
- Message handlers respond `{ ok: false, error }` and the popup surfaces the
  error text in its existing error element.

## Testing

- `npx tsc --noEmit` must pass (gate for every change).
- Manual test checklist (extension behavior is not meaningfully unit-testable):
  1. Create / edit / delete workspaces; duplicate name+icon rejected.
  2. Switch via popup, shortcut, and tab-strip click — active workspace tracks.
  3. New tab joins active workspace; tab opened from a grouped tab follows opener.
  4. Wait past suspend delay → inactive workspace tabs discarded, audible tab
     keeps playing, pinned tab untouched; clicking a discarded tab reloads it.
  5. Restart browser with native restore ON → groups re-link, no tabs lost.
  6. "Restore from backup" recreates tabs/groups, appends without deleting.
  7. Context menu moves a tab between workspaces.
  8. Search finds and jumps to a tab in another workspace.
  9. Each settings toggle enables/disables its feature.
