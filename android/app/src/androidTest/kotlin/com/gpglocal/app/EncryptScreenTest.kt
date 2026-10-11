package com.gpglocal.app

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.net.Uri
import android.view.WindowManager
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performImeAction
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.espresso.intent.Intents.intended
import androidx.test.espresso.intent.Intents.intending
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction
import androidx.test.espresso.intent.matcher.IntentMatchers.hasExtra
import androidx.test.espresso.intent.rule.IntentsRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.gpglocal.core.GpgKeyring
import org.hamcrest.Matchers.allOf
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/**
 * Encrypt flow against the real native library. SAF pickers are stubbed with Espresso-Intents and
 * answer with file:// URIs to temp files, which DocumentRepository handles like any document.
 */
@RunWith(AndroidJUnit4::class)
class EncryptScreenTest {

    @get:Rule(order = 0)
    val intentsRule = IntentsRule()

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    private lateinit var dir: File

    private fun string(id: Int, vararg args: Any) = composeRule.activity.getString(id, *args)

    @Before
    fun setUp() {
        dir = File(composeRule.activity.cacheDir, "encrypt-test-${UUID.randomUUID()}").apply { mkdirs() }
    }

    @After
    fun tearDown() {
        dir.deleteRecursively()
    }

    private fun file(name: String, content: String? = null): File =
        File(dir, name).apply { content?.let(::writeText) }

    private fun stubOpenDocument(uri: Uri) {
        intending(hasAction(Intent.ACTION_OPEN_DOCUMENT))
            .respondWith(Instrumentation.ActivityResult(Activity.RESULT_OK, Intent().setData(uri)))
    }

    private fun stubCreateDocument(uri: Uri?) {
        val result = if (uri == null) {
            Instrumentation.ActivityResult(Activity.RESULT_CANCELED, null)
        } else {
            Instrumentation.ActivityResult(Activity.RESULT_OK, Intent().setData(uri))
        }
        intending(hasAction(Intent.ACTION_CREATE_DOCUMENT)).respondWith(result)
    }

    private fun pick(file: File) {
        stubOpenDocument(Uri.fromFile(file))
        composeRule.onNodeWithTag("encrypt_choose_file").performClick()
        waitForText(file.name)
    }

    private fun enterPassphrase(passphrase: String, confirm: String = passphrase) {
        composeRule.onNodeWithTag("encrypt_passphrase").performTextInput(passphrase)
        composeRule.onNodeWithTag("encrypt_confirm").performTextInput(confirm)
    }

    private fun waitForText(text: String) = composeRule.waitUntil(TIMEOUT_MS) {
        composeRule.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    }

    @Test
    fun pickingFileShowsNameAndOutput() {
        pick(file("report.md", "hello"))

        composeRule.onNodeWithText("report.md").assertIsDisplayed()
        composeRule.onNodeWithText(string(R.string.output_name, "report.md.gpg")).assertIsDisplayed()
    }

    @Test
    fun validationMessagesMatchDesktop() {
        pick(file("report.md", "hello"))

        composeRule.onNodeWithTag("encrypt_submit").performScrollTo().performClick()
        waitForText("Passphrase must not be empty.")

        enterPassphrase("short")
        composeRule.onNodeWithTag("encrypt_submit").performScrollTo().performClick()
        waitForText("Passphrase must be at least 8 characters.")

        composeRule.onNodeWithTag("encrypt_passphrase").performTextInput("-long-enough")
        composeRule.onNodeWithTag("encrypt_submit").performScrollTo().performClick()
        waitForText("Passphrases do not match.")
    }

    @Test
    fun confirmImeDoneSubmits() {
        pick(file("report.md", "hello"))
        stubCreateDocument(null)
        enterPassphrase("correct horse")

        composeRule.onNodeWithTag("encrypt_confirm").performImeAction()
        composeRule.waitForIdle()

        intended(allOf(hasAction(Intent.ACTION_CREATE_DOCUMENT), hasExtra(Intent.EXTRA_TITLE, "report.md.gpg")))
    }

    @Test
    fun endToEndEncryptThenCoreDecrypts() {
        val plaintext = "attack at dawn"
        val output = file("report.md.gpg")
        pick(file("report.md", plaintext))
        stubCreateDocument(Uri.fromFile(output))
        enterPassphrase("correct horse")

        composeRule.onNodeWithTag("encrypt_submit").performScrollTo().performClick()
        waitForText("report.md encrypted → report.md.gpg")

        val ciphertext = output.readBytes()
        assertTrue("output must start with an OpenPGP packet header", ciphertext[0].toInt() and 0x80 != 0)
        val keyring = GpgKeyring(File(dir, "keyring-home").apply { mkdirs() }.absolutePath)
        val decrypted = keyring.use { it.decryptBytes(ciphertext, "correct horse") }
        assertArrayEquals(plaintext.toByteArray(), decrypted)
        // The form is reset, including the passphrase.
        composeRule.onNodeWithText(string(R.string.no_file_selected)).assertIsDisplayed()
    }

    @Test
    fun unreadableInputDeletesOutput() {
        val missing = file("missing.txt") // never written
        val output = file("missing.txt.gpg", "") // the save picker has already created it
        pick(missing)
        stubCreateDocument(Uri.fromFile(output))
        enterPassphrase("correct horse")

        composeRule.onNodeWithTag("encrypt_submit").performScrollTo().performClick()
        composeRule.waitUntil(TIMEOUT_MS) {
            composeRule.onAllNodesWithTag("encrypt_failure").fetchSemanticsNodes().isNotEmpty()
        }

        assertFalse("partial output must be deleted", output.exists())
    }

    @Test
    fun alreadyEncryptedFileBlocksEncryption() {
        pick(file("secret.gpg", "not really"))

        composeRule.onNodeWithText(string(R.string.encrypt_already_encrypted)).assertIsDisplayed()
        composeRule.onNodeWithTag("encrypt_submit").assertIsNotEnabled()
        composeRule.onNodeWithTag("encrypt_passphrase").assertIsNotEnabled()

        composeRule.onNodeWithTag("encrypt_go_to_decrypt").performClick()
        composeRule.onNodeWithTag("nav_decrypt").assertIsSelected()
    }

    @Test
    fun cancelledSavePickerKeepsForm() {
        pick(file("report.md", "hello"))
        stubCreateDocument(null)
        enterPassphrase("correct horse")

        composeRule.onNodeWithTag("encrypt_submit").performScrollTo().performClick()
        composeRule.waitForIdle()

        composeRule.onNodeWithTag("encrypt_submit").performScrollTo().assertIsDisplayed()
        assertEquals(0, composeRule.onAllNodesWithText("Encryption failed.", substring = true).fetchSemanticsNodes().size)
        // Values survive: toggling visibility reveals what was typed.
        composeRule.onAllNodesWithContentDescription(string(R.string.show_passphrase))[0].performScrollTo().performClick()
        composeRule.onNodeWithText("correct horse").performScrollTo().assertIsDisplayed()
    }

    @Test
    fun flagSecureIsSetOnEncryptScreen() {
        composeRule.runOnIdle {
            val flags = composeRule.activity.window.attributes.flags
            assertTrue(flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
        }
    }

    private companion object {
        const val TIMEOUT_MS = 10_000L
    }
}
