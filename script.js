// Configuration
const REFRESH_INTERVAL = 2 * 60 * 1000; // 5 minutes
let nztaDataTimestamp = 0;
let councilDataTimestamp = 0;

// 1. Setup map and layers
const map = L.map('map').setView([-41.2706, 173.2840], 7);
const nztaLayer = L.layerGroup().addTo(map);
const councilLayer = L.layerGroup().addTo(map);

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
        marker.bindPopup(`
          <b>${props.Name || props.LocationArea || "Unknown Location"} - ${props.Status || "Unknown Status"}</b><br>
          ${props.EventDescription || props.Description || "No description"}<br>
          <small>Updated: ${props.LastUpdatedNice || props.LastEdited}</small>
        `);
      } else {
        console.warn("❌ Skipped NZTA feature: invalid or missing coordinates", props.Name || props.LocationArea);
      }

  });
}

function processCouncilData(data) {
  // Clear previous data
  councilLayer.clearLayers();
  
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

        polyline.bindPopup(`
          <b>${props.Location} - ${props.Status}</b><br>
          ${props.Type}: ${props.Description}<br>
          <small>Date: ${props.Date}</small><br>
          <em>${props.Notes || ''}</em>
        `);
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

        polygon.bindPopup(`
          <b>${props.Location} - ${props.Status}</b><br>
          ${props.Type}: ${props.Description}<br>
          <small>Date: ${props.Date}</small><br>
          <em>${props.Notes || ''}</em>
        `);
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

  marker.bindPopup(`
    <b>${props.Location} - ${props.Status}</b><br>
    ${props.Type}: ${props.Description}<br>
    <small>Date: ${props.Date}</small><br>
    <em>${props.Notes || ''}</em>
  `);
}


      // === Unsupported geometries
      else {
        console.warn("Skipped non-Line/Polygon feature:", geomType, props.Location);
      }
  });
}

// 6. Helper functions
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