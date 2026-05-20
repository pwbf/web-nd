# WebND Project

WebND is a browser-based tactical Navigation Display inspired by Airbus-style cockpit ND symbology. It is built with Node.js, HTML, CSS, and JavaScript, and is intended as a practical simulation interface for route tracking, GPS experimentation, and future navigation API integration.

The display is pilot-centric and forward-looking. It supports ARC, ROSE, and PLAN-style modes, range rings, route rendering, waypoint symbols, wind correction, TAS/GS simulation, GPS position input, visible navaid and airport overlays, and compact tables for visible map objects.

## Features

- Airbus-inspired Navigation Display rendered on HTML canvas
- ARC-mode half-circle compass and range ring presentation
- KML route profile loading from `data/*.kml`
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

The API is intentionally small so a future adapter can translate navigation sources, such as Google Maps navigation data, into route points, waypoints, aircraft position, heading, distance, and ETA.

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
https://localhost:8500
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
docker run --rm -p 8500:8500 webnd
```

Open:

```text
https://localhost:8500
```

Or use Docker Compose:

```bash
docker compose up --build
```

## Notes

This project is a simulation and visualization tool. It is not certified avionics software and must not be used for real-world flight navigation.
