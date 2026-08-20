package com.pocketpal

import android.app.PendingIntent
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableType
import com.facebook.react.module.annotations.ReactModule

/**
 * Structured bridge to Termux/ZeroTermux RUN_COMMAND.
 *
 * The model never supplies a shell command line. It supplies one executable and
 * an argv array. Android root stays in AndroidControlModule; Termux is treated as
 * a separate user-space execution environment.
 */
@ReactModule(name = TermuxBridgeModule.NAME)
class TermuxBridgeModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  companion object {
    const val NAME = "TermuxBridge"
    private const val TERMUX_PACKAGE = "com.termux"
    private const val TERMUX_RUN_SERVICE = "com.termux.app.RunCommandService"
    private const val PERMISSION_RUN_COMMAND = "com.termux.permission.RUN_COMMAND"
    private const val ACTION_RUN_COMMAND = "com.termux.RUN_COMMAND"
    private const val EXTRA_COMMAND_PATH = "com.termux.RUN_COMMAND_PATH"
    private const val EXTRA_ARGUMENTS = "com.termux.RUN_COMMAND_ARGUMENTS"
    private const val EXTRA_STDIN = "com.termux.RUN_COMMAND_STDIN"
    private const val EXTRA_WORKDIR = "com.termux.RUN_COMMAND_WORKDIR"
    private const val EXTRA_BACKGROUND = "com.termux.RUN_COMMAND_BACKGROUND"
    private const val EXTRA_PENDING_INTENT = "com.termux.RUN_COMMAND_PENDING_INTENT"
    private const val TERMUX_BIN_PREFIX = "\$PREFIX/bin/"
    private const val TERMUX_PREFIX_TOKEN = "\$PREFIX/"
    private const val DEFAULT_WORKDIR = "~/"
    private const val FOREGROUND_RECOVERY_DELAY_MS = 750L
  }

  private val executablePattern = Regex("^[A-Za-z0-9][A-Za-z0-9._+:-]{0,63}$")
  private val blockedExecutables = setOf("su", "sudo", "tsu", "magisk", "ksud")
  private val mainHandler = Handler(Looper.getMainLooper())

  override fun getName(): String = NAME

  @ReactMethod
  fun getStatus(promise: Promise) {
    try {
      val map = Arguments.createMap()
      val packageInfo = try {
        getPackageInfoCompat(TERMUX_PACKAGE)
      } catch (_: Exception) {
        null
      }
      val appInfo = packageInfo?.applicationInfo
      map.putBoolean("installed", packageInfo != null)
      map.putString("packageName", TERMUX_PACKAGE)
      map.putString("versionName", packageInfo?.versionName ?: "")
      map.putString(
        "appLabel",
        if (appInfo != null) context.packageManager.getApplicationLabel(appInfo).toString() else ""
      )
      map.putBoolean(
        "permissionGranted",
        context.checkSelfPermission(PERMISSION_RUN_COMMAND) == PackageManager.PERMISSION_GRANTED
      )
      val serviceIntent = Intent().apply {
        setClassName(TERMUX_PACKAGE, TERMUX_RUN_SERVICE)
        action = ACTION_RUN_COMMAND
      }
      map.putBoolean(
        "runCommandServiceVisible",
        context.packageManager.resolveService(serviceIntent, 0) != null,
      )
      map.putString(
        "setupHint",
        "Grant Run commands in Termux environment to PocketPal Root Agent and set allow-external-apps=true in ~/.termux/termux.properties"
      )
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("TERMUX_STATUS_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun runCommand(
    executable: String,
    arguments: ReadableArray,
    workdir: String?,
    stdin: String?,
    timeoutMs: Double,
    promise: Promise,
  ) {
    try {
      val safeExecutable = validateExecutable(executable)
      val safeArgs = validateArguments(arguments)
      val safeWorkdir = validateWorkdir(workdir)
      val safeStdin = stdin?.also {
        require(it.length <= 65_536) { "stdin is limited to 65536 characters" }
      }
      val timeout = timeoutMs.toLong().coerceIn(1_000L, 600_000L)

      getPackageInfoCompat(TERMUX_PACKAGE)
      if (context.checkSelfPermission(PERMISSION_RUN_COMMAND) != PackageManager.PERMISSION_GRANTED) {
        throw SecurityException(
          "PocketPal Root Agent does not have com.termux.permission.RUN_COMMAND. Grant the Additional permission: Run commands in Termux environment."
        )
      }

      val executionId = TermuxCommandBroker.nextExecutionId()
      val resultIntent = Intent(context, TermuxResultService::class.java).apply {
        putExtra(TermuxResultService.EXTRA_EXECUTION_ID, executionId)
      }
      val pendingFlags = PendingIntent.FLAG_ONE_SHOT or
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
      val pendingIntent = PendingIntent.getService(
        context,
        executionId,
        resultIntent,
        pendingFlags,
      )

      val commandIntent = Intent().apply {
        setClassName(TERMUX_PACKAGE, TERMUX_RUN_SERVICE)
        action = ACTION_RUN_COMMAND
        putExtra(EXTRA_COMMAND_PATH, TERMUX_BIN_PREFIX + safeExecutable)
        putExtra(EXTRA_ARGUMENTS, safeArgs.toTypedArray())
        putExtra(EXTRA_WORKDIR, safeWorkdir)
        putExtra(EXTRA_BACKGROUND, true)
        putExtra(EXTRA_PENDING_INTENT, pendingIntent)
        if (safeStdin != null) putExtra(EXTRA_STDIN, safeStdin)
      }

      TermuxCommandBroker.register(executionId, promise, timeout)
      startCommandService(executionId, commandIntent)
    } catch (e: Exception) {
      promise.reject("TERMUX_RUN_FAILED", e.message, e)
    }
  }

  /**
   * Android may reject an exported service start when ZeroTermux has been idle
   * in the background. When Root Agent itself is visibly in the foreground we
   * can safely wake ZeroTermux once, retry the exact same structured command,
   * then bring Root Agent back. We never do this from a background agent/app.
   */
  private fun startCommandService(executionId: Int, commandIntent: Intent) {
    try {
      val component = context.startService(commandIntent)
      if (component == null) {
        TermuxCommandBroker.fail(executionId, "Termux RunCommandService could not be started")
      }
    } catch (e: Exception) {
      if (isBackgroundStartRestriction(e) && scheduleForegroundRecovery(executionId, commandIntent)) {
        return
      }
      TermuxCommandBroker.fail(executionId, e.message ?: "Failed to start Termux command")
    }
  }

  private fun scheduleForegroundRecovery(executionId: Int, commandIntent: Intent): Boolean {
    val callerActivity = currentActivity ?: return false
    if (callerActivity.isFinishing || callerActivity.isDestroyed) return false
    val launchTermux = context.packageManager.getLaunchIntentForPackage(TERMUX_PACKAGE) ?: return false

    TermuxCommandBroker.markForegroundRecovery(executionId)
    mainHandler.post {
      try {
        launchTermux.addFlags(
          Intent.FLAG_ACTIVITY_NEW_TASK or
            Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
            Intent.FLAG_ACTIVITY_NO_ANIMATION,
        )
        context.startActivity(launchTermux)
      } catch (e: Exception) {
        TermuxCommandBroker.fail(
          executionId,
          "ZeroTermux background recovery could not foreground the app: ${e.message ?: e.javaClass.simpleName}",
        )
        return@post
      }

      mainHandler.postDelayed({
        try {
          val component = context.startService(commandIntent)
          if (component == null) {
            TermuxCommandBroker.fail(
              executionId,
              "Termux RunCommandService could not be started after foreground recovery",
            )
          }
        } catch (e: Exception) {
          TermuxCommandBroker.fail(
            executionId,
            "Termux retry after foreground recovery failed: ${e.message ?: e.javaClass.simpleName}",
          )
        } finally {
          bringRootAgentToFront()
        }
      }, FOREGROUND_RECOVERY_DELAY_MS)
    }
    return true
  }

  private fun bringRootAgentToFront() {
    try {
      val launchSelf = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return
      launchSelf.addFlags(
        Intent.FLAG_ACTIVITY_NEW_TASK or
          Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
          Intent.FLAG_ACTIVITY_SINGLE_TOP or
          Intent.FLAG_ACTIVITY_NO_ANIMATION,
      )
      context.startActivity(launchSelf)
    } catch (_: Exception) {
      // The command result still reaches TermuxResultService even if Android
      // refuses this cosmetic foreground restoration.
    }
  }

  private fun isBackgroundStartRestriction(error: Exception): Boolean {
    val text = "${error.javaClass.name}: ${error.message.orEmpty()}".lowercase()
    return text.contains("backgroundservicestartnotallowedexception") ||
      (text.contains("not allowed to start service") && text.contains("background"))
  }

  private fun validateExecutable(value: String): String {
    val executable = value.trim()
    require(executablePattern.matches(executable)) {
      "executable must be a simple Termux command name, not a shell command line"
    }
    require(!blockedExecutables.contains(executable.lowercase())) {
      "Android root escalation through Termux is blocked; use android_system for privileged Android actions"
    }
    return executable
  }

  private fun validateArguments(arguments: ReadableArray): List<String> {
    require(arguments.size() <= 64) { "at most 64 arguments are allowed" }
    var total = 0
    val result = ArrayList<String>(arguments.size())
    for (i in 0 until arguments.size()) {
      require(arguments.getType(i) == ReadableType.String) { "all command arguments must be strings" }
      val value = arguments.getString(i) ?: ""
      require(value.length <= 8_192) { "each argument is limited to 8192 characters" }
      total += value.length
      require(total <= 65_536) { "combined arguments are limited to 65536 characters" }
      result.add(value)
    }
    return result
  }

  private fun validateWorkdir(value: String?): String {
    val workdir = value?.trim().orEmpty().ifBlank { DEFAULT_WORKDIR }
    require(workdir.length <= 512) { "workdir is too long" }
    val allowed = workdir == "~/" ||
      workdir.startsWith("~/") ||
      workdir.startsWith(TERMUX_PREFIX_TOKEN) ||
      workdir.startsWith("/storage/emulated/0/") ||
      workdir == "/storage/emulated/0" ||
      workdir.startsWith("/sdcard/") ||
      workdir == "/sdcard"
    require(allowed) { "workdir must be inside Termux home/prefix or shared storage" }
    require(!workdir.contains("\u0000")) { "workdir contains an invalid character" }
    return workdir
  }

  @Suppress("DEPRECATION")
  private fun getPackageInfoCompat(packageName: String) =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
    } else {
      context.packageManager.getPackageInfo(packageName, 0)
    }
}
