/**********************************************************************
 GraphBuddy.jsx  \u2014  one-click graph editor eases for After Effects
 v4.3  (purple UI theme: dark violet panel, lavender graph tiles, and
        custom-drawn buttons. Behavior unchanged from v4.2 \u2014 graph-only:
        Ease, Flow, and Custom tabs. Flow tab: cubic-bezier graph pack
        applied per segment with computed keyframe speeds, plus a
        type-any-bezier input.)

 Install (After Effects 2026):
   macOS:   /Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/
   Windows: C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\
 Restart After Effects, then open it from the bottom of the Window menu
 and dock it anywhere \u2014 it is designed to sit narrow at the side.

 Smart selection: buttons work on whatever you have selected \u2014
 keyframes, or properties (all their keys), or whole layers
 (every animated property). Every click is a single undo step.

 Each preset button draws its actual value graph so you can pick
 the curve by shape, exactly like the graph editor will show it.
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
    // Selection helpers
    // ------------------------------------------------------------------

    function activeComp() {
        var item = app.project.activeItem;
        return (item !== null && item instanceof CompItem) ? item : null;
    }

    // Property value types that cannot take temporal ease.
    // SHAPE (mask/shape paths) is allowed: path keyframes support
    // temporal easing.
    function isEaseable(prop) {
        var vt = prop.propertyValueType;
        return vt !== PropertyValueType.TEXT_DOCUMENT &&
               vt !== PropertyValueType.MARKER &&
               vt !== PropertyValueType.NO_VALUE &&
               vt !== PropertyValueType.CUSTOM_VALUE;
    }

    function isKeyable(prop) {
        return prop.propertyType === PropertyType.PROPERTY &&
               prop.canVaryOverTime &&
               prop.numKeys >= 1 &&
               isEaseable(prop);
    }

    function allKeyIndices(prop) {
        var keys = [];
        for (var i = 1; i <= prop.numKeys; i++) keys.push(i);
        return keys;
    }

    // Recursively collect animated (keyframed) properties under a
    // layer or property group
    function collectAnimated(group, out) {
        var n = 0;
        try { n = group.numProperties; } catch (e) { n = 0; }
        for (var i = 1; i <= n; i++) {
            var p = null;
            try { p = group.property(i); } catch (e2) { p = null; }
            if (p === null) continue;
            if (p.propertyType === PropertyType.PROPERTY) {
                if (isKeyable(p)) out.push(p);
            } else {
                collectAnimated(p, out);
            }
        }
    }

    // Smart targets, in priority order:
    //   1) selected keyframes
    //   2) all keys on selected properties
    //   3) all keys on every animated property of selected layers
    function getTargets() {
        var comp = activeComp();
        if (comp === null) return { error: "Open a composition first.", targets: [] };

        var targets = [];
        var keyCount = 0;
        var i, j, p, keys;

        var props = comp.selectedProperties;

        // 1) explicitly selected keyframes (indices snapshotted before edits)
        for (i = 0; i < props.length; i++) {
            p = props[i];
            if (!isKeyable(p)) continue;
            var sel = p.selectedKeys;
            if (sel === null || sel.length === 0) continue;
            keys = [];
            for (j = 0; j < sel.length; j++) keys.push(sel[j]);
            targets.push({ prop: p, keys: keys });
            keyCount += keys.length;
        }
        if (targets.length > 0) return { targets: targets, keyCount: keyCount, mode: "selected keys" };

        // 2) all keys on selected properties
        for (i = 0; i < props.length; i++) {
            p = props[i];
            if (!isKeyable(p)) continue;
            targets.push({ prop: p, keys: allKeyIndices(p) });
            keyCount += p.numKeys;
        }
        if (targets.length > 0) return { targets: targets, keyCount: keyCount, mode: "selected properties" };

        // If the user explicitly selected properties but none were usable
        // (no keys, or a type that can't take ease like source text /
        // markers), stop here \u2014 selecting a property also selects
        // its layer, and cascading to layer mode would silently re-ease
        // every other animated property.
        for (i = 0; i < props.length; i++) {
            if (props[i].propertyType === PropertyType.PROPERTY) {
                return { error: "Selected properties can't take ease (or have no keyframes).", targets: [] };
            }
        }

        // 3) every animated property of the selected layers
        var layers = comp.selectedLayers;
        for (i = 0; i < layers.length; i++) {
            var found = [];
            collectAnimated(layers[i], found);
            for (j = 0; j < found.length; j++) {
                targets.push({ prop: found[j], keys: allKeyIndices(found[j]) });
                keyCount += found[j].numKeys;
            }
        }
        if (targets.length > 0) return { targets: targets, keyCount: keyCount, mode: "selected layers" };

        return { error: "Select keyframes, properties, or layers first.", targets: [] };
    }

    // Runs fn(prop, keyIndex) on every target key inside one undo group
    function applyToKeys(undoLabel, fn) {
        var res = getTargets();
        if (res.error) { setStatus(res.error); return; }

        var applied = 0;
        app.beginUndoGroup(SCRIPT_NAME + ": " + undoLabel);
        try {
            for (var t = 0; t < res.targets.length; t++) {
                var tg = res.targets[t];
                for (var k = 0; k < tg.keys.length; k++) {
                    try {
                        fn(tg.prop, tg.keys[k]);
                        applied++;
                    } catch (e) {
                        // Some keys (e.g. roving) may refuse a change; skip them
                    }
                }
            }
        } finally {
            app.endUndoGroup();
        }
        var nProps = res.targets.length;
        setStatus(undoLabel + " \u2192 " + applied + (applied === 1 ? " key on " : " keys on ") +
                  nProps + (nProps === 1 ? " property (" : " properties (") + res.mode + ")");
    }

    // ------------------------------------------------------------------
    // Ease engine
    // ------------------------------------------------------------------

    // Ease arrays must match the property's dimension count (1 for 1D and
    // spatial, 2/3 for multi-D). Reading the existing ease length avoids
    // guessing per value type.
    function easeDim(prop, keyIndex) {
        var n = 1;
        try { n = prop.keyInTemporalEase(keyIndex).length; } catch (e) {}
        return n;
    }

    function easeArray(n, speed, influence) {
        if (influence < 0.1) influence = 0.1;
        if (influence > 100) influence = 100;
        var arr = [];
        for (var i = 0; i < n; i++) arr.push(new KeyframeEase(speed, influence));
        return arr;
    }

    // inInf / outInf: influence 0.1..100, or null = leave that side linear
    function applyEase(inInf, outInf, label) {
        applyToKeys(label, function (prop, ki) {
            var B = KeyframeInterpolationType.BEZIER;
            var L = KeyframeInterpolationType.LINEAR;
            var n = easeDim(prop, ki);
            // setTemporalEaseAtKey forces both sides of the key to BEZIER,
            // so write the ease first, then restore any LINEAR side.
            // Re-asserting an unchanged type does not reset the ease.
            prop.setTemporalEaseAtKey(ki,
                easeArray(n, 0, (inInf === null) ? 33.3333 : inInf),
                easeArray(n, 0, (outInf === null) ? 33.3333 : outInf));
            prop.setInterpolationTypeAtKey(ki, (inInf === null) ? L : B, (outInf === null) ? L : B);
        });
    }

    function applyLinear() {
        applyToKeys("Linear", function (prop, ki) {
            prop.setInterpolationTypeAtKey(ki, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
        });
    }

    function applyHold() {
        applyToKeys("Hold", function (prop, ki) {
            prop.setInterpolationTypeAtKey(ki, prop.keyInInterpolationType(ki), KeyframeInterpolationType.HOLD);
        });
    }

    // ------------------------------------------------------------------
    // Copy / paste ease
    // ------------------------------------------------------------------

    var easeClip = null;

    function dumpEase(arr) {
        var out = [];
        for (var i = 0; i < arr.length; i++) {
            out.push({ speed: arr[i].speed, influence: arr[i].influence });
        }
        return out;
    }

    function buildEase(src, n) {
        var arr = [];
        for (var i = 0; i < n; i++) {
            var s = (i < src.length) ? src[i] : src[src.length - 1];
            var inf = s.influence;
            if (inf < 0.1) inf = 0.1;
            if (inf > 100) inf = 100;
            arr.push(new KeyframeEase(s.speed, inf));
        }
        return arr;
    }

    function copyEase() {
        var res = getTargets();
        if (res.error) { setStatus(res.error); return; }
        var prop = res.targets[0].prop;
        var ki = res.targets[0].keys[0];
        try {
            easeClip = {
                inType: prop.keyInInterpolationType(ki),
                outType: prop.keyOutInterpolationType(ki),
                inEase: dumpEase(prop.keyInTemporalEase(ki)),
                outEase: dumpEase(prop.keyOutTemporalEase(ki))
            };
        } catch (e) {
            setStatus("Could not read ease from that keyframe.");
            return;
        }
        setStatus("Copied ease (in " + Math.round(easeClip.inEase[0].influence) +
                  "% / out " + Math.round(easeClip.outEase[0].influence) + "%)");
    }

    function pasteEase() {
        if (easeClip === null) {
            setStatus("Nothing copied yet \u2014 click Copy Ease first.");
            return;
        }
        applyToKeys("Paste Ease", function (prop, ki) {
            var n = easeDim(prop, ki);
            // Ease first, types last: setTemporalEaseAtKey forces BEZIER,
            // which would clobber copied LINEAR/HOLD sides.
            prop.setTemporalEaseAtKey(ki, buildEase(easeClip.inEase, n), buildEase(easeClip.outEase, n));
            prop.setInterpolationTypeAtKey(ki, easeClip.inType, easeClip.outType);
        });
    }

    // ------------------------------------------------------------------
    // Cubic-bezier segment engine (Flow-style graphs)
    //
    // Applies cubic-bezier(x1, y1, x2, y2) to every pair of consecutive
    // selected keys: the outgoing side of the first key and the incoming
    // side of the second. Speeds are computed from each segment's value
    // delta, so curves with velocity at the keys (y handles off the
    // baseline, e.g. Fast Out's vertical launch) reproduce exactly.
    // ------------------------------------------------------------------

    // Per-dimension speeds for one segment: slope * (value delta / time)
    function segSpeeds(prop, ki, kj, slope) {
        var dt = prop.keyTime(kj) - prop.keyTime(ki);
        if (dt <= 0) return null;
        var n = easeDim(prop, ki);
        var out = [];
        var v0 = null, v1 = null;
        try { v0 = prop.keyValue(ki); v1 = prop.keyValue(kj); } catch (e) { v0 = null; }
        var d;
        if (v0 === null || v1 === null) {
            // shapes etc: no numeric delta, fall back to influence-only
            for (d = 0; d < n; d++) out.push(0);
            return out;
        }
        if (v0 instanceof Array) {
            if (n === 1) {
                // spatial: one ease for the whole path; speed = distance/time
                var sum = 0;
                for (d = 0; d < v0.length; d++) sum += (v1[d] - v0[d]) * (v1[d] - v0[d]);
                out.push(slope * Math.sqrt(sum) / dt);
            } else {
                for (d = 0; d < n; d++) {
                    var dv = (d < v0.length) ? (v1[d] - v0[d]) : 0;
                    out.push(slope * dv / dt);
                }
            }
        } else if (typeof v0 === "number") {
            for (d = 0; d < n; d++) out.push(slope * (v1 - v0) / dt);
        } else {
            for (d = 0; d < n; d++) out.push(0);
        }
        return out;
    }

    function easeArrayFromSpeeds(speeds, influence) {
        if (influence < 0.1) influence = 0.1;
        if (influence > 100) influence = 100;
        var arr = [];
        for (var i = 0; i < speeds.length; i++) arr.push(new KeyframeEase(speeds[i], influence));
        return arr;
    }

    function applyBezier(x1, y1, x2, y2, label) {
        // clamp handle x so influences and slopes stay finite
        var ox = Math.max(0.01, Math.min(1, x1));
        var ix = Math.max(0.01, Math.min(1, 1 - x2));
        var outSlope = y1 / ox;
        var inSlope = (1 - y2) / ix;

        var res = getTargets();
        if (res.error) { setStatus(res.error); return; }

        var applied = 0;
        app.beginUndoGroup(SCRIPT_NAME + ": " + label);
        try {
            for (var t = 0; t < res.targets.length; t++) {
                var prop = res.targets[t].prop;
                var keys = res.targets[t].keys.slice(0);
                keys.sort(function (a, b) { return a - b; });
                for (var k = 0; k + 1 < keys.length; k++) {
                    var ki = keys[k];
                    var kj = keys[k + 1];
                    if (kj !== ki + 1) continue; // only real adjacent segments
                    try {
                        var so = segSpeeds(prop, ki, kj, outSlope);
                        var si = segSpeeds(prop, ki, kj, inSlope);
                        if (so === null || si === null) continue;
                        var B = KeyframeInterpolationType.BEZIER;
                        // Capture the untouched sides BEFORE the ease call
                        // (setTemporalEaseAtKey forces both sides bezier).
                        var inT = prop.keyInInterpolationType(ki);
                        var inE = prop.keyInTemporalEase(ki);
                        prop.setTemporalEaseAtKey(ki, inE, easeArrayFromSpeeds(so, ox * 100));
                        prop.setInterpolationTypeAtKey(ki, inT, B);
                        var outT = prop.keyOutInterpolationType(kj);
                        var outE = prop.keyOutTemporalEase(kj);
                        prop.setTemporalEaseAtKey(kj, easeArrayFromSpeeds(si, ix * 100), outE);
                        prop.setInterpolationTypeAtKey(kj, B, outT);
                        applied++;
                    } catch (eSeg) {}
                }
            }
        } finally {
            app.endUndoGroup();
        }
        if (applied === 0) {
            setStatus("Select at least 2 consecutive keyframes (a segment) first.");
        } else {
            setStatus(label + " \u2192 " + applied + (applied === 1 ? " segment" : " segments"));
        }
    }

    // ------------------------------------------------------------------
    // Graph tile drawing (each preset button draws its value graph)
    // ------------------------------------------------------------------

    // Purple theme. Tiles and buttons are custom-drawn (ScriptUI can't
    // recolor native buttons), the panel background is painted, and
    // text is tinted lavender where the platform allows it.
    var COL = {
        panelBg:     [0.11, 0.09, 0.16, 1],
        tileBg:      [0.16, 0.13, 0.24, 1],
        tileBgHover: [0.22, 0.18, 0.33, 1],
        tileBgDown:  [0.28, 0.23, 0.42, 1],
        border:      [0.36, 0.30, 0.53, 1],
        borderHover: [0.64, 0.54, 0.92, 1],
        grid:        [0.21, 0.17, 0.31, 1],
        curve:       [0.73, 0.58, 1.00, 1],
        dot:         [0.99, 0.79, 0.42, 1],
        label:       [0.86, 0.83, 0.95, 1],
        btnBg:       [0.24, 0.19, 0.37, 1],
        btnBgHover:  [0.31, 0.25, 0.47, 1],
        btnBgDown:   [0.38, 0.31, 0.57, 1],
        btnText:     [0.91, 0.88, 1.00, 1],
        text:        [0.86, 0.83, 0.95, 1],
        muted:       [0.63, 0.58, 0.77, 1]
    };

    var TILE_FONT = null;

    function tileFont() {
        if (TILE_FONT === null) {
            try { TILE_FONT = ScriptUI.newFont("dialog", ScriptUI.FontStyle.REGULAR, 9); } catch (e) {}
        }
        return TILE_FONT;
    }

    // Cubic bezier control points for a value-graph segment shaped by
    // this ease. P0=(0,0), P3=(1,1); a null side is linear (handle lies
    // on the straight line at default length).
    function curveCP(inInf, outInf) {
        var p1x, p1y, p2x, p2y;
        if (outInf === null) { p1x = 1 / 3; p1y = 1 / 3; }
        else { p1x = outInf / 100; p1y = 0; }
        if (inInf === null) { p2x = 2 / 3; p2y = 2 / 3; }
        else { p2x = 1 - inInf / 100; p2y = 1; }
        return [p1x, p1y, p2x, p2y];
    }

    function bezXY(t, cp) {
        var mt = 1 - t;
        var a = 3 * mt * mt * t;
        var b = 3 * mt * t * t;
        var c = t * t * t;
        return [a * cp[0] + b * cp[2] + c, a * cp[1] + b * cp[3] + c];
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

    // Theme helpers. Both are best-effort: some platforms ignore
    // background/foreground overrides on native controls, so failures
    // must never break the panel.
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

    var BTN_FONT = null;

    function btnFont() {
        if (BTN_FONT === null) {
            try { BTN_FONT = ScriptUI.newFont("dialog", ScriptUI.FontStyle.REGULAR, 11); } catch (e) {}
        }
        return BTN_FONT;
    }

    // Flat purple button: same idea as the graph tiles — an iconbutton
    // drawn by hand, with hover and pressed states.
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

    // Attach a value-graph rendering to a control. getSpec() returns
    // {kind: "ease"|"linear"|"hold", inInf, outInf, label}
    function renderGraph(ctrl, getSpec) {
        ctrl.onDraw = function (drawState) {
            try {
                if (!this.size) return;
                var spec = getSpec();
                var g = this.graphics;
                var w = this.size.width;
                var h = this.size.height;
                var labelH = (spec.label === "") ? 0 : 12;
                var over = false, down = false;
                if (drawState) {
                    over = drawState.mouseOver === true;
                    down = drawState.leftButtonPressed === true;
                }
                var i;

                // background
                g.newPath();
                g.rectPath(0, 0, w, h);
                g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, down ? COL.tileBgDown : (over ? COL.tileBgHover : COL.tileBg)));

                // plot area
                var px = 6, py = 5;
                var pw = w - px * 2;
                var ph = h - labelH - py * 2;

                // grid thirds
                var gridPen = g.newPen(g.PenType.SOLID_COLOR, COL.grid, 1);
                for (i = 1; i <= 2; i++) {
                    g.newPath();
                    g.moveTo(px + pw * i / 3, py);
                    g.lineTo(px + pw * i / 3, py + ph);
                    g.strokePath(gridPen);
                    g.newPath();
                    g.moveTo(px, py + ph * i / 3);
                    g.lineTo(px + pw, py + ph * i / 3);
                    g.strokePath(gridPen);
                }

                // border
                g.newPath();
                g.rectPath(0, 0, w - 1, h - 1);
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, over ? COL.borderHover : COL.border, 1));

                // curve (bez tiles may overshoot 0..1, so normalize the
                // vertical range before mapping to pixels)
                var yMin = 0, yMax = 1;
                var curvePen = g.newPen(g.PenType.SOLID_COLOR, COL.curve, 2);
                g.newPath();
                if (spec.kind === "hold") {
                    g.moveTo(px, py + ph);
                    g.lineTo(px + pw * 0.55, py + ph);
                    g.lineTo(px + pw * 0.55, py);
                    g.lineTo(px + pw, py);
                } else {
                    var cp = (spec.kind === "bez" && spec.cp) ? spec.cp : curveCP(spec.inInf, spec.outInf);
                    var pts = [];
                    for (i = 0; i <= 24; i++) {
                        var pt = bezXY(i / 24, cp);
                        pts.push(pt);
                        if (pt[1] < yMin) yMin = pt[1];
                        if (pt[1] > yMax) yMax = pt[1];
                    }
                    var ySpan = yMax - yMin;
                    g.moveTo(px + pts[0][0] * pw, py + (1 - (pts[0][1] - yMin) / ySpan) * ph);
                    for (i = 1; i <= 24; i++) {
                        g.lineTo(px + pts[i][0] * pw, py + (1 - (pts[i][1] - yMin) / ySpan) * ph);
                    }
                }
                g.strokePath(curvePen);

                // keyframe dots (at the mapped 0 and 1 values)
                var dotBrush = g.newBrush(g.BrushType.SOLID_COLOR, COL.dot);
                var dotY0 = py + (1 - (0 - yMin) / (yMax - yMin)) * ph;
                var dotY1 = py + (1 - (1 - yMin) / (yMax - yMin)) * ph;
                g.newPath();
                g.ellipsePath(px - 2.5, dotY0 - 2.5, 5, 5);
                g.fillPath(dotBrush);
                g.newPath();
                g.ellipsePath(px + pw - 2.5, dotY1 - 2.5, 5, 5);
                g.fillPath(dotBrush);

                // label
                if (labelH > 0) {
                    var f = tileFont();
                    var tw = spec.label.length * 4.5;
                    try { tw = g.measureString(spec.label, f).width; } catch (eM) {}
                    var tx = (w - tw) / 2;
                    if (tx < 2) tx = 2;
                    g.drawString(spec.label, g.newPen(g.PenType.SOLID_COLOR, COL.label, 1), tx, h - labelH - 1, f);
                }
            } catch (eDraw) {}
        };
    }

    // ------------------------------------------------------------------
    // Preset definitions \u2014 one tile per graph shape
    // ------------------------------------------------------------------

    var PRESETS = [
        { label: "Linear", kind: "linear", inInf: null, outInf: null,
          tip: "Linear \u2014 straight-line interpolation, no ease" },
        { label: "Hold", kind: "hold", inInf: null, outInf: null,
          tip: "Hold \u2014 freeze the value until the next keyframe" },
        { label: "Easy Ease", kind: "ease", inInf: 33.3333, outInf: 33.3333,
          tip: "Easy Ease \u2014 the classic F9 curve (33% in / 33% out)" },

        { label: "Smooth", kind: "ease", inInf: 75, outInf: 75,
          tip: "Smooth \u2014 softer drift (75% in / 75% out)" },
        { label: "Buttery", kind: "ease", inInf: 90, outInf: 90,
          tip: "Buttery \u2014 very floaty, steep middle (90% in / 90% out)" },
        { label: "Snappy", kind: "ease", inInf: 90, outInf: 10,
          tip: "Snappy \u2014 leaves fast, lands soft (90% in / 10% out). The \"modern app motion\" curve." },

        { label: "Ease In", kind: "ease", inInf: 75, outInf: null,
          tip: "Ease In \u2014 soft landing into each keyframe only (75% in, outgoing stays linear)" },
        { label: "Ease Out", kind: "ease", inInf: null, outInf: 75,
          tip: "Ease Out \u2014 soft launch out of each keyframe only (75% out, incoming stays linear)" },
        { label: "Wind Up", kind: "ease", inInf: 15, outInf: 85,
          tip: "Wind Up \u2014 leaves slow, arrives fast (15% in / 85% out)" },

        { label: "Deep In", kind: "ease", inInf: 95, outInf: null,
          tip: "Deep In \u2014 long floaty landing (95% in, outgoing stays linear)" },
        { label: "Deep Out", kind: "ease", inInf: null, outInf: 95,
          tip: "Deep Out \u2014 long floaty launch (95% out, incoming stays linear)" },
        { label: "Whip", kind: "ease", inInf: 97, outInf: 3,
          tip: "Whip \u2014 near-instant move, long settle (97% in / 3% out)" }
    ];

    // Flow-style cubic-bezier graph pack. S-Curve and Fast In are the
    // exact values shown in the reference video; the rest are the
    // canonical curves those packs are built from.
    var BEZ_PRESETS = [
        { label: "Fast In", kind: "bez", cp: [1, 0, 1, 0],
          tip: "Fast In - cubic-bezier(1, 0, 1, 0): crawls, then whips into the key at full speed" },
        { label: "In", kind: "bez", cp: [0.5, 0, 1, 1],
          tip: "In - cubic-bezier(0.5, 0, 1, 1): accelerates smoothly, arrives moving" },
        { label: "S-Curve", kind: "bez", cp: [0.71, 0, 0.29, 1],
          tip: "S-Curve - cubic-bezier(0.71, 0, 0.29, 1): the classic clean S" },
        { label: "Fast Out", kind: "bez", cp: [0.16, 1, 0.3, 1],
          tip: "Fast Out - cubic-bezier(0.16, 1, 0.3, 1): launches at full speed, long glide to rest" },
        { label: "Out", kind: "bez", cp: [0, 0, 0.58, 1],
          tip: "Out - cubic-bezier(0, 0, 0.58, 1): springs out, decelerates smoothly" },
        { label: "Norm S", kind: "bez", cp: [0.645, 0.045, 0.355, 1],
          tip: "Norm S - cubic-bezier(0.645, 0.045, 0.355, 1): gentler everyday S" },
        { label: "Tight S", kind: "bez", cp: [0.9, 0, 0.1, 1],
          tip: "Tight S - cubic-bezier(0.9, 0, 0.1, 1): long holds, fast middle" },
        { label: "Tightest", kind: "bez", cp: [1, 0, 0, 1],
          tip: "Tightest S - cubic-bezier(1, 0, 0, 1): maximum-tension S, all the motion in the middle" },
        { label: "Front S", kind: "bez", cp: [0.2, 0, 0.1, 1],
          tip: "Front S - cubic-bezier(0.2, 0, 0.1, 1): action up front, extra-long soft landing" }
    ];

    // ------------------------------------------------------------------
    // UI
    // ------------------------------------------------------------------

    function clampNum(text, def, min, max) {
        var v = parseFloat(text);
        if (isNaN(v)) v = def;
        if (v < min) v = min;
        if (v > max) v = max;
        return v;
    }

    function buildUI(host) {
        var pal = (host instanceof Panel) ? host : new Window("palette", SCRIPT_NAME, undefined, { resizeable: true });

        pal.orientation = "column";
        pal.alignChildren = ["fill", "top"];
        pal.spacing = 6;
        pal.margins = 8;
        paintBG(pal, COL.panelBg);

        var tp = pal.add("tabbedpanel");
        tp.alignChildren = ["fill", "top"];
        tp.alignment = ["fill", "top"];
        tp.margins = 6;
        paintBG(tp, COL.panelBg);

        function makeTab(title) {
            var t = tp.add("tab", undefined, title);
            t.orientation = "column";
            t.alignChildren = ["fill", "top"];
            t.spacing = 5;
            t.margins = 8;
            paintBG(t, COL.panelBg);
            return t;
        }

        function row(parent) {
            var g = parent.add("group");
            g.orientation = "row";
            g.alignChildren = ["fill", "center"];
            g.alignment = ["fill", "top"];
            g.spacing = 4;
            return g;
        }

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

        function sliderRow(parent, labelTxt, def, changed) {
            var g = row(parent);
            g.alignChildren = ["left", "center"];
            var st = g.add("statictext", undefined, labelTxt);
            st.preferredSize.width = 24;
            tintText(st, COL.text);
            var sl = g.add("slider", undefined, def, 1, 100);
            sl.alignment = ["fill", "center"];
            var et = g.add("edittext", undefined, String(def));
            et.characters = 4;
            tintText(et, COL.text);
            sl.onChanging = function () {
                et.text = String(Math.round(sl.value));
                if (changed) changed();
            };
            et.onChange = function () {
                var v = clampNum(et.text, def, 1, 100);
                et.text = String(Math.round(v));
                sl.value = v;
                if (changed) changed();
            };
            return {
                value: function () {
                    return Math.max(1, Math.min(100, Math.round(sl.value)));
                }
            };
        }

        // ---- Tab 1: Ease (graph tiles) -------------------------------

        var tEase = makeTab("Ease");

        function makeTile(parent, preset) {
            var c = parent.add("iconbutton", undefined, undefined, { style: "toolbutton" });
            c.preferredSize = [58, 48];
            c.helpTip = preset.tip;
            renderGraph(c, function () { return preset; });
            hoverRepaint(c);
            c.onClick = function () {
                if (preset.kind === "hold") applyHold();
                else if (preset.kind === "linear") applyLinear();
                else if (preset.kind === "bez") applyBezier(preset.cp[0], preset.cp[1], preset.cp[2], preset.cp[3], preset.label);
                else applyEase(preset.inInf, preset.outInf, preset.label);
            };
            return c;
        }

        var tileRow = null;
        for (var pi = 0; pi < PRESETS.length; pi++) {
            if (pi % 3 === 0) {
                tileRow = tEase.add("group");
                tileRow.orientation = "row";
                tileRow.spacing = 4;
                tileRow.alignment = ["center", "top"];
            }
            makeTile(tileRow, PRESETS[pi]);
        }

        // ---- Tab 2: Flow (cubic-bezier graph pack) -------------------

        var tFlow = makeTab("Flow");

        var flowRow = null;
        for (var bi = 0; bi < BEZ_PRESETS.length; bi++) {
            if (bi % 3 === 0) {
                flowRow = tFlow.add("group");
                flowRow.orientation = "row";
                flowRow.spacing = 4;
                flowRow.alignment = ["center", "top"];
            }
            makeTile(flowRow, BEZ_PRESETS[bi]);
        }

        var rbz = row(tFlow);
        rbz.alignChildren = ["left", "center"];
        var stBez = rbz.add("statictext", undefined, "bez");
        tintText(stBez, COL.text);
        var bzX1 = rbz.add("edittext", undefined, "0.71");
        var bzY1 = rbz.add("edittext", undefined, "0");
        var bzX2 = rbz.add("edittext", undefined, "0.29");
        var bzY2 = rbz.add("edittext", undefined, "1");
        bzX1.characters = 4; bzY1.characters = 4; bzX2.characters = 4; bzY2.characters = 4;
        tintText(bzX1, COL.text); tintText(bzY1, COL.text); tintText(bzX2, COL.text); tintText(bzY2, COL.text);
        bzX1.helpTip = "x1 (0..1)"; bzY1.helpTip = "y1 (-3..3, past 0/1 = overshoot)";
        bzX2.helpTip = "x2 (0..1)"; bzY2.helpTip = "y2 (-3..3, past 0/1 = overshoot)";

        function bzCP() {
            return [clampNum(bzX1.text, 0.71, 0, 1), clampNum(bzY1.text, 0, -3, 3),
                    clampNum(bzX2.text, 0.29, 0, 1), clampNum(bzY2.text, 1, -3, 3)];
        }

        var rbz2 = row(tFlow);
        var bzPrev = rbz2.add("iconbutton", undefined, undefined, { style: "toolbutton" });
        bzPrev.preferredSize = [58, 40];
        bzPrev.helpTip = "Live preview of the cubic-bezier above - click to apply it";
        renderGraph(bzPrev, function () {
            return { kind: "bez", cp: bzCP(), label: "" };
        });
        hoverRepaint(bzPrev);
        function bzRepaint() {
            try { bzPrev.notify("onDraw"); } catch (e) {}
        }
        bzX1.onChange = bzRepaint; bzY1.onChange = bzRepaint;
        bzX2.onChange = bzRepaint; bzY2.onChange = bzRepaint;
        function bzApply() {
            var cp = bzCP();
            applyBezier(cp[0], cp[1], cp[2], cp[3], "Custom Bezier");
        }
        bzPrev.onClick = bzApply;
        btn(rbz2, "Apply Bezier", "Applies the cubic-bezier above to the selected segments. Type any curve from any tutorial or cheat sheet.", bzApply);

        var stFlowHint = tFlow.add("statictext", undefined, "Applies to pairs of consecutive keys.");
        try { stFlowHint.graphics.font = ScriptUI.newFont(stFlowHint.graphics.font.name, ScriptUI.FontStyle.ITALIC, 9); } catch (eF5) {}
        tintText(stFlowHint, COL.muted);

        // ---- Tab 3: Custom (sliders + live preview) ------------------

        var tCustom = makeTab("Custom");

        var preview = tCustom.add("iconbutton", undefined, undefined, { style: "toolbutton" });
        preview.preferredSize = [120, 66];
        preview.alignment = ["center", "top"];
        preview.helpTip = "Live preview of the custom ease \u2014 click to apply it";

        function refreshPreview() {
            try { preview.notify("onDraw"); } catch (e) {}
        }

        var inCtl = sliderRow(tCustom, "In", 75, refreshPreview);
        var outCtl = sliderRow(tCustom, "Out", 25, refreshPreview);

        renderGraph(preview, function () {
            return { kind: "ease", inInf: inCtl.value(), outInf: outCtl.value(),
                     label: "in " + inCtl.value() + "%  /  out " + outCtl.value() + "%" };
        });
        preview.onClick = function () {
            applyEase(inCtl.value(), outCtl.value(), "Custom Ease");
        };
        hoverRepaint(preview);

        var rc = row(tCustom);
        btn(rc, "Apply", "Applies the In/Out influence above to the selection",
            function () { applyEase(inCtl.value(), outCtl.value(), "Custom Ease"); });

        var rcp = row(tCustom);
        btn(rcp, "Copy Ease", "Copies the ease (influence + speed) from the first selected keyframe",
            copyEase);
        btn(rcp, "Paste Ease", "Pastes the copied ease onto the selection",
            pasteEase);

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
