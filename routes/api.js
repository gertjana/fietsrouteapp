const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const { clusterNodesForBounds } = require('./clustering');
const router = express.Router();

// Configuration
const DATA_DIR = path.join(__dirname, '..', 'data');
const CHUNKS_DIR = path.join(DATA_DIR, 'chunks');
const RAW_DATA_FILE = 'raw-nodes-data.json';
const GEOJSON_FILE = 'nederlandse-fietsknooppunten-volledig.geojson';
const CHUNK_INDEX_FILE = 'chunk-index.json';
const ROUTE_CHUNK_INDEX_FILE = 'route-chunk-index.json';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours for local data

// In-memory cache
let cyclingNodesCache = null;
let cacheTimestamp = null;
let chunkIndex = null;
let routeChunkIndex = null;
let chunkCache = new Map(); // Cache for individual chunks
let routeChunkCache = new Map(); // Cache for route chunks

/**
 * Load chunk index
 */
async function loadChunkIndex() {
    if (chunkIndex) return chunkIndex;
    
    try {
        const indexPath = path.join(DATA_DIR, CHUNK_INDEX_FILE);
        const indexData = await fs.readFile(indexPath, 'utf8');
        chunkIndex = JSON.parse(indexData);
        console.log(`📂 Loaded chunk index with ${chunkIndex.totalChunks} chunks`);
        return chunkIndex;
    } catch (error) {
        console.log('📂 No chunk index found, falling back to legacy loading');
        return null;
    }
}

/**
 * Load specific chunk by ID
 */
async function loadChunk(chunkId) {
    try {
        // Check cache first
        if (chunkCache.has(chunkId)) {
            return chunkCache.get(chunkId);
        }
        
        const chunkPath = path.join(CHUNKS_DIR, `chunk-${chunkId}.json`);
        const chunkData = await fs.readFile(chunkPath, 'utf8');
        const chunk = JSON.parse(chunkData);
        
        // Cache the chunk
        chunkCache.set(chunkId, chunk);
        
        console.log(`📂 Loaded chunk ${chunkId} with ${chunk.count} nodes`);
        return chunk;
    } catch (error) {
        console.error(`❌ Failed to load chunk ${chunkId}:`, error.message);
        return null;
    }
}

/**
 * Find chunks that intersect with given bounds
 */
function findIntersectingChunks(south, west, north, east) {
    if (!chunkIndex) return [];
    
    const intersectingChunks = chunkIndex.chunks.filter(chunk => {
        const [chunkSouth, chunkWest, chunkNorth, chunkEast] = chunk.bounds;
        
        // Check if bounding boxes intersect
        return !(east < chunkWest || west > chunkEast || 
                north < chunkSouth || south > chunkNorth);
    });
    
    console.log(`🔍 Found ${intersectingChunks.length} intersecting chunks for bounds [${south}, ${west}, ${north}, ${east}]`);
    return intersectingChunks;
}

/**
 * Load nodes from chunks for given bounds
 */
async function loadNodesFromChunks(south, west, north, east) {
    try {
        await loadChunkIndex();
        
        if (!chunkIndex) {
            // Fallback to legacy loading
            return await filterNodesByBounds(south, west, north, east);
        }
        
        const intersectingChunks = findIntersectingChunks(south, west, north, east);
        const allNodes = [];
        
        for (const chunkInfo of intersectingChunks) {
            const chunk = await loadChunk(chunkInfo.id);
            if (chunk && chunk.nodes) {
                // Filter nodes within the requested bounds
                const filteredNodes = chunk.nodes.filter(node => {
                    return node.lat >= south && node.lat <= north &&
                           node.lng >= west && node.lng <= east;
                });
                allNodes.push(...filteredNodes);
            }
        }
        
        console.log(`📂 Loaded ${allNodes.length} nodes from ${intersectingChunks.length} chunks`);
        return allNodes;
        
    } catch (error) {
        console.error('❌ Error loading nodes from chunks:', error.message);
        // Fallback to legacy loading
        return await filterNodesByBounds(south, west, north, east);
    }
}

/**
 * Load route chunk index
 */
async function loadRouteChunkIndex() {
    if (routeChunkIndex) return routeChunkIndex;
    
    try {
        const indexPath = path.join(DATA_DIR, ROUTE_CHUNK_INDEX_FILE);
        const indexData = await fs.readFile(indexPath, 'utf8');
        routeChunkIndex = JSON.parse(indexData);
        console.log(`🛣️ Loaded route chunk index with ${routeChunkIndex.totalChunks} chunks`);
        return routeChunkIndex;
    } catch (error) {
        console.log('🛣️ No route chunk index found');
        return null;
    }
}

