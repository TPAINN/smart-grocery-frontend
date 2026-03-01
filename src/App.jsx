import { useState, useEffect, useRef } from 'react';
import './App.css';
import RecipeNotification from './RecipeNotification';
import AuthModal from './AuthModal';
import SavedListsModal from './SavedListsModal';

const normalizeText = (text) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

const greeklishToGreek = (text) => {
  let el = text.toLowerCase();
  const map = { 'th': 'θ', 'ch': 'χ', 'ps': 'ψ', 'ks': 'ξ', 'a': 'α', 'b': 'β', 'c': 'κ', 'd': 'δ', 'e': 'ε', 'f': 'φ', 'g': 'γ', 'h': 'η', 'i': 'ι', 'j': 'τζ', 'k': 'κ', 'l': 'λ', 'm': 'μ', 'n': 'ν', 'o': 'ο', 'p': 'π', 'q': 'κ', 'r': 'ρ', 's': 'σ', 't': 'τ', 'u': 'υ', 'v': 'β', 'w': 'ω', 'x': 'χ', 'y': 'υ', 'z': 'ζ' };
  for (let key in map) { el = el.split(key).join(map[key]); }
  return el;
};

const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const cleanIngredientText = (text) => {
  let cleaned = text.toLowerCase().replace(/[\d/½¼¾]+/g, ' ');
  const units =['κ.σ.', 'κ.γ.', 'κ.σ', 'κ.γ', 'γρ.', 'γρ', 'γραμμάρια', 'κιλό', 'κιλά', 'kg', 'ml', 'lt', 'λίτρα', 'φλιτζάνι', 'φλιτζάνια', 'κούπα', 'κούπες', 'πρέζα', 'σκελίδα', 'σκελίδες', 'κομμάτι', 'κομμάτια', 'τεμάχιο', 'τεμάχια', 'κουταλιά', 'κουταλιές', 'κουταλάκι', 'κουταλάκια', 'πακέτο', 'πακέτα', 'συσκευασία', 'ποτήρι', 'ματσάκι', 'κλωναράκι'];
  units.forEach(unit => { cleaned = cleaned.replace(new RegExp(`\\b${unit}\\b`, 'gi'), ' '); });
  return cleaned.replace(/\s+/g, ' ').trim();
};

const getBestMatch = (matches, query) => {
  if (!matches || matches.length === 0) return null;
  const searchGreek = greeklishToGreek(normalizeText(query));

  matches.sort((a, b) => {
    const nameA = a.normalizedName;
    const nameB = b.normalizedName;
    const q = searchGreek;

    const getScore = (name) => {
      if (name === q) return 100; // 1. Απόλυτη ταύτιση
      if (name.startsWith(q + ' ')) return 90; // 2. Είναι η πρώτη λέξη (π.χ. "γαλα αγελαδος")
      
      // 3. Είναι αυτόνομη λέξη κάπου στη μέση (Το Fix για τα Ελληνικά αντί του \b)
      if (new RegExp(`(^|\\s)${escapeRegExp(q)}(\\s|$)`).test(name)) return 80;
      
      // 4. Ξεκινάει άλλη λέξη με αυτά τα γράμματα (π.χ. "γαλα-κτος", "σοκολατουχο γαλα-τα")
      if (new RegExp(`(^|\\s)${escapeRegExp(q)}`).test(name)) return 60;
      
      // 5. Είναι χωμένο μέσα σε άλλη λέξη (π.χ. "με-γαλα"). Παίρνει τη χαμηλότερη βαθμολογία.
      return 10;
    };

    const scoreA = getScore(nameA);
    const scoreB = getScore(nameB);
    if (scoreA !== scoreB) return scoreB - scoreA;
    return (a.price || 0) - (b.price || 0); 
  });
  return matches[0]; 
};

