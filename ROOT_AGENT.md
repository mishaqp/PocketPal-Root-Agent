# PocketPal Root Agent fork

This fork extends PocketPal's AgentRunner with a fixed Android control talent and local-only agent extensions.

## Android control

The `android_system` talent exposes explicit, auditable operations only. There is no arbitrary shell endpoint or `eval`.

Current actions:

- `access_status` — verify the root channel and real `uid=0` execution;
- `system_info` — current device/build/boot information;
- `battery_status` — battery level, charging state, source, and temperature;
- `storage_info` — total, used, and free `/data` storage;
- `get_brightness` / `set_brightness` — read or set screen brightness;
- `list_packages` / `package_info` — inspect installed packages;
- `launch_app` / `force_stop_app` — open or stop a validated package;
- `tap` / `swipe` — fixed coordinate UI input through root;
- `key_event` — fixed allowlisted Android navigation/media key events;
- `reboot` — normal, recovery, or bootloader reboot with literal `REBOOT` confirmation.

Package names, coordinates, key actions, reboot targets, and system properties are validated. Dynamic values are shell-quoted, and imported plugins cannot inherit `android_system`.

The talent also injects a tool-first rule into the agent prompt: when the user asks about current phone state or requests a supported phone action, the model must call the tool instead of inventing a result.

## Agent extensions

The fork adds local-only extension storage:

- long-term global memory plus Pal-scoped memory;
- prompt-only `SKILL.md` imports with enable/disable controls;
- declarative JSON plugins that route only to explicitly listed built-in talents;
- `memory` and `agent_extensions` talents, selectable per Pal;
- a built-in DeepSeek API preset.

Imported plugins never execute JavaScript, native code, or shell commands. The `android_system` talent is explicitly rejected in plugin manifests, so root access cannot be inherited indirectly by an imported extension.

## Device profile used for testing

The personal target is POCO F5 / Redmi Note 12 Turbo (`marble`) on Android 16 / crDroid with KernelSU. Root has been verified as `uid=0` in the KernelSU context. The local Qwen3 1.7B Q4_K_M model is intended to remain CPU-only for stability.

## Safety boundary

This is a personal experimental fork. Root access is exposed only through fixed operations. Reboot requires explicit confirmation, and there is still no arbitrary shell tool.

## Build

The repository includes `.github/workflows/build-root-agent.yml`. The workflow overlays these files onto the pinned upstream PocketPal commit, applies the provider/extension patches, installs dependencies, and builds the prod release APK.

The fork uses the separate package id `com.mikhail.pocketpalrootagent`, so it can be installed alongside the original PocketPal application.
