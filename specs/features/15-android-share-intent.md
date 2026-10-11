# Feature: Encrypt / Decrypt via Android Share Sheet

Make GPG Local a target in the Android share sheet and in "Open with" for encrypted files. When the user shares a file from any app (Files, Gallery, Drive, email attachments, …), GPG Local opens directly on the right flow: **Decrypt** for `.gpg` / `.pgp` files, **Encrypt** for everything else, with the file already selected. After encrypting, the user can share the resulting `.gpg` file onwards (e.g. to a messenger) in one tap, then return to the app they came from.

---

## Motivation

Features 13 and 14 require the user to open GPG Local first and then find the file through the system picker. On Android, the natural way to act on a file is from where it already is: the share sheet ("Share → GPG Local") or tapping it in a file manager ("Open with → GPG Local"). Supporting both:

- removes the "open app → choose file → navigate folders" detour,
- enables the most common real-world flow, **share a document → encrypt → send the `.gpg` to someone**, without leaving the sending app's task, and
- lets users open a received `.gpg` attachment straight into decryption.

All crypto, validation, cleanup and privacy rules from features 13 and 14 are reused unchanged. This feature only adds entry points, routing, a share-mode presentation and a result step.

---

## Goals

1. Register GPG Local as a share target for single files of any type (`ACTION_SEND` with `EXTRA_STREAM`).
2. Register GPG Local in "Open with" for OpenPGP files (`ACTION_VIEW` with `application/pgp-encrypted` / `application/pgp`).
3. Route automatically: `.gpg` / `.pgp` display names open the Decrypt flow, and everything else opens the Encrypt flow, with the file pre-selected.
4. Treat incoming URIs as untrusted: accept only `content://` URIs that do not point into GPG Local's own data, and show a clear message for anything else.
5. Present share mode as a focused, task-local screen: a top bar with a close button and a title naming the action, and no bottom navigation.
6. After success, show a result step instead of a transient snackbar:
   - Encrypt: **Share encrypted file** (onward `ACTION_SEND` with a read grant) and **Done**.
   - Decrypt: **Open** (as in feature 14) and **Done**.
   - **Done** closes the screen and returns to the sending app.
7. Behave correctly across rotation and process death without losing the incoming file or exposing the passphrase.

---

## Out of Scope

- Sharing several files at once (`ACTION_SEND_MULTIPLE`). The app does not declare it, so it does not appear in the share sheet for multi-selections.
- Sharing plain text or links (`EXTRA_TEXT` without `EXTRA_STREAM`). Text encryption is a separate future feature.
- Direct Share targets / sharing shortcuts (contact-style targets in the share sheet).
- Overwriting the shared original in place. Output always goes through the system save picker, as in features 13/14.
- Recipient (public-key) encryption.
- A "Quick encrypt" path that skips the save picker (e.g. writing to a fixed folder).

---

## Prerequisites

| Requirement         | Notes                                                                                                        |
| ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Feature 12 complete | App shell, `AppContainer`, theme                                                                             |
| Feature 13 complete | `EncryptViewModel`, `DocumentRepository`, `isEncryptedName`, `encrypt?uri=` argument                         |
| Feature 14 complete | `DecryptViewModel`, shared `ui/common/` components, `SecureScreen`, **Open** action, `decrypt?uri=` argument |

---

## Current State

- `MainActivity` is the only activity and has only the `MAIN`/`LAUNCHER` intent filter.
- `EncryptScreen` / `DecryptScreen` accept an optional pre-selected URI through the navigation argument (features 13/14). Their ViewModels call `onInputPicked(uri)` when it is present.
- Success is reported with a snackbar in the app `Scaffold`.
- `DocumentRepository` accepts `file://` URIs (only to support instrumented tests in feature 13).

---

## Implementation Plan

### 1. `ShareActivity` and intent filters

Add a dedicated activity, so share flows run in the **sending app's task** and never disturb a GPG Local session the user may have open in its own task.

`AndroidManifest.xml`:

