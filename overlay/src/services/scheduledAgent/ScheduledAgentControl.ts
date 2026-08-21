import {NativeModules, Platform} from 'react-native';

export type NativeScheduleStatus = {
  exactAlarmAllowed: boolean;
  notificationsEnabled: boolean;
  nativeScheduleCount: number;
};

export type NativeScheduleResult = {
  scheduled: boolean;
  exact: boolean;
  triggerAtMs: number;
  repeatDaily: boolean;
};

const native = Platform.OS === 'android' ? NativeModules.ScheduledAgent : null;

function requireNative() {
  if (!native) throw new Error('Scheduled Agent is available only on Android');
  return native;
}

export const scheduledAgentControl = {
  async getStatus(): Promise<NativeScheduleStatus> {
    return requireNative().getStatus();
  },

  async scheduleTask(
    taskId: string,
    title: string,
    triggerAtMs: number,
    repeatDaily: boolean,
  ): Promise<NativeScheduleResult> {
    return requireNative().scheduleTask(
      taskId,
      title,
      triggerAtMs,
      repeatDaily,
    );
  },

  async cancelTask(taskId: string): Promise<boolean> {
    return requireNative().cancelTask(taskId);
  },

  async triggerNow(taskId: string, title: string): Promise<boolean> {
    return requireNative().triggerNow(taskId, title);
  },

  async notifyResult(
    taskId: string,
    title: string,
    success: boolean,
  ): Promise<boolean> {
    return requireNative().notifyResult(taskId, title, success);
  },
};