/**
 * Load specific route chunk by ID
 */
async function loadRouteChunk(chunkId) {
    try {
        // Check cache first
        if (routeChunkCache.has(chunkId)) {
            return routeChunkCache.get(chunkId);
        }
        
        const chunkPath = path.join(CHUNKS_DIR, `routes-chunk-${chunkId}.json`);
        const chunkData = await fs.readFile(chunkPath, 'utf8');
        const chunk = JSON.parse(chunkData);
        
        // Cache the chunk
        routeChunkCache.set(chunkId, chunk);
        console.log(`📂 Loaded route chunk ${chunkId} with ${chunk.routes ? chunk.routes.length : 0} routes`);
        
        return chunk;
    } catch (error) {
        console.error(`❌ Error loading route chunk ${chunkId}:`, error.message);
        return null;
    }
}

/**
 * Find intersecting route chunks for given bounds
 */
function findIntersectingRouteChunks(south, west, north, east) {
    if (!routeChunkIndex) return [];
    
    return routeChunkIndex.chunks.filter(chunk => {
        const [chunkSouth, chunkWest, chunkNorth, chunkEast] = chunk.bounds;
        
        // Check if bounding boxes intersect
        return !(east < chunkWest || west > chunkEast || 
                north < chunkSouth || south > chunkNorth);
    });
}

/**
 * Load routes from chunks for given bounds
 */
async function loadRoutesFromChunks(south, west, north, east, zoom = 11) {
    try {
        await loadRouteChunkIndex();
        
        if (!routeChunkIndex) {
            console.log('🛣️ No route chunks available');
            return [];
        }
        
        // Only load routes when not clustering (zoom 11+)
        if (zoom < 11) {
            console.log(`🛣️ Zoom level ${zoom} too low for route display, skipping routes`);
            return [];
        }
        
        const intersectingChunks = findIntersectingRouteChunks(south, west, north, east);
        const allRoutes = [];
        
        console.log(`🔍 Found ${intersectingChunks.length} intersecting route chunks for bounds [${south}, ${west}, ${north}, ${east}]`);
        
        for (const chunkInfo of intersectingChunks) {
            const chunk = await loadRouteChunk(chunkInfo.id);
            if (chunk && chunk.routes) {
                // Filter routes that have geometry within the requested bounds
                const filteredRoutes = chunk.routes.filter(route => {
                    if (!route.geometry || route.geometry.length === 0) return false;
                    
                    // Check if any point of the route is within bounds
                    return route.geometry.some(point => {
                        return point.lat >= south && point.lat <= north &&
                               point.lng >= west && point.lng <= east;
                    });
                });
                allRoutes.push(...filteredRoutes);
            }
        }
        
        console.log(`📂 Loaded ${allRoutes.length} routes from ${intersectingChunks.length} chunks`);
        return allRoutes;
        
    } catch (error) {
        console.error('❌ Error loading routes from chunks:', error.message);
        return [];
    }
}

/**
 * Load nodes from local files (raw JSON or GeoJSON)
 */
async function loadLocalNodes() {
    try {
        const rawDataPath = path.join(DATA_DIR, RAW_DATA_FILE);
        const geoJsonPath = path.join(DATA_DIR, GEOJSON_FILE);
        
        let nodes = [];
        let source = 'Unknown';
        let lastUpdated = 'Unknown';
        
        try {
            // Try to load raw data first (preferred format)
            console.log('📂 Loading from raw data file...');
            const rawData = await fs.readFile(rawDataPath, 'utf8');
            const data = JSON.parse(rawData);
            
            // Raw data format: { nodes: [...], metadata: {...} }
            nodes = data.nodes || data; // Support both formats
            source = 'Local raw data file';
            lastUpdated = data.metadata?.downloadDate || data.downloadDate || 'Unknown';
            
            console.log(`📂 Loaded ${nodes.length} nodes from local raw data`);
            
        } catch (rawError) {
            console.log('📂 Raw data not found, trying GeoJSON...');
            
            // Fallback to GeoJSON
            const geoJsonData = await fs.readFile(geoJsonPath, 'utf8');
            const geoJson = JSON.parse(geoJsonData);
            
            // Convert GeoJSON features back to node format
            nodes = geoJson.features.map(feature => ({
                id: feature.properties.id,
                lat: feature.geometry.coordinates[1], // GeoJSON is [lng, lat]
                lng: feature.geometry.coordinates[0],
                osmId: feature.properties.osmId,
                name: feature.properties.name,
                description: feature.properties.description,
                note: feature.properties.note,
                operator: feature.properties.operator,
                network: feature.properties.network,
                ref: feature.properties.ref,
                place: feature.properties.place,
                addr_city: feature.properties.addr_city,
                addr_village: feature.properties.addr_village
            }));
            
            source = 'Local GeoJSON file';
            lastUpdated = geoJson.metadata?.downloadDate || 'Unknown';
            
            console.log(`📂 Loaded ${nodes.length} nodes from local GeoJSON`);
        }
        
        return {
            nodes: nodes,
            count: nodes.length,
            source: source,
            lastUpdated: lastUpdated
        };
        
    } catch (error) {
        console.error('❌ Error loading local nodes:', error.message);
        throw new Error(`Failed to load local data: ${error.message}`);
    }
}

