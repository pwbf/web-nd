const express = require('express');
const fs = require('fs');
const https = require('https');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 8500;
const HTTPS_CERT_PATH = process.env.HTTPS_CERT_PATH || path.join(__dirname, 'cert', 'server.crt');
const HTTPS_KEY_PATH = process.env.HTTPS_KEY_PATH || path.join(__dirname, 'cert', 'server.key');

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
    nextWaypoint: nextWaypoint.id,
    distanceNm: nextWaypoint.distanceNm,
    navaids: navaids.map((navaid) => ({
      id: navaid.id,
      bearing: bearingDeg(origin, navaid),
      distanceNm: distanceNm(origin, navaid),
      lat: navaid.lat,
      lon: navaid.lon,
      altitudeFt: Math.round(navaid.altitude),
    })),
    radios: {
      vor1: {name: navaids[0]?.id || null, bearing: navaids[0] ? bearingDeg(origin, navaids[0]) : null, distanceNm: navaids[0] ? distanceNm(origin, navaids[0]) : null},
      vor2: {name: navaids[0]?.id || null, bearing: navaids[0] ? bearingDeg(origin, navaids[0]) : null, distanceNm: navaids[0] ? distanceNm(origin, navaids[0]) : null},
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
  trafficMode: 'HIDDEN',
  nextWaypoint: '87POY',
  eta: '00:00',
  distanceNm: 1.0,
  wind: {direction: 0, speed: 0},
  radios: {
    vor1: {name: '---', bearing: null, distanceNm: 0.38},
    vor2: {name: '---', bearing: null, distanceNm: null},
  },
  navaids: [],
  waypoints: [
    {id: 'R24SN', bearing: 346, distanceNm: 15.4, kind: 'fix'},
    {id: 'J3POY', bearing: 350, distanceNm: 13.2, kind: 'fix'},
    {id: '87POY', bearing: 2, distanceNm: 9.7, kind: 'active'},
    {id: '20TNQ', bearing: 35, distanceNm: 10.6, kind: 'fix'},
    {id: '35TNQ', bearing: 42, distanceNm: 8.8, kind: 'fix'},
    {id: '13BT', bearing: 70, distanceNm: 17.4, kind: 'fix'},
    {id: '49POY', bearing: 318, distanceNm: 5.8, kind: 'fix'},
    {id: '31PT', bearing: 300, distanceNm: 3.3, kind: 'fix'},
    {id: 'YP024', bearing: 80, distanceNm: 2.2, kind: 'fix'},
    {id: '10TNQ', bearing: 118, distanceNm: 5.4, kind: 'fix'},
  ],
  route: ['R24SN', 'J3POY', '87POY', '49POY', '31PT', 'YP024', '10TNQ'],
};

let activeProfileId = null;
const navigationState = structuredClone(fallbackNavigationState);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/navigation', (req, res) => {
  const kmlProfiles = parseKmlProfiles();
  const requestedProfileId = req.query.profile || activeProfileId || kmlProfiles[0]?.id;
  const profile = kmlProfiles.find((nextProfile) => nextProfile.id === requestedProfileId);
  if (profile) {
    activeProfileId = profile.id;
    Object.assign(navigationState, structuredClone(fallbackNavigationState), structuredClone(profile.navigation));
  } else {
    Object.assign(navigationState, structuredClone(fallbackNavigationState));
  }
  res.json(navigationState);
});

app.get('/api/profiles', (req, res) => {
  const kmlProfiles = parseKmlProfiles();
  if (!kmlProfiles.some((profile) => profile.id === activeProfileId)) {
    activeProfileId = kmlProfiles[0]?.id || null;
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
