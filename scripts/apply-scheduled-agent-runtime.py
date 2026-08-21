#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")
manifest_path = root / "android/app/src/main/AndroidManifest.xml"
index_path = root / "index.js"
extension_store_path = root / "src/store/ExtensionStore.ts"
extensions_engine_path = root / "src/services/talents/AgentExtensionsEngine.ts"
diagnostics_module_path = root / "android/app/src/main/java/com/pocketpal/DiagnosticsModule.kt"

manifest = manifest_path.read_text(encoding="utf-8")
index = index_path.read_text(encoding="utf-8")
extension_store = extension_store_path.read_text(encoding="utf-8")
extensions_engine = extensions_engine_path.read_text(encoding="utf-8")
diagnostics = diagnostics_module_path.read_text(encoding="utf-8")

# ---------------------------------------------------------------------------
# 1) Android wake/runtime permissions and components.
# ---------------------------------------------------------------------------
permission_anchor = '    <uses-permission android:name="com.termux.permission.RUN_COMMAND" />\n'
permissions = """    <uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
    <uses-permission android:name="android.permission.WAKE_LOCK" />
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <uses-permission android:name="android.permission.SCHEDULE_EXACT_ALARM" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE" />
    <uses-permission android:name="android.permission.FOREGROUND_SERVICE_DATA_SYNC" />
"""
if 'android.permission.FOREGROUND_SERVICE_DATA_SYNC' not in manifest:
    if permission_anchor not in manifest:
        raise SystemExit("Scheduled Agent permission anchor not found")
    manifest = manifest.replace(permission_anchor, permission_anchor + permissions, 1)

component_anchor = """        <service
            android:name=\".TermuxResultService\"
            android:exported=\"false\" />
"""
components = component_anchor + """
        <receiver
            android:name=\".ScheduledAgentAlarmReceiver\"
            android:exported=\"false\" />
        <receiver
            android:name=\".ScheduledAgentBootReceiver\"
            android:enabled=\"true\"
            android:exported=\"true\">
            <intent-filter>
                <action android:name=\"android.intent.action.BOOT_COMPLETED\" />
                <action android:name=\"android.intent.action.MY_PACKAGE_REPLACED\" />
            </intent-filter>
        </receiver>
        <service
            android:name=\".ScheduledAgentHeadlessService\"
            android:exported=\"false\"
            android:foregroundServiceType=\"dataSync\" />
"""
if '.ScheduledAgentHeadlessService' not in manifest:
    if component_anchor not in manifest:
        raise SystemExit("Scheduled Agent component anchor not found")
    manifest = manifest.replace(component_anchor, components, 1)

# ---------------------------------------------------------------------------
# 2) Register the Headless-JS entry point. It reuses the normal API-model and
#    AgentRunner stack without mounting the UI.
# ---------------------------------------------------------------------------
import_anchor = "import {name as appName} from './app.json';\n"
import_line = "import {runScheduledAgentHeadless} from './src/services/scheduledAgent/ScheduledAgentHeadless';\n"
if import_line not in index:
    if import_anchor not in index:
        raise SystemExit("index.js appName import anchor not found")
    index = index.replace(import_anchor, import_anchor + import_line, 1)

register_anchor = "AppRegistry.registerComponent(appName, () => App);\n"
register_line = register_anchor + "AppRegistry.registerHeadlessTask('RootAgentScheduledTask', () => runScheduledAgentHeadless);\n"
if "registerHeadlessTask('RootAgentScheduledTask'" not in index:
    if register_anchor not in index:
        raise SystemExit("index.js registerComponent anchor not found")
    index = index.replace(register_anchor, register_line, 1)

# ---------------------------------------------------------------------------
# 3) Imported plugins may not acquire the power to create future unattended
#    tasks. Keep the existing privileged-talent boundary aligned.
# ---------------------------------------------------------------------------
old_filter = """              talent !== 'android_system' &&
              talent !== 'termux' &&
              talent !== 'task_checkpoint',
"""
new_filter = """              talent !== 'android_system' &&
              talent !== 'termux' &&
              talent !== 'task_checkpoint' &&
              talent !== 'scheduled_agent',
"""
if new_filter not in extension_store:
    if old_filter not in extension_store:
        raise SystemExit("ExtensionStore privileged filter anchor not found")
    extension_store = extension_store.replace(old_filter, new_filter, 1)

old_forbidden = """  'android_system',
  'termux',
  'task_checkpoint',
  'agent_extensions',
"""
new_forbidden = """  'android_system',
  'termux',
  'task_checkpoint',
  'scheduled_agent',
  'agent_extensions',
"""
if new_forbidden not in extensions_engine:
    if old_forbidden not in extensions_engine:
        raise SystemExit("AgentExtensionsEngine privileged list anchor not found")
    extensions_engine = extensions_engine.replace(old_forbidden, new_forbidden, 1)

# ---------------------------------------------------------------------------
# 4) Include scheduler lifecycle in opt-in diagnostics log filtering.
# ---------------------------------------------------------------------------
old_tags = 'val uniqueTags = listOf("RootAgent", "RootAgentBoot", "AndroidControl", "TermuxBridge", "TermuxCommandBroker", "TermuxResultService")'
new_tags = 'val uniqueTags = listOf("RootAgent", "RootAgentBoot", "ScheduledAgent", "AndroidControl", "TermuxBridge", "TermuxCommandBroker", "TermuxResultService")'
if new_tags not in diagnostics:
    if old_tags not in diagnostics:
        raise SystemExit("Diagnostics scheduled tag anchor not found")
    diagnostics = diagnostics.replace(old_tags, new_tags, 1)

manifest_path.write_text(manifest, encoding="utf-8")
index_path.write_text(index, encoding="utf-8")
extension_store_path.write_text(extension_store, encoding="utf-8")
extensions_engine_path.write_text(extensions_engine, encoding="utf-8")
diagnostics_module_path.write_text(diagnostics, encoding="utf-8")

print("Applied Scheduled Agent AlarmManager + Headless JS + reboot restore + plugin isolation")
