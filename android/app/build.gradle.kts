plugins {
    id("com.android.application")
}

android {
    namespace = "ar.com.docentetuc.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "ar.com.docentetuc.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 10
        versionName = "1.0.9"
    }

    val releaseKeystore = System.getenv("DOCENTETUC_KEYSTORE_PATH")
    if (!releaseKeystore.isNullOrBlank()) {
        signingConfigs {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = System.getenv("DOCENTETUC_STORE_PASSWORD")
                keyAlias = "docentetuc"
                keyPassword = System.getenv("DOCENTETUC_KEY_PASSWORD") ?: storePassword
            }
        }
        buildTypes.getByName("release").signingConfig = signingConfigs.getByName("release")
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
}
