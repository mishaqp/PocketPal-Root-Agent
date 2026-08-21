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

    # This device-targeted build is arm64-only. Keep both filters because
    # React Native/CMake also reads reactNativeArchitectures when deciding
    # which native libraries to build.
    build_gradle = root / "android/app/build.gradle"
    replace_once(
        build_gradle,
        'abiFilters "arm64-v8a", "x86_64"',
        'abiFilters "arm64-v8a"',
        "arm64-only ABI",
    )

    gradle_properties = root / "android/gradle.properties"
    replace_once(
        gradle_properties,
        "reactNativeArchitectures=arm64-v8a,x86_64",
        "reactNativeArchitectures=arm64-v8a",
        "React Native arm64-only architectures",
    )

    # IMPORTANT: keep llama.rn autolinked for now.
    #
    # PocketPal's startup graph still imports llama.rn from ModelStore and
    # several local-model helpers. The first API-only attempt replaced the
    # package with a Metro shim and removed the native module. That APK built
    # successfully but crashed immediately on a real device, including after a
    # clean reinstall. Until the local-inference startup graph is fully
    # refactored away, retaining the native bridge is the safe compatibility
    # boundary. Local models are still hidden/rejected below, so users cannot
    # accidentally select GGUF inference in this API Edition.

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
        r"  get availableModels\(\): Model\[\] \{.*?\n  \}(?=\n\n  setInferencing)",
        "  get availableModels(): Model[] {\n"
        "    // Root Agent API Edition: local GGUF selection is disabled.\n"
        "    return this.remoteModels;\n"
        "  }",
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
        "[api-only] applied: arm64-only + remote-only model selection; "
        "llama.rn native bridge retained for startup compatibility"
    )


if __name__ == "__main__":
    main()
