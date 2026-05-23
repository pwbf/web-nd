const express = require('express');
const AdmZip = require('adm-zip');
const {spawn} = require('child_process');
const fs = require('fs');
const https = require('https');
const os = require('os');
const path = require('path');
const app = express();
const PORT = process.env.PORT || 4000;
const HTTPS_CERT_PATH = process.env.HTTPS_CERT_PATH || path.join(__dirname, 'cert', 'server.crt');
const HTTPS_KEY_PATH = process.env.HTTPS_KEY_PATH || path.join(__dirname, 'cert', 'server.key');
const GMAP_JOBS_URL = process.env.GMAP_JOBS_URL || 'https://neb.pwbf.pw:8585';
const GMAP_JOBS_USER = process.env.GMAP_JOBS_USER || 'admin';
const GMAP_JOBS_PASSWORD = process.env.GMAP_JOBS_PASSWORD || '';
const GMAP_JOB_TIMEOUT_MS = Number(process.env.GMAP_JOB_TIMEOUT_MS || 180000);
const GMAP_LOCAL_TOOL_DIR = process.env.GMAP_LOCAL_TOOL_DIR || path.join(__dirname, 'GMapLink2KML');
const GMAP_LOCAL_PYTHON = process.env.GMAP_LOCAL_PYTHON || 'python3';
const GMAP_LOCAL_TIMEOUT_MS = Number(process.env.GMAP_LOCAL_TIMEOUT_MS || 180000);
const MAX_KML_UPLOAD_BYTES = Number(process.env.MAX_KML_UPLOAD_BYTES || 10 * 1024 * 1024);
const ROUTE_KML_RETENTION_HOURS = Number(process.env.ROUTE_KML_RETENTION_HOURS || 24);
const ROUTE_KML_CLEANUP_INTERVAL_MS = Number(process.env.ROUTE_KML_CLEANUP_INTERVAL_MS || 60 * 60 * 1000);
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeDataFilename(filename) {
  return path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
}

function uniqueDataPath(dataDir, filename) {
  const parsed = path.parse(safeDataFilename(filename));
  let candidate = `${parsed.name || 'route'}${parsed.ext || '.kml'}`;
  let counter = 1;
  while (fs.existsSync(path.join(dataDir, candidate))) {
    candidate = `${parsed.name || 'route'}-${counter}${parsed.ext || '.kml'}`;
    counter += 1;
  }
  return path.join(dataDir, candidate);
}

function dataKmlPath(filename) {
  const safeName = safeDataFilename(filename);
  if (!safeName || safeName !== filename || !safeName.toLowerCase().endsWith('.kml')) {
    throw new Error('A valid KML profile filename is required');
  }

  const dataDir = path.resolve(__dirname, 'data');
  const filePath = path.resolve(dataDir, safeName);
  if (!filePath.startsWith(`${dataDir}${path.sep}`)) {
    throw new Error('Invalid KML profile path');
  }
  return {safeName, filePath};
}

function uploadedKmlFilename(filename) {
  const safeName = safeDataFilename(filename);
  const parsed = path.parse(safeName);
  const base = parsed.name || 'uploaded-route';
  const prefixedBase = /^route/i.test(base) ? `uploaded-${base}` : base;
  return `${prefixedBase}.kml`;
}

function validateKmlContent(filename, content) {
  const safeName = safeDataFilename(filename);
  if (!safeName.toLowerCase().endsWith('.kml')) {
    throw new Error('Only .kml files are allowed');
  }
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('KML content is empty');
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_KML_UPLOAD_BYTES) {
    throw new Error(`KML file exceeds ${MAX_KML_UPLOAD_BYTES} bytes`);
  }
  if (content.includes('\0')) {
    throw new Error('KML content contains invalid bytes');
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(content)) {
    throw new Error('KML content with DTD or entity declarations is not allowed');
  }
  if (!/<kml[\s>]/i.test(content) || !/<coordinates>[\s\S]*?<\/coordinates>/i.test(content)) {
    throw new Error('KML content does not look like a route KML file');
  }
}

function writeKmlFile(filename, content, {preserveUploadName = false} = {}) {
  validateKmlContent(filename, content);
  const dataDir = path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, {recursive: true});
  const outputName = preserveUploadName ? uploadedKmlFilename(filename) : safeDataFilename(filename);
  const outputPath = uniqueDataPath(dataDir, outputName);
  fs.writeFileSync(outputPath, content, {mode: 0o644});
  fs.chmodSync(outputPath, 0o644);
  return path.basename(outputPath);
}

