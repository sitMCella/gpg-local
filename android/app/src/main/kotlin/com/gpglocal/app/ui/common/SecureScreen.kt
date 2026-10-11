package com.gpglocal.app.ui.common

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.view.Window
import android.view.WindowManager
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.platform.LocalContext
import java.util.WeakHashMap

/**
 * Sets FLAG_SECURE on the activity window while the calling composable is shown, so screenshots,
 * screen recording and the recent-apps thumbnail cannot capture a revealed passphrase.
 *
 * Reference-counted per window: while switching tabs both screens are briefly composed, and the leaving
 * screen must not clear the flag the entering one has just set.
 */
@Composable
fun SecureScreen() {
    val activity = LocalContext.current.findActivity() ?: return
    DisposableEffect(activity) {
        val window = activity.window
        SecureWindows.acquire(window)
        onDispose { SecureWindows.release(window) }
    }
}

/** Main-thread only, like all composition effects. */
private object SecureWindows {
    private val holders = WeakHashMap<Window, Int>()

    fun acquire(window: Window) {
        val count = holders[window] ?: 0
        if (count == 0) window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        holders[window] = count + 1
    }

    fun release(window: Window) {
        val count = (holders[window] ?: 1) - 1
        if (count <= 0) {
            holders.remove(window)
            window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
        } else {
            holders[window] = count
        }
    }
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}
