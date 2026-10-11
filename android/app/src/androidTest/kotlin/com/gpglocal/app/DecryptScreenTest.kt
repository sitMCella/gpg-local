package com.gpglocal.app

import android.app.Activity
import android.app.Instrumentation
import android.content.Intent
import android.net.Uri
import android.view.WindowManager
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertIsSelected
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.text.AnnotatedString
import androidx.test.espresso.intent.Intents.intended
import androidx.test.espresso.intent.Intents.intending
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction
import androidx.test.espresso.intent.matcher.IntentMatchers.hasData
import androidx.test.espresso.intent.matcher.IntentMatchers.hasExtra
import androidx.test.espresso.intent.matcher.IntentMatchers.hasFlag
import androidx.test.espresso.intent.matcher.IntentMatchers.hasType
import androidx.test.espresso.intent.rule.IntentsRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.gpglocal.core.GpgKeyring
import org.hamcrest.Matchers.allOf
import org.hamcrest.Matchers.isEmptyOrNullString
import org.hamcrest.Matchers.not
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
 * Decrypt flow against the real native library. SAF pickers are stubbed with Espresso-Intents and
 * answer with file:// URIs to temp files, which DocumentRepository handles like any document.
 */
@RunWith(AndroidJUnit4::class)
class DecryptScreenTest {

    @get:Rule(order = 0)
    val intentsRule = IntentsRule()

    @get:Rule(order = 1)
    val composeRule = createAndroidComposeRule<MainActivity>()

    private lateinit var dir: File

    private fun string(id: Int, vararg args: Any) = composeRule.activity.getString(id, *args)

    @Before
    fun setUp() {
        dir = File(composeRule.activity.cacheDir, "decrypt-test-${UUID.randomUUID()}").apply { mkdirs() }
    }

    @After
    fun tearDown() {
        dir.deleteRecursively()
    }

    private fun file(name: String, content: ByteArray? = null): File =
        File(dir, name).apply { content?.let(::writeBytes) }

    private fun asset(name: String): ByteArray =
        InstrumentationRegistry.getInstrumentation().context.assets.open(name).use { it.readBytes() }

    private fun encryptWithCore(plaintext: String, passphrase: String): ByteArray {
        val keyring = GpgKeyring(File(dir, "keyring-home").apply { mkdirs() }.absolutePath)
        return keyring.use { it.encryptBytes(plaintext.toByteArray(), emptyList(), passphrase) }
    }

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

    private fun openDecryptTab() {
        composeRule.onNodeWithTag("nav_decrypt").performClick()
        waitForTag("decrypt_choose_file")
    }

    private fun pick(file: File) {
        stubOpenDocument(Uri.fromFile(file))
        composeRule.onNodeWithTag("decrypt_choose_file").performClick()
        waitForText(file.name)
    }

    /** Picks [input], enters [passphrase] and lets the save picker answer with [output]. */
    private fun decrypt(input: File, passphrase: String, output: File) {
        pick(input)
        stubCreateDocument(Uri.fromFile(output))
        composeRule.onNodeWithTag("decrypt_passphrase").performTextInput(passphrase)
        composeRule.onNodeWithTag("decrypt_submit").performClick()
    }

    private fun waitForText(text: String) = composeRule.waitUntil(TIMEOUT_MS) {
        composeRule.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    }

    private fun waitForTag(tag: String) = composeRule.waitUntil(TIMEOUT_MS) {
        composeRule.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()
    }

    @Test
    fun decryptAndroidEncryptedFile() {
        val plaintext = "attack at dawn"
        val output = file("report.md", ByteArray(0))
        openDecryptTab()

        decrypt(file("report.md.gpg", encryptWithCore(plaintext, "correct horse")), "correct horse", output)
        waitForText("report.md.gpg decrypted → report.md")

        assertArrayEquals(plaintext.toByteArray(), output.readBytes())
        // The form is reset.
        composeRule.onNodeWithText(string(R.string.no_file_selected)).assertIsDisplayed()
    }

    @Test
    fun decryptDesktopFixture() {
        val output = file("desktop-symmetric.txt", ByteArray(0))
        openDecryptTab()

        decrypt(file("desktop-symmetric.txt.gpg", asset("desktop-symmetric.txt.gpg")), "correct horse", output)
        waitForText("desktop-symmetric.txt.gpg decrypted → desktop-symmetric.txt")

        assertEquals("Encrypted by GPG Local desktop.\n", output.readText())
    }

    @Test
    fun decryptGpgCliFixture() {
        // Made with: gpg --symmetric --cipher-algo AES256 (passphrase "correct horse").
        val output = file("gpg-cli-symmetric.txt", ByteArray(0))
        openDecryptTab()

        decrypt(file("gpg-cli-symmetric.txt.gpg", asset("gpg-cli-symmetric.txt.gpg")), "correct horse", output)
        waitForText("gpg-cli-symmetric.txt.gpg decrypted → gpg-cli-symmetric.txt")

        assertEquals("Encrypted by gpg --symmetric.\n", output.readText())
    }

