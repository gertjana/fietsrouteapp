// Global variables
let map;
let visitedKnooppunten = new Set();
let knooppunten = new Map();
let markers = new Map();
let osmRoutes = []; // Store actual OSM routes
let osmRoutesVisible = true; // Toggle state for OSM routes
let osmRoutesLoading = true; // Toggle state for OSM route loading (enabled for chunk-based loading)
let routesCache = new Map(); // Cache for loaded routes by bounds
let routeLines = []; // Store route polylines on the map
let loadNodesTimeout = null; // For debouncing map movements
let currentBounds = null; // Track current bounds to avoid reloading same data
let lastZoom = null; // Track zoom level for clustering updates
let currentTileLayer = null; // Track current tile layer for theme switching
let totalNodesInNetherlands = 0; // Total number of cycling nodes in Netherlands for accurate percentage

// Utility functions
// Calculate distance between two points in meters using Haversine formula
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371000; // Earth's radius in meters
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lng2-lng1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c; // Distance in meters
}

// Find all nodes with the same number that are within 500m of each other
function findGroupedNodes(targetNode) {
    const groupedNodes = [targetNode];
    const maxDistance = 500; // 500 meters
    
    // Find all nodes with the same number
    const sameNumberNodes = Array.from(knooppunten.values()).filter(node => 
        node.id === targetNode.id && node.osmId !== targetNode.osmId
    );
    
    // Check which ones are within 100m
    sameNumberNodes.forEach(node => {
        const distance = calculateDistance(
            targetNode.lat, targetNode.lng,
            node.lat, node.lng
        );
        
        if (distance <= maxDistance) {
            groupedNodes.push(node);
        }
    });
    
    return groupedNodes;
}

// Cookie utility functions
function setCookie(name, value, days = 30) {
    const expires = new Date();
    expires.setTime(expires.getTime() + (days * 24 * 60 * 60 * 1000));
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
}

function getCookie(name) {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
        let c = ca[i];
        while (c.charAt(0) === ' ') c = c.substring(1, c.length);
        if (c.indexOf(nameEQ) === 0) return c.substring(nameEQ.length, c.length);
    }
    return null;
}

// Save map position to cookie
function saveMapPosition() {
    if (!map) return;
    
    const center = map.getCenter();
    const zoom = map.getZoom();
    
    const mapPosition = {
        lat: center.lat,
        lng: center.lng,
        zoom: zoom
    };
    
    setCookie('mapPosition', JSON.stringify(mapPosition));
}

// Load map position from cookie
function loadMapPosition() {
    const savedPosition = getCookie('mapPosition');
    if (savedPosition) {
        try {
            return JSON.parse(savedPosition);
        } catch (error) {
            console.warn('Could not parse saved map position:', error);
        }
    }
    return null;
}

