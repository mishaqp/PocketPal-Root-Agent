#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")
runner_types_path = root / "src/services/agent/AgentRunner.types.ts"
runner_path = root / "src/services/agent/AgentRunner.ts"
hook_path = root / "src/hooks/useChatSession.ts"
chat_view_path = root / "src/components/ChatView/ChatView.tsx"
picker_path = root / "src/components/ChatPalModelPickerSheet/ChatPalModelPickerSheet.tsx"

runner_types = runner_types_path.read_text(encoding="utf-8")
runner = runner_path.read_text(encoding="utf-8")
hook = hook_path.read_text(encoding="utf-8")
chat_view = chat_view_path.read_text(encoding="utf-8")
picker = picker_path.read_text(encoding="utf-8")

# ---------------------------------------------------------------------------
# 1. AgentRunner: allow the caller to keep a semantic checkpoint-driven task
#    alive even when the model prematurely emits a text-only "final" answer.
#    The runner remains store-free: the decision is injected by the hook.
# ---------------------------------------------------------------------------
needle = """  messageId: string;\n  maxTurns?: number;\n  signal?: AbortSignal;\n}\n"""
replacement = """  messageId: string;\n  maxTurns?: number;\n  /** Called after a text-only turn. Returning true keeps the SAME run alive. */\n  shouldContinueAfterText?: (context: {\n    turn: number;\n    content: string;\n    reasoningContent?: string;\n  }) => boolean | Promise<boolean>;\n  /** Synthetic user nudge appended only when shouldContinueAfterText returns true. */\n  continuationNudge?: string;\n  signal?: AbortSignal;\n}\n"""
if replacement not in runner_types:
    if needle not in runner_types:
        raise SystemExit("AgentRunner.types option anchor not found")
    runner_types = runner_types.replace(needle, replacement, 1)

needle = """const BUDGET_EXHAUSTED_NUDGE =\n  '(Tool budget exhausted. Answer now using only the information gathered above; if it is insufficient, say what is missing.)';\n"""
replacement = needle + """\n\nconst DEFAULT_CONTINUATION_NUDGE =\n  'Continue the unfinished task from the current checkpoint now. The complete original user request is already in this conversation. Do not ask the user to resend later sections that are already present. Verify state as needed, perform the next unfinished action, update the checkpoint at meaningful milestones, and call task_checkpoint.complete only after final verification.';\n"""
if replacement not in runner:
    if needle not in runner:
        raise SystemExit("AgentRunner nudge anchor not found")
    runner = runner.replace(needle, replacement, 1)

needle = """function buildNextTurnMessages(\n  prior: ApiCompletionParams['messages'],\n  assistantContent: string,\n  toolCalls: AgentToolCall[],\n  outcomes: AgentToolOutcome[],\n  reasoningContent?: string,\n): ApiCompletionParams['messages'] {\n"""
if needle not in runner:
    raise SystemExit("AgentRunner buildNextTurnMessages anchor not found")

# Insert helper immediately before runAgent, after buildNextTurnMessages closes.
needle = """}\n\n/**\n * The agent loop. Returns an `AsyncIterable<AgentEvent>` so the hook\n"""
helper = """}\n\n/** Append a text-only assistant turn plus a synthetic continuation request. */\nfunction buildContinuationMessages(\n  prior: ApiCompletionParams['messages'],\n  assistantContent: string,\n  continuationNudge: string,\n  reasoningContent?: string,\n): ApiCompletionParams['messages'] {\n  const assistantMsg: ChatMessage = {\n    role: 'assistant',\n    content: assistantContent,\n  };\n  if (reasoningContent && reasoningContent.length > 0) {\n    assistantMsg.reasoning_content = reasoningContent;\n  }\n  const userMsg: ChatMessage = {role: 'user', content: continuationNudge};\n  return [\n    ...(prior ?? []),\n    assistantMsg as unknown as NonNullable<\n      ApiCompletionParams['messages']\n    >[number],\n    userMsg as unknown as NonNullable<ApiCompletionParams['messages']>[number],\n  ];\n}\n\n/**\n * The agent loop. Returns an `AsyncIterable<AgentEvent>` so the hook\n"""
if helper not in runner:
    if needle not in runner:
        raise SystemExit("AgentRunner helper insertion anchor not found")
    runner = runner.replace(needle, helper, 1)