    @Test
    fun wrongPassphraseShowsDesktopMessageAndDeletesOutput() {
        val input = file("report.md.gpg", encryptWithCore("secret", "correct horse"))
        val original = input.readBytes()
        val output = file("report.md", ByteArray(0)) // the save picker has already created it
        openDecryptTab()

        decrypt(input, "wrong passphrase", output)
        waitForTag("decrypt_failure")

        composeRule.onNodeWithText(
            "Decryption failed. Check your passphrase and try again. (no matching secret key found)",
        ).assertIsDisplayed()
        assertFalse("partial output must be deleted", output.exists())
        assertArrayEquals("the encrypted original is unchanged", original, input.readBytes())
        composeRule.onNodeWithTag("decrypt_passphrase")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        composeRule.onNodeWithTag("decrypt_file_name").assertTextEquals("report.md.gpg")
    }

    @Test
    fun emptyPassphraseValidation() {
        openDecryptTab()
        pick(file("report.md.gpg", byteArrayOf(1)))

        composeRule.onNodeWithTag("decrypt_submit").performClick()

        waitForText("Passphrase must not be empty.")
    }

    @Test
    fun nonEncryptedFileShowsBanner() {
        openDecryptTab()
        pick(file("notes.txt", "hello".toByteArray()))

        composeRule.onNodeWithText(string(R.string.decrypt_not_encrypted)).assertIsDisplayed()
        composeRule.onNodeWithTag("decrypt_submit").assertIsNotEnabled()
        composeRule.onNodeWithTag("decrypt_passphrase").assertIsNotEnabled()

        composeRule.onNodeWithTag("decrypt_go_to_encrypt").performClick()
        waitForTag("encrypt_file_name")
        composeRule.onNodeWithTag("nav_encrypt").assertIsSelected()
        composeRule.onNodeWithTag("encrypt_file_name").assertTextEquals("notes.txt")
    }

    @Test
    fun decryptItInsteadFromEncryptPrefills() {
        val secret = file("secret.gpg", byteArrayOf(1))
        stubOpenDocument(Uri.fromFile(secret))
        composeRule.onNodeWithTag("encrypt_choose_file").performClick()
        waitForText("secret.gpg")

        composeRule.onNodeWithTag("encrypt_go_to_decrypt").performClick()
        waitForTag("decrypt_file_name")

        composeRule.onNodeWithTag("nav_decrypt").assertIsSelected()
        composeRule.onNodeWithTag("decrypt_file_name").assertTextEquals("secret.gpg")
        composeRule.onNodeWithTag("decrypt_output_name").assertTextEquals(string(R.string.output_name, "secret"))
    }

    @Test
    fun savePickerGetsSuggestedNameAndMime() {
        openDecryptTab()
        pick(file("report.md.gpg", byteArrayOf(1)))
        stubCreateDocument(null)
        composeRule.onNodeWithTag("decrypt_passphrase").performTextInput("correct horse")

        composeRule.onNodeWithTag("decrypt_submit").performClick()
        composeRule.waitForIdle()

        intended(
            allOf(
                hasAction(Intent.ACTION_CREATE_DOCUMENT),
                hasExtra(Intent.EXTRA_TITLE, "report.md"),
                hasType(not(isEmptyOrNullString())),
            ),
        )
        // Cancelling keeps the form without an error.
        assertTrue(composeRule.onAllNodesWithTag("decrypt_failure").fetchSemanticsNodes().isEmpty())
    }

    @Test
    fun openActionLaunchesViewIntent() {
        val output = file("report.md", ByteArray(0))
        val outputUri = Uri.fromFile(output)
        intending(hasAction(Intent.ACTION_VIEW))
            .respondWith(Instrumentation.ActivityResult(Activity.RESULT_OK, null))
        openDecryptTab()

        decrypt(file("report.md.gpg", encryptWithCore("hello", "correct horse")), "correct horse", output)
        waitForText(string(R.string.decrypt_open))
        composeRule.onNodeWithText(string(R.string.decrypt_open)).performClick()
        composeRule.waitForIdle()

        intended(
            allOf(
                hasAction(Intent.ACTION_VIEW),
                hasData(outputUri),
                hasFlag(Intent.FLAG_GRANT_READ_URI_PERMISSION),
            ),
        )
    }

    @Test
    fun flagSecureIsSetOnDecryptScreen() {
        openDecryptTab()
        composeRule.waitForIdle()

        composeRule.runOnIdle {
            val flags = composeRule.activity.window.attributes.flags
            assertTrue(flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
        }
    }

    private companion object {
        const val TIMEOUT_MS = 10_000L
    }
}
