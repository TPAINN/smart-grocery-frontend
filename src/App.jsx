import { useState, useEffect, useRef } from 'react';
import './App.css';
import RecipeNotification from './RecipeNotification';
import AuthModal from './AuthModal';
import SavedListsModal from './SavedListsModal';

// --- 1. NORMALIZATION & GREEKLISH ENGINE ---
const normalizeText = (text) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();

// Μετατρέπει τα Greeklish σε Ελληνικά για να τα βρίσκει η βάση!
const greeklishToGreek = (text) => {
  let el = text.toLowerCase();
  const map = {
    'th': 'θ', 'ch': 'χ', 'ps': 'ψ', 'ks': 'ξ',
    'a': 'α', 'b': 'β', 'c': 'κ', 'd': 'δ', 'e': 'ε', 'f': 'φ', 'g': 'γ', 'h': 'η',
    'i': 'ι', 'j': 'τζ', 'k': 'κ', 'l': 'λ', 'm': 'μ', 'n': 'ν', 'o': 'ο', 'p': 'π',
    'q': 'κ', 'r': 'ρ', 's': 'σ', 't': 'τ', 'u': 'υ', 'v': 'β', 'w': 'ω', 'x': 'χ',
    'y': 'υ', 'z': 'ζ'
  };
  for (let key in map) { el = el.split(key).join(map[key]); }
  return el;
};

