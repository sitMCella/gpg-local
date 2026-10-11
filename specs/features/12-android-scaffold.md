# Feature: Android App Scaffold (Kotlin + Jetpack Compose)

Create the native Android project for GPG Local under `android/`: a Gradle build that compiles the Rust core through the UniFFI bindings from feature 11, a Jetpack Compose + Material 3 app shell with **Encrypt** and **Decrypt** destinations, an app-private keyring, and the test harness the following Android features build on. No encrypt/decrypt user flows yet: those are features 13 and 14.

---

## Motivation

Features 09–11 produced a Tauri-free Rust core and Kotlin bindings for it, but there is no app to host them yet. Before building user-facing flows, the project needs a skeleton that:

- builds the native library and the generated Kotlin as part of a normal `./gradlew` build,
- proves on a real device/emulator that Kotlin can call Rust (keyring on disk, encrypt/decrypt roundtrip, fd passing, typed errors),
- fixes the app architecture (one Activity, Compose, ViewModels, a repository over `GpgKeyring` running on `Dispatchers.IO`), and
- sets privacy defaults (no network permission, keyring excluded from backups) once, instead of per feature.

---

## Goals

1. Add a Gradle project at `android/` with two modules: `:gpgcore` (Android library wrapping the UniFFI output) and `:app` (the application).
2. `:gpgcore` runs `crates/gpg-core-ffi/build-android.sh` as a Gradle task and packages `dist/jniLibs` + `dist/kotlin`, so `./gradlew assembleDebug` works from a clean checkout with only the prerequisites installed.
3. `:app` is a single-Activity Jetpack Compose app with Material 3, a top app bar titled **GPG Local**, and a bottom navigation bar with **Encrypt** and **Decrypt** destinations showing placeholder screens.
4. A `GpgRepository` wraps `GpgKeyring` (created once, keyring in `context.filesDir`), runs every call on `Dispatchers.IO`, and returns a typed `GpgResult`.
5. Privacy defaults: no `INTERNET` permission, backups and device-transfer exclude the keyring, and release builds are minified with correct R8 keep rules for JNA/UniFFI.
6. Unit tests, Compose UI tests and instrumented tests that exercise the real Rust library on an emulator.

---

## Out of Scope

- Encrypt and decrypt flows, file pickers, passphrase dialogs (features 13, 14).
- Share-sheet integration (feature 15).
- Release signing, version alignment with the desktop release and CI jobs (feature 16).
- Key management UI (generate / import / list keys). The repository exposes the calls, but no screen uses them yet.
- Android Keystore / biometric protection.
- Tablet- or foldable-specific layouts, beyond what Material 3 adaptive defaults give.
- Localisation (English strings only, but all user-visible text lives in `strings.xml`).

---

## Prerequisites

| Requirement            | Notes                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------- |
| Feature 11 complete    | `crates/gpg-core-ffi/build-android.sh` produces `dist/jniLibs/<abi>/` and `dist/kotlin/`      |
| JDK 17                 | Required by Android Gradle Plugin 8.x                                                         |
| Android SDK            | Platform 35, Build-Tools 35, set via `ANDROID_HOME` or `android/local.properties`             |
| Android NDK r28        | Installed through the SDK Manager. The Gradle build pins `ndkVersion`                         |
| Rust + Android targets | As in feature 11 (`aarch64-linux-android`, `armv7-linux-androideabi`, `x86_64-linux-android`) |
| `cargo-ndk`            | As in feature 11                                                                              |
| Emulator or device     | API 26+ for instrumented tests. An `x86_64` emulator image matches the built ABIs             |

---

## Current State

- `crates/gpg-core-ffi/build-android.sh` builds `libgpg_core_ffi.so` for three ABIs and generates `dist/kotlin/com/gpglocal/core/gpg_core_ffi.kt`, exposing `GpgKeyring`, `KeyInfo` and `GpgException` (feature 11).
- The generated Kotlin loads the library through JNA and needs `net.java.dev.jna:jna` at runtime.
- There is no Android code, Gradle project or Android CI in the repository.

---

## Implementation Plan

### 1. Project layout

