// Configuration
const REFRESH_INTERVAL = 2 * 60 * 1000; // 5 minutes
let nztaDataTimestamp = 0;
let councilDataTimestamp = 0;

// 1. Setup map and layers
const map = L.map('map').setView([-41.2706, 173.2840], 7);
const nztaLayer = L.layerGroup().addTo(map);
const councilLayer = L.layerGroup().addTo(map);
// Global disruptions registry used by the route planner suggestions
window.__disruptions = window.__disruptions || [];

// 2. Add tile layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
}).addTo(map);

// 3. Automatic refresh system
function initAutoRefresh() {
  // Initial data load
  fetchNZTAData();
  fetchCouncilData();
  
  // Set up periodic refresh
  setInterval(() => {
    fetchNZTAData();
    fetchCouncilData();
  }, REFRESH_INTERVAL);
  
  // Add manual refresh button

  // const refreshBtn = L.easyButton('fa-refresh', () => {
  //   fetchNZTAData();
  //   fetchCouncilData();
  // }).addTo(map);
  // refreshBtn.setPosition('topright');
const refreshBtn = L.easyButton({
  states: [{
    stateName: 'refresh-data',
    icon: '<span style="font-size: 18px; background: transparent; border: none;">&#x21bb;</span>', // 🔄 Unicode refresh symbol
    title: 'Refresh Map Data',
    onClick: function(btn, map) {
      fetchNZTAData();
      fetchCouncilData();
    }
  }]
}).addTo(map);

refreshBtn.setPosition('topright');


}

// 4. Data fetching functions
async function fetchNZTAData() {
  try {
    const response = await fetch(`https://corsproxy.io/?https://www.journeys.nzta.govt.nz/assets/map-data-cache/delays.json?t=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const data = await response.json();
    if (data.lastUpdated <= nztaDataTimestamp) return; // Skip if no updates
    
    nztaDataTimestamp = data.lastUpdated;
    document.getElementById("nzta-updated").textContent = formatDateTime(nztaDataTimestamp * 1000);
    processNZTAData(data);
  } catch (error) {
    console.error("Failed to load NZTA data:", error);
    showDataError("nzta");
  }
}

async function fetchCouncilData() {
  try {
    const response = await fetch(
      `https://corsproxy.io/?https://apps.ramm.com/GIS/?key=cc6661bdb9e5&SERVICE=WFS&VERSION=1.0.0&REQUEST=GetFeature&TYPENAME=cc6661bdb9e5:wfs_road_closures_combined_nztm&SRSNAME=EPSG:4326&outputFormat=json&t=${Date.now()}`
    );
    
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    
    const data = await response.json();
   
const councilServerTime = new Date(data.timeStamp);
if (councilServerTime <= councilDataTimestamp) return;
councilDataTimestamp = councilServerTime;


const rammUpdatedEl = document.getElementById("ramm-updated");
if (data.timeStamp && rammUpdatedEl) {
  const councilServerTime = new Date(data.timeStamp);
  rammUpdatedEl.textContent = formatDateTime(councilServerTime);
  councilDataTimestamp = councilServerTime;
} else {
  rammUpdatedEl.textContent = "⚠️ No timestamp in data";
}

    
    // document.getElementById("council-updated").textContent = formatDateTime(Date.now());
    processCouncilData(data);
  } catch (error) {
    console.error("Failed to load Council data:", error);
    showDataError("council");
  }
}

