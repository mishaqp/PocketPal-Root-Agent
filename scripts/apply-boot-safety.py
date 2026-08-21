#!/usr/bin/env python3
from pathlib import Path
import sys

root = Path(sys.argv[1] if len(sys.argv) > 1 else "app")
main_application_path = root / "android/app/src/main/java/com/pocketpalai/MainApplication.kt"
diagnostics_module_path = root / "android/app/src/main/java/com/pocketpal/DiagnosticsModule.kt"
diagnostics_control_path = root / "src/services/diagnostics/DiagnosticsControl.ts"
app_path = root / "App.tsx"

main_application = main_application_path.read_text(encoding="utf-8")
diagnostics_module = diagnostics_module_path.read_text(encoding="utf-8")
diagnostics_control = diagnostics_control_path.read_text(encoding="utf-8")
app = app_path.read_text(encoding="utf-8")

# ---------------------------------------------------------------------------
# 1) Native boot journal starts before SoLoader / New Architecture startup.
# ---------------------------------------------------------------------------
needle = """  override fun onCreate() {\n    super.onCreate()\n"""
replacement = """  override fun onCreate() {\n    super.onCreate()\n    RootAgentBootCrashRecorder.initialize(this)\n    RootAgentBootCrashRecorder.mark(\"APPLICATION_ONCREATE\")\n"""
if replacement not in main_application:
    if needle not in main_application:
        raise SystemExit("MainApplication onCreate anchor not found")
    main_application = main_application.replace(needle, replacement, 1)

needle = """    Os.setenv(\"LM_GGML_OPENCL_ADRENO_USE_LARGE_BUFFER\", \"1\", true)\n    SoLoader.init(this, OpenSourceMergedSoMapping)\n    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {\n"""
replacement = """    RootAgentBootCrashRecorder.mark(\"PRE_SOLOADER\")\n    Os.setenv(\"LM_GGML_OPENCL_ADRENO_USE_LARGE_BUFFER\", \"1\", true)\n    SoLoader.init(this, OpenSourceMergedSoMapping)\n    RootAgentBootCrashRecorder.mark(\"SOLOADER_READY\")\n    if (BuildConfig.IS_NEW_ARCHITECTURE_ENABLED) {\n      RootAgentBootCrashRecorder.mark(\"NEW_ARCH_LOADING\")\n"""
if replacement not in main_application:
    if needle not in main_application:
        raise SystemExit("MainApplication SoLoader anchor not found")
    main_application = main_application.replace(needle, replacement, 1)

needle = """      load()\n    }\n  }\n}\n"""
replacement = """      load()\n      RootAgentBootCrashRecorder.mark(\"NEW_ARCH_READY\")\n    }\n    RootAgentBootCrashRecorder.mark(\"NATIVE_READY\")\n  }\n}\n"""
if replacement not in main_application:
    if needle not in main_application:
        raise SystemExit("MainApplication completion anchor not found")
    main_application = main_application.replace(needle, replacement, 1)

# ---------------------------------------------------------------------------
# 2) Expose only boot-health metadata through the existing diagnostics module.
# ---------------------------------------------------------------------------
needle = """  @ReactMethod\n  fun clearCapture(promise: Promise) {\n"""
addition = """  @ReactMethod\n  fun getBootStatus(promise: Promise) {\n    try {\n      promise.resolve(RootAgentBootCrashRecorder.statusJson(context).toString())\n    } catch (e: Exception) {\n      promise.reject(\"BOOT_STATUS_FAILED\", e.message, e)\n    }\n  }\n\n  @ReactMethod\n  fun markBootStage(stage: String, promise: Promise) {\n    try {\n      RootAgentBootCrashRecorder.mark(stage)\n      promise.resolve(true)\n    } catch (e: Exception) {\n      promise.reject(\"BOOT_STAGE_FAILED\", e.message, e)\n    }\n  }\n\n  @ReactMethod\n  fun markUiReady(promise: Promise) {\n    try {\n      RootAgentBootCrashRecorder.markUiReady()\n      promise.resolve(true)\n    } catch (e: Exception) {\n      promise.reject(\"BOOT_READY_FAILED\", e.message, e)\n    }\n  }\n\n""" + needle
if addition not in diagnostics_module:
    if needle not in diagnostics_module:
        raise SystemExit("DiagnosticsModule clearCapture anchor not found")
    diagnostics_module = diagnostics_module.replace(needle, addition, 1)

