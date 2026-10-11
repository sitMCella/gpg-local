package com.gpglocal.app.share

import android.app.Application
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.lifecycle.SavedStateHandle
import com.gpglocal.app.data.DocumentStore
import com.gpglocal.app.data.PickedDocument
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@OptIn(ExperimentalCoroutinesApi::class)
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ShareViewModelTest {

    private val dispatcher = StandardTestDispatcher()
    private val plainUri = Uri.parse("content://com.example.files/report.md")
    private val encryptedUri = Uri.parse("content://com.example.files/secret.gpg")
    private val outputUri = Uri.parse("content://com.example.files/report.md.gpg")

    private lateinit var documents: FakeDocuments
    private lateinit var savedState: SavedStateHandle

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
        documents = FakeDocuments()
        savedState = SavedStateHandle()
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    private fun newViewModel(incoming: IncomingFile) = ShareViewModel(savedState, documents, incoming)

    @Test
    fun acceptedFileIsRoutedAndSaved() = runTest(dispatcher) {
        val vm = newViewModel(IncomingFile.Accepted(encryptedUri))
        assertEquals(ShareUiState.Loading, vm.state.value)

        advanceUntilIdle()

        assertEquals(ShareUiState.Form(ShareFlow.Decrypt, encryptedUri), vm.state.value)
        assertEquals(encryptedUri, savedState.get<Uri>(ShareViewModel.KEY_URI))
        assertEquals("Decrypt", savedState.get<String>(ShareViewModel.KEY_FLOW))
    }

    @Test
    fun rejectedIncomingFileIsShown() = runTest(dispatcher) {
        val vm = newViewModel(IncomingFile.Rejected(IncomingFile.Reason.UnsupportedScheme))
        advanceUntilIdle()

        assertEquals(ShareUiState.Rejected(IncomingFile.Reason.UnsupportedScheme), vm.state.value)
        assertEquals(0, documents.describeCalls)
    }

    @Test
    fun flowAndUriRestoreFromSavedState() = runTest(dispatcher) {
        newViewModel(IncomingFile.Accepted(plainUri)).also { advanceUntilIdle() }
        documents.describeCalls = 0

        // Process death: a new ViewModel over the same SavedStateHandle, and the intent is not routed again.
        val restored = newViewModel(IncomingFile.Accepted(plainUri))

        assertEquals(ShareUiState.Form(ShareFlow.Encrypt, plainUri), restored.state.value)
        advanceUntilIdle()
        assertEquals(0, documents.describeCalls)
    }

    @Test
    fun describeFailureIsRejectedAsUnreadable() = runTest(dispatcher) {
        documents.describeFails = true
        val vm = newViewModel(IncomingFile.Accepted(plainUri))
        advanceUntilIdle()

        assertEquals(ShareUiState.Rejected(IncomingFile.Reason.Unreadable), vm.state.value)
    }

    @Test
    fun switchFlowKeepsUri() = runTest(dispatcher) {
        val vm = newViewModel(IncomingFile.Accepted(plainUri))
        advanceUntilIdle()

        vm.onSwitchFlow()
        assertEquals(ShareUiState.Form(ShareFlow.Decrypt, plainUri), vm.state.value)
        assertEquals("Decrypt", savedState.get<String>(ShareViewModel.KEY_FLOW))

        vm.onSwitchFlow()
        assertEquals(ShareUiState.Form(ShareFlow.Encrypt, plainUri), vm.state.value)
    }

    @Test
    fun successMovesToResultAndSurvivesRestore() = runTest(dispatcher) {
        val vm = newViewModel(IncomingFile.Accepted(plainUri))
        advanceUntilIdle()
        val result = ShareResult(ShareFlow.Encrypt, "report.md", "report.md.gpg", outputUri, "application/pgp-encrypted")

        vm.onSucceeded(result)
        assertEquals(ShareUiState.Finished(result), vm.state.value)

        val restored = newViewModel(IncomingFile.Accepted(plainUri))
        assertEquals(ShareUiState.Finished(result), restored.state.value)
    }

    @Test
    fun savedStateHoldsOnlyShareKeys() = runTest(dispatcher) {
        val vm = newViewModel(IncomingFile.Accepted(plainUri))
        advanceUntilIdle()
        vm.onSwitchFlow()
        vm.onSucceeded(ShareResult(ShareFlow.Decrypt, "secret.gpg", "secret", outputUri, "application/octet-stream"))

        // No passphrase can end up in the saved-instance bundle: only these keys are ever written.
        val allowed = setOf(
            ShareViewModel.KEY_URI,
            ShareViewModel.KEY_FLOW,
            ShareViewModel.KEY_RESULT_FLOW,
            ShareViewModel.KEY_RESULT_INPUT_NAME,
            ShareViewModel.KEY_RESULT_OUTPUT_NAME,
            ShareViewModel.KEY_RESULT_OUTPUT_URI,
            ShareViewModel.KEY_RESULT_MIME_TYPE,
        )
        assertTrue(savedState.keys().toString(), allowed.containsAll(savedState.keys()))
    }

    private class FakeDocuments : DocumentStore {
        var describeFails = false
        var describeCalls = 0

        override suspend fun describe(uri: Uri): PickedDocument {
            describeCalls++
            if (describeFails) throw SecurityException("no grant")
            return PickedDocument(uri, requireNotNull(uri.lastPathSegment), 12L)
        }

        override suspend fun openForRead(uri: Uri): ParcelFileDescriptor = error("share routing must not read")
        override suspend fun openForWrite(uri: Uri): ParcelFileDescriptor = error("share routing must not write")
        override suspend fun delete(uri: Uri): Boolean = error("share routing must not delete")
    }
}
