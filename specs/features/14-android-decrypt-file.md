# Feature: Decrypt File on Android

Let the user decrypt a `.gpg` / `.pgp` file on their Android device with a passphrase. On the **Decrypt** screen the user picks an encrypted file with the system file picker, enters the passphrase, then chooses where to save the plaintext with the system "Save as" picker. The suggested name is the input name with `.gpg` / `.pgp` removed. The Rust core streams the file through file descriptors, and the encrypted original is never modified. Files encrypted by the desktop app (feature 04), by the Android app (feature 13) or by `gpg --symmetric` decrypt identically.

---

## Motivation

Feature 13 added encryption on Android. Decryption is the counterpart, the Android version of desktop feature 05. It reuses the infrastructure from feature 13 (`DocumentRepository`, fd-based repository calls, the snackbar host, `FLAG_SECURE`, the loading and cleanup pattern) and the desktop texts and naming rules, so both platforms behave the same.

---

## Goals

1. Replace the Decrypt placeholder with a flow: **Choose file → enter passphrase → Decrypt → choose save location → done**.
2. Accept a pre-selected file passed from the Encrypt screen's **Decrypt it instead** button (feature 13).
3. Only `.gpg` / `.pgp` files can be decrypted. Any other file is blocked with a banner offering **Encrypt it instead**, mirroring the greyed-out rows in desktop decrypt mode.
4. One passphrase field (no confirmation) with a visibility toggle. The only validation rule is "must not be empty", as on desktop.
5. Suggest the output name with the same rule as desktop `decryptedOutputPath`: `report.md.gpg` becomes `report.md`, `archive.pgp` becomes `archive`, and anything else becomes `<name>.decrypted`.
6. Decrypt through `GpgKeyring.decryptFd` on a background thread with an indeterminate progress indicator.
7. On success, show the snackbar `report.md.gpg decrypted → report.md` with an **Open** action that opens the plaintext in another app, and reset the form.
8. On failure, show `Decryption failed. Check your passphrase and try again. (<backend message>)` inline, keep the form (with the passphrase cleared), and delete the partially written output.

---

## Out of Scope

- A key-management UI. Decryption tries the passphrase as a symmetric key first, then against secret keys in the app keyring (feature 11 behaviour). Since Android has no key import UI yet, symmetric files are the supported case in practice.
- ASCII-armored `.asc` files (not offered on desktop either).
- Decrypting from the share sheet (feature 15).
- Decrypting several files at once.
- Deleting the encrypted original after decryption.
- In-app preview of the plaintext.
- Progress percentage and cancellation.

---

## Prerequisites

| Requirement         | Notes                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------- |
| Feature 05          | Desktop behaviour, texts and `decryptedOutputPath` rule mirrored here                               |
| Feature 11 complete | `GpgKeyring.decryptFd(inputFd, outputFd, passphrase)`, fd ownership contract                        |
| Feature 12 complete | App shell, `GpgRepository`, `GpgFailure.WrongPassphrase`, Decrypt destination                       |
| Feature 13 complete | `DocumentRepository`, snackbar host, `FLAG_SECURE` pattern, `isEncryptedName`, Decrypt nav argument |

---

## Current State

- `DecryptScreen.kt` is a placeholder from feature 12.
- Feature 13 navigates to Decrypt with the picked URI ("Decrypt it instead"), but the Decrypt destination ignores it.
- `DocumentRepository` already provides `describe`, `openForRead`, `openForWrite("wt")` and `delete`.
- The Encrypt screen contains the file card, passphrase field, progress row and error row inline in `EncryptScreen.kt`.

---

## Implementation Plan

### 1. Extract shared UI components

Move the reusable pieces of `EncryptScreen.kt` into `ui/common/` without changing behaviour, so both screens use the same components:

| Component           | Content                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------ |
| `FileCard`          | Empty state + Choose file button. Picked state with icon, name, size, `→ output`, Change   |
| `PassphraseField`   | `OutlinedTextField` + visibility toggle (not focusable), IME action, error supporting text |
| `OperationProgress` | Indeterminate `LinearProgressIndicator` + status text, `liveRegion = Polite`               |
| `InlineError`       | `Warning` icon + message (+ optional second line)                                          |
| `WrongModeBanner`   | Error-container banner with message and a single action button                             |
| `SecureScreen`      | `DisposableEffect` that sets/clears `FLAG_SECURE`                                          |

Feature 13's tests must still pass after the extraction.

