import groovy.json.JsonSlurper

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.android)
    alias(libs.plugins.kotlin.compose)
}

// Single source of version truth: package.json, which release.yml already checks against
// tauri.conf.json and src-tauri/Cargo.toml.
val appVersion: String =
    (JsonSlurper().parse(rootProject.projectDir.resolve("../package.json")) as Map<*, *>)["version"] as String

// MAJOR * 10_000 + MINOR * 100 + PATCH → 0.1.4 = 104, 1.2.3 = 10203
val appVersionCode: Int =
    appVersion.split('.').map(String::toInt).let { (maj, min, pat) ->
        require(min < 100 && pat < 100) { "minor/patch must be < 100 for versionCode: $appVersion" }
        maj * 10_000 + min * 100 + pat
    }

// Set only by the release workflow; local builds stay unsigned.
val releaseKeystore: String? = System.getenv("ANDROID_KEYSTORE_PATH")

android {
    namespace = "com.gpglocal.app"
    compileSdk = 35
    defaultConfig {
        applicationId = "com.gpglocal.app"
        minSdk = 26
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersion
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        ndk { abiFilters += listOf("arm64-v8a", "armeabi-v7a", "x86_64") }
    }
    signingConfigs {
        create("release") {
            if (releaseKeystore != null) {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("ANDROID_KEYSTORE_PASSWORD")
                keyAlias = System.getenv("ANDROID_KEY_ALIAS")
                keyPassword = System.getenv("ANDROID_KEY_PASSWORD")
                enableV2Signing = true
                enableV3Signing = true
            }
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (releaseKeystore != null) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }
    lint {
        abortOnError = true
        warningsAsErrors = false
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
    packaging { jniLibs { useLegacyPackaging = false } } // page-aligned, uncompressed .so
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    // Robolectric needs merged resources for Uri / ParcelFileDescriptor / SavedStateHandle in JVM tests.
    testOptions { unitTests { isIncludeAndroidResources = true } }
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
    testImplementation(libs.robolectric)
    testImplementation(libs.androidx.test.core)
    androidTestImplementation(platform(libs.compose.bom))
    androidTestImplementation(libs.compose.ui.test.junit4)
    androidTestImplementation(libs.androidx.test.ext)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.espresso.core)
    androidTestImplementation(libs.espresso.intents)
}
