package com.pocketpal

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.os.Build
import android.os.Bundle
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.module.annotations.ReactModule
import org.json.JSONObject
import java.util.Calendar

/**
 * Native wake/scheduling surface for unattended Root Agent tasks.
 *
 * The native layer intentionally stores only schedule metadata (id, title,
 * trigger, repeat flag). Prompts, model ids and results stay in the JS
 * ScheduledAgentStore. Alarm delivery starts a foreground Headless-JS service;
 * the JS runner then restores the saved API model and runs the normal AgentRunner.
 */
@ReactModule(name = ScheduledAgentModule.NAME)
class ScheduledAgentModule(private val context: ReactApplicationContext) :
  ReactContextBaseJavaModule(context) {

  companion object {
    const val NAME = "ScheduledAgent"
  }

  override fun getName(): String = NAME

  @ReactMethod
  fun getStatus(promise: Promise) {
    try {
      val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
      val exactAllowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarm.canScheduleExactAlarms()
      val map = Arguments.createMap()
      map.putBoolean("exactAlarmAllowed", exactAllowed)
      map.putBoolean(
        "notificationsEnabled",
        NotificationManagerCompat.from(context).areNotificationsEnabled(),
      )
      map.putInt("nativeScheduleCount", ScheduledAgentNativeStore.list(context).length())
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("SCHEDULE_STATUS_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun scheduleTask(
    taskId: String,
    title: String,
    triggerAtMs: Double,
    repeatDaily: Boolean,
    promise: Promise,
  ) {
    try {
      val safeId = ScheduledAgentNativeStore.requireTaskId(taskId)
      val safeTitle = ScheduledAgentNativeStore.cleanTitle(title)
      val trigger = triggerAtMs.toLong()
      require(trigger > 0L) { "triggerAtMs must be positive" }

      ScheduledAgentNativeStore.upsert(
        context,
        safeId,
        safeTitle,
        trigger,
        repeatDaily,
      )
      val exact = ScheduledAgentAlarmScheduler.schedule(
        context,
        safeId,
        safeTitle,
        trigger,
        repeatDaily,
      )
      val map = Arguments.createMap()
      map.putBoolean("scheduled", true)
      map.putBoolean("exact", exact)
      map.putDouble("triggerAtMs", trigger.toDouble())
      map.putBoolean("repeatDaily", repeatDaily)
      promise.resolve(map)
    } catch (e: Exception) {
      promise.reject("SCHEDULE_CREATE_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun cancelTask(taskId: String, promise: Promise) {
    try {
      val safeId = ScheduledAgentNativeStore.requireTaskId(taskId)
      ScheduledAgentAlarmScheduler.cancel(context, safeId)
      ScheduledAgentNativeStore.remove(context, safeId)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SCHEDULE_CANCEL_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun triggerNow(taskId: String, title: String, promise: Promise) {
    try {
      val safeId = ScheduledAgentNativeStore.requireTaskId(taskId)
      val safeTitle = ScheduledAgentNativeStore.cleanTitle(title)
      ScheduledAgentRuntimeStarter.start(context, safeId, safeTitle)
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SCHEDULE_RUN_NOW_FAILED", e.message, e)
    }
  }

  @ReactMethod
  fun notifyResult(taskId: String, title: String, success: Boolean, promise: Promise) {
    try {
      ScheduledAgentNotifications.showResult(
        context,
        ScheduledAgentNativeStore.requireTaskId(taskId),
        ScheduledAgentNativeStore.cleanTitle(title),
        success,
      )
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("SCHEDULE_NOTIFY_FAILED", e.message, e)
    }
  }
}

private object ScheduledAgentNativeStore {
  private const val PREFS = "root_agent_scheduled_agents_native"
  private const val KEY = "schedules_json"
  private val idPattern = Regex("^[A-Za-z0-9_.:-]{1,120}$")

  data class Entry(
    val id: String,
    val title: String,
    val triggerAtMs: Long,
    val repeatDaily: Boolean,
  )

  fun requireTaskId(value: String): String {
    val id = value.trim()
    require(idPattern.matches(id)) { "invalid scheduled task id" }
    return id
  }

  fun cleanTitle(value: String): String =
    value.replace("\u0000", "").trim().ifBlank { "Scheduled Root Agent task" }.take(120)

  @Synchronized
  fun upsert(context: Context, id: String, title: String, triggerAtMs: Long, repeatDaily: Boolean) {
    val root = read(context)
    root.put(
      id,
      JSONObject()
        .put("title", title)
        .put("triggerAtMs", triggerAtMs)
        .put("repeatDaily", repeatDaily),
    )
    write(context, root)
  }

  @Synchronized
  fun remove(context: Context, id: String) {
    val root = read(context)
    root.remove(id)
    write(context, root)
  }

  @Synchronized
  fun get(context: Context, id: String): Entry? {
    val raw = read(context).optJSONObject(id) ?: return null
    return Entry(
      id = id,
      title = cleanTitle(raw.optString("title", "Scheduled Root Agent task")),
      triggerAtMs = raw.optLong("triggerAtMs", 0L),
      repeatDaily = raw.optBoolean("repeatDaily", false),
    )
  }

  @Synchronized
  fun list(context: Context): JSONObject = read(context)

  private fun prefs(context: Context): SharedPreferences =
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  private fun read(context: Context): JSONObject = try {
    JSONObject(prefs(context).getString(KEY, "{}") ?: "{}")
  } catch (_: Exception) {
    JSONObject()
  }

  private fun write(context: Context, value: JSONObject) {
    prefs(context).edit().putString(KEY, value.toString()).apply()
  }
}

private object ScheduledAgentAlarmScheduler {
  private const val ACTION = "com.mikhail.pocketpalrootagent.SCHEDULED_AGENT_ALARM"

  fun schedule(
    context: Context,
    taskId: String,
    title: String,
    requestedTriggerAtMs: Long,
    repeatDaily: Boolean,
  ): Boolean {
    val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val triggerAtMs = requestedTriggerAtMs.coerceAtLeast(System.currentTimeMillis() + 1_000L)
    val pending = pendingIntent(context, taskId, title, repeatDaily)
    val exactAllowed = Build.VERSION.SDK_INT < Build.VERSION_CODES.S || alarm.canScheduleExactAlarms()
    if (exactAllowed) {
      alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pending)
    } else {
      // No special exact-alarm access: still deliver while idle, but Android may
      // move the wake within its battery-friendly inexact window.
      alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAtMs, pending)
    }
    return exactAllowed
  }

  fun cancel(context: Context, taskId: String) {
    val alarm = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
    val existing = PendingIntent.getBroadcast(
      context,
      requestCode(taskId),
      Intent(context, ScheduledAgentAlarmReceiver::class.java).setAction(ACTION),
      PendingIntent.FLAG_NO_CREATE or immutableFlag(),
    )
    if (existing != null) {
      alarm.cancel(existing)
      existing.cancel()
    }
  }

  fun nextDailyTrigger(previous: Long): Long {
    val source = Calendar.getInstance().apply { timeInMillis = previous }
    val hour = source.get(Calendar.HOUR_OF_DAY)
    val minute = source.get(Calendar.MINUTE)
    val second = source.get(Calendar.SECOND)
    val next = Calendar.getInstance().apply {
      set(Calendar.HOUR_OF_DAY, hour)
      set(Calendar.MINUTE, minute)
      set(Calendar.SECOND, second)
      set(Calendar.MILLISECOND, 0)
      if (timeInMillis <= System.currentTimeMillis() + 1_000L) {
        add(Calendar.DAY_OF_YEAR, 1)
      }
    }
    return next.timeInMillis
  }

  private fun pendingIntent(
    context: Context,
    taskId: String,
    title: String,
    repeatDaily: Boolean,
  ): PendingIntent {
    val intent = Intent(context, ScheduledAgentAlarmReceiver::class.java).apply {
      action = ACTION
      putExtra("taskId", taskId)
      putExtra("title", title)
      putExtra("repeatDaily", repeatDaily)
    }
    return PendingIntent.getBroadcast(
      context,
      requestCode(taskId),
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or immutableFlag(),
    )
  }

  private fun requestCode(taskId: String): Int = taskId.hashCode() and 0x7fffffff

  private fun immutableFlag(): Int =
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0
}

class ScheduledAgentAlarmReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val taskId = intent?.getStringExtra("taskId") ?: return
    val entry = ScheduledAgentNativeStore.get(context, taskId) ?: return

    if (entry.repeatDaily) {
      val next = ScheduledAgentAlarmScheduler.nextDailyTrigger(entry.triggerAtMs)
      ScheduledAgentNativeStore.upsert(context, entry.id, entry.title, next, true)
      ScheduledAgentAlarmScheduler.schedule(context, entry.id, entry.title, next, true)
    } else {
      ScheduledAgentNativeStore.remove(context, entry.id)
    }

    ScheduledAgentRuntimeStarter.start(context, entry.id, entry.title)
  }
}

class ScheduledAgentBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action != Intent.ACTION_BOOT_COMPLETED && action != Intent.ACTION_MY_PACKAGE_REPLACED) return

    val root = ScheduledAgentNativeStore.list(context)
    val ids = root.keys()
    while (ids.hasNext()) {
      val id = ids.next()
      val entry = ScheduledAgentNativeStore.get(context, id) ?: continue
      val next = if (entry.repeatDaily) {
        ScheduledAgentAlarmScheduler.nextDailyTrigger(entry.triggerAtMs)
      } else {
        entry.triggerAtMs.coerceAtLeast(System.currentTimeMillis() + 10_000L)
      }
      ScheduledAgentNativeStore.upsert(context, entry.id, entry.title, next, entry.repeatDaily)
      ScheduledAgentAlarmScheduler.schedule(context, entry.id, entry.title, next, entry.repeatDaily)
    }
  }
}

