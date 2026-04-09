// src/PlateScannerModal.jsx
import { useState, useRef, useEffect, useCallback } from 'react';
import './PlateScannerModal.css';

/* ─────────────────────────────────────────────
   Image compression helper
───────────────────────────────────────────── */
async function compressImage(file, maxDim = 800, quality = 0.75) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ratio = Math.min(maxDim / img.width, maxDim / img.height, 1);
        canvas.width  = Math.round(img.width  * ratio);
        canvas.height = Math.round(img.height * ratio);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve({ base64: dataUrl.split(',')[1], mediaType: 'image/jpeg', preview: dataUrl });
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

const LEARNING_PROFILE_KEY = 'sg_plate_scanner_profile_v1';

function readLearningProfile() {
  try {
    const raw = localStorage.getItem(LEARNING_PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      scanCount: parsed?.scanCount || 0,
      frequentFoods: Array.isArray(parsed?.frequentFoods) ? parsed.frequentFoods.slice(0, 8) : [],
      recentFoods: Array.isArray(parsed?.recentFoods) ? parsed.recentFoods.slice(0, 12) : [],
      lastConfidence: parsed?.lastConfidence || null,
    };
  } catch {
    return { scanCount: 0, frequentFoods: [], recentFoods: [], lastConfidence: null };
  }
}

