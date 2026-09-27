package ar.com.docentetuc.app;

import android.content.pm.PackageManager;

import com.google.androidbrowserhelper.trusted.LauncherActivity;
import com.google.androidbrowserhelper.trusted.TwaLauncher;

public class MainActivity extends LauncherActivity {
    @Override
    protected TwaLauncher createTwaLauncher() {
        try {
            getPackageManager().getPackageInfo("com.android.chrome", 0);
            return new TwaLauncher(this, "com.android.chrome");
        } catch (PackageManager.NameNotFoundException ignored) {
            return super.createTwaLauncher();
        }
    }
}
