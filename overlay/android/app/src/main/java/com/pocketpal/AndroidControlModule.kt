package com.pocketpal

import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.BatteryManager
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.provider.Settings
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.module.annotations.ReactModule
import java.util.concurrent.TimeUnit

/**
 * Auditable Android bridge for PocketPal Root Agent.
 *
 * There is deliberately no arbitrary shell endpoint. Privileged operations are
 * fixed methods below; package names, coordinates, key actions, reboot targets,
 * and system properties are validated before a root command is constructed.
 */
@ReactModule(name = AndroidControlModule.NAME)
class AndroidControlModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  companion object { const val NAME = "AndroidControl" }

  private val packagePattern = Regex("^[a-zA-Z][a-zA-Z0-9_]*(\\.[a-zA-Z0-9_]+)+$")
  private val propertyAllowlist = setOf(
    "ro.product.model", "ro.product.manufacturer", "ro.build.version.release",
    "ro.build.version.security_patch", "ro.build.fingerprint", "ro.boot.verifiedbootstate",
    "ro.boot.flash.locked", "ro.boot.vbmeta.device_state"
  )
  private val keyEvents = mapOf(
    "BACK" to 4,
    "HOME" to 3,
    "RECENTS" to 187,
    "ENTER" to 66,
    "DPAD_UP" to 19,
    "DPAD_DOWN" to 20,
    "DPAD_LEFT" to 21,
    "DPAD_RIGHT" to 22,
    "VOLUME_UP" to 24,
    "VOLUME_DOWN" to 25,
    "WAKEUP" to 224,
    "SLEEP" to 223
  )

  override fun getName(): String = NAME

  @ReactMethod
  fun getAccessStatus(promise: Promise) {
    try {
      val root = runFixedRoot("id")
      val map = Arguments.createMap()
      map.putBoolean("rootAvailable", root.exitCode == 0 && root.stdout.contains("uid=0"))
      map.putBoolean("rootCommandWorked", root.exitCode == 0)
      map.putString("output", root.stdout.trim().take(500))
      promise.resolve(map)
    } catch (e: Exception) { promise.reject("ANDROID_ACCESS", e.message, e) }
  }

  @ReactMethod
  fun getSystemInfo(promise: Promise) {
    try {
      val map = Arguments.createMap()
      map.putString("model", Build.MODEL)
      map.putString("manufacturer", Build.MANUFACTURER)
      map.putString("android", Build.VERSION.RELEASE)
      map.putString("securityPatch", Build.VERSION.SECURITY_PATCH)
      map.putString("fingerprint", Build.FINGERPRINT)
      map.putString("verifiedBoot", getProp("ro.boot.verifiedbootstate"))
      map.putString("bootloaderState", getProp("ro.boot.vbmeta.device_state"))
      promise.resolve(map)
    } catch (e: Exception) { promise.reject("ANDROID_INFO", e.message, e) }
  }

  @ReactMethod
  fun getBatteryStatus(promise: Promise) {
    try {
      val intent = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        ?: throw IllegalStateException("Battery status unavailable")
      val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
      val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, 100).coerceAtLeast(1)
      val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, BatteryManager.BATTERY_STATUS_UNKNOWN)
      val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0)
      val temperature = intent.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0)
      val map = Arguments.createMap()
      map.putInt("percent", ((level.coerceAtLeast(0) * 100.0) / scale).toInt().coerceIn(0, 100))
      map.putBoolean(
        "charging",
        status == BatteryManager.BATTERY_STATUS_CHARGING || status == BatteryManager.BATTERY_STATUS_FULL
      )
      map.putString(
        "status",
        when (status) {
          BatteryManager.BATTERY_STATUS_CHARGING -> "charging"
          BatteryManager.BATTERY_STATUS_DISCHARGING -> "discharging"
          BatteryManager.BATTERY_STATUS_FULL -> "full"
          BatteryManager.BATTERY_STATUS_NOT_CHARGING -> "not_charging"
          else -> "unknown"
        }
      )
      map.putString(
        "plugged",
        when (plugged) {
          BatteryManager.BATTERY_PLUGGED_AC -> "ac"
          BatteryManager.BATTERY_PLUGGED_USB -> "usb"
          BatteryManager.BATTERY_PLUGGED_WIRELESS -> "wireless"
          else -> "none"
        }
      )
      map.putDouble("temperatureC", temperature / 10.0)
      promise.resolve(map)
    } catch (e: Exception) { promise.reject("BATTERY_FAILED", e.message, e) }
  }

  @ReactMethod
  fun getStorageInfo(promise: Promise) {
    try {
      val stat = StatFs(Environment.getDataDirectory().absolutePath)
      val total = stat.totalBytes
      val free = stat.availableBytes
      val map = Arguments.createMap()
      map.putDouble("totalBytes", total.toDouble())
      map.putDouble("freeBytes", free.toDouble())
      map.putDouble("usedBytes", (total - free).coerceAtLeast(0).toDouble())
      promise.resolve(map)
    } catch (e: Exception) { promise.reject("STORAGE_FAILED", e.message, e) }
  }

  @ReactMethod
  fun getBrightness(promise: Promise) {
    try {
      val value = Settings.System.getInt(context.contentResolver, Settings.System.SCREEN_BRIGHTNESS, -1)
      val mode = Settings.System.getInt(
        context.contentResolver,
        Settings.System.SCREEN_BRIGHTNESS_MODE,
        Settings.System.SCREEN_BRIGHTNESS_MODE_MANUAL
      )
      val map = Arguments.createMap()
      map.putInt("value", value)
      map.putBoolean("automatic", mode == Settings.System.SCREEN_BRIGHTNESS_MODE_AUTOMATIC)
      promise.resolve(map)
    } catch (e: Exception) { promise.reject("BRIGHTNESS_FAILED", e.message, e) }
  }

  @ReactMethod
  fun setBrightness(value: Double, promise: Promise) {
    val brightness = value.toInt()
    if (!value.isFinite() || brightness !in 0..255) {
      promise.reject("BRIGHTNESS_INVALID", "Brightness must be between 0 and 255")
      return
    }
    try {
      val result = runFixedRoot("settings", "put", "system", "screen_brightness", brightness.toString())
      if (result.exitCode != 0) throw IllegalStateException(result.stdout.ifBlank { "settings failed" })
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("BRIGHTNESS_SET_FAILED", e.message, e) }
  }

  @ReactMethod
  fun getProperty(name: String, promise: Promise) {
    if (!propertyAllowlist.contains(name)) {
      promise.reject("PROPERTY_DENIED", "Property is not allowlisted")
      return
    }
    promise.resolve(getProp(name))
  }

  @ReactMethod
  fun launchApp(packageName: String, promise: Promise) {
    if (!isValidPackage(packageName, promise)) return
    try {
      val launch = context.packageManager.getLaunchIntentForPackage(packageName)
        ?: throw IllegalArgumentException("No launch activity for package")
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(launch)
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("LAUNCH_FAILED", e.message, e) }
  }

  @ReactMethod
  fun forceStopApp(packageName: String, promise: Promise) {
    if (!isValidPackage(packageName, promise)) return
    try {
      val result = runFixedRoot("am", "force-stop", packageName)
      if (result.exitCode != 0) throw IllegalStateException(result.stdout.ifBlank { "am force-stop failed" })
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("FORCE_STOP_FAILED", e.message, e) }
  }

  @ReactMethod
  fun getPackageInfo(packageName: String, promise: Promise) {
    if (!isValidPackage(packageName, promise)) return
    try {
      val info = getPackageInfoCompat(packageName)
      val app = info.applicationInfo
      val map = Arguments.createMap()
      map.putString("packageName", packageName)
      map.putString("versionName", info.versionName ?: "")
      map.putDouble("versionCode", getVersionCode(info).toDouble())
      map.putBoolean("enabled", app?.enabled == true)
      map.putBoolean("systemApp", app != null && (app.flags and ApplicationInfo.FLAG_SYSTEM) != 0)
      map.putBoolean("launchable", context.packageManager.getLaunchIntentForPackage(packageName) != null)
      if (app != null) map.putString("label", context.packageManager.getApplicationLabel(app).toString())
      promise.resolve(map)
    } catch (e: Exception) { promise.reject("PACKAGE_INFO_FAILED", e.message, e) }
  }

  @ReactMethod
  fun listPackages(prefix: String?, promise: Promise) {
    try {
      val safePrefix = prefix?.takeIf { it.isNotBlank() && it.matches(Regex("^[a-zA-Z0-9_.-]{1,80}$")) }
      val packages = getInstalledPackagesCompat()
        .map { it.packageName }
        .filter { safePrefix == null || it.startsWith(safePrefix) }
        .sorted()
      val array = Arguments.createArray()
      packages.take(500).forEach(array::pushString)
      promise.resolve(array)
    } catch (e: Exception) { promise.reject("PACKAGES_FAILED", e.message, e) }
  }

  @ReactMethod
  fun tap(x: Double, y: Double, promise: Promise) {
    try {
      val safeX = checkedCoordinate(x, "x")
      val safeY = checkedCoordinate(y, "y")
      val result = runFixedRoot("input", "tap", safeX.toString(), safeY.toString())
      if (result.exitCode != 0) throw IllegalStateException(result.stdout.ifBlank { "input tap failed" })
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("TAP_FAILED", e.message, e) }
  }

  @ReactMethod
  fun swipe(x1: Double, y1: Double, x2: Double, y2: Double, durationMs: Double, promise: Promise) {
    try {
      val safeX1 = checkedCoordinate(x1, "x1")
      val safeY1 = checkedCoordinate(y1, "y1")
      val safeX2 = checkedCoordinate(x2, "x2")
      val safeY2 = checkedCoordinate(y2, "y2")
      val duration = durationMs.toInt()
      require(durationMs.isFinite() && duration in 1..10_000) { "durationMs must be between 1 and 10000" }
      val result = runFixedRoot(
        "input", "swipe",
        safeX1.toString(), safeY1.toString(), safeX2.toString(), safeY2.toString(), duration.toString()
      )
      if (result.exitCode != 0) throw IllegalStateException(result.stdout.ifBlank { "input swipe failed" })
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("SWIPE_FAILED", e.message, e) }
  }

  @ReactMethod
  fun keyEvent(action: String, promise: Promise) {
    val keyCode = keyEvents[action.uppercase()]
    if (keyCode == null) {
      promise.reject("KEY_INVALID", "Unsupported key action")
      return
    }
    try {
      val result = runFixedRoot("input", "keyevent", keyCode.toString())
      if (result.exitCode != 0) throw IllegalStateException(result.stdout.ifBlank { "input keyevent failed" })
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("KEY_FAILED", e.message, e) }
  }

  @ReactMethod
  fun reboot(target: String, confirmation: String, promise: Promise) {
    if (confirmation != "REBOOT") {
      promise.reject("REBOOT_CONFIRMATION_REQUIRED", "Pass confirmation=REBOOT after an explicit user request")
      return
    }
    val args = when (target.lowercase()) {
      "normal" -> arrayOf("reboot")
      "recovery" -> arrayOf("reboot", "recovery")
      "bootloader" -> arrayOf("reboot", "bootloader")
      else -> {
        promise.reject("REBOOT_TARGET_INVALID", "Use normal, recovery, or bootloader")
        return
      }
    }
    try {
      val result = runFixedRoot(*args)
      if (result.exitCode != 0 && result.exitCode != 124) {
        throw IllegalStateException(result.stdout.ifBlank { "reboot failed" })
      }
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("REBOOT_FAILED", e.message, e) }
  }

  private fun isValidPackage(packageName: String, promise: Promise): Boolean {
    if (!packagePattern.matches(packageName)) {
      promise.reject("PACKAGE_INVALID", "Invalid package name")
      return false
    }
    return true
  }

  private fun checkedCoordinate(value: Double, name: String): Int {
    require(value.isFinite()) { "$name must be finite" }
    val coordinate = value.toInt()
    require(coordinate in 0..20_000) { "$name must be between 0 and 20000" }
    return coordinate
  }

  private fun getProp(name: String): String {
    val result = runFixedRoot("getprop", name)
    return result.stdout.trim().take(1000)
  }

  @Suppress("DEPRECATION")
  private fun getInstalledPackagesCompat(): List<PackageInfo> =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.packageManager.getInstalledPackages(PackageManager.PackageInfoFlags.of(0))
    } else {
      context.packageManager.getInstalledPackages(0)
    }

  @Suppress("DEPRECATION")
  private fun getPackageInfoCompat(packageName: String): PackageInfo =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.packageManager.getPackageInfo(packageName, PackageManager.PackageInfoFlags.of(0))
    } else {
      context.packageManager.getPackageInfo(packageName, 0)
    }

  @Suppress("DEPRECATION")
  private fun getVersionCode(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) info.longVersionCode else info.versionCode.toLong()

  private data class CommandResult(val exitCode: Int, val stdout: String)

  private fun shellQuote(value: String): String = "'" + value.replace("'", "'\"'\"'") + "'"

  private fun runFixedRoot(vararg args: String): CommandResult {
    require(args.isNotEmpty()) { "Empty command" }
    val command = args.joinToString(" ") { shellQuote(it) }
    val process = ProcessBuilder("su", "-c", command)
      .redirectErrorStream(true)
      .start()
    val finished = process.waitFor(3, TimeUnit.SECONDS)
    if (!finished) {
      process.destroyForcibly()
      return CommandResult(124, "root command timed out")
    }
    val output = process.inputStream.bufferedReader().use { it.readText() }.take(4000)
    return CommandResult(process.exitValue(), output)
  }
}
