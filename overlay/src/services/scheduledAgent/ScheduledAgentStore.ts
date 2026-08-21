import AsyncStorage from '@react-native-async-storage/async-storage';

import {scheduledAgentControl} from './ScheduledAgentControl';

const STORAGE_KEY = 'PocketPalRootAgent.ScheduledAgents.v1';
const MAX_TASKS = 64;
const MAX_HISTORY = 20;
const RUNNING_GUARD_MS = 20 * 60_000;

export type ScheduledAgentMode = 'read_only' | 'action';
export type ScheduledAgentRunStatus =
  | 'scheduled'
  | 'running'
  | 'completed'
  | 'failed'
  | 'disabled';

export type ScheduledAgentRunLog = {
  startedAt: number;
  finishedAt: number;
  success: boolean;
  result: string;
};

export type ScheduledAgentTask = {
  id: string;
  title: string;
  prompt: string;
  modelId: string;
  triggerAtMs: number;
  repeatDaily: boolean;
  mode: ScheduledAgentMode;
  allowReboot: boolean;
  notify: boolean;
  enabled: boolean;
  status: ScheduledAgentRunStatus;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  lastCompletedAt?: number;
  lastResult?: string;
  lastError?: string;
  nextRunAt?: number;
  history?: ScheduledAgentRunLog[];
};

type CreateInput = {
  title: string;
  prompt: string;
  modelId: string;
  triggerAtMs: number;
  repeatDaily?: boolean;
  mode?: ScheduledAgentMode;
  allowReboot?: boolean;
  notify?: boolean;
};

const clean = (value: unknown, max: number): string =>
  String(value ?? '')
    .replace(/\u0000/g, '')
    .trim()
    .slice(0, max);

const nextDaily = (previous: number): number => {
  const source = new Date(previous);
  const next = new Date();
  next.setHours(source.getHours(), source.getMinutes(), source.getSeconds(), 0);
  if (next.getTime() <= Date.now() + 1000) {
    next.setDate(next.getDate() + 1);
  }
  return next.getTime();
};

class ScheduledAgentStore {
  private tasks: Record<string, ScheduledAgentTask> = {};
  private hydration: Promise<void>;

  constructor() {
    this.hydration = this.hydrate();
  }

  async ensureHydrated(): Promise<void> {
    await this.hydration;
  }

  async create(input: CreateInput): Promise<{
    task: ScheduledAgentTask;
    native: Awaited<ReturnType<typeof scheduledAgentControl.scheduleTask>>;
  }> {
    await this.ensureHydrated();
    const title = clean(input.title, 120);
    const prompt = clean(input.prompt, 6000);
    const modelId = clean(input.modelId, 320);
    if (!title) throw new Error('title is required');
    if (!prompt) throw new Error('prompt is required');
    if (!modelId) throw new Error('A remote/API model must be selected before scheduling');
    if (!Number.isFinite(input.triggerAtMs) || input.triggerAtMs <= Date.now() - 60_000) {
      throw new Error('triggerAtMs must be now or in the future');
    }

    const now = Date.now();
    const id = `sa_${now}_${Math.random().toString(36).slice(2, 10)}`;
    const task: ScheduledAgentTask = {
      id,
      title,
      prompt,
      modelId,
      triggerAtMs: Math.trunc(input.triggerAtMs),
      repeatDaily: input.repeatDaily === true,
      mode: input.mode === 'action' ? 'action' : 'read_only',
      allowReboot: input.allowReboot === true,
      notify: input.notify !== false,
      enabled: true,
      status: 'scheduled',
      createdAt: now,
      updatedAt: now,
      nextRunAt: Math.trunc(input.triggerAtMs),
      history: [],
    };

    this.tasks[id] = task;
    this.trim();
    await this.persist();

    try {
      const native = await scheduledAgentControl.scheduleTask(
        id,
        title,
        task.triggerAtMs,
        task.repeatDaily,
      );
      return {task, native};
    } catch (error) {
      delete this.tasks[id];
      await this.persist();
      throw error;
    }
  }

  async list(): Promise<ScheduledAgentTask[]> {
    await this.ensureHydrated();
    return Object.values(this.tasks).sort(
      (a, b) => (a.nextRunAt ?? a.triggerAtMs) - (b.nextRunAt ?? b.triggerAtMs),
    );
  }

