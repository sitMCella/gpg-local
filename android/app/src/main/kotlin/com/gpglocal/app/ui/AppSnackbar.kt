package com.gpglocal.app.ui

import androidx.compose.material3.SnackbarDuration
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.SnackbarResult
import androidx.compose.runtime.staticCompositionLocalOf
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

/**
 * Shows snackbars in the app Scaffold. The coroutine runs in the shell's scope, not the screen's,
 * so a snackbar stays visible when the user switches tabs.
 */
class AppSnackbar(val hostState: SnackbarHostState, private val scope: CoroutineScope) {
    fun show(message: String) {
        scope.launch { hostState.showSnackbar(message) }
    }

    /** Long snackbar with one action; [onAction] runs in the shell's scope when the user taps it. */
    fun show(message: String, actionLabel: String, onAction: suspend () -> Unit) {
        scope.launch {
            val result = hostState.showSnackbar(
                message = message,
                actionLabel = actionLabel,
                duration = SnackbarDuration.Long,
            )
            if (result == SnackbarResult.ActionPerformed) onAction()
        }
    }
}

val LocalAppSnackbar = staticCompositionLocalOf<AppSnackbar> { error("No AppSnackbar provided") }
