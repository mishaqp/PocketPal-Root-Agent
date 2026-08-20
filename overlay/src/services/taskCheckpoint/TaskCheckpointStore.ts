import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'PocketPalRootAgent.TaskCheckpoints.v1';
const MAX_CHECKPOINTS = 24;
const MAX_TASK_CHARS = 2400;
const MAX_NOTES_CHARS = 4000;
const MAX_RESULT_CHARS = 4000;
const MAX_ERROR_CHARS = 2000;

export type TaskCheckpointStatus = 'active' | 'interrupted' | 'completed';

export interface TaskCheckpoint {
  sessionId: string;
  messageId: string;
  task: string;
  status: TaskCheckpointStatus;
  step: number;
  totalSteps?: number;
  nextAction: string;
  workspace?: string;
  notes?: string;
  lastToolName?: string;
  lastToolResult?: string;
  lastToolError?: boolean;
  lastError?: string;
  autoManaged: boolean;
  updatedAt: number;
}

type RunInfo = {
  sessionId: string;
  messageId: string;
  task: string;
};

type ManualCheckpointInput = {
  task?: string;
  step?: number;
  totalSteps?: number;
  nextAction?: string;
  workspace?: string;
  notes?: string;
};

const cleanText = (value: unknown, max: number): string =>
  String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, max);

const cleanPositiveInt = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  const parsed = Math.trunc(value);
  return parsed >= 0 ? parsed : undefined;
};

class TaskCheckpointStore {
  private checkpoints: Record<string, TaskCheckpoint> = {};
  private currentRuns = new Map<string, RunInfo>();
  private activeSessionId?: string;
  private hydration: Promise<void>;

  constructor() {
    this.hydration = this.hydrate();
  }

  async ensureHydrated(): Promise<void> {
    await this.hydration;
  }

  setActiveSession(sessionId?: string): void {
    this.activeSessionId = sessionId || undefined;
  }

  beginRun(sessionId: string, messageId: string, task: string): void {
    const safeSessionId = cleanText(sessionId, 160);
    const safeMessageId = cleanText(messageId, 160);
    if (!safeSessionId || !safeMessageId) {
      return;
    }
    this.currentRuns.set(safeSessionId, {
      sessionId: safeSessionId,
      messageId: safeMessageId,
      task: cleanText(task, MAX_TASK_CHARS),
    });
  }

  getActiveCheckpoint(): TaskCheckpoint | undefined {
    if (!this.activeSessionId) {
      return undefined;
    }
    return this.checkpoints[this.activeSessionId];
  }

  getForSession(sessionId: string): TaskCheckpoint | undefined {
    return this.checkpoints[sessionId];
  }

  async saveManualCheckpoint(input: ManualCheckpointInput): Promise<TaskCheckpoint> {
    await this.ensureHydrated();
    const sessionId = this.requireActiveSession();
    const run = this.currentRuns.get(sessionId);
    const previous = this.checkpoints[sessionId];
    const task = cleanText(input.task, MAX_TASK_CHARS) || run?.task || previous?.task || 'Multi-step task';
    const step = cleanPositiveInt(input.step) ?? previous?.step ?? 0;
    const totalSteps = cleanPositiveInt(input.totalSteps) ?? previous?.totalSteps;
    const nextAction =
      cleanText(input.nextAction, MAX_NOTES_CHARS) ||
      previous?.nextAction ||
      'Verify the current state and continue with the next unfinished step.';
    const checkpoint: TaskCheckpoint = {
      sessionId,
      messageId: run?.messageId || previous?.messageId || '',
      task,
      status: 'active',
      step,
      ...(totalSteps !== undefined ? {totalSteps} : {}),
      nextAction,
      ...(cleanText(input.workspace, 800) ? {workspace: cleanText(input.workspace, 800)} : previous?.workspace ? {workspace: previous.workspace} : {}),
      ...(cleanText(input.notes, MAX_NOTES_CHARS) ? {notes: cleanText(input.notes, MAX_NOTES_CHARS)} : previous?.notes ? {notes: previous.notes} : {}),
      ...(previous?.lastToolName ? {lastToolName: previous.lastToolName} : {}),
      ...(previous?.lastToolResult ? {lastToolResult: previous.lastToolResult} : {}),
      ...(previous?.lastToolError !== undefined ? {lastToolError: previous.lastToolError} : {}),
      autoManaged: false,
      updatedAt: Date.now(),
    };
    this.checkpoints[sessionId] = checkpoint;
    await this.persist();
    return checkpoint;
  }