### 2. Repository: fd-based decryption

Add to `GpgRepository`:

```kotlin
suspend fun decryptFd(
    input: ParcelFileDescriptor,
    output: ParcelFileDescriptor,
    passphrase: String,
): GpgResult<Unit> = call {
    keyring().decryptFd(input.detachFd(), output.detachFd(), passphrase)
}
```

### 3. Pure helpers (`decrypt/DecryptRules.kt`)

```kotlin
/** Mirrors desktop src/utils/decryptedOutputPath.ts, applied to a display name. */
fun decryptedOutputName(inputName: String): String {
    val lower = inputName.lowercase()
    return if ((lower.endsWith(".gpg") || lower.endsWith(".pgp")) && inputName.length > 4)
        inputName.dropLast(4)
    else
        "$inputName.decrypted"
}

/** MIME type for the CreateDocument request, derived from the output name. */
/** `lookup` defaults to Android's MimeTypeMap; JVM unit tests pass a fake (MimeTypeMap is a stub off-device). */
fun mimeTypeFor(
    outputName: String,
    lookup: (String) -> String? = { MimeTypeMap.getSingleton().getMimeTypeFromExtension(it) },
): String =
    outputName.substringAfterLast('.', "").lowercase()
        .takeIf { it.isNotEmpty() }
        ?.let(lookup)
        ?: "application/octet-stream"
```

`isEncryptedName` from feature 13 decides whether a picked file is decryptable.

`strings.xml`:

| Key                      | Text                                                                     |
| ------------------------ | ------------------------------------------------------------------------ |
| `decrypt_error_empty`    | Passphrase must not be empty.                                            |
| `decrypt_in_progress`    | Decrypting file, please wait…                                            |
| `decrypt_failed`         | Decryption failed. Check your passphrase and try again. (%1$s)           |
| `decrypt_success`        | %1$s decrypted → %2$s                                                    |
| `decrypt_open`           | Open                                                                     |
| `decrypt_no_app`         | No app found to open %1$s                                                |
| `decrypt_not_encrypted`  | Only .gpg and .pgp files can be decrypted.                               |
| `decrypt_go_to_encrypt`  | Encrypt it instead                                                       |
| `decrypt_plaintext_note` | The decrypted file will be readable by apps that can access that folder. |
| `decrypt_cleanup_failed` | The incomplete file %1$s could not be removed. Delete it manually.       |

`decrypt_failed` is used for **every** backend failure, matching desktop feature 05, which wraps every raw error the same way.

### 4. Navigation argument

Change the Decrypt route in `Destinations.kt` to `decrypt?uri={uri}` (an optional, URL-encoded string argument, default `null`). Feature 13's **Decrypt it instead** navigates with `popUpTo(encrypt) { saveState = true }` + `launchSingleTop`. Selecting the Decrypt tab in the bottom bar uses the route without an argument.

Similarly, **Encrypt it instead** on this screen navigates to `encrypt?uri={uri}`. Add the same optional argument to the Encrypt route, and have `EncryptViewModel` call `onInputPicked` when it is present (a small addition to feature 13).

The read grant from `ACTION_OPEN_DOCUMENT` belongs to the activity, so the same URI stays readable on the other screen.

### 5. `DecryptViewModel`

```kotlin
data class DecryptUiState(
    val input: PickedDocument? = null,
    val passphrase: String = "",
    val showPassphrase: Boolean = false,
    val validationError: Boolean = false,     // only "empty"
    val failure: String? = null,
    val cleanupFailedFor: String? = null,
    val loading: Boolean = false,
) {
    val notEncrypted: Boolean get() = input?.let { !isEncryptedName(it.displayName) } == true
    val canSubmit: Boolean get() = input != null && !notEncrypted && !loading
    val suggestedOutputName: String? get() = input?.displayName?.let(::decryptedOutputName)
}

sealed interface DecryptEvent {
    data class RequestOutputLocation(val suggestedName: String, val mimeType: String) : DecryptEvent
    data class Decrypted(val inputName: String, val outputName: String, val outputUri: Uri, val mimeType: String) : DecryptEvent
}
```

Behaviour is the same as `EncryptViewModel` (feature 13 §4), with these differences:

