package com.gpglocal.app.share

import android.content.ClipData
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material3.Button
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.gpglocal.app.R
import com.gpglocal.app.ui.LocalAppSnackbar
import com.gpglocal.app.ui.common.viewDocument

/**
 * Result step after a successful share-mode operation.
 *
 * Encrypt offers **Share encrypted file**; Decrypt offers only **Open**, which hands the plaintext to a
 * viewer. Plaintext is never offered to a sharing chooser, so it cannot be forwarded in one tap by mistake.
 */
@Composable
fun ShareResultCard(result: ShareResult, onDone: () -> Unit, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val snackbar = LocalAppSnackbar.current
    val encrypted = result.flow == ShareFlow.Encrypt

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Outlined.CheckCircle,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.primary,
            modifier = Modifier.size(48.dp),
        )
        Text(
            stringResource(
                if (encrypted) R.string.share_result_encrypted else R.string.share_result_decrypted,
                result.inputName,
            ),
            style = MaterialTheme.typography.titleMedium,
            textAlign = TextAlign.Center,
            modifier = Modifier.testTag("share_result_title"),
        )
        Text(
            stringResource(R.string.share_result_saved_as, result.outputName),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.testTag("share_result_output"),
        )
        if (encrypted) {
            Button(
                onClick = { context.shareOnward(result) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp)
                    .testTag("share_result_share"),
            ) { Text(stringResource(R.string.share_result_share)) }
        } else {
            Button(
                onClick = {
                    if (!context.viewDocument(result.outputUri, result.mimeType)) {
                        snackbar.show(context.getString(R.string.decrypt_no_app, result.outputName))
                    }
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 12.dp)
                    .testTag("share_result_open"),
            ) { Text(stringResource(R.string.decrypt_open)) }
        }
        OutlinedButton(
            onClick = onDone,
            modifier = Modifier
                .fillMaxWidth()
                .testTag("share_result_done"),
        ) { Text(stringResource(R.string.share_result_done)) }
    }
}

/**
 * Onward `ACTION_SEND` of the encrypted output with a one-time read grant. The ClipData makes the grant
 * reach the chosen app on every API level; GPG Local itself is left out of the chooser.
 */
private fun Context.shareOnward(result: ShareResult) {
    val send = Intent(Intent.ACTION_SEND)
        .setType(result.mimeType)
        .putExtra(Intent.EXTRA_STREAM, result.outputUri)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
    send.clipData = ClipData.newRawUri(result.outputName, result.outputUri)
    val chooser = Intent.createChooser(send, null)
        .putExtra(Intent.EXTRA_EXCLUDE_COMPONENTS, arrayOf(ComponentName(this, ShareActivity::class.java)))
    startActivity(chooser)
}