needle = """        File(workDir, \"runtime.json\").writeText(redact(runtimeJson.take(1_000_000)))\n\n        val manifest = JSONObject()\n          .put(\"schema\", 1)\n"""
replacement = """        File(workDir, \"runtime.json\").writeText(redact(runtimeJson.take(1_000_000)))\n\n        val bootStatus = RootAgentBootCrashRecorder.statusJson(context)\n        File(workDir, \"boot-status.json\").writeText(bootStatus.toString(2))\n        RootAgentBootCrashRecorder.currentLogFile(context).takeIf { it.isFile }?.copyTo(\n          File(workDir, \"boot-current.txt\"),\n          overwrite = true,\n        )\n        RootAgentBootCrashRecorder.previousLogFile(context).takeIf { it.isFile }?.copyTo(\n          File(workDir, \"boot-previous.txt\"),\n          overwrite = true,\n        )\n        RootAgentBootCrashRecorder.currentCrashStack(context).takeIf { it.isNotBlank() }?.let {\n          File(workDir, \"boot-crash-current.txt\").writeText(redact(it))\n        }\n        RootAgentBootCrashRecorder.previousCrashStack(context).takeIf { it.isNotBlank() }?.let {\n          File(workDir, \"boot-crash-previous.txt\").writeText(redact(it))\n        }\n\n        val manifest = JSONObject()\n          .put(\"schema\", 2)\n          .put(\"bootSafety\", bootStatus)\n"""
if replacement not in diagnostics_module:
    if needle not in diagnostics_module:
        raise SystemExit("DiagnosticsModule runtime export anchor not found")
    diagnostics_module = diagnostics_module.replace(needle, replacement, 1)

needle = """    val uniqueTags = listOf(\"RootAgent\", \"AndroidControl\", \"TermuxBridge\", \"TermuxCommandBroker\", \"TermuxResultService\")\n"""
replacement = """    val uniqueTags = listOf(\"RootAgent\", \"RootAgentBoot\", \"AndroidControl\", \"TermuxBridge\", \"TermuxCommandBroker\", \"TermuxResultService\")\n"""
if replacement not in diagnostics_module:
    if needle not in diagnostics_module:
        raise SystemExit("DiagnosticsModule tag anchor not found")
    diagnostics_module = diagnostics_module.replace(needle, replacement, 1)

# ---------------------------------------------------------------------------
# 3) Typed JS wrapper. No crash stack is exposed to the model; diagnostics ZIP
#    remains the explicit export surface.
# ---------------------------------------------------------------------------
needle = """export type DiagnosticsExport = {\n  fileName: string;\n  uri: string;\n  sizeBytes: number;\n  startedAt: number;\n  endedAt: number;\n};\n\n"""
replacement = needle + """export type BootSafetyStatus = {\n  schema: number;\n  bootId: string;\n  startedAt: number;\n  stage: string;\n  uiReady: boolean;\n  safeModeRecommended: boolean;\n  consecutiveFailures: number;\n  crashStage?: string;\n  crashClass?: string;\n  crashMessage?: string;\n  crashAt?: number;\n  previous?: {\n    bootId?: string;\n    startedAt?: number;\n    stage?: string;\n    uiReady?: boolean;\n    crashStage?: string;\n    crashClass?: string;\n    crashMessage?: string;\n    crashAt?: number;\n  };\n};\n\n"""
if replacement not in diagnostics_control:
    if needle not in diagnostics_control:
        raise SystemExit("DiagnosticsControl type anchor not found")
    diagnostics_control = diagnostics_control.replace(needle, replacement, 1)

needle = """  async clearCapture(): Promise<DiagnosticsStatus> {\n    return requireAndroid().clearCapture();\n  },\n\n  async exportBundle(runtimeSnapshot: object): Promise<DiagnosticsExport> {\n"""
replacement = """  async clearCapture(): Promise<DiagnosticsStatus> {\n    return requireAndroid().clearCapture();\n  },\n\n  async getBootStatus(): Promise<BootSafetyStatus> {\n    const raw = await requireAndroid().getBootStatus();\n    return JSON.parse(String(raw)) as BootSafetyStatus;\n  },\n\n  async markBootStage(stage: string): Promise<boolean> {\n    return requireAndroid().markBootStage(stage);\n  },\n\n  async markUiReady(): Promise<boolean> {\n    return requireAndroid().markUiReady();\n  },\n\n  async exportBundle(runtimeSnapshot: object): Promise<DiagnosticsExport> {\n"""
if replacement not in diagnostics_control:
    if needle not in diagnostics_control:
        raise SystemExit("DiagnosticsControl method anchor not found")
    diagnostics_control = diagnostics_control.replace(needle, replacement, 1)

