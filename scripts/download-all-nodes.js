#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

/**
 * Download all Dutch cycling nodes with rate limiting
 * This script downloads all fietsknooppunten from the Netherlands in chunks
 * to respect Overpass API rate limits and avoid timeouts
 */

// Configuration
const CONFIG = {
    // Netherlands bounding box [south, west, north, east]
    NETHERLANDS_BBOX: [50.7, 3.2, 53.7, 7.3],
    
    // Grid configuration - split Netherlands into smaller chunks
    GRID_SIZE: 8, // 8x8 = 64 chunks
    
    // Rate limiting
    REQUEST_DELAY: 3000, // 3 seconds between requests
    RETRY_DELAY: 10000,  // 10 seconds on rate limit
    MAX_RETRIES: 3,
    
    // File paths
    OUTPUT_DIR: './data',
    GEOJSON_FILE: 'nederlandse-fietsknooppunten-volledig.geojson',
    RAW_DATA_FILE: 'raw-nodes-data.json',
    LOG_FILE: 'download.log'
};

// Statistics
const stats = {
    chunksTotal: 0,
    chunksCompleted: 0,
    nodesTotal: 0,
    requestsTotal: 0,
    retriesTotal: 0,
    startTime: new Date(),
    errors: []
};

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Log message with timestamp
 */
function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}`;
    console.log(logMessage);
    
    // Also write to log file (async, don't await)
    fs.appendFile(path.join(CONFIG.OUTPUT_DIR, CONFIG.LOG_FILE), logMessage + '\n')
        .catch(err => console.error('Failed to write to log file:', err));
}

/**
 * Create output directory
 */
async function ensureOutputDir() {
    try {
        await fs.mkdir(CONFIG.OUTPUT_DIR, { recursive: true });
        log(`Created output directory: ${CONFIG.OUTPUT_DIR}`);
    } catch (error) {
        log(`Failed to create output directory: ${error.message}`, 'ERROR');
        throw error;
    }
}

/**
 * Generate grid chunks for the Netherlands
 */
function generateChunks() {
    const [south, west, north, east] = CONFIG.NETHERLANDS_BBOX;
    const latStep = (north - south) / CONFIG.GRID_SIZE;
    const lonStep = (east - west) / CONFIG.GRID_SIZE;
    
    const chunks = [];
    
    for (let i = 0; i < CONFIG.GRID_SIZE; i++) {
        for (let j = 0; j < CONFIG.GRID_SIZE; j++) {
            const chunkSouth = south + (i * latStep);
            const chunkNorth = south + ((i + 1) * latStep);
            const chunkWest = west + (j * lonStep);
            const chunkEast = west + ((j + 1) * lonStep);
            
            chunks.push({
                id: i * CONFIG.GRID_SIZE + j + 1,
                bounds: [chunkSouth, chunkWest, chunkNorth, chunkEast],
                name: `Chunk ${i * CONFIG.GRID_SIZE + j + 1}/${CONFIG.GRID_SIZE * CONFIG.GRID_SIZE}`
            });
        }
    }
    
    stats.chunksTotal = chunks.length;
    log(`Generated ${chunks.length} chunks (${CONFIG.GRID_SIZE}x${CONFIG.GRID_SIZE} grid)`);
    return chunks;
}

/**
 * Fetch nodes for a specific bounding box with retries
 */
async function fetchChunkWithRetry(chunk, retryCount = 0) {
    const [south, west, north, east] = chunk.bounds;
    
    const overpassQuery = `
        [out:json][timeout:30][maxsize:536870912];
        (
            node["rcn_ref"]["network"="rcn"](${south},${west},${north},${east});
            node["rcn_ref"]["network:type"="node_network"](${south},${west},${north},${east});
        );
        out geom;
    `;

    try {
        stats.requestsTotal++;
        log(`Fetching ${chunk.name}: [${south.toFixed(3)}, ${west.toFixed(3)}, ${north.toFixed(3)}, ${east.toFixed(3)}]`);
        
        const response = await axios.post(
            'https://overpass-api.de/api/interpreter',
            `data=${encodeURIComponent(overpassQuery)}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Nederlandse-Fietsknooppunten-Downloader/1.0'
                },
                timeout: 45000 // 45 second timeout
            }
        );

        const nodes = response.data.elements
            .filter(element => element.tags && element.tags.rcn_ref)
            .map(element => {
                const nodeId = parseInt(element.tags.rcn_ref);
                if (isNaN(nodeId)) return null;

                return {
                    id: nodeId,
                    lat: element.lat,
                    lng: element.lon,
                    osmId: element.id,
                    name: element.tags.name || `Knooppunt ${nodeId}`,
                    description: element.tags.description || null,
                    note: element.tags.note || null,
                    operator: element.tags.operator || null,
                    network: element.tags.network || 'rcn',
                    ref: element.tags.rcn_ref,
                    place: element.tags.place || null,
                    addr_city: element.tags['addr:city'] || null,
                    addr_village: element.tags['addr:village'] || null,
                    // Add chunk info for debugging
                    _chunk: chunk.id,
                    _bounds: chunk.bounds
                };
            })
            .filter(node => node !== null);

        stats.nodesTotal += nodes.length;
        stats.chunksCompleted++;
        
        log(`✅ ${chunk.name}: Found ${nodes.length} nodes (Total: ${stats.nodesTotal})`);
        return nodes;

    } catch (error) {
        stats.errors.push({
            chunk: chunk.name,
            error: error.message,
            timestamp: new Date().toISOString(),
            retryCount
        });

        if (error.response?.status === 429 || error.response?.status === 504) {
            // Rate limited or gateway timeout
            if (retryCount < CONFIG.MAX_RETRIES) {
                stats.retriesTotal++;
                const delay = CONFIG.RETRY_DELAY * (retryCount + 1);
                log(`⚠️ Rate limited/timeout for ${chunk.name}, retrying in ${delay/1000}s (attempt ${retryCount + 1}/${CONFIG.MAX_RETRIES})`, 'WARN');
                await sleep(delay);
                return fetchChunkWithRetry(chunk, retryCount + 1);
            }
        }

        log(`❌ Failed ${chunk.name} after ${retryCount + 1} attempts: ${error.message}`, 'ERROR');
        return []; // Return empty array to continue with other chunks
    }
}