// 5. Data processing functions
function processNZTAData(data) {
  // Clear previous data
  nztaLayer.clearLayers();
  // reset disruptions
  window.__disruptions = [];
  
  const features = data.features || data;
  features.forEach(item => {
    // ... (your existing NZTA processing logic) ...
    // Add processed markers to nztaLayer
    const props = item.properties || item;

      // 🔽 Determine the icon type
      const rawType = props.EventType?.toLowerCase() || "default";
      const typeMap = {
        "road closure": "Road Closure",
        "road hazard": "Road Hazard",
        "area warning": "Area Warning",
        "road work": "Road Work",
        "scheduled road work": "Road Work"
      };
      const iconType = typeMap[rawType] || "Default";
      const icon = nztaIcons[iconType];

      let lat = null;
      let lng = null;

      // 🔹 Priority 1: Use `.location`
      if (item.location && typeof item.location === 'object') {
        lat = item.location.lat;
        lng = item.location.lng;
      }

      // 🔹 Priority 2: Use geometry Point
      else if (item.geometry?.type === "Point" && Array.isArray(item.geometry.coordinates)) {
        [lng, lat] = item.geometry.coordinates;
      }

      // 🔹 Priority 3: Use midpoint of LineString
      else if (item.geometry?.type === "LineString" && Array.isArray(item.geometry.coordinates)) {
        const coords = item.geometry.coordinates;
        const midpoint = coords[Math.floor(coords.length / 2)];
        if (Array.isArray(midpoint)) {
          [lng, lat] = midpoint;
        }
      }

      // 🔹 Priority 4: Use midpoint of MultiLineString
      else if (item.geometry?.type === "MultiLineString" && Array.isArray(item.geometry.coordinates)) {
        const flattened = item.geometry.coordinates.flat();
        const midpoint = flattened[Math.floor(flattened.length / 2)];
        if (Array.isArray(midpoint)) {
          [lng, lat] = midpoint;
        }
      }

      // 🔹 Priority 5: Use centroid of first Polygon ring
      else if (item.geometry?.type === "Polygon" && Array.isArray(item.geometry.coordinates)) {
        const ring = item.geometry.coordinates[0];
        const midpoint = ring[Math.floor(ring.length / 2)];
        if (Array.isArray(midpoint)) {
          [lng, lat] = midpoint;
        }
      }

      // ✅ If we now have valid coordinates, add the marker
      if (typeof lat === "number" && typeof lng === "number") {
        const marker = L.marker([lat, lng], { icon }).addTo(nztaLayer);
        // NZTA-specific popup: display dynamic content and a consolidated "Details" field
        function first(...keys){ for(const k of keys){ if(props[k] !== undefined && props[k] !== null && String(props[k]).toString().trim()!=='') return props[k]; } return ''; }
        function formatMaybeDate(v){ try{ const d = new Date(v); if(!isNaN(d)) return d.toLocaleString('en-NZ',{ dateStyle:'medium', timeStyle:'short', hour12:false, timeZone:'Pacific/Auckland' }); }catch(e){} return v || ''; }

        // Build a consolidated details string from possible description-like fields
        const detailsParts = [];
        const detailKeys = ['EventDescription','Description','Details','Other','Message','Notes','LongDescription'];
        for(const k of detailKeys){ const v = props[k]; if(v && String(v).trim()) detailsParts.push(String(v).trim()); }
        const consolidatedDetails = detailsParts.join('\n\n');

        const typeLabel = first('EventType','Type','Category') || '';
        const locationLabel = first('Name','LocationArea','Location','Road','Title') || 'Unknown location';
        const detour = first('Detour','DetourRoute','AlternateRoute') || 'Not Applicable';
        const startVal = formatMaybeDate(first('StartDate','Start','FromDate','StartTime'));
        const endVal = formatMaybeDate(first('EndDate','End','ToDate','EndTime'));
        const expected = first('ExpectedResolution','Resolution','ExpectedEnd','Expected') || 'Until further notice';
        const lastUpdatedVal = formatMaybeDate(first('LastUpdatedNice','LastEdited','LastUpdated','Updated')) || formatDateTime(nztaDataTimestamp * 1000);

        // render details with preserved paragraphs
        let detailsHtml = '';
        if(consolidatedDetails){
          const escaped = escapeHtml(consolidatedDetails);
          detailsHtml = escaped.replace(/\r\n|\r|\n\n/g, '<br><br>').replace(/\n/g, '<br>');
          detailsHtml = `<div style="margin:0 0 12px; color:#222; line-height:1.35;">${detailsHtml}</div>`;
        }

        // build small table for metadata
        const meta = {
          'Detour route': detour,
          'Start': startVal,
          'End': endVal,
          'Expected resolution': expected,
          'Last updated': lastUpdatedVal
        };

        let titleHtml = '';
        if(typeLabel){
          titleHtml = `<h4 style="margin:0 0 8px; font-size:16px;">${escapeHtml(typeLabel)}: ${escapeHtml(locationLabel)}</h4>`;
        } else {
          titleHtml = `<h4 style="margin:0 0 8px; font-size:16px;">${escapeHtml(locationLabel)}</h4>`;
        }

        // Build popup showing only the requested NZTA keys with specified label mappings.
        try{
          const fields = {};

          // Helper to add a value if present; stringify objects/arrays
          function addIfPresent(label, key, fallbackKey) {
            let v = props[key];
            if ((v === undefined || v === null || v === '') && fallbackKey) v = props[fallbackKey];
            if (v === undefined || v === null) return;
            if (typeof v === 'object') {
              try { v = JSON.stringify(v, null, 2); } catch(e) { v = String(v); }
            }
            fields[label] = v;
          }

          // Mapping per your request
          addIfPresent('Location', 'Name');
          addIfPresent('Description', 'EventDescription');
          addIfPresent('Note', 'EventComments');
          addIfPresent('Detoure Route', 'AlternativeRoute');
          addIfPresent('Start', 'StartDateNice');
          addIfPresent('End', 'EndDateNice');
          addIfPresent('Expected Resolution', 'ExpectedResolution', 'ExpectedResolutionText');
          addIfPresent('Last Updated', 'LastUpdatedNice');

          const popupHtml = `
            <div style="font-family: sans-serif; font-size:13px; color:#222; max-width:420px;">
              ${titleHtml}
              ${createPopupTable(fields)}
            </div>
          `;

          marker.bindPopup(popupHtml);
        } catch (e) {
          // Fallback: show the previous compact meta if something unexpected happens
          const popupHtml = `
            <div style="font-family: sans-serif; font-size:13px; color:#222;">
              ${titleHtml}
              ${detailsHtml}
              ${createPopupTable(meta)}
            </div>
          `;
          marker.bindPopup(popupHtml);
        }
        // register disruption for suggestions (include geometry when available)
        try{
          const disruption = {
            name: props.Name || props.LocationArea || props.EventDescription || 'NZTA event',
            status: props.Status || props.EventType || 'unknown',
            lat: lat,
            lon: lng,
            source: 'nzta',
            properties: props
          };
          if(item.geometry) disruption.geometry = item.geometry;
          window.__disruptions.push(disruption);
        }catch(e){ /* ignore */ }
      } else {
        console.warn("❌ Skipped NZTA feature: invalid or missing coordinates", props.Name || props.LocationArea);
      }

  });
}

