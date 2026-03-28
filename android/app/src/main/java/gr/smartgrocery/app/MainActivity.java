package gr.smartgrocery.app;

import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import androidx.core.splashscreen.SplashScreen;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // ── Splash Screen API (Android 12+) ──────────────────────────────
        SplashScreen splashScreen = SplashScreen.installSplashScreen(this);

        super.onCreate(savedInstanceState);

        // ── Edge-to-Edge Display ──────────────────────────────────────────
        // Επιτρέπει στην εφαρμογή να σχεδιάζει κάτω από status bar & nav bar
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        Window window = getWindow();

        // Διαφανή bars
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
            window.setStatusBarColor(android.graphics.Color.TRANSPARENT);
            window.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        } else {
            window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_STATUS);
            window.clearFlags(WindowManager.LayoutParams.FLAG_TRANSLUCENT_NAVIGATION);
            window.setStatusBarColor(android.graphics.Color.TRANSPARENT);
            window.setNavigationBarColor(android.graphics.Color.TRANSPARENT);
        }

        // ── Display Cutout (notch support) ────────────────────────────────
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.getAttributes().layoutInDisplayCutoutMode =
                WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        }

        // ── Hardware Acceleration ─────────────────────────────────────────
        window.addFlags(WindowManager.LayoutParams.FLAG_HARDWARE_ACCELERATED);

        // ── Keep Screen On during loading ─────────────────────────────────
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
}
