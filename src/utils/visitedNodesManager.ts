export interface CyclingNode {
  id: number;
  lat: number;
  lng: number;
  osmId: string;
  name: string;
  description?: string | null;
  note?: string | null;
  operator?: string | null;
  network?: string;
  ref?: string;
  place?: string | null;
  addr_city?: string | null;
  addr_village?: string | null;
}

export interface VisitedNodeData {
  knooppuntNumber: number;
  name: string;
  osmId: string;
  coordinates: [number, number];
  visitedDate: string;
  importedDate?: string;
}

export interface ExportData {
  exportDate: string;
  totalVisited: number;
  visitedNodes: VisitedNodeData[];
}

export interface ImportResult {
  success: boolean;
  successCount: number;
  duplicateCount: number;
  errorCount: number;
  message: string;
  notFoundNodes: VisitedNodeData[];
}

export interface VisitedStats {
  totalVisited: number;
  totalNodes: number;
  percentage: number;
  visitedNodes: number;
  visitedPercentage: number;
}

export class VisitedNodesManager {
  private visitedNodes = new Set<string>();
  private visitedNodeDetails = new Map<string, VisitedNodeData>();
  private allNodes = new Map<string, CyclingNode>();
  
  constructor(nodes?: CyclingNode[], visitedIds?: string[]) {
    if (nodes) {
      this.addNodes(nodes);
    }
    if (visitedIds) {
      visitedIds.forEach(osmId => {
        if (this.allNodes.has(osmId)) {
          this.addVisitedNode(this.allNodes.get(osmId)!);
        } else {
          // Add to visited set even if node details aren't available
          this.visitedNodes.add(osmId);
        }
      });
    }
  }
  
  addNodes(nodes: CyclingNode[]): void {
    nodes.forEach(node => {
      this.allNodes.set(node.osmId, node);
    });
  }
  
  addVisitedNode(node: CyclingNode): void {
    this.visitedNodes.add(node.osmId);
    this.visitedNodeDetails.set(node.osmId, {
      knooppuntNumber: node.id,
      name: node.name,
      osmId: node.osmId,
      coordinates: [node.lat, node.lng],
      visitedDate: new Date().toISOString()
    });
  }
  
  removeVisitedNode(osmId: string): void {
    this.visitedNodes.delete(osmId);
    this.visitedNodeDetails.delete(osmId);
  }
  
  isVisited(osmId: string): boolean {
    return this.visitedNodes.has(osmId);
  }
  
  getVisitedCount(): number {
    return this.visitedNodes.size;
  }
  
  getVisitedOsmIds(): string[] {
    return Array.from(this.visitedNodes);
  }
  
  markAsVisited(osmId: string): boolean {
    if (this.allNodes.has(osmId)) {
      if (!this.visitedNodes.has(osmId)) {
        this.addVisitedNode(this.allNodes.get(osmId)!);
        return true;
      }
    }
    return false;
  }
  
  clearVisited(): void {
    this.clear();
  }
  
  getStats(): VisitedStats {
    const totalNodes = this.allNodes.size;
    const visitedNodes = this.visitedNodes.size;
    const visitedPercentage = totalNodes > 0 ? (visitedNodes / totalNodes) * 100 : 0;
    
    return {
      totalVisited: visitedNodes,
      totalNodes,
      percentage: visitedPercentage,
      visitedNodes,
      visitedPercentage
    };
  }
  
  importVisited(importData: ExportData): ImportResult {
    // Check for invalid data and throw error if needed (for test compatibility)
    if (!importData || !importData.visitedNodes || !Array.isArray(importData.visitedNodes)) {
      throw new Error('Invalid import data: missing or invalid visitedNodes array');
    }
    
    // For API usage without allNodes map - simplified version
    return this.importVisitedNodes(importData, new Map());
  }
  
  exportVisited(): ExportData | null {
    if (this.visitedNodes.size === 0) {
      return null;
    }
    return this.exportVisitedNodes();
  }
  