function processCouncilData(data) {
  // Clear previous data
  councilLayer.clearLayers();
  // ensure disruptions array exists (append to existing)
  window.__disruptions = window.__disruptions || [];
  
  data.features.forEach(feature => {
    // ... (your existing Council processing logic) ...
    // Add processed markers to councilLayer
    const props = feature.properties;
      const geomType = feature.geometry?.type;
      const coords = feature.geometry?.coordinates;

      console.log("Feature Geometry:", geomType);
      console.log("Feature Location:", props.Location);
      console.log("Feature Status:", props.Status);

      // Normalise status
      const status = (props.Status || "").toLowerCase();
      let colour = "gray";

      if (status.includes("closed")) {
        colour = "red";
      } else if (
        status.includes("residents only") ||
        status.includes("4wd access only") ||
        status.includes("single lane operation") ||
        status.includes("programmed road works")
      ) {
        colour = "orange";
      }

      // === LineString: normal road line
      if (geomType === "LineString") {
        const polyline = L.polyline(coords.map(coord => [coord[1], coord[0]]), {
          color: colour,
          weight: 5
        }).addTo(councilLayer);

        const lineFields = {
          'Location': props.Location || '',
          'Type': props.Type || '',
          'Status': props.Status || '',
          'Date': props.Date || '',
          'Description': props.Description || '',
          'Notes': props.Notes || ''
        };
        polyline.bindPopup(createPopupTable(lineFields));
        // register a disruption at midpoint for suggestions and include full geometry
        try{
          const mid = coords[Math.floor(coords.length/2)];
          const [lng, lat] = mid;
          window.__disruptions.push({
            name: props.Location || props.Type || 'Council closure',
            status: props.Status || 'unknown',
            lat: lat,
            lon: lng,
            source: 'council',
            properties: props,
            geometry: { type: 'LineString', coordinates: coords }
          });
        }catch(e){ }
      }

      // === ✅ Polygon: closed area
      else if (geomType === "Polygon") {
        const polygon = L.polygon(
          coords[0].map(coord => [coord[1], coord[0]]), // only first ring (outer shell)
          {
            color: colour,
            fillColor: colour,
            fillOpacity: 0.3,
            weight: 2
          }
        ).addTo(councilLayer);

        const polyFields = {
          'Location': props.Location || '',
          'Type': props.Type || '',
          'Status': props.Status || '',
          'Date': props.Date || '',
          'Description': props.Description || '',
          'Notes': props.Notes || ''
        };
        polygon.bindPopup(createPopupTable(polyFields));
        // register polygon disruption at first ring midpoint and include full geometry
        try{
          const ring = coords[0];
          const mid = ring[Math.floor(ring.length/2)];
          const [lng, lat] = mid;
          window.__disruptions.push({
            name: props.Location || props.Type || 'Council area',
            status: props.Status || 'unknown',
            lat: lat,
            lon: lng,
            source: 'council',
            properties: props,
            geometry: { type: 'Polygon', coordinates: coords }
          });
        }catch(e){}
      }

      // === Point: single marker
      else if (geomType === "Point") {
  const [lng, lat] = coords;
  const marker = L.marker([lat, lng], {
    icon: L.icon({
      iconUrl: "icons/ramm-closed.png", 
      iconSize: [30, 40], 
      iconAnchor: [15, 40]
    })
  }).addTo(councilLayer);

  const pointFields = {
    'Location': props.Location || '',
    'Type': props.Type || '',
    'Status': props.Status || '',
    'Date': props.Date || '',
    'Description': props.Description || '',
    'Notes': props.Notes || ''
  };
  marker.bindPopup(createPopupTable(pointFields));
  // register point disruption and include geometry
  try{
    window.__disruptions.push({
      name: props.Location || props.Type || 'Council point',
      status: props.Status || 'unknown',
      lat: lat,
      lon: lng,
      source: 'council',
      properties: props,
      geometry: { type: 'Point', coordinates: [lng, lat] }
    });
  }catch(e){}
}


      // === Unsupported geometries
      else {
        console.warn("Skipped non-Line/Polygon feature:", geomType, props.Location);
      }
  });
}