# ---------------------------------------------------------------------------
# 4) Safe Start: after one incomplete pre-UI boot, skip only optional fork
#    startup work for the next launch. Core React Native startup is untouched.
#    Once the UI stays alive for 1.5s, safe mode is cleared automatically.
# ---------------------------------------------------------------------------
needle = """import {rootAgentRuntimeStore} from './src/services/rootAgent';\n"""
replacement = needle + "import {diagnosticsControl} from './src/services/diagnostics/DiagnosticsControl';\n"
if replacement not in app:
    if needle not in app:
        raise SystemExit("App.tsx RootAgentRuntime import anchor not found")
    app = app.replace(needle, replacement, 1)

needle = """  // Initialize TTS store (memory gate + AppState/session listeners).\n  // Fire-and-forget: `init()` is idempotent and swallows its own errors.\n  React.useEffect(() => {\n    ttsStore.init().catch(() => {\n      // init() swallows its own errors; catch to satisfy no-floating-promises.\n    });\n  }, []);\n\n  // Root Agent startup health is a passive, read-only probe. Deep Termux/Linux\n  // execution is lazy so app launch never needs to foreground ZeroTermux.\n  React.useEffect(() => {\n    void rootAgentRuntimeStore.startupSelfTest(\n      chatSessionStore.activeSessionId ?? undefined,\n    );\n  }, []);\n\n"""
replacement = """  // Native Boot Crash Recorder is already active before SoLoader. Here we\n  // decide whether this launch should use one conservative Safe Start. Safe\n  // Start skips only optional fork startup work; it never disables React Native,\n  // API chat, navigation, or the diagnostics surface.\n  React.useEffect(() => {\n    let cancelled = false;\n    let readyTimer: ReturnType<typeof setTimeout> | undefined;\n\n    void (async () => {\n      let safeMode = false;\n      try {\n        await diagnosticsControl.markBootStage('JS_BOOTSTRAP');\n        const boot = await diagnosticsControl.getBootStatus();\n        safeMode = boot.safeModeRecommended === true;\n        await diagnosticsControl.markBootStage(\n          safeMode ? 'SAFE_START_ACTIVE' : 'NORMAL_START',\n        );\n      } catch (error) {\n        // Recorder failure must never prevent a normal app launch.\n        console.warn('[boot-safety] recorder unavailable:', error);\n      }\n\n      if (cancelled) return;\n\n      if (safeMode) {\n        console.warn(\n          '[boot-safety] Previous boot did not reach UI_READY; optional TTS/root health startup is skipped once.',\n        );\n      } else {\n        ttsStore.init().catch(() => {\n          // init() swallows its own errors; catch to satisfy no-floating-promises.\n        });\n        void rootAgentRuntimeStore.startupSelfTest(\n          chatSessionStore.activeSessionId ?? undefined,\n        );\n      }\n\n      // useEffect runs after the first React commit. Keep the process alive for a\n      // short stabilization window before declaring the boot healthy, so an\n      // immediate post-render startup crash is still attributed correctly.\n      readyTimer = setTimeout(() => {\n        void diagnosticsControl.markUiReady().catch(error => {\n          console.warn('[boot-safety] UI_READY marker failed:', error);\n        });\n      }, 1500);\n    })();\n\n    return () => {\n      cancelled = true;\n      if (readyTimer) clearTimeout(readyTimer);\n    };\n  }, []);\n\n"""
if replacement not in app:
    if needle not in app:
        raise SystemExit("App.tsx startup effects anchor not found")
    app = app.replace(needle, replacement, 1)

main_application_path.write_text(main_application, encoding="utf-8")
diagnostics_module_path.write_text(diagnostics_module, encoding="utf-8")
diagnostics_control_path.write_text(diagnostics_control, encoding="utf-8")
app_path.write_text(app, encoding="utf-8")

print("Applied native Boot Crash Recorder + one-shot Safe Start + diagnostics export")
