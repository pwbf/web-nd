# Navigation Display (ND)

Airbus-inspired Navigation Display web UI built with Node.js, HTML, CSS, and JavaScript. The current version is a workable simulator display with range, heading, mode controls, route legs, waypoint symbols, VOR readouts, ETA, distance, and a simple API surface for future navigation-data pipeline work.

## API shape

The UI loads navigation data from:

```bash
GET /api/navigation
```

You can push replacement state for experiments with:

```bash
POST /api/navigation
Content-Type: application/json
```

This is intentionally small so a future Google Maps Navigation API adapter can translate route steps into `waypoints`, `route`, `heading`, `distanceNm`, and `eta`.

## Run locally

1. Install dependencies:
   ```bash
   npm install
   ```
2. Start the server:
   ```bash
   npm start
   ```
3. Open `http://localhost:8500`

## Run with Docker

Build the image:
```bash
docker build -t nd-webui .
```

Run the container:
```bash
docker run --rm -p 8500:8500 nd-webui
```

Then open `http://localhost:8500`.

Or use Docker Compose:

```bash
docker compose up --build
```
