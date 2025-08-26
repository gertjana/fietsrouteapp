# Download Script voor Nederlandse Fietsknooppunten

Dit script downloadt **alle** Nederlandse fietsknooppunten van OpenStreetMap met rate limiting en error handling.

## Gebruik

```bash
# Download alle knooppunten
npm run download

# Of direct:
node scripts/download-all-nodes.js
```

## Wat het script doet

1. **Verdeelt Nederland in chunks** - 8x8 grid (64 gebieden) om API limits te vermijden
2. **Rate limiting** - 3 seconden tussen requests, 10 seconden bij rate limits
3. **Error handling** - Automatische retry bij fouten, max 3 pogingen
4. **Progress tracking** - Live voortgang en statistieken
5. **Deduplicatie** - Verwijdert dubbele knooppunten op basis van OSM ID

## Output bestanden

Na voltooiing vind je in de `./data/` map:

- **`nederlandse-fietsknooppunten-volledig.geojson`** - Complete GeoJSON dataset
- **`raw-nodes-data.json`** - Ruwe node data
- **`download-stats.json`** - Download statistieken en errors
- **`download.log`** - Gedetailleerd logbestand

## Configuratie

Je kunt het script aanpassen door de `CONFIG` object te wijzigen:

```javascript
const CONFIG = {
    GRID_SIZE: 8,           // 8x8 = 64 chunks
    REQUEST_DELAY: 3000,    // 3 seconden tussen requests
    RETRY_DELAY: 10000,     // 10 seconden bij rate limit
    MAX_RETRIES: 3,         // Maximum aantal retries
    // ...
};
```

## Verwachte resultaten

- **~5000-8000 knooppunten** voor heel Nederland
- **~45-60 minuten** download tijd (afhankelijk van API snelheid)
- **~64 API requests** (1 per chunk)
- **~10-15 MB** GeoJSON bestand

## Features

✅ **Complete coverage** - Heel Nederland in één run  
✅ **Rate limiting** - Respecteert Overpass API limits  
✅ **Error recovery** - Automatische retries bij fouten  
✅ **Progress tracking** - Live updates en statistieken  
✅ **Rich data** - Alle beschikbare OSM tags  
✅ **GeoJSON output** - Standard format voor GIS tools  
✅ **Logging** - Gedetailleerde logs voor debugging  

## Troubleshooting

**Script stopt bij rate limiting:**
- Verhoog `REQUEST_DELAY` naar 5000ms of meer
- Verminder `GRID_SIZE` naar 6x6 of 4x4

**Chunks falen herhaaldelijk:**
- Check internet verbinding
- Overpass API kan overbelast zijn - probeer later
- Verhoog timeout in axios config

**Onverwacht weinig knooppunten:**
- Check of alle chunks succesvol zijn - zie `download-stats.json`
- Sommige gebieden hebben weinig/geen knooppunten

## Voorbeeld output

```
[2025-08-26T...] [INFO] 🚴‍♀️ Starting download of all Dutch cycling nodes...
[2025-08-26T...] [INFO] Generated 64 chunks (8x8 grid)
[2025-08-26T...] [INFO] 📡 Processing chunk 1/64: Chunk 1/64
[2025-08-26T...] [INFO] ✅ Chunk 1/64: Found 127 nodes (Total: 127)
[2025-08-26T...] [INFO] ⏱️ Waiting 3s before next request...
...
[2025-08-26T...] [INFO] 🎉 Download completed!
[2025-08-26T...] [INFO] 📊 Final Statistics:
[2025-08-26T...] [INFO]    - Total nodes: 6234
[2025-08-26T...] [INFO]    - Chunks processed: 64/64
[2025-08-26T...] [INFO]    - Duration: 52 minutes
```
