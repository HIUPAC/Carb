#!/bin/sh
set -eu

bundle_id=com.icewheel.carb
show_message() {
    /usr/bin/osascript - "$1" <<'APPLESCRIPT'
on run arguments
    display dialog (item 1 of arguments) with title "Carb" buttons {"OK"} default button 1
end run
APPLESCRIPT
}

fail() {
    show_message "$1" || true
    exit 1
}

if [ "$#" -ne 3 ] || [ "$1" != --from-app ]; then
    exit 2
fi
pid=$2
case $pid in ''|*[!0-9]*) exit 2 ;; esac
[ "$pid" -gt 1 ] || exit 2

resources=$(CDPATH='' cd -P -- "$(/usr/bin/dirname -- "$0")" && pwd -P)
bundle=$(CDPATH='' cd -P -- "$3" && pwd -P)
case $bundle in /*.app) ;; *) exit 2 ;; esac
[ "$resources" = "$bundle/Contents/Resources" ] || exit 2
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$bundle/Contents/Info.plist")" = "$bundle_id" ] || exit 2
[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$bundle/Contents/Info.plist")" = Carb ] || exit 2
case ${HOME:-} in /*) ;; *) exit 2 ;; esac
home=$(CDPATH='' cd -P -- "$HOME" && pwd -P)
[ "$home" != / ] || exit 2
case $bundle in
    */AppTranslocation/*|/Volumes/*|"$home"/.Trash/*)
        fail 'Move Carb to Applications, then open it there to uninstall. 请先将 Carb 移到「应用程序」，再打开它进行卸载。' ;;
esac
[ -w "$(/usr/bin/dirname -- "$bundle")" ] || fail 'Move Carb to an Applications folder you can edit, then open it and retry. 请将 Carb 移到有写入权限的「应用程序」文件夹，重新打开后重试。'

# Validate each parent before any credentials or files are removed.
for parent in 'Application Support' Caches HTTPStorages Preferences 'Saved Application State' WebKit; do
    folder="$home/Library/$parent"
    if [ -e "$folder" ] || [ -L "$folder" ]; then
        resolved=$(CDPATH='' cd -P -- "$folder" && pwd -P) || fail "Could not access $folder. 无法访问该目录。"
        [ "$resolved" = "$folder" ] || fail "The folder $folder is redirected. 该目录已被重定向。"
    fi
done

attempts=0
while kill -0 "$pid" 2>/dev/null; do
    [ "$attempts" -lt 60 ] || fail 'Carb is still running. Open Carb and retry the uninstall. Carb 仍在运行，请重新打开后重试。'
    /bin/sleep 1
    attempts=$((attempts + 1))
done

if ! "$bundle/Contents/MacOS/Carb" --carb-remove-credentials; then
    fail 'Carb could not finish cleaning up its data. Open Carb and retry the uninstall. Carb 无法完成数据清理，请重新打开后重试。'
fi

# Only paths dedicated to this product or its bundle ID are removed.
/usr/bin/defaults delete "$bundle_id" >/dev/null 2>&1 || true
for target in \
    "$home/Library/Application Support/CarbData" \
    "$home/Library/Application Support/$bundle_id" \
    "$home/Library/Caches/$bundle_id" \
    "$home/Library/Caches/$bundle_id.ShipIt" \
    "$home/Library/HTTPStorages/$bundle_id" \
    "$home/Library/HTTPStorages/$bundle_id.binarycookies" \
    "$home/Library/Preferences/$bundle_id.plist" \
    "$home/Library/Saved Application State/$bundle_id.savedState" \
    "$home/Library/WebKit/$bundle_id"
do
    /bin/rm -rf -- "$target" || fail "Could not remove $target. 无法移除，请检查权限后重试。"
done

lsregister=/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister
if [ -x "$lsregister" ]; then
    "$lsregister" -u "$bundle" >/dev/null 2>&1 || true
fi
/usr/bin/tccutil reset All "$bundle_id" >/dev/null 2>&1 || true
/bin/rm -rf -- "$bundle" || fail 'Could not remove the Carb application. 无法移除 Carb，请检查权限后重试。'
show_message 'Carb was uninstalled. Carb 已卸载。' || true
