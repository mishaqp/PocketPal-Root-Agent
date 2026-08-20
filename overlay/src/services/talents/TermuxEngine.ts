import {termuxControl, TermuxCommandResult} from '../termux/TermuxControl';
import type {
  SystemPromptContext,
  TalentEngine,
  TalentResult,
  ToolDefinition,
} from './types';

const EXECUTABLE_RE = /^[A-Za-z0-9][A-Za-z0-9._+:-]{0,63}$/;
const DISTRO_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;
const INNER_EXECUTABLE_RE = /^\/?[A-Za-z0-9][A-Za-z0-9_./+:-]{0,255}$/;
const ROOT_ESCALATION = new Set(['su', 'sudo', 'tsu', 'magisk', 'ksud']);

/** Structured user-space command execution through Termux/ZeroTermux. */
export class TermuxEngine implements TalentEngine {
  readonly name = 'termux';

  systemPromptFragment(_ctx: SystemPromptContext): string {
    return [
      'TERMUX/ZEROTERMUX RUNTIME:',
      '- termux is a real local tool for the Termux-compatible app installed on this Android phone.',
      '- Use status or probe before assuming the integration is configured.',
      '- exec runs one user-space executable with an argv array; never invent stdout, stderr, or exit codes.',
      '- Do not use Termux to obtain Android root. Privileged Android operations belong to android_system.',
      '- linux_detect checks for PRoot-Distro. linux_exec runs a structured command inside a detected PRoot container.',
      '- A PRoot container reporting uid=0 is not proof of Android uid=0.',
    ].join('\n');
  }

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const action = typeof args.action === 'string' ? args.action : '';
    try {
      if (action === 'status') {
        return this.json(await termuxControl.getStatus());
      }

      if (action === 'probe') {
        const status = await termuxControl.getStatus();
        if (!status.installed || !status.permissionGranted) {
          return this.json(status);
        }
        const result = await termuxControl.runCommand('id', [], {timeoutMs: 15_000});
        return this.commandResult('Termux probe', result);
      }

      if (action === 'exec') {
        const executable = this.executable(args.executable);
        const argv = this.argv(args.args);
        const result = await termuxControl.runCommand(executable, argv, {
          workdir: this.optionalString(args.workdir),
          stdin: this.optionalString(args.stdin),
          timeoutMs: this.timeout(args.timeoutMs),
        });
        return this.commandResult(executable, result);
      }

      if (action === 'linux_detect') {
        const termuxStatus = await termuxControl.getStatus();
        if (!termuxStatus.installed || !termuxStatus.permissionGranted) {
          return this.json({termux: termuxStatus, linux: 'not_checked'});
        }
        const hostId = await termuxControl.runCommand('id', [], {timeoutMs: 15_000});
        const proot = await termuxControl.runCommand('proot-distro', ['list'], {
          timeoutMs: 30_000,
        });
        return this.json({
          termux: termuxStatus,
          termuxId: this.compactResult(hostId),
          prootDistro: this.compactResult(proot),
          note:
            proot.exitCode === 0
              ? 'PRoot-Distro is available. Parse the installed container names from stdout before linux_exec.'
              : 'PRoot-Distro was not available or failed. Do not assume which Linux installer/mode is present.',
        });
      }

      if (action === 'linux_exec') {
        const distro = this.distro(args.distro);
        const executable = this.innerExecutable(args.executable);
        const argv = this.argv(args.args);
        const result = await termuxControl.runCommand(
          'proot-distro',
          ['login', distro, '--', executable, ...argv],
          {timeoutMs: this.timeout(args.timeoutMs)},
        );
        return this.commandResult(`linux:${distro}:${executable}`, result);
      }

      return {
        type: 'error',
        summary: 'termux: unsupported action',
        errorMessage: 'Use status, probe, exec, linux_detect, or linux_exec.',
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {type: 'error', summary: `termux failed: ${message}`, errorMessage: message};
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Use the local Termux/ZeroTermux user-space console or a PRoot-Distro Linux container with structured executable+argv calls. Android root is not exposed by this tool.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['status', 'probe', 'exec', 'linux_detect', 'linux_exec'],
            },
            executable: {
              type: 'string',
              description:
                'Executable name for exec, or command/path inside the PRoot distro for linux_exec. Pass arguments separately; do not pass a shell command line.',
            },
            args: {
              type: 'array',
              items: {type: 'string'},
              maxItems: 64,
              description: 'Argument vector passed to the executable.',
            },
            workdir: {
              type: 'string',
              description:
                'Optional Termux work directory for exec. Use ~/..., $PREFIX/..., /sdcard/... or /storage/emulated/0/...',
            },
            stdin: {
              type: 'string',
              description: 'Optional stdin data for exec, up to 65536 characters.',
            },
            timeoutMs: {
              type: 'number',
              minimum: 1000,
              maximum: 600000,
              description: 'How long to wait for the result; default 60000ms.',
            },
            distro: {
              type: 'string',
              description:
                'Installed PRoot-Distro container name from linux_detect. Required for linux_exec.',
            },
          },
          required: ['action'],
          additionalProperties: false,
        },
      },
    };
  }

  private executable(value: unknown): string {
    if (typeof value !== 'string' || !EXECUTABLE_RE.test(value)) {
      throw new Error('executable must be a simple Termux executable name');
    }
    if (ROOT_ESCALATION.has(value.toLowerCase())) {
      throw new Error('Android root escalation through Termux is blocked; use android_system');
    }
    return value;
  }

  private innerExecutable(value: unknown): string {
    if (typeof value !== 'string' || !INNER_EXECUTABLE_RE.test(value)) {
      throw new Error('linux executable must be a command name or absolute path without shell syntax');
    }
    return value;
  }

  private distro(value: unknown): string {
    if (typeof value !== 'string' || !DISTRO_RE.test(value)) {
      throw new Error('distro must be a container name returned by linux_detect');
    }
    return value;
  }

  private argv(value: unknown): string[] {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > 64 || value.some(v => typeof v !== 'string')) {
      throw new Error('args must be an array of at most 64 strings');
    }
    return value;
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private timeout(value: unknown): number {
    return typeof value === 'number' && Number.isFinite(value)
      ? Math.max(1000, Math.min(600000, Math.trunc(value)))
      : 60_000;
  }

  private compactResult(value: TermuxCommandResult) {
    return {
      stdout: value.stdout,
      stderr: value.stderr,
      exitCode: value.exitCode,
      termuxError: value.termuxError,
      termuxErrorMessage: value.termuxErrorMessage,
      truncated: value.truncated,
    };
  }

  private commandResult(label: string, value: TermuxCommandResult): TalentResult {
    return {
      type: value.exitCode === 0 && value.termuxError === -1 ? 'text' : 'error',
      summary: JSON.stringify({label, ...this.compactResult(value)}),
      ...(value.exitCode === 0 && value.termuxError === -1
        ? {}
        : {errorMessage: value.termuxErrorMessage || value.stderr || `exit code ${value.exitCode}`}),
    };
  }

  private json(value: unknown): TalentResult {
    return {type: 'text', summary: JSON.stringify(value)};
  }
}
