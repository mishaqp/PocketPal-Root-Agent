import type {AgentPlugin, AgentSkill} from '../../store/ExtensionStore';

const slugify = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64) || 'imported-extension';

const FORBIDDEN_PLUGIN_TALENTS = new Set([
  'android_system',
  'termux',
  'task_checkpoint',
]);

function parseFrontmatter(raw: string): {
  attributes: Record<string, string>;
  body: string;
} {
  const text = raw.replace(/^\uFEFF/, '').trim();
  if (!text.startsWith('---\n')) {
    return {attributes: {}, body: text};
  }
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) {
    return {attributes: {}, body: text};
  }
  const attributes: Record<string, string> = {};
  for (const line of text.slice(4, end).split('\n')) {
    const separator = line.indexOf(':');
    if (separator <= 0) {
      continue;
    }
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line
      .slice(separator + 1)
      .trim()
      .replace(/^['"]|['"]$/g, '');
    if (key && value) {
      attributes[key] = value;
    }
  }
  return {attributes, body: text.slice(end + 5).trim()};
}

export function parseSkillMarkdown(
  raw: string,
  fallbackName = 'Imported skill',
): AgentSkill {
  if (raw.length > 100_000) {
    throw new Error('SKILL.md is too large');
  }
  const {attributes, body} = parseFrontmatter(raw);
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const name = attributes.name || heading || fallbackName;
  if (!body) {
    throw new Error('SKILL.md has no instructions');
  }
  return {
    id: slugify(attributes.id || name),
    name,
    description: attributes.description || '',
    instructions: body,
    enabled: true,
  };
}

export function parsePluginManifest(raw: string): AgentPlugin {
  if (raw.length > 32_000) {
    throw new Error('Plugin manifest is too large');
  }
  const value = JSON.parse(raw) as Partial<AgentPlugin>;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Plugin manifest must be a JSON object');
  }
  if (!value.name || !Array.isArray(value.talents)) {
    throw new Error('Plugin requires name and talents[]');
  }
  const forbidden = value.talents.map(String).find(talent =>
    FORBIDDEN_PLUGIN_TALENTS.has(talent),
  );
  if (forbidden) {
    throw new Error(`Plugins cannot request privileged talent ${forbidden}`);
  }
  return {
    id: slugify(value.id || value.name),
    name: String(value.name),
    description: String(value.description || ''),
    talents: value.talents.map(String),
    enabled: value.enabled !== false,
  };
}