// --- 2. ΚΑΤΗΓΟΡΙΕΣ ΓΙΑ ΤΟ ΚΑΛΑΘΙ ---
const CATEGORIES = [
  { name: '🍎 Φρέσκα Φρούτα & Λαχανικά', keywords: ['μηλο', 'μπανανα', 'ντοματα', 'πατατα', 'κρεμμυδι', 'λεμονι'] },
  { name: '🥛 Γαλακτοκομικά', keywords: ['γαλα', 'τυρι', 'γιαουρτι', 'βουτυρο', 'φετα'] },
  { name: '🥩 Κρέας & Ψάρια', keywords: ['κοτοπουλο', 'κρεας', 'κιμας', 'ψαρι'] },
  { name: '🍞 Φούρνος', keywords: ['ψωμι', 'πιτα', 'φρυγανιες', 'χωριατικο'] },
  { name: '🍝 Ράφι', keywords: ['μακαρονια', 'ρυζι', 'λαδι', 'ζαχαρη', 'μελι'] },
  { name: '📦 Διάφορα Είδη', keywords: [] }
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

// --- 3. ΕΛΛΗΝΙΚΟ ΗΜΕΡΟΛΟΓΙΟ (ΕΠΕΣΤΡΕΨΕ!) ---
const getCalendarEvent = (date) => {
  const month = date.getMonth() + 1, day = date.getDate(), dayOfWeek = date.getDay(), year = date.getFullYear();
  if (year === 2026 && month === 2 && day === 23) return { type: 'clean-monday', icon: '🪁', title: 'Καλή Σαρακοστή & Καθαρά Δευτέρα!', text: 'Σήμερα τα θαλασσινά, η λαγάνα και ο ταραμάς έχουν την τιμητική τους.' };
  if (year === 2026 && ((month === 2 && day > 23) || month === 3 || (month === 4 && day < 12))) return { type: 'fasting', icon: '🌿', title: 'Περίοδος Νηστείας', text: 'Βάλε στη λίστα σου όσπρια και λαχανικά.' };
  if (month === 12 && day >= 15) return { type: 'christmas', icon: '🎄', title: 'Πλησιάζουν τα Χριστούγεννα!', text: 'Οργάνωσε το γιορτινό τραπέζι.' };
  if (dayOfWeek === 0 || dayOfWeek === 6) return { type: 'weekend', icon: '🍳', title: 'Σαββατοκύριακο!', text: 'Ευκαιρία να οργανώσεις τα γεύματα της εβδομάδας.' };
  return null;
};
// Δυναμικό API Base URL (Λειτουργεί αυτόματα σε Localhost, LAN & Production)
const API_BASE = window.location.hostname === 'localhost' 
  ? 'http://localhost:5000' 
  : `http://${window.location.hostname}:5000`;
// --- ΑΡΧΗ ΕΦΑΡΜΟΓΗΣ ---
export default function App() {
  const [savedLists, setSavedLists] = useState([]);
  const [showListsModal, setShowListsModal] = useState(false);
  const [expandedStore, setExpandedStore] = useState(null); // Κρατάει το όνομα του ανοιχτού Supermarket
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [theme, setTheme] = useState('light'); // Προετοιμασία για το Dark Mode
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('smart_grocery_user')) || null);
  const [items, setItems] = useState(() => JSON.parse(localStorage.getItem('proGroceryItems_real')) || []);
  const [inputValue, setInputValue] = useState('');
  const [activeTab, setActiveTab] = useState('list'); // Tabs: list, recipes, offers, brochures
  const [notification, setNotification] = useState({ show: false, message: '' });
  const [recipeCategory, setRecipeCategory] = useState('discount');
  // LIVE DB DEALS
  const [liveDeals, setLiveDeals] = useState([]);
  // SMART SEARCH SUGGESTIONS
  const [suggestions, setSuggestions] = useState([]);
  const [selectedStore, setSelectedStore] = useState('Όλα');
  const storeOptions =['Όλα', 'ΑΒ Βασιλόπουλος', 'Σκλαβενίτης', 'MyMarket', 'Μασούτης', 'Κρητικός', 'Γαλαξίας', 'Market In'];
  const searchTimeout = useRef(null);

  useEffect(() => {
    // ΜΗΝΥΜΑ ΚΑΛΩΣΟΡΙΣΜΑΤΟΣ ΜΙΑΣ ΦΟΡΑΣ
    if (!localStorage.getItem('firstVisit_smart_grocery')) {
      setNotification({ show: true, message: '🎉 Καλώς ήρθες στο My Smart Grocery Hub! Εδώ συγκεντρώνονται οι καλύτερες προσφορές καθημερινά.' });
      localStorage.setItem('firstVisit_smart_grocery', 'true');
    }
  },[]);

  // --- 4. ΛΟΓΙΚΗ ΑΠΟΘΗΚΕΥΜΕΝΩΝ ΛΙΣΤΩΝ (API CALLS) ---
  const fetchSavedLists = async () => {
    if (!user) { setSavedLists([]); return; }
    try {
      const token = localStorage.getItem('smart_grocery_token');
      const res = await fetch(`${API_BASE}/api/lists`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        setSavedLists(data);
      }
    } catch (err) { console.error("Σφάλμα φόρτωσης λιστών", err); }
  };

  // Τραβάει τις λίστες κάθε φορά που συνδέεται ο χρήστης
  useEffect(() => { fetchSavedLists(); }, [user]);

  // Αποθήκευση της τρέχουσας λίστας
  const saveCurrentList = async () => {
    if (!user) return setNotification({ show: true, message: 'Πρέπει να συνδεθείς για να αποθηκεύσεις λίστα!' });
    if (items.length === 0) return setNotification({ show: true, message: 'Η λίστα σου είναι άδεια!' });

    const title = window.prompt("Δώσε ένα όνομα για τη Λίστα σου:", `Ψώνια ${formattedDate}`);
    if (!title) return; 

    try {
      const token = localStorage.getItem('smart_grocery_token');
      
      const res = await fetch('${API_BASE}/api/lists', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': `Bearer ${token}` 
        },
        body: JSON.stringify({ title, items })
      });

      // Αν ο Server απαντήσει με 404 (Cannot POST), το πιάνουμε ΕΔΩ!
      if (res.status === 404) {
         setNotification({ show: true, message: 'Σφάλμα 404: Ο Server δεν βρήκε τη διαδρομή. Έκανες save το server.js?' });
         return;
      }

      const data = await res.json();
      
      if (res.ok) {
        setNotification({ show: true, message: 'Η λίστα αποθηκεύτηκε επιτυχώς!' });
        fetchSavedLists(); // Ανανεώνει το Badge
      } else {
        setNotification({ show: true, message: data.message || 'Αποτυχία αποθήκευσης.' });
      }
    } catch (err) { 
      console.error("Σφάλμα Δικτύου:", err); 
      setNotification({ show: true, message: 'Σφάλμα: Ο Server είναι κλειστός ή υπάρχει πρόβλημα στον κώδικα.' });
    }
  };

  // Τικάρισμα / Ξε-τικάρισμα προϊόντος μέσα στο Modal
  const toggleListItem = async (listId, itemToToggle) => {
    // 1. Βρίσκουμε τη λίστα και το προϊόν στο state (Optimistic UI Update)
    const listToUpdate = savedLists.find(l => l._id === listId);
    const updatedItems = listToUpdate.items.map(i => 
      (i._id === itemToToggle._id || i.id === itemToToggle.id) ? { ...i, isChecked: !i.isChecked } : i
    );

    // 2. Ενημερώνουμε τοπικά για να φαίνεται αστραπιαία!
    setSavedLists(savedLists.map(l => l._id === listId ? { ...l, items: updatedItems } : l));

    // 3. Στέλνουμε την αλλαγή στη Βάση (Background)
    try {
      const token = localStorage.getItem('smart_grocery_token');
      await fetch(`${API_BASE}/api/lists/${listId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ title: listToUpdate.title, items: updatedItems })
      });
    } catch (err) { console.error(err); }
  };

  // Διαγραφή Λίστας
  const deleteList = async (listId) => {
    if(!window.confirm("Σίγουρα θέλεις να διαγράψεις αυτή τη λίστα;")) return;
    try {
      const token = localStorage.getItem('smart_grocery_token');
      await fetch(`${API_BASE}/api/lists/${listId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      fetchSavedLists();
      setNotification({ show: true, message: 'Η λίστα διεγράφη.' });
    } catch (err) { console.error(err); }
  };

  // ΡΟΛΟΙ & ΗΜΕΡΟΛΟΓΙΟ
  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const formattedDate = currentTime.toLocaleDateString('el-GR', { day: 'numeric', month: 'long', year: 'numeric' });
  const formattedTime = currentTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  const todayEvent = getCalendarEvent(currentTime);

  useEffect(() => {
    fetch(`${API_BASE}/api/prices`) // Αν δεν έβαλες το API_BASE από το προηγούμενο, γράψε 'http://localhost:5000/api/prices'
      .then(res => res.json())
      .then(data => {
        // Σιγουρευόμαστε ότι είναι Πίνακας πριν το σώσουμε!
        if (Array.isArray(data)) {
          setLiveDeals(data);
        } else {
          setLiveDeals([]);
        }
      })
      .catch(err => {
        console.log("Ο Server είναι κλειστός.");
        setLiveDeals([]);
      });
  }, []);

  useEffect(() => localStorage.setItem('proGroceryItems_real', JSON.stringify(items)), [items]);

// --- Η ΕΞΥΠΝΗ ΑΝΑΖΗΤΗΣΗ (API-POWERED & ΦΙΛΤΡΟ ΚΑΤΑΣΤΗΜΑΤΟΣ) ---
 const triggerSearch = async (query, store) => {
    if (query.trim().length >= 2) {
      const searchGreek = greeklishToGreek(normalizeText(query));
      try {
        const res = await fetch(`${API_BASE}/api/prices/search?q=${encodeURIComponent(searchGreek)}&store=${encodeURIComponent(store)}`);
        if (res.ok) {
          const matches = await res.json();
          matches.sort((a, b) => {
            const aExact = a.normalizedName.startsWith(searchGreek);
            const bExact = b.normalizedName.startsWith(searchGreek);
            if (aExact && !bExact) return -1;
            if (!aExact && bExact) return 1;
            return 0;
          });
          setSuggestions(matches);
        }
      } catch (error) { console.error("Σφάλμα:", error); }
    } else {
      setSuggestions([]);
    }
  };

  const handleInputChange = (e) => {
    const val = e.target.value;
    setInputValue(val);
    
    // Debounce 300ms για να μην "σπαμάρουμε" το API
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      triggerSearch(val, selectedStore);
    }, 300);
  };

  // Προσθήκη επιλεγμένου προϊόντος από τη λίστα
  const addFromSuggestion = (product) => {
    setItems(prev => [{ 
      id: Date.now() + Math.random(), 
      text: product.name, 
      category: getCategory(product.name), 
      price: product.price, 
      store: product.supermarket,
      matchedName: product.name 
    }, ...prev]);
    setInputValue('');
    setSuggestions([]);
    setNotification({ show: true, message: `${product.name} προστέθηκε!` });
  };

  // Προσθήκη χειροκίνητα (αν πατήσει +)
  const handleInputAdd = () => {
    if (inputValue.trim() !== '') {
      if (suggestions.length > 0) {
        addFromSuggestion(suggestions[0]); // Προσθέτει αυτόματα το φθηνότερο που βρήκε!
      } else {
        setItems(prev => [{ id: Date.now(), text: inputValue.trim(), category: getCategory(inputValue), price: 0, store: 'Άγνωστο' }, ...prev]);
        setInputValue('');
      }
    }
  };

  const deleteItem = (id) => setItems(items.filter(item => item.id !== id));

  const groupedItems = items.reduce((acc, item) => {
    if (!acc[item.category]) acc[item.category] = [];
    acc[item.category].push(item); return acc;
  }, {});
  
  let totalCost = 0;
  items.forEach(item => { if (item.price > 0) totalCost += item.price; });

  // Φιλτράρισμα για το Tab 3 (ΜΟΝΟ ΠΡΟΣΦΟΡΕΣ)
  const offersOnly = liveDeals.filter(d => d.isOnSale === true);

  return (
    <div className="app-wrapper">
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
        onLoginSuccess={(userData) => {
          setUser(userData);
          setNotification({ show: true, message: `Καλώς ήρθες, ${userData.name}!` });
        }} 
      />
      <RecipeNotification show={notification.show} message={notification.message} onClose={() => setNotification({ show: false, message: '' })} />

      <div className="container">
        <header className="app-header">
          <div className="header-top" style={{ justifyContent: 'space-between' }}>
            
            {/* ΑΡΙΣΤΕΡΑ: Ημερομηνία */}
            <div className="datetime-display">
              <div className="current-date">{formattedDate}</div>
              <div className="current-time">Η ώρα τώρα είναι : {formattedTime}</div>
            </div>
            
            {/* ΔΕΞΙΑ: Εικονίδια (Λίστες, Καλάθι, Προφίλ) */}
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center', position: 'relative' }}>
              
              {/* --- ΚΟΥΜΠΙ: Προσωρινές Λίστες (📝) --- */}
              <div 
                className="saved-lists-btn" 
                onClick={() => {
                  if(!user) return setNotification({show: true, message: 'Συνδέσου για να δεις τις λίστες σου.'});
                  setShowListsModal(true);
                }}
                style={{cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', transition: '0.2s'}}
              >
                <div className="logo-icon" style={{background: '#f8fafc', color: '#111827', fontSize: '20px', width: '42px', height: '42px', borderRadius: '12px', border: '1px solid #e5e7eb', position: 'relative'}}>
                  📝
                  <span className={`list-badge ${user && user.isPremium ? 'premium' : ''} ${savedLists.length > 0 ? 'has-items' : ''}`}>
                    {savedLists.length}
                  </span>
                </div>
                <span style={{fontSize: '11px', fontWeight: 'bold', color: '#64748b', marginTop: '4px'}}>Λίστες</span>
              </div>
              
              {/* Προφίλ / Σύνδεση (🔒 / 👤) */}
              {user ? (
                <div style={{ position: 'relative' }}>
                  <div 
                    onClick={() => setShowProfileMenu(!showProfileMenu)} 
                    style={{cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', transition: '0.2s'}}
                  >
                    <div className="logo-icon" style={{background: '#10b981', fontSize: '20px', width: '42px', height: '42px', borderRadius: '12px'}}>👤</div>
                    <span style={{fontSize: '11px', fontWeight: 'bold', color: '#10b981', marginTop: '4px'}}>{user.name.split(' ')[0]}</span>
                  </div>

                  {/* Καθαρό Dropdown (ΧΩΡΙΣ ΤΟ THEME) */}
                  {showProfileMenu && (
                    <>
                      <div className="dropdown-overlay" onClick={() => setShowProfileMenu(false)}></div>
                      <div className="profile-dropdown">
                        <div className="dropdown-item logout" onClick={() => {
                          localStorage.removeItem('smart_grocery_token');
                          localStorage.removeItem('smart_grocery_user');
                          setUser(null);
                          setShowProfileMenu(false);
                          setNotification({ show: true, message: 'Αποσυνδεθήκατε επιτυχώς.' });
                        }}>
                          <span style={{fontSize: '18px'}}>🚪</span> Αποσύνδεση
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div 
                  onClick={() => setShowAuthModal(true)} 
                  style={{cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', transition: '0.2s'}}
                >
                  <div className="logo-icon" style={{background: '#f3f4f6', color: '#374151', fontSize: '20px', width: '42px', height: '42px', borderRadius: '12px', border: '1px solid #e5e7eb'}}>🔒</div>
                  <span style={{fontSize: '11px', fontWeight: 'bold', color: '#6b7280', marginTop: '4px'}}>Σύνδεση</span>
                </div>
              )}
            </div>

          </div>
          <h1>Super List</h1>
        </header>

        {/* ΗΜΕΡΟΛΟΓΙΟ */}
        {todayEvent && (
          <div className={`seasonal-banner ${todayEvent.type}`}>
            <div className="seasonal-banner-content">
              <span className="seasonal-icon">{todayEvent.icon}</span>
              <div className="seasonal-text">
                <h3>{todayEvent.title}</h3>
                <p>{todayEvent.text}</p>
              </div>
            </div>
          </div>
        )}

        {/* --- TABS (Η ΜΟΝΑΔΙΚΗ ΚΑΙ ΣΩΣΤΗ ΜΠΑΡΑ) --- */}
        <div className="tabs-container">
          <button className={`tab-btn ${activeTab === 'list' ? 'active' : ''}`} onClick={() => setActiveTab('list')}>Η Λίστα</button>
          <button className={`tab-btn ${activeTab === 'recipes' ? 'active' : ''}`} onClick={() => setActiveTab('recipes')}>Συνταγές</button>
          <button className={`tab-btn ${activeTab === 'brochures' ? 'active' : ''}`} onClick={() => setActiveTab('brochures')}>Φυλλάδια</button>
        </div>

        {/* --- TAB 1: ΛΙΣΤΑ & ΕΞΥΠΝΗ ΑΝΑΖΗΤΗΣΗ --- */}
        {activeTab === 'list' && (
          <div className="tab-content list-tab">
            {totalCost > 0 && (
              <div className="budget-banner">
                <div className="budget-info">
                  <div>
                    <div className="budget-label">Κόστος Καλαθιού</div>
                    <div className="budget-amount">{totalCost.toFixed(2)}€</div>
                  </div>
                  <button onClick={saveCurrentList} style={{background: '#10b981', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 12px rgba(16,185,129,0.3)'}}>
                    💾 Αποθήκευση
                  </button>
                </div>
              </div>
            )}
            
            <div className="smart-search-wrapper">
              
              {/* --- ΝΕΟ: APPLE-STYLE STORE FILTER CHIPS --- */}
              <div className="store-filter-container">
                {storeOptions.map(store => (
                  <button 
                    key={store}
                    className={`store-chip ${selectedStore === store ? 'active' : ''}`}
                    onClick={() => {
                      setSelectedStore(store);
                      triggerSearch(inputValue, store); // Αν έχεις ήδη γράψει π.χ. "Γάλα", αλλάζει αμέσως τα αποτελέσματα!
                    }}
                  >
                    {store}
                  </button>
                ))}
              </div>

              {/* ΕΔΩ ΞΕΚΙΝΑΕΙ ΤΟ INPUT ΠΟΥ ΕΙΧΕΣ */}
              <div className="input-section" style={{marginBottom: suggestions.length > 0 ? '0' : '40px'}}>
                <input 
                  type="text" 
                  placeholder="Αναζήτηση..." 
                  value={inputValue} 
                  onChange={handleInputChange} 
                  onKeyDown={(e) => e.key === 'Enter' && handleInputAdd()} 
                />
                <button className="add-btn" onClick={handleInputAdd}>+</button>
              </div>

              {/* DROPDOWN ΠΡΟΤΑΣΕΩΝ (Premium & Accurate) */}
              {suggestions.length > 0 && (
                <div className="suggestions-dropdown">
                  <div className="suggestions-header">🔥 Βρέθηκαν οι φθηνότερες επιλογές:</div>
                  {suggestions.map(sug => (
                    <div key={sug._id} className="suggestion-item" onClick={() => addFromSuggestion(sug)}>
                      <div className="sug-left">
                        <img src={SUPERMARKET_LOGOS[sug.supermarket]} alt="logo" className="sug-logo" />
                        <div className="sug-name-wrapper">
                          <span className="sug-name">{sug.name}</span>
                          <div style={{display: 'flex', gap: '4px'}}>
                            {sug.is1plus1 && <span className="sug-badge plusone">🎁 +1 ΔΩΡΟ</span>}
                            {!sug.is1plus1 && sug.discountPercent && <span className="sug-badge discount">📉 -{sug.discountPercent}%</span>}
                            {!sug.is1plus1 && !sug.discountPercent && sug.isOnSale && <span className="sug-badge sale">🔥 ΠΡΟΣΦΟΡΑ</span>}
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
                            <span className={`item-price ${item.price === 0 ? 'unknown-price' : ''}`}>{item.price > 0 ? `${item.price.toFixed(2)}€` : '???'}</span>
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
          </div>
        )}

        {/* --- TAB 2: ΣΥΝΤΑΓΕΣ --- */}
        {activeTab === 'recipes' && (
          <div className="tab-content">
            <div className="real-offers-container">
               <h3>Συνταγές</h3>
               <p>Διαθέσιμες στο Premium Πακέτο (Coming soon!)</p>
            </div>
          </div>
        )}

{/* --- TAB 3: ΠΡΟΣΦΟΡΕΣ (PREMIUM GRID & DRILL-DOWN) --- */}
        {activeTab === 'offers' && (
          <div className="tab-content offers-tab">
            <div className="real-offers-container">
              
              {/* Κεφαλίδα με Δυναμικό Κουμπί Πίσω */}
              <div className="offers-header-flex">
                <h3>🔥 Top Προσφορές</h3>
                {expandedStore && (
                  <button className="back-btn" onClick={() => setExpandedStore(null)}>
                    ← Πίσω στα Καταστήματα
                  </button>
                )}
              </div>
              
              {/* SUB-TABS ΓΙΑ ΠΡΟΣΦΟΡΕΣ */}
              <div className="recipe-subtabs" style={{marginBottom: '20px', display: expandedStore ? 'none' : 'flex'}}>
                <button className={recipeCategory === 'discount' ? 'active' : ''} onClick={() => {setRecipeCategory('discount'); setExpandedStore(null);}}>-% Έκπτωση</button>
                <button className={recipeCategory === '1plus1' ? 'active' : ''} onClick={() => {setRecipeCategory('1plus1'); setExpandedStore(null);}}>+1 Δώρο</button>
              </div>

              {offersOnly.length > 0 ? (() => {
                // Φιλτράρουμε τις προσφορές ανάλογα το Sub-tab ΠΡΙΝ δείξουμε τα καταστήματα
                const currentOffers = offersOnly.filter(d => recipeCategory === '1plus1' ? d.is1plus1 : (!d.is1plus1 && d.isOnSale));
                
                // Βρίσκουμε ποια καταστήματα έχουν ΟΝΤΩΣ προσφορές σε αυτή την κατηγορία
                const availableStores = Array.from(new Set(currentOffers.map(d => d.supermarket)));

                if (currentOffers.length === 0) return <p className="empty-offers">Δεν υπάρχουν προσφορές εδώ σήμερα.</p>;

                return (
                  <div className="offers-dynamic-area">
                    {!expandedStore ? (
                      /* --- ΠΡΟΒΟΛΗ 1: ΚΑΡΤΕΣ ΚΑΤΑΣΤΗΜΑΤΩΝ (GRID) --- */
                      <div className="stores-grid">
                        {availableStores.map(storeName => {
                          const storeCount = currentOffers.filter(d => d.supermarket === storeName).length;
                          return (
                            <div key={storeName} className="store-card-btn" onClick={() => setExpandedStore(storeName)}>
                              <img src={SUPERMARKET_LOGOS[storeName]} alt={storeName} className="store-card-logo" />
                              <span className="store-card-name">{storeName}</span>
                              <span className="store-card-count">{storeCount} Προσφορές</span>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      /* --- ΠΡΟΒΟΛΗ 2: ΛΙΣΤΑ ΠΡΟΣΦΟΡΩΝ ΤΟΥ ΕΠΙΛΕΓΜΕΝΟΥ ΚΑΤΑΣΤΗΜΑΤΟΣ --- */
                      <div className="expanded-deals-list">
                        <div className="expanded-store-title">
                          <img src={SUPERMARKET_LOGOS[expandedStore]} alt="logo" className="small-inline-logo"/>
                          <h4>{expandedStore}</h4>
                        </div>
                        <div className="db-deals-list">
                          {currentOffers.filter(d => d.supermarket === expandedStore).map(deal => (
                            <div key={deal._id} className="db-deal-card fade-in-item">
                              <div className="db-deal-info">
                                <span className="db-deal-name">{deal.name}</span>
                                <div style={{display: 'flex', gap: '6px', marginTop: '4px'}}>
                                  {deal.is1plus1 && <span className="sale-badge" style={{background: '#8b5cf6'}}>🎁 +1 ΔΩΡΟ</span>}
                                  {!deal.is1plus1 && deal.discountPercent && <span className="sale-badge">📉 -{deal.discountPercent}%</span>}
                                </div>
                              </div>
                              <div className="db-deal-price" style={{textAlign: 'right'}}>
                                {deal.oldPrice && <span className="old-price-strike">{deal.oldPrice.toFixed(2)}€</span>}
                                <strong>{deal.price.toFixed(2)}€</strong>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })() : ( <p className="empty-offers">Σαρώνουμε την αγορά... Επιστρέψτε αργότερα.</p> )}
            </div>
          </div>
        )}

{/* --- TAB 4: ΦΥΛΛΑΔΙΑ (ΕΠΙΣΗΜΑ LINKS) --- */}
        {activeTab === 'brochures' && (
          <div className="tab-content brochures-tab">
            <div className="real-offers-container">
              <div className="alert-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2" style={{width: '40px', marginBottom:'10px'}}>
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
                  <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                </svg>
              </div>
              <h3>Επίσημα Φυλλάδια</h3>
              <p>Ξεφυλλίστε τα επίσημα φυλλάδια της εβδομάδας απευθείας από την πηγή.</p>

              <div className="mock-offers-list">
                {Object.keys(SUPERMARKET_LOGOS).map(sm => {
                  // Ορίζουμε το σωστό link για το κάθε σούπερ μάρκετ
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
                      <div className="offer-details">
                        <strong>{sm}</strong>
                        <span>Δείτε το φυλλάδιο ↗</span>
                      </div>
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