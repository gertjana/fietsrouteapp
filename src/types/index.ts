// Type definitions for the cycling nodes application

// Core cycling node data structure
export interface CyclingNode {
    id: string;
    lat: number;
    lng: number;
    osmId?: string;
    name?: string;
    description?: string;
    note?: string;
    operator?: string;
    network?: string;
    ref?: string;
    place?: string;
    addr_city?: string;
    addr_village?: string;
}

// Cluster representation for map display
export interface NodeCluster {
    id: string;
    lat: number;
    lng: number;
    nodes: CyclingNode[];
    count: number;
    isCluster: boolean;
    type?: 'node' | 'cluster';  // For frontend compatibility
    osmId?: string;  // For individual nodes
    name?: string;   // For individual nodes
}

// Export/Import data structure
export interface ExportData {
    version: string;
    exportDate: string;
    visitedNodes: string[];
    totalNodes: number;
    completionPercentage: number;
}

// Map position for cookie persistence
export interface MapPosition {
    lat: number;
    lng: number;
    zoom: number;
}

// API Response wrapper
export interface ApiResponse<T> {
    data?: T;
    nodes?: CyclingNode[];  // For compatibility with frontend
    clusters?: NodeCluster[];  // For compatibility with frontend
    routes?: CyclingRoute[];   // For compatibility with frontend
    count?: number;
    source?: string;
    lastUpdated?: string;
    error?: string;
    message?: string;
}

// Chunk management types
export interface ChunkInfo {
    id: string;
    bounds: [number, number, number, number]; // [south, west, north, east]
    nodeCount?: number;
}

export interface ChunkIndex {
    totalChunks: number;
    chunks: ChunkInfo[];
    lastUpdated?: string;
}

export interface Chunk {
    id: string;
    bounds: [number, number, number, number];
    nodes: CyclingNode[];
    count: number;
}

// Route types
export interface CyclingRoute {
    id: string;
    name?: string;
    description?: string;
    geometry: Array<{ lat: number; lng: number }>;
    distance?: number;
    difficulty?: string;
    // Additional fields for frontend compatibility
    network?: string;
    wayId?: number;
    relationId?: number;
    tags?: { [key: string]: any };
}

export interface RouteChunk {
    id: string;
    bounds: [number, number, number, number];
    routes: CyclingRoute[];
    count: number;
}

// API parameter types
export interface BoundsParams {
    south: string;
    west: string;
    north: string;
    east: string;
}

// Clustering result type
export interface ClusteringResult {
    clusters: NodeCluster[];
    zoom: number;
    clusterDistance: number;
    originalNodeCount: number;
    clusterCount: number;
    individualNodeCount: number;
}

// Extend Leaflet types for custom markers
declare global {
    namespace L {
        interface MarkerOptions {
            osmId?: string;
            clusterId?: string;
        }
    }
}
