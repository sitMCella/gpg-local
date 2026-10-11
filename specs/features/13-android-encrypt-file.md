# Feature: Encrypt File on Android

Let the user symmetrically encrypt any file on their Android device with a passphrase. On the **Encrypt** screen the user picks a file with the system file picker, enters and confirms a passphrase, then chooses where to save the `.gpg` output with the system "Save as" picker. The Rust core streams the file through file descriptors, and the original file is never modified. The output is byte-compatible with the desktop app (feature 04) and with `gpg --decrypt`.

---

## Motivation

Feature 12 delivered the Android app shell with a placeholder Encrypt screen and a repository over the Rust core. This feature adds the first real user flow, the Android counterpart of desktop feature 04. Android has no browsable home directory, so instead of a file tree it uses the Storage Access Framework (SAF): the system picker gives the app access only to the files the user explicitly chooses, with no storage permission. Validation rules, messages and output naming match the desktop app, so users get the same behaviour on both platforms.

---

## Goals

1. Replace the Encrypt placeholder with a flow: **Choose file → enter passphrase → Encrypt → choose save location → done**.
2. Pick the input with `ACTION_OPEN_DOCUMENT` (any MIME type). Show the file's display name and size.
3. If the chosen file is already encrypted (`.gpg` / `.pgp`), block encryption and offer to switch to the Decrypt tab. This mirrors the greyed-out rows in desktop encrypt mode.
4. Collect a passphrase and a confirmation with the same validation rules and messages as desktop feature 04. Each field has a visibility toggle.
5. Let the user choose the output with `ACTION_CREATE_DOCUMENT`, suggesting `<input name>.gpg`.
6. Encrypt through `GpgKeyring.encryptFd` on a background thread, streaming the file (no full copy in memory). Show an indeterminate progress indicator while it runs.
7. On success, show a snackbar `report.md encrypted → report.md.gpg` and reset the form. On failure, show an inline error, keep the form, and delete the partially written output document.

---

## Out of Scope

- Public-key (recipient) encryption and recipient selection. The call always passes an empty recipient list, as desktop feature 04 does.
- Encrypting from the share sheet (feature 15).
- Encrypting several files at once.
- Deleting or replacing the original file.
- Real progress percentage and cancellation.
- Passphrase strength estimation beyond the 8-character minimum.
- Remembering the last save location (the system picker already does this per app).

---

## Prerequisites

| Requirement         | Notes                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------- |
| Feature 04          | Desktop behaviour and texts that this feature mirrors                                       |
| Feature 11 complete | `GpgKeyring.encryptFd(inputFd, outputFd, recipients, passphrase)`, fd ownership contract    |
| Feature 12 complete | `android/` project, `GpgRepository`, `GpgResult` / `GpgFailure`, Encrypt destination, theme |

---

## Current State

- `EncryptScreen.kt` is a placeholder with a disabled "Choose file" button.
- `GpgRepository` wraps `listKeys`, `importKey`, `generateKey`, `encryptBytes`, `decryptBytes`. It has no fd-based wrapper yet (feature 12 deferred it to this feature).
- `encryptFd` takes ownership of both fds and closes them. On error the output may contain partial data, and the caller must discard it (feature 11 §4).
- The manifest declares no permissions. SAF needs none.

---

## Implementation Plan

### 1. Repository: fd-based encryption

Add to `GpgRepository`:

```kotlin
suspend fun encryptFd(
    input: ParcelFileDescriptor,
    output: ParcelFileDescriptor,
    passphrase: String,
): GpgResult<Unit> = call {
    // Ownership moves to Rust; Rust closes both fds on success and on error.
    keyring().encryptFd(input.detachFd(), output.detachFd(), emptyList(), passphrase)
}
```

`detachFd()` is called inside `call { … }`, so it runs on `Dispatchers.IO`, right before the native call.

### 2. `DocumentRepository`: SAF access

Create `data/DocumentRepository.kt`. It is the only class that touches `ContentResolver`:

