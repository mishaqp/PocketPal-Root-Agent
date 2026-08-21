import * as RNFS from '@dr.pogodin/react-native-fs';

import {SSEParser} from './sseParser';
import type {RemoteModelInfo, StreamChatParams} from './openai';
import type {
  CompletionResult,
  CompletionStreamData,
  ToolCall,
} from '../utils/completionTypes';

const ANTHROPIC_VERSION = '2023-06-01';
const CONNECTION_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;
const REMOTE_IMAGE_MAX_BYTES = 12 * 1024 * 1024;

export function usesAnthropicProtocol(serverType?: string): boolean {
  return serverType === 'Anthropic' || serverType === 'VibeCode';
}

function normalizeUrl(value: string): string {
  return value.replace(/\/+$/, '');
}

function anthropicUrl(serverUrl: string, path: string): string {
  const base = normalizeUrl(serverUrl);
  const cleanPath = path.replace(/^\/+/, '');
  return base.endsWith('/v1')
    ? `${base}/${cleanPath}`
    : `${base}/v1/${cleanPath}`;
}

function resolveTimeout(value: number | undefined, fallback: number): number {
  return value != null && Number.isFinite(value) && value > 0 ? value : fallback;
}

function buildHeaders(apiKey?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': ANTHROPIC_VERSION,
  };
  if (apiKey) {
    headers['x-api-key'] = apiKey;
  }
  return headers;
}

export async function fetchAnthropicModelsWithHeaders(
  serverUrl: string,
  apiKey?: string,
  timeoutMs?: number,
): Promise<{models: RemoteModelInfo[]; headers: Record<string, string>}> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    resolveTimeout(timeoutMs, CONNECTION_TIMEOUT_MS),
  );

  try {
    const response = await fetch(anthropicUrl(serverUrl, 'models'), {
      method: 'GET',
      headers: buildHeaders(apiKey),
      signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 401) {
        throw new Error('Unauthorized: Invalid or missing API key');
      }
      throw new Error(`Server error: ${response.status} ${response.statusText}`);
    }

    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value: string, key: string) => {
      responseHeaders[key] = value;
    });
    const body = await response.json();
    const rows = Array.isArray(body?.data) ? body.data : [];
    return {
      models: rows
        .filter((row: any) => typeof row?.id === 'string' && row.id.length > 0)
        .map(
          (row: any): RemoteModelInfo => ({
            id: row.id,
            object: typeof row.type === 'string' ? row.type : 'model',
            owned_by: 'anthropic',
          }),
        ),
      headers: responseHeaders,
    };
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error('Connection timed out');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

type AnthropicBlock = Record<string, any>;
type AnthropicMessage = {role: 'user' | 'assistant'; content: AnthropicBlock[]};

function parseToolArguments(value: unknown): Record<string, any> {
  if (value && typeof value === 'object') {
    return value as Record<string, any>;
  }
  if (typeof value !== 'string' || !value.trim()) {
    return {};
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

async function imageBlockFromUrl(url: string): Promise<AnthropicBlock | null> {
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;,]+);base64,(.*)$/s);
    if (!match) return null;
    return {
      type: 'image',
      source: {type: 'base64', media_type: match[1], data: match[2]},
    };
  }
  if (url.startsWith('http://') || url.startsWith('https://')) {
    return {type: 'image', source: {type: 'url', url}};
  }

  const path = url.replace(/^file:\/\//, '');
  try {
    const info = await RNFS.stat(path);
    if (typeof info?.size === 'number' && info.size > REMOTE_IMAGE_MAX_BYTES) {
      return null;
    }
  } catch {
    // A stat failure should not prevent a valid readable image from being used.
  }

  try {
    const base64 = await RNFS.readFile(path, 'base64');
    const ext = path.toLowerCase().split('.').pop() ?? '';
    const mediaType =
      ext === 'png'
        ? 'image/png'
        : ext === 'gif'
          ? 'image/gif'
          : ext === 'webp'
            ? 'image/webp'
            : 'image/jpeg';
    return {
      type: 'image',
      source: {type: 'base64', media_type: mediaType, data: base64},
    };
  } catch {
    return null;
  }
}