/**
 * Remove duplicate nodes based on OSM ID
 */
function deduplicateNodes(allNodes) {
    log(`Deduplicating ${allNodes.length} nodes...`);
    
    const uniqueNodes = Array.from(
        new Map(allNodes.map(node => [node.osmId, node])).values()
    );
    
    const duplicatesRemoved = allNodes.length - uniqueNodes.length;
    log(`Removed ${duplicatesRemoved} duplicates, ${uniqueNodes.length} unique nodes remaining`);
    
    return uniqueNodes.sort((a, b) => a.id - b.id);
}

/**
 * Convert nodes to GeoJSON format
 */
function createGeoJSON(nodes) {
    log('Converting to GeoJSON format...');
    
    return {
        type: "FeatureCollection",
        metadata: {
            title: "Nederlandse Fietsknooppunten - Volledige Dataset",
            description: "Alle fietsknooppunten van Nederland uit OpenStreetMap",
            downloadDate: new Date().toISOString(),
            totalFeatures: nodes.length,
            source: "OpenStreetMap via Overpass API",
            network: "rcn (Regionaal Cycle Network)",
            bounds: CONFIG.NETHERLANDS_BBOX,
            downloadStats: {
                chunksTotal: stats.chunksTotal,
                chunksCompleted: stats.chunksCompleted,
                requestsTotal: stats.requestsTotal,
                retriesTotal: stats.retriesTotal,
                errorsCount: stats.errors.length,
                downloadDurationMinutes: Math.round((new Date() - stats.startTime) / 60000)
            }
        },
        features: nodes.map(node => ({
            type: "Feature",
            properties: {
                id: node.id,
                osmId: node.osmId,
                name: node.name,
                network: node.network,
                ref: node.ref,
                description: node.description,
                note: node.note,
                operator: node.operator,
                place: node.place,
                addr_city: node.addr_city,
                addr_village: node.addr_village
            },
            geometry: {
                type: "Point",
                coordinates: [node.lng, node.lat]
            }
        }))
    };
}

