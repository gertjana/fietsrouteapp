# Nederlandse Fietsknooppunten Tracker 🚴‍♀️

Een moderne web applicatie om Nederlandse fietsknooppunten te verkennen en je bezochte knooppunten bij te houden. Gebouwd met Node.js, Express en Leaflet.js, gebruikmakend van lokale OpenStreetMap data.

## ✨ Features

- **Interactieve kaart** met alle Nederlandse fietsknooppunten
- **Click-to-toggle** bezocht status - klik direct op knooppunten
- **Lokale data** - snelle loading zonder API beperkingen
- **Bezochte knooppunten tracker** met collapsible overzicht
- **Export functionaliteit** voor je bezochte knooppunten
- **Regionale filtering** per Nederlandse provincie
- **Complete dataset** - 18,000+ knooppunten

## 🚀 Quick Start

### 1. Installatie

```bash
git clone <repository-url>
cd fietsrouteapp
npm install
```

### 2. Data Downloaden (Eerste keer)

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
- `GET /api/cycling-nodes/:region` - Knooppunten per provincie
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

### Scripts

```bash
npm start          # Start productie server
npm run dev        # Start development server met nodemon
npm run download   # Download/update Nederlandse knooppunten data
```

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
