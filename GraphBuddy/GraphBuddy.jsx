/**********************************************************************
 GraphBuddy.jsx  \u2014  one-click graph editor eases for After Effects
 v4.1  (Flow tab: cubic-bezier graph pack applied per segment with
        computed keyframe speeds, plus a type-any-bezier input.
        Morph tab since v4.0; render-safe FX expressions since v3.1.)

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
    // temporal easing (that's how eased morphs work).
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
    // Morph engine
    //
    // Path morph (shape layers / masked layers): AE natively tweens
    // path keyframes, so we keyframe the start layer's path from its
    // own shape to the end layer's shape, plus transform / fill /
    // opacity, and hide the end layer. Anything without a bezier path
    // (text, footage, precomps) gets a blend morph instead: both
    // layers travel together while crossfading.
    // ------------------------------------------------------------------

    var morphStart = null;
    var morphEnd = null;

    function grabSelectedLayer() {
        var comp = activeComp();
        if (comp === null) { setStatus("Open a composition first."); return null; }
        var sel = comp.selectedLayers;
        if (sel.length !== 1) { setStatus("Select exactly one layer first."); return null; }
        return sel[0];
    }

    // First free-form (bezier) path inside a shape layer's contents
    function findVectorPath(group) {
        var n = 0;
        try { n = group.numProperties; } catch (e) { return null; }
        for (var i = 1; i <= n; i++) {
            var p = null;
            try { p = group.property(i); } catch (e2) { p = null; }
            if (p === null) continue;
            if (p.matchName === "ADBE Vector Shape - Group") {
                try { return p.property("ADBE Vector Shape"); } catch (e3) {}
            } else if (p.propertyType !== PropertyType.PROPERTY) {
                var r = findVectorPath(p);
                if (r !== null) return r;
            }
        }
        return null;
    }

    function findFillColorIn(group) {
        var n = 0;
        try { n = group.numProperties; } catch (e) { return null; }
        for (var i = 1; i <= n; i++) {
            var p = null;
            try { p = group.property(i); } catch (e2) { p = null; }
            if (p === null) continue;
            if (p.matchName === "ADBE Vector Graphic - Fill") {
                try { return p.property("ADBE Vector Fill Color"); } catch (e3) {}
            } else if (p.propertyType !== PropertyType.PROPERTY) {
                var r = findFillColorIn(p);
                if (r !== null) return r;
            }
        }
        return null;
    }

    // Morphable path: first bezier shape path, else first mask path.
    // Parametric shapes (Rectangle/Ellipse Path) have no bezier path \u2014
    // right-click the path in the timeline > Convert To Bezier Path.
    function findMorphPath(layer) {
        var contents = null;
        try { contents = layer.property("ADBE Root Vectors Group"); } catch (e) {}
        if (contents !== null && contents !== undefined) {
            var p = findVectorPath(contents);
            if (p !== null) return p;
        }
        var masks = null;
        try { masks = layer.property("ADBE Mask Parade"); } catch (e2) {}
        if (masks !== null && masks !== undefined && masks.numProperties > 0) {
            try { return masks.property(1).property("ADBE Mask Shape"); } catch (e3) {}
        }
        return null;
    }

    function findLayerFillColor(layer) {
        var contents = null;
        try { contents = layer.property("ADBE Root Vectors Group"); } catch (e) {}
        if (contents === null || contents === undefined) return null;
        return findFillColorIn(contents);
    }

    function valuesDiffer(a, b) {
        if (a instanceof Array && b instanceof Array) {
            if (a.length !== b.length) return true;
            for (var i = 0; i < a.length; i++) {
                if (Math.abs(a[i] - b[i]) > 0.0001) return true;
            }
            return false;
        }
        if (typeof a === "number" && typeof b === "number") {
            return Math.abs(a - b) > 0.0001;
        }
        return true;
    }

    function morphKeyPair(prop, t0, v0, t1, v1, list) {
        try {
            prop.setValueAtTime(t0, v0);
            prop.setValueAtTime(t1, v1);
            list.push(prop);
            return true;
        } catch (e) {
            return false;
        }
    }

    // Keys `layer`'s transform from its own values at t0 to `target`'s
    // values at t1, so it lands exactly where the target sits
    function addTransformMorph(layer, target, t0, t1, includeAnchor, list) {
        var tfA = null, tfB = null;
        try { tfA = layer.transform; tfB = target.transform; } catch (e) { return; }
        var v0, v1;

        try {
            v1 = tfB.position.valueAtTime(t1, false);
            if (tfA.position.dimensionsSeparated) {
                var px = tfA.property("ADBE Position_0");
                var py = tfA.property("ADBE Position_1");
                morphKeyPair(px, t0, px.valueAtTime(t0, false), t1, v1[0], list);
                morphKeyPair(py, t0, py.valueAtTime(t0, false), t1, v1[1], list);
            } else {
                v0 = tfA.position.valueAtTime(t0, false);
                if (valuesDiffer(v0, v1)) morphKeyPair(tfA.position, t0, v0, t1, v1, list);
            }
        } catch (ePos) {}

        try {
            v0 = tfA.scale.valueAtTime(t0, false);
            v1 = tfB.scale.valueAtTime(t1, false);
            if (valuesDiffer(v0, v1)) morphKeyPair(tfA.scale, t0, v0, t1, v1, list);
        } catch (eScl) {}

        try {
            v0 = tfA.rotation.valueAtTime(t0, false);
            v1 = tfB.rotation.valueAtTime(t1, false);
            if (valuesDiffer(v0, v1)) morphKeyPair(tfA.rotation, t0, v0, t1, v1, list);
        } catch (eRot) {}

        if (includeAnchor) {
            try {
                v0 = tfA.anchorPoint.valueAtTime(t0, false);
                v1 = tfB.anchorPoint.valueAtTime(t1, false);
                if (valuesDiffer(v0, v1)) morphKeyPair(tfA.anchorPoint, t0, v0, t1, v1, list);
            } catch (eAnc) {}
        }
    }

    function deselectAllKeys(comp) {
        try {
            var props = comp.selectedProperties;
            for (var i = 0; i < props.length; i++) {
                var p = props[i];
                if (p.propertyType !== PropertyType.PROPERTY) continue;
                var sel = p.selectedKeys;
                if (sel === null) continue;
                for (var j = sel.length - 1; j >= 0; j--) {
                    try { p.setSelectedAtKey(sel[j], false); } catch (e2) {}
                }
            }
        } catch (e) {}
    }

    // Ease the two morph keys (ez = {inInf, outInf} or null = linear)
    // and leave them selected so any graph tile can restyle them
    function easeMorphKeys(prop, t0, t1, ez) {
        try {
            var k0 = prop.nearestKeyIndex(t0);
            var k1 = prop.nearestKeyIndex(t1);
            if (ez !== null) {
                var B = KeyframeInterpolationType.BEZIER;
                var n = easeDim(prop, k0);
                var ki;
                for (var idx = 0; idx < 2; idx++) {
                    ki = (idx === 0) ? k0 : k1;
                    try {
                        prop.setTemporalEaseAtKey(ki,
                            easeArray(n, 0, ez.inInf), easeArray(n, 0, ez.outInf));
                        prop.setInterpolationTypeAtKey(ki, B, B);
                    } catch (eEz) {}
                }
            }
            prop.setSelectedAtKey(k0, true);
            prop.setSelectedAtKey(k1, true);
        } catch (e) {}
    }

    function doMorph(durSec, ez) {
        var comp = activeComp();
        if (comp === null) { setStatus("Open a composition first."); return; }

        var A = morphStart;
        var B = morphEnd;
        if (A === null || B === null) {
            var sel = comp.selectedLayers;
            if (sel.length === 2) { A = sel[0]; B = sel[1]; }
        }
        if (A === null || B === null) {
            setStatus("Set Start + End layers (or select exactly 2 layers).");
            return;
        }

        var nmA, nmB;
        try {
            nmA = A.name;
            nmB = B.name;
            if (A.containingComp.id !== comp.id || B.containingComp.id !== comp.id) {
                setStatus("Start/End layers aren't in the active comp.");
                return;
            }
        } catch (eGone) {
            morphStart = null;
            morphEnd = null;
            setStatus("A captured layer was deleted \u2014 set Start/End again.");
            return;
        }
        if (A.index === B.index) {
            setStatus("Start and End must be different layers.");
            return;
        }

        var t0 = comp.time;
        var t1 = t0 + durSec;
        var keyed = [];
        var mode;

        app.beginUndoGroup(SCRIPT_NAME + ": Morph");
        try {
            var pathA = findMorphPath(A);
            var pathB = findMorphPath(B);
            if (pathA !== null && pathB !== null) {
                mode = "path morph";
                morphKeyPair(pathA, t0, pathA.valueAtTime(t0, false), t1, pathB.valueAtTime(t1, false), keyed);
                var fillA = findLayerFillColor(A);
                var fillB = findLayerFillColor(B);
                if (fillA !== null && fillB !== null &&
                    valuesDiffer(fillA.valueAtTime(t0, false), fillB.valueAtTime(t1, false))) {
                    morphKeyPair(fillA, t0, fillA.valueAtTime(t0, false), t1, fillB.valueAtTime(t1, false), keyed);
                }
                try {
                    var opA0 = A.transform.opacity.valueAtTime(t0, false);
                    var opB1 = B.transform.opacity.valueAtTime(t1, false);
                    if (valuesDiffer(opA0, opB1)) {
                        morphKeyPair(A.transform.opacity, t0, opA0, t1, opB1, keyed);
                    }
                } catch (eOp) {}
                addTransformMorph(A, B, t0, t1, true, keyed);
                B.enabled = false;
            } else {
                mode = "blend morph";
                addTransformMorph(A, B, t0, t1, false, keyed);
                addTransformMorph(B, A, t1, t0, false, keyed);
                try {
                    var oA = A.transform.opacity;
                    morphKeyPair(oA, t0, oA.valueAtTime(t0, false), t1, 0, keyed);
                } catch (eOa) {}
                try {
                    var oB = B.transform.opacity;
                    var endOp = oB.valueAtTime(t1, false);
                    morphKeyPair(oB, t0, 0, t1, (endOp > 0) ? endOp : 100, keyed);
                    B.enabled = true;
                } catch (eOb) {}
            }

            if (keyed.length > 0) {
                deselectAllKeys(comp);
                for (var i = 0; i < keyed.length; i++) {
                    easeMorphKeys(keyed[i], t0, t1, ez);
                }
            }
        } finally {
            app.endUndoGroup();
        }

        if (keyed.length === 0) {
            setStatus("Morph made no keys \u2014 check the layers (see tooltip on Morph).");
        } else {
            setStatus("Morph " + nmA + " \u2192 " + nmB + " (" + mode + ", " + keyed.length +
                      " props). Keys selected \u2014 restyle with any graph tile.");
        }
    }

    // ------------------------------------------------------------------
    // Expressions (loops, motion FX)
    // ------------------------------------------------------------------

    // Recursively collect properties that currently carry an expression
    // (used by Clear FX so keyless wiggles are found too)
    function collectExpressioned(group, out) {
        var n = 0;
        try { n = group.numProperties; } catch (e) { n = 0; }
        for (var i = 1; i <= n; i++) {
            var p = null;
            try { p = group.property(i); } catch (e2) { p = null; }
            if (p === null) continue;
            if (p.propertyType === PropertyType.PROPERTY) {
                var hasExpr = false;
                try { hasExpr = p.canSetExpression && p.expression !== ""; } catch (e3) {}
                if (hasExpr) out.push(p);
            } else {
                collectExpressioned(p, out);
            }
        }
    }

    // Properties expressions can be applied to, with the same smart
    // fallback: selected properties first, then selected layers.
    // minKeys: minimum keyframes required (loops need 2).
    // expressionedOnly: layer fallback targets only properties that
    // already carry an expression (Clear FX).
    function expressionTargets(minKeys, expressionedOnly) {
        var comp = activeComp();
        if (comp === null) return { error: "Open a composition first.", props: [] };

        var out = [];
        var props = comp.selectedProperties;
        var i;
        var sawLeaf = false;
        for (i = 0; i < props.length; i++) {
            var p = props[i];
            if (p.propertyType !== PropertyType.PROPERTY) continue;
            sawLeaf = true;
            if (!p.canSetExpression) continue;
            if (p.numKeys < minKeys) continue;
            out.push(p);
        }
        // Only fall back to the whole layer when the user selected layers,
        // not when their explicit property selection was simply unusable
        // (selecting a property also selects its layer).
        if (out.length === 0 && !sawLeaf) {
            var layers = comp.selectedLayers;
            for (i = 0; i < layers.length; i++) {
                var found = [];
                if (expressionedOnly) collectExpressioned(layers[i], found);
                else collectAnimated(layers[i], found);
                for (var j = 0; j < found.length; j++) {
                    var q = found[j];
                    if (!q.canSetExpression) continue;
                    if (!expressionedOnly && q.numKeys < minKeys) continue;
                    out.push(q);
                }
            }
        }
        if (out.length === 0) {
            var msg;
            if (expressionedOnly) msg = "No expressions found on the selection.";
            else if (minKeys >= 2) msg = "Loops need a property with at least 2 keyframes.";
            else if (minKeys >= 1) msg = "Select a keyframed property (or an animated layer) first.";
            else msg = "Select a property (or an animated layer) first.";
            return { error: msg, props: [] };
        }
        return { props: out };
    }

    function applyExpression(expr, label, minKeys) {
        var res = expressionTargets(minKeys, expr === "");
        if (res.error) { setStatus(res.error); return; }

        var count = 0;
        app.beginUndoGroup(SCRIPT_NAME + ": " + label);
        try {
            for (var i = 0; i < res.props.length; i++) {
                try {
                    res.props[i].expression = expr;
                    count++;
                } catch (e) {}
            }
        } finally {
            app.endUndoGroup();
        }
        setStatus(label + " \u2192 " + count + (count === 1 ? " property" : " properties"));
    }

    // ---- Motion FX expressions (based on Dan Ebberts' classic formulas)

    // A render error in a headless render (Media Encoder / aerender)
    // silently disables the expression for the whole render, so every
    // FX expression is wrapped to fall back to the plain keyframe value.
    var EXPR_OVERSHOOT =
        "// GraphBuddy overshoot: shoots past the last keyframe, then settles\n" +
        "amp = 0.06;   // overshoot amount\n" +
        "freq = 2.2;   // oscillations per second\n" +
        "decay = 4.5;  // settle speed\n" +
        "try {\n" +
        "  n = 0;\n" +
        "  if (numKeys > 0) {\n" +
        "    n = nearestKey(time).index;\n" +
        "    if (key(n).time > time) n--;\n" +
        "  }\n" +
        "  if (n == 0) {\n" +
        "    value;\n" +
        "  } else {\n" +
        "    t = time - key(n).time;\n" +
        "    v = velocityAtTime(key(n).time - thisComp.frameDuration / 10);\n" +
        "    value + v * amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);\n" +
        "  }\n" +
        "} catch (err) {\n" +
        "  value;\n" +
        "}";

    var EXPR_BOUNCE =
        "// GraphBuddy bounce: bounces to rest after the last keyframe\n" +
        "// (works best when motion arrives at the last key with some speed)\n" +
        "e = 0.7;    // bounciness (0..1)\n" +
        "g = 5000;   // gravity\n" +
        "nMax = 9;   // max bounces\n" +
        "try {\n" +
        "  n = 0;\n" +
        "  if (numKeys > 0) {\n" +
        "    n = nearestKey(time).index;\n" +
        "    if (key(n).time > time) n--;\n" +
        "  }\n" +
        "  if (n > 0) {\n" +
        "    t = time - key(n).time;\n" +
        "    v = -velocityAtTime(key(n).time - 0.001) * e;\n" +
        "    vl = length(v);\n" +
        "    if (value instanceof Array) {\n" +
        "      vu = (vl > 0) ? normalize(v) : [0, 0, 0];\n" +
        "    } else {\n" +
        "      vu = (v < 0) ? -1 : 1;\n" +
        "    }\n" +
        "    tCur = 0;\n" +
        "    segDur = 2 * vl / g;\n" +
        "    tNext = segDur;\n" +
        "    nb = 1;\n" +
        "    while (tNext < t && nb <= nMax) {\n" +
        "      vl *= e;\n" +
        "      segDur *= e;\n" +
        "      tCur = tNext;\n" +
        "      tNext += segDur;\n" +
        "      nb++;\n" +
        "    }\n" +
        "    if (nb <= nMax) {\n" +
        "      delta = t - tCur;\n" +
        "      value + vu * delta * (vl - g * delta / 2);\n" +
        "    } else {\n" +
        "      value;\n" +
        "    }\n" +
        "  } else {\n" +
        "    value;\n" +
        "  }\n" +
        "} catch (err) {\n" +
        "  value;\n" +
        "}";

    // Loop expressions self-guard: loopOut() errors on fewer than 2 keys,
    // and if the user later deletes keys, an unguarded loop would break
    // the render. The guard makes it degrade to the plain value instead.
    function loopExpr(type) {
        return "if (numKeys >= 2) loopOut(\"" + type + "\"); else value;";
    }

    // ------------------------------------------------------------------
    // Graph tile drawing (each preset button draws its value graph)
    // ------------------------------------------------------------------

    var COL = {
        tileBg:      [0.13, 0.14, 0.19, 1],
        tileBgHover: [0.19, 0.21, 0.29, 1],
        tileBgDown:  [0.23, 0.26, 0.36, 1],
        border:      [0.32, 0.34, 0.44, 1],
        borderHover: [0.55, 0.60, 0.80, 1],
        grid:        [0.20, 0.22, 0.29, 1],
        curve:       [0.95, 0.42, 0.34, 1],
        dot:         [0.98, 0.80, 0.25, 1],
        label:       [0.82, 0.84, 0.88, 1]
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

        var tp = pal.add("tabbedpanel");
        tp.alignChildren = ["fill", "top"];
        tp.alignment = ["fill", "top"];
        tp.margins = 6;

        function makeTab(title) {
            var t = tp.add("tab", undefined, title);
            t.orientation = "column";
            t.alignChildren = ["fill", "top"];
            t.spacing = 5;
            t.margins = 8;
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
            var b = parent.add("button", undefined, label);
            b.helpTip = tip;
            b.alignment = ["fill", "center"];
            b.preferredSize.height = 22;
            b.onClick = fn;
            return b;
        }

        function sliderRow(parent, labelTxt, def, changed) {
            var g = row(parent);
            g.alignChildren = ["left", "center"];
            var st = g.add("statictext", undefined, labelTxt);
            st.preferredSize.width = 24;
            var sl = g.add("slider", undefined, def, 1, 100);
            sl.alignment = ["fill", "center"];
            var et = g.add("edittext", undefined, String(def));
            et.characters = 4;
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
        rbz.add("statictext", undefined, "bez");
        var bzX1 = rbz.add("edittext", undefined, "0.71");
        var bzY1 = rbz.add("edittext", undefined, "0");
        var bzX2 = rbz.add("edittext", undefined, "0.29");
        var bzY2 = rbz.add("edittext", undefined, "1");
        bzX1.characters = 4; bzY1.characters = 4; bzX2.characters = 4; bzY2.characters = 4;
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

        // ---- Tab 3: Morph --------------------------------------------

        var tMorph = makeTab("Morph");

        var MORPH_EASES = {
            "Smooth": { inInf: 75, outInf: 75 },
            "Easy Ease": { inInf: 33.3333, outInf: 33.3333 },
            "Snappy": { inInf: 90, outInf: 10 },
            "Buttery": { inInf: 90, outInf: 90 },
            "Linear": null
        };

        var rms = row(tMorph);
        rms.alignChildren = ["left", "center"];
        var bStart = rms.add("button", undefined, "Set Start");
        bStart.preferredSize = [74, 22];
        bStart.helpTip = "Select ONE layer in the timeline, then click to capture it as the morph start";
        var stStart = rms.add("statictext", undefined, "\u2014 none \u2014");
        stStart.alignment = ["fill", "center"];

        var rme = row(tMorph);
        rme.alignChildren = ["left", "center"];
        var bEnd = rme.add("button", undefined, "Set End");
        bEnd.preferredSize = [74, 22];
        bEnd.helpTip = "Select ONE layer in the timeline, then click to capture it as the morph target";
        var stEnd = rme.add("statictext", undefined, "\u2014 none \u2014");
        stEnd.alignment = ["fill", "center"];

        bStart.onClick = function () {
            var l = grabSelectedLayer();
            if (l === null) return;
            morphStart = l;
            stStart.text = l.name;
            setStatus("Morph start: " + l.name);
        };
        bEnd.onClick = function () {
            var l = grabSelectedLayer();
            if (l === null) return;
            morphEnd = l;
            stEnd.text = l.name;
            setStatus("Morph end: " + l.name);
        };

        var rmo = row(tMorph);
        rmo.alignChildren = ["left", "center"];
        rmo.add("statictext", undefined, "Dur");
        var durEt = rmo.add("edittext", undefined, "1.0");
        durEt.characters = 4;
        durEt.helpTip = "Morph duration in seconds, starting at the current time indicator";
        durEt.onChange = function () { durEt.text = String(clampNum(durEt.text, 1, 0.05, 60)); };
        rmo.add("statictext", undefined, "s");
        var ddEase = rmo.add("dropdownlist", undefined,
            ["Smooth", "Easy Ease", "Snappy", "Buttery", "Linear"]);
        ddEase.selection = 0;
        ddEase.alignment = ["fill", "center"];
        ddEase.helpTip = "Ease applied to the morph keyframes (they stay selected, so any graph tile can restyle them after)";

        var rmg = row(tMorph);
        var bMorph = rmg.add("button", undefined, "Morph  \u25B6");
        bMorph.alignment = ["fill", "center"];
        bMorph.preferredSize.height = 26;
        bMorph.helpTip = "Morphs Start into End from the current time.\n\n" +
            "Shape/masked layers: true path morph (path, fill color, transform; the End layer is hidden).\n" +
            "Anything else (text, footage, precomps): blend morph \u2014 both layers travel together while crossfading.\n\n" +
            "Parametric shapes need a bezier path first: right-click the shape's path \u2192 Convert To Bezier Path.\n" +
            "Multi-mask layers morph the first mask. Cleanest path morphs: similar point counts, unparented layers.";
        bMorph.onClick = function () {
            var d = clampNum(durEt.text, 1, 0.05, 60);
            durEt.text = String(d);
            var ez = (ddEase.selection !== null) ? MORPH_EASES[ddEase.selection.text] : MORPH_EASES["Smooth"];
            doMorph(d, ez);
        };

        var stMorphHint = tMorph.add("statictext", undefined, "Or select 2 layers (first = start) and click Morph.");
        try { stMorphHint.graphics.font = ScriptUI.newFont(stMorphHint.graphics.font.name, ScriptUI.FontStyle.ITALIC, 9); } catch (eF4) {}

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

        // ---- Tab 4: FX (loops + expressions) -------------------------

        var tFx = makeTab("FX");

        var lblLoop = tFx.add("statictext", undefined, "Loop (needs 2+ keys)");
        try { lblLoop.graphics.font = ScriptUI.newFont(lblLoop.graphics.font.name, ScriptUI.FontStyle.BOLD, 10); } catch (eF1) {}

        var r4 = row(tFx);
        btn(r4, "Cycle", "loopOut(\"cycle\") \u2014 repeats the keyframes forever",
            function () { applyExpression(loopExpr("cycle"), "Loop Cycle", 2); });
        btn(r4, "Ping-Pong", "loopOut(\"pingpong\") \u2014 plays forward then backward, forever",
            function () { applyExpression(loopExpr("pingpong"), "Loop Ping-Pong", 2); });

        var r5 = row(tFx);
        btn(r5, "Offset", "loopOut(\"offset\") \u2014 repeats while adding the last value each cycle",
            function () { applyExpression(loopExpr("offset"), "Loop Offset", 2); });
        btn(r5, "Continue", "loopOut(\"continue\") \u2014 keeps moving at the last keyframe's speed",
            function () { applyExpression(loopExpr("continue"), "Loop Continue", 2); });

        var lblFx = tFx.add("statictext", undefined, "Motion FX");
        try { lblFx.graphics.font = ScriptUI.newFont(lblFx.graphics.font.name, ScriptUI.FontStyle.BOLD, 10); } catch (eF2) {}

        var r6 = row(tFx);
        btn(r6, "Overshoot", "Expression: shoots past the final keyframe and springs back. Best on Position / Scale / Rotation.",
            function () { applyExpression(EXPR_OVERSHOOT, "Overshoot", 1); });
        btn(r6, "Bounce", "Expression: bounces to rest after the final keyframe. Works best when motion arrives with speed (Linear or Snappy out).",
            function () { applyExpression(EXPR_BOUNCE, "Bounce", 1); });

        var r7 = row(tFx);
        r7.alignChildren = ["left", "center"];
        r7.add("statictext", undefined, "Freq");
        var wFreq = r7.add("edittext", undefined, "3");
        wFreq.characters = 3;
        wFreq.helpTip = "Wiggles per second";
        wFreq.onChange = function () { wFreq.text = String(clampNum(wFreq.text, 3, 0.1, 30)); };
        r7.add("statictext", undefined, "Amt");
        var wAmp = r7.add("edittext", undefined, "20");
        wAmp.characters = 4;
        wAmp.helpTip = "Wiggle amount (in the property's units)";
        wAmp.onChange = function () { wAmp.text = String(clampNum(wAmp.text, 20, 0, 10000)); };
        var wBtn = r7.add("button", undefined, "Wiggle");
        wBtn.helpTip = "Expression: adds random movement \u2014 wiggle(freq, amount)";
        wBtn.alignment = ["fill", "center"];
        wBtn.preferredSize.height = 22;
        wBtn.onClick = function () {
            var f = clampNum(wFreq.text, 3, 0.1, 30);
            var a = clampNum(wAmp.text, 20, 0, 10000);
            applyExpression("wiggle(" + f + ", " + a + ");", "Wiggle", 0);
        };

        var r8 = row(tFx);
        btn(r8, "Clear FX", "Removes expressions from the selected properties (or every expression on selected layers)",
            function () { applyExpression("", "Clear FX", 0); });

        tp.selection = tEase;

        // ---- Status line ---------------------------------------------

        var statusText = pal.add("statictext", undefined, "Select keys, props, or layers \u2014 then click a graph.");
        statusText.alignment = ["fill", "top"];
        try { statusText.graphics.font = ScriptUI.newFont(statusText.graphics.font.name, ScriptUI.FontStyle.ITALIC, 9); } catch (eF3) {}
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
