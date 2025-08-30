import express, { Request, Response, Router } from 'express';
import * as fs from 'fs/promises';
import * as path from 'path';
import { clusterNodesForBounds } from './clustering';
import { 
    CyclingNode, 
    NodeCluster, 
    ApiResponse, 
    ChunkIndex, 
    ChunkInfo, 
    Chunk, 
    RouteChunk, 
    CyclingRoute,
    BoundsParams 
} from '../types';

const router: Router = express.Router();

// Configuration
const DATA_DIR = path.join(process.cwd(), 'data');
const CHUNKS_DIR = path.join(DATA_DIR, 'chunks');
const RAW_DATA_FILE = 'raw-nodes-data.json';
const CHUNK_INDEX_FILE = 'nodes-chunk-index.json';
const ROUTE_CHUNK_INDEX_FILE = 'route-chunk-index.json';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours for local data

// In-memory cache
let cyclingNodesCache: ApiResponse<CyclingNode[]> | null = null;
let cacheTimestamp: number | null = null;
let chunkIndex: ChunkIndex | null = null;
let routeChunkIndex: ChunkIndex | null = null;
let chunkCache = new Map<string, Chunk>();
let routeChunkCache = new Map<string, RouteChunk>();

/**
 * Load chunk index
 */
async function loadChunkIndex(): Promise<ChunkIndex | null> {
    if (chunkIndex) return chunkIndex;
    
    try {
        const indexPath = path.join(DATA_DIR, CHUNK_INDEX_FILE);
        const indexData = await fs.readFile(indexPath, 'utf8');
        chunkIndex = JSON.parse(indexData) as ChunkIndex;
        return chunkIndex;
    } catch (error) {
        console.log('📂 No chunk index found, falling back to legacy loading');
        return null;
    }
}

/**
 * Load specific chunk by ID
 */
async function loadChunk(chunkId: string): Promise<Chunk | null> {
    try {
        // Check cache first
        if (chunkCache.has(chunkId)) {
            return chunkCache.get(chunkId)!;
        }
        
        const chunkPath = path.join(CHUNKS_DIR, `nodes-chunk-${chunkId}.json`);
        const chunkData = await fs.readFile(chunkPath, 'utf8');
        const chunk = JSON.parse(chunkData) as Chunk;
        
        // Cache the chunk
        chunkCache.set(chunkId, chunk);
        
        return chunk;
    } catch (error) {
        console.error(`❌ Failed to load chunk ${chunkId}:`, (error as Error).message);
        return null;
    }
}

/**
 * Find chunks that intersect with given bounds
 */
function findIntersectingChunks(south: number, west: number, north: number, east: number): ChunkInfo[] {
    if (!chunkIndex) return [];
    
    const intersectingChunks = chunkIndex.chunks.filter(chunk => {
        const [chunkSouth, chunkWest, chunkNorth, chunkEast] = chunk.bounds;
        
        // Check if bounding boxes intersect
        return !(east < chunkWest || west > chunkEast || 
                north < chunkSouth || south > chunkNorth);
    });
    
    return intersectingChunks;
}

/**
 * Load nodes from chunks for given bounds
 */
async function loadNodesFromChunks(south: number, west: number, north: number, east: number): Promise<CyclingNode[]> {
    try {
        await loadChunkIndex();
        
        if (!chunkIndex) {
            // Fallback to legacy loading
            return await filterNodesByBounds(south, west, north, east);
        }
        
        const intersectingChunks = findIntersectingChunks(south, west, north, east);
        const allNodes: CyclingNode[] = [];
        
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
        
        return allNodes;
        
    } catch (error) {
        console.error('❌ Error loading nodes from chunks:', (error as Error).message);
        // Fallback to legacy loading
        return await filterNodesByBounds(south, west, north, east);
    }
}

/**
 * Load route chunk index
 */
