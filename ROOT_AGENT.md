# PocketPal Root Agent fork

This fork extends PocketPal's AgentRunner with fixed Android control, structured Termux/ZeroTermux execution, resumable tasks, runtime health state, and local-only agent extensions.

## Android control

The `android_system` talent exposes explicit, auditable operations only. There is no arbitrary Android root shell endpoint or `eval`.

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

## Termux / ZeroTermux

The always-on `termux` talent talks to the standard `com.termux.app.RunCommandService`, so it is compatible with Termux-compatible builds that use the `com.termux` package, including ZeroTermux.

Actions:

- `status` — detect the app, label/version, command service, and RUN_COMMAND permission;
- `probe` — run `id` and return real stdout/stderr/exit code;
- `exec` — run one Termux executable with a structured argv array;
- `linux_detect` — inspect the Termux identity and query installed PRoot-Distro containers;
- `linux_exec` — run one structured executable+argv command inside a selected PRoot-Distro container.

`linux_exec.workdir` maps to PRoot-Distro `--work-dir`, so commands really start inside the requested guest directory without a shell `cd` wrapper.

The bridge deliberately does not accept one concatenated shell command line. Direct Android root escalation executables such as `su`/`tsu` are rejected; privileged Android actions remain in `android_system`. PRoot `uid=0` is not treated as proof of Android root.

When Android has idled ZeroTermux and rejects the exported service start, the native bridge can recover once while Root Agent itself is visibly in the foreground: it foregrounds ZeroTermux, retries the exact same structured command after a short delay, and attempts to return Root Agent to the foreground. This recovery is not attempted from a background Root Agent process. Successful command results include `foregroundRecoveryUsed` so the runtime/logging layer can record that the retry happened.

One-time setup on the phone:

1. Grant PocketPal Root Agent the additional permission **Run commands in Termux environment**.
2. In Termux/ZeroTermux set `allow-external-apps=true` in `~/.termux/termux.properties` and reload settings/restart the terminal app.
3. Run `termux` action `probe`; only a returned result is considered proof that the bridge works.

`com.termux` package visibility and `com.termux.permission.RUN_COMMAND` are added to the Android manifest at build time. Command results return through a one-shot PendingIntent service and include stdout, stderr, exit code, Termux internal error information, truncation metadata, and foreground-recovery metadata.

## Resumable tasks

The always-on `task_checkpoint` talent stores per-chat task checkpoints in AsyncStorage. A checkpoint tracks the task, last confirmed step, optional total step count, next action, workspace, notes, last tool outcome, and interruption error.

Verified tool outcomes are also checkpointed automatically. Completion/API/network failures mark the current task `interrupted`. The next request in the same chat receives the persisted checkpoint and is instructed to verify real device/files/process state before continuing, rather than blindly replaying the last command.

Semantic checkpoints created by the model stay active until `task_checkpoint.complete` is called after final verification. Purely automatic bookkeeping checkpoints can close automatically on a normal run finish.

## Root Agent runtime health

`RootAgentRuntimeStore` is the single observable runtime-health source intended for the future Root Agent UI. It tracks:

- Android root readiness, root identity, model, and Android version;
- ZeroTermux install/permission/service readiness and foreground-recovery count;
- PRoot/Linux distro readiness;
- active/interrupted agent task and checkpoint state;
- passive/deep self-test state and derived problems.

App startup performs a passive read-only self-test: Android access/system info, ZeroTermux configuration status, and checkpoint hydration. It deliberately does **not** execute a Termux command on startup, so opening the app cannot unexpectedly switch to ZeroTermux.

A deep self-test is lazy/explicit and actually probes Termux, `proot-distro list`, and one read-only `id` inside the detected distro. Normal `android_system`/`termux` tool outcomes continuously refresh the runtime store, so future Device/Tasks/Linux dashboards can observe one state object rather than issue their own root commands.

## Agent extensions

The fork adds local-only extension storage:

- long-term global memory plus Pal-scoped memory;
- prompt-only `SKILL.md` imports with enable/disable controls;
- declarative JSON plugins that route only to explicitly listed built-in talents;
- `memory` and `agent_extensions` talents, selectable per Pal;
- a built-in DeepSeek API preset.

Imported plugins never execute JavaScript, native code, Android root operations, Termux commands, or task checkpoints. Privileged runtime talents are blocked from plugin delegation.

## Safety boundary

This is a personal experimental fork. Android root access is exposed only through fixed operations. Reboot requires explicit confirmation. Termux execution is a separate user-space console exposed as executable + argv rather than a hidden network shell.

## Build

The repository includes `.github/workflows/build-root-agent.yml`. The workflow overlays these files onto the pinned upstream PocketPal commit, applies provider/extension/DSML/runtime integration, installs dependencies, and builds the prod release APK.

The fork uses the separate package id `com.mikhail.pocketpalrootagent`, so it can be installed alongside the original PocketPal application.