- Init: if `savedStateHandle.get<String>("uri")` (the nav argument) or the saved `"input_uri"` is present, call `onInputPicked(Uri.parse(it))`.
- `onSubmit()`: an empty passphrase sets `validationError = true`. Otherwise emit `RequestOutputLocation(suggestedOutputName, mimeTypeFor(suggestedOutputName))`.
- `onOutputPicked(uri)`: `null` means cancelled and changes nothing. Otherwise call `decryptFd` inside `withContext(NonCancellable)`.
- **On failure:** delete the output (`documents.delete`), set `failure = error.message`, and **clear the passphrase**. The desktop dialog keeps it, but on a phone retyping is expected after a wrong-passphrase error, and it shortens the time the secret stays in memory. Set `cleanupFailedFor` if the delete failed.
- **On success:** reset the state and emit `Decrypted(input.displayName, describe(outputUri).displayName, outputUri, mimeType)`.
- Only `"input_uri"` is written to `SavedStateHandle`. The passphrase never is.

### 6. `DecryptScreen` UI

Launchers:

```kotlin
val openDocument = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
    uri?.let(viewModel::onInputPicked)
}
// CreateDocument's MIME type is fixed per contract instance, so use a small custom contract
// that reads the type from the input.
val createDocument = rememberLauncherForActivityResult(CreateDocumentWithType()) { uri ->
    viewModel.onOutputPicked(uri)
}
```

```kotlin
class CreateDocumentWithType : ActivityResultContract<Pair<String, String>, Uri?>() {
    override fun createIntent(context: Context, input: Pair<String, String>) =
        Intent(Intent.ACTION_CREATE_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType(input.second)
            .putExtra(Intent.EXTRA_TITLE, input.first)
    override fun parseResult(resultCode: Int, intent: Intent?) =
        intent.takeIf { resultCode == Activity.RESULT_OK }?.data
}
```

Picker filter: `openDocument.launch(arrayOf("application/pgp-encrypted", "application/pgp", "application/octet-stream", "*/*"))`. Providers rarely report a specific type for `.gpg` files, so `*/*` stays in the list and the name check (Goal 3) is the real gate.

Events:

```kotlin
is DecryptEvent.Decrypted -> {
    val result = snackbarHostState.showSnackbar(
        message = context.getString(R.string.decrypt_success, e.inputName, e.outputName),
        actionLabel = context.getString(R.string.decrypt_open),
        duration = SnackbarDuration.Long,
    )
    if (result == SnackbarResult.ActionPerformed) {
        val view = Intent(Intent.ACTION_VIEW)
            .setDataAndType(e.outputUri, e.mimeType)
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        try { context.startActivity(view) }
        catch (_: ActivityNotFoundException) {
            snackbarHostState.showSnackbar(context.getString(R.string.decrypt_no_app, e.outputName))
        }
    }
}
```

**Open** is the Android equivalent of desktop "Open file" (feature 07). It never reads the plaintext into the app; it only hands the URI to another app with a one-time read grant.

Layout, using the shared components:

1. `FileCard`: the icon is an amber `Lock` for encrypted files, otherwise `Description`. It shows the name, size and `→ report.md`. Below the output name, `decrypt_plaintext_note` appears in `bodySmall` / `onSurfaceVariant`.
2. `WrongModeBanner` (when `notEncrypted`): "Only .gpg and .pgp files can be decrypted." with **Encrypt it instead**. The passphrase field and the Decrypt button are disabled.
3. `PassphraseField` with `imeAction = Done`. `onDone` submits (a no-op while loading). It is auto-focused once a decryptable file is picked.
4. `InlineError`: "Passphrase must not be empty." (validation) or `decrypt_failed` with the backend message, plus `decrypt_cleanup_failed` when relevant.
5. `OperationProgress` with "Decrypting file, please wait…" while loading.
6. **Decrypt** `Button`, full width, enabled when `canSubmit`. The label does not change while loading.

While loading, all controls and the bottom navigation are disabled and `BackHandler` swallows back. `SecureScreen` is applied to the whole Decrypt screen.

### 7. Overwrite behaviour

As in feature 13, the system save picker decides how existing names are handled (usually `report (1).md`). The app writes to the returned document with `"wt"`. This differs from desktop, which silently overwrites `report.md` (feature 05).

### 8. Tests

**JVM unit tests:**

- `DecryptRulesTest`:
  - `report.md.gpg` → `report.md`, `archive.pgp` → `archive`, `photo.jpg.GPG` → `photo.jpg`, `notes.txt` → `notes.txt.decrypted`, `.gpg` → `.gpg.decrypted` (no empty names).
  - with a fake lookup (`"md" -> "text/markdown"`): `mimeTypeFor("report.md")` is `text/markdown`; `mimeTypeFor("archive")` and an unknown extension (`a.xyz`) are `application/octet-stream`.
