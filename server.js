const express = require('express');
const fs = require('fs');
const https = require('https');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8500;
const HTTPS_CERT_PATH = process.env.HTTPS_CERT_PATH || path.join(__dirname, 'cert', 'server.crt');
const HTTPS_KEY_PATH = process.env.HTTPS_KEY_PATH || path.join(__dirname, 'cert', 'server.key');
let navaidCsvCache = {mtimeMs: null, navaids: []};
let airportCsvCache = {mtimeMs: null, airports: []};

function decodeXml(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function parseCoordinate(text) {
  const [lon, lat, altitude = 0] = text.trim().split(',').map(Number);
  return {lat, lon, altitude};
}

function parseCsvLine(line) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const nextCharacter = line[index + 1];
    if (character === '"' && inQuotes && nextCharacter === '"') {
      current += '"';
      index += 1;
    } else if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === ',' && !inQuotes) {
      values.push(current);
      current = '';
    } else {
      current += character;
    }
  }

  values.push(current);
  return values;
}

function parseOptionalNumber(value) {
  if (value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function loadNavaidsCsv(dataDir) {
  const csvPath = path.join(dataDir, 'navaids.csv');
  if (!fs.existsSync(csvPath)) return [];

  const stats = fs.statSync(csvPath);
  if (navaidCsvCache.mtimeMs === stats.mtimeMs) {
    return navaidCsvCache.navaids;
  }

  const [headerLine, ...rows] = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine).map((header) => header.replace(/^"|"$/g, ''));
  const navaids = rows.map((row) => {
    const values = parseCsvLine(row);
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    const lat = parseOptionalNumber(record.latitude_deg);
    const lon = parseOptionalNumber(record.longitude_deg);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !record.ident) return null;

    return {
      id: record.ident,
      name: record.name || record.ident,
      type: record.type || 'NAVAID',
      frequencyKhz: parseOptionalNumber(record.frequency_khz),
      lat,
      lon,
      altitudeFt: Math.round(parseOptionalNumber(record.elevation_ft) || 0),
      isoCountry: record.iso_country || '',
      associatedAirport: record.associated_airport || '',
    };
  }).filter(Boolean);

  navaidCsvCache = {mtimeMs: stats.mtimeMs, navaids};
  return navaids;
}

function loadAirportsCsv(dataDir) {
  const csvPath = path.join(dataDir, 'airports.csv');
  if (!fs.existsSync(csvPath)) return [];

  const stats = fs.statSync(csvPath);
  if (airportCsvCache.mtimeMs === stats.mtimeMs) {
    return airportCsvCache.airports;
  }

  const [headerLine, ...rows] = fs.readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const headers = parseCsvLine(headerLine).map((header) => header.replace(/^"|"$/g, ''));
  const airports = rows.map((row) => {
    const values = parseCsvLine(row);
    const record = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
    const lat = parseOptionalNumber(record.latitude_deg);
    const lon = parseOptionalNumber(record.longitude_deg);
    const ident = record.ident || record.icao_code || record.gps_code || record.iata_code;
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !/^[A-Z]{4}$/.test(ident) || !String(record.type || '').endsWith('airport')) return null;

    return {
      id: ident,
      name: record.name || ident,
      type: record.type || 'airport',
      lat,
      lon,
      altitudeFt: Math.round(parseOptionalNumber(record.elevation_ft) || 0),
      isoCountry: record.iso_country || '',
      municipality: record.municipality || '',
      iataCode: record.iata_code || '',
      icaoCode: record.icao_code || '',
    };
  }).filter(Boolean);

  airportCsvCache = {mtimeMs: stats.mtimeMs, airports};
  return airports;
}

