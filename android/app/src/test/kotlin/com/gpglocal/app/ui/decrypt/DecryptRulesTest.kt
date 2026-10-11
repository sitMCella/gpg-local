package com.gpglocal.app.ui.decrypt

import org.junit.Assert.assertEquals
import org.junit.Test

class DecryptRulesTest {

    @Test
    fun decryptedOutputNameMatchesDesktopRule() {
        assertEquals("report.md", decryptedOutputName("report.md.gpg"))
        assertEquals("archive", decryptedOutputName("archive.pgp"))
        assertEquals("photo.jpg", decryptedOutputName("photo.jpg.GPG"))
        assertEquals("notes.txt.decrypted", decryptedOutputName("notes.txt"))
    }

    @Test
    fun bareExtensionNeverGivesEmptyName() {
        assertEquals(".gpg.decrypted", decryptedOutputName(".gpg"))
    }

    @Test
    fun mimeTypeComesFromTheOutputExtension() {
        val lookup = mapOf("md" to "text/markdown")::get

        assertEquals("text/markdown", mimeTypeFor("report.md", lookup))
        assertEquals("text/markdown", mimeTypeFor("REPORT.MD", lookup))
        assertEquals("application/octet-stream", mimeTypeFor("archive", lookup))
        assertEquals("application/octet-stream", mimeTypeFor("a.xyz", lookup))
    }
}
