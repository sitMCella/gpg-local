package com.gpglocal.app.ui.decrypt

import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.LockOpen
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import com.gpglocal.app.R
import com.gpglocal.app.ui.PlaceholderScreen
import com.gpglocal.app.ui.theme.LocalGpgColors

@Composable
fun DecryptScreen(modifier: Modifier = Modifier) {
    PlaceholderScreen(
        icon = Icons.Outlined.LockOpen,
        iconTint = LocalGpgColors.current.encrypted,
        description = stringResource(R.string.decrypt_placeholder),
        buttonLabel = stringResource(R.string.choose_file),
        modifier = modifier,
    )
}
