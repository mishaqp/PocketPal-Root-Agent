package com.pocketpal

import android.content.Intent
import android.content.pm.PackageManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.module.annotations.ReactModule
import java.util.concurrent.TimeUnit

/**
 * Narrow Android bridge for PocketPal Root Agent.
 *
 * Deliberately does not expose arbitrary shell execution. The only privileged
 * commands are fixed below and every package/property argument is validated.
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
      map.putString("model", android.os.Build.MODEL)
      map.putString("manufacturer", android.os.Build.MANUFACTURER)
      map.putString("android", android.os.Build.VERSION.RELEASE)
      map.putString("securityPatch", android.os.Build.VERSION.SECURITY_PATCH)
      map.putString("fingerprint", android.os.Build.FINGERPRINT)
      map.putString("verifiedBoot", getProp("ro.boot.verifiedbootstate"))
      map.putString("bootloaderState", getProp("ro.boot.vbmeta.device_state"))
      promise.resolve(map)
    } catch (e: Exception) { promise.reject("ANDROID_INFO", e.message, e) }
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
    if (!packagePattern.matches(packageName)) {
      promise.reject("PACKAGE_INVALID", "Invalid package name")
      return
    }
    try {
      val launch = context.packageManager.getLaunchIntentForPackage(packageName)
        ?: throw IllegalArgumentException("No launch activity for package")
      launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(launch)
      promise.resolve(true)
    } catch (e: Exception) { promise.reject("LAUNCH_FAILED", e.message, e) }
  }

  @ReactMethod
  fun listPackages(prefix: String?, promise: Promise) {
    try {
      val safePrefix = prefix?.takeIf { it.isNotBlank() && it.matches(Regex("^[a-zA-Z0-9_.-]{1,80}$")) }
      val packages = context.packageManager.getInstalledPackages(PackageManager.PackageInfoFlags.of(0))
        .map { it.packageName }
        .filter { safePrefix == null || it.startsWith(safePrefix) }
        .sorted()
      val array = Arguments.createArray()
      packages.take(500).forEach(array::pushString)
      promise.resolve(array)
    } catch (e: Exception) { promise.reject("PACKAGES_FAILED", e.message, e) }
  }

  private fun getProp(name: String): String {
    val result = runFixedRoot("getprop", name)
    return result.stdout.trim().take(1000)
  }

  private data class CommandResult(val exitCode: Int, val stdout: String)

  private fun runFixedRoot(vararg args: String): CommandResult {
    // The caller can only reach this helper through fixed call sites and the
    // property argument is checked against propertyAllowlist before use.
    val process = ProcessBuilder("su", "-c", args.joinToString(" "))
      .redirectErrorStream(true).start()
    val output = process.inputStream.bufferedReader().use { it.readText() }.take(4000)
    val finished = process.waitFor(3, TimeUnit.SECONDS)
    if (!finished) {
      process.destroyForcibly()
      return CommandResult(124, "root command timed out")
    }
    return CommandResult(process.exitValue(), output)
  }
}
