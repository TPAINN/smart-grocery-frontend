import { useState, useEffect, useRef, useCallback } from 'react';
import './App.css';
import RecipeNotification from './RecipeNotification';
import AuthModal from './AuthModal';
import SavedListsModal from './SavedListsModal';
import { io } from 'socket.io-client';

// ─── Constants ────────────────────────────────────────────────────────────────
const API_BASE      = 'https://my-smart-grocery-api.onrender.com';
const CACHE_VERSION = 'v3';
const CACHE_TTL_MS  = 10 * 60 * 1000; // 10 min

// ─── Smart Cache (memory + localStorage, stale-while-revalidate) ──────────────
const memCache = new Map();

const cacheGet = (key) => {
  if (memCache.has(key)) return memCache.get(key);
  try {
    const raw = localStorage.getItem(`sgc_${CACHE_VERSION}_${key}`);
    if (raw) {
      const { data, ts } = JSON.parse(raw);
      const entry = { data, ts, stale: Date.now() - ts > CACHE_TTL_MS };
      memCache.set(key, entry);
      return entry;
    }
  } catch {}
  return null;
};

const cacheSet = (key, data) => {
  const entry = { data, ts: Date.now(), stale: false };
  memCache.set(key, entry);
  try {
    localStorage.setItem(`sgc_${CACHE_VERSION}_${key}`, JSON.stringify({ data, ts: entry.ts }));
  } catch {}
};

const cachedFetch = async (url, key, { onData, onBackground } = {}) => {
  const cached = cacheGet(key);
  if (cached) {
    onData?.(cached.data);
    if (!cached.stale) return;
  }
  try {
    const r = await fetch(url);
    if (!r.ok) return;
    const data = await r.json();
    cacheSet(key, data);
    if (cached?.stale) onBackground?.(data);
    else onData?.(data);
  } catch {}
};

// ─── Keep-alive: prevents Render free-tier cold start ─────────────────────────
const useKeepAlive = () => {
  useEffect(() => {
    const ping = () => fetch(`${API_BASE}/api/status`, { method: 'GET' }).catch(() => {});
    ping();
    const iv = setInterval(ping, 9 * 60 * 1000); // every 9 min
    return () => clearInterval(iv);
  }, []);
};

// ─── Helpers ──────────────────────────────────────────────────────────────────
const normalizeText = (text) =>
  text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const greeklishToGreek = (text) => {
  let el = text.toLowerCase();
  const map = {
    th:'θ', ch:'χ', ps:'ψ', ks:'ξ',
    a:'α', b:'β', c:'κ', d:'δ', e:'ε', f:'φ', g:'γ', h:'η',
    i:'ι', j:'τζ', k:'κ', l:'λ', m:'μ', n:'ν', o:'ο', p:'π',
    q:'κ', r:'ρ', s:'σ', t:'τ', u:'υ', v:'β', w:'ω', x:'χ',
    y:'υ', z:'ζ',
  };
  for (const key in map) el = el.split(key).join(map[key]);
  return el;
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cleanIngredientText = (text) => {
  let cleaned = text.toLowerCase().replace(/[\d/½¼¾]+/g, ' ');
  const units = [
    'κ.σ.','κ.γ.','κ.σ','κ.γ','γρ.','γρ','γραμμάρια','κιλό','κιλά','kg',
    'ml','lt','λίτρα','φλιτζάνι','φλιτζάνια','κούπα','κούπες','πρέζα',
    'σκελίδα','σκελίδες','κομμάτι','κομμάτια','τεμάχιο','τεμάχια',
    'κουταλιά','κουταλιές','κουταλάκι','κουταλάκια','πακέτο','πακέτα',
    'συσκευασία','ποτήρι','ματσάκι','κλωναράκι',
  ];
  units.forEach((u) => cleaned = cleaned.replace(new RegExp(`\\b${u}\\b`, 'gi'), ' '));
  return cleaned.replace(/\s+/g, ' ').trim();
};

const extractIngredientKeywords = (rawIngredient) => {
  const cleaned = cleanIngredientText(rawIngredient);
  const norm    = normalizeText(cleaned);
  const words   = norm.split(/\s+/).filter(w => w.length > 3);
  const pairs   = [];
  for (let i = 0; i < words.length - 1; i++) pairs.push(`${words[i]} ${words[i+1]}`);
  return [cleaned, ...pairs.slice(0,2), words[0] || cleaned].filter(Boolean);
};

const getBestMatch = (matches, query) => {
  if (!matches?.length) return null;
  const q = greeklishToGreek(normalizeText(query));
  matches.sort((a, b) => {
    const score = (name) => {
      if (name === q) return 100;
      if (name.startsWith(q + ' ')) return 90;
      if (new RegExp(`(^|\\s)${escapeRegExp(q)}(\\s|$)`).test(name)) return 80;
      if (new RegExp(`(^|\\s)${escapeRegExp(q)}`).test(name)) return 60;
      if (name.includes(q)) return 40;
      return 10;
    };
    const diff = score(b.normalizedName) - score(a.normalizedName);
    return diff !== 0 ? diff : (a.price || 0) - (b.price || 0);
  });
  return matches[0];
};

const CATEGORIES = [
  { name: '🍎 Φρέσκα & Λαχανικά', keywords: ['μηλο','μπανανα','ντοματα','πατατα','κρεμμυδι','λεμονι','σκορδο','πιπερια'] },
  { name: '🥛 Γαλακτοκομικά',      keywords: ['γαλα','τυρι','γιαουρτι','βουτυρο','φετα','παρμεζανα','κρεμα'] },
  { name: '🥩 Κρέας & Ψάρια',      keywords: ['κοτοπουλο','κρεας','κιμας','ψαρι','σολομος','μπεικον'] },
  { name: '🍞 Φούρνος',            keywords: ['ψωμι','πιτα','φρυγανιες','χωριατικο'] },
  { name: '🍝 Ράφι',               keywords: ['μακαρονια','ρυζι','λαδι','ζαχαρη','μελι','αλατι','πιπερι','αλευρι','ελαιολαδο','ζωμος'] },
  { name: '📦 Διάφορα',            keywords: [] },
];
const getCategory = (name) =>
  CATEGORIES.find((c) => c.keywords.some((k) => normalizeText(name).includes(k)))?.name || '📦 Διάφορα';

// ─── NON-FOOD blacklist (checked FIRST — if match → not food) ─────────────────
const NON_FOOD_KEYWORDS = [
  // Καθαριστικά / Απορρυπαντικά
  'απορρυπαντικ','σκονη πλυσιμ','υγρο πλυσιμ','υγρο πιατ','καθαριστικ',
  'χλωρινη','χλωρ','αντισηπτικ','απολυμαντ','υαλοκαθαριστ','σφουγγαριστρ',
  'σφουγγαρ','σκουπ','σκουπιδοσακουλ','σακουλ','τζαμ','βερνικ',
  // Προσωπική υγιεινή / Καλλυντικά
  'σαμπουαν','κρεμα μαλλιων','μαλακτικ','βαφη μαλλ','ντεκαπ',
  'σαπουνι','αφρολουτρ','αποσμητικ','αντιιδρωτ','αντισηπτικ','αντιιδρωτ',
  'οδοντοκρεμ','οδοντοβουρτσ','οδοντων','στοματ','στοματικ','στοματοπλυτ',
  'ξυριστικ','ξυρισμ','αφρος ξυρ','gel ξυρ','aftershave',
  'κρεμα προσωπ','κρεμα χερι','λοσιον','μουσκ','αρωμα','perfume','cologne',
  'ντεοντοραν','foundation','ρουζ','mascara','βαφη ματ','μακιγιαζ',
  'βαμβακ','μπατονετ','οδοντογλυφ','νιφαδε','νιφαδ',
  // Φαρμακευτικά / Υγεία (δεν τρώγονται)
  'ασπιρινη','παυσιπον','βιταμιν','συμπληρωμ','κολυρ','ναζονεξ',
  'πανε','ακουσ','στοματ','επιδεσμ','βαμβακι φαρμ',
  // Χαρτικά
  'χαρτι κουζ','χαρτι υγε','χαρτομαντιλ','χαρτοπετσετ','χαρτιν','tissue',
  // Ταμπόν / Πάνες
  'ταμπον','σερβιετ','πανα βρεφ','εισφορε','ακοα','pampers','huggies',
  // Ηλεκτρικά / Μπαταρίες
  'μπαταρι','λαμπτηρ','λαμπ led','λαμπ','φακ',
  // Σκεύη / Πλαστικά
  'σακουλακ','μεμβραν','αλουμινοχαρτ','λαδοκολλ','βουρτσ','σφουγγαρ',
  'γαντια καθαρ','γαντια latex','γαντια nitrile',
  // Ζωοτροφές (έχουν θερμίδες αλλά δεν τρώγονται από ανθρώπους)
  'τροφη σκυλ','τροφη γατ','κιμπλ','whiskas','pedigree','purina','friskies',
  'αμμος γατ','παιχνιδι σκυλ',
  // Φυτά / Λιπάσματα
  'λιπασμ','χωμα φυτ','γλαστρ',
];

// ─── FOOD database (calories per 100g estimate) ────────────────────────────────
const FOOD_CAL_DB = [
  { keywords:['ελαιολαδ','λαδι','σπορελαι','βουτυρ','μαργαριν','μαγιονεζ','κρεμ γαλακτ'], cals:780 },
  { keywords:['σοκολατ','μερεντ','φουντουκοκρεμ','nutella'], cals:540 },
  { keywords:['μπισκοτ','κρουασαν','πιτα κεικ','κεικ','γλυκ','τσουρεκ','παξιμαδ'], cals:480 },
  { keywords:['πατατακ','τσιπς','ποπ κορν','ξηρ καρπ','φιστικ','καρυδ','αμυγδαλ','κεσιου','πεκαν'], cals:560 },
  { keywords:['γαριδακ','πρετζελ','κρακερ','στικ'], cals:440 },
  { keywords:['ζαχαρ','μελ','μαρμελαδ','σιροπ','ζαχαροπλαστ'], cals:390 },
  { keywords:['τυρ','φετ','γκουντ','κασερ','παρμεζαν','γραβιερ','μοτσαρελ','εμενταλ','ροκφορ','γουδα','ταλαγαν'], cals:360 },
  { keywords:['ψωμ','μακαρον','σπαγετ','ζυμαρικ','ρυζ','αλευρ','βρωμ','δημητριακ','φρυγανι','πιτ ψωμ','τορτιγ'], cals:350 },
  { keywords:['αλλαντικ','ζαμπον','μπεικον','λουκανικ','σαλαμ','κοπανιστ','πεπερον'], cals:310 },
  { keywords:['κρεας','κοτοπουλ','μοσχαρ','χοιρ','κιμας','μπριζολ','φιλετ','στηθ','μπουτ','συκωτ'], cals:210 },
  { keywords:['σολομ','τονοσ','τουν','ψαρ','σαρδελ','ρεγγ','γαριδ','καλαμαρ','μυδ','χταπ'], cals:160 },
  { keywords:['αυγ'], cals:155 },
  { keywords:['γαλ','γιαουρτ','κεφιρ','ρυζογαλ'], cals:75 },
  { keywords:['χυμ','φρουτοχυμ','smoothie','nectar'], cals:55 },
  { keywords:['μηλ','μπαναν','πορτοκαλ','σταφυλ','ροδακιν','αχλαδ','κερασ','φραουλ','ακτινιδ','ανανα','μανγκ','αβοκαντ','λεμον','μανταρ'], cals:55 },
  { keywords:['ντοματ','πατατ','γλυκοπατατ','κολοκυθ','μελιτζαν','πιπερι','φρεσκ'], cals:30 },
  { keywords:['μαρουλ','σπανακ','λαχαν','καροτ','κρεμμυδ','σκορδ','αγγουρ','σελιν','μαιντ','δυοσμ','ρεπαν','παντζαρ'], cals:22 },
  { keywords:['αναψυκτικ','κολα','σπρ','φαντ','λεμοναδ','πορτοκαλαδ','ενεργει','energy drink','red bull'], cals:42 },
  { keywords:['μπυρ','beer','μπιρ'], cals:43 },
  { keywords:['κρασ','οινοσ','σαμπανι','prosecco','wine'], cals:80 },
  { keywords:['ουισκ','βοτκ','ρουμ','τσιπουρ','ρακ','ούζ','ouzo','tsipouro'], cals:220 },
  { keywords:['καφ','espresso','cappuccin','frappe'], cals:8 },
  { keywords:['τσα','chamomile','herbal','χαμομηλ'], cals:2 },
  { keywords:['νερ','μεταλλικ','σοδα','sparkling'], cals:0 },
  { keywords:['ελι','ελιε','ελιτσ'], cals:145 },
  { keywords:['ξυδ','μουσταρδ','κετσαπ','σαλτσ','pesto','μπεσαμελ','ταχιν','χουμ'], cals:100 },
  { keywords:['αλατ','πιπερ','ριγαν','θυμαρ','κανελ','κυμιν','μπαχαρ','κουρκουμ','paprika'], cals:25 },
  { keywords:['κομπ','παγωτ','sorbet','gelato'], cals:200 },
  { keywords:['κρεπ','βαφλ','pancake','τηγανιτ'], cals:230 },
];

// Checks if a product name is food/drink (edible by humans)
const getFoodInfo = (name) => {
  const t = normalizeText(name);

  // 1. Check non-food blacklist FIRST
  if (NON_FOOD_KEYWORDS.some(k => t.includes(k))) {
    return { calories: 0, isFood: false };
  }

  // 2. Check food calorie DB
  for (let e of FOOD_CAL_DB) {
    if (e.keywords.some(k => t.includes(k))) {
      return { calories: e.cals, isFood: true };
    }
  }

  // 3. Unknown → assume food (grocery app context)
  return { calories: 120, isFood: true };
};

const calColor = (c) => c === 0 ? '#94a3b8' : c < 100 ? '#22c55e' : c < 300 ? '#f97316' : '#ef4444';

// ─── Brochures ────────────────────────────────────────────────────────────────
const BROCHURE_LINKS = {
  'Market In':        'https://www.fylladiomat.gr/market-in/',
  'MyMarket':         'https://www.fylladiomat.gr/my-market/',
  'ΑΒ Βασιλόπουλος': 'https://www.fylladiomat.gr/%CE%B1%CE%B2-%CE%B2%CE%B1%CF%83%CE%B9%CE%BB%CF%8C%CF%80%CE%BF%CF%85%CE%BB%CE%BF%CF%82/',
  'Γαλαξίας':         'https://www.fylladiomat.gr/%CE%B3%CE%B1%CE%BB%CE%B1%CE%BE%CE%AF%CE%B1%CF%82/',
  'Σκλαβενίτης':      'https://www.fylladiomat.gr/%CF%83%CE%BA%CE%BB%CE%B1%CE%B2%CE%B5%CE%BD%CE%B9%CF%84%CE%B7%CF%82/',
  'Μασούτης':         'https://www.fylladiomat.gr/%CE%BC%CE%B1%CF%83%CE%BF%CF%8D%CF%84%CE%B7%CF%82/',
  'Κρητικός':         'https://www.fylladiomat.gr/%CE%BA%CF%81%CE%B7%CF%84%CE%B9%CE%BA%CE%BF%CF%82/',
};

const SUPERMARKET_LOGOS = {
  'Σκλαβενίτης':    'https://core-sa.com/wp-content/uploads/2019/10/sklavenitis.png',
  'ΑΒ Βασιλόπουλος':'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTl3QK3J91QWo9nDaOQxqXTMIwCRNMnJYazWw&s',
  'MyMarket':        'https://www.chalandri.gr/wp-content/uploads/2021/04/mymarket-logo.jpg',
  'Μασούτης':        'https://www.sbctv.gr/wp-content/uploads/2023/12/masoutis.jpg',
  'Κρητικός':        'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTqiIcIME5HllU-2TVovGx0hdfpW0Y32Hcs7w&s',
  'Γαλαξίας':        'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQy-2RHg306icN_ZxWeZtHNUeB_p9oIvMYx9Q&s',
  'Market In':       'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQif4Kc8fqSN-sxec3L1gefzE8BGBL_hQOWDg&s',
};

// ─── Friends helpers ──────────────────────────────────────────────────────────
const getInitials = (name = '') =>
  name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';

const getAvatarColor = (key = '') => {
  const colors = ['#7c3aed','#2563eb','#059669','#d97706','#dc2626','#0891b2'];
  let hash = 0;
  for (let i = 0; i < key.length; i++) hash = key.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
};

// ─── Server Status Bar ────────────────────────────────────────────────────────
function ServerStatusBar({ isWakingUp }) {
  if (!isWakingUp) return null;
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      background: 'linear-gradient(135deg, rgba(124,58,237,0.08), rgba(167,139,250,0.06))',
      border: '1px solid rgba(124,58,237,0.2)',
      borderRadius: 12, padding: '10px 16px', marginBottom: 12, fontSize: 13,
    }}>
      <div style={{
        width: 10, height: 10, borderRadius: '50%',
        background: '#a78bfa', flexShrink: 0,
        animation: 'pulse 1s infinite',
        boxShadow: '0 0 8px #a78bfa',
      }} />
      <div>
        <strong style={{ color: 'var(--text-primary)' }}>Γίνεται συγχονισμός με τον server...</strong>
        <span style={{ color: 'var(--text-secondary)', marginLeft: 6 }}>
          (~15s) - Τα cached αποτελέσματα εμφανίζονται κανονικά
        </span>
      </div>
    </div>
  );
}

