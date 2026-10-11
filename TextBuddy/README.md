# TextBuddy — one-click text animation for After Effects

A compact dockable panel for After Effects 2026 (works in 2020+), designed to sit narrow at the side of your screen. Build word-by-word reveals without digging through Animate → Advanced, and get the "animate text like Apple" looks in one click each.

Everything keys at the **playhead**. Results show in the status line at the bottom (no popups), and every click is a single undo step. After each click the new keys are **selected and twirled open in the timeline**, so if you have [GraphBuddy](../GraphBuddy/) open you can click an ease tile next to shape them.

## Install

1. Copy `TextBuddy.jsx` **and** the `TextBuddy_lib` folder, side by side, into the ScriptUI Panels folder:
   - **macOS:** `/Applications/Adobe After Effects 2026/Scripts/ScriptUI Panels/`
   - **Windows:** `C:\Program Files\Adobe\Adobe After Effects 2026\Support Files\Scripts\ScriptUI Panels\`
2. Restart After Effects.
3. Open **Window → TextBuddy.jsx**, or click **TextBuddy** in [BuddyHub](../BuddyHub/), and dock it.

## Reveal tab — build your own reveal

1. Select one or more text layers and set the controls:
   - **Property + amount**: what each word starts as. Options are Opacity (0%), Position Y (50 px), Scale (0%), Rotation (45°), and Blur (20 px).
   - **By**: Range Selector → Advanced → Based On. Defaults to **Words**.
   - **Smooth**: Smoothness. At **0%**, which is the default, each word pops on cleanly. Higher values cross-fade neighboring words.
2. Click **Add Animator**. Each layer gets an animator named *TextBuddy*. Click it again to update that animator. Pick a different property and click again to stack it on the same animator, so Opacity 0% then Position Y 50 gives a fade-up. **Alt/Option-click** adds a separate animator instead.
3. Move the playhead to where the reveal starts and click **◇ Offset 0%**. Every word is held at the amount you set.
4. Move the playhead to where it ends and click **◇ Offset 100%**. Every word is back to normal.

The Offset buttons work on any range selectors you've selected in the timeline (select an animator to key only that one). With nothing selected they key every range selector on the selected text layers, including ones made with AE's own Animate menu.

## Apple tab — the Apple text looks

The techniques from Motion By Scott's [How To Animate Text Like Apple](https://www.youtube.com/watch?v=Z_HE-jfK02s), one tile each. **Frames** sets how long a reveal, slide, or underline takes. **Dist** sets how far text travels (70 px, as in the video; a negative value flips the direction).

| Tile | What it does |
|---|---|
| **Drop** | Characters fall into place from above and fade in, one after another. Built like the video: a Position animator on a **Ramp Up** range selector with **Ease Low 80%**, plus a separate square **Opacity** fade, both swept from the playhead. |
| **Rise** | Words rise into place from below and fade in: Ramp Up, **Ease High 60% / Ease Low 80%**, based on **Words**. |
| **Slide** | The whole layer slides up into place with the Apple ease: an abrupt start, then a long soft landing. Works on any layer. |
| **Slide Cut** | Match cut between two layers. See below. |
| **Scale Cut** | Match cut through a zoom to **Zoom %** (130%, as in the video). |
| **Underline** | A hand-drawn underline under each selected text layer, drawn on over Frames. It has a tapered stroke, round caps, a little Turbulent Displace wobble, and uses the text's color. It's parented to the text, so it follows any cut. |

Drop and Rise use two animators, *Apple Move* and *Apple Fade*. Applying either one again (even the other style) updates those same two animators and re-keys them at the playhead, so they don't pile up. Their easing comes from Ease High / Low rather than the Offset keys, the way the video explains it. F9 on range-selector Offsets does nothing useful.

### Match cuts

Select the **outgoing** and **incoming** layers and put the playhead where the exit move should start.

- Both layers get parented to a new **Match Cut** null. The null slides **Dist** px (Slide Cut) or zooms to **Zoom %** (Scale Cut) over **Cut** frames (10, as in the video).
- The cut lands at the end of that move. The outgoing layer ends there and the incoming one starts there.
- The **3-keyframe trick** from the video is built in. The move lands 95% of the way, then keeps creeping the last few pixels until the incoming layer ends, so the shot never fully stops. The middle key carries its speed straight through, so there's no stall at the hand-off.
- Scale Cut zooms around the comp center (the null), so masks or moved anchor points can't throw it off. That's the reason the video uses a null for it.
- **Chained cuts work**: cut A→B, then B→C. B keeps riding the first null, and the first null rides the new one.
- Which layer is outgoing: the one that starts first. If both start at the same time, it's the lower one, since new layers land on top.

## Twirling keys open

AE has no scripting call to expand a property in the timeline. TextBuddy briefly gives the new keys' properties an error expression, runs AE's *Reveal Expression Errors*, then restores the expressions. You may see the expression-error bar flash for a moment. If your AE version doesn't have that command, the keys are still set and selected; press **U** to see them.

## Not automated

These parts of the video depend too much on your layout to automate:
- splitting the background solid at the cut
- per-word mask splits
- popping a mask with hold keyframes
- the final timing tweaks

## Uninstall

Delete `TextBuddy.jsx` and the `TextBuddy_lib` folder from the ScriptUI Panels folder and restart After Effects.
