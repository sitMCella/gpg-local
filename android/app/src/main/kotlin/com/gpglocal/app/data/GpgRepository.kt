package com.gpglocal.app.data

import com.gpglocal.core.GpgException
import com.gpglocal.core.GpgKeyringInterface
import com.gpglocal.core.KeyInfo
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.withContext
import kotlin.coroutines.cancellation.CancellationException

/**
 * Single entry point to the Rust core. Every native call runs on [io] (Dispatchers.IO in the app),
 * so the main thread never blocks on crypto or keyring I/O. Nothing here is logged.
 *
 * The keyring is supplied lazily so JVM unit tests can pass a fake without loading the native library.
 */
class GpgRepository(
    private val keyring: () -> GpgKeyringInterface,
    private val io: CoroutineDispatcher,
) {
    suspend fun listKeys(): GpgResult<List<KeyInfo>> = call { keyring().listKeys() }

    suspend fun importKey(armored: String): GpgResult<KeyInfo> = call { keyring().importKey(armored) }

    suspend fun generateKey(name: String, email: String, passphrase: String): GpgResult<KeyInfo> =
        call { keyring().generateKey(name, email, passphrase) }

    suspend fun encryptBytes(
        data: ByteArray,
        recipients: List<String>,
        passphrase: String?,
    ): GpgResult<ByteArray> = call { keyring().encryptBytes(data, recipients, passphrase) }

    suspend fun decryptBytes(data: ByteArray, passphrase: String): GpgResult<ByteArray> =
        call { keyring().decryptBytes(data, passphrase) }

    // encryptFd/decryptFd wrappers (taking ParcelFileDescriptor and calling detachFd()) arrive with features 13/14.

    private suspend fun <T> call(block: () -> T): GpgResult<T> = withContext(io) {
        try {
            GpgResult.Success(block())
        } catch (e: GpgException) {
            GpgResult.Failure(e.toFailure())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            GpgResult.Failure(GpgFailure.Internal(e.message ?: e.javaClass.simpleName))
        }
    }
}

internal fun GpgException.toFailure(): GpgFailure {
    val msg = message ?: javaClass.simpleName
    return when (this) {
        is GpgException.NoMatchingSecretKey -> GpgFailure.WrongPassphrase(msg)
        is GpgException.KeyNotFound -> GpgFailure.KeyNotFound(msg)
        is GpgException.NoRecipientsOrPassphrase -> GpgFailure.NothingToEncryptFor(msg)
        is GpgException.Io -> GpgFailure.Io(msg)
        is GpgException.OpenPgp -> GpgFailure.Crypto(msg)
    }
}
