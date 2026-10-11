package com.gpglocal.app.share

import android.net.Uri
import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelProvider.AndroidViewModelFactory.Companion.APPLICATION_KEY
import androidx.lifecycle.createSavedStateHandle
import androidx.lifecycle.viewModelScope
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.gpglocal.app.GpgLocalApp
import com.gpglocal.app.data.DocumentStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** A finished share-mode operation, shown in the result step. */
data class ShareResult(
    val flow: ShareFlow,
    val inputName: String,
    val outputName: String,
    val outputUri: Uri,
    val mimeType: String,
)

sealed interface ShareUiState {
    /** The provider is being asked for the file name, to pick the flow. */
    data object Loading : ShareUiState

    data class Rejected(val reason: IncomingFile.Reason) : ShareUiState

    /** The Encrypt or Decrypt form, with [uri] preselected. */
    data class Form(val flow: ShareFlow, val uri: Uri) : ShareUiState

    data class Finished(val result: ShareResult) : ShareUiState
}

/**
 * Share-mode state: parse result → route → form → result step.
 *
 * The URI, the chosen flow and the result are saved in [savedState], so rotation and process death restore
 * the same step. Nothing here ever holds the passphrase; that stays in the Encrypt/Decrypt ViewModels'
 * memory-only state.
 */
class ShareViewModel(
    private val savedState: SavedStateHandle,
    private val documents: DocumentStore,
    incoming: IncomingFile,
) : ViewModel() {

    private val _state = MutableStateFlow<ShareUiState>(ShareUiState.Loading)
    val state: StateFlow<ShareUiState> = _state.asStateFlow()

    init {
        val result = restoreResult()
        val uri = savedState.get<Uri>(KEY_URI)
        val flow = savedState.get<String>(KEY_FLOW)?.let(ShareFlow::valueOf)
        when {
            result != null -> _state.value = ShareUiState.Finished(result)
            uri != null && flow != null -> _state.value = ShareUiState.Form(flow, uri)
            incoming is IncomingFile.Rejected -> _state.value = ShareUiState.Rejected(incoming.reason)
            incoming is IncomingFile.Accepted -> viewModelScope.launch {
                runCatching { route(incoming.uri, documents) }
                    .onSuccess { showForm(it, incoming.uri) }
                    .onFailure { _state.value = ShareUiState.Rejected(IncomingFile.Reason.Unreadable) }
            }
        }
    }

    /** The wrong-mode banner's action: same file, other flow. */
    fun onSwitchFlow() {
        val form = _state.value as? ShareUiState.Form ?: return
        val other = if (form.flow == ShareFlow.Encrypt) ShareFlow.Decrypt else ShareFlow.Encrypt
        showForm(other, form.uri)
    }

    fun onSucceeded(result: ShareResult) {
        savedState[KEY_RESULT_FLOW] = result.flow.name
        savedState[KEY_RESULT_INPUT_NAME] = result.inputName
        savedState[KEY_RESULT_OUTPUT_NAME] = result.outputName
        savedState[KEY_RESULT_OUTPUT_URI] = result.outputUri
        savedState[KEY_RESULT_MIME_TYPE] = result.mimeType
        _state.value = ShareUiState.Finished(result)
    }

    private fun showForm(flow: ShareFlow, uri: Uri) {
        savedState[KEY_URI] = uri
        savedState[KEY_FLOW] = flow.name
        _state.value = ShareUiState.Form(flow, uri)
    }

    private fun restoreResult(): ShareResult? {
        return ShareResult(
            flow = savedState.get<String>(KEY_RESULT_FLOW)?.let(ShareFlow::valueOf) ?: return null,
            inputName = savedState.get<String>(KEY_RESULT_INPUT_NAME) ?: return null,
            outputName = savedState.get<String>(KEY_RESULT_OUTPUT_NAME) ?: return null,
            outputUri = savedState.get<Uri>(KEY_RESULT_OUTPUT_URI) ?: return null,
            mimeType = savedState.get<String>(KEY_RESULT_MIME_TYPE) ?: return null,
        )
    }

    companion object {
        const val KEY_URI = "share_uri"
        const val KEY_FLOW = "share_flow"
        const val KEY_RESULT_FLOW = "result_flow"
        const val KEY_RESULT_INPUT_NAME = "result_input_name"
        const val KEY_RESULT_OUTPUT_NAME = "result_output_name"
        const val KEY_RESULT_OUTPUT_URI = "result_output_uri"
        const val KEY_RESULT_MIME_TYPE = "result_mime_type"

        /** [incoming] is only used when nothing was saved yet, i.e. on the first creation. */
        fun factory(incoming: () -> IncomingFile): ViewModelProvider.Factory = viewModelFactory {
            initializer {
                val container = (this[APPLICATION_KEY] as GpgLocalApp).container
                ShareViewModel(createSavedStateHandle(), container.documentRepository, incoming())
            }
        }
    }
}
