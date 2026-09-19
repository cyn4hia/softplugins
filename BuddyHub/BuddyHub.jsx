/**********************************************************************
 BuddyHub.jsx  \u2014  home panel for the Buddy plugins
 v1.0   A launcher: lists every *Buddy.jsx installed next to it, each
        with its own icon and description. Click a buddy to open its
        panel (or close it if it's already open). Drop a new buddy
        into the folder and press Rescan \u2014 it appears automatically.

 Install (After Effects 2026):
   macOS:   /Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/
   Windows: C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\
 Same folder as the buddies. Restart After Effects, then open it from
 the bottom of the Window menu.

 How opening works: a buddy installed in ScriptUI Panels has a Window
 menu entry, and the hub triggers it via app.findMenuCommandId \u2014 that
 toggles the real dockable panel. If a buddy has no menu entry, the
 hub falls back to running it as a floating window.
**********************************************************************/

(function buddyHub(thisObj) {

    var SCRIPT_NAME = "BuddyHub";
    var SCRIPT_FILE = new File($.fileName);

    // ------------------------------------------------------------------
    // Purple theme (matches the buddies)
    // ------------------------------------------------------------------

    var COL = {
        panelBg:     [0.11, 0.09, 0.16, 1],
        rowBg:       [0.16, 0.13, 0.24, 1],
        rowBgHover:  [0.22, 0.18, 0.33, 1],
        rowBgDown:   [0.28, 0.23, 0.42, 1],
        border:      [0.36, 0.30, 0.53, 1],
        borderHover: [0.64, 0.54, 0.92, 1],
        tileBg:      [0.20, 0.16, 0.30, 1],
        curve:       [0.73, 0.58, 1.00, 1],
        dot:         [0.99, 0.79, 0.42, 1],
        blob:        [0.55, 0.47, 0.92, 1],
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

    function hoverRepaint(ctrl) {
        function repaint(ev) {
            try { ev.target.notify("onDraw"); } catch (e) {}
        }
        ctrl.addEventListener("mouseover", repaint);
        ctrl.addEventListener("mouseout", repaint);
    }

    var FONTS = { name: null, desc: null, btn: null, letter: null };

    function font(which) {
        if (FONTS[which] === null) {
            try {
                if (which === "name") FONTS[which] = ScriptUI.newFont("dialog", ScriptUI.FontStyle.BOLD, 11);
                else if (which === "desc") FONTS[which] = ScriptUI.newFont("dialog", ScriptUI.FontStyle.REGULAR, 9);
                else if (which === "btn") FONTS[which] = ScriptUI.newFont("dialog", ScriptUI.FontStyle.REGULAR, 11);
                else if (which === "letter") FONTS[which] = ScriptUI.newFont("dialog", ScriptUI.FontStyle.BOLD, 14);
            } catch (e) {}
        }
        return FONTS[which];
    }

    // ------------------------------------------------------------------
    // Buddy registry \u2014 known buddies get a description and a drawn
    // icon; anything else gets a letter badge so future buddies still
    // look at home.
    // ------------------------------------------------------------------

    var KNOWN = {
        GraphBuddy:   { desc: "One-click graph editor eases", icon: "graph" },
        DiscordBuddy: { desc: "Discord Rich Presence", icon: "discord" }
    };

    // cubic bezier from (0,0) to (1,1) for the graph icon
    function bezXY(t, cp) {
        var mt = 1 - t;
        var a = 3 * mt * mt * t;
        var b = 3 * mt * t * t;
        var c = t * t * t;
        return [a * cp[0] + b * cp[2] + c, a * cp[1] + b * cp[3] + c];
    }

    function drawIcon(g, kind, x, y, s, letter) {
        var i;
        if (kind === "graph") {
            g.newPath(); g.rectPath(x, y, s, s);
            g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, COL.tileBg));
            g.newPath(); g.rectPath(x, y, s - 1, s - 1);
            g.strokePath(g.newPen(g.PenType.SOLID_COLOR, COL.border, 1));
            var cp = [0.9, 0, 0.1, 1];
            g.newPath();
            for (i = 0; i <= 12; i++) {
                var pt = bezXY(i / 12, cp);
                var px = x + 4 + pt[0] * (s - 8);
                var py = y + s - 4 - pt[1] * (s - 8);
                if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
            }
            g.strokePath(g.newPen(g.PenType.SOLID_COLOR, COL.curve, 2));
            var dotB = g.newBrush(g.BrushType.SOLID_COLOR, COL.dot);
            g.newPath(); g.ellipsePath(x + 2, y + s - 7, 5, 5); g.fillPath(dotB);
            g.newPath(); g.ellipsePath(x + s - 7, y + 2, 5, 5); g.fillPath(dotB);
        } else if (kind === "discord") {
            g.newPath(); g.rectPath(x, y, s, s);
            g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, COL.tileBg));
            g.newPath(); g.rectPath(x, y, s - 1, s - 1);
            g.strokePath(g.newPen(g.PenType.SOLID_COLOR, COL.border, 1));
            // the blob-with-eyes
            g.newPath(); g.ellipsePath(x + 3, y + s * 0.28, s - 6, s * 0.46);
            g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, COL.blob));
            var eyeB = g.newBrush(g.BrushType.SOLID_COLOR, COL.panelBg);
            g.newPath(); g.ellipsePath(x + s * 0.30, y + s * 0.42, s * 0.13, s * 0.19); g.fillPath(eyeB);
            g.newPath(); g.ellipsePath(x + s * 0.58, y + s * 0.42, s * 0.13, s * 0.19); g.fillPath(eyeB);
        } else {
            g.newPath(); g.rectPath(x, y, s, s);
            g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, COL.btnBg));
            g.newPath(); g.rectPath(x, y, s - 1, s - 1);
            g.strokePath(g.newPen(g.PenType.SOLID_COLOR, COL.border, 1));
            var f = font("letter");
            var tw = 8, th = 14;
            try { var m = g.measureString(letter, f); tw = m.width; th = m.height; } catch (eM) {}
            g.drawString(letter, g.newPen(g.PenType.SOLID_COLOR, COL.curve, 1),
                         x + (s - tw) / 2, y + (s - th) / 2, f);
        }
    }

    // ------------------------------------------------------------------
    // Discovery + opening
    // ------------------------------------------------------------------

    function buddyFiles() {
        var out = [];
        try {
            var files = SCRIPT_FILE.parent.getFiles("*.jsx");
            for (var i = 0; i < files.length; i++) {
                var n = decodeURI(files[i].name);
                if (n === decodeURI(SCRIPT_FILE.name)) continue;
                if (!/Buddy\.jsx$/i.test(n)) continue;
                out.push(n);
            }
        } catch (e) {}
        out.sort();
        return out;
    }

    function makeEntry(fileName) {
        var title = fileName.replace(/\.jsx$/i, "");
        var known = KNOWN[title];
        return {
            file: fileName,
            title: title,
            desc: (known !== undefined) ? known.desc : "Buddy plugin for After Effects",
            icon: (known !== undefined) ? known.icon : "letter",
            letter: title.charAt(0).toUpperCase()
        };
    }

    // Toggle the real dockable panel via its Window menu entry; fall
    // back to running the file as a floating window.
    function openBuddy(fileName) {
        var cmdId = 0;
        try { cmdId = app.findMenuCommandId(fileName); } catch (e) { cmdId = 0; }
        if (cmdId > 0) {
            try { app.executeCommand(cmdId); return "panel"; } catch (e2) {}
        }
        try {
            var f = new File(SCRIPT_FILE.parent.fsName + "/" + fileName);
            if (f.exists) { $.evalFile(f); return "floating"; }
        } catch (e3) {}
        return null;
    }

    // ------------------------------------------------------------------
    // UI
    // ------------------------------------------------------------------

    var statusFn = null;

    function setStatus(msg) {
        if (statusFn !== null) statusFn(msg);
    }

    function renderRow(ctrl, entry) {
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
                g.newPath(); g.rectPath(0, 0, w, h);
                g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, down ? COL.rowBgDown : (over ? COL.rowBgHover : COL.rowBg)));
                g.newPath(); g.rectPath(0, 0, w - 1, h - 1);
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, over ? COL.borderHover : COL.border, 1));
                drawIcon(g, entry.icon, 9, (h - 28) / 2, 28, entry.letter);
                g.drawString(entry.title, g.newPen(g.PenType.SOLID_COLOR, COL.btnText, 1), 46, 6, font("name"));
                g.drawString(entry.desc, g.newPen(g.PenType.SOLID_COLOR, COL.muted, 1), 46, 23, font("desc"));
            } catch (eDraw) {}
        };
    }

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
                g.newPath(); g.rectPath(0, 0, w, h);
                g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, down ? COL.btnBgDown : (over ? COL.btnBgHover : COL.btnBg)));
                g.newPath(); g.rectPath(0, 0, w - 1, h - 1);
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, over ? COL.borderHover : COL.border, 1));
                var f = font("btn");
                var tw = label.length * 5.5, th = 12;
                try { var m = g.measureString(label, f); tw = m.width; th = m.height; } catch (eM) {}
                g.drawString(label, g.newPen(g.PenType.SOLID_COLOR, COL.btnText, 1),
                             Math.max(2, (w - tw) / 2), Math.max(0, (h - th) / 2), f);
            } catch (eDraw) {}
        };
    }

    function buildUI(host) {
        var pal = (host instanceof Panel) ? host : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });

        pal.orientation = "column";
        pal.alignChildren = ["fill", "top"];
        pal.spacing = 6;
        pal.margins = 10;
        paintBG(pal, COL.panelBg);

        // header: hub icon + title
        var hdr = pal.add("group");
        hdr.orientation = "row";
        hdr.alignChildren = ["left", "center"];
        hdr.spacing = 6;
        var hIcon = hdr.add("iconbutton", undefined, undefined, { style: "toolbutton" });
        hIcon.preferredSize = [20, 20];
        hIcon.onDraw = function () {
            try {
                if (!this.size) return;
                var g = this.graphics;
                var w = this.size.width, h = this.size.height;
                // little house
                var wallB = g.newBrush(g.BrushType.SOLID_COLOR, COL.blob);
                g.newPath();
                g.moveTo(w * 0.5, 1);
                g.lineTo(w - 1, h * 0.5);
                g.lineTo(1, h * 0.5);
                g.fillPath(wallB);
                g.newPath(); g.rectPath(w * 0.2, h * 0.5, w * 0.6, h * 0.45);
                g.fillPath(wallB);
                g.newPath(); g.rectPath(w * 0.42, h * 0.62, w * 0.18, h * 0.33);
                g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, COL.panelBg));
            } catch (e) {}
        };
        var hTitle = hdr.add("statictext", undefined, "BuddyHub");
        try { hTitle.graphics.font = ScriptUI.newFont(hTitle.graphics.font.name, ScriptUI.FontStyle.BOLD, 12); } catch (eF1) {}
        tintText(hTitle, COL.text);

        var listGroup = pal.add("group");
        listGroup.orientation = "column";
        listGroup.alignChildren = ["fill", "top"];
        listGroup.alignment = ["fill", "top"];
        listGroup.spacing = 4;

        function populate() {
            while (listGroup.children.length > 0) listGroup.remove(listGroup.children[0]);
            var names = buddyFiles();
            if (names.length === 0) {
                var none = listGroup.add("statictext", undefined, "No buddies found next to BuddyHub.jsx.");
                tintText(none, COL.muted);
            }
            for (var i = 0; i < names.length; i++) {
                var entry = makeEntry(names[i]);
                var row = listGroup.add("iconbutton", undefined, undefined, { style: "toolbutton" });
                row.preferredSize = [200, 46];
                row.alignment = ["fill", "top"];
                row.helpTip = "Opens " + entry.title + " (or closes it if its panel is already open).";
                renderRow(row, entry);
                hoverRepaint(row);
                row.onClick = (function (e) {
                    return function () {
                        var how = openBuddy(e.file);
                        if (how === "panel") setStatus(e.title + " opened (or closed, if it was open).");
                        else if (how === "floating") setStatus(e.title + " opened as a floating window.");
                        else setStatus("Couldn't open " + e.title + " \u2014 is its .jsx still in this folder?");
                    };
                })(entry);
            }
            return names.length;
        }

        var count = populate();

        var rRescan = pal.add("group");
        rRescan.orientation = "row";
        rRescan.alignChildren = ["fill", "center"];
        rRescan.alignment = ["fill", "top"];
        var rescanBtn = rRescan.add("iconbutton", undefined, undefined, { style: "toolbutton" });
        rescanBtn.preferredSize = [60, 24];
        rescanBtn.alignment = ["fill", "center"];
        rescanBtn.helpTip = "Re-scans this folder for *Buddy.jsx files \u2014 use after installing a new buddy.";
        renderButton(rescanBtn, "Rescan");
        hoverRepaint(rescanBtn);
        rescanBtn.onClick = function () {
            var n = populate();
            pal.layout.layout(true);
            pal.layout.resize();
            setStatus(n + (n === 1 ? " buddy found." : " buddies found."));
        };

        var statusText = pal.add("statictext", undefined,
            count + (count === 1 ? " buddy found \u2014 click it to open." : " buddies found \u2014 click one to open."));
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
