package com.gpglocal.app

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotSelected
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class GpgLocalAppUiTest {

    @get:Rule
    val composeRule = createAndroidComposeRule<MainActivity>()

    private fun string(id: Int) = composeRule.activity.getString(id)

    @Test
    fun appLaunchesOnEncryptTab() {
        composeRule.onNodeWithText(string(R.string.app_name)).assertIsDisplayed()
        composeRule.onNodeWithTag("nav_encrypt").assertIsSelected()
        composeRule.onNodeWithTag("nav_decrypt").assertIsNotSelected()
        composeRule.onNodeWithText(string(R.string.encrypt_no_file)).assertIsDisplayed()
    }

    @Test
    fun switchingToDecryptShowsDecryptScreen() {
        composeRule.onNodeWithTag("nav_decrypt").performClick()

        composeRule.onNodeWithText(string(R.string.decrypt_placeholder)).assertIsDisplayed()
        composeRule.onNodeWithTag("nav_decrypt").assertIsSelected()
        composeRule.onNodeWithTag("nav_encrypt").assertIsNotSelected()
    }

    @Test
    fun tabStateSurvivesRecreation() {
        composeRule.onNodeWithTag("nav_decrypt").performClick()
        composeRule.onNodeWithTag("nav_decrypt").assertIsSelected()

        composeRule.activityRule.scenario.recreate()

        composeRule.onNodeWithTag("nav_decrypt").assertIsSelected()
        composeRule.onNodeWithText(string(R.string.decrypt_placeholder)).assertIsDisplayed()
    }
}
