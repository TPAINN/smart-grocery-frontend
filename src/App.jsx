import { useState, useEffect, useRef } from 'react';
import './App.css';
import RecipeNotification from './RecipeNotification';
import AuthModal from './AuthModal';
import SavedListsModal from './SavedListsModal';

const normalizeText = (text) => text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
const escapeRegExp = (string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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

const CATEGORIES =[
  { name: '🍎 Φρέσκα Φρούτα & Λαχανικά', keywords:['μηλο', 'μπανανα', 'ντοματα', 'πατατα', 'κρεμμυδι', 'λεμονι', 'σκορδο', 'πιπερια'] },
  { name: '🥛 Γαλακτοκομικά', keywords:['γαλα', 'τυρι', 'γιαουρτι', 'βουτυρο', 'φετα', 'παρμεζανα', 'κρεμα'] },
  { name: '🥩 Κρέας & Ψάρια', keywords:['κοτοπουλο', 'κρεας', 'κιμας', 'ψαρι', 'σολομος', 'μπειικον'] },
  { name: '🍞 Φούρνος', keywords:['ψωμι', 'πιτα', 'φρυγανιες', 'χωριατικο'] },
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
  const month = date.getMonth() + 1, day = date.getDate(), dayOfWeek = date.getDay(), year = date.getFullYear();
  if (month === 1 && day === 1) return { type: 'christmas', icon: '🎉', title: 'Καλή Χρονιά!', text: 'Ετοιμάσου για το πρώτο τραπέζι της χρονιάς.' };
  if (month === 1 && day === 6) return { type: 'clean-monday', icon: '🕊️', title: 'Καλά Θεοφάνεια!', text: 'Χρόνια πολλά! Ώρα για εορταστικά γεύματα.' };
  if (month === 3 && day === 25) return { type: 'clean-monday', icon: '🇬🇷', title: '25η Μαρτίου', text: 'Παραδοσιακά, σήμερα τρώμε μπακαλιάρο σκορδαλιά!' };
  if (month === 5 && day === 1) return { type: 'summer', icon: '🌸', title: 'Καλό Μήνα & Πρωτομαγιά!', text: 'Ιδανική μέρα για πικνίκ ή ψήσιμο στη φύση.' };
  if (month === 8 && day === 15) return { type: 'summer', icon: '⛪', title: 'Δεκαπενταύγουστος', text: 'Το Πάσχα του καλοκαιριού. Καλό γιορτινό τραπέζι!' };
  if (month === 10 && day === 28) return { type: 'clean-monday', icon: '🇬🇷', title: 'Εθνική Επέτειος 28ης Οκτωβρίου', text: 'Χρόνια πολλά σε όλους τους Έλληνες!' };
  if (month === 12 && (day === 25 || day === 26)) return { type: 'christmas', icon: '🎄', title: 'Καλά Χριστούγεννα!', text: 'Απολαύστε το γιορτινό τραπέζι με τα αγαπημένα σας πρόσωπα.' };

  if (year === 2026) {
    if (month === 2 && day === 12) return { type: 'weekend', icon: '🍖', title: 'Τσικνοπέμπτη!', text: 'Ετοιμάσου για ψήσιμο! Βρες προσφορές σε κρέατα.' };
    if (month === 2 && day === 23) return { type: 'clean-monday', icon: '🪁', title: 'Καθαρά Δευτέρα', text: 'Ξεκινάει η Σαρακοστή. Ώρα για λαγάνα, ταραμά και θαλασσινά!' };
    if (month === 4 && day === 10) return { type: 'fasting', icon: '🕯️', title: 'Μεγάλη Παρασκευή', text: 'Ημέρα αυστηρής νηστείας.' };
    if (month === 4 && day === 12) return { type: 'summer', icon: '🥚', title: 'Καλό Πάσχα!', text: 'Χριστός Ανέστη! Καλά ψησίματα και καλό σούβλισμα!' };
    if (month === 4 && day === 13) return { type: 'summer', icon: '🥩', title: 'Δευτέρα του Πάσχα', text: 'Συνεχίζουμε τα εορταστικά τραπέζια!' };
    if (month === 6 && day === 1) return { type: 'clean-monday', icon: '🕊️', title: 'Αγίου Πνεύματος', text: 'Καλό τριήμερο! Ετοιμάσου για μπάρμπεκιου ή εξόρμηση.' };
    if ((month === 2 && day > 23) || month === 3 || (month === 4 && day < 10)) return { type: 'fasting', icon: '🌿', title: 'Μεγάλη Σαρακοστή', text: 'Περίοδος νηστείας: Πρόσθεσε στο καλάθι όσπρια και θαλασσινά.' };
  }

  if (month === 8 && day >= 1 && day <= 14) return { type: 'fasting', icon: '🌿', title: 'Νηστεία Δεκαπενταύγουστου', text: 'Νηστίσιμες επιλογές για τις ημέρες μέχρι την Παναγία.' };
  if ((month === 11 && day >= 15) || (month === 12 && day <= 24)) return { type: 'christmas', icon: '✨', title: 'Χριστουγεννιάτικη Νηστεία', text: 'Προετοιμασία για τις γιορτές. Δες τις νηστίσιμες προσφορές.' };
  if (dayOfWeek === 0 || dayOfWeek === 6) return { type: 'weekend', icon: '🛒', title: 'Σαββατοκύριακο!', text: 'Ιδανική μέρα για να οργανώσεις τα ψώνια της εβδομάδας.' };

  return null; 
};

const API_BASE = "https://my-smart-grocery-api.onrender.com";

export default function App() {
  const [savedLists, setSavedLists] = useState([]);
  const[showListsModal, setShowListsModal] = useState(false);
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [user, setUser] = useState(() => JSON.parse(localStorage.getItem('smart_grocery_user')) || null);
  const [items, setItems] = useState(() => JSON.parse(localStorage.getItem('proGroceryItems_real')) || []);
  const [inputValue, setInputValue] = useState('');
  
  const [activeTab, setActiveTab] = useState('list');
  const [notification, setNotification] = useState({ show: false, message: '' });
  const [suggestions, setSuggestions] = useState([]);
  const[selectedStore, setSelectedStore] = useState('Όλα');
  const [isScraping, setIsScraping] = useState(false);

  // Σωστή τοποθέτηση των Recipe Hooks!
  const [recipes, setRecipes] = useState([]);
  const [recipeFilter, setRecipeFilter] = useState('all');
  const[expandedRecipe, setExpandedRecipe] = useState(null);

  const storeOptions =['Όλα', 'ΑΒ Βασιλόπουλος', 'Σκλαβενίτης', 'MyMarket', 'Μασούτης', 'Κρητικός', 'Γαλαξίας', 'Market In'];
  const searchTimeout = useRef(null);

  // Fetch Recipes from DB
  useEffect(() => {
    fetch(`${API_BASE}/api/recipes`)
      .then(res => res.json())
      .then(data => setRecipes(Array.isArray(data) ? data :[]))
      .catch(err => console.log('Error fetching recipes'));
  },[]);

  useEffect(() => {
    if (!localStorage.getItem('firstVisit_smart_grocery')) {
      setNotification({ show: true, message: '🎉 Καλώς ήρθες στο My Smart Grocery Hub!' });
      localStorage.setItem('firstVisit_smart_grocery', 'true');
    }
    
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

  // Wake Up Server Mechanism (Για να μην νομίζει ότι κόλλησε στο Netlify)
  useEffect(() => {
    const wakeUpTimeout = setTimeout(() => {
      setNotification({ show: true, message: '⏳ Γίνεται εκκίνηση του Cloud Server... Δώσε μας λίγα δευτερόλεπτα!' });
    }, 3000);

    fetch(`${API_BASE}/api/prices`)
      .then(res => res.json())
      .then(data => clearTimeout(wakeUpTimeout))
      .catch(err => clearTimeout(wakeUpTimeout));
  },[]);

  const fetchSavedLists = async () => {
    if (!user) { setSavedLists([]); return; }
    try {
      const token = localStorage.getItem('smart_grocery_token');
      const res = await fetch(`${API_BASE}/api/lists`, { headers: { 'Authorization': `Bearer ${token}` }});
      if (res.ok) setSavedLists(await res.json());
    } catch (err) {}
  };

  useEffect(() => { fetchSavedLists(); }, [user]);

  const saveCurrentList = async () => {
    if (!user) return setNotification({ show: true, message: 'Πρέπει να συνδεθείς για να αποθηκεύσεις λίστα!' });
    if (items.length === 0) return setNotification({ show: true, message: 'Η λίστα σου είναι άδεια!' });

    const title = window.prompt("Δώσε ένα όνομα για τη Λίστα σου:", `Ψώνια ${formattedDate}`);
    if (!title) return; 

    try {
      const token = localStorage.getItem('smart_grocery_token');
      const res = await fetch(`${API_BASE}/api/lists`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ title, items })
      });
      if (res.ok) {
        setNotification({ show: true, message: 'Η λίστα αποθηκεύτηκε επιτυχώς!' });
        fetchSavedLists();
      } else {
        setNotification({ show: true, message: 'Αποτυχία αποθήκευσης. Δοκίμασε ξανά.' });
      }
    } catch (err) { setNotification({ show: true, message: 'Σφάλμα Δικτύου. Έλεγξε τη σύνδεσή σου.' }); }
  };

  const toggleListItem = async (listId, itemToToggle) => {
    const listToUpdate = savedLists.find(l => l._id === listId);
    const updatedItems = listToUpdate.items.map(i => (i._id === itemToToggle._id || i.id === itemToToggle.id) ? { ...i, isChecked: !i.isChecked } : i);
    setSavedLists(savedLists.map(l => l._id === listId ? { ...l, items: updatedItems } : l));
    if(navigator.vibrate) navigator.vibrate(20);
    try {
      const token = localStorage.getItem('smart_grocery_token');
      await fetch(`${API_BASE}/api/lists/${listId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ title: listToUpdate.title, items: updatedItems })
      });
    } catch (err) {}
  };

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
    } catch (err) {}
  };

  const [currentTime, setCurrentTime] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000);
    return () => clearInterval(timer);
  },[]);
  const formattedDate = currentTime.toLocaleDateString('el-GR', { day: 'numeric', month: 'long', year: 'numeric' });
  
  const hour = currentTime.getHours();
  let timeGreeting = 'Καλησπέρα'; let timeIcon = '🌙';
  if (hour >= 5 && hour < 12) { timeGreeting = 'Καλημέρα'; timeIcon = '☀️'; }
  else if (hour >= 12 && hour < 18) { timeGreeting = 'Καλό απόγευμα'; timeIcon = '☕'; }

  const todayEvent = getCalendarEvent(currentTime);

  useEffect(() => localStorage.setItem('proGroceryItems_real', JSON.stringify(items)), [items]);

  const triggerSearch = async (query, store) => {
    if (query.trim().length >= 2) {
      const searchGreek = greeklishToGreek(normalizeText(query));
      try {
        const res = await fetch(`${API_BASE}/api/prices/search?q=${encodeURIComponent(searchGreek)}&store=${encodeURIComponent(store)}`);
        if (res.ok) {
          const matches = await res.json();
          
          // 🟢 Ο ΕΞΥΠΝΟΣ ΑΛΓΟΡΙΘΜΟΣ ΤΑΞΙΝΟΜΗΣΗΣ (SCORING ALGORITHM)
          matches.sort((a, b) => {
            const nameA = a.normalizedName;
            const nameB = b.normalizedName;
            const q = searchGreek;

            const getScore = (name) => {
              if (name === q) return 100; // 1. Απόλυτη ταύτιση
              if (name.startsWith(q + ' ')) return 90; // 2. Ξεκινάει με τη λέξη
              
              // 3. Περιέχει τη λέξη αυτούσια οπουδήποτε
              const exactWordRegex = new RegExp(`\\b${escapeRegExp(q)}\\b`);
              if (exactWordRegex.test(name)) return 80; 
              
              if (name.startsWith(q)) return 70; // 4. Ξεκινάει απλά με τα γράμματα
              return 50; // 5. Είναι χωμένο μέσα σε άλλη λέξη (π.χ. Σοκοφρέτα)
            };

            const scoreA = getScore(nameA);
            const scoreB = getScore(nameB);

            // Πρωτεύουσα ταξινόμηση: Βάσει του Score (Μεγαλύτερο = Πιο ψηλά)
            if (scoreA !== scoreB) {
              return scoreB - scoreA;
            }
            
            // Δευτερεύουσα ταξινόμηση: Αν έχουν ίδιο Score, δείξε το ΦΘΗΝΟΤΕΡΟ πρώτο!
            return (a.price || 0) - (b.price || 0);
          });

          // Κρατάμε μόνο τα κορυφαία 30 αποτελέσματα για να μην κολλάει το UI του κινητού
          setSuggestions(matches.slice(0, 30));
        }
      } catch (error) {}
    } else {
      setSuggestions([]);
    }
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
    setNotification({ show: true, message: `${product.name} προστέθηκε!` });
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

  const addRecipeToList = (recipe) => {
    if(navigator.vibrate) navigator.vibrate([30, 50]);
    const newItems = recipe.ingredients.map(ing => ({
      id: Date.now() + Math.random(),
      text: ing,
      category: getCategory(ing),
      price: 0,
      store: 'Άγνωστο'
    }));
    setItems(prev =>[...newItems, ...prev]);
    setNotification({ show: true, message: `Προστέθηκαν ${recipe.ingredients.length} υλικά στη λίστα σου!` });
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

  // Σωστό Φιλτράρισμα βάσει των δεδομένων της Βάσης
  const filteredRecipes = recipes.filter(r => {
    if (recipeFilter === 'budget') return r.isBudget;
    if (recipeFilter === 'healthy') return r.isHealthy;
    if (recipeFilter === 'fast') return r.time <= 30;
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
              <div className="current-time">{formattedDate}</div>
            </div>
            
            <div style={{ display: 'flex', gap: '15px', alignItems: 'center', position: 'relative' }}>
              <div className="saved-lists-btn" onClick={() => { if(!user) return setNotification({show: true, message: 'Συνδέσου για να δεις τις λίστες σου.'}); setShowListsModal(true); }}>
                <div className="logo-icon" style={{background: '#f8fafc', color: '#111827', fontSize: '20px', width: '42px', height: '42px', borderRadius: '12px', border: '1px solid #e5e7eb', position: 'relative'}}>
                  📝
                  <span className={`list-badge ${user && user.isPremium ? 'premium' : ''} ${savedLists.length > 0 ? 'has-items' : ''}`}>{savedLists.length}</span>
                </div>
                <span style={{fontSize: '11px', fontWeight: 'bold', color: '#64748b', marginTop: '4px'}}>Λίστες</span>
              </div>
              
              {user ? (
                <div style={{ position: 'relative' }}>
                  <div onClick={() => setShowProfileMenu(!showProfileMenu)} style={{cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', transition: '0.2s'}}>
                    <div className="logo-icon" style={{background: '#f1f5f9', color: '#64748b', width: '42px', height: '42px', borderRadius: '12px', border: '1px solid #e2e8f0'}}>
                      <svg fill="none" viewBox="0 0 24 24" strokeWidth="1.8" stroke="currentColor" style={{width: '22px', height: '22px'}}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
                      </svg>
                    </div>
                    <span style={{fontSize: '11px', fontWeight: 'bold', color: '#475569', marginTop: '4px'}}>{user.name.split(' ')[0]}</span>
                  </div>

                  {showProfileMenu && (
                    <>
                      <div className="dropdown-overlay" onClick={() => setShowProfileMenu(false)}></div>
                      <div className="profile-dropdown">
                        <div className="dropdown-item logout" onClick={() => { localStorage.removeItem('smart_grocery_token'); localStorage.removeItem('smart_grocery_user'); setUser(null); setShowProfileMenu(false); setNotification({ show: true, message: 'Αποσυνδεθήκατε επιτυχώς.' });}}>
                          <span style={{fontSize: '18px'}}>🚪</span> Αποσύνδεση
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div onClick={() => setShowAuthModal(true)} style={{cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', transition: '0.2s'}}>
                  <div className="logo-icon" style={{background: '#f3f4f6', color: '#374151', fontSize: '20px', width: '42px', height: '42px', borderRadius: '12px', border: '1px solid #e5e7eb'}}>🔒</div>
                  <span style={{fontSize: '11px', fontWeight: 'bold', color: '#6b7280', marginTop: '4px'}}>Σύνδεση</span>
                </div>
              )}
            </div>
          </div>
          <h1>Smart Hub</h1>
        </header>

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
                  <div><div className="budget-label">Κόστος Καλαθιού</div><div className="budget-amount">{totalCost.toFixed(2)}€</div></div>
                  <button onClick={saveCurrentList} style={{background: '#10b981', color: 'white', border: 'none', padding: '10px 16px', borderRadius: '12px', fontWeight: 'bold', cursor: 'pointer', boxShadow: '0 4px 12px rgba(16,185,129,0.3)'}}>💾 Αποθήκευση</button>
                </div>
              </div>
            )}
            
            <div className="smart-search-wrapper">
              <div className="store-filter-container">
                {storeOptions.map(store => (
                  <button key={store} className={`store-chip ${selectedStore === store ? 'active' : ''}`} onClick={() => { setSelectedStore(store); triggerSearch(inputValue, store); }}>{store}</button>
                ))}
              </div>
              <div className="input-section" style={{marginBottom: suggestions.length > 0 ? '0' : '40px'}}>
                <input type="text" placeholder="Πρόσθεσε προϊόν (π.χ. Γάλα, Ψωμί)..." value={inputValue} onChange={handleInputChange} onKeyDown={(e) => e.key === 'Enter' && handleInputAdd()} />
                <button className="add-btn" onClick={handleInputAdd}>+</button>
              </div>

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

            {items.length === 0 ? (
              <div className="empty-cart-state">
                <div className="empty-cart-icon">🛒</div>
                <h3>Το καλάθι σου είναι άδειο!</h3>
                <p>Γράψε ένα προϊόν παραπάνω για να βρούμε την καλύτερη τιμή της αγοράς.</p>
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
            )}
          </div>
        )}

        {activeTab === 'recipes' && (
          <div className="tab-content recipes-tab">
            <div className="recipe-filters">
              <button className={`filter-btn ${recipeFilter === 'all' ? 'active' : ''}`} onClick={() => setRecipeFilter('all')}>Όλες</button>
              <button className={`filter-btn budget ${recipeFilter === 'budget' ? 'active' : ''}`} onClick={() => setRecipeFilter('budget')}>
                <span>€</span> Οικονομικές
              </button>
              <button className={`filter-btn fast ${recipeFilter === 'fast' ? 'active' : ''}`} onClick={() => setRecipeFilter('fast')}>
                ⏱️ Γρήγορες
              </button>
              <button className={`filter-btn healthy ${recipeFilter === 'healthy' ? 'active' : ''}`} onClick={() => setRecipeFilter('healthy')}>
                🥗 Υγιεινές
              </button>
            </div>

            {recipes.length === 0 ? (
              <div className="empty-cart-state" style={{marginTop: '40px'}}>
                <div className="empty-cart-icon" style={{animation: 'none'}}>👨‍🍳</div>
                <h3>Φόρτωση Συνταγών...</h3>
                <p>Αντλούμε τα καλύτερα πιάτα από το Cloud!</p>
              </div>
            ) : (
              <div className="recipes-grid">
                {filteredRecipes.map(recipe => (
                  <div key={recipe._id || recipe.id} className={`recipe-card ${expandedRecipe === (recipe._id || recipe.id) ? 'expanded' : ''}`}>
                    
                    <div className="recipe-card-front" onClick={() => setExpandedRecipe(expandedRecipe === (recipe._id || recipe.id) ? null : (recipe._id || recipe.id))}>
                      <div className="recipe-image" style={{backgroundImage: `url(${recipe.image})`}}>
                        {recipe.isBudget && <div className="recipe-badge green">Οικονομική</div>}
                      </div>
                      <div className="recipe-info">
                        <h4 className="recipe-title">{recipe.title}</h4>
                        <p className="recipe-chef">από <strong>{recipe.chef}</strong></p>
                        
                        <div className="recipe-meta">
                          <span className="meta-item time">⏱️ {recipe.time}'</span>
                          <span className="meta-item cal">🔥 {recipe.calories} kcal</span>
                          <span className="meta-item cost">~{recipe.cost.toFixed(2)}€</span>
                        </div>
                      </div>
                    </div>

                    {expandedRecipe === (recipe._id || recipe.id) && (
                      <div className="recipe-card-expanded fade-in-item">
                        
                        <button className="add-ingredients-btn" onClick={() => addRecipeToList(recipe)}>
                          🛒 Προσθήκη υλικών στη Λίστα μου
                        </button>

                        <div className="recipe-ingredients">
                          <h5>Υλικά:</h5>
                          <ul>
                            {recipe.ingredients.map((ing, idx) => (
                              <li key={idx}>• {ing}</li>
                            ))}
                          </ul>
                        </div>

                        {recipe.instructions && recipe.instructions.length > 0 && (
                          <div className="pro-recipe-instructions">
                            <h5>Εκτέλεση:</h5>
                            <ul>
                              {recipe.instructions.map((step, idx) => (
                                <li key={idx} style={{ display: 'flex', gap: '12px', marginBottom: '15px' }}>
                                  <div style={{ background: '#f1f5f9', color: '#475569', width: '26px', height: '26px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px', fontWeight: 'bold', flexShrink: 0, fontSize: '13px' }}>
                                    {idx + 1}
                                  </div>
                                  <p style={{ margin: 0, fontSize: '14px', color: '#334155', lineHeight: '1.5' }}>{step}</p>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {recipe.ovenTemp && (
                          <div className="dual-mode-cooking">
                            <div className="cook-method oven">
                              <span className="method-icon">♨️</span>
                              <div>
                                <h6>Φούρνος</h6>
                                <p>{recipe.ovenTemp}°C για {recipe.ovenTime}'</p>
                              </div>
                            </div>
                            
                            <div className="cook-method air-fryer">
                              <span className="method-icon">💨</span>
                              <div>
                                <h6>Air Fryer (Auto)</h6>
                                <p>{recipe.ovenTemp - 20}°C για {Math.round(recipe.ovenTime * 0.8)}'</p>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        <a href={recipe.url} target="_blank" rel="noopener noreferrer" className="read-full-recipe">
                          Διαβάστε την εκτέλεση στο site του σεφ ↗
                        </a>
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
              <div className="alert-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="#166534" strokeWidth="2" style={{width: '40px', marginBottom:'10px'}}>
                  <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
                </svg>
              </div>
              <h3>Επίσημα Φυλλάδια</h3>
              <p>Ξεφυλλίστε τα επίσημα φυλλάδια της εβδομάδας απευθείας από την πηγή.</p>
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
                      <div className="offer-details"><strong>{sm}</strong><span>Δείτε το φυλλάδιο ↗</span></div>
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