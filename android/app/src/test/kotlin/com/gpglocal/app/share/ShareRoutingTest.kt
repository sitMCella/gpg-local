package com.gpglocal.app.share

import android.app.Application
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.gpglocal.app.data.DocumentStore
import com.gpglocal.app.data.PickedDocument
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ShareRoutingTest {

    private val uri = Uri.parse("content://com.example.files/doc/42")

    /** The provider's display name decides the route; the URI path ("42") never does. */
    private class NamedDocuments(private val name: String) : DocumentStore {
        override suspend fun describe(uri: Uri) = PickedDocument(uri, name, null)
        override suspend fun openForRead(uri: Uri): ParcelFileDescriptor = error("routing must not read")
        override suspend fun openForWrite(uri: Uri): ParcelFileDescriptor = error("routing must not write")
        override suspend fun delete(uri: Uri): Boolean = error("routing must not delete")
    }

    private suspend fun routeFor(name: String) = route(uri, NamedDocuments(name))

    @Test
    fun encryptedNamesRouteToDecrypt() = runTest {
        assertEquals(ShareFlow.Decrypt, routeFor("secret.gpg"))
        assertEquals(ShareFlow.Decrypt, routeFor("SECRET.PGP"))
    }

    @Test
    fun otherNamesRouteToEncrypt() = runTest {
        assertEquals(ShareFlow.Encrypt, routeFor("photo.jpg"))
        assertEquals(ShareFlow.Encrypt, routeFor("noext"))
        // DocumentRepository falls back to the last path segment when the provider reports no name.
        assertEquals(ShareFlow.Encrypt, routeFor(uri.lastPathSegment!!))
    }
}
