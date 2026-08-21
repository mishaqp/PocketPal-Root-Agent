package com.pocketpal

import android.app.IntentService
import android.content.Intent
import android.os.Bundle
import android.util.Log

/** Receives one-shot command results returned by Termux/ZeroTermux. */
@Suppress("DEPRECATION")
class TermuxResultService : IntentService("TermuxResultService") {
  companion object {
    private const val TAG = "TermuxResultService"
    const val EXTRA_EXECUTION_ID = "pocketpal_execution_id"
    private const val EXTRA_RESULT_BUNDLE = "result"
    private const val EXTRA_STDOUT = "stdout"
    private const val EXTRA_STDERR = "stderr"
    private const val EXTRA_EXIT_CODE = "exitCode"
    private const val EXTRA_ERR = "err"
    private const val EXTRA_ERRMSG = "errmsg"
    private const val EXTRA_STDOUT_ORIGINAL_LENGTH = "stdout_original_length"
    private const val EXTRA_STDERR_ORIGINAL_LENGTH = "stderr_original_length"
  }

  override fun onHandleIntent(intent: Intent?) {
    if (intent == null) return
    val executionId = intent.getIntExtra(EXTRA_EXECUTION_ID, -1)
    if (executionId < 0) return
    val result = intent.getBundleExtra(EXTRA_RESULT_BUNDLE)
    if (result == null) {
      Log.w(TAG, "executionId=$executionId returned no result bundle")
      TermuxCommandBroker.fail(executionId, "Termux returned no result bundle")
      return
    }

    // ZeroTermux/Termux forks do not all use identical Bundle types for these
    // metadata fields. In particular, stdout_original_length and
    // stderr_original_length may arrive as decimal strings. Reading them with
    // Bundle.getInt() produces noisy ClassCastException warnings and loses the
    // real length. Parse Number/String values explicitly instead.
    val stdout = bundleString(result, EXTRA_STDOUT)
    val stderr = bundleString(result, EXTRA_STDERR)
    val exitCode = bundleInt(result, EXTRA_EXIT_CODE, -1)
    val err = bundleInt(result, EXTRA_ERR, -1)
    val errMsg = bundleString(result, EXTRA_ERRMSG)
    val stdoutOriginalLength = bundleInt(result, EXTRA_STDOUT_ORIGINAL_LENGTH, stdout.length)
    val stderrOriginalLength = bundleInt(result, EXTRA_STDERR_ORIGINAL_LENGTH, stderr.length)

    Log.i(
      TAG,
      "executionId=$executionId exitCode=$exitCode err=$err stdoutLength=$stdoutOriginalLength stderrLength=$stderrOriginalLength",
    )
    TermuxCommandBroker.complete(
      executionId = executionId,
      stdout = stdout,
      stderr = stderr,
      exitCode = exitCode,
      err = err,
      errMsg = errMsg,
      stdoutOriginalLength = stdoutOriginalLength,
      stderrOriginalLength = stderrOriginalLength,
    )
  }

  private fun bundleInt(bundle: Bundle, key: String, defaultValue: Int): Int {
    return when (val value = bundle.get(key)) {
      is Number -> value.toInt()
      is String -> value.trim().toIntOrNull() ?: defaultValue
      else -> defaultValue
    }
  }

  private fun bundleString(bundle: Bundle, key: String): String {
    return when (val value = bundle.get(key)) {
      null -> ""
      is String -> value
      else -> value.toString()
    }
  }
}
