package com.pocketpal

import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.os.Process
import org.json.JSONObject
import java.io.File
import java.io.PrintWriter
import java.io.StringWriter
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Extremely early, app-private boot journal for Root Agent.
 *
 * Goals:
 * - record the last reached native/JS startup stage before the UI is ready;
 * - preserve the previous incomplete boot across process restarts;
 * - capture uncaught Java/Kotlin exceptions before delegating to Android/RN;
 * - recommend one conservative "safe start" after an incomplete boot.
 *
 * This intentionally does not execute shell/root commands and never records
 * prompts, API keys, chat text, clipboard data, or arbitrary app files.
 */
object RootAgentBootCrashRecorder {
  private const val PREFS = "root_agent_boot_safety"
  private const val KEY_BOOT_ID = "boot_id"
  private const val KEY_STARTED_AT = "started_at"
  private const val KEY_STAGE = "stage"
  private const val KEY_UI_READY = "ui_ready"
  private const val KEY_SAFE_MODE = "safe_mode_recommended"
  private const val KEY_CONSECUTIVE_FAILURES = "consecutive_failures"
  private const val KEY_CRASH_STAGE = "crash_stage"
  private const val KEY_CRASH_CLASS = "crash_class"
  private const val KEY_CRASH_MESSAGE = "crash_message"
  private const val KEY_CRASH_STACK = "crash_stack"
  private const val KEY_CRASH_AT = "crash_at"

  private const val KEY_PREVIOUS_BOOT_ID = "previous_boot_id"
  private const val KEY_PREVIOUS_STARTED_AT = "previous_started_at"
  private const val KEY_PREVIOUS_STAGE = "previous_stage"
  private const val KEY_PREVIOUS_UI_READY = "previous_ui_ready"
  private const val KEY_PREVIOUS_CRASH_STAGE = "previous_crash_stage"
  private const val KEY_PREVIOUS_CRASH_CLASS = "previous_crash_class"
  private const val KEY_PREVIOUS_CRASH_MESSAGE = "previous_crash_message"
  private const val KEY_PREVIOUS_CRASH_STACK = "previous_crash_stack"
  private const val KEY_PREVIOUS_CRASH_AT = "previous_crash_at"

  private const val CURRENT_LOG = "boot-current.txt"
  private const val PREVIOUS_LOG = "boot-previous.txt"
  private const val MAX_STACK_CHARS = 48_000

  private val initialized = AtomicBoolean(false)
  @Volatile private var appContext: Context? = null
  @Volatile private var previousDefaultHandler: Thread.UncaughtExceptionHandler? = null

  fun initialize(context: Context) {
    if (!initialized.compareAndSet(false, true)) return
    val app = context.applicationContext
    appContext = app
    val prefs = prefs(app)

    val previousBootId = prefs.getString(KEY_BOOT_ID, "").orEmpty()
    val previousStartedAt = prefs.getLong(KEY_STARTED_AT, 0L)
    val previousStage = prefs.getString(KEY_STAGE, "").orEmpty()
    val previousUiReady = prefs.getBoolean(KEY_UI_READY, false)
    val hadPreviousBoot = previousBootId.isNotBlank() && previousStartedAt > 0L
    val previousIncomplete = hadPreviousBoot && !previousUiReady

    val priorFailures = prefs.getInt(KEY_CONSECUTIVE_FAILURES, 0)
    val failures = if (previousIncomplete) (priorFailures + 1).coerceAtMost(10) else 0

    if (hadPreviousBoot) {
      prefs.edit()
        .putString(KEY_PREVIOUS_BOOT_ID, previousBootId)
        .putLong(KEY_PREVIOUS_STARTED_AT, previousStartedAt)
        .putString(KEY_PREVIOUS_STAGE, previousStage)
        .putBoolean(KEY_PREVIOUS_UI_READY, previousUiReady)
        .putString(KEY_PREVIOUS_CRASH_STAGE, prefs.getString(KEY_CRASH_STAGE, "").orEmpty())
        .putString(KEY_PREVIOUS_CRASH_CLASS, prefs.getString(KEY_CRASH_CLASS, "").orEmpty())
        .putString(KEY_PREVIOUS_CRASH_MESSAGE, prefs.getString(KEY_CRASH_MESSAGE, "").orEmpty())
        .putString(KEY_PREVIOUS_CRASH_STACK, prefs.getString(KEY_CRASH_STACK, "").orEmpty())
        .putLong(KEY_PREVIOUS_CRASH_AT, prefs.getLong(KEY_CRASH_AT, 0L))
        .commit()
      rotateCurrentLog(app)
    }

    val bootId = UUID.randomUUID().toString()
    val now = System.currentTimeMillis()
    prefs.edit()
      .putString(KEY_BOOT_ID, bootId)
      .putLong(KEY_STARTED_AT, now)
      .putString(KEY_STAGE, "APPLICATION_CREATED")
      .putBoolean(KEY_UI_READY, false)
      .putBoolean(KEY_SAFE_MODE, previousIncomplete)
      .putInt(KEY_CONSECUTIVE_FAILURES, failures)
      .remove(KEY_CRASH_STAGE)
      .remove(KEY_CRASH_CLASS)
      .remove(KEY_CRASH_MESSAGE)
      .remove(KEY_CRASH_STACK)
      .remove(KEY_CRASH_AT)
      .commit()

    resetCurrentLog(app)
    appendLine(app, "APPLICATION_CREATED safeModeRecommended=$previousIncomplete consecutiveFailures=$failures")

    previousDefaultHandler = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { thread, throwable ->
      try {
        recordCrash(thread, throwable)
      } catch (_: Throwable) {
        // Never replace the original crash with a recorder failure.
      } finally {
        val delegate = previousDefaultHandler
        if (delegate != null && delegate !== Thread.getDefaultUncaughtExceptionHandler()) {
          delegate.uncaughtException(thread, throwable)
        } else {
          Process.killProcess(Process.myPid())
          kotlin.system.exitProcess(10)
        }
      }
    }
  }

