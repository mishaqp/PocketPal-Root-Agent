# PocketPal Root Agent fork

This fork extends PocketPal's AgentRunner with fixed Android control, structured Termux/ZeroTermux execution, and local-only agent extensions.

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

The bridge deliberately does not accept one concatenated shell command line. Direct Android root escalation executables such as `su`/`tsu` are rejected; privileged Android actions remain in `android_system`. PRoot `uid=0` is not treated as proof of Android root.

One-time setup on the phone:

1. Grant PocketPal Root Agent the additional permission **Run commands in Termux environment**.
2. In Termux/ZeroTermux set `allow-external-apps=true` in `~/.termux/termux.properties` and reload settings/restart the terminal app.
3. Run `termux` action `probe`; only a returned result is considered proof that the bridge works.

`com.termux` package visibility and `com.termux.permission.RUN_COMMAND` are added to the Android manifest at build time. Command results return through a one-shot PendingIntent service and include stdout, stderr, exit code, Termux internal error information, and truncation metadata.

## Agent extensions

The fork adds local-only extension storage:

- long-term global memory plus Pal-scoped memory;
- prompt-only `SKILL.md` imports with enable/disable controls;
- declarative JSON plugins that route only to explicitly listed built-in talents;
- `memory` and `agent_extensions` talents, selectable per Pal;
- a built-in DeepSeek API preset.

Imported plugins never execute JavaScript, native code, Android root operations, or Termux commands. Both `android_system` and `termux` are blocked from plugin delegation.

## Safety boundary

This is a personal experimental fork. Android root access is exposed only through fixed operations. Reboot requires explicit confirmation. Termux execution is a separate user-space console exposed as executable + argv rather than a hidden network shell.

## Build

The repository includes `.github/workflows/build-root-agent.yml`. The workflow overlays these files onto the pinned upstream PocketPal commit, applies provider/extension/DSML/runtime integration, installs dependencies, and builds the prod release APK.

The fork uses the separate package id `com.mikhail.pocketpalrootagent`, so it can be installed alongside the original PocketPal application.