async function loadRouteChunkIndex(): Promise<ChunkIndex | null> {
    if (routeChunkIndex) return routeChunkIndex;
    
    try {
        const indexPath = path.join(DATA_DIR, ROUTE_CHUNK_INDEX_FILE);
        const indexData = await fs.readFile(indexPath, 'utf8');
        routeChunkIndex = JSON.parse(indexData) as ChunkIndex;
        return routeChunkIndex;
    } catch (error) {
        console.log('🛣️ No route chunk index found');
        return null;
    }
}

/**
 * Load specific route chunk by ID
 */
async function loadRouteChunk(chunkId: string): Promise<RouteChunk | null> {
    try {
        // Check cache first
        if (routeChunkCache.has(chunkId)) {
            return routeChunkCache.get(chunkId)!;
        }
        
        const chunkPath = path.join(CHUNKS_DIR, `routes-chunk-${chunkId}.json`);
        const chunkData = await fs.readFile(chunkPath, 'utf8');
        const chunk = JSON.parse(chunkData) as RouteChunk;
        
        // Cache the chunk
        routeChunkCache.set(chunkId, chunk);
        
        return chunk;
    } catch (error) {
        console.error(`❌ Error loading route chunk ${chunkId}:`, (error as Error).message);
        return null;
    }
}

/**
 * Find intersecting route chunks for given bounds
 */
function findIntersectingRouteChunks(south: number, west: number, north: number, east: number): ChunkInfo[] {
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
async function loadRoutesFromChunks(south: number, west: number, north: number, east: number, zoom: number = 11): Promise<CyclingRoute[]> {
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
        const allRoutes: CyclingRoute[] = [];
        
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
        
        return allRoutes;
        
    } catch (error) {
        console.error('❌ Error loading routes from chunks:', (error as Error).message);
        return [];
    }
}

/**
 * Load nodes from local files (raw JSON or GeoJSON)
 */
async function loadLocalNodes(): Promise<ApiResponse<CyclingNode[]>> {
    try {
        const rawDataPath = path.join(DATA_DIR, RAW_DATA_FILE);
        
        let nodes: CyclingNode[] = [];
        let source = 'Unknown';
        let lastUpdated = 'Unknown';
        
        try {
            console.log('📂 Loading from raw data file...');
            const rawData = await fs.readFile(rawDataPath, 'utf8');
            const data = JSON.parse(rawData);
            
            // Raw data format: { nodes: [...], metadata: {...} }
            nodes = data.nodes || data;
            source = 'Local raw data file';
            lastUpdated = data.metadata?.downloadDate || data.downloadDate || 'Unknown';
            
            console.log(`📂 Loaded ${nodes.length} nodes from local raw data`);
            
        } catch (rawError) {
            throw new Error(`Failed to load raw data: ${(rawError as Error).message}`);
        }
        
        return {
            nodes: nodes,
            count: nodes.length,
            source: source,
            lastUpdated: lastUpdated
        };
        
    } catch (error) {
        console.error('❌ Error loading local nodes:', (error as Error).message);
        throw new Error(`Failed to load local data: ${(error as Error).message}`);
    }
}

/**
 * Filter local nodes by bounding box
 */
async function filterNodesByBounds(south: number, west: number, north: number, east: number): Promise<CyclingNode[]> {
    try {
        // Load all nodes from cache or file
        let allNodes: CyclingNode[];
        if (cyclingNodesCache && cacheTimestamp && 
            (Date.now() - cacheTimestamp) < CACHE_DURATION) {
            allNodes = cyclingNodesCache.nodes || [];
        } else {
            const data = await loadLocalNodes();
            cyclingNodesCache = data;
            cacheTimestamp = Date.now();
            allNodes = data.nodes || [];
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
        console.error('❌ Error filtering nodes by bounds:', (error as Error).message);
        throw error;
    }
}

/**
 * Main endpoint - get all cycling nodes from local data
 */
router.get('/cycling-nodes', async (req: Request, res: Response): Promise<void> => {
    try {
        console.log('📍 Loading nodes for bounds:', req.query.south, req.query.west, req.query.north, req.query.east);
        
        // Check cache first
        if (cyclingNodesCache && cacheTimestamp && 
            (Date.now() - cacheTimestamp) < CACHE_DURATION) {
            console.log('💾 Serving from cache');
            res.json(cyclingNodesCache);
            return;
        }
        
        // Load fresh data
        const data = await loadLocalNodes();
        
        // Update cache
        cyclingNodesCache = data;
        cacheTimestamp = Date.now();
        
        res.json(data);
        
    } catch (error) {
        console.error('❌ Error loading cycling nodes:', (error as Error).message);
        
        res.status(500).json({
            error: 'Failed to load cycling nodes from local data',
            message: (error as Error).message
        });
    }
});

/**
 * Get cycling nodes within map bounds from local data
 */
router.get('/cycling-nodes/bounds/:south/:west/:north/:east', async (req: Request<BoundsParams>, res: Response): Promise<void> => {
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
            res.status(400).json({ 
                error: 'Invalid bounds parameters' 
            });
            return;
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
        console.error('❌ Error in bounds endpoint:', (error as Error).message);
        res.status(500).json({
            error: 'Failed to load nodes for bounds',
            message: (error as Error).message
        });
    }
});

