import {androidControl} from '../androidControl/AndroidControl';
import {TalentEngine, TalentResult, ToolDefinition} from './types';

/** Fixed, auditable Android operations. No arbitrary shell or eval. */
export class AndroidSystemEngine implements TalentEngine {
  readonly name = 'android_system';

  async execute(args: Record<string, any>): Promise<TalentResult> {
    const action = typeof args.action === 'string' ? args.action : '';
    try {
      if (action === 'access_status') {
        const value = await androidControl.getAccessStatus();
        return {type: 'text', summary: JSON.stringify(value)};
      }
      if (action === 'system_info') {
        const value = await androidControl.getSystemInfo();
        return {type: 'text', summary: JSON.stringify(value)};
      }
      if (action === 'launch_app') {
        const packageName = typeof args.packageName === 'string' ? args.packageName : '';
        const ok = await androidControl.launchApp(packageName);
        return {type: 'text', summary: ok ? `Launched ${packageName}` : `Could not launch ${packageName}`};
      }
      if (action === 'list_packages') {
        const prefix = typeof args.prefix === 'string' ? args.prefix : undefined;
        const packages = await androidControl.listPackages(prefix);
        return {type: 'text', summary: packages.join('\n')};
      }
      return {type: 'error', summary: 'android_system: unsupported action', errorMessage: 'Use access_status, system_info, launch_app, or list_packages.'};
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
        description: 'Use fixed Android operations. Root is checked but arbitrary shell commands are forbidden.',
        parameters: {
          type: 'object',
          properties: {
            action: {type: 'string', enum: ['access_status', 'system_info', 'launch_app', 'list_packages']},
            packageName: {type: 'string', description: 'Android package name, only for launch_app.'},
            prefix: {type: 'string', description: 'Optional package prefix for list_packages.'},
          },
          required: ['action'],
        },
      },
    };
  }
}
