package com.gpglocal.app.ui.decrypt

import android.app.Application
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.lifecycle.SavedStateHandle
import com.gpglocal.app.data.DocumentStore
import com.gpglocal.app.data.FileDecryptor
import com.gpglocal.app.data.GpgFailure
import com.gpglocal.app.data.GpgResult
import com.gpglocal.app.data.PickedDocument
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.io.FileNotFoundException

// Robolectric provides real Uri / ParcelFileDescriptor / SavedStateHandle implementations on the JVM.
@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class DecryptViewModelTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private val dispatcher = StandardTestDispatcher()

    private val inputUri = Uri.parse("content://test/report.md.gpg")
    private val plainUri = Uri.parse("content://test/notes.txt")
    private val outputUri = Uri.parse("content://test/out")
    private val mimeLookup = mapOf("md" to "text/markdown")::get

    private lateinit var documents: FakeDocuments
    private lateinit var gpg: FakeDecryptor
    private lateinit var savedState: SavedStateHandle

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        documents = FakeDocuments(tmp.newFile("in.gpg").apply { writeText("cipher") }, tmp.newFile("out"))
        gpg = FakeDecryptor()
        savedState = SavedStateHandle()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun newViewModel() = DecryptViewModel(savedState, documents, gpg, mimeLookup)

    private fun TestScope.collectEvents(vm: DecryptViewModel): MutableList<DecryptEvent> {
        val events = mutableListOf<DecryptEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.events.collect { events += it } }
        return events
    }

    private fun TestScope.readyToSubmit(vm: DecryptViewModel, passphrase: String = "correct horse") {
        vm.onInputPicked(inputUri)
        advanceUntilIdle()
        vm.onPassphraseChange(passphrase)
    }

    @Test
    fun navArgumentUriIsPickedOnInit() = runTest(dispatcher) {
        savedState[DecryptViewModel.KEY_HANDED_OVER_URI] = inputUri.toString()

        val vm = newViewModel()
        advanceUntilIdle()

        assertEquals(PickedDocument(inputUri, "report.md.gpg", 12L), vm.state.value.input)
        assertEquals("report.md", vm.state.value.suggestedOutputName)
        // Consumed once: after process death the saved input URI takes over.
        assertFalse(savedState.contains(DecryptViewModel.KEY_HANDED_OVER_URI))
        assertEquals(inputUri, savedState.get<Uri>(DecryptViewModel.KEY_INPUT_URI))
    }

    @Test
    fun nonEncryptedInputSetsNotEncryptedAndSubmitDoesNothing() = runTest(dispatcher) {
        val vm = newViewModel()
        val events = collectEvents(vm)
        vm.onInputPicked(plainUri)
        advanceUntilIdle()
        vm.onPassphraseChange("correct horse")

        assertTrue(vm.state.value.notEncrypted)
        assertFalse(vm.state.value.canSubmit)
        vm.onSubmit()
        advanceUntilIdle()

        assertTrue(events.isEmpty())
        assertFalse(vm.state.value.validationError)
    }

    @Test
    fun emptyPassphraseSetsValidationErrorAndEmitsNothing() = runTest(dispatcher) {
        val vm = newViewModel()
        val events = collectEvents(vm)
        vm.onInputPicked(inputUri)
        advanceUntilIdle()

        vm.onSubmit()
        advanceUntilIdle()

        assertTrue(vm.state.value.validationError)
        assertTrue(events.isEmpty())

        vm.onPassphraseChange("x")
        assertFalse(vm.state.value.validationError)
    }

    @Test
    fun validSubmitRequestsOutputLocationWithMimeType() = runTest(dispatcher) {
        val vm = newViewModel()
        val events = collectEvents(vm)
        readyToSubmit(vm)

        vm.onSubmit()
        advanceUntilIdle()

        assertEquals(listOf(DecryptEvent.RequestOutputLocation("report.md", "text/markdown")), events)
    }

    @Test
    fun cancelledSavePickerKeepsStateAndDoesNotDecrypt() = runTest(dispatcher) {
        val vm = newViewModel()
        readyToSubmit(vm)
        vm.onSubmit()
        val before = vm.state.value

        vm.onOutputPicked(null)
        advanceUntilIdle()

        assertEquals(before, vm.state.value)
        assertEquals(0, gpg.calls)
    }

    @Test
    fun successResetsStateAndEmitsProviderOutputName() = runTest(dispatcher) {
        documents.outputName = "report (1).md"
        val vm = newViewModel()
        val events = collectEvents(vm)
        readyToSubmit(vm)
        vm.onSubmit()

        vm.onOutputPicked(outputUri)
        advanceUntilIdle()

        assertEquals(1, gpg.calls)
        assertEquals("correct horse", gpg.lastPassphrase)
        assertEquals(DecryptUiState(), vm.state.value)
        assertEquals(
            DecryptEvent.Decrypted("report.md.gpg", "report (1).md", outputUri, "text/markdown"),
            events.last(),
        )
        assertTrue(documents.deleted.isEmpty())
        assertFalse(savedState.contains(DecryptViewModel.KEY_INPUT_URI))
    }

    @Test
    fun wrongPassphraseClearsPassphraseKeepsFileAndDeletesOutput() = runTest(dispatcher) {
        gpg.result = GpgResult.Failure(GpgFailure.WrongPassphrase("no matching secret key found"))
        val vm = newViewModel()
        readyToSubmit(vm)
        vm.onSubmit()

        vm.onOutputPicked(outputUri)
        advanceUntilIdle()

        val s = vm.state.value
        assertEquals("no matching secret key found", s.failure)
        assertEquals("", s.passphrase)
        assertEquals(inputUri, s.input?.uri)
        assertFalse(s.loading)
        assertNull(s.cleanupFailedFor)
        assertEquals(listOf(outputUri), documents.deleted)
    }

    @Test
    fun failedDeleteSetsCleanupFailedFor() = runTest(dispatcher) {
        gpg.result = GpgResult.Failure(GpgFailure.Crypto("boom"))
        documents.deleteSucceeds = false
        documents.outputName = "report.md"
        val vm = newViewModel()
        readyToSubmit(vm)
        vm.onSubmit()

        vm.onOutputPicked(outputUri)
        advanceUntilIdle()

        assertEquals("report.md", vm.state.value.cleanupFailedFor)
    }

    @Test
    fun openForReadExceptionDeletesOutputAndReportsIoFailure() = runTest(dispatcher) {
        documents.readFails = true
        val vm = newViewModel()
        readyToSubmit(vm)
        vm.onSubmit()

        vm.onOutputPicked(outputUri)
        advanceUntilIdle()

        assertEquals("input gone", vm.state.value.failure)
        assertNull(vm.state.value.input)
        assertEquals(listOf(outputUri), documents.deleted)
        assertEquals(0, gpg.calls)
    }

    @Test
    fun submitWhileLoadingIsIgnored() = runTest(dispatcher) {
        val vm = newViewModel()
        val events = collectEvents(vm)
        readyToSubmit(vm)
        vm.onSubmit()
        advanceUntilIdle()
        events.clear()

        vm.onOutputPicked(outputUri)
        assertTrue(vm.state.value.loading)
        vm.onSubmit()
        vm.onOutputPicked(outputUri)
        advanceUntilIdle()

        assertEquals(1, gpg.calls)
        assertEquals(1, events.size)
        assertTrue(events.single() is DecryptEvent.Decrypted)
    }

    @Test
    fun passphraseIsNeverWrittenToSavedStateHandle() = runTest(dispatcher) {
        val vm = newViewModel()
        readyToSubmit(vm)
        vm.onSubmit()
        advanceUntilIdle()

        assertEquals(setOf(DecryptViewModel.KEY_INPUT_URI), savedState.keys())
        assertEquals(inputUri, savedState.get<Uri>(DecryptViewModel.KEY_INPUT_URI))
    }

    @Test
    fun outputPickedWithoutPassphraseAfterRestoreDeletesOutput() = runTest(dispatcher) {
        savedState[DecryptViewModel.KEY_INPUT_URI] = inputUri
        val vm = newViewModel()
        advanceUntilIdle()
        assertEquals(inputUri, vm.state.value.input?.uri)
        assertEquals("", vm.state.value.passphrase)

        vm.onOutputPicked(outputUri)
        advanceUntilIdle()

        assertEquals(0, gpg.calls)
        assertEquals(listOf(outputUri), documents.deleted)
        assertTrue(vm.state.value.validationError)
    }

    private class FakeDocuments(private val inputFile: File, private val outputFile: File) : DocumentStore {
        var outputName = "report.md"
        var readFails = false
        var deleteSucceeds = true
        val deleted = mutableListOf<Uri>()

        override suspend fun describe(uri: Uri): PickedDocument =
            if (uri.lastPathSegment == "out") {
                PickedDocument(uri, outputName, null)
            } else {
                PickedDocument(uri, requireNotNull(uri.lastPathSegment), 12L)
            }

        override suspend fun openForRead(uri: Uri): ParcelFileDescriptor {
            if (readFails) throw FileNotFoundException("input gone")
            return ParcelFileDescriptor.open(inputFile, ParcelFileDescriptor.MODE_READ_ONLY)
        }

        override suspend fun openForWrite(uri: Uri): ParcelFileDescriptor = ParcelFileDescriptor.open(
            outputFile,
            ParcelFileDescriptor.MODE_WRITE_ONLY or ParcelFileDescriptor.MODE_TRUNCATE,
        )

        override suspend fun delete(uri: Uri): Boolean {
            deleted += uri
            return deleteSucceeds
        }
    }

    private class FakeDecryptor : FileDecryptor {
        var result: GpgResult<Unit> = GpgResult.Success(Unit)
        var calls = 0
        var lastPassphrase: String? = null

        override suspend fun decryptFd(
            input: ParcelFileDescriptor,
            output: ParcelFileDescriptor,
            passphrase: String,
        ): GpgResult<Unit> {
            calls++
            lastPassphrase = passphrase
            // Mirrors the Rust contract: both descriptors are closed on success and on error.
            input.close()
            output.close()
            return result
        }
    }
}
