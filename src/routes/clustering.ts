/**
 * Node clustering utilities for efficient map display
 * Groups nearby nodes into clusters at different zoom levels
 */

import { CyclingNode, NodeCluster, ClusteringResult } from '../types';

/**
 * Calculate distance between two geographic points in kilometers
 */
function getDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

/**
 * Calculate appropriate cluster distance based on zoom level
 * Only cluster at zoom 10 or lower, show individual nodes at zoom 11+
 */
function getClusterDistance(zoom: number): number {
    // No clustering at zoom 11 or higher - show individual nodes
    if (zoom >= 11) {
        return 0;
    }
    
    // Zoom levels and corresponding cluster distances in km (only for zoom 10 and below)
    const zoomDistances: Record<number, number> = {
        0: 100,   // Country level - very large clusters
        3: 75,    // Large region level - large clusters
        5: 50,    // Province level - medium clusters  
        7: 30,    // Regional level - smaller clusters
        9: 15,    // City level - small clusters
        10: 10    // Detailed level - very small clusters (last clustering level)
    };
    
    // Find the appropriate distance for the zoom level
    for (let z = 10; z >= 0; z--) {
        if (zoom >= z && zoomDistances[z] !== undefined) {
            return zoomDistances[z];
        }
    }
    return 50; // Default fallback for very low zoom
}

/**
 * Calculate zoom level from bounding box area
 */
function calculateZoomFromBounds(south: number, west: number, north: number, east: number): number {
    const latDiff = north - south;
    const lngDiff = east - west;
    const area = latDiff * lngDiff;
    
    // Rough zoom estimation based on area (capped at 10 for clustering)
    if (area > 100) return 0;    // Very large area (country)
    if (area > 25) return 3;     // Large area (multiple provinces)
    if (area > 4) return 5;      // Medium area (province)
    if (area > 1) return 7;      // Regional area
    if (area > 0.25) return 9;   // City area
    if (area > 0.1) return 10;   // Detailed area (last clustering level)
    return 11;                   // Smaller areas = individual nodes (zoom 11+)
}

/**
 * Cluster nodes using a simple distance-based algorithm
 */
function clusterNodes(nodes: CyclingNode[], zoom: number): NodeCluster[] {
    const clusterDistance = getClusterDistance(zoom);
    
    // If cluster distance is 0, return all individual nodes
    if (clusterDistance === 0) {
        return nodes.map(node => ({
            id: node.id,
            lat: node.lat,
            lng: node.lng,
            osmId: node.osmId,
            name: node.name,
            nodes: [node],
            count: 1,
            isCluster: false,
            type: 'node'  // Add type for frontend compatibility
        }));
    }
    
    const clusters: NodeCluster[] = [];
    const used = new Set<number>();
    
    for (let i = 0; i < nodes.length; i++) {
        if (used.has(i)) continue;
        
        const centerNode = nodes[i];
        const clusterNodes: CyclingNode[] = [centerNode];
        let clusterLat = centerNode.lat;
        let clusterLng = centerNode.lng;
        let count = 1;
        
        used.add(i);
        
        // Find nearby nodes to add to this cluster
        for (let j = i + 1; j < nodes.length; j++) {
            if (used.has(j)) continue;
            
            const node = nodes[j];
            const distance = getDistance(centerNode.lat, centerNode.lng, node.lat, node.lng);
            
            if (distance <= clusterDistance) {
                clusterNodes.push(node);
                count++;
                used.add(j);
                
                // Update cluster center to average position
                clusterLat = clusterNodes.reduce((sum, n) => sum + n.lat, 0) / clusterNodes.length;
                clusterLng = clusterNodes.reduce((sum, n) => sum + n.lng, 0) / clusterNodes.length;
            }
        }
        
        // Add cluster or individual node
        if (count === 1) {
            // Single node - return as individual node
            clusters.push({
                id: centerNode.id,
                lat: centerNode.lat,
                lng: centerNode.lng,
                osmId: centerNode.osmId,
                name: centerNode.name,
                nodes: [centerNode],
                count: 1,
                isCluster: false,
                type: 'node'  // Add type for frontend compatibility
            });
        } else {
            // Multiple nodes - return as cluster
            clusters.push({
                id: `cluster_${clusters.length}`,
                lat: clusterLat,
                lng: clusterLng,
                nodes: clusterNodes,
                count: count,
                isCluster: true,
                type: 'cluster'  // Add type for frontend compatibility
            });
        }
    }
    
    return clusters;
}

/**
 * Main clustering function for API use
 */
export function clusterNodesForBounds(
    nodes: CyclingNode[], 
    south: number, 
    west: number, 
    north: number, 
    east: number, 
    explicitZoom: number | null = null
): ClusteringResult {
    const zoom = explicitZoom !== null ? explicitZoom : calculateZoomFromBounds(south, west, north, east);
    const clusters = clusterNodes(nodes, zoom);
    
    return {
        clusters: clusters,
        zoom: zoom,
        clusterDistance: getClusterDistance(zoom),
        originalNodeCount: nodes.length,
        clusterCount: clusters.filter(c => c.isCluster).length,
        individualNodeCount: clusters.filter(c => !c.isCluster).length
    };
}

export {
    calculateZoomFromBounds,
    getClusterDistance,
    clusterNodes
};
