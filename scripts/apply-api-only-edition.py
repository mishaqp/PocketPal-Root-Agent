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

    # Personal Android build: modern phones are arm64. Dropping x86_64
    # removes the emulator ABI and its duplicate native payload.
    build_gradle = root / "android/app/build.gradle"
    replace_once(
        build_gradle,
        'abiFilters "arm64-v8a", "x86_64"',
        'abiFilters "arm64-v8a"',
        "arm64-only ABI",
    )

    # Keep upstream project/font configuration, adding only the Android
    # autolink exclusion for llama.rn. The npm package remains installed so
    # TypeScript can continue to use its declarations.
    rn_config = root / "react-native.config.js"
    replace_once(
        rn_config,
        "module.exports = {\n"
        "  project: {\n"
        "    ios: {},\n"
        "    android: {},\n"
        "  },\n"
        "  assets: ['./src/assets/fonts'],\n"
        "};\n",
        "module.exports = {\n"
        "  project: {\n"
        "    ios: {},\n"
        "    android: {},\n"
        "  },\n"
        "  assets: ['./src/assets/fonts'],\n"
        "  dependencies: {\n"
        "    'llama.rn': {\n"
        "      platforms: {android: null},\n"
        "    },\n"
        "  },\n"
        "};\n",
        "llama.rn Android autolink exclusion",
    )

    # Runtime shim: Metro redirects llama.rn imports here, while tsc continues
    # to use the real package declarations. Remote OpenAI-compatible completion
    # never needs the native llama.cpp runtime.
    shim_dir = root / "src/shims"
    shim_dir.mkdir(parents=True, exist_ok=True)
    shim = shim_dir / "llamaRnApiOnly.js"
    shim.write_text(
        r"""/**
 * Root Agent API Edition runtime shim for llama.rn.
 * Local inference is intentionally disabled; remote/API completion remains in
 * the original OpenAICompletionEngine.
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

// Local-only capability/metadata probes fail open.
const getBackendDevicesInfo = async () => [];
const loadLlamaModelInfo = async () => ({});

// Any actual attempt to start local inference should fail explicitly.
const initLlama = async () => disabled('initLlama');

// Cleanup/logging calls can safely become no-ops after upgrading from a build
// that previously contained the native runtime.
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

// Future local-only imports should not crash during module evaluation. If an
// unknown export is actually invoked, it fails with the API-only explanation.
const fallback = new Proxy(function apiOnlyDisabledExport() {}, {
  apply() {
    return disabled('llama.rn export');
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

    # Keep upstream Metro behavior and intercept only the exact llama.rn module.
    metro = root / "metro.config.js"
    replace_once(
        metro,
        "const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');\n",
        "const path = require('path');\n"
        "const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');\n",
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

    # Keep ModelStore itself because remote models are integrated there, but only
    # expose ServerStore-backed remote models to selection surfaces.
    model_store = root / "src/store/ModelStore.ts"
    replace_once(
        model_store,
        "  get displayModels(): Model[] {\n"
        "    return [...filterProjectionModels(this.models), ...this.remoteModels];\n"
        "  }",
        "  get displayModels(): Model[] {\n"
        "    // Root Agent API Edition exposes only remote/API models.\n"
        "    return this.remoteModels;\n"
        "  }",
        "remote-only displayModels",
    )

    regex_once(
        model_store,
        r"  get availableModels\(\): Model\[\] \{.*?\n  \}\n\n  isModelAvailable",
        "  get availableModels(): Model[] {\n"
        "    // Root Agent API Edition: local GGUF inference is disabled.\n"
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

    print(
        "[api-only] applied: arm64-only + llama.rn native removal + remote-only model selection"
    )


if __name__ == "__main__":
    main()
