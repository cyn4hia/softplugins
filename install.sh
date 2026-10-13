#!/bin/bash
# Installs the Buddy plugins into After Effects' ScriptUI Panels folder
# in one go: each <Name>.jsx plus its <Name>_lib folder.
#
#   ./install.sh                   every buddy, into every After Effects found
#   ./install.sh TextBuddy         just the ones you name
#   ./install.sh --uninstall       remove them again
#   ./install.sh --dest <folder>   use another ScriptUI Panels folder
#
# Re-run it after pulling updates: it replaces the old copies, lib
# folders included, so no stale modules are left behind. Restart After
# Effects afterwards; panels are only picked up at launch.

set -euo pipefail

repo="$(cd "$(dirname "$0")" && pwd)"
args=("$@")
uninstall=0
dests=()
names=()

while [ $# -gt 0 ]; do
    case "$1" in
        --uninstall) uninstall=1 ;;
        --dest)
            [ $# -ge 2 ] || { echo "--dest needs a folder" >&2; exit 2; }
            shift
            dests+=("$1")
            ;;
        -h|--help) sed -n '2,12p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
        -*) echo "Unknown option: $1 (see --help)" >&2; exit 2 ;;
        *) names+=("$1") ;;
    esac
    shift
done

# A buddy is any folder here holding a .jsx of the same name
# (BuddyHub/BuddyHub.jsx, GraphBuddy/GraphBuddy.jsx, ...)
if [ ${#names[@]} -eq 0 ]; then
    for d in "$repo"/*/; do
        n="$(basename "$d")"
        [ -f "$d$n.jsx" ] && names+=("$n")
    done
fi
for n in "${names[@]}"; do
    case "$n" in
        *[!A-Za-z0-9_-]*) echo "Not a buddy name: $n" >&2; exit 1 ;;
    esac
    [ -f "$repo/$n/$n.jsx" ] || { echo "No such buddy: $n" >&2; exit 1; }
done

if [ ${#dests[@]} -eq 0 ]; then
    for app in /Applications/Adobe\ After\ Effects*/; do
        [ -d "${app}Scripts/ScriptUI Panels" ] && dests+=("${app}Scripts/ScriptUI Panels")
    done
    if [ ${#dests[@]} -eq 0 ]; then
        echo "Couldn't find After Effects in /Applications." >&2
        echo "Point at its ScriptUI Panels folder with --dest <folder>." >&2
        exit 1
    fi
fi
for d in "${dests[@]}"; do
    [ -d "$d" ] || { echo "No such folder: $d" >&2; exit 1; }
done

# The app's ScriptUI Panels folder belongs to the system: re-run the
# whole script through sudo once, rather than prompting per file
for d in "${dests[@]}"; do
    if [ ! -w "$d" ] && [ "$(id -u)" -ne 0 ]; then
        echo "The ScriptUI Panels folder belongs to the system, so this needs your Mac password."
        exec sudo "$0" ${args[@]+"${args[@]}"}
    fi
done

for d in "${dests[@]}"; do
    echo "$d"
    for n in "${names[@]}"; do
        if [ $uninstall -eq 1 ]; then
            rm -f "$d/$n.jsx"
            rm -rf "$d/${n}_lib"
            echo "  removed   $n"
        else
            cp "$repo/$n/$n.jsx" "$d/$n.jsx"
            if [ -d "$repo/$n/${n}_lib" ]; then
                rsync -a --delete --exclude .DS_Store "$repo/$n/${n}_lib/" "$d/${n}_lib/"
            fi
            echo "  installed $n"
        fi
    done
done

if pgrep -xq "After Effects"; then
    echo "After Effects is open: restart it to load the changes."
elif [ $uninstall -eq 0 ]; then
    echo "Done. Open After Effects, then Window > BuddyHub.jsx (or any buddy)."
fi