```kotlin
data class PickedDocument(
    val uri: Uri,
    val displayName: String,
    val sizeBytes: Long?,     // null when the provider does not report it
)

class DocumentRepository(
    private val resolver: ContentResolver,
    private val io: CoroutineDispatcher,
) {
    suspend fun describe(uri: Uri): PickedDocument = withContext(io) {
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)
            ?.use { c ->
                if (c.moveToFirst()) PickedDocument(
                    uri = uri,
                    displayName = c.getString(0) ?: uri.lastPathSegment ?: "file",
                    sizeBytes = if (c.isNull(1)) null else c.getLong(1),
                ) else null
            } ?: PickedDocument(uri, uri.lastPathSegment ?: "file", null)
    }

    suspend fun openForRead(uri: Uri): ParcelFileDescriptor = withContext(io) {
        resolver.openFileDescriptor(uri, "r") ?: throw FileNotFoundException("Cannot open $uri")
    }

    /** "wt" = write + truncate, so a reused document never keeps stale trailing bytes. */
    suspend fun openForWrite(uri: Uri): ParcelFileDescriptor = withContext(io) {
        resolver.openFileDescriptor(uri, "wt") ?: throw FileNotFoundException("Cannot open $uri")
    }

    /** Best-effort removal of a partially written output. Returns false if the provider refused. */
    suspend fun delete(uri: Uri): Boolean = withContext(io) {
        runCatching {
            if (uri.scheme == ContentResolver.SCHEME_FILE) File(requireNotNull(uri.path)).delete()
            else DocumentsContract.deleteDocument(resolver, uri)
        }.getOrDefault(false)
    }
}
```

Register it in `AppContainer` next to `gpgRepository` (`DocumentRepository(context.contentResolver, Dispatchers.IO)`). The `file://` branch exists only so instrumented tests can use plain temp files.

### 3. Pure helpers (`encrypt/EncryptRules.kt`)

These match desktop feature 04 exactly and are unit-testable:

```kotlin
const val MIN_PASSPHRASE_LENGTH = 8

enum class PassphraseError { Empty, TooShort, Mismatch }

fun validatePassphrase(passphrase: String, confirm: String): PassphraseError? = when {
    passphrase.isEmpty() -> PassphraseError.Empty
    passphrase.length < MIN_PASSPHRASE_LENGTH -> PassphraseError.TooShort
    passphrase != confirm -> PassphraseError.Mismatch
    else -> null
}

fun isEncryptedName(name: String): Boolean =
    name.substringAfterLast('.', "").lowercase().let { it == "gpg" || it == "pgp" }

fun encryptedOutputName(inputName: String): String = "$inputName.gpg"
```

`strings.xml`, with texts identical to the desktop:

| Key                         | Text                                                               |
| --------------------------- | ------------------------------------------------------------------ |
| `encrypt_error_empty`       | Passphrase must not be empty.                                      |
| `encrypt_error_too_short`   | Passphrase must be at least 8 characters.                          |
| `encrypt_error_mismatch`    | Passphrases do not match.                                          |
| `encrypt_in_progress`       | Encrypting file, please wait…                                      |
| `encrypt_success`           | %1$s encrypted → %2$s                                              |
| `encrypt_already_encrypted` | This file is already encrypted.                                    |
| `encrypt_go_to_decrypt`     | Decrypt it instead                                                 |
| `encrypt_failed`            | Encryption failed. (%1$s)                                          |
| `encrypt_cleanup_failed`    | The incomplete file %1$s could not be removed. Delete it manually. |

### 4. `EncryptViewModel`

State:

```kotlin
data class EncryptUiState(
    val input: PickedDocument? = null,
    val passphrase: String = "",
    val confirm: String = "",
    val showPassphrase: Boolean = false,
    val showConfirm: Boolean = false,
    val validationError: PassphraseError? = null,
    val failure: String? = null,          // backend message, shown in parentheses
    val cleanupFailedFor: String? = null, // display name of an output that could not be deleted
    val loading: Boolean = false,
) {
    val alreadyEncrypted: Boolean get() = input?.let { isEncryptedName(it.displayName) } == true
    val canSubmit: Boolean get() = input != null && !alreadyEncrypted && !loading
    val suggestedOutputName: String? get() = input?.displayName?.let(::encryptedOutputName)
}

sealed interface EncryptEvent {
    data class RequestOutputLocation(val suggestedName: String) : EncryptEvent
    data class Encrypted(val inputName: String, val outputName: String) : EncryptEvent
}
```