// Initialize application
document.addEventListener('DOMContentLoaded', function() {
    console.log('🚴‍♀️ Starting Nederlandse Fietsknooppunten Tracker...');
    
    // Register service worker for tile caching
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(registration => {
                console.log('✅ Service Worker registered for tile caching');
                
                // Clean cache weekly
                if (registration.active) {
                    registration.active.postMessage({ type: 'CLEAN_CACHE' });
                }
            })
            .catch(error => {
                console.warn('⚠️ Service Worker registration failed:', error);
            });
    }
    
    // Check if Leaflet is loaded
    if (typeof L === 'undefined') {
        updateStatus('❌ Kaart bibliotheek niet geladen. Herlaad de pagina.', 'error');
        document.getElementById('loading').style.display = 'none';
        return;
    }
    
    // Initialize map and load data for initial view
    initMap().then(() => {
        loadTotalStats(); // Load total statistics first
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
        
        // Load saved position or use Netherlands defaults
        const savedPosition = loadMapPosition();
        const initialCenter = savedPosition ? [savedPosition.lat, savedPosition.lng] : [52.2, 5.5];
        const initialZoom = savedPosition ? savedPosition.zoom : 7;
        
        // Create map with saved or default position
        map = L.map('map', {
            center: initialCenter,
            zoom: initialZoom,
            zoomControl: true,
            preferCanvas: true // Better performance for many markers
        });
        
        // Initialize with standard OpenStreetMap tiles
        currentTileLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
            maxZoom: 18
        });
        
        currentTileLayer.addTo(map);
        
        // If no saved position, set map bounds to Netherlands after initialization
        if (!savedPosition) {
            setTimeout(() => {
                const netherlandsBounds = [
                    [50.7, 3.2], // Southwest corner
                    [53.6, 7.2]  // Northeast corner
                ];
                map.fitBounds(netherlandsBounds);
            }, 100);
        }
        
        // Add event listeners for map movement to load data dynamically
        // Use debouncing to prevent too frequent API calls
        map.on('moveend', () => {
            debounceLoadNodes();
            saveMapPosition(); // Save position when map moves
        });
        map.on('zoomend', () => {
            debounceLoadNodes();
            saveMapPosition(); // Save position when zoom changes
        });
        
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
        // Check zoom level and clear routes if too low
        const currentZoom = map.getZoom();
        if (currentZoom < 11) {
            // Clear routes when zooming to clustering level
            clearOsmRoutes();
            updateStatus(`🔍 Zoom verder in (${Math.round(currentZoom)}/11) voor routes`, 'info');
        }
        
        loadNodesForCurrentView();
        // Load routes with shorter delay for chunk-based loading
        setTimeout(() => {
            loadRoutesForCurrentView();
        }, 1000); // 1 second delay after nodes
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
        const currentZoom = map.getZoom();
        
        // Check if current view overlaps significantly with previously loaded area
        // BUT always reload if zoom level changed (important for clustering)
        if (currentBounds && lastZoom === currentZoom) {
            const [prevSouth, prevWest, prevNorth, prevEast] = currentBounds.split(',').map(Number);
            
            // Calculate overlap percentage
            const overlapSouth = Math.max(south, prevSouth);
            const overlapWest = Math.max(west, prevWest);
            const overlapNorth = Math.min(north, prevNorth);
            const overlapEast = Math.min(east, prevEast);
            
            // If there's significant overlap (80% or more) AND zoom hasn't changed, don't reload
            if (overlapSouth < overlapNorth && overlapWest < overlapEast) {
                const currentArea = (north - south) * (east - west);
                const overlapArea = (overlapNorth - overlapSouth) * (overlapEast - overlapWest);
                const overlapPercentage = overlapArea / currentArea;
                
                if (overlapPercentage > 0.8) {
                    console.log(`📦 Significant overlap (${Math.round(overlapPercentage * 100)}%) and same zoom (${currentZoom}), skipping reload`);
                    return;
                }
            }
        } else if (lastZoom !== currentZoom) {
            console.log(`🔍 Zoom changed from ${lastZoom} to ${currentZoom}, reloading for clustering update`);
        }
        
        // Store current bounds and zoom for next comparison
        currentBounds = `${south},${west},${north},${east}`;
        lastZoom = currentZoom;
        
        // Calculate approximate area size
        const latDiff = north - south;
        const lonDiff = east - west;
        const approxKm = Math.round(latDiff * 111); // Rough conversion to km
        
        updateStatus(`📡 Ophalen knooppunten voor ~${approxKm}x${approxKm}km gebied...`);
        
        // Use clustered API for all areas (with automatic clustering based on zoom/area)
        const apiEndpoint = `/api/cycling-nodes/clustered/${south}/${west}/${north}/${east}?zoom=${currentZoom}`;
        
        const response = await fetch(apiEndpoint);
        
        if (!response.ok) {
            throw new Error(`Server error: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.error) {
            throw new Error(data.error);
        }
        
        updateStatus(`🔄 Verwerken ${data.clusters ? data.clusters.length : data.nodes.length} items...`);
        
        // Always clear markers when loading new area
        markers.forEach(marker => map.removeLayer(marker));
        markers.clear();
        knooppunten.clear();
        
        // Process clusters and nodes
        let addedCount = 0;
        const items = data.clusters || data.nodes; // Support both clustered and legacy endpoints
        
        console.log(`🔄 Processing ${items.length} items, zoom: ${data.zoom || 'unknown'}`);
        if (data.clusterCount || data.individualNodeCount) {
            console.log(`� Clusters: ${data.clusterCount || 0}, Individual nodes: ${data.individualNodeCount || 0}`);
        }
        
        for (const item of items) {
            if (item.lat && item.lng) {
                if (item.type === 'cluster' && item.isCluster === true) {
                    // Add cluster marker for true clusters
                    addClusterToMap(item);
                    addedCount++;
                } else if (item.type === 'node' || item.osmId) {
                    // Add individual node (either wrapped in cluster structure or direct)
                    if (item.osmId) {
                        // For wrapped nodes, use the data from the nodes array if available
                        let nodeData = item;
                        if (item.nodes && item.nodes.length > 0 && item.nodes[0].ref) {
                            // Extract the actual node data with ref field
                            nodeData = { ...item, ...item.nodes[0] };
                        }
                        knooppunten.set(item.osmId, nodeData);
                        addKnooppuntToMap(nodeData);
                        addedCount++;
                    }
                }
                
                // Update progress for large datasets
                if (addedCount % 50 === 0) {
                    updateStatus(`📍 Toegevoegd: ${addedCount}/${items.length} items`);
                    // Small delay to prevent UI blocking
                    await new Promise(resolve => setTimeout(resolve, 5));
                }
            } else {
                console.warn(`❌ Skipping invalid item:`, item);
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
        
        // Get current zoom level first
        const currentZoom = map.getZoom();
        
        // Only load routes if zoom level is high enough and no clustering is active
        if (currentZoom < 11) { // Changed from 14 to 11 - only show routes when no clustering
            console.log('🔍 Zoom level too low for route loading (need zoom ≥ 11), skipping...');
            updateStatus(`🔍 Zoom verder in (${Math.round(currentZoom)}/11) voor routes`, 'info');
            return;
        }
        
        // Check cache first (after zoom check)
        const cacheKey = `${south},${west},${north},${east},${currentZoom}`;
        if (routesCache.has(cacheKey)) {
            console.log('📦 Using cached routes for this area');
            osmRoutes = routesCache.get(cacheKey);
            clearOsmRoutes();
            drawOsmRoutes();
            updateStatus(`✅ ${osmRoutes.length} fietsroutes geladen (cache)!`, 'success');
            return;
        }
        
        updateStatus('🛣️ Ophalen fietsroutes...');
        
        const response = await fetch(`/api/cycling-routes/bounds/${south}/${west}/${north}/${east}?zoom=${currentZoom}`);
        
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
        if (route.geometry && route.geometry.length >= 2) {
            // Convert geometry to coordinate pairs for Leaflet
            const coordinates = route.geometry.map(point => [point.lat, point.lng]);
            
            // Determine color based on network - all dark blue and thicker
            let color = '#1565C0'; // Dark blue for all routes
            if (route.network === 'rcn') color = '#1565C0'; // Dark blue for RCN
            else if (route.network === 'lcn') color = '#1565C0'; // Dark blue for LCN  
            else if (route.network === 'ncn') color = '#1565C0'; // Dark blue for NCN
            
            const polyline = L.polyline(coordinates, {
                color: color,
                weight: 2, // Set to 2 for medium thickness
                opacity: 0.8, // Slightly more opaque
                className: 'osm-route'
            }).addTo(map);
            
            // Create popup with route information
            const routeInfo = `
                <div style="min-width: 200px;">
                    <strong>${route.name || `Route ${route.relationId || route.wayId || route.id}`}</strong><br>
                    ${route.network ? `<small>Netwerk: ${route.network.toUpperCase()}</small><br>` : ''}
                    ${route.wayId ? `<small>Way ID: ${route.wayId}</small><br>` : ''}
                    ${route.relationId ? `<small>Relation ID: ${route.relationId}</small><br>` : ''}
                    ${route.tags?.highway ? `<small>Type: ${route.tags.highway}</small><br>` : ''}
                    ${route.tags?.surface ? `<small>Oppervlak: ${route.tags.surface}</small><br>` : ''}
                    ${route.tags?.lit ? `<small>Verlichting: ${route.tags.lit}</small><br>` : ''}
                    <small>Punten: ${route.geometry.length}</small>
                </div>
            `;
            
            polyline.bindPopup(routeInfo);
            routeLines.push(polyline);
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
    // Use OSM ID for unique identification, but show node reference number
    const displayNumber = knooppunt.ref || knooppunt.osmId || knooppunt.id;
    const markerHtml = `<div class="knooppunt-marker" data-osm-id="${knooppunt.osmId}" data-node-id="${knooppunt.id}">${displayNumber}</div>`;
    
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
    
    // Tooltip with enhanced info showing both IDs
    const groupedNodes = findGroupedNodes(knooppunt);
    const groupInfo = groupedNodes.length > 1 ? `<small>🔗 ${groupedNodes.length} grouped nodes</small><br>` : '';
    
    const tooltipContent = `
        <div style="text-align: center; min-width: 160px;">
            <strong>${knooppunt.name || `Node ${knooppunt.ref || knooppunt.osmId}`}</strong><br>
            ${knooppunt.ref ? `<small>Knooppunt: ${knooppunt.ref}</small><br>` : ''}
            <small>OSM ID: ${knooppunt.osmId}</small><br>
            ${groupInfo}
            <small>Netwerk: ${knooppunt.network}</small><br>
            ${knooppunt.addr_city || knooppunt.addr_village ? `<small>📍 ${knooppunt.addr_city || knooppunt.addr_village}</small><br>` : ''}
            <small>${knooppunt.lat.toFixed(4)}, ${knooppunt.lng.toFixed(4)}</small>
        </div>`;
    
    marker.bindTooltip(tooltipContent, {
        permanent: false,
        direction: 'top',
        offset: [0, -10],
        className: 'custom-tooltip'
    });
    
    // Use OSM ID as unique key for markers
    markers.set(knooppunt.osmId, marker);
    
    // Apply initial styling using OSM ID
    updateMarkerStyle(knooppunt.osmId);
}

// Add cluster marker to map
function addClusterToMap(cluster) {
    // Check if cluster contains any visited nodes
    let hasVisitedNodes = false;
    let visitedCount = 0;
    
    if (cluster.nodes && cluster.nodes.length > 0) {
        for (const node of cluster.nodes) {
            // ONLY match by OSM ID - knooppunt numbers are not unique!
            if (node.osmId && visitedKnooppunten.has(node.osmId)) {
                hasVisitedNodes = true;
                visitedCount++;
                continue;
            }
            
            // Fallback for demo nodes only (with fallback_ prefix)
            const fallbackKey = `fallback_${node.id}`;
            if (visitedKnooppunten.has(fallbackKey)) {
                hasVisitedNodes = true;
                visitedCount++;
                continue;
            }
        }
    }
    
    // Create pie chart SVG for cluster marker - always use pie chart format
    const totalNodes = cluster.count;
    const visitedPercentage = totalNodes > 0 ? (visitedCount / totalNodes) : 0;
    
    // Calculate pie chart
    const visitedAngle = visitedPercentage * 360;
    const radius = 18;
    const centerX = 20;
    const centerY = 20;
    
    let pieSliceHtml = '';
    
    if (visitedCount > 0 && visitedCount < totalNodes) {
        // Partial pie chart - create visited slice
        const startAngle = -90; // Start at top
        const endAngle = startAngle + visitedAngle;
        
        const startAngleRad = (startAngle * Math.PI) / 180;
        const endAngleRad = (endAngle * Math.PI) / 180;
        
        const startX = centerX + radius * Math.cos(startAngleRad);
        const startY = centerY + radius * Math.sin(startAngleRad);
        const endX = centerX + radius * Math.cos(endAngleRad);
        const endY = centerY + radius * Math.sin(endAngleRad);
        
        const largeArcFlag = visitedAngle > 180 ? 1 : 0;
        
        const pathData = [
            `M ${centerX} ${centerY}`,
            `L ${startX} ${startY}`,
            `A ${radius} ${radius} 0 ${largeArcFlag} 1 ${endX} ${endY}`,
            'Z'
        ].join(' ');
        
        pieSliceHtml = `<path d="${pathData}" fill="#E67E22" opacity="0.9"/>`;
    }
    
    // Determine colors based on visited status - Blue/Orange colorblind-friendly scheme
    let backgroundColor, borderColor;
    if (visitedCount === 0) {
        // No visited nodes - blue
        backgroundColor = '#3498DB';
        borderColor = '#2980B9';
    } else if (visitedCount === totalNodes) {
        // All visited - orange
        backgroundColor = '#E67E22';
        borderColor = '#D35400';
    } else {
        // Partially visited - blue base (same as unvisited) with orange pie slice overlay
        backgroundColor = '#3498DB';
        borderColor = '#2980B9';
    }

    const markerHtml = `
        <div class="cluster-marker-container">
            <svg width="40" height="40" class="cluster-pie-chart">
                <circle cx="20" cy="20" r="18" fill="${backgroundColor}" stroke="${borderColor}" stroke-width="2"/>
                ${pieSliceHtml}
                <text x="20" y="20" text-anchor="middle" dominant-baseline="central" 
                      fill="white" font-size="14" font-weight="bold" 
                      stroke="black" stroke-width="0.5">${totalNodes}</text>
            </svg>
        </div>
    `;
    
    const marker = L.marker([cluster.lat, cluster.lng], {
        icon: L.divIcon({
            html: markerHtml,
            className: 'custom-cluster-icon',
            iconSize: [40, 40],
            iconAnchor: [20, 20]
        })
    }).addTo(map);
    
    // Click handler to zoom in on cluster
    marker.on('click', () => {
        const currentZoom = map.getZoom();
        map.setView([cluster.lat, cluster.lng], Math.min(currentZoom + 2, 18));
    });
    
    // Enhanced tooltip with visited info
    const visitedInfo = hasVisitedNodes ? 
        `<small>🟢 ${visitedCount} van ${cluster.count} bezocht</small><br>` : 
        '';
    
    const tooltipContent = `
        <div style="text-align: center; min-width: 140px;">
            <strong>🎯 ${cluster.count} knooppunten</strong><br>
            ${visitedInfo}
            ${cluster.nodes && cluster.nodes.length > 0 ? 
                `<small>${cluster.nodes.slice(0, 3).map(n => n.name || `${n.id}`).join(', ')}${cluster.nodes.length > 3 ? '...' : ''}</small><br>` : 
                ''}
            <small>🔍 Klik om in te zoomen</small>
        </div>
    `;
    
    marker.bindTooltip(tooltipContent, {
        permanent: false,
        direction: 'top',
        offset: [0, -15],
        className: 'custom-tooltip'
    });
    
    // Use cluster ID as key for markers  
    markers.set(cluster.id, marker);
}

// Toggle node selection (handles grouped nodes)
function toggleKnooppuntVisited(id) {
    const clickedNode = knooppunten.get(id);
    if (!clickedNode) return;
    
    // Find all grouped nodes (same number, within 100m)
    const groupedNodes = findGroupedNodes(clickedNode);
    
    // Check if any of the grouped nodes are already visited
    const anyVisited = groupedNodes.some(node => visitedKnooppunten.has(node.osmId));
    
    if (anyVisited) {
        // Remove all grouped nodes from visited
        groupedNodes.forEach(node => {
            visitedKnooppunten.delete(node.osmId);
            updateMarkerStyle(node.osmId);
        });
        updateStatus(`📍 Knooppunt ${clickedNode.id} (${groupedNodes.length} nodes) gemarkeerd als niet bezocht`, 'info');
    } else {
        // Add all grouped nodes to visited
        groupedNodes.forEach(node => {
            visitedKnooppunten.add(node.osmId);
            updateMarkerStyle(node.osmId);
        });
        updateStatus(`✅ Knooppunt ${clickedNode.id} (${groupedNodes.length} nodes) gemarkeerd als bezocht`, 'success');
    }
    
    updateAllClusterStyles(); // Update cluster styling when visited status changes
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

// Update all cluster markers to reflect visited status changes
function updateAllClusterStyles() {
    // Check if we're currently in clustering mode (zoom level < 11)
    const currentZoom = map ? map.getZoom() : 0;
    
    if (currentZoom < 11) {
        // We're in clustering mode, reload the current view to refresh cluster styling
        // This ensures clusters get updated colors based on visited nodes
        setTimeout(() => {
            loadNodesForCurrentView();
        }, 100); // Small delay to ensure the visited status is fully processed
    }
}

// Update a single cluster marker's style based on visited nodes
function updateSingleClusterStyle(clusterId, clusterElement) {
    // This function is kept for potential future use if we decide to cache cluster data
    // For now, we rely on updateAllClusterStyles to reload the view
    return;
}

// Update selected points display
// Clear all visited nodes
function clearAllVisited() {
    if (visitedKnooppunten.size === 0) return;
    
    if (confirm('Wil je alle bezochte knooppunten wissen? Dit kan niet ongedaan gemaakt worden!')) {
        const oldVisited = [...visitedKnooppunten];
        visitedKnooppunten.clear();
        
        // Clear all markers from the map first
        clearAllMarkers();
        
        // Force reload by clearing bounds cache
        currentBounds = null;
        lastZoom = null;
        
        // Reload the map to refresh all markers and clusters
        loadNodesForCurrentView();
        
        updateStats();
        saveData();
        
        updateStatus('🗑️ Alle bezochte knooppunten gewist', 'success');
    }
}

// Remove individual visited node
function removeVisited(osmId) {
    const node = knooppunten.get(osmId);
    if (confirm(`Wil je knooppunt ${node?.id || 'dit knooppunt'} verwijderen uit bezochte lijst?`)) {
        visitedKnooppunten.delete(osmId);
        
        // Update marker styling
        updateMarkerStyle(osmId);
        updateAllClusterStyles(); // Update cluster styling when visited is removed
        updateStats();
        saveData();
        
        updateStatus('✅ Knooppunt verwijderd uit bezochte lijst', 'success');
    }
}

// Load total statistics from API
async function loadTotalStats() {
    try {
        const response = await fetch('/api/stats');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const stats = await response.json();
        totalNodesInNetherlands = stats.totalNodes;
        console.log(`📊 Total cycling nodes in Netherlands: ${totalNodesInNetherlands}`);
        
        // Update stats display immediately
        updateStats();
        
    } catch (error) {
        console.error('❌ Failed to load total stats:', error);
        // If we can't load total stats, fallback to old behavior (using loaded nodes)
        totalNodesInNetherlands = 0;
    }
}

// Update statistics
function updateStats() {
    const knooppuntenCount = visitedKnooppunten.size;
    const loadedCount = knooppunten.size;
    
    // Use total nodes in Netherlands if available, otherwise fall back to loaded nodes
    const totalForPercentage = totalNodesInNetherlands > 0 ? totalNodesInNetherlands : loadedCount;
    const completionRate = totalForPercentage > 0 ? Math.round((knooppuntenCount / totalForPercentage) * 100) : 0;
    
    document.getElementById('totalKnooppunten').textContent = knooppuntenCount;
    document.getElementById('loadedCount').textContent = loadedCount;
    
    const progressFill = document.getElementById('progressFill');
    const displayRate = Math.min(100, completionRate);
    progressFill.style.width = displayRate + '%';
    
    // Show total nodes info in percentage text when using Netherlands total
    if (totalNodesInNetherlands > 0) {
        progressFill.textContent = `${displayRate}% (${knooppuntenCount}/${totalNodesInNetherlands})`;
    } else {
        progressFill.textContent = displayRate + '%';
    }
}

// Draw route lines on map
// Export visited nodes to text format
function exportVisited() {
    console.log('Export function called. visitedKnooppunten size:', visitedKnooppunten.size);
    console.log('visitedKnooppunten contents:', Array.from(visitedKnooppunten));
    console.log('knooppunten Map size:', knooppunten.size);
    console.log('Sample knooppunten keys:', Array.from(knooppunten.keys()).slice(0, 5));
    
    if (visitedKnooppunten.size === 0) {
        updateStatus('⚠️ Geen bezochte knooppunten om te exporteren', 'error');
        return;
    }
    
    // Get visited nodes and sort by node number
    const visitedNodes = Array.from(visitedKnooppunten).map(osmId => {
        const node = knooppunten.get(osmId);
        if (!node) {
            console.log('WARNING: Node not found for osmId:', osmId);
        }
        return node;
    }).filter(node => node).sort((a, b) => a.id - b.id);
    
    console.log('Found visited nodes for export:', visitedNodes.length);
    
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

// Import visited nodes from JSON file
function importVisited() {
    const fileInput = document.getElementById('importFileInput');
    fileInput.click();
}

// Handle the imported file
function handleImportFile(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    if (!file.name.endsWith('.json')) {
        updateStatus('⚠️ Selecteer een geldig JSON bestand', 'error');
        return;
    }
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const importData = JSON.parse(e.target.result);
            
            // Validate the import data structure
            if (!importData.visitedNodes || !Array.isArray(importData.visitedNodes)) {
                updateStatus('⚠️ Ongeldig bestandsformaat - geen visitedNodes array gevonden', 'error');
                return;
            }
            
            // Count successful imports
            let successCount = 0;
            let duplicateCount = 0;
            let errorCount = 0;
            
            // Process each visited node
            importData.visitedNodes.forEach(nodeData => {
                try {
                    if (nodeData.osmId) {
                        // Check if already visited
                        if (visitedKnooppunten.has(nodeData.osmId)) {
                            duplicateCount++;
                        } else {
                            visitedKnooppunten.add(nodeData.osmId);
                            successCount++;
                        }
                    } else {
                        errorCount++;
                    }
                } catch (error) {
                    errorCount++;
                }
            });
            
            // Save the updated data to localStorage
            saveData();
            
            // Clear all markers and force refresh if any nodes were imported
            if (successCount > 0) {
                clearAllMarkers();
                currentBounds = null;
                lastZoom = null;
                loadNodesForCurrentView();
            }
            
            // Update the display
            updateStats();
            updateAllClusterStyles();
            
            // Show import results
            let message = `✅ Import voltooid: ${successCount} nieuwe knooppunten toegevoegd`;
            if (duplicateCount > 0) {
                message += `, ${duplicateCount} waren al bezocht`;
            }
            if (errorCount > 0) {
                message += `, ${errorCount} foutieve records overgeslagen`;
            }
            
            updateStatus(message, 'success');
            
        } catch (error) {
            updateStatus('❌ Fout bij lezen van bestand: ' + error.message, 'error');
        }
    };
    
    reader.onerror = function() {
        updateStatus('❌ Fout bij lezen van bestand', 'error');
    };
    
    reader.readAsText(file);
    
    // Reset the file input
    event.target.value = '';
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

// Helper function to clear all markers from the map
function clearAllMarkers() {
    markers.forEach(marker => map.removeLayer(marker));
    markers.clear();
}