```xml
<activity
    android:name=".share.ShareActivity"
    android:exported="true"
    android:label="@string/share_target_label"
    android:icon="@mipmap/ic_launcher"
    android:excludeFromRecents="true"
    android:windowSoftInputMode="adjustResize">

    <!-- Share sheet: any single file -->
    <intent-filter>
        <action android:name="android.intent.action.SEND" />
        <category android:name="android.intent.category.DEFAULT" />
        <data android:mimeType="*/*" />
    </intent-filter>

    <!-- "Open with" for OpenPGP files -->
    <intent-filter>
        <action android:name="android.intent.action.VIEW" />
        <category android:name="android.intent.category.DEFAULT" />
        <category android:name="android.intent.category.BROWSABLE" />
        <data android:scheme="content" />
        <data android:mimeType="application/pgp-encrypted" />
        <data android:mimeType="application/pgp" />
    </intent-filter>
</activity>
```

- `share_target_label` = "GPG Local". A single share-sheet entry routes automatically. Two entries ("Encrypt…" / "Decrypt…") would let users pick the wrong one.
- `excludeFromRecents="true"`: the share flow is a short-lived task step, so it should not leave a second GPG Local card in Recents.
- `ACTION_VIEW` is limited to the OpenPGP MIME types. Many providers report `.gpg` as `application/octet-stream`, and registering for that type would put GPG Local in "Open with" for every unknown file. Those files remain reachable through the share sheet. This limitation is documented in Acceptance Criteria.
- No `ACTION_SEND_MULTIPLE` filter (Out of Scope).
- `MainActivity` is unchanged.

### 2. Parse and validate incoming intents (`share/IncomingFileParser.kt`)

A pure, unit-testable parser, the only place that interprets external intents:

```kotlin
sealed interface IncomingFile {
    data class Accepted(val uri: Uri) : IncomingFile
    data class Rejected(val reason: Reason) : IncomingFile
    enum class Reason { NoFile, MultipleFiles, UnsupportedScheme, OwnAppUri }
}

class IncomingFileParser(private val ownAuthorities: Set<String>) {
    fun parse(action: String?, data: Uri?, stream: Uri?, clipUris: List<Uri>): IncomingFile {
        val uri = when (action) {
            Intent.ACTION_SEND -> stream ?: clipUris.singleOrNull()
                ?: return IncomingFile.Rejected(if (clipUris.size > 1) Reason.MultipleFiles else Reason.NoFile)
            Intent.ACTION_VIEW -> data ?: return IncomingFile.Rejected(Reason.NoFile)
            else -> return IncomingFile.Rejected(Reason.NoFile)
        }
        if (uri.scheme != ContentResolver.SCHEME_CONTENT) return IncomingFile.Rejected(Reason.UnsupportedScheme)
        if (uri.authority in ownAuthorities) return IncomingFile.Rejected(Reason.OwnAppUri)
        return IncomingFile.Accepted(uri)
    }
}
```

`ShareActivity` extracts the inputs with `IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri::class.java)` and `intent.clipData`. `ownAuthorities` is built from the app's own declared providers (`packageManager.getPackageInfo(packageName, GET_PROVIDERS).providers`), so it stays correct if a provider is added later.

Why this matters:

- `file://` URIs from another app could point into GPG Local's own private storage (e.g. `files/keyring/<fp>.pgp`). Encrypting that file and saving it to a user-visible folder would let a malicious app trick the user into exporting the secret keyring. Only `content://` URIs are accepted, so the sending app's provider is the one enforcing access.
- A `content://` URI under one of GPG Local's own authorities is rejected for the same reason.

`DocumentRepository`'s `file://` branch stays internal for tests. Production entry points never pass a `file://` URI to it.

Rejection messages (`strings.xml`), shown in the share screen with a single **Close** button:

| Reason              | Text                                                     |
| ------------------- | -------------------------------------------------------- |
| `NoFile`            | GPG Local can only encrypt or decrypt files.             |
| `MultipleFiles`     | Share one file at a time.                                |
| `UnsupportedScheme` | This file can't be opened. Share it from a file manager. |
| `OwnAppUri`         | This file can't be opened.                               |

### 3. Routing

```kotlin
enum class ShareFlow { Encrypt, Decrypt }

suspend fun route(uri: Uri, documents: DocumentRepository): ShareFlow =
    if (isEncryptedName(documents.describe(uri).displayName)) ShareFlow.Decrypt else ShareFlow.Encrypt
```

- The name comes from the provider (`OpenableColumns.DISPLAY_NAME`), never from the URI path.
- If the provider reports no name, `describe` falls back to `lastPathSegment` (feature 13). If that is not `.gpg` / `.pgp`, the route is Encrypt. The user can still use **Decrypt it instead** in the Encrypt screen's wrong-mode banner, which stays available in share mode.
- `describe` failing (provider gone, grant missing) shows "This file can't be opened." and Close.

