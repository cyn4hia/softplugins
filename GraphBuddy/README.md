# GraphBuddy — one-click graph eases for After Effects

A compact dockable panel for After Effects 2026 (works in 2020+), designed to sit narrow at the side of your screen. **Every ease preset is drawn as its actual value graph** — pick the curve by shape, exactly like the graph editor will show it. Click it and it's applied.

**Smart selection:** you don't have to select keyframes first. Buttons work on whatever you have selected, in this order:

1. **Selected keyframes** — just those keys
2. **Selected properties** — all their keys
3. **Selected layers** — every animated property on them

Results show in the status line at the bottom (no popups), and every click is a single undo step.

## Install

1. Copy `GraphBuddy.jsx` into the ScriptUI Panels folder:
   - **macOS:** `/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/`
   - **Windows:** `C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\`
2. Restart After Effects.
3. Open **Window → GraphBuddy.jsx** (bottom of the Window menu) and drag it to the side of your screen to dock it — it stays slim.

## Ease tab — 12 graph tiles

Each tile shows its value-graph shape. Hover any tile for the exact influence values.

| Tile | Curve |
|---|---|
| **Linear** | Straight line, no ease |
| **Hold** | Step — freezes until the next key |
| **Easy Ease** | Classic F9 — gentle S (33/33) |
| **Smooth** | Softer drift — deeper S (75/75) |
| **Buttery** | Very floaty, steep middle (90/90) |
| **Snappy** | Leaves fast, lands soft (90 in / 10 out) — the "modern app motion" curve |
| **Ease In** | Soft landing into each key only (75 in, outgoing stays linear) |
| **Ease Out** | Soft launch out of each key only (75 out, incoming stays linear) |
| **Wind Up** | Leaves slow, arrives fast (15 in / 85 out) |
| **Deep In** | Long floaty landing (95 in, outgoing linear) |
| **Deep Out** | Long floaty launch (95 out, incoming linear) |
| **Whip** | Near-instant move, long settle (97 in / 3 out) |

## Flow tab — cubic-bezier graph pack

The "cleanest graphs" curves, defined as cubic-beziers and applied **per segment** (each pair of consecutive keys): the outgoing side of the first key and the incoming side of the second, with keyframe *speeds* computed from each segment's value change — so curves that arrive or launch with velocity (Fast In's whip, Fast Out's launch) reproduce exactly, something influence-only eases can't do.

| Tile | cubic-bezier |
|---|---|
| **Fast In** | (1, 0, 1, 0) — crawls, then whips into the key at full speed |
| **In** | (0.5, 0, 1, 1) — accelerates smoothly, arrives moving |
| **S-Curve** | (0.71, 0, 0.29, 1) — the classic clean S |
| **Fast Out** | (0.16, 1, 0.3, 1) — launches at full speed, long glide |
| **Out** | (0, 0, 0.58, 1) — springs out, decelerates smoothly |
| **Norm S** | (0.645, 0.045, 0.355, 1) — gentler everyday S |
| **Tight S** | (0.9, 0, 0.1, 1) — long holds, fast middle |
| **Tightest** | (1, 0, 0, 1) — maximum-tension S |
| **Front S** | (0.2, 0, 0.1, 1) — action up front, extra-long landing |

**Type any curve:** the `bez` row takes any cubic-bezier — copy values straight from a tutorial, cheat sheet, or [cubic-bezier.com](https://cubic-bezier.com) — with a live preview tile (click it or **Apply Bezier**). Y values past 0/1 create overshoot curves.

## Custom tab

- A **live graph preview** that redraws as you drag the In/Out sliders — click the preview (or **Apply**) to use it.
- **Copy Ease / Paste Ease** — grab the curve off one keyframe and stamp it onto any others, across properties and layers.

## Rendering in Media Encoder

**Ease presets can't render wrong.** They write ordinary keyframe interpolation into the project — the same data you'd get dragging handles in the graph editor. Media Encoder, aerender, and the AE preview all read that identically; nothing from the plugin is needed at render time. If a render doesn't match your preview, save and re-queue (Media Encoder renders the project state from when it was queued), or purge a stale AE preview: Edit → Purge → All Memory & Disk Cache.

## Tips

- Works across multiple properties and multiple layers at once.
- Cmd/Ctrl+Z undoes any click in one step.

## Uninstall

Delete `GraphBuddy.jsx` from the ScriptUI Panels folder and restart After Effects.
