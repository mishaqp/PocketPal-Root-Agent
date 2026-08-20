#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")
hook_path = root / "src/hooks/useChatSession.ts"
hook = hook_path.read_text(encoding="utf-8")

# Import the persistent checkpoint store into the chat lifecycle.
needle = """import type {ToolDefinition} from '../services/talents/types';\n"""
replacement = needle + "import {taskCheckpointStore} from '../services/taskCheckpoint/TaskCheckpointStore';\n"
if replacement not in hook:
    if needle not in hook:
        raise SystemExit("useChatSession ToolDefinition import anchor not found")
    hook = hook.replace(needle, replacement, 1)

# Hydrate and select the active session before prepareCompletion assembles
# system prompt fragments. That lets an interrupted checkpoint survive app
# restarts and be injected into the very next model request.
needle = """    const systemMessages = resolveSystemMessages({\n      pal,\n      model: modelStore.activeModel,\n    });\n"""
replacement = """    await taskCheckpointStore.ensureHydrated();\n    taskCheckpointStore.setActiveSession(\n      chatSessionStore.activeSessionId ?? undefined,\n    );\n\n    const systemMessages = resolveSystemMessages({\n      pal,\n      model: modelStore.activeModel,\n    });\n"""
if replacement not in hook:
    if needle not in hook:
        raise SystemExit("useChatSession systemMessages anchor not found")
    hook = hook.replace(needle, replacement, 1)

# Remember this run in memory. Nothing is persisted merely by sending a chat;
# the first real tool outcome or an explicit task_checkpoint call creates the
# durable checkpoint.
needle = """    currentMessageInfo.current = messageInfo;\n\n"""
replacement = """    currentMessageInfo.current = messageInfo;\n    taskCheckpointStore.beginRun(\n      messageInfo.sessionId,\n      messageInfo.id,\n      message.text,\n    );\n\n"""
if replacement not in hook:
    if needle not in hook:
        raise SystemExit("useChatSession messageInfo anchor not found")
    hook = hook.replace(needle, replacement, 1)

# Auto-checkpoint every verified tool outcome. This is the fallback that makes
# recovery work even when the model did not explicitly checkpoint before a
# transient API/network failure.
needle = """    case 'tool_call_finished':\n      await chatSessionStore.appendToolOutcome(\n        ctx.messageId,\n        ctx.sessionId,\n        event.outcome,\n      );\n      return;\n"""
replacement = """    case 'tool_call_finished':\n      await chatSessionStore.appendToolOutcome(\n        ctx.messageId,\n        ctx.sessionId,\n        event.outcome,\n      );\n      await taskCheckpointStore.recordToolOutcome(\n        ctx.sessionId,\n        ctx.messageId,\n        event.outcome.toolName,\n        event.outcome.responseContent,\n        event.outcome.result.type === 'error',\n      );\n      return;\n"""
if replacement not in hook:
    if needle not in hook:
        raise SystemExit("useChatSession tool_call_finished anchor not found")
    hook = hook.replace(needle, replacement, 1)

# Normal run completion closes purely automatic bookkeeping checkpoints. A
# semantic checkpoint created by the model remains active until it explicitly
# verifies the task and calls task_checkpoint.complete. Max-turn exhaustion is
# persisted as interrupted so the next request can continue.
needle = """      chatSessionStore.recordCompletionSnapshot(snapshot);\n      if (event.result.hitMaxTurns) {\n"""
replacement = """      chatSessionStore.recordCompletionSnapshot(snapshot);\n      await taskCheckpointStore.finishRun(\n        ctx.sessionId,\n        ctx.messageId,\n        event.result.hitMaxTurns,\n      );\n      if (event.result.hitMaxTurns) {\n"""
if replacement not in hook:
    if needle not in hook:
        raise SystemExit("useChatSession run_finished anchor not found")
    hook = hook.replace(needle, replacement, 1)

# Any thrown completion/API/network error marks the current task interrupted.
# On the next run, the checkpoint prompt tells the model to verify side effects
# before continuing, avoiding blind replay of a command that may already have
# succeeded before the connection dropped.
needle = """      const errorMessage = (error as Error).message;\n"""
replacement = """      const errorMessage = (error as Error).message;\n      await taskCheckpointStore.markInterrupted(\n        messageInfo.sessionId,\n        messageInfo.id,\n        message.text,\n        errorMessage,\n      );\n"""
if replacement not in hook:
    if needle not in hook:
        raise SystemExit("useChatSession errorMessage anchor not found")
    hook = hook.replace(needle, replacement, 1)

hook_path.write_text(hook, encoding="utf-8")
print("Applied persistent task checkpoint lifecycle wiring")
