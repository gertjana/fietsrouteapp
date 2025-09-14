import { Router, Request, Response } from 'express';
import { VisitedNodesManager, ExportData } from '../utils/visitedNodesManager';

const router = Router();

// In-memory store for demo purposes
// In a real app, this would be connected to a database or session storage
const globalVisitedManager = new VisitedNodesManager();

/**
 * POST /api/visited/import
 * Import visited nodes from JSON data
 */
router.post('/import', (req: Request, res: Response): void => {
  try {
    const importData: ExportData = req.body;
    
    if (!importData || !importData.visitedNodes) {
      res.status(400).json({
        success: false,
        error: 'Invalid import data format'
      });
      return;
    }

    const result = globalVisitedManager.importVisited(importData);
    
    res.json({
      success: true,
      result: {
        successCount: result.successCount,
        duplicateCount: result.duplicateCount,
        errorCount: result.errorCount,
        notFoundCount: result.errorCount, // errorCount represents nodes that couldn't be found/matched
        message: result.message
      },
      stats: globalVisitedManager.getStats()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during import'
    });
  }
});

/**
 * GET /api/visited/export
 * Export visited nodes as JSON
 */
router.get('/export', (req: Request, res: Response): void => {
  try {
    const exportData = globalVisitedManager.exportVisited();
    
    if (!exportData) {
      res.status(404).json({
        success: false,
        error: 'No visited nodes to export'
      });
      return;
    }

    res.json({
      success: true,
      data: exportData
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error during export'
    });
  }
});

/**
 * POST /api/visited/mark/:osmId
 * Mark a node as visited
 */
router.post('/mark/:osmId', (req: Request, res: Response): void => {
  try {
    const { osmId } = req.params;
    const success = globalVisitedManager.markAsVisited(osmId);
    
    if (!success) {
      res.status(404).json({
        success: false,
        error: 'Node not found in dataset'
      });
      return;
    }

    res.json({
      success: true,
      message: `Node ${osmId} marked as visited`,
      stats: globalVisitedManager.getStats()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * DELETE /api/visited/clear
 * Clear all visited nodes
 */
router.delete('/clear', (req: Request, res: Response) => {
  try {
    globalVisitedManager.clearVisited();
    
    res.json({
      success: true,
      message: 'All visited nodes cleared',
      stats: globalVisitedManager.getStats()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * GET /api/visited/stats
 * Get current statistics
 */
router.get('/stats', (req: Request, res: Response) => {
  try {
    const stats = globalVisitedManager.getStats();
    const visitedIds = globalVisitedManager.getVisitedOsmIds();
    
    res.json({
      success: true,
      stats,
      visitedOsmIds: visitedIds
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export { router as visitedRouter, globalVisitedManager };
