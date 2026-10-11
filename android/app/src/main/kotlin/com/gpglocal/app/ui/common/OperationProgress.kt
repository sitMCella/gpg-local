package com.gpglocal.app.ui.common

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** Indeterminate progress bar plus status text, announced politely by TalkBack. */
@Composable
fun OperationProgress(text: String, modifier: Modifier = Modifier) {
    Column(
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = modifier.semantics { liveRegion = LiveRegionMode.Polite },
    ) {
        LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
        Text(text, style = MaterialTheme.typography.bodyMedium)
    }
}
