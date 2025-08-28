/**
 * Node clustering utilities for efficient map display
 * Groups nearby nodes into clusters at different zoom levels
 */

/**
 * Calculate distance between two geographic points in kilometers
 */
function getDistance(lat1, lng1, lat2, lng2) {
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
function getClusterDistance(zoom) {
    // No clustering at zoom 11 or higher - show individual nodes
    if (zoom >= 11) {
        return 0;
    }
    
    // Zoom levels and corresponding cluster distances in km (only for zoom 10 and below)
    const zoomDistances = {
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
function calculateZoomFromBounds(south, west, north, east) {
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
function clusterNodes(nodes, zoom) {
    const clusterDistance = getClusterDistance(zoom);
    
    // If cluster distance is 0, return all individual nodes
    if (clusterDistance === 0) {
        return nodes.map(node => ({
            type: 'node',
            id: node.id,
            lat: node.lat,
            lng: node.lng,
            osmId: node.osmId,
            name: node.name,
            network: node.network,
            count: 1
        }));
    }
    
    const clusters = [];
    const used = new Set();
    
    for (let i = 0; i < nodes.length; i++) {
        if (used.has(i)) continue;
        
        const centerNode = nodes[i];
        const cluster = {
            type: 'cluster',
            lat: centerNode.lat,
            lng: centerNode.lng,
            nodes: [centerNode],
            count: 1
        };
        
        used.add(i);
        
        // Find nearby nodes to add to this cluster
        for (let j = i + 1; j < nodes.length; j++) {
            if (used.has(j)) continue;
            
            const node = nodes[j];
            const distance = getDistance(centerNode.lat, centerNode.lng, node.lat, node.lng);
            
            if (distance <= clusterDistance) {
                cluster.nodes.push(node);
                cluster.count++;
                used.add(j);
                
                // Update cluster center to average position
                cluster.lat = cluster.nodes.reduce((sum, n) => sum + n.lat, 0) / cluster.nodes.length;
                cluster.lng = cluster.nodes.reduce((sum, n) => sum + n.lng, 0) / cluster.nodes.length;
            }
        }
        
        // Add cluster or individual node
        if (cluster.count === 1) {
            // Single node - return as individual node
            clusters.push({
                type: 'node',
                id: centerNode.id,
                lat: centerNode.lat,
                lng: centerNode.lng,
                osmId: centerNode.osmId,
                name: centerNode.name,
                network: centerNode.network,
                count: 1
            });
        } else {
            // Multiple nodes - return as cluster
            clusters.push({
                type: 'cluster',
                id: `cluster_${clusters.length}`,
                lat: cluster.lat,
                lng: cluster.lng,
                count: cluster.count,
                nodes: cluster.nodes.map(n => ({ 
                    id: n.id, 
                    name: n.name, 
                    osmId: n.osmId // Include osmId for unique identification
                }))
            });
        }
    }
    
    return clusters;
}

/**
 * Main clustering function for API use
 */
function clusterNodesForBounds(nodes, south, west, north, east, explicitZoom = null) {
    const zoom = explicitZoom !== null ? explicitZoom : calculateZoomFromBounds(south, west, north, east);
    const clusters = clusterNodes(nodes, zoom);
    
    console.log(`🎯 Clustered ${nodes.length} nodes into ${clusters.length} items at zoom ${zoom} (distance: ${getClusterDistance(zoom)}km)`);
    
    return {
        clusters: clusters,
        zoom: zoom,
        clusterDistance: getClusterDistance(zoom),
        originalNodeCount: nodes.length,
        clusterCount: clusters.filter(c => c.type === 'cluster').length,
        individualNodeCount: clusters.filter(c => c.type === 'node').length
    };
}

module.exports = {
    clusterNodesForBounds,
    calculateZoomFromBounds,
    getClusterDistance,
    clusterNodes
};