function cleanupRouteKmlFiles() {
  if (!Number.isFinite(ROUTE_KML_RETENTION_HOURS) || ROUTE_KML_RETENTION_HOURS <= 0) return;
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) return;

  const cutoff = Date.now() - ROUTE_KML_RETENTION_HOURS * 60 * 60 * 1000;
  fs.readdirSync(dataDir)
    .filter((file) => /^route.*\.kml$/i.test(file))
    .forEach((file) => {
      const filePath = path.join(dataDir, file);
      const stats = fs.statSync(filePath);
      if (stats.isFile() && stats.mtimeMs < cutoff) {
        fs.unlinkSync(filePath);
      }
    });
}

function nebulaGmapImportConfigured() {
  return Boolean(GMAP_JOBS_URL && GMAP_JOBS_USER && GMAP_JOBS_PASSWORD);
}

function localGmapImportAvailable() {
  return fs.existsSync(path.join(GMAP_LOCAL_TOOL_DIR, 'main.py'))
    && fs.existsSync(path.join(GMAP_LOCAL_TOOL_DIR, 'sample.kml'));
}

function copyLocalGmapToolFile(workDir, filename) {
  fs.copyFileSync(path.join(GMAP_LOCAL_TOOL_DIR, filename), path.join(workDir, filename));
}

function runProcess(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {...process.env, ...(options.env || {})},
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let finished = false;

    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true;
      child.kill('SIGKILL');
      reject(new Error(`${command} timed out after ${options.timeoutMs} ms`));
    }, options.timeoutMs || 180000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      reject(error);
    });
    child.on('close', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      if (code === 0) {
        resolve({stdout, stderr});
        return;
      }
      reject(new Error(`${command} exited with ${code}: ${stderr || stdout}`));
    });
  });
}

async function importGmapWithLocalTool(url) {
  if (!localGmapImportAvailable()) {
    throw new Error('Local GMapLink2KML tool is not available');
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webnd-gmap-'));
  try {
    copyLocalGmapToolFile(workDir, 'main.py');
    copyLocalGmapToolFile(workDir, 'sample.kml');
    const result = await runProcess(GMAP_LOCAL_PYTHON, ['main.py', url], {
      cwd: workDir,
      timeoutMs: GMAP_LOCAL_TIMEOUT_MS,
    });
    const [generatedFile] = fs.readdirSync(workDir)
      .filter((file) => /^route.*\.kml$/i.test(file))
      .sort((a, b) => fs.statSync(path.join(workDir, b)).mtimeMs - fs.statSync(path.join(workDir, a)).mtimeMs);

    if (!generatedFile) {
      throw new Error(`Local GMapLink2KML did not generate a route KML file: ${result.stdout || result.stderr}`);
    }

    const content = fs.readFileSync(path.join(workDir, generatedFile), 'utf8');
    const file = writeKmlFile(generatedFile, content);
    activeProfileId = file;
    return {provider: 'local', files: [file], profiles: [{id: file, name: file}], log: result.stdout.trim()};
  } finally {
    fs.rmSync(workDir, {recursive: true, force: true});
  }
}

function jobAuthHeader() {
  return `Basic ${Buffer.from(`${GMAP_JOBS_USER}:${GMAP_JOBS_PASSWORD}`).toString('base64')}`;
}

function jobRequest(method, requestPath, {headers = {}, body = null, binary = false} = {}) {
  const url = new URL(requestPath, GMAP_JOBS_URL);
  return new Promise((resolve, reject) => {
    const request = https.request({
      method,
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      rejectUnauthorized: false,
      headers: {
        Authorization: jobAuthHeader(),
        ...headers,
      },
    }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const buffer = Buffer.concat(chunks);
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`Job API ${method} ${url.pathname} failed with ${response.statusCode}: ${buffer.toString('utf8')}`));
          return;
        }
        if (binary) {
          resolve(buffer);
          return;
        }
        const text = buffer.toString('utf8');
        try {
          resolve(text ? JSON.parse(text) : {});
        } catch (error) {
          reject(new Error(`Job API returned invalid JSON: ${text}`));
        }
      });
    });
    request.on('error', reject);
    if (body) request.write(body);
    request.end();
  });
}

