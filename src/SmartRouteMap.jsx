// ─── SmartRouteMap.jsx — Fullscreen Smart Route for grocery shopping ──────────
import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { createPortal } from 'react-dom';
import {
  IconMap2, IconX, IconNavigation, IconBuildingStore,
  IconRoute, IconCurrentLocation, IconChevronDown,
  IconChevronUp, IconClock, IconWalk, IconCar,
  IconShoppingCart, IconRefresh, IconAlertTriangle,
  IconCheck, IconMapPin,
} from '@tabler/icons-react';

// ─── Config ──────────────────────────────────────────────────────────────────
const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_KEY || '';

// Greek supermarket chains we track
const STORE_CHAINS = [
  { id: 'ab',           name: 'ΑΒ Βασιλόπουλος', query: 'ΑΒ Βασιλόπουλος',   color: '#e31e24', icon: '🔴' },
  { id: 'sklavenitis',  name: 'Σκλαβενίτης',     query: 'Σκλαβενίτης',        color: '#1a5632', icon: '🟢' },
  { id: 'mymarket',     name: 'My Market',        query: 'My Market supermarket', color: '#f5a623', icon: '🟡' },
  { id: 'lidl',         name: 'Lidl',             query: 'Lidl',               color: '#0050aa', icon: '🔵' },
  { id: 'masoutis',     name: 'Μασούτης',         query: 'Μασούτης',           color: '#c41230', icon: '🟠' },
];

// ─── Load Google Maps script dynamically ─────────────────────────────────────
let mapsLoadPromise = null;
const loadGoogleMaps = () => {
  if (window.google?.maps) return Promise.resolve();
  if (mapsLoadPromise) return mapsLoadPromise;

  mapsLoadPromise = new Promise((resolve, reject) => {
    if (!GOOGLE_MAPS_KEY) {
      reject(new Error('NO_KEY'));
      return;
    }
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&libraries=places,geometry&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('LOAD_FAILED'));
    document.head.appendChild(script);
  });
  return mapsLoadPromise;
};

// ─── Helpers ────────────────────────────────────────────────────────────────
const matchStoreChain = (placeName) => {
  const n = placeName.toLowerCase();
  if (n.includes('βασιλοπουλ') || n.includes('ab ') || n.includes('α.β') || n.includes('a.b') || n.includes('αβ '))
    return 'ab';
  if (n.includes('σκλαβενιτ') || n.includes('sklavenitis'))
    return 'sklavenitis';
  if (n.includes('my market') || n.includes('mymarket'))
    return 'mymarket';
  if (n.includes('lidl'))
    return 'lidl';
  if (n.includes('μασουτ') || n.includes('masoutis'))
    return 'masoutis';
  return null;
};

