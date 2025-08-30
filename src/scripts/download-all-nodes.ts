#!/usr/bin/env node

import axios from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import { CyclingNode } from '../types';

/**
 * Download Dutch cycling nodes with rcn_ref with rate limiting
 * This script downloads all fietsknooppunten with rcn_ref tag regardless of network
 * in chunks to respect Overpass API rate limits and avoid timeouts
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
                id: element.id.toString(),
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
 * Main download function
 */
async function main(): Promise<void> {
    try {
        log('🚴‍♀️ Starting Dutch cycling nodes download...');
        
        // Ensure directories exist
        await ensureDir(CONFIG.OUTPUT_DIR);
        await ensureDir(CONFIG.CHUNKS_DIR);
        
        // Generate chunks
        const chunks = generateGridChunks();
        stats.chunksTotal = chunks.length;
        log(`Generated ${chunks.length} chunks for download`);
        
        const allNodes: CyclingNode[] = [];
        
        // Download chunks sequentially with rate limiting
        for (const chunk of chunks) {
            try {
                const nodes = await downloadChunk(chunk);
                allNodes.push(...nodes);
                stats.nodesTotal += nodes.length;
                stats.chunksCompleted++;
                
                log(`Progress: ${stats.chunksCompleted}/${stats.chunksTotal} chunks, ${stats.nodesTotal} nodes total`);
                
                // Rate limiting delay
                if (stats.chunksCompleted < stats.chunksTotal) {
                    await sleep(CONFIG.REQUEST_DELAY);
                }
                
            } catch (error) {
                log(`Skipping failed chunk ${chunk.id}`);
                // Continue with next chunk
            }
        }
        
        // Save combined data
        const outputData = {
            metadata: {
                downloadDate: new Date().toISOString(),
                totalNodes: allNodes.length,
                completedChunks: stats.chunksCompleted,
                totalChunks: stats.chunksTotal,
                errors: stats.errors
            },
            nodes: allNodes
        };
        
        const outputPath = path.join(CONFIG.OUTPUT_DIR, CONFIG.RAW_DATA_FILE);
        await fs.writeFile(outputPath, JSON.stringify(outputData, null, 2));
        
        const endTime = new Date();
        const duration = (endTime.getTime() - stats.startTime.getTime()) / 1000;
        
        log(`✅ Download completed!`);
        log(`📊 Statistics:`);
        log(`   - Total nodes: ${stats.nodesTotal}`);
        log(`   - Completed chunks: ${stats.chunksCompleted}/${stats.chunksTotal}`);
        log(`   - Total requests: ${stats.requestsTotal}`);
        log(`   - Total retries: ${stats.retriesTotal}`);
        log(`   - Duration: ${duration}s`);
        log(`   - Errors: ${stats.errors.length}`);
        log(`📁 Data saved to: ${outputPath}`);
        
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