function multipartBody(fields) {
  const boundary = `----webnd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const chunks = [];
  Object.entries(fields).forEach(([name, value]) => {
    chunks.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  });
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  const body = Buffer.concat(chunks);
  return {body, boundary};
}

function jobIdFromResponse(response) {
  return response.job_id || response.id || response.uuid || response.job?.id || response.job?.job_id;
}

function jobStatus(job) {
  return String(job.status || job.state || job.phase || '').toLowerCase();
}

async function submitGmapJob(url) {
  const metadata = JSON.stringify({url, output_filename: 'route-kml.zip'});
  const {body, boundary} = multipartBody({capability: 'gmap2kml', metadata});
  const response = await jobRequest('POST', '/jobs', {
    body,
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': body.length,
    },
  });
  const jobId = jobIdFromResponse(response);
  if (!jobId) throw new Error('Job API did not return a job id');
  return jobId;
}

async function waitForJob(jobId) {
  const start = Date.now();
  while (Date.now() - start < GMAP_JOB_TIMEOUT_MS) {
    const job = await jobRequest('GET', `/jobs/${encodeURIComponent(jobId)}`);
    const status = jobStatus(job);
    if (['complete', 'completed', 'done', 'success', 'succeeded'].includes(status)) return job;
    if (['failed', 'error', 'cancelled', 'canceled', 'dangled'].includes(status)) {
      throw new Error(`Google Maps import job ${jobId} ended with status ${status}`);
    }
    await sleep(2000);
  }
  throw new Error(`Google Maps import job ${jobId} timed out`);
}

function extractKmlFiles(zipBuffer) {
  const zip = new AdmZip(zipBuffer);
  const writtenFiles = [];
  zip.getEntries()
    .filter((entry) => !entry.isDirectory && entry.entryName.toLowerCase().endsWith('.kml'))
    .forEach((entry) => {
      const filename = path.basename(entry.entryName);
      const content = entry.getData().toString('utf8');
      writtenFiles.push(writeKmlFile(filename, content));
    });
  if (!writtenFiles.length) throw new Error('Downloaded zip did not contain any KML files');
  return writtenFiles;
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
  callsign: 'AX200',
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
  currentPosition: {lat: 25.0777, lon: 121.233002, altitudeFt: 200, routeDistanceNm: 0},
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

app.use(express.json({limit: MAX_KML_UPLOAD_BYTES + 1024}));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/config', (req, res) => {
  const nebulaConfigured = nebulaGmapImportConfigured();
  const localAvailable = localGmapImportAvailable();
  res.json({
    gmapImportEnabled: nebulaConfigured || localAvailable,
    gmapImportProvider: nebulaConfigured ? 'nebula' : localAvailable ? 'local' : null,
    maxKmlUploadBytes: MAX_KML_UPLOAD_BYTES,
    routeKmlRetentionHours: ROUTE_KML_RETENTION_HOURS,
  });
});

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

app.post('/api/gmap/import', async (req, res) => {
  try {
    const url = String(req.body?.url || '').trim();
    if (!url || !/^https:\/\/(maps\.app\.goo\.gl|www\.google\.com\/maps|maps\.google\.com)\//i.test(url)) {
      res.status(400).json({error: 'A valid Google Maps URL is required'});
      return;
    }
    if (!nebulaGmapImportConfigured()) {
      const result = await importGmapWithLocalTool(url);
      res.json(result);
      return;
    }

    const jobId = await submitGmapJob(url);
    const job = await waitForJob(jobId);
    const zipBuffer = await jobRequest('GET', `/jobs/${encodeURIComponent(jobId)}/download`, {binary: true});
    const files = extractKmlFiles(zipBuffer);
    const [firstFile] = files;
    if (firstFile) activeProfileId = firstFile;
    res.json({provider: 'nebula', jobId, job, files, profiles: files.map((file) => ({id: file, name: file}))});
  } catch (error) {
    console.error('Google Maps import failed', error);
    res.status(500).json({error: error.message});
  }
});

app.post('/api/kml/upload', (req, res) => {
  try {
    const filename = String(req.body?.filename || '').trim();
    const content = String(req.body?.content || '');
    const file = writeKmlFile(filename, content, {preserveUploadName: true});
    activeProfileId = file;
    res.json({file, profile: {id: file, name: file}});
  } catch (error) {
    res.status(400).json({error: error.message});
  }
});

app.delete('/api/kml/:filename', (req, res) => {
  try {
    const {safeName, filePath} = dataKmlPath(req.params.filename);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.status(404).json({error: 'KML profile not found'});
      return;
    }

    fs.unlinkSync(filePath);
    if (activeProfileId === safeName) {
      activeProfileId = null;
      Object.assign(navigationState, buildNoProfileNavigationState());
    }
    res.json({deleted: safeName});
  } catch (error) {
    res.status(400).json({error: error.message});
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const httpsOptions = {
  cert: fs.readFileSync(HTTPS_CERT_PATH),
  key: fs.readFileSync(HTTPS_KEY_PATH),
};

try {
  cleanupRouteKmlFiles();
} catch (error) {
  console.warn('Route KML cleanup failed', error);
}

if (Number.isFinite(ROUTE_KML_CLEANUP_INTERVAL_MS) && ROUTE_KML_CLEANUP_INTERVAL_MS > 0) {
  setInterval(() => {
    try {
      cleanupRouteKmlFiles();
    } catch (error) {
      console.warn('Route KML cleanup failed', error);
    }
  }, ROUTE_KML_CLEANUP_INTERVAL_MS).unref();
}

https.createServer(httpsOptions, app).listen(PORT, () => {
  console.log(`ND web UI listening on https://0.0.0.0:${PORT}`);
});