### 4. Share-mode presentation

`ShareActivity`:

```kotlin
class ShareActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { GpgLocalTheme { ShareRoot(intent, onFinish = ::finish) } }
    }
}
```

`ShareRoot`:

- Parses the intent once into a `ShareViewModel` (`parse`, then `route`). The result is cached in the ViewModel. The URI string and the chosen flow are saved in `SavedStateHandle`, so rotation and process death restore the same flow. The passphrase is never saved (features 13/14 rule).
- States: `Loading` (spinner while `describe` runs) → `Rejected(reason)` → `Flow(Encrypt|Decrypt, uri)`.
- `Flow` renders the **existing** `EncryptScreen` / `DecryptScreen` with a new parameter `presentation = Presentation.Share`. The ViewModels receive the URI exactly as with the `?uri=` navigation argument.

Changes to `EncryptScreen` / `DecryptScreen` driven by `Presentation.Share`:

| Element                     | Tab (features 13/14)         | Share                                                   |
| --------------------------- | ---------------------------- | ------------------------------------------------------- |
| Scaffold                    | App scaffold with bottom nav | Own scaffold, no bottom nav                             |
| Top bar                     | "GPG Local"                  | "Encrypt with GPG Local" / "Decrypt with GPG Local" + ✕ |
| File card **Change** button | Shown                        | Hidden (the shared file is the subject)                 |
| Wrong-mode banner action    | Navigates to other tab       | Switches flow within `ShareRoot`, same URI              |
| Success                     | Snackbar, form reset         | Result step (§5)                                        |
| Close / back                | —                            | Finishes the activity, except while loading (blocked)   |

`SecureScreen` (`FLAG_SECURE`) applies in share mode exactly as in tab mode. The save picker, validation, progress, inline errors and failure cleanup are the unchanged feature 13/14 code paths.

### 5. Result step

On success in share mode, the screen replaces the form with a result card:

```
✓ report.md encrypted
  Saved as report.md.gpg

[ Share encrypted file ]   (encrypt only, primary)
[ Open ]                   (decrypt only, primary)
[ Done ]                   (secondary)
```

To support it, `EncryptEvent.Encrypted` gets the output `Uri` as well (it already carries both display names). `DecryptEvent.Decrypted` already includes `outputUri` and `mimeType` (feature 14).

**Share encrypted file:**

```kotlin
val send = Intent(Intent.ACTION_SEND)
    .setType("application/pgp-encrypted")
    .putExtra(Intent.EXTRA_STREAM, outputUri)
    .setClipData(ClipData.newRawUri(outputName, outputUri))
    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
startActivity(Intent.createChooser(send, null))
```

- The `ClipData` is set so the read grant reliably reaches the chosen app on all API levels.
- GPG Local is excluded from its own chooser (`Intent.EXTRA_EXCLUDE_COMPONENTS` with `ShareActivity`) to avoid a pointless loop.
- Only the **encrypted** output can be shared onward from this step. Decrypted plaintext is offered only through **Open**, which hands it to a viewer, not to a sharing chooser. That avoids one-tap forwarding of plaintext.

**Open** (decrypt): the same `ACTION_VIEW` + read grant + "No app found" fallback as feature 14.

**Done**: `finish()`. The user returns to the sending app.

The result step state (output name, URI, flow) is held in the ViewModel and saved in `SavedStateHandle`, so rotating the device on the result screen keeps it.

### 6. Tab-mode adjustments

`EncryptScreen` / `DecryptScreen` get the `presentation` parameter with default `Presentation.Tab`, so `MainActivity` behaviour is unchanged. The only tab-mode change is the extra `outputUri` in `EncryptEvent.Encrypted`, which the snackbar ignores.

### 7. Tests

**JVM unit tests:**

- `IncomingFileParserTest`:
  - `SEND` + `EXTRA_STREAM` content URI is accepted;
  - `SEND` with only `ClipData` (one item) is accepted;
  - `SEND` with two clip items gives `MultipleFiles`;
  - `SEND` with no stream (text share) gives `NoFile`;
  - `VIEW` + data content URI is accepted;
  - a `file://` URI gives `UnsupportedScheme`;
  - an `http://` URI gives `UnsupportedScheme`;
  - an own-authority URI gives `OwnAppUri`;
  - an unknown action gives `NoFile`.
