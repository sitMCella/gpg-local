package com.gpglocal.app.data

import com.gpglocal.core.GpgException
import com.gpglocal.core.GpgKeyringInterface
import com.gpglocal.core.KeyInfo
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import kotlin.coroutines.CoroutineContext

class GpgRepositoryTest {

    /** Fake keyring: every call runs [behaviour], so no native library is loaded. */
    private class FakeKeyring(private val behaviour: () -> Any) : GpgKeyringInterface {
        @Suppress("UNCHECKED_CAST")
        private fun <T> answer(): T {
            return behaviour() as T
        }

        override fun decryptBytes(ciphertext: ByteArray, passphrase: String): ByteArray = answer()
        override fun decryptFd(inputFd: Int, outputFd: Int, passphrase: String) = answer<Unit>()
        override fun encryptBytes(
            plaintext: ByteArray,
            recipientFingerprints: List<String>,
            passphrase: String?,
        ): ByteArray = answer()
        override fun encryptFd(
            inputFd: Int,
            outputFd: Int,
            recipientFingerprints: List<String>,
            passphrase: String?,
        ) = answer<Unit>()
        override fun generateKey(name: String, email: String, passphrase: String): KeyInfo = answer()
        override fun importKey(armored: String): KeyInfo = answer()
        override fun listKeys(): List<KeyInfo> = answer()
    }

    private fun failingWith(e: Throwable) = FakeKeyring { throw e }

    private suspend fun failureOf(keyring: FakeKeyring, dispatcher: CoroutineDispatcher): GpgFailure {
        val result = GpgRepository({ keyring }, dispatcher).decryptBytes(byteArrayOf(1), "pw")
        assertTrue("expected Failure, got $result", result is GpgResult.Failure)
        return (result as GpgResult.Failure).error
    }

    @Test
    fun noMatchingSecretKeyMapsToWrongPassphraseAndKeepsMessage() = runTest {
        val failure = failureOf(
            failingWith(GpgException.NoMatchingSecretKey("no matching secret key found")),
            StandardTestDispatcher(testScheduler),
        )
        assertEquals(GpgFailure.WrongPassphrase("no matching secret key found"), failure)
    }

    @Test
    fun everyGpgExceptionMapsToItsFailure() = runTest {
        val dispatcher = StandardTestDispatcher(testScheduler)
        val cases = listOf(
            GpgException.KeyNotFound("key not found: ABCD") to GpgFailure.KeyNotFound("key not found: ABCD"),
            GpgException.NoRecipientsOrPassphrase("No recipients or passphrase specified") to
                GpgFailure.NothingToEncryptFor("No recipients or passphrase specified"),
            GpgException.Io("permission denied") to GpgFailure.Io("permission denied"),
            GpgException.OpenPgp("malformed packet") to GpgFailure.Crypto("malformed packet"),
        )
        for ((exception, expected) in cases) {
            assertEquals(expected, failureOf(failingWith(exception), dispatcher))
        }
    }

    @Test
    fun unexpectedExceptionMapsToInternal() = runTest {
        val failure = failureOf(failingWith(RuntimeException("boom")), StandardTestDispatcher(testScheduler))
        assertEquals(GpgFailure.Internal("boom"), failure)
    }

    @Test
    fun exceptionWithoutMessageUsesClassName() = runTest {
        val failure = failureOf(failingWith(IllegalStateException()), StandardTestDispatcher(testScheduler))
        assertEquals(GpgFailure.Internal("IllegalStateException"), failure)
    }

    @Test
    fun cancellationIsRethrown() = runTest {
        val repository = GpgRepository(
            { failingWith(CancellationException("cancelled")) },
            StandardTestDispatcher(testScheduler),
        )
        try {
            repository.listKeys()
            fail("CancellationException must propagate")
        } catch (e: CancellationException) {
            assertEquals("cancelled", e.message)
        }
    }

    @Test
    fun successWrapsValue() = runTest {
        val repository = GpgRepository({ FakeKeyring { byteArrayOf(4, 2) } }, StandardTestDispatcher(testScheduler))
        val result = repository.encryptBytes(byteArrayOf(1), emptyList(), "passphrase")
        assertTrue(result is GpgResult.Success)
        assertArrayEquals(byteArrayOf(4, 2), (result as GpgResult.Success).value)
    }

    @Test
    fun callsRunOnInjectedDispatcher() = runTest {
        val io = RecordingDispatcher(StandardTestDispatcher(testScheduler))
        val repository = GpgRepository({ FakeKeyring { emptyList<KeyInfo>() } }, io)
        assertEquals(GpgResult.Success(emptyList<KeyInfo>()), repository.listKeys())
        assertTrue("native call must be dispatched to the injected dispatcher", io.dispatches > 0)
    }

    private class RecordingDispatcher(private val delegate: CoroutineDispatcher) : CoroutineDispatcher() {
        var dispatches = 0
            private set

        override fun dispatch(context: CoroutineContext, block: Runnable) {
            dispatches++
            delegate.dispatch(context, block)
        }
    }
}
