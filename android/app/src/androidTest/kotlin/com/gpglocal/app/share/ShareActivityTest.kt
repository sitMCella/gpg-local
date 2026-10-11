package com.gpglocal.app.share

import android.app.Activity
import android.app.Instrumentation
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.view.WindowManager
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.core.content.IntentCompat
import androidx.lifecycle.Lifecycle
import androidx.test.core.app.ActivityScenario
import androidx.test.espresso.Espresso
import androidx.test.espresso.intent.Intents
import androidx.test.espresso.intent.Intents.intended
import androidx.test.espresso.intent.Intents.intending
import androidx.test.espresso.intent.matcher.IntentMatchers.hasAction
import androidx.test.espresso.intent.matcher.IntentMatchers.hasData
import androidx.test.espresso.intent.matcher.IntentMatchers.hasFlag
import androidx.test.espresso.intent.rule.IntentsRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.gpglocal.app.R
import com.gpglocal.core.GpgKeyring
import org.hamcrest.Matchers.allOf
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.util.UUID

/**
 * Share-sheet / "Open with" entry point against the real native library. Incoming files are real
 * content:// URIs from [TestDocumentProvider] (another package); the save picker is stubbed with
 * Espresso-Intents and answers with file:// URIs to temp files, as in the Encrypt/Decrypt tests.
 */
@RunWith(AndroidJUnit4::class)
class ShareActivityTest {

    @get:Rule(order = 0)
    val intentsRule = IntentsRule()

    @get:Rule(order = 1)
    val composeRule = createEmptyComposeRule()

    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private lateinit var dir: File
    private var scenario: ActivityScenario<ShareActivity>? = null

    private fun string(id: Int, vararg args: Any) = context.getString(id, *args)

    @Before
    fun setUp() {
        dir = File(context.cacheDir, "share-test-${UUID.randomUUID()}").apply { mkdirs() }
    }

    @After
    fun tearDown() {
        scenario?.close()
        TestDocumentProvider.clear(context)
        dir.deleteRecursively()
    }

    private fun shared(name: String, content: ByteArray) = TestDocumentProvider.put(context, name, content)

    private fun sendIntent(uri: Uri) = Intent(context, ShareActivity::class.java)
        .setAction(Intent.ACTION_SEND)
        .setType("application/octet-stream")
        .putExtra(Intent.EXTRA_STREAM, uri)
        .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

    private fun launch(intent: Intent): ActivityScenario<ShareActivity> =
        ActivityScenario.launch<ShareActivity>(intent).also { scenario = it }

    private fun waitForTag(tag: String) = composeRule.waitUntil(TIMEOUT_MS) {
        composeRule.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()
    }

    private fun waitForText(text: String) = composeRule.waitUntil(TIMEOUT_MS) {
        composeRule.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty()
    }

    private fun assertTitle(id: Int) {
        waitForText(string(id))
        composeRule.onNodeWithTag("share_title").assertTextEquals(string(id))
    }

    private fun assertAbsent(tag: String) =
        assertEquals(0, composeRule.onAllNodesWithTag(tag).fetchSemanticsNodes().size)

    private fun stubCreateDocument(output: File) {
        intending(hasAction(Intent.ACTION_CREATE_DOCUMENT))
            .respondWith(Instrumentation.ActivityResult(Activity.RESULT_OK, Intent().setData(Uri.fromFile(output))))
    }

    /** Shares `report.md`, encrypts it to [output] and waits for the result step. */
    private fun encryptViaShare(output: File, passphrase: String = "correct horse") {
        launch(sendIntent(shared("report.md", "attack at dawn".toByteArray())))
        waitForTag("encrypt_file_name")
        stubCreateDocument(output)
        composeRule.onNodeWithTag("encrypt_passphrase").performTextInput(passphrase)
        composeRule.onNodeWithTag("encrypt_confirm").performTextInput(passphrase)
        composeRule.onNodeWithTag("encrypt_submit").performScrollTo().performClick()
        waitForTag("share_result_title")
    }

