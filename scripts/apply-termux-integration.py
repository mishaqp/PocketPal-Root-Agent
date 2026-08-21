#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")
manifest_path = root / "android/app/src/main/AndroidManifest.xml"
extension_store_path = root / "src/store/ExtensionStore.ts"

manifest = manifest_path.read_text(encoding="utf-8")

if '<package android:name="com.termux" />' not in manifest:
    anchor = """        </intent>\n    </queries>\n"""
    replacement = """        </intent>\n        <package android:name=\"com.termux\" />\n    </queries>\n"""
    if anchor not in manifest:
        raise SystemExit("AndroidManifest queries anchor not found; upstream changed")
    manifest = manifest.replace(anchor, replacement, 1)

if 'com.termux.permission.RUN_COMMAND' not in manifest:
    anchor = '    <uses-permission android:name="android.permission.CAMERA" />\n'
    replacement = (
        anchor
        + '    <uses-permission android:name="com.termux.permission.RUN_COMMAND" />\n'
    )
    if anchor not in manifest:
        raise SystemExit("AndroidManifest permission anchor not found; upstream changed")
    manifest = manifest.replace(anchor, replacement, 1)

if 'android:name=".TermuxResultService"' not in manifest:
    anchor = "    </application>\n\n</manifest>\n"
    replacement = """        <service\n            android:name=\".TermuxResultService\"\n            android:exported=\"false\" />\n    </application>\n\n</manifest>\n"""
    if anchor not in manifest:
        raise SystemExit("AndroidManifest application anchor not found; upstream changed")
    manifest = manifest.replace(anchor, replacement, 1)

manifest_path.write_text(manifest, encoding="utf-8")

# Imported JSON plugins may never inherit command execution or persistent
# runtime checkpoint control. The importer rejects these too; this sanitizes
# persisted plugin data during hydration.
store = extension_store_path.read_text(encoding="utf-8")
legacy = ".filter(talent => talent !== 'android_system'),"
termux_only = ".filter(talent => talent !== 'android_system' && talent !== 'termux'),"
final_block = """.filter(\n            talent =>\n              talent !== 'android_system' &&\n              talent !== 'termux' &&\n              talent !== 'task_checkpoint',\n          ),"""
if final_block not in store:
    if termux_only in store:
        store = store.replace(termux_only, final_block, 1)
    elif legacy in store:
        store = store.replace(legacy, final_block, 1)
    else:
        raise SystemExit("ExtensionStore plugin filter anchor not found")
extension_store_path.write_text(store, encoding="utf-8")

print("Applied Termux manifest permissions, package visibility, result service, and plugin isolation")