async function contentToAnthropicBlocks(content: any): Promise<AnthropicBlock[]> {
  if (typeof content === 'string') {
    return content ? [{type: 'text', text: content}] : [];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const result: AnthropicBlock[] = [];
  for (const part of content) {
    if (part?.type === 'text' && typeof part.text === 'string') {
      result.push({type: 'text', text: part.text});
      continue;
    }
    if (part?.type === 'image_url' && typeof part?.image_url?.url === 'string') {
      const image = await imageBlockFromUrl(part.image_url.url);
      if (image) result.push(image);
    }
  }
  return result;
}

async function convertMessages(messages: any[]): Promise<{
  system?: string;
  messages: AnthropicMessage[];
}> {
  const systemParts: string[] = [];
  const converted: AnthropicMessage[] = [];

  for (const message of messages) {
    if (message?.role === 'system') {
      if (typeof message.content === 'string' && message.content.trim()) {
        systemParts.push(message.content);
      }
      continue;
    }

    if (message?.role === 'tool') {
      converted.push({
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: String(message.tool_call_id ?? ''),
            content:
              typeof message.content === 'string'
                ? message.content
                : JSON.stringify(message.content ?? ''),
          },
        ],
      });
      continue;
    }

    const role: 'user' | 'assistant' =
      message?.role === 'assistant' ? 'assistant' : 'user';
    const blocks = await contentToAnthropicBlocks(message?.content);

    if (role === 'assistant' && Array.isArray(message?.tool_calls)) {
      for (const call of message.tool_calls) {
        const fn = call?.function;
        if (!fn?.name) continue;
        blocks.push({
          type: 'tool_use',
          id: String(call.id ?? `tool-${Date.now()}`),
          name: String(fn.name),
          input: parseToolArguments(fn.arguments),
        });
      }
    }

    if (blocks.length === 0) {
      blocks.push({type: 'text', text: ''});
    }
    converted.push({role, content: blocks});
  }

  return {
    system: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    messages: converted,
  };
}

function convertTools(tools: any[] | undefined): AnthropicBlock[] | undefined {
  if (!Array.isArray(tools) || tools.length === 0) return undefined;
  const converted = tools
    .map(tool => tool?.function)
    .filter(fn => typeof fn?.name === 'string' && fn.name.length > 0)
    .map(fn => ({
      name: fn.name,
      description: fn.description,
      input_schema: fn.parameters ?? {type: 'object', properties: {}},
    }));
  return converted.length > 0 ? converted : undefined;
}

function convertToolChoice(choice: any): Record<string, any> | undefined {
  if (!choice || choice === 'auto') return {type: 'auto'};
  if (choice === 'required') return {type: 'any'};
  if (choice === 'none') return undefined;
  const name = choice?.function?.name;
  return typeof name === 'string' && name
    ? {type: 'tool', name}
    : {type: 'auto'};
}