Behaviour:

- `onInputPicked(uri)` → `describe(uri)` → set `input`, clear `failure`, `validationError` and both passphrase fields.
- `onSubmit()`: no-op while `loading` or if `!canSubmit`. Run `validatePassphrase`. On error, set `validationError` and stop. Otherwise emit `RequestOutputLocation(suggestedOutputName)`.
- `onOutputPicked(uri: Uri?)`: `null` means the user cancelled the save picker. Do nothing and keep the form. Otherwise run the encryption (below).
- Events go through a `Channel<EncryptEvent>(BUFFERED)` exposed as a `Flow`, collected once in the screen with `LaunchedEffect`.

Encryption:

```kotlin
private fun encrypt(input: PickedDocument, outputUri: Uri) {
    val passphrase = state.value.passphrase
    _state.update { it.copy(loading = true, failure = null, cleanupFailedFor = null) }
    viewModelScope.launch {
        withContext(NonCancellable) {           // finish and clean up even if the screen goes away
            val outputName = documents.describe(outputUri).displayName
            val result = runCatching {
                val inFd = documents.openForRead(input.uri)
                val outFd = try { documents.openForWrite(outputUri) } catch (e: Exception) { inFd.close(); throw e }
                gpg.encryptFd(inFd, outFd, passphrase)
            }.getOrElse { GpgResult.Failure(GpgFailure.Io(it.message ?: it.javaClass.simpleName)) }

            when (result) {
                is GpgResult.Success -> {
                    _state.value = EncryptUiState()                         // reset form, drop passphrase
                    events.send(EncryptEvent.Encrypted(input.displayName, outputName))
                }
                is GpgResult.Failure -> {
                    val removed = documents.delete(outputUri)
                    _state.update {
                        it.copy(loading = false, failure = result.error.message,
                                cleanupFailedFor = if (removed) null else outputName)
                    }
                }
            }
        }
    }
}
```

- The output display name comes from the provider (`describe(outputUri)`), not from the suggestion: the user may rename it, or the provider may de-duplicate it to `report.md (1).gpg`. The snackbar shows the real name.
- If opening the input fails (file deleted, permission revoked), the output document has already been created by the save picker. It is deleted the same way.
- **The passphrase is never stored in `SavedStateHandle`**, because that would persist it into the saved-instance bundle. Only `input.uri` is saved there (key `"input_uri"`). After process death, the picked file is restored and the passphrase fields are empty. If the restored URI is no longer readable, the next `describe` / `openForRead` fails, `input` is cleared, and the user picks again.
- `onCleared()` overwrites nothing (JVM strings cannot be wiped). Resetting the state on success and dropping the ViewModel are the only clearing points, as on desktop where the dialog state is discarded.

### 5. `EncryptScreen` UI

```kotlin
val openDocument = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
    uri?.let(viewModel::onInputPicked)
}
val createDocument = rememberLauncherForActivityResult(
    ActivityResultContracts.CreateDocument("application/pgp-encrypted")
) { uri -> viewModel.onOutputPicked(uri) }

LaunchedEffect(Unit) {
    viewModel.events.collect { e ->
        when (e) {
            is EncryptEvent.RequestOutputLocation -> createDocument.launch(e.suggestedName)
            is EncryptEvent.Encrypted -> snackbarHostState.showSnackbar(
                context.getString(R.string.encrypt_success, e.inputName, e.outputName))
        }
    }
}
```

The snackbar host lives in the app `Scaffold` (feature 12) and is passed down through a `CompositionLocal`, so the snackbar stays visible if the user switches tabs.

Layout, top to bottom, in a vertically scrollable `Column` with `imePadding()`:

