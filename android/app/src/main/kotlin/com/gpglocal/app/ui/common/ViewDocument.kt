package com.gpglocal.app.ui.common

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * Hands [uri] to a viewer app with a one-time read grant; the app itself never reads the content.
 * Returns false when no installed app can open [mimeType].
 */
fun Context.viewDocument(uri: Uri, mimeType: String): Boolean {
    val view = Intent(Intent.ACTION_VIEW)
        .setDataAndType(uri, mimeType)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    return try {
        startActivity(view)
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}
