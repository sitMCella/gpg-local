package com.gpglocal.app.ui.encrypt

import android.app.Application
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.lifecycle.SavedStateHandle
import com.gpglocal.app.data.DocumentStore
import com.gpglocal.app.data.FileEncryptor
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
class EncryptViewModelTest {

    @get:Rule
    val tmp = TemporaryFolder()

    private val dispatcher = StandardTestDispatcher()

    private val inputUri = Uri.parse("content://test/report.md")
    private val encryptedUri = Uri.parse("content://test/secret.gpg")
    private val outputUri = Uri.parse("content://test/out")

    private lateinit var documents: FakeDocuments
    private lateinit var gpg: FakeEncryptor
    private lateinit var savedState: SavedStateHandle

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        documents = FakeDocuments(tmp.newFile("plain.txt").apply { writeText("hello") }, tmp.newFile("out.gpg"))
        gpg = FakeEncryptor()
        savedState = SavedStateHandle()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun newViewModel() = EncryptViewModel(savedState, documents, gpg)

    private fun TestScope.collectEvents(vm: EncryptViewModel): MutableList<EncryptEvent> {
        val events = mutableListOf<EncryptEvent>()
        backgroundScope.launch(UnconfinedTestDispatcher(testScheduler)) { vm.events.collect { events += it } }
        return events
    }

    private fun TestScope.readyToSubmit(vm: EncryptViewModel, passphrase: String = "correct horse") {
        vm.onInputPicked(inputUri)
        advanceUntilIdle()
        vm.onPassphraseChange(passphrase)
        vm.onConfirmChange(passphrase)
    }

    @Test
    fun pickingFileSetsInputAndClearsPassphraseFields() = runTest(dispatcher) {
        val vm = newViewModel()
        vm.onPassphraseChange("left over")
        vm.onConfirmChange("left over")

        vm.onInputPicked(inputUri)
        advanceUntilIdle()

        val s = vm.state.value
        assertEquals(PickedDocument(inputUri, "report.md", 12L), s.input)
        assertEquals("", s.passphrase)
        assertEquals("", s.confirm)
        assertEquals("report.md.gpg", s.suggestedOutputName)
        assertTrue(s.canSubmit)
    }

    @Test
    fun invalidPassphraseSetsValidationErrorAndEmitsNothing() = runTest(dispatcher) {
        val vm = newViewModel()
        val events = collectEvents(vm)
        vm.onInputPicked(inputUri)
        advanceUntilIdle()

        vm.onSubmit()
        assertEquals(PassphraseError.Empty, vm.state.value.validationError)

        vm.onPassphraseChange("short")
        vm.onSubmit()
        assertEquals(PassphraseError.TooShort, vm.state.value.validationError)

        vm.onPassphraseChange("12345678")
        vm.onConfirmChange("87654321")
        vm.onSubmit()
        assertEquals(PassphraseError.Mismatch, vm.state.value.validationError)

        advanceUntilIdle()
        assertTrue(events.isEmpty())
    }

    @Test
    fun submittingAlreadyEncryptedInputDoesNothing() = runTest(dispatcher) {
        val vm = newViewModel()
        val events = collectEvents(vm)
        vm.onInputPicked(encryptedUri)
        advanceUntilIdle()
        vm.onPassphraseChange("correct horse")
        vm.onConfirmChange("correct horse")

        assertTrue(vm.state.value.alreadyEncrypted)
        assertFalse(vm.state.value.canSubmit)
        vm.onSubmit()
        advanceUntilIdle()

        assertTrue(events.isEmpty())
        assertNull(vm.state.value.validationError)
    }

    @Test
    fun validSubmitRequestsOutputLocation() = runTest(dispatcher) {
        val vm = newViewModel()
        val events = collectEvents(vm)
        readyToSubmit(vm)

        vm.onSubmit()
        advanceUntilIdle()

        assertEquals(listOf(EncryptEvent.RequestOutputLocation("report.md.gpg")), events)
    }

