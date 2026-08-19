# PocketPal Root Agent

Personal PocketPal fork with an Android system talent.

The build is pinned to PocketPal commit
`5e0f72b599886f77ab5b0c5c4074347b6f4a1262` so the native/TypeScript overlay is
reproducible. Remote model setup includes a DeepSeek preset; the API key remains
stored by PocketPal in Android Keychain storage.

## Agent extensions

The Settings screen includes **Agent extensions**:

- global long-term memory and Pal-scoped memory through the optional `memory`
  talent;
- import and enable/disable prompt-only `SKILL.md` files;
- import permission-limited plugin manifests;
- inspect and run enabled plugins through the optional `agent_extensions`
  talent.

Plugins are declarative JSON, not executable JavaScript. Example:

```json
{
  "id": "research-kit",
  "name": "Research Kit",
  "description": "Search and read web pages",
  "talents": ["web_search", "read_url"]
}
```

Plugin manifests cannot request `android_system`; root remains an explicit Pal
talent and is never delegated to imported extensions.
