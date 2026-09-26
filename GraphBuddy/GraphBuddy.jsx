/**********************************************************************
 GraphBuddy.jsx  \u2014  one-click graph editor eases for After Effects
 v4.5  (split into modules under GraphBuddy_lib/; behavior unchanged
        from v4.4 \u2014 purple UI, graph-only: Ease, Flow, and Custom
        tabs.)

 Install (After Effects 2026): copy GraphBuddy.jsx AND the
 GraphBuddy_lib folder, side by side, into
   macOS:   /Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/
   Windows: C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\
 Restart After Effects, then open it from the bottom of the Window menu
 and dock it anywhere \u2014 it is designed to sit narrow at the side.

 Smart selection: buttons work on whatever you have selected \u2014
 keyframes, or properties (all their keys), or whole layers
 (every animated property). Every click is a single undo step.

 Each preset button draws its actual value graph so you can pick
 the curve by shape, exactly like the graph editor will show it.

 Layout:
   GraphBuddy.jsx             entry point: panel shell + status line
   GraphBuddy_lib/
     core.jsxinc              smart selection + influence-ease engine
     ui.jsxinc                theme, custom drawing, widget factories
     tab_ease.jsxinc          Ease tab  (graph-tile presets)
     tab_flow.jsxinc          Flow tab  (cubic-bezier segment engine)
     tab_custom.jsxinc        Custom tab (sliders, copy/paste ease)
 Modules use .jsxinc so AE doesn't list them in the Window menu.
**********************************************************************/

(function graphBuddy(thisObj) {

    var SCRIPT_NAME = "GraphBuddy";

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

//@include "GraphBuddy_lib/core.jsxinc"
//@include "GraphBuddy_lib/ui.jsxinc"
//@include "GraphBuddy_lib/tab_ease.jsxinc"
//@include "GraphBuddy_lib/tab_flow.jsxinc"
//@include "GraphBuddy_lib/tab_custom.jsxinc"

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

        var tEase = buildEaseTab(tp);
        buildFlowTab(tp);
        buildCustomTab(tp);
        tp.selection = tEase;

        // ---- Status line ---------------------------------------------

        var statusText = pal.add("statictext", undefined, "Select keys, props, or layers \u2014 then click a graph.");
        statusText.alignment = ["fill", "top"];
        try { statusText.graphics.font = ScriptUI.newFont(statusText.graphics.font.name, ScriptUI.FontStyle.ITALIC, 9); } catch (eF3) {}
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
