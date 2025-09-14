import { VisitedNodesManager, CyclingNode, ExportData } from '../src/utils/visitedNodesManager';

describe('VisitedNodesManager', () => {
  const createTestNodes = (): CyclingNode[] => [
    {
      id: 1,
      lat: 52.0704978,
      lng: 4.3006999,
      osmId: 'osm001',
      name: 'Knooppunt 1',
      network: 'rcn',
      ref: '1'
    },
    {
      id: 2,
      lat: 52.0805,
      lng: 4.3107,
      osmId: 'osm002',
      name: 'Knooppunt 2',
      network: 'rcn',
      ref: '2'
    },
    {
      id: 42,
      lat: 52.3319692,
      lng: 4.80655,
      osmId: 'osm042',
      name: 'Knooppunt 42',
      network: 'rcn',
      ref: '42'
    }
  ];

  describe('Basic functionality', () => {
    test('should initialize with empty state', () => {
      const manager = new VisitedNodesManager();
      expect(manager.getVisitedOsmIds()).toEqual([]);
      expect(manager.getStats().totalNodes).toBe(0);
      expect(manager.getStats().visitedNodes).toBe(0);
    });

    test('should initialize with nodes and visited IDs', () => {
      const nodes = createTestNodes();
      const visitedIds = ['osm001', 'osm002'];
      const manager = new VisitedNodesManager(nodes, visitedIds);
      
      expect(manager.getStats().totalNodes).toBe(3);
      expect(manager.getStats().visitedNodes).toBe(2);
      expect(manager.isVisited('osm001')).toBe(true);
      expect(manager.isVisited('osm002')).toBe(true);
      expect(manager.isVisited('osm042')).toBe(false);
    });

    test('should add nodes to dataset', () => {
      const manager = new VisitedNodesManager();
      const nodes = createTestNodes();
      
      manager.addNodes(nodes);
      
      expect(manager.getStats().totalNodes).toBe(3);
    });

    test('should mark nodes as visited', () => {
      const manager = new VisitedNodesManager(createTestNodes());
      
      expect(manager.markAsVisited('osm001')).toBe(true);
      expect(manager.markAsVisited('nonexistent')).toBe(false);
      expect(manager.isVisited('osm001')).toBe(true);
      expect(manager.getStats().visitedNodes).toBe(1);
    });
  });

  describe('Export functionality', () => {
    test('should return null when no nodes are visited', () => {
      const manager = new VisitedNodesManager(createTestNodes());
      
      const exportData = manager.exportVisited();
      
      expect(exportData).toBeNull();
    });

    test('should export visited nodes correctly', () => {
      const nodes = createTestNodes();
      const manager = new VisitedNodesManager(nodes, ['osm001', 'osm042']);
      
      const exportData = manager.exportVisited();
      
      expect(exportData).not.toBeNull();
      expect(exportData!.totalVisited).toBe(2);
      expect(exportData!.visitedNodes).toHaveLength(2);
      
      // Should be sorted by knooppunt number
      expect(exportData!.visitedNodes[0].knooppuntNumber).toBe(1);
      expect(exportData!.visitedNodes[1].knooppuntNumber).toBe(42);
      
      // Check structure of exported nodes
      const firstNode = exportData!.visitedNodes[0];
      expect(firstNode).toEqual({
        knooppuntNumber: 1,
        name: 'Knooppunt 1',
        osmId: 'osm001',
        coordinates: [52.0704978, 4.3006999],
        visitedDate: expect.any(String)
      });
    });
  });

  describe('Import functionality', () => {
    test('should import nodes with direct OSM ID match', () => {
      const nodes = createTestNodes();
      const manager = new VisitedNodesManager(nodes);
      
      const importData: ExportData = {
        exportDate: new Date().toISOString(),
        totalVisited: 2,
        visitedNodes: [
          {
            knooppuntNumber: 1,
            name: 'Knooppunt 1',
            osmId: 'osm001',
            coordinates: [52.0704978, 4.3006999],
            visitedDate: new Date().toISOString()
          },
          {
            knooppuntNumber: 2,
            name: 'Knooppunt 2',
            osmId: 'osm002',
            coordinates: [52.0805, 4.3107],
            visitedDate: new Date().toISOString()
          }
        ]
      };
      
      const result = manager.importVisitedNodes(importData, manager['allNodes']);
      
      expect(result.successCount).toBe(2);
      expect(result.duplicateCount).toBe(0);
      expect(result.errorCount).toBe(0);
      expect(manager.getStats().visitedNodes).toBe(2);
      expect(manager.isVisited('osm001')).toBe(true);
      expect(manager.isVisited('osm002')).toBe(true);
    });

    test('should handle coordinate matching when OSM ID differs', () => {
      const nodes = createTestNodes();
      const manager = new VisitedNodesManager(nodes);
      
      const importData: ExportData = {
        exportDate: new Date().toISOString(),
        totalVisited: 1,
        visitedNodes: [
          {
            knooppuntNumber: 1,
            name: 'Knooppunt 1',
            osmId: 'different_osm_id',
            coordinates: [52.0704978, 4.3006999],
            visitedDate: new Date().toISOString()
          }
        ]
      };
      
      const result = manager.importVisitedNodes(importData, manager['allNodes']);
      
      expect(result.successCount).toBe(1);
      expect(result.duplicateCount).toBe(0);
      expect(result.errorCount).toBe(0);
      expect(manager.isVisited('osm001')).toBe(true);
    });
  });
});