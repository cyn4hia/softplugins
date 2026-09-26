/**********************************************************************
 DiscordBuddy.jsx  \u2014  Discord Rich Presence for After Effects
 v1.5   Shows "Playing Adobe After Effects" with your current .aep
        on your Discord profile, like the VS Code and game
        integrations. The Discord application is built in \u2014 no App ID
        to create or paste, just press Start. (v1.5: split into
        modules under DiscordBuddy_lib/; behavior unchanged.)

 Install (After Effects 2026): copy DiscordBuddy.jsx AND the
 DiscordBuddy_lib folder, side by side, into
   macOS:   /Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/
   Windows: C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\
 Restart After Effects, then open it from the bottom of the Window
 menu and dock it anywhere.

 Needs: the Discord desktop app, Node.js, and Preferences >
 Scripting & Expressions > "Allow Scripts to Write Files and Access
 Network". See the README for the 1-minute setup.

 How it connects: AE scripts can't reach Discord's local IPC socket
 (a Unix domain socket / named pipe; ExtendScript's Socket object is
 TCP-only), so on Start this panel copies a zero-dependency Node
 helper (DiscordBuddy_lib/discord-presence.js) into the DiscordBuddy
 support folder and launches it in the background. The panel
 heartbeats project info into state.json every 15s; the helper
 mirrors it to Discord and exits on Stop or when the heartbeat goes
 stale (AE quit or crashed), so your status never gets stuck.

 Layout:
   DiscordBuddy.jsx           entry point: App ID, panel, status line
   DiscordBuddy_lib/
     util.jsxinc              platform, settings, file helpers
     presence.jsxinc          start/stop, heartbeat, helper process
     ui.jsxinc                theme, custom-drawn buttons, header
     discord-presence.js      the Node helper (runs outside AE)
 Modules use .jsxinc so AE doesn't list them in the Window menu.
**********************************************************************/

(function discordBuddy(thisObj) {

    var SCRIPT_NAME = "DiscordBuddy";

    // The shared Discord application everyone broadcasts through — its
    // name is the "Playing ..." line and its art assets are the icon.
    // Application IDs are public by design: Rich Presence over the local
    // socket uses no secret and no login, so shipping this costs nothing.
    // To use your own application instead, replace this with your
    // Application ID from discord.com/developers/applications.
    var CLIENT_ID = "1549167859400441966";

    // Folder holding the modules and the Node helper, next to this file
    var LIB_DIR = (new File($.fileName)).parent.fsName + "/DiscordBuddy_lib";

    // ------------------------------------------------------------------
    // Status line (set once the UI exists; replaces modal alerts)
    // ------------------------------------------------------------------

    var statusFn = null;

    function setStatus(msg) {
        if (statusFn !== null) statusFn(msg);
    }

    // ------------------------------------------------------------------
    // Modules \u2014 spliced in at load time, so they share this closure
    // and nothing leaks into AE's global scope.
    // ------------------------------------------------------------------

//@include "DiscordBuddy_lib/util.jsxinc"
//@include "DiscordBuddy_lib/presence.jsxinc"
//@include "DiscordBuddy_lib/ui.jsxinc"

    // ------------------------------------------------------------------
    // Panel
    // ------------------------------------------------------------------

    function buildUI(host) {
        var pal = (host instanceof Panel) ? host : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });

        pal.orientation = "column";
        pal.alignChildren = ["fill", "top"];
        pal.spacing = 6;
        pal.margins = 10;
        paintBG(pal, COL.panelBg);

        addHeader(pal);

        var intro = pal.add("statictext", undefined,
            'Show "Playing Adobe After Effects"\n+ your .aep on your Discord profile.', { multiline: true });
        intro.alignment = ["fill", "top"];
        try { intro.graphics.font = ScriptUI.newFont(intro.graphics.font.name, ScriptUI.FontStyle.ITALIC, 9); } catch (eF1) {}
        tintText(intro, COL.muted);

        var privChk = pal.add("checkbox", undefined, "Hide project name");
        privChk.helpTip = "Broadcasts \"Working on a secret project\" instead of the .aep name.";
        tintText(privChk, COL.text);
        privChk.value = loadSetting("privacy", "0") === "1";
        PRESENCE.privacy = privChk.value;
        privChk.onClick = function () {
            PRESENCE.privacy = privChk.value;
            saveSetting("privacy", privChk.value ? "1" : "0");
            if (PRESENCE.running) writeState(false);
        };

        var r2 = pal.add("group");
        r2.orientation = "row";
        r2.alignChildren = ["fill", "center"];
        r2.alignment = ["fill", "top"];
        r2.spacing = 4;

        btn(r2, "Start", "Starts broadcasting to Discord. Needs the Discord desktop app running and Node.js installed \u2014 see the README for the 1-minute setup.",
            startPresence);
        btn(r2, "Stop", "Stops broadcasting and clears your Discord status.", stopPresence);
        btn(r2, "Log", "Opens the connector log \u2014 check it if nothing shows up in Discord.", function () {
            var dir = supportDir();
            var lf = (dir === null) ? null : new File(dir.fsName + "/helper.log");
            if (lf !== null && lf.exists) lf.execute();
            else setStatus("No log yet \u2014 press Start first.");
        });

        var statusText = pal.add("statictext", undefined, "Presence off.");
        statusText.alignment = ["fill", "top"];
        try { statusText.graphics.font = ScriptUI.newFont(statusText.graphics.font.name, ScriptUI.FontStyle.ITALIC, 9); } catch (eF2) {}
        tintText(statusText, COL.muted);
        statusFn = function (msg) {
            statusText.text = msg;
            statusText.helpTip = msg;
        };

        pal.layout.layout(true);
        pal.layout.resize();
        pal.onResizing = pal.onResize = function () {
            this.layout.resize();
        };

        if (pal instanceof Window) {
            pal.center();
            pal.show();
        }
        return pal;
    }

    buildUI(thisObj);

})(this);
