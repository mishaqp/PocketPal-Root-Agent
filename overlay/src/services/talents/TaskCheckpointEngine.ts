import {taskCheckpointStore} from '../taskCheckpoint/TaskCheckpointStore';
import type {
  SystemPromptContext,
  TalentEngine,
  TalentResult,
  ToolDefinition,
} from './types';

export class TaskCheckpointEngine implements TalentEngine {
  readonly name = 'task_checkpoint';

  systemPromptFragment(_ctx: SystemPromptContext): string | null {
    return taskCheckpointStore.promptFragment();
  }

  async execute(args: Record<string, unknown>): Promise<TalentResult> {
    const action = String(args.action ?? '');
    try {
      if (action === 'get') {
        const checkpoint = taskCheckpointStore.getActiveCheckpoint();
        return {
          type: 'text',
          summary: JSON.stringify(checkpoint ?? {status: 'none'}),
        };
      }

      if (action === 'checkpoint') {
        const checkpoint = await taskCheckpointStore.saveManualCheckpoint({
          task: this.optionalString(args.task),
          step: this.optionalNumber(args.step),
          totalSteps: this.optionalNumber(args.totalSteps),
          nextAction: this.optionalString(args.nextAction),
          workspace: this.optionalString(args.workspace),
          notes: this.optionalString(args.notes),
        });
        return {type: 'text', summary: JSON.stringify(checkpoint)};
      }

      if (action === 'complete') {
        const checkpoint = await taskCheckpointStore.complete(
          this.optionalString(args.summary),
        );
        return {type: 'text', summary: JSON.stringify(checkpoint)};
      }

      if (action === 'clear') {
        const cleared = await taskCheckpointStore.clear();
        return {
          type: 'text',
          summary: JSON.stringify({cleared}),
        };
      }

      return {
        type: 'error',
        summary: 'task_checkpoint: unsupported action',
        errorMessage: 'Use get, checkpoint, complete, or clear.',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        type: 'error',
        summary: `task_checkpoint failed: ${message}`,
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
          'Persist and resume multi-step task state across API/network failures, app restarts, or later continuation in the same chat session.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['get', 'checkpoint', 'complete', 'clear'],
            },
            task: {
              type: 'string',
              description: 'Short description of the overall task.',
            },
            step: {
              type: 'number',
              minimum: 0,
              description: 'Current verified milestone number.',
            },
            totalSteps: {
              type: 'number',
              minimum: 0,
              description: 'Optional estimated total milestone count.',
            },
            nextAction: {
              type: 'string',
              description:
                'Concrete next action after the last verified milestone. Avoid repeating a side-effecting command unless its state was checked first.',
            },
            workspace: {
              type: 'string',
              description: 'Relevant project, Android, Termux, or Linux path.',
            },
            notes: {
              type: 'string',
              description: 'Compact facts needed to resume safely.',
            },
            summary: {
              type: 'string',
              description: 'Final verified result when marking a task complete.',
            },
          },
          required: ['action'],
          additionalProperties: false,
        },
      },
    };
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined;
  }

  private optionalNumber(value: unknown): number | undefined {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.trunc(value))
      : undefined;
  }
}
