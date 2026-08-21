import {NativeModules, Platform} from 'react-native';

export type DiagnosticsStatus = {
  active: boolean;
  startedAt?: number | null;
  lastExport: string;
};

export type DiagnosticsExport = {
  fileName: string;
  uri: string;
  sizeBytes: number;
  startedAt: number;
  endedAt: number;
};

const native =
  Platform.OS === 'android' ? NativeModules.RootAgentDiagnostics : null;

function requireAndroid() {
  if (!native) throw new Error('Root Agent diagnostics are Android only');
  return native;
}

export const diagnosticsControl = {
  async startCapture(): Promise<DiagnosticsStatus> {
    return requireAndroid().startCapture();
  },

  async getStatus(): Promise<DiagnosticsStatus> {
    if (!native) return {active: false, startedAt: null, lastExport: ''};
    return native.getStatus();
  },

  async clearCapture(): Promise<DiagnosticsStatus> {
    return requireAndroid().clearCapture();
  },

  async exportBundle(runtimeSnapshot: object): Promise<DiagnosticsExport> {
    const json = JSON.stringify(runtimeSnapshot);
    return requireAndroid().exportBundle(json);
  },
};