const CATEGORIES =[
  { name: '🍎 Φρέσκα Φρούτα & Λαχανικά', keywords:['μηλο', 'μπανανα', 'ντοματα', 'πατατα', 'κρεμμυδι', 'λεμονι', 'σκορδο', 'πιπερια'] },
  { name: '🥛 Γαλακτοκομικά', keywords:['γαλα', 'τυρι', 'γιαουρτι', 'βουτυρο', 'φετα', 'παρμεζανα', 'κρεμα'] },
  { name: '🥩 Κρέας & Ψάρια', keywords:['κοτοπουλο', 'κρεας', 'κιμας', 'ψαρι', 'σολομος', 'μπειικον'] },
  { name: '🍞 Φούρνος', keywords: ['ψωμι', 'πιτα', 'φρυγανιες', 'χωριατικο'] },
  { name: '🍝 Ράφι', keywords:['μακαρονια', 'ρυζι', 'λαδι', 'ζαχαρη', 'μελι', 'αλατι', 'πιπερι', 'αλευρι', 'ελαιολαδο', 'ζωμος'] },
  { name: '📦 Διάφορα Είδη', keywords:[] }
];
const getCategory = (itemName) => CATEGORIES.find(cat => cat.keywords.some(k => normalizeText(itemName).includes(k)))?.name || '📦 Διάφορα Είδη';

const SUPERMARKET_LOGOS = {
  'Σκλαβενίτης': 'https://core-sa.com/wp-content/uploads/2019/10/sklavenitis.png',
  'ΑΒ Βασιλόπουλος': 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTl3QK3J91QWo9nDaOQxqXTMIwCRNMnJYazWw&s',
  'MyMarket': 'https://www.chalandri.gr/wp-content/uploads/2021/04/mymarket-logo.jpg',
  'Μασούτης': 'https://www.sbctv.gr/wp-content/uploads/2023/12/masoutis.jpg',
  'Κρητικός': 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcTqiIcIME5HllU-2TVovGx0hdfpW0Y32Hcs7w&s',
  'Γαλαξίας': 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQy-2RHg306icN_ZxWeZtHNUeB_p9oIvMYx9Q&s',
  'Market In': 'https://encrypted-tbn0.gstatic.com/images?q=tbn:ANd9GcQif4Kc8fqSN-sxec3L1gefzE8BGBL_hQOWDg&s',
};

const getCalendarEvent = (date) => {
  const month = date.getMonth() + 1, day = date.getDate(), dayOfWeek = date.getDay();
  if (dayOfWeek === 0 || dayOfWeek === 6) return { type: 'weekend', icon: '🛒', title: 'Σαββατοκύριακο!', text: 'Ιδανική μέρα για να οργανώσεις τα ψώνια της εβδομάδας.' };
  return null; 
};

const API_BASE = "https://my-smart-grocery-api.onrender.com";