  async complete(summary?: string): Promise<TaskCheckpoint> {
    await this.ensureHydrated();
    const sessionId = this.requireActiveSession();
    const run = this.currentRuns.get(sessionId);
    const previous = this.checkpoints[sessionId];
    const checkpoint: TaskCheckpoint = {
      sessionId,
      messageId: run?.messageId || previous?.messageId || '',
      task: previous?.task || run?.task || 'Task',
      status: 'completed',
      step: previous?.step ?? 0,
      ...(previous?.totalSteps !== undefined ? {totalSteps: previous.totalSteps} : {}),
      nextAction: '',
      ...(previous?.workspace ? {workspace: previous.workspace} : {}),
      ...(cleanText(summary, MAX_NOTES_CHARS)
        ? {notes: cleanText(summary, MAX_NOTES_CHARS)}
        : previous?.notes
          ? {notes: previous.notes}
          : {}),
      ...(previous?.lastToolName ? {lastToolName: previous.lastToolName} : {}),
      ...(previous?.lastToolResult ? {lastToolResult: previous.lastToolResult} : {}),
      ...(previous?.lastToolError !== undefined ? {lastToolError: previous.lastToolError} : {}),
      autoManaged: previous?.autoManaged ?? false,
      updatedAt: Date.now(),
    };
    this.checkpoints[sessionId] = checkpoint;
    await this.persist();
    return checkpoint;
  }

  async clear(): Promise<boolean> {
    await this.ensureHydrated();
    const sessionId = this.requireActiveSession();
    const existed = !!this.checkpoints[sessionId];
    delete this.checkpoints[sessionId];
    this.currentRuns.delete(sessionId);
    await this.persist();
    return existed;
  }

  async recordToolOutcome(
    sessionId: string,
    messageId: string,
    toolName: string,
    responseContent: string,
    isError: boolean,
  ): Promise<void> {
    if (toolName === 'task_checkpoint') {
      return;
    }
    await this.ensureHydrated();
    const run = this.currentRuns.get(sessionId);
    const previous = this.checkpoints[sessionId];
    const sameRun = previous?.messageId === messageId;
    const base = sameRun ? previous : undefined;
    const autoManaged = base ? base.autoManaged : true;
    const checkpoint: TaskCheckpoint = {
      sessionId,
      messageId,
      task: base?.task || run?.task || 'Tool-driven task',
      status: base?.status === 'completed' ? 'active' : base?.status || 'active',
      step: autoManaged ? (base?.step ?? 0) + 1 : (base?.step ?? 0),
      ...(base?.totalSteps !== undefined ? {totalSteps: base.totalSteps} : {}),
      nextAction:
        base?.nextAction ||
        'Inspect the persisted conversation and last verified tool outcome, then continue with the next unfinished action.',
      ...(base?.workspace ? {workspace: base.workspace} : {}),
      ...(base?.notes ? {notes: base.notes} : {}),
      lastToolName: cleanText(toolName, 120),
      lastToolResult: cleanText(responseContent, MAX_RESULT_CHARS),
      lastToolError: isError,
      ...(isError ? {lastError: cleanText(responseContent, MAX_ERROR_CHARS)} : {}),
      autoManaged,
      updatedAt: Date.now(),
    };
    this.checkpoints[sessionId] = checkpoint;
    await this.persist();
  }

  async markInterrupted(
    sessionId: string,
    messageId: string,
    task: string,
    error: string,
  ): Promise<void> {
    await this.ensureHydrated();
    const previous = this.checkpoints[sessionId];
    const sameRun = previous?.messageId === messageId;
    const run = this.currentRuns.get(sessionId);
    const checkpoint: TaskCheckpoint = {
      sessionId,
      messageId,
      task: (sameRun ? previous?.task : undefined) || run?.task || cleanText(task, MAX_TASK_CHARS) || 'Interrupted task',
      status: 'interrupted',
      step: sameRun ? previous?.step ?? 0 : 0,
      ...(sameRun && previous?.totalSteps !== undefined ? {totalSteps: previous.totalSteps} : {}),
      nextAction:
        (sameRun ? previous?.nextAction : undefined) ||
        'Re-check the current state and continue from the last verified side effect. Never blindly repeat a command whose result may already have been applied.',
      ...(sameRun && previous?.workspace ? {workspace: previous.workspace} : {}),
      ...(sameRun && previous?.notes ? {notes: previous.notes} : {}),
      ...(sameRun && previous?.lastToolName ? {lastToolName: previous.lastToolName} : {}),
      ...(sameRun && previous?.lastToolResult ? {lastToolResult: previous.lastToolResult} : {}),
      ...(sameRun && previous?.lastToolError !== undefined ? {lastToolError: previous.lastToolError} : {}),
      lastError: cleanText(error, MAX_ERROR_CHARS),
      autoManaged: sameRun ? previous?.autoManaged ?? true : true,
      updatedAt: Date.now(),
    };
    this.checkpoints[sessionId] = checkpoint;
    await this.persist();
  }