private object ScheduledAgentRuntimeStarter {
  fun start(context: Context, taskId: String, title: String) {
    val service = Intent(context, ScheduledAgentHeadlessService::class.java).apply {
      putExtra("taskId", taskId)
      putExtra("title", title)
      putExtra("triggeredAt", System.currentTimeMillis().toDouble())
    }
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ContextCompat.startForegroundService(context, service)
      } else {
        context.startService(service)
      }
      HeadlessJsTaskService.acquireWakeLockNow(context)
    } catch (error: Exception) {
      // Android may exceptionally refuse a background FGS start. Preserve a
      // visible recovery path rather than silently dropping the scheduled run.
      ScheduledAgentNotifications.showDeferred(context, taskId, title)
      android.util.Log.e("ScheduledAgent", "Could not start scheduled task $taskId", error)
    }
  }
}

class ScheduledAgentHeadlessService : HeadlessJsTaskService() {
  override fun onCreate() {
    super.onCreate()
    ScheduledAgentNotifications.ensureChannel(this)
    startForeground(
      ScheduledAgentNotifications.RUNNING_NOTIFICATION_ID,
      ScheduledAgentNotifications.runningNotification(this),
    )
  }

  override fun getTaskConfig(intent: Intent?): HeadlessJsTaskConfig? {
    val extras = intent?.extras ?: Bundle()
    val taskId = extras.getString("taskId") ?: return null
    return HeadlessJsTaskConfig(
      "RootAgentScheduledTask",
      Arguments.fromBundle(extras),
      15 * 60 * 1000L,
      true,
    )
  }

