import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import { Html5Qrcode } from 'html5-qrcode';
import './App.css';
import RecipeNotification from './RecipeNotification';
import AuthModal from './AuthModal';
import SavedListsModal from './SavedListsModal';
import SmartRouteMap, { FloatingMapButton } from './SmartRouteMap';
import './SmartRouteMap.css';
import { io } from 'socket.io-client';
import {
  IconShoppingCart, IconQrcode, IconUsers, IconMessage,
  IconNotes, IconUser, IconLogout,
  IconSun, IconMoon, IconSearch, IconPlus, IconTrash,
  IconStar, IconStarFilled, IconChefHat, IconBook2,
  IconBuildingStore, IconScan, IconWifi, IconWifiOff,
  IconClipboard, IconCheck, IconX, IconChevronRight,
  IconArrowRight, IconSparkles, IconBrain, IconShield,
  IconLock, IconFingerprint, IconRefresh, IconHistory,
  IconEdit, IconBell, IconHome, IconBookmark, IconTag,
  IconCoin, IconTrendingDown, IconAlertTriangle,
} from '@tabler/icons-react';

// ─── Constants ────────────────────────────────────────────────────────────────
const API_BASE      = 'https://my-smart-grocery-api.onrender.com';
const CACHE_VERSION = 'v3';
const CACHE_TTL_MS  = 10 * 60 * 1000; // 10 min

