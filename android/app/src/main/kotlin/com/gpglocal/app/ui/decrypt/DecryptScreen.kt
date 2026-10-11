package com.gpglocal.app.ui.decrypt

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.gpglocal.app.R
import com.gpglocal.app.ui.LocalAppSnackbar
import com.gpglocal.app.ui.common.CreateDocumentWithType
import com.gpglocal.app.ui.common.FileCard
import com.gpglocal.app.ui.common.InlineError
import com.gpglocal.app.ui.common.OperationProgress
import com.gpglocal.app.ui.common.PassphraseField
import com.gpglocal.app.ui.common.SecureScreen
import com.gpglocal.app.ui.common.WrongModeBanner

/**
 * Decrypt flow: Choose file → passphrase → Decrypt → system "Save as" picker.
 *
 * @param onBusyChange true while a file is being written; the shell disables the bottom navigation.
 * @param onEncryptInstead the picked file is not encrypted and the user wants to encrypt it.
 */
@Composable
fun DecryptScreen(
    onBusyChange: (Boolean) -> Unit,
    onEncryptInstead: (Uri) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: DecryptViewModel = viewModel(factory = DecryptViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbar = LocalAppSnackbar.current
    val currentOnBusyChange by rememberUpdatedState(onBusyChange)

    SecureScreen()

    val openDocument = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let(viewModel::onInputPicked)
    }
    val createDocument = rememberLauncherForActivityResult(CreateDocumentWithType()) { uri ->
        viewModel.onOutputPicked(uri)
    }

    LaunchedEffect(viewModel) {
        viewModel.events.collect { e ->
            when (e) {
                is DecryptEvent.RequestOutputLocation -> createDocument.launch(e.suggestedName to e.mimeType)
                is DecryptEvent.Decrypted -> snackbar.show(
                    message = context.getString(R.string.decrypt_success, e.inputName, e.outputName),
                    actionLabel = context.getString(R.string.decrypt_open),
                ) {
                    // Hands the URI to a viewer with a one-time read grant; the app never reads the plaintext.
                    val view = Intent(Intent.ACTION_VIEW)
                        .setDataAndType(e.outputUri, e.mimeType)
                        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    try {
                        context.startActivity(view)
                    } catch (e: ActivityNotFoundException) {
                        snackbar.show(context.getString(R.string.decrypt_no_app, e.outputName))
                    }
                }
            }
        }
    }

    DisposableEffect(state.loading) {
        currentOnBusyChange(state.loading)
        onDispose { currentOnBusyChange(false) }
    }
    // Swallow back while writing; the operation itself would survive anyway (NonCancellable).
    BackHandler(enabled = state.loading) {}

    DecryptContent(
        state = state,
        onChooseFile = {
            // Providers rarely report a specific type for .gpg files, so */* stays; the name check is the gate.
            openDocument.launch(
                arrayOf("application/pgp-encrypted", "application/pgp", "application/octet-stream", "*/*"),
            )
        },
        onEncryptInstead = { state.input?.uri?.let(onEncryptInstead) },
        onPassphraseChange = viewModel::onPassphraseChange,
        onTogglePassphrase = viewModel::onTogglePassphraseVisibility,
        onSubmit = viewModel::onSubmit,
        modifier = modifier,
    )
}

@Composable
private fun DecryptContent(
    state: DecryptUiState,
    onChooseFile: () -> Unit,
    onEncryptInstead: () -> Unit,
    onPassphraseChange: (String) -> Unit,
    onTogglePassphrase: () -> Unit,
    onSubmit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val decryptable = state.input != null && !state.notEncrypted
    val focusRequester = remember { FocusRequester() }

    // Focus the passphrase as soon as a decryptable file is picked.
    LaunchedEffect(state.input?.uri, decryptable) {
        if (decryptable) focusRequester.requestFocus()
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .imePadding()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        FileCard(
            input = state.input,
            encrypted = decryptable,
            outputName = state.suggestedOutputName.takeIf { decryptable },
            note = if (decryptable) stringResource(R.string.decrypt_plaintext_note) else null,
            enabled = !state.loading,
            onChooseFile = onChooseFile,
            testTagPrefix = "decrypt",
        )

        if (state.notEncrypted) {
            WrongModeBanner(
                message = stringResource(R.string.decrypt_not_encrypted),
                actionLabel = stringResource(R.string.decrypt_go_to_encrypt),
                onAction = onEncryptInstead,
                actionTestTag = "decrypt_go_to_encrypt",
            )
        }

        PassphraseField(
            value = state.passphrase,
            onValueChange = onPassphraseChange,
            label = stringResource(R.string.passphrase),
            visible = state.showPassphrase,
            onToggleVisibility = onTogglePassphrase,
            enabled = decryptable && !state.loading,
            imeAction = ImeAction.Done,
            // Mirrors desktop "Enter submits"; onSubmit is a no-op while loading.
            onDone = onSubmit,
            supportingText = if (state.validationError) stringResource(R.string.decrypt_error_empty) else null,
            modifier = Modifier
                .focusRequester(focusRequester)
                .testTag("decrypt_passphrase"),
        )

        state.failure?.let { failure ->
            InlineError(
                // Every backend failure gets the same wording, as on desktop.
                message = stringResource(R.string.decrypt_failed, failure),
                secondLine = state.cleanupFailedFor?.let { stringResource(R.string.decrypt_cleanup_failed, it) },
                modifier = Modifier.testTag("decrypt_failure"),
            )
        }

        if (state.loading) {
            OperationProgress(
                text = stringResource(R.string.decrypt_in_progress),
                modifier = Modifier.testTag("decrypt_progress"),
            )
        }

        // The label does not change while loading, as on desktop.
        Button(
            onClick = onSubmit,
            enabled = state.canSubmit,
            modifier = Modifier
                .fillMaxWidth()
                .testTag("decrypt_submit"),
        ) {
            Text(stringResource(R.string.decrypt_button))
        }
    }
}
