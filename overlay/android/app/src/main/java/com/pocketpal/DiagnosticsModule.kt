package com.pocketpal

import android.content.ContentValues
import android.content.pm.PackageInfo
import android.os.Build
import android.os.Environment
import android.os.Process
import android.provider.MediaStore
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONObject
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.zip.ZipEntry
import java.util.zip.ZipOutputStream

/**
 * App-scoped diagnostics collector for Root Agent.
 *
 * The collector is intentionally not an arbitrary shell bridge. It records a
 * start timestamp, then on export snapshots logcat and a fixed allowlist of
 * package-specific Android diagnostics. System logcat is read with root so
 * ActivityManager/AndroidRuntime lines that mention this package are visible,
 * but unrelated apps are filtered out before anything is written to disk.
 *
 * Secrets commonly found in HTTP/debug logs are redacted before export. The
 * collector never dumps app databases, private files, environment variables,
 * clipboard contents, or credential stores.
 */
@ReactModule(name = DiagnosticsModule.NAME)
class DiagnosticsModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  companion object {
    const val NAME = "RootAgentDiagnostics"
    private const val PREFS = "root_agent_diagnostics"
    private const val KEY_ACTIVE = "active"
    private const val KEY_STARTED_AT = "started_at"
    private const val KEY_LAST_EXPORT = "last_export"
    private const val MAX_LOGCAT_CHARS = 12_000_000
    private const val MAX_SNAPSHOT_CHARS = 2_000_000
  }

  override fun getName(): String = NAME

  private val prefs by lazy { context.getSharedPreferences(PREFS, 0) }

  @ReactMethod
  fun startCapture(promise: Promise) {
    try {
      val now = System.currentTimeMillis()
      prefs.edit()
        .putBoolean(KEY_ACTIVE, true)
        .putLong(KEY_STARTED_AT, now)
        .apply()
      promise.resolve(statusMap())
    } catch (e: Exception) {
      promise.reject("DIAGNOSTICS_START_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun getStatus(promise: Promise) {
    try {
      promise.resolve(statusMap())
    } catch (e: Exception) {
      promise.reject("DIAGNOSTICS_STATUS_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun clearCapture(promise: Promise) {
    try {
      prefs.edit().remove(KEY_ACTIVE).remove(KEY_STARTED_AT).apply()
      promise.resolve(statusMap())
    } catch (e: Exception) {
      promise.reject("DIAGNOSTICS_CLEAR_FAILED", e.message, e)
    }
  }

  /** Stop the active capture (if any), build a redacted ZIP, and place it in Downloads/RootAgentLogs. */
  @ReactMethod
  fun exportBundle(runtimeJson: String, promise: Promise) {
    Thread {
      try {
        val end = System.currentTimeMillis()
        val configuredStart = prefs.getLong(KEY_STARTED_AT, 0L)
        val start = if (configuredStart > 0L) configuredStart else end - 10 * 60_000L
        prefs.edit().putBoolean(KEY_ACTIVE, false).apply()

        val workDir = File(context.cacheDir, "root-agent-diagnostics")
        if (workDir.exists()) workDir.deleteRecursively()
        workDir.mkdirs()

        val packageName = context.packageName
        val packageInfo = context.packageManager.getPackageInfo(packageName, 0)
        val logcatRaw = collectLogcat(start)
        val filteredLogcat = redact(filterRelevantLogcat(logcatRaw, packageName))
        File(workDir, "logcat-app.txt").writeText(filteredLogcat)

        val rootId = runFixedRoot(5, 64_000, "id")
        val selinux = runFixedRoot(5, 64_000, "getenforce")
        val packageDump = runFixedRoot(10, MAX_SNAPSHOT_CHARS, "dumpsys", "package", packageName)
        val appOps = runFixedRoot(10, MAX_SNAPSHOT_CHARS, "cmd", "appops", "get", packageName)
        val services = runFixedRoot(10, MAX_SNAPSHOT_CHARS, "dumpsys", "activity", "services", packageName)
        val meminfo = runFixedRoot(10, MAX_SNAPSHOT_CHARS, "dumpsys", "meminfo", packageName)
        val termuxPackage = runFixedRoot(10, MAX_SNAPSHOT_CHARS, "dumpsys", "package", "com.termux")

        File(workDir, "android-package.txt").writeText(redact(packageDump.output))
        File(workDir, "android-appops.txt").writeText(redact(appOps.output))
        File(workDir, "android-services.txt").writeText(redact(services.output))
        File(workDir, "android-meminfo.txt").writeText(redact(meminfo.output))
        File(workDir, "zerotermux-package.txt").writeText(redact(termuxPackage.output))
        File(workDir, "runtime.json").writeText(redact(runtimeJson.take(1_000_000)))

        val manifest = JSONObject()
          .put("schema", 1)
          .put("packageName", packageName)
          .put("versionName", packageInfo.versionName ?: "")
          .put("versionCode", versionCode(packageInfo))
          .put("captureStartedAt", start)
          .put("captureEndedAt", end)
          .put("captureDurationMs", (end - start).coerceAtLeast(0L))
          .put("android", Build.VERSION.RELEASE)
          .put("sdk", Build.VERSION.SDK_INT)
          .put("model", Build.MODEL)
          .put("manufacturer", Build.MANUFACTURER)
          .put("fingerprint", Build.FINGERPRINT)
          .put("processPid", Process.myPid())
          .put("rootIdExitCode", rootId.exitCode)
          .put("rootId", redact(rootId.output.trim()))
          .put("selinux", redact(selinux.output.trim()))
          .put("privacy", "App-scoped logs only; unrelated logcat lines filtered; common credentials redacted; no private databases/files dumped.")
        File(workDir, "manifest.json").writeText(manifest.toString(2))

        val stamp = SimpleDateFormat("yyyyMMdd-HHmmss", Locale.US).format(Date(end))
        val displayName = "RootAgent-diagnostics-$stamp.zip"
        val zip = File(context.cacheDir, displayName)
        if (zip.exists()) zip.delete()
        zipDirectory(workDir, zip)
        val uri = publishToDownloads(zip, displayName)

        prefs.edit().putString(KEY_LAST_EXPORT, displayName).apply()
        val map = Arguments.createMap()
        map.putString("fileName", displayName)
        map.putString("uri", uri)
        map.putDouble("sizeBytes", zip.length().toDouble())
        map.putDouble("startedAt", start.toDouble())
        map.putDouble("endedAt", end.toDouble())
        promise.resolve(map)
      } catch (e: Exception) {
        promise.reject("DIAGNOSTICS_EXPORT_FAILED", e.message, e)
      }
    }.start()
  }

  private fun statusMap() = Arguments.createMap().apply {
    val started = prefs.getLong(KEY_STARTED_AT, 0L)
    putBoolean("active", prefs.getBoolean(KEY_ACTIVE, false))
    if (started > 0L) putDouble("startedAt", started.toDouble()) else putNull("startedAt")
    putString("lastExport", prefs.getString(KEY_LAST_EXPORT, "") ?: "")
  }

  @Suppress("DEPRECATION")
  private fun versionCode(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

  private fun collectLogcat(startMillis: Long): String {
    val from = SimpleDateFormat("MM-dd HH:mm:ss.SSS", Locale.US).format(Date(startMillis))
    return runFixedRoot(20, MAX_LOGCAT_CHARS, "logcat", "-d", "-v", "threadtime", "-T", from).output
  }

  private fun filterRelevantLogcat(raw: String, packageName: String): String {
    if (raw.isBlank()) return "No logcat output was available.\n"
    val lines = raw.lineSequence().toList()
    val appPids = mutableSetOf(Process.myPid())
    val escaped = Regex.escape(packageName)
    val crashPid = Regex("Process:\\s*$escaped,\\s*PID:\\s*(\\d+)", RegexOption.IGNORE_CASE)
    val startPid = Regex("Start proc\\s+(\\d+):$escaped", RegexOption.IGNORE_CASE)
    val killPid = Regex("Killing\\s+(\\d+):$escaped", RegexOption.IGNORE_CASE)
    lines.forEach { line ->
      crashPid.find(line)?.groupValues?.getOrNull(1)?.toIntOrNull()?.let(appPids::add)
      startPid.find(line)?.groupValues?.getOrNull(1)?.toIntOrNull()?.let(appPids::add)
      killPid.find(line)?.groupValues?.getOrNull(1)?.toIntOrNull()?.let(appPids::add)
    }

    val threadtimePid = Regex("^\\d{2}-\\d{2}\\s+\\d{2}:\\d{2}:\\d{2}\\.\\d+\\s+(\\d+)\\s+")
    val uniqueTags = listOf("RootAgent", "AndroidControl", "TermuxBridge", "TermuxCommandBroker", "TermuxResultService")
    val filtered = lines.filter { line ->
      val pid = threadtimePid.find(line)?.groupValues?.getOrNull(1)?.toIntOrNull()
      line.contains(packageName, ignoreCase = true) ||
        (pid != null && appPids.contains(pid)) ||
        uniqueTags.any { tag -> line.contains(tag, ignoreCase = true) }
    }

    return buildString {
      appendLine("# Root Agent filtered logcat")
      appendLine("# package=$packageName pids=${appPids.sorted().joinToString(",")}")
      appendLine("# unrelated system/app lines were removed before export")
      filtered.forEach(::appendLine)
      if (filtered.isEmpty()) appendLine("# No matching lines found in the current logcat ring buffer.")
    }
  }

  private data class CommandResult(val exitCode: Int, val output: String)

  private fun shellQuote(value: String): String = "'" + value.replace("'", "'\"'\"'") + "'"

  /** Fixed-command root runner. No caller-provided executable or argv reaches this method. */
  private fun runFixedRoot(timeoutSeconds: Long, maxChars: Int, vararg args: String): CommandResult {
    require(args.isNotEmpty()) { "Empty command" }
    val command = args.joinToString(" ") { shellQuote(it) }
    val process = ProcessBuilder("su", "-c", command).redirectErrorStream(true).start()
    val output = StringBuilder()
    val readerThread = Thread {
      process.inputStream.bufferedReader().use { reader ->
        val buffer = CharArray(8192)
        while (true) {
          val count = reader.read(buffer)
          if (count <= 0) break
          if (output.length < maxChars) {
            val remaining = maxChars - output.length
            output.append(buffer, 0, minOf(count, remaining))
          }
        }
      }
    }
    readerThread.start()
    val finished = process.waitFor(timeoutSeconds, TimeUnit.SECONDS)
    if (!finished) process.destroyForcibly()
    readerThread.join(1500)
    val exit = if (finished) process.exitValue() else 124
    if (!finished && output.length < maxChars) output.append("\n[collector] command timed out\n")
    if (output.length >= maxChars) output.append("\n[collector] output truncated\n")
    return CommandResult(exit, output.toString())
  }

  private fun redact(input: String): String {
    var value = input
    value = value.replace(
      Regex("(?i)(authorization\\s*[:=]\\s*bearer\\s+)[A-Za-z0-9._~+/=-]+"),
      "\$1<REDACTED>"
    )
    value = value.replace(
      Regex("(?i)((?:api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|client[_-]?secret|password)\\s*[:=]\\s*[\\\"']?)([^\\s\\\"',}]+)"),
      "\$1<REDACTED>"
    )
    value = value.replace(Regex("(?i)\\bsk-[A-Za-z0-9_-]{12,}\\b"), "<REDACTED_KEY>")
    return value
  }

  private fun zipDirectory(source: File, destination: File) {
    ZipOutputStream(FileOutputStream(destination)).use { zip ->
      source.walkTopDown().filter { it.isFile }.forEach { file ->
        val entry = ZipEntry(file.relativeTo(source).invariantSeparatorsPath)
        zip.putNextEntry(entry)
        FileInputStream(file).use { it.copyTo(zip) }
        zip.closeEntry()
      }
    }
  }

  private fun publishToDownloads(zip: File, displayName: String): String {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      val values = ContentValues().apply {
        put(MediaStore.Downloads.DISPLAY_NAME, displayName)
        put(MediaStore.Downloads.MIME_TYPE, "application/zip")
        put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/RootAgentLogs")
        put(MediaStore.Downloads.IS_PENDING, 1)
      }
      val resolver = context.contentResolver
      val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
        ?: throw IllegalStateException("Could not create diagnostics file in Downloads")
      resolver.openOutputStream(uri)?.use { output ->
        FileInputStream(zip).use { input -> input.copyTo(output) }
      } ?: throw IllegalStateException("Could not open diagnostics Downloads output")
      val ready = ContentValues().apply { put(MediaStore.Downloads.IS_PENDING, 0) }
      resolver.update(uri, ready, null, null)
      return uri.toString()
    }

    @Suppress("DEPRECATION")
    val folder = File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "RootAgentLogs")
    folder.mkdirs()
    val target = File(folder, displayName)
    zip.copyTo(target, overwrite = true)
    return target.absolutePath
  }
}
