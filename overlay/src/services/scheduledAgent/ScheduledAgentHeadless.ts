import {isHydrated} from 'mobx-persist-store';

import {runAgent} from '../agent/AgentRunner';
import {
  registerDefaultTalents,
  talentRegistry,
} from '../talents';
import type {TalentEngine, TalentResult} from '../talents/types';
import {modelStore, serverStore} from '../../store';
import {ModelOrigin} from '../../utils/types';
import {scheduledAgentControl} from './ScheduledAgentControl';
import {
  scheduledAgentStore,
  ScheduledAgentTask,
} from './ScheduledAgentStore';

const READ_ONLY_ANDROID_ACTIONS = new Set([
  'access_status',
  'system_info',
  'battery_status',
  'storage_info',
  'get_brightness',
  'package_info',
  'list_packages',
]);

const READ_ONLY_TERMUX_ACTIONS = new Set(['status', 'probe', 'linux_detect']);
const BASE_TALENTS = ['android_system', 'termux', 'calculate', 'datetime'];
const DUPLICATE_RUN_GUARD_MS = 20 * 60_000;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function waitForPersistedStores(timeoutMs = 20_000): Promise<void> {
  const started = Date.now();
  while (!isHydrated(modelStore) || !isHydrated(serverStore)) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('Timed out waiting for API model/server settings to hydrate');
    }
    await sleep(100);
  }
}

function denied(summary: string): TalentResult {
  return {type: 'error', summary, errorMessage: summary};
}

function guardTalent(
  base: TalentEngine,
  task: ScheduledAgentTask,
): TalentEngine {
  if (base.name !== 'android_system' && base.name !== 'termux') {
    return base;
  }

  return {
    name: base.name,
    recommendedContextTokens: base.recommendedContextTokens,
    toToolDefinition: () => base.toToolDefinition(),
    systemPromptFragment: ctx => base.systemPromptFragment?.(ctx) ?? null,
    execute: async args => {
      const action = typeof args.action === 'string' ? args.action : '';
      if (task.mode === 'read_only') {
        if (
          base.name === 'android_system' &&
          !READ_ONLY_ANDROID_ACTIONS.has(action)
        ) {
          return denied(
            `Scheduled read-only task blocked android_system action: ${action}`,
          );
        }
        if (base.name === 'termux' && !READ_ONLY_TERMUX_ACTIONS.has(action)) {
          return denied(`Scheduled read-only task blocked termux action: ${action}`);
        }
      }
      if (
        base.name === 'android_system' &&
        action === 'reboot' &&
        !task.allowReboot
      ) {
        return denied(
          'Scheduled reboot is blocked because this task was not created with explicit allowReboot permission.',
        );
      }
      return base.execute(args);
    },
  };
}

function systemPrompt(task: ScheduledAgentTask, engines: TalentEngine[]): string {
  const activeTalents = new Set(engines.map(engine => engine.name));
  const ctx = {
    now: new Date(),
    maxToolTurns: 16,
    activeTalents,
  };
  const fragments = engines
    .map(engine => engine.systemPromptFragment?.(ctx))
    .filter((value): value is string => !!value && !!value.trim());

  return [
    'You are PocketPal Root Agent executing a user-created scheduled task unattended on the user\'s Android phone.',
    'Execute ONLY the saved task below. Use real tools for current state and never invent tool results.',
    'There is no interactive user available during this run. If blocked by missing information, permission, network, or a safety boundary, stop safely and explain the blocker in the final result.',
    `Scheduled execution mode: ${task.mode}.`,
    task.mode === 'read_only'
      ? 'This task is read-only: do not change Android state, files, settings, packages, or Linux/Termux data.'
      : 'This task permits state-changing actions that are necessary for the saved instruction, subject to tool restrictions.',
    task.allowReboot
      ? 'A reboot is permitted only if it is actually required by the saved instruction.'
      : 'Do not reboot the device.',
    'Do not create additional scheduled tasks from this unattended run.',
    'Do not send messages, place calls, make purchases, or expose credentials unless the saved task explicitly requested that exact action and an available typed tool safely supports it.',
    ...fragments,
  ].join('\n\n');
}

export async function runScheduledAgentHeadless(data: {
  taskId?: string;
  title?: string;
  triggeredAt?: number;
}): Promise<void> {
  const taskId = typeof data.taskId === 'string' ? data.taskId : '';
  if (!taskId) return;

  await scheduledAgentStore.ensureHydrated();
  const task = await scheduledAgentStore.get(taskId);
  if (!task || !task.enabled) {
    return;
  }

  if (
    task.status === 'running' &&
    task.lastRunAt &&
    Date.now() - task.lastRunAt < DUPLICATE_RUN_GUARD_MS
  ) {
    console.warn(`[scheduled-agent] duplicate run ignored for ${taskId}`);
    return;
  }

  await scheduledAgentStore.markRunning(taskId);
  let success = false;
  let summary = '';

  try {
    await waitForPersistedStores();

    if (modelStore.inferencing || modelStore.isStreaming) {
      throw new Error(
        'An interactive chat completion is already running; scheduled task was not allowed to interrupt it.',
      );
    }

    const model = modelStore.remoteModels.find(candidate => candidate.id === task.modelId);
    if (!model || model.origin !== ModelOrigin.REMOTE) {
      throw new Error(
        `Saved API model is unavailable: ${task.modelId}. Recreate the scheduled task after selecting a valid remote model.`,
      );
    }

    if (modelStore.activeModelId !== model.id || !modelStore.engine) {
      await modelStore.selectModel(model);
    }
    const engine = modelStore.engine;
    if (!engine) throw new Error('Remote completion engine could not be initialized');

    registerDefaultTalents();
    const engines = BASE_TALENTS.map(name => talentRegistry.get(name))
      .filter((value): value is TalentEngine => !!value)
      .map(value => guardTalent(value, task));
    const lookup = new Map(engines.map(value => [value.name, value]));
    const tools = engines.map(value => value.toToolDefinition());

    const params = {
      messages: [
        {role: 'system', content: systemPrompt(task, engines)},
        {role: 'user', content: task.prompt},
      ],
      tools,
      n_predict: 2048,
      temperature: 0.2,
    } as any;

    let finalContent = '';
    let hitMaxTurns = false;
    for await (const event of runAgent({
      engine,
      initialParams: params,
      allowedTalentNames: engines.map(value => value.name),
      talentLookup: name => lookup.get(name),
      triggerMarkers: [],
      messageId: `scheduled:${task.id}:${Date.now()}`,
      maxTurns: 16,
    })) {
      if (event.type === 'run_failed') {
        throw event.error;
      }
      if (event.type === 'run_finished') {
        finalContent = event.result.finalResult?.content ?? '';
        hitMaxTurns = event.result.hitMaxTurns;
      }
    }

    if (hitMaxTurns) {
      throw new Error(
        `Scheduled agent reached its turn limit. Last response: ${finalContent}`,
      );
    }

    summary = finalContent.trim() || 'Scheduled task completed without a text result.';
    success = true;
  } catch (error) {
    summary = error instanceof Error ? error.message : String(error);
    console.warn(`[scheduled-agent] task ${taskId} failed:`, error);
  }

  const updated = await scheduledAgentStore.markFinished(taskId, success, summary);
  if (updated.notify) {
    await scheduledAgentControl
      .notifyResult(updated.id, updated.title, success)
      .catch(error => console.warn('[scheduled-agent] result notification failed:', error));
  }
}
