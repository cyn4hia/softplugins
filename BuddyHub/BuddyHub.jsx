/**********************************************************************
 BuddyHub.jsx  \u2014  home panel for the Buddy plugins
 v1.1   A launcher: lists every *Buddy.jsx installed next to it, each
        with its own icon and description. Click a buddy to open its
        panel (or close it if it's already open). Drop a new buddy
        into the folder and press Rescan \u2014 it appears automatically.
        (v1.1: split into modules under BuddyHub_lib/.)

 Install (After Effects 2026): copy BuddyHub.jsx AND the BuddyHub_lib
 folder, side by side, into the same folder as the buddies:
   macOS:   /Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/
   Windows: C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\
 Restart After Effects, then open it from the bottom of the Window
 menu.

 How opening works: a buddy installed in ScriptUI Panels has a Window
 menu entry, and the hub triggers it via app.findMenuCommandId \u2014 that
 toggles the real dockable panel. If a buddy has no menu entry, the
 hub falls back to running it as a floating window.

 Layout:
   BuddyHub.jsx               entry point: panel, buddy list, status
   BuddyHub_lib/
     registry.jsxinc          known buddies, discovery, opening
     icons.jsxinc             each buddy's code-drawn icon
     ui.jsxinc                theme, fonts, custom-drawn rows/buttons
 Modules use .jsxinc so AE doesn't list them in the Window menu.
**********************************************************************/

(function buddyHub(thisObj) {

    var SCRIPT_NAME = "BuddyHub";
    var SCRIPT_FILE = new File($.fileName);

    // ------------------------------------------------------------------
    // Status line (set once the UI exists)
    // ------------------------------------------------------------------

    var statusFn = null;

    function setStatus(msg) {
        if (statusFn !== null) statusFn(msg);
    }

    // ------------------------------------------------------------------
    // Modules \u2014 spliced in at load time, so they share this closure
    // and nothing leaks into AE's global scope.
    // ------------------------------------------------------------------

//@include "BuddyHub_lib/ui.jsxinc"
//@include "BuddyHub_lib/icons.jsxinc"
//@include "BuddyHub_lib/registry.jsxinc"

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