export default function App() {
  const [savedLists, setSavedLists] = useState([]);
  const [showListsModal, setShowListsModal] = useState(false);
  const[showProfileMenu, setShowProfileMenu] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('smart_grocery_user')) || null);
  const [items, setItems] = useState(() => JSON.parse(localStorage.getItem('proGroceryItems_real')) || []);
  const [inputValue, setInputValue] = useState('');
  
  const [activeTab, setActiveTab] = useState('list');
  const [notification, setNotification] = useState({ show: false, message: '' });
  const [suggestions, setSuggestions] = useState([]);
  const[selectedStore, setSelectedStore] = useState('Όλα');
  const[isScraping, setIsScraping] = useState(false);

  // 🎙️ 1. Voice Recognition State
  const[isListening, setIsListening] = useState(false);

  const [recipes, setRecipes] = useState([]);
  const[recipeFilter, setRecipeFilter] = useState('all');
  const [expandedRecipe, setExpandedRecipe] = useState(null);
  
  // 🧊 2. Fridge AI State
  const [fridgeQuery, setFridgeQuery] = useState('');

  const storeOptions =['Όλα', 'ΑΒ Βασιλόπουλος', 'Σκλαβενίτης', 'MyMarket', 'Μασούτης', 'Κρητικός', 'Γαλαξίας', 'Market In'];
  const searchTimeout = useRef(null);

  useEffect(() => {
    fetch(`${API_BASE}/api/recipes`).then(res => res.json()).then(data => setRecipes(Array.isArray(data) ? data :[])).catch(err => console.log('Error recipes'));
    
    const checkScrapingStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/status`);
        if (res.ok) setIsScraping((await res.json()).isScraping || false);
      } catch (e) {}
    };
    checkScrapingStatus();
    const interval = setInterval(checkScrapingStatus, 15000);
    return () => clearInterval(interval);
  },[]);

  const fetchSavedLists = async () => {
    if (!user) return;
    try {
      const token = localStorage.getItem('smart_grocery_token');
      const res = await fetch(`${API_BASE}/api/lists`, { headers: { 'Authorization': `Bearer ${token}` }});
      if (res.ok) setSavedLists(await res.json());
    } catch (err) {}
  };

  useEffect(() => { fetchSavedLists(); }, [user]);

  const saveCurrentList = async () => {
    if (!user) return setNotification({ show: true, message: 'Πρέπει να συνδεθείς!' });
    if (items.length === 0) return setNotification({ show: true, message: 'Η λίστα σου είναι άδεια!' });
    const title = window.prompt("Όνομα Λίστας:", `Ψώνια`);
    if (!title) return; 
    try {
      const token = localStorage.getItem('smart_grocery_token');
      const res = await fetch(`${API_BASE}/api/lists`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ title, items })
      });
      if (res.ok) { setNotification({ show: true, message: 'Αποθηκεύτηκε επιτυχώς!' }); fetchSavedLists(); }
    } catch (err) {}
  };

  const toggleListItem = async (listId, itemToToggle) => {
    const listToUpdate = savedLists.find(l => l._id === listId);
    const updatedItems = listToUpdate.items.map(i => (i._id === itemToToggle._id || i.id === itemToToggle.id) ? { ...i, isChecked: !i.isChecked } : i);
    setSavedLists(savedLists.map(l => l._id === listId ? { ...l, items: updatedItems } : l));
    if(navigator.vibrate) navigator.vibrate(20);
    try {
      await fetch(`${API_BASE}/api/lists/${listId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('smart_grocery_token')}` }, body: JSON.stringify({ title: listToUpdate.title, items: updatedItems })
      });
    } catch (err) {}
  };

  const deleteList = async (listId) => {
    if(!window.confirm("Διαγραφή;")) return;
    try {
      await fetch(`${API_BASE}/api/lists/${listId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${localStorage.getItem('smart_grocery_token')}` }});
      fetchSavedLists();
    } catch (err) {}
  };

  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => { const timer = setInterval(() => setCurrentTime(new Date()), 1000); return () => clearInterval(timer); },[]);
  const hour = currentTime.getHours();
  let timeGreeting = 'Καλησπέρα'; let timeIcon = '🌙';
  if (hour >= 5 && hour < 12) { timeGreeting = 'Καλημέρα'; timeIcon = '☀️'; } else if (hour >= 12 && hour < 18) { timeGreeting = 'Καλό απόγευμα'; timeIcon = '☕'; }
  const todayEvent = getCalendarEvent(currentTime);

  useEffect(() => localStorage.setItem('proGroceryItems_real', JSON.stringify(items)), [items]);

  // 🎙️ 1. Voice Recognition Function
  const handleVoiceClick = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Ο browser σου δεν υποστηρίζει φωνητική πληκτρολόγηση (δοκίμασε Chrome/Safari).");
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'el-GR';
    
    recognition.onstart = () => {
      setIsListening(true);
      if(navigator.vibrate) navigator.vibrate(50);
    };
    
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInputValue(transcript);
      triggerSearch(transcript, selectedStore); // Ψάχνει αυτόματα αυτό που είπες!
    };
    
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  const triggerSearch = async (query, store) => {
    if (query.trim().length >= 2) {
      const searchGreek = greeklishToGreek(normalizeText(query));
      try {
        const res = await fetch(`${API_BASE}/api/prices/search?q=${encodeURIComponent(searchGreek)}&store=${encodeURIComponent(store)}`);
        if (res.ok) {
          const matches = await res.json();
          const bestMatches = matches.sort((a,b) => {
            const getScore = (name) => {
              if (name === searchGreek) return 100;
              if (name.startsWith(searchGreek + ' ')) return 90;
              if (new RegExp(`(^|\\s)${escapeRegExp(searchGreek)}(\\s|$)`).test(name)) return 80;
              if (new RegExp(`(^|\\s)${escapeRegExp(searchGreek)}`).test(name)) return 60;
              return 10;
            };
            const scoreA = getScore(a.normalizedName);
            const scoreB = getScore(b.normalizedName);
            if (scoreA !== scoreB) return scoreB - scoreA;
            return (a.price || 0) - (b.price || 0);
          });
          setSuggestions(bestMatches.slice(0, 30));
        }
      } catch (error) {}
    } else { setSuggestions([]); }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => triggerSearch(val, selectedStore), 300);
  };

  const addFromSuggestion = (product) => {
    if(navigator.vibrate) navigator.vibrate(50);
    setItems(prev =>[{ id: Date.now() + Math.random(), text: product.name, category: getCategory(product.name), price: product.price, store: product.supermarket, matchedName: product.name }, ...prev]);
    setInputValue('');
    setSuggestions([]);
  };

  const handleInputAdd = () => {
    if (inputValue.trim() !== '') {
      if(navigator.vibrate) navigator.vibrate(50);
      if (suggestions.length > 0) addFromSuggestion(suggestions[0]);
      else {
        setItems(prev =>[{ id: Date.now(), text: inputValue.trim(), category: getCategory(inputValue), price: 0, store: 'Άγνωστο' }, ...prev]);
        setInputValue('');
      }
    }
  };

  const addRecipeToList = async (recipe) => {
    if(navigator.vibrate) navigator.vibrate([30, 50]);
    setNotification({ show: true, message: `⏳ Ψάχνω τις καλύτερες τιμές για ${recipe.ingredients.length} υλικά...` });

    const promises = recipe.ingredients.map(async (rawIng) => {
      const cleanName = cleanIngredientText(rawIng);
      try {
        const res = await fetch(`${API_BASE}/api/prices/search?q=${encodeURIComponent(cleanName)}&store=Όλα`);
        if (res.ok) {
          const matches = await res.json();
          const bestMatch = getBestMatch(matches, cleanName);
          if (bestMatch) {
            return { id: Date.now() + Math.random(), text: rawIng, category: getCategory(cleanName), price: bestMatch.price, store: bestMatch.supermarket, matchedName: bestMatch.name };
          }
        }
      } catch (e) {}
      return { id: Date.now() + Math.random(), text: rawIng, category: getCategory(cleanName), price: 0, store: 'Άγνωστο' };
    });

    const newItems = await Promise.all(promises);
    setItems(prev =>[...newItems, ...prev]);
    setNotification({ show: true, message: `✅ Προστέθηκαν! Βρήκαμε τις καλύτερες τιμές της αγοράς.` });
    setActiveTab('list');
  };

  const deleteItem = (id) => {
    if(navigator.vibrate) navigator.vibrate([30, 50]);
    setItems(items.filter(item => item.id !== id));
  }

  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item); return acc;
  }, {});
  
  let totalCost = 0;
  items.forEach(item => { if (item.price > 0) totalCost += item.price; });

  // 🛒 3. Cart Optimizer Analytics (Υπολογισμός ανά κατάστημα)
  const storeTotals = items.reduce((acc, item) => {
    if (item.store && item.store !== 'Άγνωστο') {
      if (!acc[item.store]) acc[item.store] = { count: 0, cost: 0 };
      acc[item.store].count += 1;
      acc[item.store].cost += item.price || 0;
    }
    return acc;
  }, {});

  // 🧊 2. Fridge AI Filtering Logic
  const filteredRecipes = recipes.filter(r => {
    // 1ο Φίλτρο: Κατηγορίες (Budget, Fast, Healthy)
    if (recipeFilter === 'budget' && !r.isBudget) return false;
    if (recipeFilter === 'healthy' && !r.isHealthy) return false;
    if (recipeFilter === 'fast' && r.time > 30) return false;
    
    // 2ο Φίλτρο: Τι έχει το ψυγείο σου; (Ψάχνει μέσα στα υλικά)
    if (fridgeQuery.trim() !== '') {
      // Μετατρέπουμε αυτό που έγραψε ο χρήστης σε πεζά, χωρίς τόνους, και greeklish σε ελληνικά
      const normalizedQuery = greeklishToGreek(normalizeText(fridgeQuery));
      const searchTerms = normalizedQuery.split(',').map(t => t.trim()).filter(Boolean);
      
      // Κάνουμε το ίδιο και για τα υλικά της συνταγής
      const ingredientsText = greeklishToGreek(normalizeText(r.ingredients.join(' ')));
      
      // Ψάχνει αν το "κοτο" υπάρχει μέσα στο "κοτοπουλο"
      const hasMatch = searchTerms.some(term => ingredientsText.includes(term));
      if (!hasMatch) return false;
    }
    return true;
  });

  return (
    <div className="app-wrapper">
      <SavedListsModal isOpen={showListsModal} onClose={() => setShowListsModal(false)} lists={savedLists} onDelete={deleteList} onToggleItem={toggleListItem}/>
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onLoginSuccess={(userData) => { setUser(userData); setNotification({ show: true, message: `Καλώς ήρθες, ${userData.name}!` }); }} />
      <RecipeNotification show={notification.show} message={notification.message} onClose={() => setNotification({ show: false, message: '' })} />

      <div className="container">
        
        {isScraping && (
          <div className="live-scraping-banner">
            <div className="pulsing-dot"></div>
            <span style={{fontSize:'12px', fontWeight:'700'}}>LIVE ΕΝΗΜΕΡΩΣΗ ΤΙΜΩΝ...</span>
          </div>
        )}

        <header className="app-header">
          <div className="header-top" style={{ justifyContent: 'space-between' }}>
            <div className="datetime-display">
              <div className="current-date">{timeGreeting} {timeIcon}</div>
              <div className="current-time">{currentTime.toLocaleDateString('el-GR', { day: 'numeric', month: 'short' })}</div>
            </div>
            
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center', position: 'relative' }}>
              <div className="saved-lists-btn" onClick={() => { if(!user) return setNotification({show: true, message: 'Συνδέσου για να δεις τις λίστες σου.'}); setShowListsModal(true); }}>
                <div className="logo-icon" style={{background: '#f8fafc', color: '#111827', fontSize: '20px', width: '42px', height: '42px', borderRadius: '12px', border: '1px solid #e5e7eb', position: 'relative'}}>
                  📝 <span className={`list-badge ${user && user.isPremium ? 'premium' : ''} ${savedLists.length > 0 ? 'has-items' : ''}`}>{savedLists.length}</span>
                </div>
              </div>
              
              {user ? (
                <div style={{ position: 'relative' }}>
                  <div onClick={() => setShowProfileMenu(!showProfileMenu)} style={{cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                    <div className="logo-icon" style={{background: '#f1f5f9', color: '#64748b', width: '42px', height: '42px', borderRadius: '12px', border: '1px solid #e2e8f0'}}>👤</div>
                  </div>
                  {showProfileMenu && (
                    <div className="profile-dropdown">
                      <div className="dropdown-item logout" onClick={() => { localStorage.removeItem('smart_grocery_token'); localStorage.removeItem('smart_grocery_user'); setUser(null); setShowProfileMenu(false);}}>🚪 Αποσύνδεση</div>
                    </div>
                  )}
                </div>
              ) : (
                <div onClick={() => setShowAuthModal(true)} style={{cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center'}}>
                  <div className="logo-icon" style={{background: '#f3f4f6', color: '#374151', fontSize: '20px', width: '42px', height: '42px', borderRadius: '12px'}}>🔒</div>
                </div>
              )}
            </div>
          </div>
          <h1>Smart Hub</h1>
        </header>

        {todayEvent && (
          <div className={`seasonal-banner ${todayEvent.type}`}>
            <div className="seasonal-banner-content"><span className="seasonal-icon">{todayEvent.icon}</span><div className="seasonal-text"><h3>{todayEvent.title}</h3><p>{todayEvent.text}</p></div></div>
          </div>
        )}

        <div className="tabs-container" style={{gridTemplateColumns: '1fr 1fr 1fr', display: 'grid'}}>
          <button className={`tab-btn ${activeTab === 'list' ? 'active' : ''}`} onClick={() => setActiveTab('list')}>Λίστα</button>
          <button className={`tab-btn ${activeTab === 'recipes' ? 'active' : ''}`} onClick={() => setActiveTab('recipes')}>Συνταγές</button>
          <button className={`tab-btn ${activeTab === 'brochures' ? 'active' : ''}`} onClick={() => setActiveTab('brochures')}>Φυλλάδια</button>
        </div>

        {activeTab === 'list' && (
          <div className="tab-content list-tab">
            {totalCost > 0 && (
              <div className="budget-banner">
                <div className="budget-info">
                  <div><div className="budget-label">Συνολικό Κόστος</div><div className="budget-amount">{totalCost.toFixed(2)}€</div></div>
                  <button onClick={saveCurrentList} style={{background: '#10b981', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer'}}>💾 Αποθήκευση</button>
                </div>
                
                {/* 🛒 3. CART OPTIMIZER UI (SPLIT-CART) */}
                <div className="cart-optimizer-box">
                  <h5 style={{margin: '15px 0 8px 0', color: '#d1d5db', fontSize: '12px', textTransform: 'uppercase'}}>Ανάλυση Καλαθιού</h5>
                  <div className="store-breakdown">
                    {Object.keys(storeTotals).map(store => (
                      <div key={store} className="breakdown-row">
                        <span className="br-name">{store}</span>
                        <span className="br-stats">{storeTotals[store].count} είδη • <strong>{storeTotals[store].cost.toFixed(2)}€</strong></span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
            
            <div className="smart-search-wrapper">
              <div className="store-filter-container">
                {storeOptions.map(store => (
                  <button key={store} className={`store-chip ${selectedStore === store ? 'active' : ''}`} onClick={() => { setSelectedStore(store); triggerSearch(inputValue, store); }}>{store}</button>
                ))}
              </div>
              <div className="input-section" style={{marginBottom: suggestions.length > 0 ? '0' : '30px', position: 'relative'}}>
                <input type="text" placeholder="Προσθήκη..." value={inputValue} onChange={handleInputChange} onKeyDown={(e) => e.key === 'Enter' && handleInputAdd()} />
                
                {/* 🎙️ 1. Voice Recognition Button */}
                <button 
                  className={`voice-btn ${isListening ? 'listening' : ''}`} 
                  onClick={handleVoiceClick}
                  title="Φωνητική Υπαγόρευση"
                >
                  {isListening ? '🔴' : '🎤'}
                </button>

                <button className="add-btn" onClick={handleInputAdd}>+</button>
              </div>

              {suggestions.length > 0 && (
                <div className="suggestions-dropdown">
                  {suggestions.map(sug => (
                    <div key={sug._id} className="suggestion-item" onClick={() => addFromSuggestion(sug)}>
                      <div className="sug-left">
                        <img src={SUPERMARKET_LOGOS[sug.supermarket]} alt="logo" className="sug-logo" />
                        <div className="sug-name-wrapper">
                          <span className="sug-name">{sug.name}</span>
                          <div style={{display: 'flex', gap: '4px'}}>
                            {sug.is1plus1 && <span className="sug-badge plusone">🎁 1+1</span>}
                            {!sug.is1plus1 && sug.discountPercent && <span className="sug-badge discount">-{sug.discountPercent}%</span>}
                          </div>
                        </div>
                      </div>
                      <div className="sug-price-col">
                        {sug.oldPrice && <span className="sug-old-price">{sug.oldPrice.toFixed(2)}€</span>}
                        <strong className="sug-price">{sug.price.toFixed(2)}€</strong>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {items.length === 0 ? (
              <div className="empty-cart-state">
                <div className="empty-cart-icon">🛒</div>
                <h3>Το καλάθι είναι άδειο!</h3>
              </div>
            ) : (
              <div className="categories-container">
                {Object.keys(groupedItems).sort().map(cat => (
                  <div key={cat} className="category-group">
                    <h2 className="category-title">{cat}</h2>
                    <ul className="grocery-list">
                      {groupedItems[cat].map(item => (
                        <li key={item.id} className="item-card">
                          <div className="item-content">
                            <div className="item-header">
                              <span className="item-text">{item.text}</span>
                              <span className={`item-price ${item.price === 0 ? 'unknown-price' : ''}`}>{item.price > 0 ? `${item.price.toFixed(2)}€` : '—'}</span>
                            </div>
                            {item.store !== 'Άγνωστο' && <div style={{fontSize: '11px', color: '#64748b'}}>📍 {item.store}</div>}
                          </div>
                          <button className="delete-btn" onClick={() => deleteItem(item.id)}>❌</button>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* 🟢 ΝΕΟ: RECIPES TAB ME FRIDGE AI */}
        {activeTab === 'recipes' && (
          <div className="tab-content recipes-tab">
            
            {/* 🧊 2. Fridge AI Search Box */}
            <div className="fridge-ai-box">
              <span className="fridge-icon">🧊</span>
              <input 
                type="text" 
                placeholder="Τι έχεις στο ψυγείο; (π.χ. κοτόπουλο, ρύζι)" 
                value={fridgeQuery}
                onChange={(e) => setFridgeQuery(e.target.value)}
                className="fridge-input"
              />
            </div>

            <div className="recipe-filters">
              <button className={`filter-btn ${recipeFilter === 'all' ? 'active' : ''}`} onClick={() => setRecipeFilter('all')}>Όλες</button>
              <button className={`filter-btn budget ${recipeFilter === 'budget' ? 'active' : ''}`} onClick={() => setRecipeFilter('budget')}><span>€</span> Οικονομικές</button>
              <button className={`filter-btn fast ${recipeFilter === 'fast' ? 'active' : ''}`} onClick={() => setRecipeFilter('fast')}>⏱️ Γρήγορες</button>
            </div>

            {filteredRecipes.length === 0 ? (
              <div className="empty-cart-state" style={{marginTop: '20px'}}>
                <div className="empty-cart-icon" style={{animation: 'none'}}>👨‍🍳</div>
                <h3>Δε βρέθηκαν συνταγές!</h3>
              </div>
            ) : (
              <div className="recipes-grid">
                {filteredRecipes.map(recipe => (
                  <div key={recipe._id || recipe.id} className={`recipe-card ${expandedRecipe === (recipe._id || recipe.id) ? 'expanded' : ''}`}>
                    <div className="recipe-card-front" onClick={() => setExpandedRecipe(expandedRecipe === (recipe._id || recipe.id) ? null : (recipe._id || recipe.id))}>
                      <div className="recipe-image" style={{backgroundImage: `url(${recipe.image})`}}>
                        {recipe.isBudget && <div className="recipe-badge green">Value for money</div>}
                      </div>
                      <div className="recipe-info">
                        <h4 className="recipe-title">{recipe.title}</h4>
                        <p className="recipe-chef">από <strong>{recipe.chef}</strong></p>
                        <div className="recipe-meta">
                          <span className="meta-item time">⏱️ {recipe.time}'</span>
                          <span className="meta-item cost">~{recipe.cost.toFixed(2)}€ υλικά</span>
                        </div>
                      </div>
                    </div>

                    {expandedRecipe === (recipe._id || recipe.id) && (
                      <div className="recipe-card-expanded fade-in-item">
                        <button className="add-ingredients-btn" onClick={() => addRecipeToList(recipe)}>
                          🛒 Προσθήκη υλικών στη Λίστα
                        </button>
                        <div className="recipe-ingredients">
                          <h5>Υλικά:</h5>
                          <ul>{recipe.ingredients.map((ing, idx) => <li key={idx}>• {ing}</li>)}</ul>
                        </div>
                        {recipe.instructions && recipe.instructions.length > 0 && (
                          <div className="pro-recipe-instructions">
                            <h5>Εκτέλεση:</h5>
                            <ul>{recipe.instructions.map((step, idx) => (
                              <li key={idx} style={{ display: 'flex', gap: '12px', marginBottom: '10px' }}>
                                <div style={{ background: '#f1f5f9', color: '#475569', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '6px', fontWeight: 'bold', flexShrink: 0, fontSize: '12px' }}>{idx + 1}</div>
                                <p style={{ margin: 0, fontSize: '14px', color: '#334155' }}>{step}</p>
                              </li>
                            ))}</ul>
                          </div>
                        )}
                        {recipe.ovenTemp && (
                          <div className="dual-mode-cooking">
                            <div className="cook-method oven"><span className="method-icon">♨️</span><div><h6>Φούρνος</h6><p>{recipe.ovenTemp}°C για {recipe.ovenTime}'</p></div></div>
                            <div className="cook-method air-fryer"><span className="method-icon">💨</span><div><h6>Air Fryer</h6><p>{recipe.ovenTemp - 20}°C για {Math.round(recipe.ovenTime * 0.8)}'</p></div></div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'brochures' && (
          <div className="tab-content brochures-tab">
            <div className="real-offers-container">
              <div className="mock-offers-list">
                {Object.keys(SUPERMARKET_LOGOS).map(sm => {
                  let link = '#';
                  if (sm === 'ΑΒ Βασιλόπουλος') link = 'https://www.fylladiomat.gr/%CE%B1%CE%B2-%CE%B2%CE%B1%CF%83%CE%B9%CE%BB%CF%8C%CF%80%CE%BF%CF%85%CE%BB%CE%BF%CF%82/';
                  else if (sm === 'MyMarket') link = 'https://www.fylladiomat.gr/my-market/';
                  else if (sm === 'Μασούτης') link = 'https://www.fylladiomat.gr/%CE%BC%CE%B1%CF%83%CE%BF%CF%8D%CF%84%CE%B7%CF%82/';
                  else if (sm === 'Κρητικός') link = 'https://www.fylladiomat.gr/%CE%BA%CF%81%CE%B7%CF%84%CE%B9%CE%BA%CE%BF%CF%83/';
                  else if (sm === 'Γαλαξίας') link = 'https://www.fylladiomat.gr/%CE%B3%CE%B1%CE%BB%CE%B1%CE%BE%CE%AF%CE%B1%CF%82/';
                  else if (sm === 'Market In') link = 'https://www.fylladiomat.gr/market-in/';
                  else link = 'https://www.fylladiomat.gr/%CF%83%CE%BA%CE%BB%CE%B1%CE%B2%CE%B5%CE%BD%CE%B9%CF%84%CE%B7%CF%83/';
                  return (
                    <a key={sm} href={link} target="_blank" rel="noopener noreferrer" className="offer-card real-link">
                      <img src={SUPERMARKET_LOGOS[sm]} alt={sm} className="offer-logo"/>
                      <div className="offer-details"><strong>{sm}</strong></div>
                    </a>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}