    @Test
    fun cancelledSavePickerKeepsStateAndDoesNotEncrypt() = runTest(dispatcher) {
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
        documents.outputName = "report.md (1).gpg"
        val vm = newViewModel()
        val events = collectEvents(vm)
        readyToSubmit(vm)
        vm.onSubmit()

        vm.onOutputPicked(outputUri)
        advanceUntilIdle()

        assertEquals(1, gpg.calls)
        assertEquals("correct horse", gpg.lastPassphrase)
        assertEquals(EncryptUiState(), vm.state.value)
        assertEquals(EncryptEvent.Encrypted("report.md", "report.md (1).gpg"), events.last())
        assertTrue(documents.deleted.isEmpty())
    }

    @Test
    fun gpgFailureSetsFailureAndDeletesOutput() = runTest(dispatcher) {
        gpg.result = GpgResult.Failure(GpgFailure.Io("disk full"))
        val vm = newViewModel()
        readyToSubmit(vm)
        vm.onSubmit()

        vm.onOutputPicked(outputUri)
        advanceUntilIdle()

        val s = vm.state.value
        assertEquals("disk full", s.failure)
        assertFalse(s.loading)
        assertNull(s.cleanupFailedFor)
        assertEquals("correct horse", s.passphrase) // form kept
        assertEquals(listOf(outputUri), documents.deleted)
    }

    @Test
    fun failedDeleteSetsCleanupFailedFor() = runTest(dispatcher) {
        gpg.result = GpgResult.Failure(GpgFailure.Crypto("boom"))
        documents.deleteSucceeds = false
        documents.outputName = "report.md.gpg"
        val vm = newViewModel()
        readyToSubmit(vm)
        vm.onSubmit()

        vm.onOutputPicked(outputUri)
        advanceUntilIdle()

        assertEquals("report.md.gpg", vm.state.value.cleanupFailedFor)
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
        assertFalse(vm.state.value.loading)
        assertEquals(listOf(outputUri), documents.deleted)
        assertEquals(0, gpg.calls)
    }

    @Test
    fun secondSubmitWhileLoadingIsIgnored() = runTest(dispatcher) {
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
        assertTrue(events.single() is EncryptEvent.Encrypted)
    }

    @Test
    fun passphraseIsNeverWrittenToSavedStateHandle() = runTest(dispatcher) {
        val vm = newViewModel()
        readyToSubmit(vm)
        vm.onSubmit()
        advanceUntilIdle()

        assertEquals(setOf(EncryptViewModel.KEY_INPUT_URI), savedState.keys())
        assertEquals(inputUri, savedState.get<Uri>(EncryptViewModel.KEY_INPUT_URI))
    }

    @Test
    fun restoredViewModelHasInputButNoPassphrase() = runTest(dispatcher) {
        savedState[EncryptViewModel.KEY_INPUT_URI] = inputUri

        val vm = newViewModel()
        advanceUntilIdle()

        assertEquals(inputUri, vm.state.value.input?.uri)
        assertEquals("", vm.state.value.passphrase)
    }

    @Test
    fun outputPickedWithoutPassphraseAfterRestoreDeletesOutput() = runTest(dispatcher) {
        savedState[EncryptViewModel.KEY_INPUT_URI] = inputUri
        val vm = newViewModel()
        advanceUntilIdle()

        vm.onOutputPicked(outputUri)
        advanceUntilIdle()

        assertEquals(0, gpg.calls)
        assertEquals(listOf(outputUri), documents.deleted)
        assertEquals(PassphraseError.Empty, vm.state.value.validationError)
    }

    private class FakeDocuments(private val inputFile: File, private val outputFile: File) : DocumentStore {
        var outputName = "report.md.gpg"
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

    private class FakeEncryptor : FileEncryptor {
        var result: GpgResult<Unit> = GpgResult.Success(Unit)
        var calls = 0
        var lastPassphrase: String? = null

        override suspend fun encryptFd(
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
