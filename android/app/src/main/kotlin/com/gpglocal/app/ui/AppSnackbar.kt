package com.gpglocal.app.ui

import androidx.compose.material3.SnackbarHostState
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
}

val LocalAppSnackbar = staticCompositionLocalOf<AppSnackbar> { error("No AppSnackbar provided") }
