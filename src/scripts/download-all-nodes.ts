#!/usr/bin/env node

import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CyclingNode, CyclingRoute } from '../types';

/**
 * Download Dutch cycling nodes or routes with rate limiting
 * This script downloads all fietsknooppunten with rcn_ref tag and/or cycling routes
 * in chunks to respect Overpass API rate limits and avoid timeouts
 * 
 * Usage:
 * - npm run download:nodes (downloads only nodes)
 * - npm run download:routes (downloads only routes)
 * - npm run download (downloads both nodes and routes)
 */

// Configuration
interface Config {
    NETHERLANDS_BBOX: [number, number, number, number]; // [south, west, north, east]
    GRID_SIZE: number;
    REQUEST_DELAY: number;
    RETRY_DELAY: number;
    MAX_RETRIES: number;
    OUTPUT_DIR: string;
    CHUNKS_DIR: string;
    RAW_DATA_FILE: string;
    ROUTE_RAW_DATA_FILE: string;
    LOG_FILE: string;
}

const CONFIG: Config = {
    NETHERLANDS_BBOX: [50.7, 3.2, 53.7, 7.3],
    GRID_SIZE: 8, // 8x8 = 64 chunks
    REQUEST_DELAY: 3000, // 3 seconds between requests
    RETRY_DELAY: 10000,  // 10 seconds on rate limit
    MAX_RETRIES: 3,
    OUTPUT_DIR: './data',
    CHUNKS_DIR: './data/chunks',
    RAW_DATA_FILE: 'raw-nodes-data.json',
    ROUTE_RAW_DATA_FILE: 'raw-routes-data.json',
    LOG_FILE: 'download.log'
};

// Statistics
interface Stats {
    chunksTotal: number;
    chunksCompleted: number;
    nodesTotal: number;
    requestsTotal: number;
    retriesTotal: number;
    startTime: Date;
    errors: string[];
}

