// Global variables
let map;
let visitedKnooppunten = new Set();
let knooppunten = new Map();
let markers = new Map();
let osmRoutes = []; // Store actual OSM routes
let osmRoutesVisible = true; // Toggle state for OSM routes
let osmRoutesLoading = false; // Toggle state for OSM route loading (start disabled)
let routesCache = new Map(); // Cache for loaded routes by bounds
let loadNodesTimeout = null; // For debouncing map movements
let currentBounds = null; // Track current bounds to avoid reloading same data

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚴‍♀️ Starting Nederlandse Fietsknooppunten Tracker...');
    
    // Check if Leaflet is loaded
    if (typeof L === 'undefined') {
        updateStatus('❌ Kaart bibliotheek niet geladen. Herlaad de pagina.', 'error');
        document.getElementById('loading').style.display = 'none';
        return;
    }
    
    // Initialize map and load data for initial view
    initMap().then(() => {
        loadNodesForCurrentView();
        // Routes loading is disabled by default to prevent API overload
        // User can enable it manually with the toggle button
    }).catch(error => {
        console.error('Initialization failed:', error);
        updateStatus('❌ Initialisatie mislukt: ' + error.message, 'error');
        document.getElementById('loading').style.display = 'none';
    });
    
    // Load saved data from localStorage
    loadSavedData();
});

// Initialize Leaflet map
async function initMap() {
    try {
        updateStatus('🗺️ Kaart initialiseren...');
        
        // Create map centered on Utrecht (central Netherlands)
        // Zoom level 11 shows approximately 30x30km area
        map = L.map('map', {
            center: [52.0907, 5.1214], // Utrecht area
            zoom: 11, // This shows roughly 30x30km
            zoomControl: true,
            preferCanvas: true // Better performance for many markers
        });
        
        // Add OpenStreetMap tiles
        const osmLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 18
        });
        
        // Add cycling-specific layer
        const cyclingLayer = L.tileLayer('https://{s}.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 18,
            opacity: 0.7
        });
        
        // Set default layer
        osmLayer.addTo(map);
        
        // Layer control
        const baseLayers = {
            "Standaard Kaart": osmLayer,
            "Fietskaart": cyclingLayer
        };
        
        L.control.layers(baseLayers).addTo(map);
        
        // Add event listeners for map movement to load data dynamically
        // Use debouncing to prevent too frequent API calls
        map.on('moveend', debounceLoadNodes);
        map.on('zoomend', debounceLoadNodes);
        
        console.log('✅ Map initialized successfully');
        updateStatus('✅ Kaart geladen!', 'success');
        
    } catch (error) {
        throw new Error('Map initialization failed: ' + error.message);
    }
}

// Debounce function to prevent too frequent API calls during map movement
function debounceLoadNodes() {
    clearTimeout(loadNodesTimeout);
    loadNodesTimeout = setTimeout(() => {
        loadNodesForCurrentView();
        // Load routes with much longer delay to prevent API overload
        setTimeout(() => {
            loadRoutesForCurrentView();
        }, 5000); // 5 second delay after nodes
    }, 2000); // Increased debounce time to 2 seconds
}

