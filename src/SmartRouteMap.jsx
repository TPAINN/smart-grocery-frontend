// ─── SmartRouteMap.jsx — v2: Draggable FAB + Animations + Faster Routing ─────
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

// ─── Chains ──────────────────────────────────────────────────────────────────
const CHAINS = [
  { id:'ab', name:'ΑΒ Βασιλόπουλος', tags:['ΑΒ Βασιλόπουλος','AB Vassilopoulos','AB Food Market'], color:'#e31e24', emoji:'🔴' },
  { id:'sklavenitis', name:'Σκλαβενίτης', tags:['Σκλαβενίτης','Sklavenitis'], color:'#1a5632', emoji:'🟢' },
  { id:'mymarket', name:'My Market', tags:['My Market'], color:'#f5a623', emoji:'🟡' },
  { id:'lidl', name:'Lidl', tags:['Lidl'], color:'#0050aa', emoji:'🔵' },
  { id:'masoutis', name:'Μασούτης', tags:['Μασούτης','Masoutis'], color:'#c41230', emoji:'🟠' },
  { id:'galaxias', name:'Γαλαξίας', tags:['Γαλαξίας','Galaxias'], color:'#6b21a8', emoji:'🟣' },
];

// ─── Leaflet loader ──────────────────────────────────────────────────────────
let _ll = false;
const loadLeaflet = () => {
  if (_ll && window.L) return Promise.resolve();
  return new Promise((ok, fail) => {
    if (!document.getElementById('lf-css')) {
      const l = document.createElement('link'); l.id='lf-css'; l.rel='stylesheet';
      l.href='https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'; l.crossOrigin=''; document.head.appendChild(l);
    }
    if (window.L) { _ll=true; ok(); return; }
    const s = document.createElement('script'); s.src='https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.crossOrigin=''; s.onload=()=>{_ll=true;ok()}; s.onerror=()=>fail(new Error('Leaflet failed'));
    document.head.appendChild(s);
  });
};