// #region agent log
const debugLog = (payload) => {
  try {
    fetch('http://127.0.0.1:7511/ingest/af701115-fec6-479a-b09b-c1d32de6d5c8', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Debug-Session-Id': 'fe5a26',
      },
      body: JSON.stringify({
        sessionId: 'fe5a26',
        timestamp: Date.now(),
        ...payload,
      }),
    }).catch(() => {});
  } catch {
    // swallow
  }
};
// #endregion

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
    const words = norm.split(/[\s\-\/,.:;!?()\[\]{}0-9]+/).filter(w => w.length >= 3);
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
function SwipeableItem({ item, onDelete, onSend, user }) {
  const [offsetX, setOffsetX]     = useState(0);
  const [swiping, setSwiping]     = useState(false);
  const [dismissed, setDismissed] = useState(false);
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
    <li className={`item-card-wrapper ${dismissed ? 'dismissed' : ''}`} style={{ '--reveal': revealPct }}>

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
        className={`item-card ${swiping ? 'swiping' : ''}`}
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
        <div className="item-actions">
          {user && <button className="send-friend-btn" onClick={() => onSend(item)} title="Στείλε σε φίλο">📤</button>}
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



function AddFriendModal({ isOpen, onAdd, onClose, existingFriends = [] }) {
  const [key, setKey]           = useState('');
  const [loading, setLoading]   = useState(false);
  const [preview, setPreview]   = useState(null);
  const [copied, setCopied]     = useState(false);
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
    const target = friendData || (
      preview && preview !== 'not_found' && preview !== 'offline'
        ? { shareKey: preview.shareKey, username: preview.name, addedAt: Date.now() }
        : key.trim() ? { shareKey: key.trim().toUpperCase(), username: key.trim().toUpperCase(), addedAt: Date.now() } : null
    );
    if (!target) return;
    onAdd(target);
    setKey('');
    setPreview(null);
  };

  const alreadyAdded = (sk) => existingFriends.some(f => f.shareKey === sk);

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
    <div style={{
      position:'fixed', top:0, right:0, bottom:0, zIndex:300,
      width:'min(320px, 92vw)',
      background:'var(--bg-card)',
      borderLeft:'1px solid var(--border-light)',
      boxShadow:'-12px 0 40px rgba(0,0,0,0.3)',
      display:'flex', flexDirection:'column',
      animation:'slideInRight 0.25s cubic-bezier(0.34,1.56,0.64,1)',
    }}>
      {/* Header */}
      <div style={{ padding:'20px 20px 16px', borderBottom:'1px solid var(--border-light)', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <div>
          <h3 style={{ margin:0, fontSize:16, fontWeight:800 }}>Κοινό Καλάθι</h3>
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
        <h2 className="welcome-title">Καλώς ήρθες στο<br /><span>Smart Grocery Hub</span></h2>
        <p className="welcome-subtitle">Το έξυπνο καλάθι αγορών που συγκρίνει τιμές από όλα τα σούπερ μάρκετ σε πραγματικό χρόνο.</p>
        <div className="welcome-features">
          {[
            { icon:'🔍', title:'Έξυπνη Αναζήτηση',   sub:'Τιμές από ΑΒ, Σκλαβενίτη, MyMarket & άλλα', locked:true },
            { icon:'🍽️', title:'Συνταγές & Υλικά',    sub:'Προσθήκη υλικών απευθείας στη λίστα', locked:true },
            { icon:'📋', title:'Βασική Λίστα',         sub:'Δωρεάν για όλους', locked:false },
            { icon:'🤝', title:'Κοινό Καλάθι',         sub:'Μοιράσου τη λίστα με φίλους', locked:true },
            { icon:'✨', title:'...και πολλά άλλα',    sub:'Barcode scanner, θερμίδες, smart route', locked:true, isMore:true },
          ].map(({ icon, title, sub, locked, isMore }) => (
            <div key={title} className={`wf-row ${locked ? 'wf-locked' : ''} ${isMore ? 'wf-more' : ''}`}>
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

// ─── Barcode Scanner Modal ───────────────────────────────────────────────────
function BarcodeScannerModal({ isOpen, onClose }) {
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

        html5Qr = new Html5Qrcode(scannerDivId);
        scannerRef.current = html5Qr;
        if (cancelled) return;
        await html5Qr.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 120 }, aspectRatio: 1.333, disableFlip: false },
          (text) => {
            if (html5Qr.isScanning) html5Qr.stop().catch(() => {});
            handleBarcodeScan(text);
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
      } catch (err) {
        if (!cancelled) setError('Δεν μπόρεσε να ανοίξει η κάμερα. Δώσε πρόσβαση.');
      }
    };
    const timer = setTimeout(startScanner, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (html5Qr) {
        try { if (html5Qr.isScanning) html5Qr.stop().catch(() => {}); } catch {}
        try { html5Qr.clear(); } catch {}
      }
      scannerRef.current = null;
    };
  }, [isOpen, activeView, product, scanKey]);

  const stopScanner = () => {
    if (scannerRef.current) {
      try { if (scannerRef.current.isScanning) scannerRef.current.stop().catch(() => {}); } catch {}
      try { scannerRef.current.clear(); } catch {}
      scannerRef.current = null;
    }
  };

  const handleBarcodeScan = async (barcode) => {
    setLoading(true);
    setError('');
    try { new Audio('data:audio/mp3;base64,//MkxAAQhEBEFmACAAAI0HqAgIICuS39R/4AAAABh//MkxAAYS15QAAwYyAAwAQA4B5///wAAC////wAAA//MkxAAQgAAAAAQQAAAwAAAwD///wAAAP///wAAA//MkxAARQAAAAAQQAAAwAAAwD///wAAAP///wAAA').play().catch(()=>{}); } catch(e){}
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);

    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json?fields=product_name,product_name_el,product_name_en,generic_name,generic_name_el,brands,image_front_small_url,image_front_url,image_url,nova_group,nutriscore_grade,nutriments,allergens_tags,traces_tags,additives_tags,additives_original_tags,ingredients_text,ingredients_text_el,ingredients_analysis_tags,quantity,packaging,categories,labels,manufacturing_places,origins,stores,countries`);
      const data = await r.json();
      
      if (data.status === 1 && data.product) {
        const p = data.product;
        const fallbackName = `Προϊόν (${barcode})`;
        const parsedName = [p.product_name_el, p.product_name, p.product_name_en, p.generic_name_el, p.generic_name].find(n => n && n.trim()) || fallbackName;
        
        // Parse additives with friendly names
        const additivesTags = p.additives_original_tags || p.additives_tags || [];
        const additives = additivesTags.map(a => {
          const code = a.replace(/^en:/, '').toUpperCase();
          return code;
        }).filter(Boolean);

        // Detect palm oil more accurately
        const ingredientsText = p.ingredients_text_el || p.ingredients_text || '';
        const hasPalmOil = /palm/i.test(ingredientsText) || (p.ingredients_analysis_tags || []).some(t => t.includes('palm-oil'));
        
        // Get vegan/vegetarian from analysis tags
        const analysisTags = p.ingredients_analysis_tags || [];
        const isVegan = analysisTags.some(t => t === 'en:vegan');
        const isVegetarian = analysisTags.some(t => t === 'en:vegetarian' || t === 'en:vegan');

        const parsed = {
          barcode,
          name: parsedName,
          brand: p.brands ? p.brands.split(',')[0].trim() : null,
          image: p.image_front_small_url || p.image_front_url || p.image_url || null,
          novaGroup: p.nova_group || null,
          nutriScore: p.nutriscore_grade || null,
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
        setError(`Δεν βρέθηκε στη βάση (Barcode: ${barcode})`);
      }
    } catch {
      setError('Σφάλμα σύνδεσης. Δοκίμασε ξανά.');
    }
    setLoading(false);
  };

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
    if (p.novaGroup === 4) w.push({ icon:'⚠️', text:'Ultra-processed food', detail:'NOVA 4', type:'bad', clickable:true, desc:'Τα τρόφιμα NOVA 4 έχουν υποστεί βιομηχανική επεξεργασία και περιέχουν πολλά πρόσθετα. Συνδέονται με αυξημένο κίνδυνο παχυσαρκίας και χρόνιων παθήσεων.' });
    
    if (p.fat != null && p.sugars != null && getNutrientLevel(p.fat, 'fat') === 'low' && getNutrientLevel(p.sugars, 'sugars') === 'low') w.push({ icon:'✅', text:'Χαμηλά λιπαρά & ζάχαρη', detail:'', type: 'good' });
    if (p.proteins != null && p.proteins >= 10) w.push({ icon:'💪', text:'Υψηλή πρωτεΐνη', detail:`${p.proteins.toFixed(1)}g`, type: 'good', clickable:true, desc:`Πρωτεΐνη: ${p.proteins.toFixed(1)}g/100g. Άριστη πηγή πρωτεΐνης για μυϊκή ανάπτυξη και κορεσμό.` });
    if (p.fiber != null && p.fiber >= 5) w.push({ icon:'🥦', text:'Πλούσιες φυτικές ίνες', detail:`${p.fiber.toFixed(1)}g`, type: 'good', clickable:true, desc:`Φυτικές ίνες: ${p.fiber.toFixed(1)}g/100g. Συμβάλλουν στη σωστή λειτουργία του πεπτικού συστήματος.` });
        
    return w.sort((a, b) => (a.type === 'bad' ? -1 : 1));
  };

  if (!isOpen) return null;

  return createPortal(
    <div className={`scanner-overlay ${isClosing ? 'closing' : ''}`} onMouseDown={(e) => e.target === e.currentTarget && handleClose()}>
      <div className={`scanner-card ${isClosing ? 'closing' : ''}`}>
        <button className="recipe-popup-close" onClick={handleClose}>✕</button>
        {ingredientDetail && <IngredientDetailModal item={ingredientDetail} onClose={() => setIngredientDetail(null)} />}

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
                const card = document.querySelector('.scanner-card');
                if (card) { const h = card.offsetHeight; card.style.minHeight = h + 'px'; setTimeout(() => { card.style.minHeight = ''; }, 400); }
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
              <>
                <div className="scanner-viewfinder">
                  <div id={scannerDivId} key={scanKey} style={{ width:'100%' }} />
                  <div className="scanner-frame">
                    <div className="sf-corner sf-tl" /><div className="sf-corner sf-tr" />
                    <div className="sf-corner sf-bl" /><div className="sf-corner sf-br" />
                    <div className="sf-laser" />
                  </div>
                </div>
                <p className="scanner-hint">Στόχευσε το barcode του προϊόντος</p>
              </>
            )}
          </div>
        )}

        {/* ── PRODUCT RESULT ── */}
        {activeView === 'scan' && product && (
          <div className="scanner-body scanner-result">
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
                        {h.nutriScore && (
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

  // Pre-clean ingredients and instructions once on mount
  const cleanIngredients = (recipe.ingredients || [])
    .map(cleanRecipeText)
    .filter(s => s.length > 1);

  const cleanInstructions = (recipe.instructions || [])
    .map(s => cleanRecipeText(s).replace(/^\d+[\.\)]\s*/, '')) // strip leading "1. "
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

        {recipe.image ? (
          <div className="recipe-popup-hero" style={{ backgroundImage: `url(${recipe.image})` }}>
            <div className="recipe-popup-hero-overlay">
              <div style={{ display:'flex', gap:6, marginBottom:8, flexWrap:'wrap' }}>
                {recipe.cuisine && recipe.cuisine !== 'Διεθνής' && (
                  <span className="recipe-popup-tag">{recipe.cuisine}</span>
                )}
                {recipe.category && (
                  <span className="recipe-popup-tag">{recipe.category}</span>
                )}
              </div>
              <h2 className="recipe-popup-title">{recipe.title}</h2>
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
            <h2 className="recipe-popup-title">{recipe.title}</h2>
            <div className="recipe-popup-meta-inline" style={{ color:'var(--text-muted)' }}>
              <span>⏱️ {recipe.time || 30} λεπτά</span>
              <span>•</span>
              <span>🍽️ {recipe.servings || 4} μερίδες</span>
            </div>
          </div>
        )}

        <div className="recipe-popup-body">
          {recipe.description && (
            <p style={{ fontSize:13, lineHeight:1.65, color:'var(--text-secondary)', margin:'0 0 16px', paddingBottom:16, borderBottom:'1px solid var(--border-light)' }}>{recipe.description}</p>
          )}

          <div className="recipe-nutri-dashboard" style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:8, marginBottom:14 }}>
            {macros.map((m, i) => (
              <div key={i} style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:4, padding:'12px 6px', borderRadius:14, background:'var(--bg-subtle)', border:'1px solid var(--border-light)', transition:'transform 0.3s cubic-bezier(0.34,1.56,0.64,1)' }}>
                <div style={{ width:28, height:28, borderRadius:9, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, background:`${m.color}15`, color:m.color }}>{m.icon}</div>
                <div style={{ fontSize:17, fontWeight:900, lineHeight:1.1, color:m.color }}>{m.value || '-'}{m.unit && <span style={{ fontSize:10, opacity:0.6, marginLeft:1 }}>{m.unit}</span>}</div>
                <div style={{ fontSize:9, textTransform:'uppercase', fontWeight:800, color:'var(--text-muted)', letterSpacing:0.5 }}>{m.label}</div>
              </div>
            ))}
          </div>

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
                  tag === 'high-protein' ? '💪 High Protein' :
                  tag === 'low-carb' ? '🥑 Low Carb' :
                  tag === 'quick' ? '⚡ Γρήγορη' :
                  tag === 'vegan' ? '🌱 Vegan' :
                  tag === 'vegetarian' ? '🥬 Χορτοφαγική' :
                  tag === 'gluten-free' ? '🌾 Χωρίς Γλουτένη' :
                  tag === 'dairy-free' ? '🥛 Χωρίς Γαλακτοκομικά' :
                  tag === 'healthy' ? '💚 Υγιεινή' :
                  tag === 'budget' ? '💰 Οικονομική' :
                  tag === 'low-fat' ? '🫒 Low Fat' :
                  tag
                }</span>
              ))}
            </div>
          )}

          <button className="add-recipe-btn" onClick={(e) => { e.stopPropagation(); onAddToList(); }}>
            🛒 Προσθήκη Υλικών στη Λίστα
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
  const chatEndRef = useRef(null);

  // ── Friends state ──────────────────────────────────────────────────────────
  const [friends, setFriends]                 = useState([]);  // loaded from DB on login
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
  const [favoritesLoaded, setFavoritesLoaded]   = useState(false);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [recipePage, setRecipePage]         = useState(1);
  const [recipeTotalPages, setRecipeTotalPages] = useState(1);
  const [recipeCategory, setRecipeCategory] = useState('');
  const [recipeCuisine, setRecipeCuisine]   = useState('');
  const [recipeSearchDebounced, setRecipeSearchDebounced] = useState('');
  const recipeFridgeTimer = useRef(null);
  const [showScanner, setShowScanner]     = useState(false);
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
  const [mealPlanShoppingList, setMealPlanShoppingList] = useState([]);
  const [mealPlanPrefs,      setMealPlanPrefs]       = useState({
    persons: 2, days: 7, budget: 80, goal: 'balanced', restrictions: []
  });

  // TDEE Calculator state
  const [tdeeAge,      setTdeeAge]      = useState('22-28');  // age range
  const [tdeeGender,   setTdeeGender]   = useState('male');
  const [tdeeHeight,   setTdeeHeight]   = useState(175);
  const [tdeeWeight,   setTdeeWeight]   = useState(75);
  const [tdeeActivity, setTdeeActivity] = useState('moderate');
  const [tdeeBodyFat,  setTdeeBodyFat]  = useState('');
  const [tdeeResult,   setTdeeResult]   = useState(null);
  const [tdeeGoal,     setTdeeGoal]     = useState(null);
  const [showTdeeCalc, setShowTdeeCalc] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [showSmartShopping, setShowSmartShopping] = useState(false);

  // ── Daily Streak ───────────────────────────────────────────────────────────
  const [streak,          setStreak]          = useState(0);
  const [streakToast,     setStreakToast]      = useState('');
  const [isNewStreakRecord, setIsNewStreakRecord] = useState(false);

  const storeOptions  = ['Όλα','ΑΒ Βασιλόπουλος','Σκλαβενίτης','MyMarket','Μασούτης','Κρητικός','Γαλαξίας','Market In'];
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
    } catch {}

    // 2. Update local state with confirmed (or optimistic) data
    const normalizedFriend = confirmedFriend || {
      shareKey: friend.shareKey,
      username: friend.username || friend.name || friend.shareKey,
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
    } catch {}
  };

  const removeFriend = async (shareKey) => {
    setFriends(prev => prev.filter(f => f.shareKey !== shareKey));
    // Also remove from DB (bidirectional)
    try {
      await fetch(`${API_BASE}/api/auth/remove-friend/${shareKey}`, {
        method: 'DELETE',
        headers: authHeader(),
      });
    } catch {}
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
      friends.forEach(f => {
        if (f?.shareKey) socketRef.current.emit('join_cart', f.shareKey);
      });
    }

    socketRef.current.on('receive_item', (itemData) => {
      setItems(prev => [{ ...itemData, id: Date.now() + Math.random() }, ...prev]);
      setNotification({ show:true, message:`🔔 Νέο προϊόν από φίλο: ${itemData.text}` });
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    });

    socketRef.current.on('receive_message', (msg) => {
      setChatMessages(prev => {
        // Avoid duplicate if we already have this exact _id
        if (msg._id && prev.some(m => m._id === msg._id)) return prev;
        return [...prev, msg];
      });
      if (!showChatPanel) {
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
        const newFriend = { shareKey: data.from.shareKey, username: data.from.username || data.from.name, addedAt: Date.now() };
        // Reload chat to include their messages
        setTimeout(() => loadGroupChat([...prev, newFriend]), 300);
        return [...prev, newFriend];
      });
    });

    return () => socketRef.current.disconnect();
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

  // Load friends from DB every time the user changes (login/logout)
  useEffect(() => {
    if (user) {
      loadFriendsFromDB();
    } else {
      setFriends([]);
    }
  }, [user?.shareKey]); // eslint-disable-line

  useEffect(() => { loadGroupChat(); }, [user, friends.length]);

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
  const fetchRecipes = useCallback(async (page = 1, append = false) => {
    if (!append) setRecipesLoading(true);

    const params = new URLSearchParams({
      page: String(page),
      limit: '20',
      ...(recipeCategory && { category: recipeCategory }),
      ...(recipeCuisine  && { cuisine: recipeCuisine }),
      ...(recipeSearchDebounced && { search: recipeSearchDebounced }),
    });

    // Try cache first (only for page 1, no filters)
    if (page === 1 && !recipeCategory && !recipeCuisine && !recipeSearchDebounced) {
      const ck = cacheGet('recipes');
      if (ck && !ck.stale) {
        const cachedData = Array.isArray(ck.data) ? ck.data : (ck.data.recipes || []);
        if (cachedData.length > 0) {
          setRecipes(cachedData);
          setRecipesLoading(false);
          return;
        }
      }
    }

    try {
      const r = await fetch(`${API_BASE}/api/recipes?${params}`);
      if (r.ok) {
        const d = await r.json();
        const actualRecipes = d.recipes || d;
        if (Array.isArray(actualRecipes)) {
          if (page === 1 && !recipeCategory && !recipeCuisine && !recipeSearchDebounced) {
            cacheSet('recipes', actualRecipes);
          }
          if (append) {
            setRecipes(prev => [...prev, ...actualRecipes]);
          } else {
            setRecipes(actualRecipes);
          }
          setRecipeTotalPages(d.pages || 1);
          setRecipePage(d.page || page);
        }
      }
    } catch (err) {
      console.error('❌ fetchRecipes:', err);
      if (recipes.length === 0) {
        const ck = cacheGet('recipes');
        if (ck) {
          const cachedData = Array.isArray(ck.data) ? ck.data : (ck.data.recipes || []);
          setRecipes(cachedData);
        }
      }
    }
    setRecipesLoading(false);
  }, [recipeCategory, recipeCuisine, recipeSearchDebounced]);

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

  useEffect(() => { if (user) syncFavorites(); }, [user, syncFavorites]);

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
    if (navigator.vibrate) navigator.vibrate(30);
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
      } catch {}
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
    setItems(prev => [...newItems, ...prev]);
    setActiveTab('list');
  };

  const closeRecipeAddModal = () => {
    setRecipeAddModal({ open:false, recipeName:'', progress:0, total:0 });
    setNotification({ show:true, message:'✅ Υλικά προστέθηκαν στη λίστα!' });
  };

  // ── Meal Plan functions ────────────────────────────────────────────────────
  // TDEE Calculator (Mifflin-St Jeor)
  const calculateTDEE = () => {
    const w = parseFloat(tdeeWeight), h = parseFloat(tdeeHeight);
    // Use midpoint of selected age range
    const ageStr = String(tdeeAge);
    let a;
    if (ageStr === '65+') { a = 68; }
    else {
      const ageParts = ageStr.split('-');
      a = ageParts.length === 2
        ? (parseFloat(ageParts[0]) + parseFloat(ageParts[1])) / 2
        : parseFloat(ageStr);
    }
    if (!w || !h || !a) return;
    // BMR
    const bmr = tdeeGender === 'male'
      ? 10 * w + 6.25 * h - 5 * a + 5
      : 10 * w + 6.25 * h - 5 * a - 161;
    const multipliers = { sedentary:1.2, light:1.375, moderate:1.55, active:1.725, veryactive:1.9 };
    const tdee = Math.round(bmr * (multipliers[tdeeActivity] || 1.55));
    // If body fat % provided, also show Katch-McArdle
    let lbm = null;
    if (tdeeBodyFat) {
      lbm = w * (1 - parseFloat(tdeeBodyFat) / 100);
    }
    const goals = {
      maintain:  { label: 'Διατήρηση βάρους',        kcal: tdee,        color: '#10b981' },
      mild:      { label: 'Ήπια απώλεια βάρους',      kcal: tdee - 250,  color: '#6366f1' },
      loss:      { label: 'Απώλεια βάρους',           kcal: tdee - 500,  color: '#f59e0b' },
      extreme:   { label: 'Ακραία απώλεια βάρους',    kcal: tdee - 1000, color: '#ef4444' },
    };
    // Zigzag: 7-day alternating high/low
    const zigzag = (base) => {
      const high = Math.round(base * 1.15);
      const low  = Math.round(base * 0.85);
      return [high, low, high, low, high, low, high];
    };
    const result = { bmr: Math.round(bmr), tdee, goals, lbm: lbm ? Math.round(lbm) : null };
    Object.keys(goals).forEach(k => { result.goals[k].zigzag = zigzag(goals[k].kcal); });
    setTdeeResult(result);
  };

  const generateMealPlan = async () => {
    setMealPlanLoading(true);
    setMealPlanError('');
    setMealPlan(null);
    try {
      const res = await fetch(`${API_BASE}/api/meal-plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...mealPlanPrefs,
          tdee: tdeeGoal && tdeeResult ? tdeeResult.goals[tdeeGoal]?.kcal : null,
          zigzag: tdeeGoal && tdeeResult ? tdeeResult.goals[tdeeGoal]?.zigzag : null,
          gender: tdeeGender,
          age: tdeeAge,
          weight: tdeeWeight,
          height: tdeeHeight,
          activityLevel: tdeeActivity,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Σφάλμα AI');
      setMealPlan(data.plan);
      setMealPlanStats(data.stats);
      setMealPlanShoppingList(data.shoppingList || []);
      setActiveMealDay(0);
    } catch (e) {
      setMealPlanError(e.message);
    } finally {
      setMealPlanLoading(false);
    }
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

  const toggleMealRestriction = (r) => {
    setMealPlanPrefs(p => ({
      ...p,
      restrictions: p.restrictions.includes(r) ? p.restrictions.filter(x => x !== r) : [...p.restrictions, r]
    }));
  };

  const deleteItem = useCallback((id) => setItems(prev => prev.filter(i => i.id !== id)), []);

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
  const totalCost = items.reduce((s, i) => s + (i.price > 0 ? i.price : 0), 0);

  // Smart Shopping: group items by store, sorted by total value desc
  const smartStoreGroups = Object.entries(
    items.filter(i => i.store && i.store !== '—' && i.store !== '').reduce((acc, item) => {
      const s = item.store;
      if (!acc[s]) acc[s] = { items: [], total: 0 };
      acc[s].items.push(item);
      acc[s].total += item.price > 0 ? item.price : 0;
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
    };
    socketRef.current.emit('send_message', msgData);
    setChatMessages(prev => [...prev, { ...msgData, _id: 'local_' + Date.now() }]);
    setChatInput('');
  };

  // When showing favorites, use the offline-safe favoriteRecipes array
  const baseRecipes = showFavoritesOnly ? favoriteRecipes : recipes;

  const filteredRecipes = baseRecipes
    .filter(r => r && r.title)
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

  // ── Smart Route: count unique stores in user's list ──────────────────────
  const uniqueStoresInList = [...new Set(
    items.filter(i => i.store && i.store !== 'Άγνωστο').map(i => i.store)
  )].length;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app-wrapper">
      <OfflineBanner isOnline={isOnline} wasOffline={wasOffline} />
      {showWelcome && !user && <WelcomeModal onLogin={handleWelcomeLogin} onRegister={handleWelcomeRegister} onSkip={handleWelcomeSkip} />}

      <SavedListsModal isOpen={showListsModal} onClose={() => setShowListsModal(false)} lists={savedLists} onDelete={deleteList} onToggleItem={toggleListItem} />
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onLoginSuccess={(u) => {
          setUser(u);
          // Friends will be loaded by the useEffect above when user changes
        }} initMode={authInitMode} />
      <NameModal isOpen={nameModalOpen} value={nameModalValue} onChange={setNameModalValue} onConfirm={handleSaveConfirm} onCancel={() => setNameModalOpen(false)} />
      <ConfirmModal isOpen={confirmModal.open} message={confirmModal.message} onConfirm={confirmModal.onConfirm} onCancel={() => setConfirmModal({ open:false, message:'', onConfirm:null })} />
      <RecipeNotification show={notification.show} message={notification.message} onClose={() => setNotification({ show:false, message:'' })} />
      <RecipeAddModal isOpen={recipeAddModal.open} recipeName={recipeAddModal.recipeName} progress={recipeAddModal.progress} total={recipeAddModal.total} onClose={closeRecipeAddModal} />
      <BarcodeScannerModal isOpen={showScanner} onClose={() => setShowScanner(false)} />
      {/* Friend modals & panel */}
      <FriendPickerModal isOpen={friendPicker.open} friends={friends} item={friendPicker.item} onSend={handlePickerSend} onClose={() => setFriendPicker({ open:false, item:null })} />
      <AddFriendModal isOpen={showAddFriendModal} onAdd={addFriend} onClose={() => setShowAddFriendModal(false)} existingFriends={friends} />
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
                      <div className={`chat-bubble ${isMine ? 'chat-mine' : 'chat-other'}`} style={{ maxWidth:'78%', wordBreak:'break-word' }}>
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

            <div style={{ padding:'16px', borderTop:'1px solid var(--border-light)', background:'var(--bg-surface)' }}>
              <form onSubmit={handleSendMessage} style={{ display:'flex', gap:'8px' }}>
                <input 
                  type="text" placeholder="Γράψε μήνυμα..." value={chatInput} onChange={e => setChatInput(e.target.value)}
                  style={{ flex:1, padding:'12px 16px', borderRadius:'14px', border:'1px solid var(--border)', background:'var(--bg-input)', color:'var(--text-primary)', outline:'none' }}
                />
                <button type="submit" disabled={!chatInput.trim()} style={{ background:'linear-gradient(135deg,#6366f1,#8b5cf6)', color:'white', border:'none', borderRadius:'14px', width:'46px', cursor: chatInput.trim() ? 'pointer' : 'not-allowed', opacity: chatInput.trim() ? 1 : 0.5, display:'flex', alignItems:'center', justifyContent:'center', transition:'all 0.2s' }}>
                  <IconArrowRight size={18} stroke={2.5}/>
                </button>
              </form>
            </div>
          </div>
        </>
      )}

      <div className="container" style={!isOnline ? { marginTop: 64 } : {}}>
        {isScraping && (
          <div className="live-scraping-banner"><div className="pulsing-dot" /><span>LIVE ΕΝΗΜΕΡΩΣΗ ΤΙΜΩΝ...</span></div>
        )}

        {/* ── Header ── */}
        <header className="app-header">
          
          {/* Πάνω: Ώρα, Ημερομηνία & Streak κεντραρισμένα */}
          <div className="header-clock-center" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <div className="datetime-display" style={{ maxWidth: '240px', margin: '0 auto' }}>
              <div className="current-date">{timeGreeting} {timeIcon}</div>
              <div className="current-time">{currentTime.toLocaleDateString('el-GR', { weekday:'long', day:'numeric', month:'long' })}</div>
              <div className="current-clock">{currentTime.toLocaleTimeString('el-GR', { timeZone:'Europe/Athens', hour:'2-digit', minute:'2-digit' })}</div>
            </div>

            {/* Streak Badge */}
            {streak >= 2 && (
              <div
                className={`streak-badge${isNewStreakRecord ? ' new-record' : ''}`}
                title={`${streak} μέρες στη σειρά! Καλύτερο: ${JSON.parse(localStorage.getItem('sg_streak')||'{}').best || streak}`}
              >
                🔥 <span>{streak}</span>
              </div>
            )}
          </div>

          {/* Τίτλος */}
          <h1 style={{ background:"linear-gradient(135deg, var(--brand-primary), #a855f7)", WebkitBackgroundClip:"text", WebkitTextFillColor:"transparent", backgroundClip:"text", textAlign: 'center', marginTop: '15px' }}>
            Smart Grocery Hub
          </h1>

          {/* Κάτω: Κουμπιά κεντραρισμένα σε νέα σειρά */}
          <div className="header-actions-row">
            <div className="header-actions">
              {!isOnline && (
                <div style={{ display:'flex', alignItems:'center', gap:4, background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:99, padding:'4px 10px', fontSize:11, fontWeight:700, color:'#ef4444' }}>
                  📡 Offline
                </div>
              )}

              {/* Barcode scanner button */}
              {user && (
                <div className="action-btn-new scanner-btn-header" onClick={() => setShowScanner(true)} title="Σάρωση Barcode">
                  <IconQrcode size={20} stroke={1.8} />
                </div>
              )}

              {/* Friends button with badge */}
              <div
                className="action-btn-new"
                style={{ position:'relative' }}
                onClick={() => { if (!user) return setShowAuthModal(true); setShowFriendsPanel(true); }}
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
                <div className="action-btn-new" style={{ position:'relative' }} onClick={() => setShowChatPanel(true)} title="Chat Καλαθιού">
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
                    return setShowAuthModal(true);
                  }
                  setShowListsModal(true);
                }}
                title="Λίστες μου"
                style={{ position:'relative' }}
              >
                <IconNotes size={20} stroke={1.8} />
                {savedLists.length > 0 && <span className="list-badge">{savedLists.length}</span>}
              </div>

              {user ? (
                <div style={{ position:'relative' }}>
                  <div className="action-btn-new" onClick={() => setShowProfileMenu(v => !v)} title={user.name}>
                    <IconUser size={20} stroke={1.8} />
                  </div>
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
                        <div className="dropdown-item" onClick={() => { setIsDarkMode(v => !v); setShowProfileMenu(false); }} style={{ display:'flex', alignItems:'center', gap:8 }}>{isDarkMode ? <><IconSun size={16}/> Light Mode</> : <><IconMoon size={16}/> Dark Mode</>}</div>
                        <div className="dropdown-item logout" onClick={handleLogout} style={{ display:'flex', alignItems:'center', gap:8 }}><IconLogout size={16}/> Αποσύνδεση</div>
                      </div>
                    </>
                  )}
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
                    setShowAuthModal(true);
                  }}
                  title="Σύνδεση"
                >
                  <IconLock size={20} stroke={1.8} />
                </div>
              )}
            </div>
          </div>
        </header>
        

        {/* ── Tabs ── */}
        <div className="tabs-container">
          {[
            ['list', <><IconShoppingCart size={16} stroke={2}/> Λίστα</>, 'Λίστα'],
            ['recipes', <><IconChefHat size={16} stroke={2}/> Συνταγές</>, 'Συνταγές'],
            ['mealplan', <><IconSparkles size={16} stroke={2}/> AI Plan</>, 'AI Plan'],
            ['brochures', <><IconTag size={16} stroke={2}/> Φυλλάδια</>, 'Φυλλάδια'],
          ].map(([tab, label, labelText]) => {
            const isLocked = !user && (tab === 'recipes' || tab === 'mealplan');
            const isActive = activeTab === tab;
            return (
              <button
                key={tab}
                className={`tab-btn ${isActive ? 'active' : ''} ${isLocked ? 'tab-btn-locked' : ''}`}
                onClick={() => {
                  if (isLocked) {
                    // #region agent log
                    debugLog({
                      runId: 'pre-repro',
                      hypothesisId: 'H3',
                      location: 'App.jsx:tabs',
                      message: 'Locked tab clicked while unauthenticated',
                      data: { tab },
                    });
                    // #endregion
                    setAuthInitMode('register');
                    setShowAuthModal(true);
                    return;
                  }
                  setActiveTab(tab);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                style={{ display:'flex', alignItems:'center', gap:5 }}
              >
                {label}
                {isLocked && <span className="tab-lock-indicator">🔒</span>}
              </button>
            );
          })}
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
                  {user && <div style={{ fontSize:10, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:0.5 }}>Κόστος</div>}
                  {user && <div className="budget-amount" style={{ fontSize:'22px', fontWeight:'bold', color:'var(--brand-primary)' }}>{totalCost.toFixed(2)}€</div>}
                  <div style={{ fontSize:11, color:'var(--text-secondary)', marginTop: user ? 2 : 0 }}>{items.length} προϊόντα</div>
                </div>
                <div style={{ display:'flex', gap:'8px' }}>
                  <button onClick={handleMassClear} style={{ background:'rgba(239,68,68,0.1)', color:'var(--brand-danger)', border:'none', padding:'10px', borderRadius:'10px', cursor:'pointer', fontSize:18 }} title="Αδείασμα">🗑️</button>
                  {user && <button onClick={saveCurrentList} style={{ background:'linear-gradient(135deg,#059669,#10b981)', color:'white', border:'none', padding:'10px 16px', borderRadius:'10px', cursor:'pointer', fontWeight:'bold', fontSize:13 }} title="Αποθήκευση">💾 Αποθήκευση</button>}
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
                      {smartStoreGroups.map(([store, data], i) => (
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
                    {store}
                  </button>
                ))}
              </div>
              )}

              <div className="input-section" style={{ position:'relative' }}>
                <input
                  type="text"
                  placeholder={!isOnline ? '📡 Offline — αναζήτηση μη διαθέσιμη' : user ? 'Αναζήτηση προϊόντος...' : 'Γράψε προϊόν...'}
                  value={inputValue}
                  onChange={user ? handleInputChange : (e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { user ? triggerSearch(inputValue, selectedStore) : addPlainItem(); } }}
                  readOnly={!isOnline}
                  style={!isOnline ? { cursor:'not-allowed', opacity:0.7 } : {}}
                />
                {user && (
                  <button className={`voice-btn ${isListening ? 'listening' : ''}`} onClick={handleVoiceClick} title="Φωνητική αναζήτηση">
                    {isListening ? '🔴' : '🎤'}
                  </button>
                )}
                <button className="add-btn" onClick={() => user ? triggerSearch(inputValue, selectedStore) : addPlainItem()} title={user ? 'Αναζήτηση' : 'Προσθήκη'}>+</button>
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
                <p style={{ marginBottom: 18 }}>
                  {user
                    ? 'Αναζήτησε προϊόντα παραπάνω ή χρησιμοποίησε 🎤 για φωνητική εισαγωγή'
                    : 'Γράψε ό,τι χρειάζεσαι και πάτα + για να το προσθέσεις'}
                </p>
                {/* Quick-add suggestions */}
                <div style={{ display:'flex', flexWrap:'wrap', gap:7, justifyContent:'center', marginBottom: user ? 0 : 16 }}>
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
                {!user && <button className="locked-unlock-btn" style={{ marginTop:'4px' }} onClick={() => setShowAuthModal(true)}>Σύνδεση για τιμές, συνταγές & άλλα</button>}
              </div>
            ) : (
              <div className="categories-container">
                {Object.keys(groupedItems).sort().map(cat => (
                  <div key={cat} className="category-group">
                    <h2 className="category-title">{cat}</h2>
                    <ul className="grocery-list">
                      {groupedItems[cat].map(item => (
                        <SwipeableItem key={item.id} item={item} onDelete={deleteItem} onSend={handleSendToFriend} user={user} />
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════ RECIPES TAB — PREMIUM ════ */}
        {activeTab === 'recipes' && (
          <div className="tab-content recipes-tab">
            {!user ? (
              <LockedFeature label="Συνταγές" onUnlock={() => { setAuthInitMode('register'); setShowAuthModal(true); }} />
            ) : (
            <>
                {!isOnline && (
                  <div style={{ background:'rgba(239,68,68,0.08)', border:'1px solid rgba(239,68,68,0.2)', borderRadius:12, padding:'12px 16px', marginBottom:16, display:'flex', alignItems:'center', gap:10, fontSize:13 }}>
                    <span>📡</span>
                    <div><strong>Offline mode</strong> — Συνταγές από τελευταία φόρτωση.</div>
                  </div>
                )}

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
                      <button
                        onClick={() => setFridgeQuery('')}
                        style={{ background:'none', border:'none', color:'var(--text-muted)', cursor:'pointer', padding:4, display:'flex' }}
                      >
                        <IconX size={16} />
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Category Pills ── */}
                <div className="recipe-category-scroll">
                  <button
                    className={`recipe-cat-pill fav-pill ${showFavoritesOnly ? 'active' : ''}`}
                    onClick={() => { setShowFavoritesOnly(v => !v); setRecipeCategory(''); setRecipePage(1); }}
                  >
                    ❤️ Αγαπημένα {favoriteRecipes.length > 0 && <span className="fav-count">{favoriteRecipes.length}</span>}
                  </button>
                  {[
                    { id: '', label: '🍽️ Όλες' },
                    { id: 'Κυρίως', label: '🥘 Κυρίως' },
                    { id: 'Σαλάτες', label: '🥗 Σαλάτες' },
                    { id: 'Σούπες', label: '🍲 Σούπες' },
                    { id: 'Πρωινό', label: '🍳 Πρωινό' },
                    { id: 'Σνακ', label: '🍏 Σνακ' },
                    { id: 'Επιδόρπια', label: '🍰 Επιδόρπια' },
                    { id: 'Συνοδευτικά', label: '🥗 Συνοδευτικά' },
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
                    {id:'all', label:'Όλες'},
                    {id:'protein', label:'💪 High Protein'},
                    {id:'nosugar', label:'🚫 No Sugar'},
                    {id:'fast', label:'⏱️ Γρήγορες'},
                    {id:'vegan', label:'🌱 Vegan'},
                    {id:'budget', label:'💰 Οικονομικές'}
                  ].map(f => (
                    <button key={f.id} className={`filter-btn ${recipeFilter === f.id ? 'active' : ''}`} onClick={() => setRecipeFilter(f.id)}>{f.label}</button>
                  ))}
                </div>

                {/* ── Results count ── */}
                {!recipesLoading && filteredRecipes.length > 0 && (
                  <div style={{ fontSize:12, color:'var(--text-muted)', padding:'0 2px 12px', fontWeight:500 }}>
                    {filteredRecipes.length} συνταγ{filteredRecipes.length === 1 ? 'ή' : 'ές'}
                    {recipeCategory && <span> στην κατηγορία <strong style={{ color:'var(--text-secondary)' }}>{recipeCategory}</strong></span>}
                    {fridgeQuery && <span> για «<strong style={{ color:'var(--text-secondary)' }}>{fridgeQuery}</strong>»</span>}
                  </div>
                )}

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
                        <div
                          key={recipe._id || recipe.title}
                          className="recipe-card-v2"
                          onClick={() => recipe._id && setExpandedRecipe(recipe._id)}
                          style={{ animationDelay: `${Math.min(idx * 0.06, 0.5)}s` }}
                        >
                          <div className="recipe-card-img-wrap">
                            {recipe.image ? (
                              <div className="recipe-card-img" style={{ backgroundImage: `url(${recipe.image})` }} />
                            ) : (
                              <div className="recipe-card-img" style={{ height:135, background:'linear-gradient(135deg, var(--bg-subtle), var(--bg-card))', display:'flex', alignItems:'center', justifyContent:'center' }}>
                                <span style={{ fontSize:36, opacity:0.3 }}>🍽️</span>
                              </div>
                            )}
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
                            <h4 className="recipe-card-title">{recipe.title}</h4>
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
                      ))}
                    </div>

                    {/* ── Load More ── */}
                    {!showFavoritesOnly && recipePage < recipeTotalPages && (
                      <div style={{ textAlign:'center', padding:'20px 0 8px' }}>
                        <button
                          onClick={loadMoreRecipes}
                          disabled={recipesLoading}
                          style={{ padding:'12px 28px', background:'var(--bg-card)', border:'1.5px solid var(--border)', borderRadius:14, color:'var(--text-primary)', fontSize:13, fontWeight:700, fontFamily:'var(--font)', cursor:'pointer', transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)', WebkitTapHighlightColor:'transparent', opacity:recipesLoading?0.6:1 }}
                          onMouseEnter={e => { if(!recipesLoading) { e.currentTarget.style.transform='translateY(-2px)'; e.currentTarget.style.boxShadow='0 6px 20px rgba(0,0,0,0.1)'; } }}
                          onMouseLeave={e => { e.currentTarget.style.transform=''; e.currentTarget.style.boxShadow=''; }}
                        >
                          {recipesLoading ? '⏳ Φόρτωση...' : '📜 Περισσότερες Συνταγές'}
                        </button>
                      </div>
                    )}
                  </>
                )}

                {/* ── Recipe Popup Modal ── */}
                {expandedRecipe && (() => {
                  const recipe = recipes.find(r => r._id === expandedRecipe) || favoriteRecipes.find(r => r._id === expandedRecipe);
                  if (!recipe) return null;
                  return (
                    <RecipePopup
                      recipe={recipe}
                      onClose={() => setExpandedRecipe(null)}
                      onAddToList={() => addRecipeToList(recipe)}
                      isFavorite={favoriteIds.includes(recipe._id)}
                      onToggleFavorite={() => toggleFavorite(recipe._id)}
                    />
                  );
                })()}
            </>
            )}
          </div>
        )}

        {/* ════ AI MEAL PLANNER TAB ════ */}
        {activeTab === 'mealplan' && (
          <div className="tab-content">

            {/* ── Hero banner ── */}
            <div style={{ background:'linear-gradient(135deg,#6366f1 0%,#8b5cf6 50%,#a78bfa 100%)', borderRadius:20, padding:'22px 20px', marginBottom:18, position:'relative', overflow:'hidden' }}>
              <div style={{ position:'absolute', top:-20, right:-20, width:100, height:100, borderRadius:'50%', background:'rgba(255,255,255,0.08)' }}/>
              <div style={{ position:'absolute', bottom:-30, left:-10, width:80, height:80, borderRadius:'50%', background:'rgba(255,255,255,0.06)' }}/>
              <div style={{ display:'flex', alignItems:'center', gap:12, position:'relative' }}>
                <div style={{ width:48, height:48, borderRadius:14, background:'rgba(255,255,255,0.2)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <IconBrain size={26} color="#fff" stroke={1.5}/>
                </div>
                <div>
                  <div style={{ fontWeight:900, fontSize:18, color:'#fff', letterSpacing:-0.4 }}>AI Meal Planner</div>
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.8)', marginTop:2 }}>Εβδομαδιαίο πλάνο διατροφής με τιμές από τα super market σου</div>
                </div>
              </div>
            </div>

            {!mealPlan ? (
              /* ── TDEE Calculator + Preferences Form ── */
              <div style={{ display:'flex', flexDirection:'column', gap:12 }}>

                {/* TDEE Calculator toggle */}
                <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, overflow:'hidden' }}>
                  <div onClick={() => setShowTdeeCalc(s => !s)}
                    style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'14px 16px', cursor:'pointer' }}>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <div style={{ width:36, height:36, borderRadius:10, background:'linear-gradient(135deg,#10b981,#059669)', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                        <span style={{ fontSize:18 }}>⚡</span>
                      </div>
                      <div>
                        <div style={{ fontWeight:800, fontSize:14, color:'var(--text-primary)' }}>Υπολογιστής Θερμίδων (TDEE)</div>
                        <div style={{ fontSize:11, color:'var(--text-secondary)' }}>
                          {tdeeResult ? `BMR: ${tdeeResult.bmr} · TDEE: ${tdeeResult.tdee} kcal` : 'Υπολόγισε τις ιδανικές θερμίδες σου'}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize:14, color:'var(--text-muted)', transform: showTdeeCalc ? 'rotate(180deg)' : 'rotate(0)', transition:'transform 0.3s' }}>▼</div>
                  </div>

                  {showTdeeCalc && (
                    <div style={{ padding:'0 16px 16px', borderTop:'1px solid var(--border)' }}>
                      {/* Age + Gender */}
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:12 }}>
                        <div>
                          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:6 }}>ΗΛΙΚΙΑ</div>
                          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                            {[['15-18','15–18'], ['18-22','18–22'], ['22-28','22–28'], ['28-35','28–35'], ['35-45','35–45'], ['45-55','45–55'], ['55-65','55–65'], ['65+','65+']].map(([val, label]) => (
                              <button key={val} onClick={() => setTdeeAge(val)}
                                style={{ padding:'7px 10px', borderRadius:8, border:`1.5px solid ${tdeeAge===val?'#6366f1':'var(--border)'}`, background:tdeeAge===val?'rgba(99,102,241,0.12)':'var(--bg-surface)', color:tdeeAge===val?'#6366f1':'var(--text-secondary)', fontWeight:700, fontSize:12, cursor:'pointer', transition:'all 0.18s', textAlign:'left' }}>
                                {label} <span style={{ fontSize:10, color:'var(--text-muted)' }}>χρόνων</span>
                              </button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:6 }}>ΦΥΛΟ</div>
                          <div style={{ display:'flex', gap:6 }}>
                            {[['male','♂ Άνδρας'],['female','♀ Γυναίκα']].map(([v,l]) => (
                              <button key={v} onClick={() => setTdeeGender(v)}
                                style={{ flex:1, padding:'8px 4px', borderRadius:8, border:`1.5px solid ${tdeeGender===v?'#6366f1':'var(--border)'}`, background:tdeeGender===v?'rgba(99,102,241,0.12)':'var(--bg-surface)', color:tdeeGender===v?'#6366f1':'var(--text-secondary)', fontWeight:700, fontSize:11, cursor:'pointer' }}>
                                {l}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Height + Weight */}
                      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginTop:8 }}>
                        <div>
                          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:6 }}>ΥΨΟΣ (cm)</div>
                          <div style={{ display:'flex', alignItems:'center', gap:6, background:'var(--bg-surface)', borderRadius:10, padding:'8px 12px' }}>
                            <button onClick={() => setTdeeHeight(h => Math.max(140, h-1))} style={{ background:'var(--bg-card)', border:'none', borderRadius:6, width:28, height:28, cursor:'pointer', fontWeight:800, color:'var(--text-primary)' }}>-</button>
                            <span style={{ fontWeight:800, fontSize:16, flex:1, textAlign:'center', color:'var(--text-primary)' }}>{tdeeHeight}</span>
                            <button onClick={() => setTdeeHeight(h => Math.min(220, h+1))} style={{ background:'var(--bg-card)', border:'none', borderRadius:6, width:28, height:28, cursor:'pointer', fontWeight:800, color:'var(--text-primary)' }}>+</button>
                          </div>
                        </div>
                        <div>
                          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:6 }}>ΒΑΡΟΣ (kg)</div>
                          <div style={{ display:'flex', alignItems:'center', gap:6, background:'var(--bg-surface)', borderRadius:10, padding:'8px 12px' }}>
                            <button onClick={() => setTdeeWeight(w => Math.max(30, w-1))} style={{ background:'var(--bg-card)', border:'none', borderRadius:6, width:28, height:28, cursor:'pointer', fontWeight:800, color:'var(--text-primary)' }}>-</button>
                            <span style={{ fontWeight:800, fontSize:16, flex:1, textAlign:'center', color:'var(--text-primary)' }}>{tdeeWeight}</span>
                            <button onClick={() => setTdeeWeight(w => Math.min(200, w+1))} style={{ background:'var(--bg-card)', border:'none', borderRadius:6, width:28, height:28, cursor:'pointer', fontWeight:800, color:'var(--text-primary)' }}>+</button>
                          </div>
                        </div>
                      </div>

                      {/* Activity level */}
                      <div style={{ marginTop:10 }}>
                        <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:6 }}>ΕΠΙΠΕΔΟ ΔΡΑΣΤΗΡΙΟΤΗΤΑΣ</div>
                        <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                          {[
                            ['sedentary',  '🪑 Καθιστικός', 'Σπάνια ή καθόλου άσκηση'],
                            ['light',      '🚶 Ελαφρύς',    '1-2 φορές/εβδομάδα'],
                            ['moderate',   '🏃 Μέτριος',    '3-5 φορές/εβδομάδα'],
                            ['active',     '💪 Ενεργός',    '6-7 φορές/εβδομάδα'],
                            ['veryactive', '🔥 Πολύ Ενεργός','2x/μέρα, έντονη άσκηση'],
                          ].map(([v, l, sub]) => (
                            <div key={v} onClick={() => setTdeeActivity(v)}
                              style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'9px 12px', borderRadius:10, border:`1.5px solid ${tdeeActivity===v?'#6366f1':'var(--border)'}`, background:tdeeActivity===v?'rgba(99,102,241,0.08)':'var(--bg-surface)', cursor:'pointer', transition:'all 0.2s' }}>
                              <div>
                                <div style={{ fontWeight:700, fontSize:13, color:tdeeActivity===v?'#6366f1':'var(--text-primary)' }}>{l}</div>
                                <div style={{ fontSize:10, color:'var(--text-muted)' }}>{sub}</div>
                              </div>
                              <div style={{ width:18, height:18, borderRadius:'50%', border:`2px solid ${tdeeActivity===v?'#6366f1':'var(--border)'}`, background:tdeeActivity===v?'#6366f1':'transparent', flexShrink:0 }}/>
                            </div>
                          ))}
                        </div>
                      </div>

                      {/* Advanced: body fat */}
                      <div style={{ marginTop:8 }}>
                        <button onClick={() => setShowAdvanced(s=>!s)}
                          style={{ background:'none', border:'none', color:'#6366f1', fontWeight:700, fontSize:12, cursor:'pointer', padding:0 }}>
                          {showAdvanced ? '▼' : '▶'} Advanced (Προαιρετικό)
                        </button>
                        {showAdvanced && (
                          <div style={{ marginTop:8, background:'var(--bg-surface)', borderRadius:10, padding:'10px 12px' }}>
                            <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:6 }}>Ποσοστό Λίπους Σώματος % (προαιρετικό)</div>
                            <input type="number" placeholder="π.χ. 20" value={tdeeBodyFat} onChange={e => setTdeeBodyFat(e.target.value)}
                              style={{ width:'100%', padding:'8px 12px', borderRadius:8, border:'1.5px solid var(--border)', background:'var(--bg-card)', color:'var(--text-primary)', fontSize:14, boxSizing:'border-box' }}/>
                            <div style={{ fontSize:10, color:'var(--text-muted)', marginTop:4 }}>Χρησιμοποιείται για ακριβέστερο υπολογισμό (Katch-McArdle)</div>
                          </div>
                        )}
                      </div>

                      {/* Calculate button */}
                      <button onClick={calculateTDEE}
                        style={{ width:'100%', marginTop:12, padding:'12px', background:'linear-gradient(135deg,#10b981,#059669)', color:'#fff', border:'none', borderRadius:12, fontWeight:800, fontSize:15, cursor:'pointer', transition:'all 0.2s' }}>
                        ⚡ Υπολόγισε
                      </button>

                      {/* TDEE Results */}
                      {tdeeResult && (
                        <div style={{ marginTop:14 }}>
                          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:6, marginBottom:10 }}>
                            <div style={{ background:'var(--bg-surface)', borderRadius:10, padding:'10px 12px', textAlign:'center' }}>
                              <div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:700 }}>BMR</div>
                              <div style={{ fontSize:20, fontWeight:900, color:'var(--text-primary)' }}>{tdeeResult.bmr}</div>
                              <div style={{ fontSize:10, color:'var(--text-muted)' }}>kcal/ημέρα</div>
                            </div>
                            <div style={{ background:'rgba(99,102,241,0.08)', borderRadius:10, padding:'10px 12px', textAlign:'center', border:'1.5px solid rgba(99,102,241,0.2)' }}>
                              <div style={{ fontSize:10, color:'#6366f1', fontWeight:700 }}>TDEE</div>
                              <div style={{ fontSize:20, fontWeight:900, color:'#6366f1' }}>{tdeeResult.tdee}</div>
                              <div style={{ fontSize:10, color:'var(--text-muted)' }}>kcal/ημέρα</div>
                            </div>
                          </div>

                          {/* Goal selection */}
                          <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>Επίλεξε Στόχο</div>
                          <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                            {Object.entries(tdeeResult.goals).map(([k, g]) => (
                              <div key={k} onClick={() => setTdeeGoal(k)}
                                style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderRadius:12, border:`2px solid ${tdeeGoal===k ? g.color : 'var(--border)'}`, background:tdeeGoal===k ? `${g.color}14` : 'var(--bg-surface)', cursor:'pointer', transition:'all 0.2s' }}>
                                <div>
                                  <div style={{ fontWeight:700, fontSize:13, color:tdeeGoal===k ? g.color : 'var(--text-primary)' }}>{g.label}</div>
                                  <div style={{ fontSize:10, color:'var(--text-muted)' }}>
                                    Zigzag: {g.zigzag[0]} / {g.zigzag[1]} kcal εναλλάξ
                                  </div>
                                </div>
                                <div style={{ fontWeight:900, fontSize:18, color: g.color }}>{g.kcal} <span style={{ fontSize:10, fontWeight:600 }}>kcal</span></div>
                              </div>
                            ))}
                          </div>

                          {/* Zigzag 7-day preview */}
                          {tdeeGoal && (
                            <div style={{ marginTop:10, background:'var(--bg-surface)', borderRadius:12, padding:'12px 14px' }}>
                              <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:8 }}>📊 Zigzag Diet — 7 Ημέρες</div>
                              <div style={{ display:'flex', gap:5 }}>
                                {tdeeResult.goals[tdeeGoal].zigzag.map((kcal, i) => {
                                  const isHigh = kcal > tdeeResult.goals[tdeeGoal].kcal;
                                  return (
                                    <div key={i} style={{ flex:1, textAlign:'center' }}>
                                      <div style={{ fontSize:9, color:'var(--text-muted)', marginBottom:3 }}>
                                        {['Δευ','Τρί','Τετ','Πέμ','Παρ','Σάβ','Κυρ'][i]}
                                      </div>
                                      <div style={{ background: isHigh ? 'rgba(99,102,241,0.15)' : 'rgba(16,185,129,0.15)', border:`1px solid ${isHigh?'rgba(99,102,241,0.3)':'rgba(16,185,129,0.3)'}`, borderRadius:8, padding:'6px 2px' }}>
                                        <div style={{ fontSize:9, fontWeight:800, color: isHigh ? '#6366f1' : '#10b981' }}>{kcal}</div>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Persons + Days */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
                  <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:14, padding:'14px 16px' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>👥 Άτομα</div>
                    <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                      <button onClick={() => setMealPlanPrefs(p => ({ ...p, persons: Math.max(1, p.persons - 1) }))} style={{ width:34, height:34, borderRadius:9, border:'1.5px solid var(--border)', background:'var(--bg-surface)', fontSize:18, cursor:'pointer', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}>-</button>
                      <span style={{ fontWeight:900, fontSize:22, color:'var(--text-primary)', minWidth:24, textAlign:'center' }}>{mealPlanPrefs.persons}</span>
                      <button onClick={() => setMealPlanPrefs(p => ({ ...p, persons: Math.min(8, p.persons + 1) }))} style={{ width:34, height:34, borderRadius:9, border:'1.5px solid var(--border)', background:'var(--bg-surface)', fontSize:18, cursor:'pointer', fontWeight:700, color:'var(--text-primary)', display:'flex', alignItems:'center', justifyContent:'center' }}>+</button>
                    </div>
                  </div>
                  <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:14, padding:'14px 16px' }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:0.5, marginBottom:8 }}>📅 Ημέρες</div>
                    <div style={{ display:'flex', gap:6 }}>
                      {[3,5,7].map(d => (
                        <button key={d} onClick={() => setMealPlanPrefs(p => ({ ...p, days: d }))}
                          style={{ flex:1, padding:'6px 0', borderRadius:8, border:`1.5px solid ${mealPlanPrefs.days===d?'#6366f1':'var(--border)'}`, background:mealPlanPrefs.days===d?'rgba(99,102,241,0.1)':'var(--bg-surface)', color:mealPlanPrefs.days===d?'#6366f1':'var(--text-secondary)', fontWeight:800, fontSize:13, cursor:'pointer', transition:'all 0.2s' }}>{d}</button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Budget */}
                <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:14, padding:'14px 16px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                    <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:0.5 }}>💰 Εβδομαδιαίο Budget</div>
                    <div style={{ fontWeight:900, fontSize:20, color:'#10b981' }}>{mealPlanPrefs.budget}€</div>
                  </div>
                  <input type="range" min={20} max={300} step={5} value={mealPlanPrefs.budget}
                    onChange={e => setMealPlanPrefs(p => ({ ...p, budget: +e.target.value }))}
                    style={{ width:'100%', accentColor:'#6366f1' }}/>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--text-muted)', marginTop:4 }}>
                    <span>20€</span><span>160€</span><span>300€</span>
                  </div>
                </div>

                {/* Goal */}
                <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:14, padding:'14px 16px' }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:0.5, marginBottom:10 }}>🎯 Στόχος</div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                    {Object.entries({ balanced:'⚖️ Ισορροπία', weightloss:'🔥 Αδυνάτισμα', muscle:'💪 Μυϊκή Μάζα', budget:'💰 Οικονομία' }).map(([k, label]) => (
                      <button key={k} onClick={() => setMealPlanPrefs(p => ({ ...p, goal: k }))}
                        style={{ padding:'10px 8px', borderRadius:10, border:`1.5px solid ${mealPlanPrefs.goal===k?'#6366f1':'var(--border)'}`, background:mealPlanPrefs.goal===k?'rgba(99,102,241,0.1)':'var(--bg-surface)', color:mealPlanPrefs.goal===k?'#6366f1':'var(--text-secondary)', fontWeight:700, fontSize:13, cursor:'pointer', transition:'all 0.2s' }}>{label}</button>
                    ))}
                  </div>
                </div>

                {/* Restrictions */}
                <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:14, padding:'14px 16px' }}>
                  <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', textTransform:'uppercase', letterSpacing:0.5, marginBottom:10 }}>🚫 Διατροφικοί Περιορισμοί</div>
                  <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
                    {[['vegan','🌱 Vegan'],['vegetarian','🥗 Vegetarian'],['gluten-free','🌾 Χωρίς Γλουτένη'],['lactose-free','🥛 Χωρίς Λακτόζη'],['nut-free','🥜 Χωρίς Ξηρούς Καρπούς']].map(([r, label]) => {
                      const active = mealPlanPrefs.restrictions.includes(r);
                      return (
                        <button key={r} onClick={() => setMealPlanPrefs(p => ({ ...p, restrictions: active ? p.restrictions.filter(x=>x!==r) : [...p.restrictions, r] }))}
                          style={{ padding:'8px 14px', borderRadius:20, border:`1.5px solid ${active?'#6366f1':'var(--border)'}`, background:active?'rgba(99,102,241,0.1)':'var(--bg-surface)', color:active?'#6366f1':'var(--text-secondary)', fontWeight:700, fontSize:13, cursor:'pointer', transition:'all 0.2s' }}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {mealPlanError && (
                  <div style={{ background:'rgba(239,68,68,0.08)', border:'1.5px solid rgba(239,68,68,0.25)', borderRadius:12, padding:'12px 14px', color:'#ef4444', fontSize:13 }}>
                    ❌ {mealPlanError}
                  </div>
                )}

                <button onClick={generateMealPlan} disabled={mealPlanLoading}
                  style={{ width:'100%', padding:16, background:mealPlanLoading?'var(--bg-surface)':'linear-gradient(135deg,#6366f1,#8b5cf6)', color:mealPlanLoading?'var(--text-secondary)':'#fff', border:'none', borderRadius:16, fontWeight:800, fontSize:16, cursor:mealPlanLoading?'not-allowed':'pointer', opacity:mealPlanLoading?0.75:1, display:'flex', alignItems:'center', justifyContent:'center', gap:10, transition:'all 0.2s', boxShadow:mealPlanLoading?'none':'0 4px 24px rgba(99,102,241,0.35)' }}>
                  {mealPlanLoading
                    ? <><div style={{ width:20, height:20, border:'2.5px solid rgba(255,255,255,0.3)', borderTopColor:'#fff', borderRadius:'50%', animation:'spin 0.85s linear infinite' }}/> Δημιουργώ πλάνο...</>
                    : <><IconSparkles size={20} stroke={2}/> Δημιούργησε Πλάνο Διατροφής</>
                  }
                </button>
              </div>
            ) : (
              /* ── Results View ── */
              <div style={{ display:'flex', flexDirection:'column', gap:14 }}>

                {/* Stats bar */}
                {mealPlanStats && (
                  <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
                    {[
                      { label:'Βρέθηκαν', value:`${mealPlanStats.foundInDB}/${mealPlanStats.totalIngredients}`, color:'#10b981' },
                      { label:'Εκτ. Κόστος', value:`${mealPlanStats.estimatedCost}€`, color:'#6366f1' },
                      { label:'Κάλυψη', value:`${mealPlanStats.coveragePercent}%`, color:'#f59e0b' },
                    ].map(s => (
                      <div key={s.label} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'10px 12px', textAlign:'center' }}>
                        <div style={{ fontWeight:900, fontSize:18, color:s.color }}>{s.value}</div>
                        <div style={{ fontSize:10, color:'var(--text-muted)', fontWeight:700, marginTop:2 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Day selector */}
                <div style={{ display:'flex', gap:8, overflowX:'auto', paddingBottom:4 }}>
                  {mealPlan.map((day, i) => (
                    <button key={i} onClick={() => setActiveMealDay(i)}
                      style={{ flexShrink:0, padding:'8px 14px', borderRadius:20, border:`1.5px solid ${activeMealDay===i?'#6366f1':'var(--border)'}`, background:activeMealDay===i?'rgba(99,102,241,0.12)':'var(--bg-card)', color:activeMealDay===i?'#6366f1':'var(--text-secondary)', fontWeight:800, fontSize:13, cursor:'pointer', transition:'all 0.2s', whiteSpace:'nowrap' }}>
                      {day.dayName || `Ημέρα ${day.day}`}
                    </button>
                  ))}
                </div>

                {/* Day meals */}
                {mealPlan[activeMealDay] && (() => {
                  const day = mealPlan[activeMealDay];
                  return (
                    <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                      {[['breakfast','🌅 Πρωινό'],['lunch','☀️ Μεσημεριανό'],['dinner','🌙 Βραδινό']].map(([mKey, mLabel]) => {
                        const meal = day.meals?.[mKey];
                        if (!meal) return null;
                        return (
                          <div key={mKey} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16, padding:'14px 16px' }}>
                            <div style={{ fontSize:11, fontWeight:700, color:'var(--text-secondary)', marginBottom:6 }}>{mLabel}</div>
                            <div style={{ fontWeight:800, fontSize:15, color:'var(--text-primary)', marginBottom:4 }}>{meal.name}</div>
                            <div style={{ fontSize:12, color:'var(--text-secondary)', marginBottom:10 }}>{meal.description}</div>
                            {/* Macros */}
                            <div style={{ display:'flex', gap:8, marginBottom:10 }}>
                              {[['kcal','kcal','#f59e0b'],['protein','g protein','#6366f1'],['carbs','g carbs','#10b981'],['fat','g fat','#ef4444']].map(([k, unit, col]) => (
                                meal.macros?.[k] != null && (
                                  <div key={k} style={{ background:`${col}14`, borderRadius:8, padding:'4px 8px', fontSize:11, fontWeight:800, color:col }}>
                                    {meal.macros[k]}{unit}
                                  </div>
                                )
                              ))}
                              {meal.time && <div style={{ background:'var(--bg-surface)', borderRadius:8, padding:'4px 8px', fontSize:11, fontWeight:700, color:'var(--text-muted)' }}>⏱ {meal.time}λ</div>}
                            </div>
                            {/* Ingredients */}
                            {meal.ingredients?.length > 0 && (
                              <div style={{ display:'flex', flexWrap:'wrap', gap:5 }}>
                                {meal.ingredients.map((ing, j) => {
                                  const ingName = typeof ing === 'string' ? ing : ing.name;
                                  const ingPrice = typeof ing === 'object' && ing.price ? `${ing.price}€` : null;
                                  const found = typeof ing === 'object' && ing.found;
                                  return (
                                    <span key={j} style={{ fontSize:11, padding:'3px 8px', borderRadius:20, background: found ? 'rgba(16,185,129,0.1)' : 'var(--bg-surface)', border: `1px solid ${found ? 'rgba(16,185,129,0.25)' : 'var(--border)'}`, color: found ? '#10b981' : 'var(--text-secondary)', fontWeight:600 }}>
                                      {ingName}{ingPrice ? ` • ${ingPrice}` : ''}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {/* Day macros summary */}
                      {day.dayMacros && (
                        <div style={{ background:'linear-gradient(135deg,rgba(99,102,241,0.06),rgba(139,92,246,0.06))', border:'1px solid rgba(99,102,241,0.15)', borderRadius:12, padding:'10px 14px', display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                          <div style={{ fontSize:11, fontWeight:700, color:'#6366f1' }}>Σύνολο Ημέρας</div>
                          <div style={{ display:'flex', gap:10 }}>
                            {[['kcal','kcal'],['protein','P'],['carbs','C'],['fat','F']].map(([k,l]) => (
                              day.dayMacros[k] != null && <span key={k} style={{ fontSize:11, fontWeight:800, color:'var(--text-primary)' }}>{day.dayMacros[k]}{l}</span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}

                {/* Action buttons */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginTop:4 }}>
                  <button onClick={addMealPlanToCart}
                    style={{ padding:'13px 10px', background:'linear-gradient(135deg,#10b981,#059669)', color:'#fff', border:'none', borderRadius:14, fontWeight:800, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7, boxShadow:'0 4px 16px rgba(16,185,129,0.3)' }}>
                    <IconShoppingCart size={16} stroke={2}/> Στη Λίστα
                  </button>
                  <button onClick={() => { setMealPlan(null); setMealPlanStats(null); setMealPlanShoppingList([]); }}
                    style={{ padding:'13px 10px', background:'var(--bg-card)', color:'var(--text-secondary)', border:'1px solid var(--border)', borderRadius:14, fontWeight:800, fontSize:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
                    <IconRefresh size={16} stroke={2}/> Νέο Πλάνο
                  </button>
                </div>

              </div>
            )}
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

      {/* ── Smart Route — Floating button + Fullscreen map ── */}
      <FloatingMapButton
        onClick={() => {
          // #region agent log
          debugLog({
            runId: 'pre-repro',
            hypothesisId: 'H1',
            location: 'App.jsx:floatingMapButton',
            message: 'Open SmartRoute overlay',
            data: {
              showAuthModal,
              showListsModal,
              showFriendsPanel,
              showChatPanel,
            },
          });
          // #endregion
          setShowSmartRoute(true);
        }}
        itemCount={uniqueStoresInList}
      />
      <SmartRouteMap
        isOpen={showSmartRoute}
        onClose={() => setShowSmartRoute(false)}
        items={items}
      />
    </div>
  );
}
