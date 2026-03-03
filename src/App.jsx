import { useState, useEffect, useRef } from 'react';
import './App.css';
import RecipeNotification from './RecipeNotification';
import AuthModal from './AuthModal';
import SavedListsModal from './SavedListsModal';
import { io } from 'socket.io-client';

// Helper Functions
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
      if (name === q) return 100;
      if (name.startsWith(q + ' ')) return 90;
      if (new RegExp(`(^|\\s)${escapeRegExp(q)}(\\s|$)`).test(name)) return 80;
      if (new RegExp(`(^|\\s)${escapeRegExp(q)}`).test(name)) return 60;
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

const API_BASE = "https://my-smart-grocery-api.onrender.com";

export default function App() {
  // 🟢 ΝΕΟ: States για Dark Mode & Shared Cart
  const [isDarkMode, setIsDarkMode] = useState(() => localStorage.getItem('theme') === 'dark');
  const [showShareModal, setShowShareModal] = useState(false);
  const [targetFriendKey, setTargetFriendKey] = useState(''); // Ο κωδικός του φίλου
  const socketRef = useRef(null);

  const [savedLists, setSavedLists] = useState([]);
  const [showListsModal, setShowListsModal] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('smart_grocery_user')) || null);
  const [items, setItems] = useState(() => JSON.parse(localStorage.getItem('proGroceryItems_real')) || []);
  const [inputValue, setInputValue] = useState('');
  const [activeTab, setActiveTab] = useState('list');
  const [notification, setNotification] = useState({ show: false, message: '' });
  const [suggestions, setSuggestions] = useState([]);
  const [selectedStore, setSelectedStore] = useState('Όλα');
  const [isScraping, setIsScraping] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [recipes, setRecipes] = useState([]);
  const [recipeFilter, setRecipeFilter] = useState('all');
  const [expandedRecipe, setExpandedRecipe] = useState(null);
  const [fridgeQuery, setFridgeQuery] = useState('');
  const storeOptions =['Όλα', 'ΑΒ Βασιλόπουλος', 'Σκλαβενίτης', 'MyMarket', 'Μασούτης', 'Κρητικός', 'Γαλαξίας', 'Market In'];
  const searchTimeout = useRef(null);

  // 🟢 ΝΕΟ: Dark Mode Effect
  useEffect(() => {
    document.body.classList.toggle('dark-mode', isDarkMode);
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);

  // 🟢 ΝΕΟ: WebSockets Connection & Shared Cart Receival
  useEffect(() => {
    socketRef.current = io(API_BASE);
    
    if (user?.shareKey) {
        socketRef.current.emit('join_cart', user.shareKey); // Μπαίνει στο δικό του room
    }

    socketRef.current.on('receive_item', (itemData) => {
        setItems(prev => [{...itemData, id: Date.now() + Math.random()}, ...prev]);
        setNotification({ show: true, message: `🔔 Νέο προϊόν από φίλο: ${itemData.text}` });
        if(navigator.vibrate) navigator.vibrate([100, 50, 100]);
    });

    return () => socketRef.current.disconnect();
  }, [user]);

  // 🟢 ΝΕΟ: Συνάρτηση Αποστολής σε Φίλο
  const handleSendToFriend = (item) => {
    if (!targetFriendKey) {
      setShowShareModal(true);
      return;
    }
    socketRef.current.emit('send_item', { shareKey: targetFriendKey, item: item });
    setNotification({ show: true, message: '🚀 Στάλθηκε επιτυχώς!' });
  };

  // 🟢 ΝΕΟ: Μαζική Διαγραφή Λίστας
  const handleMassClear = () => {
    const confirm = window.confirm("Είστε σίγουροι ότι θέλετε να σβήσετε όλα τα προϊόντα;");
    if (confirm) {
      setItems([]);
      if(navigator.vibrate) navigator.vibrate(50);
    }
  };

  // Rest of original useEffects (Recipe fetching, Status checking, κτλ)
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

  useEffect(() => localStorage.setItem('proGroceryItems_real', JSON.stringify(items)), [items]);

  const handleVoiceClick = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Δεν υποστηρίζεται φωνητική πληκτρολόγηση."); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = 'el-GR';
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setInputValue(transcript);
      triggerSearch(transcript, selectedStore);
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
          setSuggestions(matches.slice(0, 30));
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
    setItems(prev =>[{ id: Date.now() + Math.random(), text: product.name, category: getCategory(product.name), price: product.price, store: product.supermarket, matchedName: product.name }, ...prev]);
    setInputValue('');
    setSuggestions([]);
  };

  const addRecipeToList = async (recipe) => {
    setNotification({ show: true, message: `⏳ Ψάχνω τιμές για το καλάθι...` });
    const promises = recipe.ingredients.map(async (rawIng) => {
      const cleanName = cleanIngredientText(rawIng);
      try {
        const res = await fetch(`${API_BASE}/api/prices/search?q=${encodeURIComponent(cleanName)}&store=Όλα`);
        if (res.ok) {
          const matches = await res.json();
          const bestMatch = getBestMatch(matches, cleanName);
          if (bestMatch) return { id: Date.now() + Math.random(), text: rawIng, category: getCategory(cleanName), price: bestMatch.price, store: bestMatch.supermarket };
        }
      } catch (e) {}
      return { id: Date.now() + Math.random(), text: rawIng, category: getCategory(cleanName), price: 0, store: 'Άγνωστο' };
    });
    const newItems = await Promise.all(promises);
    setItems(prev =>[...newItems, ...prev]);
    setActiveTab('list');
  };

  const deleteItem = (id) => setItems(items.filter(item => item.id !== id));

  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item); return acc;
  }, {});
  
  let totalCost = 0;
  items.forEach(item => { if (item.price > 0) totalCost += item.price; });

  const filteredRecipes = recipes.filter(r => {
    if (recipeFilter === 'budget' && !r.isBudget) return false;
    if (recipeFilter === 'healthy' && !r.isHealthy) return false;
    if (recipeFilter === 'fast' && r.time > 30) return false;
    if (fridgeQuery.trim() !== '') {
      const q = greeklishToGreek(normalizeText(fridgeQuery));
      return r.ingredients.some(ing => greeklishToGreek(normalizeText(ing)).includes(q));
    }
    return true;
  });

  return (
    <div className="app-wrapper">
      <SavedListsModal isOpen={showListsModal} onClose={() => setShowListsModal(false)} lists={savedLists} onDelete={deleteList} onToggleItem={toggleListItem}/>
      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} onLoginSuccess={(userData) => { setUser(userData); }} />
      <RecipeNotification show={notification.show} message={notification.message} onClose={() => setNotification({ show: false, message: '' })} />

      {/* 🟢 ΝΕΟ: Shared Cart Modal */}
      {showShareModal && (
        <div className="modal-overlay" onClick={() => setShowShareModal(false)}>
          <div className="auth-modal" onClick={e => e.stopPropagation()} style={{textAlign: 'center', padding: '30px'}}>
             <h3>🤝 Κοινό Καλάθι</h3>
             <p style={{fontSize: '14px', color: '#64748b'}}>Βάλε το Invite Code του φίλου σου για να του "πετάς" προϊόντα στη λίστα του.</p>
             <input 
                type="text" 
                className="pro-input" 
                placeholder="π.χ. AB123..." 
                value={targetFriendKey} 
                onChange={(e) => setTargetFriendKey(e.target.value.toUpperCase())} 
                style={{textAlign: 'center', fontSize: '18px', letterSpacing: '2px'}}
             />
             <button className="auth-submit-btn" style={{marginTop: '20px'}} onClick={() => setShowShareModal(false)}>Σύνδεση</button>
          </div>
        </div>
      )}

      <div className="container">
        {isScraping && (
          <div className="live-scraping-banner">
            <div className="pulsing-dot"></div>
            <span>LIVE ΕΝΗΜΕΡΩΣΗ ΤΙΜΩΝ...</span>
          </div>
        )}

        <header className="app-header">
          <div className="header-top">
            <div className="datetime-display">
               <div className="current-date">{timeGreeting} {timeIcon}</div>
               <div className="current-time">{currentTime.toLocaleDateString('el-GR', { day: 'numeric', month: 'short' })}</div>
            </div>
            
            <div className="header-actions" style={{display: 'flex', gap: '10px'}}>
              {/* 🟢 ΝΕΟ: Shared Cart Button */}
              <div className="logo-icon action-btn-new" onClick={() => setShowShareModal(true)}>🤝</div>
              
              <div className="logo-icon action-btn-new" onClick={() => { if(!user) return setShowAuthModal(true); setShowListsModal(true); }}>
                📝 <span className="list-badge">{savedLists.length}</span>
              </div>

              {user ? (
                <div style={{ position: 'relative' }}>
                  <div className="logo-icon action-btn-new" onClick={() => setShowProfileMenu(!showProfileMenu)}>👤</div>
                  {showProfileMenu && (
                    <div className="profile-dropdown">
                      <div className="dropdown-info" style={{padding: '10px', fontSize: '12px', borderBottom: '1px solid #eee'}}>
                        <strong>{user.name}</strong><br/>
                        <span style={{color: '#94a3b8'}}>Κωδικός: {user.shareKey}</span>
                      </div>
                      {/* 🟢 ΝΕΟ: Dark Mode Toggle */}
                      <div className="dropdown-item" onClick={() => setIsDarkMode(!isDarkMode)}>
                        {isDarkMode ? '☀️ Light Mode' : '🌙 Dark Mode'}
                      </div>
                      <div className="dropdown-item logout" onClick={() => { localStorage.clear(); window.location.reload(); }}>🚪 Αποσύνδεση</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="logo-icon action-btn-new" onClick={() => setShowAuthModal(true)}>🔒</div>
              )}
            </div>
          </div>
          <h1>Smart Hub</h1>
        </header>

        <div className="tabs-container">
          <button className={`tab-btn ${activeTab === 'list' ? 'active' : ''}`} onClick={() => setActiveTab('list')}>Λίστα</button>
          <button className={`tab-btn ${activeTab === 'recipes' ? 'active' : ''}`} onClick={() => setActiveTab('recipes')}>Συνταγές</button>
          <button className={`tab-btn ${activeTab === 'brochures' ? 'active' : ''}`} onClick={() => setActiveTab('brochures')}>Φυλλάδια</button>
        </div>

        {activeTab === 'list' && (
          <div className="tab-content list-tab">
            {totalCost > 0 && (
              <div className="budget-banner">
                <div className="budget-info">
                  <div>
                    <div className="budget-label">Συνολικό Κόστος</div>
                    <div className="budget-amount">{totalCost.toFixed(2)}€</div>
                  </div>
                  <div style={{display: 'flex', gap: '8px'}}>
                    {/* 🟢 ΝΕΟ: Mass Clear Button */}
                    <button onClick={handleMassClear} className="mass-clear-btn" title="Καθαρισμός">🗑️</button>
                    <button onClick={saveCurrentList} className="save-list-btn">💾</button>
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
              <div className="input-section">
                <input type="text" placeholder="Προσθήκη..." value={inputValue} onChange={handleInputChange} />
                <button className={`voice-btn ${isListening ? 'listening' : ''}`} onClick={handleVoiceClick}>{isListening ? '🔴' : '🎤'}</button>
                <button className="add-btn" onClick={() => triggerSearch(inputValue, selectedStore)}>+</button>
              </div>

              {suggestions.length > 0 && (
                <div className="suggestions-dropdown">
                  {suggestions.map(sug => (
                    <div key={sug._id} className="suggestion-item" onClick={() => addFromSuggestion(sug)}>
                      <img src={SUPERMARKET_LOGOS[sug.supermarket]} alt="logo" className="sug-logo" />
                      <span className="sug-name">{sug.name}</span>
                      <strong className="sug-price">{sug.price.toFixed(2)}€</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="categories-container">
              {Object.keys(groupedItems).sort().map(cat => (
                <div key={cat} className="category-group fade-in-item">
                  <h2 className="category-title">{cat}</h2>
                  <ul className="grocery-list">
                    {groupedItems[cat].map(item => (
                      <li key={item.id} className="item-card ripple">
                        <div className="item-content">
                          <span className="item-text">{item.text}</span>
                          <span className="item-price-tag">{item.price > 0 ? `${item.price.toFixed(2)}€` : '—'}</span>
                          <div className="item-store-tag">📍 {item.store}</div>
                        </div>
                        <div style={{display: 'flex', gap: '5px'}}>
                           {/* 🟢 ΝΕΟ: Send Individual Item Button */}
                           <button className="send-friend-btn" onClick={() => handleSendToFriend(item)}>📤</button>
                           <button className="delete-btn" onClick={() => deleteItem(item.id)}>❌</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Recipes & Brochures tabs remain mostly same as your source but with UI polish... */}
        {activeTab === 'recipes' && (
          <div className="tab-content recipes-tab">
            <div className="fridge-ai-box">
              <span className="fridge-icon">🧊</span>
              <input type="text" placeholder="Τι έχεις στο ψυγείο;" value={fridgeQuery} onChange={(e) => setFridgeQuery(e.target.value)} className="fridge-input" />
            </div>

            <div className="recipe-filters">
              <button className={`filter-btn ${recipeFilter === 'all' ? 'active' : ''}`} onClick={() => setRecipeFilter('all')}>Όλες</button>
              <button className={`filter-btn budget ${recipeFilter === 'budget' ? 'active' : ''}`} onClick={() => setRecipeFilter('budget')}>€ Φθηνές</button>
              <button className={`filter-btn fast ${recipeFilter === 'fast' ? 'active' : ''}`} onClick={() => setRecipeFilter('fast')}>⏱️ Γρήγορες</button>
            </div>

            <div className="recipes-grid">
              {filteredRecipes.map(recipe => (
                <div key={recipe._id} className="recipe-card" onClick={() => setExpandedRecipe(expandedRecipe === recipe._id ? null : recipe._id)}>
                  <div className="recipe-image" style={{backgroundImage: `url(${recipe.image})`}}></div>
                  <div className="recipe-info">
                    <h4>{recipe.title}</h4>
                    <span className="recipe-chef">από {recipe.chef}</span>
                    <div className="recipe-meta">
                      <span>⏱️ {recipe.time}'</span>
                      <span>💰 ~{recipe.cost.toFixed(1)}€</span>
                    </div>
                  </div>
                  {expandedRecipe === recipe._id && (
                    <div className="recipe-details-expanded">
                      <button className="add-recipe-btn" onClick={(e) => { e.stopPropagation(); addRecipeToList(recipe); }}>🛒 Προσθήκη Υλικών</button>
                      <h5>Υλικά:</h5>
                      <ul className="ing-list">{recipe.ingredients.map((ing, i) => <li key={i}>• {ing}</li>)}</ul>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === 'brochures' && (
             <div className="tab-content brochures-tab">
                <div className="mock-offers-list">
                    {Object.keys(SUPERMARKET_LOGOS).map(sm => (
                        <div key={sm} className="offer-card ripple">
                            <img src={SUPERMARKET_LOGOS[sm]} alt={sm} className="offer-logo" />
                            <strong>{sm}</strong>
                        </div>
                    ))}
                </div>
             </div>
        )}
      </div>
    </div>
  );
}