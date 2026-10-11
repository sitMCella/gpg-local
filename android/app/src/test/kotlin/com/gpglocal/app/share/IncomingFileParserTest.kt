package com.gpglocal.app.share

import android.app.Application
import android.content.Intent
import android.net.Uri
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class IncomingFileParserTest {

    private val parser = IncomingFileParser(ownAuthorities = setOf("com.gpglocal.app.androidx-startup"))
    private val content = Uri.parse("content://com.example.files/doc/report.md")
    private val other = Uri.parse("content://com.example.files/doc/notes.txt")

    private fun rejected(reason: IncomingFile.Reason) = IncomingFile.Rejected(reason)

    @Test
    fun sendWithStreamIsAccepted() {
        assertEquals(IncomingFile.Accepted(content), parser.parse(Intent.ACTION_SEND, null, content, emptyList()))
    }

    @Test
    fun sendWithSingleClipItemIsAccepted() {
        assertEquals(IncomingFile.Accepted(content), parser.parse(Intent.ACTION_SEND, null, null, listOf(content)))
    }

    @Test
    fun sendWithTwoClipItemsIsMultipleFiles() {
        assertEquals(
            rejected(IncomingFile.Reason.MultipleFiles),
            parser.parse(Intent.ACTION_SEND, null, null, listOf(content, other)),
        )
    }

    @Test
    fun sendWithoutStreamIsNoFile() {
        assertEquals(rejected(IncomingFile.Reason.NoFile), parser.parse(Intent.ACTION_SEND, null, null, emptyList()))
    }

    @Test
    fun viewWithDataIsAccepted() {
        assertEquals(IncomingFile.Accepted(content), parser.parse(Intent.ACTION_VIEW, content, null, emptyList()))
    }

    @Test
    fun viewWithoutDataIsNoFile() {
        assertEquals(rejected(IncomingFile.Reason.NoFile), parser.parse(Intent.ACTION_VIEW, null, null, emptyList()))
    }

    @Test
    fun fileSchemeIsUnsupported() {
        val keyring = Uri.parse("file:///data/data/com.gpglocal.app/files/keyring/ABCD.pgp")
        assertEquals(
            rejected(IncomingFile.Reason.UnsupportedScheme),
            parser.parse(Intent.ACTION_SEND, null, keyring, emptyList()),
        )
    }

    @Test
    fun httpSchemeIsUnsupported() {
        assertEquals(
            rejected(IncomingFile.Reason.UnsupportedScheme),
            parser.parse(Intent.ACTION_VIEW, Uri.parse("http://example.com/secret.gpg"), null, emptyList()),
        )
    }

    @Test
    fun ownAuthorityIsRejected() {
        val own = Uri.parse("content://com.gpglocal.app.androidx-startup/whatever")
        assertEquals(rejected(IncomingFile.Reason.OwnAppUri), parser.parse(Intent.ACTION_SEND, null, own, emptyList()))
    }

    @Test
    fun unknownActionIsNoFile() {
        assertEquals(rejected(IncomingFile.Reason.NoFile), parser.parse(Intent.ACTION_EDIT, content, content, emptyList()))
        assertEquals(rejected(IncomingFile.Reason.NoFile), parser.parse(null, content, content, emptyList()))
    }
}