/**
 * Get clustered cycling nodes within map bounds (RECOMMENDED)
 */
router.get('/cycling-nodes/clustered/:south/:west/:north/:east', async (req: Request<BoundsParams>, res: Response): Promise<void> => {
    try {
        const { south, west, north, east } = req.params;
        const zoom = req.query.zoom ? parseInt(req.query.zoom as string) : null;
        
        // Validate bounds
        const bounds = {
            south: parseFloat(south),
            west: parseFloat(west),
            north: parseFloat(north),
            east: parseFloat(east)
        };
        
        if (Object.values(bounds).some(val => isNaN(val))) {
            res.status(400).json({ 
                error: 'Invalid bounds parameters' 
            });
            return;
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
        console.error('❌ Error in clustered bounds endpoint:', (error as Error).message);
        res.status(500).json({
            error: 'Failed to load clustered nodes for bounds',
            message: (error as Error).message
        });
    }
});

/**
 * Get cycling routes for given bounds (chunked loading)
 */
router.get('/cycling-routes/bounds/:south/:west/:north/:east', async (req: Request<BoundsParams>, res: Response): Promise<void> => {
    try {
        const bounds = {
            south: parseFloat(req.params.south),
            west: parseFloat(req.params.west),
            north: parseFloat(req.params.north),
            east: parseFloat(req.params.east)
        };
        
        const zoom = parseInt((req.query.zoom as string) || '11');
        
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
        console.error('❌ Error fetching routes:', (error as Error).message);
        res.status(500).json({
            error: 'Failed to fetch routes',
            message: (error as Error).message
        });
    }
});

/**
 * Clear the cache (useful for development)
 */
router.delete('/cache', (req: Request, res: Response): void => {
    cyclingNodesCache = null;
    cacheTimestamp = null;
    console.log('🗑️ Cache cleared');
    res.json({ message: 'Cache cleared successfully' });
});

/**
 * Get total node statistics
 */
router.get('/stats', async (req: Request, res: Response): Promise<void> => {
    try {
        // Load full dataset to get total count
        const data = await loadLocalNodes();
        
        res.json({
            totalNodes: data.count,
            lastUpdated: data.lastUpdated,
            source: data.source
        });
    } catch (error) {
        console.error('❌ Error loading stats:', (error as Error).message);
        res.status(500).json({
            error: 'Failed to load statistics',
            message: (error as Error).message
        });
    }
});

/**
 * Get cache status
 */
router.get('/cache/status', (req: Request, res: Response): void => {
    res.json({
        cached: !!cyclingNodesCache,
        cacheAge: cacheTimestamp ? Date.now() - cacheTimestamp : null,
        nodeCount: cyclingNodesCache ? cyclingNodesCache.count : 0,
        lastUpdated: cyclingNodesCache ? cyclingNodesCache.lastUpdated : null
    });
});

/**
 * Health check endpoint
 */
router.get('/health', (req: Request, res: Response): void => {
    res.status(200).end();
});

export default router;
