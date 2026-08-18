import {NativeModules, Platform} from 'react-native';

type AccessStatus = {
  rootAvailable: boolean;
  rootCommandWorked: boolean;
  output: string;
};

type SystemInfo = {
  model: string;
  manufacturer: string;
  android: string;
  securityPatch: string;
  fingerprint: string;
  verifiedBoot: string;
  bootloaderState: string;
};

const native = Platform.OS === 'android' ? NativeModules.AndroidControl : null;

export const androidControl = {
  async getAccessStatus(): Promise<AccessStatus> {
    if (!native) return {rootAvailable: false, rootCommandWorked: false, output: 'Android only'};
    return native.getAccessStatus();
  },
  async getSystemInfo(): Promise<SystemInfo> {
    if (!native) throw new Error('Android only');
    return native.getSystemInfo();
  },
  async getProperty(name: string): Promise<string> {
    if (!native) throw new Error('Android only');
    return native.getProperty(name);
  },
  async launchApp(packageName: string): Promise<boolean> {
    if (!native) throw new Error('Android only');
    return native.launchApp(packageName);
  },
  async listPackages(prefix?: string): Promise<string[]> {
    if (!native) throw new Error('Android only');
    return native.listPackages(prefix ?? null);
  },
};