1. **File card** (`OutlinedCard`):
   - Nothing chosen: a `Description` icon, the text "No file selected", and a **Choose file** `FilledTonalButton` that launches `openDocument.launch(arrayOf("*/*"))`.
   - File chosen: the file icon (amber `Lock` when `alreadyEncrypted`, otherwise `Description`), the display name (single line, middle ellipsis), the human-readable size (`Formatter.formatShortFileSize`, omitted if unknown), the output name `→ report.md.gpg`, and a **Change** `TextButton`.
2. **Already-encrypted banner** (only when `alreadyEncrypted`): a Material 3 error-container surface with the text "This file is already encrypted." and a **Decrypt it instead** button. It navigates to the Decrypt destination and passes the URI as a navigation argument, which feature 14 consumes. The passphrase fields and the Encrypt button are disabled.
3. **Passphrase** `OutlinedTextField`: `PasswordVisualTransformation` unless `showPassphrase`. Trailing `IconButton` with `Visibility` / `VisibilityOff`. `KeyboardOptions(keyboardType = Password, autoCorrectEnabled = false, imeAction = Next)`.
4. **Confirm passphrase**: the same field, with `imeAction = Done`. `KeyboardActions(onDone = { viewModel.onSubmit() })` mirrors desktop "Enter submits" and is a no-op while loading.
5. **Inline error** (`supportingText` of the confirm field for validation errors, and a separate error row with a `Warning` icon for backend failures): the mapped validation message, or `Encryption failed. (<backend message>)`. If `cleanupFailedFor` is set, a second line shows `encrypt_cleanup_failed`.
6. **Progress** (only while `loading`): an indeterminate `LinearProgressIndicator` plus the text "Encrypting file, please wait…".
7. **Encrypt** `Button`, full width, enabled when `canSubmit`. Its label does not change while loading (as on desktop).

While `loading`:

- Every input, the Change button, the Encrypt button and the bottom navigation bar are disabled.
- A `BackHandler(enabled = loading) {}` swallows the back gesture, so the user cannot leave mid-write. The operation itself would survive anyway because of `NonCancellable`.

Accessibility:

- Visibility toggles have `contentDescription` "Show passphrase" / "Hide passphrase" and are not in the IME focus chain (`Modifier.focusProperties { canFocus = false }`, the equivalent of desktop `tabIndex={-1}`).
- The progress row uses `liveRegion = Polite` so TalkBack announces it.

### 6. Screen privacy

While the Encrypt screen is visible, set `WindowManager.LayoutParams.FLAG_SECURE` on the activity window (`DisposableEffect` adds it on enter and clears it on dispose). This prevents screenshots, screen recording and the recent-apps thumbnail from capturing a revealed passphrase. Feature 14 applies the same rule to the Decrypt screen.

### 7. Output naming and overwrite behaviour

- The suggested name is `<input display name>.gpg`, as on desktop.
- The MIME type for `CreateDocument` is `application/pgp-encrypted`. If a provider appends its own extension (some do for unknown types), the real name is still read back from the provider and shown in the snackbar.
- **Difference from desktop:** desktop silently overwrites `<name>.gpg` (feature 04). On Android the system save picker owns that decision: it typically creates `report.md (1).gpg` or asks the user before replacing. The app accepts whatever document the picker returns and opens it with `"wt"` (truncate).

### 8. Tests

**JVM unit tests** (`app/src/test`):

- `EncryptRulesTest`:
  - `validatePassphrase` gives `Empty`, `TooShort`, `Mismatch` and null in the same order of precedence as desktop.
  - `isEncryptedName` handles `a.gpg`, `A.PGP`, `a.gpg.txt` (false) and `gpg` (false, no dot).
  - `encryptedOutputName("report.md") == "report.md.gpg"`.
