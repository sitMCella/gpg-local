package com.gpglocal.app.ui

import android.net.Uri
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.gpglocal.app.R
import com.gpglocal.app.ui.decrypt.DecryptScreen
import com.gpglocal.app.ui.encrypt.EncryptScreen

/** App shell: top app bar, bottom navigation (Encrypt / Decrypt), snackbar host and the NavHost. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GpgLocalAppUi(navController: NavHostController = rememberNavController()) {
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val snackbar = remember(snackbarHostState, scope) { AppSnackbar(snackbarHostState, scope) }
    // A screen sets this while an operation is writing a file, so the user cannot switch tabs mid-write.
    var navigationLocked by remember { mutableStateOf(false) }

    CompositionLocalProvider(LocalAppSnackbar provides snackbar) {
        Scaffold(
            topBar = {
                CenterAlignedTopAppBar(title = { Text(stringResource(R.string.app_name)) })
            },
            bottomBar = { GpgLocalNavigationBar(navController, enabled = !navigationLocked) },
            snackbarHost = { SnackbarHost(snackbarHostState) },
        ) { innerPadding ->
            NavHost(
                navController = navController,
                startDestination = Destination.start.route,
                modifier = Modifier.padding(innerPadding),
            ) {
                composable(Destination.Encrypt.route) {
                    EncryptScreen(
                        onBusyChange = { navigationLocked = it },
                        onDecryptInstead = { uri -> navController.navigateToDecrypt(uri) },
                    )
                }
                composable(
                    Destination.decryptPattern,
                    arguments = listOf(
                        navArgument(Destination.ARG_URI) {
                            type = NavType.StringType
                            nullable = true
                            defaultValue = null
                        },
                    ),
                ) { entry ->
                    DecryptScreen(
                        initialUri = entry.arguments?.getString(Destination.ARG_URI)?.let(Uri::parse),
                    )
                }
            }
        }
    }
}

private fun NavHostController.navigateToDecrypt(uri: Uri) {
    navigate("${Destination.Decrypt.route}?${Destination.ARG_URI}=${Uri.encode(uri.toString())}") {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        // No restoreState: a restored entry would keep its old arguments instead of this URI.
    }
}

@Composable
private fun GpgLocalNavigationBar(navController: NavHostController, enabled: Boolean) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val current = backStackEntry?.destination
    NavigationBar {
        Destination.entries.forEach { destination ->
            val label = stringResource(destination.label)
            NavigationBarItem(
                selected = current?.hierarchy?.any { it.route?.substringBefore('?') == destination.route } == true,
                onClick = {
                    navController.navigate(destination.route) {
                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
                enabled = enabled,
                icon = { Icon(destination.icon, contentDescription = null) },
                label = { Text(label) },
                modifier = Modifier.testTag("nav_${destination.route}"),
            )
        }
    }
}
