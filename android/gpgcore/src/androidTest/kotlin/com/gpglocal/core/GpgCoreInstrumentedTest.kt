package com.gpglocal.core

import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Exercises the real libgpg_core_ffi.so through the UniFFI bindings, exactly as the app calls it. */
@RunWith(AndroidJUnit4::class)
class GpgCoreInstrumentedTest {

    private lateinit var dir: File
    private lateinit var keyring: GpgKeyring

    @Before
    fun setUp() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        dir = File(context.cacheDir, "gpgcore-test-${System.nanoTime()}").apply { mkdirs() }
        keyring = GpgKeyring(dir.absolutePath)
    }

    @After
    fun tearDown() {
        keyring.close()
        dir.deleteRecursively()
    }

    @Test
    fun nativeLibraryLoads() {
        assertTrue(File(dir, "keyring").isDirectory)
    }

    @Test
    fun symmetricBytesRoundtrip() {
        val plaintext = "hello from android".toByteArray()
        val ciphertext = keyring.encryptBytes(plaintext, emptyList(), PASSPHRASE)
        assertArrayEquals(plaintext, keyring.decryptBytes(ciphertext, PASSPHRASE))
    }

    @Test
    fun generateKeyThenList() {
        val info = keyring.generateKey("Alice", "alice@example.com", PASSPHRASE)
        val listed = keyring.listKeys().single { it.fingerprint == info.fingerprint }
        assertTrue(listed.hasSecret)
        assertEquals(listOf("Alice <alice@example.com>"), listed.userIds)
    }

    @Test
    fun publicKeyRoundtrip() {
        val info = keyring.generateKey("Bob", "bob@example.com", PASSPHRASE)
        val plaintext = "for bob only".toByteArray()
        val ciphertext = keyring.encryptBytes(plaintext, listOf(info.fingerprint), null)
        assertArrayEquals(plaintext, keyring.decryptBytes(ciphertext, PASSPHRASE))
    }

    @Test
    fun fdRoundtrip() {
        val plaintext = ByteArray(256 * 1024) { (it % 251).toByte() }
        val source = File(dir, "plain.bin").apply { writeBytes(plaintext) }
        val encrypted = File(dir, "plain.bin.gpg")
        val decrypted = File(dir, "plain.out")

        keyring.encryptFd(openRead(source), openWrite(encrypted), emptyList(), PASSPHRASE)
        keyring.decryptFd(openRead(encrypted), openWrite(decrypted), PASSPHRASE)

        assertArrayEquals(plaintext, decrypted.readBytes())
    }

    @Test
    fun wrongPassphraseThrowsTypedException() {
        val ciphertext = keyring.encryptBytes("secret".toByteArray(), emptyList(), PASSPHRASE)
        val e = assertThrows(GpgException.NoMatchingSecretKey::class.java) {
            keyring.decryptBytes(ciphertext, "wrong passphrase")
        }
        assertEquals("no matching secret key found", e.message)
    }

    @Test
    fun desktopCiphertextDecrypts() {
        val assets = InstrumentationRegistry.getInstrumentation().context.assets
        val ciphertext = assets.open("desktop-symmetric.txt.gpg").use { it.readBytes() }
        val plaintext = keyring.decryptBytes(ciphertext, "correct horse")
        assertEquals("Encrypted by GPG Local desktop.\n", plaintext.toString(Charsets.UTF_8))
    }

    private fun openRead(file: File): Int =
        ParcelFileDescriptor.open(file, ParcelFileDescriptor.MODE_READ_ONLY).detachFd()

    private fun openWrite(file: File): Int =
        ParcelFileDescriptor.open(
            file,
            ParcelFileDescriptor.MODE_WRITE_ONLY or ParcelFileDescriptor.MODE_CREATE or
                ParcelFileDescriptor.MODE_TRUNCATE,
        ).detachFd()

    private companion object {
        const val PASSPHRASE = "correct horse battery staple"
    }
}
