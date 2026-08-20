#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")
manifest_path = root / "android/app/src/main/AndroidManifest.xml"
extension_store_path = root / "src/store/ExtensionStore.ts"

manifest = manifest_path.read_text(encoding="utf-8")

if '<package android:name="com.termux" />' not in manifest:
    anchor = "    </queries>"
    replacement = '        <package android:name="com.termux" />\n    </queries>'
    if anchor not in manifest:
        raise SystemExit("AndroidManifest queries anchor not found; upstream changed")
    manifest = manifest.replace(anchor, replacement, 1)

if 'com.termux.permission.RUN_COMMAND' not in manifest:
    anchor = '    <uses-permission android:name="android.permission.CAMERA" />'
    replacement = (
        anchor
        + '\n    <uses-permission android:name="com.termux.permission.RUN_COMMAND" />'
    )
    if anchor not in manifest:
        raise SystemExit("AndroidManifest permission anchor not found; upstream changed")
    manifest = manifest.replace(anchor, replacement, 1)

if 'android:name=".TermuxResultService"' not in manifest:
    anchor = "    </application>"
    replacement = """        <service
            android:name=\".TermuxResultService\"
            android:exported=\"false\" />
    </application>"""
    if anchor not in manifest:
        raise SystemExit("AndroidManifest application anchor not found; upstream changed")
    manifest = manifest.replace(anchor, replacement, 1)

manifest_path.write_text(manifest, encoding="utf-8")

# Imported JSON plugins may never inherit command execution, just as they may
# never inherit android_system. The importer rejects it too; this also sanitizes
# persisted plugin data during hydration.
store = extension_store_path.read_text(encoding="utf-8")
old = ".filter(talent => talent !== 'android_system'),"
new = ".filter(talent => talent !== 'android_system' && talent !== 'termux'),"
if old in store:
    store = store.replace(old, new, 1)
elif new not in store:
    raise SystemExit("ExtensionStore plugin filter anchor not found")
extension_store_path.write_text(store, encoding="utf-8")

print("Applied Termux manifest permissions, package visibility, result service, and plugin isolation")
