package com.gpglocal.app.ui

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

    companion object {
        /** Matches the desktop default mode. */
        val start = Encrypt
    }
}
