package com.gpglocal.app.ui.encrypt

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.gpglocal.app.R
import com.gpglocal.app.ui.PlaceholderScreen

@Composable
fun EncryptScreen(modifier: Modifier = Modifier) {
    PlaceholderScreen(
        icon = Icons.Outlined.Lock,
        iconTint = MaterialTheme.colorScheme.primary,
        description = stringResource(R.string.encrypt_placeholder),
        buttonLabel = stringResource(R.string.choose_file),
        modifier = modifier,
    )
}