```
android/
├── settings.gradle.kts
├── build.gradle.kts                # plugin versions only (apply false)
├── gradle.properties
├── gradle/
│   ├── libs.versions.toml          # version catalog
│   └── wrapper/                    # committed Gradle wrapper
├── gradlew, gradlew.bat
├── gpgcore/                        # :gpgcore — Android library around the UniFFI output
│   ├── build.gradle.kts
│   ├── consumer-rules.pro
│   └── src/androidTest/kotlin/com/gpglocal/core/GpgCoreInstrumentedTest.kt
└── app/                            # :app — the application
    ├── build.gradle.kts
    ├── proguard-rules.pro
    └── src/
        ├── main/
        │   ├── AndroidManifest.xml
        │   ├── kotlin/com/gpglocal/app/
        │   │   ├── GpgLocalApp.kt          # Application + AppContainer
        │   │   ├── MainActivity.kt
        │   │   ├── data/GpgRepository.kt
        │   │   ├── data/GpgResult.kt
        │   │   └── ui/
        │   │       ├── GpgLocalAppUi.kt    # Scaffold, top bar, bottom nav, NavHost
        │   │       ├── Destinations.kt
        │   │       ├── encrypt/EncryptScreen.kt
        │   │       ├── decrypt/DecryptScreen.kt
        │   │       └── theme/{Theme,Color,Type}.kt
        │   └── res/
        │       ├── values/strings.xml
        │       ├── xml/data_extraction_rules.xml
        │       ├── xml/backup_rules.xml
        │       └── mipmap-*/ic_launcher*   # generated from public/icons.svg
        ├── test/kotlin/com/gpglocal/app/   # JVM unit tests
        └── androidTest/kotlin/com/gpglocal/app/  # Compose UI tests
```

Package / application ID: `com.gpglocal.app`, the same identifier as the desktop bundle (`tauri.conf.json`). The generated bindings keep package `com.gpglocal.core`.

### 2. Version catalog (`android/gradle/libs.versions.toml`)

```toml
[versions]
agp = "8.7.3"
kotlin = "2.0.21"
composeBom = "2024.12.01"
activityCompose = "1.9.3"
lifecycle = "2.8.7"
navigationCompose = "2.8.5"
coroutines = "1.9.0"
jna = "5.14.0"
junit = "4.13.2"
androidxTestRunner = "1.6.2"
androidxTestExt = "1.2.1"

[libraries]
compose-bom = { module = "androidx.compose:compose-bom", version.ref = "composeBom" }
compose-material3 = { module = "androidx.compose.material3:material3" }
compose-ui = { module = "androidx.compose.ui:ui" }
compose-ui-tooling-preview = { module = "androidx.compose.ui:ui-tooling-preview" }
compose-ui-tooling = { module = "androidx.compose.ui:ui-tooling" }
compose-ui-test-junit4 = { module = "androidx.compose.ui:ui-test-junit4" }
compose-ui-test-manifest = { module = "androidx.compose.ui:ui-test-manifest" }
compose-material-icons = { module = "androidx.compose.material:material-icons-extended" }
activity-compose = { module = "androidx.activity:activity-compose", version.ref = "activityCompose" }
lifecycle-viewmodel-compose = { module = "androidx.lifecycle:lifecycle-viewmodel-compose", version.ref = "lifecycle" }
lifecycle-runtime-compose = { module = "androidx.lifecycle:lifecycle-runtime-compose", version.ref = "lifecycle" }
navigation-compose = { module = "androidx.navigation:navigation-compose", version.ref = "navigationCompose" }
coroutines-android = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-android", version.ref = "coroutines" }
coroutines-test = { module = "org.jetbrains.kotlinx:kotlinx-coroutines-test", version.ref = "coroutines" }
jna = { module = "net.java.dev.jna:jna", version.ref = "jna" }
junit = { module = "junit:junit", version.ref = "junit" }
androidx-test-runner = { module = "androidx.test:runner", version.ref = "androidxTestRunner" }
androidx-test-ext = { module = "androidx.test.ext:junit", version.ref = "androidxTestExt" }

[plugins]
android-application = { id = "com.android.application", version.ref = "agp" }
android-library = { id = "com.android.library", version.ref = "agp" }
kotlin-android = { id = "org.jetbrains.kotlin.android", version.ref = "kotlin" }
kotlin-compose = { id = "org.jetbrains.kotlin.plugin.compose", version.ref = "kotlin" }
```

