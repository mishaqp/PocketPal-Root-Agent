#!/usr/bin/env python3
from __future__ import annotations

import re
import sys
from pathlib import Path


def fail(message: str) -> None:
    raise SystemExit(f"[api-only] {message}")


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        fail(f"{label}: expected exactly one anchor in {path}, found {count}")
    path.write_text(text.replace(old, new, 1), encoding="utf-8")


def regex_once(path: Path, pattern: str, replacement: str, label: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        fail(f"{label}: expected exactly one regex match in {path}, found {count}")
    path.write_text(updated, encoding="utf-8")


def main() -> None:
    if len(sys.argv) != 2:
        fail("usage: apply-api-only-edition.py <upstream-app-root>")

    root = Path(sys.argv[1]).resolve()
    if not (root / "package.json").exists():
        fail(f"not an app root: {root}")

    # ------------------------------------------------------------------
    # 1) Personal Android build: POCO/modern Android is arm64 only.
    #    Dropping x86_64 removes the emulator ABI and its duplicate native
    #    runtime payload from the shipped APK without changing JS behavior.
    # ------------------------------------------------------------------
    build_gradle = root / "android/app/build.gradle"
    replace_once(
        build_gradle,
        'abiFilters "arm64-v8a", "x86_64"',
        'abiFilters "arm64-v8a"',
        "arm64-only ABI",
    )

    # ------------------------------------------------------------------
    # 2) Disable llama.rn native autolinking on Android. The package remains
    #    installed so TypeScript can use its type declarations while Metro
    #    resolves runtime imports to the API-only shim below.
    # ------------------------------------------------------------------
    rn_config = root / "react-native.config.js"
    if rn_config.exists():
        fail("react-native.config.js unexpectedly exists upstream; merge manually")
    rn_config.write_text(
        """// Root Agent API Edition: remote/API models only.\n"
        "module.exports = {\n"
        "  dependencies: {\n"
        "    'llama.rn': {\n"
        "      platforms: {android: null},\n"
        "    },\n"
        "  },\n"
        "};\n"
        """,
        encoding="utf-8",
    )

    shim_dir = root / "src/shims"
    shim_dir.mkdir(parents=True, exist_ok=True)
    shim = shim_dir / "llamaRnApiOnly.js"
    shim.write_text(
        r"""/**
 * Runtime shim for Root Agent API Edition.
 *
 * The real llama.rn package is intentionally not linked into the Android APK.
 * TypeScript still resolves its declarations from node_modules, while Metro
 * redirects runtime imports here. Remote OpenAI-compatible completion does not
 * require llama.cpp. Any accidental local-model initialization fails with a
 * clear message instead of trying to load a missing native library.
 */

const API_ONLY_MESSAGE =
  'Local llama.rn inference is disabled in Root Agent API Edition. Configure and select a remote/API model.';

const disabled = name => {
  throw new Error(`${API_ONLY_MESSAGE} (${name})`);
};

// AboutScreen reads this synchronously.
const BuildInfo = {
  number: 'API',
  commit: 'api-only',
};

// Local-only probes should fail open where callers already have fallbacks.
const getBackendDevicesInfo = async () => [];
const loadLlamaModelInfo = async () => ({});

// Accidental attempts to create a local inference context must be explicit.
const initLlama = async () => disabled('initLlama');

// Some local-only cleanup paths may be reached after migration from an older
// install. Making cleanup no-op is safer than throwing during app startup.
const releaseAllLlama = async () => {};
const toggleNativeLog = () => {};

const known = {
  BuildInfo,
  getBackendDevicesInfo,
  loadLlamaModelInfo,
  initLlama,
  releaseAllLlama,
  toggleNativeLog,
};

// Keep future upstream local-only imports from crashing at module evaluation.
// If one is actually invoked, the error states exactly why it is unavailable.
const fallback = new Proxy(function apiOnlyDisabledExport() {}, {
  apply(_target, _thisArg, args) {
    const name = args && args.length ? String(args[0]) : 'llama.rn export';
    return disabled(name);
  },
  get(_target, prop) {
    if (prop === 'then') return undefined;
    if (prop === 'toString') return () => '[Root Agent API-only llama.rn shim]';
    return fallback;
  },
});

module.exports = new Proxy(known, {
  get(target, prop) {
    if (prop === '__esModule') return false;
    if (prop in target) return target[prop];
    return fallback;
  },
});
""",
        encoding="utf-8",
    )

    # Metro runtime alias. Keep the upstream transformer/resolver behavior and
    # only intercept the exact llama.rn module name.
    metro = root / "metro.config.js"
    replace_once(
        metro,
        "const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');\n",
        "const path = require('path');\nconst {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');\n",
        "Metro path import",
    )
    replace_once(
        metro,
        "  resolver: {\n    //nodeModulesPaths: [...localPackagePaths], // update to resolver\n",
        "  resolver: {\n"
        "    resolveRequest: (context, moduleName, platform) => {\n"
        "      if (moduleName === 'llama.rn') {\n"
        "        return {\n"
        "          filePath: path.resolve(__dirname, 'src/shims/llamaRnApiOnly.js'),\n"
        "          type: 'sourceFile',\n"
        "        };\n"
        "      }\n"
        "      return context.resolveRequest(context, moduleName, platform);\n"
        "    },\n"
        "    //nodeModulesPaths: [...localPackagePaths], // update to resolver\n",
        "Metro llama.rn alias",
    )

    # ------------------------------------------------------------------
    # 3) Keep ModelStore for remote/API sessions, but stop advertising local
    #    GGUF/HF models to chat and model-selection surfaces. ServerStore-backed
    #    remote models continue to use the original OpenAICompletionEngine.
    # ------------------------------------------------------------------
    model_store = root / "src/store/ModelStore.ts"
    replace_once(
        model_store,
        "  get displayModels(): Model[] {\n    return [...filterProjectionModels(this.models), ...this.remoteModels];\n  }",
        "  get displayModels(): Model[] {\n    // Root Agent API Edition exposes only remote/API models.\n    return this.remoteModels;\n  }",
        "remote-only displayModels",
    )

    regex_once(
        model_store,
        r"  get availableModels\(\): Model\[\] \{.*?\n  \}\n\n  isModelAvailable",
        "  get availableModels(): Model[] {\n"
        "    // Root Agent API Edition: local GGUF inference is intentionally disabled.\n"
        "    return this.remoteModels;\n"
        "  }\n\n"
        "  isModelAvailable",
        "remote-only availableModels",
    )

    replace_once(
        model_store,
        "  selectModel = async (model: Model): Promise<void> => {\n"
        "    if (model.origin === ModelOrigin.REMOTE) {\n"
        "      await this.setRemoteModel(model);\n"
        "    } else {\n"
        "      await this.initContext(model);\n"
        "    }\n"
        "  };",
        "  selectModel = async (model: Model): Promise<void> => {\n"
        "    if (model.origin !== ModelOrigin.REMOTE) {\n"
        "      throw new Error(\n"
        "        'Root Agent API Edition supports remote/API models only. Local GGUF inference is disabled.',\n"
        "      );\n"
        "    }\n"
        "    await this.setRemoteModel(model);\n"
        "  };",
        "remote-only selectModel",
    )

    print("[api-only] applied: arm64-only + llama.rn native removal + remote-only model selection")


if __name__ == "__main__":
    main()
