import {makeAutoObservable, runInAction} from 'mobx';

import {androidControl} from '../androidControl/AndroidControl';
import {termuxControl, TermuxCommandResult, TermuxStatus} from '../termux/TermuxControl';
import {
  taskCheckpointStore,
  TaskCheckpoint,
} from '../taskCheckpoint/TaskCheckpointStore';

export type RuntimeReadiness =
  | 'unknown'
  | 'checking'
  | 'ready'
  | 'degraded'
  | 'error';

export type AgentRuntimeStatus = 'idle' | 'running' | 'interrupted' | 'error';

type AndroidRuntimeState = {
  status: RuntimeReadiness;
  rootAvailable: boolean;
  rootCommandWorked: boolean;
  rootIdentity: string;
  model: string;
  androidVersion: string;
  lastCheckedAt?: number;
  error?: string;
};

type TermuxRuntimeState = {
  status: RuntimeReadiness;
  installed: boolean;
  permissionGranted: boolean;
  runCommandServiceVisible: boolean;
  versionName: string;
  appLabel: string;
  foregroundRecoveryCount: number;
  lastCheckedAt?: number;
  error?: string;
};

type LinuxRuntimeState = {
  status: RuntimeReadiness;
  distro?: string;
  prootAvailable: boolean;
  lastProbe?: string;
  lastCheckedAt?: number;
  error?: string;
};

type AgentState = {
  status: AgentRuntimeStatus;
  currentTask?: string;
  sessionId?: string;
  checkpoint?: TaskCheckpoint;
  lastError?: string;
};

type SelfTestState = {
  status: RuntimeReadiness;
  passiveCompleted: boolean;
  deepCompleted: boolean;
  lastStartedAt?: number;
  lastCompletedAt?: number;
};

const initialAndroid = (): AndroidRuntimeState => ({
  status: 'unknown',
  rootAvailable: false,
  rootCommandWorked: false,
  rootIdentity: '',
  model: '',
  androidVersion: '',
});

const initialTermux = (): TermuxRuntimeState => ({
  status: 'unknown',
  installed: false,
  permissionGranted: false,
  runCommandServiceVisible: false,
  versionName: '',
  appLabel: '',
  foregroundRecoveryCount: 0,
});

const initialLinux = (): LinuxRuntimeState => ({
  status: 'unknown',
  prootAvailable: false,
});

/**
 * Single observable source of truth for Root Agent runtime health.
 *
 * Startup checks are intentionally passive: they never foreground ZeroTermux.
 * A deep self-test is explicit/lazy and actually executes safe read-only probes.
 * Tool outcomes continuously refresh this store during normal agent work.
 */
class RootAgentRuntimeStore {
  android: AndroidRuntimeState = initialAndroid();
  termux: TermuxRuntimeState = initialTermux();
  linux: LinuxRuntimeState = initialLinux();
  agent: AgentState = {status: 'idle'};
  selfTest: SelfTestState = {
    status: 'unknown',
    passiveCompleted: false,
    deepCompleted: false,
  };

  private startupPromise: Promise<void> | null = null;

  constructor() {
    makeAutoObservable(
      this,
      {startupPromise: false},
      {autoBind: true},
    );
  }

  get overallStatus(): RuntimeReadiness {
    if (this.selfTest.status === 'checking') return 'checking';
    if (this.android.status === 'error') return 'error';
    if (this.android.status !== 'ready' || this.termux.status !== 'ready') {
      return 'degraded';
    }
    if (this.linux.status === 'error' || this.linux.status === 'degraded') {
      return 'degraded';
    }
    return 'ready';
  }

  get problems(): string[] {
    const problems: string[] = [];
    if (!this.android.rootAvailable || !this.android.rootCommandWorked) {
      problems.push('Android root is unavailable or the root probe failed.');
    }
    if (!this.termux.installed) {
      problems.push('ZeroTermux/Termux is not installed.');
    } else {
      if (!this.termux.permissionGranted) {
        problems.push('RUN_COMMAND permission is not granted to Root Agent.');
      }
      if (!this.termux.runCommandServiceVisible) {
        problems.push('Termux RunCommandService is not visible.');
      }
    }
    if (this.linux.status === 'degraded' || this.linux.status === 'error') {
      problems.push(this.linux.error || 'Linux/PRoot self-test is not ready.');
    }
    if (this.agent.status === 'interrupted' && this.agent.checkpoint) {
      problems.push('An interrupted resumable task is available.');
    }
    return problems;
  }

  /** Passive startup test: safe to run every app launch without UI switching. */
  async startupSelfTest(sessionId?: string): Promise<void> {
    if (this.startupPromise) {
      return this.startupPromise;
    }
    this.startupPromise = this.runPassiveSelfTest(sessionId).finally(() => {
      this.startupPromise = null;
    });
    return this.startupPromise;
  }