Shared SDK levels (both modules): `compileSdk = 35`, `targetSdk = 35`, `minSdk = 26`, Java/Kotlin target 17.

### 3. `:gpgcore` — build the Rust library from Gradle

`android/gpgcore/build.gradle.kts`:

```kotlin
plugins {
    alias(libs.plugins.android.library)
    alias(libs.plugins.kotlin.android)
}

val ffiDir = rootProject.projectDir.resolve("../crates/gpg-core-ffi").normalize()
val coreDir = rootProject.projectDir.resolve("../crates/gpg-core").normalize()
val distDir = ffiDir.resolve("dist")
val skipRust = providers.gradleProperty("gpglocal.skipRust").map { it.toBoolean() }.getOrElse(false)

android {
    namespace = "com.gpglocal.core"
    compileSdk = 35
    ndkVersion = "28.0.13004108"
    defaultConfig {
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }
    sourceSets["main"].apply {
        jniLibs.srcDir(distDir.resolve("jniLibs"))
        kotlin.srcDir(distDir.resolve("kotlin"))
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

val buildRustCore by tasks.registering(Exec::class) {
    description = "Builds libgpg_core_ffi.so for all ABIs and generates Kotlin bindings"
    onlyIf { !skipRust }
    workingDir = ffiDir
    commandLine("bash", "build-android.sh")
    environment("ANDROID_NDK_HOME", android.ndkDirectory.absolutePath)
    inputs.files(fileTree(coreDir.resolve("src")), coreDir.resolve("Cargo.toml"))
    inputs.files(fileTree(ffiDir.resolve("src")), ffiDir.resolve("Cargo.toml"),
                 ffiDir.resolve("uniffi.toml"), ffiDir.resolve("build-android.sh"))
    outputs.dir(distDir)
}

tasks.named("preBuild") { dependsOn(buildRustCore) }

dependencies {
    api("${libs.jna.get()}@aar")              // JNA with Android native dispatch libs
    implementation(libs.coroutines.android)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext)
    androidTestImplementation(libs.junit)
}
```

- The task declares its inputs and outputs, so Gradle skips the Rust build when neither crate changed.
- `-Pgpglocal.skipRust=true` uses an existing `dist/` (e.g. downloaded from the feature 11 CI artifact). That lets UI work happen without a Rust/NDK toolchain. The build fails with a clear message if `dist/` is missing in that mode.
- `api(jna@aar)` exposes JNA to `:app` with its Android `libjnidispatch.so` per ABI.

`android/gpgcore/consumer-rules.pro` (applied to `:app` release builds automatically):

```
-keep class com.sun.jna.** { *; }
-keepclassmembers class * extends com.sun.jna.** { public *; }
-keep class com.gpglocal.core.** { *; }
-dontwarn java.awt.**
```

### 4. `:app` module

`android/app/build.gradle.kts` (key parts):

```kotlin
plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

android {
    namespace = "com.gpglocal.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.gpglocal.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // signing config added in feature 16
        }
    }
    buildFeatures { compose = true }
    packaging { jniLibs { useLegacyPackaging = false } }   // page-aligned, uncompressed .so
    compileOptions { sourceCompatibility = JavaVersion.VERSION_17; targetCompatibility = JavaVersion.VERSION_17 }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation(project(":gpgcore"))
    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.activity.compose)
    implementation(libs.lifecycle.viewmodel.compose)
    implementation(libs.lifecycle.runtime.compose)
    implementation(libs.navigation.compose)
    implementation(libs.coroutines.android)
    debugImplementation(libs.compose.ui.tooling)
    debugImplementation(libs.compose.ui.test.manifest)
    testImplementation(libs.junit)
    testImplementation(libs.coroutines.test)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.ext)
}
```

`abiFilters` matches the ABIs from feature 11. `x86` (32-bit emulator) is intentionally excluded.

### 5. Manifest and privacy defaults