/**
 * Main endpoint - get all cycling nodes from local data
 */
router.get('/cycling-nodes', async (req, res) => {
    try {
        console.log('📍 Loading nodes for bounds:', req.query.south, req.query.west, req.query.north, req.query.east);
        
        // Check cache first
        if (cyclingNodesCache && cacheTimestamp && 
            (Date.now() - cacheTimestamp) < CACHE_DURATION) {
            console.log('💾 Serving from cache');
            return res.json(cyclingNodesCache);
        }
        
        // Load fresh data
        const data = await loadLocalNodes();
        
        // Update cache
        cyclingNodesCache = data;
        cacheTimestamp = Date.now();
        
        res.json(data);
        
    } catch (error) {
        console.error('❌ Error loading cycling nodes:', error.message);
        
        // Return error
        res.status(500).json({
            error: 'Failed to load cycling nodes from local data',
            message: error.message
        });
    }
});

/**
 * Filter local nodes by bounding box
 */
async function filterNodesByBounds(south, west, north, east) {
    try {
        // Load all nodes from cache or file
        let allNodes;
        if (cyclingNodesCache && cacheTimestamp && 
            (Date.now() - cacheTimestamp) < CACHE_DURATION) {
            allNodes = cyclingNodesCache.nodes;
        } else {
            const data = await loadLocalNodes();
            cyclingNodesCache = data;
            cacheTimestamp = Date.now();
            allNodes = data.nodes;
        }
        
        // Filter nodes within bounds
        const filteredNodes = allNodes.filter(node => {
            return node.lat >= south && 
                   node.lat <= north && 
                   node.lng >= west && 
                   node.lng <= east;
        });
        
        console.log(`🔍 Filtered ${filteredNodes.length} nodes from ${allNodes.length} total for bounds`);
        return filteredNodes;
        
    } catch (error) {
        console.error('❌ Error filtering nodes by bounds:', error.message);
        throw error;
    }
}

/**
 * Get cycling nodes within map bounds from local data
 */
router.get('/cycling-nodes/bounds/:south/:west/:north/:east', async (req, res) => {
    try {
        const { south, west, north, east } = req.params;
        
        // Validate bounds
        const bounds = {
            south: parseFloat(south),
            west: parseFloat(west),
            north: parseFloat(north),
            east: parseFloat(east)
        };
        
        if (Object.values(bounds).some(val => isNaN(val))) {
            return res.status(400).json({ 
                error: 'Invalid bounds parameters' 
            });
        }
        
        console.log(`📍 Loading nodes for bounds: ${south},${west},${north},${east}`);
        
        const nodes = await loadNodesFromChunks(bounds.south, bounds.west, bounds.north, bounds.east);
        
        res.json({
            bounds: bounds,
            nodes: nodes,
            count: nodes.length,
            source: chunkIndex ? 'Chunk-based loading' : 'Local data file (filtered by bounds)'
        });
        
    } catch (error) {
        console.error('❌ Error in bounds endpoint:', error.message);
        res.status(500).json({
            error: 'Failed to load nodes for bounds',
            message: error.message
        });
    }
});

/**
 * Get clustered cycling nodes within map bounds (RECOMMENDED)
 */
