package com.gpglocal.app.ui.encrypt

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.gpglocal.app.GpgLocalApp
import com.gpglocal.app.data.DocumentStore
import com.gpglocal.app.data.FileEncryptor
import com.gpglocal.app.data.GpgFailure
import com.gpglocal.app.data.GpgResult
import com.gpglocal.app.data.PickedDocument
import com.gpglocal.app.ui.Destination
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.receiveAsFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

data class EncryptUiState(
    val input: PickedDocument? = null,
    val passphrase: String = "",
    val confirm: String = "",
    val showPassphrase: Boolean = false,
    val showConfirm: Boolean = false,
    val validationError: PassphraseError? = null,
    /** Backend message, shown in parentheses after "Encryption failed.". */
    val failure: String? = null,
    /** Display name of an output document that could not be deleted after a failure. */
    val cleanupFailedFor: String? = null,
    val loading: Boolean = false,
) {
    val alreadyEncrypted: Boolean get() = input?.let { isEncryptedName(it.displayName) } == true
    val canSubmit: Boolean get() = input != null && !alreadyEncrypted && !loading
    val suggestedOutputName: String? get() = input?.displayName?.let(::encryptedOutputName)
}

sealed interface EncryptEvent {
    data class RequestOutputLocation(val suggestedName: String) : EncryptEvent

    data class Encrypted(val inputName: String, val outputName: String) : EncryptEvent
}

/**
 * Encrypt flow: pick input → passphrase → save location → encryptFd.
 *
 * The passphrase lives only in [state]. It is never written to [savedState], which would persist it
 * into the saved-instance bundle; only the input URI is saved there.
 */
class EncryptViewModel(
    private val savedState: SavedStateHandle,
    private val documents: DocumentStore,
    private val gpg: FileEncryptor,
) : ViewModel() {

    private val _state = MutableStateFlow(EncryptUiState())
    val state: StateFlow<EncryptUiState> = _state.asStateFlow()

    private val _events = Channel<EncryptEvent>(Channel.BUFFERED)
    val events: Flow<EncryptEvent> = _events.receiveAsFlow()

    init {
        // "Encrypt it instead" on the Decrypt screen hands over its file as a nav argument. It is removed
        // once consumed, so after process death the saved input URI (possibly changed since) wins.
        val handedOver = savedState.remove<String>(KEY_HANDED_OVER_URI)
        if (handedOver != null) {
            onInputPicked(Uri.parse(handedOver))
        } else {
            // After process death the picked file comes back; the passphrase fields stay empty.
            savedState.get<Uri>(KEY_INPUT_URI)?.let { uri ->
                viewModelScope.launch {
                    runCatching { documents.describe(uri) }
                        .onSuccess { doc -> _state.update { it.copy(input = doc) } }
                        .onFailure { setInput(null) }
                }
            }
        }
    }

    fun onInputPicked(uri: Uri) {
        if (_state.value.loading) return
        viewModelScope.launch {
            val doc = runCatching { documents.describe(uri) }.getOrElse {
                _state.update { s -> s.copy(failure = it.message ?: it.javaClass.simpleName) }
                return@launch
            }
            setInput(doc)
            _state.update {
                it.copy(
                    passphrase = "",
                    confirm = "",
                    validationError = null,
                    failure = null,
                    cleanupFailedFor = null,
                )
            }
        }
    }

    fun onPassphraseChange(value: String) {
        if (_state.value.loading) return
        _state.update { it.copy(passphrase = value, validationError = null) }
    }

    fun onConfirmChange(value: String) {
        if (_state.value.loading) return
        _state.update { it.copy(confirm = value, validationError = null) }
    }

    fun onTogglePassphraseVisibility() = _state.update { it.copy(showPassphrase = !it.showPassphrase) }

    fun onToggleConfirmVisibility() = _state.update { it.copy(showConfirm = !it.showConfirm) }

    fun onSubmit() {
        val s = _state.value
        if (!s.canSubmit) return
        val error = validatePassphrase(s.passphrase, s.confirm)
        if (error != null) {
            _state.update { it.copy(validationError = error) }
            return
        }
        _state.update { it.copy(validationError = null) }
        _events.trySend(EncryptEvent.RequestOutputLocation(requireNotNull(s.suggestedOutputName)))
    }

    /** `null` means the user cancelled the save picker: keep the form as it is. */
    fun onOutputPicked(uri: Uri?) {
        if (uri == null) return
        val s = _state.value
        if (s.loading) return
        val input = s.input
        val error = validatePassphrase(s.passphrase, s.confirm)
        if (input == null || s.alreadyEncrypted || error != null) {
            // The picker result can arrive after process death, when the passphrase is gone.
            // The picker already created the document, so remove it instead of encrypting with nothing.
            _state.update { it.copy(validationError = error) }
            viewModelScope.launch { withContext(NonCancellable) { documents.delete(uri) } }
            return
        }
        encrypt(input, uri, s.passphrase)
    }

    private fun encrypt(input: PickedDocument, outputUri: Uri, passphrase: String) {
        _state.update { it.copy(loading = true, failure = null, cleanupFailedFor = null) }
        viewModelScope.launch {
            // Finish and clean up even if the screen goes away.
            withContext(NonCancellable) {
                val outputName = documents.describe(outputUri).displayName
                var inputUnreadable = false
                val result = runCatching {
                    val inFd = try {
                        documents.openForRead(input.uri)
                    } catch (e: Exception) {
                        inputUnreadable = true
                        throw e
                    }
                    val outFd = try {
                        documents.openForWrite(outputUri)
                    } catch (e: Exception) {
                        inFd.close()
                        throw e
                    }
                    gpg.encryptFd(inFd, outFd, passphrase)
                }.getOrElse { GpgResult.Failure(GpgFailure.Io(it.message ?: it.javaClass.simpleName)) }

                when (result) {
                    is GpgResult.Success -> {
                        setInput(null)
                        _state.value = EncryptUiState() // reset the form, drop the passphrase
                        _events.send(EncryptEvent.Encrypted(input.displayName, outputName))
                    }
                    is GpgResult.Failure -> {
                        // The save picker created the output before we opened anything, so it always exists.
                        val removed = documents.delete(outputUri)
                        // A file that cannot be opened (deleted, permission revoked) must be picked again.
                        if (inputUnreadable) setInput(null)
                        _state.update {
                            it.copy(
                                loading = false,
                                failure = result.error.message,
                                cleanupFailedFor = if (removed) null else outputName,
                            )
                        }
                    }
                }
            }
        }
    }

    private fun setInput(doc: PickedDocument?) {
        if (doc == null) savedState.remove<Uri>(KEY_INPUT_URI) else savedState[KEY_INPUT_URI] = doc.uri
        _state.update { it.copy(input = doc) }
    }

    companion object {
        const val KEY_INPUT_URI = "input_uri"

        /** Optional nav argument of the Encrypt route. */
        const val KEY_HANDED_OVER_URI = Destination.ARG_URI

        val Factory = viewModelFactory {
            initializer {
                val container = (this[APPLICATION_KEY] as GpgLocalApp).container
                EncryptViewModel(createSavedStateHandle(), container.documentRepository, container.gpgRepository)
            }
        }
    }
}