- `EncryptViewModelTest` with fake `DocumentRepository` / `GpgRepository` and `StandardTestDispatcher`:
  - picking a file sets `input` and clears both passphrase fields;
  - submitting with an invalid passphrase sets `validationError` and emits no event;
  - submitting with a `.gpg` input does nothing;
  - a valid submit emits `RequestOutputLocation("report.md.gpg")`;
  - `onOutputPicked(null)` keeps the state unchanged and does not call `encryptFd`;
  - success resets the state and emits `Encrypted` with the provider's output name;
  - `GpgFailure` sets `failure`, `loading = false` and calls `delete(outputUri)`;
  - a failed delete sets `cleanupFailedFor`;
  - an `openForRead` exception deletes the output and reports an `Io` failure;
  - a second submit while loading is ignored;
  - the passphrase is never written to `SavedStateHandle` (assert the keys are only `input_uri`).

**Instrumented tests** (`app/src/androidTest`, Espresso-Intents + Compose test rule):

- `pickingFileShowsNameAndOutput`: stub the `ACTION_OPEN_DOCUMENT` result with a `file://` URI to a temp `report.md`. The card shows `report.md` and `report.md.gpg`.
- `validationMessagesMatchDesktop`: the three error texts appear for empty, short and mismatched input.
- `confirmImeDoneSubmits`: `performImeAction()` on the confirm field launches `ACTION_CREATE_DOCUMENT` with `EXTRA_TITLE == "report.md.gpg"`.
- `endToEndEncryptThenCoreDecrypts`: stub both intents with temp files. Encrypt, then assert a snackbar `report.md encrypted → report.md.gpg`, that the output starts with an OpenPGP packet header, and that `GpgKeyring.decryptBytes(output, passphrase)` returns the original bytes.
- `unreadableInputDeletesOutput`: stub the input URI with a non-existent file. An inline error appears and the output temp file no longer exists.
- `alreadyEncryptedFileBlocksEncryption`: pick `secret.gpg`. The banner is shown, the Encrypt button is disabled, and "Decrypt it instead" navigates to the Decrypt tab.
- `cancelledSavePickerKeepsForm`: stub `ACTION_CREATE_DOCUMENT` with `RESULT_CANCELED`. The passphrase fields keep their values and no error is shown.
- `flagSecureIsSetOnEncryptScreen`: `activity.window.attributes.flags and FLAG_SECURE != 0`.

**Manual checks** (documented in the PR):

- Encrypt a file from Downloads, Google Drive and an SD card. The output is in the chosen folder, and the desktop app decrypts it (feature 05).
- Encrypt a ≥ 1 GB file on a device. Memory stays flat (Android Studio profiler) and the UI stays responsive.

---

## File Tree After This Feature

```
android/app/src/main/kotlin/com/gpglocal/app/
├── GpgLocalApp.kt                 # + DocumentRepository in AppContainer
├── data/
│   ├── GpgRepository.kt           # + encryptFd(ParcelFileDescriptor, ParcelFileDescriptor, passphrase)
│   └── DocumentRepository.kt      # ← new: SAF describe / open / delete
└── ui/
    ├── GpgLocalAppUi.kt           # + snackbar host CompositionLocal, nav argument to Decrypt
    └── encrypt/
        ├── EncryptRules.kt        # ← new: validation + naming helpers
        ├── EncryptViewModel.kt    # ← new
        └── EncryptScreen.kt       # placeholder replaced with the full flow
android/app/src/main/res/values/strings.xml   # + encrypt_* strings
```

---

## Visual Layout Reference

### Idle, no file

```
┌───────────────────────────────┐
│          GPG Local            │
├───────────────────────────────┤
│ ┌───────────────────────────┐ │
│ │ 📄 No file selected       │ │
│ │          [ Choose file ]  │ │
│ └───────────────────────────┘ │
│                               │
│ Passphrase            (dis.)  │
│ Confirm passphrase    (dis.)  │
│                               │
│ [         Encrypt         ]   │  ← disabled
├───────────────────────────────┤
│   ▣ Encrypt      ○ Decrypt    │
└───────────────────────────────┘
```

### File chosen, passphrase entered

