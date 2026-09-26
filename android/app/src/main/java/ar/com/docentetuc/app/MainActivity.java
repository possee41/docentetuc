package ar.com.docentetuc.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;

public class MainActivity extends Activity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        startActivity(new Intent(Intent.ACTION_VIEW,
                Uri.parse("https://docentetuc.possee41.chatgpt.site")));
        finish();
    }
}