    private fun waitForState(state: Lifecycle.State) {
        val deadline = System.currentTimeMillis() + TIMEOUT_MS
        while (scenario?.state != state && System.currentTimeMillis() < deadline) Thread.sleep(50)
        assertEquals(state, scenario?.state)
    }

    @Test
    fun shareTextFileOpensEncryptWithFilePreselected() {
        launch(sendIntent(shared("report.md", "hello".toByteArray())))

        assertTitle(R.string.share_title_encrypt)
        waitForTag("encrypt_file_name")
        composeRule.onNodeWithTag("encrypt_file_name").assertTextEquals("report.md")
        composeRule.onNodeWithText(string(R.string.output_name, "report.md.gpg")).assertIsDisplayed()
        assertAbsent("encrypt_change_file")
        assertAbsent("nav_encrypt")
        assertAbsent("nav_decrypt")
    }

    @Test
    fun shareGpgFileOpensDecrypt() {
        launch(sendIntent(shared("secret.gpg", "cipher".toByteArray())))

        assertTitle(R.string.share_title_decrypt)
        waitForTag("decrypt_file_name")
        composeRule.onNodeWithTag("decrypt_file_name").assertTextEquals("secret.gpg")
        assertAbsent("decrypt_change_file")
    }

    @Test
    fun viewGpgFileOpensDecrypt() {
        val uri = shared("secret.gpg", "cipher".toByteArray())
        launch(
            Intent(context, ShareActivity::class.java)
                .setAction(Intent.ACTION_VIEW)
                .setDataAndType(uri, "application/pgp-encrypted")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION),
        )