/**
 * Save data to files
 */
async function saveData(nodes) {
    log('Saving data to files...');
    
    try {
        // Save raw nodes data
        const rawDataPath = path.join(CONFIG.OUTPUT_DIR, CONFIG.RAW_DATA_FILE);
        await fs.writeFile(rawDataPath, JSON.stringify(nodes, null, 2));
        log(`✅ Saved raw data: ${rawDataPath}`);
        
        // Save GeoJSON
        const geoJSON = createGeoJSON(nodes);
        const geoJsonPath = path.join(CONFIG.OUTPUT_DIR, CONFIG.GEOJSON_FILE);
        await fs.writeFile(geoJsonPath, JSON.stringify(geoJSON, null, 2));
        log(`✅ Saved GeoJSON: ${geoJsonPath}`);
        
        // Save statistics
        const statsPath = path.join(CONFIG.OUTPUT_DIR, 'download-stats.json');
        await fs.writeFile(statsPath, JSON.stringify(stats, null, 2));
        log(`✅ Saved statistics: ${statsPath}`);
        
    } catch (error) {
        log(`❌ Failed to save files: ${error.message}`, 'ERROR');
        throw error;
    }
}

/**
 * Main download function
 */
async function downloadAllNodes() {
    try {
        log('🚴‍♀️ Starting download of all Dutch cycling nodes...');
        log(`Configuration: ${CONFIG.GRID_SIZE}x${CONFIG.GRID_SIZE} grid, ${CONFIG.REQUEST_DELAY/1000}s delay`);
        
        // Setup
        await ensureOutputDir();
        const chunks = generateChunks();
        
        // Download all chunks
        const allNodes = [];
        
        for (let i = 0; i < chunks.length; i++) {
            const chunk = chunks[i];
            const progress = `${i + 1}/${chunks.length}`;
            
            log(`📡 Processing chunk ${progress}: ${chunk.name}`);
            
            const nodes = await fetchChunkWithRetry(chunk);
            allNodes.push(...nodes);
            
            // Progress update
            const percentage = Math.round(((i + 1) / chunks.length) * 100);
            log(`📊 Progress: ${percentage}% (${stats.nodesTotal} nodes found so far)`);
            
            // Rate limiting delay (except for last chunk)
            if (i < chunks.length - 1) {
                log(`⏱️ Waiting ${CONFIG.REQUEST_DELAY/1000}s before next request...`);
                await sleep(CONFIG.REQUEST_DELAY);
            }
        }
        
        // Process results
        const uniqueNodes = deduplicateNodes(allNodes);
        await saveData(uniqueNodes);
        
        // Final statistics
        const duration = Math.round((new Date() - stats.startTime) / 60000);
        log('🎉 Download completed!');
        log(`📊 Final Statistics:`);
        log(`   - Total nodes: ${uniqueNodes.length}`);
        log(`   - Chunks processed: ${stats.chunksCompleted}/${stats.chunksTotal}`);
        log(`   - Total requests: ${stats.requestsTotal}`);
        log(`   - Retries: ${stats.retriesTotal}`);
        log(`   - Errors: ${stats.errors.length}`);
        log(`   - Duration: ${duration} minutes`);
        
        if (stats.errors.length > 0) {
            log(`⚠️ Errors occurred in ${stats.errors.length} chunks - check download-stats.json for details`, 'WARN');
        }
        
    } catch (error) {
        log(`❌ Download failed: ${error.message}`, 'ERROR');
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    downloadAllNodes().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = { downloadAllNodes, CONFIG };
