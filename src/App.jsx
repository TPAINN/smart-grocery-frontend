import { useState, useEffect, useRef } from 'react';
import './App.css';
import RecipeNotification from './RecipeNotification';
import AuthModal from './AuthModal';
import SavedListsModal from './SavedListsModal';
import { io } from 'socket.io-client';

// ─── Helper Functions ─────────────────────────────────────────────────────────
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
  units.forEach((u) => {
    cleaned = cleaned.replace(new RegExp(`\\b${u}\\b`, 'gi'), ' ');
  });
  return cleaned.replace(/\s+/g, ' ').trim();
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
      return 10;
    };
    const diff = score(b.normalizedName) - score(a.normalizedName);
    return diff !== 0 ? diff : (a.price || 0) - (b.price || 0);
  });
  return matches[0];
};

const CATEGORIES = [
  { name: '🍎 Φρέσκα Φρούτα & Λαχανικά', keywords: ['μηλο','μπανανα','ντοματα','πατατα','κρεμμυδι','λεμονι','σκορδο','πιπερια'] },
  { name: '🥛 Γαλακτοκομικά',             keywords: ['γαλα','τυρι','γιαουρτι','βουτυρο','φετα','παρμεζανα','κρεμα'] },
  { name: '🥩 Κρέας & Ψάρια',             keywords: ['κοτοπουλο','κρεας','κιμας','ψαρι','σολομος','μπειικον'] },
  { name: '🍞 Φούρνος',                   keywords: ['ψωμι','πιτα','φρυγανιες','χωριατικο'] },
  { name: '🍝 Ράφι',                      keywords: ['μακαρονια','ρυζι','λαδι','ζαχαρη','μελι','αλατι','πιπερι','αλευρι','ελαιολαδο','ζωμος'] },
  { name: '📦 Διάφορα Είδη',              keywords: [] },
];

const getCategory = (name) =>
  CATEGORIES.find((c) => c.keywords.some((k) => normalizeText(name).includes(k)))?.name || '📦 Διάφορα Είδη';
