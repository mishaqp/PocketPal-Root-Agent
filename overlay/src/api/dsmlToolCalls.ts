import type {ToolCall} from '../utils/completionTypes';

// DeepSeek V4 emits native tool calls as DSML markup. Some OpenAI-compatible
// gateways return that markup inside message.content instead of normalizing it
// into choice.delta.tool_calls. Accept both the documented full-width pipe and
// the common one/two-pipe drift seen in real gateways.
const DSML = '[|｜]{1,2}DSML[|｜]{1,2}';
const BLOCK_SOURCE = `<${DSML}(?:tool_calls|function_calls)>[\\s\\S]*?<\\/${DSML}(?:tool_calls|function_calls)>`;
const START_RE = new RegExp(`<${DSML}(?:tool_calls|function_calls)>`, 'i');
const BLOCK_RE = new RegExp(BLOCK_SOURCE, 'gi');
const INVOKE_RE = new RegExp(
  `<${DSML}invoke\\s+name=(?:"([^"]+)"|'([^']+)')[^>]*>([\\s\\S]*?)<\\/${DSML}invoke>`,
  'gi',
);
const PARAM_RE = new RegExp(
  `<${DSML}parameter\\s+name=(?:"([^"]+)"|'([^']+)')\\s+string=(?:"(true|false)"|'(true|false)')[^>]*>([\\s\\S]*?)<\\/${DSML}parameter>`,
  'gi',
);
const EOS_RE = /<[|｜]{1,2}end▁of▁sentence[|｜]{1,2}>/gi;

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseParameter(raw: string, isString: boolean): unknown {
  const value = decodeXmlEntities(raw).trim();
  if (isString) {
    return value;
  }
  try {
    return JSON.parse(value);
  } catch {
    // A malformed non-string parameter should not make the whole tool call
    // disappear. Passing the literal value lets the tool's own schema/validator
    // return a useful error to the model on the next agent turn.
    return value;
  }
}

/** Parse DeepSeek DSML blocks into the same ToolCall shape used by OpenAI. */
export function parseDsmlToolCalls(content: string): ToolCall[] {
  if (!content || !/DSML/i.test(content)) {
    return [];
  }

  const calls: ToolCall[] = [];
  const blocks = content.match(BLOCK_RE) ?? [];
  for (const block of blocks) {
    INVOKE_RE.lastIndex = 0;
    let invoke: RegExpExecArray | null;
    while ((invoke = INVOKE_RE.exec(block)) !== null) {
      const name = (invoke[1] ?? invoke[2] ?? '').trim();
      if (!name) {
        continue;
      }
      const body = invoke[3] ?? '';
      const args: Record<string, unknown> = {};

      PARAM_RE.lastIndex = 0;
      let param: RegExpExecArray | null;
      while ((param = PARAM_RE.exec(body)) !== null) {
        const paramName = (param[1] ?? param[2] ?? '').trim();
        if (!paramName) {
          continue;
        }
        const stringFlag = (param[3] ?? param[4] ?? 'true') === 'true';
        args[paramName] = parseParameter(param[5] ?? '', stringFlag);
      }

      calls.push({
        id: '',
        type: 'function',
        function: {
          name,
          arguments: JSON.stringify(args),
        },
      });
    }
  }

  return calls;
}

/**
 * Hide DSML protocol markup from the chat while it is streaming. Complete
 * blocks are removed; if a block has started but is not complete yet, only the
 * human-readable preamble before the block is shown.
 */
export function stripDsmlToolCallsForDisplay(content: string): string {
  if (!content || !/DSML/i.test(content)) {
    return content;
  }

  let visible = content.replace(BLOCK_RE, '');
  const partialStart = visible.search(START_RE);
  if (partialStart >= 0) {
    visible = visible.slice(0, partialStart);
  }
  return visible.replace(EOS_RE, '').trimEnd();
}
