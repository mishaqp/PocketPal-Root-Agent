#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")
chat_screen_path = root / "src/screens/ChatScreen/ChatScreen.tsx"
text = chat_screen_path.read_text(encoding="utf-8")

import_anchor = """import {VideoPalScreen} from './VideoPalScreen';\n"""
import_replacement = import_anchor + "import {AgentActivityPanel} from '../../components/AgentActivityPanel';\n"
if import_replacement not in text:
    if import_anchor not in text:
        raise SystemExit("ChatScreen import anchor not found")
    text = text.replace(import_anchor, import_replacement, 1)

view_anchor = """      <ChatView\n        renderBubble={renderBubble}\n"""
view_replacement = """      <ChatView\n        customContent={<AgentActivityPanel />}\n        renderBubble={renderBubble}\n"""
if view_replacement not in text:
    if view_anchor not in text:
        raise SystemExit("ChatScreen ChatView anchor not found")
    text = text.replace(view_anchor, view_replacement, 1)

chat_screen_path.write_text(text, encoding="utf-8")
print("Applied in-chat Root Agent activity panel")
