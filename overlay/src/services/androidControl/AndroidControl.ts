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

type BatteryStatus = {
  percent: number;
  charging: boolean;
  status: string;
  plugged: string;
  temperatureC: number;
};

type StorageInfo = {
  totalBytes: number;
  freeBytes: number;
  usedBytes: number;
};

type BrightnessInfo = {
  value: number;
  automatic: boolean;
};

type PackageInfo = {
  packageName: string;
  versionName: string;
  versionCode: number;
  enabled: boolean;
  systemApp: boolean;
  launchable: boolean;
  label?: string;
};

const native = Platform.OS === 'android' ? NativeModules.AndroidControl : null;

function requireAndroid() {
  if (!native) throw new Error('Android only');
  return native;
}

export const androidControl = {
  async getAccessStatus(): Promise<AccessStatus> {
    if (!native) return {rootAvailable: false, rootCommandWorked: false, output: 'Android only'};
    return native.getAccessStatus();
  },
  async getSystemInfo(): Promise<SystemInfo> {
    return requireAndroid().getSystemInfo();
  },
  async getBatteryStatus(): Promise<BatteryStatus> {
    return requireAndroid().getBatteryStatus();
  },
  async getStorageInfo(): Promise<StorageInfo> {
    return requireAndroid().getStorageInfo();
  },
  async getBrightness(): Promise<BrightnessInfo> {
    return requireAndroid().getBrightness();
  },
  async setBrightness(value: number): Promise<boolean> {
    return requireAndroid().setBrightness(value);
  },
  async getProperty(name: string): Promise<string> {
    return requireAndroid().getProperty(name);
  },
  async launchApp(packageName: string): Promise<boolean> {
    return requireAndroid().launchApp(packageName);
  },
  async forceStopApp(packageName: string): Promise<boolean> {
    return requireAndroid().forceStopApp(packageName);
  },
  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    return requireAndroid().getPackageInfo(packageName);
  },
  async listPackages(prefix?: string): Promise<string[]> {
    return requireAndroid().listPackages(prefix ?? null);
  },
  async tap(x: number, y: number): Promise<boolean> {
    return requireAndroid().tap(x, y);
  },
  async swipe(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    durationMs = 300,
  ): Promise<boolean> {
    return requireAndroid().swipe(x1, y1, x2, y2, durationMs);
  },
  async keyEvent(action: string): Promise<boolean> {
    return requireAndroid().keyEvent(action);
  },
  async reboot(target: 'normal' | 'recovery' | 'bootloader', confirmation: string): Promise<boolean> {
    return requireAndroid().reboot(target, confirmation);
  },
};
