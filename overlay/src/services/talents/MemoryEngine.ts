import {extensionStore} from '../../store/ExtensionStore';
import type {
  SystemPromptContext,
  TalentEngine,
  TalentResult,
  ToolDefinition,
} from './types';

type MemoryScope = 'global' | 'pal';

export class MemoryEngine implements TalentEngine {
  readonly name = 'memory';

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Read or update user-approved long-term memory. Never store passwords, tokens, private keys, or authentication data.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list', 'read', 'write', 'delete'],
            },
            scope: {type: 'string', enum: ['global', 'pal']},
            key: {type: 'string', maxLength: 64},
            value: {type: 'string', maxLength: 2000},
          },
          required: ['action'],
          additionalProperties: false,
        },
      },
    };
  }

  systemPromptFragment(_ctx: SystemPromptContext): string {
    return [
      'The memory tool stores stable user facts and preferences across chats.',
      'Use pal scope for facts relevant only to the active Pal; otherwise use global.',
      'Do not store passwords, API keys, tokens, private keys, or transient one-off details.',
      'Do not claim a memory was saved unless the tool returns success.',
    ].join(' ');
  }

  async execute(args: Record<string, unknown>): Promise<TalentResult> {
    const action = String(args.action ?? '');
    const scope: MemoryScope = args.scope === 'pal' ? 'pal' : 'global';
    const key = String(args.key ?? '').trim();

    if (action === 'list' || action === 'read') {
      const text =
        scope === 'pal'
          ? extensionStore.activePalId
            ? extensionStore.palMemory[extensionStore.activePalId] ?? ''
            : ''
          : extensionStore.globalMemory;
      return {
        type: 'text',
        summary: text || `No ${scope} memory saved.`,
      };
    }

    if (action === 'write') {
      const value = String(args.value ?? '').trim();
      await extensionStore.writeMemoryEntry(scope, key, value);
      return {
        type: 'text',
        summary: `Saved ${scope} memory entry "${key}".`,
      };
    }

    if (action === 'delete') {
      const deleted = await extensionStore.deleteMemoryEntry(scope, key);
      return {
        type: 'text',
        summary: deleted
          ? `Deleted ${scope} memory entry "${key}".`
          : `Memory entry "${key}" was not found.`,
      };
    }

    return {
      type: 'error',
      summary: 'Unsupported memory action.',
      errorMessage: 'Unsupported memory action',
    };
  }
}

