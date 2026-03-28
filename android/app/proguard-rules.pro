# ── Capacitor / Cordova ───────────────────────────────────────────────────────
-keep class com.getcapacitor.** { *; }
-keep class com.getcapacitor.plugin.** { *; }
-keepclassmembers class * extends com.getcapacitor.Plugin {
    @com.getcapacitor.annotation.CapacitorPlugin <methods>;
    @com.getcapacitor.PluginMethod <methods>;
}

# ── WebView JS Interface ──────────────────────────────────────────────────────
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
-keepattributes JavascriptInterface

# ── AndroidX & Material ───────────────────────────────────────────────────────
-keep class androidx.** { *; }
-keep class com.google.android.material.** { *; }
-dontwarn androidx.**

# ── Splash Screen ─────────────────────────────────────────────────────────────
-keep class androidx.core.splashscreen.** { *; }

# ── Geolocation, Camera plugins ──────────────────────────────────────────────
-keep class com.getcapacitor.plugin.geolocation.** { *; }
-keep class com.getcapacitor.plugin.camera.** { *; }

# ── Keep line numbers for crash reports ──────────────────────────────────────
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile

# ── Stripe (αν χρησιμοποιείται) ──────────────────────────────────────────────
-dontwarn com.stripe.**
-keep class com.stripe.** { *; }

# ── General ───────────────────────────────────────────────────────────────────
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**