  private async runPassiveSelfTest(sessionId?: string): Promise<void> {
    const startedAt = Date.now();
    runInAction(() => {
      this.selfTest.status = 'checking';
      this.selfTest.lastStartedAt = startedAt;
      this.android.status = 'checking';
      this.termux.status = 'checking';
    });

    const [accessResult, systemResult, termuxResult] = await Promise.allSettled([
      androidControl.getAccessStatus(),
      androidControl.getSystemInfo(),
      termuxControl.getStatus(),
    ]);

    await taskCheckpointStore.ensureHydrated();
    if (sessionId) {
      taskCheckpointStore.setActiveSession(sessionId);
    }
    const checkpoint = sessionId
      ? taskCheckpointStore.getForSession(sessionId)
      : undefined;

    const now = Date.now();
    runInAction(() => {
      if (accessResult.status === 'fulfilled') {
        const value = accessResult.value;
        this.android.rootAvailable = value.rootAvailable;
        this.android.rootCommandWorked = value.rootCommandWorked;
        this.android.rootIdentity = value.output;
        this.android.status =
          value.rootAvailable && value.rootCommandWorked ? 'ready' : 'degraded';
        this.android.error = undefined;
      } else {
        this.android.status = 'error';
        this.android.error = String(accessResult.reason);
      }
      if (systemResult.status === 'fulfilled') {
        this.android.model = systemResult.value.model;
        this.android.androidVersion = systemResult.value.android;
      } else if (!this.android.error) {
        this.android.error = String(systemResult.reason);
      }
      this.android.lastCheckedAt = now;

      if (termuxResult.status === 'fulfilled') {
        this.applyTermuxStatus(termuxResult.value, now);
      } else {
        this.termux.status = 'error';
        this.termux.error = String(termuxResult.reason);
        this.termux.lastCheckedAt = now;
      }

      this.agent.checkpoint = checkpoint;
      this.agent.sessionId = sessionId;
      if (checkpoint?.status === 'interrupted') {
        this.agent.status = 'interrupted';
        this.agent.currentTask = checkpoint.task;
        this.agent.lastError = checkpoint.lastError;
      } else if (this.agent.status !== 'running') {
        this.agent.status = 'idle';
      }

      this.selfTest.passiveCompleted = true;
      this.selfTest.lastCompletedAt = now;
      this.selfTest.status =
        this.android.status === 'error' || this.termux.status === 'error'
          ? 'error'
          : this.android.status === 'ready' && this.termux.status === 'ready'
            ? 'ready'
            : 'degraded';
    });
  }

