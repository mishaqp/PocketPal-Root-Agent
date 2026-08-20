#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")
checkpoint_path = root / "src/services/taskCheckpoint/TaskCheckpointStore.ts"
diagnostics_path = root / "src/screens/DiagnosticsScreen.tsx"

checkpoint = checkpoint_path.read_text(encoding="utf-8")
diagnostics = diagnostics_path.read_text(encoding="utf-8")

# A checkpoint is a durable milestone, never a reason to stop halfway through a
# user message that already contains the remaining steps.
needle = """      return [
        'RESUMABLE TASKS:',
        '- For a multi-step task that will use several tools, create/update task_checkpoint at meaningful milestones and call task_checkpoint.complete only after final verification.',
        '- Tool outcomes are also checkpointed automatically so a network/app interruption can be recovered on the next run.',
      ].join('\\n');
"""
replacement = """      return [
        'RESUMABLE TASKS:',
        '- For a multi-step task that will use several tools, create/update task_checkpoint at meaningful milestones and call task_checkpoint.complete only after final verification.',
        '- A checkpoint is a milestone, NOT a stopping point. After task_checkpoint.checkpoint succeeds, immediately continue with the next unfinished action in the same user request.',
        '- The complete current user message is already available. Never ask the user to send a later section/part if that section is already present in the message.',
        '- Do not end a multi-step run while a semantic checkpoint is still active unless progress truly requires new user-only information, explicit confirmation, or a safety boundary.',
        '- Tool outcomes are also checkpointed automatically so a network/app interruption can be recovered on the next run.',
      ].join('\\n');
"""
if replacement not in checkpoint:
    if needle not in checkpoint:
        raise SystemExit("TaskCheckpointStore empty checkpoint prompt anchor not found")
    checkpoint = checkpoint.replace(needle, replacement, 1)

needle = """      '- Update task_checkpoint after important milestones and mark complete only after final verification.',
"""
replacement = """      '- A checkpoint is a milestone, NOT a stopping point. Continue autonomously after saving it while unfinished actions from the current user request remain.',
      '- The complete current user message is already available. Never ask the user to resend a section/part that is already present.',
      '- Update task_checkpoint after important milestones and mark complete only after final verification.',
"""
if replacement not in checkpoint:
    if needle not in checkpoint:
        raise SystemExit("TaskCheckpointStore active checkpoint prompt anchor not found")
    checkpoint = checkpoint.replace(needle, replacement, 1)

# Diagnostics: include only safe model/session identity so a ZIP can explain why
# a model did or did not restore after an app restart. Never include API keys,
# server auth headers, prompts, or chat text.
needle = """import {rootAgentRuntimeStore} from '../services/rootAgent';
import {Theme} from '../utils/types';
"""
replacement = """import {rootAgentRuntimeStore} from '../services/rootAgent';
import {sessionModelSelectionStore} from '../services/modelPersistence/SessionModelSelectionStore';
import {chatSessionStore, modelStore} from '../store';
import {Theme} from '../utils/types';
"""
if replacement not in diagnostics:
    if needle not in diagnostics:
        raise SystemExit("DiagnosticsScreen import anchor not found")
    diagnostics = diagnostics.replace(needle, replacement, 1)

needle = """    try {
      const checkpoint = runtime.agent.checkpoint;
      const snapshot = {
        exportedAt: Date.now(),
"""
replacement = """    try {
      await sessionModelSelectionStore.ensureHydrated();
      const checkpoint = runtime.agent.checkpoint;
      const activeModel = modelStore.activeModel;
      const snapshot = {
        exportedAt: Date.now(),
        modelSelection: {
          activeSessionId: chatSessionStore.activeSessionId,
          activeModelId: modelStore.activeModelId,
          lastUsedModelId: modelStore.lastUsedModelId,
          activeModel: activeModel
            ? {
                id: activeModel.id,
                name: activeModel.name,
                origin: activeModel.origin,
                serverId: activeModel.serverId,
                remoteModelId: activeModel.remoteModelId,
              }
            : null,
          persistence: sessionModelSelectionStore.getSnapshot(
            chatSessionStore.activeSessionId,
          ),
        },
"""
if replacement not in diagnostics:
    if needle not in diagnostics:
        raise SystemExit("DiagnosticsScreen snapshot anchor not found")
    diagnostics = diagnostics.replace(needle, replacement, 1)

needle = """          <Text variant=\"bodyMedium\" style={styles.item}>
            • снимок Android/Termux/Linux/runtime/checkpoint без текста чата
          </Text>
"""
replacement = """          <Text variant=\"bodyMedium\" style={styles.item}>
            • снимок Android/Termux/Linux/runtime/checkpoint без текста чата
          </Text>
          <Text variant=\"bodyMedium\" style={styles.item}>
            • безопасные ID выбранной модели/провайдера и привязка модели к текущему диалогу — без API-ключей
          </Text>
"""
if replacement not in diagnostics:
    if needle not in diagnostics:
        raise SystemExit("DiagnosticsScreen description anchor not found")
    diagnostics = diagnostics.replace(needle, replacement, 1)

checkpoint_path.write_text(checkpoint, encoding="utf-8")
diagnostics_path.write_text(diagnostics, encoding="utf-8")
print("Applied checkpoint continuation policy + safe model diagnostics")