  override fun onDestroy() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(Service.STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }
}

private object ScheduledAgentNotifications {
  const val RUNNING_NOTIFICATION_ID = 73120
  private const val CHANNEL_ID = "root_agent_scheduled"

  fun ensureChannel(context: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Root Agent scheduled tasks",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Background execution status for scheduled Root Agent tasks"
        setShowBadge(false)
      }
      manager.createNotificationChannel(channel)
    }
  }

  fun runningNotification(context: Context): android.app.Notification {
    ensureChannel(context)
    return NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle("Root Agent")
      .setContentText("Выполняется запланированная задача")
      .setOngoing(true)
      .setPriority(NotificationCompat.PRIORITY_LOW)
      .setContentIntent(openAppIntent(context, 73120))
      .build()
  }

  fun showResult(context: Context, taskId: String, title: String, success: Boolean) {
    ensureChannel(context)
    val text = if (success) "Запланированная задача завершена" else "Запланированная задача завершилась с ошибкой"
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(title)
      .setContentText(text)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_DEFAULT)
      .setContentIntent(openAppIntent(context, taskId.hashCode()))
      .build()
    NotificationManagerCompat.from(context).notify(taskId.hashCode() and 0x7fffffff, notification)
  }

  fun showDeferred(context: Context, taskId: String, title: String) {
    ensureChannel(context)
    val notification = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(title)
      .setContentText("Android не разрешил фоновый запуск. Открой Root Agent, чтобы продолжить.")
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setContentIntent(openAppIntent(context, taskId.hashCode()))
      .build()
    NotificationManagerCompat.from(context).notify((taskId.hashCode() xor 0x5a5a) and 0x7fffffff, notification)
  }

  private fun openAppIntent(context: Context, requestCode: Int): PendingIntent? {
    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
    launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    return PendingIntent.getActivity(
      context,
      requestCode and 0x7fffffff,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0,
    )
  }
}
