package com.gpglocal.app.share

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import com.gpglocal.app.data.DocumentStore
import com.gpglocal.app.ui.encrypt.isEncryptedName

/** The outcome of reading an external `SEND` / `VIEW` intent. */
sealed interface IncomingFile {
    data class Accepted(val uri: Uri) : IncomingFile

    data class Rejected(val reason: Reason) : IncomingFile

    enum class Reason {
        NoFile,
        MultipleFiles,
        UnsupportedScheme,
        OwnAppUri,

        /** The provider could not describe the file. Set by [ShareViewModel] while routing, never by the parser. */
        Unreadable,
    }
}

/**
 * The only place that interprets external intents. ShareActivity is exported, so every input is untrusted:
 * only `content://` URIs are accepted, and never one served by GPG Local itself. A `file://` URI could
 * point into the app's private storage (e.g. `files/keyring/`), and encrypting and saving it would export
 * the secret keyring on another app's behalf.
 *
 * @param ownAuthorities authorities of the providers this app declares.
 */
class IncomingFileParser(private val ownAuthorities: Set<String>) {
    fun parse(action: String?, data: Uri?, stream: Uri?, clipUris: List<Uri>): IncomingFile {
        val uri = when (action) {
            Intent.ACTION_SEND -> stream ?: clipUris.singleOrNull()
                ?: return IncomingFile.Rejected(
                    if (clipUris.size > 1) IncomingFile.Reason.MultipleFiles else IncomingFile.Reason.NoFile,
                )
            Intent.ACTION_VIEW -> data ?: return IncomingFile.Rejected(IncomingFile.Reason.NoFile)
            else -> return IncomingFile.Rejected(IncomingFile.Reason.NoFile)
        }
        if (uri.scheme != ContentResolver.SCHEME_CONTENT) {
            return IncomingFile.Rejected(IncomingFile.Reason.UnsupportedScheme)
        }
        if (uri.authority in ownAuthorities) return IncomingFile.Rejected(IncomingFile.Reason.OwnAppUri)
        return IncomingFile.Accepted(uri)
    }
}

enum class ShareFlow { Encrypt, Decrypt }

/**
 * `.gpg` / `.pgp` files open the Decrypt flow, everything else Encrypt. The name comes from the provider
 * (`DISPLAY_NAME`), never from the URI path.
 */
suspend fun route(uri: Uri, documents: DocumentStore): ShareFlow =
    if (isEncryptedName(documents.describe(uri).displayName)) ShareFlow.Decrypt else ShareFlow.Encrypt