`android/app/src/main/AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <!-- No permissions: no INTERNET, no storage permissions (files come through SAF in features 13–15). -->
    <application
        android:name=".GpgLocalApp"
        android:label="@string/app_name"
        android:icon="@mipmap/ic_launcher"
        android:roundIcon="@mipmap/ic_launcher_round"
        android:theme="@android:style/Theme.Material.NoActionBar"
        android:allowBackup="false"
        android:fullBackupContent="@xml/backup_rules"
        android:dataExtractionRules="@xml/data_extraction_rules"
        android:enableOnBackInvokedCallback="true">
        <activity
            android:name=".MainActivity"
            android:exported="true"
            android:windowSoftInputMode="adjustResize">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

`res/xml/data_extraction_rules.xml` (Android 12+) excludes everything from cloud backup and device-to-device transfer:

```xml
<data-extraction-rules>
    <cloud-backup><exclude domain="file" path="." /></cloud-backup>
    <device-transfer><exclude domain="file" path="." /></device-transfer>
</data-extraction-rules>
```

`res/xml/backup_rules.xml` (Android 8–11) uses the same exclusion with `<full-backup-content>`.

The secret keyring must never leave the device through Google backup or a device-migration tool. Moving keys between devices is an explicit export/import feature later.

### 6. Application container and repository

`GpgLocalApp.kt`:

```kotlin
class GpgLocalApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

class AppContainer(context: Context) {
    // Keyring lives in <filesDir>/keyring/ — app-private, excluded from backups.
    private val keyring: GpgKeyring by lazy { GpgKeyring(context.filesDir.absolutePath) }
    val gpgRepository: GpgRepository by lazy { GpgRepository({ keyring }, Dispatchers.IO) }
}
```

Manual dependency injection is used on purpose: there is one dependency graph with two objects, and Hilt would add annotation processing and build time for no benefit at this size. If the graph grows, revisit this.

`data/GpgResult.kt`:

```kotlin
sealed interface GpgResult<out T> {
    data class Success<T>(val value: T) : GpgResult<T>
    data class Failure(val error: GpgFailure) : GpgResult<Nothing>
}

sealed interface GpgFailure {
    val message: String
    data class WrongPassphrase(override val message: String) : GpgFailure      // GpgException.NoMatchingSecretKey
    data class KeyNotFound(override val message: String) : GpgFailure          // GpgException.KeyNotFound
    data class NothingToEncryptFor(override val message: String) : GpgFailure  // GpgException.NoRecipientsOrPassphrase
    data class Io(override val message: String) : GpgFailure                   // GpgException.Io
    data class Crypto(override val message: String) : GpgFailure               // GpgException.OpenPgp
    data class Internal(override val message: String) : GpgFailure            // InternalException / unexpected
}
```

`data/GpgRepository.kt`:

```kotlin
class GpgRepository(
    private val keyring: () -> GpgKeyring,
    private val io: CoroutineDispatcher,
) {
    suspend fun listKeys(): GpgResult<List<KeyInfo>> = call { keyring().listKeys() }
    suspend fun importKey(armored: String) = call { keyring().importKey(armored) }
    suspend fun generateKey(name: String, email: String, passphrase: String) =
        call { keyring().generateKey(name, email, passphrase) }
    suspend fun encryptBytes(data: ByteArray, recipients: List<String>, passphrase: String?) =
        call { keyring().encryptBytes(data, recipients, passphrase) }
    suspend fun decryptBytes(data: ByteArray, passphrase: String) =
        call { keyring().decryptBytes(data, passphrase) }
    // encryptFd/decryptFd wrappers (taking ParcelFileDescriptor and calling detachFd()) arrive with features 13/14.

    private suspend fun <T> call(block: () -> T): GpgResult<T> = withContext(io) {
        try {
            GpgResult.Success(block())
        } catch (e: GpgException) {
            GpgResult.Failure(e.toFailure())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            GpgResult.Failure(GpgFailure.Internal(e.message ?: e.javaClass.simpleName))
        }
    }
}
```

- Every native call runs on `Dispatchers.IO`. The main thread never blocks on crypto.
- `GpgFailure.message` keeps the backend string verbatim, so later screens can show it in parentheses after a friendly text, as the desktop decrypt dialog does (feature 05).
- The keyring is supplied as a lambda, so JVM unit tests can pass a fake without loading the native library.
- Passphrases are never logged. The repository has no logging at all.

### 7. UI shell

`MainActivity` calls `enableEdgeToEdge()` and `setContent { GpgLocalTheme { GpgLocalAppUi() } }`.

`ui/GpgLocalAppUi.kt` renders a Material 3 `Scaffold`:

- **Top app bar**: `CenterAlignedTopAppBar` with title "GPG Local".
- **Bottom navigation**: `NavigationBar` with two items, **Encrypt** (`Icons.Outlined.Lock`) and **Decrypt** (`Icons.Outlined.LockOpen`). It replaces the desktop `ModeTabBar` (features 04/05). On a phone, top-level modes belong in the bottom bar within thumb reach. Encrypt is the start destination, matching the desktop default.
- **NavHost** (`navigation-compose`) with routes `encrypt` and `decrypt`. Switching tabs uses `launchSingleTop` + `restoreState`, so each screen keeps its state.

Placeholder screens (`EncryptScreen`, `DecryptScreen`) show a centered icon and a one-line description, e.g. "Choose a file to encrypt with a passphrase." The primary button is disabled and labelled "Choose file". Features 13/14 replace their contents without touching the shell.

Theme (`ui/theme/`):

- Material 3 `dynamicLightColorScheme` / `dynamicDarkColorScheme` on Android 12+. The fallback scheme takes its primary from the desktop selection colour (`oklch(0.488 0.243 264.376)` ≈ `#4F46E5`).
- Follows the system dark/light setting.
- The encrypted-file accent is amber (`#F59E0B`), as the desktop `Lock` icon uses, exposed as `LocalGpgColors.current.encrypted` for later features.

