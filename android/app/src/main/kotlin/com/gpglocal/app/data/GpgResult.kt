package com.gpglocal.app.data

/** Outcome of a [GpgRepository] call. Native exceptions never escape the repository. */
sealed interface GpgResult<out T> {
    data class Success<T>(val value: T) : GpgResult<T>

    data class Failure(val error: GpgFailure) : GpgResult<Nothing>
}

/**
 * Typed failure. [message] is the backend string verbatim (same as the desktop UI shows),
 * so screens can append it in parentheses after a friendly explanation.
 */
sealed interface GpgFailure {
    val message: String

    /** `GpgException.NoMatchingSecretKey` */
    data class WrongPassphrase(override val message: String) : GpgFailure

    /** `GpgException.KeyNotFound` */
    data class KeyNotFound(override val message: String) : GpgFailure

    /** `GpgException.NoRecipientsOrPassphrase` */
    data class NothingToEncryptFor(override val message: String) : GpgFailure

    /** `GpgException.Io` */
    data class Io(override val message: String) : GpgFailure

    /** `GpgException.OpenPgp` */
    data class Crypto(override val message: String) : GpgFailure

    /** UniFFI `InternalException` or any other unexpected exception. */
    data class Internal(override val message: String) : GpgFailure
}