// ─── Skeleton Loaders ─────────────────────────────────────────────────────────
function SkeletonItem() {
  return (
    <li style={{
      background: 'var(--bg-surface)', borderRadius: 14,
      padding: '14px 16px', marginBottom: 8,
      border: '1px solid var(--border-light)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ flex: 1 }}>
          <div className="skeleton" style={{ height: 14, width: '60%', borderRadius: 8, marginBottom: 8 }} />
          <div style={{ display: 'flex', gap: 6 }}>
            <div className="skeleton" style={{ height: 10, width: 50, borderRadius: 8 }} />
            <div className="skeleton" style={{ height: 10, width: 70, borderRadius: 8 }} />
          </div>
        </div>
        <div className="skeleton" style={{ width: 50, height: 22, borderRadius: 8 }} />
      </div>
    </li>
  );
}

function SuggestionSkeleton() {
  return (
    <div style={{ padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 10 }}>
      <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 8, flexShrink: 0 }} />
      <div className="skeleton" style={{ height: 13, flex: 1, borderRadius: 6 }} />
      <div className="skeleton" style={{ width: 44, height: 13, borderRadius: 6 }} />
    </div>
  );
}

// ─── Offline Banner ───────────────────────────────────────────────────────────
function OfflineBanner({ isOnline, wasOffline }) {
  if (isOnline && !wasOffline) return null;
  if (!isOnline) return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'linear-gradient(135deg, #1e1e2e, #2d1b4e)',
      color: '#fff', padding: '12px 20px',
      display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 600,
      boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
    }}>
      <span style={{ fontSize: 20 }}>📡</span>
      <div>
        <div style={{ fontWeight: 800, fontSize: 14 }}>Χωρίς σύνδεση</div>
        <div style={{ fontWeight: 400, fontSize: 11, opacity: 0.8, marginTop: 2 }}>
          Λίστα από μνήμη — τιμές & αναζητήσεις μη διαθέσιμες
        </div>
      </div>
      <div style={{
        marginLeft: 'auto', background: 'rgba(255,255,255,0.1)',
        borderRadius: 20, padding: '4px 12px', fontSize: 11, animation: 'pulse 1.5s infinite',
      }}>● OFFLINE</div>
    </div>
  );
  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
      background: 'linear-gradient(135deg, #064e3b, #065f46)',
      color: '#fff', padding: '12px 20px',
      display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, fontWeight: 600,
    }}>
      <span style={{ fontSize: 20 }}>✅</span>
      <div>
        <div style={{ fontWeight: 800, fontSize: 14 }}>Σύνδεση αποκαταστάθηκε!</div>
        <div style={{ fontWeight: 400, fontSize: 11, opacity: 0.8 }}>Τιμές ενημερώνονται ξανά</div>
      </div>
    </div>
  );
}

