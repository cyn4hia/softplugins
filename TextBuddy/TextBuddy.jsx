/**********************************************************************
 TextBuddy.jsx  \u2014  one-click text animation for After Effects
 v1.0   Reveal tab: build a text animator (property, Based On,
        Smoothness) and key its Offset at 0% / 100%, with the keys
        selected and twirled open in the timeline. Apple tab: the
        "animate text like Apple" looks \u2014 Drop, Rise, Slide reveals,
        Slide / Scale match cuts with the 3-keyframe drift, and a
        hand-drawn Underline. (Reveal moved here from GraphBuddy.)

 Install (After Effects 2026): copy TextBuddy.jsx AND the
 TextBuddy_lib folder, side by side, into
   macOS:   /Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/
   Windows: C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\
 Restart After Effects, then open it from the bottom of the Window menu
 (or from BuddyHub) and dock it anywhere \u2014 it is designed to sit
 narrow at the side.

 Everything keys at the playhead and is a single undo step. Keys
 land selected, so a GraphBuddy ease tile clicked next shapes them.

 Layout:
   TextBuddy.jsx              entry point: panel shell + status line
   TextBuddy_lib/
     core.jsxinc              text layers, range selectors, selection +
                              timeline reveal, keyframe helpers
     ui.jsxinc                theme, custom drawing, widget factories
     tab_reveal.jsxinc        Reveal tab (animator builder, Offset keys)
     tab_apple.jsxinc         Apple tab  (styles, match cuts, underline)
 Modules use .jsxinc so AE doesn't list them in the Window menu.
**********************************************************************/

(function textBuddy(thisObj) {

    var SCRIPT_NAME = "TextBuddy";

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

//@include "TextBuddy_lib/core.jsxinc"
//@include "TextBuddy_lib/ui.jsxinc"
//@include "TextBuddy_lib/tab_reveal.jsxinc"
//@include "TextBuddy_lib/tab_apple.jsxinc"

    // ------------------------------------------------------------------
    // Panel
    // ------------------------------------------------------------------

    function buildUI(host) {
        var pal = (host instanceof Panel) ? host : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });

        pal.orientation = "column";
        pal.alignChildren = ["fill", "top"];
        pal.spacing = 6;
        pal.margins = 8;
        paintBG(pal, COL.panelBg);

        addHeader(pal);

        var tp = pal.add("tabbedpanel");
        tp.alignChildren = ["fill", "top"];
        tp.alignment = ["fill", "top"];
        tp.margins = 6;
        paintBG(tp, COL.panelBg);

        var tReveal = buildRevealTab(tp);
        buildAppleTab(tp);
        tp.selection = tReveal;

        // ---- Status line ---------------------------------------------

        var statusText = pal.add("statictext", undefined, "Select text layers \u2014 then pick a look.");
        statusText.alignment = ["fill", "top"];
        try { statusText.graphics.font = ScriptUI.newFont(statusText.graphics.font.name, ScriptUI.FontStyle.ITALIC, 9); } catch (eF) {}
        tintText(statusText, COL.muted);
        statusFn = function (msg) {
            statusText.text = msg;
            statusText.helpTip = msg;
        };

        // ---- Layout / docking ----------------------------------------

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
