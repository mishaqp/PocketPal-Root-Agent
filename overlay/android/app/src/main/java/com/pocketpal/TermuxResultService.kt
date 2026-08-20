package com.pocketpal

import android.app.IntentService
import android.content.Intent

/** Receives one-shot command results returned by Termux/ZeroTermux. */
@Suppress("DEPRECATION")
class TermuxResultService : IntentService("TermuxResultService") {
  companion object {
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
      TermuxCommandBroker.fail(executionId, "Termux returned no result bundle")
      return
    }
    TermuxCommandBroker.complete(
      executionId = executionId,
      stdout = result.getString(EXTRA_STDOUT).orEmpty(),
      stderr = result.getString(EXTRA_STDERR).orEmpty(),
      exitCode = result.getInt(EXTRA_EXIT_CODE, -1),
      err = result.getInt(EXTRA_ERR, -1),
      errMsg = result.getString(EXTRA_ERRMSG).orEmpty(),
      stdoutOriginalLength = result.getInt(EXTRA_STDOUT_ORIGINAL_LENGTH, 0),
      stderrOriginalLength = result.getInt(EXTRA_STDERR_ORIGINAL_LENGTH, 0),
    )
  }
}
