plugins {
    id("com.android.application")
}

val previewUrl = System.getenv("DOCENTETUC_PREVIEW_URL")?.trim().orEmpty()
val previewRequested = gradle.startParameter.taskNames.any { it.contains("preview", ignoreCase = true) }
val previewUri = if (previewRequested) previewUrl.takeIf { it.isNotEmpty() }?.let { java.net.URI(it) } else null
val previewHost = previewUri?.host?.lowercase().orEmpty()
if (previewRequested) {
    require("https".equals(previewUri?.scheme, ignoreCase = true) && previewHost.contains('.') &&
        !previewHost.endsWith('.') && previewUri?.port == -1 &&
        previewUri?.userInfo == null && previewUri?.rawQuery == null && previewUri?.rawFragment == null &&
        (previewUri?.path.isNullOrEmpty() || previewUri?.path == "/") &&
        previewHost !in setOf("docentetuc.possee41.workers.dev", "docentetuc.com.ar", "www.docentetuc.com.ar")) {
        "DOCENTETUC_PREVIEW_URL debe ser el origen HTTPS aislado de 1.2, nunca el sitio publicado."
    }
}
val previewOrigin = if (previewHost.isNotEmpty()) "https://$previewHost" else ""

android {
    namespace = "ar.com.docentetuc.app"
    compileSdk = 36

    defaultConfig {
        applicationId = "ar.com.docentetuc.app"
        minSdk = 24
        targetSdk = 36
        versionCode = 11
        versionName = "1.0.10"
        manifestPlaceholders["twaUrl"] = "https://docentetuc.possee41.workers.dev/"
        manifestPlaceholders["twaHost"] = "docentetuc.possee41.workers.dev"
        manifestPlaceholders["assetStatementsResource"] = "@string/asset_statements"
    }

    buildTypes {
        create("preview") {
            initWith(getByName("debug"))
            applicationIdSuffix = ".preview"
            versionNameSuffix = "-preview"
            signingConfig = signingConfigs.getByName("debug")
            manifestPlaceholders["twaUrl"] = if (previewOrigin.isNotEmpty()) "$previewOrigin/" else ""
            manifestPlaceholders["twaHost"] = previewHost
            manifestPlaceholders["assetStatementsResource"] = "@string/preview_asset_statements"
            resValue("string", "preview_asset_statements", """[{\"relation\":[\"delegate_permission/common.handle_all_urls\"],\"target\":{\"namespace\":\"web\",\"site\":\"$previewOrigin\"}}]""")
        }
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