router.get('/cycling-nodes/clustered/:south/:west/:north/:east', async (req, res) => {
    try {
        const { south, west, north, east } = req.params;
        const zoom = req.query.zoom ? parseInt(req.query.zoom) : null;
        
        // Validate bounds
        const bounds = {
            south: parseFloat(south),
            west: parseFloat(west),
            north: parseFloat(north),
            east: parseFloat(east)
        };
        
        if (Object.values(bounds).some(val => isNaN(val))) {
            return res.status(400).json({ 
                error: 'Invalid bounds parameters' 
            });
        }
        
        console.log(`📍 Loading clustered nodes for bounds: ${south},${west},${north},${east} (zoom: ${zoom || 'auto'})`);
        
        const nodes = await loadNodesFromChunks(bounds.south, bounds.west, bounds.north, bounds.east);
        const clusteredData = clusterNodesForBounds(nodes, bounds.south, bounds.west, bounds.north, bounds.east, zoom);
        
        res.json({
            bounds: bounds,
            clusters: clusteredData.clusters,
            count: clusteredData.clusters.length,
            zoom: clusteredData.zoom,
            clusterDistance: clusteredData.clusterDistance,
            originalNodeCount: clusteredData.originalNodeCount,
            clusterCount: clusteredData.clusterCount,
            individualNodeCount: clusteredData.individualNodeCount,
            source: chunkIndex ? 'Chunk-based clustering' : 'Local data clustering'
        });
        
    } catch (error) {
        console.error('❌ Error in clustered bounds endpoint:', error.message);
        res.status(500).json({
            error: 'Failed to load clustered nodes for bounds',
            message: error.message
        });
    }
});

/**
 * Get cycling nodes within map bounds with chunked loading for large areas
 * (Now just returns filtered local data - chunking not needed for local files)
 */
router.get('/cycling-nodes/bounds-chunked/:south/:west/:north/:east', async (req, res) => {
    try {
        const { south, west, north, east } = req.params;
        
        // Validate bounds
        const bounds = {
            south: parseFloat(south),
            west: parseFloat(west),
            north: parseFloat(north),
            east: parseFloat(east)
        };
        
        if (Object.values(bounds).some(val => isNaN(val))) {
            return res.status(400).json({ 
                error: 'Invalid bounds parameters' 
            });
        }
        
        console.log(`📍 Chunked loading nodes for bounds: ${south},${west},${north},${east}`);
        
        const nodes = await loadNodesFromChunks(bounds.south, bounds.west, bounds.north, bounds.east);
        
        res.json({
            bounds: bounds,
            nodes: nodes,
            count: nodes.length,
            chunks: chunkIndex ? findIntersectingChunks(bounds.south, bounds.west, bounds.north, bounds.east).length : 1,
            totalNodesBeforeDedup: nodes.length,
            source: chunkIndex ? 'Chunk-based loading (chunked endpoint)' : 'Local data file (chunked endpoint - no actual chunking needed)'
        });
        
    } catch (error) {
        console.error('❌ Error in chunked bounds endpoint:', error.message);
        res.status(500).json({
            error: 'Failed to load nodes for chunked bounds',
            message: error.message
        });
    }
});

/**
 * Get cycling routes for given bounds (chunked loading)
 */
router.get('/cycling-routes/bounds/:south/:west/:north/:east', async (req, res) => {
    try {
        const bounds = {
            south: parseFloat(req.params.south),
            west: parseFloat(req.params.west),
            north: parseFloat(req.params.north),
            east: parseFloat(req.params.east)
        };
        
        const zoom = parseInt(req.query.zoom) || 11;
        
        console.log(`🛣️ Loading routes for bounds: ${bounds.south},${bounds.west},${bounds.north},${bounds.east} (zoom: ${zoom})`);
        
        const routes = await loadRoutesFromChunks(bounds.south, bounds.west, bounds.north, bounds.east, zoom);
        
        res.json({
            bounds: bounds,
            routes: routes,
            count: routes.length,
            zoom: zoom,
            source: 'Local route chunks'
        });

    } catch (error) {
        console.error('❌ Error fetching routes:', error.message);
        res.status(500).json({
            error: 'Failed to fetch routes',
            message: error.message
        });
    }
});

/**
 * Clear the cache (useful for development)
 */
router.delete('/cache', (req, res) => {
    cyclingNodesCache = null;
    cacheTimestamp = null;
    console.log('🗑️ Cache cleared');
    res.json({ message: 'Cache cleared successfully' });
});

/**
 * Get cache status
 */
router.get('/cache/status', (req, res) => {
    res.json({
        cached: !!cyclingNodesCache,
        cacheAge: cacheTimestamp ? Date.now() - cacheTimestamp : null,
        nodeCount: cyclingNodesCache ? cyclingNodesCache.count : 0,
        lastUpdated: cyclingNodesCache ? cyclingNodesCache.lastUpdated : null
    });
});

module.exports = router;