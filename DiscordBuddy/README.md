# DiscordBuddy — Discord Rich Presence for After Effects

A small dockable panel that puts what you're animating on your Discord profile, like the VS Code and game integrations:

> **Playing Adobe After Effects**
> Editing my-project.aep
> Comp: Main · 12:34 elapsed

It refreshes every ~15 s as you switch projects and comps, shows session elapsed time, and clears itself when you stop it or quit AE.

## Install

1. Copy `DiscordBuddy.jsx` into the ScriptUI Panels folder:
   - **macOS:** `/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/`
   - **Windows:** `C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\`
2. Restart After Effects.
3. Open **Window → DiscordBuddy.jsx** (bottom of the Window menu) and dock it anywhere.

## One-time setup (~2 minutes)

Discord shows the *name of a Discord application* as the "Playing …" line, so you create one — free, no bot, no code:

1. Go to [discord.com/developers/applications](https://discord.com/developers/applications) → **New Application** → name it exactly `Adobe After Effects` (that name is what appears after "Playing").
2. On **General Information**, copy the **Application ID**.
3. *(Optional, adds the AE icon to your status)*: under **Rich Presence → Art Assets**, upload a 512×512 After Effects icon with the key name `aftereffects`.
4. Install [Node.js](https://nodejs.org) if you don't have it — the connector runs as a tiny background Node script, because AE scripts can't talk to Discord's local socket directly.
5. In After Effects: **Preferences → Scripting & Expressions → ✓ Allow Scripts to Write Files and Access Network**.

## Use

1. Paste your Application ID into the **App ID** field (remembered between sessions).
2. With the Discord **desktop** app running, press **Start**. Your status appears within a few seconds; the panel's status line shows exactly what's being broadcast.
3. **Hide project name** broadcasts *"Working on a secret project"* instead of your file and comp names — for client work.
4. **Stop** clears your status. Quitting AE clears it automatically too: the connector notices the heartbeat stopped and shuts itself down.

## How the connection works

Discord Rich Presence lives on a local IPC socket (a Unix domain socket on macOS, a named pipe on Windows), and ExtendScript can't open those — its `Socket` object is TCP-only. So the panel:

1. extracts a small zero-dependency Node script to `~/Library/Application Support/DiscordBuddy/` (Windows: `%APPDATA%\DiscordBuddy\`) and launches it in the background;
2. writes what you're working on to `state.json` there every 15 seconds;
3. the helper speaks Discord's IPC protocol directly, mirrors that file into your status, and exits on Stop or when the heartbeat goes stale.

Nothing leaves your machine except to your local Discord app.

## Troubleshooting

- Press **Log** — the connector writes everything it does (connection attempts, Discord errors) to `helper.log`.
- No status showing? The **desktop** Discord app must be running (browser Discord has no local socket), and Discord **Settings → Activity Privacy → Share your detected activities with others** must be on.
- `Invalid Client ID` in the log: re-copy the Application ID from the developer portal.
- "Node.js not found": install it from [nodejs.org](https://nodejs.org), then press Start again.

## Uninstall

Press **Stop**, delete `DiscordBuddy.jsx` from the ScriptUI Panels folder, delete the `DiscordBuddy` folder from Application Support (macOS) / `%APPDATA%` (Windows), and restart After Effects.