  fun mark(stage: String) {
    val app = appContext ?: return
    val safeStage = sanitizeStage(stage)
    prefs(app).edit().putString(KEY_STAGE, safeStage).commit()
    appendLine(app, safeStage)
  }

  fun markUiReady() {
    val app = appContext ?: return
    prefs(app).edit()
      .putString(KEY_STAGE, "UI_READY")
      .putBoolean(KEY_UI_READY, true)
      .putBoolean(KEY_SAFE_MODE, false)
      .putInt(KEY_CONSECUTIVE_FAILURES, 0)
      .commit()
    appendLine(app, "UI_READY")
  }

  fun statusJson(context: Context): JSONObject {
    val p = prefs(context.applicationContext)
    return JSONObject()
      .put("schema", 1)
      .put("bootId", p.getString(KEY_BOOT_ID, "").orEmpty())
      .put("startedAt", p.getLong(KEY_STARTED_AT, 0L))
      .put("stage", p.getString(KEY_STAGE, "").orEmpty())
      .put("uiReady", p.getBoolean(KEY_UI_READY, false))
      .put("safeModeRecommended", p.getBoolean(KEY_SAFE_MODE, false))
      .put("consecutiveFailures", p.getInt(KEY_CONSECUTIVE_FAILURES, 0))
      .put("crashStage", p.getString(KEY_CRASH_STAGE, "").orEmpty())
      .put("crashClass", p.getString(KEY_CRASH_CLASS, "").orEmpty())
      .put("crashMessage", p.getString(KEY_CRASH_MESSAGE, "").orEmpty())
      .put("crashAt", p.getLong(KEY_CRASH_AT, 0L))
      .put(
        "previous",
        JSONObject()
          .put("bootId", p.getString(KEY_PREVIOUS_BOOT_ID, "").orEmpty())
          .put("startedAt", p.getLong(KEY_PREVIOUS_STARTED_AT, 0L))
          .put("stage", p.getString(KEY_PREVIOUS_STAGE, "").orEmpty())
          .put("uiReady", p.getBoolean(KEY_PREVIOUS_UI_READY, false))
          .put("crashStage", p.getString(KEY_PREVIOUS_CRASH_STAGE, "").orEmpty())
          .put("crashClass", p.getString(KEY_PREVIOUS_CRASH_CLASS, "").orEmpty())
          .put("crashMessage", p.getString(KEY_PREVIOUS_CRASH_MESSAGE, "").orEmpty())
          .put("crashAt", p.getLong(KEY_PREVIOUS_CRASH_AT, 0L))
      )
  }

  fun currentLogFile(context: Context): File = File(logDir(context.applicationContext), CURRENT_LOG)

  fun previousLogFile(context: Context): File = File(logDir(context.applicationContext), PREVIOUS_LOG)

  fun previousCrashStack(context: Context): String =
    prefs(context.applicationContext).getString(KEY_PREVIOUS_CRASH_STACK, "").orEmpty()

  fun currentCrashStack(context: Context): String =
    prefs(context.applicationContext).getString(KEY_CRASH_STACK, "").orEmpty()

  private fun recordCrash(thread: Thread, throwable: Throwable) {
    val app = appContext ?: return
    val p = prefs(app)
    val stage = p.getString(KEY_STAGE, "UNKNOWN").orEmpty().ifBlank { "UNKNOWN" }
    val stackWriter = StringWriter()
    throwable.printStackTrace(PrintWriter(stackWriter))
    val stack = stackWriter.toString().take(MAX_STACK_CHARS)
    val now = System.currentTimeMillis()
    p.edit()
      .putString(KEY_CRASH_STAGE, stage)
      .putString(KEY_CRASH_CLASS, throwable.javaClass.name)
      .putString(KEY_CRASH_MESSAGE, throwable.message.orEmpty().take(4000))
      .putString(KEY_CRASH_STACK, stack)
      .putLong(KEY_CRASH_AT, now)
      .putString(KEY_STAGE, "CRASHED")
      .commit()
    appendLine(
      app,
      "CRASHED thread=${thread.name.take(120)} stage=$stage class=${throwable.javaClass.name} message=${throwable.message.orEmpty().take(800)}"
    )
  }

  private fun sanitizeStage(value: String): String =
    value.uppercase(Locale.US)
      .replace(Regex("[^A-Z0-9_.:-]"), "_")
      .take(80)
      .ifBlank { "UNKNOWN" }

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun logDir(context: Context): File = File(context.filesDir, "root-agent-boot").apply { mkdirs() }

  private fun resetCurrentLog(context: Context) {
    val file = currentLogFile(context)
    file.parentFile?.mkdirs()
    val header = buildString {
      appendLine("# Root Agent boot journal")
      appendLine("# android=${Build.VERSION.RELEASE} sdk=${Build.VERSION.SDK_INT}")
      appendLine("# model=${Build.MODEL} manufacturer=${Build.MANUFACTURER}")
      appendLine("# pid=${Process.myPid()}")
    }
    runCatching { file.writeText(header) }
  }

  private fun rotateCurrentLog(context: Context) {
    val current = currentLogFile(context)
    if (!current.isFile) return
    val previous = previousLogFile(context)
    runCatching { current.copyTo(previous, overwrite = true) }
  }

  private fun appendLine(context: Context, value: String) {
    val timestamp = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSZ", Locale.US).format(Date())
    runCatching { currentLogFile(context).appendText("$timestamp $value\n") }
  }
}
