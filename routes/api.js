const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const router = express.Router();

// Configuration
const DATA_DIR = path.join(__dirname, '..', 'data');
const RAW_DATA_FILE = 'raw-nodes-data.json';
const GEOJSON_FILE = 'nederlandse-fietsknooppunten-volledig.geojson';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours for local data

// In-memory cache
let cyclingNodesCache = null;
let cacheTimestamp = null;

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
        
        const nodes = await filterNodesByBounds(bounds.south, bounds.west, bounds.north, bounds.east);
        
        res.json({
            bounds: bounds,
            nodes: nodes,
            count: nodes.length,
            source: 'Local data file (filtered by bounds)'
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
        
        // For local data, we don't need actual chunking since filtering is fast
        const nodes = await filterNodesByBounds(bounds.south, bounds.west, bounds.north, bounds.east);
        
        res.json({
            bounds: bounds,
            nodes: nodes,
            count: nodes.length,
            chunks: 1, // Simulate single chunk for compatibility
            totalNodesBeforeDedup: nodes.length,
            source: 'Local data file (chunked endpoint - no actual chunking needed)'
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
 * Get cycling nodes for a specific region (filtered from local data)
 */
router.get('/cycling-nodes/:region', async (req, res) => {
    const region = req.params.region.toLowerCase();
    
    // Define regional bounding boxes for the Netherlands
    const regions = {
        'noord-holland': [52.2, 4.5, 52.6, 5.2],
        'zuid-holland': [51.8, 4.0, 52.2, 4.7],
        'utrecht': [51.9, 4.9, 52.2, 5.4],
        'gelderland': [51.7, 5.4, 52.5, 6.8],
        'noord-brabant': [51.3, 4.7, 51.8, 5.9],
        'limburg': [50.7, 5.7, 51.5, 6.2],
        'zeeland': [51.2, 3.2, 51.7, 4.2],
        'friesland': [52.8, 5.4, 53.5, 6.2],
        'groningen': [53.0, 6.2, 53.5, 7.2],
        'drenthe': [52.5, 6.2, 53.2, 7.0],
        'overijssel': [52.0, 6.0, 52.8, 6.9],
        'flevoland': [52.3, 5.2, 52.6, 5.8]
    };

    const bbox = regions[region];
    if (!bbox) {
        return res.status(400).json({ 
            error: 'Unknown region', 
            available: Object.keys(regions) 
        });
    }

    try {
        console.log(`📍 Loading nodes for region: ${region}`);
        
        // Filter local data by region bounds
        const nodes = await filterNodesByBounds(bbox[0], bbox[1], bbox[2], bbox[3]);
        
        // Add region info to nodes
        const regionalNodes = nodes.map(node => ({
            ...node,
            region: region
        }));

        res.json({
            region: region,
            nodes: regionalNodes,
            count: regionalNodes.length,
            bbox: bbox,
            source: 'Local data file (filtered by region)'
        });

    } catch (error) {
        console.error(`❌ Error fetching nodes for ${region}:`, error.message);
        res.status(500).json({
            error: 'Failed to fetch regional nodes',
            region: region,
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

/**
 * Fallback nodes for when API is unavailable
 */
function getFallbackNodes() {
    return {
        nodes: [
            {id: 12, lat: 52.0907, lng: 5.1214, name: "Knooppunt 12", osmId: null},
            {id: 15, lat: 52.0845, lng: 5.1456, name: "Knooppunt 15", osmId: null},
            {id: 23, lat: 52.0756, lng: 5.1623, name: "Knooppunt 23", osmId: null},
            {id: 34, lat: 52.0623, lng: 5.1789, name: "Knooppunt 34", osmId: null},
            {id: 45, lat: 52.0534, lng: 5.1967, name: "Knooppunt 45", osmId: null},
            {id: 67, lat: 52.3702, lng: 4.8952, name: "Knooppunt 67", osmId: null},
            {id: 78, lat: 52.1590, lng: 4.4970, name: "Knooppunt 78", osmId: null},
            {id: 89, lat: 51.8423, lng: 4.6081, name: "Knooppunt 89", osmId: null},
            {id: 91, lat: 51.6978, lng: 5.3037, name: "Knooppunt 91", osmId: null}
        ],
        count: 9,
        source: 'Fallback data',
        warning: 'Limited demo dataset - API unavailable'
    };
}

module.exports = router;