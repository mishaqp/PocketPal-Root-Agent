import {modelStore} from '../../store';
import {ModelOrigin} from '../../utils/types';
import {scheduledAgentControl} from '../scheduledAgent/ScheduledAgentControl';
import {
  scheduledAgentStore,
  ScheduledAgentMode,
} from '../scheduledAgent/ScheduledAgentStore';
import type {
  SystemPromptContext,
  TalentEngine,
  TalentResult,
  ToolDefinition,
} from './types';

/** Persistent unattended tasks backed by AlarmManager + Headless JS. */
export class ScheduledAgentEngine implements TalentEngine {
  readonly name = 'scheduled_agent';

  systemPromptFragment(_ctx: SystemPromptContext): string {
    return [
      'SCHEDULED AGENT TASKS:',
      '- scheduled_agent creates persistent tasks that can wake Root Agent later and run through the saved remote/API model.',
      '- Default to mode=read_only. Use mode=action only when the user explicitly asks the future task to change device/files/state.',
      '- allowReboot must remain false unless the user explicitly requested a scheduled reboot in the current message.',
      '- Use a future local ISO date-time for fixedTime, or countdownMinutes for a relative delay.',
      '- repeatDaily means the same local clock time every day and is restored after device reboot/app update.',
      '- Do not claim a task was scheduled until this tool returns success.',
    ].join('\n');
  }

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const action = typeof args.action === 'string' ? args.action : '';
    try {
      if (action === 'status') {
        return this.json(await scheduledAgentControl.getStatus());
      }

      if (action === 'list') {
        const tasks = await scheduledAgentStore.list();
        return this.json(
          tasks.map(task => ({
            id: task.id,
            title: task.title,
            prompt: task.prompt,
            modelId: task.modelId,
            triggerAt: new Date(task.triggerAtMs).toISOString(),
            repeatDaily: task.repeatDaily,
            mode: task.mode,
            allowReboot: task.allowReboot,
            notify: task.notify,
            enabled: task.enabled,
            status: task.status,
            lastRunAt: task.lastRunAt,
            lastCompletedAt: task.lastCompletedAt,
            nextRunAt: task.nextRunAt,
            lastResult: task.lastResult,
            lastError: task.lastError,
          })),
        );
      }

      if (action === 'create') {
        const activeModel = modelStore.activeModel;
        if (!activeModel || activeModel.origin !== ModelOrigin.REMOTE) {
          throw new Error(
            'Select a remote/API model before creating a scheduled agent task',
          );
        }
        const title = this.requiredString(args.title, 'title');
        const prompt = this.requiredString(args.prompt, 'prompt');
        const triggerAtMs = this.resolveTrigger(args);
        const mode: ScheduledAgentMode =
          args.mode === 'action' ? 'action' : 'read_only';
        const created = await scheduledAgentStore.create({
          title,
          prompt,
          modelId: activeModel.id,
          triggerAtMs,
          repeatDaily: args.repeatDaily === true,
          mode,
          allowReboot: mode === 'action' && args.allowReboot === true,
          notify: args.notify !== false,
        });
        return this.json({
          created: true,
          task: {
            id: created.task.id,
            title: created.task.title,
            modelId: created.task.modelId,
            triggerAt: new Date(created.task.triggerAtMs).toString(),
            repeatDaily: created.task.repeatDaily,
            mode: created.task.mode,
            allowReboot: created.task.allowReboot,
            notify: created.task.notify,
          },
          native: created.native,
          note: created.native.exact
            ? 'Exact alarm access is available.'
            : 'Scheduled with Android inexact allow-while-idle fallback; delivery time may drift.',
        });
      }

      if (action === 'delete') {
        const id = this.requiredString(args.taskId, 'taskId');
        return this.json({deleted: await scheduledAgentStore.remove(id), id});
      }

      if (action === 'disable') {
        const id = this.requiredString(args.taskId, 'taskId');
        return this.json(await scheduledAgentStore.disable(id));
      }

      if (action === 'run_now') {
        const id = this.requiredString(args.taskId, 'taskId');
        return this.json({started: await scheduledAgentStore.runNow(id), id});
      }

      return {
        type: 'error',
        summary: 'scheduled_agent: unsupported action',
        errorMessage: 'Use status, list, create, delete, disable, or run_now.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        type: 'error',
        summary: `scheduled_agent failed: ${message}`,
        errorMessage: message,
      };
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Create, inspect, run, disable, or delete persistent unattended Root Agent tasks. Tasks use the currently selected remote/API model and survive app/device restarts.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['status', 'list', 'create', 'delete', 'disable', 'run_now'],
            },
            taskId: {
              type: 'string',
              description: 'Existing scheduled task id for delete/disable/run_now.',
            },
            title: {
              type: 'string',
              description: 'Short user-facing task title.',
            },
            prompt: {
              type: 'string',
              description:
                'Self-contained instruction to execute when the task fires. Preserve the user intent and relevant constraints.',
            },
            fixedTime: {
              type: 'string',
              description:
                'Local ISO date-time, for example 2026-08-21T08:30:00. Use instead of countdownMinutes.',
            },
            countdownMinutes: {
              type: 'number',
              minimum: 1,
              maximum: 525600,
              description: 'Relative delay in minutes. Use instead of fixedTime.',
            },
            repeatDaily: {
              type: 'boolean',
              description: 'Repeat every day at the same local clock time.',
            },
            mode: {
              type: 'string',
              enum: ['read_only', 'action'],
              description:
                'read_only is the safe default. action is only for an explicitly requested future state-changing task.',
            },
            allowReboot: {
              type: 'boolean',
              description:
                'Permit android_system reboot during an action task. Set true only after an explicit scheduled reboot request.',
            },
            notify: {
              type: 'boolean',
              description: 'Show a generic completion/failure notification. Default true.',
            },
          },
          required: ['action'],
          additionalProperties: false,
        },
      },
    };
  }

  private resolveTrigger(args: Record<string, any>): number {
    if (typeof args.countdownMinutes === 'number') {
      const minutes = Math.trunc(args.countdownMinutes);
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > 525600) {
        throw new Error('countdownMinutes must be between 1 and 525600');
      }
      return Date.now() + minutes * 60_000;
    }
    const fixedTime = this.requiredString(args.fixedTime, 'fixedTime');
    const parsed = new Date(fixedTime).getTime();
    if (!Number.isFinite(parsed)) {
      throw new Error('fixedTime must be a valid local ISO date-time');
    }
    if (parsed < Date.now() - 60_000) {
      throw new Error('fixedTime is in the past');
    }
    return parsed;
  }

  private requiredString(value: unknown, name: string): string {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`${name} is required`);
    }
    return value.trim();
  }

  private json(value: unknown): TalentResult {
    return {type: 'text', summary: JSON.stringify(value)};
  }
}