export async function streamAnthropicMessages(
  params: StreamChatParams,
  serverUrl: string,
  apiKey?: string,
  signal?: AbortSignal,
  onToken?: (data: CompletionStreamData) => void,
  timeoutMs?: number,
): Promise<CompletionResult> {
  const converted = await convertMessages(params.messages as any[]);
  const tools = params.tool_choice === 'none' ? undefined : convertTools(params.tools);
  const body: Record<string, any> = {
    model: params.model,
    messages: converted.messages,
    max_tokens: Math.max(1, Math.trunc(params.max_tokens ?? 4096)),
    stream: true,
  };
  if (converted.system) body.system = converted.system;
  if (tools) {
    body.tools = tools;
    const toolChoice = convertToolChoice(params.tool_choice);
    if (toolChoice) body.tool_choice = toolChoice;
  }
  if (typeof params.temperature === 'number' && Number.isFinite(params.temperature)) {
    body.temperature = Math.max(0, Math.min(1, params.temperature));
  } else if (typeof params.top_p === 'number' && Number.isFinite(params.top_p)) {
    body.top_p = Math.max(0, Math.min(1, params.top_p));
  }
  if (Array.isArray(params.stop)) {
    body.stop_sequences = params.stop.slice(0, 4);
  } else if (typeof params.stop === 'string' && params.stop) {
    body.stop_sequences = [params.stop];
  }

  return new Promise<CompletionResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', anthropicUrl(serverUrl, 'messages'));
    for (const [key, value] of Object.entries(buildHeaders(apiKey))) {
      xhr.setRequestHeader(key, value);
    }

    const parser = new SSEParser();
    const toolAcc = new Map<
      number,
      {id: string; name: string; inputFragments: string[]}
    >();
    let fullContent = '';
    let fullReasoning = '';
    let stopReason: string | null = null;
    let inputTokens = 0;
    let outputTokens = 0;
    let lastProcessedLength = 0;
    let settled = false;

    const connectionTimeoutMs = resolveTimeout(timeoutMs, CONNECTION_TIMEOUT_MS);
    const idleTimeoutMs = resolveTimeout(timeoutMs, IDLE_TIMEOUT_MS);
    const connectionTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        xhr.abort();
        reject(new Error('Connection timed out'));
      }
    }, connectionTimeoutMs);
    let idleTimer: ReturnType<typeof setTimeout> | null = null;

    const cleanup = () => {
      clearTimeout(connectionTimer);
      if (idleTimer) clearTimeout(idleTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
    };
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          xhr.abort();
          reject(new Error('Idle timeout: no data received'));
        }
      }, idleTimeoutMs);
    };

    const buildToolCalls = (): ToolCall[] | undefined => {
      if (toolAcc.size === 0) return undefined;
      return Array.from(toolAcc.entries())
        .sort(([a], [b]) => a - b)
        .map(([, entry]) => ({
          id: entry.id,
          type: 'function' as const,
          function: {
            name: entry.name,
            arguments: entry.inputFragments.join('') || '{}',
          },
        }));
    };

    const snapshot = (): CompletionResult => ({
      text: fullContent,
      content: fullContent,
      reasoning_content: fullReasoning || undefined,
      tool_calls: buildToolCalls(),
      tokens_evaluated: inputTokens || undefined,
      tokens_predicted: outputTokens || undefined,
      stopped_eos: stopReason === 'end_turn' || stopReason === 'stop_sequence',
      stopped_limit: stopReason === 'max_tokens' ? 1 : undefined,
      interrupted: signal?.aborted === true,
    });

    const emit = (token?: string) => {
      if (!onToken) return;
      onToken({
        token,
        content: fullContent || undefined,
        reasoning_content: fullReasoning || undefined,
        tool_calls: buildToolCalls(),
        accumulated_text: fullContent,
      });
    };

    const handleEvent = (event: any) => {
      switch (event?.type) {
        case 'message_start':
          inputTokens = Number(event?.message?.usage?.input_tokens) || inputTokens;
          break;
        case 'content_block_start': {
          const index = Number(event.index);
          const block = event.block;
          if (block?.type === 'text' && typeof block.text === 'string') {
            fullContent += block.text;
            emit(block.text);
          } else if (block?.type === 'thinking' && typeof block.thinking === 'string') {
            fullReasoning += block.thinking;
            emit();
          } else if (block?.type === 'tool_use') {
            toolAcc.set(index, {
              id: String(block.id ?? `tool-${index}`),
              name: String(block.name ?? ''),
              inputFragments:
                block.input && Object.keys(block.input).length > 0
                  ? [JSON.stringify(block.input)]
                  : [],
            });
            emit();
          }
          break;
        }
        case 'content_block_delta': {
          const delta = event.delta;
          const index = Number(event.index);
          if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
            fullContent += delta.text;
            emit(delta.text);
          } else if (
            delta?.type === 'thinking_delta' &&
            typeof delta.thinking === 'string'
          ) {
            fullReasoning += delta.thinking;
            emit();
          } else if (
            delta?.type === 'input_json_delta' &&
            typeof delta.partial_json === 'string'
          ) {
            const entry = toolAcc.get(index) ?? {
              id: `tool-${index}`,
              name: '',
              inputFragments: [],
            };
            entry.inputFragments.push(delta.partial_json);
            toolAcc.set(index, entry);
            emit();
          }
          break;
        }
        case 'message_delta':
          stopReason = event?.delta?.stop_reason ?? stopReason;
          outputTokens = Number(event?.usage?.output_tokens) || outputTokens;
          break;
        default:
          break;
      }
    };

    const processNewData = () => {
      const text = xhr.responseText || '';
      const chunk = text.slice(lastProcessedLength);
      lastProcessedLength = text.length;
      if (!chunk) return;
      clearTimeout(connectionTimer);
      resetIdleTimer();
      for (const event of parser.feed(chunk)) {
        if (event !== 'done') handleEvent(event);
      }
    };

    const onAbort = () => xhr.abort();
    if (signal) {
      if (signal.aborted) {
        cleanup();
        resolve({...snapshot(), interrupted: true});
        return;
      }
      signal.addEventListener('abort', onAbort, {once: true});
    }

    xhr.onprogress = processNewData;
    xhr.onload = () => {
      processNewData();
      for (const event of parser.flush()) {
        if (event !== 'done') handleEvent(event);
      }
      if (settled) return;
      settled = true;
      cleanup();
      if (xhr.status < 200 || xhr.status >= 300) {
        let message = `Server error: ${xhr.status}`;
        try {
          const parsed = JSON.parse(xhr.responseText || '{}');
          message = parsed?.error?.message || message;
        } catch {
          // Keep generic HTTP error.
        }
        reject(new Error(message));
        return;
      }
      resolve(snapshot());
    };
    xhr.onerror = () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('Network request failed'));
    };
    xhr.onabort = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (signal?.aborted) {
        resolve({...snapshot(), interrupted: true});
      } else {
        reject(new Error('Request aborted'));
      }
    };

    xhr.send(JSON.stringify(body));
  });
}
