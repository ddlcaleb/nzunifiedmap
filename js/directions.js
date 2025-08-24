// directions.js
// Vanilla JS autocomplete + routing integration for the existing Leaflet map.
(function(){
  // Configuration
  const OSRM_URL = 'https://router.project-osrm.org/route/v1/driving/'; // public demo
  const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search?format=json&limit=5&q=';

  // Elements
  const startInput = document.getElementById('start');
  const endInput = document.getElementById('end');
  const startSug = document.getElementById('start-suggestions');
  const endSug = document.getElementById('end-suggestions');
  const goBtn = document.getElementById('goBtn');
  const swapBtn = document.getElementById('swapBtn');
  const routesList = document.getElementById('routesList');
  const routesMessage = document.getElementById('routesMessage');

  // State
  let startCoord = null;
  let endCoord = null;
  let routePolylines = []; // {id, polyline, summary}
  let selectedRouteId = null;

  // Utility: debounce
  function debounce(fn, wait=300){ let t; return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), wait); }; }

  // Helper: fetch suggestions from Nominatim (free)
  async function fetchPlaces(q){
    if(!q) return [];
    try{
      // First, gather local disruptions matching the query (high priority)
      const disruptions = (window.__disruptions || []).filter(d=> d.name && d.name.toLowerCase().includes(q.toLowerCase()));
      const disp = disruptions.map(d=>({ name: d.name + ' (disruption)', lat: d.lat, lon: d.lon, source: d.source, __disruption: d }));

      // Then fallback to Nominatim for regular places
      const res = await fetch(NOMINATIM_URL + encodeURIComponent(q) + '&countrycodes=nz');
      let nom = [];
      if(res.ok){
        const data = await res.json();
        nom = data.map(d=>({ name: d.display_name, lat: parseFloat(d.lat), lon: parseFloat(d.lon) }));
      }

      // Merge, with disruptions first and remove duplicates (by lat/lon)
      const merged = [...disp, ...nom];
      const seen = new Set();
      const uniq = [];
      for(const it of merged){
        const key = `${it.lat.toFixed(5)},${it.lon.toFixed(5)}`;
        if(seen.has(key)) continue; seen.add(key); uniq.push(it);
      }
      return uniq.slice(0,6);
    }catch(e){ console.warn('Place lookup failed', e); return []; }
  }

  function renderSuggestions(listEl, items, onPick){
    listEl.innerHTML='';
    if(!items || items.length===0){ listEl.style.display='none'; return; }
    items.forEach((it, idx)=>{
      const li = document.createElement('li');
      li.tabIndex = 0;
      li.textContent = it.name;
      if(it.__disruption) li.style.fontWeight = '700';
      li.addEventListener('click', ()=> onPick(it));
      li.addEventListener('keydown', (e)=>{ if(e.key==='Enter') onPick(it); });
      listEl.appendChild(li);
    });
    listEl.style.display='block';
  }

  // Input handlers
  const onStartInput = debounce(async ()=>{
    const q = startInput.value.trim();
    if(q.length<2){ renderSuggestions(startSug, []); return; }
    const items = await fetchPlaces(q + ' Nelson New Zealand');
    renderSuggestions(startSug, items, (it)=>{
      startInput.value = it.name; startCoord = [it.lat, it.lon]; renderSuggestions(startSug, []);
    });
  }, 300);

  const onEndInput = debounce(async ()=>{
    const q = endInput.value.trim();
    if(q.length<2){ renderSuggestions(endSug, []); return; }
    const items = await fetchPlaces(q + ' Nelson New Zealand');
    renderSuggestions(endSug, items, (it)=>{
      endInput.value = it.name; endCoord = [it.lat, it.lon]; renderSuggestions(endSug, []);
    });
  }, 300);

  startInput.addEventListener('input', ()=>{ startCoord = null; onStartInput(); });
  endInput.addEventListener('input', ()=>{ endCoord = null; onEndInput(); });

  // Show suggestions immediately when focusing an input that already has text
  startInput.addEventListener('focus', async ()=>{
    const q = startInput.value.trim();
    if(q.length<2) return;
    const items = await fetchPlaces(q + ' Nelson New Zealand');
    renderSuggestions(startSug, items, (it)=>{ startInput.value = it.name; startCoord = [it.lat, it.lon]; renderSuggestions(startSug, []); });
  });
  endInput.addEventListener('focus', async ()=>{
    const q = endInput.value.trim();
    if(q.length<2) return;
    const items = await fetchPlaces(q + ' Nelson New Zealand');
    renderSuggestions(endSug, items, (it)=>{ endInput.value = it.name; endCoord = [it.lat, it.lon]; renderSuggestions(endSug, []); });
  });

  // Click outside to hide suggestions
  document.addEventListener('click', (e)=>{
    if(!e.target.closest('.field')){
      startSug.style.display='none';
      endSug.style.display='none';
    }
  });

  // Swap start/end
  swapBtn.addEventListener('click', ()=>{
    const s = startInput.value; const sc = startCoord;
    startInput.value = endInput.value; startCoord = endCoord;
    endInput.value = s; endCoord = sc;
  });

  // Routing: call OSRM and return up to 3 alternatives
  async function fetchRoutes(a, b){
    // OSRM supports alternative=true for alternative routes
    const coords = `${a[1]},${a[0]};${b[1]},${b[0]}`; // lon,lat
    const url = OSRM_URL + coords + '?geometries=geojson&overview=full&alternatives=true&steps=false';
    const res = await fetch(url);
    if(!res.ok) throw new Error('Routing failed');
    const data = await res.json();
    if(!data.routes) return [];
    return data.routes.slice(0,3).map((r,i)=>({
      id: 'route-' + i,
      geometry: r.geometry,
      distance: r.distance,
      duration: r.duration,
      summary: r.summary || `Route ${String.fromCharCode(65+i)}`
    }));
  }

  // --- Geometry helpers to detect conflicts with disruptions ---
  function toRad(v){ return v * Math.PI / 180; }
  // Haversine distance in meters
  function haversine([lat1,lon1],[lat2,lon2]){
    const R = 6371000;
    const dLat = toRad(lat2-lat1); const dLon = toRad(lon2-lon1);
    const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon/2)**2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  // Distance from point p to segment v-w in meters (p, v, w are [lat, lon])
  function pointToSegmentDistance(p, v, w){
    // convert lat/lon to cartesian approx using equirectangular projection around p
    const lat = p[0];
    const kx = Math.cos(toRad(lat));
    const ax = v[1]*kx, ay = v[0];
    const bx = w[1]*kx, by = w[0];
    const px = p[1]*kx, py = p[0];
    const dx = bx - ax, dy = by - ay;
    if(dx === 0 && dy === 0) return haversine(p, v);
    const t = ((px - ax) * dx + (py - ay) * dy) / (dx*dx + dy*dy);
    if(t < 0) return haversine(p, v);
    if(t > 1) return haversine(p, w);
    const proj = [ ay + t*dy, ax + t*dx ]; // proj lat, lon*kx
    // convert back to lat/lon for haversine: lon = x/kx
    return haversine(p, [proj[0], proj[1]/kx]);
  }

  // Check if a route geometry (geojson LineString) intersects/near any disruption
  function routeConflictsWithDisruptions(routeGeojson, disruptions, thresholdMeters=50){
    // routeGeojson.coordinates are [lon,lat]
    const coords = routeGeojson.coordinates.map(c=>[c[1], c[0]]); // [lat,lon]
    for(const d of disruptions){
      try{
        const geom = d.geometry || (d.lat && d.lon ? { type: 'Point', coordinates: [d.lon, d.lat] } : null);
        if(!geom) continue;
        if(geom.type === 'Point'){
          const p = [geom.coordinates[1], geom.coordinates[0]];
          // if any route point is within threshold
          for(const rc of coords){ if(haversine(rc, p) <= thresholdMeters) return true; }
        } else if(geom.type === 'LineString'){
          // check segments vs route segments
          const dcoords = geom.coordinates.map(c=>[c[1], c[0]]);
          for(let i=0;i<coords.length-1;i++){
            const rA = coords[i], rB = coords[i+1];
            for(let j=0;j<dcoords.length-1;j++){
              const dA = dcoords[j], dB = dcoords[j+1];
              // check distance between segment pairs using checking vertices and point-segment distances
              if(pointToSegmentDistance(rA, dA, dB) <= thresholdMeters) return true;
              if(pointToSegmentDistance(rB, dA, dB) <= thresholdMeters) return true;
              if(pointToSegmentDistance(dA, rA, rB) <= thresholdMeters) return true;
              if(pointToSegmentDistance(dB, rA, rB) <= thresholdMeters) return true;
            }
          }
        } else if(geom.type === 'Polygon'){
          // flatten polygon rings to segments
          const ring = geom.coordinates[0].map(c=>[c[1], c[0]]);
          for(let i=0;i<coords.length-1;i++){
            const rA = coords[i], rB = coords[i+1];
            for(let j=0;j<ring.length-1;j++){
              const pA = ring[j], pB = ring[j+1];
              if(pointToSegmentDistance(rA, pA, pB) <= thresholdMeters) return true;
              if(pointToSegmentDistance(rB, pA, pB) <= thresholdMeters) return true;
            }
          }
        }
      }catch(e){ console.warn('Error checking disruption geometry', e); }
    }
    return false;
  }

  function clearRoutes(){
    routePolylines.forEach(r=>{ map.removeLayer(r.polyline); });
    routePolylines = [];
    routesList.innerHTML='';
    selectedRouteId = null;
  }

  function formatTime(sec){
    if(sec < 60) return Math.round(sec) + ' s';
    const mins = Math.round(sec/60);
    if(mins < 60) return mins + ' min';
    const hrs = Math.floor(mins/60); const rm = mins % 60;
    return `${hrs}h ${rm}m`;
  }

  function renderRoutesOnMap(routes){
    clearRoutes();
    routes.forEach((rt, idx)=>{
      const coords = rt.geometry.coordinates.map(c=>[c[1], c[0]]);
      const poly = L.polyline(coords, { color: idx===0? '#0072b5' : '#2b7fb2', weight: 5 - Math.min(3, idx), opacity: idx===0? 0.9 : 0.6 }).addTo(map);
      routePolylines.push({ id: rt.id, polyline: poly, summary: rt });
      poly.on('click', ()=> selectRoute(rt.id));
    });
    // Fit map to first route if any
    if(routePolylines.length) map.fitBounds(routePolylines[0].polyline.getBounds(), { padding: [40,40] });
  }

  function populateRouteList(routes){
    routesList.innerHTML='';
    routes.forEach((rt, i)=>{
      const li = document.createElement('li');
      li.id = rt.id;
      li.tabIndex = 0;
      const title = document.createElement('div'); title.textContent = `Route ${String.fromCharCode(65+i)} - ${rt.summary || ''}`;
      const dur = document.createElement('div'); dur.className='duration'; dur.textContent = formatTime(rt.duration);
      li.appendChild(title); li.appendChild(dur);
      li.addEventListener('click', ()=> selectRoute(rt.id));
      li.addEventListener('keydown', (e)=>{ if(e.key==='Enter') selectRoute(rt.id); });
      routesList.appendChild(li);
    });
  }

  function selectRoute(id){
    selectedRouteId = id;
    // style list
    Array.from(routesList.children).forEach(li=> li.classList.toggle('selected', li.id===id));
    // style polylines
    routePolylines.forEach(r=>{
      if(r.id === id){ r.polyline.setStyle({ color: '#385af1ff', weight: 7, opacity: 0.95 }); r.polyline.bringToFront(); }
      else r.polyline.setStyle({ color: '#6aaed6', weight: 4, opacity: 0.4 });
    });
    // Announce
    const sel = routePolylines.find(r=> r.id===id);
    if(sel){ routesMessage.textContent = `Selected ${id} — ${formatTime(sel.summary.duration)} (${Math.round(sel.summary.distance/1000)} km)`; }
  }

  // Main Go handler
  goBtn.addEventListener('click', async ()=>{
    routesMessage.textContent = '';
    // If coords not set, try geocoding from text
    try{
      if(!startCoord){
        const res = await fetchPlaces(startInput.value + ' Nelson New Zealand');
        if(res.length) startCoord = [res[0].lat, res[0].lon];
      }
      if(!endCoord){
        const res = await fetchPlaces(endInput.value + ' Nelson New Zealand');
        if(res.length) endCoord = [res[0].lat, res[0].lon];
      }

      if(!startCoord || !endCoord){ routesMessage.textContent = 'Unable to resolve start or destination — try a different name.'; return; }

      routesMessage.textContent = 'Calculating routes...';
      let routes = await fetchRoutes(startCoord, endCoord);
      if(!routes.length){ routesMessage.textContent = 'No routes found.'; return; }
      // Filter routes that conflict with known disruptions
      const disruptions = window.__disruptions || [];
      const clearRoutes = routes.filter(r=> !routeConflictsWithDisruptions(r.geometry, disruptions, 40));
      if(clearRoutes.length === 0){
        routesMessage.textContent = 'No clear routes found that avoid known disruptions.';
        // still show original routes but greyed so user can inspect
        renderRoutesOnMap(routes);
        populateRouteList(routes);
        return;
      }
      renderRoutesOnMap(clearRoutes);
      populateRouteList(clearRoutes);
      routesMessage.textContent = `Found ${clearRoutes.length} safe route(s). Click a route to highlight.`;
    }catch(err){ console.error(err); routesMessage.textContent = 'Routing failed — check console for details.'; }
  });

  // Keyboard: Enter on inputs triggers Go
  [startInput, endInput].forEach(inp=> inp.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); goBtn.click(); } }));

  // Expose for debugging
  window.__nzfd = { clearRoutes, selectRoute };

})();
