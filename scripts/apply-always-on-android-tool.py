#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")

store_path = root / "src/store/ChatSessionStore.ts"
hook_path = root / "src/hooks/useChatSession.ts"
android_engine_path = root / "src/services/talents/AndroidSystemEngine.ts"

# 1) Root Agent built-ins must be present in every request, including plain
# chats, old sessions, custom settings, and Pals whose pact did not list them.
store = store_path.read_text(encoding="utf-8")
needle = """    return resolvedSettings;\n  }\n\n  /**\n   * Gets the effective completion settings for the current context\n   */\n"""
replacement = """    // PocketPal Root Agent built-ins are runtime capabilities, not optional\n    // marketplace talents. Add any missing schemas at the final resolver boundary.\n    const existingTools = (resolvedSettings.tools ?? []) as any[];\n    const existingNames = new Set(\n      existingTools.map(tool => tool?.function?.name).filter(Boolean),\n    );\n    const requiredBuiltIns = ['android_system', 'termux'];\n    const missingBuiltIns = requiredBuiltIns.filter(name => !existingNames.has(name));\n    if (missingBuiltIns.length > 0) {\n      const builtInTools = deriveToolSchemas(missingBuiltIns);\n      if (builtInTools.length > 0) {\n        resolvedSettings = {\n          ...resolvedSettings,\n          tools: [...existingTools, ...builtInTools],\n        };\n      }\n    }\n\n    return resolvedSettings;\n  }\n\n  /**\n   * Gets the effective completion settings for the current context\n   */\n"""
if needle not in store:
    raise SystemExit("ChatSessionStore anchor not found; upstream changed")
store = store.replace(needle, replacement, 1)
store_path.write_text(store, encoding="utf-8")

# 2) AgentRunner also has an execution allowlist. Keep it aligned with the tool
# schemas or a correctly generated built-in call would still be rejected.
hook = hook_path.read_text(encoding="utf-8")
needle = """    // Allowed talent names for this Pal. The runner rejects any\n    // tool call whose function.name isn't in this list.\n    const palTalents = (pal?.pact?.talents ?? []).map(t => t.name);\n"""
replacement = """    // Root Agent runtime capabilities are always executable; Pal talents are additive.\n    const palTalents = Array.from(\n      new Set([\n        'android_system',\n        'termux',\n        ...(pal?.pact?.talents ?? []).map(t => t.name),\n      ]),\n    );\n"""
if needle not in hook:
    raise SystemExit("useChatSession palTalents anchor not found; upstream changed")
hook = hook.replace(needle, replacement, 1)
hook_path.write_text(hook, encoding="utf-8")

# 3) Make Android runtime identity explicit. The Termux talent contributes its
# own prompt fragment whenever it is present in the resolved tools list.
engine = android_engine_path.read_text(encoding="utf-8")
needle = """      'ANDROID DEVICE RULES:',\n      '- When the user asks about the current phone state, installed apps, battery, storage, brightness, or root status, call android_system instead of guessing.',\n"""
replacement = """      'ANDROID DEVICE RUNTIME:',\n      '- You are running inside PocketPal Root Agent on the user\\'s Android phone. android_system is a real native device tool supplied by the app runtime.',\n      '- Do not claim that you have only text access, that Android tools are unavailable, or that the user must run ADB/shell manually while android_system is present.',\n      '- When the user asks about the current phone state, installed apps, battery, storage, brightness, or root status, call android_system instead of guessing.',\n"""
if needle not in engine:
    raise SystemExit("AndroidSystemEngine prompt anchor not found; overlay changed")
engine = engine.replace(needle, replacement, 1)
android_engine_path.write_text(engine, encoding="utf-8")

print("Applied always-on android_system + termux wiring and Android runtime bootstrap")
