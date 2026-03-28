// Αρχικοποίηση Capacitor plugins κατά το boot της εφαρμογής.
// StatusBar → διαφανής overlay, SplashScreen → χειροκίνητο hide,
// App → back button handler για Android.
import { Capacitor } from '@capacitor/core';

export async function initCapacitor() {
  if (!Capacitor.isNativePlatform()) return;

  try {
    // ── StatusBar ─────────────────────────────────────────────────────────
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setOverlaysWebView({ overlay: true });
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: '#00000000' });
  } catch (e) {
    console.warn('[Capacitor] StatusBar init error:', e);
  }

  try {
    // ── SplashScreen: κρύψιμο ταυτόχρονα με το web animation ─────────────
    // Μικρή καθυστέρηση ώστε η native splash και το web animation να γίνουν
    // smooth handoff (native φεύγει καθώς το web animation αρχίζει)
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await new Promise(r => setTimeout(r, 300));
    await SplashScreen.hide({ fadeOutDuration: 500 });
  } catch (e) {
    console.warn('[Capacitor] SplashScreen hide error:', e);
  }
}

// Back button handler — καλείται στο App.jsx, επιστρέφει cleanup για το unmount.
export async function initBackButton(onBack) {
  if (!Capacitor.isNativePlatform()) return () => {};

  try {
    const { App } = await import('@capacitor/app');
    const handle = await App.addListener('backButton', onBack);
    return () => handle.remove();
  } catch {
    return () => {};
  }
}

// Haptic feedback — light/medium/success/error, no-ops on web.
export async function hapticFeedback(type = 'light') {
  if (!Capacitor.isNativePlatform()) return;
  try {
    const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
    if (type === 'success') {
      await Haptics.notification({ type: 'SUCCESS' });
    } else if (type === 'error') {
      await Haptics.notification({ type: 'ERROR' });
    } else {
      await Haptics.impact({ style: type === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
    }
  } catch { /* ignore */ }
}
