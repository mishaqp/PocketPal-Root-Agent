#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")
path = root / "src/services/taskCheckpoint/TaskCheckpointStore.ts"
text = path.read_text(encoding="utf-8")

needle = """      status: 'completed',\n      step: previous?.step ?? 0,\n      ...(previous?.totalSteps !== undefined ? {totalSteps: previous.totalSteps} : {}),\n"""
replacement = """      status: 'completed',\n      // Explicit completion means every declared milestone is complete. Keep\n      // the persisted progress coherent (e.g. 7/7 instead of 6/7 after the\n      // final verification step calls task_checkpoint.complete).\n      step: previous?.totalSteps ?? previous?.step ?? 0,\n      ...(previous?.totalSteps !== undefined ? {totalSteps: previous.totalSteps} : {}),\n"""
if replacement not in text:
    if needle not in text:
        raise SystemExit("TaskCheckpointStore complete progress anchor not found")
    text = text.replace(needle, replacement, 1)

path.write_text(text, encoding="utf-8")
print("Applied completed checkpoint progress fix")