  async get(id: string): Promise<ScheduledAgentTask | undefined> {
    await this.ensureHydrated();
    return this.tasks[id];
  }

  async remove(id: string): Promise<boolean> {
    await this.ensureHydrated();
    const existed = !!this.tasks[id];
    if (!existed) return false;
    await scheduledAgentControl.cancelTask(id);
    delete this.tasks[id];
    await this.persist();
    return true;
  }

  async runNow(id: string): Promise<boolean> {
    await this.ensureHydrated();
    const task = this.tasks[id];
    if (!task) throw new Error('Scheduled task not found');
    if (!task.enabled) throw new Error('Scheduled task is disabled');
    if (
      task.status === 'running' &&
      task.lastRunAt &&
      Date.now() - task.lastRunAt < RUNNING_GUARD_MS
    ) {
      throw new Error('Scheduled task is already running');
    }
    return scheduledAgentControl.triggerNow(task.id, task.title);
  }

  async markRunning(id: string): Promise<ScheduledAgentTask> {
    await this.ensureHydrated();
    const task = this.requireTask(id);
    const now = Date.now();
    const updated: ScheduledAgentTask = {
      ...task,
      status: 'running',
      lastRunAt: now,
      lastError: undefined,
      updatedAt: now,
    };
    this.tasks[id] = updated;
    await this.persist();
    return updated;
  }

  async markFinished(
    id: string,
    success: boolean,
    result: string,
  ): Promise<ScheduledAgentTask> {
    await this.ensureHydrated();
    const task = this.requireTask(id);
    const now = Date.now();
    const repeatDaily = task.repeatDaily;
    const cleanedResult = clean(result, success ? 8000 : 4000);
    const history: ScheduledAgentRunLog[] = [
      {
        startedAt: task.lastRunAt ?? now,
        finishedAt: now,
        success,
        result: cleanedResult,
      },
      ...(task.history ?? []),
    ].slice(0, MAX_HISTORY);

    const updated: ScheduledAgentTask = {
      ...task,
      enabled: repeatDaily,
      status: success
        ? repeatDaily
          ? 'scheduled'
          : 'completed'
        : 'failed',
      lastCompletedAt: now,
      lastResult: success ? cleanedResult : task.lastResult,
      lastError: success ? undefined : cleanedResult,
      nextRunAt: repeatDaily ? nextDaily(task.triggerAtMs) : undefined,
      history,
      updatedAt: now,
    };
    this.tasks[id] = updated;
    await this.persist();
    return updated;
  }

  async disable(id: string): Promise<ScheduledAgentTask> {
    await this.ensureHydrated();
    const task = this.requireTask(id);
    await scheduledAgentControl.cancelTask(id);
    const updated: ScheduledAgentTask = {
      ...task,
      enabled: false,
      status: 'disabled',
      nextRunAt: undefined,
      updatedAt: Date.now(),
    };
    this.tasks[id] = updated;
    await this.persist();
    return updated;
  }

  private requireTask(id: string): ScheduledAgentTask {
    const task = this.tasks[id];
    if (!task) throw new Error('Scheduled task not found');
    return task;
  }

  private async hydrate(): Promise<void> {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, ScheduledAgentTask>;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      this.tasks = Object.fromEntries(
        Object.entries(parsed)
          .filter(([, value]) => !!value && typeof value === 'object')
          .slice(-MAX_TASKS)
          .map(([id, value]) => [
            id,
            {
              ...value,
              history: Array.isArray(value.history)
                ? value.history.slice(0, MAX_HISTORY)
                : [],
            },
          ]),
      );
    } catch (error) {
      console.warn('[scheduled-agent] Failed to hydrate:', error);
      this.tasks = {};
    }
  }

  private trim(): void {
    const values = Object.values(this.tasks);
    if (values.length <= MAX_TASKS) return;
    const keep = values
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_TASKS);
    this.tasks = Object.fromEntries(keep.map(task => [task.id, task]));
  }

  private async persist(): Promise<void> {
    this.trim();
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(this.tasks));
  }
}

export const scheduledAgentStore = new ScheduledAgentStore();
