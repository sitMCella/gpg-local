package com.gpglocal.app.data

import android.content.ContentResolver
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileNotFoundException

/** A document the user chose through the Storage Access Framework. */
data class PickedDocument(
    val uri: Uri,
    val displayName: String,
    /** null when the provider does not report it. */
    val sizeBytes: Long?,
)

/** SAF access, as an interface so ViewModels can be tested with a fake. */
interface DocumentStore {
    suspend fun describe(uri: Uri): PickedDocument

    suspend fun openForRead(uri: Uri): ParcelFileDescriptor

    suspend fun openForWrite(uri: Uri): ParcelFileDescriptor

    /** Best-effort removal of a partially written output. Returns false if the provider refused. */
    suspend fun delete(uri: Uri): Boolean
}

/** The only class that touches [ContentResolver]. Every call runs on [io]. */
class DocumentRepository(
    private val resolver: ContentResolver,
    private val io: CoroutineDispatcher,
) : DocumentStore {
    override suspend fun describe(uri: Uri): PickedDocument = withContext(io) {
        val fallbackName = uri.lastPathSegment ?: "file"
        // Some providers throw instead of returning null; the name then falls back to the URI.
        runCatching {
            resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
                ?.use { c ->
                    if (c.moveToFirst()) {
                        PickedDocument(
                            uri = uri,
                            displayName = c.getString(0) ?: fallbackName,
                            sizeBytes = if (c.isNull(1)) null else c.getLong(1),
                        )
                    } else {
                        null
                    }
                }
        }.getOrNull() ?: PickedDocument(uri, fallbackName, null)
    }

    override suspend fun openForRead(uri: Uri): ParcelFileDescriptor = withContext(io) {
        resolver.openFileDescriptor(uri, "r") ?: throw FileNotFoundException("Cannot open $uri")
    }

    /** "wt" = write + truncate, so a reused document never keeps stale trailing bytes. */
    override suspend fun openForWrite(uri: Uri): ParcelFileDescriptor = withContext(io) {
        resolver.openFileDescriptor(uri, "wt") ?: throw FileNotFoundException("Cannot open $uri")
    }

    // The file:// branch exists only so instrumented tests can use plain temp files.
    override suspend fun delete(uri: Uri): Boolean = withContext(io) {
        runCatching {
            if (uri.scheme == ContentResolver.SCHEME_FILE) {
                File(requireNotNull(uri.path)).delete()
            } else {
                DocumentsContract.deleteDocument(resolver, uri)
            }
        }.getOrDefault(false)
    }
}
