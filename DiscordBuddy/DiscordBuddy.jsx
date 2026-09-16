/**********************************************************************
 DiscordBuddy.jsx  \u2014  Discord Rich Presence for After Effects
 v1.2   Shows "Playing Adobe After Effects" with your current .aep
        on your Discord profile, like the VS Code and game
        integrations. (v1.2: purple UI theme, matching GraphBuddy.)

 Install (After Effects 2026):
   macOS:   /Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/
   Windows: C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\
 Restart After Effects, then open it from the bottom of the Window
 menu and dock it anywhere.

 Needs: the Discord desktop app, Node.js, a free Discord Application
 ID, and Preferences > Scripting & Expressions > "Allow Scripts to
 Write Files and Access Network". See the README for the 2-minute
 setup.

 How it connects: AE scripts can't reach Discord's local IPC socket
 (a Unix domain socket / named pipe; ExtendScript's Socket object is
 TCP-only), so this panel extracts a zero-dependency Node helper into
 the DiscordBuddy support folder and launches it in the background.
 The panel heartbeats project info into state.json every 15s; the
 helper mirrors it to Discord and exits on Stop or when the heartbeat
 goes stale (AE quit or crashed), so your status never gets stuck.
**********************************************************************/

(function discordBuddy(thisObj) {

    var SCRIPT_NAME = "DiscordBuddy";

    // ------------------------------------------------------------------
    // Status line (set once the UI exists; replaces modal alerts)
    // ------------------------------------------------------------------

    var statusFn = null;

    function setStatus(msg) {
        if (statusFn !== null) statusFn(msg);
    }

    // ------------------------------------------------------------------
    // Small helpers
    // ------------------------------------------------------------------

    function isWin() {
        return $.os.indexOf("Windows") !== -1;
    }

    function loadSetting(key, def) {
        try {
            if (app.settings.haveSetting(SCRIPT_NAME, key)) return app.settings.getSetting(SCRIPT_NAME, key);
        } catch (e) {}
        return def;
    }

    function saveSetting(key, val) {
        try { app.settings.saveSetting(SCRIPT_NAME, key, String(val)); } catch (e) {}
    }

    // <userData>/DiscordBuddy \u2014 macOS: ~/Library/Application Support,
    // Windows: %APPDATA%. Holds the helper, config, state, pid, log.
    function supportDir() {
        try {
            var f = new Folder(Folder.userData.fsName + "/" + SCRIPT_NAME);
            if (!f.exists && !f.create()) return null;
            return f;
        } catch (e) { return null; }
    }

    function writeTextFile(file, text) {
        try {
            file.encoding = "UTF-8";
            file.lineFeed = "Unix";
            if (!file.open("w")) return false;
            var ok = file.write(text);
            file.close();
            return ok;
        } catch (e) {
            try { file.close(); } catch (e2) {}
            return false;
        }
    }

    function jsonEscape(s) {
        s = String(s);
        var out = "";
        for (var i = 0; i < s.length; i++) {
            var c = s.charAt(i);
            var code = s.charCodeAt(i);
            if (c === '"') out += '\\"';
            else if (c === "\\") out += "\\\\";
            else if (code < 32) out += "\\u" + ("000" + code.toString(16)).slice(-4);
            else out += c;
        }
        return out;
    }

    // ------------------------------------------------------------------
    // The Node helper, extracted to <userData>/DiscordBuddy/discord-presence.js.
    // Pure Node, no npm installs: it speaks Discord's IPC framing directly.
    // ------------------------------------------------------------------

    function helperSource() {
        return [
            "// DiscordBuddy Rich Presence helper (auto-extracted by DiscordBuddy.jsx).",
            "// Runs outside After Effects, mirrors state.json to the Discord desktop",
            "// client over its local IPC socket, and exits when the panel stops or",
            "// After Effects goes away. Zero dependencies.",
            "'use strict';",
            "var net = require('net');",
            "var fs = require('fs');",
            "var path = require('path');",
            "",
            "var DIR = __dirname;",
            "var STATE_FILE = path.join(DIR, 'state.json');",
            "var CONFIG_FILE = path.join(DIR, 'config.json');",
            "var PID_FILE = path.join(DIR, 'helper.pid');",
            "var LOG_FILE = path.join(DIR, 'helper.log');",
            "var STALE_SECS = 75; // no heartbeat from the panel for this long = AE is gone",
            "",
            "function log(msg) {",
            "  try {",
            "    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 200000) fs.unlinkSync(LOG_FILE);",
            "    fs.appendFileSync(LOG_FILE, new Date().toISOString() + '  ' + msg + '\\n');",
            "  } catch (e) {}",
            "}",
            "",
            "function readJSON(file) {",
            "  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return null; }",
            "}",
            "",
            "// single instance: if a previous helper is still alive, leave it to it",
            "try {",
            "  var oldPid = parseInt(fs.readFileSync(PID_FILE, 'utf8'), 10);",
            "  if (oldPid > 0) { process.kill(oldPid, 0); log('already running as pid ' + oldPid + ', exiting'); process.exit(0); }",
            "} catch (e0) {}",
            "try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch (e1) {}",
            "",
            "var config = readJSON(CONFIG_FILE) || {};",
            "if (!config.clientId) { log('no clientId in config.json, exiting'); process.exit(1); }",
            "",
            "// backslash built without literals: this file rides inside a .jsx string",
            "var BS = String.fromCharCode(92);",
            "function ipcCandidates() {",
            "  var out = [], i, d;",
            "  if (process.platform === 'win32') {",
            "    for (i = 0; i < 10; i++) out.push(BS + BS + '?' + BS + 'pipe' + BS + 'discord-ipc-' + i);",
            "  } else {",
            "    var dirs = [process.env.XDG_RUNTIME_DIR, process.env.TMPDIR, process.env.TMP, '/tmp'];",
            "    var seen = {};",
            "    for (d = 0; d < dirs.length; d++) {",
            "      if (!dirs[d] || seen[dirs[d]]) continue;",
            "      seen[dirs[d]] = true;",
            "      for (i = 0; i < 10; i++) out.push(path.join(dirs[d], 'discord-ipc-' + i));",
            "    }",
            "  }",
            "  return out;",
            "}",
            "",
            "// Discord IPC framing: little-endian int32 opcode, int32 length, JSON payload",
            "function frame(op, obj) {",
            "  var json = Buffer.from(JSON.stringify(obj), 'utf8');",
            "  var buf = Buffer.alloc(8 + json.length);",
            "  buf.writeInt32LE(op, 0);",
            "  buf.writeInt32LE(json.length, 4);",
            "  json.copy(buf, 8);",
            "  return buf;",
            "}",
            "",
            "var sock = null, ready = false, pending = Buffer.alloc(0), nonce = 0, lastSent = '';",
            "",
            "function connect(list, idx) {",
            "  if (idx >= list.length) {",
            "    log('Discord IPC socket not found (is the Discord desktop app running?), retrying in 15s');",
            "    setTimeout(function () { connect(ipcCandidates(), 0); }, 15000);",
            "    return;",
            "  }",
            "  var s = net.connect(list[idx]);",
            "  s.on('connect', function () {",
            "    sock = s;",
            "    pending = Buffer.alloc(0);",
            "    s.write(frame(0, { v: 1, client_id: String(config.clientId) })); // handshake",
            "  });",
            "  s.on('data', function (chunk) { onData(s, chunk); });",
            "  s.on('error', function () { if (sock !== s) connect(list, idx + 1); });",
            "  s.on('close', function () {",
            "    if (sock === s) {",
            "      sock = null; ready = false; lastSent = '';",
            "      log('connection closed, reconnecting in 15s');",
            "      setTimeout(function () { connect(ipcCandidates(), 0); }, 15000);",
            "    }",
            "  });",
            "}",
            "",
            "function onData(s, chunk) {",
            "  pending = Buffer.concat([pending, chunk]);",
            "  while (pending.length >= 8) {",
            "    var len = pending.readInt32LE(4);",
            "    if (pending.length < 8 + len) break;",
            "    var op = pending.readInt32LE(0);",
            "    var payload = pending.slice(8, 8 + len).toString('utf8');",
            "    pending = pending.slice(8 + len);",
            "    handle(s, op, payload);",
            "  }",
            "}",
            "",
            "function handle(s, op, payload) {",
            "  var msg = null;",
            "  try { msg = JSON.parse(payload); } catch (e) {}",
            "  if (op === 1 && msg && msg.evt === 'READY') {",
            "    ready = true;",
            "    log('connected to Discord as application ' + config.clientId);",
            "    tick(); // push the current state right away",
            "  } else if (op === 1 && msg && msg.evt === 'ERROR') {",
            "    log('Discord error: ' + payload);",
            "  } else if (op === 3) { // PING -> PONG",
            "    s.write(frame(4, msg || {}));",
            "  } else if (op === 2) { // CLOSE",
            "    log('Discord closed the connection: ' + payload);",
            "    s.end();",
            "  }",
            "}",
            "",
            "function setActivity(activity) {",
            "  if (!sock || !ready) return;",
            "  var key = JSON.stringify(activity);",
            "  if (key === lastSent) return; // only push real changes (Discord rate-limits)",
            "  lastSent = key;",
            "  nonce++;",
            "  sock.write(frame(1, { cmd: 'SET_ACTIVITY', args: { pid: process.pid, activity: activity }, nonce: String(nonce) }));",
            "}",
            "",
            "function activityFrom(state) {",
            "  var a = { details: state.details || 'Working in After Effects' };",
            "  if (state.state) a.state = state.state;",
            "  if (state.startTimestamp > 0) a.timestamps = { start: state.startTimestamp };",
            "  if (config.largeImageKey) {",
            "    a.assets = { large_image: config.largeImageKey };",
            "    if (config.largeImageText) a.assets.large_text = config.largeImageText;",
            "  }",
            "  return a;",
            "}",
            "",
            "function shutdown(reason) {",
            "  log('exiting: ' + reason);",
            "  try { setActivity(null); } catch (e) {}",
            "  try { fs.unlinkSync(PID_FILE); } catch (e2) {}",
            "  setTimeout(function () { process.exit(0); }, 500); // let the clear frame flush",
            "}",
            "",
            "function tick() {",
            "  var state = readJSON(STATE_FILE);",
            "  if (!state) return;",
            "  if (state.stop) { shutdown('panel pressed Stop'); return; }",
            "  var age = Date.now() / 1000 - (state.updatedAt || 0);",
            "  if (age > STALE_SECS) { shutdown('no heartbeat from After Effects for ' + Math.round(age) + 's'); return; }",
            "  setActivity(activityFrom(state));",
            "}",
            "",
            "process.on('SIGINT', function () { shutdown('SIGINT'); });",
            "process.on('SIGTERM', function () { shutdown('SIGTERM'); });",
            "",
            "log('helper started (pid ' + process.pid + ', node ' + process.version + ')');",
            "connect(ipcCandidates(), 0);",
            "setInterval(tick, 5000);"
        ].join("\n");
    }

    // ------------------------------------------------------------------
    // Presence engine (panel side)
    // ------------------------------------------------------------------

    var PRESENCE = {
        running: false,
        taskId: 0,
        startStamp: 0,
        privacy: false,
        lastDetails: ""
    };

    function configJSON(clientId) {
        return '{"clientId":"' + jsonEscape(clientId) + '",' +
               '"largeImageKey":"aftereffects",' +
               '"largeImageText":"Adobe After Effects"}';
    }

    // Heartbeat: what Discord should show right now. stopFlag = true
    // tells the helper to clear the presence and exit.
    function writeState(stopFlag) {
        var dir = supportDir();
        if (dir === null) return false;
        var projName = null;
        try { if (app.project.file !== null) projName = app.project.file.displayName; } catch (e) {}
        var details;
        if (PRESENCE.privacy) {
            details = "Working on a secret project";
        } else {
            details = (projName !== null) ? "Editing " + projName : "Editing an unsaved project";
        }
        PRESENCE.lastDetails = details;
        var now = Math.round((new Date()).getTime() / 1000);
        var json = '{"details":"' + jsonEscape(details) + '"' +
                   ',"startTimestamp":' + PRESENCE.startStamp +
                   ',"updatedAt":' + now +
                   ',"stop":' + (stopFlag ? "true" : "false") + '}';
        var ok = writeTextFile(new File(dir.fsName + "/state.json"), json);
        if (ok && PRESENCE.running && !stopFlag) {
            setStatus("\u25CF " + details);
        }
        return ok;
    }

    function findNode() {
        var out = "";
        var i;
        if (isWin()) {
            try { out = system.callSystem("cmd.exe /q /c where node"); } catch (e) {}
            var lines = String(out || "").split(/[\r\n]+/);
            for (i = 0; i < lines.length; i++) {
                var p = lines[i].replace(/^\s+|\s+$/g, "");
                if (p !== "" && File(p).exists) return p;
            }
            return null;
        }
        var candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];
        for (i = 0; i < candidates.length; i++) {
            if (File(candidates[i]).exists) return candidates[i];
        }
        // login shell so nvm/fnm installs are found too
        try { out = system.callSystem("/bin/zsh -lc 'command -v node'"); } catch (e2) {}
        out = String(out || "").replace(/^\s+|\s+$/g, "");
        if (out !== "" && File(out).exists) return out;
        return null;
    }

    // Kill a previous helper (Start after an App ID change needs a fresh
    // handshake). Only kills the recorded pid if it still looks like node,
    // in case the pid was recycled by another process.
    function killHelper() {
        var dir = supportDir();
        if (dir === null) return;
        var pf = new File(dir.fsName + "/helper.pid");
        if (!pf.exists) return;
        var pid = 0;
        try {
            if (pf.open("r")) { pid = parseInt(pf.read(), 10); pf.close(); }
        } catch (e) { pid = 0; }
        if (pid > 0 && !isNaN(pid)) {
            try {
                var chk = "";
                if (isWin()) {
                    chk = String(system.callSystem('cmd.exe /q /c tasklist /fi "PID eq ' + pid + '" /nh') || "");
                    if (chk.toLowerCase().indexOf("node") !== -1) {
                        system.callSystem("cmd.exe /q /c taskkill /pid " + pid + " /f");
                    }
                } else {
                    chk = String(system.callSystem("/bin/ps -p " + pid + " -o comm=") || "");
                    if (chk.indexOf("node") !== -1) {
                        system.callSystem("/bin/kill " + pid);
                    }
                }
            } catch (e2) {}
        }
        try { pf.remove(); } catch (e3) {}
    }

    function startPresence(clientIdRaw) {
        var clientId = String(clientIdRaw).replace(/^\s+|\s+$/g, "");
        if (!/^\d{15,25}$/.test(clientId)) {
            setStatus("Paste your numeric Application ID first (see README for the 2-minute setup).");
            return;
        }
        var dir = supportDir();
        var prefMsg = "Can't write files \u2014 enable Preferences > Scripting & Expressions > \"Allow Scripts to Write Files and Access Network\".";
        if (dir === null) { setStatus(prefMsg); return; }
        var helperFile = new File(dir.fsName + "/discord-presence.js");
        if (!writeTextFile(helperFile, helperSource()) ||
            !writeTextFile(new File(dir.fsName + "/config.json"), configJSON(clientId))) {
            setStatus(prefMsg);
            return;
        }
        killHelper();
        PRESENCE.startStamp = Math.round((new Date()).getTime() / 1000);
        if (!writeState(false)) { setStatus(prefMsg); return; }
        var nodePath = findNode();
        if (nodePath === null) {
            setStatus("Node.js not found \u2014 install it from nodejs.org, then press Start again.");
            return;
        }
        try {
            if (isWin()) {
                system.callSystem('cmd.exe /c start "" /b "' + nodePath + '" "' + helperFile.fsName + '"');
            } else {
                system.callSystem("/bin/bash -c 'nohup \"" + nodePath + "\" \"" + helperFile.fsName + "\" >/dev/null 2>&1 &'");
            }
        } catch (eLaunch) {
            setStatus("Couldn't launch the helper \u2014 " + eLaunch.toString());
            return;
        }
        if (PRESENCE.taskId === 0) {
            PRESENCE.taskId = app.scheduleTask("__discordBuddyTick()", 15000, true);
        }
        PRESENCE.running = true;
        setStatus("\u25CF " + PRESENCE.lastDetails);
    }

    function stopPresence() {
        if (PRESENCE.taskId !== 0) {
            try { app.cancelTask(PRESENCE.taskId); } catch (e) {}
            PRESENCE.taskId = 0;
        }
        if (PRESENCE.running) writeState(true); // helper clears presence + exits
        killHelper();
        PRESENCE.running = false;
        setStatus("Presence off.");
    }

    // scheduleTask evaluates a string in global scope, so the heartbeat
    // lives on $.global; the closure keeps access to the panel state.
    $.global.__discordBuddyTick = function () {
        if (PRESENCE.running) writeState(false);
    };

    // ------------------------------------------------------------------
    // Purple theme (matches GraphBuddy). Buttons are custom-drawn
    // because ScriptUI can't recolor native ones; background and text
    // tints are best-effort per platform and never break the panel.
    // ------------------------------------------------------------------

    var COL = {
        panelBg:     [0.11, 0.09, 0.16, 1],
        border:      [0.36, 0.30, 0.53, 1],
        borderHover: [0.64, 0.54, 0.92, 1],
        btnBg:       [0.24, 0.19, 0.37, 1],
        btnBgHover:  [0.31, 0.25, 0.47, 1],
        btnBgDown:   [0.38, 0.31, 0.57, 1],
        btnText:     [0.91, 0.88, 1.00, 1],
        text:        [0.86, 0.83, 0.95, 1],
        muted:       [0.63, 0.58, 0.77, 1]
    };

    function paintBG(ctrl, color) {
        try {
            var g = ctrl.graphics;
            g.backgroundColor = g.newBrush(g.BrushType.SOLID_COLOR, [color[0], color[1], color[2]]);
        } catch (e) {}
    }

    function tintText(ctrl, color) {
        try {
            var g = ctrl.graphics;
            g.foregroundColor = g.newPen(g.PenType.SOLID_COLOR, [color[0], color[1], color[2]], 1);
        } catch (e) {}
    }

    // AE doesn't repaint custom-drawn controls on mouse enter/leave, so
    // force a redraw to make the hover highlight visible
    function hoverRepaint(ctrl) {
        function repaint(ev) {
            try { ev.target.notify("onDraw"); } catch (e) {}
        }
        ctrl.addEventListener("mouseover", repaint);
        ctrl.addEventListener("mouseout", repaint);
    }

    var BTN_FONT = null;

    function btnFont() {
        if (BTN_FONT === null) {
            try { BTN_FONT = ScriptUI.newFont("dialog", ScriptUI.FontStyle.REGULAR, 11); } catch (e) {}
        }
        return BTN_FONT;
    }

    // Flat purple button: an iconbutton drawn by hand, with hover and
    // pressed states.
    function renderButton(ctrl, label) {
        ctrl.onDraw = function (drawState) {
            try {
                if (!this.size) return;
                var g = this.graphics;
                var w = this.size.width;
                var h = this.size.height;
                var over = false, down = false;
                if (drawState) {
                    over = drawState.mouseOver === true;
                    down = drawState.leftButtonPressed === true;
                }
                g.newPath();
                g.rectPath(0, 0, w, h);
                g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, down ? COL.btnBgDown : (over ? COL.btnBgHover : COL.btnBg)));
                g.newPath();
                g.rectPath(0, 0, w - 1, h - 1);
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, over ? COL.borderHover : COL.border, 1));
                var f = btnFont();
                var tw = label.length * 5.5;
                var th = 12;
                try {
                    var m = g.measureString(label, f);
                    tw = m.width;
                    th = m.height;
                } catch (eM) {}
                var tx = (w - tw) / 2;
                if (tx < 2) tx = 2;
                var ty = (h - th) / 2;
                if (ty < 0) ty = 0;
                g.drawString(label, g.newPen(g.PenType.SOLID_COLOR, COL.btnText, 1), tx, ty, f);
            } catch (eDraw) {}
        };
    }

    // ------------------------------------------------------------------
    // UI
    // ------------------------------------------------------------------

    function buildUI(host) {
        var pal = (host instanceof Panel) ? host : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });

        pal.orientation = "column";
        pal.alignChildren = ["fill", "top"];
        pal.spacing = 6;
        pal.margins = 10;
        paintBG(pal, COL.panelBg);

        var intro = pal.add("statictext", undefined,
            'Show "Playing Adobe After Effects"\n+ your .aep on your Discord profile.', { multiline: true });
        intro.alignment = ["fill", "top"];
        try { intro.graphics.font = ScriptUI.newFont(intro.graphics.font.name, ScriptUI.FontStyle.ITALIC, 9); } catch (eF1) {}
        tintText(intro, COL.muted);

        var r1 = pal.add("group");
        r1.orientation = "row";
        r1.alignChildren = ["left", "center"];
        r1.alignment = ["fill", "top"];
        r1.spacing = 4;
        var stId = r1.add("statictext", undefined, "App ID");
        tintText(stId, COL.text);
        var idField = r1.add("edittext", undefined, loadSetting("clientId", ""));
        idField.alignment = ["fill", "center"];
        idField.characters = 14;
        tintText(idField, COL.text);
        idField.helpTip = "Your Discord Application ID. Create a free app named \"Adobe After Effects\" at discord.com/developers/applications and paste its Application ID here \u2014 the app name is what Discord shows after \"Playing\". Remembered between sessions.";
        idField.onChange = function () {
            saveSetting("clientId", idField.text.replace(/^\s+|\s+$/g, ""));
        };

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

        function btn(parent, label, tip, fn) {
            var b = parent.add("iconbutton", undefined, undefined, { style: "toolbutton" });
            b.helpTip = tip;
            b.alignment = ["fill", "center"];
            b.preferredSize = [60, 24];
            renderButton(b, label);
            hoverRepaint(b);
            b.onClick = fn;
            return b;
        }

        btn(r2, "Start", "Starts broadcasting to Discord. Needs the Discord desktop app running, Node.js installed, and your App ID above \u2014 see the README for the 2-minute setup.",
            function () { startPresence(idField.text); });
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