// 6. Helper functions
// helper to escape HTML
function escapeHtml(str){
  if(str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// build a labeled table for popups from an object of fields
function createPopupTable(fields){
  let html = '<table style="border-collapse:collapse; font-family: sans-serif; font-size:13px;">';
  for(const key of Object.keys(fields)){
    const val = fields[key];
    html += `<tr>`;
    html += `<td style="font-weight:700; padding:6px 8px; vertical-align:top; color:#222; min-width:110px;">${escapeHtml(key)}</td>`;
    html += `<td style="padding:6px 8px; vertical-align:top; color:#333;">${escapeHtml(val) || ''}</td>`;
    html += `</tr>`;
  }
  html += '</table>';
  return html;
}

function formatDateTime(timestamp) {
  return new Date(timestamp).toLocaleString("en-NZ", {
    dateStyle: "medium",
    timeStyle: "short",
    hour12: false,
    timeZone: "Pacific/Auckland"
  });
}

function showDataError(source) {
  const element = document.getElementById(`${source}-status`);
  element.textContent = "⚠️ Data update failed - trying again soon";
  element.style.color = "red";
  
  // Revert to normal after 30 seconds
  setTimeout(() => {
    element.textContent = `Last update: ${formatDateTime(source === 'nzta' ? nztaDataTimestamp * 1000 : councilDataTimestamp)}`;
    element.style.color = "";
  }, 30000);
}

// 7. Initialize the auto-refresh system
document.addEventListener('DOMContentLoaded', initAutoRefresh);

// =========================================================
// Layer Toggle UI
// =========================================================
const overlays = {
  "NZTA Events": nztaLayer,
  "Council Closures": councilLayer
};

L.control.layers(null, overlays, { collapsed: false }).addTo(map);