All strings live in `res/values/strings.xml` (`app_name`, `tab_encrypt`, `tab_decrypt`, placeholder texts, etc.).

App icon: generated from `public/icons.svg` (the desktop icon source) with Android Studio's Image Asset tool. The adaptive icon foreground and a monochrome layer go in `mipmap-anydpi-v26/`.

### 8. Tests

**JVM unit tests** (`app/src/test`):

- `GpgRepositoryTest`: with a fake keyring lambda, `GpgException.NoMatchingSecretKey` maps to `GpgFailure.WrongPassphrase` and keeps the message `no matching secret key found`. Each other `GpgException` subtype maps to its `GpgFailure`. An unexpected `RuntimeException` maps to `Internal`. `CancellationException` is rethrown. Calls run on the injected dispatcher (`StandardTestDispatcher`).

**Instrumented tests against the real native library** (`gpgcore/src/androidTest`, `GpgCoreInstrumentedTest`), using a fresh directory under `context.cacheDir` per test:

- `nativeLibraryLoads`: `GpgKeyring(dir)` succeeds and creates `<dir>/keyring/`.
- `symmetricBytesRoundtrip`: `encryptBytes` then `decryptBytes` gives the original bytes.
- `generateKeyThenList`: the key appears with `hasSecret == true`.
- `publicKeyRoundtrip`: generate a key, encrypt to its fingerprint, decrypt with its passphrase.
- `fdRoundtrip`: write plaintext to a cache file, open input/output with `ParcelFileDescriptor.open(...)`, call `encryptFd(in.detachFd(), out.detachFd(), …)`, then `decryptFd` the same way, and compare.
- `wrongPassphraseThrowsTypedException`: `assertThrows(GpgException.NoMatchingSecretKey::class.java)` with message `no matching secret key found`.
- `desktopCiphertextDecrypts`: a fixture `.gpg` file encrypted by the desktop app (symmetric, passphrase `correct horse`) stored in `androidTest/assets/` decrypts to the expected text. This proves cross-platform compatibility.

**Compose UI tests** (`app/src/androidTest`):

- `appLaunchesOnEncryptTab`: the "GPG Local" title is shown and the Encrypt item is selected.
- `switchingToDecryptShowsDecryptScreen`: tap Decrypt, then the Decrypt placeholder text is displayed and the Decrypt item is selected.
- `tabStateSurvivesRecreation`: switch to Decrypt, call `activityScenario.recreate()`, and Decrypt is still selected.

### 9. Commands and repository housekeeping

Add to `.gitignore`:

```
# Android
android/.gradle/
android/build/
android/*/build/
android/local.properties
android/.idea/
android/.kotlin/
```

Add to `CLAUDE.md`:

- Architecture: `android/` (`:app`, `:gpgcore`) and how it consumes `crates/gpg-core-ffi/dist/`.
- Commands:

