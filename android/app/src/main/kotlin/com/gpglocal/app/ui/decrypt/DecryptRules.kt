package com.gpglocal.app.ui.decrypt

import android.webkit.MimeTypeMap

// Naming rules, identical to desktop feature 05 (src/utils/decryptedOutputPath.ts).

/**
 * `report.md.gpg` → `report.md`, `archive.pgp` → `archive`, anything else → `<name>.decrypted`.
 * A bare `.gpg` also falls back, so the suggested name is never empty.
 */
fun decryptedOutputName(inputName: String): String {
    val lower = inputName.lowercase()
    return if ((lower.endsWith(".gpg") || lower.endsWith(".pgp")) && inputName.length > 4) {
        inputName.dropLast(4)
    } else {
        "$inputName.decrypted"
    }
}

/**
 * MIME type for the save picker and the Open action, derived from the output name's extension.
 * [lookup] defaults to Android's MimeTypeMap; JVM unit tests pass a fake.
 */
fun mimeTypeFor(
    outputName: String,
    lookup: (String) -> String? = { MimeTypeMap.getSingleton().getMimeTypeFromExtension(it) },
): String =
    outputName.substringAfterLast('.', "").lowercase()
        .takeIf { it.isNotEmpty() }
        ?.let(lookup)
        ?: "application/octet-stream"