function distanceNm(from, to) {
  const radiusNm = 3440.065;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLat = ((to.lat - from.lat) * Math.PI) / 180;
  const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return radiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingDeg(from, to) {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function isVorNavaid(navaid) {
  return String(navaid.type || '').toUpperCase().startsWith('VOR');
}

function mapNavaidsForOrigin(navaids, origin) {
  return navaids.map((navaid) => ({
    id: navaid.id,
    name: navaid.name || navaid.id,
    type: navaid.type || 'NAVAID',
    frequencyKhz: navaid.frequencyKhz ?? null,
    bearing: bearingDeg(origin, navaid),
    distanceNm: distanceNm(origin, navaid),
    lat: navaid.lat,
    lon: navaid.lon,
    altitudeFt: Math.round(navaid.altitudeFt ?? navaid.altitude ?? 0),
    isoCountry: navaid.isoCountry || '',
    associatedAirport: navaid.associatedAirport || '',
  }));
}

function mapAirportsForOrigin(airports, origin) {
  return airports.map((airport) => ({
    id: airport.id,
    name: airport.name || airport.id,
    type: airport.type || 'airport',
    bearing: bearingDeg(origin, airport),
    distanceNm: distanceNm(origin, airport),
    lat: airport.lat,
    lon: airport.lon,
    altitudeFt: airport.altitudeFt,
    isoCountry: airport.isoCountry || '',
    municipality: airport.municipality || '',
    iataCode: airport.iataCode || '',
    icaoCode: airport.icaoCode || '',
  }));
}

function buildRoutePath(coordinates) {
  let totalDistanceNm = 0;
  return coordinates.map((point, index) => {
    if (index > 0) {
      totalDistanceNm += distanceNm(coordinates[index - 1], point);
    }
    return {
      ...point,
      routeDistanceNm: totalDistanceNm,
    };
  });
}

function nearestRouteDistance(point, routePath) {
  if (!routePath.length) return 0;

  return routePath.reduce((nearest, routePoint) => {
    const distance = distanceNm(point, routePoint);
    return distance < nearest.distance ? {distance, routeDistanceNm: routePoint.routeDistanceNm} : nearest;
  }, {distance: Number.POSITIVE_INFINITY, routeDistanceNm: 0}).routeDistanceNm;
}

function parseKmlFile(dataDir, file) {
  const fixes = [];
  const navaids = [];
  const csvNavaids = loadNavaidsCsv(dataDir);
  const csvAirports = loadAirportsCsv(dataDir);
  let origin = null;
  let navLabel = file;
  let routePath = [];

  const body = fs.readFileSync(path.join(dataDir, file), 'utf8');
  const documentName = body.match(/<Document>[\s\S]*?<name>([\s\S]*?)<\/name>/);
  if (documentName) {
    navLabel = decodeXml(documentName[1].trim());
  }

  const routeCoordinates = body.match(/<Placemark>[\s\S]*?<name>\s*Route\s*<\/name>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>[\s\S]*?<\/Placemark>/i);
  if (routeCoordinates) {
    const coordinates = routeCoordinates[1].trim().split(/\s+/).map(parseCoordinate);
    routePath = buildRoutePath(coordinates);
    origin = routePath[0];
  }

  const placemarks = body.match(/<Placemark>[\s\S]*?<\/Placemark>/g) || [];
  placemarks.forEach((placemark) => {
    if (!/<Point>/i.test(placemark)) return;
    const name = placemark.match(/<name>([\s\S]*?)<\/name>/);
    const description = placemark.match(/<description>([\s\S]*?)<\/description>/);
    const coordinates = placemark.match(/<coordinates>([\s\S]*?)<\/coordinates>/);
    if (!name || !coordinates) return;

    const point = {
      id: decodeXml(name[1].trim()),
      ...parseCoordinate(coordinates[1]),
    };
    const descriptionText = description ? decodeXml(description[1].trim()) : '';
    if (/\(Navaids\)/i.test(descriptionText)) {
      navaids.push(point);
      return;
    }
    fixes.push(point);
  });

  if (!origin && fixes.length > 0) {
    origin = fixes[0];
  }

  if (!origin || fixes.length === 0) {
    return null;
  }

  const waypoints = fixes.map((fix, index) => ({
    id: fix.id,
    bearing: bearingDeg(origin, fix),
    distanceNm: distanceNm(origin, fix),
    lat: fix.lat,
    lon: fix.lon,
    altitudeFt: Math.round(fix.altitude),
    routeDistanceNm: nearestRouteDistance(fix, routePath),
    kind: index === 1 ? 'active' : 'fix',
  }));
  const route = waypoints.map((waypoint) => waypoint.id);
  const nextWaypoint = waypoints[1] || waypoints[0];
  const nextFix = fixes[1] || fixes[0];
  const activeBearing = nextFix ? bearingDeg(origin, nextFix) : 257;
  const routeDistanceNm = routePath.at(-1)?.routeDistanceNm || 0;
  const mappedNavaids = mapNavaidsForOrigin([...navaids, ...csvNavaids], origin);
  const [nearestNavaid] = mappedNavaids.filter(isVorNavaid).sort((a, b) => a.distanceNm - b.distanceNm);
  const mappedAirports = mapAirportsForOrigin(csvAirports, origin);

  return {
    navLabel,
    source: 'KML',
    currentPosition: {
      lat: origin.lat,
      lon: origin.lon,
      altitudeFt: Math.round(origin.altitude || 0),
      routeDistanceNm: 0,
    },
    heading: activeBearing,
    track: activeBearing,
    trueAirSpeed: 250,
    groundSpeed: 250,
    wind: {direction: 0, speed: 0},
    rangeNm: 10,
    navaidRangeNm: 250,
    navaidTypeFilters: {vor: false, dme: false, tacan: false, ndb: false, other: false},
    showAirports: false,
    nextWaypoint: nextWaypoint.id,
    distanceNm: nextWaypoint.distanceNm,
    navaids: mappedNavaids,
    airports: mappedAirports,
    radios: {
      vor1: {name: nearestNavaid?.id || null, bearing: nearestNavaid?.bearing ?? null, distanceNm: nearestNavaid?.distanceNm ?? null},
      vor2: {name: nearestNavaid?.id || null, bearing: nearestNavaid?.bearing ?? null, distanceNm: nearestNavaid?.distanceNm ?? null},
    },
    waypoints,
    route,
    routePath,
    routeDistanceNm,
  };
}

function parseKmlProfiles() {
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    return [];
  }

  return fs.readdirSync(dataDir)
    .filter((file) => file.toLowerCase().endsWith('.kml'))
    .sort((a, b) => a.localeCompare(b))
    .map((file) => {
      const navigation = parseKmlFile(dataDir, file);
      return navigation ? {id: file, name: navigation.navLabel, navigation} : null;
    })
    .filter(Boolean);
}

const fallbackNavigationState = {
  callsign: 'JX801',
  navLabel: 'ILS05L',
  mode: 'ARC',
  source: 'SIM',
  heading: 257,
  track: 257,
  groundSpeed: 250,
  trueAirSpeed: 250,
  rangeNm: 10,
  navaidRangeNm: 250,
  navaidTypeFilters: {vor: false, dme: false, tacan: false, ndb: false, other: false},
  showAirports: false,
  currentPosition: {lat: 35.765278, lon: 140.385556, altitudeFt: 41, routeDistanceNm: 0},
  routePath: [],
  routeDistanceNm: 0,
  trafficMode: 'HIDDEN',
  nextWaypoint: null,
  eta: '00:00',
  distanceNm: null,
  wind: {direction: 0, speed: 0},
  radios: {
    vor1: {name: '---', bearing: null, distanceNm: 0.38},
    vor2: {name: '---', bearing: null, distanceNm: null},
  },
  navaids: [],
  airports: [],
  waypoints: [],
  route: [],
};

function buildNoProfileNavigationState() {
  const dataDir = path.join(__dirname, 'data');
  const fallback = structuredClone(fallbackNavigationState);
  const origin = fallback.currentPosition;
  fallback.navaids = mapNavaidsForOrigin(loadNavaidsCsv(dataDir), origin);
  fallback.airports = mapAirportsForOrigin(loadAirportsCsv(dataDir), origin);
  const [nearestNavaid] = fallback.navaids.filter(isVorNavaid).sort((a, b) => a.distanceNm - b.distanceNm);
  fallback.radios = {
    ...fallback.radios,
    vor1: {name: nearestNavaid?.id || '---', bearing: nearestNavaid?.bearing ?? null, distanceNm: nearestNavaid?.distanceNm ?? null},
    vor2: {name: nearestNavaid?.id || '---', bearing: nearestNavaid?.bearing ?? null, distanceNm: nearestNavaid?.distanceNm ?? null},
  };
  return fallback;
}

let activeProfileId = null;
const navigationState = structuredClone(fallbackNavigationState);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/navigation', (req, res) => {
  const kmlProfiles = parseKmlProfiles();
  const requestedProfileId = req.query.profile || null;
  const profile = kmlProfiles.find((nextProfile) => nextProfile.id === requestedProfileId);
  if (profile) {
    activeProfileId = profile.id;
    Object.assign(navigationState, structuredClone(fallbackNavigationState), structuredClone(profile.navigation));
  } else {
    activeProfileId = null;
    Object.assign(navigationState, buildNoProfileNavigationState());
  }
  res.json(navigationState);
});

app.get('/api/profiles', (req, res) => {
  const kmlProfiles = parseKmlProfiles();
  if (!kmlProfiles.some((profile) => profile.id === activeProfileId)) {
    activeProfileId = null;
  }

  res.json({
    activeProfileId,
    profiles: kmlProfiles.map((profile) => ({id: profile.id, name: profile.name})),
  });
});

app.post('/api/navigation', (req, res) => {
  Object.assign(navigationState, req.body);
  res.json(navigationState);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const httpsOptions = {
  cert: fs.readFileSync(HTTPS_CERT_PATH),
  key: fs.readFileSync(HTTPS_KEY_PATH),
};

https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`ND web UI listening on https://0.0.0.0:${PORT}`);
});
