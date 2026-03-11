// ─── SmartRouteMap.jsx — Fullscreen Smart Route (Leaflet + OpenStreetMap) ────
// 100% FREE — No API key, no billing, no limits
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import {
  IconMap2, IconX, IconBuildingStore,
  IconRoute, IconCurrentLocation, IconChevronDown,
  IconChevronUp, IconClock, IconWalk, IconCar,
  IconShoppingCart, IconRefresh, IconAlertTriangle,
  IconCheck, IconMapPin, IconLoader2, IconBike,
  IconNavigation, IconArrowUpRight,
  IconArrowRight, IconArrowLeft,
  IconArrowBearRight, IconArrowBearLeft,
  IconArrowRoundaboutRight, IconFlag,
} from '@tabler/icons-react';

// ─── Greek supermarket chains ────────────────────────────────────────────────
const STORE_CHAINS = [
  { id: 'ab',          name: 'ΑΒ Βασιλόπουλος', tags: ['ΑΒ Βασιλόπουλος','AB Vassilopoulos','AB Food Market'], color: '#e31e24', emoji: '🔴' },
  { id: 'sklavenitis', name: 'Σκλαβενίτης',     tags: ['Σκλαβενίτης','Sklavenitis'],                         color: '#1a5632', emoji: '🟢' },
  { id: 'mymarket',    name: 'My Market',        tags: ['My Market'],                                         color: '#f5a623', emoji: '🟡' },
  { id: 'lidl',        name: 'Lidl',             tags: ['Lidl'],                                              color: '#0050aa', emoji: '🔵' },
  { id: 'masoutis',    name: 'Μασούτης',         tags: ['Μασούτης','Masoutis'],                                color: '#c41230', emoji: '🟠' },
  { id: 'galaxias',    name: 'Γαλαξίας',         tags: ['Γαλαξίας','Galaxias'],                                color: '#6b21a8', emoji: '🟣' },
];

// ─── Load Leaflet dynamically ────────────────────────────────────────────────
let leafletLoaded = false;
const loadLeaflet = () => {
  if (leafletLoaded && window.L) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link');
      link.id = 'leaflet-css';
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      link.crossOrigin = '';
      document.head.appendChild(link);
    }
    if (window.L) { leafletLoaded = true; resolve(); return; }
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.crossOrigin = '';
    script.onload = () => { leafletLoaded = true; resolve(); };
    script.onerror = () => reject(new Error('Failed to load Leaflet'));
    document.head.appendChild(script);
  });
};

// ─── Overpass API: find nearby supermarkets (FREE) ──────────────────────────
const searchOverpass = async (lat, lng, radius = 5000) => {
  const query = `[out:json][timeout:15];(node["shop"="supermarket"](around:${radius},${lat},${lng});way["shop"="supermarket"](around:${radius},${lat},${lng}););out center body;`;
  const resp = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
  if (!resp.ok) throw new Error('Overpass error');
  const data = await resp.json();
  return data.elements.map(el => ({
    id: el.id,
    name: el.tags?.name || 'Σούπερ Μάρκετ',
    brand: el.tags?.brand || el.tags?.operator || '',
    lat: el.lat || el.center?.lat,
    lng: el.lon || el.center?.lon,
    address: [el.tags?.['addr:street'], el.tags?.['addr:housenumber']].filter(Boolean).join(' ') || '',
  })).filter(s => s.lat && s.lng);
};

// ─── OSRM: free routing ─────────────────────────────────────────────────────
const getOSRMRoute = async (coords, profile = 'driving') => {
  const str = coords.map(c => `${c.lng},${c.lat}`).join(';');
  const resp = await fetch(`https://router.project-osrm.org/route/v1/${profile}/${str}?overview=full&geometries=geojson&steps=true`);
  if (!resp.ok) throw new Error('Routing error');
  const data = await resp.json();
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error('No route');
  return data.routes[0];
};

