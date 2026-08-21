#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")
openai = root / "src/api/openai.ts"
runner = root / "src/services/agent/AgentRunner.ts"


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one anchor in {path}, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


replace_once(
    openai,
    "import {SSEParser} from './sseParser';\n",
    "import {SSEParser} from './sseParser';\n"
    "import {\n"
    "  parseDsmlToolCalls,\n"
    "  stripDsmlToolCallsForDisplay,\n"
    "} from './dsmlToolCalls';\n",
    "DSML import",
)

replace_once(
    openai,
    "        if (\n          onToken &&\n",
    "        const visibleContent = stripDsmlToolCallsForDisplay(fullContent);\n"
    "        if (\n          onToken &&\n",
    "stream display sanitization",
)

replace_once(
    openai,
    "            content: fullContent || undefined,\n"
    "            reasoning_content: fullReasoningContent || undefined,\n",
    "            content: visibleContent || undefined,\n"
    "            reasoning_content: fullReasoningContent || undefined,\n",
    "stream sanitized content",
)

replace_once(
    openai,
    "      // Mirror llama.rn's shape: undefined when no tool_calls were\n"
    "      // observed during the stream.\n"
    "      const finalToolCalls = assembleFinalToolCalls(toolCallAcc);\n",
    "      // Mirror llama.rn's shape when the gateway emits structured calls.\n"
    "      // DeepSeek V4 gateways can instead leak native DSML markup inside\n"
    "      // message.content, so normalize that markup as a compatibility path.\n"
    "      const structuredToolCalls = assembleFinalToolCalls(toolCallAcc);\n"
    "      const dsmlToolCalls = structuredToolCalls?.length\n"
    "        ? []\n"
    "        : parseDsmlToolCalls(fullContent);\n"
    "      const finalToolCalls =\n"
    "        structuredToolCalls ??\n"
    "        (dsmlToolCalls.length > 0 ? dsmlToolCalls : undefined);\n"
    "      const finalContent =\n"
    "        dsmlToolCalls.length > 0\n"
    "          ? stripDsmlToolCallsForDisplay(fullContent)\n"
    "          : fullContent;\n",
    "final DSML normalization",
)

replace_once(
    openai,
    "      if (signal?.aborted) {\n"
    "        resolve({\n"
    "          text: fullContent,\n"
    "          content: fullContent,\n",
    "      if (signal?.aborted) {\n"
    "        resolve({\n"
    "          text: finalContent,\n"
    "          content: finalContent,\n",
    "aborted normalized content",
)

replace_once(
    openai,
    "      const result: CompletionResult = {\n"
    "        text: fullContent,\n"
    "        content: fullContent,\n",
    "      const result: CompletionResult = {\n"
    "        text: finalContent,\n"
    "        content: finalContent,\n",
    "final normalized content",
)

replace_once(
    runner,
    "export const DEFAULT_MAX_TURNS = 5;\n",
    "// Large phone jobs often need many sequential read/action rounds. Keep a\n"
    "// finite runaway guard, but do not force-finalize normal multi-step tasks.\n"
    "export const DEFAULT_MAX_TURNS = 20;\n",
    "agent turn budget",
)

print("Applied DeepSeek DSML normalization and 20-turn agent budget")