  async finishRun(sessionId: string, messageId: string, hitMaxTurns: boolean): Promise<void> {
    await this.ensureHydrated();
    const previous = this.checkpoints[sessionId];
    this.currentRuns.delete(sessionId);
    if (!previous || previous.messageId !== messageId) {
      return;
    }
    if (hitMaxTurns) {
      this.checkpoints[sessionId] = {
        ...previous,
        status: 'interrupted',
        lastError: 'Agent turn budget exhausted before the task was explicitly completed.',
        nextAction:
          previous.nextAction ||
          'Continue the unfinished task from the last verified tool outcome.',
        updatedAt: Date.now(),
      };
      await this.persist();
      return;
    }
    // Automatic checkpoints are bookkeeping only, so a normally finished run
    // can close them automatically. Semantic checkpoints created by the model
    // remain active until task_checkpoint.complete is called.
    if (previous.autoManaged) {
      this.checkpoints[sessionId] = {
        ...previous,
        status: 'completed',
        nextAction: '',
        updatedAt: Date.now(),
      };
      await this.persist();
    }
  }

  promptFragment(): string | null {
    const checkpoint = this.getActiveCheckpoint();
    if (!checkpoint || checkpoint.status === 'completed') {
      return [
        'RESUMABLE TASKS:',
        '- For a multi-step task that will use several tools, create/update task_checkpoint at meaningful milestones and call task_checkpoint.complete only after final verification.',
        '- Tool outcomes are also checkpointed automatically so a network/app interruption can be recovered on the next run.',
      ].join('\n');
    }
    const compact = {
      status: checkpoint.status,
      task: checkpoint.task,
      step: checkpoint.step,
      totalSteps: checkpoint.totalSteps,
      nextAction: checkpoint.nextAction,
      workspace: checkpoint.workspace,
      notes: checkpoint.notes,
      lastToolName: checkpoint.lastToolName,
      lastToolResult: checkpoint.lastToolResult,
      lastToolError: checkpoint.lastToolError,
      lastError: checkpoint.lastError,
      updatedAt: checkpoint.updatedAt,
    };
    return [
      'RESUMABLE TASK CHECKPOINT:',
      JSON.stringify(compact),
      '- This checkpoint survived a previous run and belongs to this chat session.',
      '- If the current user message is continuing the same task, verify the current device/files/process state first, then continue from the next unfinished action.',
      '- Never blindly replay the last command: it may already have produced a side effect before an API/network interruption.',
      '- If the current user clearly started an unrelated task, replace or clear the stale checkpoint instead of resuming it.',
      '- Update task_checkpoint after important milestones and mark complete only after final verification.',
    ].join('\n');
  }

  private requireActiveSession(): string {
    if (!this.activeSessionId) {
      throw new Error('No active chat session for task checkpoint');
    }
    return this.activeSessionId;
  }

  private async hydrate(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw) as Record<string, TaskCheckpoint>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return;
      }
      this.checkpoints = Object.fromEntries(
        Object.entries(parsed)
          .filter(([, value]) => !!value && typeof value === 'object')
          .slice(-MAX_CHECKPOINTS),
      );
    } catch (error) {
      console.warn('[task-checkpoint] Failed to hydrate checkpoints:', error);
      this.checkpoints = {};
    }
  }

  private async persist(): Promise<void> {
    const newest = Object.values(this.checkpoints)
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(-MAX_CHECKPOINTS);
    this.checkpoints = Object.fromEntries(newest.map(item => [item.sessionId, item]));
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.checkpoints));
  }
}

export const taskCheckpointStore = new TaskCheckpointStore();
