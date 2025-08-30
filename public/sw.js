// Service Worker for caching map tiles
const CACHE_NAME = 'cyclosm-tiles-v1';
const TILE_CACHE_NAME = 'map-tiles-v1';

// CyclOSM tile URL pattern
const CYCLOSM_PATTERN = /^https:\/\/[abc]\.tile-cyclosm\.openstreetmap\.fr\/cyclosm\/\d+\/\d+\/\d+\.png$/;

self.addEventListener('install', (event) => {
    console.log('🔧 Service Worker installing...');
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    console.log('✅ Service Worker activated');
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    
    // Only cache GET requests for map tiles
    if (request.method !== 'GET') return;
    
    // Check if this is a CyclOSM tile request
    if (CYCLOSM_PATTERN.test(request.url)) {
        event.respondWith(handleTileRequest(request));
    }
});

async function handleTileRequest(request) {
    try {
        const cache = await caches.open(TILE_CACHE_NAME);
        
        // Try to get from cache first
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
            console.log('📦 Serving tile from cache:', request.url);
            return cachedResponse;
        }
        
        // Fetch from network with timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout
        
        const response = await fetch(request, {
            signal: controller.signal,
            headers: {
                'User-Agent': 'Nederlandse Fietsknooppunten Tracker'
            }
        });
        
        clearTimeout(timeoutId);
        
        // Cache successful responses
        if (response.ok) {
            console.log('💾 Caching tile:', request.url);
            cache.put(request, response.clone());
        }
        
        return response;
        
    } catch (error) {
        console.warn('⚠️ Tile request failed:', request.url, error.message);
        
        // Return a fallback tile or empty response
        return new Response(null, { 
            status: 404, 
            statusText: 'Tile not available' 
        });
    }
}

// Clean up old cached tiles periodically
self.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'CLEAN_CACHE') {
        const cache = await caches.open(TILE_CACHE_NAME);
        const requests = await cache.keys();
        
        // Remove tiles older than 7 days
        const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
        
        for (const request of requests) {
            const response = await cache.match(request);
            if (response) {
                const dateHeader = response.headers.get('date');
                if (dateHeader && new Date(dateHeader).getTime() < oneWeekAgo) {
                    await cache.delete(request);
                }
            }
        }
        
        console.log('🧹 Cache cleanup completed');
    }
});