- `ShareRoutingTest`: `secret.gpg` / `SECRET.PGP` route to Decrypt; `photo.jpg`, `noext` and a missing name route to Encrypt.
- `ShareViewModelTest`:
  - flow and URI restore from `SavedStateHandle`;
  - `describe` failure gives a rejected state;
  - the passphrase never appears in `SavedStateHandle`;
  - the success event moves to the result state with name and URI;
  - the wrong-mode action switches the flow while keeping the URI.

**Instrumented tests** (`app/src/androidTest`):

- Add a test-only `FileProvider` in the androidTest manifest serving files from the test APK's cache, so incoming URIs are real `content://` URIs with grants. That matches production, now that `file://` is rejected.
- `shareTextFileOpensEncryptWithFilePreselected`: launch `ShareActivity` with `ACTION_SEND` + `EXTRA_STREAM` for `report.md` + `FLAG_GRANT_READ_URI_PERMISSION`. The title is "Encrypt with GPG Local", the card shows `report.md`, Change is absent and the bottom nav is absent.
- `shareGpgFileOpensDecrypt`: the same with `secret.gpg` gives "Decrypt with GPG Local".
- `viewGpgFileOpensDecrypt`: `ACTION_VIEW` with type `application/pgp-encrypted`.
- `encryptViaShareThenShareOnward`: stub `ACTION_CREATE_DOCUMENT` with a temp document and complete encryption. The result card is shown. Tap **Share encrypted file** and assert a chooser wrapping `ACTION_SEND` with `EXTRA_STREAM == output`, `FLAG_GRANT_READ_URI_PERMISSION`, and GPG Local excluded.
- `decryptViaShareThenOpen`: the result card is shown, and **Open** sends `ACTION_VIEW` with the output URI.
- `doneFinishesActivity`: tapping Done finishes `ShareActivity` (`scenario.state == DESTROYED`).
- `fileSchemeIsRejected`: `ACTION_SEND` with a `file://` URI shows "This file can't be opened. Share it from a file manager." and no file is read.
- `textShareIsRejected`: `ACTION_SEND` with `EXTRA_TEXT` only shows "GPG Local can only encrypt or decrypt files.".
- `rotationKeepsSharedFileAndClearsNothingElse`: rotate on the form; the file is still selected and the typed passphrase is kept (same process). Rotate on the result step; the result is still shown.
- `closeIsBlockedWhileLoading`: during encryption, back and ✕ do not finish the activity.
- `flagSecureIsSetInShareMode`.
- `mainActivityUnaffected`: feature 12–14 UI tests still pass.

**Manual checks:**

- Share a photo from Google Photos, encrypt it, then share `photo.jpg.gpg` to a messenger and to email. Decrypt the received file with desktop GPG Local.
- Tap a `.gpg` email attachment (Gmail), choose GPG Local in "Open with" (if the provider reports `application/pgp-encrypted`) or use Share, and decrypt.
- Start a share while GPG Local is already open on the Encrypt tab with a half-filled form. After finishing the share flow, the main app task is unchanged.

---

## File Tree After This Feature

```
android/app/src/main/
├── AndroidManifest.xml                 # + ShareActivity with SEND / VIEW filters
├── kotlin/com/gpglocal/app/
│   ├── share/                          # ← new
│   │   ├── ShareActivity.kt
│   │   ├── ShareRoot.kt                # Loading / Rejected / Flow / Result
│   │   ├── ShareViewModel.kt
│   │   ├── IncomingFileParser.kt
│   │   └── ShareResultCard.kt
│   └── ui/
│       ├── common/Presentation.kt      # ← new: Tab | Share
│       ├── encrypt/EncryptScreen.kt    # + presentation param; Encrypted event carries output Uri
│       ├── encrypt/EncryptViewModel.kt
│       └── decrypt/DecryptScreen.kt    # + presentation param
└── res/values/strings.xml              # + share_* strings
android/app/src/androidTest/
├── AndroidManifest.xml                 # + test FileProvider
└── res/xml/test_file_paths.xml
```

---

## Visual Layout Reference

### Share sheet (system UI)

```
┌───────────────────────────────┐
│ Share report.md               │
│  [Messages] [Gmail] [Drive]   │
│  [GPG Local] [Bluetooth] …    │  ← single "GPG Local" entry
└───────────────────────────────┘
```

