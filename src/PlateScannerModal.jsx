// src/PlateScannerModal.jsx
import { useState, useRef, useEffect, useCallback } from 'react';
import './PlateScannerModal.css';

/* ─────────────────────────────────────────────
   Image compression helper
───────────────────────────────────────────── */
async function compressImage(file, maxDim = 1024, quality = 0.82) {
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

/* ─────────────────────────────────────────────
   Storage keys
───────────────────────────────────────────── */
const LEARNING_PROFILE_KEY  = 'sg_plate_scanner_profile_v1';
const MEAL_MACRO_HISTORY_KEY = 'sg_plate_macro_history_v1';
const DAILY_NUTRITION_KEY   = 'sg_daily_nutrition_v1';
const WEIGHT_LOG_KEY        = 'sg_weight_log_v1';

/* ─────────────────────────────────────────────
   Learning profile helpers (unchanged)
───────────────────────────────────────────── */
function readLearningProfile() {
  try {
    const raw = localStorage.getItem(LEARNING_PROFILE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return {
      scanCount:      parsed?.scanCount      || 0,
      frequentFoods:  Array.isArray(parsed?.frequentFoods) ? parsed.frequentFoods.slice(0, 8) : [],
      recentFoods:    Array.isArray(parsed?.recentFoods)   ? parsed.recentFoods.slice(0, 12)  : [],
      lastConfidence: parsed?.lastConfidence || null,
    };
  } catch {
    return { scanCount: 0, frequentFoods: [], recentFoods: [], lastConfidence: null };
  }
}

function persistLearningProfile(profile) {
  try { localStorage.setItem(LEARNING_PROFILE_KEY, JSON.stringify(profile)); } catch {}
}

function readMacroHistory() {
  try {
    const raw = JSON.parse(localStorage.getItem(MEAL_MACRO_HISTORY_KEY) || '[]');
    return Array.isArray(raw) ? raw.slice(0, 10) : [];
  } catch { return []; }
}

function persistMacroHistory(history) {
  try { localStorage.setItem(MEAL_MACRO_HISTORY_KEY, JSON.stringify((history || []).slice(0, 10))); } catch {}
}

function createMacroHistoryEntry(results, preview) {
  return {
    id:        `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    scannedAt: new Date().toISOString(),
    preview:   preview && preview.length < 350000 ? preview : null,
    results,
  };
}

function buildLearningContext(profile) {
  return {
    scanCount:      profile.scanCount      || 0,
    frequentFoods:  profile.frequentFoods  || [],
    recentFoods:    profile.recentFoods    || [],
    lastConfidence: profile.lastConfidence || null,
  };
}

function updateLearningProfile(profile, result) {
  const nextCount   = (profile.scanCount || 0) + 1;
  const recentFoods = [
    ...(result.foods || []).map(f => f.name).filter(Boolean),
    ...(profile.recentFoods || []),
  ].slice(0, 12);

  const frequencyMap = new Map();
  [...recentFoods, ...(profile.frequentFoods || [])].forEach(food => {
    frequencyMap.set(food, (frequencyMap.get(food) || 0) + 1);
  });

  return {
    scanCount:      nextCount,
    recentFoods,
    frequentFoods:  [...frequencyMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([food]) => food),
    lastConfidence: result.confidence || null,
  };
}

/* ─────────────────────────────────────────────
   Daily nutrition logger
───────────────────────────────────────────── */
function logNutritionToDaily(totals) {
  const today = new Date().toISOString().slice(0, 10);
  try {
    const raw = JSON.parse(localStorage.getItem(DAILY_NUTRITION_KEY) || '{}');
    const day = raw[today] || { calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 };
    day.calories += totals.calories || 0;
    day.protein  += totals.protein  || 0;
    day.carbs    += totals.carbs    || 0;
    day.fat      += totals.fat      || 0;
    day.meals    += 1;
    raw[today] = day;
    const keys   = Object.keys(raw).sort().slice(-30);
    const pruned = {};
    keys.forEach(k => { pruned[k] = raw[k]; });
    localStorage.setItem(DAILY_NUTRITION_KEY, JSON.stringify(pruned));
  } catch {}
}

/* ─────────────────────────────────────────────
   Weight log helpers
───────────────────────────────────────────── */
function readWeightLog() {
  try {
    const raw = JSON.parse(localStorage.getItem(WEIGHT_LOG_KEY) || '[]');
    return Array.isArray(raw) ? raw.slice(0, 90) : [];
  } catch { return []; }
}

function persistWeightLog(entries) {
  try { localStorage.setItem(WEIGHT_LOG_KEY, JSON.stringify(entries.slice(0, 90))); } catch {}
}

/* ─────────────────────────────────────────────
   MacroBar — horizontal animated bar
───────────────────────────────────────────── */
function MacroBar({ label, value, max, color }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const t = requestAnimationFrame(() => setWidth(pct));
    return () => cancelAnimationFrame(t);
  }, [pct]);

  return (
    <div className="psm-macro-bar-row">
      <span className="psm-macro-bar-label">{label}</span>
      <div className="psm-macro-bar-track">
        <div
          className="psm-macro-bar-fill"
          style={{ width: `${width}%`, background: color, transition: 'width 0.9s cubic-bezier(0.34,1.56,0.64,1)' }}
        />
      </div>
      <span className="psm-macro-bar-value">{value}g</span>
    </div>
  );
}

/* ─────────────────────────────────────────────
   WeeklyChart — inline SVG bar chart (no deps)
───────────────────────────────────────────── */
function WeeklyChart({ data }) {
  const maxCal = Math.max(...data.map(d => d.calories), 200);
  const W = 300, H = 120, barW = 30;
  const gap = (W - 7 * barW) / 8;
  return (
    <svg viewBox={`0 0 ${W} ${H + 20}`} width="100%" className="psm-week-chart-svg">
      {data.map((d, i) => {
        const x    = gap + i * (barW + gap);
        const barH = Math.round((d.calories / maxCal) * H);
        const y    = H - barH;
        return (
          <g key={i}>
            <rect
              x={x} y={y} width={barW} height={barH > 0 ? barH : 2} rx={6}
              fill={d.isToday ? '#3b82f6' : '#10b981'}
              opacity={d.calories ? 1 : 0.15}
            />
            <text x={x + barW / 2} y={H + 14} textAnchor="middle" fontSize="10" fill="currentColor" opacity="0.6">
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* ─────────────────────────────────────────────
   WeightChart — inline SVG polyline (no deps)
───────────────────────────────────────────── */
function WeightChart({ entries }) {
  if (entries.length < 2) return null;
  const W = 300, H = 100, pad = 20;
  const weights = entries.map(e => e.weight);
  const minW    = Math.min(...weights) - 1;
  const maxW    = Math.max(...weights) + 1;
  const points  = entries.map((e, i) => {
    const x = pad + (i / (entries.length - 1)) * (W - 2 * pad);
    const y = H - pad - ((e.weight - minW) / (maxW - minW)) * (H - 2 * pad);
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" className="psm-weight-chart-svg">
      <polyline points={points} fill="none" stroke="#3b82f6" strokeWidth="2.5" strokeLinejoin="round" />
      {entries.map((e, i) => {
        const x = pad + (i / (entries.length - 1)) * (W - 2 * pad);
        const y = H - pad - ((e.weight - minW) / (maxW - minW)) * (H - 2 * pad);
        return <circle key={i} cx={x} cy={y} r="3.5" fill="#3b82f6" />;
      })}
    </svg>
  );
}

/* ─────────────────────────────────────────────
   HealthScorePill
───────────────────────────────────────────── */
function HealthScorePill({ score }) {
  if (score == null) return null;
  const cls = score >= 7 ? 'psm-health-score--good'
    : score >= 4         ? 'psm-health-score--mid'
    :                      'psm-health-score--bad';
  return (
    <span className={`psm-health-score ${cls}`}>
      {score}/10
    </span>
  );
}

/* ─────────────────────────────────────────────
   Main component
───────────────────────────────────────────── */
export default function PlateScannerModal({ isOpen, onClose, apiBase, onAddToList }) {
  /* ── Tab & mode state ── */
  const [activeTab, setActiveTab]   = useState('scan');
  const [scanMode, setScanMode]     = useState('camera'); // 'camera' | 'text'

  /* ── Scan flow state ── */
  const [step, setStep]             = useState('capture'); // capture|scanning|question|results|error
  const [preview, setPreview]       = useState(null);
  const [imageData, setImageData]   = useState(null);
  const [textInput, setTextInput]   = useState('');
  const [results, setResults]       = useState(null);
  const [errorMsg, setErrorMsg]     = useState('');
  const [addedMsg, setAddedMsg]     = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  /* ── Question flow state ── */
  const [clarification, setClarification]           = useState(null);
  const [pendingDescription, setPendingDescription] = useState(null);

  /* ── Persistent state ── */
  const [learningProfile, setLearningProfile] = useState(() => readLearningProfile());
  const [history, setHistory]                 = useState(() => readMacroHistory());

  /* ── Weight tab state ── */
  const [weightInput, setWeightInput] = useState('');
  const [weightLog, setWeightLog]     = useState(() => readWeightLog());

  /* ── Refs ── */
  const fileInputRef   = useRef(null);
  const cameraInputRef = useRef(null);
  const addedTimerRef  = useRef(null);

  /* ── Reset on open ── */
  useEffect(() => {
    if (isOpen) {
      setStep('capture');
      setPreview(null);
      setImageData(null);
      setTextInput('');
      setResults(null);
      setErrorMsg('');
      setAddedMsg(false);
      setShowDetails(false);
      setClarification(null);
      setPendingDescription(null);
      setActiveTab('scan');
    }
    return () => { if (addedTimerRef.current) clearTimeout(addedTimerRef.current); };
  }, [isOpen]);

  /* ─────────────────────────────────────────────
     File / image handlers
  ───────────────────────────────────────────── */
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
    e.target.value = '';
  }, []);

  /* ─────────────────────────────────────────────
     Process API response (shared by camera + text)
  ───────────────────────────────────────────── */
  const processResponse = useCallback(async (data) => {
    if (data.question) {
      setStep('question');
      return;
    }
    // Normal results
    setResults(data);
    if (data.totals) logNutritionToDaily(data.totals);
    setHistory(prev => {
      const next = [createMacroHistoryEntry(data, preview), ...prev].slice(0, 10);
      persistMacroHistory(next);
      return next;
    });
    setLearningProfile(prev => {
      const next = updateLearningProfile(prev, data);
      persistLearningProfile(next);
      return next;
    });
    setStep('results');
  }, [preview]);

  /* ─────────────────────────────────────────────
     Camera scan
  ───────────────────────────────────────────── */
  const handleCameraScan = useCallback(async (clarificationAnswer) => {
    if (!imageData) return;
    setStep('scanning');
    setErrorMsg('');
    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30000);
    try {
      const base  = (apiBase || '').replace(/\/+$/, '');
      const token = localStorage.getItem('smart_grocery_token');
      const res   = await fetch(`${base}/api/plate-scanner/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          image:           imageData.base64,
          mediaType:       imageData.mediaType,
          learningContext: buildLearningContext(learningProfile),
          clarification:   clarificationAnswer || undefined,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || d.message || `Σφάλμα διακομιστή (${res.status})`);
      }
      await processResponse(await res.json());
    } catch (err) {
      clearTimeout(timeout);
      setErrorMsg(err.name === 'AbortError'
        ? 'Η ανάλυση διήρκεσε πολύ. Δοκίμασε με μικρότερη εικόνα.'
        : err.message || 'Κάτι πήγε στραβά. Δοκίμασε ξανά.');
      setStep('error');
    }
  }, [imageData, apiBase, learningProfile, processResponse]);

  /* ─────────────────────────────────────────────
     Text analyze
  ───────────────────────────────────────────── */
  const handleTextAnalyze = useCallback(async (descriptionOverride, clarificationAnswer) => {
    const desc = descriptionOverride || textInput;
    if (!desc.trim()) return;
    setStep('scanning');
    setErrorMsg('');
    const ctrl    = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 30000);
    try {
      const base  = (apiBase || '').replace(/\/+$/, '');
      const token = localStorage.getItem('smart_grocery_token');
      const res   = await fetch(`${base}/api/plate-scanner/analyze-text`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({
          description:     desc,
          learningContext: buildLearningContext(learningProfile),
          clarification:   clarificationAnswer || undefined,
        }),
        signal: ctrl.signal,
      });
      clearTimeout(timeout);
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || d.message || `Σφάλμα διακομιστή (${res.status})`);
      }
      const data = await res.json();
      if (data.question) {
        setPendingDescription(desc);
        setStep('question');
        setResults(data); // store question payload in results temporarily
        return;
      }
      await processResponse(data);
    } catch (err) {
      clearTimeout(timeout);
      setErrorMsg(err.name === 'AbortError'
        ? 'Η ανάλυση διήρκεσε πολύ. Δοκίμασε ξανά.'
        : err.message || 'Κάτι πήγε στραβά. Δοκίμασε ξανά.');
      setStep('error');
    }
  }, [textInput, apiBase, learningProfile, processResponse]);

  /* ─────────────────────────────────────────────
     Question answer handler
  ───────────────────────────────────────────── */
  const handleChoiceSelect = useCallback((choice) => {
    setClarification(choice);
    if (scanMode === 'text') {
      handleTextAnalyze(pendingDescription, choice);
    } else {
      handleCameraScan(choice);
    }
  }, [scanMode, pendingDescription, handleTextAnalyze, handleCameraScan]);

  /* ─────────────────────────────────────────────
     Reset + misc handlers
  ───────────────────────────────────────────── */
  const handleReset = useCallback(() => {
    setStep('capture');
    setPreview(null);
    setImageData(null);
    setTextInput('');
    setResults(null);
    setErrorMsg('');
    setAddedMsg(false);
    setShowDetails(false);
    setClarification(null);
    setPendingDescription(null);
  }, []);

  const handleOpenHistoryEntry = useCallback((entry) => {
    if (!entry?.results) return;
    setPreview(entry.preview || null);
    setImageData(null);
    setResults(entry.results);
    setErrorMsg('');
    setAddedMsg(false);
    setStep('results');
  }, []);

  const handleClearHistory = useCallback(() => {
    setHistory([]);
    persistMacroHistory([]);
  }, []);

  const handleAddToList = useCallback(() => {
    if (!results?.foods) return;
    const names = results.foods.map(f => f.name);
    onAddToList?.(names);
    setAddedMsg(true);
    addedTimerRef.current = setTimeout(() => setAddedMsg(false), 2500);
  }, [results, onAddToList]);

  /* ─────────────────────────────────────────────
     Weight tab handlers
  ───────────────────────────────────────────── */
  const handleWeightSubmit = useCallback((e) => {
    e.preventDefault();
    const w = parseFloat(weightInput);
    if (!w || w < 20 || w > 300) return;
    const today = new Date().toISOString().slice(0, 10);
    const entry = { date: today, weight: w };
    setWeightLog(prev => {
      const filtered = prev.filter(e => e.date !== today);
      const next     = [...filtered, entry].sort((a, b) => a.date.localeCompare(b.date)).slice(-90);
      persistWeightLog(next);
      return next;
    });
    setWeightInput('');
  }, [weightInput]);

  /* ─────────────────────────────────────────────
     Progress tab data builders
  ───────────────────────────────────────────── */
  function buildWeekData() {
    const today = new Date().toISOString().slice(0, 10);
    let raw = {};
    try { raw = JSON.parse(localStorage.getItem(DAILY_NUTRITION_KEY) || '{}'); } catch {}

    const DAY_LABELS = ['Κυ', 'Δε', 'Τρ', 'Τε', 'Πε', 'Πα', 'Σα'];
    return Array.from({ length: 7 }, (_, i) => {
      const d    = new Date();
      d.setDate(d.getDate() - (6 - i));
      const key  = d.toISOString().slice(0, 10);
      const data = raw[key] || { calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 };
      return { ...data, day: key, label: DAY_LABELS[d.getDay()], isToday: key === today };
    });
  }

  function buildTodayData() {
    const today = new Date().toISOString().slice(0, 10);
    try {
      const raw = JSON.parse(localStorage.getItem(DAILY_NUTRITION_KEY) || '{}');
      return raw[today] || null;
    } catch { return null; }
  }

  if (!isOpen) return null;

  /* ─────────────────────────────────────────────
     Derived values for results screen
  ───────────────────────────────────────────── */
  const macroMaxes = { protein: 80, carbs: 120, fat: 60 };
  const questionData = step === 'question' ? results?.question : null;

  /* ─────────────────────────────────────────────
     RENDER
  ───────────────────────────────────────────── */
  return (
    <div className="psm-modal" role="dialog" aria-modal="true" aria-label="Plate Scanner">

      {/* ══ TAB: SCAN ════════════════════════════════ */}
      {activeTab === 'scan' && (
        <div className="psm-screen">

          {/* ── STEP: CAPTURE ── */}
          {step === 'capture' && (
            <>
              <div className="psm-header">
                <button className="psm-header-utility" onClick={() => setStep('history')} aria-label="Ιστορικό">
                  Ιστορικό{history.length > 0 ? ` (${history.length})` : ''}
                </button>
                <h2 className="psm-title">Meal Macros</h2>
                <button className="psm-close-btn" onClick={onClose} aria-label="Κλείσιμο">✕</button>
              </div>

              {/* Mode toggle */}
              <div className="psm-mode-toggle">
                <button
                  className={`psm-mode-btn${scanMode === 'camera' ? ' psm-mode-btn--active' : ''}`}
                  onClick={() => setScanMode('camera')}
                >
                  Camera
                </button>
                <button
                  className={`psm-mode-btn${scanMode === 'text' ? ' psm-mode-btn--active' : ''}`}
                  onClick={() => setScanMode('text')}
                >
                  Κείμενο
                </button>
              </div>

              {/* Camera mode */}
              {scanMode === 'camera' && (
                <div className="psm-capture-body">
                  <div className="psm-capture-glass-card">
                    <div className={`psm-capture-viewfinder${preview ? ' psm-capture-viewfinder--filled' : ''}`}>
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
                  </div>

                  <input ref={cameraInputRef} type="file" accept="image/*" capture="environment"
                    onChange={handleFileChange} className="psm-file-input" aria-hidden="true" tabIndex={-1} />
                  <input ref={fileInputRef} type="file" accept="image/*"
                    onChange={handleFileChange} className="psm-file-input" aria-hidden="true" tabIndex={-1} />

                  <div className="psm-capture-actions">
                    {!preview ? (
                      <div className="psm-source-btns">
                        <button className="psm-source-btn psm-source-btn--camera" onClick={() => cameraInputRef.current?.click()}>
                          <span className="psm-source-icon">📷</span>
                          <span className="psm-source-label">Κάμερα</span>
                        </button>
                        <button className="psm-source-btn psm-source-btn--gallery" onClick={() => fileInputRef.current?.click()}>
                          <span className="psm-source-icon">🖼️</span>
                          <span className="psm-source-label">Gallery</span>
                        </button>
                      </div>
                    ) : (
                      <>
                        <button className="psm-btn psm-btn--gradient psm-btn--pill" onClick={() => handleCameraScan()}>
                          Ανάλυσε →
                        </button>
                        <div className="psm-reselect-row">
                          <button className="psm-btn psm-btn--ghost psm-btn--sm" onClick={() => cameraInputRef.current?.click()}>
                            📷 Νέα φωτό
                          </button>
                          <button className="psm-btn psm-btn--ghost psm-btn--sm" onClick={() => fileInputRef.current?.click()}>
                            🖼️ Από γκαλερί
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* Text mode */}
              {scanMode === 'text' && (
                <div className="psm-capture-body">
                  <div className="psm-capture-glass-card" style={{ width: '100%', maxWidth: 360 }}>
                    <textarea
                      className="psm-text-input"
                      placeholder="π.χ. κοτόπουλο με ρύζι και σαλάτα"
                      value={textInput}
                      onChange={e => setTextInput(e.target.value)}
                      rows={5}
                    />
                  </div>
                  <div className="psm-capture-actions">
                    <button
                      className="psm-btn psm-btn--gradient psm-btn--pill"
                      onClick={() => handleTextAnalyze()}
                      disabled={!textInput.trim()}
                    >
                      Ανάλυσε →
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ── STEP: HISTORY ── */}
          {step === 'history' && (
            <div className="psm-screen psm-history-screen">
              <div className="psm-header">
                <button className="psm-header-utility" onClick={() => setStep('capture')} aria-label="Πίσω">
                  ← Πίσω
                </button>
                <h2 className="psm-title">Ιστορικό</h2>
                <button className="psm-close-btn" onClick={onClose} aria-label="Κλείσιμο">✕</button>
              </div>
              <div className="psm-results-scroll">
                {history.length === 0 ? (
                  <div className="psm-history-empty">
                    <div className="psm-history-empty-icon">📸</div>
                    <h3>Δεν υπάρχει ακόμη ιστορικό</h3>
                    <p>Μετά το πρώτο scan θα εμφανίζονται εδώ τα αποτελέσματα.</p>
                  </div>
                ) : (
                  <div className="psm-history-list">
                    {history.map(entry => {
                      const totals = entry.results?.totals || {};
                      const foods  = (entry.results?.foods || []).map(f => f.name).filter(Boolean);
                      return (
                        <button key={entry.id} className="psm-history-card" onClick={() => handleOpenHistoryEntry(entry)}>
                          {entry.preview
                            ? <img src={entry.preview} alt="" className="psm-history-thumb" />
                            : <div className="psm-history-thumb psm-history-thumb--placeholder">🍽️</div>}
                          <div className="psm-history-copy">
                            <div className="psm-history-top">
                              <strong>{entry.results?.mealType || 'Γεύμα'}</strong>
                              <span>{new Date(entry.scannedAt).toLocaleString('el-GR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
                            </div>
                            <div className="psm-history-foods">{foods.length ? foods.join(' • ') : 'Χωρίς καταγεγραμμένα τρόφιμα'}</div>
                            <div className="psm-history-macros">
                              <span>{totals.calories ?? 0} kcal</span>
                              <span>{totals.protein ?? 0}g πρωτ.</span>
                              <span>{totals.carbs ?? 0}g υδ/κες</span>
                              <span>{totals.fat ?? 0}g λίπος</span>
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              <div className="psm-results-actions">
                <button className="psm-btn psm-btn--outline" onClick={() => setStep('capture')}>Νέα σάρωση</button>
                {!!history.length && (
                  <button className="psm-btn psm-btn--ghost" onClick={handleClearHistory}>Καθαρισμός</button>
                )}
              </div>
            </div>
          )}

          {/* ── STEP: SCANNING ── */}
          {step === 'scanning' && (
            <div className="psm-screen psm-scanning">
              {preview && scanMode === 'camera' && (
                <>
                  <div className="psm-scan-bg" style={{ backgroundImage: `url(${preview})` }} aria-hidden="true" />
                  <div className="psm-scan-overlay" aria-hidden="true" />
                  <div className="psm-float-emojis" aria-hidden="true">
                    {['🍗', '🥗', '🍝', '🥩'].map((em, i) => (
                      <span key={em} className={`psm-float-emoji psm-float-emoji--${i + 1}`}>{em}</span>
                    ))}
                  </div>
                </>
              )}
              <div className="psm-scan-card">
                <div className="psm-spinner" aria-label="Φόρτωση" />
                <p className="psm-scan-text">
                  AI αναλύει το γεύμα σου<span className="psm-dots"><span>.</span><span>.</span><span>.</span></span>
                </p>
                <p className="psm-scan-subtext">Εκτιμώμενος χρόνος: 3-6 δευτερόλεπτα</p>
              </div>
            </div>
          )}

          {/* ── STEP: QUESTION ── */}
          {step === 'question' && questionData && (
            <div className="psm-screen psm-question-screen">
              <div className="psm-header">
                <button className="psm-header-utility" onClick={handleReset} aria-label="Πίσω">← Πίσω</button>
                <h2 className="psm-title">Διευκρίνιση</h2>
                <button className="psm-close-btn" onClick={onClose} aria-label="Κλείσιμο">✕</button>
              </div>
              <div className="psm-question-body">
                <div className="psm-question-card">
                  <p className="psm-question-text">{questionData.text}</p>
                  <div className="psm-question-choices">
                    {(questionData.choices || []).map((choice, i) => (
                      <button key={i} className="psm-choice-btn" onClick={() => handleChoiceSelect(choice)}>
                        {choice}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── STEP: RESULTS ── */}
          {step === 'results' && results && results.foods && (
            <div className="psm-screen psm-results">
              <div className="psm-header psm-header--results">
                <button className="psm-header-utility" onClick={handleReset} aria-label="Πίσω">← Πίσω</button>
                <h2 className="psm-title">Αποτελέσματα</h2>
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
                    <HealthScorePill score={results.healthScore} />
                    <span className="psm-badge psm-badge--memory">AI μνήμη ενεργή</span>
                  </div>

                  {/* Big calorie number */}
                  <div className="psm-cal-display">
                    <span className="psm-cal-big">{results.totals?.calories ?? 0}</span>
                    <span className="psm-cal-unit">kcal</span>
                  </div>

                  {/* Macro bars */}
                  <div className="psm-macro-bars">
                    <MacroBar label="Πρωτεΐνη" value={results.totals?.protein ?? 0} max={macroMaxes.protein} color="#3b82f6" />
                    <MacroBar label="Υδ/κες"   value={results.totals?.carbs   ?? 0} max={macroMaxes.carbs}   color="#10b981" />
                    <MacroBar label="Λίπος"    value={results.totals?.fat     ?? 0} max={macroMaxes.fat}     color="#f59e0b" />
                  </div>

                  {/* Details collapsible */}
                  {(results.totals?.fiber != null || results.totals?.sugar != null || results.nutrients) && (
                    <div className="psm-details-section">
                      <button className="psm-details-toggle" onClick={() => setShowDetails(v => !v)}>
                        Λεπτομέρειες {showDetails ? '▲' : '▼'}
                      </button>
                      {showDetails && (
                        <div className="psm-details-grid">
                          {results.totals?.fiber   != null && <span className="psm-detail-chip">Φυτ. ίνες: {results.totals.fiber}g</span>}
                          {results.totals?.sugar   != null && <span className="psm-detail-chip">Σάκχαρα: {results.totals.sugar}g</span>}
                          {results.nutrients?.vitaminC  != null && <span className="psm-detail-chip">Βιτ. C: {results.nutrients.vitaminC}mg</span>}
                          {results.nutrients?.vitaminD  != null && <span className="psm-detail-chip">Βιτ. D: {results.nutrients.vitaminD}μg</span>}
                          {results.nutrients?.calcium   != null && <span className="psm-detail-chip">Ασβέστιο: {results.nutrients.calcium}mg</span>}
                          {results.nutrients?.iron      != null && <span className="psm-detail-chip">Σίδηρος: {results.nutrients.iron}mg</span>}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Food items */}
                {results.foods?.length > 0 && (
                  <section className="psm-foods-section">
                    <h3 className="psm-section-title">Τρόφιμα</h3>
                    <div className="psm-foods-list">
                      {results.foods.map((food, idx) => (
                        <div key={idx} className="psm-food-card" style={{ animationDelay: `${0.12 + idx * 0.06}s` }}>
                          <div className="psm-food-top">
                            <span className="psm-food-emoji" aria-hidden="true">{food.emoji || '🍴'}</span>
                            <div className="psm-food-names">
                              <span className="psm-food-name">{food.name}</span>
                              {food.nameEn && <span className="psm-food-name-en">{food.nameEn}</span>}
                              {food.portion && <span className="psm-food-name-en">{food.portion}</span>}
                            </div>
                            {food.calories != null && (
                              <span className="psm-chip psm-chip--cal">{food.calories} kcal</span>
                            )}
                          </div>
                          <div className="psm-food-macros">
                            {food.protein != null && (
                              <span className="psm-macro-dot psm-macro-dot--protein">
                                <span className="psm-dot" aria-hidden="true" />{food.protein}g πρωτ.
                              </span>
                            )}
                            {food.carbs != null && (
                              <span className="psm-macro-dot psm-macro-dot--carbs">
                                <span className="psm-dot" aria-hidden="true" />{food.carbs}g υδ/κες
                              </span>
                            )}
                            {food.fat != null && (
                              <span className="psm-macro-dot psm-macro-dot--fat">
                                <span className="psm-dot" aria-hidden="true" />{food.fat}g λίπος
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
              </div>

              <div className="psm-results-actions">
                <button className="psm-btn psm-btn--outline" onClick={handleReset}>
                  Σκανάρισε πάλι
                </button>
                <button
                  className={`psm-btn psm-btn--primary${addedMsg ? ' psm-btn--success' : ''}`}
                  onClick={handleAddToList}
                  disabled={addedMsg}
                >
                  {addedMsg ? '✓ Προστέθηκε!' : '➕ Στη λίστα'}
                </button>
              </div>
            </div>
          )}

          {/* ── STEP: ERROR ── */}
          {step === 'error' && (
            <div className="psm-screen psm-error-screen">
              <div className="psm-header">
                <h2 className="psm-title">Meal Macros</h2>
                <button className="psm-close-btn" onClick={onClose} aria-label="Κλείσιμο">✕</button>
              </div>
              <div className="psm-error-body">
                <div className="psm-error-card">
                  <span className="psm-error-icon" aria-hidden="true">⚠️</span>
                  <h3 className="psm-error-title">Ωχ, κάτι πήγε στραβά!</h3>
                  <p className="psm-error-message">
                    {errorMsg || 'Δεν ήταν δυνατή η ανάλυση. Δοκίμασε ξανά.'}
                  </p>
                  <button className="psm-btn psm-btn--primary psm-btn--pill" onClick={handleReset}>
                    Δοκίμασε ξανά
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ══ TAB: PROGRESS ════════════════════════════ */}
      {activeTab === 'progress' && (
        <div className="psm-screen psm-progress-tab">
          <div className="psm-header">
            <h2 className="psm-title">Πρόοδος</h2>
            <button className="psm-close-btn" onClick={onClose} aria-label="Κλείσιμο">✕</button>
          </div>
          <ProgressTab />
        </div>
      )}

      {/* ══ TAB: WEIGHT ══════════════════════════════ */}
      {activeTab === 'weight' && (
        <div className="psm-screen psm-weight-tab">
          <div className="psm-header">
            <h2 className="psm-title">Βάρος</h2>
            <button className="psm-close-btn" onClick={onClose} aria-label="Κλείσιμο">✕</button>
          </div>
          <WeightTab
            weightLog={weightLog}
            weightInput={weightInput}
            setWeightInput={setWeightInput}
            onSubmit={handleWeightSubmit}
          />
        </div>
      )}

      {/* ══ TAB BAR ══════════════════════════════════ */}
      <div className="psm-tab-bar">
        <button className={`psm-tab${activeTab === 'scan'     ? ' psm-tab--active' : ''}`} onClick={() => setActiveTab('scan')}>
          <span className="psm-tab-icon">📷</span>
          <span>Σάρωση</span>
        </button>
        <button className={`psm-tab${activeTab === 'progress' ? ' psm-tab--active' : ''}`} onClick={() => setActiveTab('progress')}>
          <span className="psm-tab-icon">📊</span>
          <span>Πρόοδος</span>
        </button>
        <button className={`psm-tab${activeTab === 'weight'   ? ' psm-tab--active' : ''}`} onClick={() => setActiveTab('weight')}>
          <span className="psm-tab-icon">⚖️</span>
          <span>Βάρος</span>
        </button>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   ProgressTab — reads sg_daily_nutrition_v1
───────────────────────────────────────────── */
function ProgressTab() {
  const today = new Date().toISOString().slice(0, 10);
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(DAILY_NUTRITION_KEY) || '{}'); } catch {}
  const todayData = raw[today] || null;

  const DAY_LABELS = ['Κυ', 'Δε', 'Τρ', 'Τε', 'Πε', 'Πα', 'Σα'];
  const weekData = Array.from({ length: 7 }, (_, i) => {
    const d   = new Date();
    d.setDate(d.getDate() - (6 - i));
    const key = d.toISOString().slice(0, 10);
    const day = raw[key] || { calories: 0, protein: 0, carbs: 0, fat: 0, meals: 0 };
    return { ...day, day: key, label: DAY_LABELS[d.getDay()], isToday: key === today };
  });

  const hasData = weekData.some(d => d.calories > 0);
  const activeDays = weekData.filter(d => d.calories > 0);
  const avgCal     = activeDays.length ? Math.round(activeDays.reduce((s, d) => s + d.calories, 0) / activeDays.length) : 0;
  const avgProt    = activeDays.length ? Math.round(activeDays.reduce((s, d) => s + d.protein,  0) / activeDays.length) : 0;
  const avgCarbs   = activeDays.length ? Math.round(activeDays.reduce((s, d) => s + d.carbs,    0) / activeDays.length) : 0;
  const avgFat     = activeDays.length ? Math.round(activeDays.reduce((s, d) => s + d.fat,      0) / activeDays.length) : 0;

  return (
    <div className="psm-results-scroll psm-progress-body">
      {!hasData ? (
        <div className="psm-history-empty">
          <div className="psm-history-empty-icon">📊</div>
          <h3>Δεν υπάρχουν δεδομένα ακόμη</h3>
          <p>Σκανάρισε το πρώτο σου γεύμα για να δεις εδώ την πρόοδό σου!</p>
        </div>
      ) : (
        <>
          {/* Today summary */}
          {todayData && (
            <div className="psm-today-summary">
              <p className="psm-section-title">Σήμερα</p>
              <div className="psm-cal-display">
                <span className="psm-cal-big">{todayData.calories}</span>
                <span className="psm-cal-unit">kcal · {todayData.meals} γεύμ.</span>
              </div>
              <div className="psm-avg-row">
                <span className="psm-avg-chip psm-avg-chip--protein">{todayData.protein}g πρωτ.</span>
                <span className="psm-avg-chip psm-avg-chip--carbs">{todayData.carbs}g υδ/κες</span>
                <span className="psm-avg-chip psm-avg-chip--fat">{todayData.fat}g λίπος</span>
              </div>
            </div>
          )}

          {/* 7-day bar chart */}
          <div className="psm-results-card">
            <p className="psm-section-title">Τελευταίες 7 ημέρες</p>
            <WeeklyChart data={weekData} />
          </div>

          {/* Weekly average */}
          {activeDays.length > 0 && (
            <div className="psm-results-card">
              <p className="psm-section-title">Εβδομαδιαίος μέσος όρος</p>
              <div className="psm-cal-display">
                <span className="psm-cal-big" style={{ fontSize: 40 }}>{avgCal}</span>
                <span className="psm-cal-unit">kcal / ημέρα</span>
              </div>
              <div className="psm-avg-row">
                <span className="psm-avg-chip psm-avg-chip--protein">{avgProt}g πρωτ.</span>
                <span className="psm-avg-chip psm-avg-chip--carbs">{avgCarbs}g υδ/κες</span>
                <span className="psm-avg-chip psm-avg-chip--fat">{avgFat}g λίπος</span>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   WeightTab — reads/writes sg_weight_log_v1
───────────────────────────────────────────── */
function WeightTab({ weightLog, weightInput, setWeightInput, onSubmit }) {
  const today     = new Date().toISOString().slice(0, 10);
  const todayEntry = weightLog.find(e => e.date === today);
  const last30    = weightLog.slice(-30);
  const latestEntry = weightLog[weightLog.length - 1];

  let trend = null;
  if (last30.length >= 2) {
    const diff = last30[last30.length - 1].weight - last30[0].weight;
    trend = { diff: Math.abs(diff).toFixed(1), up: diff > 0, days: last30.length };
  }

  return (
    <div className="psm-results-scroll psm-weight-body">
      {/* Entry form */}
      <div className="psm-results-card">
        <p className="psm-section-title">Καταγραφή βάρους</p>
        <form className="psm-weight-form" onSubmit={onSubmit}>
          <input
            className="psm-weight-input"
            type="number"
            step="0.1"
            min="20"
            max="300"
            placeholder="π.χ. 75.5"
            value={weightInput}
            onChange={e => setWeightInput(e.target.value)}
          />
          <button type="submit" className="psm-btn psm-btn--primary" style={{ padding: '12px 24px' }}>
            Καταχώρηση
          </button>
        </form>
        {todayEntry && (
          <p className="psm-weight-today">Σήμερα: <strong>{todayEntry.weight} kg</strong></p>
        )}
      </div>

      {/* Chart */}
      {last30.length >= 2 && (
        <div className="psm-results-card">
          <p className="psm-section-title">Τελευταίες καταγραφές</p>
          <WeightChart entries={last30} />
          {latestEntry && (
            <p className="psm-weight-entry">Τελευταία καταγραφή: <strong>{latestEntry.weight} kg</strong></p>
          )}
          {trend && (
            <p className={`psm-weight-trend${trend.up ? ' psm-weight-trend--up' : ' psm-weight-trend--down'}`}>
              {trend.up ? '↑' : '↓'} {trend.up ? '+' : '-'}{trend.diff} kg ({trend.days} ημέρες)
            </p>
          )}
        </div>
      )}

      {last30.length === 0 && (
        <div className="psm-history-empty">
          <div className="psm-history-empty-icon">⚖️</div>
          <h3>Καμία καταγραφή ακόμη</h3>
          <p>Καταχώρησε το πρώτο σου βάρος παραπάνω.</p>
        </div>
      )}
    </div>
  );
}