// Load cycling nodes for current map view (bounds-based loading)
async function loadNodesForCurrentView() {
    try {
        if (!map) return;
        
        const bounds = map.getBounds();
        const south = bounds.getSouth();
        const west = bounds.getWest();
        const north = bounds.getNorth();
        const east = bounds.getEast();
        
        // Check if current view overlaps significantly with previously loaded area
        if (currentBounds) {
            const [prevSouth, prevWest, prevNorth, prevEast] = currentBounds.split(',').map(Number);
            
            // Calculate overlap percentage
            const overlapSouth = Math.max(south, prevSouth);
            const overlapWest = Math.max(west, prevWest);
            const overlapNorth = Math.min(north, prevNorth);
            const overlapEast = Math.min(east, prevEast);
            
            // If there's significant overlap (80% or more), don't reload
            if (overlapSouth < overlapNorth && overlapWest < overlapEast) {
                const currentArea = (north - south) * (east - west);
                const overlapArea = (overlapNorth - overlapSouth) * (overlapEast - overlapWest);
                const overlapPercentage = overlapArea / currentArea;
                
                if (overlapPercentage > 0.8) {
                    console.log(`📦 Significant overlap (${Math.round(overlapPercentage * 100)}%), skipping reload`);
                    return;
                }
            }
        }
        
        // Store current bounds for next comparison
        currentBounds = `${south},${west},${north},${east}`;
        
        // Calculate approximate area size
        const latDiff = north - south;
        const lonDiff = east - west;
        const approxKm = Math.round(latDiff * 111); // Rough conversion to km
        
        updateStatus(`📡 Ophalen knooppunten voor ~${approxKm}x${approxKm}km gebied...`);
        
        // Use chunked API for larger areas to avoid missing data
        const apiEndpoint = approxKm > 50 ? 
            `/api/cycling-nodes/bounds-chunked/${south}/${west}/${north}/${east}` :
            `/api/cycling-nodes/bounds/${south}/${west}/${north}/${east}`;
        
        const response = await fetch(apiEndpoint);
        
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        updateStatus(`🔄 Verwerken ${data.nodes.length} knooppunten...`);
        
        // Always clear markers when loading new area (chunked or not)
        markers.forEach(marker => map.removeLayer(marker));
        markers.clear();
        knooppunten.clear();
        
        // Process nodes using OSM ID as unique identifier
        let addedCount = 0;
        console.log(`🔄 Processing ${data.nodes.length} nodes, current map has ${knooppunten.size} nodes`);
        console.log(`🔍 First 5 nodes:`, data.nodes.slice(0, 5).map(n => ({ id: n.id, osmId: n.osmId, lat: n.lat, lng: n.lng })));
        
        for (const node of data.nodes) {
            if (node.osmId && node.lat && node.lng) {
                // Use OSM ID as unique key, but keep node number for display
                knooppunten.set(node.osmId, node);
                addKnooppuntToMap(node);
                addedCount++;
                
                // Update progress for large datasets
                if (addedCount % 50 === 0) {
                    updateStatus(`📍 Toegevoegd: ${addedCount}/${data.nodes.length} knooppunten`);
                    // Small delay to prevent UI blocking
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
            } else {
                console.warn(`❌ Skipping invalid node:`, node);
            }
        }
        
        document.getElementById('loading').style.display = 'none';
        
        // Create appropriate success message
        let successMessage = `✅ ${addedCount} knooppunten geladen voor ~${approxKm}x${approxKm}km gebied!`;
        if (data.chunks) {
            successMessage += ` (${data.chunks} delen samengevoegd)`;
        }
        
        console.log(`📊 Final stats: ${addedCount} nodes added, ${knooppunten.size} total nodes, ${markers.size} markers on map`);
        updateStatus(successMessage, 'success');
        
        // Show warning if data might be incomplete
        if (data.warning) {
            setTimeout(() => {
                updateStatus(`⚠️ ${data.warning}`, 'error');
            }, 3000);
        }
        
        // Show info about chunked loading
        if (data.chunks) {
            setTimeout(() => {
                updateStatus(`📦 Data geladen in ${data.chunks} delen voor betere dekking`, 'info');
            }, 2000);
        }

        updateStats();
        updateVisitedList();
        
    } catch (error) {
        console.error('Error loading cycling nodes for current view:', error);
        document.getElementById('loading').style.display = 'none';
        
        // Check if this is a "no data" error with instructions
        if (error.message.includes('npm run download') || error.message.includes('No local data found')) {
            updateStatus('📥 Geen lokale data gevonden. Run eerst "npm run download" in de terminal om Nederlandse knooppunten te downloaden.', 'error');
        } else {
            updateStatus(`❌ Fout bij ophalen knooppunten: ${error.message}`, 'error');
        }
    }
}

// Load cycling routes for current map view
async function loadRoutesForCurrentView() {
    try {
        if (!map || !osmRoutesLoading) return; // Don't load if disabled
        
        const bounds = map.getBounds();
        const south = bounds.getSouth().toFixed(4);
        const west = bounds.getWest().toFixed(4);
        const north = bounds.getNorth().toFixed(4);
        const east = bounds.getEast().toFixed(4);
        
        // Check cache first
        const cacheKey = `${south},${west},${north},${east}`;
        if (routesCache.has(cacheKey)) {
            console.log('📦 Using cached routes for this area');
            osmRoutes = routesCache.get(cacheKey);
            clearOsmRoutes();
            drawOsmRoutes();
            updateStatus(`✅ ${osmRoutes.length} fietsroutes geladen (cache)!`, 'success');
            return;
        }
        
        // Only load routes if zoom level is high enough (closer view)
        const currentZoom = map.getZoom();
        if (currentZoom < 14) { // Increased minimum zoom to reduce load even more
            console.log('🔍 Zoom level too low for route loading (need zoom ≥ 14), skipping...');
            updateStatus(`🔍 Zoom verder in (${Math.round(currentZoom)}/14) voor routes`, 'info');
            return;
        }
        
        updateStatus('🛣️ Ophalen fietsroutes...');
        
        const response = await fetch(`/api/cycling-routes/bounds/${south}/${west}/${north}/${east}`);
        
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        console.log(`📍 Loaded ${data.routes.length} routes`);
        
        // Clear existing route lines
        clearOsmRoutes();
        osmRoutes = data.routes;
        
        // Cache the routes for this area
        routesCache.set(cacheKey, osmRoutes);
        
        // Draw the actual OSM routes
        drawOsmRoutes();
        
        updateStatus(`✅ ${data.routes.length} fietsroutes geladen!`, 'success');
        
    } catch (error) {
        console.error('Error loading cycling routes for current view:', error);
        
        // Provide user-friendly error messages
        if (error.message.includes('504')) {
            updateStatus(`⚠️ Gebied te groot voor routes - zoom verder in`, 'error');
        } else if (error.message.includes('429')) {
            updateStatus(`⚠️ Te veel verzoeken - wacht even met slepen`, 'error');
        } else {
            updateStatus(`⚠️ Kon geen routes laden: ${error.message}`, 'error');
        }
    }
}

// Draw OSM routes on the map
function drawOsmRoutes() {
    if (!osmRoutesVisible) return; // Don't draw if routes are hidden
    
    osmRoutes.forEach(route => {
        if (route.type === 'way' && route.coordinates) {
            // Single way route
            const polyline = L.polyline(route.coordinates, {
                color: '#2196F3',
                weight: 3,
                opacity: 0.7,
                className: 'osm-route'
            }).addTo(map);
            
            polyline.bindPopup(`
                <div style="min-width: 200px;">
                    <strong>${route.name}</strong><br>
                    <small>Netwerk: ${route.network}</small><br>
                    ${route.rcn_ref ? `<small>Route nummer: ${route.rcn_ref}</small><br>` : ''}
                    <small>Afstand: ${(route.distance / 1000).toFixed(2)} km</small><br>
                    <small>Type: ${route.type}</small>
                </div>
            `);
            
            routeLines.push(polyline);
            
        } else if (route.type === 'relation' && route.coordinates) {
            // Multi-way relation route
            route.coordinates.forEach((wayCoords, index) => {
                const polyline = L.polyline(wayCoords, {
                    color: '#FF9800',
                    weight: 3,
                    opacity: 0.7,
                    className: 'osm-route-relation'
                }).addTo(map);
                
                polyline.bindPopup(`
                    <div style="min-width: 200px;">
                        <strong>${route.name}</strong><br>
                        <small>Deel ${index + 1} van ${route.wayCount}</small><br>
                        <small>Netwerk: ${route.network}</small><br>
                        ${route.rcn_ref ? `<small>Route nummer: ${route.rcn_ref}</small><br>` : ''}
                        <small>Type: Relatie (${route.wayCount} delen)</small>
                    </div>
                `);
                
                routeLines.push(polyline);
            });
        }
    });
}

// Clear OSM routes from map
function clearOsmRoutes() {
    routeLines.forEach(line => {
        if (line.options.className && 
            (line.options.className.includes('osm-route'))) {
            map.removeLayer(line);
        }
    });
    
    // Keep only user-drawn routes
    routeLines = routeLines.filter(line => 
        !line.options.className || 
        !line.options.className.includes('osm-route')
    );
}

// Load cycling nodes from our API (legacy function for full Netherlands)
async function loadCyclingNodes() {
    try {
        updateStatus('📡 Ophalen fietsknooppunten van server...');
        
        const response = await fetch('/api/cycling-nodes');
        
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        updateStatus(`🔄 Verwerken ${data.nodes.length} knooppunten...`);
        
        // Clear existing markers
        markers.forEach(marker => map.removeLayer(marker));
        markers.clear();
        knooppunten.clear();
        
        // Process nodes using OSM ID as unique identifier
        let addedCount = 0;
        for (const node of data.nodes) {
            if (node.osmId && node.lat && node.lng) {
                // Use OSM ID as unique key, but keep node number for display
                knooppunten.set(node.osmId, node);
                addKnooppuntToMap(node);
                addedCount++;
                
                // Update progress for large datasets
                if (addedCount % 100 === 0) {
                    updateStatus(`📍 Toegevoegd: ${addedCount}/${data.nodes.length} knooppunten`);
                    // Small delay to prevent UI blocking
                    await new Promise(resolve => setTimeout(resolve, 10));
                }
            }
        }
        
        document.getElementById('loading').style.display = 'none';
        updateStatus(`✅ ${addedCount} Nederlandse fietsknooppunten geladen! (Bron: ${data.source})`, 'success');
        
        if (data.warning) {
            setTimeout(() => {
                updateStatus(`⚠️ ${data.warning}`, 'error');
            }, 3000);
        }
        
        updateStats();
        
        // Fit map to show all nodes
        if (knooppunten.size > 0) {
            fitToNodes();
        }
        
    } catch (error) {
        console.error('Error loading cycling nodes:', error);
        document.getElementById('loading').style.display = 'none';
        
        // Check if this is a "no data" error with instructions
        if (error.message.includes('npm run download') || error.message.includes('No local data found')) {
            updateStatus('📥 Geen lokale data gevonden. Run eerst "npm run download" in de terminal om Nederlandse knooppunten te downloaden.', 'error');
        } else {
            updateStatus(`❌ Fout bij ophalen knooppunten: ${error.message}`, 'error');
        }
        
        // Try to load fallback data
        setTimeout(loadFallbackData, 2000);
    }
}

// Load fallback data if API fails
async function loadFallbackData() {
    try {
        updateStatus('🔄 Proberen fallback data te laden...');
        
        const response = await fetch('/api/cycling-nodes');
        const data = await response.json();
        
        if (data.fallback && data.fallback.nodes) {
            updateStatus('⚠️ Demo modus: beperkte knooppunten geladen');
            
            data.fallback.nodes.forEach(node => {
                // Fallback nodes need OSM IDs too, use node ID as fallback OSM ID
                if (!node.osmId) {
                    node.osmId = `fallback_${node.id}`;
                }
                knooppunten.set(node.osmId, node);
                addKnooppuntToMap(node);
            });
            
            updateStats();
            fitToNodes();
        }
        
    } catch (error) {
        updateStatus('❌ Geen data beschikbaar. Check server verbinding.', 'error');
    }
}

// Add cycling node marker to map
function addKnooppuntToMap(knooppunt) {
    // Use OSM ID for unique identification, but show node number
    const markerHtml = `<div class="knooppunt-marker" data-osm-id="${knooppunt.osmId}" data-node-id="${knooppunt.id}">${knooppunt.id}</div>`;
    
    const marker = L.marker([knooppunt.lat, knooppunt.lng], {
        icon: L.divIcon({
            html: markerHtml,
            className: 'custom-div-icon',
            iconSize: [28, 28],
            iconAnchor: [14, 14]
        })
    }).addTo(map);
    
    // Click handler using OSM ID for unique identification
    marker.on('click', () => toggleKnooppuntVisited(knooppunt.osmId));
    
    // Popup with enhanced info showing both IDs
    const popupContent = `
        <div style="text-align: center; min-width: 180px;">
            <strong>${knooppunt.name}</strong><br>
            <small>Knooppunt nummer: ${knooppunt.id}</small><br>
            <small>Uniek OSM ID: ${knooppunt.osmId}</small><br>
            <small>Netwerk: ${knooppunt.network}</small><br>
            ${knooppunt.description ? `<small>📝 ${knooppunt.description}</small><br>` : ''}
            ${knooppunt.note ? `<small>💡 ${knooppunt.note}</small><br>` : ''}
            ${knooppunt.operator ? `<small>🏢 Beheerder: ${knooppunt.operator}</small><br>` : ''}
            ${knooppunt.addr_city || knooppunt.addr_village ? `<small>📍 ${knooppunt.addr_city || knooppunt.addr_village}</small><br>` : ''}
            <small>Coördinaten: ${knooppunt.lat.toFixed(4)}, ${knooppunt.lng.toFixed(4)}</small><br>
            <small>Klik om ${visitedKnooppunten.has(knooppunt.osmId) ? 'als niet bezocht te markeren' : 'als bezocht te markeren'}</small>
        </div>
    `;
    
    marker.bindPopup(popupContent);
    
    // Use OSM ID as unique key for markers
    markers.set(knooppunt.osmId, marker);
    
    // Apply initial styling using OSM ID
    updateMarkerStyle(knooppunt.osmId);
}

// Toggle node selection
function toggleKnooppuntVisited(id) {
    if (visitedKnooppunten.has(id)) {
        // Remove from visited
        visitedKnooppunten.delete(id);
        updateStatus(`📍 Knooppunt ${knooppunten.get(id)?.id || id} gemarkeerd als niet bezocht`, 'info');
    } else {
        // Add to visited
        visitedKnooppunten.add(id);
        updateStatus(`✅ Knooppunt ${knooppunten.get(id)?.id || id} gemarkeerd als bezocht`, 'success');
    }
    
    updateMarkerStyle(id);
    updateVisitedList();
    updateStats();
    saveData();
}

// Update marker appearance
function updateMarkerStyle(id) {
    const marker = markers.get(id);
    if (!marker) return;
    
    const element = marker.getElement()?.querySelector('.knooppunt-marker');
    if (!element) return;
    
    element.classList.remove('selected', 'visited');
    
    if (visitedKnooppunten.has(id)) {
        element.classList.add('visited');
    }
}

// Update selected points display
// Clear all visited nodes
function clearAllVisited() {
    if (visitedKnooppunten.size === 0) return;
    
    if (confirm('Wil je alle bezochte knooppunten wissen? Dit kan niet ongedaan gemaakt worden!')) {
        const oldVisited = [...visitedKnooppunten];
        visitedKnooppunten.clear();
        
        oldVisited.forEach(id => updateMarkerStyle(id));
        updateVisitedList();
        updateStats();
        saveData();
        
        updateStatus('🗑️ Alle bezochte knooppunten gewist', 'success');
    }
}

// Update visited list display
function updateVisitedList() {
    const container = document.getElementById('visitedList');
    const barTitle = document.getElementById('visitedBarTitle');
    
    if (visitedKnooppunten.size === 0) {
        container.innerHTML = '<div class="empty-visited">Nog geen knooppunten bezocht</div>';
        barTitle.textContent = '✅ Bezochte Knooppunten (0)';
        return;
    }
    
    // Get visited nodes and sort by node number
    const visitedNodes = Array.from(visitedKnooppunten).map(osmId => {
        return knooppunten.get(osmId);
    }).filter(node => node).sort((a, b) => a.id - b.id);
    
    // Update bar title with count
    barTitle.textContent = `✅ Bezochte Knooppunten (${visitedNodes.length})`;
    
    container.innerHTML = visitedNodes.map(node => {
        const locationInfo = node.addr_city || node.addr_village || '';
        const extraInfo = node.description || node.note || '';
        
        return `
            <div class="visited-item">
                <div class="visited-text">
                    <strong>📍 ${node.id} - ${node.name}</strong>
                    ${locationInfo ? `<br><small>📍 ${locationInfo}</small>` : ''}
                    ${extraInfo ? `<br><small>💬 ${extraInfo}</small>` : ''}
                </div>
                <button class="visited-remove" onclick="removeVisited('${node.osmId}')" title="Verwijderen">×</button>
            </div>
        `;
    }).join('');
    
    updateStats();
}

// Toggle visited bar
function toggleVisitedBar() {
    const visitedBar = document.getElementById('visitedBar');
    visitedBar.classList.toggle('collapsed');
}

// Remove individual visited node
function removeVisited(osmId) {
    const node = knooppunten.get(osmId);
    if (confirm(`Wil je knooppunt ${node?.id || 'dit knooppunt'} verwijderen uit bezochte lijst?`)) {
        visitedKnooppunten.delete(osmId);
        
        // Update marker styling
        updateMarkerStyle(osmId);
        updateVisitedList();
        updateStats();
        saveData();
        
        updateStatus('✅ Knooppunt verwijderd uit bezochte lijst', 'success');
    }
}

// Update statistics
function updateStats() {
    const knooppuntenCount = visitedKnooppunten.size;
    const loadedCount = knooppunten.size;
    const completionRate = loadedCount > 0 ? Math.round((knooppuntenCount / loadedCount) * 100) : 0;
    
    document.getElementById('totalKnooppunten').textContent = knooppuntenCount;
    document.getElementById('loadedCount').textContent = loadedCount;
    
    const progressFill = document.getElementById('progressFill');
    const displayRate = Math.min(100, completionRate);
    progressFill.style.width = displayRate + '%';
    progressFill.textContent = displayRate + '%';
}

// Draw route lines on map
// Export visited nodes to text format
function exportVisited() {
    if (visitedKnooppunten.size === 0) {
        updateStatus('⚠️ Geen bezochte knooppunten om te exporteren', 'error');
        return;
    }
    
    // Get visited nodes and sort by node number
    const visitedNodes = Array.from(visitedKnooppunten).map(osmId => {
        return knooppunten.get(osmId);
    }).filter(node => node).sort((a, b) => a.id - b.id);
    
    const exportData = {
        exportDate: new Date().toISOString(),
        totalVisited: visitedNodes.length,
        visitedNodes: visitedNodes.map(node => ({
            knooppuntNumber: node.id,
            name: node.name,
            osmId: node.osmId,
            coordinates: [node.lat, node.lng]
        }))
    };
    
    const dataStr = JSON.stringify(exportData, null, 2);
    const dataBlob = new Blob([dataStr], {type: 'application/json'});
    
    const link = document.createElement('a');
    link.href = URL.createObjectURL(dataBlob);
    link.download = `bezochte-knooppunten-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    
    updateStatus('✅ Bezochte knooppunten geëxporteerd!', 'success');
}

// Clear route lines (user-drawn routes only)
function clearRouteLines() {
    routeLines.forEach(line => {
        // Only remove user-drawn routes (those without osm-route class)
        if (!line.options.className || 
            !line.options.className.includes('osm-route')) {
            map.removeLayer(line);
        }
    });
    
    // Keep only OSM routes in the array
    routeLines = routeLines.filter(line => 
        line.options.className && 
        line.options.className.includes('osm-route')
    );
}

// Toggle OSM routes visibility
function toggleOsmRoutes() {
    osmRoutesVisible = !osmRoutesVisible;
    const toggleBtn = document.getElementById('osmRoutesToggle');
    
    if (osmRoutesVisible) {
        // Show OSM routes
        drawOsmRoutes();
        toggleBtn.style.background = '#2196F3';
        toggleBtn.style.color = 'white';
        toggleBtn.textContent = '🛣️ OSM Routes ON';
        updateStatus('✅ OSM fietsroutes worden getoond', 'success');
    } else {
        // Hide OSM routes
        clearOsmRoutes();
        toggleBtn.style.background = '#f0f0f0';
        toggleBtn.style.color = '#666';
        toggleBtn.textContent = '🛣️ OSM Routes OFF';
        updateStatus('⚪ OSM fietsroutes verborgen', 'info');
    }
}

// Toggle OSM route loading (to prevent API overload)
function toggleOsmRouteLoading() {
    osmRoutesLoading = !osmRoutesLoading;
    const toggleBtn = document.getElementById('osmLoadingToggle');
    
    if (osmRoutesLoading) {
        toggleBtn.style.background = '#4CAF50';
        toggleBtn.style.color = 'white';
        toggleBtn.textContent = '✅ Routes ON';
        updateStatus('✅ OSM route loading ingeschakeld - zoom in (≥14) om routes te zien', 'success');
        // Try to load routes for current view
        setTimeout(loadRoutesForCurrentView, 1000);
    } else {
        toggleBtn.style.background = '#ff5722';
        toggleBtn.style.color = 'white';
        toggleBtn.textContent = '⚠️ Routes OFF';
        updateStatus('⚠️ OSM route loading uitgeschakeld (vermindert API belasting)', 'info');
        clearOsmRoutes();
    }
}

// Utility functions
function updateStatus(message, type = '') {
    const statusElement = document.getElementById('statusInfo');
    statusElement.textContent = message;
    statusElement.className = `status-info ${type}`;
    console.log(`[${type.toUpperCase()}] ${message}`);
}

function fitToNodes() {
    if (knooppunten.size === 0) return;
    
    const bounds = L.latLngBounds();
    knooppunten.forEach(node => {
        bounds.extend([node.lat, node.lng]);
    });
    
    map.fitBounds(bounds, { padding: [20, 20] });
    updateStatus('🎯 Kaart aangepast aan alle knooppunten');
}

async function refreshData() {
    updateStatus('🔄 Data verversen...');
    document.getElementById('loading').style.display = 'block';
    
    // Clear cache on server
    try {
        await fetch('/api/cache', { method: 'DELETE' });
    } catch (error) {
        console.log('Could not clear cache:', error.message);
    }
    
    // Reload data
    await loadCyclingNodes();
    
    updateStatus('✅ Data ververst!', 'success');
}

// Data persistence
function saveData() {
    const data = {
        visitedKnooppunten: Array.from(visitedKnooppunten),
        savedAt: new Date().toISOString()
    };
    
    try {
        localStorage.setItem('fietsknooppunten-tracker', JSON.stringify(data));
    } catch (error) {
        console.warn('Could not save to localStorage:', error);
    }
}

function loadSavedData() {
    try {
        const saved = localStorage.getItem('fietsknooppunten-tracker');
        if (saved) {
            const data = JSON.parse(saved);
            
            visitedKnooppunten = new Set(data.visitedKnooppunten || []);
            
            console.log('✅ Saved data loaded from localStorage');
            updateStatus('💾 Opgeslagen data geladen');
        }
    } catch (error) {
        console.warn('Could not load from localStorage:', error);
    }
}

// Handle window resize
window.addEventListener('resize', () => {
    if (map) {
        setTimeout(() => {
            map.invalidateSize();
        }, 100);
    }
});

// Handle page visibility change (refresh data when page becomes visible)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && map && knooppunten.size === 0) {
        console.log('Page became visible, checking for data...');
        loadCyclingNodes();
    }
});