const getOSRMTrip = async (coords, profile = 'driving') => {
  const str = coords.map(c => `${c.lng},${c.lat}`).join(';');
  const resp = await fetch(`https://router.project-osrm.org/trip/v1/${profile}/${str}?overview=full&geometries=geojson&roundtrip=true&source=first&destination=last`);
  if (!resp.ok) throw new Error('Trip error');
  const data = await resp.json();
  if (data.code !== 'Ok' || !data.trips?.length) throw new Error('No trip');
  return data.trips[0];
};

// ─── Helpers ────────────────────────────────────────────────────────────────
const haversine = (lat1, lng1, lat2, lng2) => {
  const R = 6371e3, toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2-lat1), dLng = toRad(lng2-lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
};

const matchChain = (name, brand) => {
  const text = `${name} ${brand}`.toLowerCase();
  return STORE_CHAINS.find(c => c.tags.some(t => text.includes(t.toLowerCase()))) || null;
};

const fmtDuration = (s) => {
  if (!s || s < 60) return '<1\'';
  const m = Math.round(s/60);
  if (m < 60) return `${m} λεπτ${m===1?'ό':'ά'}`;
  return `${Math.floor(m/60)}ώρ${m%60>0?` ${m%60}'`:''}`;
};

const fmtDist = (m) => {
  if (!m) return '';
  return m < 1000 ? `${Math.round(m)}μ` : `${(m/1000).toFixed(1)}χλμ`;
};

// ─── OSRM maneuver → icon + Greek text ──────────────────────────────────────
const MANEUVER_MAP = {
  'turn-right':        { icon: IconArrowRight,           text: 'Στρίψε δεξιά' },
  'turn-left':         { icon: IconArrowLeft,            text: 'Στρίψε αριστερά' },
  'turn-slight-right': { icon: IconArrowBearRight,       text: 'Ελαφρά δεξιά' },
  'turn-slight-left':  { icon: IconArrowBearLeft,        text: 'Ελαφρά αριστερά' },
  'turn-sharp-right':  { icon: IconArrowRight,           text: 'Απότομη στροφή δεξιά' },
  'turn-sharp-left':   { icon: IconArrowLeft,            text: 'Απότομη στροφή αριστερά' },
  'straight':          { icon: IconArrowUpRight,         text: 'Συνέχισε ευθεία' },
  'depart':            { icon: IconNavigation,           text: 'Ξεκίνα' },
  'arrive':            { icon: IconFlag,                 text: 'Έφτασες' },
  'roundabout':        { icon: IconArrowRoundaboutRight, text: 'Μπες στον κυκλικό κόμβο' },
  'rotary':            { icon: IconArrowRoundaboutRight, text: 'Κυκλικός κόμβος' },
  'merge':             { icon: IconArrowUpRight,         text: 'Συγχωνεύσου' },
  'fork-right':        { icon: IconArrowBearRight,       text: 'Κράτα δεξιά στη διακλάδωση' },
  'fork-left':         { icon: IconArrowBearLeft,        text: 'Κράτα αριστερά στη διακλάδωση' },
  'end of road-right': { icon: IconArrowRight,           text: 'Στο τέλος στρίψε δεξιά' },
  'end of road-left':  { icon: IconArrowLeft,            text: 'Στο τέλος στρίψε αριστερά' },
  'continue':          { icon: IconArrowUpRight,         text: 'Συνέχισε' },
  'new name':          { icon: IconArrowUpRight,         text: 'Συνέχισε σε' },
};

const getManeuver = (step) => {
  const type = step.maneuver?.type || '';
  const modifier = step.maneuver?.modifier || '';
  const key = modifier ? `${type}-${modifier}` : type;
  const m = MANEUVER_MAP[key] || MANEUVER_MAP[type] || { icon: IconArrowUpRight, text: 'Συνέχισε' };
  const road = step.name || step.ref || '';
  return { ...m, road, distance: step.distance, duration: step.duration };
};

