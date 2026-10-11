package com.gpglocal.app.ui.theme

import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

/** App colours outside the Material scheme. */
@Immutable
data class GpgColors(val encrypted: Color)

val LocalGpgColors = staticCompositionLocalOf { GpgColors(encrypted = Amber500) }

private val LightColors = lightColorScheme(
    primary = Indigo600,
    onPrimary = Color.White,
    primaryContainer = Indigo100,
    onPrimaryContainer = Indigo900,
)

private val DarkColors = darkColorScheme(
    primary = Indigo300,
    onPrimary = Indigo900,
    primaryContainer = Indigo900,
    onPrimaryContainer = Indigo100,
)

/** Follows the system dark/light setting; dynamic colour on Android 12+. */
@Composable
fun GpgLocalTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            val context = LocalContext.current
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColors
        else -> LightColors
    }
    CompositionLocalProvider(LocalGpgColors provides GpgColors(encrypted = Amber500)) {
        MaterialTheme(colorScheme = colorScheme, typography = GpgLocalTypography, content = content)
    }
}
