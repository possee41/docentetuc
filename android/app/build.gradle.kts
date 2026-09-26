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
        versionCode = 3
        versionName = "1.0.2"
    }
}

dependencies {
    implementation("androidx.browser:browser:1.8.0")
}