  exportVisitedNodes(allNodes?: Map<string, CyclingNode>): ExportData {
    const allVisitedNodes: VisitedNodeData[] = Array.from(this.visitedNodeDetails.values());
    
    // If we have nodes that are in visitedNodes but not in visitedNodeDetails,
    // try to populate them from allNodes if provided
    if (allNodes) {
      for (const osmId of this.visitedNodes) {
        if (!this.visitedNodeDetails.has(osmId)) {
          const node = allNodes.get(osmId);
          if (node) {
            const nodeData: VisitedNodeData = {
              knooppuntNumber: node.id,
              name: node.name,
              osmId: node.osmId,
              coordinates: [node.lat, node.lng],
              visitedDate: new Date().toISOString()
            };
            this.visitedNodeDetails.set(osmId, nodeData);
            allVisitedNodes.push(nodeData);
          }
        }
      }
    }
    
    return {
      exportDate: new Date().toISOString(),
      totalVisited: allVisitedNodes.length,
      visitedNodes: allVisitedNodes.sort((a, b) => a.knooppuntNumber - b.knooppuntNumber)
    };
  }
  
  importVisitedNodes(importData: ExportData, allNodes: Map<string, CyclingNode>): ImportResult {
    if (!importData.visitedNodes || !Array.isArray(importData.visitedNodes)) {
      return {
        success: false,
        successCount: 0,
        duplicateCount: 0,
        errorCount: 1,
        message: 'Invalid import data format',
        notFoundNodes: []
      };
    }

    let successCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    const notFoundNodes: VisitedNodeData[] = [];

    // Use this.allNodes if no allNodes map provided
    const nodesToSearch = allNodes.size > 0 ? allNodes : this.allNodes;

    importData.visitedNodes.forEach(nodeData => {
      try {
        // Normalize osmId to string — export data may contain numeric osmIds
        const normalizedNodeData = {
          ...nodeData,
          osmId: String(nodeData.osmId)
        };
        let foundOsmId: string | null = null;
        
        // Strategy 1: Try direct OSM ID match
        if (normalizedNodeData.osmId && nodesToSearch.has(normalizedNodeData.osmId)) {
          foundOsmId = normalizedNodeData.osmId;
        }
        
        // Strategy 2: Try matching by coordinates (within 100m)
        if (!foundOsmId && normalizedNodeData.coordinates && normalizedNodeData.coordinates.length === 2) {
          const [targetLat, targetLng] = normalizedNodeData.coordinates;
          const threshold = 0.001; // roughly 100m
          
          for (const [osmId, node] of nodesToSearch) {
            const latDiff = Math.abs(node.lat - targetLat);
            const lngDiff = Math.abs(node.lng - targetLng);
            
            if (latDiff < threshold && lngDiff < threshold) {
              foundOsmId = osmId;
              break;
            }
          }
        }
        
        // Strategy 3: Trust the export data directly — if it has osmId and full
        // details, store it as-is without requiring a match in the current dataset.
        if (!foundOsmId && normalizedNodeData.osmId) {
          foundOsmId = normalizedNodeData.osmId;
        }
        
        if (foundOsmId) {
          if (this.visitedNodes.has(foundOsmId)) {
            duplicateCount++;
          } else {
            this.visitedNodes.add(foundOsmId);
            this.visitedNodeDetails.set(foundOsmId, {
              ...normalizedNodeData,
              osmId: foundOsmId,
              importedDate: new Date().toISOString()
            });
            successCount++;
          }
        } else {
          errorCount++;
          notFoundNodes.push(normalizedNodeData);
        }
      } catch (error) {
        errorCount++;
        notFoundNodes.push(nodeData);
      }
    });

    const success = successCount > 0 || duplicateCount > 0;
    let message = `Import completed: ${successCount} new nodes added`;
    if (duplicateCount > 0) {
      message += `, ${duplicateCount} duplicates`;
    }
    if (errorCount > 0) {
      message += `, ${errorCount} not found`;
    }

    return {
      success,
      successCount,
      duplicateCount,
      errorCount,
      message,
      notFoundNodes
    };
  }
  
  clear(): void {
    this.visitedNodes.clear();
    this.visitedNodeDetails.clear();
  }
}