```bash
cd android && ./gradlew assembleDebug                   # build debug APK (compiles Rust core first)
cd android && ./gradlew installDebug                    # install on connected device/emulator
cd android && ./gradlew test                            # JVM unit tests
cd android && ./gradlew connectedDebugAndroidTest       # instrumented + Compose UI tests
cd android && ./gradlew assembleDebug -Pgpglocal.skipRust=true   # reuse existing dist/
```

- Add `@specs/features/12-android-scaffold.md` to the spec list.

---

## File Tree After This Feature

```
gpg-local/
├── android/
│   ├── settings.gradle.kts
│   ├── build.gradle.kts
│   ├── gradle.properties
│   ├── gradle/libs.versions.toml
│   ├── gradlew, gradlew.bat, gradle/wrapper/
│   ├── gpgcore/                  # :gpgcore — UniFFI output + JNA, Rust build task
│   └── app/                      # :app — Compose shell, repository, theme, tests
├── crates/
│   ├── gpg-core/
│   └── gpg-core-ffi/             # dist/ consumed by :gpgcore
├── src-tauri/                    # unchanged
└── ...
```

---

## Visual Layout Reference

```
┌───────────────────────────────┐
│          GPG Local            │  ← CenterAlignedTopAppBar
├───────────────────────────────┤
│                               │
│                               │
│             🔒                │
│   Choose a file to encrypt    │  ← placeholder (feature 13 replaces)
│       with a passphrase.      │
│                               │
│        [ Choose file ]        │  ← disabled in this feature
│                               │
│                               │
├───────────────────────────────┤
│   ▣ Encrypt      ○ Decrypt    │  ← NavigationBar; Encrypt selected
└───────────────────────────────┘
```

---

## Security Considerations

- **No network access.** The manifest declares no `INTERNET` permission, so the app cannot send keys, passphrases or file contents anywhere, even by accident through a future dependency.
- **The keyring is app-private** (`filesDir`, mode `0700`, inaccessible to other apps without root) and **excluded from cloud backup and device transfer** through `allowBackup="false"`, `backup_rules.xml` and `data_extraction_rules.xml`.
- **No storage permissions.** The app never requests `READ/WRITE_EXTERNAL_STORAGE` or `MANAGE_EXTERNAL_STORAGE`. User files will be reached only through the Storage Access Framework, scoped to what the user picks.
- **R8 keep rules are scoped** to JNA and `com.gpglocal.core`. The rest of the app is minified and obfuscated in release builds.
- **Passphrases are not logged.** There is no logging in the repository layer, and the native library logs nothing (feature 11).
- **Main-thread safety.** Every native call goes through `GpgRepository` on `Dispatchers.IO`. StrictMode is enabled in debug builds (`detectDiskReads`, `detectDiskWrites`, `penaltyLog`) to catch violations early.

---

## Acceptance Criteria

- [ ] From a clean checkout with the prerequisites installed, `cd android && ./gradlew assembleDebug` builds the Rust core, generates bindings and produces an APK containing `lib/{arm64-v8a,armeabi-v7a,x86_64}/libgpg_core_ffi.so`.
- [ ] A second `assembleDebug` with no Rust changes skips `buildRustCore` (up-to-date).
- [ ] `-Pgpglocal.skipRust=true` builds from an existing `dist/` without invoking Cargo.
- [ ] The app installs and launches on API 26 and API 35 emulators. It shows "GPG Local" in the top bar and Encrypt / Decrypt in the bottom navigation, with Encrypt selected.
- [ ] Switching tabs shows the matching placeholder screen, and the selected tab survives configuration changes (rotation).
- [ ] The app follows the system dark/light theme and uses dynamic colour on Android 12+.
- [ ] The merged manifest contains no `uses-permission` entries.
- [ ] `adb backup` / Auto Backup does not include `files/keyring/` (`allowBackup=false` and the extraction rules are present).
- [ ] `./gradlew test` passes (repository error mapping).
- [ ] `./gradlew connectedDebugAndroidTest` passes on an `x86_64` emulator, including the desktop-ciphertext fixture test.
- [ ] `./gradlew assembleRelease` succeeds with R8 enabled, and the minified release APK can still load the native library and call `GpgKeyring` (smoke-tested by installing an unsigned/debug-signed release build).
- [ ] Desktop app, `pnpm test`, `pnpm test:e2e` and `pnpm build:tauri` are unaffected.