// ─── Calorie Summary (no goal limit — just shows total & breakdown) ────────────
function CalorieSummary({ items }) {
  const foodItems = items.filter(i => getFoodInfo(i.text).isFood);
  const nonFoodItems = items.filter(i => !getFoodInfo(i.text).isFood);
  if (!items.length) return null;

  const totalCals = foodItems.reduce((s, i) => s + getFoodInfo(i.text).calories, 0);

  // Group calories by category bucket
  const buckets = [
    { label:'Λαχ/Φρούτα', max:50,  color:'#22c55e', icon:'🥦' },
    { label:'Πρωτεΐνες',  max:250,  color:'#3b82f6', icon:'🥩' },
    { label:'Γαλακτ.',    max:200,  color:'#a78bfa', icon:'🥛' },
    { label:'Αμυλ.',      max:400,  color:'#f97316', icon:'🍞' },
    { label:'Λιπαρά',     max:999,  color:'#ef4444', icon:'🧈' },
  ];

  // Build per-item sparkle color
  const calColor = (c) =>
    c === 0   ? '#64748b' :
    c <= 50   ? '#22c55e' :
    c <= 200  ? '#3b82f6' :
    c <= 400  ? '#f97316' : '#ef4444';

  const totalColor = calColor(totalCals / Math.max(foodItems.length, 1));

  return (
    <div style={{
      background: 'var(--bg-surface)', borderRadius: 14, padding: '14px 16px',
      marginBottom: 12, border: '1px solid var(--border-light)',
    }}>
      {/* Header row */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:20 }}>🔥</span>
          <div>
            <div style={{ fontSize:10, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:0.5 }}>
              Εκτιμώμενες Θερμίδες
            </div>
            <div style={{ fontSize:24, fontWeight:800, color: totalColor, lineHeight:1.1 }}>
              {totalCals.toLocaleString('el-GR')}
              <span style={{ fontSize:11, fontWeight:400, color:'var(--text-secondary)', marginLeft:4 }}>kcal</span>
            </div>
          </div>
        </div>
        <div style={{ textAlign:'right', display:'flex', flexDirection:'column', gap:2 }}>
          <div style={{ fontSize:11, color:'var(--text-secondary)' }}>
            🛒 {foodItems.length} τρόφιμα
          </div>
          {nonFoodItems.length > 0 && (
            <div style={{ fontSize:11, color:'#64748b' }}>
              🧴 {nonFoodItems.length} μη τρόφιμα
            </div>
          )}
        </div>
      </div>

      {/* Per-item mini chips */}
      {foodItems.length > 0 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
          {foodItems.slice(0, 8).map((item, i) => {
            const cals = getFoodInfo(item.text).calories;
            return (
              <div key={i} style={{
                display:'flex', alignItems:'center', gap:4,
                background:`${calColor(cals)}12`,
                border:`1px solid ${calColor(cals)}30`,
                borderRadius:99, padding:'3px 8px',
                fontSize:10, fontWeight:700, color: calColor(cals),
                maxWidth:120, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
              }}>
                {cals === 0 ? '~0' : cals} kcal
                <span style={{ color:'var(--text-secondary)', fontWeight:400, overflow:'hidden', textOverflow:'ellipsis' }}>
                  {' '}{item.text.split(' ')[0]}
                </span>
              </div>
            );
          })}
          {foodItems.length > 8 && (
            <div style={{ fontSize:10, color:'var(--text-secondary)', padding:'3px 6px', alignSelf:'center' }}>
              +{foodItems.length - 8} ακόμα
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Swipeable Item ───────────────────────────────────────────────────────────
function SwipeableItem({ item, onDelete, onSend }) {
  const [offsetX, setOffsetX]     = useState(0);
  const [swiping, setSwiping]     = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const startX    = useRef(0);
  const startY    = useRef(0);
  const isLocked  = useRef(false);
  const THRESHOLD = 80;

  const foodInfo = getFoodInfo(item.text);

  const handleTouchStart = (e) => {
    startX.current   = e.touches[0].clientX;
    startY.current   = e.touches[0].clientY;
    isLocked.current = false;
    setSwiping(false);
  };
  const handleTouchMove = (e) => {
    const dx = e.touches[0].clientX - startX.current;
    const dy = e.touches[0].clientY - startY.current;
    if (!isLocked.current) {
      if (Math.abs(dx) > Math.abs(dy) + 4)      isLocked.current = 'h';
      else if (Math.abs(dy) > Math.abs(dx) + 4) isLocked.current = 'v';
      else return;
    }
    if (isLocked.current === 'v') return;
    e.preventDefault();
    setSwiping(true);
    // Allow BOTH directions — clamp between -160 and +160
    setOffsetX(Math.min(160, Math.max(-160, dx)));
  };
  const handleTouchEnd = () => {
    if (isLocked.current !== 'h') { setOffsetX(0); setSwiping(false); return; }
    if (Math.abs(offsetX) > THRESHOLD) {
      // Fly out in swipe direction
      setOffsetX(offsetX > 0 ? 500 : -500);
      setDismissed(true);
      setTimeout(() => onDelete(item.id), 320);
    } else {
      setOffsetX(0);
      setSwiping(false);
    }
  };

  // 0→1 reveal ratio (direction-agnostic)
  const revealPct = Math.min(1, Math.abs(offsetX) / THRESHOLD);
  // Which side is the glow on
  const swipeDir  = offsetX > 0 ? 'right' : 'left';

  return (
    <li className={`item-card-wrapper ${dismissed ? 'dismissed' : ''}`} style={{ '--reveal': revealPct }}>

      {/* ── Red glow layer (behind the card, full width) ── */}
      {swiping && revealPct > 0.05 && (
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'var(--radius-md, 14px)',
          // Glow follows swipe direction
          background: swipeDir === 'left'
            ? `linear-gradient(to left, transparent 0%, rgba(239,68,68,${0.12 + revealPct * 0.35}) 60%, rgba(239,68,68,${0.25 + revealPct * 0.5}) 100%)`
            : `linear-gradient(to right, transparent 0%, rgba(239,68,68,${0.12 + revealPct * 0.35}) 60%, rgba(239,68,68,${0.25 + revealPct * 0.5}) 100%)`,
          boxShadow: `
            ${swipeDir === 'left' ? '-' : ''}${6 + revealPct * 20}px 0 ${16 + revealPct * 32}px rgba(239,68,68,${0.3 + revealPct * 0.55}),
            0 0 ${8 + revealPct * 24}px rgba(239,68,68,${0.15 + revealPct * 0.35})
          `,
          transition: 'none',
          pointerEvents: 'none',
          zIndex: 0,
        }} />
      )}

      {/* ── Trash icon — appears on the side being swiped toward ── */}
      <div style={{
        position: 'absolute',
        top: 0, bottom: 0,
        left:  swipeDir === 'right' ? 0 : 'auto',
        right: swipeDir === 'left'  ? 0 : 'auto',
        width: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: revealPct,
        transform: `scale(${0.6 + revealPct * 0.5})`,
        transition: swiping ? 'none' : 'opacity 0.3s, transform 0.3s',
        pointerEvents: 'none',
        zIndex: 0,
        filter: `drop-shadow(0 0 ${revealPct * 10}px rgba(239,68,68,0.9))`,
      }}>
        <span style={{ fontSize: 22 }}>🗑️</span>
      </div>

      {/* ── The actual card ── */}
      <div
        className={`item-card ${swiping ? 'swiping' : ''}`}
        style={{
          transform: `translateX(${offsetX}px)`,
          position: 'relative',
          zIndex: 1,
          // Red border tint as swipe progresses
          borderColor: revealPct > 0.2
            ? `rgba(239,68,68,${revealPct * 0.7})`
            : undefined,
          boxShadow: revealPct > 0.2
            ? `0 0 0 1px rgba(239,68,68,${revealPct * 0.4}), inset 0 0 ${revealPct * 20}px rgba(239,68,68,${revealPct * 0.08})`
            : undefined,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <div className="item-content">
          <span className="item-text">{item.text}</span>
          {item.recipeSource && (
            <span style={{
              display:'inline-block', fontSize:10, fontWeight:700,
              color:'#a78bfa', background:'rgba(167,139,250,0.1)',
              border:'1px solid rgba(167,139,250,0.2)',
              borderRadius:99, padding:'2px 8px', marginTop:2,
            }}>📖 {item.recipeSource}</span>
          )}
          <div className="item-meta-row">
            <span className="item-price-tag">{item.price > 0 ? `${item.price.toFixed(2)}€` : '—'}</span>
            <span className="item-store-tag">📍 {item.store}</span>
            {foodInfo.isFood && foodInfo.calories > 0 && (
              <span style={{
                fontSize:10, fontWeight:700, color:calColor(foodInfo.calories),
                background:`${calColor(foodInfo.calories)}18`, borderRadius:99, padding:'2px 7px',
              }}>🔥 {foodInfo.calories}</span>
            )}
          </div>
        </div>
        <div className="item-actions">
          <button className="send-friend-btn" onClick={() => onSend(item)} title="Στείλε σε φίλο">📤</button>
          <button className="delete-btn" onClick={() => onDelete(item.id)} title="Διαγραφή">✕</button>
        </div>
      </div>
    </li>
  );
}

// ─── Friend Picker Modal (εμφανίζεται όταν υπάρχουν 2+ φίλοι) ────────────────
function FriendPickerModal({ isOpen, friends, item, onSend, onClose }) {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content" style={{ maxWidth: 340 }} onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>✕</button>
        <div className="modal-header">
          <h2>📤 Αποστολή σε φίλο</h2>
          <p>Επίλεξε σε ποιον να στείλεις <strong>"{item?.text}"</strong></p>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:16 }}>
          {friends.map(friend => (
            <button
              key={friend.shareKey}
              onClick={() => onSend(friend)}
              style={{
                display:'flex', alignItems:'center', gap:14,
                background:'var(--bg-surface)', border:'1.5px solid var(--border-light)',
                borderRadius:14, padding:'12px 16px', cursor:'pointer',
                transition:'border-color 0.15s, transform 0.1s',
                textAlign:'left', width:'100%',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = '#7c3aed'; e.currentTarget.style.transform = 'scale(1.01)'; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-light)'; e.currentTarget.style.transform = ''; }}
            >
              <div style={{
                width:42, height:42, borderRadius:'50%', flexShrink:0,
                background: getAvatarColor(friend.shareKey),
                display:'flex', alignItems:'center', justifyContent:'center',
                color:'#fff', fontWeight:800, fontSize:15,
              }}>
                {getInitials(friend.username)}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontWeight:700, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                  {friend.username}
                </div>
                <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:2 }}>
                  #{friend.shareKey}
                </div>
              </div>
              <span style={{ fontSize:18 }}>→</span>
            </button>
          ))}
        </div>
        <button
          className="submit-btn"
          style={{ width:'100%', marginTop:14, background:'var(--bg-subtle)', color:'var(--text-primary)', backgroundImage:'none' }}
          onClick={onClose}
        >
          Ακύρωση
        </button>
      </div>
    </div>
  );
}



