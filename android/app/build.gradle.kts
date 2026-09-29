plugins {
    id("com.android.application")
}

android {
    namespace = "ar.com.docentetuc.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "ar.com.docentetuc.app"
        minSdk = 24
        targetSdk = 35
        versionCode = 8
        versionName = "1.0.7"
    }
}

dependencies {
    implementation("com.google.androidbrowserhelper:androidbrowserhelper:2.5.0")
}
