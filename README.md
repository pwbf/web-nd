# WebND Project

WebND is a browser-based tactical Navigation Display inspired by Airbus-style cockpit ND symbology. It is built with Node.js, HTML, CSS, and JavaScript, and is intended as a practical simulation interface for route tracking, GPS experimentation, and future navigation API integration.

The display is pilot-centric and forward-looking. It supports ARC, ROSE, and PLAN-style modes, range rings, route rendering, waypoint symbols, wind correction, TAS/GS simulation, GPS position input, visible navaid and airport overlays, and compact tables for visible map objects.

## Features

- Airbus-inspired Navigation Display rendered on HTML canvas
- ARC-mode half-circle compass and range ring presentation
- KML route profile loading from `data/*.kml`
- Browser KML upload with server-side filename and content validation
- Manual latitude/longitude input
- Browser GPS support with temporary `GPS PRIMARY` annunciation
- Route progress slider and play/pause simulation
- TAS, wind speed, and wind direction controls
- Ground speed and track calculation from aircraft vector plus wind vector
- Navaid rendering from CSV data with selectable VOR, DME, TACAN, NDB, and Other layers
- Airport rendering from CSV data with selectable airport layer
- Visible navaid and airport tables with distance, position, and metadata
- Unit display support for NM, km, and meters
- Docker and Docker Compose support

## Data Sources

Navaid and airport CSV data are sourced from OurAirports:

https://ourairports.com/

Files used by this project:

- `data/navaids.csv`
- `data/airports.csv`

Please review OurAirports licensing and attribution requirements before redistributing datasets or derived data.

## Project Structure

```text
.
├── data/
│   ├── airports.csv
│   ├── navaids.csv
│   └── *.kml
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── server.js
├── Dockerfile
├── docker-compose.yml
└── compose.yml
```

## API

Load navigation state:

```bash
GET /api/navigation
```

Load a specific KML profile:

```bash
GET /api/navigation?profile=PROFILE_FILE.kml
```

List available profiles:

```bash
GET /api/profiles
```

Push replacement navigation state for experiments:

```bash
POST /api/navigation
Content-Type: application/json
```

Import a Google Maps route URL:

```bash
POST /api/gmap/import
Content-Type: application/json
```

```json
{"url":"https://maps.app.goo.gl/example"}
```

Upload a local KML route file:

```bash
POST /api/kml/upload
Content-Type: application/json
```

```json
{"filename":"my-route.kml","content":"<kml>...</kml>"}
```

Read server-side feature flags:

```bash
GET /api/config
```

The API is intentionally small so a future adapter can translate navigation sources, such as Google Maps navigation data, into route points, waypoints, aircraft position, heading, distance, and ETA.

## Google Maps Import Configuration

The Google Maps import UI submits the pasted URL to the WebND backend. When Nebula job settings are fully configured, the backend creates a `gmap2kml` job, waits for completion, downloads the output zip, extracts KML files, and writes them into `data/`.

Configure Nebula import with:

```bash
GMAP_JOBS_URL=https://neb.pwbf.pw:8585
GMAP_JOBS_USER=admin
GMAP_JOBS_PASSWORD=your-api-password
```

Do not put the job API password in browser-side code.

When Nebula URL, username, or password is not configured, WebND falls back to the bundled local `GMapLink2KML` tool. The local tool runs as:

```bash
python3 main.py <google-map-url>
```

Local import settings:

```bash
GMAP_LOCAL_TOOL_DIR=/usr/src/app/GMapLink2KML
GMAP_LOCAL_PYTHON=python3
GMAP_LOCAL_TIMEOUT_MS=180000
```

The Google Maps URL field is shown when either Nebula import is configured or the local `GMapLink2KML` tool is available.

## KML Uploads and Retention

Uploaded KML files are written into `data/` after filename sanitization and basic KML content validation. The server accepts only `.kml` names, rejects DTD/entity declarations, rejects empty or oversized files, and writes files without executable permissions.

KML files created by Google Maps import are considered temporary when their name matches `route*.kml`. They are removed after 24 hours by default. User-uploaded KML files are preserved, including uploads originally named `route*.kml`, which are renamed with an `uploaded-` prefix.

Retention settings:

```bash
MAX_KML_UPLOAD_BYTES=10485760
ROUTE_KML_RETENTION_HOURS=24
ROUTE_KML_CLEANUP_INTERVAL_MS=3600000
```

## Run Locally

Install dependencies:

```bash
npm install
```

Start the HTTPS server:

```bash
npm start
```

Open:

```text
https://localhost:4000
```

The server expects a local certificate and key at:

```text
cert/server.crt
cert/server.key
```

You can override those paths with:

```bash
HTTPS_CERT_PATH=/path/to/server.crt HTTPS_KEY_PATH=/path/to/server.key npm start
```

## Run With Docker

Build the image:

```bash
docker build -t webnd .
```

Run the container:

```bash
docker run --rm -p 4000:4000 webnd
```

Open:

```text
https://localhost:4000
```

Or use Docker Compose:

```bash
docker compose up --build
```

## Notes

This project is a simulation and visualization tool. It is not certified avionics software and must not be used for real-world flight navigation.