const formatDuration = (seconds) => {
  if (seconds < 60) return '<1 λεπτό';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} λεπτ${mins === 1 ? 'ό' : 'ά'}`;
  const hrs = Math.floor(mins / 60);
  const rm = mins % 60;
  return `${hrs} ώρ${hrs === 1 ? 'α' : 'ες'}${rm > 0 ? ` ${rm}'` : ''}`;
};

const formatDistance = (meters) => {
  if (meters < 1000) return `${Math.round(meters)}μ`;
  return `${(meters / 1000).toFixed(1)}χλμ`;
};


// ═══════════════════════════════════════════════════════════════════════════════
// FloatingMapButton — always visible FAB
// ═══════════════════════════════════════════════════════════════════════════════
export function FloatingMapButton({ onClick, itemCount = 0 }) {
  return (
    <button
      onClick={onClick}
      className="smart-route-fab"
      title="Smart Route — Βρες κοντινά σούπερ"
      aria-label="Άνοιγμα Smart Route χάρτη"
    >
      <IconMap2 size={22} stroke={2.2} />
      {itemCount > 0 && (
        <span className="smart-route-fab-badge">{itemCount > 9 ? '9+' : itemCount}</span>
      )}
    </button>
  );
}


// ═══════════════════════════════════════════════════════════════════════════════
// SmartRouteMap — Fullscreen overlay component
// ═══════════════════════════════════════════════════════════════════════════════
const SmartRouteMap = memo(function SmartRouteMap({ isOpen, onClose, items = [] }) {
  // ── State ──────────────────────────────────────────────────────────────────
  const [mapStatus, setMapStatus]         = useState('loading'); // loading | ready | error | no_key
  const [userLocation, setUserLocation]   = useState(null);
  const [locationError, setLocationError] = useState(null);
  const [nearbyStores, setNearbyStores]   = useState([]);
  const [selectedStores, setSelectedStores] = useState([]); // stores to include in route
  const [routeInfo, setRouteInfo]         = useState(null);
  const [travelMode, setTravelMode]       = useState('DRIVING');
  const [isSearching, setIsSearching]     = useState(false);
  const [showStoreList, setShowStoreList] = useState(true);
  const [mapError, setMapError]           = useState('');

  // ── Refs ───────────────────────────────────────────────────────────────────
  const mapRef          = useRef(null);
  const mapInstanceRef  = useRef(null);
  const markersRef      = useRef([]);
  const directionsRendererRef = useRef(null);
  const placesServiceRef = useRef(null);
  const infoWindowRef   = useRef(null);

  // ── Group items by store ──────────────────────────────────────────────────
  const storeGroups = {};
  items.forEach(item => {
    const store = item.store || 'Άγνωστο';
    if (!storeGroups[store]) storeGroups[store] = [];
    storeGroups[store].push(item);
  });
  const storeNames = Object.keys(storeGroups).filter(s => s !== 'Άγνωστο');

  // ── Lock body scroll ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    const scrollY = window.scrollY;
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';
    return () => {
      document.body.style.overflow = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.width = '';
      window.scrollTo(0, scrollY);
    };
  }, [isOpen]);

  // ── Initialize map ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;

    const init = async () => {
      try {
        await loadGoogleMaps();
        if (cancelled) return;

        // Get user location
        const pos = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(
            (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
            (e) => reject(e),
            { enableHighAccuracy: true, timeout: 10000 }
          );
        });

        if (cancelled) return;
        setUserLocation(pos);

        // Create map
        if (mapRef.current && !mapInstanceRef.current) {
          const map = new window.google.maps.Map(mapRef.current, {
            center: pos,
            zoom: 14,
            disableDefaultUI: true,
            zoomControl: true,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: false,
            styles: getMapStyles(),
          });

          mapInstanceRef.current = map;
          placesServiceRef.current = new window.google.maps.places.PlacesService(map);
          infoWindowRef.current = new window.google.maps.InfoWindow();

          // User marker
          new window.google.maps.Marker({
            position: pos,
            map,
            icon: {
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 10,
              fillColor: '#4285F4',
              fillOpacity: 1,
              strokeColor: '#fff',
              strokeWeight: 3,
            },
            title: 'Η θέση σου',
            zIndex: 999,
          });

          setMapStatus('ready');
          searchNearbyStores(pos, map);
        }
      } catch (err) {
        if (cancelled) return;
        if (err.message === 'NO_KEY') {
          setMapStatus('no_key');
        } else if (err.code === 1) {
          setLocationError('Δεν επιτρέπεται η πρόσβαση στην τοποθεσία. Ενεργοποίησε το GPS.');
          setMapStatus('error');
        } else {
          setMapError(err.message || 'Σφάλμα φόρτωσης χάρτη');
          setMapStatus('error');
        }
      }
    };

    init();

    return () => {
      cancelled = true;
      // Cleanup markers
      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
      if (directionsRendererRef.current) {
        directionsRendererRef.current.setMap(null);
        directionsRendererRef.current = null;
      }
      mapInstanceRef.current = null;
    };
  }, [isOpen]);

  // ── Search nearby stores ──────────────────────────────────────────────────
  const searchNearbyStores = useCallback(async (location, map) => {
    if (!placesServiceRef.current) return;
    setIsSearching(true);

    const allStores = [];

    const searchChain = (chain) => {
      return new Promise((resolve) => {
        placesServiceRef.current.nearbySearch(
          {
            location,
            radius: 5000, // 5km radius
            keyword: chain.query,
            type: 'supermarket',
          },
          (results, status) => {
            if (status === window.google.maps.places.PlacesServiceStatus.OK && results) {
              const stores = results.slice(0, 3).map(place => ({
                placeId: place.place_id,
                name: place.name,
                chainId: chain.id,
                chainName: chain.name,
                chainColor: chain.color,
                chainIcon: chain.icon,
                address: place.vicinity,
                location: {
                  lat: place.geometry.location.lat(),
                  lng: place.geometry.location.lng(),
                },
                rating: place.rating,
                isOpen: place.opening_hours?.isOpen?.() ?? null,
                distance: window.google.maps.geometry.spherical.computeDistanceBetween(
                  new window.google.maps.LatLng(location.lat, location.lng),
                  place.geometry.location
                ),
                // Count items from this store chain
                itemCount: countItemsForChain(chain.id),
              }));
              resolve(stores);
            } else {
              resolve([]);
            }
          }
        );
      });
    };

    // Search all chains in parallel
    const results = await Promise.all(STORE_CHAINS.map(searchChain));
    const stores = results.flat().sort((a, b) => a.distance - b.distance);

    setNearbyStores(stores);
    setIsSearching(false);

    // Add markers
    markersRef.current.forEach(m => m.setMap(null));
    markersRef.current = [];

    stores.forEach(store => {
      const marker = new window.google.maps.Marker({
        position: store.location,
        map,
        title: store.name,
        icon: {
          path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z',
          fillColor: store.chainColor,
          fillOpacity: 1,
          strokeColor: '#fff',
          strokeWeight: 2,
          scale: 1.8,
          anchor: new window.google.maps.Point(12, 22),
        },
      });

      marker.addListener('click', () => {
        const content = buildInfoWindowContent(store);
        infoWindowRef.current.setContent(content);
        infoWindowRef.current.open(map, marker);
      });

      markersRef.current.push(marker);
    });

    // Auto-select stores that have items in list
    const autoSelect = stores.filter(s => s.itemCount > 0);
    if (autoSelect.length > 0) {
      // Pick closest of each chain
      const closest = {};
      autoSelect.forEach(s => {
        if (!closest[s.chainId] || s.distance < closest[s.chainId].distance) {
          closest[s.chainId] = s;
        }
      });
      setSelectedStores(Object.values(closest));
    }
  }, [items]);

  // ── Count items for a chain ───────────────────────────────────────────────
  const countItemsForChain = (chainId) => {
    const chainInfo = STORE_CHAINS.find(c => c.id === chainId);
    if (!chainInfo) return 0;
    return items.filter(item => {
      const s = (item.store || '').toLowerCase();
      return s.includes(chainInfo.name.toLowerCase()) ||
             s.includes(chainInfo.query.toLowerCase().split(' ')[0]);
    }).length;
  };

  // ── Build info window HTML ────────────────────────────────────────────────
  const buildInfoWindowContent = (store) => {
    const storeItems = items.filter(item => {
      const s = (item.store || '').toLowerCase();
      const chain = STORE_CHAINS.find(c => c.id === store.chainId);
      return chain && (s.includes(chain.name.toLowerCase()) || s.includes(chain.query.toLowerCase().split(' ')[0]));
    });

    let html = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,sans-serif;min-width:220px;max-width:300px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:20px">${store.chainIcon}</span>
          <div>
            <div style="font-weight:700;font-size:14px;color:#1a1a1a">${store.name}</div>
            <div style="font-size:11px;color:#666">${store.address}</div>
          </div>
        </div>
        <div style="display:flex;gap:12px;font-size:12px;color:#555;margin-bottom:8px">
          <span>📍 ${formatDistance(store.distance)}</span>
          ${store.rating ? `<span>⭐ ${store.rating}</span>` : ''}
          ${store.isOpen !== null ? `<span>${store.isOpen ? '🟢 Ανοιχτό' : '🔴 Κλειστό'}</span>` : ''}
        </div>`;

    if (storeItems.length > 0) {
      html += `<div style="border-top:1px solid #eee;padding-top:8px;margin-top:4px">
        <div style="font-size:11px;font-weight:600;color:#333;margin-bottom:4px">
          🛒 ${storeItems.length} προϊόντ${storeItems.length === 1 ? 'α' : 'α'} στη λίστα σου:
        </div>`;
      storeItems.slice(0, 5).forEach(item => {
        html += `<div style="font-size:11px;color:#555;padding:2px 0">
          • ${item.name} ${item.price > 0 ? `<b style="color:#10b981">€${item.price.toFixed(2)}</b>` : ''}
        </div>`;
      });
      if (storeItems.length > 5) {
        html += `<div style="font-size:10px;color:#999;margin-top:4px">+${storeItems.length - 5} ακόμα...</div>`;
      }
      const total = storeItems.reduce((s, i) => s + (i.price > 0 ? i.price : 0), 0);
      if (total > 0) {
        html += `<div style="font-size:12px;font-weight:700;color:#10b981;margin-top:6px;border-top:1px solid #eee;padding-top:6px">
          Σύνολο: €${total.toFixed(2)}
        </div>`;
      }
    } else {
      html += `<div style="font-size:11px;color:#999;margin-top:4px">Κανένα προϊόν στη λίστα σου από αυτό το κατάστημα</div>`;
    }

    html += '</div>';
    return html;
  };

  // ── Calculate route ───────────────────────────────────────────────────────
  const calculateRoute = useCallback(async () => {
    if (!mapInstanceRef.current || !userLocation || selectedStores.length === 0) return;

    // Clear old route
    if (directionsRendererRef.current) {
      directionsRendererRef.current.setMap(null);
    }

    const directionsService = new window.google.maps.DirectionsService();
    const directionsRenderer = new window.google.maps.DirectionsRenderer({
      map: mapInstanceRef.current,
      suppressMarkers: true,
      polylineOptions: {
        strokeColor: '#6366f1',
        strokeWeight: 5,
        strokeOpacity: 0.8,
      },
    });
    directionsRendererRef.current = directionsRenderer;

    const origin = userLocation;
    const destination = userLocation; // Return home

    // Waypoints = selected stores (optimized order)
    const waypoints = selectedStores.map(s => ({
      location: new window.google.maps.LatLng(s.location.lat, s.location.lng),
      stopover: true,
    }));

    try {
      const result = await new Promise((resolve, reject) => {
        directionsService.route(
          {
            origin,
            destination,
            waypoints,
            optimizeWaypoints: true, // Google optimizes the order!
            travelMode: window.google.maps.TravelMode[travelMode],
          },
          (result, status) => {
            if (status === 'OK') resolve(result);
            else reject(new Error(status));
          }
        );
      });

      directionsRenderer.setDirections(result);

      // Extract route info
      const route = result.routes[0];
      const legs = route.legs;
      const totalDistance = legs.reduce((s, l) => s + l.distance.value, 0);
      const totalDuration = legs.reduce((s, l) => s + l.duration.value, 0);

      // Reorder stores based on optimization
      const order = route.waypoint_order;
      const orderedStores = order.map(i => selectedStores[i]);

      setRouteInfo({
        totalDistance,
        totalDuration,
        legs,
        orderedStores,
        optimizedOrder: order,
      });

      // Fit map to route
      const bounds = new window.google.maps.LatLngBounds();
      legs.forEach(leg => {
        bounds.extend(leg.start_location);
        bounds.extend(leg.end_location);
      });
      mapInstanceRef.current.fitBounds(bounds, 60);

    } catch (err) {
      setMapError(`Δεν βρέθηκε διαδρομή: ${err.message}`);
    }
  }, [userLocation, selectedStores, travelMode]);

  // ── Toggle store selection ────────────────────────────────────────────────
  const toggleStore = (store) => {
    setSelectedStores(prev => {
      const exists = prev.find(s => s.placeId === store.placeId);
      if (exists) return prev.filter(s => s.placeId !== store.placeId);
      return [...prev, store];
    });
    setRouteInfo(null); // Clear old route
  };

  // ── Recenter map ──────────────────────────────────────────────────────────
  const recenterMap = () => {
    if (mapInstanceRef.current && userLocation) {
      mapInstanceRef.current.panTo(userLocation);
      mapInstanceRef.current.setZoom(14);
    }
  };

  // ── Refresh search ────────────────────────────────────────────────────────
  const refreshSearch = () => {
    if (userLocation && mapInstanceRef.current) {
      searchNearbyStores(userLocation, mapInstanceRef.current);
      setRouteInfo(null);
    }
  };

  // ── Don't render if not open ──────────────────────────────────────────────
  if (!isOpen) return null;

  return createPortal(
    <div className="smart-route-overlay">
      {/* ── Top bar ─────────────────────────────────────────────────────────── */}
      <div className="smart-route-topbar">
        <div className="smart-route-topbar-left">
          <IconMap2 size={20} stroke={2} />
          <div>
            <div className="smart-route-title">Smart Route</div>
            <div className="smart-route-subtitle">
              {nearbyStores.length > 0
                ? `${nearbyStores.length} κοντινά σούπερ`
                : 'Αναζήτηση...'}
            </div>
          </div>
        </div>
        <div className="smart-route-topbar-actions">
          <button className="smart-route-icon-btn" onClick={recenterMap} title="Η θέση μου">
            <IconCurrentLocation size={18} />
          </button>
          <button className="smart-route-icon-btn" onClick={refreshSearch} title="Ανανέωση">
            <IconRefresh size={18} />
          </button>
          <button className="smart-route-close-btn" onClick={onClose}>
            <IconX size={20} />
          </button>
        </div>
      </div>

      {/* ── Map container ───────────────────────────────────────────────────── */}
      <div className="smart-route-map-container">
        <div ref={mapRef} className="smart-route-map" />

        {/* Loading state */}
        {mapStatus === 'loading' && (
          <div className="smart-route-loading">
            <div className="smart-route-spinner" />
            <div>Φόρτωση χάρτη...</div>
          </div>
        )}

        {/* No API key */}
        {mapStatus === 'no_key' && (
          <div className="smart-route-loading">
            <IconAlertTriangle size={40} color="#f59e0b" />
            <div style={{ fontWeight: 700, marginTop: 12 }}>Google Maps API Key Required</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 280, lineHeight: 1.5 }}>
              Πρόσθεσε το key στο αρχείο <code>.env</code> ως<br />
              <code>VITE_GOOGLE_MAPS_KEY=your-key</code>
            </div>
          </div>
        )}

        {/* Error state */}
        {mapStatus === 'error' && (
          <div className="smart-route-loading">
            <IconAlertTriangle size={40} color="#ef4444" />
            <div style={{ fontWeight: 700, marginTop: 12 }}>Σφάλμα</div>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)', textAlign: 'center', maxWidth: 280 }}>
              {locationError || mapError || 'Δεν ήταν δυνατή η φόρτωση του χάρτη.'}
            </div>
            <button className="smart-route-retry-btn" onClick={() => { setMapStatus('loading'); setMapError(''); setLocationError(null); }}>
              Δοκίμασε ξανά
            </button>
          </div>
        )}
      </div>

      {/* ── Bottom panel (store list + route) ───────────────────────────────── */}
      <div className={`smart-route-panel ${showStoreList ? 'expanded' : 'collapsed'}`}>
        {/* Drag handle */}
        <div className="smart-route-panel-handle" onClick={() => setShowStoreList(!showStoreList)}>
          <div className="smart-route-handle-bar" />
          <div className="smart-route-panel-header">
            <span>
              <IconBuildingStore size={16} />
              {selectedStores.length > 0
                ? ` ${selectedStores.length} επιλεγμένα`
                : ' Κοντινά Σούπερ'}
            </span>
            {showStoreList
              ? <IconChevronDown size={18} />
              : <IconChevronUp size={18} />}
          </div>
        </div>

        {showStoreList && (
          <div className="smart-route-panel-content">
            {/* Travel mode toggle */}
            <div className="smart-route-travel-modes">
              {[
                { mode: 'DRIVING', icon: <IconCar size={15} />, label: 'Αυτοκίνητο' },
                { mode: 'WALKING', icon: <IconWalk size={15} />, label: 'Περπάτημα' },
              ].map(({ mode, icon, label }) => (
                <button
                  key={mode}
                  className={`smart-route-travel-btn ${travelMode === mode ? 'active' : ''}`}
                  onClick={() => { setTravelMode(mode); setRouteInfo(null); }}
                >
                  {icon} {label}
                </button>
              ))}
            </div>

            {/* Searching indicator */}
            {isSearching && (
              <div className="smart-route-searching">
                <div className="smart-route-spinner small" />
                Αναζήτηση κοντινών σούπερ...
              </div>
            )}

            {/* Store list */}
            <div className="smart-route-store-list">
              {nearbyStores.map(store => {
                const isSelected = selectedStores.some(s => s.placeId === store.placeId);
                return (
                  <div
                    key={store.placeId}
                    className={`smart-route-store-card ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleStore(store)}
                  >
                    <div className="smart-route-store-left">
                      <div
                        className="smart-route-store-icon"
                        style={{ background: store.chainColor + '18', borderColor: store.chainColor + '40' }}
                      >
                        <span>{store.chainIcon}</span>
                      </div>
                      <div className="smart-route-store-info">
                        <div className="smart-route-store-name">{store.name}</div>
                        <div className="smart-route-store-meta">
                          <span>📍 {formatDistance(store.distance)}</span>
                          {store.rating && <span>⭐ {store.rating}</span>}
                          {store.isOpen !== null && (
                            <span className={store.isOpen ? 'open' : 'closed'}>
                              {store.isOpen ? 'Ανοιχτό' : 'Κλειστό'}
                            </span>
                          )}
                        </div>
                        {store.itemCount > 0 && (
                          <div className="smart-route-store-items">
                            <IconShoppingCart size={12} />
                            {store.itemCount} προϊόντ{store.itemCount === 1 ? '' : 'α'} στη λίστα
                          </div>
                        )}
                      </div>
                    </div>
                    <div className={`smart-route-store-check ${isSelected ? 'checked' : ''}`}>
                      {isSelected && <IconCheck size={14} color="#fff" />}
                    </div>
                  </div>
                );
              })}

              {!isSearching && nearbyStores.length === 0 && mapStatus === 'ready' && (
                <div className="smart-route-empty">
                  <IconBuildingStore size={32} color="var(--text-secondary)" />
                  <div>Δεν βρέθηκαν κοντινά σούπερ</div>
                </div>
              )}
            </div>

            {/* Route button */}
            {selectedStores.length > 0 && (
              <button className="smart-route-calc-btn" onClick={calculateRoute}>
                <IconRoute size={18} />
                {routeInfo ? 'Επανυπολογισμός' : 'Υπολόγισε Διαδρομή'}
                {selectedStores.length > 0 && ` (${selectedStores.length} στάσεις)`}
              </button>
            )}

            {/* Route result */}
            {routeInfo && (
              <div className="smart-route-result">
                <div className="smart-route-result-header">
                  <div className="smart-route-result-stat">
                    <IconClock size={16} />
                    <span>{formatDuration(routeInfo.totalDuration)}</span>
                  </div>
                  <div className="smart-route-result-stat">
                    <IconMapPin size={16} />
                    <span>{formatDistance(routeInfo.totalDistance)}</span>
                  </div>
                </div>

                <div className="smart-route-result-stops">
                  {/* Start */}
                  <div className="smart-route-stop">
                    <div className="smart-route-stop-dot start" />
                    <div className="smart-route-stop-line" />
                    <div className="smart-route-stop-text">
                      <div className="smart-route-stop-name">📍 Η θέση σου</div>
                      <div className="smart-route-stop-time">
                        {routeInfo.legs[0] && `→ ${formatDistance(routeInfo.legs[0].distance.value)} · ${formatDuration(routeInfo.legs[0].duration.value)}`}
                      </div>
                    </div>
                  </div>

                  {/* Waypoints */}
                  {routeInfo.orderedStores.map((store, i) => (
                    <div key={store.placeId} className="smart-route-stop">
                      <div className="smart-route-stop-dot" style={{ background: store.chainColor }} />
                      {i < routeInfo.orderedStores.length - 1 && <div className="smart-route-stop-line" />}
                      <div className="smart-route-stop-text">
                        <div className="smart-route-stop-name">
                          {store.chainIcon} {store.name}
                        </div>
                        {store.itemCount > 0 && (
                          <div className="smart-route-stop-items">
                            {store.itemCount} προϊόντα για αγορά
                          </div>
                        )}
                        {routeInfo.legs[i + 1] && (
                          <div className="smart-route-stop-time">
                            → {formatDistance(routeInfo.legs[i + 1].distance.value)} · {formatDuration(routeInfo.legs[i + 1].duration.value)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* End */}
                  <div className="smart-route-stop">
                    <div className="smart-route-stop-dot end" />
                    <div className="smart-route-stop-text">
                      <div className="smart-route-stop-name">🏠 Επιστροφή</div>
                    </div>
                  </div>
                </div>
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


// ─── Map Styles (dark/clean aesthetic) ──────────────────────────────────────
function getMapStyles() {
  return [
    { elementType: 'geometry', stylers: [{ color: '#f5f5f5' }] },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#f5f5f5' }] },
    { featureType: 'administrative.land_parcel', elementType: 'labels.text.fill', stylers: [{ color: '#bdbdbd' }] },
    { featureType: 'poi', elementType: 'geometry', stylers: [{ color: '#eeeeee' }] },
    { featureType: 'poi', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#e5e5e5' }] },
    { featureType: 'poi.park', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    { featureType: 'road.arterial', elementType: 'labels.text.fill', stylers: [{ color: '#757575' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#dadada' }] },
    { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#616161' }] },
    { featureType: 'road.local', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
    { featureType: 'transit.line', elementType: 'geometry', stylers: [{ color: '#e5e5e5' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9c9c9' }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#9e9e9e' }] },
  ];
}