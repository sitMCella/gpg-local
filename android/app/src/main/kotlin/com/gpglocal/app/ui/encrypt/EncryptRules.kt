package com.gpglocal.app.ui.encrypt

// Validation and naming rules, identical to desktop feature 04 (EncryptDialog).

const val MIN_PASSPHRASE_LENGTH = 8

enum class PassphraseError { Empty, TooShort, Mismatch }

/** Same order of precedence as the desktop dialog: empty, then too short, then mismatch. */
fun validatePassphrase(passphrase: String, confirm: String): PassphraseError? = when {
    passphrase.isEmpty() -> PassphraseError.Empty
    passphrase.length < MIN_PASSPHRASE_LENGTH -> PassphraseError.TooShort
    passphrase != confirm -> PassphraseError.Mismatch
    else -> null
}

fun isEncryptedName(name: String): Boolean =
    name.substringAfterLast('.', "").lowercase().let { it == "gpg" || it == "pgp" }

fun encryptedOutputName(inputName: String): String = "$inputName.gpg"
