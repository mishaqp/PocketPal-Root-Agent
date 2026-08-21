import {extensionStore} from '../../store/ExtensionStore';
import {talentRegistry} from './TalentRegistry';
import type {
  SystemPromptContext,
  TalentEngine,
  TalentResult,
  ToolDefinition,
} from './types';

const FORBIDDEN_PLUGIN_TALENTS = new Set([
  'android_system',
  'termux',
  'task_checkpoint',
  'agent_extensions',
]);

export class AgentExtensionsEngine implements TalentEngine {
  readonly name = 'agent_extensions';

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Inspect installed skills/plugins or run a plugin through its allowlisted built-in talent.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['list_skills', 'get_skill', 'list_plugins', 'run_plugin'],
            },
            id: {type: 'string'},
            talent: {type: 'string'},
            arguments: {type: 'object'},
          },
          required: ['action'],
          additionalProperties: false,
        },
      },
    };
  }

  systemPromptFragment(_ctx: SystemPromptContext): string | null {
    const plugins = extensionStore.plugins.filter(plugin => plugin.enabled);
    if (plugins.length === 0) {
      return 'No user plugins are enabled. Skills, if enabled, are already included in the system prompt.';
    }
    return `Enabled plugins:\n${plugins
      .map(
        plugin =>
          `- ${plugin.id}: ${plugin.name}; allowed talents: ${plugin.talents.join(', ')}`,
      )
      .join('\n')}\nUse run_plugin only with a listed plugin and talent.`;
  }

  async execute(args: Record<string, unknown>): Promise<TalentResult> {
    const action = String(args.action ?? '');
    const id = String(args.id ?? '');

    if (action === 'list_skills') {
      const skills = extensionStore.skills.map(
        skill =>
          `${skill.id} | ${skill.enabled ? 'enabled' : 'disabled'} | ${skill.name} | ${skill.description}`,
      );
      return {type: 'text', summary: skills.join('\n') || 'No skills installed.'};
    }

    if (action === 'get_skill') {
      const skill = extensionStore.skills.find(item => item.id === id);
      return skill
        ? {
            type: 'text',
            summary: `${skill.name}\n\n${skill.instructions}`,
          }
        : {
            type: 'error',
            summary: `Skill "${id}" was not found.`,
            errorMessage: 'Skill not found',
          };
    }

    if (action === 'list_plugins') {
      const plugins = extensionStore.plugins.map(
        plugin =>
          `${plugin.id} | ${plugin.enabled ? 'enabled' : 'disabled'} | ${plugin.name} | ${plugin.talents.join(', ')}`,
      );
      return {
        type: 'text',
        summary: plugins.join('\n') || 'No plugins installed.',
      };
    }

    if (action === 'run_plugin') {
      const plugin = extensionStore.plugins.find(
        item => item.id === id && item.enabled,
      );
      if (!plugin) {
        return {
          type: 'error',
          summary: `Enabled plugin "${id}" was not found.`,
          errorMessage: 'Plugin not found or disabled',
        };
      }
      const talentName = String(args.talent ?? '');
      if (
        !plugin.talents.includes(talentName) ||
        FORBIDDEN_PLUGIN_TALENTS.has(talentName)
      ) {
        return {
          type: 'error',
          summary: `Plugin "${id}" is not allowed to run "${talentName}".`,
          errorMessage: 'Plugin permission denied',
        };
      }
      const engine = talentRegistry.get(talentName);
      if (!engine) {
        return {
          type: 'error',
          summary: `Talent "${talentName}" is not installed.`,
          errorMessage: 'Talent unavailable',
        };
      }
      const nestedArgs =
        args.arguments && typeof args.arguments === 'object'
          ? (args.arguments as Record<string, unknown>)
          : {};
      return engine.execute(nestedArgs);
    }

    return {
      type: 'error',
      summary: 'Unsupported extension action.',
      errorMessage: 'Unsupported extension action',
    };
  }
}