function AddFriendModal({ isOpen, onAdd, onClose }) {
  const [key, setKey]         = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null); // { name, shareKey } or 'not_found'
  const lookupTimeout         = useRef(null);

  if (!isOpen) return null;

  const lookupKey = async (val) => {
    if (val.length < 6) { setPreview(null); return; }
    setLoading(true);
    setPreview(null);
    try {
      const r = await fetch(`${API_BASE}/api/auth/by-key/${val.trim().toUpperCase()}`);
      if (r.ok) {
        const data = await r.json();
        setPreview({ name: data.name, shareKey: data.shareKey });
      } else {
        setPreview('not_found');
      }
    } catch {
      setPreview('offline');
    }
    setLoading(false);
  };

  const handleKeyChange = (e) => {
    const val = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
    setKey(val);
    setPreview(null);
    clearTimeout(lookupTimeout.current);
    if (val.length >= 6) {
      lookupTimeout.current = setTimeout(() => lookupKey(val), 500);
    }
  };

  const handleAdd = () => {
    if (!key.trim()) return;
    const username = (preview && preview !== 'not_found' && preview !== 'offline')
      ? preview.name
      : key.trim().toUpperCase();
    onAdd({ shareKey: key.trim().toUpperCase(), username, addedAt: Date.now() });
    setKey('');
    setPreview(null);
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content" style={{ maxWidth: 360 }} onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>✕</button>
        <div className="modal-header">
          <h2>➕ Προσθήκη Φίλου</h2>
          <p>Βάλε το <strong>Share Key</strong> του φίλου σου.</p>
        </div>
        <div style={{ marginTop:16, display:'flex', flexDirection:'column', gap:10 }}>
          <input
            type="text"
            placeholder="Share Key (π.χ. AB12XY)"
            value={key}
            onChange={handleKeyChange}
            onKeyDown={(e) => e.key === 'Enter' && key.trim() && handleAdd()}
            autoFocus
            maxLength={15}
            style={{
              padding:'14px 16px', borderRadius:'var(--radius-md)',
              border:`1.5px solid ${preview && preview !== 'not_found' && preview !== 'offline' ? '#10b981' : 'var(--border)'}`,
              background:'var(--bg-input)', color:'var(--text-primary)',
              fontSize:16, fontFamily:'monospace',
              outline:'none', width:'100%', letterSpacing:3,
              fontWeight:800, textTransform:'uppercase',
              transition:'border-color 0.2s',
            }}
          />

          {/* Preview area */}
          {loading && (
            <div style={{ display:'flex', alignItems:'center', gap:8, padding:'10px 14px', background:'var(--bg-surface)', borderRadius:12, border:'1px solid var(--border-light)' }}>
              <div className="skeleton" style={{ width:38, height:38, borderRadius:'50%', flexShrink:0 }} />
              <div style={{ flex:1 }}>
                <div className="skeleton" style={{ height:12, width:'60%', borderRadius:6, marginBottom:6 }} />
                <div className="skeleton" style={{ height:10, width:'40%', borderRadius:6 }} />
              </div>
            </div>
          )}

          {!loading && preview && preview !== 'not_found' && preview !== 'offline' && (
            <div style={{
              display:'flex', alignItems:'center', gap:12,
              padding:'12px 14px', background:'rgba(16,185,129,0.06)',
              border:'1px solid rgba(16,185,129,0.25)', borderRadius:14,
            }}>
              <div style={{
                width:40, height:40, borderRadius:'50%', flexShrink:0,
                background: getAvatarColor(preview.shareKey),
                display:'flex', alignItems:'center', justifyContent:'center',
                color:'#fff', fontWeight:800, fontSize:15,
              }}>
                {getInitials(preview.name)}
              </div>
              <div>
                <div style={{ fontWeight:700, fontSize:14, color:'var(--text-primary)' }}>{preview.name}</div>
                <div style={{ fontSize:11, color:'#10b981', marginTop:2 }}>✅ Βρέθηκε!</div>
              </div>
            </div>
          )}

          {!loading && preview === 'not_found' && (
            <div style={{ padding:'10px 14px', background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:12, fontSize:13, color:'#ef4444' }}>
              ❌ Δεν βρέθηκε χρήστης με αυτό το Share Key
            </div>
          )}

          {!loading && preview === 'offline' && (
            <div style={{ padding:'10px 14px', background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:12, fontSize:13, color:'#f59e0b' }}>
              📡 Offline — θα προστεθεί χωρίς όνομα
            </div>
          )}

          <div style={{ display:'flex', gap:8, marginTop:4 }}>
            <button
              className="submit-btn"
              style={{ flex:1 }}
              onClick={handleAdd}
              disabled={!key.trim() || loading || preview === 'not_found'}
            >
              🤝 Προσθήκη
            </button>
            <button
              className="submit-btn"
              style={{ flex:1, background:'var(--bg-subtle)', color:'var(--text-primary)', backgroundImage:'none' }}
              onClick={() => { onClose(); setKey(''); setPreview(null); }}
            >
              Ακύρωση
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Friends Panel (slide-in από δεξιά) ──────────────────────────────────────
function FriendsPanel({ friends, myShareKey, onCopyKey, onAddFriend, onRemoveFriend, onClose }) {
  return (
    <div style={{
      position:'fixed', top:0, right:0, bottom:0, zIndex:300,
      width:'min(320px, 92vw)',
      background:'var(--bg-main, #0f0f1a)',
      borderLeft:'1px solid var(--border-light)',
      boxShadow:'-12px 0 40px rgba(0,0,0,0.3)',
      display:'flex', flexDirection:'column',
      animation:'slideInRight 0.25s cubic-bezier(0.34,1.56,0.64,1)',
    }}>
      {/* Header */}
      <div style={{ padding:'20px 20px 16px', borderBottom:'1px solid var(--border-light)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <h3 style={{ margin:0, fontSize:16, fontWeight:800 }}>🤝 Κοινό Καλάθι</h3>
          <p style={{ margin:'4px 0 0', fontSize:11, color:'var(--text-secondary)' }}>{friends.length} συνδεδεμένοι φίλοι</p>
        </div>
        <button onClick={onClose} style={{ background:'var(--bg-surface)', border:'1px solid var(--border-light)', borderRadius:10, padding:'8px 10px', cursor:'pointer', fontSize:16, color:'var(--text-primary)' }}>✕</button>
      </div>

      {/* My share key */}
      <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border-light)', background:'var(--bg-surface)' }}>
        <div style={{ fontSize:10, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:0.5, marginBottom:6 }}>Το Share Key μου</div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <div style={{
            flex:1, fontWeight:800, fontSize:16, letterSpacing:3,
            color:'#a78bfa', background:'rgba(167,139,250,0.08)',
            border:'1px solid rgba(167,139,250,0.2)',
            borderRadius:10, padding:'10px 14px', fontFamily:'monospace',
          }}>
            {myShareKey || '—'}
          </div>
          <button
            onClick={onCopyKey}
            style={{ background:'var(--bg-subtle)', border:'1px solid var(--border-light)', borderRadius:10, padding:'10px 12px', cursor:'pointer', fontSize:15, transition:'transform 0.1s' }}
            onMouseDown={e => e.currentTarget.style.transform = 'scale(0.9)'}
            onMouseUp={e => e.currentTarget.style.transform = ''}
          >📋</button>
        </div>
        <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:6 }}>Δώσε αυτόν τον κωδικό στους φίλους σου</div>
      </div>

      {/* Friends list */}
      <div style={{ flex:1, overflowY:'auto', padding:'12px 20px' }}>
        {friends.length === 0 ? (
          <div style={{ textAlign:'center', padding:'40px 20px', color:'var(--text-secondary)' }}>
            <div style={{ fontSize:40, marginBottom:12 }}>👥</div>
            <div style={{ fontWeight:600, marginBottom:6 }}>Δεν έχεις φίλους ακόμα</div>
            <div style={{ fontSize:12 }}>Πάτα "Προσθήκη" παρακάτω και βάλε το Share Key τους</div>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {friends.map(friend => (
              <div key={friend.shareKey} style={{
                display:'flex', alignItems:'center', gap:12,
                background:'var(--bg-surface)', border:'1px solid var(--border-light)',
                borderRadius:14, padding:'12px 14px',
              }}>
                <div style={{
                  width:44, height:44, borderRadius:'50%', flexShrink:0,
                  background: getAvatarColor(friend.shareKey),
                  display:'flex', alignItems:'center', justifyContent:'center',
                  color:'#fff', fontWeight:800, fontSize:16,
                  boxShadow:`0 4px 12px ${getAvatarColor(friend.shareKey)}44`,
                }}>
                  {getInitials(friend.username)}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:700, fontSize:14, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                    {friend.username}
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-secondary)', letterSpacing:1, marginTop:2 }}>
                    #{friend.shareKey}
                  </div>
                </div>
                <button
                  onClick={() => onRemoveFriend(friend.shareKey)}
                  style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.15)', borderRadius:8, padding:'6px 8px', cursor:'pointer', fontSize:13, color:'#ef4444' }}
                  title="Αφαίρεση"
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add friend button */}
      <div style={{ padding:'16px 20px', borderTop:'1px solid var(--border-light)' }}>
        <button
          onClick={onAddFriend}
          style={{
            width:'100%', padding:'14px', borderRadius:14,
            border:'1.5px dashed rgba(124,58,237,0.4)',
            background:'rgba(124,58,237,0.06)', color:'#a78bfa',
            fontWeight:700, fontSize:14, cursor:'pointer', transition:'background 0.15s, border-color 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.12)'; e.currentTarget.style.borderColor = 'rgba(124,58,237,0.6)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(124,58,237,0.06)'; e.currentTarget.style.borderColor = 'rgba(124,58,237,0.4)'; }}
        >
          ➕ Προσθήκη Φίλου
        </button>
      </div>
    </div>
  );
}

// ─── Other Modals ─────────────────────────────────────────────────────────────
function NameModal({ isOpen, value, onChange, onConfirm, onCancel }) {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-content" style={{ maxWidth:360 }} onClick={(e) => e.stopPropagation()}>
        <button className="close-btn" onClick={onCancel}>✕</button>
        <div className="modal-header"><h2>Όνομα Λίστας</h2><p>Δώσε ένα όνομα για τη λίστα σου.</p></div>
        <div style={{ display:'flex', flexDirection:'column', gap:8, marginTop:16 }}>
          <input
            type="text" placeholder="π.χ. Ψώνια Σαββατοκύριακου" value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && value.trim() && onConfirm()}
            autoFocus
            style={{ padding:'14px 16px', borderRadius:'var(--radius-md)', border:'1.5px solid var(--border)', background:'var(--bg-input)', color:'var(--text-primary)', fontSize:14, fontFamily:'var(--font)', outline:'none', width:'100%' }}
          />
          <div style={{ display:'flex', gap:8 }}>
            <button className="submit-btn" style={{ flex:1 }} onClick={onConfirm} disabled={!value.trim()}>💾 Αποθήκευση</button>
            <button className="submit-btn" style={{ flex:1, background:'var(--bg-subtle)', color:'var(--text-primary)', backgroundImage:'none' }} onClick={onCancel}>Ακύρωση</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({ isOpen, message, onConfirm, onCancel }) {
  if (!isOpen) return null;
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-content" style={{ maxWidth:360 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header"><h2>Επιβεβαίωση</h2><p>{message}</p></div>
        <div style={{ display:'flex', gap:8, marginTop:20 }}>
          <button className="submit-btn" style={{ flex:1, background:'rgba(239,68,68,.12)', color:'var(--danger)', border:'1px solid rgba(239,68,68,.25)', backgroundImage:'none' }} onClick={onConfirm}>Ναι, διαγραφή</button>
          <button className="submit-btn" style={{ flex:1, background:'var(--bg-subtle)', color:'var(--text-primary)', backgroundImage:'none' }} onClick={onCancel}>Ακύρωση</button>
        </div>
      </div>
    </div>
  );
}

function WelcomeModal({ onLogin, onRegister, onSkip }) {
  return (
    <div className="welcome-overlay">
      <div className="welcome-box">
        <div className="welcome-emoji-row"><span>🛒</span><span>🥦</span><span>💡</span></div>
        <h2 className="welcome-title">Καλώς ήρθες στο<br /><span>Smart Hub</span></h2>
        <p className="welcome-subtitle">Το έξυπνο καλάθι αγορών που συγκρίνει τιμές από όλα τα σούπερ μάρκετ σε πραγματικό χρόνο.</p>
        <div className="welcome-features">
          {[
            { icon:'🔍', title:'Έξυπνη Αναζήτηση', sub:'Τιμές από ΑΒ, Σκλαβενίτη, MyMarket & άλλα', locked:true },
            { icon:'🍽️', title:'Συνταγές & Υλικά',  sub:'Προσθήκη υλικών απευθείας στη λίστα', locked:true },
            { icon:'📋', title:'Βασική Λίστα',       sub:'Δωρεάν για όλους', locked:false },
            { icon:'🤝', title:'Κοινό Καλάθι',       sub:'Μοιράσου τη λίστα με φίλους', locked:false },
          ].map(({ icon, title, sub, locked }) => (
            <div key={title} className={`wf-row ${locked ? 'wf-locked' : ''}`}>
              <span className="wf-icon">{icon}</span>
              <div><strong>{title}</strong><span>{sub}</span></div>
              <span className={locked ? 'wf-lock' : 'wf-free'}>{locked ? '🔒' : '✓'}</span>
            </div>
          ))}
        </div>
        <div className="welcome-cta">
          <button className="welcome-register-btn" onClick={onRegister}>Δημιουργία Λογαριασμού</button>
          <button className="welcome-login-btn" onClick={onLogin}>Έχω ήδη λογαριασμό</button>
          <button className="welcome-skip-btn" onClick={onSkip}>Συνέχεια χωρίς λογαριασμό</button>
        </div>
      </div>
    </div>
  );
}

function LockedFeature({ label, onUnlock }) {
  return (
    <div className="locked-feature-overlay">
      <div className="locked-feature-box">
        <span className="locked-icon">🔒</span>
        <h3>Απαιτείται Λογαριασμός</h3>
        <p>Το <strong>{label}</strong> είναι διαθέσιμο μόνο σε εγγεγραμμένους χρήστες.</p>
        <button className="locked-unlock-btn" onClick={onUnlock}>Σύνδεση / Εγγραφή</button>
      </div>
    </div>
  );
}

function RecipeAddModal({ isOpen, recipeName, progress, total, onClose }) {
  if (!isOpen) return null;
  const pct = total > 0 ? Math.round((progress / total) * 100) : 0;
  return (
    <div className="modal-overlay">
      <div className="modal-content" style={{ maxWidth:340, textAlign:'center' }}>
        <div style={{ fontSize:40, marginBottom:12 }}>🍽️</div>
        <h3 style={{ margin:'0 0 6px', fontSize:16 }}>{recipeName}</h3>
        <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:16 }}>Ψάχνω τιμές για τα υλικά...</p>
        <div style={{ height:10, background:'var(--bg-subtle)', borderRadius:99, overflow:'hidden', marginBottom:10 }}>
          <div style={{ height:'100%', width:`${pct}%`, borderRadius:99, background:'linear-gradient(90deg, #7c3aed, #a78bfa)', transition:'width 0.4s ease' }} />
        </div>
        <div style={{ fontSize:13, color:'var(--text-secondary)' }}>{progress}/{total} υλικά ({pct}%)</div>
        {progress === total && total > 0 && (
          <button className="submit-btn" style={{ marginTop:16, width:'100%' }} onClick={onClose}>✅ Προστέθηκαν</button>
        )}
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  useKeepAlive(); // 🔑 keeps Render free-tier alive

  const [isDarkMode, setIsDarkMode]           = useState(() => localStorage.getItem('theme') === 'dark');
  const socketRef = useRef(null);

  const [showWelcome, setShowWelcome]         = useState(() => !localStorage.getItem('sg_welcomed'));
  const [savedLists, setSavedLists]           = useState([]);
  const [showListsModal, setShowListsModal]   = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showAuthModal, setShowAuthModal]     = useState(false);
  const [authInitMode, setAuthInitMode]       = useState('login');
  const [nameModalOpen, setNameModalOpen]     = useState(false);
  const [nameModalValue, setNameModalValue]   = useState('');
  const [confirmModal, setConfirmModal]       = useState({ open:false, message:'', onConfirm:null });
  const [recipeAddModal, setRecipeAddModal]   = useState({ open:false, recipeName:'', progress:0, total:0 });

  // ── Friends state ──────────────────────────────────────────────────────────
  const [friends, setFriends]                 = useState(() => JSON.parse(localStorage.getItem('sg_friends') || '[]'));
  const [showFriendsPanel, setShowFriendsPanel] = useState(false);
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);
  const [friendPicker, setFriendPicker]       = useState({ open:false, item:null });

  const [user, setUser]   = useState(() => JSON.parse(localStorage.getItem('smart_grocery_user')) || null);
  const [items, setItems] = useState(() => JSON.parse(localStorage.getItem('proGroceryItems_real')) || []);

  const [inputValue, setInputValue]       = useState('');
  const [activeTab, setActiveTab]         = useState('list');
  const [notification, setNotification]   = useState({ show:false, message:'' });
  const [suggestions, setSuggestions]     = useState([]);
  const [isSearching, setIsSearching]     = useState(false);
  const [selectedStore, setSelectedStore] = useState('Όλα');
  const [isScraping, setIsScraping]       = useState(false);
  const [isServerWaking, setIsServerWaking] = useState(false);
  const [isListening, setIsListening]     = useState(false);
  const [recipes, setRecipes]             = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(true);
  const [recipeFilter, setRecipeFilter]   = useState('all');
  const [expandedRecipe, setExpandedRecipe] = useState(null);
  const [fridgeQuery, setFridgeQuery]     = useState('');
  const [currentTime, setCurrentTime]     = useState(new Date());
  const [isOnline, setIsOnline]           = useState(() => navigator.onLine);
  const [wasOffline, setWasOffline]       = useState(false);

  const storeOptions  = ['Όλα','ΑΒ Βασιλόπουλος','Σκλαβενίτης','MyMarket','Μασούτης','Κρητικός','Γαλαξίας','Market In'];
  const searchTimeout = useRef(null);

  // ── Persist friends ────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('sg_friends', JSON.stringify(friends));
  }, [friends]);

  const addFriend = (friend) => {
    if (friends.some(f => f.shareKey === friend.shareKey)) {
      setNotification({ show:true, message:'Αυτός ο φίλος υπάρχει ήδη!' });
      return;
    }
    setFriends(prev => [...prev, friend]);
    setShowAddFriendModal(false);
    setNotification({ show:true, message:`✅ ${friend.username} προστέθηκε στο κοινό καλάθι!` });
  };

  const removeFriend = (shareKey) => {
    setFriends(prev => prev.filter(f => f.shareKey !== shareKey));
  };

  // ── Offline detection ──────────────────────────────────────────────────────
  useEffect(() => {
    const offlineH = () => {
      setIsOnline(false);
      setWasOffline(true);
      if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    };
    const onlineH = () => {
      setIsOnline(true);
      setTimeout(() => setWasOffline(false), 3000);
      fetchRecipes();
    };
    window.addEventListener('offline', offlineH);
    window.addEventListener('online', onlineH);
    return () => { window.removeEventListener('offline', offlineH); window.removeEventListener('online', onlineH); };
  }, []);

  // ── Dark mode ──────────────────────────────────────────────────────────────
  useEffect(() => {
    document.body.classList.toggle('dark-mode', isDarkMode);
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    socketRef.current = io(API_BASE);
    if (user?.shareKey) socketRef.current.emit('join_cart', user.shareKey);
    socketRef.current.on('receive_item', (itemData) => {
      setItems(prev => [{ ...itemData, id: Date.now() + Math.random() }, ...prev]);
      setNotification({ show:true, message:`🔔 Νέο προϊόν από φίλο: ${itemData.text}` });
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    });
    return () => socketRef.current.disconnect();
  }, [user]);

  // ── Clock ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Recipes ────────────────────────────────────────────────────────────────
  const fetchRecipes = useCallback(async () => {
    setRecipesLoading(true);
    
    // 1. Έλεγχος Cache
    const ck = cacheGet('recipes');
    if (ck) {
      // Υποστήριξη και για παλιά (array) και για νέα (object) δομή cache
      const cachedData = Array.isArray(ck.data) ? ck.data : (ck.data.recipes || []);
      if (cachedData.length > 0) {
        setRecipes(cachedData);
        setRecipesLoading(false);
        if (!ck.stale) return;
      }
    }

    try {
      const r = await fetch(`${API_BASE}/api/recipes`);
      if (r.ok) {
        const d = await r.json();
        
        // 🟢 FIX: Παίρνουμε το array από το κλειδί "recipes" αν υπάρχει, αλλιώς το d
        const actualRecipes = d.recipes || d; 

        if (Array.isArray(actualRecipes) && actualRecipes.length > 0) {
          cacheSet('recipes', actualRecipes);
          setRecipes(actualRecipes);
        }
      }
    } catch (err) {
      console.error("Fetch error:", err);
    }
    setRecipesLoading(false);
  }, []);

  useEffect(() => {
    if (!isOnline) { setRecipesLoading(false); return; }
    fetchRecipes();

    const checkStatus = async () => {
      try {
        const startT  = Date.now();
        const r       = await fetch(`${API_BASE}/api/status`);
        const elapsed = Date.now() - startT;
        if (r.ok) {
          const j = await r.json();
          setIsScraping(j.isScraping || false);
          setIsServerWaking(elapsed > 3000);
          if (elapsed > 3000) setTimeout(() => setIsServerWaking(false), 15000);
        }
      } catch {
        setIsServerWaking(true);
      }
    };
    checkStatus();
    const iv = setInterval(checkStatus, 15000);
    return () => clearInterval(iv);
  }, [isOnline, fetchRecipes]);

  useEffect(() => {
    localStorage.setItem('proGroceryItems_real', JSON.stringify(items));
  }, [items]);

  // ── Saved lists ────────────────────────────────────────────────────────────
  const fetchSavedLists = useCallback(async () => {
    if (!user) return;
    try {
      const token = localStorage.getItem('smart_grocery_token');
      const r = await fetch(`${API_BASE}/api/lists`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setSavedLists(await r.json());
    } catch {}
  }, [user]);
  useEffect(() => { fetchSavedLists(); }, [fetchSavedLists]);

  const saveCurrentList = () => {
    if (!user)         return setNotification({ show:true, message:'Πρέπει να συνδεθείς!' });
    if (!items.length) return setNotification({ show:true, message:'Η λίστα σου είναι άδεια!' });
    setNameModalValue('Ψώνια');
    setNameModalOpen(true);
  };

  const handleSaveConfirm = async () => {
    if (!nameModalValue.trim()) return;
    setNameModalOpen(false);
    try {
      const token = localStorage.getItem('smart_grocery_token');
      const r = await fetch(`${API_BASE}/api/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title: nameModalValue.trim(), items }),
      });
      if (r.ok) { setNotification({ show:true, message:'✅ Αποθηκεύτηκε!' }); fetchSavedLists(); }
      else { const e = await r.json(); setNotification({ show:true, message: e.message || 'Σφάλμα.' }); }
    } catch {}
  };

  const toggleListItem = async (listId, itemToToggle) => {
    const list = savedLists.find(l => l._id === listId);
    const updatedItems = list.items.map(i =>
      i._id === itemToToggle._id || i.id === itemToToggle.id ? { ...i, isChecked: !i.isChecked } : i
    );
    setSavedLists(savedLists.map(l => l._id === listId ? { ...l, items: updatedItems } : l));
    if (navigator.vibrate) navigator.vibrate(20);
    try {
      await fetch(`${API_BASE}/api/lists/${listId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('smart_grocery_token')}` },
        body: JSON.stringify({ title: list.title, items: updatedItems }),
      });
    } catch {}
  };

  const deleteList = (listId) => {
    setConfirmModal({
      open: true, message: 'Θέλεις σίγουρα να διαγράψεις αυτή τη λίστα;',
      onConfirm: async () => {
        setConfirmModal({ open:false, message:'', onConfirm:null });
        try {
          await fetch(`${API_BASE}/api/lists/${listId}`, {
            method: 'DELETE', headers: { Authorization: `Bearer ${localStorage.getItem('smart_grocery_token')}` },
          });
          fetchSavedLists();
        } catch {}
      },
    });
  };

  // ── Smart Send (0 φίλοι → panel, 1 → απευθείας, 2+ → picker) ─────────────
  const handleSendToFriend = (item) => {
    if (!friends.length) {
      setShowFriendsPanel(true);
      setNotification({ show:true, message:'Πρόσθεσε πρώτα έναν φίλο 👥' });
      return;
    }
    if (friends.length === 1) {
      const friend = friends[0];
      socketRef.current.emit('send_item', { shareKey: friend.shareKey, item });
      setNotification({ show:true, message:`🚀 Στάλθηκε στον ${friend.username}!` });
      if (navigator.vibrate) navigator.vibrate(40);
      return;
    }
    // 2+ friends → show picker
    setFriendPicker({ open:true, item });
  };

  const handlePickerSend = (friend) => {
    socketRef.current.emit('send_item', { shareKey: friend.shareKey, item: friendPicker.item });
    setNotification({ show:true, message:`🚀 Στάλθηκε στον ${friend.username}!` });
    if (navigator.vibrate) navigator.vibrate(40);
    setFriendPicker({ open:false, item:null });
  };

  const handleMassClear = () => {
    setConfirmModal({
      open: true, message: 'Θέλεις σίγουρα να αδειάσεις όλη τη λίστα;',
      onConfirm: () => {
        setItems([]);
        setConfirmModal({ open:false, message:'', onConfirm:null });
        if (navigator.vibrate) navigator.vibrate(50);
      },
    });
  };

  // ── Search with smart cache ────────────────────────────────────────────────
  const triggerSearch = async (query, store) => {
    if (!user)   { setSuggestions([]); return; }
    if (!isOnline) { setNotification({ show:true, message:'📡 Offline — αναζήτηση μη διαθέσιμη' }); return; }
    if (query.trim().length < 2) { setSuggestions([]); return; }

    const q        = greeklishToGreek(normalizeText(query));
    const cacheKey = `search_${q}_${store}`;
    const cached   = cacheGet(cacheKey);

    if (cached) {
      setSuggestions(cached.data.slice(0, 30));
      if (!cached.stale) return;
    } else {
      setIsSearching(true);
    }

    try {
      const r = await fetch(`${API_BASE}/api/prices/search?q=${encodeURIComponent(q)}&store=${encodeURIComponent(store)}`);
      if (r.ok) {
        const data = await r.json();
        cacheSet(cacheKey, data);
        setSuggestions(data.slice(0, 30));
      }
    } catch {}
    setIsSearching(false);
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => triggerSearch(val, selectedStore), 300);
  };

  const addFromSuggestion = (product) => {
    setItems(prev => [{
      id: Date.now() + Math.random(),
      text: product.name,
      category: getCategory(product.name),
      price: product.price,
      store: product.supermarket,
    }, ...prev]);
    setInputValue('');
    setSuggestions([]);
    if (navigator.vibrate) navigator.vibrate(30);
  };

  // ── Voice ──────────────────────────────────────────────────────────────────
  const handleVoiceClick = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { alert('Δεν υποστηρίζεται φωνητική εισαγωγή.'); return; }
    const r = new SR();
    r.lang     = 'el-GR';
    r.onstart  = () => setIsListening(true);
    r.onresult = (e) => { const t = e.results[0][0].transcript; setInputValue(t); triggerSearch(t, selectedStore); };
    r.onend    = () => setIsListening(false);
    r.start();
  };

  // ── Recipe → list (multi-strategy + parallel batch) ───────────────────────
  const searchIngredient = async (rawIng) => {
    const strategies = extractIngredientKeywords(rawIng);
    for (const query of strategies) {
      if (query.trim().length < 2) continue;
      const q      = greeklishToGreek(normalizeText(query));
      const ck     = `search_${q}_Όλα`;
      const cached = cacheGet(ck);
      if (cached) {
        const best = getBestMatch(cached.data, query);
        if (best) return best;
      }
      try {
        const r = await fetch(`${API_BASE}/api/prices/search?q=${encodeURIComponent(q)}&store=%CE%8C%CE%BB%CE%B1`);
        if (r.ok) {
          const data = await r.json();
          cacheSet(ck, data);
          const best = getBestMatch(data, query);
          if (best) return best;
        }
      } catch {}
    }
    return null;
  };

  const addRecipeToList = async (recipe) => {
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    if (!ingredients.length) {
      setNotification({ show:true, message:'Δεν βρέθηκαν υλικά για αυτή τη συνταγή.' });
      return;
    }

    if (!isOnline) {
      const newItems = ingredients.map(rawIng => ({
        id: Date.now() + Math.random(), text: rawIng,
        category: getCategory(cleanIngredientText(rawIng)),
        price: 0, store: '—', recipeSource: recipe.title,
      }));
      setItems(prev => [...newItems, ...prev]);
      setActiveTab('list');
      setNotification({ show:true, message:`📡 Offline: ${newItems.length} υλικά χωρίς τιμές` });
      return;
    }

    setRecipeAddModal({ open:true, recipeName:recipe.title, progress:0, total:ingredients.length });
    const newItems  = [];
    const batchSize = 3;
    for (let i = 0; i < ingredients.length; i += batchSize) {
      const batch   = ingredients.slice(i, i + batchSize);
      const results = await Promise.all(batch.map(rawIng => searchIngredient(rawIng)));
      results.forEach((best, idx) => {
        const rawIng = batch[idx];
        newItems.push(best ? {
          id: Date.now() + Math.random(), text: best.name,
          originalIngredient: rawIng, category: getCategory(best.name),
          price: best.price, store: best.supermarket, recipeSource: recipe.title,
        } : {
          id: Date.now() + Math.random(), text: rawIng,
          category: getCategory(cleanIngredientText(rawIng)),
          price: 0, store: '—', recipeSource: recipe.title,
        });
      });
      setRecipeAddModal(prev => ({ ...prev, progress: Math.min(ingredients.length, i + batchSize) }));
    }
    setItems(prev => [...newItems, ...prev]);
    setActiveTab('list');
  };

  const closeRecipeAddModal = () => {
    setRecipeAddModal({ open:false, recipeName:'', progress:0, total:0 });
    setNotification({ show:true, message:'✅ Υλικά προστέθηκαν στη λίστα!' });
  };

  const deleteItem = useCallback((id) => setItems(prev => prev.filter(i => i.id !== id)), []);

  const handleWelcomeLogin    = () => { setShowWelcome(false); localStorage.setItem('sg_welcomed','1'); setAuthInitMode('login');    setShowAuthModal(true); };
  const handleWelcomeRegister = () => { setShowWelcome(false); localStorage.setItem('sg_welcomed','1'); setAuthInitMode('register'); setShowAuthModal(true); };
  const handleWelcomeSkip     = () => { setShowWelcome(false); localStorage.setItem('sg_welcomed','1'); };

  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});
  const totalCost = items.reduce((s, i) => s + (i.price > 0 ? i.price : 0), 0);

  const handleLogout       = () => { localStorage.removeItem('smart_grocery_token'); localStorage.removeItem('smart_grocery_user'); setUser(null); setSavedLists([]); setShowProfileMenu(false); };
  const handleCopyShareKey = () => { if (user?.shareKey) { navigator.clipboard.writeText(user.shareKey); setNotification({ show:true, message:`📋 Αντιγράφηκε: ${user.shareKey}` }); } };

  const filteredRecipes = recipes
    .filter(r => r && r.title) // skip malformed entries
    .filter(r => {
      if (recipeFilter === 'budget' && !r.isBudget) return false;
      if (recipeFilter === 'fast'   && r.time > 30)  return false;
      if (fridgeQuery.trim()) {
        const q = greeklishToGreek(normalizeText(fridgeQuery));
        const ings = Array.isArray(r.ingredients) ? r.ingredients : [];
        return ings.some(ing => greeklishToGreek(normalizeText(String(ing))).includes(q));
      }
      return true;
    });

  const hour         = currentTime.getHours();
  const timeGreeting = hour < 5 ? 'Καλό βράδυ' : hour < 12 ? 'Καλημέρα' : hour < 18 ? 'Καλό απόγευμα' : 'Καλησπέρα';
  const timeIcon     = hour < 5 ? '🌙' : hour < 12 ? '☀️' : hour < 18 ? '☕' : '🌙';

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-wrapper">
      <OfflineBanner isOnline={isOnline} wasOffline={wasOffline} />
      {showWelcome && !user && <WelcomeModal onLogin={handleWelcomeLogin} onRegister={handleWelcomeRegister} onSkip={handleWelcomeSkip} />}

      <SavedListsModal isOpen={showListsModal} onClose={() => setShowListsModal(false)} lists={savedLists} onDelete={deleteList} onToggleItem={toggleListItem} />
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onLoginSuccess={(u) => setUser(u)} initMode={authInitMode} />
      <NameModal isOpen={nameModalOpen} value={nameModalValue} onChange={setNameModalValue} onConfirm={handleSaveConfirm} onCancel={() => setNameModalOpen(false)} />
      <ConfirmModal isOpen={confirmModal.open} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal({ open:false, message:'', onConfirm:null })} />
      <RecipeNotification show={notification.show} message={notification.message} onClose={() => setNotification({ show:false, message:'' })} />
      <RecipeAddModal isOpen={recipeAddModal.open} recipeName={recipeAddModal.recipeName} progress={recipeAddModal.progress} total={recipeAddModal.total} onClose={closeRecipeAddModal} />

      {/* Friend modals & panel */}
      <FriendPickerModal isOpen={friendPicker.open} friends={friends} item={friendPicker.item} onSend={handlePickerSend} onClose={() => setFriendPicker({ open:false, item:null })} />
      <AddFriendModal isOpen={showAddFriendModal} onAdd={addFriend} onClose={() => setShowAddFriendModal(false)} />
      {showFriendsPanel && (
        <>
          <div
            style={{ position:'fixed', inset:0, zIndex:299, background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)' }}
            onClick={() => setShowFriendsPanel(false)}
          />
          <FriendsPanel
            friends={friends}
            myShareKey={user?.shareKey}
            onCopyKey={handleCopyShareKey}
            onAddFriend={() => { setShowFriendsPanel(false); setShowAddFriendModal(true); }}
            onRemoveFriend={removeFriend}
            onClose={() => setShowFriendsPanel(false)}
          />
        </>
      )}

      <div className="container" style={!isOnline ? { marginTop: 64 } : {}}>
        {isScraping && (
          <div className="live-scraping-banner"><div className="pulsing-dot" /><span>LIVE ΕΝΗΜΕΡΩΣΗ ΤΙΜΩΝ...</span></div>
        )}

        {/* ── Header ── */}
        <header className="app-header">
          <div className="header-top">
            <div className="datetime-display">
              <div className="current-date">{timeGreeting} {timeIcon}</div>
              <div className="current-time">{currentTime.toLocaleDateString('el-GR', { weekday:'short', day:'numeric', month:'long' })}</div>
              <div className="current-clock">{currentTime.toLocaleTimeString('el-GR', { timeZone:'Europe/Athens', hour:'2-digit', minute:'2-digit', second:'2-digit' })}</div>
            </div>

            <div className="header-actions">
              {!isOnline && (
                <div style={{ display:'flex', alignItems:'center', gap:4, background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:99, padding:'4px 10px', fontSize:11, fontWeight:700, color:'#ef4444' }}>
                  📡 Offline
                </div>
              )}

              {/* Friends button with badge */}
              <div
                className="action-btn-new"
                style={{ position:'relative' }}
                onClick={() => { if (!user) return setShowAuthModal(true); setShowFriendsPanel(true); }}
                title="Κοινό Καλάθι"
              >
                🤝
                {friends.length > 0 && (
                  <span style={{
                    position:'absolute', top:-4, right:-4,
                    background:'#7c3aed', color:'#fff', borderRadius:'50%',
                    width:16, height:16, fontSize:9, fontWeight:800,
                    display:'flex', alignItems:'center', justifyContent:'center',
                  }}>{friends.length}</span>
                )}
              </div>

              <div className="action-btn-new" onClick={() => { if (!user) return setShowAuthModal(true); setShowListsModal(true); }} title="Λίστες μου">
                📝{savedLists.length > 0 && <span className="list-badge">{savedLists.length}</span>}
              </div>

              {user ? (
                <div style={{ position:'relative' }}>
                  <div className="action-btn-new" onClick={() => setShowProfileMenu(v => !v)} title={user.name}>👤</div>
                  {showProfileMenu && (
                    <>
                      <div style={{ position:'fixed', inset:0, zIndex:99 }} onClick={() => setShowProfileMenu(false)} />
                      <div className="profile-dropdown">
                        <div className="dropdown-info" style={{ padding:'15px', borderBottom:'1px solid var(--border-light)' }}>
                          <strong style={{ display:'block', fontSize:'14px' }}>{user.name}</strong>
                          <div style={{ display:'flex', alignItems:'center', gap:'8px', marginTop:'8px' }}>
                            <span style={{ color:'var(--text-secondary)', fontSize:'12px' }}>Κωδικός: <strong>{user.shareKey || 'N/A'}</strong></span>
                            <button onClick={handleCopyShareKey} style={{ background:'var(--bg-surface-hover)', border:'1px solid var(--border-light)', cursor:'pointer', fontSize:'14px', padding:'4px 8px', borderRadius:'6px' }}>📋</button>
                          </div>
                        </div>
                        <div className="dropdown-item" onClick={() => { setIsDarkMode(v => !v); setShowProfileMenu(false); }}>{isDarkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}</div>
                        <div className="dropdown-item logout" onClick={handleLogout}>🚪 Αποσύνδεση</div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="action-btn-new" onClick={() => setShowAuthModal(true)} title="Σύνδεση">🔒</div>
              )}
            </div>
          </div>
          <h1>Smart Hub</h1>
        </header>

        {/* ── Tabs ── */}
        <div className="tabs-container">
          {['list','recipes','brochures'].map(tab => (
            <button key={tab} className={`tab-btn ${activeTab === tab ? 'active' : ''}`} onClick={() => setActiveTab(tab)}>
              {tab === 'list' ? 'Λίστα' : tab === 'recipes' ? 'Συνταγές' : 'Φυλλάδια'}
            </button>
          ))}
        </div>

        {/* ════ LIST TAB ════ */}
        {activeTab === 'list' && (
          <div className="tab-content list-tab">
            {items.length > 0 && (
              <div style={{
                background:'var(--bg-surface)', padding:'15px', borderRadius:'14px',
                border:'1px solid var(--border-light)', marginBottom:'12px',
                display:'flex', justifyContent:'space-between', alignItems:'center',
              }}>
                <div>
                  <div style={{ fontSize:10, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:0.5 }}>Κόστος</div>
                  <div className="budget-amount" style={{ fontSize:'22px', fontWeight:'bold', color:'var(--brand-primary)' }}>{totalCost.toFixed(2)}€</div>
                  <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:2 }}>{items.length} προϊόντα</div>
                </div>
                <div style={{ display:'flex', gap:'8px' }}>
                  <button onClick={handleMassClear} style={{ background:'rgba(239,68,68,0.1)', color:'var(--brand-danger)', border:'none', padding:'10px', borderRadius:'10px', cursor:'pointer', fontSize:18 }} title="Αδείασμα">🗑️</button>
                  <button onClick={saveCurrentList} style={{ background:'linear-gradient(135deg,#059669,#10b981)', color:'white', border:'none', padding:'10px 16px', borderRadius:'10px', cursor:'pointer', fontWeight:'bold', fontSize:13 }} title="Αποθήκευση">💾 Αποθήκευση</button>
                </div>
              </div>
            )}

            {items.length > 0 && <CalorieSummary items={items} />}
            <ServerStatusBar isWakingUp={isServerWaking} />

            {/* Search */}
            <div className="smart-search-wrapper">
              <div className="store-filter-container">
                {storeOptions.map(store => (
                  <button
                    key={store}
                    className={`store-chip ${selectedStore === store ? 'active' : ''}`}
                    onClick={() => { setSelectedStore(store); triggerSearch(inputValue, store); }}
                  >
                    {store}
                  </button>
                ))}
              </div>

              <div className="input-section" style={{ position:'relative' }}>
                <input
                  type="text"
                  placeholder={!isOnline ? '📡 Offline — αναζήτηση μη διαθέσιμη' : user ? 'Αναζήτηση προϊόντος...' : '🔒 Σύνδεση για αναζήτηση τιμών...'}
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyDown={(e) => e.key === 'Enter' && triggerSearch(inputValue, selectedStore)}
                  readOnly={!user || !isOnline}
                  onClick={() => !user && setShowAuthModal(true)}
                  style={(!user || !isOnline) ? { cursor:'pointer', opacity:0.7 } : {}}
                />
                <button className={`voice-btn ${isListening ? 'listening' : ''}`} onClick={handleVoiceClick} title="Φωνητική αναζήτηση">
                  {isListening ? '🔴' : '🎤'}
                </button>
                <button className="add-btn" onClick={() => user ? triggerSearch(inputValue, selectedStore) : setShowAuthModal(true)} title="Αναζήτηση">+</button>
              </div>

              {/* Skeleton while loading */}
              {isSearching && !suggestions.length && (
                <div className="suggestions-dropdown">
                  {[1,2,3].map(i => <SuggestionSkeleton key={i} />)}
                </div>
              )}

              {suggestions.length > 0 && (
                <div className="suggestions-dropdown">
                  {suggestions.map(sug => (
                    <div key={sug._id} className="suggestion-item" onClick={() => addFromSuggestion(sug)}>
                      <img src={SUPERMARKET_LOGOS[sug.supermarket]} alt={sug.supermarket} className="sug-logo" />
                      <span className="sug-name">{sug.name}</span>
                      <strong className="sug-price">{sug.price?.toFixed(2)}€</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <div className="empty-cart-state">
                <span className="empty-cart-icon">🛒</span>
                <h3>Η λίστα είναι άδεια</h3>
                <p>Αναζήτησε προϊόντα παραπάνω ή πρόσθεσε υλικά από μια συνταγή.</p>
                {!user && <button className="locked-unlock-btn" style={{ marginTop:'16px' }} onClick={() => setShowAuthModal(true)}>Σύνδεση για όλα τα features</button>}
              </div>
            ) : (
              <div className="categories-container">
                {Object.keys(groupedItems).sort().map(cat => (
                  <div key={cat} className="category-group">
                    <h2 className="category-title">{cat}</h2>
                    <ul className="grocery-list">
                      {groupedItems[cat].map(item => (
                        <SwipeableItem key={item.id} item={item} onDelete={deleteItem} onSend={handleSendToFriend} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════ RECIPES TAB ════ */}
        {activeTab === 'recipes' && (
          <div className="tab-content recipes-tab">
            <>
                {!isOnline && (
                  <div style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:12, padding:'12px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:10, fontSize:13 }}>
                    <span>📡</span>
                    <div><strong>Offline mode</strong> — Συνταγές από τελευταία φόρτωση. Υλικά χωρίς τιμές.</div>
                  </div>
                )}

                <div className="fridge-ai-box">
                  <span className="fridge-icon">🧊</span>
                  <input type="text" placeholder="Τι έχεις στο ψυγείο;" value={fridgeQuery} onChange={(e) => setFridgeQuery(e.target.value)} className="fridge-input" />
                </div>

                <div className="recipe-filters">
                  {[{id:'all',label:'Όλες'},{id:'budget',label:'€ Φθηνές'},{id:'fast',label:'⏱️ Γρήγορες'}].map(f => (
                    <button key={f.id} className={`filter-btn ${recipeFilter === f.id ? 'active' : ''}`} onClick={() => setRecipeFilter(f.id)}>{f.label}</button>
                  ))}
                </div>

                {/* ── Loading skeletons ── */}
                {recipesLoading && recipes.length === 0 && (
                  <div className="recipes-grid">
                    <div style={{ textAlign:'center', padding:'16px 0 8px', fontSize:13, color:'var(--text-secondary)', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                      <div style={{ width:8, height:8, borderRadius:'50%', background:'var(--accent)', animation:'pulseDot 1.4s ease-in-out infinite' }} />
                      {isServerWaking ? 'Ο server ξυπνάει (~15 δευτ.)...' : 'Φόρτωση συνταγών...'}
                    </div>
                    {[1,2,3].map(i => (
                      <div key={i} style={{ background:'var(--bg-card)', borderRadius:16, border:'1px solid var(--border)', overflow:'hidden' }}>
                        <div className="skeleton" style={{ height:160, borderRadius:0 }} />
                        <div style={{ padding:'14px 18px', display:'flex', flexDirection:'column', gap:8 }}>
                          <div className="skeleton" style={{ height:14, width:'70%', borderRadius:8 }} />
                          <div className="skeleton" style={{ height:11, width:'40%', borderRadius:8 }} />
                          <div style={{ display:'flex', gap:6, marginTop:4 }}>
                            <div className="skeleton" style={{ height:24, width:60, borderRadius:20 }} />
                            <div className="skeleton" style={{ height:24, width:70, borderRadius:20 }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Empty / error state ── */}
                {!recipesLoading && filteredRecipes.length === 0 && (
                  <div style={{ textAlign:'center', padding:'48px 20px', background:'var(--bg-surface)', border:'2px dashed var(--border-light)', borderRadius:16 }}>
                    <div style={{ fontSize:44, marginBottom:12 }}>🍽️</div>
                    {recipes.length === 0 ? (
                      <>
                        <h3 style={{ margin:'0 0 8px', fontSize:16 }}>Δεν φορτώθηκαν συνταγές</h3>
                        <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:16 }}>
                          {isOnline ? 'Ο server μπορεί να ξυπνάει (~15 δευτ.)' : 'Δεν υπάρχει σύνδεση'}
                        </p>
                        {isOnline && (
                          <button
                            className="submit-btn"
                            style={{ padding:'10px 24px', fontSize:13 }}
                            onClick={fetchRecipes}
                          >🔄 Δοκιμή ξανά</button>
                        )}
                      </>
                    ) : (
                      <>
                        <h3 style={{ margin:'0 0 8px', fontSize:16 }}>Κανένα αποτέλεσμα</h3>
                        <p style={{ fontSize:13, color:'var(--text-secondary)' }}>Δοκίμασε διαφορετικό φίλτρο</p>
                      </>
                    )}
                  </div>
                )}

                {/* ── Recipes grid ── */}
                {filteredRecipes.length > 0 && (
                  <div className="recipes-grid">
                    {filteredRecipes.map(recipe => (
                      <div key={recipe._id || recipe.title} className="recipe-card" onClick={() => setExpandedRecipe(expandedRecipe === recipe._id ? null : recipe._id)}>
                        {recipe.image && <div className="recipe-image" style={{ backgroundImage:`url(${recipe.image})` }} />}
                        <div className="recipe-info">
                          <h4>{recipe.title}</h4>
                          <p className="recipe-chef">από {recipe.chef || 'Άγνωστος'}</p>
                          <div className="recipe-meta">
                            {recipe.time && <span>⏱️ {recipe.time}'</span>}
                            {recipe.cost != null && <span>💰 ~{Number(recipe.cost).toFixed(1)}€</span>}
                          </div>
                        </div>
                        {expandedRecipe === recipe._id && (
                          <div className="recipe-details-expanded fade-in-item">
                            <button className="add-recipe-btn" onClick={(e) => { e.stopPropagation(); addRecipeToList(recipe); }}>
                              🛒 Προσθήκη όλων στη Λίστα
                            </button>

                            <div className="recipe-section">
                              <h5 className="section-title">🥗 Υλικά</h5>
                              <ul className="ing-list-pro">
                                {recipe.ingredients.map((ing, i) => (
                                  <li key={i} className="ing-item">
                                    <input type="checkbox" id={`ing-${i}`} onClick={(e) => e.stopPropagation()} />
                                    <label htmlFor={`ing-${i}`}>{ing}</label>
                                  </li>
                                ))}
                              </ul>
                            </div>

                            {recipe.instructions && recipe.instructions.length > 0 && (
                              <div className="recipe-section" style={{marginTop: '20px'}}>
                                <h5 className="section-title">👨‍🍳 Εκτέλεση</h5>
                                <div className="instructions-timeline">
                                  {recipe.instructions.map((step, i) => (
                                    <div key={i} className="step-row">
                                      <span className="step-number">{i + 1}</span>
                                      <p className="step-text">{step}</p>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
            </>
          </div>
        )}

        {/* ════ BROCHURES TAB ════ */}
        {activeTab === 'brochures' && (
          <div className="tab-content brochures-tab">
            <div style={{ marginBottom:16, padding:'0 4px' }}>
              <h3 style={{ fontSize:15, fontWeight:700, marginBottom:4 }}>📰 Φυλλάδια Σούπερ Μάρκετ</h3>
              <p style={{ fontSize:12, color:'var(--text-secondary)' }}>Πάτα για να δεις τις τρέχουσες προσφορές</p>
            </div>
            <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(140px, 1fr))', gap:12 }}>
              {Object.entries(BROCHURE_LINKS).map(([name, url]) => (
                <a
                  key={name} href={url} target="_blank" rel="noopener noreferrer"
                  style={{
                    display:'flex', flexDirection:'column', alignItems:'center', gap:10,
                    background:'var(--bg-surface)', border:'1px solid var(--border-light)',
                    borderRadius:16, padding:'18px 12px', textDecoration:'none',
                    color:'var(--text-primary)', fontWeight:700, fontSize:13,
                    transition:'transform 0.15s, box-shadow 0.15s',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(0,0,0,0.12)'; }}
                  onMouseLeave={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = ''; }}
                >
                  <img
                    src={SUPERMARKET_LOGOS[name] || ''}
                    alt={name}
                    style={{ width:60, height:60, objectFit:'contain', borderRadius:12, background:'#fff', padding:4 }}
                    onError={e => { e.target.style.display = 'none'; }}
                  />
                  <span style={{ textAlign:'center', lineHeight:1.3 }}>{name}</span>
                  <span style={{ fontSize:10, color:'var(--text-secondary)', background:'var(--bg-subtle)', borderRadius:99, padding:'3px 8px', fontWeight:500 }}>
                    Δες Φυλλάδιο →
                  </span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}