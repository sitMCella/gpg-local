package com.gpglocal.app.ui.common

import android.text.format.Formatter
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.gpglocal.app.R
import com.gpglocal.app.data.PickedDocument
import com.gpglocal.app.ui.theme.LocalGpgColors

/**
 * The picked input: an empty state with **Choose file**, or icon, name, size, `→ output` and **Change**.
 *
 * @param encrypted shows the amber lock instead of the generic file icon.
 * @param outputName suggested output name; hidden when null.
 * @param note optional line under the output name.
 * @param testTagPrefix prefix for the test tags (`<prefix>_file_name`, `<prefix>_choose_file`, …).
 */
@Composable
fun FileCard(
    input: PickedDocument?,
    encrypted: Boolean,
    outputName: String?,
    enabled: Boolean,
    onChooseFile: () -> Unit,
    testTagPrefix: String,
    note: String? = null,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    OutlinedCard(modifier = modifier.fillMaxWidth()) {
        Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (input != null && encrypted) {
                    Icon(Icons.Outlined.Lock, contentDescription = null, tint = LocalGpgColors.current.encrypted)
                } else {
                    Icon(Icons.Outlined.Description, contentDescription = null)
                }
                if (input == null) {
                    Text(stringResource(R.string.no_file_selected), modifier = Modifier.weight(1f))
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
                                    .testTag("${testTagPrefix}_file_name"),
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
                        if (outputName != null) {
                            Text(
                                stringResource(R.string.output_name, outputName),
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.testTag("${testTagPrefix}_output_name"),
                            )
                        }
                        if (note != null) {
                            Text(
                                note,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(top = 4.dp),
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
                        modifier = Modifier.testTag("${testTagPrefix}_choose_file"),
                    ) { Text(stringResource(R.string.choose_file)) }
                } else {
                    TextButton(
                        onClick = onChooseFile,
                        enabled = enabled,
                        modifier = Modifier.testTag("${testTagPrefix}_change_file"),
                    ) { Text(stringResource(R.string.change_file)) }
                }
            }
        }
    }
}