function persistLearningProfile(profile) {
  try {
    localStorage.setItem(LEARNING_PROFILE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage write failures.
  }
}

function buildLearningContext(profile) {
  return {
    scanCount: profile.scanCount || 0,
    frequentFoods: profile.frequentFoods || [],
    recentFoods: profile.recentFoods || [],
    lastConfidence: profile.lastConfidence || null,
  };
}

function updateLearningProfile(profile, result) {
  const nextCount = (profile.scanCount || 0) + 1;
  const recentFoods = [
    ...(result.foods || []).map((food) => food.name).filter(Boolean),
    ...(profile.recentFoods || []),
  ].slice(0, 12);

  const frequencyMap = new Map();
  [...recentFoods, ...(profile.frequentFoods || [])].forEach((food) => {
    frequencyMap.set(food, (frequencyMap.get(food) || 0) + 1);
  });

  return {
    scanCount: nextCount,
    recentFoods,
    frequentFoods: [...frequencyMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([food]) => food),
    lastConfidence: result.confidence || null,
  };
}

/* ─────────────────────────────────────────────
   MacroRing — animated SVG donut
   Props: value (number), max (number), color (css var string),
          label (string), unit (string)
───────────────────────────────────────────── */
function MacroRing({ value, max, color, label, unit }) {
  const R            = 30;
  const STROKE_W     = 6;
  const C            = 2 * Math.PI * R;
  const circumference = C;
  const ratio        = max > 0 ? Math.min(value / max, 1) : 0;
  const [dashArray, setDashArray] = useState('0 ' + circumference);

  useEffect(() => {
    // Animate after mount
    const t = requestAnimationFrame(() => {
      setDashArray(`${ratio * circumference} ${circumference}`);
    });
    return () => cancelAnimationFrame(t);
  }, [ratio, circumference]);

  const size = (R + STROKE_W) * 2 + 4;
  const center = size / 2;

  return (
    <div className="macro-ring-wrap">
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        aria-label={`${label}: ${value} ${unit}`}
      >
        {/* Track */}
        <circle
          cx={center}
          cy={center}
          r={R}
          fill="none"
          stroke="rgba(0,0,0,0.07)"
          strokeWidth={STROKE_W}
        />
        {/* Arc */}
        <circle
          cx={center}
          cy={center}
          r={R}
          fill="none"
          stroke={color}
          strokeWidth={STROKE_W}
          strokeLinecap="round"
          strokeDasharray={dashArray}
          strokeDashoffset={-(circumference / 4)}
          style={{ transition: 'stroke-dasharray 0.9s cubic-bezier(0.34,1.56,0.64,1)' }}
        />
        {/* Center value */}
        <text
          x={center}
          y={center + 1}
          textAnchor="middle"
          dominantBaseline="middle"
          fontSize="11"
          fontWeight="700"
          fill="var(--text-primary)"
        >
          {value}
        </text>
      </svg>
      <span className="macro-ring-unit">{unit}</span>
      <span className="macro-ring-label">{label}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Confidence badge
───────────────────────────────────────────── */
function ConfidenceBadge({ confidence }) {
  const map = {
    high:   { label: 'Υψηλή ακρίβεια',   cls: 'badge-high'   },
    medium: { label: 'Μέτρια ακρίβεια',  cls: 'badge-medium' },
    low:    { label: 'Χαμηλή ακρίβεια',  cls: 'badge-low'    },
  };
  const key   = (confidence || '').toLowerCase();
  const entry = map[key] || map.medium;
  return <span className={`psm-badge ${entry.cls}`}>{entry.label}</span>;
}

/* ─────────────────────────────────────────────
   Main component
───────────────────────────────────────────── */
export default function PlateScannerModal({ isOpen, onClose, apiBase, onAddToList }) {
  // step: 'capture' | 'scanning' | 'results' | 'error'
  const [step, setStep]         = useState('capture');
  const [preview, setPreview]   = useState(null);   // data-url for preview
  const [imageData, setImageData] = useState(null); // { base64, mediaType }
  const [results, setResults]   = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const [addedMsg, setAddedMsg] = useState(false);
  const [learningProfile, setLearningProfile] = useState(() => readLearningProfile());

  const fileInputRef    = useRef(null); // gallery pick
  const cameraInputRef  = useRef(null); // direct camera
  const addedTimerRef   = useRef(null);

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setStep('capture');
      setPreview(null);
      setImageData(null);
      setResults(null);
      setErrorMsg('');
      setAddedMsg(false);
    }
    return () => {
      if (addedTimerRef.current) clearTimeout(addedTimerRef.current);
    };
  }, [isOpen]);

  const handleFileChange = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressImage(file);
      setPreview(compressed.preview);
      setImageData({ base64: compressed.base64, mediaType: compressed.mediaType });
    } catch {
      setErrorMsg('Δεν ήταν δυνατή η φόρτωση της εικόνας. Δοκίμασε ξανά.');
      setStep('error');
    }
    // Reset input so the same file can be re-selected
    e.target.value = '';
  }, []);

  const handleScan = useCallback(async () => {
    if (!imageData) return;
    setStep('scanning');
    setErrorMsg('');

    try {
      const base = (apiBase || '').replace(/\/+$/, '');
      const token = localStorage.getItem('smart_grocery_token');
      const res = await fetch(`${base}/api/plate-scanner/scan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          image: imageData.base64,
          mediaType: imageData.mediaType,
          learningContext: buildLearningContext(learningProfile),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || data.message || `Σφάλμα διακομιστή (${res.status})`);
      }

      const data = await res.json();
      setResults(data);
      setLearningProfile((prev) => {
        const next = updateLearningProfile(prev, data);
        persistLearningProfile(next);
        return next;
      });
      setStep('results');
    } catch (err) {
      setErrorMsg(err.message || 'Κάτι πήγε στραβά. Δοκίμασε ξανά.');
      setStep('error');
    }
  }, [imageData, apiBase, learningProfile]);

  const handleReset = useCallback(() => {
    setStep('capture');
    setPreview(null);
    setImageData(null);
    setResults(null);
    setErrorMsg('');
    setAddedMsg(false);
  }, []);

  const handleAddToList = useCallback(() => {
    if (!results?.foods) return;
    const names = results.foods.map(f => f.name);
    onAddToList?.(names);
    setAddedMsg(true);
    addedTimerRef.current = setTimeout(() => setAddedMsg(false), 2500);
  }, [results, onAddToList]);

  if (!isOpen) return null;

  /* ── Macro max estimates for ring fill (sensible daily-meal reference) ── */
  const macroMaxes = { calories: 800, protein: 60, carbs: 80, fat: 40 };

  return (
    <div className="psm-modal" role="dialog" aria-modal="true" aria-label="Meal Scanner">

      {/* ── STEP: CAPTURE ─────────────────────────────── */}
      {step === 'capture' && (
        <div className="psm-screen psm-capture">
          {/* Header */}
          <div className="psm-header">
            <h2 className="psm-title">
              <span className="psm-title-icon">📊</span> Meal Macros
            </h2>
            <button className="psm-close-btn" onClick={onClose} aria-label="Κλείσιμο">✕</button>
          </div>

          {/* Capture area */}
          <div className="psm-capture-body">
            <div className="psm-capture-glass-card">
              <div className={`psm-capture-viewfinder ${preview ? 'psm-capture-viewfinder--filled' : ''}`}>
                {/* Corner tick marks for viewfinder effect */}
                <span className="psm-vf-corner psm-vf-corner--tl" aria-hidden="true" />
                <span className="psm-vf-corner psm-vf-corner--tr" aria-hidden="true" />
                <span className="psm-vf-corner psm-vf-corner--bl" aria-hidden="true" />
                <span className="psm-vf-corner psm-vf-corner--br" aria-hidden="true" />

                {preview ? (
                  <img src={preview} alt="Προεπισκόπηση πιάτου" className="psm-preview-img" />
                ) : (
                  <div className="psm-capture-placeholder">
                    <span className="psm-plate-emoji" aria-hidden="true">🍽️</span>
                    <p className="psm-capture-hint">Φωτογράφισε<br />το πιάτο σου</p>
                  </div>
                )}
              </div>

              <p className="psm-tip-text">
                Τοποθέτησε ολόκληρο το πιάτο στο πλαίσιο για καλύτερα αποτελέσματα
              </p>
              <div className="psm-learning-chip">
                {learningProfile.scanCount > 0
                  ? `Βελτιώνομαι από ${learningProfile.scanCount} προηγούμενα scans`
                  : 'Μαθαίνω από κάθε νέο πιάτο που σκανάρεις'}
              </div>
            </div>

            {/* Camera input (direct capture) */}
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handleFileChange}
              className="psm-file-input"
              aria-hidden="true"
              tabIndex={-1}
            />
            {/* Gallery input (no capture — opens photo picker) */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="psm-file-input"
              aria-hidden="true"
              tabIndex={-1}
            />

            {/* Buttons */}
            <div className="psm-capture-actions">
              {!preview ? (
                <div className="psm-source-btns">
                  <button
                    className="psm-source-btn psm-source-btn--camera"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <span className="psm-source-icon">📷</span>
                    <span className="psm-source-label">Κάμερα</span>
                    <span className="psm-source-sub">Τώρα</span>
                  </button>
                  <button
                    className="psm-source-btn psm-source-btn--gallery"
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <span className="psm-source-icon">🖼️</span>
                    <span className="psm-source-label">Γκαλερί</span>
                    <span className="psm-source-sub">Από αρχεία</span>
                  </button>
                </div>
              ) : (
                <>
                  <button
                    className="psm-btn psm-btn--gradient psm-btn--pill"
                    onClick={handleScan}
                  >
                    Ανάλυσε →
                  </button>
                  <div className="psm-reselect-row">
                    <button
                      className="psm-btn psm-btn--ghost psm-btn--sm"
                      onClick={() => cameraInputRef.current?.click()}
                    >
                      📷 Νέα φωτό
                    </button>
                    <button
                      className="psm-btn psm-btn--ghost psm-btn--sm"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      🖼️ Από γκαλερί
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── STEP: SCANNING ────────────────────────────── */}
      {step === 'scanning' && (
        <div className="psm-screen psm-scanning">
          {preview && (
            <div
              className="psm-scan-bg"
              style={{ backgroundImage: `url(${preview})` }}
              aria-hidden="true"
            />
          )}
          <div className="psm-scan-overlay" aria-hidden="true" />

          {/* Floating emojis */}
          <div className="psm-float-emojis" aria-hidden="true">
            {['🍗', '🥗', '🍝', '🥩'].map((em, i) => (
              <span key={em} className={`psm-float-emoji psm-float-emoji--${i + 1}`}>{em}</span>
            ))}
          </div>

          {/* Card */}
          <div className="psm-scan-card">
            <div className="psm-spinner" aria-label="Φόρτωση" />
            <p className="psm-scan-text">
              AI αναλύει το πιάτο σου<span className="psm-dots"><span>.</span><span>.</span><span>.</span></span>
            </p>
            <p className="psm-scan-subtext">Εκτιμώμενος χρόνος: 3-6 δευτερόλεπτα</p>
          </div>
        </div>
      )}

      {/* ── STEP: RESULTS ─────────────────────────────── */}
      {step === 'results' && results && (
        <div className="psm-screen psm-results">
          {/* Header */}
          <div className="psm-header psm-header--results">
            <h2 className="psm-title">
              <span className="psm-title-icon">📊</span> Αποτελέσματα
            </h2>
            <button className="psm-close-btn" onClick={onClose} aria-label="Κλείσιμο">✕</button>
          </div>

          <div className="psm-results-scroll">
            {/* Summary card */}
            <div className="psm-results-card psm-slide-up">

              {/* Badges row */}
              <div className="psm-badges-row">
                {results.mealType && (
                  <span className="psm-badge psm-badge--meal">{results.mealType}</span>
                )}
                <ConfidenceBadge confidence={results.confidence} />
                <span className="psm-badge psm-badge--memory">AI μνήμη ενεργή</span>
              </div>

              {/* Photo thumbnail */}
              {preview && (
                <div className="psm-thumb-wrap">
                  <img src={preview} alt="Φωτογραφία πιάτου" className="psm-thumb" />
                </div>
              )}

              {/* Macro rings */}
              <div className="psm-rings-row">
                <MacroRing
                  value={results.totals?.calories ?? 0}
                  max={macroMaxes.calories}
                  color="var(--psm-orange)"
                  label="Θερμίδες"
                  unit="kcal"
                />
                <MacroRing
                  value={results.totals?.protein ?? 0}
                  max={macroMaxes.protein}
                  color="var(--psm-blue)"
                  label="Πρωτεΐνη"
                  unit="g"
                />
                <MacroRing
                  value={results.totals?.carbs ?? 0}
                  max={macroMaxes.carbs}
                  color="var(--psm-green)"
                  label="Υδ/κες"
                  unit="g"
                />
                <MacroRing
                  value={results.totals?.fat ?? 0}
                  max={macroMaxes.fat}
                  color="var(--psm-yellow)"
                  label="Λίπος"
                  unit="g"
                />
              </div>

              {results.totals?.fiber != null && (
                <p className="psm-fiber-note">
                  Φυτικές ίνες: <strong>{results.totals.fiber}g</strong>
                </p>
              )}
            </div>

            {/* Food items */}
            {results.foods?.length > 0 && (
              <section className="psm-foods-section">
                <h3 className="psm-section-title">Ανιχνεύτηκαν τρόφιμα</h3>
                <div className="psm-foods-list">
                  {results.foods.map((food, idx) => (
                    <div key={idx} className="psm-food-card">
                      <div className="psm-food-top">
                        <span className="psm-food-emoji" aria-hidden="true">{food.emoji || '🍴'}</span>
                        <div className="psm-food-names">
                          <span className="psm-food-name">{food.name}</span>
                          {food.nameEn && <span className="psm-food-name-en">{food.nameEn}</span>}
                        </div>
                        <div className="psm-food-chips">
                          {food.portion && (
                            <span className="psm-chip psm-chip--portion">{food.portion}</span>
                          )}
                          {food.calories != null && (
                            <span className="psm-chip psm-chip--cal">{food.calories} kcal</span>
                          )}
                        </div>
                      </div>
                      <div className="psm-food-macros">
                        {food.protein != null && (
                          <span className="psm-macro-dot psm-macro-dot--protein">
                            <span className="psm-dot" aria-hidden="true" />
                            {food.protein}g πρωτ.
                          </span>
                        )}
                        {food.carbs != null && (
                          <span className="psm-macro-dot psm-macro-dot--carbs">
                            <span className="psm-dot" aria-hidden="true" />
                            {food.carbs}g υδ/κες
                          </span>
                        )}
                        {food.fat != null && (
                          <span className="psm-macro-dot psm-macro-dot--fat">
                            <span className="psm-dot" aria-hidden="true" />
                            {food.fat}g λίπος
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {/* AI tip */}
            {results.tip && (
              <div className="psm-tip-box" role="note">
                <span className="psm-tip-icon" aria-hidden="true">💡</span>
                <p className="psm-tip-content">{results.tip}</p>
              </div>
            )}

            {/* Action buttons */}
            <div className="psm-results-actions">
              <button className="psm-btn psm-btn--outline" onClick={handleReset}>
                🔄 Σκανάρισε πάλι
              </button>
              <button
                className={`psm-btn psm-btn--primary ${addedMsg ? 'psm-btn--success' : ''}`}
                onClick={handleAddToList}
                disabled={addedMsg}
              >
                {addedMsg ? '✓ Προστέθηκε!' : '➕ Προσθήκη στη λίστα'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── STEP: ERROR ───────────────────────────────── */}
      {step === 'error' && (
        <div className="psm-screen psm-error-screen">
          <div className="psm-header">
            <h2 className="psm-title">
              <span className="psm-title-icon">📊</span> Meal Macros
            </h2>
            <button className="psm-close-btn" onClick={onClose} aria-label="Κλείσιμο">✕</button>
          </div>

          <div className="psm-error-body">
            <div className="psm-error-card">
              <span className="psm-error-icon" aria-hidden="true">⚠️</span>
              <h3 className="psm-error-title">Ωχ, κάτι πήγε στραβά!</h3>
              <p className="psm-error-message">
                {errorMsg || 'Δεν ήταν δυνατή η ανάλυση της εικόνας. Βεβαιώσου ότι η φωτογραφία είναι ευκρινής και δοκίμασε ξανά.'}
              </p>
              <button className="psm-btn psm-btn--primary psm-btn--pill" onClick={handleReset}>
                🔄 Δοκίμασε ξανά
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
