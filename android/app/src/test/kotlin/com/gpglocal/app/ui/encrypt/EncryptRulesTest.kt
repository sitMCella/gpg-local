package com.gpglocal.app.ui.encrypt

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EncryptRulesTest {

    @Test
    fun validatePassphraseFollowsDesktopPrecedence() {
        assertEquals(PassphraseError.Empty, validatePassphrase("", ""))
        assertEquals(PassphraseError.Empty, validatePassphrase("", "something"))
        assertEquals(PassphraseError.TooShort, validatePassphrase("short", "other"))
        assertEquals(PassphraseError.TooShort, validatePassphrase("1234567", "1234567"))
        assertEquals(PassphraseError.Mismatch, validatePassphrase("12345678", "12345679"))
        assertNull(validatePassphrase("12345678", "12345678"))
    }

    @Test
    fun isEncryptedNameChecksLastExtensionOnly() {
        assertTrue(isEncryptedName("a.gpg"))
        assertTrue(isEncryptedName("A.PGP"))
        assertTrue(isEncryptedName("report.md.gpg"))
        assertFalse(isEncryptedName("a.gpg.txt"))
        assertFalse(isEncryptedName("gpg"))
        assertFalse(isEncryptedName("report.md"))
    }

    @Test
    fun encryptedOutputNameAppendsGpg() {
        assertEquals("report.md.gpg", encryptedOutputName("report.md"))
    }
}
