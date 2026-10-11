package com.gpglocal.app.ui.encrypt

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
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.gpglocal.app.R
import com.gpglocal.app.ui.LocalAppSnackbar
import com.gpglocal.app.ui.common.FileCard
import com.gpglocal.app.ui.common.InlineError
import com.gpglocal.app.ui.common.OperationProgress
import com.gpglocal.app.ui.common.PassphraseField
import com.gpglocal.app.ui.common.Presentation
import com.gpglocal.app.ui.common.SecureScreen
import com.gpglocal.app.ui.common.WrongModeBanner

/**
 * Encrypt flow: Choose file → passphrase + confirmation → Encrypt → system "Save as" picker.
 *
 * @param onBusyChange true while a file is being written; the shell disables the bottom navigation.
 * @param onDecryptInstead the picked file is already encrypted and the user wants to decrypt it.
 * @param presentation [Presentation.Share] hides **Change** and reports success through [onSuccess]
 *   instead of a snackbar.
 * @param onSuccess called on success in [Presentation.Share] only.
 */
@Composable
fun EncryptScreen(
    onBusyChange: (Boolean) -> Unit,
    onDecryptInstead: (Uri) -> Unit,
    modifier: Modifier = Modifier,
    presentation: Presentation = Presentation.Tab,
    onSuccess: (EncryptEvent.Encrypted) -> Unit = {},
    viewModel: EncryptViewModel = viewModel(factory = EncryptViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbar = LocalAppSnackbar.current
    val currentOnBusyChange by rememberUpdatedState(onBusyChange)
    val currentOnSuccess by rememberUpdatedState(onSuccess)

    SecureScreen()

    val openDocument = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        uri?.let(viewModel::onInputPicked)
    }
    val createDocument = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/pgp-encrypted"),
    ) { uri -> viewModel.onOutputPicked(uri) }

    LaunchedEffect(viewModel) {
        viewModel.events.collect { e ->
            when (e) {
                is EncryptEvent.RequestOutputLocation -> createDocument.launch(e.suggestedName)
                is EncryptEvent.Encrypted -> when (presentation) {
                    Presentation.Tab ->
                        snackbar.show(context.getString(R.string.encrypt_success, e.inputName, e.outputName))
                    Presentation.Share -> currentOnSuccess(e)
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

    EncryptContent(
        state = state,
        onChooseFile = { openDocument.launch(arrayOf("*/*")) },
        onDecryptInstead = { state.input?.uri?.let(onDecryptInstead) },
        onPassphraseChange = viewModel::onPassphraseChange,
        onConfirmChange = viewModel::onConfirmChange,
        onTogglePassphrase = viewModel::onTogglePassphraseVisibility,
        onToggleConfirm = viewModel::onToggleConfirmVisibility,
        onSubmit = viewModel::onSubmit,
        changeable = presentation == Presentation.Tab,
        modifier = modifier,
    )
}

@Composable
private fun EncryptContent(
    state: EncryptUiState,
    onChooseFile: () -> Unit,
    onDecryptInstead: () -> Unit,
    onPassphraseChange: (String) -> Unit,
    onConfirmChange: (String) -> Unit,
    onTogglePassphrase: () -> Unit,
    onToggleConfirm: () -> Unit,
    onSubmit: () -> Unit,
    changeable: Boolean,
    modifier: Modifier = Modifier,
) {
    val fieldsEnabled = state.input != null && !state.alreadyEncrypted && !state.loading

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
            encrypted = state.alreadyEncrypted,
            outputName = state.suggestedOutputName.takeUnless { state.alreadyEncrypted },
            enabled = !state.loading,
            onChooseFile = onChooseFile,
            testTagPrefix = "encrypt",
            changeable = changeable,
        )

        if (state.alreadyEncrypted) {
            WrongModeBanner(
                message = stringResource(R.string.encrypt_already_encrypted),
                actionLabel = stringResource(R.string.encrypt_go_to_decrypt),
                onAction = onDecryptInstead,
                actionTestTag = "encrypt_go_to_decrypt",
            )
        }

        PassphraseField(
            value = state.passphrase,
            onValueChange = onPassphraseChange,
            label = stringResource(R.string.passphrase),
            visible = state.showPassphrase,
            onToggleVisibility = onTogglePassphrase,
            enabled = fieldsEnabled,
            imeAction = ImeAction.Next,
            onDone = {},
            supportingText = null,
            modifier = Modifier.testTag("encrypt_passphrase"),
        )

        PassphraseField(
            value = state.confirm,
            onValueChange = onConfirmChange,
            label = stringResource(R.string.encrypt_confirm_passphrase),
            visible = state.showConfirm,
            onToggleVisibility = onToggleConfirm,
            enabled = fieldsEnabled,
            imeAction = ImeAction.Done,
            // Mirrors desktop "Enter submits"; onSubmit is a no-op while loading.
            onDone = onSubmit,
            supportingText = state.validationError?.let { validationMessage(it) },
            modifier = Modifier.testTag("encrypt_confirm"),
        )

        state.failure?.let { failure ->
            InlineError(
                message = stringResource(R.string.encrypt_failed, failure),
                secondLine = state.cleanupFailedFor?.let { stringResource(R.string.encrypt_cleanup_failed, it) },
                modifier = Modifier.testTag("encrypt_failure"),
            )
        }

        if (state.loading) {
            OperationProgress(
                text = stringResource(R.string.encrypt_in_progress),
                modifier = Modifier.testTag("encrypt_progress"),
            )
        }

        // The label does not change while loading, as on desktop.
        Button(
            onClick = onSubmit,
            enabled = state.canSubmit,
            modifier = Modifier
                .fillMaxWidth()
                .testTag("encrypt_submit"),
        ) {
            Text(stringResource(R.string.encrypt_button))
        }
    }
}

@Composable
private fun validationMessage(error: PassphraseError): String = stringResource(
    when (error) {
        PassphraseError.Empty -> R.string.encrypt_error_empty
        PassphraseError.TooShort -> R.string.encrypt_error_too_short
        PassphraseError.Mismatch -> R.string.encrypt_error_mismatch
    },
)