  /**
   * Active read-only test for Termux + PRoot. May use the native foreground
   * recovery once if Android has idled ZeroTermux in the background.
   */
  async deepSelfTest(): Promise<void> {
    runInAction(() => {
      this.selfTest.status = 'checking';
      this.termux.status = 'checking';
      this.linux.status = 'checking';
      this.selfTest.lastStartedAt = Date.now();
    });

    try {
      const status = await termuxControl.getStatus();
      runInAction(() => this.applyTermuxStatus(status, Date.now()));
      if (
        !status.installed ||
        !status.permissionGranted ||
        !status.runCommandServiceVisible
      ) {
        throw new Error('ZeroTermux is not fully configured for RUN_COMMAND');
      }

      const hostProbe = await termuxControl.runCommand('id', [], {
        timeoutMs: 15_000,
      });
      this.observeRecovery(hostProbe);
      if (hostProbe.exitCode !== 0 || hostProbe.termuxError !== -1) {
        throw new Error(
          hostProbe.termuxErrorMessage || hostProbe.stderr || 'Termux id probe failed',
        );
      }

      const distroList = await termuxControl.runCommand('proot-distro', ['list'], {
        timeoutMs: 30_000,
      });
      this.observeRecovery(distroList);
      if (distroList.exitCode !== 0 || distroList.termuxError !== -1) {
        throw new Error(
          distroList.termuxErrorMessage ||
            distroList.stderr ||
            'proot-distro list failed',
        );
      }

      const distro = this.parseDistro(distroList.stdout);
      if (!distro) {
        runInAction(() => {
          this.termux.status = 'ready';
          this.linux = {
            ...this.linux,
            status: 'degraded',
            prootAvailable: true,
            error: 'PRoot-Distro is installed but no container was detected.',
            lastCheckedAt: Date.now(),
          };
          this.selfTest.status = 'degraded';
          this.selfTest.deepCompleted = true;
          this.selfTest.lastCompletedAt = Date.now();
        });
        return;
      }

      const linuxProbe = await termuxControl.runCommand(
        'proot-distro',
        ['login', distro, '--work-dir', '/root', '--', 'id'],
        {timeoutMs: 30_000},
      );
      this.observeRecovery(linuxProbe);
      const now = Date.now();
      runInAction(() => {
        this.termux.status = 'ready';
        this.termux.error = undefined;
        this.linux = {
          status:
            linuxProbe.exitCode === 0 && linuxProbe.termuxError === -1
              ? 'ready'
              : 'degraded',
          distro,
          prootAvailable: true,
          lastProbe: linuxProbe.stdout.trim(),
          lastCheckedAt: now,
          ...(linuxProbe.exitCode === 0 && linuxProbe.termuxError === -1
            ? {}
            : {
                error:
                  linuxProbe.termuxErrorMessage ||
                  linuxProbe.stderr ||
                  `Linux probe exit code ${linuxProbe.exitCode}`,
              }),
        };
        this.selfTest.deepCompleted = true;
        this.selfTest.lastCompletedAt = now;
        this.selfTest.status = this.linux.status === 'ready' ? 'ready' : 'degraded';
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runInAction(() => {
        if (this.termux.status === 'checking') {
          this.termux.status = 'degraded';
          this.termux.error = message;
        }
        this.linux.status = 'degraded';
        this.linux.error = message;
        this.linux.lastCheckedAt = Date.now();
        this.selfTest.status = 'degraded';
        this.selfTest.deepCompleted = true;
        this.selfTest.lastCompletedAt = Date.now();
      });
    }
  }

  async syncCheckpoint(sessionId?: string): Promise<void> {
    await taskCheckpointStore.ensureHydrated();
    if (sessionId) {
      taskCheckpointStore.setActiveSession(sessionId);
    }
    const checkpoint = sessionId
      ? taskCheckpointStore.getForSession(sessionId)
      : undefined;
    runInAction(() => {
      this.agent.sessionId = sessionId;
      this.agent.checkpoint = checkpoint;
      if (this.agent.status !== 'running') {
        if (checkpoint?.status === 'interrupted') {
          this.agent.status = 'interrupted';
          this.agent.currentTask = checkpoint.task;
          this.agent.lastError = checkpoint.lastError;
        } else {
          this.agent.status = 'idle';
        }
      }
    });
  }

  beginAgentRun(task: string, sessionId: string): void {
    this.agent = {
      ...this.agent,
      status: 'running',
      currentTask: task,
      sessionId,
      lastError: undefined,
    };
  }

  finishAgentRun(hitMaxTurns = false): void {
    this.agent.status = hitMaxTurns ? 'interrupted' : 'idle';
    if (!hitMaxTurns) {
      this.agent.lastError = undefined;
    }
  }

  failAgentRun(error: string): void {
    this.agent.status = 'interrupted';
    this.agent.lastError = error;
  }

  noteToolOutcome(toolName: string, responseContent: string, isError: boolean): void {
    if (toolName === 'android_system') {
      this.android.lastCheckedAt = Date.now();
      if (!isError && this.android.status === 'unknown') {
        this.android.status = 'ready';
      }
      return;
    }
    if (toolName !== 'termux') return;

    const parsed = this.tryParseJson(responseContent);
    const now = Date.now();
    if (parsed && typeof parsed === 'object') {
      const value = parsed as Record<string, any>;
      if (value.termux && typeof value.termux === 'object') {
        this.applyTermuxStatus(value.termux as TermuxStatus, now);
      }
      if (value.foregroundRecoveryUsed === true) {
        this.termux.foregroundRecoveryCount += 1;
      }
      const label = typeof value.label === 'string' ? value.label : '';
      if (label.startsWith('linux:')) {
        const parts = label.split(':');
        this.termux.status = 'ready';
        this.termux.error = undefined;
        this.linux.status = 'ready';
        this.linux.prootAvailable = true;
        this.linux.distro = parts[1] || this.linux.distro;
        this.linux.lastCheckedAt = now;
        this.linux.error = undefined;
      } else if (label || 'exitCode' in value) {
        // A non-zero program exit is a command-level result, not a broken bridge.
        this.termux.status = 'ready';
        this.termux.error = undefined;
        this.termux.lastCheckedAt = now;
      }
      return;
    }

    if (isError && /termux failed|runcommandservice|run_command/i.test(responseContent)) {
      this.termux.status = 'degraded';
      this.termux.error = responseContent.slice(0, 1000);
      this.termux.lastCheckedAt = now;
    }
  }

  private applyTermuxStatus(status: TermuxStatus, now: number): void {
    this.termux.installed = status.installed;
    this.termux.permissionGranted = status.permissionGranted;
    this.termux.runCommandServiceVisible = status.runCommandServiceVisible;
    this.termux.versionName = status.versionName;
    this.termux.appLabel = status.appLabel;
    this.termux.lastCheckedAt = now;
    this.termux.error = undefined;
    this.termux.status =
      status.installed && status.permissionGranted && status.runCommandServiceVisible
        ? 'ready'
        : 'degraded';
  }

  private observeRecovery(result: TermuxCommandResult): void {
    if (result.foregroundRecoveryUsed) {
      runInAction(() => {
        this.termux.foregroundRecoveryCount += 1;
      });
    }
  }

  private parseDistro(stdout: string): string | undefined {
    const candidates = stdout
      .split(/\r?\n/)
      .map(line => line.trim())
      .map(line => line.match(/^\*?\s*([A-Za-z0-9][A-Za-z0-9._:-]{0,63})$/)?.[1])
      .filter((value): value is string => !!value);
    return candidates.find(value => value.toLowerCase() === 'debian') || candidates[0];
  }

  private tryParseJson(value: string): unknown {
    try {
      return JSON.parse(value);
    } catch {
      return undefined;
    }
  }
}

export const rootAgentRuntimeStore = new RootAgentRuntimeStore();
