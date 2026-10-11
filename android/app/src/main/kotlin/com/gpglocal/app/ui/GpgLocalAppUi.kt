package com.gpglocal.app.ui

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.CenterAlignedTopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import com.gpglocal.app.R
import com.gpglocal.app.ui.decrypt.DecryptScreen
import com.gpglocal.app.ui.encrypt.EncryptScreen

/** App shell: top app bar, bottom navigation (Encrypt / Decrypt) and the NavHost between them. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GpgLocalAppUi(navController: NavHostController = rememberNavController()) {
    Scaffold(
        topBar = {
            CenterAlignedTopAppBar(title = { Text(stringResource(R.string.app_name)) })
        },
        bottomBar = { GpgLocalNavigationBar(navController) },
    ) { innerPadding ->
        NavHost(
            navController = navController,
            startDestination = Destination.start.route,
            modifier = Modifier.padding(innerPadding),
        ) {
            composable(Destination.Encrypt.route) { EncryptScreen() }
            composable(Destination.Decrypt.route) { DecryptScreen() }
        }
    }
}

@Composable
private fun GpgLocalNavigationBar(navController: NavHostController) {
    val backStackEntry by navController.currentBackStackEntryAsState()
    val current = backStackEntry?.destination
    NavigationBar {
        Destination.entries.forEach { destination ->
            val label = stringResource(destination.label)
            NavigationBarItem(
                selected = current?.hierarchy?.any { it.route == destination.route } == true,
                onClick = {
                    navController.navigate(destination.route) {
                        popUpTo(navController.graph.findStartDestination().id) { saveState = true }
                        launchSingleTop = true
                        restoreState = true
                    }
                },
                icon = { Icon(destination.icon, contentDescription = null) },
                label = { Text(label) },
                modifier = Modifier.testTag("nav_${destination.route}"),
            )
        }
    }
}