// ─── Parse all OSRM steps from legs ─────────────────────────────────────────
const parseSteps = (legs) => {
  if (!legs?.length) return [];
  const steps = [];
  legs.forEach((leg, legIdx) => {
    (leg.steps || []).forEach((step) => {
      if (step.distance < 5 && step.maneuver?.type === 'arrive' && legIdx < legs.length - 1) return; // skip intermediate arrives
      steps.push(getManeuver(step));
    });
  });
  return steps;
};

// ─── Open external navigation app ───────────────────────────────────────────
const openExternalNav = (userLoc, orderedStores, travelMode) => {
  // Build waypoints for Google Maps URL
  const waypoints = orderedStores.map(s => `${s.lat},${s.lng}`);
  const origin = `${userLoc.lat},${userLoc.lng}`;
  const destination = origin; // return home

  // Google Maps travel mode mapping
  const gmodeMap = { driving: 'driving', walking: 'walking', cycling: 'bicycling' };
  const gmode = gmodeMap[travelMode] || 'driving';

  // Try to detect platform
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  if (isIOS) {
    // Apple Maps with waypoints isn't great, use Google Maps URL which opens in browser/app
    const waypointStr = waypoints.join('|');
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypointStr}&travelmode=${gmode}`;
    window.open(url, '_blank');
  } else {
    // Google Maps intent (opens app if installed, otherwise web)
    const waypointStr = waypoints.join('|');
    const url = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&waypoints=${waypointStr}&travelmode=${gmode}`;
    window.open(url, '_blank');
  }
};

// ─── Custom icons ───────────────────────────────────────────────────────────
const storeIcon = (L, color) => L.divIcon({
  className: '',
  html: `<div style="width:30px;height:30px;border-radius:50% 50% 50% 4px;background:${color};border:3px solid #fff;box-shadow:0 3px 10px rgba(0,0,0,0.3);transform:rotate(-45deg);display:flex;align-items:center;justify-content:center"><div style="transform:rotate(45deg);font-size:13px">🏪</div></div>`,
  iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -32],
});

const userIcon = (L) => L.divIcon({
  className: '',
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#4285F4;border:3px solid #fff;box-shadow:0 0 0 4px rgba(66,133,244,0.25),0 2px 8px rgba(0,0,0,0.2)"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 9],
});

