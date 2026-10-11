package com.gpglocal.app.ui.decrypt

import android.net.Uri
import android.webkit.MimeTypeMap
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.gpglocal.app.GpgLocalApp
import com.gpglocal.app.data.DocumentStore
import com.gpglocal.app.data.FileDecryptor
import com.gpglocal.app.data.GpgFailure
import com.gpglocal.app.data.GpgResult
import com.gpglocal.app.data.PickedDocument
import com.gpglocal.app.ui.Destination
import com.gpglocal.app.ui.encrypt.isEncryptedName
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

data class DecryptUiState(
    val input: PickedDocument? = null,
    val passphrase: String = "",
    val showPassphrase: Boolean = false,
    /** The only validation rule, as on desktop: the passphrase must not be empty. */
    val validationError: Boolean = false,
    /** Backend message, shown in parentheses after the "Decryption failed." explanation. */
    val failure: String? = null,
    /** Display name of an output document that could not be deleted after a failure. */
    val cleanupFailedFor: String? = null,
    val loading: Boolean = false,
) {
    val notEncrypted: Boolean get() = input?.let { !isEncryptedName(it.displayName) } == true
    val canSubmit: Boolean get() = input != null && !notEncrypted && !loading
    val suggestedOutputName: String? get() = input?.displayName?.let(::decryptedOutputName)
}

sealed interface DecryptEvent {
    data class RequestOutputLocation(val suggestedName: String, val mimeType: String) : DecryptEvent

    data class Decrypted(
        val inputName: String,
        val outputName: String,
        val outputUri: Uri,
        val mimeType: String,
    ) : DecryptEvent
}

/**
 * Decrypt flow: pick input → passphrase → save location → decryptFd.
 *
 * The passphrase lives only in [state]. It is never written to [savedState]; only the input URI is.
 * It is cleared after a failed attempt and on success.
 */
class DecryptViewModel(
    private val savedState: SavedStateHandle,
    private val documents: DocumentStore,
    private val gpg: FileDecryptor,
    private val mimeLookup: (String) -> String? = { MimeTypeMap.getSingleton().getMimeTypeFromExtension(it) },
) : ViewModel() {

    private val _state = MutableStateFlow(DecryptUiState())
    val state: StateFlow<DecryptUiState> = _state.asStateFlow()

    private val _events = Channel<DecryptEvent>(Channel.BUFFERED)
    val events: Flow<DecryptEvent> = _events.receiveAsFlow()

    init {
        // "Decrypt it instead" on the Encrypt screen hands over its file as a nav argument. It is removed
        // once consumed, so after process death the saved input URI (possibly changed since) wins.
        val handedOver = savedState.remove<String>(KEY_HANDED_OVER_URI)
        if (handedOver != null) {
            onInputPicked(Uri.parse(handedOver))
        } else {
            // After process death the picked file comes back; the passphrase field stays empty.
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
                it.copy(passphrase = "", validationError = false, failure = null, cleanupFailedFor = null)
            }
        }
    }

    fun onPassphraseChange(value: String) {
        if (_state.value.loading) return
        _state.update { it.copy(passphrase = value, validationError = false) }
    }

    fun onTogglePassphraseVisibility() = _state.update { it.copy(showPassphrase = !it.showPassphrase) }

    fun onSubmit() {
        val s = _state.value
        if (!s.canSubmit) return
        if (s.passphrase.isEmpty()) {
            _state.update { it.copy(validationError = true) }
            return
        }
        _state.update { it.copy(validationError = false) }
        val name = requireNotNull(s.suggestedOutputName)
        _events.trySend(DecryptEvent.RequestOutputLocation(name, mimeTypeFor(name, mimeLookup)))
    }

    /** `null` means the user cancelled the save picker: keep the form as it is. */
    fun onOutputPicked(uri: Uri?) {
        if (uri == null) return
        val s = _state.value
        if (s.loading) return
        val input = s.input
        if (input == null || s.notEncrypted || s.passphrase.isEmpty()) {
            // The picker result can arrive after process death, when the passphrase is gone.
            // The picker already created the document, so remove it instead of decrypting with nothing.
            _state.update { it.copy(validationError = s.passphrase.isEmpty()) }
            viewModelScope.launch { withContext(NonCancellable) { documents.delete(uri) } }
            return
        }
        decrypt(input, uri, s.passphrase)
    }

    private fun decrypt(input: PickedDocument, outputUri: Uri, passphrase: String) {
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
                    gpg.decryptFd(inFd, outFd, passphrase)
                }.getOrElse { GpgResult.Failure(GpgFailure.Io(it.message ?: it.javaClass.simpleName)) }

                when (result) {
                    is GpgResult.Success -> {
                        setInput(null)
                        _state.value = DecryptUiState() // reset the form, drop the passphrase
                        _events.send(
                            DecryptEvent.Decrypted(
                                inputName = input.displayName,
                                outputName = outputName,
                                outputUri = outputUri,
                                // The provider may have renamed the output; derive the type from the real name.
                                mimeType = mimeTypeFor(outputName, mimeLookup),
                            ),
                        )
                    }
                    is GpgResult.Failure -> {
                        // Never leave a truncated plaintext behind. The save picker created the output
                        // before we opened anything, so it always exists.
                        val removed = documents.delete(outputUri)
                        // A file that cannot be opened (deleted, permission revoked) must be picked again.
                        if (inputUnreadable) setInput(null)
                        _state.update {
                            it.copy(
                                loading = false,
                                // Retyping is expected after a wrong passphrase, and the secret leaves memory sooner.
                                passphrase = "",
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

        /** Optional nav argument of the Decrypt route. */
        const val KEY_HANDED_OVER_URI = Destination.ARG_URI

        val Factory = viewModelFactory {
            initializer {
                val container = (this[APPLICATION_KEY] as GpgLocalApp).container
                DecryptViewModel(createSavedStateHandle(), container.documentRepository, container.gpgRepository)
            }
        }
    }
}