        assertTitle(R.string.share_title_decrypt)
        waitForTag("decrypt_file_name")
    }

    @Test
    fun encryptViaShareThenShareOnward() {
        val output = File(dir, "report.md.gpg")
        encryptViaShare(output)

        composeRule.onNodeWithTag("share_result_title").assertTextEquals(string(R.string.share_result_encrypted, "report.md"))
        composeRule.onNodeWithTag("share_result_output")
            .assertTextEquals(string(R.string.share_result_saved_as, "report.md.gpg"))
        val decrypted = GpgKeyring(File(dir, "keyring-home").apply { mkdirs() }.absolutePath)
            .use { it.decryptBytes(output.readBytes(), "correct horse") }
        assertArrayEquals("attack at dawn".toByteArray(), decrypted)

        intending(hasAction(Intent.ACTION_CHOOSER))
            .respondWith(Instrumentation.ActivityResult(Activity.RESULT_OK, null))
        composeRule.onNodeWithTag("share_result_share").performClick()
        composeRule.waitForIdle()

        val chooser = Intents.getIntents().last { it.action == Intent.ACTION_CHOOSER }
        val send = requireNotNull(IntentCompat.getParcelableExtra(chooser, Intent.EXTRA_INTENT, Intent::class.java))
        assertEquals(Intent.ACTION_SEND, send.action)
        assertEquals(Uri.fromFile(output), IntentCompat.getParcelableExtra(send, Intent.EXTRA_STREAM, Uri::class.java))
        assertTrue(send.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION != 0)
        val excluded = IntentCompat.getParcelableArrayExtra(chooser, Intent.EXTRA_EXCLUDE_COMPONENTS, ComponentName::class.java)
            .orEmpty().toList()
        assertTrue(ComponentName(context, ShareActivity::class.java) in excluded)
    }

    @Test
    fun decryptViaShareThenOpen() {
        val ciphertext = GpgKeyring(File(dir, "keyring-home").apply { mkdirs() }.absolutePath)
            .use { it.encryptBytes("attack at dawn".toByteArray(), emptyList(), "correct horse") }
        val output = File(dir, "report.md")
        launch(sendIntent(shared("report.md.gpg", ciphertext)))
        waitForTag("decrypt_file_name")
        stubCreateDocument(output)

        composeRule.onNodeWithTag("decrypt_passphrase").performTextInput("correct horse")
        composeRule.onNodeWithTag("decrypt_submit").performScrollTo().performClick()
        waitForTag("share_result_title")

        assertArrayEquals("attack at dawn".toByteArray(), output.readBytes())
        // Plaintext is never offered to a sharing chooser.
        assertAbsent("share_result_share")

        intending(hasAction(Intent.ACTION_VIEW)).respondWith(Instrumentation.ActivityResult(Activity.RESULT_OK, null))
        composeRule.onNodeWithTag("share_result_open").performClick()
        composeRule.waitForIdle()

        intended(
            allOf(
                hasAction(Intent.ACTION_VIEW),
                hasData(Uri.fromFile(output)),
                hasFlag(Intent.FLAG_GRANT_READ_URI_PERMISSION),
            ),
        )
    }

    @Test
    fun doneFinishesActivity() {
        encryptViaShare(File(dir, "report.md.gpg"))

        composeRule.onNodeWithTag("share_result_done").performClick()

        waitForState(Lifecycle.State.DESTROYED)
    }

    @Test
    fun fileSchemeIsRejected() {
        val file = File(dir, "report.md").apply { writeText("hello") }
        launch(sendIntent(Uri.fromFile(file)))

        waitForText(string(R.string.share_rejected_unsupported_scheme))
        assertAbsent("encrypt_file_name")

        composeRule.onNodeWithTag("share_rejected_close").performClick()
        waitForState(Lifecycle.State.DESTROYED)
    }

    @Test
    fun textShareIsRejected() {
        launch(
            Intent(context, ShareActivity::class.java)
                .setAction(Intent.ACTION_SEND)
                .setType("text/plain")
                .putExtra(Intent.EXTRA_TEXT, "hello"),
        )

        waitForText(string(R.string.share_rejected_no_file))
    }

    @Test
    fun rotationKeepsSharedFileAndResult() {
        launch(sendIntent(shared("report.md", "hello".toByteArray())))
        waitForTag("encrypt_file_name")
        composeRule.onNodeWithTag("encrypt_passphrase").performTextInput("correct horse")

        scenario!!.recreate()

        waitForTag("encrypt_file_name")
        composeRule.onNodeWithTag("encrypt_file_name").assertTextEquals("report.md")
        // Same process: the typed passphrase is kept in the ViewModel.
        composeRule.onAllNodesWithContentDescription(string(R.string.show_passphrase))[0].performScrollTo().performClick()
        composeRule.onNodeWithText("correct horse").performScrollTo().assertIsDisplayed()

        val output = File(dir, "report.md.gpg")
        stubCreateDocument(output)
        composeRule.onNodeWithTag("encrypt_confirm").performTextInput("correct horse")
        composeRule.onNodeWithTag("encrypt_submit").performScrollTo().performClick()
        waitForTag("share_result_title")

        scenario!!.recreate()

        waitForTag("share_result_title")
        composeRule.onNodeWithTag("share_result_output")
            .assertTextEquals(string(R.string.share_result_saved_as, "report.md.gpg"))
    }

    @Test
    fun closeIsBlockedWhileLoading() {
        // The test provider delays the first byte of "slow-" documents, so the operation stays in progress.
        launch(sendIntent(shared("${TestDocumentProvider.SLOW_PREFIX}report.md", "hello".toByteArray())))
        waitForTag("encrypt_file_name")
        stubCreateDocument(File(dir, "slow-report.md.gpg"))
        composeRule.onNodeWithTag("encrypt_passphrase").performTextInput("correct horse")
        composeRule.onNodeWithTag("encrypt_confirm").performTextInput("correct horse")
        composeRule.onNodeWithTag("encrypt_submit").performScrollTo().performClick()
        waitForTag("encrypt_progress")

        composeRule.onNodeWithTag("share_close").assertIsNotEnabled()
        Espresso.pressBackUnconditionally()
        composeRule.waitForIdle()
        assertTrue(scenario!!.state.isAtLeast(Lifecycle.State.RESUMED))

        waitForTag("share_result_title")
        composeRule.onNodeWithTag("share_close").assertIsEnabled()
    }

    @Test
    fun flagSecureIsSetInShareMode() {
        launch(sendIntent(shared("report.md", "hello".toByteArray())))
        waitForTag("encrypt_file_name")

        scenario!!.onActivity { activity ->
            assertTrue(activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
        }
    }

    private companion object {
        const val TIMEOUT_MS = 10_000L
    }
}
