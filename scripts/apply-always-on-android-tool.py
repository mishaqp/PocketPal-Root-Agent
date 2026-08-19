#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")

store_path = root / "src/store/ChatSessionStore.ts"
hook_path = root / "src/hooks/useChatSession.ts"

# 1) Always expose android_system in the request's OpenAI-compatible tools array,
# even when the user is in a plain chat, an old session, or a Pal whose pact did
# not explicitly list it. This fork is an Android root-agent app, so phone control
# is a built-in runtime capability rather than an optional marketplace talent.
store = store_path.read_text(encoding="utf-8")
needle = """    return resolvedSettings;\n  }\n\n  /**\n   * Gets the effective completion settings for the current context\n   */\n"""
replacement = """    // PocketPal Root Agent invariant: android_system is always available.\n    // Do this at the final resolver boundary so it also covers plain chats,\n    // custom settings, existing sessions, and Pals without a pact entry.\n    const existingTools = (resolvedSettings.tools ?? []) as any[];\n    const hasAndroidSystem = existingTools.some(\n      tool => tool?.function?.name === 'android_system',\n    );\n    if (!hasAndroidSystem) {\n      const androidTools = deriveToolSchemas(['android_system']);\n      if (androidTools.length > 0) {\n        resolvedSettings = {\n          ...resolvedSettings,\n          tools: [...existingTools, ...androidTools],\n        };\n      }\n    }\n\n    return resolvedSettings;\n  }\n\n  /**\n   * Gets the effective completion settings for the current context\n   */\n"""
if needle not in store:
    raise SystemExit("ChatSessionStore anchor not found; upstream changed")
store = store.replace(needle, replacement, 1)
store_path.write_text(store, encoding="utf-8")

# 2) The runner has its own allowlist in addition to API tool schemas. Keep the
# same invariant there or a correctly emitted android_system call would still be
# rejected after generation.
hook = hook_path.read_text(encoding="utf-8")
needle = """    // Allowed talent names for this Pal. The runner rejects any\n    // tool call whose function.name isn't in this list.\n    const palTalents = (pal?.pact?.talents ?? []).map(t => t.name);\n"""
replacement = """    // Root Agent always has the native Android bridge. Pal-declared talents are\n    // additive; android_system must not disappear in plain chats or old Pals.\n    const palTalents = Array.from(\n      new Set([\n        'android_system',\n        ...(pal?.pact?.talents ?? []).map(t => t.name),\n      ]),\n    );\n"""
if needle not in hook:
    raise SystemExit("useChatSession palTalents anchor not found; upstream changed")
hook = hook.replace(needle, replacement, 1)
hook_path.write_text(hook, encoding="utf-8")

print("Applied always-on android_system tool wiring")