// ─── APIs ────────────────────────────────────────────────────────────────────
let _overpassCache = null;
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];
const searchOverpass = async (lat, lng, r=5000) => {
  const k = `${lat.toFixed(3)},${lng.toFixed(3)},${r}`;
  if (_overpassCache?.k === k && Date.now() - _overpassCache.t < 180000) return _overpassCache.d;
  const q = `[out:json][timeout:15];(node["shop"="supermarket"](around:${r},${lat},${lng});way["shop"="supermarket"](around:${r},${lat},${lng}););out center body;`;
  let lastErr;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const resp = await fetch(`${endpoint}?data=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(14000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json();
      const d = data.elements.map(e => ({
        id:e.id, name:e.tags?.name||'Σούπερ Μάρκετ', brand:e.tags?.brand||e.tags?.operator||'',
        lat:e.lat||e.center?.lat, lng:e.lon||e.center?.lon,
        address:[e.tags?.['addr:street'],e.tags?.['addr:housenumber']].filter(Boolean).join(' ')||'',
      })).filter(s => s.lat && s.lng);
      _overpassCache = { k, d, t:Date.now() };
      return d;
    } catch (err) { lastErr = err; }
  }
  throw lastErr || new Error('Overpass unavailable');
};

const osrmRoute = async (coords, p='driving') => {
  const s = coords.map(c=>`${c.lng},${c.lat}`).join(';');
  const r = await fetch(`https://router.project-osrm.org/route/v1/${p}/${s}?overview=full&geometries=geojson&steps=true`);
  const d = await r.json(); if (d.code!=='Ok'||!d.routes?.length) throw new Error('No route'); return d.routes[0];
};
const osrmTrip = async (coords, p='driving') => {
  const s = coords.map(c=>`${c.lng},${c.lat}`).join(';');
  const r = await fetch(`https://router.project-osrm.org/trip/v1/${p}/${s}?overview=full&geometries=geojson&roundtrip=true&source=first&destination=last`);
  const d = await r.json(); if (d.code!=='Ok'||!d.trips?.length) throw new Error('No trip'); return d.trips[0];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
const hav = (a,b,c,d) => { const R=6371e3,r=x=>x*Math.PI/180,dL=r(c-a),dN=r(d-b),x=Math.sin(dL/2)**2+Math.cos(r(a))*Math.cos(r(c))*Math.sin(dN/2)**2; return R*2*Math.atan2(Math.sqrt(x),Math.sqrt(1-x)); };
const matchChain = (n,b) => { const t=`${n} ${b}`.toLowerCase(); return CHAINS.find(c=>c.tags.some(x=>t.includes(x.toLowerCase())))||null; };
const fmtD = s => { if(!s||s<60)return'<1\''; const m=Math.round(s/60); return m<60?`${m}'`:`${Math.floor(m/60)}h ${m%60}'`; };
const fmtM = m => { if(!m)return''; return m<1000?`${Math.round(m)}μ`:`${(m/1000).toFixed(1)}χλμ`; };

// Maneuvers
const MAN = {
  'turn-right':{i:IconArrowRight,t:'Στρίψε δεξιά'},'turn-left':{i:IconArrowLeft,t:'Στρίψε αριστερά'},
  'turn-slight-right':{i:IconArrowBearRight,t:'Ελαφρά δεξιά'},'turn-slight-left':{i:IconArrowBearLeft,t:'Ελαφρά αριστερά'},
  'straight':{i:IconArrowUpRight,t:'Ευθεία'},'depart':{i:IconNavigation,t:'Ξεκίνα'},'arrive':{i:IconFlag,t:'Έφτασες'},
  'roundabout':{i:IconArrowRoundaboutRight,t:'Κυκλικός κόμβος'},'continue':{i:IconArrowUpRight,t:'Συνέχισε'},
  'fork-right':{i:IconArrowBearRight,t:'Κράτα δεξιά'},'fork-left':{i:IconArrowBearLeft,t:'Κράτα αριστερά'},
};
const getMan = s => { const k=s.maneuver?.modifier?`${s.maneuver.type}-${s.maneuver.modifier}`:s.maneuver?.type||''; const m=MAN[k]||MAN[s.maneuver?.type]||{i:IconArrowUpRight,t:'Συνέχισε'}; return{...m,road:s.name||'',distance:s.distance,duration:s.duration}; };
const parseSteps = legs => {
  if (!legs?.length) return [];
  const r = [];
  legs.forEach((leg, li) => {
    (leg.steps || []).forEach((s, si) => {
      // Skip intermediate arrive steps (not the final destination)
      if (s.maneuver?.type === 'arrive' && li < legs.length - 1) return;
      // Skip very short steps < 10m that are not depart/arrive
      if (s.distance < 10 && s.maneuver?.type !== 'depart' && s.maneuver?.type !== 'arrive') return;
      r.push(getMan(s));
    });
  });
  return r;
};

const openNav = (loc, stores, mode) => {
  const gm = {driving:'driving',walking:'walking',cycling:'bicycling'}[mode]||'driving';
  if (stores.length === 1) {
    // Single store — simple A→B
    const s = stores[0];
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${loc.lat},${loc.lng}&destination=${s.lat},${s.lng}&travelmode=${gm}`,'_blank');
  } else {
    // Multiple stores — origin → waypoints → last store as destination
    const dest = stores[stores.length - 1];
    const wp = stores.slice(0, -1).map(s=>`${s.lat},${s.lng}`).join('|');
    window.open(`https://www.google.com/maps/dir/?api=1&origin=${loc.lat},${loc.lng}&destination=${dest.lat},${dest.lng}&waypoints=${wp}&travelmode=${gm}`,'_blank');
  }
};

// Icons
const mkStore = (L,c) => L.divIcon({className:'',html:`<div style="width:28px;height:28px;border-radius:50% 50% 50% 4px;background:${c};border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);transform:rotate(-45deg);display:flex;align-items:center;justify-content:center"><div style="transform:rotate(45deg);font-size:12px">🏪</div></div>`,iconSize:[28,28],iconAnchor:[14,28],popupAnchor:[0,-30]});
const mkUser = L => L.divIcon({className:'',html:`<div style="width:16px;height:16px;border-radius:50%;background:#4285F4;border:3px solid #fff;box-shadow:0 0 0 4px rgba(66,133,244,.25),0 2px 6px rgba(0,0,0,.2)"></div>`,iconSize:[16,16],iconAnchor:[8,8]});

// ─── FAB position persistence ────────────────────────────────────────────────
const FAB_KEY = 'sg_fab_pos';
const saveFabPos = (x,y) => {
  try {
    localStorage.setItem(FAB_KEY, JSON.stringify({ x, y }));
  } catch {
    // Ignore storage failures (private mode/quota).
  }
};
const loadFabPos = () => {
  try {
    const v = JSON.parse(localStorage.getItem(FAB_KEY));
    if (v?.x != null) return v;
  } catch {
    // Ignore invalid persisted data.
  }
  return null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// FloatingMapButton — DRAGGABLE + animated
// ═══════════════════════════════════════════════════════════════════════════════
export function FloatingMapButton({ onClick, itemCount = 0 }) {
  const [pos, setPos] = useState(() => loadFabPos() || { x: null, y: null });
  const [dragging, setDragging] = useState(false);
  const [ripple, setRipple] = useState(false);
  const dragRef = useRef({ startX:0, startY:0, startPosX:0, startPosY:0, moved:false });
  const btnRef = useRef(null);

  // Default position (bottom-right)
  const style = pos.x != null ? {
    position:'fixed', left:pos.x, top:pos.y, right:'auto', bottom:'auto', zIndex:900,
  } : {
    position:'fixed', bottom:90, right:16, zIndex:900,
  };

  const handleStart = (clientX, clientY) => {
    const rect = btnRef.current?.getBoundingClientRect();
    if (!rect) return;
    dragRef.current = { startX:clientX, startY:clientY, startPosX:rect.left, startPosY:rect.top, moved:false };
    setDragging(true);
  };

  const handleMove = (clientX, clientY) => {
    if (!dragging) return;
    const d = dragRef.current;
    const dx = clientX - d.startX;
    const dy = clientY - d.startY;
    if (Math.abs(dx) > 5 || Math.abs(dy) > 5) d.moved = true;
    if (!d.moved) return;
    const nx = Math.max(0, Math.min(window.innerWidth - 52, d.startPosX + dx));
    const ny = Math.max(0, Math.min(window.innerHeight - 52, d.startPosY + dy));
    setPos({ x: nx, y: ny });
  };

  const handleEnd = () => {
    if (!dragging) return;
    setDragging(false);
    if (dragRef.current.moved) {
      saveFabPos(pos.x, pos.y);
    } else {
      // Tap — trigger ripple + open
      setRipple(true);
      setTimeout(() => { setRipple(false); onClick?.(); }, 350);
    }
  };

  useEffect(() => {
    if (!dragging) return;
    const mm = e => handleMove(e.clientX, e.clientY);
    const mu = () => handleEnd();
    window.addEventListener('mousemove', mm);
    window.addEventListener('mouseup', mu);
    return () => { window.removeEventListener('mousemove', mm); window.removeEventListener('mouseup', mu); };
  });

  return (
    <button
      ref={btnRef}
      className={`smart-route-fab ${ripple ? 'ripple' : ''} ${dragging ? 'dragging' : ''}`}
      style={style}
      onTouchStart={e => { e.stopPropagation(); handleStart(e.touches[0].clientX, e.touches[0].clientY); }}
      onTouchMove={e => { e.stopPropagation(); handleMove(e.touches[0].clientX, e.touches[0].clientY); }}
      onTouchEnd={e => { e.stopPropagation(); handleEnd(); }}
      onMouseDown={e => { e.preventDefault(); handleStart(e.clientX, e.clientY); }}
      aria-label="Smart Route"
    >
      <span className="smart-route-fab-inner">
        <IconMap2 size={22} stroke={2.2} />
        {ripple && <span className="fab-ripple" />}
      </span>
      {itemCount > 0 && <span className="smart-route-fab-badge">{itemCount > 9 ? '9+' : itemCount}</span>}
    </button>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// SmartRouteMap
// ═══════════════════════════════════════════════════════════════════════════════
const SmartRouteMap = memo(function SmartRouteMap({ isOpen, onClose, items = [] }) {
  const [status, setStatus] = useState('loading');
  const [userLoc, setUserLoc] = useState(null);
  const [stores, setStores] = useState([]);
  const [selected, setSelected] = useState([]);
  const [route, setRoute] = useState(null);
  const [mode, setMode] = useState('driving');
  const [searching, setSearching] = useState(false);
  const [routing, setRouting] = useState(false);
  const [panel, setPanel] = useState(true);
  const [showNav, setShowNav] = useState(false);
  const [err, setErr] = useState('');

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef([]);
  const routeLayerRef = useRef(null);

  const countItems = useCallback(chain => {
    if (!chain) return 0;
    return items.filter(i => { const s=(i.store||'').toLowerCase(); return chain.tags.some(t=>s.includes(t.toLowerCase())); }).length;
  }, [items]);

  // Lock scroll
  useEffect(() => {
    if (!isOpen) return;
    const y = window.scrollY;
    Object.assign(document.body.style, { overflow:'hidden', position:'fixed', top:`-${y}px`, width:'100%' });
    return () => { Object.assign(document.body.style, { overflow:'', position:'', top:'', width:'' }); window.scrollTo(0,y); };
  }, [isOpen]);

  const doSearch = useCallback(async (pos, attempt = 1) => {
    setSearching(true);
    setErr('');
    try {
      const raw = await searchOverpass(pos.lat, pos.lng, 5000);
      const L = window.L, map = mapRef.current;
      markersRef.current.forEach(m => map?.removeLayer(m)); markersRef.current = [];

      if (!raw.length && attempt < 3) {
        // Widen radius and retry
        const raw2 = await searchOverpass(pos.lat, pos.lng, 10000);
        raw.push(...raw2);
      }

      const enriched = raw.map(s => {
        const chain = matchChain(s.name, s.brand);
        return { ...s, chain, chainId:chain?.id||'other', chainName:chain?.name||s.name, chainColor:chain?.color||'#6b7280', chainEmoji:chain?.emoji||'⚪', distance:hav(pos.lat,pos.lng,s.lat,s.lng), itemCount:countItems(chain) };
      }).sort((a,b) => a.distance-b.distance);

      setStores(enriched);

      if (map && L) {
        enriched.forEach(s => {
          const m = L.marker([s.lat,s.lng],{icon:mkStore(L,s.chainColor)}).addTo(map);
          let p = `<div style="font-family:-apple-system,sans-serif;min-width:180px;max-width:250px"><div style="display:flex;align-items:center;gap:6px;margin-bottom:4px"><span style="font-size:16px">${s.chainEmoji}</span><div><div style="font-weight:700;font-size:13px">${s.name}</div>${s.address?`<div style="font-size:11px;color:#666">${s.address}</div>`:''}</div></div><div style="font-size:11px;color:#555">📍 ${fmtM(s.distance)}</div>`;
          if (s.itemCount > 0 && s.chain) {
            const si = items.filter(i=>s.chain.tags.some(t=>(i.store||'').toLowerCase().includes(t.toLowerCase())));
            p += `<div style="border-top:1px solid #eee;margin-top:5px;padding-top:5px"><div style="font-size:11px;font-weight:600;margin-bottom:2px">🛒 ${si.length} προϊόντα:</div>`;
            si.slice(0,3).forEach(i=>{p+=`<div style="font-size:11px;color:#555">• ${i.name||i.text}${i.price>0?` <b style="color:#10b981">€${i.price.toFixed(2)}</b>`:''}</div>`});
            if(si.length>3) p+=`<div style="font-size:10px;color:#999">+${si.length-3}</div>`;
            const tot=si.reduce((a,i)=>a+(i.price>0?i.price:0),0);
            if(tot>0) p+=`<div style="font-size:12px;font-weight:700;color:#10b981;margin-top:3px;border-top:1px solid #eee;padding-top:3px">€${tot.toFixed(2)}</div>`;
            p+='</div>';
          }
          p+='</div>';
          m.bindPopup(p); markersRef.current.push(m);
        });
        const auto=[], seen=new Set();
        enriched.forEach(s=>{if(s.itemCount>0&&!seen.has(s.chainId)){auto.push(s);seen.add(s.chainId)}});
        if(auto.length) setSelected(auto);
        // Fit map to show all markers
        if (enriched.length > 0) {
          const bounds = L.latLngBounds([[pos.lat,pos.lng],...enriched.map(s=>[s.lat,s.lng])]);
          map.fitBounds(bounds, { padding:[50,50], maxZoom:14 });
        }
      }

      if (!enriched.length) setErr('Δεν βρέθηκαν σούπερ μάρκετ κοντά. Δοκίμασε "Ανανέωση".');
    } catch (error) {
      console.error('Search error:', error);
      if (attempt < 2) {
        // Auto-retry once on failure
        setTimeout(() => doSearch(pos, attempt + 1), 1500);
        return;
      }
      setErr('Σφάλμα αναζήτησης. Πάτα Ανανέωση.');
    }
    setSearching(false);
  }, [countItems, items]);

  // Init
  useEffect(() => {
    if (!isOpen) return;
    let dead = false;
    (async () => {
      try {
        setStatus('loading'); setErr('');
        await loadLeaflet();
        if (dead) return;
        const pos = await new Promise((ok,fail) => navigator.geolocation.getCurrentPosition(
          p=>ok({lat:p.coords.latitude,lng:p.coords.longitude}),
          fail,
          {enableHighAccuracy:true,timeout:10000,maximumAge:60000}
        ));
        if (dead) return;
        setUserLoc(pos);
        if (containerRef.current && !mapRef.current) {
          const L = window.L;
          const map = L.map(containerRef.current, { center:[pos.lat,pos.lng], zoom:14, zoomControl:false, attributionControl:false });
          L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,crossOrigin:true,className:'srm-tiles'}).addTo(map);
          L.control.attribution({position:'bottomright',prefix:false}).addAttribution('© <a href="https://openstreetmap.org">OSM</a>').addTo(map);
          L.control.zoom({position:'topright'}).addTo(map);
          L.marker([pos.lat,pos.lng],{icon:mkUser(L),zIndexOffset:1000}).addTo(map).bindPopup('<b>📍 Εδώ είσαι</b>');
          mapRef.current = map;
          setTimeout(() => map.invalidateSize(), 150);
        }
        setStatus('ready');
        await doSearch(pos);
      } catch (e) {
        if (dead) return;
        setErr(e.code===1?'Ενεργοποίησε GPS στις ρυθμίσεις.':e.code===3?'Timeout. Δοκίμασε ξανά.':(e.message||'Σφάλμα'));
        setStatus('error');
      }
    })();
    return () => { dead=true; if(mapRef.current){mapRef.current.remove();mapRef.current=null} markersRef.current=[]; routeLayerRef.current=null; setStores([]); setSelected([]); setRoute(null); };
  }, [isOpen, doSearch]);

  const calcRoute = useCallback(async () => {
    if (!mapRef.current||!userLoc||!selected.length) return;
    setRouting(true); setRoute(null); setErr('');
    const L=window.L, map=mapRef.current;
    // Remove any existing route layers
    if(routeLayerRef.current){
      if (Array.isArray(routeLayerRef.current)) routeLayerRef.current.forEach(l=>map.removeLayer(l));
      else map.removeLayer(routeLayerRef.current);
      routeLayerRef.current=null;
    }
    try {
      const pts=[userLoc,...selected.map(s=>({lat:s.lat,lng:s.lng}))];
      if (selected.length > 1) pts.push(userLoc); // roundtrip only for multi-stop
      const r = selected.length===1 ? await osrmRoute(pts,mode) : await osrmTrip(pts,mode);
      const coords=r.geometry.coordinates.map(c=>[c[1],c[0]]);

      // Single animated polyline
      const line = L.polyline([],{color:'#6366f1',weight:5,opacity:.9,smoothFactor:0,lineCap:'round'}).addTo(map);
      routeLayerRef.current = line;

      // Animate drawing
      const step=Math.max(1,Math.floor(coords.length/60));
      let idx=0;
      const draw=()=>{
        if(idx>=coords.length){
          map.fitBounds(line.getBounds(),{padding:[60,60],maxZoom:14});
          return;
        }
        line.addLatLng(coords[Math.min(idx,coords.length-1)]);
        idx+=step;
        requestAnimationFrame(draw);
      };
      draw();

      // Resolve ordered stops from trip waypoints
      let ordered = selected;
      if (r.waypoints && selected.length > 1) {
        const wpIndexes = r.waypoints.slice(1, selected.length + 1).map(w => w.waypoint_index);
        if (wpIndexes.length === selected.length) {
          const indexed = selected.map((s, i) => ({ s, wi: wpIndexes[i] }));
          indexed.sort((a, b) => a.wi - b.wi);
          ordered = indexed.map(x => x.s);
        }
      }

      setRoute({ distance:r.distance, duration:r.duration, orderedStores:ordered, steps:parseSteps(r.legs) });
    } catch (e) {
      console.error('Route error:', e);
      setErr('Δεν βρέθηκε διαδρομή. Δοκίμασε άλλο τρόπο μεταφοράς.');
    }
    setRouting(false);
  },[userLoc,selected,mode]);

  const toggle=s=>{setSelected(p=>p.find(x=>x.id===s.id)?p.filter(x=>x.id!==s.id):[...p,s]);setRoute(null);setShowNav(false)};
  const recenter=()=>{if(mapRef.current&&userLoc)mapRef.current.setView([userLoc.lat,userLoc.lng],14)};
  const refresh=()=>{if(userLoc){setRoute(null);setSelected([]);setShowNav(false);doSearch(userLoc)}};

  if (!isOpen) return null;

  return createPortal(
    <div className="smart-route-overlay">
      <div className="smart-route-topbar">
        <div className="smart-route-topbar-left">
          <IconMap2 size={20} stroke={2}/>
          <div>
            <div className="smart-route-title">Smart Route</div>
            <div className="smart-route-subtitle">
              {searching?'Αναζήτηση...':stores.length>0?`${stores.length} κοντινά σούπερ`:status==='ready'?'Έτοιμο':'Φόρτωση...'}
            </div>
          </div>
        </div>
        <div className="smart-route-topbar-actions">
          <button className="smart-route-icon-btn" onClick={recenter} title="Θέση μου"><IconCurrentLocation size={18}/></button>
          <button className="smart-route-icon-btn" onClick={refresh} title="Ανανέωση"><IconRefresh size={18}/></button>
          <button className="smart-route-close-btn" onClick={onClose}><IconX size={20}/></button>
        </div>
      </div>

      <div className="smart-route-map-container">
        <div ref={containerRef} className="smart-route-map"/>
        {status==='loading'&&<div className="smart-route-loading"><div className="smart-route-spinner"/><div style={{fontWeight:600}}>Φόρτωση χάρτη...</div></div>}
        {status==='error'&&<div className="smart-route-loading"><IconAlertTriangle size={40} color="#f59e0b"/><div style={{fontWeight:700,marginTop:12}}>{err}</div><button className="smart-route-retry-btn" onClick={()=>{setStatus('loading');setErr('')}}><IconRefresh size={16}/>Ξαναδοκίμασε</button></div>}
      </div>

      <div className={`smart-route-panel ${panel?'expanded':'collapsed'}`}>
        <div className="smart-route-panel-handle" onClick={()=>setPanel(!panel)}>
          <div className="smart-route-handle-bar"/>
          <div className="smart-route-panel-header">
            <span style={{display:'flex',alignItems:'center',gap:6}}><IconBuildingStore size={16}/>{selected.length>0?` ${selected.length} επιλεγμένα`:' Κοντινά Σούπερ'}</span>
            {panel?<IconChevronDown size={18}/>:<IconChevronUp size={18}/>}
          </div>
        </div>
        {panel&&<div className="smart-route-panel-content">
          <div className="smart-route-travel-modes">
            {[{m:'driving',i:<IconCar size={15}/>,l:'Αυτοκίνητο'},{m:'cycling',i:<IconBike size={15}/>,l:'Ποδήλατο'},{m:'walking',i:<IconWalk size={15}/>,l:'Πόδια'}].map(({m,i,l})=>(
              <button key={m} className={`smart-route-travel-btn ${mode===m?'active':''}`} onClick={()=>{setMode(m);setRoute(null);setShowNav(false)}}>{i} {l}</button>
            ))}
          </div>
          {searching&&<div className="smart-route-searching"><div className="smart-route-spinner small"/>Αναζήτηση...</div>}
          {!searching&&stores.length>0&&<button
            className="smart-route-select-all"
            onClick={()=>{
              if(selected.length===stores.length){setSelected([]);setRoute(null);setShowNav(false)}
              else{setSelected([...stores]);setRoute(null);setShowNav(false)}
            }}
          >
            {selected.length===stores.length?'✕ Αποεπιλογή Όλων':'✓ Επιλογή Όλων'} ({stores.length})
          </button>}
          <div className="smart-route-store-list">
            {stores.map(s=>{const sel=selected.some(x=>x.id===s.id);return(
              <div key={s.id} className={`smart-route-store-card ${sel?'selected':''}`} onClick={()=>toggle(s)}>
                <div className="smart-route-store-left">
                  <div className="smart-route-store-icon" style={{background:s.chainColor+'18',borderColor:s.chainColor+'40'}}><span>{s.chainEmoji}</span></div>
                  <div className="smart-route-store-info">
                    <div className="smart-route-store-name">{s.name}</div>
                    <div className="smart-route-store-meta"><span>📍 {fmtM(s.distance)}</span>{s.address&&<span>{s.address}</span>}</div>
                    {s.itemCount>0&&<div className="smart-route-store-items"><IconShoppingCart size={12}/>{s.itemCount} προϊόντα</div>}
                  </div>
                </div>
                <div className={`smart-route-store-check ${sel?'checked':''}`}>{sel&&<IconCheck size={14} color="#fff"/>}</div>
              </div>
            )})}
            {!searching&&!stores.length&&status==='ready'&&<div className="smart-route-empty"><IconBuildingStore size={32} color="#888"/><div>Δεν βρέθηκαν σούπερ κοντά</div></div>}
          </div>
          {selected.length>0&&<button className="smart-route-calc-btn" onClick={calcRoute} disabled={routing}>
            {routing?<><IconLoader2 size={18} className="smart-route-spin-icon"/>Υπολογισμός...</>:<><IconRoute size={18}/>{route?'Επανυπολογισμός':'Υπολόγισε Διαδρομή'} ({selected.length})</>}
          </button>}
          {route&&<div className="smart-route-result">
            <div className="smart-route-result-header">
              <div className="smart-route-result-stat"><IconClock size={16}/><span>{fmtD(route.duration)}</span></div>
              <div className="smart-route-result-stat"><IconMapPin size={16}/><span>{fmtM(route.distance)}</span></div>
            </div>
            <div className="smart-route-result-stops">
              <div className="smart-route-stop"><div className="smart-route-stop-dot start"/><div className="smart-route-stop-line"/><div className="smart-route-stop-text"><div className="smart-route-stop-name">📍 Εδώ είσαι</div></div></div>
              {route.orderedStores.map((s,i)=><div key={s.id} className="smart-route-stop"><div className="smart-route-stop-dot" style={{background:s.chainColor}}/>{i<route.orderedStores.length-1&&<div className="smart-route-stop-line"/>}<div className="smart-route-stop-text"><div className="smart-route-stop-name">{s.chainEmoji} {s.name}</div>{s.itemCount>0&&<div className="smart-route-stop-items">{s.itemCount} προϊόντα</div>}<div className="smart-route-stop-time">{fmtM(s.distance)}</div></div></div>)}
              <div className="smart-route-stop"><div className="smart-route-stop-dot end"/><div className="smart-route-stop-text"><div className="smart-route-stop-name">🏠 Επιστροφή</div></div></div>
            </div>
            <div className="smart-route-nav-actions">
              <button className="smart-route-nav-btn primary" onClick={()=>openNav(userLoc,route.orderedStores,mode)}><IconNavigation size={17}/>Πλοήγηση<span className="smart-route-nav-btn-sub">Google Maps</span></button>
              <button className="smart-route-nav-btn secondary" onClick={()=>setShowNav(!showNav)}><IconRoute size={17}/>{showNav?'Κρύψε':'Οδηγίες'}</button>
            </div>
            {showNav&&route.steps?.length>0&&<div className="smart-route-directions">
              <div className="smart-route-directions-title">{mode==='driving'?'🚗':mode==='cycling'?'🚲':'🚶'} Οδηγίες</div>
              {route.steps.map((s,i)=>{const I=s.i;return<div key={i} className="smart-route-direction-step"><div className="smart-route-direction-icon"><I size={16}/></div><div className="smart-route-direction-text"><div className="smart-route-direction-instruction">{s.t}{s.road?` — ${s.road}`:''}</div>{s.distance>0&&<div className="smart-route-direction-meta">{fmtM(s.distance)} · {fmtD(s.duration)}</div>}</div></div>})}
            </div>}
          </div>}
        </div>}
      </div>
    </div>,document.body);
});

export default SmartRouteMap;