- `DecryptViewModelTest` (fakes + `StandardTestDispatcher`):
  - a nav-argument URI is picked automatically on init;
  - a non-`.gpg` input sets `notEncrypted` and submit does nothing;
  - an empty passphrase sets `validationError` and emits no event;
  - a valid submit emits `RequestOutputLocation("report.md", …)`;
  - a cancelled save picker leaves the state unchanged;
  - success resets the state and emits `Decrypted` with the provider output name;
  - `GpgFailure.WrongPassphrase` sets `failure = "no matching secret key found"`, clears the passphrase and deletes the output;
  - a failed delete sets `cleanupFailedFor`;
  - submit while loading is ignored;
  - `SavedStateHandle` never contains the passphrase.

**Instrumented tests** (Espresso-Intents + Compose rule, temp `file://` documents as in feature 13):

- `decryptAndroidEncryptedFile`: encrypt `report.md` with `GpgKeyring.encryptBytes`, decrypt it through the UI, and assert the output bytes equal the original and that the snackbar reads `report.md.gpg decrypted → report.md`.
- `decryptDesktopFixture`: the desktop-produced fixture from feature 12 decrypts to the expected text.
- `decryptGpgCliFixture`: a fixture made with `gpg --symmetric --cipher-algo AES256` decrypts.
- `wrongPassphraseShowsDesktopMessageAndDeletesOutput`: the inline text is exactly `Decryption failed. Check your passphrase and try again. (no matching secret key found)`, the output temp file is gone, and the passphrase field is empty.
- `emptyPassphraseValidation`.
- `nonEncryptedFileShowsBanner`: picking `notes.txt` shows the banner, Decrypt is disabled, and **Encrypt it instead** opens the Encrypt tab with `notes.txt` selected.
- `decryptItInsteadFromEncryptPrefills`: from the Encrypt tab, pick `secret.gpg` and tap **Decrypt it instead**. The Decrypt screen shows `secret.gpg` and `→ secret`.
- `savePickerGetsSuggestedNameAndMime`: the intended `ACTION_CREATE_DOCUMENT` has `EXTRA_TITLE == "report.md"` and a non-empty type.
- `openActionLaunchesViewIntent`: tap **Open** on the snackbar and assert an `ACTION_VIEW` intent with the output URI and `FLAG_GRANT_READ_URI_PERMISSION`.
- `flagSecureIsSetOnDecryptScreen`.

**Manual checks:**

- Decrypt a file stored in Downloads, Google Drive and on an SD card. The plaintext is saved where chosen.
- Encrypt on desktop, copy the file to the phone, decrypt on Android; then the reverse.
- Decrypt a ≥ 1 GB file. Memory stays bounded and the UI stays responsive.

---

## File Tree After This Feature

```
android/app/src/main/kotlin/com/gpglocal/app/
├── data/
│   └── GpgRepository.kt              # + decryptFd
└── ui/
    ├── Destinations.kt               # decrypt?uri=, encrypt?uri= optional args
    ├── common/                       # ← new: extracted from EncryptScreen
    │   ├── FileCard.kt
    │   ├── PassphraseField.kt
    │   ├── OperationProgress.kt
    │   ├── InlineError.kt
    │   ├── WrongModeBanner.kt
    │   ├── SecureScreen.kt
    │   └── CreateDocumentWithType.kt
    ├── encrypt/
    │   ├── EncryptScreen.kt          # uses common components
    │   └── EncryptViewModel.kt       # + reads optional uri nav argument
    └── decrypt/
        ├── DecryptRules.kt           # ← new
        ├── DecryptViewModel.kt       # ← new
        └── DecryptScreen.kt          # placeholder replaced
android/app/src/main/res/values/strings.xml   # + decrypt_* strings
android/app/src/androidTest/assets/           # + gpg CLI fixture
```

---

## Visual Layout Reference

### File chosen

```
┌───────────────────────────────┐
│          GPG Local            │
├───────────────────────────────┤
│ ┌───────────────────────────┐ │
│ │ 🔒 report.md.gpg   12 kB  │ │
│ │    → report.md            │ │
│ │ The decrypted file will   │ │
│ │ be readable by apps that  │ │
│ │ can access that folder.   │ │
│ │                [ Change ] │ │
│ └───────────────────────────┘ │
│ ┌ Passphrase ─────────────┐👁 │
│ │ ••••••••••              │   │
│ └─────────────────────────┘   │
│ [         Decrypt         ]   │
├───────────────────────────────┤
│   ○ Encrypt      ▣ Decrypt    │
└───────────────────────────────┘
```

