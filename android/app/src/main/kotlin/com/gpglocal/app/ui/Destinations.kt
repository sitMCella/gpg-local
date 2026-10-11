package com.gpglocal.app.ui

import android.net.Uri
import androidx.annotation.StringRes
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.ui.graphics.vector.ImageVector
import com.gpglocal.app.R

/** Top-level destinations shown in the bottom navigation bar. Order = bar order. */
enum class Destination(
    val route: String,
    @StringRes val label: Int,
    val icon: ImageVector,
) {
    Encrypt("encrypt", R.string.tab_encrypt, Icons.Outlined.Lock),
    Decrypt("decrypt", R.string.tab_decrypt, Icons.Outlined.LockOpen),
    ;

    /**
     * Route pattern registered in the NavHost, with an optional document URI handed over from the other
     * screen ("Decrypt it instead" / "Encrypt it instead"). The plain route still matches it.
     */
    val pattern: String get() = "$route?$ARG_URI={$ARG_URI}"

    /** Route that opens this destination with [uri] preselected. */
    fun routeWith(uri: Uri): String = "$route?$ARG_URI=${Uri.encode(uri.toString())}"

    companion object {
        /** Matches the desktop default mode. */
        val start = Encrypt

        /** Optional, URL-encoded document URI. Read by the ViewModels from their SavedStateHandle. */
        const val ARG_URI = "uri"
    }
}
