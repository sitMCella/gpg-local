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
    group = "build"
    onlyIf { !skipRust }
    workingDir = ffiDir
    commandLine("bash", "build-android.sh")
    inputs.files(fileTree(coreDir.resolve("src")), coreDir.resolve("Cargo.toml"))
    inputs.files(
        fileTree(ffiDir.resolve("src")),
        ffiDir.resolve("Cargo.toml"),
        ffiDir.resolve("Cargo.lock"),
        ffiDir.resolve("uniffi.toml"),
        ffiDir.resolve("build-android.sh"),
        ffiDir.resolve(".cargo/config.toml"),
    )
    outputs.dir(distDir)
    // Resolved at execution time, so configuring the project (and -Pgpglocal.skipRust=true
    // builds) never requires the NDK to be installed.
    doFirst { environment("ANDROID_NDK_HOME", android.ndkDirectory.absolutePath) }
}

val checkRustDist by tasks.registering {
    description = "Fails early when -Pgpglocal.skipRust=true is used without a prebuilt dist/"
    onlyIf { skipRust }
    doLast {
        val so = distDir.resolve("jniLibs/arm64-v8a/libgpg_core_ffi.so")
        val kt = distDir.resolve("kotlin/com/gpglocal/core/gpg_core_ffi.kt")
        if (!so.isFile || !kt.isFile) {
            throw GradleException(
                "gpglocal.skipRust=true but $distDir is missing or incomplete. " +
                    "Run crates/gpg-core-ffi/build-android.sh or download the dist/ CI artifact.",
            )
        }
    }
}

tasks.named("preBuild") { dependsOn(buildRustCore, checkRustDist) }

dependencies {
    api("${libs.jna.get()}@aar") // JNA with Android native dispatch libs
    implementation(libs.coroutines.android)
    implementation(libs.androidx.annotation) // @RequiresApi in the generated bindings
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext)
    androidTestImplementation(libs.junit)
}