### Wrong passphrase

```
│ ┌ Passphrase ─────────────┐👁 │
│ │                         │   │  ← cleared
│ └─────────────────────────┘   │
│ ⚠ Decryption failed. Check    │
│   your passphrase and try     │
│   again. (no matching secret  │
│   key found)                  │
│ [         Decrypt         ]   │
```

### Not an encrypted file

```
│ ┌───────────────────────────┐ │
│ │ 📄 notes.txt       2 kB   │ │
│ └───────────────────────────┘ │
│ ┌───────────────────────────┐ │
│ │ Only .gpg and .pgp files  │ │
│ │ can be decrypted.         │ │
│ │     [ Encrypt it instead ]│ │
│ └───────────────────────────┘ │
│ [         Decrypt         ]   │  ← disabled
```

### Success

```
│ ┌───────────────────────────┐ │
│ │ report.md.gpg decrypted → │ │
│ │ report.md          OPEN   │ │  ← Snackbar with action
│ └───────────────────────────┘ │
```

---

## Security Considerations

- **Plaintext goes only where the user puts it.** The decrypted output is written to the document the user picked and nowhere else: no temp copy in app storage or cache, and no in-app preview. The note under the output name reminds users that a plaintext file in shared storage is readable by other apps with access to that folder.
- **Partial plaintext is removed.** On any failure the output document is deleted. If the provider refuses, the user is told to delete it, so a truncated plaintext is never left silently.
- **Least-privilege access.** SAF grants cover only the picked input and output, with no storage permission and no persistable grants. **Open** passes a one-time read grant to the receiving app.
- **The passphrase stays in memory only.** It is never in `SavedStateHandle` or logs, it is cleared after a failed attempt and on success, and the screen uses `FLAG_SECURE`.
- **Error text never contains the passphrase.** Backend messages come from `CoreError` (feature 09), which never formats it.
- **The encrypted original is never modified or deleted.**

---

## Acceptance Criteria

- [ ] The Decrypt screen shows a **Choose file** button that opens the system file picker.
- [ ] Choosing a `.gpg` / `.pgp` file shows its name, size and the suggested output name (`report.md.gpg` → `report.md`, `archive.pgp` → `archive`).
- [ ] Choosing any other file shows "Only .gpg and .pgp files can be decrypted." with **Encrypt it instead**, which opens the Encrypt tab with that file selected. Decrypt is disabled.
- [ ] **Decrypt it instead** on the Encrypt screen opens the Decrypt screen with the file pre-selected.
- [ ] Submitting an empty passphrase shows "Passphrase must not be empty." inline.
- [ ] The visibility toggle shows and hides the passphrase. The keyboard Done action submits, and does nothing while decrypting.
- [ ] A valid submit opens the system save picker with the suggested name and a MIME type matching its extension. Cancelling returns to the form with no error.
- [ ] While decrypting, controls and bottom navigation are disabled, back is blocked, and the progress bar plus "Decrypting file, please wait…" are shown.
- [ ] Success writes the plaintext to the chosen location, shows `<input> decrypted → <actual output name>` with an **Open** action, and resets the form.
- [ ] **Open** launches a viewer app with read access to the output. If none exists, "No app found to open <name>" is shown.
- [ ] A wrong passphrase shows exactly `Decryption failed. Check your passphrase and try again. (no matching secret key found)`, clears the passphrase field, keeps the selected file and deletes the output document.
- [ ] Files encrypted by desktop GPG Local, by Android GPG Local and by `gpg --symmetric` decrypt to byte-identical plaintext.
- [ ] The encrypted original is unchanged after success and failure.
- [ ] Decrypting a ≥ 1 GB file causes no out-of-memory error and the UI stays responsive.
- [ ] Screenshots of the Decrypt screen are blocked, and the passphrase is not restored after process death.
- [ ] Feature 13 behaviour and tests are unchanged after the shared-component extraction.
- [ ] `./gradlew test` and `./gradlew connectedDebugAndroidTest` pass. Desktop `pnpm test`, `pnpm test:e2e` and `pnpm build:tauri` are unaffected.
