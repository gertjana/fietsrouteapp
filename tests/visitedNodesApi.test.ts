import request from 'supertest';
import express from 'express';
import { visitedRouter, globalVisitedManager } from '../src/routes/visited';
import { CyclingNode } from '../src/utils/visitedNodesManager';

// Setup Express app for testing
const app = express();
app.use(express.json());
app.use('/api/visited', visitedRouter);

// Test data
const testNodes: CyclingNode[] = [
  {
    id: 1,
    lat: 52.0704978,
    lng: 4.3006999,
    osmId: 'test001',
    name: 'Test Knooppunt 1',
    network: 'rcn',
    ref: '1'
  },
  {
    id: 2,
    lat: 52.0805,
    lng: 4.3107,
    osmId: 'test002',
    name: 'Test Knooppunt 2',
    network: 'rcn',
    ref: '2'
  },
  {
    id: 42,
    lat: 52.3319692,
    lng: 4.80655,
    osmId: 'test042',
    name: 'Test Knooppunt 42',
    network: 'rcn',
    ref: '42'
  }
];

describe('Visited Nodes API', () => {
  beforeEach(() => {
    // Clear state and add test nodes
    globalVisitedManager.clearVisited();
    globalVisitedManager.addNodes(testNodes);
  });

  describe('GET /api/visited/stats', () => {
    test('should return initial stats', async () => {
      const response = await request(app)
        .get('/api/visited/stats')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        stats: {
          totalNodes: 3,
          visitedNodes: 0,
          percentage: 0
        },
        visitedOsmIds: []
      });
    });

    test('should return updated stats after marking nodes visited', async () => {
      globalVisitedManager.markAsVisited('test001');
      globalVisitedManager.markAsVisited('test002');

      const response = await request(app)
        .get('/api/visited/stats')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        stats: {
          totalNodes: 3,
          visitedNodes: 2
        },
        visitedOsmIds: ['test001', 'test002']
      });
    });
  });

  describe('POST /api/visited/mark/:osmId', () => {
    test('should mark existing node as visited', async () => {
      const response = await request(app)
        .post('/api/visited/mark/test001')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Node test001 marked as visited',
        stats: {
          totalNodes: 3,
          visitedNodes: 1
        }
      });
    });

    test('should return 404 for non-existent node', async () => {
      const response = await request(app)
        .post('/api/visited/mark/nonexistent')
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Node not found in dataset'
      });
    });
  });

  describe('DELETE /api/visited/clear', () => {
    test('should clear all visited nodes', async () => {
      // Mark some nodes as visited first
      globalVisitedManager.markAsVisited('test001');
      globalVisitedManager.markAsVisited('test002');

      const response = await request(app)
        .delete('/api/visited/clear')
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'All visited nodes cleared',
        stats: {
          totalNodes: 3,
          visitedNodes: 0,
          percentage: 0
        }
      });
    });
  });

  describe('GET /api/visited/export', () => {
    test('should return 404 when no nodes are visited', async () => {
      const response = await request(app)
        .get('/api/visited/export')
        .expect(404);

      expect(response.body).toMatchObject({
        success: false,
        error: 'No visited nodes to export'
      });
    });

    test('should export visited nodes correctly', async () => {
      // Mark some nodes as visited
      globalVisitedManager.markAsVisited('test001');
      globalVisitedManager.markAsVisited('test042');

      const response = await request(app)
        .get('/api/visited/export')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toMatchObject({
        totalVisited: 2,
        visitedNodes: expect.arrayContaining([
          expect.objectContaining({
            knooppuntNumber: 1,
            name: 'Test Knooppunt 1',
            osmId: 'test001',
            coordinates: [52.0704978, 4.3006999]
          }),
          expect.objectContaining({
            knooppuntNumber: 42,
            name: 'Test Knooppunt 42',
            osmId: 'test042',
            coordinates: [52.3319692, 4.80655]
          })
        ])
      });
    });
  });

  describe('POST /api/visited/import', () => {
    test('should return 400 for invalid import data', async () => {
      const response = await request(app)
        .post('/api/visited/import')
        .send({ invalid: 'data' })
        .expect(400);

      expect(response.body).toMatchObject({
        success: false,
        error: 'Invalid import data format'
      });
    });

    test('should import valid data successfully', async () => {
      const importData = {
        exportDate: new Date().toISOString(),
        totalVisited: 2,
        visitedNodes: [
          {
            knooppuntNumber: 1,
            name: 'Test Knooppunt 1',
            osmId: 'test001',
            coordinates: [52.0704978, 4.3006999],
            visitedDate: new Date().toISOString()
          },
          {
            knooppuntNumber: 2,
            name: 'Test Knooppunt 2',
            osmId: 'test002',
            coordinates: [52.0805, 4.3107],
            visitedDate: new Date().toISOString()
          }
        ]
      };

      const response = await request(app)
        .post('/api/visited/import')
        .send(importData)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        result: {
          successCount: 2,
          duplicateCount: 0,
          errorCount: 0
        },
        stats: {
          totalNodes: 3,
          visitedNodes: 2
        }
      });
    });
  });
});