needle = """    messageId,\n    maxTurns = DEFAULT_MAX_TURNS,\n    signal,\n  } = options;\n"""
replacement = """    messageId,\n    maxTurns = DEFAULT_MAX_TURNS,\n    shouldContinueAfterText,\n    continuationNudge = DEFAULT_CONTINUATION_NUDGE,\n    signal,\n  } = options;\n"""
if replacement not in runner:
    if needle not in runner:
        raise SystemExit("AgentRunner destructure anchor not found")
    runner = runner.replace(needle, replacement, 1)

needle = """      if (!calls || calls.length === 0) {\n        // No tools requested — final answer landed.\n        break;\n      }\n"""
replacement = """      if (!calls || calls.length === 0) {\n        // A semantic task_checkpoint means a text-only answer is NOT always a\n        // final answer. Ask the injected guard before ending the run. This is\n        // intentionally caller-driven so AgentRunner stays free of stores.\n        const keepGoing =\n          !!shouldContinueAfterText &&\n          turn + 1 < maxTurns &&\n          (await shouldContinueAfterText({\n            turn,\n            content: finishedResult.content ?? '',\n            reasoningContent: finishedResult.reasoning_content,\n          }));\n        if (keepGoing) {\n          messages = buildContinuationMessages(\n            messages,\n            finishedResult.content ?? '',\n            continuationNudge,\n            finishedResult.reasoning_content,\n          );\n          turn += 1;\n          continue;\n        }\n        // No tools requested and no active semantic checkpoint — final answer.\n        break;\n      }\n"""
if replacement not in runner:
    if needle not in runner:
        raise SystemExit("AgentRunner text-only finish anchor not found")
    runner = runner.replace(needle, replacement, 1)

# Hook injects the semantic-checkpoint continuation decision. apply-task-checkpoint.py
# runs before this script and already imports taskCheckpointStore.
needle = """        triggerMarkers,\n        messageId: messageInfo.id,\n        signal: abortRef.current.signal,\n"""
replacement = """        triggerMarkers,\n        messageId: messageInfo.id,\n        shouldContinueAfterText: async () => {\n          await taskCheckpointStore.ensureHydrated();\n          const checkpoint = taskCheckpointStore.getForSession(\n            messageInfo.sessionId,\n          );\n          return !!(\n            checkpoint &&\n            checkpoint.messageId === messageInfo.id &&\n            checkpoint.status === 'active' &&\n            checkpoint.autoManaged === false &&\n            checkpoint.nextAction\n          );\n        },\n        signal: abortRef.current.signal,\n"""
if replacement not in hook:
    if needle not in hook:
        raise SystemExit("useChatSession runAgent anchor not found")
    hook = hook.replace(needle, replacement, 1)

# ---------------------------------------------------------------------------
# 2. Per-chat model persistence and automatic restoration.
# ---------------------------------------------------------------------------
needle = """import {chatSessionStore, modelStore} from '../../store';\n"""
replacement = needle + """import {sessionModelSelectionStore} from '../../services/modelPersistence/SessionModelSelectionStore';\n"""
if replacement not in chat_view:
    if needle not in chat_view:
        raise SystemExit("ChatView store import anchor not found")
    chat_view = chat_view.replace(needle, replacement, 1)

