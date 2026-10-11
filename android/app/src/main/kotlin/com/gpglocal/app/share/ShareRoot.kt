package com.gpglocal.app.share

import android.net.Uri
import android.os.Bundle
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.DEFAULT_ARGS_KEY
import androidx.lifecycle.HasDefaultViewModelProviderFactory
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.CreationExtras
import androidx.lifecycle.viewmodel.MutableCreationExtras
import androidx.lifecycle.viewmodel.compose.LocalViewModelStoreOwner
import androidx.lifecycle.viewmodel.compose.viewModel
import com.gpglocal.app.R
import com.gpglocal.app.ui.AppSnackbar
import com.gpglocal.app.ui.Destination
import com.gpglocal.app.ui.LocalAppSnackbar
import com.gpglocal.app.ui.common.Presentation
import com.gpglocal.app.ui.common.SecureScreen
import com.gpglocal.app.ui.decrypt.DecryptScreen
import com.gpglocal.app.ui.decrypt.DecryptViewModel
import com.gpglocal.app.ui.encrypt.EncryptScreen
import com.gpglocal.app.ui.encrypt.EncryptViewModel

/** MIME type of the onward share; matches the save picker in the Encrypt flow. */
private const val ENCRYPTED_MIME_TYPE = "application/pgp-encrypted"

/**
 * Share-mode shell: top bar with ✕ and a title naming the action, no bottom navigation.
 * Loading → Rejected | Form (the existing Encrypt / Decrypt screens) → result step.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ShareRoot(shareViewModel: ShareViewModel, onFinish: () -> Unit) {
    val state by shareViewModel.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val snackbar = remember(snackbarHostState, scope) { AppSnackbar(snackbarHostState, scope) }
    // Set by the form while a file is being written: ✕ is disabled, and the form swallows back.
    var busy by remember { mutableStateOf(false) }

    // Every share-mode step, including the result, keeps screenshots out.
    SecureScreen()

    CompositionLocalProvider(LocalAppSnackbar provides snackbar) {
        Scaffold(
            topBar = {
                TopAppBar(
                    title = { Text(stringResource(titleFor(state)), modifier = Modifier.testTag("share_title")) },
                    navigationIcon = {
                        IconButton(onClick = onFinish, enabled = !busy, modifier = Modifier.testTag("share_close")) {
                            Icon(Icons.Filled.Close, contentDescription = stringResource(R.string.share_close))
                        }
                    },
                )
            },
            snackbarHost = { SnackbarHost(snackbarHostState) },
        ) { innerPadding ->
            val modifier = Modifier.padding(innerPadding)
            when (val s = state) {
                ShareUiState.Loading -> Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                is ShareUiState.Rejected -> ShareRejected(s.reason, onClose = onFinish, modifier = modifier)
                is ShareUiState.Form -> when (s.flow) {
                    ShareFlow.Encrypt -> EncryptScreen(
                        onBusyChange = { busy = it },
                        onDecryptInstead = { shareViewModel.onSwitchFlow() },
                        presentation = Presentation.Share,
                        onSuccess = { e ->
                            shareViewModel.onSucceeded(
                                ShareResult(ShareFlow.Encrypt, e.inputName, e.outputName, e.outputUri, ENCRYPTED_MIME_TYPE),
                            )
                        },
                        viewModel = viewModel(
                            key = "share_encrypt",
                            factory = EncryptViewModel.Factory,
                            extras = extrasWithUri(s.uri),
                        ),
                        modifier = modifier,
                    )
                    ShareFlow.Decrypt -> DecryptScreen(
                        onBusyChange = { busy = it },
                        onEncryptInstead = { shareViewModel.onSwitchFlow() },
                        presentation = Presentation.Share,
                        onSuccess = { e ->
                            shareViewModel.onSucceeded(
                                ShareResult(ShareFlow.Decrypt, e.inputName, e.outputName, e.outputUri, e.mimeType),
                            )
                        },
                        viewModel = viewModel(
                            key = "share_decrypt",
                            factory = DecryptViewModel.Factory,
                            extras = extrasWithUri(s.uri),
                        ),
                        modifier = modifier,
                    )
                }
                is ShareUiState.Finished -> ShareResultCard(
                    result = s.result,
                    onDone = onFinish,
                    modifier = modifier,
                )
            }
        }
    }
}

private fun titleFor(state: ShareUiState): Int = when (state) {
    is ShareUiState.Form -> titleFor(state.flow)
    is ShareUiState.Finished -> titleFor(state.result.flow)
    ShareUiState.Loading, is ShareUiState.Rejected -> R.string.app_name
}

private fun titleFor(flow: ShareFlow): Int = when (flow) {
    ShareFlow.Encrypt -> R.string.share_title_encrypt
    ShareFlow.Decrypt -> R.string.share_title_decrypt
}

/**
 * The activity's default extras with the shared URI as the `uri` argument, so the Encrypt / Decrypt
 * ViewModels preselect it exactly as with the `?uri=` navigation argument in MainActivity.
 */
@Composable
private fun extrasWithUri(uri: Uri): CreationExtras {
    val owner = checkNotNull(LocalViewModelStoreOwner.current) { "No ViewModelStoreOwner" }
    val base = (owner as? HasDefaultViewModelProviderFactory)?.defaultViewModelCreationExtras ?: CreationExtras.Empty
    return MutableCreationExtras(base).apply {
        set(DEFAULT_ARGS_KEY, Bundle().apply { putString(Destination.ARG_URI, uri.toString()) })
    }
}

@Composable
private fun ShareRejected(reason: IncomingFile.Reason, onClose: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(24.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            stringResource(rejectionMessage(reason)),
            style = MaterialTheme.typography.bodyLarge,
            textAlign = TextAlign.Center,
            modifier = Modifier.testTag("share_rejected"),
        )
        OutlinedButton(
            onClick = onClose,
            modifier = Modifier
                .fillMaxWidth()
                .testTag("share_rejected_close"),
        ) { Text(stringResource(R.string.share_close)) }
    }
}

private fun rejectionMessage(reason: IncomingFile.Reason): Int = when (reason) {
    IncomingFile.Reason.NoFile -> R.string.share_rejected_no_file
    IncomingFile.Reason.MultipleFiles -> R.string.share_rejected_multiple
    IncomingFile.Reason.UnsupportedScheme -> R.string.share_rejected_unsupported_scheme
    IncomingFile.Reason.OwnAppUri, IncomingFile.Reason.Unreadable -> R.string.share_rejected_unreadable
}
