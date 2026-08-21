import {androidControl} from '../androidControl/AndroidControl';
import {SystemPromptContext, TalentEngine, TalentResult, ToolDefinition} from './types';

/** Fixed, auditable Android operations. No arbitrary shell or eval. */
export class AndroidSystemEngine implements TalentEngine {
  readonly name = 'android_system';

  systemPromptFragment(_ctx: SystemPromptContext): string {
    return [
      'ANDROID DEVICE RULES:',
      '- When the user asks about the current phone state, installed apps, battery, storage, brightness, or root status, call android_system instead of guessing.',
      '- When the user asks to perform a supported phone action, call android_system and report the tool result only after it returns.',
      '- Never claim that a tap, swipe, app launch, force-stop, brightness change, or reboot happened unless the tool reports success.',
      '- Reboot actions are allowed only after an explicit reboot/recovery/bootloader request from the user in the current turn.',
    ].join('\n');
  }

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const action = typeof args.action === 'string' ? args.action : '';
    try {
      if (action === 'access_status') {
        return this.json(await androidControl.getAccessStatus());
      }
      if (action === 'system_info') {
        return this.json(await androidControl.getSystemInfo());
      }
      if (action === 'battery_status') {
        return this.json(await androidControl.getBatteryStatus());
      }
      if (action === 'storage_info') {
        return this.json(await androidControl.getStorageInfo());
      }
      if (action === 'get_brightness') {
        return this.json(await androidControl.getBrightness());
      }
      if (action === 'set_brightness') {
        const value = this.numberArg(args, 'value');
        const ok = await androidControl.setBrightness(value);
        return {type: 'text', summary: ok ? `Brightness set to ${Math.trunc(value)}` : 'Brightness change failed'};
      }
      if (action === 'launch_app') {
        const packageName = this.stringArg(args, 'packageName');
        const ok = await androidControl.launchApp(packageName);
        return {type: 'text', summary: ok ? `Launched ${packageName}` : `Could not launch ${packageName}`};
      }
      if (action === 'force_stop_app') {
        const packageName = this.stringArg(args, 'packageName');
        const ok = await androidControl.forceStopApp(packageName);
        return {type: 'text', summary: ok ? `Force-stopped ${packageName}` : `Could not force-stop ${packageName}`};
      }
      if (action === 'package_info') {
        const packageName = this.stringArg(args, 'packageName');
        return this.json(await androidControl.getPackageInfo(packageName));
      }
      if (action === 'list_packages') {
        const prefix = typeof args.prefix === 'string' ? args.prefix : undefined;
        const packages = await androidControl.listPackages(prefix);
        return {type: 'text', summary: packages.join('\n')};
      }
      if (action === 'tap') {
        const x = this.numberArg(args, 'x');
        const y = this.numberArg(args, 'y');
        const ok = await androidControl.tap(x, y);
        return {type: 'text', summary: ok ? `Tapped ${Math.trunc(x)},${Math.trunc(y)}` : 'Tap failed'};
      }
      if (action === 'swipe') {
        const x1 = this.numberArg(args, 'x1');
        const y1 = this.numberArg(args, 'y1');
        const x2 = this.numberArg(args, 'x2');
        const y2 = this.numberArg(args, 'y2');
        const durationMs = typeof args.durationMs === 'number' ? args.durationMs : 300;
        const ok = await androidControl.swipe(x1, y1, x2, y2, durationMs);
        return {type: 'text', summary: ok ? 'Swipe completed' : 'Swipe failed'};
      }
      if (action === 'key_event') {
        const key = this.stringArg(args, 'key').toUpperCase();
        const ok = await androidControl.keyEvent(key);
        return {type: 'text', summary: ok ? `Key event ${key} sent` : `Key event ${key} failed`};
      }
      if (action === 'reboot') {
        const target = this.stringArg(args, 'target');
        if (target !== 'normal' && target !== 'recovery' && target !== 'bootloader') {
          throw new Error('target must be normal, recovery, or bootloader');
        }
        const confirmation = this.stringArg(args, 'confirmation');
        if (confirmation !== 'REBOOT') {
          throw new Error('confirmation must be REBOOT after an explicit user request');
        }
        const ok = await androidControl.reboot(target, confirmation);
        return {type: 'text', summary: ok ? `Reboot requested: ${target}` : `Reboot request failed: ${target}`};
      }
      return {
        type: 'error',
        summary: 'android_system: unsupported action',
        errorMessage: 'Use one of the actions declared in the android_system tool schema.',
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return {type: 'error', summary: `android_system failed: ${message}`, errorMessage: message};
    }
  }

  toToolDefinition(): ToolDefinition {
    return {
      type: 'function',
      function: {
        name: this.name,
        description:
          'Read current Android state and perform fixed Android actions. Use this tool instead of guessing device state. No arbitrary shell is exposed.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: [
                'access_status',
                'system_info',
                'battery_status',
                'storage_info',
                'get_brightness',
                'set_brightness',
                'launch_app',
                'force_stop_app',
                'package_info',
                'list_packages',
                'tap',
                'swipe',
                'key_event',
                'reboot',
              ],
            },
            packageName: {type: 'string', description: 'Android package name for app actions.'},
            prefix: {type: 'string', description: 'Optional package prefix for list_packages.'},
            value: {type: 'number', description: 'Brightness value from 0 to 255 for set_brightness.'},
            x: {type: 'number', description: 'X coordinate for tap.'},
            y: {type: 'number', description: 'Y coordinate for tap.'},
            x1: {type: 'number', description: 'Swipe start X.'},
            y1: {type: 'number', description: 'Swipe start Y.'},
            x2: {type: 'number', description: 'Swipe end X.'},
            y2: {type: 'number', description: 'Swipe end Y.'},
            durationMs: {type: 'number', description: 'Swipe duration in milliseconds, default 300.'},
            key: {
              type: 'string',
              enum: [
                'BACK',
                'HOME',
                'RECENTS',
                'ENTER',
                'DPAD_UP',
                'DPAD_DOWN',
                'DPAD_LEFT',
                'DPAD_RIGHT',
                'VOLUME_UP',
                'VOLUME_DOWN',
                'WAKEUP',
                'SLEEP',
              ],
              description: 'Fixed Android key action for key_event.',
            },
            target: {
              type: 'string',
              enum: ['normal', 'recovery', 'bootloader'],
              description: 'Reboot target. Only for reboot after an explicit user request.',
            },
            confirmation: {
              type: 'string',
              enum: ['REBOOT'],
              description: 'Required literal confirmation for reboot.',
            },
          },
          required: ['action'],
        },
      },
    };
  }

  private json(value: unknown): TalentResult {
    return {type: 'text', summary: JSON.stringify(value)};
  }

  private stringArg(args: Record<string, any>, name: string): string {
    const value = args[name];
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`);
    return value.trim();
  }

  private numberArg(args: Record<string, any>, name: string): number {
    const value = args[name];
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
    return value;
  }
}
