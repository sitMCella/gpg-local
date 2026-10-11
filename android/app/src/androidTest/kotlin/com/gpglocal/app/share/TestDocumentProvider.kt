package com.gpglocal.app.share

import android.content.ContentProvider
import android.content.ContentResolver
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.MatrixCursor
import android.net.Uri
import android.os.Bundle
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import java.io.FileNotFoundException
import java.util.concurrent.ConcurrentHashMap
import kotlin.concurrent.thread

/**
 * Read-only, in-memory document provider for share tests. Documents are added through [put] and served
 * through a pipe, so the app streams them exactly as from a real provider. Names starting with
 * `slow-` delay the first byte, to keep an operation running long enough to observe its loading state.
 */
class TestDocumentProvider : ContentProvider() {

    override fun onCreate() = true

    override fun call(method: String, arg: String?, extras: Bundle?): Bundle? {
        when (method) {
            METHOD_PUT -> documents[requireNotNull(arg)] = requireNotNull(extras?.getByteArray(EXTRA_BYTES))
            METHOD_CLEAR -> documents.clear()
        }
        return null
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor {
        val name = nameOf(uri)
        val bytes = documents[name] ?: throw FileNotFoundException(name)
        val columns = projection ?: arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE)
        return MatrixCursor(columns).apply {
            addRow(columns.map { if (it == OpenableColumns.SIZE) bytes.size.toLong() else name }.toTypedArray())
        }
    }

    override fun openFile(uri: Uri, mode: String): ParcelFileDescriptor {
        if (mode != "r") throw SecurityException("read-only provider")
        val name = nameOf(uri)
        val bytes = documents[name] ?: throw FileNotFoundException(name)
        val (read, write) = ParcelFileDescriptor.createPipe()
        thread(name = "test-document-$name") {
            if (name.startsWith(SLOW_PREFIX)) Thread.sleep(SLOW_DELAY_MS)
            ParcelFileDescriptor.AutoCloseOutputStream(write).use { it.write(bytes) }
        }
        return read
    }

    override fun getType(uri: Uri): String = "application/octet-stream"

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0

    private fun nameOf(uri: Uri) = requireNotNull(uri.lastPathSegment)

    companion object {
        const val AUTHORITY = "com.gpglocal.app.test.documents"
        const val SLOW_PREFIX = "slow-"
        const val SLOW_DELAY_MS = 3_000L
        private const val METHOD_PUT = "put"
        private const val METHOD_CLEAR = "clear"
        private const val EXTRA_BYTES = "bytes"

        // The provider may run in the test package's own process; documents are added through call().
        private val documents = ConcurrentHashMap<String, ByteArray>()

        fun uriFor(name: String): Uri = Uri.Builder()
            .scheme(ContentResolver.SCHEME_CONTENT)
            .authority(AUTHORITY)
            .appendPath(name)
            .build()

        fun put(context: Context, name: String, bytes: ByteArray): Uri {
            val uri = uriFor(name)
            context.contentResolver.call(uri, METHOD_PUT, name, Bundle().apply { putByteArray(EXTRA_BYTES, bytes) })
            return uri
        }

        fun clear(context: Context) {
            context.contentResolver.call(uriFor("_"), METHOD_CLEAR, null, null)
        }
    }
}
