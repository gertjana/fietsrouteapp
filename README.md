# Nederlandse Fietsknooppunten Tracker 🚴‍♀️

Een moderne web applicatie om Nederlandse fietsknooppunten te verkennen en je bezochte knooppunten bij te houden. Gebouwd met **TypeScript**, Node.js, Express en Leaflet.js, gebruikmakend van lokale OpenStreetMap data.

## ✨ Features

- **TypeScript backend** - Type-safe server code met modern development
- **Interactieve kaart** met alle Nederlandse fietsknooppunten
- **Click-to-toggle** bezocht status - klik direct op knooppunten
- **Lokale data** - snelle loading zonder API beperkingen
- **Bezochte knooppunten tracker** met collapsible overzicht
- **Export functionaliteit** voor je bezochte knooppunten
- **Clustering** - intelligente groepering op lage zoom niveaus
- **Complete dataset** - 18,000+ knooppunten

## 🚀 Quick Start

### 1. Installatie

```bash
git clone <repository-url>
cd fietsrouteapp
npm install
```

### 2. Build TypeScript

```bash
npm run build
```

### 3. Data Downloaden (Eerste keer)

**Belangrijk**: Voor de eerste keer moet je de Nederlandse fietsknooppunten data downloaden:

```bash
npm run download
```

Dit proces:
- Downloadt alle Nederlandse fietsknooppunten van OpenStreetMap
- Splitst Nederland op in 64 chunks om API limieten te respecteren
- Duurt ongeveer 5-10 minuten (afhankelijk van je internetverbinding)
- Slaat data op in `./data/` directory

**Let op**: De download gebruikt de Overpass API met respectvolle rate limiting (3 seconden tussen requests).

### 3. Server Starten

```bash
npm start
```

Of voor development met auto-reload:

```bash
npm run dev
```

Ga naar: http://localhost:3000

## 📁 Project Structuur

```
fietsrouteapp/
├── data/                                    # Lokale data files
│   ├── nederlandse-fietsknooppunten-volledig.geojson
│   ├── raw-nodes-data.json
│   ├── download-stats.json
│   └── download.log
├── public/                                  # Frontend bestanden
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── routes/                                  # API endpoints
│   └── api.js
├── scripts/                                 # Download scripts
│   └── download-all-nodes.js
├── server.js                               # Express server
└── package.json
```

## 🔧 API Endpoints

- `GET /api/cycling-nodes` - Alle knooppunten
- `GET /api/cycling-nodes/bounds/:south/:west/:north/:east` - Knooppunten binnen bounds
- `GET /api/cycling-nodes/clustered/` - Geclusterde knooppunten (met zoom parameter)
- `GET /api/cache/status` - Cache status
- `DELETE /api/cache` - Cache wissen

## 🗺️ Hoe Te Gebruiken

1. **Knooppunten bekijken**: De kaart laadt automatisch alle knooppunten in je huidige view
2. **Markeren als bezocht**: Klik direct op een knooppunt op de kaart
3. **Bezochte lijst**: Gebruik de uitklapbare balk onderaan
4. **Exporteren**: Klik "Export Bezochte" om je lijst op te slaan
5. **Navigatie**: Gebruik zoom/pan of "Fit View" knop

## 📊 Data Bronnen

- **OpenStreetMap**: Alle knooppunten data via Overpass API
- **Network Type**: RCN (Regionaal Cycle Network)
- **Coverage**: Geheel Nederland
- **Update Frequentie**: Handmatig via `npm run download`

## 🔄 Data Updaten

Om de nieuwste knooppunten data te krijgen:

```bash
npm run download
```

Dit overschrijft je huidige data met de nieuwste versie van OpenStreetMap.

## ⚡ Performance

- **Lokale data**: Geen API calls tijdens gebruik
- **Caching**: 24-uur cache voor optimale snelheid
- **Chunked loading**: Intelligente filtering op bounds
- **Memory efficient**: Alleen geladen wat nodig is

## 🛠️ Development

### TypeScript Architecture

- **Source code**: `src/` directory (TypeScript)
- **Compiled output**: `dist/` directory (JavaScript)
- **Frontend**: `public/` directory (HTML/CSS/JS)

### Scripts

```bash
npm run build      # Compile TypeScript to JavaScript
npm start          # Start production server (requires build first)
npm run dev        # Development: build + start with nodemon
npm run download   # Download/update Nederlandse knooppunten data
```

## 🐳 Docker Deployment

### Option 1: Pre-built Images from GitHub (Aanbevolen)

We build ready-to-use Docker images with data included via GitHub Actions:

```bash
# Run image with data included (weekly updated)
docker run -p 3000:3000 ghcr.io/gertjana/fietsrouteapp:latest

# Or run without pre-downloaded data (smaller image)
docker run -p 3000:3000 ghcr.io/gertjana/fietsrouteapp:nodata
```

### Option 2: Docker Compose (Local Build)

```bash
# Build en start de container
npm run docker:compose

# Voor productie (detached mode)
npm run docker:compose:prod
```

### Option 3: Manual Docker Build

```bash
# Build de image
npm run docker:build

# Run de container
npm run docker:run
```

### GitHub Actions Builds

We provide two automated builds:

1. **With Data** (`latest` tag): 
   - Downloads fresh OpenStreetMap data weekly
   - Self-contained image ready to run
   - Larger image (~100-200MB) but no setup needed

2. **No Data** (`nodata` tag):
   - Minimal image (~50MB)
   - Requires running `npm run download` after start
   - Good for development or custom data sources

### Docker Features

- **Multi-stage build** voor minimale image grootte
- **Alpine Linux** basis voor security en grootte  
- **Non-root user** voor veiligheid
- **Health checks** voor monitoring (`/api/health`)
- **Resource limits** voor kleine deployments (256MB RAM max)
- **Signal handling** met dumb-init

De applicatie is toegankelijk op `http://localhost:3000`

### Cache Management

- Cache wordt automatisch beheerd
- Handmatig cache wissen: `DELETE /api/cache`
- Cache status: `GET /api/cache/status`

## 📝 Notes

- **Eerste gebruik**: Vergeet niet `npm run download` te draaien!
- **Offline capable**: Werkt volledig offline na download
- **Storage**: Data files zijn ~5-10MB
- **Browser compatibility**: Moderne browsers (ES6+)

## 🤝 Contributing

1. Fork het project
2. Maak een feature branch
3. Commit je changes
4. Push naar de branch
5. Open een Pull Request

## 📄 License

MIT License - zie LICENSE bestand voor details.

---

**Happy cycling! 🚴‍♂️🚴‍♀️**