// 🟢 ΕΞΥΠΝΟΣ ΘΕΡΜΙΔΟΜΕΤΡΗΤΗΣ (OFFLINE NLP DICTIONARY)
const getAdvancedCalories = (itemName) => {
  const text = normalizeText(itemName);
  const foodDB =[
    { keywords:['λαδι', 'ελαιολαδο', 'σπορελαιο', 'βουτυρο', 'μαργαρινη', 'μαγιονεζα'], cals: 800 },
    { keywords:['σοκολατα', 'μερεντα', 'μπισκοτα', 'κρουασαν', 'πατατακια', 'τσιπς', 'γαριδακια'], cals: 500 },
    { keywords:['ζαχαρη', 'μελι', 'μαρμελαδα'], cals: 400 },
    { keywords:['τυρι', 'φετα', 'γκουντα', 'κασπερι', 'παρμεζανα', 'γραβιερα'], cals: 350 },
    { keywords:['ψωμι', 'μακαρονια', 'ρυζι', 'αλευρι', 'βρωμη', 'δημητριακα', 'φρυγανιες', 'πιτα'], cals: 350 },
    { keywords:['αλλαντικα', 'ζαμπον', 'μπεικον', 'λουκανικο', 'σαλαμι'], cals: 300 },
    { keywords:['κρεας', 'κοτοπουλο', 'μοσχαρι', 'κιμας', 'μπριζολα', 'ψαρι', 'σολομος'], cals: 200 },
    { keywords:['αυγο', 'αυγα'], cals: 150 },
    { keywords:['γαλα', 'γιαουρτι', 'κεφιρ'], cals: 80 },
    { keywords:['μηλο', 'μπανανα', 'πορτοκαλι', 'φρουτ', 'χυμος'], cals: 60 },
    { keywords:['ντοματα', 'πατατα', 'κρεμμυδι', 'σαλατα', 'λαχανικ', 'καροτο', 'μαρουλι'], cals: 25 },
    { keywords:['νερο', 'σοδα', 'καφες', 'τσαι', 'αναψυκτικο zero'], cals: 0 }
  ];
  for (let category of foodDB) {
    if (category.keywords.some(word => text.includes(word))) return category.cals;
  }
  return 120; // Fallback
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

const API_BASE = 'https://my-smart-grocery-api.onrender.com';

export default function App() {
  // ── State ──────────────────────────────────────────────────────────────────
  const [isDarkMode, setIsDarkMode]       = useState(() => localStorage.getItem('theme') === 'dark');
  const [showShareModal, setShowShareModal] = useState(false);
  const [targetFriendKey, setTargetFriendKey] = useState('');
  const socketRef = useRef(null);

  const [savedLists, setSavedLists]       = useState([]);
  const [showListsModal, setShowListsModal] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);

  const [user, setUser] = useState(() =>
    JSON.parse(localStorage.getItem('smart_grocery_user')) || null
  );
  const [items, setItems] = useState(() =>
    JSON.parse(localStorage.getItem('proGroceryItems_real')) || []
  );

  const [inputValue, setInputValue]     = useState('');
  const [activeTab, setActiveTab]       = useState('list');
  const [notification, setNotification] = useState({ show: false, message: '' });
  const [suggestions, setSuggestions]   = useState([]);
  const [selectedStore, setSelectedStore] = useState('Όλα');
  const [isScraping, setIsScraping]     = useState(false);
  const [isListening, setIsListening]   = useState(false);
  const [recipes, setRecipes]           = useState([]);
  const [recipeFilter, setRecipeFilter] = useState('all');
  const [expandedRecipe, setExpandedRecipe] = useState(null);
  const [fridgeQuery, setFridgeQuery]   = useState('');
  const [currentTime, setCurrentTime]   = useState(new Date());

  const storeOptions = ['Όλα','ΑΒ Βασιλόπουλος','Σκλαβενίτης','MyMarket','Μασούτης','Κρητικός','Γαλαξίας','Market In'];
  const searchTimeout = useRef(null);

  // ── Dark mode ──────────────────────────────────────────────────────────────
  useEffect(() => {
    document.body.classList.toggle('dark-mode', isDarkMode);
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // ── WebSocket ──────────────────────────────────────────────────────────────
  useEffect(() => {
    socketRef.current = io(API_BASE);
    if (user?.shareKey) {
      socketRef.current.emit('join_cart', user.shareKey);
    }
    socketRef.current.on('receive_item', (itemData) => {
      setItems((prev) => [{ ...itemData, id: Date.now() + Math.random() }, ...prev]);
      setNotification({ show: true, message: `🔔 Νέο προϊόν από φίλο: ${itemData.text}` });
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    });
    return () => socketRef.current.disconnect();
  }, [user]);

  // ── Clock ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── Recipes + scraping status ──────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/api/recipes`)
      .then((r) => r.json())
      .then((d) => setRecipes(Array.isArray(d) ? d : []))
      .catch(() => {});

    const checkStatus = async () => {
      try {
        const r = await fetch(`${API_BASE}/api/status`);
        if (r.ok) setIsScraping((await r.json()).isScraping || false);
      } catch {}
    };
    checkStatus();
    const interval = setInterval(checkStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  // ── Persist items ──────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('proGroceryItems_real', JSON.stringify(items));
  }, [items]);

  // ── Saved lists ────────────────────────────────────────────────────────────
  const fetchSavedLists = async () => {
    if (!user) return;
    try {
      const token = localStorage.getItem('smart_grocery_token');
      const r = await fetch(`${API_BASE}/api/lists`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (r.ok) setSavedLists(await r.json());
    } catch {}
  };

  useEffect(() => { fetchSavedLists(); }, [user]);

  const saveCurrentList = async () => {
    if (!user) return setNotification({ show: true, message: 'Πρέπει να συνδεθείς!' });
    if (!items.length) return setNotification({ show: true, message: 'Η λίστα σου είναι άδεια!' });
    const title = window.prompt('Όνομα Λίστας:', 'Ψώνια');
    if (!title) return;
    try {
      const token = localStorage.getItem('smart_grocery_token');
      const r = await fetch(`${API_BASE}/api/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ title, items }),
      });
      if (r.ok) { setNotification({ show: true, message: '✅ Αποθηκεύτηκε!' }); fetchSavedLists(); }
    } catch {}
  };

  const toggleListItem = async (listId, itemToToggle) => {
    const list = savedLists.find((l) => l._id === listId);
    const updatedItems = list.items.map((i) =>
      i._id === itemToToggle._id || i.id === itemToToggle.id
        ? { ...i, isChecked: !i.isChecked }
        : i
    );
    setSavedLists(savedLists.map((l) => l._id === listId ? { ...l, items: updatedItems } : l));
    if (navigator.vibrate) navigator.vibrate(20);
    try {
      await fetch(`${API_BASE}/api/lists/${listId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('smart_grocery_token')}`,
        },
        body: JSON.stringify({ title: list.title, items: updatedItems }),
      });
    } catch {}
  };

  const deleteList = async (listId) => {
    if (!window.confirm('Διαγραφή;')) return;
    try {
      await fetch(`${API_BASE}/api/lists/${listId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${localStorage.getItem('smart_grocery_token')}` },
      });
      fetchSavedLists();
    } catch {}
  };

  // ── Shared cart ────────────────────────────────────────────────────────────
  const handleSendToFriend = (item) => {
    if (!targetFriendKey) { setShowShareModal(true); return; }
    socketRef.current.emit('send_item', { shareKey: targetFriendKey, item });
    setNotification({ show: true, message: '🚀 Στάλθηκε επιτυχώς!' });
  };

  const handleMassClear = () => {
    if (window.confirm('Καθαρισμός όλης της λίστας;')) {
      setItems([]);
      if (navigator.vibrate) navigator.vibrate(50);
    }
  };

  // ── Search ─────────────────────────────────────────────────────────────────
  const triggerSearch = async (query, store) => {
    if (query.trim().length < 2) { setSuggestions([]); return; }
    try {
      const q = greeklishToGreek(normalizeText(query));
      const r = await fetch(`${API_BASE}/api/prices/search?q=${encodeURIComponent(q)}&store=${encodeURIComponent(store)}`);
      if (r.ok) setSuggestions((await r.json()).slice(0, 30));
    } catch {}
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => triggerSearch(val, selectedStore), 300);
  };

  const addFromSuggestion = (product) => {
    setItems((prev) => [
      {
        id: Date.now() + Math.random(),
        text: product.name,
        category: getCategory(product.name),
        price: product.price,
        store: product.supermarket,
      },
      ...prev,
    ]);
    setInputValue('');
    setSuggestions([]);
  };

  // ── Voice ──────────────────────────────────────────────────────────────────
  const handleVoiceClick = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert('Δεν υποστηρίζεται φωνητική εισαγωγή.'); return; }
    const r = new SpeechRecognition();
    r.lang = 'el-GR';
    r.onstart = () => setIsListening(true);
    r.onresult = (e) => {
      const t = e.results[0][0].transcript;
      setInputValue(t);
      triggerSearch(t, selectedStore);
    };
    r.onend = () => setIsListening(false);
    r.start();
  };

  // ── Recipe → list ──────────────────────────────────────────────────────────
  const addRecipeToList = async (recipe) => {
    setNotification({ show: true, message: '⏳ Ψάχνω τιμές...' });
    const newItems = await Promise.all(
      recipe.ingredients.map(async (rawIng) => {
        const clean = cleanIngredientText(rawIng);
        try {
          const r = await fetch(`${API_BASE}/api/prices/search?q=${encodeURIComponent(clean)}&store=Όλα`);
          if (r.ok) {
            const matches = await r.json();
            const best = getBestMatch(matches, clean);
            if (best) return { id: Date.now() + Math.random(), text: rawIng, category: getCategory(clean), price: best.price, store: best.supermarket };
          }
        } catch {}
        return { id: Date.now() + Math.random(), text: rawIng, category: getCategory(clean), price: 0, store: 'Άγνωστο' };
      })
    );
    setItems((prev) => [...newItems, ...prev]);
    setActiveTab('list');
  };

  const deleteItem = (id) => setItems(items.filter((i) => i.id !== id));

  // ── Derived ────────────────────────────────────────────────────────────────
  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item);
    return acc;
  }, {});

  const totalCost = items.reduce((s, i) => s + (i.price > 0 ? i.price : 0), 0);

  // 🟢 Υπολογισμός Θερμίδων
  let totalCalories = 0;
  items.forEach(item => { totalCalories += getAdvancedCalories(item.text); });

  // 🟢 Συνάρτηση για COPY του Share Key
  const handleCopyShareKey = () => {
    if (user?.shareKey) {
        navigator.clipboard.writeText(user.shareKey);
        setNotification({ show: true, message: `📋 Αντιγράφηκε το Share Key: ${user.shareKey}` });
        if(navigator.vibrate) navigator.vibrate(50);
    }
  };

  const filteredRecipes = recipes.filter((r) => {
    if (recipeFilter === 'budget' && !r.isBudget) return false;
    if (recipeFilter === 'healthy' && !r.isHealthy) return false;
    if (recipeFilter === 'fast' && r.time > 30) return false;
    if (fridgeQuery.trim()) {
      const q = greeklishToGreek(normalizeText(fridgeQuery));
      return r.ingredients.some((ing) => greeklishToGreek(normalizeText(ing)).includes(q));
    }
    return true;
  });

  // ── Time greeting ──────────────────────────────────────────────────────────
  const hour = currentTime.getHours();
  const timeGreeting = hour < 5 ? 'Καλό βράδυ' : hour < 12 ? 'Καλημέρα' : hour < 18 ? 'Καλό απόγευμα' : 'Καλησπέρα';
  const timeIcon     = hour < 5 ? '🌙' : hour < 12 ? '☀️' : hour < 18 ? '☕' : '🌙';

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="app-wrapper">
      {/* ── Modals ── */}
      <SavedListsModal
        isOpen={showListsModal}
        onClose={() => setShowListsModal(false)}
        lists={savedLists}
        onDelete={deleteList}
        onToggleItem={toggleListItem}
      />
      <AuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        onLoginSuccess={(userData) => setUser(userData)}
      />
      <RecipeNotification
        show={notification.show}
        message={notification.message}
        onClose={() => setNotification({ show: false, message: '' })}
      />

      {/* ── Shared Cart Modal ── */}
      {showShareModal && (
        <div className="share-modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="share-modal-box" onClick={(e) => e.stopPropagation()}>
            <span className="share-modal-icon">🤝</span>
            <h3>Κοινό Καλάθι</h3>
            <p>
              Βάλε το <strong>Invite Code</strong> του φίλου σου για να του
              στέλνεις προϊόντα απευθείας στη λίστα του.
            </p>
            <input
              type="text"
              className="share-key-input"
              placeholder="π.χ. AB123..."
              value={targetFriendKey}
              onChange={(e) => setTargetFriendKey(e.target.value.toUpperCase())}
              autoFocus
            />
            <button
              className="share-connect-btn"
              onClick={() => { if (targetFriendKey.trim()) setShowShareModal(false); }}
            >
              ✓ Σύνδεση με φίλο
            </button>
            <button className="share-cancel-btn" onClick={() => setShowShareModal(false)}>
              Ακύρωση
            </button>
          </div>
        </div>
      )}

      <div className="container">
        {/* ── Live Scraping Banner ── */}
        {isScraping && (
          <div className="live-scraping-banner">
            <div className="pulsing-dot" />
            <span>LIVE ΕΝΗΜΕΡΩΣΗ ΤΙΜΩΝ...</span>
          </div>
        )}

        {/* ── Header ── */}
        <header className="app-header">
          <div className="header-top">
            <div className="datetime-display">
              <div className="current-date">{timeGreeting} {timeIcon}</div>
              <div className="current-time">
                {currentTime.toLocaleDateString('el-GR', { weekday: 'short', day: 'numeric', month: 'long' })}
              </div>
              <div className="current-clock">
                {currentTime.toLocaleTimeString('el-GR', { timeZone: 'Europe/Athens', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
            </div>

            <div className="header-actions">
              {/* Shared Cart */}
              <div className="action-btn-new" onClick={() => setShowShareModal(true)} title="Κοινό Καλάθι">
                {targetFriendKey
                  ? <span style={{ fontSize: '12px', fontWeight: 800, color: 'var(--success)' }}>🔗</span>
                  : '🤝'}
              </div>

              {/* Saved Lists */}
              <div
                className="action-btn-new"
                onClick={() => { if (!user) return setShowAuthModal(true); setShowListsModal(true); }}
                title="Λίστες μου"
              >
                📝
                {savedLists.length > 0 && (
                  <span className="list-badge">{savedLists.length}</span>
                )}
              </div>

              {/* Profile / Login */}
              {user ? (
                <div style={{ position: 'relative' }}>
                  <div
                    className="action-btn-new"
                    onClick={() => setShowProfileMenu((v) => !v)}
                    title={user.name}
                  >
                    👤
                  </div>
                  {showProfileMenu && (
                    <>
                      <div
                        style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                        onClick={() => setShowProfileMenu(false)}
                      />
                      <div className="profile-dropdown">
                        <div className="dropdown-info" style={{padding: '15px', borderBottom: '1px solid var(--border-light)'}}>
                          <strong style={{display: 'block', fontSize: '14px'}}>{user.name}</strong>
                          <div style={{display: 'flex', alignItems: 'center', gap: '8px', marginTop: '8px'}}>
                             <span style={{color: 'var(--text-secondary)', fontSize: '12px'}}>Κωδικός: <strong>{user.shareKey || 'N/A'}</strong></span>
                             <button onClick={handleCopyShareKey} style={{background: 'var(--bg-surface-hover)', border: '1px solid var(--border-light)', cursor: 'pointer', fontSize: '14px', padding: '4px 8px', borderRadius: '6px'}}>📋</button>
                          </div>
                        </div>
                        <div
                          className="dropdown-item"
                          onClick={() => { setIsDarkMode((v) => !v); setShowProfileMenu(false); }}
                        >
                          {isDarkMode ? '☀️' : '🌙'}
                          {isDarkMode ? ' Light Mode' : ' Dark Mode'}
                        </div>
                        <div
                          className="dropdown-item logout"
                          onClick={() => { localStorage.clear(); window.location.reload(); }}
                        >
                          🚪 Αποσύνδεση
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="action-btn-new" onClick={() => setShowAuthModal(true)} title="Σύνδεση">
                  🔒
                </div>
              )}
            </div>
          </div>

          <h1>Smart Hub</h1>
        </header>

        {/* ── Tabs ── */}
        <div className="tabs-container">
          {['list', 'recipes', 'brochures'].map((tab) => (
            <button
              key={tab}
              className={`tab-btn ${activeTab === tab ? 'active' : ''}`}
              onClick={() => setActiveTab(tab)}
            >
              {tab === 'list' ? 'Λίστα' : tab === 'recipes' ? 'Συνταγές' : 'Φυλλάδια'}
            </button>
          ))}
        </div>

        {/* ════════════════ LIST TAB ════════════════ */}
        {activeTab === 'list' && (
          <div className="tab-content list-tab">
            {/* Budget Banner & Calories */}
            {items.length > 0 && (
              <div className="budget-banner" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg-surface)', padding: '15px', borderRadius: '12px', border: '1px solid var(--border-light)', marginBottom: '15px'}}>
                <div style={{display: 'flex', gap: '20px'}}>
                    <div>
                        <div style={{fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase'}}>Κοστος</div>
                        <div className="budget-amount" style={{fontSize: '20px', fontWeight: 'bold', color: 'var(--brand-primary)'}}>{totalCost.toFixed(2)}€</div>
                    </div>
                    <div style={{borderLeft: '1px solid var(--border-light)', paddingLeft: '20px'}}>
                        <div style={{fontSize: '11px', color: 'var(--text-secondary)', textTransform: 'uppercase'}}>Θερμιδες (Est.)</div>
                        <div className="budget-amount" style={{fontSize: '20px', fontWeight: 'bold', color: '#f97316'}}>🔥 {totalCalories}</div>
                    </div>
                </div>
                <div style={{display: 'flex', gap: '8px'}}>
                    <button onClick={handleMassClear} className="mass-clear-btn" style={{background: 'rgba(239, 68, 68, 0.1)', color: 'var(--brand-danger)', border: 'none', padding: '10px', borderRadius: '8px', cursor: 'pointer'}} title="Αδειασμα">🗑️</button>
                    <button onClick={saveCurrentList} className="save-list-btn" style={{background: 'var(--brand-success)', color: 'white', border: 'none', padding: '10px 15px', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold'}} title="Αποθήκευση">💾</button>
                </div>
              </div>
            )}

            {/* Smart Search */}
            <div className="smart-search-wrapper">
              <div className="store-filter-container">
                {storeOptions.map((store) => (
                  <button
                    key={store}
                    className={`store-chip ${selectedStore === store ? 'active' : ''}`}
                    onClick={() => { setSelectedStore(store); triggerSearch(inputValue, store); }}
                  >
                    {store}
                  </button>
                ))}
              </div>

              <div className="input-section">
                <input
                  type="text"
                  placeholder="Αναζήτηση προϊόντος..."
                  value={inputValue}
                  onChange={handleInputChange}
                  onKeyDown={(e) => e.key === 'Enter' && triggerSearch(inputValue, selectedStore)}
                />
                <button
                  className={`voice-btn ${isListening ? 'listening' : ''}`}
                  onClick={handleVoiceClick}
                  title="Φωνητική αναζήτηση"
                >
                  {isListening ? '🔴' : '🎤'}
                </button>
                <button
                  className="add-btn"
                  onClick={() => triggerSearch(inputValue, selectedStore)}
                  title="Αναζήτηση"
                >
                  +
                </button>
              </div>

              {suggestions.length > 0 && (
                <div className="suggestions-dropdown">
                  {suggestions.map((sug) => (
                    <div
                      key={sug._id}
                      className="suggestion-item"
                      onClick={() => addFromSuggestion(sug)}
                    >
                      <img
                        src={SUPERMARKET_LOGOS[sug.supermarket]}
                        alt={sug.supermarket}
                        className="sug-logo"
                      />
                      <span className="sug-name">{sug.name}</span>
                      <strong className="sug-price">{sug.price?.toFixed(2)}€</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Items */}
            {items.length === 0 ? (
              <div className="empty-cart-state">
                <span className="empty-cart-icon">🛒</span>
                <h3>Η λίστα είναι άδεια</h3>
                <p>Αναζήτησε προϊόντα παραπάνω ή πρόσθεσε υλικά από μια συνταγή.</p>
              </div>
            ) : (
              <div className="categories-container">
                {Object.keys(groupedItems).sort().map((cat) => (
                  <div key={cat} className="category-group">
                    <h2 className="category-title">{cat}</h2>
                    <ul className="grocery-list">
                      {groupedItems[cat].map((item) => (
                        <li key={item.id} className="item-card">
                          <div className="item-content">
                            <span className="item-text">{item.text}</span>
                            <span className="item-price-tag">
                              {item.price > 0 ? `${item.price.toFixed(2)}€` : '—'}
                            </span>
                            <div className="item-store-tag">📍 {item.store}</div>
                          </div>
                          <div className="item-actions">
                            <button
                              className="send-friend-btn"
                              onClick={() => handleSendToFriend(item)}
                              title="Στείλε σε φίλο"
                            >
                              📤
                            </button>
                            <button
                              className="delete-btn"
                              onClick={() => deleteItem(item.id)}
                              title="Διαγραφή"
                            >
                              ✕
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ════════════════ RECIPES TAB ════════════════ */}
        {activeTab === 'recipes' && (
          <div className="tab-content recipes-tab">
            <div className="fridge-ai-box">
              <span className="fridge-icon">🧊</span>
              <input
                type="text"
                placeholder="Τι έχεις στο ψυγείο;"
                value={fridgeQuery}
                onChange={(e) => setFridgeQuery(e.target.value)}
                className="fridge-input"
              />
            </div>

            <div className="recipe-filters">
              {[
                { id: 'all', label: 'Όλες' },
                { id: 'budget', label: '€ Φθηνές' },
                { id: 'fast', label: '⏱️ Γρήγορες' },
              ].map((f) => (
                <button
                  key={f.id}
                  className={`filter-btn ${recipeFilter === f.id ? 'active' : ''}`}
                  onClick={() => setRecipeFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            <div className="recipes-grid">
              {filteredRecipes.map((recipe) => (
                <div
                  key={recipe._id}
                  className="recipe-card"
                  onClick={() => setExpandedRecipe(expandedRecipe === recipe._id ? null : recipe._id)}
                >
                  {recipe.image && (
                    <div className="recipe-image" style={{ backgroundImage: `url(${recipe.image})` }} />
                  )}
                  <div className="recipe-info">
                    <h4>{recipe.title}</h4>
                    <p className="recipe-chef">από {recipe.chef}</p>
                    <div className="recipe-meta">
                      <span>⏱️ {recipe.time}'</span>
                      <span>💰 ~{recipe.cost?.toFixed(1)}€</span>
                    </div>
                  </div>

                  {expandedRecipe === recipe._id && (
                    <div className="recipe-details-expanded">
                      <button
                        className="add-recipe-btn"
                        onClick={(e) => { e.stopPropagation(); addRecipeToList(recipe); }}
                      >
                        🛒 Προσθήκη Υλικών στη Λίστα
                      </button>
                      <h5>Υλικά</h5>
                      <ul className="ing-list">
                        {recipe.ingredients.map((ing, i) => (
                          <li key={i}>• {ing}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ════════════════ BROCHURES TAB ════════════════ */}
        {activeTab === 'brochures' && (
          <div className="tab-content brochures-tab">
            <div className="mock-offers-list">
              {Object.entries(SUPERMARKET_LOGOS).map(([name, logo]) => (
                <div key={name} className="offer-card">
                  <img src={logo} alt={name} className="offer-logo" />
                  <strong>{name}</strong>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}