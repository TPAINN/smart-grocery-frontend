import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { openDB } from 'idb';
// html5-qrcode is dynamically imported on first scanner open (saves ~210KB on initial load)
import './App.css';
import './EnhancedAnimations.css';
import RecipeNotification from './RecipeNotification';
import DynamicIsland from './DynamicIsland';
import SavingsRing from './SavingsRing';
import GlowCard from './GlowCard';
import AuthModal from './AuthModal';
import SavedListsModal from './SavedListsModal';
import SmartRouteMap from './SmartRouteMap';
import './SmartRouteMap.css';
import { io } from 'socket.io-client';
import { initCapacitor, initBackButton } from './capacitorInit';
import { useAndroidPermissions } from './useAndroidPermissions.jsx';
import AppSplash from './AppSplash';
import ScrollReveal from './ScrollReveal';
import PremiumWelcomeModal from './PremiumWelcomeModal';
import PlateScannerModal from './PlateScannerModal';
import LazyImage from './LazyImage';
import SplitText from './SplitText';
import { useHapticFeedback } from './useHapticFeedback';
import { API_BASE, ENABLE_KEEPALIVE } from './config';
import {
  IconShoppingCart, IconQrcode, IconUsers, IconMessage,
  IconNotes, IconUser, IconLogout,
  IconSun, IconMoon, IconSearch, IconPlus, IconTrash,
  IconStar, IconStarFilled, IconChefHat,
  IconBuildingStore, IconScan, IconWifi, IconWifiOff,
  IconClipboard, IconCheck, IconX, IconChevronRight,
  IconArrowRight, IconSparkles, IconBrain, IconShield,
  IconLock, IconFingerprint, IconRefresh, IconHistory,
  IconEdit, IconBell, IconHome, IconBookmark, IconTag,
  IconCoin, IconTrendingDown, IconAlertTriangle,
  IconMap, IconMicrophone,
} from '@tabler/icons-react';

// ─── Constants ────────────────────────────────────────────────────────────────
const CACHE_VERSION = 'v3';
const CACHE_TTL_MS  = 10 * 60 * 1000; // 10 min

// only fires in dev — keeps prod console clean
const debugLog = (payload) => {
  if (import.meta.env.DEV) console.debug('[smart-grocery]', payload);
};

// Two-layer cache: hot Map in memory, cold JSON in localStorage.
// Stale entries still render immediately while we revalidate in the background.
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
  } catch {
    // Ignore invalid/stale local cache content.
  }
  return null;
};

const cacheSet = (key, data) => {
  const entry = { data, ts: Date.now(), stale: false };
  memCache.set(key, entry);
  try {
    localStorage.setItem(`sgc_${CACHE_VERSION}_${key}`, JSON.stringify({ data, ts: entry.ts }));
  } catch {
    // Ignore storage write failures.
  }
};

// ── IndexedDB helpers for offline-first list ─────────────────────────────────
const IDB_NAME  = 'kalathaki';
const IDB_STORE = 'list_items';

function getListDB() {
  return openDB(IDB_NAME, 1, {
    upgrade(db) { db.createObjectStore(IDB_STORE, { keyPath: 'id' }); },
  });
}

async function saveItemsToIDB(items) {
  try {
    const db = await getListDB();
    const tx = db.transaction(IDB_STORE, 'readwrite');
    await tx.store.clear();
    await Promise.all(items.map(item => tx.store.put(item)));
    await tx.done;
  } catch { /* IDB unavailable — localStorage is the fallback */ }
}

async function loadItemsFromIDB() {
  try {
    const db = await getListDB();
    return await db.getAll(IDB_STORE);
  } catch { return []; }
}

// ── Render free-tier spins down after 15min of inactivity. Ping every 9min to avoid that.
const useKeepAlive = () => {
  useEffect(() => {
    if (!ENABLE_KEEPALIVE) return undefined;
    const ping = () => fetch(`${API_BASE}/api/status`, { method: 'GET' }).catch(() => {});
    ping();
    const iv = setInterval(ping, 9 * 60 * 1000); // every 9 min
    return () => clearInterval(iv);
  }, []);
};

// ── Text helpers ──────────────────────────────────────────────────────────────
const normalizeText = (text) =>
  text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

const toAbsoluteMediaUrl = (src) => {
  if (!src || typeof src !== 'string') return '';
  if (/^(https?:|data:|blob:)/i.test(src)) return src;
  const base = (API_BASE || '').replace(/\/+$/, '');
  return src.startsWith('/') ? `${base}${src}` : `${base}/${src}`;
};

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

/** Αφαιρεί το prefix "FITNESS ΣΥΝΤΑΓΗ:" (και παραλλαγές) από τίτλους συνταγών */
const cleanRecipeTitle = (title) => {
  if (!title) return title;
  return title.replace(/^(FITNESS\s+)?ΣΥΝΤΑΓ[ΗΉ]\s*(FITNESS\s*)?:\s*/i, '').trim();
};

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

// ─── SMART CATEGORY ENGINE v3 ────────────────────────────────────────────────
// Multi-pass: exact phrases → brand detection → stem matching → fallback
// Rule: longer match wins (prevents "σοκολάτα γάλακτος" → dairy)

const CATEGORIES = [
  { name: '🍎 Φρούτα & Λαχανικά', keywords: [
    // — Phrases (high priority) —
    'πρασιν σαλατ','ροκα σαλατ','λαχανικ μιξ','φρεσκ λαχαν','baby σαλατ','σαλατ μιξ',
    'cherry ντοματ','ντοματ cherry','ντοματινι','πιπερι φλωριν','πρασιν πιπερ','κοκκιν πιπερ',
    'πατατ baby','πατατε','ρεβιθ','φασολ','μπιζελ','φακε','φακ',
    // — Fruits —
    'μηλο','μηλα','αχλαδ','πορτοκαλ','μανταριν','μπανανα','μπανανε','σταφυλ',
    'καρπουζ','πεπον','ροδακιν','βερικοκ','κερασ','βυσσιν','δαμασκην','φραουλ',
    'ακτινιδ','μανγκο','mango','ανανα','παπαγ','λιτσι','ρομπ','ροδι','σμεουρ',
    'βατομουρ','μυρτιλ','blueberr','κοκκιν φρουτ','berries','νεκταριν',
    'κλημεντιν','γκρειπφρ','grapefruit','λαιμ','lime','αβοκαντ','avocado',
    'μουσμουλ','κυδων','καρυδ κοκο','ξηρ καρπ','ξηροκαρπ',
    'καρυδ','αμυγδαλ','φυστικ','κασιου','cashew','φιστικ','καρυδια','αμυγδαλα',
    'φουντουκ','σταφιδ','κουκουναρ','χουρμα','γκοτζι','cranberr',
    // — Vegetables —
    'ντοματ','τοματ','αγγουρ','κολοκυθ','κολοκυθακ','μελιτζαν','πιπερ',
    'πατατ','κρεμμυδ','κρεμυδ','σκορδ','πρασ','σελιν','μαιντανο','μαιδανο',
    'ανιθο','βασιλικ','δυοσμο','δυοσμ','ματζουραν','δαφν','ριγαν','θυμαρ',
    'μαρουλ','σπανακ','ροκ','λαχαν','κουνουπιδ','μπροκολ','broccol',
    'αρακ','καροτ','παντζαρ','ραδικ','αντιδ','γογγυλ','ραπαν',
    'τζιντζερ','ginger','κουρκουμ','φρεσκ μυρωδ','μαρουλι','λολο','ιτσεμπεργκ',
    'iceberg','σαλατ','λαχαν','κραμβ','πακ τσοι','σπαραγγ','αγκιναρ',
    'μανιταρ','mushroom','πλευρωτ','champignon','τρουφ','λαχανιδ',
    'φρεσκ κρεμμυδ','ελια','ελιε','χορτ','βλιτ','λουβ','γλυστριδ',
    'τσουκνιδ','φυλλ ελι','πιπερι καγιεν','jalapeno','χαλαπενι','τσιλ','chili',
  ]},
  { name: '🥛 Γαλακτοκομικά', keywords: [
    // — Phrases (prevent "σοκολάτα γάλακτος" from matching here) —
    'γαλα φρεσκ','γαλα πληρ','γαλα ελαφρ','γαλα αγελαδ','γαλα κατσικ',
    'γαλα βιολογ','γαλα evol','γαλα εβαπορ','γαλα ζαχαρουχ','γαλα σοκολατ',
    'τυρι κρεμα','κρεμα τυρι','cream cheese','τυρι φετ','τυρι εμενταλ',
    'τυρι γκουντ','τυρι gouda','τυρι τσενταρ','τυρι cheddar','τυρι μοτσαρελ',
    'τυρι παρμεζαν','τυρι κεφαλοτυρ','τυρι γραβιερ','τυρι ανθοτυρ',
    'τυρι μυζηθρ','τυρι μανουρ','τυρι κασερ','τυρι χαλουμ','halloumi',
    'τυρι τριμμ','τυρι φλωριν','τυρι ρικοτ','ricotta','τυρι mascarpone',
    'τυρι μασκαρπ','τυρι brie','τυρι καμαμπερ','τυρι ροκφορ','τυρι μπλε',
    'γιαουρτ στραγγιστ','γιαουρτ αγελαδ','γιαουρτ κατσικ','γιαουρτ greek',
    'γιαουρτ επιδορπ','γιαουρτ φρουτ','γιαουρτ 0%','γιαουρτ 2%',
    'κρεμα γαλακτ','κρεμ φρες','creme fraiche',
    // — Singles —
    'γαλα','γιαουρτ','βουτυρ','φετα','τυρι','τυρια','παρμεζαν','μοτσαρελ',
    'κεφαλοτυρ','γραβιερ','ανθοτυρ','μυζηθρ','κασερ','χαλουμ',
    'κρεμα','κεφιρ','kefir','αριαν','ayran','γαλακτ',
    'φιλαδελφ','philadelphia','lurpak','κερ','κρι κρι','φαγε','fage',
    'δελτα','νουνου','βλαχα','τρικαλιν','δωδων','κολιο',
    'πηλι','μεβγαλ','αγνο',
  ]},
  { name: '🥩 Κρέας & Αλλαντικά', keywords: [
    // — Phrases —
    'κοτοπουλ φιλετ','φιλετ κοτοπουλ','στηθος κοτοπουλ','μπουτ κοτοπουλ',
    'κοτοπουλ μπουτ','κοτοπουλ ολοκληρ','φτερουγ κοτοπ','κοτοπουλ στηθ',
    'κιμα μοσχαρ','κιμα χοιριν','κιμα ανάμεικ','κιμα ανάμικτ',
    'μοσχαρ φιλετ','φιλετ μοσχαρ','μπριζολ χοιρ','μπριζολ μοσχ',
    'χοιρινα παιδ','παιδακ χοιρ','παιδακ αρν','αρνι μπουτ',
    'χοιριν μπουτ','σουβλακ κοτοπ','σουβλακ χοιρ','γυρο χοιρ','γυρο κοτοπ',
    'μπιφτεκ μοσχ','μπιφτεκ κοτοπ','λουκανικ χωριατ','λουκανικ φρανκφ',
    'μπεικον καπνιστ','ζαμπον γαλοπουλ','ζαμπον χοιρ',
    'παριζ','σαλαμ αερ','σαλαμ καπνιστ','προσουτ','prosciutt',
    'σουτζουκ','παστουρμ','καβουρμ','απακ','τσιζμπεργκερ',
    // — Singles —
    'κοτοπουλ','κοτα','κιμα','μοσχαρ','χοιριν','χοιρ','αρνι','αρνισ',
    'κατσικ','κατσικισ','μπριζολ','μπιφτεκ','σουβλ','κεμπαπ','κεμπαμπ',
    'λουκανικ','σουτζ','μπεικον','bacon','παστο','ζαμπον','γαλοπουλ',
    'παριζα','σαλαμι','αλλαντ','πεπερον','pepperoni','μορταδελ','mortadell',
    'γυρο','πανσετ','σνιτσελ','schnitzel','μπουτ','φιλετ','παιδακ',
    'μπεργκερ','burger','κρεατ','κρεας','κατεψυγμεν κρεας',
    'κοτομπουκ','nugget','σεφταλ','πιτογυρ',
  ]},
  { name: '🐟 Ψάρια & Θαλασσινά', keywords: [
    'σολομο','salmon','τσιπουρ','λαβρακ','ξιφια','τονο','tuna','σαρδελ',
    'γαυρ','μαριδ','μπακαλιαρ','πεστροφ','φαγκρ','λιθριν','συναγριδ',
    'γλωσσ','κεφαλ','μυδι','γαριδ','shrimp','prawn','καβουρ','crab',
    'αστακ','lobster','καλαμαρ','calamari','χταποδ','σουπ','καραβιδ',
    'αντζουγ','anchov','κιπερ','ρεγγα','herring','μπαρμπουν','σκουμπρ',
    'θαλασσιν','ψαρι','ψαρια','fish','παγωμεν ψαρ','φιλετ ψαρ',
    'ψαροκροκετ','ψαρομπιφτεκ','ταραμ','αυγοταραχ','surimi',
    'καπνιστ σολομ','σολομ καπνιστ','καπνιστ τονο',
    'γαριδες κατεψ','γαριδα κατεψ','γαριδ κατεψ',
    'καλαμαρι κατεψ','καλαμαρ κατεψ','καλαμαρια κατεψ',
    'μυδια κατεψ','μυδι κατεψ','κατεψυγμεν γαριδ','κατεψυγμεν καλαμαρ',
    'κατεψυγμεν μυδι','κατεψυγμεν ψαρ','κατεψυγμεν σολομ',
    'κατεψ γαριδ','κατεψ καλαμαρ','κατεψ μυδι','κατεψ ψαρ',
    'χταποδι κατεψ','χταποδ κατεψ','κατεψ χταποδ',
  ]},
  { name: '🍞 Αρτοσκευάσματα', keywords: [
    'ψωμι','ψωμακ','χωριατικ ψωμ','ψωμ ολικ','ψωμ σικαλ','ψωμ σταρ',
    'σταρενι','μπαγκετ','baguette','τσιαβατ','ciabatta','φρατζολ',
    'πιτα','αραβικ πιτ','τορτιγ','tortilla','wrap','πιτ ολικ','πιτ σουβλ',
    'φρυγανι','κρακερ','cracker','κριτσιν','κρουτον','crouton',
    'κουλουρ','τσουρεκ','μπριος','brioche','παξιμαδ','ψωμ τοστ',
    'ψωμ αμερικαν','ψωμ μπεργκερ','burger bun','sandwich',
    'κεικ','muffin','μαφιν','κρουασαν','croissant','ντονατ','donut',
    'φυλλ κρουστ','φυλλ σφολιατ','σφολιατ','κουρου','κρεπ','crepe',
    'pancake','βαφλ','waffle','πιτοψωμ','λαγαν','ελιοψωμ',
  ]},
  { name: '🍝 Βασικά Τρόφιμα', keywords: [
    // — Phrases —
    'ελαιολαδ εξαιρ','εξαιρετ παρθεν','extra virgin','ελαιολαδ','λαδι ελια',
    'ηλιελαι','σογιελαι','καλαμποκελαι','σησαμελαι','φυστικελαι',
    'αλατ θαλασσ','αλατ ιωδιουχ','πιπερ μαυρ','πιπερ ασπρ',
    'ζαχαρ λευκ','ζαχαρ καστ','ζαχαρ ακατεργ','αχνη ζαχαρ',
    // — Pasta —
    'μακαρον','σπαγγετ','spaghett','πεννε','penne','φαρφαλ','farfalle',
    'λιγκουιν','linguini','ταλιατελ','tagliatell','φετουτσιν','fettuccin',
    'ριγκατον','rigatoni','λαζανι','lasagn','κοφτ μακαρ','κριθαρακ',
    'χυλοπιτ','τραχαν','ορζο','κουσκου','couscous','νουντλ','noodle',
    'ραβιολ','ravioli','τορτελιν','tortellini',
    // — Rice & Grains —
    'ρυζι','ρυζ','μπασματ','basmati','γλασ','αρμπορι','arborio',
    'κινοα','quinoa','πλιγουρ','bulgur','βρωμ','oat','δημητριακ','cereal',
    'μουσλ','muesli','γκρανολ','granola','κορν φλεικ','corn flakes',
    // — Basics —
    'αλατ','πιπερ','ζαχαρ','αλευρ','flour','μαγια','yeast',
    'μελι','honey','σιροπ','syrup','μαρμελαδ','μερεντ','nutella',
    'ταχιν','φυστικοβουτυρ','peanut butter','πραλιν',
    'ξυδ','vinegar','βαλσαμικ','balsamic','μουσταρδ','mustard','κετσαπ','ketchup',
    'μαγιονεζ','mayonnais','ζωμο','ζωμ','κυβ ζωμ','knorr',
    'λαδι','σουσαμ','παπαρουν','κανελ','γαρυφαλ','μπαχαρ','κουρκουμα',
    'παπρικ','κυμιν','cumin','κοριανδρ','σκον αρτοπ',
    'baking','μπεικιν','σοδα μαγειρ','αμμωνι','βανιλ','vanill','αρωμα βανιλ',
  ]},
  { name: '🥫 Κονσέρβες & Σάλτσες', keywords: [
    'κονσερβ','σαλτσ','τοματ πασ','τοματ πελ','τοματ τριμμ','πελτ',
    'σαλτσ ντοματ','σαλτσ ζυμαρ','σαλτσ μπολονεζ','σαλτσ πεστο','pesto',
    'σαλτσ σογια','soy sauce','σαλτσ ασια','σαλτσ bbq','σαλτσ worcester',
    'σαλτσ τσιλ','sriracha','tabasco','σαλτσ τερ','teriyaki',
    'hummus','χουμου','τζατζικ','ταραμοσαλατ','μελιτζανοσ',
    'κομποστ','φρουτοσαλατ','ανανα κονσερβ','ροδακιν κονσερβ',
    'καλαμποκ κονσ','αρακα κονσ','φασολ κονσ','φασολακ','τοματ κονσ',
    'τονο κονσερβ','σαρδελ κονσερβ','τοματ συμπ','pelati','passata',
    'τοματοπολτ','τοματοχυμ','πιατ ετοιμ','ετοιμ φαγητ',
  ]},
  { name: '❄️ Κατεψυγμένα', keywords: [
    'κατεψυγμ','κατεψ','frozen','παγωτ','ice cream','παγωμεν',
    'πιτσα κατεψ','pizza κατεψ','πιτσα','pizza',
    'λαχανικ κατεψ','κατεψ λαχαν','μιξ λαχαν κατεψ',
    'κροκετ','croquett','σπρινγκ ρολ','spring roll',
    'γαριδ κατεψ','καλαμαρ κατεψ','ψαροκροκ',
    'κατεψ μπιφτεκ','κατεψ κοτοπ','κατεψ γεμιστ',
    'στρουντελ','πιτ κατεψ','πιτ σπανακ','σπανακοπιτ','τυροπιτ','κασεροπιτ',
    'μπουγατσ','πιτακ','κρεπ κατεψ','κατεψ ζυμ','ζυμ σφολιατ','ζυμ κουρου',
  ]},
  { name: '🥤 Ποτά & Αναψυκτικά', keywords: [
    // — Phrases —
    'φυσικ νερ','μεταλλικ νερ','ανθρακουχ νερ','ανθρακικ',
    'χυμο πορτοκ','χυμο μηλ','χυμο ροδ','χυμο κρανμπ','χυμο ντομ',
    'χυμο μανγκο','χυμο ανανα','χυμο πολυφρ','χυμο φρεσκ',
    // — Water & Juice —
    'νερο','νερα','χυμο','χυμος','φυσικ μεταλ',
    // — Soft drinks —
    'coca cola','pepsi','fanta','sprite','σβεπ','schweppes','7up','7 up',
    'αναψυκτικ','cola','κολα','γκαζοζ','σοδα','tonic','λεμοναδ','πορτοκαλαδ',
    'αϊστι','ice tea','τσαι παγ',
    // — Energy & Sports —
    'monster','red bull','redbull','ενεργειακ','gatorade','powerade',
    // — Alcohol —
    'μπυρ','μπιρ','beer','lager','ale','ipa','stout','pilsner','μπιρα',
    'κρασ','κρασι','wine','οινο','ροζε','rose wine','λευκ κρασ','κοκκιν κρασ',
    'ουζο','τσιπουρ','ρακ','ρακι','τσικουδ','μεταξα','metaxa',
    'ουισκ','whisky','whiskey','βοτκα','vodka','ρουμ','rum',
    'τεκιλ','tequila','τζιν','gin','λικερ','liqueur','aperol','campari',
    'prosecco','σαμπαν','champagne',
    // — Plant milk —
    'γαλα αμυγδ','γαλα βρωμ','γαλα σογι','γαλα καρυδ','γαλα ρυζ',
    'γαλα φυτικ','oat milk','almond milk','soy milk',
  ]},
  { name: '🍪 Σνακ & Γλυκά', keywords: [
    // — Phrases (protect from misclassification) —
    'σοκολατ γαλακτ','σοκολατ υγεια','σοκολατ λευκ','σοκολατ bitter',
    'σοκολατ κουβερτ','σοκολατ πραλιν','σοκολατ φουντουκ',
    // — Chocolate —
    'σοκολατ','chocolat','lacta','λακτα','ιον','παυλιδ','merci','ferrero',
    'kinder','bueno','kitkat','kit kat','toblerone','lindt','milka','twix',
    'snickers','mars','bounty','oreo','μπισκοτ',
    // — Cookies & Snacks —
    'κουλουρακ','μπισκοτ','biscuit','cookie','παξιμαδ γλυκ',
    'γκοφρετ','wafer','κρουασανακ','μπαρ δημητρ','granola bar','μπαρ ενεργ',
    'τσιπ','chips','πατατακ','lay','lays','pringles','doritos','cheetos',
    'ποπ κορν','popcorn','κρακ','pretzel','πρετζελ','στικ','μπαστουν',
    'φιστικ πακετ','κασιου πακετ','ξηρ καρπ πακετ','τραγαν',
    // — Sweets —
    'γλυκ','ζαχαροπλ','καραμελ','candy','γομ','τσιχλ','gum','μαστιχ',
    'παστελ','χαλβα','λουκουμ','ζελεδ','ζελε','jelly','μαρσμελ','marshmallow',
    'κρεμ καραμελ','γλυκ κουταλ','γλυκο','φονταν',
    // — Ice cream (when not frozen section context) —
    'παγωτ','ice cream','magnum','algida','εβγα','κρεμ παγωτ',
  ]},
  { name: '☕ Καφές & Ροφήματα', keywords: [
    'καφε','coffee','εσπρεσ','espresso','καπουτσιν','cappuccin','φιλτρ καφ',
    'ελληνικ καφ','φραπ','nescafe','νεσκαφε','ness','jacobs','lavazza',
    'illy','segafredo','loumidis','λουμιδ','παπαγαλ','bravo','στιγμιαι καφ',
    'καψουλ καφ','capsule','nespresso','dolce gusto','tassimo',
    'τσαι','tea','χαμομηλ','μεντ','πρασιν τσα','μαυρ τσα','τσαι βουν',
    'ρoφημ','σοκολατ ροφημ','κακαο','cocoa','ζεστ σοκολ',
    'φυτικ ροφημ','ροφημ αμυγδ','ροφημ βρωμ','ροφημ σογι',
  ]},
  { name: '🧹 Καθαριότητα & Σπίτι', keywords: [
    'απορρυπαντ','σκον πλυσ','υγρ πλυσ','υγρ πιατ','καθαριστ',
    'χλωριν','χλωρ','αντισηπτ','απολυμαντ','υαλοκαθαρ','τζαμ','σφουγγαρ',
    'σκουπ','σκουπιδοσακουλ','σακουλ σκουπ','μεμβραν','αλουμινοχαρτ','λαδοκολλ',
    'χαρτ κουζ','χαρτ υγ','χαρτομαντ','χαρτοπετσετ','χαρτιν','tissue',
    'μαλακτ ρουχ','κοντισιον ρουχ','λευκαντ','ενισχυτ πλυσ',
    'καθαρ δαπεδ','καθαρ μπαν','καθαρ κουζιν','καθαρ αλατ','αποφρακτ',
    'σφουγγαριστρ','βουρτσ','γαντι καθαρ','γαντι latex','γαντι nitrile',
    'εντομοκτον','εντομοαπωθ','μυγοκτον','κατσαριδ',
    'αρωματ χωρ','αποσμητ χωρ','κερ αρωμ','θυμιαμ',
    'μπαταρ','λαμπ','λαμπτηρ','led','φακ',
    'ariel','skip','θερμ','persil','dixan','ajax','cif','domestos','mr muscle',
    'fairy','θερμαικ','μεγα','mega','εσσεν','essenc','αρκαδ',
  ]},
  { name: '🧴 Προσωπική Φροντίδα', keywords: [
    'σαμπουαν','shampoo','κοντισιον μαλ','conditioner','μαλακτ μαλλ',
    'αφρολουτρ','shower','σαπουν','soap','αποσμητ','deodor','αντιιδρωτ',
    'οδοντοκρεμ','οδοντοβουρτσ','οδοντ νημ','στοματικ','στοματοπλυτ',
    'ξυριστ','ξυρισμ','αφρ ξυρ','aftershave','ξυραφ','gillette',
    'κρεμ προσωπ','κρεμ χερ','λοσιον','αντηλιακ','sunscreen',
    'αντιρυτιδ','ενυδατ','moistur','μασκ προσωπ','scrub','peeling',
    'μαντηλακ','μωρομαντ','wet wipe','βαμβακ','μπατονετ',
    'σερβιετ','ταμπον','πανα','pampers','huggies','βρεφ',
    'nivea','dove','palmolive','oral-b','colgate','aim','nθ',
  ]},
  { name: '📦 Διάφορα', keywords: [] },
];

const getCategory = (name) => {
  const norm = normalizeText(name);
  let bestCat = '📦 Διάφορα';
  let bestLen = 0;   // longest matching keyword wins → most specific match

  for (const cat of CATEGORIES) {
    for (const kw of cat.keywords) {
      if (kw.length > bestLen && norm.includes(kw)) {
        bestLen = kw.length;
        bestCat = cat.name;
      }
    }
  }

  // ── Second pass: try matching individual words (handles "ΦΡΕΣΚΟ ΓΑΛΑ 1L" etc.) ──
  if (bestCat === '📦 Διάφορα') {
    const words = norm.split(/[\s\-,.:;!?()[\]{}0-9]+/).filter(w => w.length >= 3);
    for (const word of words) {
      for (const cat of CATEGORIES) {
        for (const kw of cat.keywords) {
          // word starts with keyword or keyword starts with word
          if (kw.length >= 3 && word.length >= 3 && (word.startsWith(kw) || kw.startsWith(word)) && kw.length > bestLen) {
            bestLen = kw.length;
            bestCat = cat.name;
          }
        }
      }
    }
  }

  return bestCat;
};

// ─── Category avatar helpers ──────────────────────────────────────────────────
const CAT_GRADIENTS = {
  '🍎': ['#86efac','#22c55e'],  // fruits & veg — green
  '🥛': ['#93c5fd','#60a5fa'],  // dairy — blue
  '🥩': ['#fca5a5','#ef4444'],  // meat — red
  '🐟': ['#7dd3fc','#0ea5e9'],  // fish — ocean blue
  '🍞': ['#fde68a','#f59e0b'],  // bakery — amber
  '🍝': ['#fed7aa','#f97316'],  // pantry — orange
  '🥫': ['#d9f99d','#84cc16'],  // cans & sauces — lime
  '❄️': ['#bae6fd','#38bdf8'],  // frozen — ice blue
  '🥤': ['#6ee7b7','#10b981'],  // drinks — teal
  '🍪': ['#ddd6fe','#8b5cf6'],  // snacks & sweets — purple
  '☕': ['#d6b4a7','#92400e'],  // coffee — brown
  '🧹': ['#e2e8f0','#64748b'],  // cleaning — slate
  '🧴': ['#fbcfe8','#ec4899'],  // personal care — pink
  '📦': ['#e5e7eb','#9ca3af'],  // misc — gray
};
const getCatEmoji  = (cat) => [...(cat || '📦')][0] || '📦';
const getCatGradient = (cat) => {
  const cols = CAT_GRADIENTS[getCatEmoji(cat)] || CAT_GRADIENTS['📦'];
  return `linear-gradient(135deg, ${cols[0]}, ${cols[1]})`;
};

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
  { keywords:['ελαιολαδ','λαδι','σπορελαι'], cals:820, defaultG:500 },
  { keywords:['βουτυρ','μαργαριν'], cals:720, defaultG:250 },
  { keywords:['μαγιονεζ'], cals:680, defaultG:450 },
  { keywords:['κρεμ γαλακτ'], cals:340, defaultG:200 },
  { keywords:['σοκολατ'], cals:540, defaultG:100 },
  { keywords:['μερεντ','φουντουκοκρεμ','nutella'], cals:540, defaultG:400 },
  { keywords:['μπισκοτ'], cals:480, defaultG:200 },
  { keywords:['κρουασαν'], cals:400, defaultG:80 },
  { keywords:['κεικ','τσουρεκ'], cals:380, defaultG:500 },
  { keywords:['παξιμαδ','φρυγανι'], cals:420, defaultG:250 },
  { keywords:['πατατακ','τσιπς'], cals:530, defaultG:130 },
  { keywords:['ποπ κορν'], cals:380, defaultG:90 },
  { keywords:['ξηρ καρπ','φιστικ','καρυδ','αμυγδαλ','κεσιου','πεκαν'], cals:600, defaultG:150 },
  { keywords:['γαριδακ','πρετζελ','κρακερ','στικ'], cals:440, defaultG:120 },
  { keywords:['ζαχαρ'], cals:400, defaultG:1000 },
  { keywords:['μελ'], cals:320, defaultG:450 },
  { keywords:['μαρμελαδ'], cals:250, defaultG:370 },
  { keywords:['σιροπ','ζαχαροπλαστ'], cals:300, defaultG:250 },
  { keywords:['φετ'], cals:260, defaultG:400 },
  { keywords:['γκουντ','γουδα','εμενταλ'], cals:360, defaultG:300 },
  { keywords:['κασερ','γραβιερ','παρμεζαν'], cals:390, defaultG:250 },
  { keywords:['μοτσαρελ'], cals:280, defaultG:250 },
  { keywords:['τυρ','ροκφορ','ταλαγαν'], cals:320, defaultG:200 },
  { keywords:['ψωμ','πιτ ψωμ'], cals:250, defaultG:500 },
  { keywords:['τορτιγ'], cals:310, defaultG:370 },
  { keywords:['μακαρον','σπαγετ','ζυμαρικ'], cals:350, defaultG:500 },
  { keywords:['ρυζ'], cals:350, defaultG:500 },
  { keywords:['αλευρ'], cals:340, defaultG:1000 },
  { keywords:['βρωμ','δημητριακ'], cals:370, defaultG:500 },
  { keywords:['αλλαντικ','ζαμπον'], cals:130, defaultG:360 },
  { keywords:['μπεικον'], cals:310, defaultG:140 },
  { keywords:['λουκανικ'], cals:280, defaultG:400 },
  { keywords:['σαλαμ','πεπερον','κοπανιστ'], cals:380, defaultG:150 },
  { keywords:['κοτοπουλ','στηθ','μπουτ'], cals:170, defaultG:700 },
  { keywords:['κρεας','μοσχαρ','χοιρ','μπριζολ','φιλετ'], cals:210, defaultG:500 },
  { keywords:['κιμας'], cals:230, defaultG:500 },
  { keywords:['συκωτ'], cals:140, defaultG:400 },
  { keywords:['σολομ'], cals:210, defaultG:300 },
  { keywords:['τονοσ','τουν'], cals:130, defaultG:160 },
  { keywords:['ψαρ','σαρδελ','ρεγγ'], cals:150, defaultG:400 },
  { keywords:['γαριδ','καλαμαρ','μυδ','χταπ'], cals:90, defaultG:400 },
  { keywords:['αυγ'], cals:155, defaultG:360 },
  { keywords:['γαλ'], cals:50, defaultG:1000 },
  { keywords:['γιαουρτ','κεφιρ'], cals:65, defaultG:200 },
  { keywords:['ρυζογαλ'], cals:100, defaultG:200 },
  { keywords:['χυμ','φρουτοχυμ','smoothie','nectar'], cals:45, defaultG:1000 },
  { keywords:['μηλ','μπαναν','πορτοκαλ','σταφυλ','ροδακιν','αχλαδ','κερασ','φραουλ','ακτινιδ','ανανα','μανγκ','λεμον','μανταρ'], cals:55, defaultG:500 },
  { keywords:['αβοκαντ'], cals:160, defaultG:200 },
  { keywords:['ντοματ','πατατ','γλυκοπατατ','κολοκυθ','μελιτζαν','πιπερι','φρεσκ'], cals:30, defaultG:500 },
  { keywords:['μαρουλ','σπανακ','λαχαν','καροτ','κρεμμυδ','σκορδ','αγγουρ','σελιν','μαιντ','δυοσμ','ρεπαν','παντζαρ'], cals:22, defaultG:400 },
  { keywords:['αναψυκτικ','κολα','σπρ','φαντ','λεμοναδ','πορτοκαλαδ'], cals:42, defaultG:330 },
  { keywords:['ενεργει','energy drink','red bull'], cals:45, defaultG:250 },
  { keywords:['μπυρ','beer','μπιρ'], cals:43, defaultG:500 },
  { keywords:['κρασ','οινοσ','σαμπανι','prosecco','wine'], cals:80, defaultG:750 },
  { keywords:['ουισκ','βοτκ','ρουμ'], cals:220, defaultG:700 },
  { keywords:['τσιπουρ','ρακ','ούζ','ouzo','tsipouro'], cals:220, defaultG:200 },
  { keywords:['καφ','espresso','cappuccin','frappe'], cals:8, defaultG:200 },
  { keywords:['τσα','chamomile','herbal','χαμομηλ'], cals:2, defaultG:200 },
  { keywords:['νερ','μεταλλικ','σοδα','sparkling'], cals:0, defaultG:1500 },
  { keywords:['ελι','ελιε','ελιτσ'], cals:145, defaultG:250 },
  { keywords:['κετσαπ'], cals:110, defaultG:500 },
  { keywords:['μουσταρδ'], cals:65, defaultG:200 },
  { keywords:['σαλτσ','pesto'], cals:80, defaultG:400 },
  { keywords:['ξυδ'], cals:18, defaultG:500 },
  { keywords:['μπεσαμελ'], cals:130, defaultG:250 },
  { keywords:['ταχιν','χουμ'], cals:300, defaultG:300 },
  { keywords:['αλατ','πιπερ','ριγαν','θυμαρ','κανελ','κυμιν','μπαχαρ','κουρκουμ','paprika'], cals:25, defaultG:100 },
  { keywords:['παγωτ','sorbet','gelato'], cals:200, defaultG:500 },
  { keywords:['κρεπ','βαφλ','pancake','τηγανιτ'], cals:230, defaultG:200 },
  { keywords:['κομπ'], cals:250, defaultG:350 },
  { keywords:['πιτα κεικ','γλυκ'], cals:350, defaultG:400 },
  { keywords:['οσπρι','φακε','ρεβιθ','φασολ','φαβα'], cals:340, defaultG:500 },
  { keywords:['ντολμα','σαρμα'], cals:150, defaultG:400 },
  { keywords:['πιτσ','pizza'], cals:260, defaultG:400 },
  { keywords:['χαλβ'], cals:470, defaultG:400 },
  { keywords:['λουκουμ'], cals:320, defaultG:350 },
];

// ─── Extract quantity in grams from product name ────────────────────────────
const extractQuantityGrams = (name) => {
  const t = name.toLowerCase().replace(/,/g, '.');

  // "6x330ml", "4x1.5lt", "3x200g"
  const multi = t.match(/(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*(ml|lt|l|g|gr|kg)/i);
  if (multi) {
    const count = parseInt(multi[1]);
    const val = parseFloat(multi[2]);
    const unit = multi[3].toLowerCase();
    if (unit === 'kg') return count * val * 1000;
    if (unit === 'lt' || unit === 'l') return count * val * 1000;
    return count * val; // ml or g
  }

  // "1.5kg", "500g", "1lt", "330ml", "200gr"
  const single = t.match(/(\d+(?:[.,]\d+)?)\s*(kg|lt|l|ml|g|gr)\b/i);
  if (single) {
    const val = parseFloat(single[1]);
    const unit = single[2].toLowerCase();
    if (unit === 'kg') return val * 1000;
    if (unit === 'lt' || unit === 'l') return val * 1000;
    return val; // ml or g
  }

  // "500 γρ", "1 κιλό", "1.5 λίτρο"
  const gr = t.match(/(\d+(?:[.,]\d+)?)\s*(γρ|γραμ|κιλ|λιτρ|λίτρ)/i);
  if (gr) {
    const val = parseFloat(gr[1]);
    const unit = gr[2].toLowerCase();
    if (unit.startsWith('κιλ')) return val * 1000;
    if (unit.startsWith('λιτ') || unit.startsWith('λίτ')) return val * 1000;
    return val; // γραμμάρια
  }

  // "500 ml", "1000ml" (with space)
  const spaced = t.match(/(\d+(?:[.,]\d+)?)\s+(ml|g|gr|kg|lt|l)\b/i);
  if (spaced) {
    const val = parseFloat(spaced[1]);
    const unit = spaced[2].toLowerCase();
    if (unit === 'kg') return val * 1000;
    if (unit === 'lt' || unit === 'l') return val * 1000;
    return val;
  }

  // "X τεμάχια" (pieces) — use default weight, return null
  return null;
};

// Checks if a product name is food/drink (edible by humans)
const getFoodInfo = (name) => {
  const t = normalizeText(name);

  // 1. Check non-food blacklist FIRST
  if (NON_FOOD_KEYWORDS.some(k => t.includes(k))) {
    return { calsPer100g: 0, totalCals: 0, quantity: 0, isFood: false };
  }

  // 2. Check food calorie DB
  for (let e of FOOD_CAL_DB) {
    if (e.keywords.some(k => t.includes(k))) {
      const detectedG = extractQuantityGrams(name);
      const grams = detectedG || e.defaultG;
      const totalCals = Math.round((e.cals / 100) * grams);
      return { calsPer100g: e.cals, totalCals, quantity: grams, isFood: true, detected: !!detectedG };
    }
  }

  // 3. Unknown → assume food, ~120 kcal/100g, ~300g default
  const detectedG = extractQuantityGrams(name);
  const grams = detectedG || 300;
  return { calsPer100g: 120, totalCals: Math.round((120 / 100) * grams), quantity: grams, isFood: true, detected: !!detectedG };
};

const calColor = (c) => c === 0 ? '#94a3b8' : c < 200 ? '#22c55e' : c < 500 ? '#f97316' : '#ef4444';

// ─── Brochures ────────────────────────────────────────────────────────────────
const BROCHURE_LINKS = {
  'Lidl':             'https://www.kimbino.gr/lidl/',
  'Market In':        'https://www.fylladiomat.gr/market-in/',
  'MyMarket':         'https://www.fylladiomat.gr/my-market/',
  'ΑΒ Βασιλόπουλος': 'https://www.fylladiomat.gr/%CE%B1%CE%B2-%CE%B2%CE%B1%CF%83%CE%B9%CE%BB%CF%8C%CF%80%CE%BF%85%CE%BB%CE%BF%CF%82/',
  'Γαλαξίας':         'https://www.fylladiomat.gr/%CE%B3%CE%B1%CE%BB%CE%B1%CE%BE%CE%AF%CE%B1%CF%82/',
  'Σκλαβενίτης':      'https://www.fylladiomat.gr/%CF%83%CE%BA%CE%BB%CE%B1%CE%B2%CE%B5%CE%BD%CE%B9%CF%84%CE%B7%CF%82/',
  'Μασούτης':         'https://www.fylladiomat.gr/%CE%BC%CE%B1%CF%83%CE%BF%CF%8D%CF%84%CE%B7%CF%82/',
  'Κρητικός':         'https://www.fylladiomat.gr/%CE%BA%CF%81%CE%B7%CF%84%CE%B9%CE%BA%CE%BF%CF%82/',
};

const SUPERMARKET_LOGOS = {
  'Lidl':            'https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Lidl_logo.png/500px-Lidl_logo.png',
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

  const totalCals = foodItems.reduce((s, i) => s + getFoodInfo(i.text).totalCals, 0);

  const totalColor =
    totalCals === 0   ? '#64748b' :
    totalCals < 2000  ? '#22c55e' :
    totalCals < 5000  ? '#f97316' : '#ef4444';

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
              Θερμίδες Καλαθιού
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
            const info = getFoodInfo(item.text);
            return (
              <div key={i} style={{
                display:'flex', alignItems:'center', gap:4,
                background:`${calColor(info.totalCals)}12`,
                border:`1px solid ${calColor(info.totalCals)}30`,
                borderRadius:99, padding:'3px 8px',
                fontSize:10, fontWeight:700, color: calColor(info.totalCals),
                maxWidth:140, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap',
              }}>
                {info.totalCals} kcal
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
function SwipeableItem({ item, onDelete, onSend, onToggleCheck, onChangeQty, user }) {
  const [offsetX, setOffsetX]     = useState(0);
  const [swiping, setSwiping]     = useState(false);
  const [dismissed, setDismissed] = useState(false);
  // ── AI substitutions ──────────────────────────────────────────────────────
  const [showSub,   setShowSub]   = useState(false);
  const [subLoading,setSubLoading]= useState(false);
  const [subResult, setSubResult] = useState(null);
  const [subError,  setSubError]  = useState('');

  useEffect(() => {
    if (!showSub || subResult || subLoading) return;
    setSubLoading(true);
    setSubError('');
    fetch(`${API_BASE}/api/prices/substitute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ productName: item.text, currentStore: item.store, currentPrice: item.price }),
    })
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(data => setSubResult(data))
      .catch(() => setSubError('Αδυναμία σύνδεσης με τον server.'))
      .finally(() => setSubLoading(false));
  }, [showSub]); // eslint-disable-line
  const startX    = useRef(0);
  const startY    = useRef(0);
  const isLocked  = useRef(false);
  const THRESHOLD = 80;

  const foodInfo = user ? getFoodInfo(item.text) : { calories: 0, isFood: false };

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
    <li
      className={`item-card-wrapper ${dismissed ? 'dismissed' : ''}`}
      style={{ '--reveal': revealPct }}
      tabIndex={0}
      onKeyPress={(e) => { if (e.key === 'Enter') onToggleCheck(item.id); }}
    >

      {/* ── Red glow layer (behind the card, full width) ── */}
      {swiping && revealPct > 0.02 && (
        <div style={{
          position: 'absolute',
          inset: 0,
          borderRadius: 'var(--radius-md, 14px)',
          // Intense red glow follows swipe direction
          background: swipeDir === 'left'
            ? `linear-gradient(to left, transparent 0%, rgba(239,68,68,${0.2 + revealPct * 0.5}) 50%, rgba(239,68,68,${0.4 + revealPct * 0.6}) 100%)`
            : `linear-gradient(to right, transparent 0%, rgba(239,68,68,${0.2 + revealPct * 0.5}) 50%, rgba(239,68,68,${0.4 + revealPct * 0.6}) 100%)`,
          boxShadow: `
            ${swipeDir === 'left' ? '-' : ''}${8 + revealPct * 28}px 0 ${20 + revealPct * 44}px rgba(239,68,68,${0.4 + revealPct * 0.6}),
            0 0 ${12 + revealPct * 36}px rgba(239,68,68,${0.25 + revealPct * 0.5}),
            inset 0 0 ${revealPct * 40}px rgba(239,68,68,${revealPct * 0.15})
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
        opacity: Math.min(1, revealPct * 1.4),
        transform: `scale(${0.5 + revealPct * 0.6})`,
        transition: swiping ? 'none' : 'opacity 0.3s, transform 0.3s',
        pointerEvents: 'none',
        zIndex: 0,
        filter: `drop-shadow(0 0 ${revealPct * 16}px rgba(239,68,68,1)) drop-shadow(0 0 ${revealPct * 6}px rgba(239,68,68,0.8))`,
      }}>
        <span style={{ fontSize: 22 }}>🗑️</span>
      </div>

      {/* ── The actual card ── */}
      <div
        className={`item-card card-lift ${swiping ? 'swiping' : ''} ${item.isChecked ? 'item-checked' : ''}`}
        style={{
          transform: `translateX(${offsetX}px) rotate(${offsetX * 0.018}deg)`,
          transformOrigin: offsetX > 0 ? 'right center' : 'left center',
          transition: swiping ? 'none' : 'transform 0.4s cubic-bezier(0.34,1.56,0.64,1), box-shadow 0.3s ease',
          position: 'relative',
          zIndex: 1,
          // Intense red border tint as swipe progresses
          borderColor: revealPct > 0.1
            ? `rgba(239,68,68,${revealPct * 0.9})`
            : undefined,
          boxShadow: revealPct > 0.1
            ? `0 0 0 ${1 + revealPct}px rgba(239,68,68,${revealPct * 0.6}), inset 0 0 ${revealPct * 30}px rgba(239,68,68,${revealPct * 0.12}), 0 0 ${revealPct * 20}px rgba(239,68,68,${revealPct * 0.25})`
            : undefined,
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {/* Tap-to-check circle */}
        <button
          className={`check-circle ${item.isChecked ? 'checked' : ''}`}
          onClick={() => onToggleCheck(item.id)}
          title={item.isChecked ? 'Αγοράστηκε' : 'Σημείωσε ως αγορασμένο'}
        >
          {item.isChecked && <span style={{ fontSize:11, lineHeight:1 }}>✓</span>}
        </button>

        {/* ── Product avatar (real image or clean initial fallback) ── */}
        <div className="item-avatar" style={{ opacity: item.isChecked ? 0.45 : 1, transition:'opacity 0.2s' }}>
          {item.imageUrl
            ? <img src={item.imageUrl} alt={item.text} className="item-avatar-img" loading="lazy" onError={e => { e.currentTarget.style.display='none'; e.currentTarget.nextSibling.style.display='flex'; }}/>
            : null
          }
          {/* Subtle initial fallback, shown if no image or image fails to load */}
          <div className="item-avatar-fallback" style={{ display: item.imageUrl ? 'none' : 'flex' }}>
            <span className="item-avatar-initial">{item.text.charAt(0).toUpperCase()}</span>
          </div>
        </div>

        <div className="item-content" style={{ opacity: item.isChecked ? 0.45 : 1, transition:'opacity 0.2s' }}>
          <span className="item-text" style={{ textDecoration: item.isChecked ? 'line-through' : 'none' }}>{item.text}</span>
          {item.recipeSource && (
            <span style={{
              display:'inline-block', fontSize:10, fontWeight:700,
              color:'#a78bfa', background:'rgba(167,139,250,0.1)',
              border:'1px solid rgba(167,139,250,0.2)',
              borderRadius:99, padding:'2px 8px', marginTop:2,
            }}>📖 {item.recipeSource}</span>
          )}
          {user && (
          <div className="item-meta-row">
            <span className="item-price-tag">{item.price > 0 ? `${item.price.toFixed(2)}€` : '—'}</span>
            {item.store && item.store !== '—' && <span className="item-store-tag">📍 {item.store}</span>}
            {foodInfo.isFood && foodInfo.totalCals > 0 && (
              <span style={{
                fontSize:10, fontWeight:700, color:calColor(foodInfo.totalCals),
                background:`${calColor(foodInfo.totalCals)}18`, borderRadius:99, padding:'2px 7px',
              }}>🔥 {foodInfo.totalCals}</span>
            )}
          </div>
          )}
        </div>
        <div className="item-actions" style={{ alignItems:'center', gap:4 }}>
          {/* Quantity controls */}
          <div style={{ display:'flex', alignItems:'center', gap:3, background:'var(--bg-subtle)', borderRadius:8, padding:'2px 3px' }}>
            <button
              onClick={() => onChangeQty(item.id, -1)}
              style={{ width:20, height:20, border:'none', background:'transparent', cursor:'pointer', color:'var(--text-secondary)', fontSize:15, fontWeight:700, lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, padding:0 }}
            >−</button>
            <span style={{ fontSize:12, fontWeight:800, color:'var(--text-primary)', minWidth:14, textAlign:'center' }}>{item.quantity || 1}</span>
            <button
              onClick={() => onChangeQty(item.id, +1)}
              style={{ width:20, height:20, border:'none', background:'transparent', cursor:'pointer', color:'var(--text-secondary)', fontSize:15, fontWeight:700, lineHeight:1, display:'flex', alignItems:'center', justifyContent:'center', borderRadius:6, padding:0 }}
            >+</button>
          </div>
          {user && <button className="send-friend-btn" onClick={() => onSend(item)} title="Στείλε σε φίλο">📤</button>}
          {item.price > 0 && <button className="substitute-btn" onClick={() => setShowSub(s => !s)} title="AI Εναλλακτικά">💡</button>}
          <button className="delete-btn" onClick={() => onDelete(item.id)} title="Διαγραφή">✕</button>
        </div>
      </div>

      {/* ── AI Substitutions panel ── */}
      {showSub && (
        <div className="sub-panel">
          {subLoading && <div className="sub-loading"><span className="sub-spinner"/>Αναζήτηση εναλλακτικών…</div>}
          {subError  && <div className="sub-error">⚠️ {subError}</div>}
          {subResult && (
            <>
              <div className="sub-panel-title">💡 AI Εναλλακτικά για «{item.text}»</div>
              {(subResult.aiTop3 || subResult.alternatives || []).map((alt, i) => (
                <div key={i} className="sub-alt">
                  <div className="sub-alt-info">
                    <span className="sub-alt-name">{alt.name || alt.chainName}</span>
                    <span className="sub-alt-store">📍 {alt.supermarket || alt.store}</span>
                    {alt.reason && <span className="sub-alt-reason">{alt.reason}</span>}
                  </div>
                  <span className="sub-alt-price">€{(alt.price||0).toFixed(2)}</span>
                  {item.price > 0 && alt.price < item.price && (
                    <span className="sub-alt-save">-€{(item.price - alt.price).toFixed(2)}</span>
                  )}
                </div>
              ))}
              {(!subResult.aiTop3 && !subResult.alternatives?.length) && (
                <div className="sub-none">Δεν βρέθηκαν φθηνότερα εναλλακτικά.</div>
              )}
            </>
          )}
        </div>
      )}
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
  const [key, setKey]           = useState('');
  const [loading, setLoading]   = useState(false);
  const [preview, setPreview]   = useState(null);
  const lookupTimeout           = useRef(null);

  if (!isOpen) return null;

  const lookupKey = async (val) => {
    if (val.length < 6) { setPreview(null); return; }
    setLoading(true);
    setPreview(null);
    try {
      // FIX: try both name and shareKey in response
      const r = await fetch(`${API_BASE}/api/auth/by-key/${val.trim().toUpperCase()}`);
      if (r.ok) {
        const data = await r.json();
        // Backend returns { name, shareKey } — 'name' is the display name
        setPreview({ name: data.name || data.username, shareKey: data.shareKey });
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

  const handleAdd = (friendData) => {
    // Only allow adding when the share key was verified against the server.
    // Never create a ghost friend from a raw unverified key.
    const target = friendData || (
      preview && preview !== 'not_found' && preview !== 'offline'
        ? { shareKey: preview.shareKey, username: preview.name || preview.username || 'Φίλος', addedAt: Date.now() }
        : null
    );
    if (!target) return;
    onAdd(target);
    setKey('');
    setPreview(null);
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content" style={{ maxWidth:400, padding:0, overflow:'hidden' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ padding:'20px 20px 16px', background:'linear-gradient(135deg,rgba(99,102,241,0.08),rgba(139,92,246,0.05))', borderBottom:'1px solid var(--border-light)', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10 }}>
            <div style={{ width:40, height:40, borderRadius:11, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center' }}>
              <IconUsers size={20} color="#fff" stroke={2} />
            </div>
            <div>
              <div style={{ fontWeight:800, fontSize:16, color:'var(--text-primary)' }}>Προσθήκη Φίλου</div>
              <div style={{ fontSize:11, color:'var(--text-secondary)' }}>Μοιραστείτε το ίδιο καλάθι</div>
            </div>
          </div>
          <button onClick={onClose} style={{ background:'var(--bg-surface)', border:'none', borderRadius:9, width:32, height:32, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-secondary)' }}>
            <IconX size={16} />
          </button>
        </div>

        <div style={{ padding:'16px 20px 20px' }}>
          {/* Search input */}
          <div style={{ position:'relative', marginBottom:12 }}>
            <div style={{ position:'absolute', left:12, top:'50%', transform:'translateY(-50%)', color:'var(--text-secondary)', pointerEvents:'none' }}>
              <IconSearch size={16} />
            </div>
            <input
              type="text"
              placeholder="Share Key του φίλου (π.χ. AB12XY)"
              value={key}
              onChange={handleKeyChange}
              onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              autoFocus
              maxLength={15}
              style={{
                padding:'12px 14px 12px 38px', borderRadius:11,
                border:`1.5px solid ${preview && preview !== 'not_found' && preview !== 'offline' ? '#10b981' : 'var(--border)'}`,
                background:'var(--bg-input)', color:'var(--text-primary)',
                fontSize:15, fontFamily:'monospace',
                outline:'none', width:'100%', letterSpacing:2,
                fontWeight:700, textTransform:'uppercase',
                transition:'border-color 0.2s', boxSizing:'border-box',
              }}
            />
            {key && <button onClick={() => { setKey(''); setPreview(null); }} style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', background:'none', border:'none', cursor:'pointer', color:'var(--text-secondary)', display:'flex' }}><IconX size={14}/></button>}
          </div>

          {/* Preview area */}
          {loading && (
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 14px', background:'var(--bg-surface)', borderRadius:11, border:'1px solid var(--border-light)', marginBottom:12 }}>
              <div className="skeleton" style={{ width:38, height:38, borderRadius:10, flexShrink:0 }} />
              <div style={{ flex:1 }}>
                <div className="skeleton" style={{ height:12, width:'55%', borderRadius:6, marginBottom:6 }} />
                <div className="skeleton" style={{ height:10, width:'35%', borderRadius:6 }} />
              </div>
            </div>
          )}
          {!loading && preview && preview !== 'not_found' && preview !== 'offline' && (
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, padding:'12px 14px', background:'rgba(16,185,129,0.06)', border:'1.5px solid rgba(16,185,129,0.25)', borderRadius:12, marginBottom:12 }}>
              <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                <div style={{ width:40, height:40, borderRadius:11, flexShrink:0, background:getAvatarColor(preview.shareKey), display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontWeight:800, fontSize:15 }}>
                  {getInitials(preview.name)}
                </div>
                <div>
                  <div style={{ fontWeight:700, fontSize:14, color:'var(--text-primary)' }}>{preview.name}</div>
                  <div style={{ fontSize:11, color:'#10b981', display:'flex', alignItems:'center', gap:4 }}><IconCheck size={12}/> Βρέθηκε!</div>
                </div>
              </div>
              <button onClick={() => handleAdd()} style={{ background:'#10b981', color:'#fff', border:'none', borderRadius:9, padding:'8px 14px', fontWeight:700, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:5 }}>
                <IconPlus size={14}/> Προσθήκη
              </button>
            </div>
          )}
          {!loading && preview === 'not_found' && (
            <div style={{ padding:'10px 14px', background:'rgba(239,68,68,0.06)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:11, fontSize:13, color:'#ef4444', marginBottom:12, display:'flex', alignItems:'center', gap:6 }}>
              <IconAlertTriangle size={14}/> Δεν βρέθηκε χρήστης με αυτό το Share Key
            </div>
          )}
          {!loading && preview === 'offline' && (
            <div style={{ padding:'10px 14px', background:'rgba(245,158,11,0.06)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:11, fontSize:13, color:'#f59e0b', marginBottom:12, display:'flex', alignItems:'center', gap:6 }}>
              <IconWifi size={14}/> Offline — θα προστεθεί χωρίς όνομα
            </div>
          )}

          {/* Main Add button (when no preview yet) */}
          {!preview && (
            <button onClick={() => handleAdd()} disabled={!key.trim() || loading} style={{ width:'100%', padding:'12px', background: key.trim()?'linear-gradient(135deg,#6366f1,#8b5cf6)':'var(--bg-surface)', color:key.trim()?'#fff':'var(--text-secondary)', border:'none', borderRadius:11, fontWeight:700, fontSize:14, cursor:key.trim()?'pointer':'not-allowed', display:'flex', alignItems:'center', justifyContent:'center', gap:7, transition:'all 0.2s' }}>
              <IconUsers size={16}/> Προσθήκη Φίλου
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Friends Panel (slide-in από δεξιά) ──────────────────────────────────────
function FriendsPanel({ friends, myShareKey, onCopyKey, onAddFriend, onRemoveFriend, onClose }) {
  return (
    <div className="friends-popup-card">
      <div className="friends-popup-header">
        <div>
          <p className="friends-popup-kicker">Κοινό Καλάθι</p>
          <h3 className="friends-popup-title">Φίλοι & shared carts</h3>
          <p className="friends-popup-subtitle">{friends.length} συνδεδεμένοι φίλοι</p>
        </div>
        <button className="friends-popup-close" onClick={onClose} aria-label="Κλείσιμο">✕</button>
      </div>

      <div className="friends-popup-share">
        <div className="friends-popup-share-label">Το Share Key μου</div>
        <div className="friends-popup-share-row">
          <div className="friends-popup-share-code">{myShareKey || '—'}</div>
          <button className="friends-popup-copy" onClick={onCopyKey}>📋</button>
        </div>
        <div className="friends-popup-share-note">Στείλε τον κωδικό σου και σύνδεσε τα καλάθια σας.</div>
      </div>

      <div className="friends-popup-list">
        {friends.length === 0 ? (
          <div className="friends-empty-state">
            <div className="friends-empty-icon">👥</div>
            <div className="friends-empty-title">Δεν έχεις φίλους ακόμα</div>
            <div className="friends-empty-copy">Πρόσθεσε το πρώτο share key για να ξεκινήσει το κοινό καλάθι.</div>
          </div>
        ) : (
          friends.map(friend => (
            <div key={friend.shareKey} className="friends-popup-item">
              <div
                className="friends-popup-avatar"
                style={{
                  background: getAvatarColor(friend.shareKey),
                  boxShadow: `0 12px 24px ${getAvatarColor(friend.shareKey)}33`,
                }}
              >
                {getInitials(friend.username)}
              </div>
              <div className="friends-popup-meta">
                <div className="friends-popup-name">{friend.username}</div>
                <div className="friends-popup-key">#{friend.shareKey}</div>
              </div>
              <button
                className="friends-popup-remove"
                onClick={() => onRemoveFriend(friend.shareKey)}
                title="Αφαίρεση"
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      <div className="friends-popup-footer">
        <button className="friends-popup-add" onClick={onAddFriend}>
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

function PremiumModal({ isOpen, onClose, user }) {
  const [selectedPlan, setSelectedPlan] = useState('yearly');
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState('');
  if (!isOpen) return null;

  const onTrial = user?.isOnTrial;
  const trialDays = user?.trialDaysLeft || 0;

  const plans = [
    { id: 'monthly',  price: '0,99€',  period: '/μήνα',     badge: null,              saving: null },
    { id: 'yearly',   price: '7,99€',  period: '/χρόνο',    badge: '🔥 Δημοφιλές',    saving: 'Εξοικονόμηση 4€' },
    { id: 'lifetime', price: '14,99€', period: ' μία φορά', badge: '⭐ Early Bird',    saving: 'Για πάντα!' },
  ];

  const features = [
    { icon:'📋', text:'Έως 10 αποθηκευμένες λίστες (αντί 2)' },
    { icon:'🤖', text:'Εβδομαδιαίο AI Πλάνο Διατροφής' },
    { icon:'🤝', text:'Κοινό καλάθι με απεριόριστους φίλους' },
    { icon:'📊', text:'Ιστορικό αγορών & στατιστικά budget' },
    { icon:'🗺️', text:'Χάρτης — Έξυπνη διαδρομή αγορών' },
    { icon:'🔔', text:'Push notifications για φίλους & προσφορές' },
    { icon:'📷', text:'Barcode scanner χωρίς διαφημίσεις' },
    { icon:'⭐', text:'Προτεραιότητα στη νέα ύλη & features' },
  ];

  const handleCheckout = async () => {
    setCheckoutLoading(true);
    setCheckoutError('');
    try {
      const token = localStorage.getItem('smart_grocery_token');
      if (!token) { setCheckoutError('Πρέπει να συνδεθείς πρώτα.'); return; }
      const res = await fetch(`${API_BASE}/api/stripe/create-checkout-session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ plan: selectedPlan }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Σφάλμα');
      if (data.url) window.location.href = data.url;
    } catch (e) {
      setCheckoutError(e.message);
    } finally {
      setCheckoutLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-content" style={{ maxWidth:440, padding:0, overflow:'hidden', maxHeight:'92vh', overflowY:'auto' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{
          background: onTrial
            ? 'linear-gradient(135deg,#059669,#10b981,#6366f1)'
            : 'linear-gradient(135deg,#7c3aed,#a855f7,#6366f1)',
          padding:'24px 24px 20px', textAlign:'center', position:'relative',
        }}>
          <button onClick={onClose} style={{ position:'absolute', top:12, right:12, background:'rgba(255,255,255,0.15)', border:'none', borderRadius:8, width:28, height:28, cursor:'pointer', color:'#fff', display:'flex', alignItems:'center', justifyContent:'center' }}>✕</button>
          <div style={{ fontSize:40, marginBottom:8 }}>{onTrial ? '🎁' : '⭐'}</div>
          {onTrial ? (
            <>
              <h2 style={{ margin:0, color:'#fff', fontSize:20, fontWeight:900 }}>Απολαμβάνεις Free Trial!</h2>
              <p style={{ margin:'6px 0 0', color:'rgba(255,255,255,0.9)', fontSize:13 }}>
                Απομένουν <strong>{trialDays} ημέρες</strong> — μετά χρειάζεσαι Premium για να συνεχίσεις
              </p>
            </>
          ) : (
            <>
              <h2 style={{ margin:0, color:'#fff', fontSize:22, fontWeight:900 }}>Καλαθάκι Premium</h2>
              <p style={{ margin:'6px 0 0', color:'rgba(255,255,255,0.85)', fontSize:13 }}>Ξεκλείδωσε όλες τις δυνατότητες</p>
            </>
          )}
        </div>

        <div style={{ padding:'20px 24px' }}>
          {/* Plan selection — 3 cards */}
          <div style={{ display:'flex', gap:8, marginBottom:20 }}>
            {plans.map(p => {
              const active = selectedPlan === p.id;
              return (
                <div key={p.id} onClick={() => setSelectedPlan(p.id)}
                  style={{
                    flex:1, padding:'14px 8px', borderRadius:14, textAlign:'center', cursor:'pointer',
                    border: `2px solid ${active ? '#7c3aed' : 'var(--border)'}`,
                    background: active ? 'rgba(124,58,237,0.08)' : 'var(--bg-surface)',
                    transition: 'all 0.2s', position:'relative',
                  }}>
                  {p.badge && (
                    <div style={{ position:'absolute', top:-8, left:'50%', transform:'translateX(-50%)', background: p.id === 'yearly' ? 'linear-gradient(135deg,#7c3aed,#a855f7)' : '#10b981', color:'#fff', fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:99, whiteSpace:'nowrap' }}>
                      {p.badge}
                    </div>
                  )}
                  <div style={{ fontSize:20, fontWeight:900, color: active ? '#7c3aed' : 'var(--text-primary)', marginTop: p.badge ? 4 : 0 }}>{p.price}</div>
                  <div style={{ fontSize:11, color:'var(--text-secondary)', fontWeight:600 }}>{p.period}</div>
                  {p.saving && <div style={{ fontSize:10, color:'#10b981', fontWeight:700, marginTop:4 }}>{p.saving}</div>}
                </div>
              );
            })}
          </div>

          {/* Features */}
          <div style={{ display:'flex', flexDirection:'column', gap:7, marginBottom:20 }}>
            {features.map(f => (
              <div key={f.text} style={{ display:'flex', alignItems:'center', gap:10, fontSize:13 }}>
                <span style={{ width:24, textAlign:'center', flexShrink:0 }}>{f.icon}</span>
                <span style={{ color:'var(--text-primary)' }}>{f.text}</span>
                <span style={{ marginLeft:'auto', color:'#10b981', fontWeight:800, flexShrink:0 }}>✓</span>
              </div>
            ))}
          </div>

          {/* Error */}
          {checkoutError && (
            <div style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:10, padding:'10px 12px', marginBottom:12, fontSize:12, color:'#ef4444', fontWeight:600 }}>
              {checkoutError}
            </div>
          )}

          {/* CTA — distinct premium box */}
          <div style={{
            background:'linear-gradient(135deg,rgba(124,58,237,0.08),rgba(168,85,247,0.05))',
            border:'1.5px solid rgba(124,58,237,0.25)',
            borderRadius:18, padding:'18px 20px 14px', marginTop:4,
          }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, marginBottom:12 }}>
              <div style={{ height:1, flex:1, background:'linear-gradient(90deg,transparent,rgba(124,58,237,0.25))' }}/>
              <span style={{ fontSize:11, fontWeight:700, color:'rgba(167,139,250,0.7)', letterSpacing:1, textTransform:'uppercase' }}>Ξεκίνα τώρα</span>
              <div style={{ height:1, flex:1, background:'linear-gradient(90deg,rgba(124,58,237,0.25),transparent)' }}/>
            </div>
            <button
              onClick={handleCheckout}
              disabled={checkoutLoading}
              style={{
                width:'100%', padding:'16px 0', borderRadius:14, border:'none', cursor: checkoutLoading ? 'wait' : 'pointer',
                background: checkoutLoading ? 'var(--bg-surface)' : 'linear-gradient(135deg,#7c3aed 0%,#a855f7 60%,#6366f1 100%)',
                color: checkoutLoading ? 'var(--text-secondary)' : '#fff', fontWeight:900, fontSize:17,
                boxShadow: checkoutLoading ? 'none' : '0 6px 28px rgba(124,58,237,0.45), inset 0 1px 0 rgba(255,255,255,0.15)',
                transition:'transform 0.18s, box-shadow 0.18s', display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                letterSpacing:0.2,
              }}
              onMouseEnter={e => { if (!checkoutLoading) { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 10px 36px rgba(124,58,237,0.55), inset 0 1px 0 rgba(255,255,255,0.18)'; } }}
              onMouseLeave={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow= checkoutLoading ? 'none' : '0 6px 28px rgba(124,58,237,0.45), inset 0 1px 0 rgba(255,255,255,0.15)'; }}
            >
              {checkoutLoading ? (
                <><div style={{ width:18, height:18, border:'2.5px solid rgba(124,58,237,0.3)', borderTopColor:'#7c3aed', borderRadius:'50%', animation:'spin 0.85s linear infinite' }}/> Μεταφορά στο Stripe...</>
              ) : (
                <>🚀 Ξεκίνα το Premium</>
              )}
            </button>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:10, marginTop:10 }}>
              <span style={{ fontSize:10, color:'var(--text-muted)', display:'flex', alignItems:'center', gap:3 }}>🔒 Stripe</span>
              <span style={{ width:3, height:3, borderRadius:'50%', background:'var(--border-strong)' }}/>
              <span style={{ fontSize:10, color:'var(--text-muted)' }}>Ακύρωση ανά πάσα στιγμή</span>
              <span style={{ width:3, height:3, borderRadius:'50%', background:'var(--border-strong)' }}/>
              <span style={{ fontSize:10, color:'var(--text-muted)' }}>256-bit SSL</span>
            </div>
          </div>
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
        <h2 className="welcome-title">Καλώς ήρθες στο<br /><span>Έξυπνο Καλαθάκι</span></h2>
        <p className="welcome-subtitle">Ψώνια χωρίς άγχος — σύγκριση τιμών, συνταγές, κοινό καλάθι με φίλους.</p>
        <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:'linear-gradient(135deg,rgba(16,185,129,0.12),rgba(5,150,105,0.08))', border:'1.5px solid rgba(16,185,129,0.3)', borderRadius:99, padding:'6px 14px', marginBottom:12, fontSize:12, fontWeight:700, color:'#10b981' }}>
          🎁 14 ημέρες δωρεάν Premium για νέους χρήστες
        </div>
        <div className="welcome-features">
          {[
            { icon:'💰', title:'Σύγκριση Τιμών',       sub:'Βρες το φθηνότερο σε ΑΒ, Σκλαβενίτη, MyMarket και άλλα!', locked:false },
            { icon:'🍽️', title:'Συνταγές & Μακροστοιχεία', sub:'Υλικά απευθείας στη λίστα, θερμίδες & πρωτεΐνη', locked:true },
            { icon:'🤝', title:'Κοινό Καλάθι',         sub:'Μοιράσου τη λίστα με φίλους σε πραγματικό χρόνο', locked:true },
            { icon:'🤖', title:'AI Πλάνο Διατροφής',   sub:'Εβδομαδιαίο πλάνο διατροφής με AI', locked:true },
            { icon:'📷', title:'Σαρωτής Barcodes',      sub:'Σάρωσε για τιμή, θερμίδες & αλλεργιογόνα', locked:true },
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
  const isDone = progress === total && total > 0;
  return (
    <div className="modal-overlay" style={{ backdropFilter:'blur(8px)' }}>
      <div style={{
        background:'var(--bg-card)', border:'1px solid var(--border-light)', borderRadius:24,
        padding:'32px 28px', maxWidth:360, width:'90vw', textAlign:'center',
        boxShadow:'0 24px 80px rgba(0,0,0,0.4)', animation:'fadeInScale 0.3s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
        <div style={{
          width:72, height:72, borderRadius:'50%', margin:'0 auto 20px',
          background:'linear-gradient(135deg,rgba(124,58,237,0.15),rgba(167,139,250,0.15))',
          border:'2px solid rgba(167,139,250,0.3)',
          display:'flex', alignItems:'center', justifyContent:'center', fontSize:32,
          animation: isDone ? 'none' : 'pulse 1.5s ease-in-out infinite',
        }}>
          {isDone ? '✅' : '🛒'}
        </div>
        <h3 style={{ margin:'0 0 4px', fontSize:17, fontWeight:800, color:'var(--text-primary)' }}>
          {isDone ? 'Ολοκληρώθηκε!' : 'Αναζήτηση Τιμών'}
        </h3>
        <p style={{ fontSize:12, color:'var(--text-secondary)', margin:'0 0 20px', lineHeight:1.5, maxWidth:260, marginInline:'auto' }}>
          {isDone
            ? `${total} υλικά από "${recipeName}" προστέθηκαν στη λίστα σου`
            : `Βρίσκω τις καλύτερες τιμές για τα υλικά του "${recipeName}"...`}
        </p>
        <div style={{ height:8, background:'var(--bg-subtle)', borderRadius:99, overflow:'hidden', marginBottom:10, position:'relative' }}>
          <div style={{
            height:'100%', width:`${pct}%`, borderRadius:99,
            background: isDone ? 'linear-gradient(90deg,#10b981,#34d399)' : 'linear-gradient(90deg,#7c3aed,#a78bfa,#7c3aed)',
            backgroundSize:'200% 100%',
            transition:'width 0.5s cubic-bezier(0.34,1.56,0.64,1)',
            animation: isDone ? 'none' : 'shimmerSlide 1.5s linear infinite',
          }} />
        </div>
        <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom: isDone ? 20 : 0, display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
          {!isDone && <span style={{ width:10, height:10, borderRadius:'50%', border:'2px solid #a78bfa', borderTopColor:'transparent', display:'inline-block', animation:'spin 0.7s linear infinite' }} />}
          <span>{isDone ? `✓ ${total}/${total} υλικά` : `${progress}/${total} υλικά (${pct}%)`}</span>
        </div>
        {isDone && (
          <button
            onClick={onClose}
            style={{
              width:'100%', padding:'13px', borderRadius:14, border:'none',
              background:'linear-gradient(135deg,#10b981,#059669)', color:'#fff',
              fontWeight:800, fontSize:14, cursor:'pointer', fontFamily:'var(--font)',
              boxShadow:'0 4px 16px rgba(16,185,129,0.35)',
            }}
          >
            Πήγαινε στη Λίστα →
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Allergen Database ────────────────────────────────────────────────────────
const ALLERGEN_LIST = [
  { id:'en:gluten',       label:'Γλουτένη',       icon:'🌾' },
  { id:'en:milk',         label:'Γάλα / Λακτόζη', icon:'🥛' },
  { id:'en:eggs',         label:'Αυγά',           icon:'🥚' },
  { id:'en:nuts',         label:'Ξηροί Καρποί',   icon:'🥜' },
  { id:'en:peanuts',      label:'Φιστίκια',       icon:'🫘' },
  { id:'en:soybeans',     label:'Σόγια',          icon:'🫛' },
  { id:'en:fish',         label:'Ψάρι',           icon:'🐟' },
  { id:'en:crustaceans',  label:'Καρκινοειδή',    icon:'🦐' },
  { id:'en:molluscs',     label:'Μαλάκια',        icon:'🐚' },
  { id:'en:celery',       label:'Σέλερι',         icon:'🥬' },
  { id:'en:mustard',      label:'Μουστάρδα',      icon:'🟡' },
  { id:'en:sesame-seeds', label:'Σουσάμι',        icon:'🟤' },
  { id:'en:sulphur-dioxide', label:'Θειώδη',      icon:'⚗️' },
  { id:'en:lupin',        label:'Λούπινα',        icon:'🌿' },
];

const getNutriScoreColor = (grade) => {
  const c = { a:'#1e8f4e', b:'#60ac0e', c:'#eeae0e', d:'#e67e22', e:'#e63e11' };
  return c[grade] || '#94a3b8';
};

const getNutrientLevel = (val, type) => {
  const thresholds = {
    fat:      { low:3,   high:17.5 },
    saturated:{ low:1.5, high:5 },
    sugars:   { low:5,   high:12.5 },
    salt:     { low:0.3, high:1.5 },
  };
  const t = thresholds[type];
  if (!t) return 'unknown';
  if (val <= t.low) return 'low';
  if (val >= t.high) return 'high';
  return 'moderate';
};

// ─── Additive / Ingredient Info Database ──────────────────────────────────────
const ADDITIVE_DB = {
  'E100': { name:'Κουρκουμίνη', safety:'ok', desc:'Φυσική χρωστική από κουρκούμα. Θεωρείται ασφαλής.' },
  'E101': { name:'Ριβοφλαβίνη (Β2)', safety:'ok', desc:'Βιταμίνη Β2 που χρησιμοποιείται ως χρωστική. Φυσική και ασφαλής.' },
  'E102': { name:'Ταρτραζίνη', safety:'caution', desc:'Τεχνητή κίτρινη χρωστική. Μπορεί να προκαλέσει αλλεργίες σε ευαίσθητα άτομα.' },
  'E110': { name:'Κίτρινο Ηλιοβασιλέματος', safety:'caution', desc:'Τεχνητή χρωστική. Συνδέεται με υπερκινητικότητα σε παιδιά.' },
  'E120': { name:'Κοχενίλλη (E120)', safety:'caution', desc:'Κόκκινη χρωστική από έντομα. Μπορεί να προκαλέσει αλλεργίες.' },
  'E122': { name:'Αζορουμπίνη', safety:'caution', desc:'Τεχνητή κόκκινη χρωστική. Αποφύγετε σε παιδιά.' },
  'E124': { name:'Ερυθρό Πονσό 4R', safety:'caution', desc:'Τεχνητή χρωστική. Συνδέεται με υπερκινητικότητα.' },
  'E129': { name:'Ερυθρό Allura AC', safety:'caution', desc:'Τεχνητή κόκκινη χρωστική. Αμφιλεγόμενη χρήση σε παιδιά.' },
  'E200': { name:'Σορβικό οξύ', safety:'ok', desc:'Φυσικό συντηρητικό. Γενικά ασφαλές.' },
  'E202': { name:'Σορβικό κάλιο', safety:'ok', desc:'Κοινό συντηρητικό για τυριά και κρασί. Ασφαλές.' },
  'E210': { name:'Βενζοϊκό οξύ', safety:'caution', desc:'Συντηρητικό. Σε συνδυασμό με βιταμίνη C μπορεί να σχηματίσει βενζόλιο.' },
  'E211': { name:'Βενζοϊκό νάτριο', safety:'caution', desc:'Κοινό συντηρητικό. Αποφύγετε σε συνδυασμό με ασκορβικό οξύ.' },
  'E220': { name:'Διοξείδιο θείου (SO2)', safety:'caution', desc:'Συντηρητικό σε κρασί & αποξηραμένα φρούτα. Μπορεί να προκαλέσει άσθμα.' },
  'E250': { name:'Νιτρώδες νάτριο', safety:'bad', desc:'Χρησιμοποιείται σε αλλαντικά. Σε υψηλές θερμοκρασίες σχηματίζει νιτροζαμίνες (καρκινογόνα).' },
  'E251': { name:'Νιτρικό νάτριο', safety:'bad', desc:'Συντηρητικό σε επεξεργασμένα κρέατα. Αμφιλεγόμενο για υγεία.' },
  'E270': { name:'Γαλακτικό οξύ', safety:'ok', desc:'Φυσικό οξύ από ζύμωση. Πολύ ασφαλές.' },
  'E300': { name:'Ασκορβικό οξύ (Vit.C)', safety:'ok', desc:'Βιταμίνη C ως αντιοξειδωτικό. Εξαιρετικά ασφαλές.' },
  'E306': { name:'Τοκοφερόλη (Vit.E)', safety:'ok', desc:'Φυσικό αντιοξειδωτικό. Ασφαλές.' },
  'E320': { name:'BHA', safety:'bad', desc:'Τεχνητό αντιοξειδωτικό. Πιθανώς καρκινογόνο σε μεγάλες δόσεις.' },
  'E321': { name:'BHT', safety:'caution', desc:'Τεχνητό αντιοξειδωτικό. Αμφιλεγόμενο.' },
  'E330': { name:'Κιτρικό οξύ', safety:'ok', desc:'Φυσικό οξύ. Πολύ κοινό και ασφαλές.' },
  'E407': { name:'Καραγενάνη', safety:'caution', desc:'Πηκτικό από θαλάσσια φύκια. Μπορεί να προκαλέσει φλεγμονή.' },
  'E420': { name:'Σορβιτόλη', safety:'ok', desc:'Φυσικό γλυκαντικό. Ασφαλές, αλλά μπορεί να προκαλέσει πεπτικά σε μεγάλες ποσότητες.' },
  'E421': { name:'Μαννιτόλη', safety:'ok', desc:'Φυσικό γλυκαντικό. Γενικά ασφαλές.' },
  'E450': { name:'Διφωσφορικά', safety:'caution', desc:'Χρησιμοποιείται ως διογκωτικό. Υψηλή πρόσληψη φωσφόρου σχετίζεται με οστεοπόρωση.' },
  'E471': { name:'Μονογλυκερίδια', safety:'ok', desc:'Γαλακτωματοποιητής από λίπος. Γενικά ασφαλής.' },
  'E472': { name:'Εστέρες μονογλυκεριδίων', safety:'ok', desc:'Γαλακτωματοποιητής. Ασφαλής.' },
  'E476': { name:'Πολυγλυκερόλη', safety:'ok', desc:'Γαλακτωματοποιητής σε σοκολάτα. Ασφαλής.' },
  'E500': { name:'Ανθρακικά άλατα νατρίου', safety:'ok', desc:'Κοινό διογκωτικό. Πλήρως ασφαλές.' },
  'E621': { name:'Γλουταμινικό μονονάτριο (MSG)', safety:'caution', desc:'Ενισχυτικό γεύσης. Ασφαλές για τους περισσότερους, αλλά μπορεί να προκαλέσει ευαισθησία.' },
  'E950': { name:'Ακεσουλφάμη Κ', safety:'caution', desc:'Τεχνητό γλυκαντικό. Αμφιλεγόμενο - μελέτες σε πειραματόζωα έδειξαν ανησυχίες.' },
  'E951': { name:'Ασπαρτάμη', safety:'caution', desc:'Τεχνητό γλυκαντικό. Αποφύγετε αν έχετε φαινυλκετονουρία.' },
  'E954': { name:'Σακχαρίνη', safety:'caution', desc:'Τεχνητό γλυκαντικό. Παλαιότερα θεωρήθηκε επικίνδυνη - σήμερα εγκεκριμένη.' },
  'E955': { name:'Σουκραλόζη', safety:'ok', desc:'Τεχνητό γλυκαντικό από ζάχαρη. Γενικά ασφαλές.' },
};

const getAdditiveInfo = (code) => {
  const clean = code.replace(/[^A-Z0-9]/g, '');
  return ADDITIVE_DB[clean] || { name: code, safety:'unknown', desc:'Δεν υπάρχουν αρκετές πληροφορίες για αυτό το πρόσθετο.' };
};

// ─── Ingredient Detail Modal (for tapping warnings/additives) ─────────────────
function IngredientDetailModal({ item, onClose }) {
  if (!item) return null;
  const safetyColors = {
    ok:      { bg:'rgba(34,197,94,0.08)',  border:'rgba(34,197,94,0.3)',  color:'#22c55e', label:'Ασφαλές' },
    caution: { bg:'rgba(245,158,11,0.08)', border:'rgba(245,158,11,0.3)', color:'#f59e0b', label:'Προσοχή' },
    bad:     { bg:'rgba(239,68,68,0.08)',  border:'rgba(239,68,68,0.3)',  color:'#ef4444', label:'Αποφύγετε' },
    unknown: { bg:'rgba(148,163,184,0.08)',border:'rgba(148,163,184,0.3)',color:'#94a3b8', label:'Άγνωστο' },
  };
  const c = safetyColors[item.safety] || safetyColors.unknown;

  return createPortal(
    <div className="modal-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()} style={{ zIndex:110000 }}>
      <div className="modal-content" style={{ maxWidth:340, animation:'popIn 0.4s cubic-bezier(0.34,1.56,0.64,1) both' }} onClick={e => e.stopPropagation()}>
        <button className="close-btn" onClick={onClose}>✕</button>
        <div style={{ textAlign:'center', padding:'8px 0 16px' }}>
          <div style={{ fontSize:40, marginBottom:8 }}>🧪</div>
          <div style={{
            display:'inline-block', padding:'4px 14px', borderRadius:99,
            background: c.bg, border:`1px solid ${c.border}`, color: c.color,
            fontSize:11, fontWeight:800, letterSpacing:0.5, marginBottom:12
          }}>{c.label}</div>
          <h3 style={{ margin:'0 0 6px', fontSize:17, fontWeight:800, color:'var(--text-primary)' }}>{item.name}</h3>
          {item.code && <div style={{ fontSize:12, color:'var(--text-muted)', fontWeight:700, marginBottom:12 }}>{item.code}</div>}
          <p style={{ fontSize:14, color:'var(--text-secondary)', lineHeight:1.6, margin:0 }}>{item.desc}</p>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── Scanner Onboarding Modal (first-time use) ───────────────────────────────
function ScannerOnboardingModal({ onComplete }) {
  const [step, setStep]           = useState(0);
  const [direction, setDirection] = useState('forward');

  const goTo = (newStep) => {
    setDirection(newStep > step ? 'forward' : 'backward');
    setStep(newStep);
  };
  const goNext = () => { if (step < 2) goTo(step + 1); else onComplete(); };
  const goPrev = () => { if (step > 0) goTo(step - 1); };

  const steps = [
    {
      icon: '📷',
      tag: 'Σάρωση',
      title: 'Σκάναρε οποιοδήποτε προϊόν',
      desc: 'Στόχευσε το barcode με την κάμερα και η αναγνώριση γίνεται αυτόματα — χωρίς να πατήσεις τίποτα.',
      features: [
        { icon: '⚡', text: 'Αυτόματη αναγνώριση barcode' },
        { icon: '🌍', text: 'Βάση δεδομένων 3M+ προϊόντων' },
        { icon: '🇬🇷', text: 'Υποστήριξη ελληνικών προϊόντων' },
      ],
      svg: (
        <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width:'100%', maxWidth:210, height:158 }}>
          {/* Phone outline */}
          <rect x="65" y="10" width="70" height="120" rx="12" fill="#1e1b4b" stroke="#6366f1" strokeWidth="2"/>
          <rect x="72" y="22" width="56" height="80" rx="6" fill="#0f0f1a"/>
          {/* Barcode lines */}
          <rect x="80" y="36" width="4" height="50" fill="#22c55e" opacity="0.9"/>
          <rect x="87" y="36" width="2" height="50" fill="#22c55e" opacity="0.9"/>
          <rect x="92" y="36" width="6" height="50" fill="#22c55e" opacity="0.9"/>
          <rect x="101" y="36" width="3" height="50" fill="#22c55e" opacity="0.9"/>
          <rect x="107" y="36" width="5" height="50" fill="#22c55e" opacity="0.9"/>
          <rect x="115" y="36" width="2" height="50" fill="#22c55e" opacity="0.9"/>
          <rect x="120" y="36" width="4" height="50" fill="#22c55e" opacity="0.9"/>
          {/* Scan line animation */}
          <rect x="76" y="60" width="48" height="2" rx="1" fill="#22c55e">
            <animateTransform attributeName="transform" type="translate" values="0,0;0,-20;0,20;0,0" dur="2.5s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="1;0.3;1" dur="2.5s" repeatCount="indefinite"/>
          </rect>
          {/* Phone button */}
          <rect x="92" y="125" width="16" height="4" rx="2" fill="#6366f1" opacity="0.6"/>
          {/* Tap hand */}
          <g style={{ animation:'floatHand 2s ease-in-out infinite' }}>
            <ellipse cx="155" cy="115" rx="12" ry="12" fill="#fbbf24" opacity="0.9"/>
            <rect x="151" y="92" width="5" height="22" rx="2.5" fill="#fbbf24"/>
            <rect x="157" y="96" width="4" height="18" rx="2" fill="#fbbf24"/>
            <rect x="162" y="99" width="4" height="15" rx="2" fill="#fbbf24"/>
            <rect x="145" y="98" width="4" height="16" rx="2" fill="#fbbf24"/>
          </g>
          {/* Signal rings around tap */}
          <circle cx="155" cy="115" r="18" stroke="#6366f1" strokeWidth="1.5" opacity="0.4">
            <animate attributeName="r" values="16;24;16" dur="1.8s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0.5;0;0.5" dur="1.8s" repeatCount="indefinite"/>
          </circle>
        </svg>
      ),
    },
    {
      icon: '🎯',
      tag: 'Διατροφή',
      title: 'Κεντράρισε στο πράσινο πλαίσιο',
      desc: 'Κράτησε το κινητό σταθερό και βάλε το barcode μέσα στο πράσινο πλαίσιο. Η αναγνώριση γίνεται αμέσως!',
      features: [
        { icon: '📊', text: 'Θερμίδες & μακροθρεπτικά' },
        { icon: '🔴', text: 'Προειδοποιήσεις ζάχαρης/αλατιού' },
        { icon: '🌱', text: 'Vegan & vegetarian ένδειξη' },
      ],
      svg: (
        <svg viewBox="0 0 200 160" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width:'100%', maxWidth:210, height:158 }}>
          {/* Camera view background */}
          <rect x="20" y="15" width="160" height="130" rx="16" fill="#0a0a14"/>
          {/* Barcode in center */}
          <rect x="68" y="55" width="4" height="50" fill="#fff" opacity="0.85"/>
          <rect x="75" y="55" width="2" height="50" fill="#fff" opacity="0.85"/>
          <rect x="80" y="55" width="5" height="50" fill="#fff" opacity="0.85"/>
          <rect x="88" y="55" width="3" height="50" fill="#fff" opacity="0.85"/>
          <rect x="94" y="55" width="6" height="50" fill="#fff" opacity="0.85"/>
          <rect x="103" y="55" width="2" height="50" fill="#fff" opacity="0.85"/>
          <rect x="108" y="55" width="4" height="50" fill="#fff" opacity="0.85"/>
          <rect x="115" y="55" width="5" height="50" fill="#fff" opacity="0.85"/>
          <rect x="123" y="55" width="3" height="50" fill="#fff" opacity="0.85"/>
          {/* Green frame corners - animated */}
          <path d="M52 55 L52 42 L65 42" stroke="#22c55e" strokeWidth="3" strokeLinecap="round">
            <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite"/>
          </path>
          <path d="M148 55 L148 42 L135 42" stroke="#22c55e" strokeWidth="3" strokeLinecap="round">
            <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" begin="0.3s"/>
          </path>
          <path d="M52 105 L52 118 L65 118" stroke="#22c55e" strokeWidth="3" strokeLinecap="round">
            <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" begin="0.6s"/>
          </path>
          <path d="M148 105 L148 118 L135 118" stroke="#22c55e" strokeWidth="3" strokeLinecap="round">
            <animate attributeName="opacity" values="0.5;1;0.5" dur="2s" repeatCount="indefinite" begin="0.9s"/>
          </path>
          {/* Scan line */}
          <rect x="55" y="80" width="90" height="2" rx="1" fill="#22c55e" opacity="0.9">
            <animateTransform attributeName="transform" type="translate" values="0,-28;0,28;0,-28" dur="2s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="1;0.4;1" dur="2s" repeatCount="indefinite"/>
          </rect>
          {/* Check mark appearing */}
          <circle cx="170" cy="25" r="10" fill="#22c55e">
            <animate attributeName="r" values="0;10;10" dur="2s" repeatCount="indefinite"/>
            <animate attributeName="opacity" values="0;0;1;1;0" dur="2s" repeatCount="indefinite"/>
          </circle>
          <path d="M165 25 L168 28 L175 21" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <animate attributeName="opacity" values="0;0;1;1;0" dur="2s" repeatCount="indefinite"/>
          </path>
        </svg>
      ),
    },
    {
      icon: '🛡️',
      tag: 'Αλλεργίες & NOVA',
      title: 'Πλήρης ανάλυση προϊόντος',
      desc: 'Nutri-Score, βαθμολογία NOVA, αλλεργιογόνα, πρόσθετα E-codes και πλήρη λίστα συστατικών.',
      features: [
        { icon: '🏅', text: 'Nutri-Score A έως E' },
        { icon: '⚠️', text: 'Αλλεργιογόνα & E-codes' },
        { icon: '🏭', text: 'Βαθμολογία NOVA επεξεργασίας' },
      ],
      svg: (
        <svg viewBox="0 0 220 172" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ width:'100%', maxWidth:226, height:158 }}>
          <defs>
            <linearGradient id="sc-card" x1="0" y1="0" x2="220" y2="172" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#1e1b4b"/>
              <stop offset="100%" stopColor="#0d0b22"/>
            </linearGradient>
            <linearGradient id="sc-img" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#3730a3"/>
              <stop offset="100%" stopColor="#1e1b4b"/>
            </linearGradient>
            <linearGradient id="sc-border" x1="0" y1="0" x2="220" y2="172" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.7"/>
              <stop offset="60%" stopColor="#4f46e5" stopOpacity="0.3"/>
              <stop offset="100%" stopColor="#312e81" stopOpacity="0.15"/>
            </linearGradient>
            <filter id="sc-shadow" x="-10%" y="-10%" width="120%" height="120%">
              <feDropShadow dx="0" dy="6" stdDeviation="10" floodColor="#6366f1" floodOpacity="0.18"/>
            </filter>
          </defs>

          {/* Card shadow */}
          <rect x="18" y="20" width="184" height="140" rx="20" fill="#6366f1" opacity="0.06" filter="url(#sc-shadow)"/>

          {/* Card body */}
          <rect x="12" y="12" width="196" height="148" rx="20" fill="url(#sc-card)" stroke="url(#sc-border)" strokeWidth="1.4">
            <animate attributeName="opacity" values="0;1" dur="0.5s" fill="freeze"/>
          </rect>
          {/* Top inner glow */}
          <rect x="13" y="12" width="194" height="1.5" rx="0.75" fill="white" opacity="0.07"/>

          {/* Product image box */}
          <rect x="22" y="22" width="44" height="44" rx="12" fill="url(#sc-img)" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.1s"/>
          </rect>
          <rect x="22" y="22" width="44" height="44" rx="12" stroke="#4f46e5" strokeWidth="0.8" strokeOpacity="0.6" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.1s"/>
          </rect>
          <text x="44" y="50" textAnchor="middle" fontSize="22" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.35s" fill="freeze" begin="0.15s"/>
            🥛
          </text>

          {/* Brand label */}
          <rect x="74" y="24" width="44" height="6" rx="3" fill="#6366f1" opacity="0">
            <animate attributeName="opacity" values="0;0.45" dur="0.4s" fill="freeze" begin="0.2s"/>
            <animate attributeName="width" values="0;44" dur="0.5s" fill="freeze" begin="0.2s"/>
          </rect>
          {/* Product name */}
          <rect x="74" y="34" width="96" height="10" rx="5" fill="#c7d2fe" opacity="0">
            <animate attributeName="opacity" values="0;0.85" dur="0.45s" fill="freeze" begin="0.25s"/>
            <animate attributeName="width" values="0;96" dur="0.55s" fill="freeze" begin="0.25s"/>
          </rect>
          {/* Quantity */}
          <rect x="74" y="49" width="36" height="6" rx="3" fill="#6366f1" opacity="0">
            <animate attributeName="opacity" values="0;0.3" dur="0.4s" fill="freeze" begin="0.3s"/>
            <animate attributeName="width" values="0;36" dur="0.45s" fill="freeze" begin="0.3s"/>
          </rect>

          {/* NutriScore pill */}
          <rect x="74" y="58" width="68" height="15" rx="7.5" fill="#22c55e" opacity="0">
            <animate attributeName="opacity" values="0;0.95" dur="0.4s" fill="freeze" begin="0.38s"/>
          </rect>
          <text x="108" y="69" textAnchor="middle" fontSize="8" fill="white" fontWeight="800" letterSpacing="0.4" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.38s"/>
            Nutri-Score  A
          </text>

          {/* Health score badge top-right */}
          <circle cx="193" cy="35" r="17" fill="#0f0c29" stroke="#22c55e" strokeWidth="1.2" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.42s"/>
          </circle>
          <text x="193" y="30" textAnchor="middle" fontSize="6" fill="#86efac" fontWeight="700" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.42s"/>
            NOVA
          </text>
          <text x="193" y="43" textAnchor="middle" fontSize="13" fill="#22c55e" fontWeight="900" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.42s"/>
            1
          </text>

          {/* Divider */}
          <rect x="22" y="84" width="176" height="0.8" fill="#6366f1" opacity="0">
            <animate attributeName="opacity" values="0;0.22" dur="0.5s" fill="freeze" begin="0.44s"/>
            <animate attributeName="width" values="0;176" dur="0.6s" fill="freeze" begin="0.44s"/>
          </rect>

          {/* Macro pill — Calories */}
          <rect x="20" y="92" width="58" height="24" rx="10" fill="#f97316" fillOpacity="0.12" stroke="#f97316" strokeWidth="0.7" strokeOpacity="0.4" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.52s"/>
          </rect>
          <text x="26" y="103" fontSize="9.5" fill="#fb923c" fontWeight="700" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.52s"/>
            🔥 245 kcal
          </text>
          <text x="27" y="113" fontSize="7" fill="#fb923c" opacity="0" fillOpacity="0.6">
            <animate attributeName="opacity" values="0;0.7" dur="0.4s" fill="freeze" begin="0.52s"/>
            Θερμίδες
          </text>

          {/* Macro pill — Protein */}
          <rect x="83" y="92" width="52" height="24" rx="10" fill="#3b82f6" fillOpacity="0.12" stroke="#3b82f6" strokeWidth="0.7" strokeOpacity="0.4" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.6s"/>
          </rect>
          <text x="89" y="103" fontSize="9.5" fill="#60a5fa" fontWeight="700" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.6s"/>
            💪 8g
          </text>
          <text x="90" y="113" fontSize="7" fill="#60a5fa" opacity="0" fillOpacity="0.6">
            <animate attributeName="opacity" values="0;0.7" dur="0.4s" fill="freeze" begin="0.6s"/>
            Πρωτεΐνη
          </text>

          {/* Macro pill — Carbs */}
          <rect x="140" y="92" width="56" height="24" rx="10" fill="#a855f7" fillOpacity="0.12" stroke="#a855f7" strokeWidth="0.7" strokeOpacity="0.4" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.68s"/>
          </rect>
          <text x="146" y="103" fontSize="9.5" fill="#c084fc" fontWeight="700" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.68s"/>
            ⚡ 32g
          </text>
          <text x="147" y="113" fontSize="7" fill="#c084fc" opacity="0" fillOpacity="0.6">
            <animate attributeName="opacity" values="0;0.7" dur="0.4s" fill="freeze" begin="0.68s"/>
            Υδατάνθρακες
          </text>

          {/* Allergen badge */}
          <rect x="20" y="126" width="80" height="16" rx="8" fill="rgba(239,68,68,0.1)" stroke="rgba(239,68,68,0.35)" strokeWidth="0.8" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.76s"/>
          </rect>
          <text x="60" y="137.5" textAnchor="middle" fontSize="8" fill="#f87171" fontWeight="700" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.76s"/>
            ⚠️ Γλουτένη
          </text>

          {/* NOVA label */}
          <rect x="110" y="126" width="86" height="16" rx="8" fill="rgba(34,197,94,0.08)" stroke="rgba(34,197,94,0.3)" strokeWidth="0.8" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.82s"/>
          </rect>
          <text x="153" y="137.5" textAnchor="middle" fontSize="8" fill="#4ade80" fontWeight="700" opacity="0">
            <animate attributeName="opacity" values="0;1" dur="0.4s" fill="freeze" begin="0.82s"/>
            ✅ Χαμηλή επεξεργασία
          </text>

          {/* Sparkles */}
          {[[202, 78], [14, 128], [198, 152]].map(([x, y], i) => (
            <text key={i} x={x} y={y} fontSize="9" fill="#fbbf24" opacity="0">
              <animate attributeName="opacity" values="0;0.6;0" dur="2.5s" repeatCount="indefinite" begin={`${i * 0.8}s`}/>
              ✦
            </text>
          ))}
        </svg>
      ),
    },
  ];

  const current = steps[step];

  return (
    <div style={{
      position:'fixed', inset:0, zIndex:200000,
      background:'rgba(0,0,0,0.9)', backdropFilter:'blur(20px)',
      display:'flex', alignItems:'center', justifyContent:'center', padding:16,
      animation:'fadeIn 0.25s ease both',
    }}>
      <div style={{
        background:'linear-gradient(160deg,#0f0c29 0%,#1a1560 50%,#0c0a1e 100%)',
        border:'1px solid rgba(99,102,241,0.35)',
        borderRadius:28,
        width:'100%', maxWidth:370,
        maxHeight:'calc(100dvh - 32px)',
        boxShadow:'0 40px 100px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.05), inset 0 1px 0 rgba(255,255,255,0.07)',
        position:'relative', overflow:'hidden',
        display:'flex', flexDirection:'column',
        animation:'onboardModalIn 0.6s cubic-bezier(0.16,1,0.3,1) both',
      }}>
        {/* Top glow */}
        <div style={{ position:'absolute', top:-80, left:'50%', transform:'translateX(-50%)', width:260, height:200, background:'radial-gradient(ellipse,rgba(99,102,241,0.18),transparent 70%)', pointerEvents:'none' }}/>

        {/* Skip button */}
        <button onClick={onComplete} style={{
          position:'absolute', top:16, right:16, background:'rgba(255,255,255,0.06)', border:'none',
          color:'rgba(165,180,252,0.6)', fontSize:12, fontWeight:600, cursor:'pointer', padding:'5px 12px',
          borderRadius:20, fontFamily:'var(--font)', letterSpacing:0.3,
          transition:'background 0.2s',
        }}>
          Παράλειψη
        </button>

        {/* Progress bar */}
        <div style={{ height:3, background:'rgba(99,102,241,0.15)', position:'relative' }}>
          <div style={{
            height:'100%', borderRadius:2,
            background:'linear-gradient(90deg,#6366f1,#818cf8)',
            width:`${((step + 1) / steps.length) * 100}%`,
            transition:'width 0.4s cubic-bezier(0.16,1,0.3,1)',
          }}/>
        </div>

        <div key={step} className={`onboard-step-${direction}`} style={{ padding:'24px 24px 28px', overflowY:'auto', flex:1 }}>
          {/* Tag + step */}
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
            <div style={{
              display:'inline-flex', alignItems:'center', gap:6,
              background:'rgba(99,102,241,0.15)', border:'1px solid rgba(99,102,241,0.3)',
              borderRadius:20, padding:'4px 12px', fontSize:11, fontWeight:700,
              color:'#a5b4fc', letterSpacing:0.5,
            }}>
              <span>{current.icon}</span> {current.tag}
            </div>
            <span style={{ fontSize:11, color:'rgba(165,180,252,0.5)', fontWeight:600 }}>
              {step + 1} / {steps.length}
            </span>
          </div>

          {/* Illustration */}
          <div style={{ margin:'0 auto 16px', height:158, display:'flex', alignItems:'center', justifyContent:'center', overflow:'hidden', flexShrink:0, animation:'onboardIllustrationIn 0.5s cubic-bezier(0.16,1,0.3,1) 0.06s both' }}>
            {current.svg}
          </div>

          {/* Title */}
          <h2 style={{ fontSize:18, fontWeight:900, color:'#fff', margin:'0 0 7px', lineHeight:1.3, letterSpacing:-0.3 }}>
            {current.title}
          </h2>

          {/* Description */}
          <p style={{ fontSize:13, color:'rgba(165,180,252,0.82)', lineHeight:1.55, margin:'0 0 14px' }}>
            {current.desc}
          </p>

          {/* Feature highlights */}
          <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:20 }}>
            {current.features.map((f, i) => (
              <div key={i} style={{
                display:'flex', alignItems:'center', gap:10,
                background:'rgba(255,255,255,0.04)', borderRadius:12,
                padding:'8px 12px', border:'1px solid rgba(255,255,255,0.06)',
                animation:`onboardFeatureIn 0.45s cubic-bezier(0.16,1,0.3,1) ${0.12 + i * 0.09}s both`,
              }}>
                <span style={{ fontSize:15, flexShrink:0 }}>{f.icon}</span>
                <span style={{ fontSize:12.5, color:'rgba(255,255,255,0.78)', fontWeight:500, lineHeight:1.35 }}>{f.text}</span>
              </div>
            ))}
          </div>

          {/* Step dots */}
          <div style={{ display:'flex', justifyContent:'center', gap:6, marginBottom:16 }}>
            {steps.map((_, i) => (
              <div key={i} onClick={() => goTo(i)} style={{
                width: i === step ? 22 : 7, height:7, borderRadius:4,
                background: i <= step ? '#6366f1' : 'rgba(99,102,241,0.25)',
                transition:'all 0.38s cubic-bezier(0.34,1.56,0.64,1)',
                cursor:'pointer',
              }}/>
            ))}
          </div>

          {/* Buttons */}
          <div style={{ display:'flex', gap:8 }}>
            {step > 0 && (
              <button onClick={goPrev} style={{
                padding:'13px 18px', borderRadius:14,
                border:'1px solid rgba(99,102,241,0.35)', background:'rgba(99,102,241,0.08)',
                color:'#a5b4fc', fontWeight:700, fontSize:14, cursor:'pointer', fontFamily:'var(--font)',
                transition:'background 0.2s, transform 0.15s',
              }}
              onMouseDown={e=>e.currentTarget.style.transform='scale(0.96)'}
              onMouseUp={e=>e.currentTarget.style.transform=''}
              onTouchStart={e=>e.currentTarget.style.transform='scale(0.96)'}
              onTouchEnd={e=>e.currentTarget.style.transform=''}
              >
                ←
              </button>
            )}
            <button
              onClick={goNext}
              style={{
                flex:1, padding:'13px', borderRadius:14, border:'none',
                background:'linear-gradient(135deg,#6366f1,#4f46e5)',
                color:'#fff', fontWeight:800, fontSize:14, cursor:'pointer', fontFamily:'var(--font)',
                boxShadow:'0 6px 22px rgba(99,102,241,0.5)',
                transition:'transform 0.15s, box-shadow 0.15s',
              }}
              onMouseDown={e => { e.currentTarget.style.transform='scale(0.97)'; e.currentTarget.style.boxShadow='0 2px 10px rgba(99,102,241,0.35)'; }}
              onMouseUp={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}
              onTouchStart={e => { e.currentTarget.style.transform='scale(0.97)'; }}
              onTouchEnd={e => { e.currentTarget.style.transform=''; }}
            >
              {step < steps.length - 1 ? 'Επόμενο →' : '🚀 Ξεκίνα!'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Barcode Scanner Modal ───────────────────────────────────────────────────
function BarcodeScannerModal({ isOpen, onClose }) {
  const [showOnboarding, setShowOnboarding] = useState(() => !localStorage.getItem('sg_scanner_onboarded'));
  const [activeView, setActiveView] = useState('scan');
  const [product, setProduct] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [scanKey, setScanKey] = useState(0);
  const [ingredientDetail, setIngredientDetail] = useState(null);
  const [scanHistory, setScanHistory] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sg_scan_history') || '[]'); } catch { return []; }
  });
  const [allergens, setAllergens] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sg_allergens') || '[]'); } catch { return []; }
  });
  const scannerRef = useRef(null);
  const handleBarcodeScanRef = useRef(null);
  const scannerDivId = 'barcode-scanner-area';

  // Persist
  useEffect(() => {
    localStorage.setItem('sg_allergens', JSON.stringify(allergens));
  }, [allergens]);
  useEffect(() => {
    localStorage.setItem('sg_scan_history', JSON.stringify(scanHistory));
  }, [scanHistory]);

  // Lock body scroll
  useEffect(() => {
    if (isOpen) { document.body.style.overflow = 'hidden'; }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Start camera
  useEffect(() => {
    if (!isOpen || activeView !== 'scan' || product || loading) return;
    let html5Qr = null;
    let cancelled = false;
    const startScanner = async () => {
      try {
        // Clear any leftover DOM from previous instance
        const container = document.getElementById(scannerDivId);
        if (container) container.innerHTML = '';

        // Dynamic import — loads ~210KB only when scanner is actually opened
        const { Html5Qrcode: H5QR, Html5QrcodeSupportedFormats: Fmts } = await import('html5-qrcode');
        html5Qr = new H5QR(scannerDivId);
        scannerRef.current = html5Qr;
        if (cancelled) return;
        await html5Qr.start(
          { facingMode: 'environment' },
          {
            fps: 15,
            qrbox: { width: 270, height: 130 },
            aspectRatio: 1.5,
            disableFlip: false,
            formatsToSupport: [
              Fmts.EAN_13,
              Fmts.EAN_8,
              Fmts.UPC_A,
              Fmts.UPC_E,
              Fmts.CODE_128,
              Fmts.CODE_39,
              Fmts.QR_CODE,
              Fmts.DATA_MATRIX,
              Fmts.ITF,
            ],
            experimentalFeatures: { useBarCodeDetectorIfSupported: true },
          },
          (text) => {
            if (html5Qr.isScanning) html5Qr.stop().catch(() => {});
            handleBarcodeScanRef.current?.(text);
          },
          () => {}
        );

        // Remove library's built-in white scanning box corners
        if (!cancelled) {
          const el = document.getElementById(scannerDivId);
          if (el) {
            el.querySelectorAll('div[style]').forEach(d => {
              const s = d.getAttribute('style') || '';
              if ((s.includes('border') && s.includes('position: absolute')) || s.includes('border-width')) {
                d.style.display = 'none';
              }
            });
            // Also hide the shaded region children
            const shaded = el.querySelector('#qr-shaded-region');
            if (shaded) {
              shaded.style.border = 'none';
              shaded.style.boxShadow = 'none';
              Array.from(shaded.children).forEach(c => c.style.display = 'none');
            }
          }
        }
      } catch {
        if (!cancelled) setError('Δεν μπόρεσε να ανοίξει η κάμερα. Δώσε πρόσβαση.');
      }
    };
    const timer = setTimeout(startScanner, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (html5Qr) {
        try { if (html5Qr.isScanning) html5Qr.stop().catch(() => {}); } catch { /* ignore stop cleanup errors */ }
        try { html5Qr.clear(); } catch { /* ignore clear cleanup errors */ }
      }
      scannerRef.current = null;
    };
  }, [isOpen, activeView, product, scanKey, loading]);

  const stopScanner = () => {
    if (scannerRef.current) {
      try { if (scannerRef.current.isScanning) scannerRef.current.stop().catch(() => {}); } catch { /* ignore stop cleanup errors */ }
      try { scannerRef.current.clear(); } catch { /* ignore clear cleanup errors */ }
      scannerRef.current = null;
    }
  };

  async function handleBarcodeScan(barcode) {
    setLoading(true);
    setError('');
    try { new Audio('data:audio/mp3;base64,//MkxAAQhEBEFmACAAAI0HqAgIICuS39R/4AAAABh//MkxAAYS15QAAwYyAAwAQA4B5///wAAC////wAAA//MkxAAQgAAAAAQQAAAwAAAwD///wAAAP///wAAA//MkxAARQAAAAAQQAAAwAAAwD///wAAAP///wAAA').play().catch(()=>{}); } catch { /* ignore sound-play failures */ }
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    try {
      const OFB_FIELDS = 'product_name,product_name_el,product_name_en,generic_name,generic_name_el,brands,image_front_small_url,image_front_url,image_url,nova_group,nutriscore_grade,nutriments,allergens_tags,traces_tags,additives_tags,additives_original_tags,ingredients_text,ingredients_text_el,ingredients_analysis_tags,quantity,packaging,categories,labels,manufacturing_places,origins,stores,countries';
      // Try world DB first, then Greek DB as fallback for local products
      let data = null;
      try {
        const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${OFB_FIELDS}`);
        const d = await r.json();
        if (d.status === 1 && d.product) data = d;
      } catch { /* try Greek fallback */ }
      if (!data) {
        try {
          const r2 = await fetch(`https://gr.openfoodfacts.org/api/v2/product/${barcode}.json?fields=${OFB_FIELDS}`);
          const d2 = await r2.json();
          if (d2.status === 1 && d2.product) data = d2;
        } catch { /* no result */ }
      }

      if (data && data.status === 1 && data.product) {
        const p = data.product;
        const fallbackName = `Προϊόν (${barcode})`;
        const parsedName = [p.product_name_el, p.product_name, p.product_name_en, p.generic_name_el, p.generic_name].find(n => n && n.trim()) || fallbackName;

        const additivesTags = p.additives_original_tags || p.additives_tags || [];
        const additives = additivesTags.map(a => a.replace(/^en:/, '').toUpperCase()).filter(Boolean);

        const ingredientsText = p.ingredients_text_el || p.ingredients_text || '';
        const hasPalmOil = /palm/i.test(ingredientsText) || (p.ingredients_analysis_tags || []).some(t => t.includes('palm-oil'));

        const analysisTags = p.ingredients_analysis_tags || [];
        const isVegan = analysisTags.some(t => t === 'en:vegan');
        const isVegetarian = analysisTags.some(t => t === 'en:vegetarian' || t === 'en:vegan');

        const parsed = {
          barcode,
          source: 'openfoodfacts',
          name: parsedName,
          brand: p.brands ? p.brands.split(',')[0].trim() : null,
          image: p.image_front_small_url || p.image_front_url || p.image_url || null,
          novaGroup: p.nova_group || null,
          nutriScore: /^[a-e]$/i.test(p.nutriscore_grade || '') ? p.nutriscore_grade.toLowerCase() : null,
          kcal: p.nutriments?.['energy-kcal_100g'] ?? p.nutriments?.['energy-kcal'] ?? null,
          fat: p.nutriments?.fat_100g ?? null,
          saturated: p.nutriments?.['saturated-fat_100g'] ?? null,
          sugars: p.nutriments?.sugars_100g ?? null,
          salt: p.nutriments?.salt_100g ?? null,
          proteins: p.nutriments?.proteins_100g ?? null,
          fiber: p.nutriments?.fiber_100g ?? null,
          carbs: p.nutriments?.carbohydrates_100g ?? null,
          sodium: p.nutriments?.sodium_100g ?? null,
          allergenTags: [...(p.allergens_tags || []), ...(p.traces_tags || [])],
          additives,
          ingredients: ingredientsText,
          hasPalmOil,
          isVegan,
          isVegetarian,
          quantity: p.quantity || '',
          categories: p.categories ? p.categories.split(',').slice(0, 3).map(c => c.trim()).filter(c => c.length < 30) : [],
          labels: p.labels ? p.labels.split(',').slice(0, 4).map(l => l.trim()).filter(l => l.length < 25) : [],
          origin: p.origins || p.manufacturing_places || null,
          scannedAt: new Date().toISOString(),
        };
        setProduct(parsed);
        setScanHistory(prev => {
          const filtered = prev.filter(h => h.barcode !== barcode);
          return [parsed, ...filtered].slice(0, 50);
        });

      } else {
        // ── Edamam fallback — fires when OFF has no record for this barcode ──
        setLoading(true); // keep spinner going
        try {
          const edamamRes = await fetch(`${API_BASE}/api/barcode/${barcode}`);
          const edamamData = await edamamRes.json();
          if (edamamData.found && edamamData.product) {
            const ep = edamamData.product;
            setProduct(ep);
            setScanHistory(prev => {
              const filtered = prev.filter(h => h.barcode !== barcode);
              return [ep, ...filtered].slice(0, 50);
            });
          } else {
            setError(`Δεν βρέθηκε στη βάση (Barcode: ${barcode})`);
          }
        } catch {
          setError(`Δεν βρέθηκε στη βάση (Barcode: ${barcode})`);
        }
      }
    } catch {
      setError('Σφάλμα σύνδεσης. Δοκίμασε ξανά.');
    }
    setLoading(false);
  }
  useEffect(() => {
    handleBarcodeScanRef.current = handleBarcodeScan;
  });

  const handleClose = () => {
    stopScanner();
    setIsClosing(true);
    setTimeout(() => {
      setIsClosing(false);
      setProduct(null);
      setError('');
      setLoading(false);
      setActiveView('scan');
      setScanKey(k => k + 1);
      onClose();
    }, 350);
  };

  const handleScanAgain = () => {
    stopScanner();
    setProduct(null);
    setError('');
    setLoading(false);
    setActiveView('scan');
    setScanKey(k => k + 1); // Force fresh camera mount
  };

  const toggleAllergen = (id) => {
    setAllergens(prev => prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]);
  };

  const matchedAllergens = product
    ? ALLERGEN_LIST.filter(a => allergens.includes(a.id) && product.allergenTags.some(t => t.includes(a.id.replace('en:', ''))))
    : [];

  const getWarnings = (p) => {
    if (!p) return[];
    const w =[];
    
    if (p.fat != null && getNutrientLevel(p.fat, 'fat') === 'high') w.push({ icon:'🔴', text:'Υψηλά λιπαρά', detail:`${p.fat.toFixed(1)}g/100g`, type:'bad', clickable:true, desc:`Το προϊόν περιέχει ${p.fat.toFixed(1)}g λιπαρών ανά 100g. Ο ΠΟΥ συνιστά <30% ημερήσιων θερμίδων από λιπαρά.` });
    if (p.saturated != null && getNutrientLevel(p.saturated, 'saturated') === 'high') w.push({ icon:'🔴', text:'Υψηλά κορεσμένα λιπαρά', detail:`${p.saturated.toFixed(1)}g`, type:'bad', clickable:true, desc:`Κορεσμένα λιπαρά: ${p.saturated.toFixed(1)}g/100g. Υψηλή πρόσληψη αυξάνει τον κίνδυνο καρδιαγγειακών νοσημάτων.` });
    if (p.sugars != null && getNutrientLevel(p.sugars, 'sugars') === 'high') w.push({ icon:'🔴', text:'Υψηλή ζάχαρη', detail:`${p.sugars.toFixed(1)}g`, type:'bad', clickable:true, desc:`Ζάχαρη: ${p.sugars.toFixed(1)}g/100g. Ο ΠΟΥ συνιστά <10% ημερήσιων θερμίδων από ελεύθερα σάκχαρα.` });
    if (p.salt != null && getNutrientLevel(p.salt, 'salt') === 'high') w.push({ icon:'🔴', text:'Υψηλό αλάτι', detail:`${p.salt.toFixed(1)}g`, type:'bad', clickable:true, desc:`Αλάτι: ${p.salt.toFixed(1)}g/100g. Η υπερκατανάλωση αλατιού συνδέεται με υπέρταση.` });
    if (p.hasPalmOil) w.push({ icon:'🌴', text:'Περιέχει φοινικέλαιο', detail:'', type:'bad', clickable:true, desc:'Το φοινικέλαιο είναι πλούσιο σε κορεσμένα λιπαρά οξέα και η παραγωγή του συνδέεται με αποψίλωση δασών.' });
    if (p.novaGroup === 4) w.push({ icon:'⚠️', text:'Υπερεπεξεργασμένο τρόφιμο', detail:'NOVA 4', type:'bad', clickable:true, desc:'Τα τρόφιμα NOVA 4 έχουν υποστεί βιομηχανική επεξεργασία και περιέχουν πολλά πρόσθετα. Συνδέονται με αυξημένο κίνδυνο παχυσαρκίας και χρόνιων παθήσεων.' });
    
    if (p.fat != null && p.sugars != null && getNutrientLevel(p.fat, 'fat') === 'low' && getNutrientLevel(p.sugars, 'sugars') === 'low') w.push({ icon:'✅', text:'Χαμηλά λιπαρά & ζάχαρη', detail:'', type: 'good' });
    if (p.proteins != null && p.proteins >= 10) w.push({ icon:'💪', text:'Υψηλή πρωτεΐνη', detail:`${p.proteins.toFixed(1)}g`, type: 'good', clickable:true, desc:`Πρωτεΐνη: ${p.proteins.toFixed(1)}g/100g. Άριστη πηγή πρωτεΐνης για μυϊκή ανάπτυξη και κορεσμό.` });
    if (p.fiber != null && p.fiber >= 5) w.push({ icon:'🥦', text:'Πλούσιες φυτικές ίνες', detail:`${p.fiber.toFixed(1)}g`, type: 'good', clickable:true, desc:`Φυτικές ίνες: ${p.fiber.toFixed(1)}g/100g. Συμβάλλουν στη σωστή λειτουργία του πεπτικού συστήματος.` });
        
    return w.sort((a, b) => {
      if (a.type === b.type) return 0;
      return a.type === 'bad' ? -1 : 1;
    });
  };

  if (!isOpen) return null;

  if (showOnboarding) {
    return createPortal(
      <ScannerOnboardingModal onComplete={() => {
        localStorage.setItem('sg_scanner_onboarded', '1');
        setShowOnboarding(false);
      }} />,
      document.body
    );
  }

  return createPortal(
    <div className={`scanner-overlay ${isClosing ? 'closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && handleClose()}>
      <div className={`scanner-card ${isClosing ? 'closing' : ''}`}>
        {ingredientDetail && <IngredientDetailModal item={ingredientDetail} onClose={() => setIngredientDetail(null)} />}

        {/* ── Professional Header ── */}
        <div className="scanner-header">
          <div className="scanner-header-left">
            <div className="scanner-header-icon-wrap">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>
                <rect x="7" y="7" width="10" height="10" rx="1"/>
              </svg>
            </div>
            <div>
              <div className="scanner-header-title">Έξυπνος Σαρωτής</div>
              <div className="scanner-header-sub">
                {activeView === 'scan' && !product && !loading && !error
                  ? <><span className="scanner-live-dot" />Κάμερα ενεργή</>
                  : activeView === 'scan' && product
                  ? <><span style={{color:'#22c55e'}}>✓</span> Προϊόν βρέθηκε</>
                  : activeView === 'history' ? 'Ιστορικό σαρώσεων'
                  : activeView === 'allergens' ? 'Διαχείριση αλλεργιογόνων'
                  : 'Σαρωτής Barcodes'
                }
              </div>
            </div>
          </div>
          <button className="scanner-close-btn" onClick={handleClose} aria-label="Κλείσιμο">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="scanner-tabs">
          {[
            { id:'scan',     label:'📷 Σάρωση' },
            { id:'history',  label:`📜 Ιστορικό ${scanHistory.length > 0 ? `(${scanHistory.length})` : ''}` },
            { id:'allergens', label:'⚠️ Αλλεργίες' },
          ].map(t => (
            <button key={t.id} className={`scanner-tab ${activeView === t.id ? 'active' : ''}`}
              onClick={() => {
                if (activeView === 'scan') stopScanner();
                setActiveView(t.id);
                if (t.id === 'scan' && !product) setScanKey(k => k + 1);
              }}
            >{t.label}</button>
          ))}
        </div>

        {/* ── SCAN VIEW ── */}
        {activeView === 'scan' && !product && (
          <div className="scanner-body">
            {error ? (
              <div className="scanner-error">
                <span style={{ fontSize:40 }}>😕</span>
                <p>{error}</p>
                <button className="scanner-btn" onClick={handleScanAgain}>🔄 Δοκίμασε ξανά</button>
              </div>
            ) : loading ? (
              <div className="scanner-loading">
                <div className="scanner-spinner" />
                <p>Αναζήτηση προϊόντος...</p>
              </div>
            ) : (
              <div className="scanner-scan-center">
                {/* Coverage notice — small, unobtrusive, above the viewfinder */}
                <div className="scanner-coverage-notice">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" style={{ flexShrink:0, opacity:0.65 }}>
                    <circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/>
                  </svg>
                  <span>Ο σαρωτής χρησιμοποιεί τη βάση Open Food Facts. Δεν αναγνωρίζει πάντα ελληνικά ή τοπικά προϊόντα — αν δεν βρεθεί αποτέλεσμα, δοκίμασε χειροκίνητη αναζήτηση.</span>
                </div>

                <div className="scanner-viewfinder">
                  <div id={scannerDivId} key={scanKey} style={{ width:'100%' }} />
                  <div className="scanner-frame">
                    <div className="sf-corner sf-tl" /><div className="sf-corner sf-tr" />
                    <div className="sf-corner sf-bl" /><div className="sf-corner sf-br" />
                    <div className="sf-laser" />
                  </div>
                  {/* Dim overlay outside the scan zone */}
                  <div className="scanner-zone-overlay scanner-zone-top" />
                  <div className="scanner-zone-overlay scanner-zone-bottom" />
                </div>

                <div className="scanner-hint-card">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="scanner-hint-icon">
                    <path d="M3 5h2M3 12h2M3 19h2M7 5v14M11 5h2M11 12h2M11 19h2M15 5v14M19 5h2M19 12h2M19 19h2"/>
                  </svg>
                  <div>
                    <div>Στόχευσε το barcode μέσα στο <strong>πράσινο πλαίσιο</strong></div>
                    <div className="scanner-hint-supported">EAN-13 · EAN-8 · UPC · QR · Code 128</div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PRODUCT RESULT ── */}
        {activeView === 'scan' && product && (
          <div className="scanner-body scanner-result">
            {/* Product Found Flash */}
            <div className="scanner-found-flash">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
              <span>Barcode αναγνωρίστηκε επιτυχώς</span>
            </div>
            {/* Allergen Alert Banner */}
            {matchedAllergens.length > 0 && (
              <div className="allergen-alert-banner">
                <span style={{ fontSize:22 }}>🚨</span>
                <div>
                  <strong>Προσοχή — Αλλεργιογόνα!</strong>
                  <div className="allergen-alert-tags">
                    {matchedAllergens.map(a => (
                      <span key={a.id} className="allergen-alert-tag">{a.icon} {a.label}</span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Product Header */}
            <div className="product-header">
              {product.image && <img src={product.image} alt="" className="product-img" />}
              <div className="product-title-area">
                <h3 className="product-name">{product.name}</h3>
                {product.brand && <p className="product-brand">{product.brand}</p>}
                {product.quantity && <p className="product-qty">{product.quantity}</p>}
                {product.source === 'edamam' && (
                  <span className="product-source-badge">via Edamam</span>
                )}
              </div>
            </div>

            {/* Nutrition Grid */}
            <div className="nutrition-grid">
              {[
                { label:'Θερμίδες', val: product.kcal != null ? Math.round(product.kcal) : '-', unit: product.kcal != null ? 'kcal' : '', color: product.kcal != null ? '#f97316' : '#94a3b8' },
                { label:'Λιπαρά',   val: product.fat != null ? product.fat.toFixed(1) : '-', unit: product.fat != null ? 'g' : '', color: product.fat == null ? '#94a3b8' : getNutrientLevel(product.fat,'fat')==='high' ? '#ef4444' : '#22c55e' },
                { label:'Ζάχαρη',   val: product.sugars != null ? product.sugars.toFixed(1) : '-', unit: product.sugars != null ? 'g' : '', color: product.sugars == null ? '#94a3b8' : getNutrientLevel(product.sugars,'sugars')==='high' ? '#ef4444' : '#22c55e' },
                { label:'Αλάτι',    val: product.salt != null ? product.salt.toFixed(1) : '-', unit: product.salt != null ? 'g' : '', color: product.salt == null ? '#94a3b8' : getNutrientLevel(product.salt,'salt')==='high' ? '#ef4444' : '#22c55e' },
                { label:'Πρωτεΐνη', val: product.proteins != null ? product.proteins.toFixed(1) : '-', unit: product.proteins != null ? 'g' : '', color: product.proteins != null ? '#3b82f6' : '#94a3b8' },
                { label:'Ίνες',     val: product.fiber != null ? product.fiber.toFixed(1) : '-', unit: product.fiber != null ? 'g' : '', color: product.fiber != null ? '#22c55e' : '#94a3b8' },
              ].map((n,i) => (
                <div key={i} className="nutrition-cell" style={{ animationDelay:`${i * 0.06}s` }}>
                  <div className="nutrition-val" style={{ color:n.color }}>{n.val}<span>{n.unit}</span></div>
                  <div className="nutrition-label">{n.label}</div>
                </div>
              ))}
            </div>

            {/* Warnings */}
            {getWarnings(product).length > 0 && (
              <div className="product-warnings">
                {getWarnings(product).map((w,i) => (
                  <div key={i} className={`warning-chip ${w.icon === '✅' || w.icon === '💪' || w.icon === '🥦' ? 'good' : 'bad'}`}
                    style={{ cursor: w.clickable ? 'pointer' : 'default' }}
                    onClick={() => w.clickable && setIngredientDetail({ name: w.text, code: w.detail, desc: w.desc, safety: w.type === 'bad' ? 'bad' : 'ok' })}
                  >
                    <span>{w.icon}</span>
                    <span>{w.text}</span>
                    {w.detail && <span className="warning-detail">{w.detail}</span>}
                    {w.clickable && <span style={{ marginLeft:'auto', fontSize:10, color:'var(--text-muted)' }}>ℹ️</span>}
                  </div>
                ))}
              </div>
            )}

            {/* NutriScore + Labels Row */}
            {(product.nutriScore || product.isVegan || product.isVegetarian || product.novaGroup) && (
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14, alignItems:'center' }}>
                {product.nutriScore && (
                  <div style={{
                    display:'flex', alignItems:'center', gap:5,
                    background: getNutriScoreColor(product.nutriScore),
                    color:'white', borderRadius:10, padding:'5px 11px',
                    fontSize:12, fontWeight:900, letterSpacing:0.5,
                    boxShadow:`0 3px 10px ${getNutriScoreColor(product.nutriScore)}55`
                  }}>
                    <span>Nutri</span><span style={{ opacity:0.7 }}>-</span><span>Score</span>
                    <span style={{ fontSize:16, marginLeft:4 }}>{product.nutriScore.toUpperCase()}</span>
                  </div>
                )}
                {product.novaGroup && (
                  <div style={{
                    display:'flex', alignItems:'center', gap:4,
                    background: product.novaGroup <= 2 ? 'rgba(34,197,94,0.1)' : product.novaGroup === 3 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
                    border: `1px solid ${product.novaGroup <= 2 ? 'rgba(34,197,94,0.3)' : product.novaGroup === 3 ? 'rgba(245,158,11,0.3)' : 'rgba(239,68,68,0.3)'}`,
                    color: product.novaGroup <= 2 ? '#22c55e' : product.novaGroup === 3 ? '#f59e0b' : '#ef4444',
                    borderRadius:10, padding:'5px 10px', fontSize:11, fontWeight:700
                  }}>
                    NOVA {product.novaGroup} {product.novaGroup === 4 ? '⚠️' : product.novaGroup <= 2 ? '✅' : ''}
                  </div>
                )}
                {product.isVegan && <span style={{ background:'rgba(34,197,94,0.1)', border:'1px solid rgba(34,197,94,0.3)', color:'#22c55e', borderRadius:10, padding:'5px 10px', fontSize:11, fontWeight:700 }}>🌱 Vegan</span>}
                {!product.isVegan && product.isVegetarian && <span style={{ background:'rgba(34,197,94,0.08)', border:'1px solid rgba(34,197,94,0.25)', color:'#22c55e', borderRadius:10, padding:'5px 10px', fontSize:11, fontWeight:700 }}>🥗 Vegetarian</span>}
              </div>
            )}

            {/* Additives tappable list */}
            {product.additives && product.additives.length > 0 && (
              <div style={{ marginBottom:14 }}>
                <div style={{ fontSize:11, fontWeight:800, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:0.8, marginBottom:8 }}>
                  🧪 Πρόσθετα ({product.additives.length})
                  <span style={{ fontSize:10, fontWeight:500, textTransform:'none', marginLeft:6, color:'var(--text-muted)' }}>Πάτα για πληροφορίες</span>
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  {product.additives.map((add, i) => {
                    const info = getAdditiveInfo(add);
                    const safetyBg = info.safety === 'ok' ? 'rgba(34,197,94,0.08)' : info.safety === 'bad' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.08)';
                    const safetyCo = info.safety === 'ok' ? '#22c55e' : info.safety === 'bad' ? '#ef4444' : '#f59e0b';
                    const safetyBo = info.safety === 'ok' ? 'rgba(34,197,94,0.25)' : info.safety === 'bad' ? 'rgba(239,68,68,0.3)' : 'rgba(245,158,11,0.25)';
                    return (
                      <button key={i}
                        onClick={() => setIngredientDetail({ name: info.name, code: add, desc: info.desc, safety: info.safety })}
                        style={{
                          display:'flex', alignItems:'center', gap:5,
                          background: safetyBg, border:`1px solid ${safetyBo}`,
                          color: safetyCo, borderRadius:20, padding:'5px 12px',
                          fontSize:11, fontWeight:700, cursor:'pointer',
                          fontFamily:'var(--font)',
                          transition:'transform 0.2s, box-shadow 0.2s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.transform='scale(1.05)'; }}
                        onMouseLeave={e => { e.currentTarget.style.transform=''; }}
                      >
                        {add} ℹ️
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Ingredients (collapsible) */}
            {product.ingredients && (
              <details className="ingredients-details">
                <summary>📋 Συστατικά</summary>
                <p>{product.ingredients}</p>
              </details>
            )}
            <button className="scanner-btn" onClick={handleScanAgain} style={{ marginTop:8 }}>📷 Σάρωσε ξανά</button>
          </div>
        )}

        {/* ── HISTORY VIEW ── */}
        {activeView === 'history' && (
          <div className="scanner-body">
            {scanHistory.length === 0 ? (
              <div className="scanner-empty">
                <span style={{ fontSize:40 }}>📜</span>
                <p>Δεν έχεις σαρώσει κάτι ακόμα</p>
              </div>
            ) : (
              <div className="history-list">
                {scanHistory.map((h, i) => (
                  <div key={h.barcode + i} className="history-item" onClick={() => { setProduct(h); setActiveView('scan'); }}>
                    {h.image && <img src={h.image} alt="" className="history-img" />}
                    <div className="history-info">
                      <div className="history-name">{h.name}</div>
                      <div className="history-meta">
                        {h.brand && <span>{h.brand}</span>}
                        {h.nutriScore && /^[a-e]$/i.test(h.nutriScore) && (
                          <span className="history-score" style={{ background: getNutriScoreColor(h.nutriScore) }}>
                            {h.nutriScore.toUpperCase()}
                          </span>
                        )}
                        <span className="history-date">{new Date(h.scannedAt).toLocaleDateString('el-GR')}</span>
                      </div>
                    </div>
                  </div>
                ))}
                <button className="scanner-btn-outline" onClick={() => { setScanHistory([]); }} style={{ marginTop:12 }}>🗑️ Καθαρισμός ιστορικού</button>
              </div>
            )}
          </div>
        )}

        {/* ── ALLERGENS VIEW ── */}
        {activeView === 'allergens' && (
          <div className="scanner-body">
            <p className="allergen-subtitle">Ενεργοποίησε αλλεργιογόνα για να λαμβάνεις ειδοποίηση όταν σαρώνεις προϊόντα.</p>
            <div className="allergen-grid">
              {ALLERGEN_LIST.map(a => {
                const active = allergens.includes(a.id);
                return (
                  <div key={a.id} className={`allergen-toggle ${active ? 'active' : ''}`} onClick={() => toggleAllergen(a.id)}>
                    <span className="allergen-icon">{a.icon}</span>
                    <span className="allergen-label">{a.label}</span>
                    <div className={`allergen-switch ${active ? 'on' : ''}`}>
                      <div className="allergen-switch-dot" />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// ─── Recipe Popup — Premium Edition ──────────────────────────────────────────
// ── Recipe text cleaning — strips HTML tags, decodes entities, removes junk ──
function cleanRecipeText(raw) {
  if (!raw || typeof raw !== 'string') return '';
  return raw
    .replace(/<[^>]*>/g, ' ')           // strip HTML tags → space
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, '')             // numeric HTML entities
    .replace(/&[a-z]+;/g, '')           // named HTML entities
    .replace(/\s{2,}/g, ' ')            // collapse multiple spaces
    .trim();
}

function RecipePopup({ recipe, onClose, onAddToList, isFavorite, onToggleFavorite }) {
  const [showDetails, setShowDetails] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [activeSection, setActiveSection] = useState('ingredients');
  const [isAdding, setIsAdding] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  // Pre-clean ingredients and instructions once on mount
  const cleanIngredients = (recipe.ingredients || [])
    .map(cleanRecipeText)
    .filter(s => s.length > 1);

  const cleanInstructions = (recipe.instructions || [])
    .map(s => cleanRecipeText(s)
      .replace(/^[0-9]\uFE0F\u20E3\s*/u, '')  // strip keycap emoji: 1️⃣ 2️⃣ 3️⃣…
      .replace(/^\d+[.)]\s*/, '')              // strip leading "1. "
      .replace(/^step\s+\d+[.):\s]*/i, '')    // strip leading "step 1" / "step 2:"
      .trim()
    )
    .filter(s => s.length > 5);

  useEffect(() => {
    const timer = setTimeout(() => setShowDetails(true), 400);
    document.body.style.overflow = 'hidden';
    return () => { clearTimeout(timer); document.body.style.overflow = ''; };
  }, []);

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(() => onClose(), 350);
  };

  const macros = [
    { label: 'Θερμίδες', value: recipe.calories, unit: '', color: '#f97316', icon: '🔥' },
    { label: 'Πρωτεΐνη', value: recipe.protein, unit: 'g', color: '#10b981', icon: '💪' },
    { label: 'Υδατάνθ.', value: recipe.carbs, unit: 'g', color: '#3b82f6', icon: '⚡' },
    { label: 'Λιπαρά', value: recipe.fat, unit: 'g', color: '#eab308', icon: '🫒' },
  ];

  const diffColor = recipe.difficulty === 'Εύκολη' ? '#10b981' : recipe.difficulty === 'Δύσκολη' ? '#ef4444' : '#f59e0b';
  const heroImage = toAbsoluteMediaUrl(recipe.image || recipe.thumbnail);

  return createPortal(
    <div className={`recipe-popup-overlay ${isClosing ? 'closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && handleClose()}>
      <div className={`recipe-popup-card ${isClosing ? 'closing' : ''}`}>
        <button className="recipe-popup-close" onClick={handleClose}>✕</button>
        <button
          className={`recipe-popup-fav ${isFavorite ? 'is-fav' : ''}`}
          onClick={(e) => { e.stopPropagation(); onToggleFavorite?.(); }}
          aria-label={isFavorite ? 'Αφαίρεση από αγαπημένα' : 'Προσθήκη στα αγαπημένα'}
        >
          {isFavorite ? '❤️' : '🤍'}
        </button>

        {heroImage ? (
          <div className="recipe-popup-hero" style={{ backgroundImage: `url(${heroImage})` }}>
            <div className="recipe-popup-hero-overlay">
              <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' }}>
                {recipe.cuisine && recipe.cuisine !== 'Διεθνής' && (
                  <span className="recipe-popup-tag">{recipe.cuisine}</span>
                )}
                {recipe.category && (
                  <span className="recipe-popup-tag">{recipe.category}</span>
                )}
              </div>
              <h2 className="recipe-popup-title">{cleanRecipeTitle(recipe.title)}</h2>
              <div className="recipe-popup-meta-inline">
                <span>⏱️ {recipe.time || 30} λεπτά</span>
                <span>•</span>
                <span>🍽️ {recipe.servings || 4} μερίδες</span>
                <span>•</span>
                <span style={{ color: diffColor }}>{recipe.difficulty || 'Μέτρια'}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="recipe-popup-header-noimg">
            <h2 className="recipe-popup-title">{cleanRecipeTitle(recipe.title)}</h2>
            <div className="recipe-popup-meta-inline" style={{ color:'var(--text-muted)' }}>
              <span>⏱️ {recipe.time || 30} λεπτά</span>
              <span>•</span>
              <span>🍽️ {recipe.servings || 4} μερίδες</span>
            </div>
          </div>
        )}

        <div className="recipe-popup-body">
          {recipe.description && (() => {
            const LIMIT = 160;
            const isLong = recipe.description.length > LIMIT;
            const shown = isLong && !descExpanded
              ? recipe.description.slice(0, LIMIT).trimEnd() + '…'
              : recipe.description;
            return (
              <div style={{ margin:'0 0 16px', paddingBottom:16, borderBottom:'1px solid var(--border-light)' }}>
                <p style={{ fontSize:13, lineHeight:1.65, color:'var(--text-secondary)', margin:0 }}>{shown}</p>
                {isLong && (
                  <button
                    onClick={() => setDescExpanded(e => !e)}
                    style={{ marginTop:4, fontSize:12, fontWeight:700, color:'var(--accent)', background:'none', border:'none', cursor:'pointer', padding:0, fontFamily:'var(--font)' }}
                  >
                    {descExpanded ? 'Λιγότερα ▲' : 'Περισσότερα ▼'}
                  </button>
                )}
              </div>
            );
          })()}

          {macros.some(m => m.value) && (
          <div className="recipe-nutri-dashboard" style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:8, marginBottom:14 }}>
            {macros.map((m, i) => (
              <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'12px 6px', borderRadius:14, background:'var(--bg-subtle)', border:'1px solid var(--border-light)', transition:'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)' }}>
                <div style={{ width:28, height:28, borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, background:`${m.color}15`, color:m.color }}>{m.icon}</div>
                <div style={{ fontSize:17, fontWeight:900, lineHeight:1.1, color:m.color }}>{m.value || '-'}{m.unit && <span style={{ fontSize:10, opacity:0.6, marginLeft:1 }}>{m.unit}</span>}</div>
                <div style={{ fontSize:9, textTransform:'uppercase', fontWeight:800, color:'var(--text-muted)', letterSpacing:0.5 }}>{m.label}</div>
              </div>
            ))}
          </div>
          )}

          {(recipe.fiber || recipe.sugar) && (
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
              {recipe.fiber && <span style={{ fontSize:11, fontWeight:600, color:'var(--text-secondary)', background:'var(--bg-subtle)', padding:'5px 10px', borderRadius:8, border:'1px solid var(--border-light)' }}>🥦 Φυτικές Ίνες: {recipe.fiber}g</span>}
              {recipe.sugar && <span style={{ fontSize:11, fontWeight:600, color:'var(--text-secondary)', background:'var(--bg-subtle)', padding:'5px 10px', borderRadius:8, border:'1px solid var(--border-light)' }}>🍬 Ζάχαρη: {recipe.sugar}g</span>}
            </div>
          )}

          {recipe.tags && recipe.tags.length > 0 && (
            <div style={{ display:'flex', gap:6, flexWrap:'wrap', marginBottom:14 }}>
              {recipe.tags.map((tag, i) => (
                <span key={i} style={{ fontSize:10.5, fontWeight:700, color:'var(--accent)', background:'rgba(99,102,241,0.08)', padding:'5px 10px', borderRadius:8, border:'1px solid rgba(99,102,241,0.15)', whiteSpace:'nowrap' }}>{
                  tag === 'high-protein' ? '💪 Υψηλή Πρωτεΐνη' :
                  tag === 'low-carb' ? '🥑 Χαμηλοί Υδατ/κες' :
                  tag === 'quick' ? '⚡ Γρήγορη' :
                  tag === 'vegan' ? '🌱 Vegan' :
                  tag === 'vegetarian' ? '🥬 Χορτοφαγική' :
                  tag === 'gluten-free' ? '🌾 Χωρίς Γλουτένη' :
                  tag === 'dairy-free' ? '🥛 Χωρίς Γαλακτοκομικά' :
                  tag === 'healthy' ? '💚 Υγιεινή' :
                  tag === 'budget' ? '💰 Οικονομική' :
                  tag === 'low-fat' ? '🫒 Low Fat' :
                  tag.toLowerCase() === 'seafood' ? '🐟 Θαλασσινά' :
                  tag.toLowerCase() === 'shellfish' ? '🦐 Οστρακόδερμα' :
                  tag.toLowerCase() === 'beef' ? '🥩 Μοσχάρι' :
                  tag.toLowerCase() === 'chicken' ? '🍗 Κοτόπουλο' :
                  tag.toLowerCase() === 'lamb' ? '🍖 Αρνί' :
                  tag.toLowerCase() === 'pork' ? '🥓 Χοιρινό' :
                  tag.toLowerCase() === 'pasta' ? '🍝 Ζυμαρικά' :
                  tag.toLowerCase() === 'dessert' ? '🍰 Γλυκό' :
                  tag.toLowerCase() === 'breakfast' ? '🍳 Πρωινό' :
                  tag.toLowerCase() === 'starter' ? '🥗 Ορεκτικό' :
                  tag.toLowerCase() === 'side' ? '🥙 Συνοδευτικό' :
                  tag.toLowerCase() === 'miscellaneous' ? '🍽️ Διάφορα' :
                  tag.toLowerCase() === 'goat' ? '🐐 Κατσίκι' :
                  tag
                }</span>
              ))}
            </div>
          )}

          {recipe.youtube && (
            <a
              href={recipe.youtube}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, width:'100%', padding:'11px 16px', marginBottom:10, borderRadius:12, background:'#ff0000', color:'#fff', fontWeight:700, fontSize:13, textDecoration:'none', boxSizing:'border-box' }}
            >
              ▶ Δες το Video στο YouTube
            </a>
          )}

          <button
            className="add-recipe-btn"
            disabled={isAdding}
            onClick={async (e) => {
              e.stopPropagation();
              setIsAdding(true);
              try { await onAddToList(); } finally { setIsAdding(false); }
            }}
            style={isAdding ? { opacity:0.75, cursor:'not-allowed' } : {}}
          >
            {isAdding
              ? <><span style={{ display:'inline-block', width:14, height:14, borderRadius:'50%', border:'2px solid rgba(255,255,255,0.4)', borderTopColor:'#fff', animation:'spin 0.7s linear infinite', marginRight:8, verticalAlign:'middle' }} />Ψάχνω τιμές...</>
              : '🛒 Προσθήκη Υλικών στη Λίστα'}
          </button>

          <div className={`recipe-popup-details ${showDetails ? 'visible' : ''}`}>
            <div style={{ display:'flex', gap:0, marginBottom:16, borderRadius:12, overflow:'hidden', border:'1.5px solid var(--border)', background:'var(--bg-subtle)' }}>
              <button
                onClick={() => setActiveSection('ingredients')}
                style={{ flex:1, padding:'10px 8px', border:'none', background:activeSection === 'ingredients' ? 'var(--bg-card)' : 'transparent', color:activeSection === 'ingredients' ? 'var(--text-primary)' : 'var(--text-muted)', fontSize:13, fontWeight:700, fontFamily:'var(--font)', cursor:'pointer', transition:'background 0.25s, color 0.25s', boxShadow:activeSection === 'ingredients' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none', WebkitTapHighlightColor:'transparent' }}
              >
                🥗 Υλικά ({cleanIngredients.length})
              </button>
              <button
                onClick={() => setActiveSection('instructions')}
                style={{ flex:1, padding:'10px 8px', border:'none', background:activeSection === 'instructions' ? 'var(--bg-card)' : 'transparent', color:activeSection === 'instructions' ? 'var(--text-primary)' : 'var(--text-muted)', fontSize:13, fontWeight:700, fontFamily:'var(--font)', cursor:'pointer', transition:'background 0.25s, color 0.25s', boxShadow:activeSection === 'instructions' ? '0 2px 8px rgba(0,0,0,0.06)' : 'none', WebkitTapHighlightColor:'transparent' }}
              >
                👨‍🍳 Εκτέλεση ({cleanInstructions.length})
              </button>
            </div>

            {activeSection === 'ingredients' && (
              <div className="recipe-section">
                {cleanIngredients.length > 0 ? (
                  <ul className="ing-list-pro">
                    {cleanIngredients.map((ing, i) => (
                      <li key={i} className="ing-item-clean">
                        <span className="ing-bullet" />
                        <span>{ing}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div style={{ textAlign:'center', color:'var(--text-muted)', padding:'24px 0', fontSize:13 }}>
                    Δεν βρέθηκαν υλικά για αυτή τη συνταγή.
                  </div>
                )}
              </div>
            )}

            {activeSection === 'instructions' && (
              <div className="recipe-section">
                {cleanInstructions.length > 0 ? (
                  <div className="instructions-timeline">
                    {cleanInstructions.map((step, i) => (
                      <div key={i} className="step-row">
                        <span className="step-number">{i + 1}</span>
                        <p className="step-text">{step}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ textAlign:'center', color:'var(--text-muted)', padding:'24px 0', fontSize:13 }}>
                    Δεν βρέθηκαν οδηγίες για αυτή τη συνταγή.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  useKeepAlive(); // 🔑 keeps Render free-tier alive
  const haptic = useHapticFeedback();

  // ── Capacitor Android init ─────────────────────────────────────────────────
  const { requestLocation, requestCamera, PermissionDialog } = useAndroidPermissions();

  useEffect(() => {
    // Αρχικοποίηση StatusBar, SplashScreen κ.ά.
    initCapacitor();

    // Android back button: κλείνει modals ή βγαίνει
    const cleanup = initBackButton(({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      }
    });
    return () => { if (typeof cleanup === 'function') cleanup(); };
  }, []);

  const [showSplash, setShowSplash] = useState(true);
  // Stable ref — inline arrow would create a new function every render,
  // which would re-trigger AppSplash's useEffect and loop forever.
  const handleSplashDone = useCallback(() => setShowSplash(false), []);

  const [isDarkMode, setIsDarkMode]           = useState(() => localStorage.getItem('theme') === 'dark');
  const socketRef = useRef(null);

  const [showWelcome, setShowWelcome]         = useState(() => {
    try { return !localStorage.getItem('sg_welcomed_v2'); } catch { return true; }
  });
  const [savedLists, setSavedLists]           = useState([]);
  const [showListsModal, setShowListsModal]   = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showAuthModal, setShowAuthModal]     = useState(false);
  const [authInitMode, setAuthInitMode]       = useState('login');
  const [nameModalOpen, setNameModalOpen]     = useState(false);
  const [nameModalValue, setNameModalValue]   = useState('');
  const [confirmModal, setConfirmModal]       = useState({ open:false, message:'', onConfirm:null });
  const [recipeAddModal, setRecipeAddModal]   = useState({ open:false, recipeName:'', progress:0, total:0 });
// ── Chat Messages ──────────────────────────────────────────────────────────
  const [chatMessages, setChatMessages] = useState([]);
  const [showChatPanel, setShowChatPanel] = useState(false);
  const[unreadChat, setUnreadChat] = useState(0);
  const [chatInput, setChatInput] = useState('');
  const [dmTarget, setDmTarget] = useState(null); // null = group, friend object = private DM
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showPremiumWelcome, setShowPremiumWelcome] = useState(false);
  const [shoppingBudget, setShoppingBudget] = useState(() => {
    const v = localStorage.getItem('sg_budget');
    return v ? parseFloat(v) : null;
  });
  const [showBudgetInput, setShowBudgetInput] = useState(false);
  const [budgetInputVal, setBudgetInputVal] = useState('');
  const chatEndRef = useRef(null);
  const navRef     = useRef(null);

  // ── Friends state ──────────────────────────────────────────────────────────
  const [friends, setFriends]                 = useState([]);  // loaded from DB on login
  const [showFriendsPanel, setShowFriendsPanel] = useState(false);
  const [showAddFriendModal, setShowAddFriendModal] = useState(false);
  const [friendPicker, setFriendPicker]       = useState({ open:false, item:null });
  const friendsRef = useRef(friends);
  const showChatPanelRef = useRef(showChatPanel);
  const loadGroupChatRef = useRef(() => {});
  const fetchRecipesRef = useRef(() => {});

  const [user, setUser]   = useState(() => JSON.parse(localStorage.getItem('smart_grocery_user')) || null);
  const [items, setItems] = useState(() => JSON.parse(localStorage.getItem('proGroceryItems_real')) || []);
  const [inputValue, setInputValue]       = useState('');
  const [activeTab, setActiveTab]         = useState('list');
  const [notification, setNotification]   = useState({ show:false, message:'' });
  const [suggestions, setSuggestions]     = useState([]);
  const [isSearching, setIsSearching]     = useState(false);
  const [noResults, setNoResults]         = useState(false);
  const [recentSearches, setRecentSearches] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sg_recent_searches') || '[]'); } catch { return []; }
  });
  const [searchInputFocused, setSearchInputFocused] = useState(false);
  const [searchSort, setSearchSort] = useState('relevance'); // 'relevance' | 'price'
  const [selectedStore, setSelectedStore] = useState('Όλα');
  const [isScraping, setIsScraping]       = useState(false);
  const [showLiveBanner, setShowLiveBanner] = useState(false);
  const liveBannerTimerRef = useRef(null);
  const [isServerWaking, setIsServerWaking] = useState(false);
  const [isListening, setIsListening]     = useState(false);
  const [recipes, setRecipes]               = useState([]);
  const [recipesLoading, setRecipesLoading] = useState(true);
  const [recipeFilter, setRecipeFilter]     = useState('all');
  const [expandedRecipe, setExpandedRecipe] = useState(null);
  const [fridgeQuery, setFridgeQuery]       = useState('');

  // ── Favorites (persistent + offline) ─────────────────────────────────────
  const [favoriteIds, setFavoriteIds]           = useState(() => {
    try { return JSON.parse(localStorage.getItem('sg_favorite_ids') || '[]'); } catch { return []; }
  });
  const [favoriteRecipes, setFavoriteRecipes]   = useState(() => {
    try { return JSON.parse(localStorage.getItem('sg_favorite_recipes') || '[]'); } catch { return []; }
  });
  const [, setFavoritesLoaded]   = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [recipePage, setRecipePage]         = useState(1);
  const [recipeTotalPages, setRecipeTotalPages] = useState(1);
  const [recipeCategory, setRecipeCategory] = useState('');
  const [recipeCuisine]   = useState('');
  const [recipeSearchDebounced, setRecipeSearchDebounced] = useState('');
  const recipeFridgeTimer = useRef(null);
  const recipesSentinelRef = useRef(null); // Infinite scroll sentinel

  // TheMealDB — Greek & Mediterranean section
  const [mealDbRecipes, setMealDbRecipes]       = useState([]);
  const [mealDbLoading, setMealDbLoading]       = useState(false);
  const [selectedMealDbRecipe, setSelectedMealDbRecipe] = useState(null);
  const [mealDbTab, setMealDbTab]               = useState('greek'); // 'greek' | 'mediterranean'
  const [mealDbPanelKey, setMealDbPanelKey]     = useState(0); // increment to retrigger animation
  const [mealDbPage,    setMealDbPage]          = useState(1); // 12 per page
  const MEALDB_PER_PAGE = 12;
  const mealDbTabsRef                           = useRef(null);

  // MealDB favorites (separate key-space from scraped recipe favorites)
  const [mealDbFavIds, setMealDbFavIds]         = useState(() => {
    try { return JSON.parse(localStorage.getItem('sg_mealdb_fav_ids') || '[]'); } catch { return []; }
  });
  const [mealDbFavRecipes, setMealDbFavRecipes] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sg_mealdb_fav_recipes') || '[]'); } catch { return []; }
  });

  // Typing indicators — { [friendShareKey]: senderName }
  const [friendsTyping, setFriendsTyping]       = useState({});
  const typingTimers                            = useRef({});

  // Push notifications
  const [pushEnabled, setPushEnabled]           = useState(() => !!localStorage.getItem('sg_push_sub'));

  // Onboarding tour
  const [showOnboarding, setShowOnboarding]     = useState(() => !localStorage.getItem('sg_onboarding_done'));
  const [onboardingStep, setOnboardingStep]     = useState(0);
  const [showScanner, setShowScanner]       = useState(false);
  const [showPlateScanner, setShowPlateScanner] = useState(false);
  const [showSmartRoute, setShowSmartRoute] = useState(false);
  const [currentTime, setCurrentTime]     = useState(new Date());
  const [isOnline, setIsOnline]           = useState(() => navigator.onLine);
  const [wasOffline, setWasOffline]       = useState(false);

  // ── Meal Planner state ─────────────────────────────────────────────────────
  const [mealPlan,           setMealPlan]           = useState(null);
  const [mealPlanLoading,    setMealPlanLoading]     = useState(false);
  const [mealPlanError,      setMealPlanError]       = useState('');
  const [activeMealDay,      setActiveMealDay]       = useState(0);
  const [mealPlanStats,      setMealPlanStats]       = useState(null);
  const [mealPlanSummary,    setMealPlanSummary]     = useState(null);
  const [mealPlanShoppingList, setMealPlanShoppingList] = useState([]);
  const [mealPlanPrefs,      setMealPlanPrefs]       = useState({
    persons: 2, days: 7, budget: 80, goal: 'maintain', restrictions: []
  });

  // TDEE Calculator state
  const [tdeeAge,      setTdeeAge]      = useState('22-28');  // age range
  const [tdeeGender,   setTdeeGender]   = useState('male');
  const [tdeeHeight,   setTdeeHeight]   = useState(175);
  const [tdeeWeight,   setTdeeWeight]   = useState(75);
  const [tdeeActivity, setTdeeActivity] = useState('moderate');
  const [mealPlanStep, setMealPlanStep] = useState(1); // 1=Quiz slides, 3=Results
  const [quizSlide,    setQuizSlide]    = useState(0); // 0-8 quiz slides
  const [quizDir,      setQuizDir]      = useState('fwd'); // 'fwd' | 'bck'

  // Feedback modal — shown when user taps "Νέο" to learn why they want a new plan
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedbackReason,    setFeedbackReason]    = useState('other');
  const [feedbackFreeText,  setFeedbackFreeText]  = useState('');
  // Track which A/B option user picked per meal slot: key = "dayIdx_mealType", value = 'a'|'b'
  const [selectedMeals, setSelectedMeals] = useState({});

  // Macro ratio targets for meal plan (must sum to 100)
  const [macroRatios, setMacroRatios] = useState({ protein: 30, carbs: 40, fat: 30 });

  const [showSmartShopping, setShowSmartShopping] = useState(false);

  // ── Daily Streak ───────────────────────────────────────────────────────────
  const [streak,            setStreak]          = useState(() => {
    try { return JSON.parse(localStorage.getItem('sg_streak') || '{}').count || 0; } catch { return 0; }
  });
  const [streakToast,       setStreakToast]      = useState('');
  const [isNewStreakRecord,  setIsNewStreakRecord] = useState(false);

  // ── Achievements ───────────────────────────────────────────────────────────
  const [achievements, setAchievements] = useState(() => {
    try { return JSON.parse(localStorage.getItem('sg_achievements') || '{}'); } catch { return {}; }
  });
  const [achievementToast, setAchievementToast] = useState('');

  const unlockAchievement = (id, label) => {
    setAchievements(prev => {
      if (prev[id]) return prev;
      const next = { ...prev, [id]: true };
      localStorage.setItem('sg_achievements', JSON.stringify(next));
      setAchievementToast(label);
      setTimeout(() => setAchievementToast(''), 3200);
      return next;
    });
  };

  const storeOptions  = ['Όλα','Lidl','ΑΒ Βασιλόπουλος','Σκλαβενίτης','MyMarket','Μασούτης','Κρητικός','Γαλαξίας','Market In'];
  const searchTimeout = useRef(null);

  // #region agent log
  useEffect(() => {
    debugLog({
      runId: 'pre-repro',
      hypothesisId: 'H1',
      location: 'App.jsx:mount',
      message: 'App mounted',
      data: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    });
  }, []);
  // #endregion

  // ── Auth header helper ─────────────────────────────────────────────────────
  const authHeader = () => {
    const token = localStorage.getItem('smart_grocery_token');
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  const closeOverlaySurfaces = useCallback((keep = '') => {
    if (keep !== 'profile') setShowProfileMenu(false);
    if (keep !== 'lists') setShowListsModal(false);
    if (keep !== 'friends') setShowFriendsPanel(false);
    if (keep !== 'add-friend') setShowAddFriendModal(false);
    if (keep !== 'friend-picker') setFriendPicker({ open: false, item: null });
    if (keep !== 'chat') setShowChatPanel(false);
    if (keep !== 'scanner') setShowScanner(false);
    if (keep !== 'plate-scanner') setShowPlateScanner(false);
    if (keep !== 'map') setShowSmartRoute(false);
    if (keep !== 'premium') setShowPremiumModal(false);
    if (keep !== 'more') setShowMoreMenu(false);
    if (keep !== 'feedback') setShowFeedbackModal(false);
    if (keep !== 'recipe') setExpandedRecipe(null);
    if (keep !== 'mealdb-recipe') setSelectedMealDbRecipe(null);
  }, []);

  const openAuthWall = useCallback((mode = 'login') => {
    closeOverlaySurfaces();
    setAuthInitMode(mode);
    setShowAuthModal(true);
  }, [closeOverlaySurfaces]);

  const navigateToTab = useCallback((tab) => {
    closeOverlaySurfaces();
    setActiveTab(tab);
    haptic.light();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [closeOverlaySurfaces, haptic]);

  const toggleProfileMenu = useCallback(() => {
    if (!user) {
      openAuthWall('login');
      return;
    }
    const next = !showProfileMenu;
    closeOverlaySurfaces(next ? 'profile' : '');
    setShowProfileMenu(next);
    haptic.light();
  }, [user, showProfileMenu, closeOverlaySurfaces, openAuthWall, haptic]);

  const openFriendsPopup = useCallback(() => {
    if (!user) {
      openAuthWall('login');
      return;
    }
    closeOverlaySurfaces('friends');
    setShowFriendsPanel(true);
    haptic.light();
  }, [user, closeOverlaySurfaces, openAuthWall, haptic]);

  const openAddFriendPopup = useCallback(() => {
    if (!user) {
      openAuthWall('login');
      return;
    }
    closeOverlaySurfaces('add-friend');
    setShowAddFriendModal(true);
    haptic.light();
  }, [user, closeOverlaySurfaces, openAuthWall, haptic]);

  const openChatDrawer = useCallback(() => {
    if (!user) {
      openAuthWall('login');
      return;
    }
    closeOverlaySurfaces('chat');
    setShowChatPanel(true);
    haptic.light();
  }, [user, closeOverlaySurfaces, openAuthWall, haptic]);

  const openSavedLists = useCallback(() => {
    if (!user) {
      openAuthWall('login');
      return;
    }
    closeOverlaySurfaces('lists');
    setShowListsModal(true);
    haptic.light();
  }, [user, closeOverlaySurfaces, openAuthWall, haptic]);

  const openPlateScannerModal = useCallback(() => {
    closeOverlaySurfaces('plate-scanner');
    setShowPlateScanner(true);
    haptic.light();
  }, [closeOverlaySurfaces, haptic]);

  const openSmartRouteModal = useCallback(() => {
    if (!user) {
      openAuthWall('login');
      return;
    }
    closeOverlaySurfaces('map');
    setShowSmartRoute(true);
    haptic.light();
  }, [user, closeOverlaySurfaces, openAuthWall, haptic]);

  const openBarcodeScanner = useCallback(async () => {
    const { granted } = await requestCamera();
    if (!granted) return;
    closeOverlaySurfaces('scanner');
    setShowScanner(true);
    haptic.light();
  }, [requestCamera, closeOverlaySurfaces, haptic]);

  // ── Persist friends ────────────────────────────────────────────────────────
  useEffect(() => {
    // friends are persisted in DB — no localStorage needed
  }, [friends]);

  const addFriend = async (friend) => {
    if (!user) return;
    if (friends.some(f => f.shareKey === friend.shareKey)) {
      setNotification({ show:true, message:'Αυτός ο φίλος υπάρχει ήδη!' });
      return;
    }
    if (friend.shareKey === user?.shareKey) {
      setNotification({ show:true, message:'Δεν μπορείς να προσθέσεις τον εαυτό σου!' });
      return;
    }

    // 1. Call backend — saves BOTH sides in DB, notifies target via socket
    let confirmedFriend = null;
    try {
      const r = await fetch(`${API_BASE}/api/auth/add-friend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ targetShareKey: friend.shareKey }),
      });
      const data = await r.json();
      if (r.ok) confirmedFriend = data.friend;
    } catch {
      // Ignore transient friend loading failures.
    }

    // 2. Update local state with confirmed (or optimistic) data
    const normalizedFriend = confirmedFriend || {
      shareKey: friend.shareKey,
      username: friend.username || friend.name || 'Φίλος',
      addedAt: Date.now(),
    };

    setFriends(prev => [...prev, normalizedFriend]);
    setShowAddFriendModal(false);
    setNotification({ show:true, message:`✅ ${normalizedFriend.username} προστέθηκε στο κοινό καλάθι!` });

    // 3. Join their socket room immediately (for real-time items/chat)
    if (socketRef.current) {
      socketRef.current.emit('join_cart', normalizedFriend.shareKey);
    }
  };

  // Load friends from DB — called on login and app start
  const loadFriendsFromDB = async () => {
    if (!user) return;
    try {
      const r = await fetch(`${API_BASE}/api/auth/friends`, { headers: authHeader() });
      if (r.ok) {
        const data = await r.json();
        const dbFriends = (data.friends || []).map(f => ({
          shareKey: f.shareKey,
          username: f.username,
          addedAt:  f.addedAt,
        }));
        setFriends(dbFriends);
        // Re-join all rooms
        if (socketRef.current) {
          dbFriends.forEach(f => socketRef.current.emit('join_cart', f.shareKey));
        }
      }
    } catch {
      // Ignore chat refresh failures while offline.
    }
  };

  const removeFriend = async (shareKey) => {
    setFriends(prev => prev.filter(f => f.shareKey !== shareKey));
    // Also remove from DB (bidirectional)
    try {
      await fetch(`${API_BASE}/api/auth/remove-friend/${shareKey}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
    } catch {
      // Ignore favorite sync failures; local state remains source of truth.
    }
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
      fetchRecipesRef.current?.();
    };
    window.addEventListener('offline', offlineH);
    window.addEventListener('online', onlineH);
    return () => { window.removeEventListener('offline', offlineH); window.removeEventListener('online', onlineH); };
  }, []);

  // ── Daily Streak ──────────────────────────────────────────────────────────
  useEffect(() => {
    const today = new Date().toDateString();
    const stored = JSON.parse(localStorage.getItem('sg_streak') || '{"count":0,"lastDate":"","best":0}');
    const yesterday = new Date(Date.now() - 86400000).toDateString();
    let newCount = stored.count;
    let isRecord = false;
    if (stored.lastDate === today) {
      newCount = stored.count;
    } else if (stored.lastDate === yesterday) {
      newCount = stored.count + 1;
    } else {
      newCount = 1;
    }
    const newBest = Math.max(stored.best || 0, newCount);
    if (newCount > (stored.best || 0) && newCount > 1) isRecord = true;
    localStorage.setItem('sg_streak', JSON.stringify({ count: newCount, lastDate: today, best: newBest }));
    setStreak(newCount);
    setIsNewStreakRecord(isRecord);
    if (isRecord && newCount >= 3) {
      setTimeout(() => {
        setStreakToast(`🔥 ${newCount} μέρες streak! Νέο ρεκόρ!`);
        setTimeout(() => setStreakToast(''), 3000);
      }, 1200);
    }
  }, []);

  // ── Dark mode ──────────────────────────────────────────────────────────────
  useEffect(() => {
    document.body.classList.toggle('dark-mode', isDarkMode);
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    socketRef.current = io(API_BASE, { transports: ['websocket', 'polling'] });

    if (user?.shareKey) {
      // Join own room (for item/message receive from others)
      socketRef.current.emit('join_cart', user.shareKey);
      // Join personal notification room (for friend_added events)
      socketRef.current.emit('join_user_room', user.shareKey);
      // Also join all existing friends' rooms so we receive their messages
      friendsRef.current.forEach(f => {
        if (f?.shareKey) socketRef.current.emit('join_cart', f.shareKey);
      });
    }

    socketRef.current.on('receive_item', (itemData) => {
      setItems(prev => [{ ...itemData, id: Date.now() + Math.random() }, ...prev]);
      setNotification({ show:true, message:`🔔 Νέο προϊόν από φίλο: ${itemData.text}` });
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    });

    // Typing indicators
    socketRef.current.on('friend_typing', ({ senderName, shareKey }) => {
      setFriendsTyping(prev => ({ ...prev, [shareKey]: senderName }));
      // Auto-clear after 3s if typing_stop not received
      clearTimeout(typingTimers.current[shareKey]);
      typingTimers.current[shareKey] = setTimeout(() => {
        setFriendsTyping(prev => { const n = { ...prev }; delete n[shareKey]; return n; });
      }, 3000);
    });
    socketRef.current.on('friend_stopped_typing', ({ shareKey }) => {
      clearTimeout(typingTimers.current[shareKey]);
      setFriendsTyping(prev => { const n = { ...prev }; delete n[shareKey]; return n; });
    });

    socketRef.current.on('receive_message', (msg) => {
      setChatMessages(prev => {
        // Avoid duplicate if we already have this exact _id
        if (msg._id && prev.some(m => m._id === msg._id)) return prev;
        return [...prev, msg];
      });
      if (!showChatPanelRef.current) {
        setUnreadChat(prev => prev + 1);
        if (navigator.vibrate) navigator.vibrate([50, 50]);
      }
    });

    // Mutual friendship: when someone adds us, auto-add them back + join their room
    socketRef.current.on('friend_added', (data) => {
      if (!data?.from?.shareKey) return;
      setFriends(prev => {
        if (prev.some(f => f.shareKey === data.from.shareKey)) return prev; // already friends
        // Join their cart room immediately so messages flow
        socketRef.current.emit('join_cart', data.from.shareKey);
        setNotification({ show:true, message:`🤝 ${data.from.username || data.from.name} σε πρόσθεσε στο καλάθι!` });
        if (navigator.vibrate) navigator.vibrate([80, 40, 80]);
        const newFriend = { shareKey: data.from.shareKey, username: data.from.username || data.from.name || 'Φίλος', addedAt: Date.now() };
        // Reload chat to include their messages
        setTimeout(() => loadGroupChatRef.current([...prev, newFriend]), 300);
        return [...prev, newFriend];
      });
    });

    return () => {
      // Remove all listeners before disconnecting to prevent duplicate handlers on reconnect
      socketRef.current.off('receive_item');
      socketRef.current.off('receive_message');
      socketRef.current.off('friend_added');
      socketRef.current.off('friend_typing');
      socketRef.current.off('friend_stopped_typing');
      socketRef.current.disconnect();
    };
  }, [user]);

  // Load group chat (own + all friends messages merged & sorted by time)
  const loadGroupChat = useCallback((friendList) => {
    const currentFriends = friendList !== undefined ? friendList : friends;
    if (!user?.shareKey) return;
    const allKeys = [user.shareKey, ...currentFriends.map(f => f.shareKey)].filter(Boolean);
    fetch(`${API_BASE}/api/chat/group?keys=${encodeURIComponent(allKeys.join(','))}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setChatMessages(data); })
      .catch(() => {
        fetch(`${API_BASE}/api/chat/${user.shareKey}`)
          .then(r => r.json())
          .then(data => { if (Array.isArray(data)) setChatMessages(data); })
          .catch(() => {});
      });
  }, [user, friends]);

  useEffect(() => {
    friendsRef.current = friends;
  }, [friends]);

  useEffect(() => {
    showChatPanelRef.current = showChatPanel;
  }, [showChatPanel]);

  useEffect(() => {
    loadGroupChatRef.current = loadGroupChat;
  }, [loadGroupChat]);

  // Load friends from DB every time the user changes (login/logout)
  useEffect(() => {
    if (user) {
      loadFriendsFromDB();
      // Refresh premium/trial status from DB (catches manual MongoDB grants + trial expiry)
      fetch(`${API_BASE}/api/auth/refresh-premium`, { headers: authHeader() })
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data?.user) return;
          // Update stored user with fresh premium/trial info
          const updated = { ...user, ...data.user };
          setUser(updated);
          localStorage.setItem('smart_grocery_user', JSON.stringify(updated));
          if (data.token) localStorage.setItem('smart_grocery_token', data.token);
        })
        .catch(() => {});
    } else {
      setFriends([]);
    }
  }, [user?.shareKey]); // eslint-disable-line

  // ── Handle Stripe payment success redirect ─────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const payment = params.get('payment');
    if (payment === 'success') {
      // Clean URL first
      window.history.replaceState({}, '', window.location.pathname);
      // Show celebration modal (guard: only once per session)
      if (!sessionStorage.getItem('sg_premium_welcomed')) {
        sessionStorage.setItem('sg_premium_welcomed', '1');
        setShowPremiumWelcome(true);
      }
      // Refresh premium status
      const token = localStorage.getItem('smart_grocery_token');
      if (token) {
        setTimeout(() => {
          fetch(`${API_BASE}/api/auth/refresh-premium`, { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
              if (data?.user) {
                const updated = { ...user, ...data.user };
                setUser(updated);
                localStorage.setItem('smart_grocery_user', JSON.stringify(updated));
                if (data.token) localStorage.setItem('smart_grocery_token', data.token);
              }
            })
            .catch(() => {});
        }, 2000); // Wait 2s for webhook to process
      }
    } else if (payment === 'cancelled') {
      setNotification({ show: true, message: 'Η πληρωμή ακυρώθηκε.' });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []); // eslint-disable-line

  useEffect(() => { loadGroupChat(); }, [loadGroupChat]);

  // Scroll to bottom στο chat
  useEffect(() => {
    if (showChatPanel && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
      setUnreadChat(0); // Αν ανοίξεις το chat, μηδενίζουν τα unread
    }
  },[chatMessages, showChatPanel]);

  // ── Clock ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Recipes ────────────────────────────────────────────────────────────────
  const fetchRecipes = useCallback(async (page = 1, append = false, retryCount = 0) => {
    if (!append) setRecipesLoading(true);

    const params = new URLSearchParams({
      page:  String(page),
      limit: '24',
      ...(recipeCategory && { category: recipeCategory }),
      ...(recipeCuisine  && { cuisine: recipeCuisine }),
      ...(recipeSearchDebounced && { search: recipeSearchDebounced }),
    });

    // Try cache first (only for page 1, no filters)
    if (page === 1 && !recipeCategory && !recipeCuisine && !recipeSearchDebounced) {
      const ck = cacheGet('recipes');
      if (ck && !ck.stale) {
        const cached = ck.data;
        const cachedData  = Array.isArray(cached) ? cached : (cached.recipes || []);
        const cachedPages = Array.isArray(cached) ? 1 : (cached.pages || 1);
        if (cachedData.length > 0) {
          setRecipes(cachedData);
          setRecipeTotalPages(cachedPages);
          setRecipePage(1);
          setRecipesLoading(false);
          return;
        }
      }
    }

    // Detect slow server (Render free tier wake-up)
    const wakeTimer = setTimeout(() => setIsServerWaking(true), 3000);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      const r = await fetch(`${API_BASE}/api/recipes?${params}`, { signal: controller.signal });
      clearTimeout(timeout);
      clearTimeout(wakeTimer);
      setIsServerWaking(false);

      if (r.ok) {
        const d = await r.json();
        const actualRecipes = d.recipes || d;
        if (Array.isArray(actualRecipes)) {
          // Only cache non-empty results
          if (actualRecipes.length > 0 && page === 1 && !recipeCategory && !recipeCuisine && !recipeSearchDebounced) {
            cacheSet('recipes', { recipes: actualRecipes, pages: d.pages || 1 });
          }
          if (append) {
            setRecipes(prev => [...prev, ...actualRecipes]);
          } else {
            setRecipes(actualRecipes);
          }
          setRecipeTotalPages(d.pages || 1);
          setRecipePage(d.page || page);
        }
      } else if (retryCount < 3) {
        // Server returned error — retry with backoff
        clearTimeout(wakeTimer);
        const delay = Math.min(2000 * Math.pow(2, retryCount), 8000);
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchRecipes(page, append, retryCount + 1);
      }
    } catch (err) {
      clearTimeout(wakeTimer);
      setIsServerWaking(false);
      console.error('❌ fetchRecipes:', err);

      // Auto-retry on network errors
      if (retryCount < 3) {
        const delay = Math.min(2000 * Math.pow(2, retryCount), 8000);
        await new Promise(resolve => setTimeout(resolve, delay));
        return fetchRecipes(page, append, retryCount + 1);
      }

      // Final fallback: use any cached data (even stale)
      const ck = cacheGet('recipes');
      if (ck) {
        const cachedData = Array.isArray(ck.data) ? ck.data : (ck.data.recipes || []);
        setRecipes(prev => (prev.length > 0 ? prev : cachedData));
      }
    }
    setRecipesLoading(false);
  }, [recipeCategory, recipeCuisine, recipeSearchDebounced]);

  useEffect(() => {
    fetchRecipesRef.current = fetchRecipes;
  }, [fetchRecipes]);

  // Refetch when filters change
  useEffect(() => {
    if (!isOnline) { setRecipesLoading(false); return; }
    fetchRecipes(1);
  }, [isOnline, fetchRecipes]);

  // Debounce fridge search → server-side
  useEffect(() => {
    if (recipeFridgeTimer.current) clearTimeout(recipeFridgeTimer.current);
    recipeFridgeTimer.current = setTimeout(() => {
      setRecipeSearchDebounced(fridgeQuery.trim());
    }, 400);
    return () => clearTimeout(recipeFridgeTimer.current);
  }, [fridgeQuery]);

  // Load more recipes (pagination)
  const loadMoreRecipes = useCallback(() => {
    if (recipePage < recipeTotalPages && !recipesLoading) {
      fetchRecipes(recipePage + 1, true);
    }
  }, [recipePage, recipeTotalPages, recipesLoading, fetchRecipes]);


  // ── TheMealDB: fetch Greek or Mediterranean recipes ──────────────────────
  const MEALDB_BASE = 'https://www.themealdb.com/api/json/v1/1';
  const fetchMealDb = useCallback(async (section = 'greek') => {
    setMealDbLoading(true);
    setMealDbRecipes([]);
    setSelectedMealDbRecipe(null);
    setMealDbPage(1);
    setMealDbPanelKey(k => k + 1);
    // 1) Try our backend proxy (has Greek translations + extra data)
    try {
      const endpoint = section === 'mediterranean' ? 'mediterranean' : 'greek';
      const r = await fetch(`${API_BASE}/api/meals/${endpoint}`, { signal: AbortSignal.timeout(8000) });
      if (r.ok) {
        const data = await r.json();
        const meals = data.meals || [];
        if (meals.length > 0) {
          setMealDbRecipes(meals);
          setMealDbLoading(false);
          return;
        }
      }
    } catch { /* backend sleeping or offline — fall through to direct API */ }
    // 2) Fallback: call TheMealDB directly
    try {
      const area = section === 'mediterranean' ? 'Italian' : 'Greek';
      const listR = await fetch(`${MEALDB_BASE}/filter.php?a=${area}`);
      if (listR.ok) {
        const listData = await listR.json();
        const items = (listData.meals || []).slice(0, 24);
        // Fetch full details for each meal in parallel (batched to avoid rate limits)
        const details = await Promise.allSettled(
          items.map(m => fetch(`${MEALDB_BASE}/lookup.php?i=${m.idMeal}`).then(r2 => r2.json()))
        );
        const meals = details
          .filter(d => d.status === 'fulfilled' && d.value?.meals?.[0])
          .map(d => {
            const m = d.value.meals[0];
            // Build ingredient list
            const ingredients = [];
            for (let i = 1; i <= 20; i++) {
              const ing = m[`strIngredient${i}`];
              const meas = m[`strMeasure${i}`];
              if (ing && ing.trim()) ingredients.push(`${meas ? meas.trim() + ' ' : ''}${ing.trim()}`);
            }
            return {
              _id: m.idMeal,
              sourceId: m.idMeal,
              title: m.strMeal,
              image: m.strMealThumb,
              area: m.strArea || (section === 'mediterranean' ? 'Mediterranean' : 'Greek'),
              category: m.strCategory || '',
              cuisine: section === 'mediterranean' ? 'Μεσογειακή' : 'Ελληνική',
              sourceApi: 'themealdb',
              instructions: m.strInstructions || '',
              ingredients,
              youtubeUrl: m.strYoutube || null,
              calories: null,
              protein: null,
              carbs: null,
              fat: null,
            };
          });
        setMealDbRecipes(meals);
      }
    } catch { /* fully offline — section stays empty */ }
    setMealDbLoading(false);
  }, []);

  // Auto-fetch Greek recipes when the tab first becomes active
  const mealDbFetchedRef = useRef(false);
  useEffect(() => {
    if (activeTab === 'recipes' && !mealDbFetchedRef.current && isOnline) {
      mealDbFetchedRef.current = true;
      fetchMealDb('greek');
    }
  }, [activeTab, isOnline, fetchMealDb]);

  // ── Favorites: sync with backend + persist in localStorage ────────────────
  const syncFavorites = useCallback(async () => {
    if (!user) return;
    try {
      const token = localStorage.getItem('smart_grocery_token');
      const r = await fetch(`${API_BASE}/api/favorites`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const d = await r.json();
        const ids = (d.favorites || []).map(f => f._id);
        setFavoriteIds(ids);
        setFavoriteRecipes(d.favorites || []);
        localStorage.setItem('sg_favorite_ids', JSON.stringify(ids));
        localStorage.setItem('sg_favorite_recipes', JSON.stringify(d.favorites || []));
      }
    } catch {
      // offline — keep localStorage data
    }
    setFavoritesLoaded(true);
  }, [user]);

  useEffect(() => {
    if (user) { syncFavorites(); syncMealdbFavorites(); }
  }, [user, syncFavorites]); // syncMealdbFavorites intentionally omitted from deps to avoid loop

  // ── MealDB favorites ───────────────────────────────────────────────────────
  const syncMealdbFavorites = useCallback(async () => {
    if (!user) return;
    try {
      const token = localStorage.getItem('smart_grocery_token');
      const r = await fetch(`${API_BASE}/api/favorites/ids`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) {
        const d = await r.json();
        const ids = d.mealdbIds || [];
        setMealDbFavIds(ids);
        localStorage.setItem('sg_mealdb_fav_ids', JSON.stringify(ids));
      }
    } catch { /* offline */ }
  }, [user]);

  const toggleMealdbFavorite = useCallback(async (meal) => {
    const mealdbId = String(meal?._id || '');
    if (!mealdbId) return;
    if (!user) { setAuthInitMode('register'); setShowAuthModal(true); return; }
    const isFav = mealDbFavIds.includes(mealdbId);
    const token = localStorage.getItem('smart_grocery_token');

    // Optimistic update
    if (isFav) {
      const newIds = mealDbFavIds.filter(id => id !== mealdbId);
      setMealDbFavIds(newIds);
      setMealDbFavRecipes(prev => prev.filter(r => String(r._id) !== mealdbId));
      localStorage.setItem('sg_mealdb_fav_ids', JSON.stringify(newIds));
    } else {
      const newIds = [...mealDbFavIds, mealdbId];
      const snap   = { ...meal, addedAt: new Date().toISOString() };
      const updated = [snap, ...mealDbFavRecipes];
      setMealDbFavIds(newIds);
      setMealDbFavRecipes(updated);
      localStorage.setItem('sg_mealdb_fav_ids', JSON.stringify(newIds));
      localStorage.setItem('sg_mealdb_fav_recipes', JSON.stringify(updated));
    }

    // Sync backend
    try {
      await fetch(`${API_BASE}/api/favorites/mealdb/${mealdbId}`, {
        method: isFav ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: isFav ? undefined : JSON.stringify({
          recipe: {
            title:        meal.title,
            image:        meal.image,
            category:     meal.category,
            cuisine:      meal.area || '',
            instructions: Array.isArray(meal.instructions)
              ? meal.instructions
              : (meal.instructions || '').split(/\r?\n/).filter(Boolean),
            ingredients:  meal.ingredients || [],
            tags:         meal.tags || [],
            youtube:      meal.youtube || '',
          },
        }),
      });
    } catch { /* offline — will sync next login */ }
  }, [user, mealDbFavIds, mealDbFavRecipes]);

  const toggleFavorite = useCallback(async (recipeId) => {
    if (!recipeId) return;
    if (!user) { setAuthInitMode('register'); setShowAuthModal(true); return; }
    const isFav = favoriteIds.includes(recipeId);
    const token = localStorage.getItem('smart_grocery_token');

    // Save previous state for rollback
    const prevIds     = [...favoriteIds];
    const prevRecipes = [...favoriteRecipes];

    // Optimistic update
    if (isFav) {
      const newIds = favoriteIds.filter(id => id !== recipeId);
      setFavoriteIds(newIds);
      setFavoriteRecipes(prev => prev.filter(r => r._id !== recipeId));
      localStorage.setItem('sg_favorite_ids', JSON.stringify(newIds));
      localStorage.setItem('sg_favorite_recipes', JSON.stringify(prevRecipes.filter(r => r._id !== recipeId)));
    } else {
      const newIds = [...favoriteIds, recipeId];
      setFavoriteIds(newIds);
      localStorage.setItem('sg_favorite_ids', JSON.stringify(newIds));
      // Find recipe from current page OR from existing favorites
      const recipe = recipes.find(r => r._id === recipeId) || favoriteRecipes.find(r => r._id === recipeId);
      if (recipe) {
        const updated = [{ ...recipe, addedAt: new Date().toISOString() }, ...favoriteRecipes];
        setFavoriteRecipes(updated);
        localStorage.setItem('sg_favorite_recipes', JSON.stringify(updated));
      }
    }

    // Sync with backend — rollback on server errors (but not network failures)
    try {
      const res = isFav
        ? await fetch(`${API_BASE}/api/favorites/${recipeId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${token}` },
          })
        : await fetch(`${API_BASE}/api/favorites/${recipeId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          });

      if (!res.ok && res.status >= 400) {
        // Server rejected — rollback optimistic update
        setFavoriteIds(prevIds);
        setFavoriteRecipes(prevRecipes);
        localStorage.setItem('sg_favorite_ids', JSON.stringify(prevIds));
        localStorage.setItem('sg_favorite_recipes', JSON.stringify(prevRecipes));
      }
    } catch {
      // Network offline — keep optimistic update, will sync on next login
    }
  }, [user, favoriteIds, favoriteRecipes, recipes]);

  // ── Push notification subscription ────────────────────────────────────────
  const subscribeToPush = useCallback(async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const keyRes = await fetch(`${API_BASE}/api/push/vapid-key`);
      if (!keyRes.ok) return;
      const { publicKey } = await keyRes.json();

      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: publicKey,
      });
      const subJson = sub.toJSON();
      const token = localStorage.getItem('smart_grocery_token');
      await fetch(`${API_BASE}/api/push/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys:     subJson.keys,
          userAgent: navigator.userAgent.slice(0, 120),
        }),
      });
      localStorage.setItem('sg_push_sub', '1');
      setPushEnabled(true);
      setNotification({ show: true, message: '🔔 Ειδοποιήσεις ενεργοποιήθηκαν!' });
    } catch (err) {
      console.warn('Push subscribe failed:', err);
    }
  }, []);

  const unsubscribeFromPush = useCallback(async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        const token = localStorage.getItem('smart_grocery_token');
        await fetch(`${API_BASE}/api/push/subscribe`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
    } catch { /* ignore */ }
    localStorage.removeItem('sg_push_sub');
    setPushEnabled(false);
  }, []);

  // Server status check
  useEffect(() => {
    if (!isOnline) return;
    const checkStatus = async () => {
      try {
        const startT  = Date.now();
        const r       = await fetch(`${API_BASE}/api/status`);
        const elapsed = Date.now() - startT;
        if (r.ok) {
          const j = await r.json();
          setIsScraping(j.isScraping || false);
          if (j.isScraping) {
            setShowLiveBanner(true);
            clearTimeout(liveBannerTimerRef.current);
            liveBannerTimerRef.current = setTimeout(() => setShowLiveBanner(false), 8000);
          }
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
  }, [isOnline]);

  // Load list from IndexedDB on first mount (supersedes localStorage initial value)
  useEffect(() => {
    loadItemsFromIDB().then(idbItems => {
      if (idbItems && idbItems.length > 0) setItems(idbItems);
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    localStorage.setItem('proGroceryItems_real', JSON.stringify(items));
    saveItemsToIDB(items); // async, no-await intentional
  }, [items]);

  // ── Saved lists ────────────────────────────────────────────────────────────
  const fetchSavedLists = useCallback(async () => {
    if (!user) return;
    try {
      const token = localStorage.getItem('smart_grocery_token');
      const r = await fetch(`${API_BASE}/api/lists`, { headers: { Authorization: `Bearer ${token}` } });
      if (r.ok) setSavedLists(await r.json());
    } catch {
      // Ignore saved-list fetch failures while backend is unavailable.
    }
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
      if (r.ok) {
        setNotification({ show:true, message:'✅ Αποθηκεύτηκε!' });
        fetchSavedLists();
      } else {
        const e = await r.json().catch(() => ({}));
        // #region agent log
        debugLog({
          runId: 'pre-repro',
          hypothesisId: 'H2',
          location: 'App.jsx:handleSaveConfirm',
          message: 'Save list failed',
          data: {
            status: r.status,
            hasToken: !!token,
            rawMessage: e?.message || null,
          },
        });
        // #endregion
        setNotification({
          show:true,
          message: e.message || 'Σφάλμα.',
        });
      }
    } catch (err) {
      // #region agent log
      debugLog({
        runId: 'pre-repro',
        hypothesisId: 'H2',
        location: 'App.jsx:handleSaveConfirm',
        message: 'Save list threw',
        data: { error: String(err && err.message ? err.message : err) },
      });
      // #endregion
    }
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
    } catch {
      // Ignore optimistic toggle sync failures.
    }
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
        } catch {
          // Ignore delete failures from confirmation flow.
        }
      },
    });
  };

  // ── Smart Send (0 φίλοι → panel, 1 → απευθείας, 2+ → picker) ─────────────
  const handleSendToFriend = (item) => {
    if (!friends.length) {
      openFriendsPopup();
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
        haptic.heavy();
      },
    });
  };

  // ── Search with smart cache ────────────────────────────────────────────────
  const triggerSearch = async (query, store) => {
    if (!user)   { setSuggestions([]); return; }
    if (!isOnline) { setNotification({ show:true, message:'📡 Offline — αναζήτηση μη διαθέσιμη' }); return; }
    if (query.trim().length < 2) { setSuggestions([]); setNoResults(false); return; }

    setNoResults(false);
    const q        = greeklishToGreek(normalizeText(query));
    const cacheKey = `search_${q}_${store}`;
    const cached   = cacheGet(cacheKey);

    if (cached) {
      setSuggestions(cached.data.slice(0, 40));
      setNoResults(cached.data.length === 0);
      if (!cached.stale) return;
    } else {
      setIsSearching(true);
    }

    try {
      const r = await fetch(`${API_BASE}/api/prices/search?q=${encodeURIComponent(q)}&store=${encodeURIComponent(store)}`);
      if (r.ok) {
        const data = await r.json();
        cacheSet(cacheKey, data);
        setSuggestions(data.slice(0, 40));
        setNoResults(data.length === 0);
        if (data.length > 0 && query.trim()) {
          setRecentSearches(prev => {
            const next = [query.trim(), ...prev.filter(r => r.toLowerCase() !== query.trim().toLowerCase())].slice(0, 6);
            try { localStorage.setItem('sg_recent_searches', JSON.stringify(next)); } catch {}
            return next;
          });
        }
      }
    } catch {
      // Ignore search failures and keep existing suggestions.
    }
    setIsSearching(false);
  };

  const typingEmitTimer = useRef(null);
  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => triggerSearch(val, selectedStore), 300);

    // Emit typing indicator to friends when there's content and we have friends
    if (socketRef.current?.connected && friends.length > 0 && user?.shareKey && val.trim()) {
      socketRef.current.emit('typing_start', {
        shareKey: user.shareKey,
        senderName: user.name || user.username || 'Φίλος',
        friendShareKeys: friends.map(f => f.shareKey),
      });
      clearTimeout(typingEmitTimer.current);
      typingEmitTimer.current = setTimeout(() => {
        socketRef.current?.emit('typing_stop', {
          shareKey: user.shareKey,
          friendShareKeys: friends.map(f => f.shareKey),
        });
      }, 1500);
    }
  };

  const addFromSuggestion = (product) => {
    setItems(prev => [{
      id: Date.now() + Math.random(),
      text: product.name,
      category: getCategory(product.name),
      price: product.price,
      store: product.supermarket,
      imageUrl: product.imageUrl || null,
    }, ...prev]);
    setInputValue('');
    setSuggestions([]);
    if (navigator.vibrate) navigator.vibrate(30);
  };

  // ── Plain add (no search, no price — for non-logged users) ─────────────────
  const addPlainItem = () => {
    const text = inputValue.trim();
    if (!text) return;
    setItems(prev => [{
      id: Date.now() + Math.random(),
      text,
      category: getCategory(text),
      price: 0,
      store: '—',
    }, ...prev]);
    setInputValue('');
    haptic.medium();
  };

  // ── Voice ──────────────────────────────────────────────────────────────────
  const voiceRecRef = useRef(null);
  const handleVoiceClick = () => {
    // Stop if already listening
    if (isListening) {
      voiceRecRef.current?.stop();
      setIsListening(false);
      return;
    }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      setNotification({ show: true, message: '❌ Η φωνητική εισαγωγή δεν υποστηρίζεται στον browser σου' });
      return;
    }
    const r = new SR();
    r.lang = 'el-GR';
    r.continuous = false;
    r.interimResults = false;
    voiceRecRef.current = r;
    r.onstart  = () => setIsListening(true);
    r.onresult = (e) => {
      const t = e.results[0][0].transcript;
      setInputValue(t);
      setNotification({ show: true, message: `🎙️ "${t}"` });
      if (user) triggerSearch(t, selectedStore);
    };
    r.onerror = () => {
      setIsListening(false);
      setNotification({ show: true, message: '❌ Σφάλμα αναγνώρισης φωνής' });
    };
    r.onend = () => setIsListening(false);
    try { r.start(); } catch { setIsListening(false); }
    // Haptic feedback on mobile
    if (navigator.vibrate) navigator.vibrate(30);
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
      } catch {
        // Ignore a strategy failure and continue with next keyword.
      }
    }
    return null;
  };

  const addRecipeToList = async (recipe) => {
    // Clean ingredients before adding to list (strip HTML tags / entities)
    const ingredients = (Array.isArray(recipe.ingredients) ? recipe.ingredients : [])
      .map(cleanRecipeText)
      .filter(s => s.length > 1);
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
    setItems(prev => {
      const next = [...newItems, ...prev];
      // Achievements
      if (!achievements['first_recipe']) unlockAchievement('first_recipe', '🎉 Πρώτη συνταγή στη λίστα!');
      const recipesAdded = parseInt(localStorage.getItem('sg_recipes_added') || '0', 10) + 1;
      localStorage.setItem('sg_recipes_added', recipesAdded);
      if (recipesAdded >= 5 && !achievements['chef5'])  unlockAchievement('chef5',  '👨‍🍳 5 συνταγές στη λίστα!');
      if (recipesAdded >= 10 && !achievements['chef10']) unlockAchievement('chef10', '🏆 10 συνταγές — Μaster Chef!');
      return next;
    });
    setActiveTab('list');
    haptic.success();
  };

  const closeRecipeAddModal = () => {
    setRecipeAddModal({ open:false, recipeName:'', progress:0, total:0 });
    setNotification({ show:true, message:'✅ Υλικά προστέθηκαν στη λίστα!' });
  };

  // ── Meal Plan functions ────────────────────────────────────────────────────
  const generateMealPlan = async () => {
    if (!user) { setAuthInitMode('login'); setShowAuthModal(true); return; }
    setMealPlanLoading(true);
    setMealPlanError('');
    setMealPlan(null);
    try {
      // Compute TDEE inline (quiz flow doesn't require separate calculateTDEE step)
      const w = parseFloat(tdeeWeight), h = parseFloat(tdeeHeight);
      const ageStr = String(tdeeAge);
      let a = ageStr === '65+' ? 68 : (() => { const p = ageStr.split('-'); return p.length === 2 ? (parseFloat(p[0]) + parseFloat(p[1])) / 2 : parseFloat(ageStr); })();
      const bmrVal = (w && h && a) ? (tdeeGender === 'male' ? 10*w + 6.25*h - 5*a + 5 : 10*w + 6.25*h - 5*a - 161) : null;
      const multipliers = { sedentary:1.2, light:1.375, moderate:1.55, active:1.725, veryactive:1.9 };
      const tdeeVal = bmrVal ? Math.round(bmrVal * (multipliers[tdeeActivity] || 1.55)) : null;
      const goalTdeeMap = { maintain: 0, mild: -250, loss: -500, extreme: -1000, muscle: +300, budget: 0 };
      const tdeeKcal = tdeeVal ? tdeeVal + (goalTdeeMap[mealPlanPrefs.goal] ?? 0) : null;
      const zigzagHigh = tdeeKcal ? Math.round(tdeeKcal * 1.15) : null;
      const zigzagLow  = tdeeKcal ? Math.round(tdeeKcal * 0.85) : null;
      const zigzagArr  = tdeeKcal ? [zigzagHigh, zigzagLow, zigzagHigh, zigzagLow, zigzagHigh, zigzagLow, zigzagHigh] : null;

      const res = await fetch(`${API_BASE}/api/meal-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({
          ...mealPlanPrefs,
          tdee: tdeeKcal,
          zigzag: zigzagArr,
          gender: tdeeGender,
          age: tdeeAge,
          weight: tdeeWeight,
          height: tdeeHeight,
          activityLevel: tdeeActivity,
          macroRatios,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Σφάλμα AI');
      setMealPlan(data.plan);
      setMealPlanStats(data.stats);
      setMealPlanShoppingList(data.shoppingList || []);
      setMealPlanSummary(data.summary || null);
      setActiveMealDay(0);
      setMealPlanStep(3);
    } catch (e) {
      setMealPlanError(e.message);
    } finally {
      setMealPlanLoading(false);
    }
  };

  // Show the feedback dialog instead of immediately resetting
  const resetPlanWithFeedback = () => {
    setFeedbackReason('other');
    setFeedbackFreeText('');
    setShowFeedbackModal(true);
  };

  // Save feedback to backend then wipe the current plan
  const submitFeedbackAndReset = async () => {
    const choices = Object.entries(selectedMeals).map(([key, chosen]) => {
      const [day, ...rest] = key.split('_');
      return { day: Number(day), mealType: rest.join('_'), chosen };
    });
    try {
      await fetch(`${API_BASE}/api/meal-plan/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeader() },
        body: JSON.stringify({ reason: feedbackReason, freeText: feedbackFreeText, choices }),
      });
    } catch { /* non-critical — don't block the UX */ }
    setMealPlan(null); setMealPlanStats(null); setMealPlanShoppingList([]);
    setMealPlanSummary(null); setMealPlanStep(1); setQuizSlide(0);
    setSelectedMeals({}); setShowFeedbackModal(false);
    setFeedbackReason('other'); setFeedbackFreeText('');
  };

  const addMealPlanToCart = () => {
    const found = mealPlanShoppingList.filter(i => i.found && i.price);
    const newItems = found.map(i => ({
      id: Date.now() + Math.random(),
      text: i.productName || i.ingredient,
      price: i.price,
      store: i.store || '',
      category: 'Meal Plan',
      quantity: 1,
    }));
    setItems(prev => [...newItems, ...prev]);
    setActiveTab('list');
    setNotification({ show: true, message: `✅ ${newItems.length} υλικά προστέθηκαν στη λίστα!` });
  };

  const deleteItem = useCallback((id) => setItems(prev => prev.filter(i => i.id !== id)), []);
  const toggleItemCheck = useCallback((id) => {
    setItems(prev => {
      const updated = prev.map(i => i.id === id ? { ...i, isChecked: !i.isChecked } : i);
      // Heavy success pulse when EVERY item is now checked — shopping complete!
      const allDone = updated.length > 0 && updated.every(i => i.isChecked);
      if (allDone) haptic.success(); else haptic.light();
      return updated;
    });
  }, [haptic]);

  const changeItemQty = useCallback((id, delta) => {
    setItems(prev => prev.map(i => {
      if (i.id !== id) return i;
      const newQty = Math.max(1, (i.quantity || 1) + delta);
      return { ...i, quantity: newQty };
    }));
    if (navigator.vibrate) navigator.vibrate(10);
  }, []);

  const handleWelcomeLogin    = () => {
    setShowWelcome(false);
    localStorage.setItem('sg_welcomed_v2','1');
    setAuthInitMode('login');
    // #region agent log
    debugLog({
      runId: 'pre-repro',
      hypothesisId: 'H1',
      location: 'App.jsx:welcomeLogin',
      message: 'Open AuthModal from welcome',
      data: {
        showSmartRoute,
        showListsModal,
        showFriendsPanel,
        showChatPanel,
      },
    });
    // #endregion
    setShowAuthModal(true);
  };

  const handleWelcomeRegister = () => {
    setShowWelcome(false);
    localStorage.setItem('sg_welcomed_v2','1');
    setAuthInitMode('register');
    // #region agent log
    debugLog({
      runId: 'pre-repro',
      hypothesisId: 'H1',
      location: 'App.jsx:welcomeRegister',
      message: 'Open AuthModal (register) from welcome',
      data: {
        showSmartRoute,
        showListsModal,
        showFriendsPanel,
        showChatPanel,
      },
    });
    // #endregion
    setShowAuthModal(true);
  };
  const handleWelcomeSkip     = () => { setShowWelcome(false); localStorage.setItem('sg_welcomed_v2','1'); };

  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});
  const totalCost = items.reduce((s, i) => s + (i.price > 0 ? i.price * (i.quantity || 1) : 0), 0);
  const checkedItems = items.filter(i => i.isChecked);
  const checkedCost  = checkedItems.reduce((s, i) => s + (i.price > 0 ? i.price * (i.quantity || 1) : 0), 0);

  // ── Scroll-aware nav: finger-accurate hide/reveal ─────────────────────────
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    // Clear the CSS entrance animation fill (fill-mode:backwards still freezes during
    // animation; once it ends the fill releases, but clearing it here ensures the inline
    // style transform has full control from the moment the user first scrolls).
    const animClear = setTimeout(() => { nav.style.animation = 'none'; }, 600);

    let offset    = 0;          // 0 = visible, NAV_H = fully hidden
    let lastScY   = window.scrollY;
    let tStartY   = 0;
    let tPrevY    = 0;
    let tLastY    = 0;
    let touching  = false;
    let snapTimer = null;
    const NAV_H   = () => nav.offsetHeight || 72;

    let rafId = null;
    const apply = (o, animated = false) => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const h = NAV_H();
        offset = Math.max(0, Math.min(h, o));
        nav.style.transition = animated
          ? 'transform 0.42s cubic-bezier(0.16, 1, 0.3, 1)'
          : 'none';
        nav.style.transform = `translateX(-50%) translateY(${offset}px)`;
      });
    };

    const snapTo = (target) => {
      clearTimeout(snapTimer);
      apply(target, true);
    };

    // Desktop scroll
    const onScroll = () => {
      if (touching) return;
      const y     = window.scrollY;
      const delta = y - lastScY;
      lastScY     = y;
      if (Math.abs(delta) < 2) return;
      if (y <= 0) { snapTo(0); return; }
      apply(offset + delta * 1.5);
      clearTimeout(snapTimer);
      snapTimer = setTimeout(() => snapTo(offset > NAV_H() * 0.45 ? NAV_H() : 0), 160);
    };

    // Touch: pixel-for-pixel tracking
    const onTouchStart = (e) => {
      tStartY  = e.touches[0].clientY;
      tPrevY   = tStartY;
      tLastY   = tStartY;
      touching = true;
      clearTimeout(snapTimer);
      nav.style.transition = 'none';
    };

    const onTouchMove = (e) => {
      if (!touching) return;
      const y     = e.touches[0].clientY;
      const delta = tPrevY - y; // positive = finger up = scrolling down = hide nav
      tPrevY      = tLastY;
      tLastY      = y;
      apply(offset + delta);
    };

    const onTouchEnd = () => {
      if (!touching) return;
      touching = false;
      const velocity  = tPrevY - tLastY; // positive = last motion was downward scroll
      const h         = NAV_H();
      const shouldHide = offset > h * 0.42 || velocity > 4;
      snapTo(shouldHide ? h : 0);
    };

    window.addEventListener('scroll',      onScroll,      { passive: true });
    window.addEventListener('touchstart',  onTouchStart,  { passive: true });
    window.addEventListener('touchmove',   onTouchMove,   { passive: true });
    window.addEventListener('touchend',    onTouchEnd,    { passive: true });
    window.addEventListener('touchcancel', onTouchEnd,    { passive: true });

    return () => {
      clearTimeout(animClear);
      window.removeEventListener('scroll',      onScroll);
      window.removeEventListener('touchstart',  onTouchStart);
      window.removeEventListener('touchmove',   onTouchMove);
      window.removeEventListener('touchend',    onTouchEnd);
      window.removeEventListener('touchcancel', onTouchEnd);
      cancelAnimationFrame(rafId);
      clearTimeout(snapTimer);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const budgetPct    = shoppingBudget ? Math.min(1, totalCost / shoppingBudget) : 0;
  const budgetColor  = budgetPct >= 1 ? '#ef4444' : budgetPct >= 0.8 ? '#f59e0b' : '#10b981';

  // Smart Shopping: group items by store, sorted by total value desc
  const smartStoreGroups = Object.entries(
    items.filter(i => i.store && i.store !== '—' && i.store !== '').reduce((acc, item) => {
      const s = item.store;
      if (!acc[s]) acc[s] = { items: [], total: 0 };
      acc[s].items.push(item);
      acc[s].total += item.price > 0 ? item.price * (item.quantity || 1) : 0;
      return acc;
    }, {})
  ).sort((a, b) => b[1].total - a[1].total);

  const itemsWithoutStore = items.filter(i => !i.store || i.store === '—' || i.store === '');

  const handleLogout       = () => {
    localStorage.removeItem('smart_grocery_token');
    localStorage.removeItem('smart_grocery_user');
    localStorage.removeItem('sg_welcomed_v2');
    localStorage.removeItem('sg_favorite_ids');
    localStorage.removeItem('sg_favorite_recipes');
    window.location.reload();
  };
  const handleCopyShareKey = () => { if (user?.shareKey) { navigator.clipboard.writeText(user.shareKey); setNotification({ show:true, message:`📋 Αντιγράφηκε: ${user.shareKey}` }); } };

  const handleSendMessage = (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !user || !socketRef.current) return;
    const msgData = {
      shareKey:        user.shareKey,
      senderName:      user.name,
      text:            chatInput.trim(),
      createdAt:       new Date(),
      friendShareKeys: friends.map(f => f.shareKey).filter(Boolean),
      // If DM target is selected, send only to that friend
      targetShareKey:  dmTarget ? dmTarget.shareKey : null,
    };
    socketRef.current.emit('send_message', msgData);
    setChatMessages(prev => [...prev, { ...msgData, _id: 'local_' + Date.now() }]);
    setChatInput('');
  };

  // When showing favorites, use the offline-safe favoriteRecipes array
  const baseRecipes = showFavoritesOnly ? favoriteRecipes : recipes;

  const filteredRecipes = baseRecipes
      .filter(r => r && r.title && (r.ingredients?.length || 0) > 0)
      .filter(r => {
      const protein = r.protein || 0;
      const carbs = r.carbs || 0;
      const time = r.time || 30;
      const tags = r.tags || [];

      if (recipeFilter === 'protein' && protein < 25) return false; 
      if (recipeFilter === 'nosugar' && carbs > 15) return false;
      if (recipeFilter === 'fast' && time > 30) return false;
      if (recipeFilter === 'budget' && (r.ingredients?.length || 0) > 6) return false;
      if (recipeFilter === 'breakfast' && !tags.includes('breakfast') && r.category !== 'Πρωινό') return false;
      if (recipeFilter === 'snack' && !tags.includes('snack') && r.category !== 'Σνακ') return false;
      if (recipeFilter === 'vegan' && !tags.includes('vegan')) return false;
      
      // Fridge search — client-side fallback for cached/offline data
      if (fridgeQuery.trim() && !recipeSearchDebounced) {
        const terms = fridgeQuery.split(/[,\s]+/).map(t => greeklishToGreek(normalizeText(t))).filter(t => t.length > 1);
        if (terms.length) {
          const ings = Array.isArray(r.ingredients) ? r.ingredients.map(i => greeklishToGreek(normalizeText(String(i)))) : [];
          const titleN = greeklishToGreek(normalizeText(r.title || ''));
          const tagsN  = (r.tags || []).map(t => greeklishToGreek(normalizeText(t)));
          return terms.some(term =>
            ings.some(ing => ing.includes(term) || term.includes(ing.substring(0, Math.max(3, ing.length - 2)))) ||
            titleN.includes(term) || tagsN.some(t => t.includes(term))
          );
        }
      }
      return true;
    });

  const hour         = currentTime.getHours();
  const timeGreeting = hour < 5 ? 'Καλό βράδυ' : hour < 12 ? 'Καλημέρα' : hour < 18 ? 'Καλό απόγευμα' : 'Καλησπέρα';
  const timeIcon     = hour < 5 ? '🌙' : hour < 12 ? '☀️' : hour < 18 ? '☕' : '🌙';

  // ── Χάρτης: count unique stores in user's list ──────────────────────────
  const mealPlanLocked = !user || (!user.isPremium && !user.isOnTrial);
  const planTierLabel = user?.isRealPremium
    ? 'Premium'
    : user?.isOnTrial
      ? `Trial ${user.trialDaysLeft}ημ`
      : user
        ? 'Free'
        : 'Guest';

  const uniqueStoresInList = [...new Set(
    items.filter(i => i.store && i.store !== 'Άγνωστο').map(i => i.store)
  )].length;

  const mealplanJustBlocked = useRef(false);

  useEffect(() => {
    if (activeTab === 'mealplan' && mealPlanLocked) {
      mealplanJustBlocked.current = true;
      setActiveTab('list');
      setShowPremiumModal(true);
    }
  }, [activeTab, mealPlanLocked]);

  useEffect(() => {
    if (mealplanJustBlocked.current) {
      mealplanJustBlocked.current = false;
      closeOverlaySurfaces('premium');
    } else {
      closeOverlaySurfaces();
    }
  }, [activeTab, closeOverlaySurfaces]);

  // ── Body scroll lock — prevent background scroll when any modal is open ─────
  useEffect(() => {
    const anyOpen = showAuthModal || showPremiumModal || showListsModal || showScanner
      || showPlateScanner || showSmartRoute || showFriendsPanel || showChatPanel
      || showMoreMenu || showPremiumWelcome || showProfileMenu || showAddFriendModal
      || friendPicker.open || !!expandedRecipe || !!selectedMealDbRecipe || showFeedbackModal;
    document.body.style.overflow = anyOpen ? 'hidden' : '';
    return () => { document.body.style.overflow = ''; };
  }, [showAuthModal, showPremiumModal, showListsModal, showScanner, showPlateScanner,
      showSmartRoute, showFriendsPanel, showChatPanel, showMoreMenu, showPremiumWelcome,
      showProfileMenu, showAddFriendModal, friendPicker.open, expandedRecipe, selectedMealDbRecipe,
      showFeedbackModal]);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-wrapper">
      {/* Splash animation — shows once on launch, hides via handleSplashDone */}
      {showSplash && <AppSplash onDone={handleSplashDone} />}
      {/* Runtime permission dialogs (camera, location) */}
      {PermissionDialog}
      <OfflineBanner isOnline={isOnline} wasOffline={wasOffline} />
      {showWelcome && !user && <WelcomeModal onLogin={handleWelcomeLogin} onRegister={handleWelcomeRegister} onSkip={handleWelcomeSkip} />}

      <PremiumModal isOpen={showPremiumModal} onClose={() => setShowPremiumModal(false)} user={user} />
      {showPremiumWelcome && <PremiumWelcomeModal onClose={() => setShowPremiumWelcome(false)} />}
      <SavedListsModal isOpen={showListsModal} onClose={() => setShowListsModal(false)} lists={savedLists} onDelete={deleteList} onToggleItem={toggleListItem} />
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onLoginSuccess={(u) => {
          setUser(u);
          // Friends will be loaded by the useEffect above when user changes
        }} initMode={authInitMode} />
      <NameModal isOpen={nameModalOpen} value={nameModalValue} onChange={setNameModalValue} onConfirm={handleSaveConfirm} onCancel={() => setNameModalOpen(false)} />
      <ConfirmModal isOpen={confirmModal.open} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal({ open:false, message:'', onConfirm:null })} />
      <DynamicIsland show={notification.show} message={notification.message} onClose={() => setNotification({ show:false, message:'' })} />

      {/* Achievement toast */}
      {achievementToast && (
        <div className="engagement-toast achievement-toast">
          {achievementToast}
        </div>
      )}
      <RecipeAddModal isOpen={recipeAddModal.open} recipeName={recipeAddModal.recipeName} progress={recipeAddModal.progress} total={recipeAddModal.total} onClose={closeRecipeAddModal} />
      <BarcodeScannerModal isOpen={showScanner} onClose={() => setShowScanner(false)} />
      <PlateScannerModal
        isOpen={showPlateScanner}
        onClose={() => setShowPlateScanner(false)}
        apiBase={API_BASE}
        onAddToList={(foodNames) => {
          const newItems = foodNames.map(name => ({
            id: Date.now() + Math.random(),
            text: name,
            category: getCategory(name),
            price: 0,
            store: '—',
          }));
          setItems(prev => [...newItems, ...prev]);
          haptic.success();
          setNotification({ show: true, message: `✅ Προστέθηκαν ${foodNames.length} τρόφιμα στη λίστα!` });
        }}
      />
      {/* Friend modals & panel */}
      <FriendPickerModal isOpen={friendPicker.open} friends={friends} item={friendPicker.item} onSend={handlePickerSend} onClose={() => setFriendPicker({ open:false, item:null })} />
      <AddFriendModal isOpen={showAddFriendModal} onAdd={addFriend} onClose={() => setShowAddFriendModal(false)} existingFriends={friends} />
      {showFriendsPanel && (
        <>
          <div
            style={{ position:'fixed', inset:0, zIndex:299, background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)' }}
            onClick={() => setShowFriendsPanel(false)}
          />
          <div className="friends-popup-shell">
            <FriendsPanel
              friends={friends}
              myShareKey={user?.shareKey}
              onCopyKey={handleCopyShareKey}
              onAddFriend={() => {
                setShowFriendsPanel(false);
                openAddFriendPopup();
              }}
              onRemoveFriend={removeFriend}
              onClose={() => setShowFriendsPanel(false)}
            />
          </div>
        </>
      )}
      {/* ── Chat Panel ── */}
      {showChatPanel && (
        <>
          <div style={{ position:'fixed', inset:0, zIndex:299, background:'rgba(0,0,0,0.5)', backdropFilter:'blur(4px)' }} onClick={() => setShowChatPanel(false)} />
          <div style={{
            position:'fixed', top:0, right:0, bottom:0, zIndex:300, width:'min(340px, 92vw)',
            background:'var(--bg-card)', borderLeft:'1px solid var(--border)',
            boxShadow:'-12px 0 48px rgba(0,0,0,0.2)', display:'flex', flexDirection:'column',
            animation:'slideInRight 0.3s cubic-bezier(0.34,1.56,0.64,1)',
            backdropFilter:'blur(24px)', WebkitBackdropFilter:'blur(24px)',
          }}>
            <div style={{ padding:'16px 20px', borderBottom:'1px solid var(--border-light)', background:'var(--bg-surface)' }}>
              <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <div style={{ width:36, height:36, borderRadius:10, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <IconMessage size={18} color="#fff" stroke={2}/>
                  </div>
                  <div>
                    <div style={{ fontWeight:800, fontSize:15 }}>Chat Καλαθιού</div>
                    <div style={{ fontSize:10, color:'var(--text-secondary)' }}>Αυτόματη διαγραφή μετά 24 ώρες</div>
                  </div>
                </div>
                <div style={{ display:'flex', gap:6 }}>
                  <button onClick={() => loadGroupChat()} title="Ανανέωση μηνυμάτων" style={{ background:'var(--bg-surface)', border:'1px solid var(--border-light)', borderRadius:8, width:30, height:30, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-secondary)' }}>
                    <IconRefresh size={14}/>
                  </button>
                  <button onClick={() => setShowChatPanel(false)} style={{ background:'var(--bg-surface)', border:'1px solid var(--border-light)', borderRadius:8, width:30, height:30, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', color:'var(--text-secondary)' }}>
                    <IconX size={14}/>
                  </button>
                </div>
              </div>
              {/* Participant avatars */}
              <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                {/* Me */}
                <div title={user?.name} style={{ width:26, height:26, borderRadius:8, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:10, fontWeight:800, flexShrink:0, border:'2px solid var(--bg-card)' }}>
                  {getInitials(user?.name || '?')}
                </div>
                {friends.slice(0,5).map(f => (
                  <div key={f.shareKey} title={f.username} style={{ width:26, height:26, borderRadius:8, background:getAvatarColor(f.shareKey), display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:10, fontWeight:800, flexShrink:0, border:'2px solid var(--bg-card)' }}>
                    {getInitials(f.username)}
                  </div>
                ))}
                <span style={{ fontSize:10, color:'var(--text-secondary)', marginLeft:2 }}>{1 + friends.length} συμμετέχοντες</span>
              </div>
            </div>
            
            <div style={{ flex:1, overflowY:'auto', padding:'16px', display:'flex', flexDirection:'column', gap:'12px' }}>
              {chatMessages.length === 0 ? (
                <div style={{ textAlign:'center', marginTop:'40px', padding:'0 20px' }}>
                  <div style={{ width:64, height:64, borderRadius:20, background:'linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.1))', border:'1.5px solid rgba(99,102,241,0.2)', display:'flex', alignItems:'center', justifyContent:'center', margin:'0 auto 12px' }}>
                    <IconMessage size={28} stroke={1.5} style={{color:'#6366f1'}} />
                  </div>
                  <div style={{ fontWeight:700, fontSize:15, color:'var(--text-primary)', marginBottom:6 }}>Ξεκίνα τη συνομιλία!</div>
                  <div style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.5 }}>Τα μηνύματα φαίνονται σε όλους τους φίλους του καλαθιού σε πραγματικό χρόνο.</div>
                </div>
              ) : (
                chatMessages.map((m, i) => {
                  const isMine = m.senderName === user?.name;
                  const prevMsg = chatMessages[i - 1];
                  const showSenderName = !isMine && m.senderName !== prevMsg?.senderName;
                  const msgTime = m.createdAt ? new Date(m.createdAt).toLocaleTimeString('el-GR', { hour:'2-digit', minute:'2-digit' }) : '';
                  // Don't show duplicate local messages (optimistic vs server)
                  const isDupe = m._id?.startsWith('local_') && chatMessages.slice(0, i).some(
                    prev => !prev._id?.startsWith('local_') && prev.text === m.text && prev.senderName === m.senderName
                  );
                  if (isDupe) return null;
                  return (
                    <div key={m._id || i} style={{ display:'flex', flexDirection:'column', width:'100%', alignItems: isMine ? 'flex-end' : 'flex-start', marginBottom: 2 }}>
                      {showSenderName && (
                        <div style={{ fontSize:10, color:'var(--text-secondary)', fontWeight:600, marginLeft:12, marginBottom:3 }}>{m.senderName}</div>
                      )}
                      <div className={`chat-bubble ${isMine ? 'chat-mine' : 'chat-other'}`} style={{ maxWidth:'78%', wordBreak:'break-word', border: m.targetShareKey ? '1px solid rgba(16,185,129,0.35)' : 'none' }}>
                        {m.targetShareKey && (
                          <div style={{ fontSize:9, color:'#10b981', fontWeight:700, marginBottom:3, opacity:0.85 }}>🔒 Ιδιωτικό</div>
                        )}
                        <div style={{ fontSize:14 }}>{m.text}</div>
                        <div style={{ display:'flex', alignItems:'center', justifyContent: isMine ? 'flex-end' : 'flex-start', gap:4, marginTop:3 }}>
                          <span style={{ fontSize:10, opacity:0.6 }}>{msgTime}</span>
                          {isMine && <span style={{ fontSize:10, opacity:0.6 }}>{m._id?.startsWith('local_') ? '⏳' : '✓✓'}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={chatEndRef} />
            </div>

            <div style={{ padding:'12px 16px 16px', borderTop:'1px solid var(--border-light)', background:'var(--bg-surface)' }}>
              {/* DM Target Picker — who receives this message */}
              {friends.length > 0 && (
                <div style={{ display:'flex', gap:6, marginBottom:10, flexWrap:'wrap', alignItems:'center' }}>
                  <span style={{ fontSize:10, color:'var(--text-secondary)', fontWeight:600, textTransform:'uppercase', letterSpacing:0.4 }}>Προς:</span>
                  <button
                    onClick={() => setDmTarget(null)}
                    style={{
                      padding:'4px 10px', borderRadius:20, fontSize:11, fontWeight:700, cursor:'pointer', border:'none',
                      background: dmTarget === null ? 'linear-gradient(135deg,#6366f1,#8b5cf6)' : 'var(--bg-subtle)',
                      color: dmTarget === null ? '#fff' : 'var(--text-secondary)',
                      transition:'all 0.15s',
                    }}
                  >👥 Όλοι</button>
                  {friends.map(f => (
                    <button
                      key={f.shareKey}
                      onClick={() => setDmTarget(dmTarget?.shareKey === f.shareKey ? null : f)}
                      style={{
                        padding:'4px 10px', borderRadius:20, fontSize:11, fontWeight:700, cursor:'pointer', border:'none',
                        background: dmTarget?.shareKey === f.shareKey ? 'linear-gradient(135deg,#10b981,#059669)' : 'var(--bg-subtle)',
                        color: dmTarget?.shareKey === f.shareKey ? '#fff' : 'var(--text-secondary)',
                        transition:'all 0.15s',
                        display:'flex', alignItems:'center', gap:5,
                      }}
                    >
                      <span style={{ width:16, height:16, borderRadius:'50%', background: getAvatarColor(f.shareKey), display:'inline-flex', alignItems:'center', justifyContent:'center', fontSize:8, color:'#fff', fontWeight:800 }}>
                        {getInitials(f.username)}
                      </span>
                      {f.username}
                    </button>
                  ))}
                </div>
              )}
              <form onSubmit={handleSendMessage} style={{ display:'flex', gap:'8px' }}>
                <input
                  type="text"
                  placeholder={dmTarget ? `Ιδιωτικό σε ${dmTarget.username}...` : 'Μήνυμα σε όλους...'}
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  style={{ flex:1, padding:'12px 16px', borderRadius:'14px', border:`1px solid ${dmTarget ? '#10b981' : 'var(--border)'}`, background:'var(--bg-input)', color:'var(--text-primary)', outline:'none', transition:'border-color 0.2s' }}
                />
                <button type="submit" disabled={!chatInput.trim()} style={{ background: dmTarget ? 'linear-gradient(135deg,#10b981,#059669)' : 'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'white', border:'none', borderRadius:'14px', width:'46px', cursor: chatInput.trim() ? 'pointer' : 'not-allowed', opacity: chatInput.trim() ? 1 : 0.5, display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.2s' }}>
                  <IconArrowRight size={18} stroke={2.5}/>
                </button>
              </form>
            </div>
          </div>
        </>
      )}

      <div className="container" style={!isOnline ? { marginTop: 64 } : {}}>
        {showLiveBanner && (
          <div className="live-scraping-banner">
            <div className="pulsing-dot" />
            <span>Live ενημέρωση τιμών</span>
          </div>
        )}

        {/* ── Header ── */}
        <header className="app-header">
          
          {/* Πάνω: Ώρα, Ημερομηνία & Streak κεντραρισμένα */}
          <div className="header-clock-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <div className="datetime-display" style={{ maxWidth: '240px', margin: '0 auto' }}>
              <div className="current-date current-date-split">
                <SplitText text={`${timeGreeting} ${timeIcon}`} delayStep={0.025} />
              </div>
              <div className="current-time">{currentTime.toLocaleDateString('el-GR', { weekday:'long', day:'numeric', month:'long' })}</div>
              <div className="current-clock hero-time">{currentTime.toLocaleTimeString('el-GR', { timeZone:'Europe/Athens', hour:'2-digit', minute:'2-digit', hourCycle:'h23' })}</div>
            </div>


          </div>

          {/* Τίτλος — compact inline under clock */}
          <div className="hero-brand-compact">Έξυπνο <strong>Καλαθάκι</strong> <span className="hero-version">v2.3.0</span></div>


          {/* Trial / Premium status pill — replaces streak */}
          {user && (
            <div
              className="hero-status-pill"
              onClick={!user.isRealPremium ? () => setShowPremiumModal(true) : undefined}
              style={!user.isRealPremium ? { cursor:'pointer' } : {}}
            >
              {user.isRealPremium ? (
                <><span className="hero-status-dot hero-status-dot--premium" />Premium ✦</>
              ) : user.isOnTrial ? (
                <><span className="hero-status-dot hero-status-dot--trial" />Trial · {user.trialDaysLeft} {user.trialDaysLeft === 1 ? 'μέρα' : 'μέρες'} →</>
              ) : (
                <><span className="hero-status-dot hero-status-dot--free" />Free Plan · Αναβάθμιση →</>
              )}
            </div>
          )}

          {/* ── Tools Top Bar — quick action tabs under clock ── */}
          <div className="tools-topbar">
            <button className={`tools-topbar-btn${activeTab === 'recipes' ? ' active' : ''}`} onClick={() => navigateToTab('recipes')}>
              <IconChefHat size={16} stroke={1.8} />
              <span>Συνταγές</span>
            </button>
            <button className="tools-topbar-btn tools-topbar-btn--featured" onClick={openPlateScannerModal}>
              <IconScan size={18} stroke={2} />
              <span>Meal Scan</span>
            </button>
            <button className="tools-topbar-btn tools-topbar-btn--featured" onClick={openBarcodeScanner}>
              <IconQrcode size={18} stroke={2} />
              <span>Barcode</span>
            </button>
            <button className={`tools-topbar-btn${activeTab === 'mealplan' ? ' active' : ''}`} onClick={() => navigateToTab('mealplan')}>
              <IconBrain size={16} stroke={1.8} />
              <span>AI Πλάνο</span>
            </button>
            <button className="tools-topbar-btn" onClick={openFriendsPopup}>
              <IconUsers size={16} stroke={1.8} />
              <span>Φίλοι</span>
              {friends.length > 0 && <span className="tools-topbar-badge">{friends.length}</span>}
            </button>
            <button className={`tools-topbar-btn${activeTab === 'brochures' ? ' active' : ''}`} onClick={() => navigateToTab('brochures')}>
              <IconTag size={16} stroke={1.8} />
              <span>Φυλλάδια</span>
            </button>
          </div>

          {/* Κάτω: Κουμπιά κεντραρισμένα σε νέα σειρά */}
          <div className="header-actions-row">
            <div className="header-actions">
              {!isOnline && (
                <div style={{ display:'flex', alignItems:'center', gap:4, background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:99, padding:'4px 10px', fontSize:11, fontWeight:700, color:'#ef4444' }}>
                  📡 Offline
                </div>
              )}

              {/* Premium / Trial badge */}
              {user && !user.isPremium && !user.isOnTrial && (
                <div
                  className="action-btn-new"
                  onClick={() => setShowPremiumModal(true)}
                  title="Αναβάθμιση σε Premium"
                  style={{ background:'transparent', border:'1px solid rgba(124,58,237,0.2)', opacity: 0.75 }}
                >
                  <span style={{ fontSize:15, opacity: 0.8 }}>⭐</span>
                </div>
              )}
              {user?.isOnTrial && (() => {
                const urgent = (user.trialDaysLeft || 0) <= 3;
                return (
                  <div
                    onClick={() => setShowPremiumModal(true)}
                    title="Δωρεάν Δοκιμή — Κλίκ για Premium"
                    style={{
                      display:'flex', alignItems:'center', gap:4,
                      background: urgent
                        ? 'linear-gradient(135deg,rgba(239,68,68,0.12),rgba(239,68,68,0.08))'
                        : 'linear-gradient(135deg,rgba(16,185,129,0.1),rgba(5,150,105,0.07))',
                      border: urgent
                        ? '1px solid rgba(239,68,68,0.25)'
                        : '1px solid rgba(16,185,129,0.2)',
                      borderRadius:99, padding:'4px 9px',
                      fontSize:11, fontWeight:700,
                      color: urgent ? '#ef4444' : '#10b981',
                      cursor:'pointer', opacity: 0.9,
                    }}
                  >
                    {urgent ? '⚠️' : '🎁'} {user.trialDaysLeft}μ
                  </div>
                );
              })()}
              {user?.isRealPremium && (
                <div style={{
                  display:'flex', alignItems:'center', gap:3,
                  background:'transparent',
                  border:'1px solid rgba(124,58,237,0.18)',
                  borderRadius:99, padding:'4px 9px',
                  fontSize:10, fontWeight:700,
                  color:'rgba(167,139,250,0.8)', opacity:0.8,
                }}>
                  ⭐
                </div>
              )}

              {/* Meal Scanner button */}
              {user && (
                <div
                  className="action-btn-new scanner-btn-header psm-header-btn"
                  onClick={openPlateScannerModal}
                  title="Meal Scanner — Σκάναρε το πιάτο σου"
                  style={{ fontSize: 18 }}
                >
                  🍽️
                </div>
              )}

              {/* Barcode scanner button — asks camera permission first */}
              {user && (
                <div className="action-btn-new scanner-btn-header" onClick={openBarcodeScanner} title="Σάρωση Barcode">
                  <IconQrcode size={20} stroke={1.8} />
                </div>
              )}

              {/* Friends button with badge */}
              <div
                className="action-btn-new"
                style={{ position:'relative' }}
                onClick={openFriendsPopup}
                title="Κοινό Καλάθι"
              >
                <IconUsers size={20} stroke={1.8} />
                {friends.length > 0 && (
                  <span style={{
                    position:'absolute', top:-4, right:-4,
                    background:'#7c3aed', color:'#fff', borderRadius:'50%',
                    width:16, height:16, fontSize:9, fontWeight:800,
                    display:'flex', alignItems:'center', justifyContent:'center',
                  }}>{friends.length}</span>
                )}
              </div>

              {/* Chat Button */}
              {user && friends.length > 0 && (
                <div className="action-btn-new" style={{ position:'relative' }} onClick={openChatDrawer} title="Chat Καλαθιού">
                  <IconMessage size={20} stroke={1.8} />
                  {unreadChat > 0 && (
                    <span style={{
                      position:'absolute', top:-4, right:-4, background:'#ef4444', color:'#fff', borderRadius:'50%',
                      width:16, height:16, fontSize:9, fontWeight:800, display:'flex', alignItems:'center', justifyContent:'center',
                      animation: 'badgePop 0.3s spring'
                    }}>{unreadChat}</span>
                  )}
                </div>
              )}

              <div
                className="action-btn-new"
                onClick={() => {
                  if (!user) {
                    // #region agent log
                    debugLog({
                      runId: 'pre-repro',
                      hypothesisId: 'H1',
                      location: 'App.jsx:listsActionUnauthed',
                      message: 'Open AuthModal from lists action',
                      data: {
                        showSmartRoute,
                        showListsModal,
                        showFriendsPanel,
                        showChatPanel,
                      },
                    });
                    // #endregion
                    return openAuthWall('login');
                  }
                  openSavedLists();
                }}
                title="Λίστες μου"
                style={{ position:'relative' }}
              >
                <IconNotes size={20} stroke={1.8} />
                {savedLists.length > 0 && <span className="list-badge">{savedLists.length}</span>}
              </div>

              {user ? (
                <div style={{ position:'relative' }}>
                  <div className="action-btn-new" onClick={toggleProfileMenu} title={user.name}>
                    <IconUser size={20} stroke={1.8} />
                  </div>
                </div>
              ) : (
                <div
                  className="action-btn-new"
                  onClick={() => {
                    // #region agent log
                    debugLog({
                      runId: 'pre-repro',
                      hypothesisId: 'H1',
                      location: 'App.jsx:headerLogin',
                      message: 'Open AuthModal from header login',
                      data: {
                        showSmartRoute,
                        showListsModal,
                        showFriendsPanel,
                        showChatPanel,
                      },
                    });
                    // #endregion
                    openAuthWall('login');
                  }}
                  title="Σύνδεση"
                >
                  <IconLock size={20} stroke={1.8} />
                </div>
              )}
            </div>
          </div>
        </header>
        

        {/* ════ LIST TAB ════ */}
        {activeTab === 'list' && (
          <div key="list" className="tab-content list-tab page-enter">
            {/* Smart trial expiry banner */}
            {user?.isOnTrial && (user.trialDaysLeft || 0) <= 3 && (
              <div
                onClick={() => setShowPremiumModal(true)}
                style={{
                  display:'flex', alignItems:'center', gap:12,
                  background:'linear-gradient(135deg,rgba(239,68,68,0.08),rgba(239,68,68,0.04))',
                  border:'1px solid rgba(239,68,68,0.2)',
                  borderRadius:14, padding:'12px 16px', marginBottom:12,
                  cursor:'pointer', transition:'all 0.2s',
                }}
              >
                <span style={{ fontSize:22 }}>⚠️</span>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:800, fontSize:13, color:'#ef4444' }}>
                    Το trial σου λήγει σε {user.trialDaysLeft} {user.trialDaysLeft === 1 ? 'μέρα' : 'μέρες'}!
                  </div>
                  <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop:2 }}>
                    Αναβάθμισε σε Premium για να κρατήσεις πρόσβαση σε όλα τα features →
                  </div>
                </div>
              </div>
            )}
            {/* ── Cart Ring Hero ── */}
            <SavingsRing
              items={items}
              checkedItems={checkedItems}
              totalCost={totalCost}
              checkedCost={checkedCost}
            />

            {items.length > 0 && (
              <div style={{
                background:'var(--bg-surface)', padding:'15px', borderRadius:'14px',
                border:'1px solid var(--border-light)', marginBottom:'12px',
              }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:'flex', alignItems:'baseline', gap:10, flexWrap:'wrap' }}>
                      {user && (
                        <div>
                          <div style={{ fontSize:10, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:0.5 }}>Σύνολο</div>
                          <div className="budget-amount" style={{ fontSize:'22px', fontWeight:'bold', color: shoppingBudget ? budgetColor : 'var(--brand-primary)' }}>{totalCost.toFixed(2)}€</div>
                        </div>
                      )}
                      {checkedItems.length > 0 && (
                        <div>
                          <div style={{ fontSize:10, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:0.5 }}>Αγοράστηκαν</div>
                          <div style={{ fontSize:16, fontWeight:800, color:'#10b981' }}>{checkedItems.length}/{items.length} · {checkedCost.toFixed(2)}€</div>
                        </div>
                      )}
                      {checkedItems.length === 0 && (
                        <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop: user ? 4 : 0, alignSelf:'center' }}>{items.length} προϊόντα</div>
                      )}
                    </div>
                    {/* Budget progress bar */}
                    {shoppingBudget && (
                      <div style={{ marginTop:10 }}>
                        <div style={{ display:'flex', justifyContent:'space-between', fontSize:11, color:'var(--text-secondary)', marginBottom:4 }}>
                          <span>Προϋπολογισμός: <strong style={{ color:budgetColor }}>{totalCost.toFixed(2)}€</strong> / {shoppingBudget.toFixed(2)}€</span>
                          <span
                            style={{ cursor:'pointer', color:'var(--text-muted)', fontSize:10 }}
                            onClick={() => { setShoppingBudget(null); localStorage.removeItem('sg_budget'); }}
                          >✕ Αφαίρεση</span>
                        </div>
                        <div className="budget-progress-bar">
                          <div className="budget-progress-fill" style={{ width:`${(budgetPct * 100).toFixed(1)}%`, background:`linear-gradient(90deg, #10b981, ${budgetColor})` }} />
                        </div>
                        {budgetPct >= 1 && <div style={{ fontSize:11, color:'#ef4444', fontWeight:700, marginTop:4 }}>⚠️ Υπέρβαση budget κατά {(totalCost - shoppingBudget).toFixed(2)}€</div>}
                      </div>
                    )}
                    {/* Set budget prompt */}
                    {!shoppingBudget && user && (
                      showBudgetInput ? (
                        <div style={{ display:'flex', gap:6, marginTop:8, alignItems:'center' }}>
                          <input
                            type="number" min="1" step="1" placeholder="π.χ. 50"
                            value={budgetInputVal}
                            onChange={e => setBudgetInputVal(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter' && budgetInputVal) {
                                const v = parseFloat(budgetInputVal);
                                if (v > 0) { setShoppingBudget(v); localStorage.setItem('sg_budget', v); }
                                setShowBudgetInput(false); setBudgetInputVal('');
                              }
                              if (e.key === 'Escape') { setShowBudgetInput(false); setBudgetInputVal(''); }
                            }}
                            autoFocus
                            style={{ width:90, padding:'5px 10px', borderRadius:8, border:'1px solid var(--border)', background:'var(--bg-input)', color:'var(--text-primary)', fontSize:13, outline:'none' }}
                          />
                          <button
                            onClick={() => {
                              const v = parseFloat(budgetInputVal);
                              if (v > 0) { setShoppingBudget(v); localStorage.setItem('sg_budget', v); }
                              setShowBudgetInput(false); setBudgetInputVal('');
                            }}
                            style={{ padding:'5px 12px', borderRadius:8, background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', border:'none', fontSize:12, fontWeight:700, cursor:'pointer' }}
                          >OK</button>
                          <button onClick={() => { setShowBudgetInput(false); setBudgetInputVal(''); }}
                            style={{ padding:'5px 8px', borderRadius:8, background:'var(--bg-surface)', border:'1px solid var(--border)', color:'var(--text-secondary)', fontSize:12, cursor:'pointer' }}>✕</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setShowBudgetInput(true)}
                          style={{ marginTop:8, padding:'4px 10px', borderRadius:8, border:'1px dashed var(--border)', background:'transparent', color:'var(--text-secondary)', fontSize:11, cursor:'pointer', fontWeight:600 }}
                        >💰 Βάλε budget</button>
                      )
                    )}
                  </div>
                  <div style={{ display:'flex', gap:'8px', marginLeft:12, alignItems:'center' }}>
                    <button onClick={handleMassClear} style={{ background:'rgba(239,68,68,0.1)', color:'var(--brand-danger)', border:'none', padding:'10px', borderRadius:'10px', cursor:'pointer', fontSize:18 }} title="Αδείασμα">🗑️</button>
                    {user && <button onClick={saveCurrentList} style={{ background:'linear-gradient(135deg,#059669,#10b981)', color:'white', border:'none', padding:'10px 16px', borderRadius:'10px', cursor:'pointer', fontWeight:'bold', fontSize:13 }} title="Αποθήκευση">💾 Αποθήκευση</button>}
                  </div>
                </div>
              </div>
            )}

            {/* Smart Shopping Panel */}
            {items.length > 0 && smartStoreGroups.length > 1 && (
              <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, marginBottom:12, overflow:'hidden' }}>
                <div onClick={() => setShowSmartShopping(s => !s)}
                  style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'12px 16px', cursor:'pointer', transition:'background 0.2s' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:34, height:34, borderRadius:10, background:'linear-gradient(135deg,#f59e0b,#d97706)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                      <IconBuildingStore size={17} color="#fff" stroke={2}/>
                    </div>
                    <div>
                      <div style={{ fontWeight:800, fontSize:14, color:'var(--text-primary)' }}>Έξυπνες Αγορές</div>
                      <div style={{ fontSize:11, color:'var(--text-secondary)' }}>{smartStoreGroups.length} καταστήματα · βέλτιστη διαδρομή</div>
                    </div>
                  </div>
                  <div style={{ fontSize:13, color:'var(--text-secondary)', fontWeight:700, transition:'transform 0.3s', transform: showSmartShopping ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</div>
                </div>
                {showSmartShopping && (
                  <div style={{ padding:'0 16px 16px', animation:'slideUpFadeIn 0.3s ease' }}>
                    {/* Route summary */}
                    <div style={{ display:'flex', gap:6, marginBottom:12, overflowX:'auto', paddingBottom:4 }}>
                      {smartStoreGroups.map(([store], i) => (
                        <div key={store} style={{ flexShrink:0, display:'flex', alignItems:'center', gap:6 }}>
                          <div style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.1))', border:'1px solid rgba(99,102,241,0.2)', borderRadius:20, padding:'5px 12px', fontSize:12, fontWeight:700, color:'#6366f1', whiteSpace:'nowrap' }}>
                            {i+1}. {store}
                          </div>
                          {i < smartStoreGroups.length - 1 && <span style={{ color:'var(--text-muted)', fontSize:14, flexShrink:0 }}>→</span>}
                        </div>
                      ))}
                    </div>
                    {/* Per-store breakdown */}
                    {smartStoreGroups.map(([store, data]) => (
                      <div key={store} style={{ marginBottom:10 }}>
                        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:6 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:7 }}>
                            <div style={{ width:8, height:8, borderRadius:'50%', background:'#6366f1' }}/>
                            <span style={{ fontWeight:800, fontSize:13, color:'var(--text-primary)' }}>{store}</span>
                            <span style={{ fontSize:11, color:'var(--text-secondary)', background:'var(--bg-surface)', borderRadius:20, padding:'2px 8px', border:'1px solid var(--border)' }}>{data.items.length} προϊόντα</span>
                          </div>
                          <span style={{ fontWeight:900, fontSize:14, color:'#10b981' }}>{data.total.toFixed(2)}€</span>
                        </div>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                          {data.items.slice(0,6).map(item => (
                            <span key={item.id} style={{ fontSize:11, padding:'3px 9px', background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:20, color:'var(--text-secondary)', fontWeight:600 }}>
                              {item.text}{item.price > 0 ? ` · ${item.price.toFixed(2)}€` : ''}
                            </span>
                          ))}
                          {data.items.length > 6 && <span style={{ fontSize:11, padding:'3px 9px', background:'rgba(99,102,241,0.08)', border:'1px solid rgba(99,102,241,0.2)', borderRadius:20, color:'#6366f1', fontWeight:700 }}>+{data.items.length-6} ακόμα</span>}
                        </div>
                      </div>
                    ))}
                    {itemsWithoutStore.length > 0 && (
                      <div style={{ borderTop:'1px solid var(--border)', paddingTop:10, marginTop:4 }}>
                        <div style={{ fontSize:11, color:'var(--text-muted)', fontWeight:700, marginBottom:6 }}>🔍 Χωρίς τιμή/κατάστημα</div>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                          {itemsWithoutStore.slice(0,4).map(i => <span key={i.id} style={{ fontSize:11, padding:'3px 9px', background:'var(--bg-surface)', border:'1px solid var(--border)', borderRadius:20, color:'var(--text-muted)' }}>{i.text}</span>)}
                          {itemsWithoutStore.length > 4 && <span style={{ fontSize:11, color:'var(--text-muted)', padding:'3px 9px' }}>+{itemsWithoutStore.length-4} ακόμα</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {user && items.length > 0 && <CalorieSummary items={items} />}
            <ServerStatusBar isWakingUp={isServerWaking} />

            {/* Search */}
            <div className="smart-search-wrapper">
              {user && (
              <div className="store-filter-container">
                {storeOptions.map(store => (
                  <button
                    key={store}
                    className={`store-chip ${selectedStore === store ? 'active' : ''}`}
                    onClick={() => { setSelectedStore(store); triggerSearch(inputValue, store); }}
                  >
                    {SUPERMARKET_LOGOS[store] ? (
                      <img src={SUPERMARKET_LOGOS[store]} alt={store} className="store-chip-logo" onError={e => { e.currentTarget.style.display='none'; }} />
                    ) : null}
                    <span className="store-chip-label">{store === 'Όλα' ? '🏪 Όλα' : store}</span>
                  </button>
                ))}
              </div>
              )}

              <div className="input-section input-section--v2" style={{ position:'relative' }}>
                <span className="input-search-icon" aria-hidden="true">
                  <IconSearch size={18} stroke={2} />
                </span>
                <input
                  className="search-input"
                  type="text"
                  placeholder={!isOnline ? '📡 Offline — αναζήτηση μη διαθέσιμη' : user ? 'Αναζήτηση προϊόντος...' : 'Γράψε προϊόν για να ξεκινήσεις...'}
                  value={inputValue}
                  onChange={user ? handleInputChange : (e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { user ? triggerSearch(inputValue, selectedStore) : addPlainItem(); } }}
                  onFocus={() => setSearchInputFocused(true)}
                  onBlur={() => setTimeout(() => setSearchInputFocused(false), 200)}
                  readOnly={!isOnline}
                  style={!isOnline ? { cursor:'not-allowed', opacity:0.7 } : {}}
                />
                {user && (
                  <button className={`voice-btn ${isListening ? 'listening' : ''}`} onClick={handleVoiceClick} title="Φωνητική αναζήτηση">
                    {isListening ? <IconX size={16} /> : <IconMicrophone size={16} />}
                  </button>
                )}
                <button
                  className="search-submit-btn"
                  onClick={() => user ? triggerSearch(inputValue, selectedStore) : addPlainItem()}
                  title={user ? 'Αναζήτηση' : 'Προσθήκη'}
                >
                  {user ? <IconSearch size={17} stroke={2.5} /> : <IconPlus size={17} stroke={2.5} />}
                </button>
              </div>

              {/* ── Recent searches — shown when focused with empty input ── */}
              {searchInputFocused && !inputValue.trim() && !suggestions.length && !isSearching && recentSearches.length > 0 && (
                <div className="suggestions-dropdown sug-recents-panel">
                  <div className="sug-header">
                    <span className="sug-recents-label">🕐 Πρόσφατες αναζητήσεις</span>
                    <button className="sug-clear" onClick={() => {
                      setRecentSearches([]);
                      try { localStorage.removeItem('sg_recent_searches'); } catch {}
                    }}><IconTrash size={13} stroke={2} /></button>
                  </div>
                  {recentSearches.map((term, i) => (
                    <div key={i} className="sug-recent-item" onClick={() => {
                      setInputValue(term);
                      triggerSearch(term, selectedStore);
                    }}>
                      <span className="sug-recent-icon">🔍</span>
                      <span className="sug-recent-text">{term}</span>
                      <span className="sug-recent-arrow">›</span>
                    </div>
                  ))}
                </div>
              )}

              {/* ── Skeleton while loading ── */}
              {isSearching && !suggestions.length && (
                <div className="suggestions-dropdown">
                  <div className="sug-header">
                    <span className="sug-count sug-count-loading">Αναζήτηση<span className="sug-dots"><span/><span/><span/></span></span>
                  </div>
                  {[1,2,3].map(i => <SuggestionSkeleton key={i} />)}
                </div>
              )}

              {/* ── No results ── */}
              {!isSearching && noResults && inputValue.trim().length >= 2 && (
                <div className="suggestions-dropdown">
                  <div className="sug-no-results">
                    <span className="sug-no-results-icon">🔍</span>
                    <p className="sug-no-results-title">Δεν βρέθηκαν αποτελέσματα</p>
                    <p className="sug-no-results-sub">Δοκίμασε διαφορετική λέξη ή αλλαγή καταστήματος</p>
                    {recentSearches.length > 0 && (
                      <div className="sug-no-results-recents">
                        <p className="sug-no-results-recents-label">Δοκίμασε:</p>
                        <div className="sug-no-results-chips">
                          {recentSearches.slice(0, 3).map((t, i) => (
                            <button key={i} className="sug-chip" onClick={() => {
                              setInputValue(t);
                              triggerSearch(t, selectedStore);
                            }}>{t}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* ── Premium search results ── */}
              {suggestions.length > 0 && (
                <div className="suggestions-dropdown">
                  {/* Rich header: count + stores + price range + sort */}
                  {(() => {
                    const prices     = suggestions.map(s => s.price).filter(Boolean);
                    const minP       = prices.length ? Math.min(...prices) : null;
                    const maxP       = prices.length ? Math.max(...prices) : null;
                    const storeSet   = new Set(suggestions.map(s => s.supermarket).filter(Boolean));
                    const storeCount = storeSet.size;
                    const hasPriceRange = minP && maxP && parseFloat((maxP - minP).toFixed(2)) > 0;
                    return (
                      <div className="sug-header sug-header-rich">
                        <div className="sug-header-left">
                          <span className="sug-count">{suggestions.length} αποτελέσματα</span>
                          {storeCount > 1 && <span className="sug-meta-pill">🏪 {storeCount} καταστήματα</span>}
                          {hasPriceRange && <span className="sug-meta-pill sug-price-range-pill">€{minP.toFixed(2)} – €{maxP.toFixed(2)}</span>}
                        </div>
                        <div className="sug-header-right">
                          <button
                            className={`sug-sort-btn${searchSort === 'price' ? ' active' : ''}`}
                            onClick={() => setSearchSort(s => s === 'price' ? 'relevance' : 'price')}
                          >
                            {searchSort === 'price' ? '↑ Τιμή' : '⇅'}
                          </button>
                          <button className="sug-clear" onClick={() => {
                            setSuggestions([]);
                            setNoResults(false);
                            setInputValue('');
                            setSearchInputFocused(false);
                          }}>✕</button>
                        </div>
                      </div>
                    );
                  })()}

                  {/* Result items */}
                  {(() => {
                    const sorted   = searchSort === 'price'
                      ? [...suggestions].sort((a, b) => (a.price || 9999) - (b.price || 9999))
                      : suggestions;
                    const minPrice = Math.min(...suggestions.map(s => s.price || Infinity));
                    return sorted.map((sug, idx) => {
                      const cat      = getCategory(sug.name);
                      const emoji    = getCatEmoji(cat);
                      const gradient = getCatGradient(cat);
                      const isBest   = sug.price && sug.price === minPrice && suggestions.length > 1;
                      return (
                        <div
                          key={sug._id || idx}
                          className={`suggestion-item tilt-card${isBest ? ' suggestion-item-best' : ''}`}
                          onClick={() => addFromSuggestion(sug)}
                          style={{ animationDelay: `${idx * 25}ms` }}
                          onMouseMove={e => {
                            const card = e.currentTarget;
                            const rect = card.getBoundingClientRect();
                            const x = (e.clientX - rect.left) / rect.width  - 0.5;
                            const y = (e.clientY - rect.top)  / rect.height - 0.5;
                            card.style.setProperty('--tilt-x', `${-y * 6}deg`);
                            card.style.setProperty('--tilt-y', `${ x * 6}deg`);
                            card.style.setProperty('--glare-x', `${(x + 0.5) * 100}%`);
                            card.style.setProperty('--glare-y', `${(y + 0.5) * 100}%`);
                          }}
                          onMouseLeave={e => {
                            const card = e.currentTarget;
                            card.style.setProperty('--tilt-x', '0deg');
                            card.style.setProperty('--tilt-y', '0deg');
                          }}
                        >
                          <div className="sug-avatar">
                            {sug.imageUrl ? (
                              <img
                                src={sug.imageUrl}
                                alt={sug.name}
                                className="sug-avatar-img"
                                loading="lazy"
                                onError={e => { e.currentTarget.style.display='none'; e.currentTarget.nextSibling.style.display='flex'; }}
                              />
                            ) : null}
                            <div className="sug-avatar-fallback" style={{ display: sug.imageUrl ? 'none' : 'flex' }}>
                              <span>{sug.name.charAt(0).toUpperCase()}</span>
                            </div>
                          </div>
                          <div className="sug-info">
                            <span className="sug-name">{sug.name}</span>
                            <div className="sug-meta">
                              {SUPERMARKET_LOGOS[sug.supermarket] && (
                                <img src={SUPERMARKET_LOGOS[sug.supermarket]} alt={sug.supermarket} className="sug-logo" />
                              )}
                              <span className="sug-store">{sug.supermarket}</span>
                              {isBest && <span className="sug-best-badge">✓ Καλύτερη τιμή</span>}
                            </div>
                          </div>
                          <div className="sug-price-col">
                            <strong className={`sug-price${isBest ? ' sug-price-best' : ''}`}>{sug.price?.toFixed(2)}€</strong>
                            {/* Price comparison badges */}
                            {(() => {
                              const name = (sug.name || '').toLowerCase().trim();
                              const allPrices = suggestions
                                .filter(s => (s.name || '').toLowerCase().trim() === name && s.price)
                                .map(s => ({ store: s.supermarket || '', price: parseFloat(s.price) }))
                                .filter((s, i, arr) => arr.findIndex(x => x.store === s.store) === i)
                                .sort((a, b) => a.price - b.price);
                              if (allPrices.length < 2) return null;
                              const bestPrice = allPrices[0].price;
                              return (
                                <div className="price-compare-row">
                                  {allPrices.slice(0, 3).map((p, i) => (
                                    <span
                                      key={p.store}
                                      className={`price-compare-badge ${p.price === bestPrice ? 'best-price' : 'other-price'}`}
                                      style={{ '--badge-i': i }}
                                    >
                                      {p.store.charAt(0).toUpperCase()}{p.store.slice(1, 4)} {p.price.toFixed(2)}€
                                    </span>
                                  ))}
                                </div>
                              );
                            })()}
                            <div className="sug-add-btn">+</div>
                          </div>
                        </div>
                      );
                    });
                  })()}

                  {suggestions.length >= 10 && (
                    <div className="sug-footer">Εμφανίζονται τα {suggestions.length} πρώτα αποτελέσματα</div>
                  )}
                </div>
              )}
            </div>

            {/* Typing indicator banner */}
            {Object.entries(friendsTyping).length > 0 && (
              <div style={{
                padding: '6px 14px',
                marginBottom: 8,
                borderRadius: 10,
                background: 'var(--bg-subtle)',
                fontSize: 12,
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span style={{ display:'inline-flex', gap:2 }}>
                  {[0,1,2].map(i => (
                    <span key={i} style={{
                      width: 5, height: 5, borderRadius: '50%',
                      background: 'var(--accent)',
                      animation: `typingDot 1s ${i * 0.2}s infinite ease-in-out`,
                    }} />
                  ))}
                </span>
                {Object.values(friendsTyping).join(', ')} γράφει…
              </div>
            )}

            {items.length === 0 ? (
              <div className="empty-cart-state list-empty-v4">
                <span className="empty-state-icon empty-cart-icon list-empty-illustration" style={{ fontSize: '4rem', display: 'block', marginBottom: 16 }}>🛒</span>
                <h2 className="empty-cart-heading list-empty-title">Η λίστα είναι άδεια</h2>
                <p className="list-empty-desc" style={{ marginBottom: 18 }}>
                  {user
                    ? 'Αναζήτησε προϊόντα παραπάνω ή χρησιμοποίησε 🎤 για φωνητική εισαγωγή'
                    : 'Γράψε ό,τι χρειάζεσαι και πάτα + για να το προσθέσεις'}
                </p>
                {/* Quick-add suggestions */}
                <div style={{ display:'flex', flexWrap:'wrap', gap:7, justifyContent:'center', marginBottom: user ? 16 : 16 }}>
                  {['🥛 Γάλα','🍞 Ψωμί','🥚 Αυγά','🍌 Μπανάνες','🧀 Τυρί'].map(chip => {
                    const name = chip.split(' ').slice(1).join(' ');
                    return (
                      <button key={chip}
                        onClick={() => {
                          if (user) { setInputValue(name); document.querySelector('.search-input')?.focus(); }
                          else { setItems(prev => [...prev, { id: Date.now()+Math.random(), text:name, price:0, store:'', quantity:1, category: getCategory(name) }]); if(navigator.vibrate) navigator.vibrate(20); }
                        }}
                        style={{ padding:'7px 13px', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:20, fontSize:13, fontWeight:600, cursor:'pointer', color:'var(--text-primary)', fontFamily:'var(--font)', transition:'all 0.22s cubic-bezier(0.34,1.56,0.64,1)' }}
                        onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px) scale(1.06)'; e.currentTarget.style.boxShadow='0 4px 12px rgba(0,0,0,0.1)';}}
                        onMouseLeave={e=>{e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow='';}}
                      >{chip}</button>
                    );
                  })}
                </div>
                {/* Scanner Promo */}
                <div className="scanner-promo-card" onClick={openBarcodeScanner}>
                  <div className="scanner-promo-icon-wrap">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2"/>
                      <rect x="7" y="7" width="10" height="10" rx="1"/>
                    </svg>
                  </div>
                  <div className="scanner-promo-text">
                    <div className="scanner-promo-title">Σάρωσε προϊόν</div>
                    <div className="scanner-promo-desc">Ανίχνευσε barcode για θρεπτικά στοιχεία</div>
                  </div>
                  <div className="scanner-promo-arrow">→</div>
                </div>
                {!user && <button className="locked-unlock-btn" style={{ marginTop:'8px' }} onClick={() => setShowAuthModal(true)}>Σύνδεση για τιμές, συνταγές & άλλα</button>}
              </div>
            ) : (
              <div className="categories-container stagger-list">
                {Object.keys(groupedItems).sort().map(cat => (
                  <div key={cat} className="category-group">
                    <h2 className="category-title">{cat}</h2>
                    <ul className="grocery-list stagger-list">
                      {groupedItems[cat].map(item => (
                        <SwipeableItem key={item.id} item={item} onDelete={deleteItem} onSend={handleSendToFriend} onToggleCheck={toggleItemCheck} onChangeQty={changeItemQty} user={user} />
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
          <div key="recipes" className="tab-content recipes-tab page-enter">
            <>
                {!isOnline && (
                  <div className="offline-banner">
                    <span>📡</span>
                    <span><strong>Offline</strong> — εμφανίζονται οι τελευταίες αποθηκευμένες συνταγές.</span>
                  </div>
                )}

                {/* ── Tab header ── */}
                <div className="recipes-tab-header">
                  <div>
                    <h2 className="recipes-tab-title">Συνταγές</h2>
                    {!recipesLoading && filteredRecipes.length > 0 && (
                      <p className="recipes-tab-subtitle">
                        {recipes.length}+ συνταγές
                        {recipeCategory && <> · <strong>{recipeCategory}</strong></>}
                        {fridgeQuery && <> · «{fridgeQuery}»</>}
                      </p>
                    )}
                  </div>
                  <button
                    className={`recipe-cat-pill fav-pill ${showFavoritesOnly ? 'active' : ''}`}
                    style={{ flexShrink: 0 }}
                    onClick={() => { setShowFavoritesOnly(v => !v); setRecipeCategory(''); setRecipePage(1); }}
                  >
                    ❤️ {favoriteRecipes.length > 0 && <span className="fav-count">{favoriteRecipes.length}</span>}
                  </button>
                </div>

                {/* ── Συνταγή της Ημέρας ── */}
                {!showFavoritesOnly && !fridgeQuery && !recipeCategory && recipes.length > 0 && (() => {
                  const dayIdx   = Math.floor(Date.now() / 86400000);
                  const daily    = recipes[dayIdx % recipes.length];
                  if (!daily) return null;
                  return (
                    <div
                      className="daily-recipe-card"
                      onClick={() => setExpandedRecipe(daily)}
                    >
                      {(daily.image || daily.thumbnail) && (
                        <img src={toAbsoluteMediaUrl(daily.image || daily.thumbnail)} alt={daily.title} className="daily-recipe-img" loading="lazy" />
                      )}
                      <div className="daily-recipe-body">
                        <div className="daily-recipe-badge">⭐ Συνταγή της Ημέρας</div>
                        <div className="daily-recipe-title">{daily.title}</div>
                        <div className="daily-recipe-meta">
                          {daily.kcal && <span>🔥 {daily.kcal} kcal</span>}
                          {daily.cookTime && <span>⏱ {daily.cookTime} λεπτ.</span>}
                          {daily.cuisine && <span>🌍 {daily.cuisine}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })()}

                {/* ── Search Bar ── */}
                <div className="recipe-search-bar">
                  <div className="recipe-search-inner">
                    <IconSearch size={18} stroke={2} style={{ color:'var(--text-muted)', flexShrink:0 }} />
                    <input
                      type="text"
                      placeholder="Αναζήτηση συνταγής ή υλικού..."
                      value={fridgeQuery}
                      onChange={(e) => setFridgeQuery(e.target.value)}
                      className="recipe-search-input"
                    />
                    {fridgeQuery && (
                      <button onClick={() => setFridgeQuery('')} className="recipe-search-clear">
                        <IconX size={16} />
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Category Pills ── */}
                <div className="recipe-category-scroll">
                  {[
                    { id: '', label: '🍽️ Όλες' },
                    { id: 'Κυρίως', label: '🥘 Κυρίως' },
                    { id: 'Σαλάτες', label: '🥗 Σαλάτες' },
                    { id: 'Σούπες', label: '🍲 Σούπες' },
                    { id: 'Πρωινό', label: '🍳 Πρωινό' },
                    { id: 'Σνακ', label: '🍏 Σνακ' },
                    { id: 'Επιδόρπια', label: '🍰 Γλυκά' },
                    { id: 'Συνοδευτικά', label: '🫙 Συνοδευτικά' },
                  ].map(cat => (
                    <button
                      key={cat.id}
                      className={`recipe-cat-pill ${recipeCategory === cat.id && !showFavoritesOnly ? 'active' : ''}`}
                      onClick={() => { setRecipeCategory(cat.id); setShowFavoritesOnly(false); setRecipePage(1); }}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {/* ── Filter Chips ── */}
                <div className="recipe-filters">
                  {[
                    { id:'all',     label:'Όλες' },
                    { id:'protein', label:'💪 Πρωτεΐνη' },
                    { id:'fast',    label:'⚡ Γρήγορες' },
                    { id:'vegan',   label:'🌱 Vegan' },
                    { id:'nosugar', label:'🚫 Χ. Ζάχαρη' },
                    { id:'budget',  label:'💰 Λίγα Υλικά' },
                  ].map(f => (
                    <button
                      key={f.id}
                      className={`filter-btn ${recipeFilter === f.id ? 'active' : ''}`}
                      onClick={() => setRecipeFilter(f.id)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                {/* ── Loading skeletons ── */}
                {recipesLoading && recipes.length === 0 && (
                  <div className="recipes-grid">
                    <div style={{ gridColumn:'1/-1', textAlign:'center', padding:'16px 0 8px', fontSize:13, color:'var(--text-secondary)', display:'flex', alignItems:'center', justifyContent:'center', gap:8 }}>
                      <div style={{ width:8, height:8, borderRadius:'50%', background:'var(--accent)', animation:'pulseDot 1.4s ease-in-out infinite' }} />
                      {isServerWaking ? 'Ο server ξυπνάει (~15 δευτ.)...' : 'Φόρτωση συνταγών...'}
                    </div>
                    {[1,2,3,4].map(i => (
                      <div key={i} style={{ background:'var(--bg-card)', borderRadius:18, border:'1px solid var(--border)', overflow:'hidden' }}>
                        <div className="skeleton" style={{ height:135, borderRadius:0 }} />
                        <div style={{ padding:'12px 14px', display:'flex', flexDirection:'column', gap:8 }}>
                          <div className="skeleton" style={{ height:14, width:'80%', borderRadius:8 }} />
                          <div className="skeleton" style={{ height:11, width:'50%', borderRadius:8 }} />
                          <div style={{ display:'flex', gap:5, marginTop:6 }}>
                            <div className="skeleton" style={{ height:26, width:55, borderRadius:10 }} />
                            <div className="skeleton" style={{ height:26, width:55, borderRadius:10 }} />
                            <div className="skeleton" style={{ height:26, width:55, borderRadius:10 }} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Empty / error state ── */}
                {!recipesLoading && filteredRecipes.length === 0 && (
                  <div style={{ textAlign:'center', padding:'48px 20px', background:'var(--bg-surface)', border:'2px dashed var(--border-light)', borderRadius:20 }}>
                    <div style={{ fontSize:52, marginBottom:16 }}>{showFavoritesOnly ? '❤️' : '🍽️'}</div>
                    {showFavoritesOnly ? (
                      <>
                        <h3 style={{ margin:'0 0 8px', fontSize:17, fontWeight:800 }}>Δεν έχεις αγαπημένες συνταγές</h3>
                        <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:16 }}>Πάτα το 🤍 σε μια συνταγή για να την αποθηκεύσεις</p>
                        <button className="submit-btn" style={{ padding:'10px 24px', fontSize:13 }} onClick={() => setShowFavoritesOnly(false)}>
                          🍽️ Εξερεύνηση Συνταγών
                        </button>
                      </>
                    ) : recipes.length === 0 ? (
                      <>
                        <h3 style={{ margin:'0 0 8px', fontSize:17, fontWeight:800 }}>Δεν φορτώθηκαν συνταγές</h3>
                        <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:16 }}>
                          {isOnline ? 'Ο server μπορεί να ξυπνάει (~15 δευτ.)' : 'Δεν υπάρχει σύνδεση'}
                        </p>
                        {isOnline && (
                          <button className="submit-btn" style={{ padding:'10px 24px', fontSize:13 }} onClick={() => fetchRecipes(1)}>
                            🔄 Δοκιμή ξανά
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <h3 style={{ margin:'0 0 8px', fontSize:17, fontWeight:800 }}>Κανένα αποτέλεσμα</h3>
                        <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:16 }}>Δοκίμασε διαφορετικό φίλτρο ή αναζήτηση</p>
                        <button className="submit-btn" style={{ padding:'10px 24px', fontSize:13 }} onClick={() => { setRecipeFilter('all'); setRecipeCategory(''); setFridgeQuery(''); }}>
                          ↩️ Εμφάνιση Όλων
                        </button>
                      </>
                    )}
                  </div>
                )}

                {/* ── Recipe Cards Grid — Premium v2 ── */}
                {filteredRecipes.length > 0 && (
                  <>
                    <div className="recipes-grid">
                      {filteredRecipes.map((recipe, idx) => (
                        // ScrollReveal fires per-card when it enters the viewport —
                        // works for initial render AND infinite-scroll appended cards.
                        <ScrollReveal
                          key={recipe._id || recipe.title}
                          delay={Math.min((idx % 6) * 55, 280)}
                          y={20}
                        >
                          <div
                            className="recipe-card-v2"
                            onClick={() => setExpandedRecipe(recipe)}
                            style={{ animationName: 'none' }} // disable old CSS-only animation now that ScrollReveal handles entrance
                          >
                            <div className="recipe-card-img-wrap">
                              <LazyImage
                                src={toAbsoluteMediaUrl(recipe.image || recipe.thumbnail || '')}
                                className="recipe-card-img"
                                style={!(recipe.image || recipe.thumbnail) ? { height:135, background:'linear-gradient(135deg, var(--bg-subtle), var(--bg-card))', display:'flex', alignItems:'center', justifyContent:'center' } : {}}
                              >
                                {!(recipe.image || recipe.thumbnail) && <span style={{ fontSize:36, opacity:0.3 }}>🍽️</span>}
                              </LazyImage>
                              <div className="recipe-card-time-badge">⏱️ {recipe.time || 30}'</div>
                              <div style={{ position:'absolute', top:10, left:10, width:8, height:8, borderRadius:'50%', zIndex:2, background: recipe.difficulty === 'Εύκολη' ? '#10b981' : recipe.difficulty === 'Δύσκολη' ? '#ef4444' : '#f59e0b' }} />
                              <button
                                className={`recipe-fav-btn ${favoriteIds.includes(recipe._id) ? 'is-fav' : ''}`}
                                onClick={(e) => { e.stopPropagation(); toggleFavorite(recipe._id); }}
                                aria-label={favoriteIds.includes(recipe._id) ? 'Αφαίρεση από αγαπημένα' : 'Προσθήκη στα αγαπημένα'}
                              >
                                {favoriteIds.includes(recipe._id) ? '❤️' : '🤍'}
                              </button>
                            </div>

                            <div className="recipe-card-body">
                              <h4 className="recipe-card-title">{cleanRecipeTitle(recipe.title)}</h4>
                              <div className="recipe-card-meta">
                                <span>{recipe.ingredients?.length || 0} υλικά</span>
                                {recipe.cuisine && recipe.cuisine !== 'Διεθνής' && (
                                  <>
                                    <span style={{ opacity:0.4 }}>·</span>
                                    <span>{recipe.cuisine}</span>
                                  </>
                                )}
                              </div>
                              <div className="recipe-card-macros">
                                {recipe.calories && <span className="macro-pill macro-kcal">🔥 {recipe.calories}</span>}
                                {recipe.protein && <span className="macro-pill macro-protein">💪 {recipe.protein}g</span>}
                                {recipe.carbs && <span className="macro-pill macro-carbs">⚡ {recipe.carbs}g</span>}
                              </div>
                            </div>
                          </div>
                        </ScrollReveal>
                      ))}
                    </div>

                    {/* ── Load More button ── */}
                    {!showFavoritesOnly && (
                      <div className="recipes-load-more-sentinel">
                        {recipesLoading && (
                          <div className="recipes-loading-row">
                            <div className="spinner-sm" />
                            Φόρτωση περισσότερων...
                          </div>
                        )}
                        {!recipesLoading && recipePage < recipeTotalPages && (
                          <button className="load-more-btn" onClick={loadMoreRecipes}>
                            Φόρτωση περισσότερων συνταγών ↓
                          </button>
                        )}
                        {!recipesLoading && recipePage >= recipeTotalPages && recipes.length > 0 && (
                          <div className="recipes-end-label">
                            Εμφανίζονται όλες οι συνταγές ({recipes.length})
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* ── TheMealDB: Διεθνείς Συνταγές Section ── */}
                {isOnline && (() => {
                  const TABS = [
                    { id: 'greek',         label: '🇬🇷 Ελληνικές' },
                    { id: 'mediterranean', label: '☀️ Μεσογειακές' },
                  ];
                  const activeIdx = TABS.findIndex(t => t.id === mealDbTab);

                  return (
                    <div className="mealdb-section">
                      {/* ── Header row ── */}
                      <div className="mealdb-header">
                        <div className="mealdb-header-left">
                          <div className="mealdb-title">
                            <span className="mealdb-globe">🌍</span>
                            Διεθνείς Συνταγές
                          </div>
                          <div className="mealdb-subtitle">
                            Από το TheMealDB — μεταφρασμένες στα ελληνικά
                          </div>
                        </div>

                        {/* Animated tab switcher */}
                        <div className="mealdb-tabs" ref={mealDbTabsRef}>
                          {/* Sliding pill — positioned via JS widths */}
                          {(() => {
                            const tabsEl   = mealDbTabsRef.current;
                            const btnEls   = tabsEl ? tabsEl.querySelectorAll('.mealdb-tab-btn') : [];
                            const activeEl = btnEls[activeIdx];
                            const left  = activeEl ? activeEl.offsetLeft : 0;
                            const width = activeEl ? activeEl.offsetWidth : 0;
                            return (
                              <span
                                className="mealdb-tab-pill"
                                style={{ left, width }}
                              />
                            );
                          })()}
                          {TABS.map(t => (
                            <button
                              key={t.id}
                              className={`mealdb-tab-btn${mealDbTab === t.id ? ' active' : ''}`}
                              onClick={() => { setMealDbTab(t.id); fetchMealDb(t.id); }}
                            >
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* ── Content panel ── */}
                      {mealDbLoading ? (
                        /* Skeleton grid */
                        <div className="mealdb-skeleton">
                          {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="mealdb-skeleton-card"
                              style={{ animationDelay: `${i * 0.06}s` }} />
                          ))}
                        </div>
                      ) : mealDbRecipes.length === 0 ? (
                        <div style={{ textAlign:'center', color:'var(--text-muted)', fontSize:13, padding:'24px 0' }}>
                          Δεν βρέθηκαν συνταγές.
                        </div>
                      ) : (
                        <div key={mealDbPanelKey} className="mealdb-panel">
                          <div className="mealdb-grid">
                            {mealDbRecipes.slice(0, mealDbPage * MEALDB_PER_PAGE).map((meal, idx) => (
                              <div
                                key={meal._id}
                                className="mealdb-card"
                                style={{ animationDelay: `${Math.min(idx, 9) * 0.05}s`, cursor:'pointer' }}
                                onClick={() => setSelectedMealDbRecipe(meal)}
                              >
                                {/* Image */}
                                {meal.image && (
                                  <div className="mealdb-card-img-wrap">
                                    <img
                                      src={meal.image}
                                      alt={meal.title}
                                      className="mealdb-card-img"
                                      loading="lazy"
                                    />
                                    {meal.area && (
                                      <span className="mealdb-card-area-badge">{meal.area}</span>
                                    )}
                                    {/* Favorite heart */}
                                    <button
                                      className={`recipe-fav-btn${mealDbFavIds.includes(String(meal._id)) ? ' is-fav' : ''}`}
                                      style={{ position:'absolute', top:8, right:8 }}
                                      onClick={(e) => { e.stopPropagation(); toggleMealdbFavorite(meal); }}
                                      aria-label={mealDbFavIds.includes(String(meal._id)) ? 'Αφαίρεση από αγαπημένα' : 'Προσθήκη στα αγαπημένα'}
                                    >
                                      {mealDbFavIds.includes(String(meal._id)) ? '❤️' : '🤍'}
                                    </button>
                                  </div>
                                )}

                                {/* Body */}
                                <div className="mealdb-card-body">
                                  <div className="mealdb-card-title">{meal.title}</div>
                                  <div>
                                    {meal.category && (
                                      <span className="mealdb-chip mealdb-chip-category">{meal.category}</span>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Load more */}
                          {mealDbPage * MEALDB_PER_PAGE < mealDbRecipes.length && (
                            <div style={{ textAlign:'center', marginTop:16 }}>
                              <button
                                className="mealdb-load-more-btn"
                                onClick={() => setMealDbPage(p => p + 1)}
                              >
                                Φόρτωση περισσότερων
                                <span className="mealdb-load-more-count">
                                  +{Math.min(MEALDB_PER_PAGE, mealDbRecipes.length - mealDbPage * MEALDB_PER_PAGE)}
                                </span>
                              </button>
                            </div>
                          )}
                          {mealDbPage * MEALDB_PER_PAGE >= mealDbRecipes.length && mealDbRecipes.length > MEALDB_PER_PAGE && (
                            <div style={{ textAlign:'center', fontSize:12, color:'var(--text-muted)', marginTop:14, fontWeight:600 }}>
                              Εμφανίζονται όλες οι συνταγές ({mealDbRecipes.length}) ✓
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* ── Recipe Popup Modal ── */}
                {expandedRecipe && (
                    <RecipePopup
                      recipe={expandedRecipe}
                      onClose={() => setExpandedRecipe(null)}
                      onAddToList={() => addRecipeToList(expandedRecipe)}
                      isFavorite={favoriteIds.includes(expandedRecipe._id)}
                      onToggleFavorite={() => toggleFavorite(expandedRecipe._id)}
                    />
                )}

                {selectedMealDbRecipe && (() => {
                  const meal = selectedMealDbRecipe;
                  // Adapt mealdb structure to RecipePopup format
                  const adapted = {
                    ...meal,
                    cuisine: meal.area || '',
                    instructions: typeof meal.instructions === 'string'
                      ? meal.instructions.split(/\r?\n/).filter(s => s.trim().length > 0)
                      : (meal.instructions || []),
                  };
                  return (
                    <RecipePopup
                      recipe={adapted}
                      onClose={() => setSelectedMealDbRecipe(null)}
                      onAddToList={() => addRecipeToList(meal)}
                      isFavorite={mealDbFavIds.includes(String(meal._id))}
                      onToggleFavorite={() => toggleMealdbFavorite(meal)}
                    />
                  );
                })()}
            </>
          </div>
        )}

        {/* ════ AI MEAL PLANNER TAB ════ */}
        {activeTab === 'mealplan' && (
          <div key="mealplan" className="tab-content page-enter">

            {(() => {
              const activePlannerStage = mealPlanStep === 3 ? 2 : quizSlide >= 6 ? 1 : 0;
              const plannerSteps = [
                {
                  label: 'Στόχος',
                  detail: 'Σώμα και προτιμήσεις',
                  state: activePlannerStage > 0 ? 'complete' : activePlannerStage === 0 ? 'active' : 'idle',
                },
                {
                  label: 'Ρυθμίσεις',
                  detail: 'Άτομα, budget, μέρες',
                  state: activePlannerStage > 1 ? 'complete' : activePlannerStage === 1 ? 'active' : 'idle',
                },
                {
                  label: 'Πλάνο',
                  detail: mealPlanStep === 3 ? 'Έτοιμο για χρήση' : mealPlanLoading ? 'Δημιουργείται τώρα' : 'Weekly output',
                  state: activePlannerStage === 2 ? 'active' : 'idle',
                },
              ];

              return (
                <div className="mealplanner-stepper" aria-label="Πρόοδος AI πλάνου">
                  <div className="mealplanner-stepper-intro">
                    <div className="mealplanner-stepper-kicker">AI Meal Planner</div>
                    <div className="mealplanner-stepper-title">Στήσε το πλάνο σου χωρίς χαοτικό wizard</div>
                  </div>
                  <div className="mealplanner-stepper-track">
                    {plannerSteps.map((step, index) => (
                      <div
                        key={step.label}
                        className={`mealplanner-step ${step.state === 'active' ? 'is-active' : ''}${step.state === 'complete' ? ' is-complete' : ''}`}
                      >
                        <div className="mealplanner-step-badge">{index + 1}</div>
                        <div className="mealplanner-step-copy">
                          <strong>{step.label}</strong>
                          <span>{step.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}


            {/* ── Quiz Header ── */}
            {mealPlanStep === 1 && (
              <div style={{ marginBottom:20 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                  {quizSlide > 0
                    ? <button onClick={() => { setQuizDir('bck'); setQuizSlide(s => s-1); }}
                        style={{ background:'none', border:'none', color:'var(--text-secondary)', cursor:'pointer', display:'flex', alignItems:'center', gap:5, fontWeight:700, fontSize:13, padding:'6px 0' }}>
                        ← Πίσω
                      </button>
                    : <div/>
                  }
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:11, fontWeight:700, color:'var(--text-muted)' }}>Βήμα {quizSlide + 1} / 8</span>
                    <div style={{ display:'flex', gap:3 }}>
                      {Array.from({length:8}).map((_,i) => (
                        <div key={i} style={{ width:i===quizSlide?16:5, height:5, borderRadius:99, background:i<=quizSlide?'#6366f1':'var(--bg-subtle)', transition:'all 0.3s ease' }}/>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Quiz Slides ── */}
            {mealPlanStep === 1 && (
              <div style={{ overflow:'hidden' }}>
                <div key={quizSlide} className={`quiz-slide quiz-slide-${quizDir}`}>

                  {/* SLIDE 0: Gender */}
                  {quizSlide === 0 && (
                    <div className="quiz-slide-body" style={{ alignItems:'center', gap:22 }}>
                      <div style={{ textAlign:'center' }}>
                        <div style={{ fontSize:46, marginBottom:10 }}>⚕️</div>
                        <div style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', letterSpacing:-0.5 }}>Ποιο είναι το φύλο σου;</div>
                        <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:8, lineHeight:1.5 }}>Χρειάζεται για τον υπολογισμό του μεταβολισμού σου</div>
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, width:'100%' }}>
                        {[['male','♂','Άνδρας','#6366f1'],['female','♀','Γυναίκα','#ec4899']].map(([v,icon,label,color]) => (
                          <button key={v} onClick={() => setTdeeGender(v)}
                            style={{ padding:'32px 10px', borderRadius:20, border:`2.5px solid ${tdeeGender===v?color:'var(--border)'}`, background:tdeeGender===v?`${color}14`:'var(--bg-card)', cursor:'pointer', transition:'all 0.2s', display:'flex', flexDirection:'column', alignItems:'center', gap:10, position:'relative' }}>
                            {tdeeGender===v && <div style={{ position:'absolute', top:10, right:10, width:22, height:22, borderRadius:'50%', background:color, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, color:'#fff', fontWeight:900 }}>✓</div>}
                            <span style={{ fontSize:48 }}>{icon}</span>
                            <span style={{ fontWeight:800, fontSize:16, color:tdeeGender===v?color:'var(--text-primary)' }}>{label}</span>
                          </button>
                        ))}
                      </div>
                      <button onClick={() => { if(tdeeGender){ setQuizDir('fwd'); setQuizSlide(1); } }}
                        disabled={!tdeeGender}
                        style={{ width:'100%', padding:'15px', background:tdeeGender?'linear-gradient(135deg,#6366f1,#8b5cf6)':'var(--bg-surface)', color:tdeeGender?'#fff':'var(--text-muted)', border:'none', borderRadius:14, fontWeight:800, fontSize:16, cursor:tdeeGender?'pointer':'not-allowed', boxShadow:tdeeGender?'0 4px 20px rgba(99,102,241,0.3)':'none', transition:'all 0.2s' }}>
                        {tdeeGender ? 'Επόμενο →' : 'Επέλεξε φύλο'}
                      </button>
                    </div>
                  )}

                  {/* SLIDE 1: Age */}
                  {quizSlide === 1 && (
                    <div className="quiz-slide-body" style={{ gap:16 }}>
                      <div>
                        <div style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', letterSpacing:-0.5 }}>Πόσων χρονών είσαι;</div>
                        <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:6 }}>Η ηλικία επηρεάζει τον βασικό μεταβολισμό σου</div>
                      </div>
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                        {[['15-18','🧑'],['18-22','🎓'],['22-28','💼'],['28-35','👨'],['35-45','🧔'],['45-55','👨‍💼'],['55-65','🧓'],['65+','👴']].map(([val,emoji]) => (
                          <button key={val} onClick={() => setTdeeAge(val)}
                            style={{ padding:'12px 10px', borderRadius:14, border:`2px solid ${tdeeAge===val?'#6366f1':'var(--border)'}`, background:tdeeAge===val?'rgba(99,102,241,0.1)':'var(--bg-card)', cursor:'pointer', transition:'all 0.18s', display:'flex', alignItems:'center', gap:8 }}>
                            <span style={{ fontSize:20 }}>{emoji}</span>
                            <span style={{ fontWeight:800, fontSize:14, color:tdeeAge===val?'#6366f1':'var(--text-primary)' }}>{val}</span>
                            <span style={{ fontSize:11, color:'var(--text-muted)', marginLeft:'auto' }}>ετών</span>
                          </button>
                        ))}
                      </div>
                      <button onClick={() => { if(tdeeAge){ setQuizDir('fwd'); setQuizSlide(2); } }}
                        disabled={!tdeeAge}
                        style={{ width:'100%', padding:'15px', background:tdeeAge?'linear-gradient(135deg,#6366f1,#8b5cf6)':'var(--bg-surface)', color:tdeeAge?'#fff':'var(--text-muted)', border:'none', borderRadius:14, fontWeight:800, fontSize:16, cursor:tdeeAge?'pointer':'not-allowed', boxShadow:tdeeAge?'0 4px 20px rgba(99,102,241,0.3)':'none', transition:'all 0.2s' }}>
                        {tdeeAge ? 'Επόμενο →' : 'Επέλεξε ηλικία'}
                      </button>
                    </div>
                  )}

                  {/* SLIDE 2: Height */}
                  {quizSlide === 2 && (
                    <div className="quiz-slide-body" style={{ gap:24, alignItems:'center' }}>
                      <div style={{ width:'100%' }}>
                        <div style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', letterSpacing:-0.5 }}>Ποιο είναι το ύψος σου;</div>
                        <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:6 }}>Σε εκατοστά (cm)</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:20, width:'100%' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:24 }}>
                          <button onClick={() => setTdeeHeight(h => Math.max(140, h-1))}
                            style={{ width:56, height:56, borderRadius:16, border:'2px solid var(--border)', background:'var(--bg-card)', fontSize:26, cursor:'pointer', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                          <div style={{ textAlign:'center', minWidth:120 }}>
                            <div style={{ fontWeight:900, fontSize:64, color:'#6366f1', lineHeight:1, letterSpacing:-2 }}>{tdeeHeight}</div>
                            <div style={{ fontSize:15, color:'var(--text-muted)', fontWeight:700, marginTop:4 }}>cm</div>
                          </div>
                          <button onClick={() => setTdeeHeight(h => Math.min(220, h+1))}
                            style={{ width:56, height:56, borderRadius:16, border:'2px solid var(--border)', background:'var(--bg-card)', fontSize:26, cursor:'pointer', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                        </div>
                        <input type="range" min={140} max={220} value={tdeeHeight} onChange={e => setTdeeHeight(+e.target.value)} style={{ width:'90%', accentColor:'#6366f1' }}/>
                        <div style={{ display:'flex', justifyContent:'space-between', width:'90%', fontSize:11, color:'var(--text-muted)', fontWeight:600 }}>
                          <span>140cm</span><span>180cm</span><span>220cm</span>
                        </div>
                      </div>
                      <button onClick={() => { setQuizDir('fwd'); setQuizSlide(3); }}
                        style={{ width:'100%', padding:'15px', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', border:'none', borderRadius:14, fontWeight:800, fontSize:16, cursor:'pointer', boxShadow:'0 4px 20px rgba(99,102,241,0.3)' }}>
                        Επόμενο →
                      </button>
                    </div>
                  )}

                  {/* SLIDE 3: Weight */}
                  {quizSlide === 3 && (
                    <div className="quiz-slide-body" style={{ gap:24, alignItems:'center' }}>
                      <div style={{ width:'100%' }}>
                        <div style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', letterSpacing:-0.5 }}>Ποιο είναι το βάρος σου;</div>
                        <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:6 }}>Σε κιλά (kg)</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:20, width:'100%' }}>
                        <div style={{ display:'flex', alignItems:'center', gap:24 }}>
                          <button onClick={() => setTdeeWeight(w => Math.max(30, w-1))}
                            style={{ width:56, height:56, borderRadius:16, border:'2px solid var(--border)', background:'var(--bg-card)', fontSize:26, cursor:'pointer', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                          <div style={{ textAlign:'center', minWidth:120 }}>
                            <div style={{ fontWeight:900, fontSize:64, color:'#6366f1', lineHeight:1, letterSpacing:-2 }}>{tdeeWeight}</div>
                            <div style={{ fontSize:15, color:'var(--text-muted)', fontWeight:700, marginTop:4 }}>kg</div>
                          </div>
                          <button onClick={() => setTdeeWeight(w => Math.min(200, w+1))}
                            style={{ width:56, height:56, borderRadius:16, border:'2px solid var(--border)', background:'var(--bg-card)', fontSize:26, cursor:'pointer', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                        </div>
                        <input type="range" min={30} max={200} value={tdeeWeight} onChange={e => setTdeeWeight(+e.target.value)} style={{ width:'90%', accentColor:'#6366f1' }}/>
                        <div style={{ display:'flex', justifyContent:'space-between', width:'90%', fontSize:11, color:'var(--text-muted)', fontWeight:600 }}>
                          <span>30kg</span><span>115kg</span><span>200kg</span>
                        </div>
                      </div>
                      <button onClick={() => { setQuizDir('fwd'); setQuizSlide(4); }}
                        style={{ width:'100%', padding:'15px', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', border:'none', borderRadius:14, fontWeight:800, fontSize:16, cursor:'pointer', boxShadow:'0 4px 20px rgba(99,102,241,0.3)' }}>
                        Επόμενο →
                      </button>
                    </div>
                  )}

                  {/* SLIDE 4: Activity */}
                  {quizSlide === 4 && (
                    <div className="quiz-slide-body" style={{ gap:16 }}>
                      <div>
                        <div style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', letterSpacing:-0.5 }}>Πόσο αθλείσαι;</div>
                        <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:6 }}>Επηρεάζει τις ημερήσιες θερμίδες σου</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                        {[
                          ['sedentary','🪑','Καθιστικός','Γραφείο · χωρίς άσκηση'],
                          ['light','🚶','Ελαφρύ','1-2 προπονήσεις/εβδομάδα'],
                          ['moderate','🏃','Μέτριο','3-5 προπονήσεις/εβδομάδα'],
                          ['active','💪','Ενεργός','6-7 προπονήσεις/εβδομάδα'],
                          ['veryactive','🔥','Έντονο','2 προπονήσεις/μέρα'],
                        ].map(([v,icon,label,sub]) => (
                          <button key={v} onClick={() => setTdeeActivity(v)}
                            style={{ display:'flex', alignItems:'center', gap:14, padding:'14px 16px', borderRadius:14, border:`2px solid ${tdeeActivity===v?'#6366f1':'var(--border)'}`, background:tdeeActivity===v?'rgba(99,102,241,0.08)':'var(--bg-card)', cursor:'pointer', transition:'all 0.18s', textAlign:'left' }}>
                            <span style={{ fontSize:26, flexShrink:0 }}>{icon}</span>
                            <div style={{ flex:1 }}>
                              <div style={{ fontWeight:800, fontSize:14, color:tdeeActivity===v?'#6366f1':'var(--text-primary)' }}>{label}</div>
                              <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{sub}</div>
                            </div>
                            {tdeeActivity===v && <div style={{ width:22, height:22, borderRadius:'50%', background:'#6366f1', display:'flex', alignItems:'center', justifyContent:'center', color:'#fff', fontSize:12, fontWeight:900, flexShrink:0 }}>✓</div>}
                          </button>
                        ))}
                      </div>
                      <button onClick={() => { if(tdeeActivity){ setQuizDir('fwd'); setQuizSlide(5); } }}
                        disabled={!tdeeActivity}
                        style={{ width:'100%', padding:'15px', background:tdeeActivity?'linear-gradient(135deg,#6366f1,#8b5cf6)':'var(--bg-surface)', color:tdeeActivity?'#fff':'var(--text-muted)', border:'none', borderRadius:14, fontWeight:800, fontSize:16, cursor:tdeeActivity?'pointer':'not-allowed', boxShadow:tdeeActivity?'0 4px 20px rgba(99,102,241,0.3)':'none', transition:'all 0.2s' }}>
                        {tdeeActivity ? 'Επόμενο →' : 'Επέλεξε επίπεδο'}
                      </button>
                    </div>
                  )}

                  {/* SLIDE 5: Goal */}
                  {quizSlide === 5 && (
                    <div className="quiz-slide-body" style={{ gap:16 }}>
                      <div>
                        <div style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', letterSpacing:-0.5 }}>Ποιος είναι ο στόχος σου;</div>
                        <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:6 }}>Καθορίζει τις θερμίδες του πλάνου σου</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                        {[
                          { k:'muscle',  icon:'💪', label:'Bulk — Μυϊκή Μάζα',   sub:'Αύξηση δύναμης & όγκου',          kcal:'+300', color:'#10b981' },
                          { k:'maintain',icon:'⚖️', label:'Διατήρηση Βάρους',    sub:'Ισορροπία, καμία αλλαγή',          kcal:'0',    color:'#6366f1' },
                          { k:'mild',    icon:'📉', label:'Ήπια Απώλεια',         sub:'Αργή & σταθερή μείωση',            kcal:'−250', color:'#a78bfa' },
                          { k:'loss',    icon:'🔥', label:'Cut — Απώλεια Βάρους', sub:'Αποτελεσματική καύση λίπους',      kcal:'−500', color:'#f59e0b' },
                          { k:'extreme', icon:'⚡', label:'Έντονη Απώλεια',       sub:'Γρήγορα αποτελέσματα (προσοχή!)', kcal:'−1000',color:'#ef4444' },
                          { k:'budget',  icon:'💰', label:'Οικονομία',            sub:'Χαμηλό κόστος, υγιεινό πλάνο',    kcal:'0',    color:'#f59e0b' },
                        ].map(({k,icon,label,sub,kcal,color}) => {
                          const active = mealPlanPrefs.goal===k;
                          return (
                            <button key={k} onClick={() => setMealPlanPrefs(p => ({...p, goal:k}))}
                              style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 16px', borderRadius:14, border:`2px solid ${active?color:'var(--border)'}`, background:active?`${color}12`:'var(--bg-card)', cursor:'pointer', transition:'all 0.18s', textAlign:'left' }}>
                              <span style={{ fontSize:24, flexShrink:0 }}>{icon}</span>
                              <div style={{ flex:1 }}>
                                <div style={{ fontWeight:800, fontSize:13, color:active?color:'var(--text-primary)' }}>{label}</div>
                                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{sub}</div>
                              </div>
                              <div style={{ flexShrink:0, background:active?`${color}18`:'var(--bg-subtle)', borderRadius:8, padding:'4px 8px', fontSize:11, fontWeight:800, color:active?color:'var(--text-muted)', whiteSpace:'nowrap' }}>
                                {kcal} kcal
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <button onClick={() => { if(mealPlanPrefs.goal){ setQuizDir('fwd'); setQuizSlide(6); } }}
                        disabled={!mealPlanPrefs.goal}
                        style={{ width:'100%', padding:'15px', background:mealPlanPrefs.goal?'linear-gradient(135deg,#6366f1,#8b5cf6)':'var(--bg-surface)', color:mealPlanPrefs.goal?'#fff':'var(--text-muted)', border:'none', borderRadius:14, fontWeight:800, fontSize:16, cursor:mealPlanPrefs.goal?'pointer':'not-allowed', boxShadow:mealPlanPrefs.goal?'0 4px 20px rgba(99,102,241,0.3)':'none', transition:'all 0.2s' }}>
                        Επόμενο →
                      </button>
                    </div>
                  )}

                  {/* SLIDE 6: Diet style */}
                  {quizSlide === 6 && (
                    <div className="quiz-slide-body" style={{ gap:16 }}>
                      <div>
                        <div style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', letterSpacing:-0.5 }}>Πώς τρως συνήθως;</div>
                        <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:6 }}>Καθορίζει αναλογία πρωτεΐνης · υδατανθράκων · λιπαρών</div>
                      </div>
                      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                        {[
                          { icon:'🫒', label:'Μεσογειακό',       sub:'Ελαιόλαδο, λαχανικά, κρέας',        p:30, c:40, f:30 },
                          { icon:'💪', label:'Υψηλή Πρωτεΐνη',   sub:'Κρέας, αυγά, γυμναστήριο',           p:35, c:40, f:25 },
                          { icon:'⚡', label:'Αθλητική',         sub:'Πολλοί υδατάνθρακες, cardio',        p:25, c:55, f:20 },
                          { icon:'🥑', label:'Low Carb',          sub:'Χωρίς ψωμί/ζυμαρικά, καλά λιπαρά', p:30, c:15, f:55 },
                          { icon:'🔥', label:'Κετογονική',        sub:'Ελάχιστοι υδατ/κες, κέτωση',        p:25, c:5,  f:70 },
                        ].map(preset => {
                          const active = macroRatios.protein===preset.p && macroRatios.carbs===preset.c && macroRatios.fat===preset.f;
                          return (
                            <button key={preset.label} onClick={() => setMacroRatios({protein:preset.p, carbs:preset.c, fat:preset.f})}
                              style={{ display:'flex', alignItems:'center', gap:12, padding:'13px 16px', borderRadius:14, border:`2px solid ${active?'#6366f1':'var(--border)'}`, background:active?'rgba(99,102,241,0.08)':'var(--bg-card)', cursor:'pointer', transition:'all 0.18s', textAlign:'left' }}>
                              <span style={{ fontSize:24, flexShrink:0 }}>{preset.icon}</span>
                              <div style={{ flex:1 }}>
                                <div style={{ fontWeight:800, fontSize:13, color:active?'#6366f1':'var(--text-primary)' }}>{preset.label}</div>
                                <div style={{ fontSize:11, color:'var(--text-muted)', marginTop:2 }}>{preset.sub}</div>
                              </div>
                              <div style={{ display:'flex', gap:3, flexShrink:0 }}>
                                {[{v:preset.p,c:'#6366f1',l:'P'},{v:preset.c,c:'#10b981',l:'C'},{v:preset.f,c:'#f59e0b',l:'F'}].map(({v,c,l})=>(
                                  <div key={l} style={{ fontSize:10, fontWeight:800, color:c, background:`${c}14`, borderRadius:6, padding:'2px 5px' }}>{v}%{l}</div>
                                ))}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <button onClick={() => { setQuizDir('fwd'); setQuizSlide(7); }}
                        style={{ width:'100%', padding:'15px', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', border:'none', borderRadius:14, fontWeight:800, fontSize:16, cursor:'pointer', boxShadow:'0 4px 20px rgba(99,102,241,0.3)' }}>
                        Επόμενο →
                      </button>
                    </div>
                  )}

                  {/* SLIDE 7: Settings + TDEE preview */}
                  {quizSlide === 7 && (() => {
                    const w = parseFloat(tdeeWeight), h = parseFloat(tdeeHeight);
                    const ageStr = String(tdeeAge);
                    let a = ageStr==='65+' ? 68 : (() => { const p=ageStr.split('-'); return p.length===2?(parseFloat(p[0])+parseFloat(p[1]))/2:parseFloat(ageStr); })();
                    const bmrVal = (w&&h&&a) ? (tdeeGender==='male'?10*w+6.25*h-5*a+5:10*w+6.25*h-5*a-161) : null;
                    const mults = {sedentary:1.2,light:1.375,moderate:1.55,active:1.725,veryactive:1.9};
                    const tdeeEst = bmrVal ? Math.round(bmrVal*(mults[tdeeActivity]||1.55)) : null;
                    const adjMap = {maintain:0,mild:-250,loss:-500,extreme:-1000,muscle:300,budget:0};
                    const adj = adjMap[mealPlanPrefs.goal]??0;
                    const targetKcal = tdeeEst ? tdeeEst+adj : null;
                    return (
                      <div className="quiz-slide-body" style={{ gap:14 }}>
                        <div style={{ fontWeight:900, fontSize:20, color:'var(--text-primary)', letterSpacing:-0.5 }}>Ρύθμισε το πλάνο σου</div>
                        {targetKcal && (
                          <div style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.1),rgba(139,92,246,0.06))', border:'1.5px solid rgba(99,102,241,0.2)', borderRadius:16, padding:'14px 18px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                            <div>
                              <div style={{ fontSize:11, fontWeight:700, color:'#6366f1', textTransform:'uppercase', letterSpacing:0.5, marginBottom:2 }}>⚡ Στόχος θερμίδων</div>
                              <div style={{ fontWeight:900, fontSize:30, color:'var(--text-primary)', letterSpacing:-1 }}>{targetKcal} <span style={{ fontSize:14, fontWeight:600, color:'var(--text-muted)' }}>kcal/μέρα</span></div>
                            </div>
                            <div style={{ textAlign:'right', fontSize:12, color:'var(--text-muted)' }}>
                              <div>TDEE: <strong>{tdeeEst}</strong> kcal</div>
                              <div style={{ color:adj<0?'#ef4444':adj>0?'#10b981':'var(--text-muted)', fontWeight:700, marginTop:3 }}>{adj>0?'+':''}{adj} kcal</div>
                            </div>
                          </div>
                        )}
                        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, padding:'14px 18px' }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:10 }}>👥 ΑΤΟΜΑ</div>
                          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                            <button onClick={() => setMealPlanPrefs(p => ({...p, persons:Math.max(1,p.persons-1)}))}
                              style={{ width:44, height:44, borderRadius:12, border:'2px solid var(--border)', background:'var(--bg-surface)', fontSize:22, cursor:'pointer', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}>−</button>
                            <div style={{ textAlign:'center' }}>
                              <span style={{ fontWeight:900, fontSize:36, color:'var(--text-primary)' }}>{mealPlanPrefs.persons}</span>
                              <span style={{ fontSize:13, color:'var(--text-muted)', marginLeft:6 }}>άτομο{mealPlanPrefs.persons!==1?'α':''}</span>
                            </div>
                            <button onClick={() => setMealPlanPrefs(p => ({...p, persons:Math.min(8,p.persons+1)}))}
                              style={{ width:44, height:44, borderRadius:12, border:'2px solid var(--border)', background:'var(--bg-surface)', fontSize:22, cursor:'pointer', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                          </div>
                        </div>
                        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, padding:'14px 18px' }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:10 }}>📅 ΔΙΑΡΚΕΙΑ ΠΛΑΝΟΥ</div>
                          <div style={{ display:'flex', gap:8 }}>
                            {[3,5,7].map(d => (
                              <button key={d} onClick={() => setMealPlanPrefs(p => ({...p, days:d}))}
                                style={{ flex:1, padding:'13px 0', borderRadius:12, border:`2px solid ${mealPlanPrefs.days===d?'#6366f1':'var(--border)'}`, background:mealPlanPrefs.days===d?'rgba(99,102,241,0.12)':'var(--bg-surface)', color:mealPlanPrefs.days===d?'#6366f1':'var(--text-secondary)', fontWeight:800, fontSize:16, cursor:'pointer', transition:'all 0.2s', display:'flex', flexDirection:'column', alignItems:'center', gap:2 }}>
                                {d}<span style={{ fontSize:10, fontWeight:600 }}>μέρες</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, padding:'14px 18px' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                            <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)' }}>💰 ΕΒΔΟΜΑΔΙΑΙΟ BUDGET</div>
                            <div style={{ fontWeight:900, fontSize:22, color:'#10b981' }}>{mealPlanPrefs.budget}€</div>
                          </div>
                          <input type="range" min={20} max={300} step={5} value={mealPlanPrefs.budget} onChange={e => setMealPlanPrefs(p => ({...p, budget:+e.target.value}))} style={{ width:'100%', accentColor:'#6366f1' }}/>
                          <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text-muted)', marginTop:4 }}>
                            <span>20€</span><span>160€</span><span>300€</span>
                          </div>
                        </div>
                        <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, padding:'14px 18px' }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:10 }}>🚫 ΠΕΡΙΟΡΙΣΜΟΙ <span style={{ fontWeight:500, color:'var(--text-muted)' }}>(προαιρετικό)</span></div>
                          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                            {[['vegan','🌱 Vegan'],['vegetarian','🥗 Vegetarian'],['gluten-free','🌾 Χωρίς Γλουτένη'],['lactose-free','🥛 Χωρίς Λακτόζη'],['nut-free','🥜 Χωρίς Ξηρούς Καρπούς']].map(([r,label]) => {
                              const active = mealPlanPrefs.restrictions.includes(r);
                              return (
                                <button key={r} onClick={() => setMealPlanPrefs(p => ({...p, restrictions:active?p.restrictions.filter(x=>x!==r):[...p.restrictions,r]}))}
                                  style={{ padding:'8px 14px', borderRadius:20, border:`1.5px solid ${active?'#6366f1':'var(--border)'}`, background:active?'rgba(99,102,241,0.1)':'var(--bg-surface)', color:active?'#6366f1':'var(--text-secondary)', fontWeight:700, fontSize:12, cursor:'pointer', transition:'all 0.2s' }}>
                                  {label}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {mealPlanError && (
                          <div style={{ background:'rgba(239,68,68,0.08)', border:'1.5px solid rgba(239,68,68,0.25)', borderRadius:12, padding:'12px 14px', color:'#ef4444', fontSize:13 }}>{mealPlanError}</div>
                        )}
                        <button onClick={generateMealPlan} disabled={mealPlanLoading}
                          style={{ padding:'17px', border:'none', borderRadius:16, fontWeight:900, fontSize:17, cursor:mealPlanLoading?'not-allowed':'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:10, background:mealPlanLoading?'var(--bg-surface)':'linear-gradient(135deg,#6366f1,#8b5cf6)', color:mealPlanLoading?'var(--text-secondary)':'#fff', boxShadow:mealPlanLoading?'none':'0 6px 24px rgba(99,102,241,0.4)', transition:'all 0.3s' }}>
                          {mealPlanLoading
                            ? <><div style={{ width:20, height:20, border:'2.5px solid rgba(99,102,241,0.2)', borderTopColor:'#6366f1', borderRadius:'50%', animation:'spin 0.85s linear infinite' }}/><span style={{ fontWeight:800, fontSize:14, color:'var(--text-primary)' }}>Δημιουργία πλάνου...</span></>
                            : <><IconSparkles size={20} stroke={2}/> Δημιούργησε το Πλάνο μου ✨</>
                          }
                        </button>
                      </div>
                    );
                  })()}

                </div>
              </div>
            )}

            {/* ════ STEP 3: RESULTS ════ */}
            {mealPlanStep === 3 && mealPlan && (() => {
              // slotKey = "dayIdx_mealType" (e.g. "0_breakfast")
              // chosen = 'a' | 'b'
              const renderCard = (meal, isAlt, slotKey) => {
                if (!meal) return null;
                const chosenForSlot = selectedMeals[slotKey];
                const isThisChosen = chosenForSlot === (isAlt ? 'b' : 'a');
                const otherChosen  = chosenForSlot && !isThisChosen;
                return (
                  <div
                    onClick={() => slotKey && setSelectedMeals(prev => ({ ...prev, [slotKey]: isAlt ? 'b' : 'a' }))}
                    style={{
                      background: isThisChosen
                        ? (isAlt ? 'rgba(139,92,246,0.07)' : 'rgba(99,102,241,0.07)')
                        : isAlt ? 'var(--bg-surface)' : 'var(--bg-card)',
                      border: `1.5px solid ${isThisChosen ? (isAlt?'#8b5cf6':'#6366f1') : otherChosen ? 'var(--border)' : isAlt?'var(--border)':'rgba(99,102,241,0.15)'}`,
                      borderRadius:16, padding:'14px 16px',
                      cursor: slotKey ? 'pointer' : 'default',
                      opacity: otherChosen ? 0.55 : 1,
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:8, marginBottom:10 }}>
                      <div style={{ flex:1 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:5 }}>
                          <div style={{ fontSize:10, fontWeight:800, color:isThisChosen?(isAlt?'#8b5cf6':'#6366f1'):isAlt?'var(--text-muted)':'#6366f1', background:isThisChosen?'rgba(99,102,241,0.18)':isAlt?'var(--bg-subtle)':'rgba(99,102,241,0.1)', borderRadius:6, padding:'2px 7px', letterSpacing:0.3 }}>
                            {isThisChosen ? '✓ ' : ''}{isAlt?'ΕΠΙΛΟΓΗ Β':'ΕΠΙΛΟΓΗ Α'}
                          </div>
                          {meal.time && <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)' }}>⏱ {meal.time}′</div>}
                        </div>
                        <div style={{ fontWeight:900, fontSize:16, color:'var(--text-primary)', lineHeight:1.3 }}>{meal.name}</div>
                      </div>
                    </div>
                    {meal.macros && (
                      <div style={{ display:'flex', gap:5, flexWrap:'wrap', marginBottom:10 }}>
                        {[{k:'kcal',l:'kcal',c:'#f59e0b'},{k:'protein',l:'P',c:'#6366f1'},{k:'carbs',l:'C',c:'#10b981'},{k:'fat',l:'F',c:'#ef4444'}].map(({k,l,c}) =>
                          meal.macros[k]!=null && (
                            <div key={k} style={{ background:`${c}12`, border:`1px solid ${c}22`, borderRadius:8, padding:'3px 8px', fontSize:11, fontWeight:800, color:c, display:'flex', alignItems:'center', gap:2 }}>
                              {meal.macros[k]}<span style={{ fontSize:9, opacity:0.8 }}>{l}</span>
                            </div>
                          )
                        )}
                      </div>
                    )}
                    {meal.description && (
                      <div style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.6, marginBottom:10 }}>{meal.description}</div>
                    )}
                    {meal.ingredients?.length>0 && (
                      <div style={{ marginBottom:meal.prepTip?10:0 }}>
                        <div style={{ fontSize:10, fontWeight:700, color:'var(--text-muted)', textTransform:'uppercase', letterSpacing:0.3, marginBottom:6 }}>🛒 Υλικά</div>
                        <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                          {meal.ingredients.map((ing,j) => {
                            const ingName = typeof ing==='string'?ing:ing.name;
                            const ingPrice = typeof ing==='object'&&ing.price?`${ing.price.toFixed?ing.price.toFixed(2):ing.price}€`:null;
                            const found = typeof ing==='object'&&ing.found;
                            return (
                              <span key={j} style={{ fontSize:11, padding:'4px 10px', borderRadius:20, fontWeight:600, background:found?'rgba(16,185,129,0.08)':'var(--bg-subtle)', border:`1px solid ${found?'rgba(16,185,129,0.2)':'var(--border)'}`, color:found?'#10b981':'var(--text-secondary)' }}>
                                {ingName}{ingPrice?` · ${ingPrice}`:''}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {meal.prepTip && (
                      <div style={{ background:'rgba(99,102,241,0.06)', borderLeft:'3px solid #6366f1', borderRadius:'0 10px 10px 0', padding:'8px 12px', marginTop:10, fontSize:11, color:'var(--text-secondary)', fontStyle:'italic', lineHeight:1.5 }}>
                        💡 {meal.prepTip}
                      </div>
                    )}
                  </div>
                );
              };

              const day = mealPlan[activeMealDay] || mealPlan[0];

              return (
                <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
                  {/* Header */}
                  <div style={{ background:'linear-gradient(135deg,rgba(16,185,129,0.1),rgba(99,102,241,0.07))', border:'1.5px solid rgba(16,185,129,0.2)', borderRadius:20, padding:'18px 20px' }}>
                    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
                      <div>
                        <div style={{ fontWeight:900, fontSize:19, color:'var(--text-primary)', letterSpacing:-0.5 }}>🎉 Το πλάνο σου είναι έτοιμο!</div>
                        <div style={{ fontSize:12, color:'var(--text-secondary)', marginTop:3 }}>{mealPlan.length} μέρες · {mealPlanPrefs.persons} άτομο{mealPlanPrefs.persons!==1?'α':''} · 2 επιλογές ανά γεύμα</div>
                      </div>
                      <button onClick={resetPlanWithFeedback}
                        style={{ background:'var(--bg-surface)', border:'1.5px solid var(--border)', borderRadius:12, padding:'8px 12px', fontSize:12, fontWeight:700, cursor:'pointer', color:'var(--text-secondary)', display:'flex', alignItems:'center', gap:5, flexShrink:0 }}>
                        <IconRefresh size={13}/> Νέο
                      </button>
                    </div>
                    {mealPlanSummary && (() => {
                      const isBudget = mealPlanPrefs.goal === 'budget';
                      const statItems = [
                        !isBudget && { label:'kcal/μέρα', value:mealPlanSummary.avgKcalPerDay||'—', color:'#f59e0b', icon:'🔥' },
                        { label:'Πρωτεΐνη', value:mealPlanSummary.avgProteinPerDay?`${mealPlanSummary.avgProteinPerDay}g`:'—', color:'#6366f1', icon:'💪' },
                        { label:'Βρέθηκαν', value:mealPlanStats?`${mealPlanStats.foundInDB}/${mealPlanStats.totalIngredients}`:'—', color:'#10b981', icon:'✓' },
                        { label:'Κόστος', value:mealPlanStats?.estimatedCost?`${mealPlanStats.estimatedCost.toFixed(0)}€`:mealPlanStats?.estimatedTotalCost?`${mealPlanStats.estimatedTotalCost.toFixed(0)}€`:'—', color:'#a78bfa', icon:'💰' },
                      ].filter(Boolean);
                      return (
                        <div style={{ display:'grid', gridTemplateColumns:`repeat(${statItems.length},1fr)`, gap:8 }}>
                          {statItems.map(({label,value,color,icon}) => (
                            <div key={label} style={{ background:`${color}12`, border:`1px solid ${color}22`, borderRadius:12, padding:'10px 8px', textAlign:'center' }}>
                              <div style={{ fontSize:18, marginBottom:3 }}>{icon}</div>
                              <div style={{ fontWeight:900, fontSize:14, color, lineHeight:1 }}>{value}</div>
                              <div style={{ fontSize:9, color:'var(--text-muted)', marginTop:3, fontWeight:600 }}>{label}</div>
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Day selector */}
                  <div style={{ display:'flex', gap:8, overflowX:'auto', paddingBottom:2, scrollbarWidth:'none' }}>
                    {mealPlan.map((d,i) => {
                      const isSel = activeMealDay===i;
                      return (
                        <button key={i} onClick={() => setActiveMealDay(i)}
                          style={{ flexShrink:0, padding:'10px 16px', borderRadius:14, cursor:'pointer', transition:'all 0.2s', border:isSel?'2px solid #6366f1':'1.5px solid var(--border)', background:isSel?'linear-gradient(135deg,rgba(99,102,241,0.15),rgba(139,92,246,0.1))':'var(--bg-card)', color:isSel?'#6366f1':'var(--text-secondary)', fontWeight:800, fontSize:13 }}>
                          <div style={{ fontSize:9, opacity:0.7, marginBottom:1 }}>Ημ. {d.day||i+1}</div>
                          <div>{d.dayName||`Ημέρα ${d.day}`}</div>
                          {d.dayMacros?.kcal && <div style={{ fontSize:9, marginTop:2, opacity:0.6 }}>{d.dayMacros.kcal} kcal</div>}
                        </button>
                      );
                    })}
                  </div>

                  {/* Meals for selected day */}
                  <div style={{ display:'flex', flexDirection:'column', gap:18 }}>

                    {(day.meals?.breakfast||day.meals?.breakfast_alt) && (
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, paddingBottom:8, borderBottom:'1px solid var(--border)' }}>
                          <span style={{ fontSize:22 }}>🌅</span>
                          <div>
                            <div style={{ fontWeight:900, fontSize:15, color:'var(--text-primary)' }}>Πρωινό</div>
                            <div style={{ fontSize:11, color:'var(--text-muted)' }}>Διάλεξε μία από τις 2 επιλογές</div>
                          </div>
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                          {renderCard(day.meals.breakfast, false, `${activeMealDay}_breakfast`)}
                          {day.meals.breakfast_alt && renderCard(day.meals.breakfast_alt, true, `${activeMealDay}_breakfast`)}
                        </div>
                      </div>
                    )}

                    {day.snacks?.morning && (
                      <div style={{ display:'flex', gap:10, padding:'10px 14px', background:'rgba(16,185,129,0.05)', border:'1px solid rgba(16,185,129,0.15)', borderRadius:12 }}>
                        <span style={{ fontSize:18, flexShrink:0 }}>🍎</span>
                        <div>
                          <div style={{ fontSize:10, fontWeight:700, color:'#10b981', textTransform:'uppercase', marginBottom:2 }}>Πρωινό Σνακ</div>
                          <div style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.5 }}>{day.snacks.morning}</div>
                        </div>
                      </div>
                    )}

                    {(day.meals?.lunch||day.meals?.lunch_alt) && (
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, paddingBottom:8, borderBottom:'1px solid var(--border)' }}>
                          <span style={{ fontSize:22 }}>☀️</span>
                          <div>
                            <div style={{ fontWeight:900, fontSize:15, color:'var(--text-primary)' }}>Μεσημεριανό</div>
                            <div style={{ fontSize:11, color:'var(--text-muted)' }}>Διάλεξε μία από τις 2 επιλογές</div>
                          </div>
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                          {renderCard(day.meals.lunch, false, `${activeMealDay}_lunch`)}
                          {day.meals.lunch_alt && renderCard(day.meals.lunch_alt, true, `${activeMealDay}_lunch`)}
                        </div>
                      </div>
                    )}

                    {day.snacks?.afternoon && (
                      <div style={{ display:'flex', gap:10, padding:'10px 14px', background:'rgba(16,185,129,0.05)', border:'1px solid rgba(16,185,129,0.15)', borderRadius:12 }}>
                        <span style={{ fontSize:18, flexShrink:0 }}>🥜</span>
                        <div>
                          <div style={{ fontSize:10, fontWeight:700, color:'#10b981', textTransform:'uppercase', marginBottom:2 }}>Απογευματινό Σνακ</div>
                          <div style={{ fontSize:12, color:'var(--text-secondary)', lineHeight:1.5 }}>{day.snacks.afternoon}</div>
                        </div>
                      </div>
                    )}

                    {(day.meals?.dinner||day.meals?.dinner_alt) && (
                      <div>
                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:10, paddingBottom:8, borderBottom:'1px solid var(--border)' }}>
                          <span style={{ fontSize:22 }}>🌙</span>
                          <div>
                            <div style={{ fontWeight:900, fontSize:15, color:'var(--text-primary)' }}>Βραδινό</div>
                            <div style={{ fontSize:11, color:'var(--text-muted)' }}>Διάλεξε μία από τις 2 επιλογές</div>
                          </div>
                        </div>
                        <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
                          {renderCard(day.meals.dinner, false, `${activeMealDay}_dinner`)}
                          {day.meals.dinner_alt && renderCard(day.meals.dinner_alt, true, `${activeMealDay}_dinner`)}
                        </div>
                      </div>
                    )}

                    {day.dayMacros && (
                      <div style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.06),rgba(139,92,246,0.04))', border:'1.5px solid rgba(99,102,241,0.15)', borderRadius:14, padding:'12px 16px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                        <span style={{ fontSize:12, fontWeight:800, color:'#6366f1' }}>📊 Σύνολο Ημέρας</span>
                        <div style={{ display:'flex', gap:12 }}>
                          {[['kcal','🔥','kcal'],['protein','💪','P'],['carbs','⚡','C'],['fat','🥑','F']].map(([k,e,l]) =>
                            day.dayMacros[k]!=null && (
                              <span key={k} style={{ fontSize:12, fontWeight:800, color:'var(--text-primary)', display:'flex', alignItems:'center', gap:2 }}>
                                <span style={{ fontSize:10 }}>{e}</span>{day.dayMacros[k]}<span style={{ fontSize:9, opacity:0.6 }}>{l}</span>
                              </span>
                            )
                          )}
                        </div>
                      </div>
                    )}

                    {day.waterGlasses && (
                      <div style={{ display:'flex', gap:8, padding:'10px 14px', background:'rgba(59,130,246,0.05)', border:'1px solid rgba(59,130,246,0.15)', borderRadius:12 }}>
                        <span>💧</span>
                        <span style={{ fontSize:12, fontWeight:600, color:'var(--text-secondary)' }}>Στόχος: {day.waterGlasses} ποτήρια νερό</span>
                      </div>
                    )}

                    {day.nutritionNote && (
                      <div style={{ fontSize:12, color:'var(--text-secondary)', fontStyle:'italic', padding:'10px 14px', background:'var(--bg-subtle)', borderRadius:12, lineHeight:1.5 }}>
                        ℹ️ {day.nutritionNote}
                      </div>
                    )}

                    <div style={{ display:'grid', gridTemplateColumns:'1fr auto', gap:10 }}>
                      <button onClick={addMealPlanToCart}
                        style={{ padding:'16px', border:'none', borderRadius:14, fontWeight:800, fontSize:15, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:8, background:'linear-gradient(135deg,#10b981,#059669)', color:'#fff', boxShadow:'0 4px 20px rgba(16,185,129,0.3)' }}>
                        <IconShoppingCart size={18} stroke={2}/> Πρόσθεσε στη Λίστα
                      </button>
                      <button onClick={resetPlanWithFeedback}
                        style={{ padding:'16px 14px', background:'var(--bg-card)', color:'var(--text-secondary)', border:'1.5px solid var(--border)', borderRadius:14, fontWeight:800, fontSize:13, cursor:'pointer', display:'flex', alignItems:'center', gap:6 }}>
                        <IconRefresh size={15} stroke={2}/>
                      </button>
                    </div>

                  </div>
                </div>
              );
            })()}
          </div>
        )}

        {/* ════ FEEDBACK MODAL — shown before regenerating a plan ════ */}
        {showFeedbackModal && createPortal(
          <div
            aria-modal="true" role="dialog"
            onClick={e => { if (e.target === e.currentTarget) setShowFeedbackModal(false); }}
            style={{ position:'fixed', inset:0, zIndex:9999, display:'flex', alignItems:'flex-end', justifyContent:'center', background:'rgba(0,0,0,0.55)', backdropFilter:'blur(4px)' }}
          >
            <div style={{ width:'100%', maxWidth:480, background:'var(--bg-card)', borderRadius:'24px 24px 0 0', padding:'24px 20px 32px', paddingBottom:'calc(32px + env(safe-area-inset-bottom))', display:'flex', flexDirection:'column', gap:16 }}>

              {/* Handle + title */}
              <div style={{ width:40, height:4, borderRadius:99, background:'var(--border)', margin:'0 auto 4px' }}/>
              <div>
                <div style={{ fontWeight:900, fontSize:19, color:'var(--text-primary)', marginBottom:4 }}>Γιατί νέο πλάνο; 🤔</div>
                <div style={{ fontSize:12, color:'var(--text-secondary)' }}>Το feedback σου βοηθάει να βελτιώνουμε τις προτάσεις</div>
              </div>

              {/* Reason chips */}
              <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                {[
                  { v:'different_recipes', l:'Θέλω άλλες συνταγές' },
                  { v:'lighter',           l:'Πιο ελαφρύ' },
                  { v:'cheaper',           l:'Πιο οικονομικό' },
                  { v:'faster',            l:'Πιο γρήγορο μαγείρεμα' },
                  { v:'more_variety',      l:'Περισσότερη ποικιλία' },
                  { v:'other',             l:'Άλλο' },
                ].map(({ v, l }) => (
                  <button key={v} onClick={() => setFeedbackReason(v)}
                    style={{ padding:'8px 14px', borderRadius:20, fontSize:12, fontWeight:700, cursor:'pointer', border:`1.5px solid ${feedbackReason===v?'#6366f1':'var(--border)'}`, background:feedbackReason===v?'rgba(99,102,241,0.1)':'var(--bg-surface)', color:feedbackReason===v?'#6366f1':'var(--text-secondary)', transition:'all 0.15s' }}>
                    {l}
                  </button>
                ))}
              </div>

              {/* Optional free-text */}
              <textarea
                placeholder="Πρόσθεσε σχόλιο (προαιρετικό)…"
                value={feedbackFreeText}
                onChange={e => setFeedbackFreeText(e.target.value)}
                rows={2}
                style={{ padding:'12px', borderRadius:12, border:'1.5px solid var(--border)', background:'var(--bg-surface)', color:'var(--text-primary)', fontSize:13, resize:'none', fontFamily:'inherit', outline:'none' }}
              />

              {/* Actions */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                <button onClick={() => setShowFeedbackModal(false)}
                  style={{ padding:'14px', borderRadius:14, border:'1.5px solid var(--border)', background:'var(--bg-surface)', color:'var(--text-secondary)', fontWeight:700, fontSize:14, cursor:'pointer' }}>
                  Άκυρο
                </button>
                <button onClick={submitFeedbackAndReset}
                  style={{ padding:'14px', borderRadius:14, border:'none', background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'#fff', fontWeight:800, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7, boxShadow:'0 4px 18px rgba(99,102,241,0.35)' }}>
                  <IconRefresh size={15}/> Νέο Πλάνο
                </button>
              </div>
            </div>
          </div>,
          document.body
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
                    key={SUPERMARKET_LOGOS[name]}
                    src={SUPERMARKET_LOGOS[name] || ''}
                    alt={name}
                    style={{ width:60, height:60, objectFit:'contain', borderRadius:12, background:'#fff', padding:4 }}
                    onLoad={e => { e.target.style.display = ''; }}
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

      {/* Floating toolbar removed — tools moved to tools-topbar under clock */}

      {/* ── Floating Bottom Nav — lives OUTSIDE .container to avoid backdrop-filter stacking context ── */}


      <nav ref={navRef} className="bottom-nav bottom-nav-revamp bottom-nav-minimal" aria-label="Κύρια πλοήγηση">
        <button
          className={`bottom-nav-btn${showSmartRoute ? ' active' : ''}`}
          onClick={openSmartRouteModal}
          aria-label="Χάρτης"
        >
          <div className="bottom-nav-icon"><IconMap size={24} stroke={1.8} /></div>
          <span className="bottom-nav-label">Χάρτης</span>
        </button>
        <button
          className={`bottom-nav-btn nav-tab-fab${activeTab === 'list' ? ' active' : ''}`}
          onClick={() => navigateToTab('list')}
          aria-label="Αρχική"
        >
          <div className="nav-fab-inner">
            <IconHome size={26} stroke={1.8} />
          </div>
          <span className="bottom-nav-label">Αρχική</span>
        </button>
        <button
          className={`bottom-nav-btn${showProfileMenu ? ' active' : ''}`}
          onClick={() => {
            if (!user) { openAuthWall('login'); return; }
            setShowProfileMenu(v => !v);
          }}
          aria-label="Προφίλ"
        >
          <div className="bottom-nav-icon"><IconUser size={24} stroke={1.8} /></div>
          <span className="bottom-nav-label">Προφίλ</span>
        </button>
      </nav>

      {/* ── Profile Popup Modal ── */}
      {showProfileMenu && createPortal(
        <div className="profile-popup-overlay" onMouseDown={(e) => e.target === e.currentTarget && setShowProfileMenu(false)}>
          <div className="profile-popup-card">
            <button className="profile-popup-close" onClick={() => setShowProfileMenu(false)}>✕</button>
            {user ? (
              <>
                <div className="profile-popup-header">
                  <div className="profile-popup-avatar">
                    {user.name?.charAt(0)?.toUpperCase() || '?'}
                  </div>
                  <div className="profile-popup-name">{user.name}</div>
                  <div className="profile-popup-email">{user.email || ''}</div>
                  <div className="profile-popup-share">
                    Κωδικός: <strong>{user.shareKey || 'N/A'}</strong>
                    <button className="profile-popup-copy" onClick={handleCopyShareKey}>📋</button>
                  </div>
                  {user.isPremium && <div className="profile-popup-premium-badge">⭐ Premium</div>}
                </div>
                <div className="profile-popup-actions">
                  <button className="profile-popup-action" onClick={() => { setIsDarkMode(v => !v); setShowProfileMenu(false); }}>
                    {isDarkMode ? <><IconSun size={18} /> Φωτεινό θέμα</> : <><IconMoon size={18} /> Σκούρο θέμα</>}
                  </button>
                  {'PushManager' in window && (
                    <button className="profile-popup-action" onClick={() => { pushEnabled ? unsubscribeFromPush() : subscribeToPush(); setShowProfileMenu(false); }}>
                      <IconBell size={18} /> {pushEnabled ? 'Ειδοποιήσεις ON' : 'Ειδοποιήσεις OFF'}
                    </button>
                  )}
                  <button className="profile-popup-action" onClick={openSavedLists}>
                    <IconNotes size={18} /> Λίστες μου
                  </button>
                  <button className="profile-popup-action logout" onClick={handleLogout}>
                    <IconLogout size={18} /> Αποσύνδεση
                  </button>
                </div>
              </>
            ) : (
              <div style={{ textAlign:'center', padding:'32px 20px' }}>
                <div style={{ fontSize:48, marginBottom:16 }}>👤</div>
                <h3 style={{ margin:'0 0 8px', fontWeight:800 }}>Σύνδεση</h3>
                <p style={{ fontSize:13, color:'var(--text-secondary)', marginBottom:20 }}>Συνδέσου για να αποθηκεύσεις λίστες, συνταγές και προτιμήσεις</p>
                <button className="submit-btn" onClick={() => { setShowProfileMenu(false); openAuthWall('login'); }}>Σύνδεση / Εγγραφή</button>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {/* SmartRoute map modal — opened via nav Map button */}
      {user && <SmartRouteMap
        isOpen={showSmartRoute}
        onClose={() => setShowSmartRoute(false)}
        items={items}
      />}

      {/* ── Onboarding Tour ── */}
      {showOnboarding && createPortal(
        <OnboardingTour
          step={onboardingStep}
          onNext={() => {
            const STEPS = 5;
            if (onboardingStep < STEPS - 1) {
              setOnboardingStep(s => s + 1);
            } else {
              localStorage.setItem('sg_onboarding_done', '1');
              setShowOnboarding(false);
            }
          }}
          onSkip={() => {
            localStorage.setItem('sg_onboarding_done', '1');
            setShowOnboarding(false);
          }}
        />,
        document.body,
      )}
    </div>
  );
}

// ── Onboarding Tour Component ─────────────────────────────────────────────────
const ONBOARDING_STEPS = [
  {
    emoji: '👋',
    title: 'Καλωσήρθες στο Καλαθάκι!',
    body:  'v2.3.0 — Η έξυπνη λίστα ψώνων με σύγκριση τιμών, Meal Scanner, Barcode Scanner, συνταγές & AI πλάνο διατροφής.',
    btn:   'Ας ξεκινήσουμε →',
  },
  {
    emoji: '🔍',
    title: 'Αναζήτηση προϊόντων',
    body:  'Γράψε ένα προϊόν και δες αμέσως τις τρέχουσες τιμές από όλα τα σούπερ μάρκετ. Χτύπα "+" ή Enter για να το προσθέσεις.',
    btn:   'Επόμενο →',
  },
  {
    emoji: '🎤',
    title: 'Φωνητική εισαγωγή',
    body:  'Πάτα το 🎤 για να προσθέσεις προϊόντα με τη φωνή σου. Ιδανικό για γρήγορη εισαγωγή!',
    btn:   'Επόμενο →',
  },
  {
    emoji: '🍽️',
    title: 'Συνταγές & Διατροφή',
    body:  'Στην καρτέλα "Συνταγές" θα βρεις εκατοντάδες ελληνικές & διεθνείς συνταγές. Πάτα "📥 Προσθήκη" για να μπουν τα υλικά στη λίστα σου.',
    btn:   'Επόμενο →',
  },
  {
    emoji: '🤖',
    title: 'AI Πλάνο Διατροφής',
    body:  'Το "AI Πλάνο" δημιουργεί εξατομικευμένο πλάνο γεύματος για εβδομάδα. Δοκίμασέ το — χρειάζεσαι λογαριασμό Premium.',
    btn:   '🚀 Ξεκίνα τώρα!',
  },
];

function OnboardingTour({ step, onNext, onSkip }) {
  const s = ONBOARDING_STEPS[step] || ONBOARDING_STEPS[0];
  return (
    <div className="onboarding-overlay" onClick={e => e.target === e.currentTarget && onSkip()}>
      <div className="onboarding-card">
        <div className="onboarding-step-dots">
          {ONBOARDING_STEPS.map((_, i) => (
            <div key={i} className={`onboarding-step-dot${i === step ? ' active' : ''}`} />
          ))}
        </div>
        <div className="onboarding-emoji">{s.emoji}</div>
        <div className="onboarding-title">{s.title}</div>
        <div className="onboarding-body">{s.body}</div>
        <button className="onboarding-btn" onClick={onNext}>{s.btn}</button>
        {step < ONBOARDING_STEPS.length - 1 && (
          <button className="onboarding-skip" onClick={onSkip}>Παράλειψη</button>
        )}
      </div>
    </div>
  );
}