const stats: Stats = {
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
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Log message with timestamp
 */
function log(message: string): void {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}`;
    console.log(logMessage);
}

/**
 * Ensure directory exists
 */
async function ensureDir(dirPath: string): Promise<void> {
    try {
        await fs.access(dirPath);
    } catch {
        await fs.mkdir(dirPath, { recursive: true });
    }
}

/**
 * Generate grid chunks for the Netherlands
 */
function generateGridChunks(): Array<{ id: string; bbox: [number, number, number, number] }> {
    const [south, west, north, east] = CONFIG.NETHERLANDS_BBOX;
    const latStep = (north - south) / CONFIG.GRID_SIZE;
    const lngStep = (east - west) / CONFIG.GRID_SIZE;
    
    const chunks: Array<{ id: string; bbox: [number, number, number, number] }> = [];
    
    for (let i = 0; i < CONFIG.GRID_SIZE; i++) {
        for (let j = 0; j < CONFIG.GRID_SIZE; j++) {
            const chunkSouth = south + (i * latStep);
            const chunkNorth = south + ((i + 1) * latStep);
            const chunkWest = west + (j * lngStep);
            const chunkEast = west + ((j + 1) * lngStep);
            
            chunks.push({
                id: `${i}_${j}`,
                bbox: [chunkSouth, chunkWest, chunkNorth, chunkEast]
            });
        }
    }
    
    return chunks;
}

/**
 * Download chunk with retry logic
 */
async function downloadChunk(chunk: { id: string; bbox: [number, number, number, number] }): Promise<CyclingNode[]> {
    const overpassQuery = `
        [out:json][timeout:180];
        (
          node["rcn_ref"](${chunk.bbox.join(',')});
        );
        out geom;
    `;
    
    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
        try {
            stats.requestsTotal++;
            log(`Downloading chunk ${chunk.id} (attempt ${attempt}/${CONFIG.MAX_RETRIES})`);
            
            const response = await axios.post('https://overpass-api.de/api/interpreter', overpassQuery, {
                timeout: 180000,
                headers: { 'Content-Type': 'text/plain' }
            });
            
            const data: any = response.data;
            const nodes: CyclingNode[] = (data.elements || []).map((element: any) => ({
                id: `node-${element.id}`, // Consistent prefix for node IDs
                lat: element.lat,
                lng: element.lon,
                osmId: element.id.toString(),
                name: element.tags?.name || `Node ${element.tags?.rcn_ref || element.id}`,
                ref: element.tags?.rcn_ref,
                network: element.tags?.network || 'rcn',
                operator: element.tags?.operator,
                description: element.tags?.description,
                note: element.tags?.note
            }));
            
            log(`Downloaded ${nodes.length} nodes from chunk ${chunk.id}`);
            return nodes;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log(`Error downloading chunk ${chunk.id} (attempt ${attempt}): ${errorMessage}`);
            
            if (attempt === CONFIG.MAX_RETRIES) {
                stats.errors.push(`Failed to download chunk ${chunk.id}: ${errorMessage}`);
                throw error;
            }
            
            stats.retriesTotal++;
            await sleep(CONFIG.RETRY_DELAY);
        }
    }
    
    return [];
}

/**
 * Download cycling routes chunk with retry logic
 */
async function downloadRoutesChunk(chunk: { id: string; bbox: [number, number, number, number] }): Promise<CyclingRoute[]> {
    const overpassQuery = `
        [out:json][timeout:180];
        (
          relation["route"="bicycle"]["network"~"rcn|lcn"](${chunk.bbox.join(',')});
          way["route"="bicycle"]["network"~"rcn|lcn"](${chunk.bbox.join(',')});
        );
        out geom;
    `;
    
    for (let attempt = 1; attempt <= CONFIG.MAX_RETRIES; attempt++) {
        try {
            stats.requestsTotal++;
            
            const response = await axios.post('https://overpass-api.de/api/interpreter', overpassQuery, {
                timeout: 300000, // 5 minutes
                headers: {
                    'Content-Type': 'text/plain',
                    'User-Agent': 'Dutch Cycling Routes Tracker'
                }
            });
            
            const responseData = response.data as any;
            if (!responseData || !responseData.elements) {
                log(`No routes data in chunk ${chunk.id}`);
                return [];
            }
            
            const routes: CyclingRoute[] = responseData.elements
                .filter((element: any) => element.type === 'relation' || element.type === 'way')
                .map((element: any) => {
                    // Extract geometry from relation or way
                    let geometry: Array<{ lat: number; lng: number }> = [];
                    
                    if (element.type === 'way' && element.geometry) {
                        geometry = element.geometry.map((point: any) => ({
                            lat: point.lat,
                            lng: point.lon
                        }));
                    } else if (element.type === 'relation' && element.members) {
                        // For relations, we'd need to resolve member ways, but that's complex
                        // For now, just use the first member's geometry if available
                        const firstWay = element.members.find((member: any) => member.type === 'way');
                        if (firstWay && firstWay.geometry) {
                            geometry = firstWay.geometry.map((point: any) => ({
                                lat: point.lat,
                                lng: point.lon
                            }));
                        }
                    }
                    
                    return {
                        id: `route-${element.id}`, // Consistent prefix for route IDs
                        name: element.tags?.name || element.tags?.ref || `Route ${element.id}`,
                        description: element.tags?.description,
                        geometry: geometry,
                        distance: element.tags?.distance ? parseFloat(element.tags.distance) : undefined,
                        difficulty: element.tags?.difficulty,
                        // Add compatibility fields for frontend
                        network: element.tags?.network || 'rcn',
                        wayId: element.type === 'way' ? element.id : undefined,
                        relationId: element.type === 'relation' ? element.id : undefined,
                        tags: element.tags || {}
                    } as any; // Cast to any to allow extra fields
                })
                .filter((route: CyclingRoute) => route.geometry.length > 0); // Only include routes with geometry
            
            log(`Downloaded ${routes.length} routes from chunk ${chunk.id}`);
            return routes;
            
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            log(`Error downloading routes chunk ${chunk.id} (attempt ${attempt}): ${errorMessage}`);
            
            if (attempt === CONFIG.MAX_RETRIES) {
                stats.errors.push(`Failed to download routes chunk ${chunk.id}: ${errorMessage}`);
                throw error;
            }
            
            stats.retriesTotal++;
            await sleep(CONFIG.RETRY_DELAY);
        }
    }
    
    return [];
}

/**
 * Main download function
 */
async function main(): Promise<void> {
    try {
        // Check command line arguments
        const args = process.argv.slice(2);
        const downloadRoutes = args.includes('routes') || (args.length === 0);
        const downloadNodes = args.includes('nodes') || (args.length === 0);
        
        if (downloadRoutes && !downloadNodes) {
            log('�️ Starting Dutch cycling routes download...');
        } else if (downloadNodes && !downloadRoutes) {
            log('�🚴‍♀️ Starting Dutch cycling nodes download...');
        } else {
            log('🚴‍♀️🛣️ Starting Dutch cycling nodes and routes download...');
        }
        
        // Ensure directories exist
        await ensureDir(CONFIG.OUTPUT_DIR);
        await ensureDir(CONFIG.CHUNKS_DIR);
        
        // Generate chunks
        const chunks = generateGridChunks();
        stats.chunksTotal = chunks.length;
        log(`Generated ${chunks.length} chunks for download`);
        
        // Download nodes if requested
        if (downloadNodes) {
            const allNodes: CyclingNode[] = [];
            const nodeChunkInfos: Array<{ id: string; bounds: [number, number, number, number]; nodeCount: number }> = [];
            
            log('📍 Downloading cycling nodes...');
            for (const chunk of chunks) {
                try {
                    const nodes = await downloadChunk(chunk);
                    allNodes.push(...nodes);
                    stats.nodesTotal += nodes.length;
                    stats.chunksCompleted++;
                    
                    // Save individual chunk file
                    const chunkFileName = `nodes-chunk-${chunk.id}.json`;
                    const chunkFilePath = path.join(CONFIG.CHUNKS_DIR, chunkFileName);
                    const chunkData = {
                        id: chunk.id,
                        bounds: chunk.bbox,
                        nodes: nodes,
                        count: nodes.length
                    };
                    await fs.writeFile(chunkFilePath, JSON.stringify(chunkData, null, 2));
                    
                    // Add to chunk index
                    nodeChunkInfos.push({
                        id: chunk.id,
                        bounds: chunk.bbox,
                        nodeCount: nodes.length
                    });
                    
                    log(`Progress: ${stats.chunksCompleted}/${stats.chunksTotal} chunks, ${stats.nodesTotal} nodes total`);
                    log(`Saved chunk ${chunk.id} with ${nodes.length} nodes to ${chunkFileName}`);
                    
                    // Rate limiting delay
                    if (stats.chunksCompleted < stats.chunksTotal) {
                        await sleep(CONFIG.REQUEST_DELAY);
                    }
                    
                } catch (error) {
                    log(`Skipping failed chunk ${chunk.id}`);
                    // Continue with next chunk
                }
            }
            
            // Create nodes chunk index file
            const nodeChunkIndex = {
                version: "1.0",
                generatedAt: new Date().toISOString(),
                totalChunks: nodeChunkInfos.length,
                totalNodes: stats.nodesTotal,
                chunks: nodeChunkInfos
            };
            
            const nodeChunkIndexPath = path.join(CONFIG.OUTPUT_DIR, 'nodes-chunk-index.json');
            await fs.writeFile(nodeChunkIndexPath, JSON.stringify(nodeChunkIndex, null, 2));
            log(`📋 Saved nodes chunk index to: ${nodeChunkIndexPath}`);
            
            // Save combined nodes data
            const nodesOutputData = {
                metadata: {
                    downloadDate: new Date().toISOString(),
                    totalNodes: allNodes.length,
                    completedChunks: stats.chunksCompleted,
                    totalChunks: stats.chunksTotal,
                    errors: stats.errors
                },
                nodes: allNodes
            };
            
            const nodesOutputPath = path.join(CONFIG.OUTPUT_DIR, CONFIG.RAW_DATA_FILE);
            await fs.writeFile(nodesOutputPath, JSON.stringify(nodesOutputData, null, 2));
            log(`📁 Nodes data saved to: ${nodesOutputPath}`);
        }
        
        // Download routes if requested
        let allRoutes: CyclingRoute[] = [];
        if (downloadRoutes) {
            const routeChunkInfos: Array<{ id: string; bounds: [number, number, number, number]; routeCount: number }> = [];
            
            // Reset stats for routes
            const routeStats = { chunksCompleted: 0, routesTotal: 0 };
            
            log('🛣️ Downloading cycling routes...');
            for (const chunk of chunks) {
                try {
                    const routes = await downloadRoutesChunk(chunk);
                    allRoutes.push(...routes);
                    routeStats.routesTotal += routes.length;
                    routeStats.chunksCompleted++;
                    
                    // Save individual route chunk file
                    const chunkFileName = `routes-chunk-${chunk.id}.json`;
                    const chunkFilePath = path.join(CONFIG.CHUNKS_DIR, chunkFileName);
                    const chunkData = {
                        id: chunk.id,
                        bounds: chunk.bbox,
                        routes: routes,
                        count: routes.length
                    };
                    await fs.writeFile(chunkFilePath, JSON.stringify(chunkData, null, 2));
                    
                    // Add to chunk index
                    routeChunkInfos.push({
                        id: chunk.id,
                        bounds: chunk.bbox,
                        routeCount: routes.length
                    });
                    
                    log(`Routes Progress: ${routeStats.chunksCompleted}/${stats.chunksTotal} chunks, ${routeStats.routesTotal} routes total`);
                    log(`Saved route chunk ${chunk.id} with ${routes.length} routes to ${chunkFileName}`);
                    
                    // Rate limiting delay
                    if (routeStats.chunksCompleted < stats.chunksTotal) {
                        await sleep(CONFIG.REQUEST_DELAY);
                    }
                    
                } catch (error) {
                    log(`Skipping failed routes chunk ${chunk.id}`);
                    // Continue with next chunk
                }
            }
            
            // Create routes chunk index file
            const routeChunkIndex = {
                version: "1.0",
                generatedAt: new Date().toISOString(),
                totalChunks: routeChunkInfos.length,
                totalRoutes: routeStats.routesTotal,
                chunks: routeChunkInfos
            };
            
            const routeChunkIndexPath = path.join(CONFIG.OUTPUT_DIR, 'route-chunk-index.json');
            await fs.writeFile(routeChunkIndexPath, JSON.stringify(routeChunkIndex, null, 2));
            log(`📋 Saved routes chunk index to: ${routeChunkIndexPath}`);
            
            // Save combined routes data
            const routesOutputData = {
                metadata: {
                    downloadDate: new Date().toISOString(),
                    totalRoutes: allRoutes.length,
                    completedChunks: routeStats.chunksCompleted,
                    totalChunks: stats.chunksTotal,
                    errors: stats.errors
                },
                routes: allRoutes
            };
            
            const routesOutputPath = path.join(CONFIG.OUTPUT_DIR, CONFIG.ROUTE_RAW_DATA_FILE);
            await fs.writeFile(routesOutputPath, JSON.stringify(routesOutputData, null, 2));
            log(`📁 Routes data saved to: ${routesOutputPath}`);
        }
        
        const endTime = new Date();
        const duration = (endTime.getTime() - stats.startTime.getTime()) / 1000;
        
        log(`✅ Download completed!`);
        log(`📊 Statistics:`);
        if (downloadNodes) {
            log(`   - Total nodes: ${stats.nodesTotal}`);
        }
        if (downloadRoutes) {
            log(`   - Total routes: ${allRoutes.length}`);
        }
        log(`   - Completed chunks: ${stats.chunksCompleted}/${stats.chunksTotal}`);
        log(`   - Total requests: ${stats.requestsTotal}`);
        log(`   - Total retries: ${stats.retriesTotal}`);
        log(`   - Duration: ${duration}s`);
        log(`   - Errors: ${stats.errors.length}`);
        
    } catch (error) {
        log(`❌ Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(console.error);
}

export { main as downloadAllNodes };