### Share mode: encrypt form

```
┌───────────────────────────────┐
│ ✕   Encrypt with GPG Local    │  ← no bottom navigation
├───────────────────────────────┤
│ ┌───────────────────────────┐ │
│ │ 📄 report.md      12 kB   │ │  ← no Change button
│ │    → report.md.gpg        │ │
│ └───────────────────────────┘ │
│ ┌ Passphrase ─────────────┐👁 │
│ └─────────────────────────┘   │
│ ┌ Confirm passphrase ─────┐👁 │
│ └─────────────────────────┘   │
│ [         Encrypt         ]   │
└───────────────────────────────┘
```

### Share mode: result (encrypt)

```
┌───────────────────────────────┐
│ ✕   Encrypt with GPG Local    │
├───────────────────────────────┤
│                               │
│      ✓ report.md encrypted    │
│      Saved as report.md.gpg   │
│                               │
│  [   Share encrypted file   ] │  ← primary
│  [           Done           ] │  ← secondary
│                               │
└───────────────────────────────┘
```

### Share mode: rejected

```
┌───────────────────────────────┐
│ ✕   GPG Local                 │
├───────────────────────────────┤
│   GPG Local can only encrypt  │
│   or decrypt files.           │
│                               │
│  [           Close          ] │
└───────────────────────────────┘
```

---

## Security Considerations

- **Incoming intents are untrusted.** `ShareActivity` is exported, so any app can launch it with any URI. Only `content://` URIs are accepted, and URIs under GPG Local's own authorities are rejected. That blocks a malicious app from getting the user to "encrypt and save" the app's private keyring (a confused-deputy export).
- **Grants stay scoped.** The incoming read grant belongs to `ShareActivity` for the life of that task. The app takes no persistable permissions. Outgoing shares pass only a one-time read grant on the single output document.
- **No plaintext forwarding shortcut.** The result step offers onward sharing only for encrypted output. Decrypted plaintext can only be opened in a viewer, so the user can't send plaintext to a chat app in one tap by mistake.
- **No temp copies.** Shared files are streamed from the sender's provider through file descriptors, exactly as in features 13/14. Nothing is cached in app storage.
- **The passphrase rules are unchanged:** memory only, never in `SavedStateHandle`, `FLAG_SECURE` on all share screens, and cleared on success.
- **Task isolation.** Share flows run in the sender's task and are excluded from Recents, so they can't be resumed later from Recents with a stale passphrase on screen.
- **The share-sheet entry exposes no data.** The activity shows nothing about the keyring or previous operations. It only acts on the file it was given.

---

## Acceptance Criteria

- [ ] "GPG Local" appears once in the system share sheet when sharing a single file of any type, and does not appear for multi-file or text-only shares.
- [ ] Sharing a `.gpg` / `.pgp` file opens "Decrypt with GPG Local" with the file pre-selected. Sharing any other file opens "Encrypt with GPG Local" with the file pre-selected.
- [ ] Opening a file whose provider reports `application/pgp-encrypted` or `application/pgp` offers GPG Local in "Open with" and opens the Decrypt flow.
- [ ] Share mode shows a close button and no bottom navigation, and hides the file card's Change button.
- [ ] Validation, progress, inline errors, save picker and failure cleanup behave exactly as in features 13 and 14.
- [ ] After a successful encryption the result step shows the output name with **Share encrypted file** and **Done**. Sharing passes the `.gpg` with a read grant to the chosen app and excludes GPG Local from the chooser.
- [ ] After a successful decryption the result step shows **Open** and **Done**. No onward-share option is offered for plaintext.
- [ ] **Done** and ✕ return to the sending app. Back and ✕ are blocked while an operation runs.
- [ ] A `file://` URI, a text-only share, or a URI pointing into GPG Local's own provider is rejected with the matching message and nothing is read.
- [ ] The shared file and the result step survive rotation. After process death the shared file is restored and the passphrase is empty.
- [ ] Share flows don't appear as a separate card in Recents and don't change the state of an already open GPG Local main window.
- [ ] `FLAG_SECURE` is set on every share-mode screen.
- [ ] The main app (launcher entry, tabs, features 12–14) behaves exactly as before, and its tests pass.
- [ ] `./gradlew test` and `./gradlew connectedDebugAndroidTest` pass. Desktop `pnpm test`, `pnpm test:e2e` and `pnpm build:tauri` are unaffected.
