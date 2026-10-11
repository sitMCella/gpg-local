package com.gpglocal.app.share

import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.core.content.IntentCompat
import com.gpglocal.app.ui.theme.GpgLocalTheme

/**
 * Entry point for the share sheet (`SEND`) and "Open with" (`VIEW`). Runs in the sending app's task and is
 * excluded from Recents, so it never disturbs a GPG Local session open in its own task.
 */
class ShareActivity : ComponentActivity() {

    private val viewModel: ShareViewModel by viewModels { ShareViewModel.factory(::parseIncoming) }

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            GpgLocalTheme {
                ShareRoot(viewModel, onFinish = ::finish)
            }
        }
    }

    private fun parseIncoming(): IncomingFile {
        val intent = intent
        val stream = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)
        val clip = intent.clipData
        val clipUris = if (clip == null) emptyList() else (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
        return IncomingFileParser(ownAuthorities()).parse(intent.action, intent.data, stream, clipUris)
    }

    /** Authorities of every provider in the merged manifest, so a provider added later is covered too. */
    private fun ownAuthorities(): Set<String> {
        val info = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            packageManager.getPackageInfo(
                packageName,
                PackageManager.PackageInfoFlags.of(PackageManager.GET_PROVIDERS.toLong()),
            )
        } else {
            @Suppress("DEPRECATION")
            packageManager.getPackageInfo(packageName, PackageManager.GET_PROVIDERS)
        }
        // One provider may declare several authorities, separated by ';'.
        return info.providers.orEmpty().flatMap { it.authority.orEmpty().split(';') }.filter { it.isNotEmpty() }.toSet()
    }
}
