import {NativeModules, Platform} from 'react-native';

export type TermuxStatus = {
  installed: boolean;
  packageName: string;
  versionName: string;
  appLabel: string;
  permissionGranted: boolean;
  runCommandServiceVisible: boolean;
  setupHint: string;
};

export type TermuxCommandResult = {
  executionId: number;
  stdout: string;
  stderr: string;
  exitCode: number;
  termuxError: number;
  termuxErrorMessage: string;
  stdoutOriginalLength: number;
  stderrOriginalLength: number;
  truncated: boolean;
  foregroundRecoveryUsed: boolean;
};

const native = Platform.OS === 'android' ? NativeModules.TermuxBridge : null;

function requireTermuxBridge() {
  if (!native) throw new Error('Termux bridge is available only on Android');
  return native;
}

export const termuxControl = {
  async getStatus(): Promise<TermuxStatus> {
    return requireTermuxBridge().getStatus();
  },

  async runCommand(
    executable: string,
    args: string[] = [],
    options?: {
      workdir?: string;
      stdin?: string;
      timeoutMs?: number;
    },
  ): Promise<TermuxCommandResult> {
    return requireTermuxBridge().runCommand(
      executable,
      args,
      options?.workdir ?? null,
      options?.stdin ?? null,
      options?.timeoutMs ?? 60_000,
    );
  },
};
