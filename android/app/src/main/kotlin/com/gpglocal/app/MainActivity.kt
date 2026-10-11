package com.gpglocal.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.gpglocal.app.ui.GpgLocalAppUi
import com.gpglocal.app.ui.theme.GpgLocalTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            GpgLocalTheme {
                GpgLocalAppUi()
            }
        }
    }
}