// ═══════════════════════════════════════════════════════════════════════════════
// FloatingMapButton
// ═══════════════════════════════════════════════════════════════════════════════
export function FloatingMapButton({ onClick, itemCount = 0 }) {
  return (
    <button onClick={onClick} className="smart-route-fab" title="Smart Route" aria-label="Smart Route">
      <IconMap2 size={22} stroke={2.2} />
      {itemCount > 0 && <span className="smart-route-fab-badge">{itemCount > 9 ? '9+' : itemCount}</span>}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SmartRouteMap
// ═══════════════════════════════════════════════════════════════════════════════
const SmartRouteMap = memo(function SmartRouteMap({ isOpen, onClose, items = [] }) {
  const [status, setStatus]       = useState('loading');
  const [userLoc, setUserLoc]     = useState(null);
  const [stores, setStores]       = useState([]);
  const [selected, setSelected]   = useState([]);
  const [route, setRoute]         = useState(null);
  const [mode, setMode]           = useState('driving');
  const [searching, setSearching] = useState(false);
  const [routing, setRouting]     = useState(false);
  const [panel, setPanel]         = useState(true);
  const [showNav, setShowNav]     = useState(false); // turn-by-turn view
  const [err, setErr]             = useState('');

  const containerRef  = useRef(null);
  const mapRef        = useRef(null);
  const markersRef    = useRef([]);
  const routeLayerRef = useRef(null);

  const countItems = useCallback((chain) => {
    if (!chain) return 0;
    return items.filter(i => {
      const s = (i.store||'').toLowerCase();
      return chain.tags.some(t => s.includes(t.toLowerCase()));
    }).length;
  }, [items]);

  // Lock scroll
  useEffect(() => {
    if (!isOpen) return;
    const y = window.scrollY;
    Object.assign(document.body.style, { overflow:'hidden', position:'fixed', top:`-${y}px`, width:'100%' });
    return () => {
      Object.assign(document.body.style, { overflow:'', position:'', top:'', width:'' });
      window.scrollTo(0, y);
    };
  }, [isOpen]);

  // Init
  useEffect(() => {
    if (!isOpen) return;
    let dead = false;

    (async () => {
      try {
        setStatus('loading'); setErr('');
        await loadLeaflet();
        if (dead) return;
        const L = window.L;

        const pos = await new Promise((ok, fail) =>
          navigator.geolocation.getCurrentPosition(
            p => ok({ lat: p.coords.latitude, lng: p.coords.longitude }),
            fail,
            { enableHighAccuracy: true, timeout: 12000 }
          )
        );
        if (dead) return;
        setUserLoc(pos);

        if (containerRef.current && !mapRef.current) {
          const map = L.map(containerRef.current, {
            center: [pos.lat, pos.lng], zoom: 14,
            zoomControl: false, attributionControl: false,
          });
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
          L.control.attribution({ position:'bottomright', prefix:false }).addAttribution('© <a href="https://openstreetmap.org">OSM</a>').addTo(map);
          L.control.zoom({ position:'topright' }).addTo(map);
          L.marker([pos.lat, pos.lng], { icon: userIcon(L), zIndexOffset: 1000 }).addTo(map).bindPopup('<b>📍 Η θέση σου</b>');
          mapRef.current = map;
          setTimeout(() => map.invalidateSize(), 200);
        }
        setStatus('ready');
        await doSearch(pos);
      } catch (e) {
        if (dead) return;
        setErr(e.code === 1 ? 'Ενεργοποίησε την τοποθεσία (GPS) στις ρυθμίσεις.' : e.code === 3 ? 'Timeout. Δοκίμασε ξανά.' : (e.message || 'Σφάλμα'));
        setStatus('error');
      }
    })();

    return () => {
      dead = true;
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
      markersRef.current = [];
      routeLayerRef.current = null;
      setStores([]); setSelected([]); setRoute(null);
    };
  }, [isOpen]);

  // Search
  const doSearch = async (pos) => {
    setSearching(true);
    try {
      const raw = await searchOverpass(pos.lat, pos.lng, 5000);
      const L = window.L, map = mapRef.current;
      markersRef.current.forEach(m => map?.removeLayer(m));
      markersRef.current = [];

      const enriched = raw.map(s => {
        const chain = matchChain(s.name, s.brand);
        return { ...s, chain, chainId: chain?.id||'other', chainName: chain?.name||s.name, chainColor: chain?.color||'#6b7280', chainEmoji: chain?.emoji||'⚪', distance: haversine(pos.lat, pos.lng, s.lat, s.lng), itemCount: countItems(chain) };
      }).sort((a,b) => a.distance - b.distance);

      setStores(enriched);

      if (map && L) {
        enriched.forEach(s => {
          const m = L.marker([s.lat, s.lng], { icon: storeIcon(L, s.chainColor) }).addTo(map);
          let popup = `<div style="font-family:-apple-system,sans-serif;min-width:190px;max-width:260px">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              <span style="font-size:16px">${s.chainEmoji}</span>
              <div><div style="font-weight:700;font-size:13px">${s.name}</div>${s.address?`<div style="font-size:11px;color:#666">${s.address}</div>`:''}</div>
            </div>
            <div style="font-size:11px;color:#555">📍 ${fmtDist(s.distance)}</div>`;
          if (s.itemCount > 0 && s.chain) {
            const si = items.filter(i => s.chain.tags.some(t => (i.store||'').toLowerCase().includes(t.toLowerCase())));
            popup += `<div style="border-top:1px solid #eee;margin-top:5px;padding-top:5px"><div style="font-size:11px;font-weight:600;margin-bottom:2px">🛒 ${si.length} προϊόντα:</div>`;
            si.slice(0,4).forEach(i => { popup += `<div style="font-size:11px;color:#555">• ${i.name}${i.price>0?` <b style="color:#10b981">€${i.price.toFixed(2)}</b>`:''}</div>`; });
            if (si.length>4) popup += `<div style="font-size:10px;color:#999">+${si.length-4} ακόμα</div>`;
            const tot = si.reduce((a,i) => a+(i.price>0?i.price:0), 0);
            if (tot>0) popup += `<div style="font-size:12px;font-weight:700;color:#10b981;margin-top:3px;border-top:1px solid #eee;padding-top:3px">Σύνολο: €${tot.toFixed(2)}</div>`;
            popup += '</div>';
          }
          popup += '</div>';
          m.bindPopup(popup);
          markersRef.current.push(m);
        });

        // Auto-select closest per chain that has items
        const auto = [], seen = new Set();
        enriched.forEach(s => { if (s.itemCount>0 && !seen.has(s.chainId)) { auto.push(s); seen.add(s.chainId); } });
        if (auto.length) setSelected(auto);
      }
    } catch (e) { console.error('Search error:', e); }
    setSearching(false);
  };

  // Route
  const calcRoute = useCallback(async () => {
    if (!mapRef.current || !userLoc || !selected.length) return;
    setRouting(true); setRoute(null);
    const L = window.L, map = mapRef.current;
    if (routeLayerRef.current) { map.removeLayer(routeLayerRef.current); routeLayerRef.current = null; }

    try {
      const pts = [userLoc, ...selected.map(s => ({lat:s.lat, lng:s.lng})), userLoc];
      const r = selected.length === 1 ? await getOSRMRoute(pts, mode) : await getOSRMTrip(pts, mode);
      const coords = r.geometry.coordinates.map(c => [c[1], c[0]]);
      const line = L.polyline(coords, { color:'#6366f1', weight:5, opacity:0.85, smoothFactor:1, lineCap:'round' }).addTo(map);
      routeLayerRef.current = line;
      map.fitBounds(line.getBounds(), { padding:[50,50] });

      let ordered = selected;
      if (r.waypoints && selected.length > 1) {
        const wp = r.waypoints.slice(1,-1).map(w => w.waypoint_index);
        if (wp.length === selected.length) {
          const idx = selected.map((s,i) => ({s, i:wp[i]}));
          idx.sort((a,b) => a.i - b.i);
          ordered = idx.map(x => x.s);
        }
      }
      setRoute({ distance: r.distance, duration: r.duration, orderedStores: ordered, steps: parseSteps(r.legs), legs: r.legs });
    } catch (e) { setErr('Δεν βρέθηκε διαδρομή.'); }
    setRouting(false);
  }, [userLoc, selected, mode]);

  const toggle = (s) => { setSelected(p => p.find(x=>x.id===s.id) ? p.filter(x=>x.id!==s.id) : [...p, s]); setRoute(null); setShowNav(false); };
  const recenter = () => { if (mapRef.current && userLoc) mapRef.current.setView([userLoc.lat, userLoc.lng], 14); };
  const refresh = () => { if (userLoc) { setRoute(null); setSelected([]); setShowNav(false); doSearch(userLoc); } };

  if (!isOpen) return null;

  return createPortal(
    <div className="smart-route-overlay">
      {/* Top bar */}
      <div className="smart-route-topbar">
        <div className="smart-route-topbar-left">
          <IconMap2 size={20} stroke={2} />
          <div>
            <div className="smart-route-title">Smart Route</div>
            <div className="smart-route-subtitle">
              {searching ? 'Αναζήτηση...' : stores.length > 0 ? `${stores.length} κοντινά σούπερ` : status === 'ready' ? 'Έτοιμο' : 'Φόρτωση...'}
            </div>
          </div>
        </div>
        <div className="smart-route-topbar-actions">
          <button className="smart-route-icon-btn" onClick={recenter} title="Η θέση μου"><IconCurrentLocation size={18}/></button>
          <button className="smart-route-icon-btn" onClick={refresh} title="Ανανέωση"><IconRefresh size={18}/></button>
          <button className="smart-route-close-btn" onClick={onClose}><IconX size={20}/></button>
        </div>
      </div>

      {/* Map */}
      <div className="smart-route-map-container">
        <div ref={containerRef} className="smart-route-map" />
        {status === 'loading' && (
          <div className="smart-route-loading">
            <div className="smart-route-spinner" />
            <div style={{ fontWeight:600 }}>Φόρτωση χάρτη...</div>
            <div style={{ fontSize:12, color:'var(--text-secondary,#888)' }}>OpenStreetMap · 100% Δωρεάν</div>
          </div>
        )}
        {status === 'error' && (
          <div className="smart-route-loading">
            <IconAlertTriangle size={40} color="#f59e0b" />
            <div style={{ fontWeight:700, marginTop:12, fontSize:16 }}>Σφάλμα</div>
            <div style={{ fontSize:13, color:'var(--text-secondary,#888)', textAlign:'center', maxWidth:280, lineHeight:1.6 }}>{err}</div>
            <button className="smart-route-retry-btn" onClick={() => { setStatus('loading'); setErr(''); }}>
              <IconRefresh size={16}/> Δοκίμασε ξανά
            </button>
          </div>
        )}
      </div>

      {/* Bottom panel */}
      <div className={`smart-route-panel ${panel ? 'expanded' : 'collapsed'}`}>
        <div className="smart-route-panel-handle" onClick={() => setPanel(!panel)}>
          <div className="smart-route-handle-bar" />
          <div className="smart-route-panel-header">
            <span style={{ display:'flex', alignItems:'center', gap:6 }}>
              <IconBuildingStore size={16}/>{selected.length > 0 ? ` ${selected.length} επιλεγμένα` : ' Κοντινά Σούπερ'}
            </span>
            {panel ? <IconChevronDown size={18}/> : <IconChevronUp size={18}/>}
          </div>
        </div>

        {panel && (
          <div className="smart-route-panel-content">
            <div className="smart-route-travel-modes">
              {[{ m:'driving', i:<IconCar size={15}/>, l:'Αυτοκίνητο' }, { m:'cycling', i:<IconBike size={15}/>, l:'Ποδήλατο' }, { m:'walking', i:<IconWalk size={15}/>, l:'Πόδια' }].map(({m,i,l}) => (
                <button key={m} className={`smart-route-travel-btn ${mode===m?'active':''}`} onClick={()=>{setMode(m);setRoute(null);setShowNav(false);}}>{i} {l}</button>
              ))}
            </div>

            {searching && <div className="smart-route-searching"><div className="smart-route-spinner small"/>Αναζήτηση κοντινών σούπερ...</div>}

            <div className="smart-route-store-list">
              {stores.map(s => {
                const sel = selected.some(x => x.id === s.id);
                return (
                  <div key={s.id} className={`smart-route-store-card ${sel?'selected':''}`} onClick={() => toggle(s)}>
                    <div className="smart-route-store-left">
                      <div className="smart-route-store-icon" style={{ background:s.chainColor+'18', borderColor:s.chainColor+'40' }}>
                        <span>{s.chainEmoji}</span>
                      </div>
                      <div className="smart-route-store-info">
                        <div className="smart-route-store-name">{s.name}</div>
                        <div className="smart-route-store-meta">
                          <span>📍 {fmtDist(s.distance)}</span>
                          {s.address && <span>{s.address}</span>}
                        </div>
                        {s.itemCount > 0 && <div className="smart-route-store-items"><IconShoppingCart size={12}/>{s.itemCount} προϊόντ{s.itemCount===1?'':'α'} στη λίστα</div>}
                      </div>
                    </div>
                    <div className={`smart-route-store-check ${sel?'checked':''}`}>{sel && <IconCheck size={14} color="#fff"/>}</div>
                  </div>
                );
              })}
              {!searching && !stores.length && status === 'ready' && (
                <div className="smart-route-empty"><IconBuildingStore size={32} color="var(--text-secondary,#888)"/><div>Δεν βρέθηκαν κοντινά σούπερ</div></div>
              )}
            </div>

            {selected.length > 0 && (
              <button className="smart-route-calc-btn" onClick={calcRoute} disabled={routing}>
                {routing ? <><IconLoader2 size={18} className="smart-route-spin-icon"/> Υπολογισμός...</> : <><IconRoute size={18}/> {route?'Επανυπολογισμός':'Υπολόγισε Διαδρομή'} ({selected.length} στάσεις)</>}
              </button>
            )}

            {route && (
              <div className="smart-route-result">
                <div className="smart-route-result-header">
                  <div className="smart-route-result-stat"><IconClock size={16}/><span>{fmtDuration(route.duration)}</span></div>
                  <div className="smart-route-result-stat"><IconMapPin size={16}/><span>{fmtDist(route.distance)}</span></div>
                </div>
                <div className="smart-route-result-stops">
                  <div className="smart-route-stop"><div className="smart-route-stop-dot start"/><div className="smart-route-stop-line"/><div className="smart-route-stop-text"><div className="smart-route-stop-name">📍 Η θέση σου</div></div></div>
                  {route.orderedStores.map((s,i) => (
                    <div key={s.id} className="smart-route-stop">
                      <div className="smart-route-stop-dot" style={{ background:s.chainColor }}/>
                      {i < route.orderedStores.length-1 && <div className="smart-route-stop-line"/>}
                      <div className="smart-route-stop-text">
                        <div className="smart-route-stop-name">{s.chainEmoji} {s.name}</div>
                        {s.itemCount > 0 && <div className="smart-route-stop-items">{s.itemCount} προϊόντα εδώ</div>}
                        <div className="smart-route-stop-time">📍 {fmtDist(s.distance)} από εσένα</div>
                      </div>
                    </div>
                  ))}
                  <div className="smart-route-stop"><div className="smart-route-stop-dot end"/><div className="smart-route-stop-text"><div className="smart-route-stop-name">🏠 Επιστροφή</div></div></div>
                </div>

                {/* ── Navigation buttons ── */}
                <div className="smart-route-nav-actions">
                  <button className="smart-route-nav-btn primary" onClick={() => openExternalNav(userLoc, route.orderedStores, mode)}>
                    <IconNavigation size={17}/> Πλοήγηση
                    <span className="smart-route-nav-btn-sub">Google Maps</span>
                  </button>
                  <button className="smart-route-nav-btn secondary" onClick={() => setShowNav(!showNav)}>
                    <IconRoute size={17}/> {showNav ? 'Κρύψε' : 'Οδηγίες'}
                  </button>
                </div>

                {/* ── Turn-by-turn directions ── */}
                {showNav && route.steps?.length > 0 && (
                  <div className="smart-route-directions">
                    <div className="smart-route-directions-title">
                      {mode === 'driving' ? '🚗' : mode === 'cycling' ? '🚲' : '🚶'} Βήμα-βήμα οδηγίες
                    </div>
                    {route.steps.map((step, i) => {
                      const StepIcon = step.icon;
                      return (
                        <div key={i} className="smart-route-direction-step">
                          <div className="smart-route-direction-icon">
                            <StepIcon size={16} />
                          </div>
                          <div className="smart-route-direction-text">
                            <div className="smart-route-direction-instruction">
                              {step.text}{step.road ? ` — ${step.road}` : ''}
                            </div>
                            {step.distance > 0 && (
                              <div className="smart-route-direction-meta">
                                {fmtDist(step.distance)} · {fmtDuration(step.duration)}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
});

export default SmartRouteMap;