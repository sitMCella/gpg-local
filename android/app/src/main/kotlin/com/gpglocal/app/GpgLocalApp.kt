package com.gpglocal.app

import android.app.Application
import android.content.Context
import android.os.StrictMode
import com.gpglocal.app.data.GpgRepository
import com.gpglocal.core.GpgKeyring
import com.gpglocal.core.GpgKeyringInterface
import kotlinx.coroutines.Dispatchers

class GpgLocalApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        if (BuildConfig.DEBUG) {
            StrictMode.setThreadPolicy(
                StrictMode.ThreadPolicy.Builder()
                    .detectDiskReads()
                    .detectDiskWrites()
                    .penaltyLog()
                    .build(),
            )
        }
        container = AppContainer(this)
    }
}

/**
 * Manual dependency graph. Two objects do not justify Hilt; revisit if the graph grows.
 */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext

    // Keyring lives in <filesDir>/keyring/ — app-private, excluded from backups.
    // Created lazily, and only from GpgRepository's IO dispatcher, so the main thread never touches disk.
    private val keyring: GpgKeyringInterface by lazy { GpgKeyring(appContext.filesDir.absolutePath) }

    val gpgRepository: GpgRepository by lazy { GpgRepository({ keyring }, Dispatchers.IO) }
}
