package com.gpglocal.app.ui.encrypt

import android.net.Uri
import android.text.format.Formatter
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.outlined.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import com.gpglocal.app.R
import com.gpglocal.app.data.PickedDocument
import com.gpglocal.app.ui.LocalAppSnackbar
import com.gpglocal.app.ui.SecureWindowEffect
import com.gpglocal.app.ui.theme.LocalGpgColors

/**
 * Encrypt flow: Choose file → passphrase + confirmation → Encrypt → system "Save as" picker.
 *
 * @param onBusyChange true while a file is being written; the shell disables the bottom navigation.
 * @param onDecryptInstead the picked file is already encrypted and the user wants to decrypt it.
 */
@Composable
fun EncryptScreen(
    onBusyChange: (Boolean) -> Unit,
    onDecryptInstead: (Uri) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: EncryptViewModel = viewModel(factory = EncryptViewModel.Factory),
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val context = LocalContext.current
    val snackbar = LocalAppSnackbar.current
    val currentOnBusyChange by rememberUpdatedState(onBusyChange)

    SecureWindowEffect()

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
                is EncryptEvent.Encrypted ->
                    snackbar.show(context.getString(R.string.encrypt_success, e.inputName, e.outputName))
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
            alreadyEncrypted = state.alreadyEncrypted,
            outputName = state.suggestedOutputName,
            enabled = !state.loading,
            onChooseFile = onChooseFile,
        )

        if (state.alreadyEncrypted) {
            AlreadyEncryptedBanner(onDecryptInstead)
        }

        PassphraseField(
            value = state.passphrase,
            onValueChange = onPassphraseChange,
            label = stringResource(R.string.encrypt_passphrase),
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
            FailureRow(failure = failure, cleanupFailedFor = state.cleanupFailedFor)
        }

        if (state.loading) {
            Column(
                verticalArrangement = Arrangement.spacedBy(8.dp),
                modifier = Modifier
                    .testTag("encrypt_progress")
                    .semantics { liveRegion = LiveRegionMode.Polite },
            ) {
                LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
                Text(stringResource(R.string.encrypt_in_progress), style = MaterialTheme.typography.bodyMedium)
            }
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
private fun FileCard(
    input: PickedDocument?,
    alreadyEncrypted: Boolean,
    outputName: String?,
    enabled: Boolean,
    onChooseFile: () -> Unit,
) {
    val context = LocalContext.current
    OutlinedCard(modifier = Modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (input != null && alreadyEncrypted) {
                    Icon(Icons.Outlined.Lock, contentDescription = null, tint = LocalGpgColors.current.encrypted)
                } else {
                    Icon(Icons.Outlined.Description, contentDescription = null)
                }
                if (input == null) {
                    Text(stringResource(R.string.encrypt_no_file), modifier = Modifier.weight(1f))
                } else {
                    Column(modifier = Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                input.displayName,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.titleMedium,
                                modifier = Modifier
                                    .weight(1f, fill = false)
                                    .testTag("encrypt_file_name"),
                            )
                            input.sizeBytes?.let { size ->
                                Text(
                                    Formatter.formatShortFileSize(context, size),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    modifier = Modifier.padding(start = 12.dp),
                                )
                            }
                        }
                        if (!alreadyEncrypted && outputName != null) {
                            Text(
                                stringResource(R.string.encrypt_output_name, outputName),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.testTag("encrypt_output_name"),
                            )
                        }
                    }
                }
            }
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                if (input == null) {
                    FilledTonalButton(
                        onClick = onChooseFile,
                        enabled = enabled,
                        modifier = Modifier.testTag("encrypt_choose_file"),
                    ) { Text(stringResource(R.string.choose_file)) }
                } else {
                    TextButton(
                        onClick = onChooseFile,
                        enabled = enabled,
                        modifier = Modifier.testTag("encrypt_change_file"),
                    ) { Text(stringResource(R.string.encrypt_change_file)) }
                }
            }
        }
    }
}

@Composable
private fun AlreadyEncryptedBanner(onDecryptInstead: () -> Unit) {
    Surface(
        color = MaterialTheme.colorScheme.errorContainer,
        contentColor = MaterialTheme.colorScheme.onErrorContainer,
        shape = MaterialTheme.shapes.medium,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(stringResource(R.string.encrypt_already_encrypted), style = MaterialTheme.typography.bodyMedium)
            TextButton(
                onClick = onDecryptInstead,
                modifier = Modifier
                    .align(Alignment.End)
                    .testTag("encrypt_go_to_decrypt"),
            ) { Text(stringResource(R.string.encrypt_go_to_decrypt)) }
        }
    }
}

@Composable
private fun PassphraseField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    visible: Boolean,
    onToggleVisibility: () -> Unit,
    enabled: Boolean,
    imeAction: ImeAction,
    onDone: () -> Unit,
    supportingText: String?,
    modifier: Modifier = Modifier,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        enabled = enabled,
        singleLine = true,
        isError = supportingText != null,
        supportingText = if (supportingText != null) {
            { Text(supportingText) }
        } else {
            null
        },
        visualTransformation = if (visible) VisualTransformation.None else PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(
            keyboardType = KeyboardType.Password,
            autoCorrectEnabled = false,
            imeAction = imeAction,
        ),
        keyboardActions = KeyboardActions(onDone = { onDone() }),
        trailingIcon = {
            IconButton(
                onClick = onToggleVisibility,
                enabled = enabled,
                // Not in the IME focus chain, like desktop tabIndex={-1}.
                modifier = Modifier.focusProperties { canFocus = false },
            ) {
                Icon(
                    if (visible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                    contentDescription = stringResource(
                        if (visible) R.string.encrypt_hide_passphrase else R.string.encrypt_show_passphrase,
                    ),
                )
            }
        },
        modifier = modifier.fillMaxWidth(),
    )
}

@Composable
private fun FailureRow(failure: String, cleanupFailedFor: String?) {
    Row(
        horizontalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.testTag("encrypt_failure"),
    ) {
        Icon(
            Icons.Outlined.Warning,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.error,
            modifier = Modifier.size(20.dp),
        )
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(
                stringResource(R.string.encrypt_failed, failure),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
            )
            cleanupFailedFor?.let {
                Text(
                    stringResource(R.string.encrypt_cleanup_failed, it),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
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
