// Runtime permissions με branded dialog πριν το native OS prompt.
// Σε Android → Capacitor, αλλιώς → browser fallback (no-op for camera).
import { useState, useCallback } from 'react';
import { Capacitor } from '@capacitor/core';

// lazy imports — Capacitor plugins δεν υπάρχουν στο web build
const getGeolocation = () => import('@capacitor/geolocation').then(m => m.Geolocation);
const getCamera      = () => import('@capacitor/camera').then(m => m.Camera);

// Επιστρέφει { requestLocation, requestCamera, PermissionDialog }
export function useAndroidPermissions() {
  const [dialog, setDialog] = useState(null);
  // dialog: { type, onConfirm, onDeny } | null

  const isAndroid = Capacitor.isNativePlatform();

  // ── Location ──────────────────────────────────────────────────────────────
  const requestLocation = useCallback(() => {
    return new Promise((resolve) => {
      if (!isAndroid) {
        // Browser fallback
        navigator.geolocation
          ? resolve({ granted: true })
          : resolve({ granted: false, reason: 'not_supported' });
        return;
      }

      setDialog({
        type: 'location',
        icon: '📍',
        title: 'Πρόσβαση Τοποθεσίας',
        message: 'Η εφαρμογή χρειάζεται την τοποθεσία σου για να σου δείξει τη βέλτιστη διαδρομή στο super market και να υπολογίσει αποστάσεις.',
        confirmText: 'Επιτρέπω',
        denyText: 'Όχι τώρα',
        onConfirm: async () => {
          setDialog(null);
          try {
            const Geo = await getGeolocation();
            const result = await Geo.requestPermissions({ permissions: ['location'] });
            const granted = result.location === 'granted' || result.coarseLocation === 'granted';
            resolve({ granted });
          } catch {
            resolve({ granted: false, reason: 'error' });
          }
        },
        onDeny: () => {
          setDialog(null);
          resolve({ granted: false, reason: 'denied_by_user' });
        },
      });
    });
  }, [isAndroid]);

  // ── Camera ────────────────────────────────────────────────────────────────
  const requestCamera = useCallback(() => {
    return new Promise((resolve) => {
      if (!isAndroid) {
        resolve({ granted: true }); // browser handles its own permission
        return;
      }

      setDialog({
        type: 'camera',
        icon: '📷',
        title: 'Πρόσβαση Κάμερας',
        message: 'Για να σκανάρεις barcodes προϊόντων και να βρεις αμέσως τιμές & θρεπτικές αξίες, χρειαζόμαστε πρόσβαση στην κάμερα.',
        confirmText: 'Επιτρέπω',
        denyText: 'Άκυρο',
        onConfirm: async () => {
          setDialog(null);
          try {
            const Cam = await getCamera();
            const result = await Cam.requestPermissions({ permissions: ['camera'] });
            const granted = result.camera === 'granted';
            resolve({ granted });
          } catch {
            resolve({ granted: false, reason: 'error' });
          }
        },
        onDeny: () => {
          setDialog(null);
          resolve({ granted: false, reason: 'denied_by_user' });
        },
      });
    });
  }, [isAndroid]);

  // ── Permission Dialog Component ───────────────────────────────────────────
  const PermissionDialog = dialog ? (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '0 24px',
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: 'var(--bg-card)',
        borderRadius: 20,
        padding: '28px 24px',
        maxWidth: 340,
        width: '100%',
        boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
        border: '1px solid rgba(99,102,241,0.2)',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>{dialog.icon}</div>
        <div style={{
          fontSize: 18, fontWeight: 800,
          color: 'var(--text-primary)',
          marginBottom: 10,
        }}>{dialog.title}</div>
        <div style={{
          fontSize: 14, lineHeight: 1.6,
          color: 'var(--text-secondary)',
          marginBottom: 24,
        }}>{dialog.message}</div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={dialog.onDeny} style={{
            flex: 1, padding: '12px 0', borderRadius: 12,
            border: '1.5px solid var(--border)',
            background: 'transparent',
            color: 'var(--text-secondary)',
            fontWeight: 600, fontSize: 14, cursor: 'pointer',
          }}>
            {dialog.denyText}
          </button>
          <button onClick={dialog.onConfirm} style={{
            flex: 2, padding: '12px 0', borderRadius: 12,
            border: 'none',
            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
            color: '#fff',
            fontWeight: 700, fontSize: 14, cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(99,102,241,0.35)',
          }}>
            {dialog.confirmText}
          </button>
        </div>
        <div style={{
          marginTop: 14, fontSize: 11,
          color: 'var(--text-muted)',
          lineHeight: 1.4,
        }}>
          Μπορείς να αλλάξεις την επιλογή σου αργότερα από τις Ρυθμίσεις.
        </div>
      </div>
    </div>
  ) : null;

  return { requestLocation, requestCamera, PermissionDialog };
}