# Restore after the existing Pal-default effect. A persisted per-session binding
# wins; a new/legacy chat can fall back to Pal default or upstream lastUsedModelId.
needle = """    }, [activePal]);\n\n    // ============ KEYBOARD ANIMATION SETUP ============\n"""
replacement = """    }, [activePal]);\n\n    // ============ ROOT AGENT MODEL RESTORATION ============\n    // Upstream persists only lastUsedModelId. Root Agent additionally remembers\n    // the explicit model for each chat and a default for blank/new chats.\n    React.useEffect(() => {\n      let cancelled = false;\n      void (async () => {\n        if (modelStore.benchmarkActive) return;\n        const fallbackModelId =\n          activePal?.defaultModel?.id ?? modelStore.lastUsedModelId;\n        const desiredModelId = await sessionModelSelectionStore.resolveModelId(\n          chatSessionStore.activeSessionId,\n          fallbackModelId,\n        );\n        if (cancelled || !desiredModelId) return;\n        if (\n          modelStore.activeModelId === desiredModelId &&\n          modelStore.engine\n        ) {\n          return;\n        }\n        const desiredModel = modelStore.availableModels.find(\n          model => model.id === desiredModelId,\n        );\n        if (!desiredModel) {\n          console.warn(\n            `[model-persistence] model unavailable session=${chatSessionStore.activeSessionId ?? 'new'} model=${desiredModelId}`,\n          );\n          return;\n        }\n        try {\n          console.info(\n            `[model-persistence] restoring session=${chatSessionStore.activeSessionId ?? 'new'} model=${desiredModelId}`,\n          );\n          await modelStore.selectModel(desiredModel);\n        } catch (error) {\n          console.warn('[model-persistence] restore failed:', error);\n        }\n      })();\n      return () => {\n        cancelled = true;\n      };\n      // availableModels length changes when remote models hydrate; rerun so a\n      // persisted remote model can restore once it becomes available.\n    }, [\n      chatSessionStore.activeSessionId,\n      activePal?.id,\n      activePal?.defaultModel?.id,\n      modelStore.lastUsedModelId,\n      modelStore.availableModels.length,\n    ]);\n\n    // ============ KEYBOARD ANIMATION SETUP ============\n"""
if replacement not in chat_view:
    if needle not in chat_view:
        raise SystemExit("ChatView model restoration anchor not found")
    chat_view = chat_view.replace(needle, replacement, 1)

needle = """import {modelStore, palStore, chatSessionStore} from '../../store';\n"""
replacement = needle + """import {sessionModelSelectionStore} from '../../services/modelPersistence/SessionModelSelectionStore';\n"""
if replacement not in picker:
    if needle not in picker:
        raise SystemExit("Model picker store import anchor not found")
    picker = picker.replace(needle, replacement, 1)

needle = """    const handleModelSelect = React.useCallback(\n      async (model: (typeof modelStore.availableModels)[0]) => {\n        try {\n          onModelSelect?.(model.id);\n          onClose();\n          modelStore.selectModel(model);\n        } catch (e) {\n          console.log(`Error: ${e}`);\n        }\n      },\n      [onModelSelect, onClose],\n    );\n"""
replacement = """    const selectAndRememberModel = React.useCallback(\n      async (model: (typeof modelStore.availableModels)[0]) => {\n        await modelStore.selectModel(model);\n        await sessionModelSelectionStore.rememberSelection(\n          chatSessionStore.activeSessionId,\n          model.id,\n        );\n        console.info(\n          `[model-persistence] selected session=${chatSessionStore.activeSessionId ?? 'new'} model=${model.id}`,\n        );\n      },\n      [],\n    );\n\n    const handleModelSelect = React.useCallback(\n      async (model: (typeof modelStore.availableModels)[0]) => {\n        try {\n          onModelSelect?.(model.id);\n          onClose();\n          await selectAndRememberModel(model);\n        } catch (e) {\n          console.log(`Error: ${e}`);\n        }\n      },\n      [onModelSelect, onClose, selectAndRememberModel],\n    );\n"""
if replacement not in picker:
    if needle not in picker:
        raise SystemExit("Model picker selection anchor not found")
    picker = picker.replace(needle, replacement, 1)

# Pal's optional default-model switch is also an explicit model choice for this
# chat, so remember it when the user presses Switch.
needle = """                  onPress: () => {\n                    modelStore.selectModel(palDefaultModel);\n                  },\n"""
replacement = """                  onPress: () => {\n                    void selectAndRememberModel(palDefaultModel);\n                  },\n"""
if replacement not in picker:
    if needle not in picker:
        raise SystemExit("Model picker Pal switch anchor not found")
    picker = picker.replace(needle, replacement, 1)

runner_types_path.write_text(runner_types, encoding="utf-8")
runner_path.write_text(runner, encoding="utf-8")
hook_path.write_text(hook, encoding="utf-8")
chat_view_path.write_text(chat_view, encoding="utf-8")
picker_path.write_text(picker, encoding="utf-8")
print("Applied checkpoint-driven autonomous continuation + per-chat model persistence")