```
┌───────────────────────────────┐
│ ┌───────────────────────────┐ │
│ │ 📄 report.md      12 kB   │ │
│ │    → report.md.gpg        │ │
│ │                [ Change ] │ │
│ └───────────────────────────┘ │
│ ┌ Passphrase ─────────────┐👁 │
│ │ ••••••••••              │   │
│ └─────────────────────────┘   │
│ ┌ Confirm passphrase ─────┐👁 │
│ │ ••••••••••              │   │
│ └─────────────────────────┘   │
│ ⚠ Passphrases do not match.   │
│ [         Encrypt         ]   │
└───────────────────────────────┘
```

### Encrypting

```
│ ▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░   │  ← indeterminate LinearProgressIndicator
│ Encrypting file, please wait… │
│ [         Encrypt         ]   │  ← disabled, label unchanged
```

### Success

```
│ ┌───────────────────────────┐ │
│ │ report.md encrypted →     │ │  ← Snackbar
│ │ report.md.gpg             │ │
│ └───────────────────────────┘ │
├───────────────────────────────┤
│   ▣ Encrypt      ○ Decrypt    │
```

---

## Security Considerations

- **Least-privilege file access.** SAF grants access only to the single input document and the single output document the user picks. The app holds no storage permission and takes no persistable URI permissions, so the grants end with the activity.
- **No plaintext copies.** The input is streamed from its file descriptor straight into the Rust encryptor and written to the output descriptor. No temporary plaintext file is created in app storage or cache.
- **Partial output is removed.** On any failure the output document is deleted. If the provider refuses, the user is told to delete it.
- **The passphrase stays in memory only.** It lives in ViewModel state, not in `SavedStateHandle`, preferences or logs. It is dropped on success and when the ViewModel is cleared. JVM strings cannot be zeroized; the Rust side converts it to a zeroizing `Password` (feature 11).
- **Screen capture is blocked** while the screen shows passphrase fields (`FLAG_SECURE`).
- **The original file is never modified or deleted.**
- **Output format.** Symmetric OpenPGP (SKESK + SEIPD) produced by the same `gpg-core` code as the desktop app, so it is interoperable with desktop GPG Local and `gpg`.

---

## Acceptance Criteria

- [ ] The Encrypt screen shows a **Choose file** button that opens the system file picker for any file type.
- [ ] After picking, the screen shows the file name, its size when the provider reports one, and the suggested output name `<name>.gpg`.
- [ ] Picking a `.gpg` / `.pgp` file shows "This file is already encrypted.", disables encryption, and offers **Decrypt it instead**, which opens the Decrypt tab.
- [ ] An empty passphrase shows "Passphrase must not be empty.", fewer than 8 characters shows "Passphrase must be at least 8 characters.", and a mismatch shows "Passphrases do not match.". The form stays open in each case.
- [ ] Each passphrase field has its own show/hide toggle.
- [ ] The keyboard's Done action on **Confirm passphrase** submits, and does nothing while encrypting.
- [ ] A valid submit opens the system save picker with `<name>.gpg` pre-filled. Cancelling it returns to the filled form with no error.
- [ ] While encrypting, all controls and the bottom navigation are disabled, an indeterminate progress bar and "Encrypting file, please wait…" are shown, and back is blocked.
- [ ] Success writes the encrypted file to the chosen location, shows the snackbar `<input> encrypted → <actual output name>`, and clears the form, including the passphrase.
- [ ] The output decrypts with the desktop app (feature 05) and with `gpg --decrypt` using the same passphrase.
- [ ] On failure an inline `Encryption failed. (<backend message>)` is shown, the form is kept, and the partially written output document is deleted (or the user is told to delete it).
- [ ] The original file is unchanged after both success and failure.
- [ ] Encrypting a ≥ 1 GB file does not cause out-of-memory errors and the UI stays responsive.
- [ ] Screenshots of the Encrypt screen are blocked (`FLAG_SECURE`).
- [ ] The passphrase does not survive process death (the fields are empty after the app is restored).
- [ ] `./gradlew test` and `./gradlew connectedDebugAndroidTest` pass. Desktop `pnpm test`, `pnpm test:e2e` and `pnpm build:tauri` are unaffected.
