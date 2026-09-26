# BuddyHub — home panel for the Buddy plugins

A small dockable launcher that lists every Buddy plugin installed on your machine, each with its own icon and description. Click a buddy to open its panel (click again to close it). It's the "home page" for the family:

- **GraphBuddy** — ease-curve icon, one-click graph editor eases
- **DiscordBuddy** — blob icon, Discord Rich Presence
- any future buddy — appears automatically with a letter badge

## Install

1. Copy `BuddyHub.jsx` **and** the `BuddyHub_lib` folder, side by side, into the ScriptUI Panels folder — the **same folder as the buddies**:
   - **macOS:** `/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/`
   - **Windows:** `C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\`
2. Restart After Effects.
3. Open **Window → BuddyHub.jsx** and dock it anywhere.

## How it works

- **Discovery:** the hub scans its own folder for files ending in `Buddy.jsx`. Anything it finds becomes a row — no registration needed. Installed a new buddy while AE is running? Press **Rescan**.
- **Opening:** a buddy installed in ScriptUI Panels has an entry at the bottom of the Window menu, and the hub triggers exactly that — so you get the *real dockable panel*, identical to opening it from the menu. Clicking the row again closes it. If a buddy somehow has no menu entry, the hub falls back to launching it as a floating window.
- **Icons:** drawn in code (no image files to install). Known buddies get their signature icon; unknown ones get a letter badge in the same purple theme.

## Uninstall

Delete `BuddyHub.jsx` and the `BuddyHub_lib` folder from the ScriptUI Panels folder and restart After Effects. The buddies themselves are unaffected — the hub is just a launcher.
