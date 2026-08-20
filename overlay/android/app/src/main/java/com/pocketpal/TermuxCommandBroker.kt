package com.pocketpal

import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/** Keeps React Native promises associated with one-shot Termux result intents. */
object TermuxCommandBroker {
  private data class PendingCommand(
    val promise: Promise,
    val timeoutRunnable: Runnable,
  )

  private val nextId = AtomicInteger(10_000)
  private val mainHandler = Handler(Looper.getMainLooper())
  private val pending = ConcurrentHashMap<Int, PendingCommand>()

  fun nextExecutionId(): Int {
    val value = nextId.incrementAndGet()
    if (value < 0) nextId.set(10_000)
    return value
  }

  fun register(executionId: Int, promise: Promise, timeoutMs: Long) {
    val timeout = Runnable {
      val command = pending.remove(executionId) ?: return@Runnable
      command.promise.reject(
        "TERMUX_TIMEOUT",
        "Timed out waiting for Termux result after ${timeoutMs}ms. The command may still be running in Termux.",
      )
    }
    pending[executionId] = PendingCommand(promise, timeout)
    mainHandler.postDelayed(timeout, timeoutMs)
  }

  fun complete(
    executionId: Int,
    stdout: String,
    stderr: String,
    exitCode: Int,
    err: Int,
    errMsg: String,
    stdoutOriginalLength: Int,
    stderrOriginalLength: Int,
  ) {
    val command = pending.remove(executionId) ?: return
    mainHandler.removeCallbacks(command.timeoutRunnable)
    mainHandler.post {
      val map = Arguments.createMap()
      map.putInt("executionId", executionId)
      map.putString("stdout", stdout)
      map.putString("stderr", stderr)
      map.putInt("exitCode", exitCode)
      map.putInt("termuxError", err)
      map.putString("termuxErrorMessage", errMsg)
      map.putInt("stdoutOriginalLength", stdoutOriginalLength)
      map.putInt("stderrOriginalLength", stderrOriginalLength)
      map.putBoolean(
        "truncated",
        stdoutOriginalLength > stdout.length || stderrOriginalLength > stderr.length,
      )
      command.promise.resolve(map)
    }
  }

  fun fail(executionId: Int, message: String) {
    val command = pending.remove(executionId) ?: return
    mainHandler.removeCallbacks(command.timeoutRunnable)
    mainHandler.post {
      command.promise.reject("TERMUX_RUN_FAILED", message)
    }
  }
}
