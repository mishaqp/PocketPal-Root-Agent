# PocketPal Root Agent fork

This fork adds a small Android control talent to PocketPal's existing AgentRunner.

## Current scope

The `android_system` talent exposes only fixed operations:

- `access_status` — checks whether a root `su` channel is available;
- `system_info` — reads safe device and boot-state information;
- `launch_app` — launches a validated package name;
- `list_packages` — lists installed packages, optionally by prefix.

There is intentionally no arbitrary shell endpoint, `eval`, or user string passed to
`sh -c`. Root is used only for the fixed `id` and `getprop <allowlisted-property>`
operations. Shizuku support is the next backend and will use the same TypeScript
talent interface.

## Agent extensions

The fork also adds local-only extension storage:

- long-term global memory plus Pal-scoped memory;
- prompt-only `SKILL.md` imports with enable/disable controls;
- declarative JSON plugins that route only to explicitly listed built-in talents;
- `memory` and `agent_extensions` talents, selectable per Pal.

Imported plugins never execute JavaScript, native code, or shell commands. The
`android_system` talent is explicitly rejected in plugin manifests, so root access
cannot be inherited indirectly by an imported extension.

## Using the talent

Create or edit a Pal and enable the `android_system` talent. The local model must
support tool calling; Qwen3 4B Q4_K_M is a practical starting point for a 12 GB
Android device. The app still works as a normal local chat when the talent is not
enabled.

## Safety

This is an experimental personal fork. Do not grant root to an APK you did not build
or inspect. Keep the allowlist narrow and require confirmation before adding any
operation that changes settings, installs/uninstalls packages, reboots, records the
screen, or reads private files.

## Build

The repository includes `.github/workflows/build-root-agent.yml`. Upload the
project to GitHub, open **Actions → Build PocketPal Root Agent APK → Run workflow**,
then download the APK from the completed workflow's **Artifacts** section.

The fork uses the separate package id `com.mikhail.pocketpalrootagent`, so it can
be installed alongside the original PocketPal application.
