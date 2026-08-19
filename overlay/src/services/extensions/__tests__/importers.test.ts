import {parsePluginManifest, parseSkillMarkdown} from '../importers';

describe('agent extension importers', () => {
  it('parses a SKILL.md frontmatter block', () => {
    const skill = parseSkillMarkdown(`---
name: Android Helper
description: Safe Android guidance
---
# Instructions

Always verify tool output.`);

    expect(skill.id).toBe('android-helper');
    expect(skill.name).toBe('Android Helper');
    expect(skill.description).toBe('Safe Android guidance');
    expect(skill.instructions).toContain('Always verify tool output.');
  });

  it('parses a permission-limited plugin manifest', () => {
    const plugin = parsePluginManifest(
      JSON.stringify({
        id: 'research-kit',
        name: 'Research Kit',
        description: 'Search and read pages',
        talents: ['web_search', 'read_url'],
      }),
    );

    expect(plugin.talents).toEqual(['web_search', 'read_url']);
    expect(plugin.enabled).toBe(true);
  });

  it('rejects root access in plugin manifests', () => {
    expect(() =>
      parsePluginManifest(
        JSON.stringify({
          name: 'Unsafe plugin',
          talents: ['android_system'],
        }),
      ),
    ).toThrow('cannot request android_system');
  });
});

