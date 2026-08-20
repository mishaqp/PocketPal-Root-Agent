#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")
app_path = root / "App.tsx"
hook_path = root / "src/hooks/useChatSession.ts"

app = app_path.read_text(encoding="utf-8")
hook = hook_path.read_text(encoding="utf-8")

# App startup: passive health/bootstrap check. It deliberately does not execute
# Termux commands, so simply opening Root Agent cannot unexpectedly switch to
# ZeroTermux. Deep Termux/Linux probes are lazy/explicit in the runtime store.
old = "import {ttsStore, uiStore} from './src/store';\n"
new = "import {chatSessionStore, ttsStore, uiStore} from './src/store';\n"
if new not in app:
    if old not in app:
        raise SystemExit("App.tsx store import anchor not found")
    app = app.replace(old, new, 1)

needle = "import {useDeepLinking} from './src/hooks/useDeepLinking';\n"
addition = needle + "import {rootAgentRuntimeStore} from './src/services/rootAgent';\n"
if addition not in app:
    if needle not in app:
        raise SystemExit("App.tsx deep linking import anchor not found")
    app = app.replace(needle, addition, 1)

needle = """  React.useEffect(() => {\n    ttsStore.init().catch(() => {\n      // init() swallows its own errors; catch to satisfy no-floating-promises.\n    });\n  }, []);\n\n"""
replacement = needle + """  // Root Agent startup health is a passive, read-only probe. Deep Termux/Linux\n  // execution is lazy so app launch never needs to foreground ZeroTermux.\n  React.useEffect(() => {\n    void rootAgentRuntimeStore.startupSelfTest(\n      chatSessionStore.activeSessionId ?? undefined,\n    );\n  }, []);\n\n  // Keep resumable-task state aligned when the user switches chats.\n  React.useEffect(() => {\n    void rootAgentRuntimeStore.syncCheckpoint(\n      chatSessionStore.activeSessionId ?? undefined,\n    );\n  }, [chatSessionStore.activeSessionId]);\n\n"""
if replacement not in app:
    if needle not in app:
        raise SystemExit("App.tsx TTS effect anchor not found")
    app = app.replace(needle, replacement, 1)

# Chat lifecycle: publish agent/task/tool activity into RootAgentRuntimeStore.
needle = "import {taskCheckpointStore} from '../services/taskCheckpoint/TaskCheckpointStore';\n"
addition = needle + "import {rootAgentRuntimeStore} from '../services/rootAgent';\n"
if addition not in hook:
    if needle not in hook:
        raise SystemExit("useChatSession checkpoint import anchor not found")
    hook = hook.replace(needle, addition, 1)

needle = """    taskCheckpointStore.beginRun(\n      messageInfo.sessionId,\n      messageInfo.id,\n      message.text,\n    );\n\n"""
replacement = needle + """    rootAgentRuntimeStore.beginAgentRun(\n      message.text,\n      messageInfo.sessionId,\n    );\n\n"""
if replacement not in hook:
    if needle not in hook:
        raise SystemExit("useChatSession beginRun anchor not found")
    hook = hook.replace(needle, replacement, 1)

needle = """      await taskCheckpointStore.recordToolOutcome(\n        ctx.sessionId,\n        ctx.messageId,\n        event.outcome.toolName,\n        event.outcome.responseContent,\n        event.outcome.result.type === 'error',\n      );\n      return;\n"""
replacement = """      await taskCheckpointStore.recordToolOutcome(\n        ctx.sessionId,\n        ctx.messageId,\n        event.outcome.toolName,\n        event.outcome.responseContent,\n        event.outcome.result.type === 'error',\n      );\n      rootAgentRuntimeStore.noteToolOutcome(\n        event.outcome.toolName,\n        event.outcome.responseContent,\n        event.outcome.result.type === 'error',\n      );\n      await rootAgentRuntimeStore.syncCheckpoint(ctx.sessionId);\n      return;\n"""
if replacement not in hook:
    if needle not in hook:
        raise SystemExit("useChatSession checkpoint tool outcome anchor not found")
    hook = hook.replace(needle, replacement, 1)

needle = """      await taskCheckpointStore.finishRun(\n        ctx.sessionId,\n        ctx.messageId,\n        event.result.hitMaxTurns,\n      );\n      if (event.result.hitMaxTurns) {\n"""
replacement = """      await taskCheckpointStore.finishRun(\n        ctx.sessionId,\n        ctx.messageId,\n        event.result.hitMaxTurns,\n      );\n      await rootAgentRuntimeStore.syncCheckpoint(ctx.sessionId);\n      rootAgentRuntimeStore.finishAgentRun(event.result.hitMaxTurns);\n      if (event.result.hitMaxTurns) {\n"""
if replacement not in hook:
    if needle not in hook:
        raise SystemExit("useChatSession checkpoint finishRun anchor not found")
    hook = hook.replace(needle, replacement, 1)

needle = """      await taskCheckpointStore.markInterrupted(\n        messageInfo.sessionId,\n        messageInfo.id,\n        message.text,\n        errorMessage,\n      );\n"""
replacement = needle + """      await rootAgentRuntimeStore.syncCheckpoint(messageInfo.sessionId);\n      rootAgentRuntimeStore.failAgentRun(errorMessage);\n"""
if replacement not in hook:
    if needle not in hook:
        raise SystemExit("useChatSession checkpoint markInterrupted anchor not found")
    hook = hook.replace(needle, replacement, 1)

app_path.write_text(app, encoding="utf-8")
hook_path.write_text(hook, encoding="utf-8")
print("Applied RootAgentRuntimeStore startup + chat lifecycle wiring")
