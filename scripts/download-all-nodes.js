#!/usr/bin/env node

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

/**
 * Download Dutch cycling nodes with rcn_ref with rate limiting
 * This script downloads all fietsknooppunten with rcn_ref tag regardless of network
 * in chunks to respect Overpass API rate limits and avoid timeouts
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
    CHUNKS_DIR: './data/chunks',
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
 * Create output directories
 */
async function ensureOutputDir() {
    try {
        await fs.mkdir(CONFIG.OUTPUT_DIR, { recursive: true });
        await fs.mkdir(CONFIG.CHUNKS_DIR, { recursive: true });
        log(`Created output directories: ${CONFIG.OUTPUT_DIR} and ${CONFIG.CHUNKS_DIR}`);
    } catch (error) {
        log(`Failed to create output directories: ${error.message}`, 'ERROR');
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
            node["rcn_ref"](${south},${west},${north},${east});
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
        
        // Save individual chunk
        await saveChunk(chunk, nodes);
        
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
 * Save individual chunk data
 */
async function saveChunk(chunk, nodes) {
    try {
        const chunkData = {
            id: chunk.id,
            name: chunk.name,
            bounds: chunk.bounds,
            nodes: nodes,
            count: nodes.length,
            downloadDate: new Date().toISOString()
        };
        
        const chunkPath = path.join(CONFIG.CHUNKS_DIR, `chunk-${chunk.id}.json`);
        await fs.writeFile(chunkPath, JSON.stringify(chunkData, null, 2));
        
        log(`💾 Saved chunk ${chunk.id}: ${nodes.length} nodes to ${chunkPath}`);
    } catch (error) {
        log(`❌ Failed to save chunk ${chunk.id}: ${error.message}`, 'ERROR');
        // Don't throw - this shouldn't stop the download process
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
            description: "Alle fietsknooppunten met rcn_ref van Nederland uit OpenStreetMap",
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
        
        // Create chunk index
        await createChunkIndex();
        
    } catch (error) {
        log(`❌ Failed to save files: ${error.message}`, 'ERROR');
        throw error;
    }
}

/**
 * Create chunk index file for API use
 */
async function createChunkIndex() {
    try {
        const [south, west, north, east] = CONFIG.NETHERLANDS_BBOX;
        const latStep = (north - south) / CONFIG.GRID_SIZE;
        const lonStep = (east - west) / CONFIG.GRID_SIZE;
        
        const chunks = [];
        
        for (let i = 0; i < CONFIG.GRID_SIZE; i++) {
            for (let j = 0; j < CONFIG.GRID_SIZE; j++) {
                const chunkId = i * CONFIG.GRID_SIZE + j + 1;
                const chunkSouth = south + (i * latStep);
                const chunkNorth = south + ((i + 1) * latStep);
                const chunkWest = west + (j * lonStep);
                const chunkEast = west + ((j + 1) * lonStep);
                
                chunks.push({
                    id: chunkId,
                    bounds: [chunkSouth, chunkWest, chunkNorth, chunkEast],
                    file: `chunk-${chunkId}.json`
                });
            }
        }
        
        const chunkIndex = {
            gridSize: CONFIG.GRID_SIZE,
            totalChunks: chunks.length,
            bounds: CONFIG.NETHERLANDS_BBOX,
            chunks: chunks,
            createdDate: new Date().toISOString()
        };
        
        const indexPath = path.join(CONFIG.OUTPUT_DIR, 'chunk-index.json');
        await fs.writeFile(indexPath, JSON.stringify(chunkIndex, null, 2));
        log(`✅ Created chunk index: ${indexPath}`);
        
    } catch (error) {
        log(`❌ Failed to create chunk index: ${error.message}`, 'ERROR');
        throw error;
    }
}

/**
 * Main download function
 */
async function downloadAllNodes() {
    try {
        log('🚴‍♀️ Starting download of Dutch cycling nodes with rcn_ref...');
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

/**
 * Fetch cycling routes for a specific bounding box with retries
 */
async function fetchRoutesChunkWithRetry(chunk, retryCount = 0) {
    const [south, west, north, east] = chunk.bounds;
    
    const overpassQuery = `
        [out:json][timeout:60][maxsize:536870912];
        (
            relation["route"="bicycle"]["network"~"^(rcn|lcn|ncn)$"](${south},${west},${north},${east});
            way(r)["highway"];
        );
        out geom;
    `;

    try {
        stats.requestsTotal++;
        log(`Fetching routes for ${chunk.name}: [${south.toFixed(3)}, ${west.toFixed(3)}, ${north.toFixed(3)}, ${east.toFixed(3)}]`);
        
        const response = await axios.post(
            'https://overpass-api.de/api/interpreter',
            `data=${encodeURIComponent(overpassQuery)}`,
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'User-Agent': 'Nederlandse-Fietsknooppunten-Routes-Downloader/1.0'
                },
                timeout: 90000 // 90 second timeout for routes
            }
        );

        const elements = response.data.elements;
        const relations = elements.filter(el => el.type === 'relation');
        const ways = elements.filter(el => el.type === 'way');
        
        const routes = [];
        
        for (const relation of relations) {
            if (!relation.tags || relation.tags.route !== 'bicycle') continue;
            
            const routeWays = relation.members
                .filter(member => member.type === 'way')
                .map(member => ways.find(way => way.id === member.ref))
                .filter(way => way && way.nodes);
            
            for (const way of routeWays) {
                if (!way.geometry || way.geometry.length < 2) continue;
                
                routes.push({
                    relationId: relation.id,
                    wayId: way.id,
                    name: relation.tags.name || relation.tags.ref || `Route ${relation.id}`,
                    network: relation.tags.network || 'unknown',
                    route: relation.tags.route,
                    geometry: way.geometry.map(point => ({
                        lat: point.lat,
                        lng: point.lon
                    })),
                    tags: {
                        highway: way.tags?.highway,
                        surface: way.tags?.surface,
                        lit: way.tags?.lit,
                        bicycle: way.tags?.bicycle,
                        cycleway: way.tags?.cycleway
                    }
                });
            }
        }

        log(`✅ ${chunk.name}: ${routes.length} route segments found`);
        
        return {
            chunkId: chunk.id,
            routes: routes,
            bounds: chunk.bounds,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        log(`❌ Error fetching routes for ${chunk.name}: ${error.message}`);
        
        if (error.response?.status === 429 || error.code === 'ECONNRESET') {
            if (retryCount < CONFIG.MAX_RETRIES) {
                log(`⏳ Rate limited, waiting ${CONFIG.RETRY_DELAY}ms before retry ${retryCount + 1}/${CONFIG.MAX_RETRIES}`);
                await sleep(CONFIG.RETRY_DELAY);
                return fetchRoutesChunkWithRetry(chunk, retryCount + 1);
            }
        }
        
        stats.errors.push({
            chunk: chunk.name,
            error: error.message,
            type: 'routes'
        });
        
        return {
            chunkId: chunk.id,
            routes: [],
            bounds: chunk.bounds,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

/**
 * Download all cycling routes in chunks and save them
 */
async function downloadAllRoutes() {
    try {
        log('🛣️ Starting download of Dutch cycling routes...');
        
        // Reset stats for routes
        stats.chunksTotal = 0;
        stats.chunksCompleted = 0;
        stats.requestsTotal = 0;
        stats.retriesTotal = 0;
        stats.startTime = new Date();
        stats.errors = [];

        // Create directories
        await fs.mkdir(CONFIG.OUTPUT_DIR, { recursive: true });
        await fs.mkdir(CONFIG.CHUNKS_DIR, { recursive: true });
        
        // Generate chunks
        const chunks = generateChunks();
        stats.chunksTotal = chunks.length;
        
        log(`📦 Processing ${chunks.length} chunks for routes...`);
        
        const routeChunks = [];
        
        // Download routes for each chunk
        for (const [index, chunk] of chunks.entries()) {
            log(`\n🔄 Processing chunk ${index + 1}/${chunks.length}: ${chunk.name}`);
            
            const chunkData = await fetchRoutesChunkWithRetry(chunk);
            routeChunks.push(chunkData);
            
            // Save individual chunk
            const chunkFilePath = path.join(CONFIG.CHUNKS_DIR, `routes-chunk-${chunk.id}.json`);
            await fs.writeFile(chunkFilePath, JSON.stringify(chunkData, null, 2));
            
            stats.chunksCompleted++;
            
            // Progress update
            const progress = ((index + 1) / chunks.length * 100).toFixed(1);
            log(`📊 Progress: ${progress}% (${stats.chunksCompleted}/${stats.chunksTotal})`);
            
            // Rate limiting - wait between requests
            if (index < chunks.length - 1) {
                log(`⏳ Waiting ${CONFIG.REQUEST_DELAY}ms before next request...`);
                await sleep(CONFIG.REQUEST_DELAY);
            }
        }
        
        // Create route chunk index
        const routeChunkIndex = {
            totalChunks: chunks.length,
            chunks: chunks.map(chunk => ({
                id: chunk.id,
                name: chunk.name,
                bounds: chunk.bounds,
                file: `routes-chunk-${chunk.id}.json`
            })),
            created: new Date().toISOString(),
            type: 'routes'
        };
        
        const routeIndexPath = path.join(CONFIG.OUTPUT_DIR, 'route-chunk-index.json');
        await fs.writeFile(routeIndexPath, JSON.stringify(routeChunkIndex, null, 2));
        
        // Calculate statistics
        const totalRoutes = routeChunks.reduce((sum, chunk) => sum + chunk.routes.length, 0);
        const elapsed = (new Date() - stats.startTime) / 1000;
        
        log('\n🎉 Route download completed!');
        log(`📊 Final Statistics:`);
        log(`   • Total chunks: ${stats.chunksTotal}`);
        log(`   • Completed chunks: ${stats.chunksCompleted}`);
        log(`   • Total route segments: ${totalRoutes.toLocaleString()}`);
        log(`   • Total requests: ${stats.requestsTotal}`);
        log(`   • Total retries: ${stats.retriesTotal}`);
        log(`   • Errors: ${stats.errors.length}`);
        log(`   • Time elapsed: ${elapsed.toFixed(1)} seconds`);
        log(`   • Average per chunk: ${(elapsed / stats.chunksCompleted).toFixed(2)} seconds`);
        
        if (stats.errors.length > 0) {
            log('\n⚠️ Errors encountered:');
            stats.errors.forEach(error => {
                log(`   • ${error.chunk}: ${error.error}`);
            });
        }
        
        log(`\n📁 Route data saved to:`);
        log(`   • Individual chunks: ${CONFIG.CHUNKS_DIR}/routes-chunk-*.json`);
        log(`   • Chunk index: ${routeIndexPath}`);
        
        return {
            totalRoutes,
            chunks: routeChunks.length,
            success: stats.errors.length === 0
        };
        
    } catch (error) {
        log(`💥 Fatal error in route download: ${error.message}`);
        console.error('Route download error:', error);
        throw error;
    }
}

// Run if called directly
if (require.main === module) {
    const command = process.argv[2];
    
    if (command === 'routes') {
        downloadAllRoutes().catch(error => {
            console.error('Fatal error downloading routes:', error);
            process.exit(1);
        });
    } else {
        downloadAllNodes().catch(error => {
            console.error('Fatal error downloading nodes:', error);
            process.exit(1);
        });
    }
}

module.exports = { downloadAllNodes, downloadAllRoutes, CONFIG };
