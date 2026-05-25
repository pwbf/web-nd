const canvas = document.getElementById('ndCanvas');
const ctx = canvas.getContext('2d');

const colors = {
  bg: '#000000',
  cyan: '#05d8ff',
  green: '#00ff3b',
  magenta: '#d100ff',
  amber: '#e3c700',
  white: '#d0d0d0',
  grey: '#9a9a9a',
};

const ARC_SWEEP_DEG = 180;
const ARC_HALF_SWEEP = ARC_SWEEP_DEG / 2;
const FONT = '"Roboto Mono", "Consolas", "Lucida Console", monospace';
const METERS_PER_NM = 1852;
const DEFAULT_GPS_HEADING_MIN_SPEED_MPS = 2;
const GPS_PRIMARY_DISPLAY_MS = 60000;
const AUTOPILOT_DISCONNECT_SOUND_URL = '/api/sounds/airbus-autopilot-disconnect';
const SETTINGS_COOKIE_NAME = 'webnd_settings';
const SETTINGS_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

const DEBUG_CANVAS_COORDS = true;
const DEBUG_INVERTED_NAVAID = true;

const fallbackState = {
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
  showCourseRoute: true,
  currentPosition: {lat: 25.0777, lon: 121.233002, altitudeFt: 200, routeDistanceNm: 0},
  routePath: [],
  routeDistanceNm: 0,
  trafficMode: 'HIDDEN',
  nextWaypoint: null,
  eta: '00:00',
  distanceNm: null,
  gpsHeadingMinSpeedMps: DEFAULT_GPS_HEADING_MIN_SPEED_MPS,
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

const state = structuredClone(fallbackState);
let simulationPlaying = false;
let lastTime = performance.now();
let baselineState = structuredClone(fallbackState);
let locationWatchId = null;
let previousGpsPosition = null;
let previousGpsTimestamp = null;
let visibleNavaidTableSignature = '';
let visibleAirportTableSignature = '';
let gpsPrimaryVisibleUntil = 0;
let toastTimer = null;
let serverConfig = {gmapImportEnabled: false, gmapImportProvider: null};
let soundEnabled = false;
let soundAvailable = false;
let autopilotDisconnectSoundObjectUrl = '';
let savedSettings = {};

const els = {
  instrument: document.querySelector('.instrument'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  gs: document.getElementById('gsReadout'),
  tas: document.getElementById('tasReadout'),
  windArrow: document.getElementById('windArrow'),
  windDirectionTop: document.getElementById('windDirectionReadoutTop'),
  windSpeedTop: document.getElementById('windSpeedReadoutTop'),
  heading: document.getElementById('headingReadout'),
  nextDistance: document.getElementById('nextDistanceReadout'),
  distanceUnit: document.getElementById('distanceUnitReadout'),
  eta: document.getElementById('etaReadout'),
  vor1Name: document.getElementById('vor1Name'),
  vor1DistValue: document.getElementById('vor1DistValue'),
  vor1DistUnit: document.getElementById('vor1DistUnit'),
  vor2Name: document.getElementById('vor2Name'),
  vor2DistValue: document.getElementById('vor2DistValue'),
  vor2DistUnit: document.getElementById('vor2DistUnit'),
  navaidPanel: document.getElementById('navaidPanel'),
  visibleNavaidCount: document.getElementById('visibleNavaidCount'),
  visibleNavaidTableBody: document.getElementById('visibleNavaidTableBody'),
  airportPanel: document.getElementById('airportPanel'),
  visibleAirportCount: document.getElementById('visibleAirportCount'),
  visibleAirportTableBody: document.getElementById('visibleAirportTableBody'),
  trafficStatus: document.getElementById('trafficStatus'),
  copyrightYear: document.getElementById('copyrightYear'),
  toast: document.getElementById('toast'),
  controlsPanel: document.querySelector('.controls'),
  controlsToggle: document.getElementById('controlsToggle'),
  mobileControlsToggle: document.getElementById('mobileControlsToggle'),
  profile: document.getElementById('profileControl'),
  kmlDeleteButton: document.getElementById('kmlDeleteButton'),
  cleanCookieButton: document.getElementById('cleanCookieButton'),
  kmlProfileStatus: document.getElementById('kmlProfileStatus'),
  gmapImportRow: document.getElementById('gmapImportRow'),
  gmapUrl: document.getElementById('gmapUrlControl'),
  gmapImport: document.getElementById('gmapImportButton'),
  gmapImportStatus: document.getElementById('gmapImportStatus'),
  kmlUpload: document.getElementById('kmlUploadControl'),
  kmlUploadButton: document.getElementById('kmlUploadButton'),
  kmlUploadStatus: document.getElementById('kmlUploadStatus'),
  range: document.getElementById('rangeControl'),
  navaidRange: document.getElementById('navaidRangeControl'),
  showVor: document.getElementById('showVorControl'),
  showDme: document.getElementById('showDmeControl'),
  showTacan: document.getElementById('showTacanControl'),
  showNdb: document.getElementById('showNdbControl'),
  showOtherNavaid: document.getElementById('showOtherNavaidControl'),
  showAirports: document.getElementById('showAirportsControl'),
  layerButtons: document.querySelectorAll('[data-layer-toggle]'),
  unit: document.getElementById('unitControl'),
  hudMode: document.getElementById('hudModeControl'),
  headingControl: document.getElementById('headingControl'),
  latitudeControl: document.getElementById('latitudeControl'),
  longitudeControl: document.getElementById('longitudeControl'),
  progressControl: document.getElementById('progressControl'),
  progressControlRow: document.getElementById('progressControlRow'),
  progressReadout: document.getElementById('progressReadout'),
  trueAirSpeedControl: document.getElementById('trueAirSpeedControl'),
  trueAirSpeedControlRow: document.getElementById('trueAirSpeedControlRow'),
  trueAirSpeedReadout: document.getElementById('trueAirSpeedReadout'),
  windSpeedControl: document.getElementById('windSpeedControl'),
  windSpeedReadout: document.getElementById('windSpeedReadout'),
  windDirectionControl: document.getElementById('windDirectionControl'),
  windDirectionReadout: document.getElementById('windDirectionReadout'),
  gpsHeadingMinSpeedControl: document.getElementById('gpsHeadingMinSpeedControl'),
  gpsHeadingMinSpeedReadout: document.getElementById('gpsHeadingMinSpeedReadout'),
  play: document.getElementById('playButton'),
  sound: document.getElementById('soundButton'),
  soundStatus: document.getElementById('soundStatus'),
  location: document.getElementById('locationButton'),
  gpsStatus: document.getElementById('gpsStatus'),
  fakeHeading: document.getElementById('fakeHeadingControl'),
  debugPanel: document.getElementById('debugPanel'),
  debugLog: document.getElementById('debugLog'),
  modeButtons: document.querySelectorAll('[data-mode]'),
};

els.copyrightYear.textContent = String(new Date().getFullYear());
savedSettings = loadSettingsCookie();

function debugValue(value, formatter = (nextValue) => nextValue) {
  return Number.isFinite(value) ? formatter(value) : 'n/a';
}

function debugLog(message) {
  const timestamp = new Date().toLocaleTimeString();
  const nextLine = `[${timestamp}] ${message}`;
  const lines = [nextLine, ...(els.debugLog.textContent ? els.debugLog.textContent.split('\n') : [])].slice(0, 80);
  els.debugLog.textContent = lines.join('\n');
}

function openDebugPanel() {
  if (els.debugPanel) {
    els.debugPanel.open = true;
  }
}

function showToast(message) {
  if (!els.toast) return;
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  toastTimer = window.setTimeout(() => {
    els.toast.hidden = true;
  }, 3200);
}

function readCookie(name) {
  const prefix = `${encodeURIComponent(name)}=`;
  const cookie = document.cookie.split('; ').find((item) => item.startsWith(prefix));
  return cookie ? decodeURIComponent(cookie.slice(prefix.length)) : '';
}

function writeCookie(name, value, maxAge = SETTINGS_COOKIE_MAX_AGE) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`;
}

function clearReadableCookies() {
  document.cookie.split(';').forEach((cookie) => {
    const [rawName] = cookie.trim().split('=');
    if (!rawName) return;
    document.cookie = `${rawName}=; Max-Age=0; Path=/; SameSite=Lax`;
    document.cookie = `${rawName}=; Max-Age=0; Path=/; SameSite=Lax; Secure`;
  });
}

function loadSettingsCookie() {
  try {
    const raw = readCookie(SETTINGS_COOKIE_NAME);
    return raw ? JSON.parse(raw) : {};
  } catch (error) {
    console.warn('Unable to load settings cookie', error);
    return {};
  }
}

function numberSetting(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function collectSettings() {
  return {
    version: 1,
    profileId: els.profile?.value || '',
    rangeNm: Number(els.range.value),
    navaidRangeNm: Number(els.navaidRange.value),
    unit: els.unit.value,
    mode: state.mode,
    hudMode: els.hudMode.checked,
    heading: Number(els.headingControl.value),
    latitude: Number(els.latitudeControl.value),
    longitude: Number(els.longitudeControl.value),
    trueAirSpeed: Number(els.trueAirSpeedControl.value),
    windSpeed: Number(els.windSpeedControl.value),
    windDirection: Number(els.windDirectionControl.value),
    gpsHeadingMinSpeedMps: Number(els.gpsHeadingMinSpeedControl.value),
    navaidTypeFilters: {...state.navaidTypeFilters},
    showAirports: Boolean(state.showAirports),
    showCourseRoute: state.showCourseRoute !== false,
    soundEnabled: Boolean(soundEnabled),
    controlsCollapsed: els.controlsPanel.classList.contains('collapsed'),
  };
}

function saveSettings() {
  try {
    savedSettings = collectSettings();
    writeCookie(SETTINGS_COOKIE_NAME, JSON.stringify(savedSettings));
  } catch (error) {
    console.warn('Unable to save settings cookie', error);
  }
}

function applySavedSettingsToState() {
  if (!savedSettings || typeof savedSettings !== 'object') return;

  state.rangeNm = numberSetting(savedSettings.rangeNm, state.rangeNm);
  state.navaidRangeNm = numberSetting(savedSettings.navaidRangeNm, state.navaidRangeNm);
  state.mode = ['ARC', 'ROSE'].includes(savedSettings.mode) ? savedSettings.mode : state.mode;
  state.heading = normalizeDegrees(numberSetting(savedSettings.heading, state.heading));
  state.trueAirSpeed = numberSetting(savedSettings.trueAirSpeed, state.trueAirSpeed);
  state.wind = {
    ...state.wind,
    speed: numberSetting(savedSettings.windSpeed, state.wind.speed),
    direction: normalizeDegrees(numberSetting(savedSettings.windDirection, state.wind.direction)),
  };
  state.gpsHeadingMinSpeedMps = numberSetting(savedSettings.gpsHeadingMinSpeedMps, state.gpsHeadingMinSpeedMps);
  if (savedSettings.navaidTypeFilters && typeof savedSettings.navaidTypeFilters === 'object') {
    state.navaidTypeFilters = {...state.navaidTypeFilters, ...savedSettings.navaidTypeFilters};
  }
  if (typeof savedSettings.showAirports === 'boolean') {
    state.showAirports = savedSettings.showAirports;
  }
  if (typeof savedSettings.showCourseRoute === 'boolean') {
    state.showCourseRoute = savedSettings.showCourseRoute;
  }
  if (Number.isFinite(Number(savedSettings.latitude)) && Number.isFinite(Number(savedSettings.longitude))) {
    state.currentPosition = {
      ...(state.currentPosition || {}),
      lat: Number(savedSettings.latitude),
      lon: Number(savedSettings.longitude),
      routeDistanceNm: nearestRouteDistance({lat: Number(savedSettings.latitude), lon: Number(savedSettings.longitude)}),
    };
  }
  applyWindCorrection();
}

function applySavedSettingsToControls() {
  if (!savedSettings || typeof savedSettings !== 'object') return;
  if ([...els.range.options].some((option) => option.value === String(savedSettings.rangeNm))) {
    els.range.value = String(savedSettings.rangeNm);
  }
  if ([...els.navaidRange.options].some((option) => option.value === String(savedSettings.navaidRangeNm))) {
    els.navaidRange.value = String(savedSettings.navaidRangeNm);
  }
  if ([...els.unit.options].some((option) => option.value === savedSettings.unit)) {
    els.unit.value = savedSettings.unit;
  }
  els.hudMode.checked = Boolean(savedSettings.hudMode);
  els.instrument.classList.toggle('hud-mirror', els.hudMode.checked);
}

function hideLoadingOverlay() {
  if (els.loadingOverlay) {
    els.loadingOverlay.hidden = true;
  }
}

function setControlsCollapsed(collapsed) {
  els.controlsPanel.classList.toggle('collapsed', collapsed);
  const label = collapsed ? 'Menu' : 'Close';
  els.controlsToggle.textContent = label;
  els.controlsToggle.setAttribute('aria-expanded', String(!collapsed));
  if (els.mobileControlsToggle) {
    els.mobileControlsToggle.textContent = label;
    els.mobileControlsToggle.classList.toggle('open', !collapsed);
    els.mobileControlsToggle.setAttribute('aria-expanded', String(!collapsed));
  }
}

function applySavedSettingsAfterNavigation() {
  applySavedSettingsToState();
  applySavedSettingsToControls();
  syncRangeOptionLabels();
  syncLayerControls();
  syncHeadingControl();
  syncPositionControls();
  els.trueAirSpeedControl.value = String(Math.round(state.trueAirSpeed));
  els.trueAirSpeedReadout.textContent = speedText(state.trueAirSpeed);
  els.windSpeedControl.value = String(Math.round(state.wind.speed));
  els.windSpeedReadout.textContent = speedText(state.wind.speed);
  els.windDirectionControl.value = String(Math.round(state.wind.direction));
  els.windDirectionReadout.textContent = `${headingText(state.wind.direction)}°`;
  els.gpsHeadingMinSpeedControl.value = String(state.gpsHeadingMinSpeedMps);
  els.gpsHeadingMinSpeedReadout.textContent = gpsHeadingMinSpeedText(state.gpsHeadingMinSpeedMps);
  updateModeButtons();
  syncRouteProgressAvailability();
  if (soundAvailable) {
    setSoundSwitchState(Boolean(savedSettings.soundEnabled));
  } else if (savedSettings.soundEnabled) {
    setSoundSwitchState(false, {fault: true, message: els.soundStatus?.textContent || 'Sound unavailable'});
  }
}

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function headingText(value) {
  const normalized = Math.round(normalizeDegrees(value));
  return String(normalized === 0 ? 360 : normalized).padStart(3, '0');
}

function syncHeadingControl() {
  els.headingControl.value = String(Math.round(normalizeDegrees(state.heading)) % 360);
}

function useMeters() {
  return els.unit.value === 'm';
}

function useKilometers() {
  return els.unit.value === 'km';
}

function metersPerSecondToNmPerHour(value) {
  return (value * 3600) / METERS_PER_NM;
}

function nmPerHourToMetersPerSecond(value) {
  return (value * METERS_PER_NM) / 3600;
}

function distanceValue(valueNm) {
  if (useMeters()) return valueNm * METERS_PER_NM;
  if (useKilometers()) return valueNm * 1.852;
  return valueNm;
}

function distanceUnitText() {
  if (useMeters()) return 'm';
  if (useKilometers()) return 'km';
  return 'NM';
}

function speedText(valueNmPerHour) {
  if (useMeters()) {
    return `${Math.round(nmPerHourToMetersPerSecond(valueNmPerHour))} m/s`;
  }
  if (useKilometers()) {
    return `${Math.round(valueNmPerHour * 1.852)} km/h`;
  }
  return `${Math.round(valueNmPerHour)} NM/H`;
}

function speedReadoutValue(valueNmPerHour) {
  if (useMeters()) return Math.round(nmPerHourToMetersPerSecond(valueNmPerHour));
  if (useKilometers()) return Math.round(valueNmPerHour * 1.852);
  return Math.round(valueNmPerHour);
}

function navaidFrequencyText(frequencyKhz) {
  if (!Number.isFinite(frequencyKhz)) return '---';
  if (frequencyKhz >= 10000) return `${(frequencyKhz / 1000).toFixed(2)} MHz`;
  return `${Math.round(frequencyKhz)} kHz`;
}

function coordinateText(value) {
  return Number.isFinite(value) ? value.toFixed(5) : '---';
}

function tableDistanceText(distanceNm) {
  if (!Number.isFinite(distanceNm)) return '---';
  const value = distanceValue(distanceNm);
  const decimals = useMeters() ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${distanceUnitText()}`;
}

function navaidType(value) {
  return String(value || '').toUpperCase();
}

function isVorNavaid(navaid) {
  return navaidType(navaid.type).startsWith('VOR');
}

function isTrackedVorNavaid(navaid) {
  return isVorNavaid(navaid) && navaid.id === state.radios?.vor1?.name;
}

function navaidCategory(navaid) {
  const type = navaidType(navaid.type);
  if (type.startsWith('VOR')) return 'vor';
  if (type.startsWith('NDB')) return 'ndb';
  if (type === 'DME') return 'dme';
  if (type === 'TACAN') return 'tacan';
  return 'other';
}

function navaidTypeIsVisible(navaid) {
  if (isVorNavaid(navaid)) {
    return Boolean(state.navaidTypeFilters?.vor) || isTrackedVorNavaid(navaid);
  }
  return state.navaidTypeFilters?.[navaidCategory(navaid)] ?? true;
}

function activeMapLayer() {
  if (state.showAirports) return 'arpt';
  if (state.navaidTypeFilters?.ndb) return 'ndb';
  if (state.navaidTypeFilters?.vor && state.navaidTypeFilters?.dme) return 'vor-d';
  return null;
}

function syncLayerToggles() {
  const activeLayer = activeMapLayer();
  els.layerButtons.forEach((button) => {
    const layer = button.dataset.layerToggle;
    const active = layer === 'csrt' ? state.showCourseRoute !== false : layer === activeLayer;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function syncLayerControls() {
  els.showVor.checked = Boolean(state.navaidTypeFilters?.vor);
  els.showDme.checked = Boolean(state.navaidTypeFilters?.dme);
  els.showTacan.checked = Boolean(state.navaidTypeFilters?.tacan);
  els.showNdb.checked = Boolean(state.navaidTypeFilters?.ndb);
  els.showOtherNavaid.checked = Boolean(state.navaidTypeFilters?.other);
  els.showAirports.checked = Boolean(state.showAirports);
  syncLayerToggles();
}

function applyExclusiveMapLayer(layer) {
  state.navaidTypeFilters = {
    ...state.navaidTypeFilters,
    vor: layer === 'vor-d',
    dme: layer === 'vor-d',
    ndb: layer === 'ndb',
    tacan: false,
    other: false,
  };
  state.showAirports = layer === 'arpt';
  visibleNavaidTableSignature = '';
  visibleAirportTableSignature = '';
  syncLayerControls();
}

function gpsHeadingMinSpeedText(valueMps) {
  return `${Number(valueMps).toFixed(1)} m/s`;
}

function syncRangeOptionLabels() {
  [...els.range.options].forEach((option) => {
    const valueNm = Number(option.value);
    option.textContent = `${rangeLabel(valueNm)} ${distanceUnitText()}`;
  });
}

function bearingDelta(bearing, heading) {
  return ((bearing - heading + 540) % 360) - 180;
}

function distanceNmBetween(from, to) {
  const radiusNm = 3440.065;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLat = ((to.lat - from.lat) * Math.PI) / 180;
  const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
  const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
  return radiusNm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function bearingBetween(from, to) {
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const deltaLon = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(deltaLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
  return normalizeDegrees((Math.atan2(y, x) * 180) / Math.PI);
}

function vectorFromBearing(speed, bearing) {
  const radians = (bearing * Math.PI) / 180;
  return {
    x: Math.sin(radians) * speed,
    y: Math.cos(radians) * speed,
  };
}

function bearingFromVector(vector) {
  if (Math.abs(vector.x) < 0.000001 && Math.abs(vector.y) < 0.000001) {
    return state.heading;
  }
  return normalizeDegrees((Math.atan2(vector.x, vector.y) * 180) / Math.PI);
}

function applyWindCorrection() {
  const tas = Math.max(0, Number(state.trueAirSpeed) || 0);
  const windSpeed = Math.max(0, Number(state.wind?.speed) || 0);
  const windFrom = normalizeDegrees(Number(state.wind?.direction) || 0);
  const aircraftVector = vectorFromBearing(tas, state.heading);
  const windVector = vectorFromBearing(windSpeed, normalizeDegrees(windFrom + 180));
  const groundVector = {
    x: aircraftVector.x + windVector.x,
    y: aircraftVector.y + windVector.y,
  };

  state.groundSpeed = Math.hypot(groundVector.x, groundVector.y);
  state.track = bearingFromVector(groundVector);
}

function nmText(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return `--- ${distanceUnitText()}`;
  }
  const displayValue = distanceValue(Number(value));
  const decimals = useMeters() ? 0 : displayValue < 10 ? 2 : 0;
  return `${displayValue.toFixed(decimals)} ${distanceUnitText()}`;
}

function distanceParts(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return {value: '---', unit: distanceUnitText()};
  }
  const displayValue = distanceValue(Number(value));
  const decimals = useMeters() ? 0 : displayValue < 10 ? 2 : 0;
  return {value: displayValue.toFixed(decimals), unit: distanceUnitText()};
}

function syncRadioDistance(valueEl, unitEl, distanceNm) {
  const parts = distanceParts(distanceNm);
  valueEl.textContent = parts.value;
  unitEl.textContent = parts.unit;
}

function rangeLabel(value) {
  const displayValue = distanceValue(value);
  if (useMeters()) {
    return String(Math.round(displayValue));
  }
  return Number.isInteger(displayValue) ? String(displayValue) : displayValue.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}

function etaText(distanceNm, groundSpeed) {
  if (!Number.isFinite(distanceNm) || !Number.isFinite(groundSpeed) || groundSpeed <= 0) {
    return '--:--';
  }

  const totalSeconds = Math.max(0, Math.round((distanceNm / groundSpeed) * 3600));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function mergeNavigation(nextState) {
  Object.assign(state, structuredClone(fallbackState), nextState);
  state.radios = {...fallbackState.radios, ...(nextState.radios || {})};
  state.wind = {...fallbackState.wind, ...(nextState.wind || {})};
  state.navaidTypeFilters = {...fallbackState.navaidTypeFilters, ...(nextState.navaidTypeFilters || state.navaidTypeFilters || {})};
  state.showCourseRoute = nextState.showCourseRoute ?? state.showCourseRoute ?? fallbackState.showCourseRoute;
  state.waypoints = Array.isArray(nextState.waypoints) ? nextState.waypoints : state.waypoints;
  state.navaids = Array.isArray(nextState.navaids) ? nextState.navaids : state.navaids || [];
  state.airports = Array.isArray(nextState.airports) ? nextState.airports : state.airports || [];
  state.route = Array.isArray(nextState.route) ? nextState.route : state.route;
  state.routePath = Array.isArray(nextState.routePath) ? nextState.routePath : state.routePath || [];
  visibleNavaidTableSignature = '';
  visibleAirportTableSignature = '';
  els.range.value = String(state.rangeNm);
  els.navaidRange.value = String(state.navaidRangeNm);
  syncLayerControls();
  syncRangeOptionLabels();
  syncHeadingControl();
  els.trueAirSpeedControl.value = String(Math.round(state.trueAirSpeed));
  els.trueAirSpeedReadout.textContent = speedText(state.trueAirSpeed);
  els.windSpeedControl.value = String(Math.round(state.wind.speed));
  els.windSpeedReadout.textContent = speedText(state.wind.speed);
  els.windDirectionControl.value = String(Math.round(state.wind.direction));
  els.windDirectionReadout.textContent = `${headingText(state.wind.direction)}°`;
  els.gpsHeadingMinSpeedControl.value = String(state.gpsHeadingMinSpeedMps);
  els.gpsHeadingMinSpeedReadout.textContent = gpsHeadingMinSpeedText(state.gpsHeadingMinSpeedMps);
  syncPositionControls();
  recomputeNavigationFromPosition();
  recomputeNavaidsFromPosition();
  recomputeAirportsFromPosition();
  applyWindCorrection();
  updateModeButtons();
  syncRouteProgressAvailability();
}

function clearRouteState() {
  state.waypoints = [];
  state.route = [];
  state.routePath = [];
  state.routeDistanceNm = 0;
  state.nextWaypoint = null;
  state.distanceNm = null;
  if (state.currentPosition) {
    state.currentPosition.routeDistanceNm = 0;
  }
  syncRouteProgressAvailability();
}

function syncRouteProgressAvailability() {
  const routeAvailable = Boolean(els.profile.value && state.routeDistanceNm > 0 && state.routePath?.length);
  els.progressControl.disabled = !routeAvailable;
  els.progressControlRow.classList.toggle('disabled', !routeAvailable);
  if (!routeAvailable) {
    els.progressControl.value = '0';
    els.progressReadout.textContent = '0%';
  }
}

async function loadProfiles() {
  try {
    const response = await fetch('/api/profiles');
    if (!response.ok) return;
    const {activeProfileId, profiles} = await response.json();
    els.profile.innerHTML = '';
    const noneOption = document.createElement('option');
    noneOption.value = '';
    noneOption.textContent = 'None';
    noneOption.selected = !activeProfileId;
    els.profile.append(noneOption);
    profiles.forEach((profile) => {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = profile.name || profile.id;
      option.selected = profile.id === activeProfileId;
      els.profile.append(option);
    });
    if (savedSettings.profileId && [...els.profile.options].some((option) => option.value === savedSettings.profileId)) {
      els.profile.value = savedSettings.profileId;
    }
    els.profile.disabled = false;
    syncKmlProfileActions();
  } catch (error) {
    console.warn('Unable to load KML profiles', error);
    els.profile.innerHTML = '<option value="">None</option>';
    els.profile.disabled = false;
    syncKmlProfileActions();
  }
}

function syncKmlProfileActions() {
  els.kmlDeleteButton.disabled = !els.profile.value;
  syncRouteProgressAvailability();
}

async function loadNavigation(profileId = '') {
  try {
    const response = await fetch(profileId ? `/api/navigation?profile=${encodeURIComponent(profileId)}` : '/api/navigation');
    if (!response.ok) return;
    mergeNavigation(await response.json());
  } catch (error) {
    console.warn('Using local navigation state', error);
  }
}

async function loadServerConfig() {
  try {
    const response = await fetch('/api/config');
    if (!response.ok) return;
    const config = await response.json();
    serverConfig = config;
    if (els.gmapImportRow) {
      els.gmapImportRow.hidden = !config.gmapImportEnabled;
    }
  } catch (error) {
    console.warn('Unable to load server config', error);
    if (els.gmapImportRow) {
      els.gmapImportRow.hidden = true;
    }
  }
}

async function importGoogleMapsRoute() {
  if (els.gmapImport.dataset.state === 'available') {
    els.gmapImport.dataset.state = 'idle';
    els.gmapImport.setAttribute('aria-pressed', 'false');
    els.gmapUrl.value = '';
    els.gmapImportStatus.textContent = '';
    return;
  }

  const url = els.gmapUrl.value.trim();
  if (!url) {
    els.gmapImportStatus.textContent = 'Paste a Google Maps URL';
    els.gmapImport.dataset.state = 'fault';
    els.gmapImport.setAttribute('aria-pressed', 'false');
    return;
  }

  els.gmapImport.disabled = true;
  els.gmapImport.dataset.state = 'active';
  els.gmapImport.setAttribute('aria-pressed', 'true');
  els.gmapImportStatus.textContent = serverConfig.gmapImportProvider === 'local'
    ? 'Running local GMapLink2KML...'
    : 'Submitting import job...';
  try {
    const response = await fetch('/api/gmap/import', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({url}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Import failed');

    await loadProfiles();
    const [firstFile] = result.files || [];
    if (firstFile) {
      els.profile.value = firstFile;
      saveSettings();
      await loadNavigation(firstFile);
      applySavedSettingsAfterNavigation();
      baselineState = structuredClone(state);
      syncKmlProfileActions();
      saveSettings();
    }
    els.gmapImport.dataset.state = 'available';
    els.gmapImport.setAttribute('aria-pressed', 'true');
    els.gmapImportStatus.textContent = firstFile ? `Imported ${firstFile}` : 'Import complete';
    showToast(firstFile ? `Imported and loaded ${firstFile}` : 'Google Maps import complete');
    debugLog(result.provider === 'local'
      ? 'Local Google Maps import complete'
      : `Google Maps import job ${result.jobId} complete`);
  } catch (error) {
    console.warn('Google Maps import failed', error);
    els.gmapImport.dataset.state = 'fault';
    els.gmapImport.setAttribute('aria-pressed', 'false');
    els.gmapUrl.value = '';
    els.gmapImportStatus.textContent = error.message;
  } finally {
    els.gmapImport.disabled = false;
  }
}

async function uploadKmlProfile() {
  if (els.kmlUploadButton.dataset.state === 'available') {
    els.kmlUploadButton.dataset.state = 'idle';
    els.kmlUploadButton.setAttribute('aria-pressed', 'false');
    els.kmlUpload.value = '';
    els.kmlUploadStatus.textContent = '';
    return;
  }

  const [file] = els.kmlUpload.files || [];
  if (!file) {
    els.kmlUploadStatus.textContent = 'Choose a KML file';
    els.kmlUploadButton.dataset.state = 'fault';
    els.kmlUploadButton.setAttribute('aria-pressed', 'false');
    return;
  }
  if (!file.name.toLowerCase().endsWith('.kml')) {
    els.kmlUploadStatus.textContent = 'Only .kml files are allowed';
    els.kmlUploadButton.dataset.state = 'fault';
    els.kmlUploadButton.setAttribute('aria-pressed', 'false');
    els.kmlUpload.value = '';
    return;
  }

  els.kmlUploadButton.disabled = true;
  els.kmlUploadButton.dataset.state = 'active';
  els.kmlUploadButton.setAttribute('aria-pressed', 'true');
  els.kmlUploadStatus.textContent = 'Uploading KML...';
  try {
    const content = await file.text();
    if (!/<kml[\s>]/i.test(content) || !/<coordinates>[\s\S]*?<\/coordinates>/i.test(content)) {
      throw new Error('File does not look like a route KML');
    }

    const response = await fetch('/api/kml/upload', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({filename: file.name, content}),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Upload failed');

    await loadProfiles();
    els.profile.value = result.file;
    saveSettings();
    await loadNavigation(result.file);
    applySavedSettingsAfterNavigation();
    baselineState = structuredClone(state);
    syncKmlProfileActions();
    saveSettings();
    els.kmlUploadButton.dataset.state = 'available';
    els.kmlUploadButton.setAttribute('aria-pressed', 'true');
    els.kmlUploadStatus.textContent = `Uploaded ${result.file}`;
    debugLog(`KML profile uploaded: ${result.file}`);
  } catch (error) {
    console.warn('KML upload failed', error);
    els.kmlUploadButton.dataset.state = 'fault';
    els.kmlUploadButton.setAttribute('aria-pressed', 'false');
    els.kmlUpload.value = '';
    els.kmlUploadStatus.textContent = error.message;
  } finally {
    els.kmlUploadButton.disabled = false;
  }
}

async function deleteSelectedKmlProfile() {
  const filename = els.profile.value;
  if (!filename) {
    els.kmlProfileStatus.textContent = 'Select a KML profile';
    return;
  }
  if (!window.confirm(`Delete ${filename}?`)) return;

  els.kmlDeleteButton.disabled = true;
  els.kmlProfileStatus.textContent = 'Deleting KML...';
  try {
    const response = await fetch(`/api/kml/${encodeURIComponent(filename)}`, {method: 'DELETE'});
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Delete failed');

    await loadProfiles();
    els.profile.value = '';
    clearRouteState();
    saveSettings();
    await loadNavigation('');
    applySavedSettingsAfterNavigation();
    baselineState = structuredClone(state);
    syncKmlProfileActions();
    saveSettings();
    els.kmlProfileStatus.textContent = `Deleted ${result.deleted}`;
    debugLog(`KML profile deleted: ${result.deleted}`);
  } catch (error) {
    console.warn('KML delete failed', error);
    els.kmlProfileStatus.textContent = error.message;
  } finally {
    syncKmlProfileActions();
  }
}

async function cleanClientCookies() {
  if (!window.confirm('Clean cookies for this WebND session? Uploaded/imported KML ownership tied to this browser session will no longer be available.')) {
    return;
  }

  try {
    const response = await fetch('/api/session/clear', {method: 'POST'});
    if (!response.ok) {
      const error = await response.json().catch(() => ({error: 'Unable to clean cookie'}));
      throw new Error(error.error || 'Unable to clean cookie');
    }
    clearReadableCookies();
    savedSettings = {};
    showToast('Cookies cleaned');
    window.setTimeout(() => {
      window.location.reload();
    }, 350);
  } catch (error) {
    els.kmlProfileStatus.textContent = error.message;
    debugLog(`Cookie cleanup failed: ${error.message}`);
  }
}

function syncReadouts() {
  els.gs.textContent = speedReadoutValue(state.groundSpeed);
  els.tas.textContent = speedReadoutValue(state.trueAirSpeed);
  els.windDirectionTop.textContent = headingText(state.wind.direction);
  els.windSpeedTop.textContent = Math.round(state.wind.speed);
  els.windArrow.style.transform = `rotate(${bearingDelta(state.wind.direction, state.heading) - 90}deg)`;
  els.windArrow.hidden = Math.round(state.wind.speed) <= 0;
  els.heading.textContent = headingText(state.track);
  els.nextDistance.textContent = Number.isFinite(Number(state.distanceNm)) ? Math.round(distanceValue(Number(state.distanceNm))) : '---';
  els.distanceUnit.textContent = distanceUnitText();
  els.eta.textContent = etaText(state.distanceNm, state.groundSpeed);
  els.vor1Name.textContent = state.radios.vor1.name || '---';
  syncRadioDistance(els.vor1DistValue, els.vor1DistUnit, state.radios.vor1.distanceNm);
  els.vor2Name.textContent = state.radios.vor2.name || '---';
  syncRadioDistance(els.vor2DistValue, els.vor2DistUnit, state.radios.vor2.distanceNm);
  const gpsPrimaryVisible = performance.now() < gpsPrimaryVisibleUntil;
  els.trafficStatus.textContent = 'GPS PRIMARY';
  els.trafficStatus.hidden = !gpsPrimaryVisible;
}

function visibleNavaidsForView(view) {
  if (!state.navaids?.length) return [];

  return state.navaids
    .filter((navaid) => navaid.distanceNm <= state.navaidRangeNm)
    .filter(navaidTypeIsVisible)
    .map((navaid) => ({navaid, screen: toScreen(navaid, view)}))
    .filter(({screen}) => screen.visible)
    .sort((a, b) => a.navaid.distanceNm - b.navaid.distanceNm);
}

function visibleAirportsForView(view) {
  if (!state.showAirports || !state.airports?.length) return [];

  return state.airports
    .filter((airport) => airport.distanceNm <= state.rangeNm)
    .map((airport) => ({airport, screen: toScreen(airport, view)}))
    .filter(({screen}) => screen.visible)
    .sort((a, b) => a.airport.distanceNm - b.airport.distanceNm);
}

function syncVisibleNavaidTable(visibleNavaids) {
  els.visibleNavaidCount.textContent = String(visibleNavaids.length);
  if (!els.navaidPanel.open) return;

  const tableSignature = visibleNavaids.map(({navaid}) => navaid.id).join('|');
  if (tableSignature === visibleNavaidTableSignature) return;
  visibleNavaidTableSignature = tableSignature;

  if (!visibleNavaids.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.textContent = 'No visible navaids';
    row.append(cell);
    els.visibleNavaidTableBody.replaceChildren(row);
    return;
  }

  const rows = visibleNavaids.map(({navaid}) => {
    const row = document.createElement('tr');
    [navaid.id, navaid.type || 'NAVAID', navaidFrequencyText(navaid.frequencyKhz), tableDistanceText(navaid.distanceNm), coordinateText(navaid.lat), coordinateText(navaid.lon)]
      .forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value || '---';
        row.append(cell);
      });
    return row;
  });
  els.visibleNavaidTableBody.replaceChildren(...rows);
}

function syncVisibleAirportTable(visibleAirports) {
  els.visibleAirportCount.textContent = String(visibleAirports.length);
  if (!els.airportPanel.open) return;

  const tableSignature = visibleAirports.map(({airport}) => airport.id).join('|');
  if (tableSignature === visibleAirportTableSignature) return;
  visibleAirportTableSignature = tableSignature;

  if (!visibleAirports.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 6;
    cell.textContent = 'No visible airports';
    row.append(cell);
    els.visibleAirportTableBody.replaceChildren(row);
    return;
  }

  const rows = visibleAirports.map(({airport}) => {
    const row = document.createElement('tr');
    [airport.id, airport.type || 'airport', tableDistanceText(airport.distanceNm), coordinateText(airport.lat), coordinateText(airport.lon), `${airport.isoCountry || '---'} / ${airport.municipality || '---'}`]
      .forEach((value) => {
        const cell = document.createElement('td');
        cell.textContent = value || '---';
        row.append(cell);
      });
    return row;
  });
  els.visibleAirportTableBody.replaceChildren(...rows);
}

function syncPositionControls() {
  if (!state.currentPosition) return;

  els.latitudeControl.value = Number(state.currentPosition.lat).toFixed(6);
  els.longitudeControl.value = Number(state.currentPosition.lon).toFixed(6);

  if (state.routeDistanceNm > 0) {
    const ratio = Math.max(0, Math.min(1, (state.currentPosition.routeDistanceNm || 0) / state.routeDistanceNm));
    els.progressControl.value = String(Math.round(ratio * 1000));
    els.progressReadout.textContent = `${Math.round(ratio * 100)}%`;
  }
}

function positionAtProgress(ratio) {
  if (!state.routePath?.length) {
    return state.currentPosition;
  }

  const targetDistance = ratio * state.routeDistanceNm;
  for (let i = 1; i < state.routePath.length; i += 1) {
    const previous = state.routePath[i - 1];
    const next = state.routePath[i];
    if (next.routeDistanceNm >= targetDistance) {
      const segmentDistance = next.routeDistanceNm - previous.routeDistanceNm || 1;
      const segmentRatio = (targetDistance - previous.routeDistanceNm) / segmentDistance;
      return {
        lat: previous.lat + (next.lat - previous.lat) * segmentRatio,
        lon: previous.lon + (next.lon - previous.lon) * segmentRatio,
        altitudeFt: Math.round((previous.altitude || 0) + ((next.altitude || 0) - (previous.altitude || 0)) * segmentRatio),
        routeDistanceNm: targetDistance,
      };
    }
  }

  const finalPoint = state.routePath[state.routePath.length - 1];
  return {
    lat: finalPoint.lat,
    lon: finalPoint.lon,
    altitudeFt: Math.round(finalPoint.altitude || 0),
    routeDistanceNm: state.routeDistanceNm,
  };
}

function setRouteProgress(ratio) {
  const clampedRatio = Math.max(0, Math.min(1, ratio));
  state.currentPosition = positionAtProgress(clampedRatio);
  syncPositionControls();
  recomputeNavigationFromPosition();
  recomputeNavaidsFromPosition();
  recomputeAirportsFromPosition();

  if (clampedRatio >= 1) {
    setSimulationSwitchState(false);
  }
}

function nearestRouteDistance(position) {
  if (!state.routePath?.length) return 0;

  return state.routePath.reduce((nearest, routePoint) => {
    const distance = distanceNmBetween(position, routePoint);
    return distance < nearest.distance ? {distance, routeDistanceNm: routePoint.routeDistanceNm} : nearest;
  }, {distance: Number.POSITIVE_INFINITY, routeDistanceNm: 0}).routeDistanceNm;
}

function recomputeNavigationFromPosition({updateHeading = true} = {}) {
  const ownship = state.currentPosition;
  if (!ownship) return;
  if (!state.waypoints.length) {
    state.nextWaypoint = null;
    state.distanceNm = null;
    applyWindCorrection();
    return;
  }
  if (!state.waypoints.every((wp) => Number.isFinite(wp.lat) && Number.isFinite(wp.lon))) return;

  const currentRouteDistance = ownship.routeDistanceNm ?? nearestRouteDistance(ownship);
  state.currentPosition.routeDistanceNm = currentRouteDistance;

  state.waypoints = state.waypoints.map((wp) => ({
    ...wp,
    bearing: bearingBetween(ownship, wp),
    distanceNm: distanceNmBetween(ownship, wp),
    kind: 'fix',
  }));

  const nextWaypoint = state.waypoints.find((wp) => (wp.routeDistanceNm ?? 0) > currentRouteDistance + 0.1)
    || state.waypoints.reduce((nearest, wp) => (wp.distanceNm < nearest.distanceNm ? wp : nearest), state.waypoints[0]);

  if (nextWaypoint) {
    nextWaypoint.kind = 'active';
    state.nextWaypoint = nextWaypoint.id;
    state.distanceNm = nextWaypoint.distanceNm;
    if (updateHeading) {
      state.heading = nextWaypoint.bearing;
      syncHeadingControl();
    }
    applyWindCorrection();
  }
}

function recomputeNavaidsFromPosition() {
  const ownship = state.currentPosition;
  if (!ownship || !Array.isArray(state.navaids)) return;

  state.navaids = state.navaids.map((navaid) => ({
    ...navaid,
    bearing: bearingBetween(ownship, navaid),
    distanceNm: distanceNmBetween(ownship, navaid),
  }));

  const [trackedNavaid] = state.navaids.filter(isVorNavaid).sort((a, b) => a.distanceNm - b.distanceNm);
  state.radios = {
    ...state.radios,
    vor1: {name: trackedNavaid?.id || '---', bearing: trackedNavaid?.bearing ?? null, distanceNm: trackedNavaid?.distanceNm ?? null},
    vor2: {name: trackedNavaid?.id || '---', bearing: trackedNavaid?.bearing ?? null, distanceNm: trackedNavaid?.distanceNm ?? null},
  };
}

function recomputeAirportsFromPosition() {
  const ownship = state.currentPosition;
  if (!ownship || !Array.isArray(state.airports)) return;

  state.airports = state.airports.map((airport) => ({
    ...airport,
    bearing: bearingBetween(ownship, airport),
    distanceNm: distanceNmBetween(ownship, airport),
  }));
}

function setGpsSwitchState(mode, message = '') {
  els.location.dataset.state = mode;
  els.location.setAttribute('aria-pressed', String(['active', 'available', 'fault'].includes(mode)));
  if (els.gpsStatus) {
    els.gpsStatus.textContent = message;
    els.gpsStatus.dataset.state = mode;
  }
}

async function preloadAutopilotDisconnectSound() {
  try {
    const response = await fetch(AUTOPILOT_DISCONNECT_SOUND_URL, {cache: 'force-cache'});
    if (!response.ok) {
      const reason = `MP3 preload failed: HTTP ${response.status}`;
      setSoundSwitchState(false, {fault: true, message: reason});
      debugLog(reason);
      return;
    }
    const blob = await response.blob();
    if (autopilotDisconnectSoundObjectUrl) {
      URL.revokeObjectURL(autopilotDisconnectSoundObjectUrl);
    }
    autopilotDisconnectSoundObjectUrl = URL.createObjectURL(blob);
    soundAvailable = true;
    setSoundSwitchState(false, {message: 'MP3 cached'});
    debugLog('Sound preload complete');
  } catch (error) {
    console.warn('Unable to preload autopilot disconnect sound', error);
    const reason = `MP3 preload failed: ${error.message}`;
    setSoundSwitchState(false, {fault: true, message: reason});
    debugLog(reason);
  }
}

function playAutopilotDisconnectSound() {
  const audio = new Audio(autopilotDisconnectSoundObjectUrl || AUTOPILOT_DISCONNECT_SOUND_URL);
  audio.play().catch((error) => {
    console.warn('Unable to play autopilot disconnect sound', error);
    debugLog(`Sound failed: ${error.message}`);
  });
}

function setSoundSwitchState(enabled, {fault = false, message = ''} = {}) {
  soundEnabled = enabled;
  els.sound.dataset.state = fault ? 'fault' : enabled ? 'active' : 'idle';
  els.sound.setAttribute('aria-pressed', String(enabled));
  if (els.soundStatus) {
    els.soundStatus.textContent = message;
    els.soundStatus.dataset.state = fault ? 'fault' : enabled ? 'available' : '';
  }
}

function setSimulationSwitchState(playing) {
  const wasPlaying = simulationPlaying;
  simulationPlaying = playing;
  els.play.dataset.state = playing ? 'active' : 'idle';
  els.play.setAttribute('aria-pressed', String(playing));
  if (wasPlaying && !playing && soundEnabled) {
    playAutopilotDisconnectSound();
  }
}

function resetSimulation() {
  mergeNavigation(structuredClone(baselineState));
  setSimulationSwitchState(false);
}

function stopLocationWatch() {
  if (locationWatchId !== null) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
    previousGpsPosition = null;
    previousGpsTimestamp = null;
    debugLog('GPS watch stopped');
  }
  setGpsSwitchState('idle');
  els.progressControlRow.hidden = false;
  els.trueAirSpeedControlRow.hidden = false;
}

function applyBrowserPosition(position) {
  const {latitude, longitude, altitude, accuracy, altitudeAccuracy, heading, speed} = position.coords;
  const gpsPosition = {lat: latitude, lon: longitude};
  const movementDistanceM = previousGpsPosition ? distanceNmBetween(previousGpsPosition, gpsPosition) * METERS_PER_NM : 0;
  const movementSeconds = previousGpsTimestamp ? Math.max(0, (position.timestamp - previousGpsTimestamp) / 1000) : 0;
  const movementSpeed = movementSeconds > 0 ? movementDistanceM / movementSeconds : null;
  const headingSpeed = Number.isFinite(speed) ? speed : movementSpeed;
  const headingReliable = Number.isFinite(headingSpeed) && headingSpeed >= state.gpsHeadingMinSpeedMps;
  const fakeHeading = headingReliable && previousGpsPosition
    ? bearingBetween(previousGpsPosition, gpsPosition)
    : null;
  const fakeHeadingMode = Boolean(els.fakeHeading?.checked);
  const useFakeHeading = fakeHeadingMode && Number.isFinite(fakeHeading);

  state.currentPosition = {
    ...(state.currentPosition || {}),
    lat: latitude,
    lon: longitude,
    altitudeFt: Number.isFinite(altitude) ? Math.round(altitude * 3.28084) : state.currentPosition?.altitudeFt || 0,
    routeDistanceNm: nearestRouteDistance({lat: latitude, lon: longitude}),
  };
  state.source = 'GPS';
  setSimulationSwitchState(false);
  syncPositionControls();
  recomputeNavigationFromPosition({updateHeading: false});
  recomputeNavaidsFromPosition();
  recomputeAirportsFromPosition();

  if (useFakeHeading) {
    state.heading = fakeHeading;
    syncHeadingControl();
  } else if (headingReliable && Number.isFinite(heading)) {
    state.heading = normalizeDegrees(heading);
    syncHeadingControl();
  }

  if (Number.isFinite(speed)) {
    const speedNmPerHour = metersPerSecondToNmPerHour(speed);
    state.trueAirSpeed = speedNmPerHour;
    state.groundSpeed = speedNmPerHour;
    state.track = state.heading;
  } else {
    applyWindCorrection();
  }
  debugLog(
    `GPS lat=${latitude.toFixed(6)} lon=${longitude.toFixed(6)} ` +
    `accuracy=${debugValue(accuracy, (value) => `${value.toFixed(1)}m`)} ` +
    `heading=${debugValue(heading, (value) => `${normalizeDegrees(value).toFixed(1)}deg`)} ` +
    `fakeHeading=${debugValue(fakeHeading, (value) => `${value.toFixed(1)}deg`)} ` +
    `fakeHeadingMode=${fakeHeadingMode ? 'on' : 'off'} ` +
    `vector=${movementDistanceM.toFixed(1)}m ` +
    `vectorSpeed=${debugValue(movementSpeed, (value) => `${value.toFixed(2)}m/s`)} ` +
    `minHeadingSpeed=${state.gpsHeadingMinSpeedMps.toFixed(1)}m/s ` +
    `headingReliable=${headingReliable ? 'yes' : 'no'} ` +
    `speed=${debugValue(speed, (value) => `${value.toFixed(2)}m/s`)} ` +
    `speedNm=${debugValue(speed, (value) => `${metersPerSecondToNmPerHour(value).toFixed(1)}NM/H`)} ` +
    `alt=${debugValue(altitude, (value) => `${value.toFixed(1)}m`)} ` +
    `altAccuracy=${debugValue(altitudeAccuracy, (value) => `${value.toFixed(1)}m`)} ` +
    `browserTs=${new Date(position.timestamp).toLocaleTimeString()}`
  );
  previousGpsPosition = gpsPosition;
  previousGpsTimestamp = position.timestamp;
  setGpsSwitchState('available', `GPS position received. Accuracy ${debugValue(accuracy, (value) => `${value.toFixed(1)} m`)}`);
}

function gpsErrorHint(error) {
  if (error.code === 1) {
    return 'GPS permission denied. Allow location access in the browser and OS privacy settings.';
  }
  if (error.code === 2) {
    return 'GPS position unavailable. Check OS location services, browser permission, Wi-Fi, or GNSS signal.';
  }
  if (error.code === 3) {
    return 'GPS timed out before receiving coordinates. Move outdoors or check OS location services.';
  }
  return 'GPS failed. Check browser permission and operating system location services.';
}

function stopLocationWatchAfterError(message) {
  if (locationWatchId !== null) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
    previousGpsPosition = null;
    previousGpsTimestamp = null;
    debugLog('GPS watch stopped');
  }
  setGpsSwitchState('fault', message);
  els.progressControlRow.hidden = false;
  els.trueAirSpeedControlRow.hidden = false;
}

function handleLocationError(error) {
  const message = gpsErrorHint(error);
  console.warn('Unable to use browser location', error);
  debugLog(`GPS error ${error.code}: ${error.message}`);
  openDebugPanel();
  stopLocationWatchAfterError(message);
}

function startLocationWatch() {
  if (!('geolocation' in navigator)) {
    const message = 'GPS is not supported by this browser. Use a browser and OS with location services enabled.';
    console.warn('Geolocation is not supported by this browser.');
    debugLog('GPS unavailable: geolocation is not supported by this browser');
    openDebugPanel();
    setGpsSwitchState('fault', message);
    return;
  }

  setGpsSwitchState('active', 'Waiting for GPS permission and coordinates...');
  gpsPrimaryVisibleUntil = performance.now() + GPS_PRIMARY_DISPLAY_MS;
  previousGpsPosition = null;
  previousGpsTimestamp = null;
  debugLog('GPS permission requested');
  locationWatchId = navigator.geolocation.watchPosition(applyBrowserPosition, handleLocationError, {
    enableHighAccuracy: true,
    maximumAge: 0,
    timeout: 10000,
  });
  setGpsSwitchState('active', 'GPS watch started. Waiting for coordinates...');
  els.progressControlRow.hidden = true;
  els.trueAirSpeedControlRow.hidden = true;
  debugLog(`GPS watch started id=${locationWatchId}`);
}

function updateModeButtons() {
  els.modeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === state.mode);
  });
}

function canvasCoordinatesFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * canvas.width,
    y: ((event.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function localPointFromCanvasPoint(point, transform) {
  const dx = point.x - transform.x;
  const dy = point.y - transform.y;
  const cos = Math.cos(transform.radians);
  const sin = Math.sin(transform.radians);
  return {
    x: dx * cos + dy * sin,
    y: -dx * sin + dy * cos,
  };
}

function roundPoint(point) {
  return {
    x: Number(point.x.toFixed(1)),
    y: Number(point.y.toFixed(1)),
  };
}

function enableCanvasCoordinateDebug() {
  if (!DEBUG_CANVAS_COORDS) return;

  canvas.addEventListener('click', (event) => {
    const point = canvasCoordinatesFromEvent(event);
    const view = layout();
    const vor1Transform = vorPointerTransform(view, state.radios.vor1, 'vor1');
    const vor2Transform = vorPointerTransform(view, state.radios.vor2, 'vor2');
    console.log('canvas coords', {
      x: Number(point.x.toFixed(1)),
      y: Number(point.y.toFixed(1)),
      fromCenterX: Number((point.x - view.cx).toFixed(1)),
      fromCenterY: Number((point.y - view.cy).toFixed(1)),
      mode: state.mode,
      centerX: Number(view.cx.toFixed(1)),
      centerY: Number(view.cy.toFixed(1)),
      arcRadius: Number(view.arcRadius.toFixed(1)),
      vor1Local: vor1Transform ? {
        kind: vor1Transform.symbolKind,
        origin: roundPoint(vor1Transform),
        point: roundPoint(localPointFromCanvasPoint(point, vor1Transform)),
      } : null,
      vor2Local: vor2Transform ? {
        kind: vor2Transform.symbolKind,
        origin: roundPoint(vor2Transform),
        point: roundPoint(localPointFromCanvasPoint(point, vor2Transform)),
      } : null,
    });
  });
}

function layout() {
  const w = canvas.width;
  const h = canvas.height;
  const cx = w / 2;
  const cy = state.mode === 'ROSE' ? h * 0.52 : h * 0.755;
  const arcRadius = state.mode === 'ARC' ? Math.min(w * 0.68, h * 0.755) : Math.min(w * 0.45, h * 0.63);
  const scaleRadius = arcRadius;
  return {w, h, cx, cy, arcRadius, scaleRadius};
}

function angleForOffset(offsetDeg) {
  return ((offsetDeg - 90) * Math.PI) / 180;
}

function toScreen(wp, view) {
  const displayHeading = state.mode === 'PLAN' ? 0 : state.heading;
  const delta = bearingDelta(wp.bearing, displayHeading);
  const radians = (delta * Math.PI) / 180;
  const distanceRatio = wp.distanceNm / state.rangeNm;
  const radius = distanceRatio * view.arcRadius;
  return {
    x: view.cx + Math.sin(radians) * radius,
    y: view.cy - Math.cos(radians) * radius,
    visible: distanceRatio <= 1 && Math.abs(delta) <= (state.mode === 'ARC' ? ARC_HALF_SWEEP : 182),
  };
}

function activeCourseBearing() {
  const active = state.waypoints.find((wp) => wp.id === state.nextWaypoint);
  return active?.bearing ?? state.heading;
}

function courseAdjustedBearing(bearing) {
  const correction = bearingDelta(state.track, activeCourseBearing());
  return normalizeDegrees(bearing + correction);
}

function routePointToScreen(point, view) {
  if (!state.currentPosition) return null;

  return toScreen({
    bearing: bearingBetween(state.currentPosition, point),
    distanceNm: distanceNmBetween(state.currentPosition, point),
  }, view);
}

function clipToAzimuth(view) {
  const start = state.mode === 'ARC' ? angleForOffset(-ARC_HALF_SWEEP) : 0;
  const end = state.mode === 'ARC' ? angleForOffset(ARC_HALF_SWEEP) : Math.PI * 2;
  ctx.beginPath();
  ctx.moveTo(view.cx, view.cy);
  ctx.arc(view.cx, view.cy, view.arcRadius, start, end);
  ctx.closePath();
  ctx.clip();
}

function drawBackground(view) {
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, view.w, view.h);
}

function drawEqualDashedArc(view, radius, start, end, color, lineWidth = 2) {
  const direction = end >= start ? 1 : -1;
  const arcLength = Math.abs(end - start) * radius;
  const dashLength = 25;
  const minimumGap = 25;
  const dashCount = Math.max(2, Math.floor((arcLength + minimumGap) / (dashLength + minimumGap)));
  const gapLength = dashCount > 1 ? (arcLength - dashCount * dashLength) / (dashCount - 1) : 0;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = 'butt';

  for (let i = 0; i < dashCount; i += 1) {
    const distanceStart = i * (dashLength + gapLength);
    const distanceEnd = distanceStart + dashLength;
    const dashStart = start + direction * (distanceStart / radius);
    const dashEnd = start + direction * (distanceEnd / radius);
    ctx.beginPath();
    ctx.arc(view.cx, view.cy, radius, dashStart, dashEnd);
    ctx.stroke();
  }

  ctx.restore();
}

function drawCompass(view) {
  const start = state.mode === 'ARC' ? angleForOffset(-ARC_HALF_SWEEP) : 0;
  const end = state.mode === 'ARC' ? angleForOffset(ARC_HALF_SWEEP) : Math.PI * 2;
  const displayHeading = state.mode === 'PLAN' ? 0 : state.heading;

  ctx.save();
  ctx.strokeStyle = colors.white;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(view.cx, view.cy, view.arcRadius, start, end);
  ctx.stroke();

  const sweep = state.mode === 'ARC' ? ARC_HALF_SWEEP : 180;
  const firstTickHeading = Math.floor((displayHeading - sweep - 5) / 5) * 5;
  const lastTickHeading = Math.ceil((displayHeading + sweep + 5) / 5) * 5;

  for (let tickHeading = firstTickHeading; tickHeading <= lastTickHeading; tickHeading += 5) {
    const displayOffset = tickHeading - displayHeading;
    if (state.mode === 'ARC' && (displayOffset < -ARC_HALF_SWEEP || displayOffset > ARC_HALF_SWEEP)) continue;

    const headingAtTick = normalizeDegrees(tickHeading);
    const majorTick = Math.round(headingAtTick) % 10 === 0;
    const radians = angleForOffset(displayOffset);
    const outer = view.arcRadius;
    const tick = majorTick ? 22 : 11;
    const x1 = view.cx + Math.cos(radians) * outer;
    const y1 = view.cy + Math.sin(radians) * outer;
    const x2 = view.cx + Math.cos(radians) * (outer - tick);
    const y2 = view.cy + Math.sin(radians) * (outer - tick);

    ctx.strokeStyle = colors.white;
    ctx.lineWidth = majorTick ? 2 : 1;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();

    if (majorTick) {
      const label = Math.round(headingAtTick / 10) || 36;
      const lx = view.cx + Math.cos(radians) * (outer + 28);
      const ly = view.cy + Math.sin(radians) * (outer + 28);
      ctx.fillStyle = colors.white;
      ctx.font = `26px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(label), lx, ly);
    }
  }

  if (state.mode !== 'PLAN') {
    const trackOffset = bearingDelta(state.track, state.heading);

    ctx.strokeStyle = colors.amber;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(view.cx, view.cy - view.arcRadius - 4);
    ctx.lineTo(view.cx, view.cy - view.arcRadius + 24);
    ctx.stroke();

    if (Math.abs(trackOffset) <= ARC_HALF_SWEEP) {
      const trackRadians = angleForOffset(trackOffset);
      const tx = view.cx + Math.cos(trackRadians) * view.arcRadius;
      const ty = view.cy + Math.sin(trackRadians) * view.arcRadius + 14;

      ctx.strokeStyle = colors.green;
      ctx.fillStyle = colors.green;
      ctx.lineWidth = 3;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(trackRadians + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -13);
      ctx.lineTo(8, 0);
      ctx.lineTo(0, 13);
      ctx.lineTo(-8, 0);
      ctx.closePath();
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

function drawRange(view) {
  const start = state.mode === 'ARC' ? angleForOffset(-ARC_HALF_SWEEP) : 0;
  const end = state.mode === 'ARC' ? angleForOffset(ARC_HALF_SWEEP) : Math.PI * 2;
  const d = state.rangeNm / 4;
  const rangeRadii = [view.arcRadius / 4, view.arcRadius / 2, (view.arcRadius * 3) / 4];
  rangeRadii.forEach((radius) => {
    drawEqualDashedArc(view, radius, start, end, colors.grey, 2);
  });

  ctx.save();
  ctx.fillStyle = colors.cyan;
  ctx.font = `22px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  [2, 3].forEach((multiple) => {
    const radius = (view.arcRadius * multiple) / 4;
    const label = rangeLabel(d * multiple);
    const offsetRadians = angleForOffset(58);
    const labelX = Math.cos(offsetRadians) * radius;
    const labelY = Math.sin(offsetRadians) * radius;
    ctx.fillText(String(label), view.cx - labelX, view.cy + labelY);
    ctx.fillText(String(label), view.cx + labelX, view.cy + labelY);
  });
  ctx.restore();
}

function drawRoute(view) {
  if (state.showCourseRoute === false) return;

  ctx.save();
  clipToAzimuth(view);
  ctx.strokeStyle = colors.green;
  ctx.lineWidth = 3;

  if (state.routePath?.length) {
    ctx.beginPath();
    let started = false;
    state.routePath.forEach((point) => {
      const screen = routePointToScreen(point, view);
      if (!screen) return;
      if (!started) {
        ctx.moveTo(screen.x, screen.y);
        started = true;
      } else {
        ctx.lineTo(screen.x, screen.y);
      }
    });
    ctx.stroke();
  }

  ctx.restore();
}

function drawDiamond(x, y, size, color) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(x, y - size);
  ctx.lineTo(x + size, y);
  ctx.lineTo(x, y + size);
  ctx.lineTo(x - size, y);
  ctx.closePath();
  ctx.stroke();
}

function drawWaypoints(view) {
  if (state.showCourseRoute === false) return;

  ctx.save();
  clipToAzimuth(view);
  state.waypoints.forEach((wp) => {
    const screen = toScreen(wp, view);
    if (!screen.visible) return;

    const active = wp.id === state.nextWaypoint || wp.kind === 'active';
    const color = colors.green;

    drawDiamond(screen.x, screen.y, active ? 9 : 7, color);
    ctx.fillStyle = color;
    ctx.font = active ? `700 24px ${FONT}` : `700 22px ${FONT}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(wp.id, screen.x + 11, screen.y - 2);
  });
  ctx.restore();
}

function drawNavaidSymbol(x, y, color = colors.cyan) {
  const radius = 5;
  const arm = 10;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - arm, y);
  ctx.lineTo(x - radius, y);
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + arm, y);
  ctx.moveTo(x, y - arm);
  ctx.lineTo(x, y - radius);
  ctx.moveTo(x, y + radius);
  ctx.lineTo(x, y + arm);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.stroke();
}

function drawNdbSymbol(x, y) {
  const radius = 5;
  ctx.strokeStyle = colors.magenta;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius, y + radius);
  ctx.lineTo(x - radius, y + radius);
  ctx.closePath();
  ctx.stroke();
}

function drawNavaidLabel(label, x, y, color = colors.cyan) {
  ctx.fillStyle = color;
  ctx.font = `700 18px ${FONT}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + 14, y);
}

function drawAirportSymbol(x, y) {
  const radius = 7;
  ctx.strokeStyle = colors.magenta;
  ctx.lineWidth = 2;
  ctx.lineCap = 'butt';
  for (let index = 0; index < 4; index += 1) {
    const radians = (index * Math.PI) / 4;
    const dx = Math.cos(radians) * radius;
    const dy = Math.sin(radians) * radius;
    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x + dx, y + dy);
    ctx.stroke();
  }
}

function drawAirports(view, visibleAirports) {
  if (!visibleAirports.length) return;

  ctx.save();
  clipToAzimuth(view);
  visibleAirports.forEach(({airport, screen}) => {
    drawAirportSymbol(screen.x, screen.y);
    drawNavaidLabel(airport.id, screen.x, screen.y, colors.magenta);
  });
  ctx.restore();
}

function drawNavaids(view, visibleNavaids) {
  if (!visibleNavaids.length) return;

  ctx.save();
  clipToAzimuth(view);
  visibleNavaids.forEach(({navaid, screen}) => {
    if (isVorNavaid(navaid)) {
      const color = isTrackedVorNavaid(navaid) ? colors.cyan : state.navaidTypeFilters.vor ? colors.magenta : colors.cyan;
      drawNavaidSymbol(screen.x, screen.y, color);
      drawNavaidLabel(navaid.id, screen.x, screen.y, color);
      return;
    }

    if (navaidCategory(navaid) === 'ndb') {
      drawNdbSymbol(screen.x, screen.y);
      drawNavaidLabel(navaid.id, screen.x, screen.y, colors.magenta);
      return;
    }

    drawNavaidSymbol(screen.x, screen.y, colors.magenta);
    drawNavaidLabel(navaid.id, screen.x, screen.y, colors.magenta);
  });
  ctx.restore();
}

function drawInvertedTrackedNavaid(view) {
  if (!DEBUG_INVERTED_NAVAID) return;

  const tracked = state.radios.vor1;
  if (!Number.isFinite(tracked?.bearing) || !Number.isFinite(tracked?.distanceNm)) return;

  const invertedNavaid = {
    id: `${tracked.name || 'VOR'} 180`,
    bearing: normalizeDegrees(tracked.bearing + 180),
    distanceNm: tracked.distanceNm,
  };
  const screen = toScreen(invertedNavaid, view);
  if (!screen.visible) return;

  ctx.save();
  clipToAzimuth(view);
  drawNavaidSymbol(screen.x, screen.y, colors.magenta);
  drawNavaidLabel(invertedNavaid.id, screen.x, screen.y, colors.magenta);
  ctx.restore();
}

function drawVorPointerSymbol(kind) {
  ctx.strokeStyle = colors.white;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'butt';

  if (kind === 'vor1-inward') {
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(0, 25);
    ctx.lineTo(15, 25);
    ctx.lineTo(0, 50);
    ctx.lineTo(0, 145);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(0, 25);
    ctx.lineTo(-15, 25);
    ctx.lineTo(0, 50);
    ctx.lineTo(0, 145);
    ctx.stroke();
    return;
  }

  if (kind === 'vor2-inward') {
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(0, 40);
    ctx.lineTo(15, 40);
    ctx.lineTo(15, 118);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.lineTo(0, 40);
    ctx.lineTo(-15, 40);
    ctx.lineTo(-15, 118);
    ctx.stroke();
    return;
  }

  if (kind === 'vor1-outward') {
    ctx.beginPath();
    ctx.moveTo(0, -50);
    ctx.lineTo(0, 10);
    ctx.lineTo(15, 40);
    ctx.lineTo(0, 40);
    ctx.lineTo(0, 142);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -50);
    ctx.lineTo(0, 10);
    ctx.lineTo(-15, 40);
    ctx.lineTo(0, 40);
    ctx.lineTo(0, 142);
    ctx.stroke();
    return;
  }

  if (kind === 'vor2-outward') {
    ctx.beginPath();
    ctx.moveTo(0, -50);
    ctx.lineTo(0, 30);
    ctx.lineTo(-20, 65);
    ctx.lineTo(-10, 65);
    ctx.lineTo(-10, 118);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -50);
    ctx.lineTo(0, 30);
    ctx.lineTo(20, 65);
    ctx.lineTo(10, 65);
    ctx.lineTo(10, 118);
    ctx.stroke();
    return;
  }
}

function vorPointerTransform(view, radio, vorId) {
  if (!Number.isFinite(radio?.bearing)) return;

  const displayHeading = state.mode === 'PLAN' ? 0 : state.heading;
  const delta = bearingDelta(radio.bearing, displayHeading);
  const outsideArc = state.mode === 'ARC' && Math.abs(delta) > ARC_HALF_SWEEP;
  const radius = view.arcRadius * 1;
  const tailOffset = vorId === 'vor1' ? 20 : 48;
  const pointsOutward = !outsideArc && Math.abs(delta) <= 72;
  const symbolKind = `${vorId}-${pointsOutward ? 'outward' : 'inward'}`;
  const symbolDelta = pointsOutward ? delta : bearingDelta(normalizeDegrees(radio.bearing + 180), displayHeading);
  const radians = (symbolDelta * Math.PI) / 180;
  const symbolRadius = radius - tailOffset;
  const x = view.cx + Math.sin(radians) * symbolRadius;
  const y = view.cy - Math.cos(radians) * symbolRadius;
  return {x, y, radians, symbolKind, outsideArc, delta, symbolDelta};
}

function drawVorPointer(view, radio, vorId) {
  const transform = vorPointerTransform(view, radio, vorId);
  if (!transform) return;

  ctx.save();
  ctx.translate(transform.x, transform.y);
  ctx.rotate(transform.radians);
  drawVorPointerSymbol(transform.symbolKind);
  ctx.restore();
}

function drawVorPointers(view) {
  ctx.save();
  clipToAzimuth(view);
  drawVorPointer(view, state.radios.vor1, 'vor1');
  drawVorPointer(view, state.radios.vor2, 'vor2');
  ctx.restore();
}

function drawOwnship(view) {
  ctx.save();
  ctx.translate(view.cx, view.cy);
  ctx.strokeStyle = colors.amber;
  ctx.fillStyle = colors.amber;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, 2);
  ctx.lineTo(0, 44);
  ctx.moveTo(-23, 17);
  ctx.lineTo(23, 17);
  ctx.moveTo(-6, 38);
  ctx.lineTo(6, 38);
  ctx.stroke();
  ctx.restore();
}

function drawCourseDetails(view) {
  ctx.save();
  ctx.fillStyle = colors.green;
  ctx.font = `22px ${FONT}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = colors.cyan;

  ctx.fillStyle = colors.white;
  ctx.textAlign = 'left';

  ctx.restore();
}

function drawRosePlanOverlay(view) {
  if (state.mode === 'ARC') return;

  ctx.save();
  ctx.strokeStyle = colors.grey;
  ctx.lineWidth = 1.5;
  for (let angle = 0; angle < 360; angle += 30) {
    const radians = (angle * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(view.cx, view.cy);
    ctx.lineTo(view.cx + Math.sin(radians) * view.scaleRadius, view.cy - Math.cos(radians) * view.scaleRadius);
    ctx.stroke();
  }
  ctx.restore();
}

function draw() {
  const view = layout();
  const visibleNavaids = visibleNavaidsForView(view);
  const visibleAirports = visibleAirportsForView(view);
  drawBackground(view);
  drawRosePlanOverlay(view);
  drawRange(view);
  drawCompass(view);
  drawCourseDetails(view);
  drawRoute(view);
  drawWaypoints(view);
  drawAirports(view, visibleAirports);
  drawNavaids(view, visibleNavaids);
  //drawInvertedTrackedNavaid(view);
  drawVorPointers(view);
  drawOwnship(view);
  syncReadouts();
  syncVisibleNavaidTable(visibleNavaids);
  syncVisibleAirportTable(visibleAirports);
}

function tick(time) {
  const deltaSeconds = Math.max(0, (time - lastTime) / 1000);
  lastTime = time;

  if (simulationPlaying && state.routeDistanceNm > 0) {
    const nmPerSecond = Math.max(0, Number(state.groundSpeed) || 0) / 3600;
    const currentDistance = state.currentPosition?.routeDistanceNm || 0;
    const nextDistance = currentDistance + nmPerSecond * deltaSeconds;
    setRouteProgress(nextDistance / state.routeDistanceNm);
  }

  draw();
  requestAnimationFrame(tick);
}

els.range.addEventListener('change', (event) => {
  state.rangeNm = Number(event.target.value);
  saveSettings();
});

els.navaidRange.addEventListener('change', (event) => {
  state.navaidRangeNm = Number(event.target.value);
  visibleNavaidTableSignature = '';
  saveSettings();
});

function updateNavaidTypeFilter(key, checked) {
  if (checked && key === 'vor') {
    applyExclusiveMapLayer('vor-d');
    saveSettings();
    return;
  }
  if (checked && key === 'dme') {
    applyExclusiveMapLayer('vor-d');
    saveSettings();
    return;
  }
  if (checked && key === 'ndb') {
    applyExclusiveMapLayer('ndb');
    saveSettings();
    return;
  }

  state.navaidTypeFilters = {...state.navaidTypeFilters, [key]: checked};
  visibleNavaidTableSignature = '';
  syncLayerControls();
  saveSettings();
}

els.showVor.addEventListener('change', (event) => updateNavaidTypeFilter('vor', event.target.checked));
els.showDme.addEventListener('change', (event) => updateNavaidTypeFilter('dme', event.target.checked));
els.showTacan.addEventListener('change', (event) => updateNavaidTypeFilter('tacan', event.target.checked));
els.showNdb.addEventListener('change', (event) => updateNavaidTypeFilter('ndb', event.target.checked));
els.showOtherNavaid.addEventListener('change', (event) => updateNavaidTypeFilter('other', event.target.checked));
els.showAirports.addEventListener('change', (event) => {
  if (event.target.checked) {
    applyExclusiveMapLayer('arpt');
  } else {
    state.showAirports = false;
    visibleAirportTableSignature = '';
    syncLayerControls();
  }
  saveSettings();
});

els.layerButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const layer = button.dataset.layerToggle;
    if (layer === 'csrt') {
      state.showCourseRoute = state.showCourseRoute === false;
      if (state.showCourseRoute) {
        applyExclusiveMapLayer(null);
      } else {
        syncLayerControls();
      }
      saveSettings();
      return;
    }
    if (button.disabled || layer === 'wpt') return;
    applyExclusiveMapLayer(activeMapLayer() === layer ? null : layer);
    saveSettings();
  });
});

els.gmapImport.addEventListener('click', importGoogleMapsRoute);
els.gmapUrl.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    importGoogleMapsRoute();
  }
});
els.gmapUrl.addEventListener('input', () => {
  if (els.gmapImport.dataset.state === 'fault' || els.gmapImport.dataset.state === 'available') {
    els.gmapImport.dataset.state = 'idle';
    els.gmapImport.setAttribute('aria-pressed', 'false');
  }
});
els.kmlUploadButton.addEventListener('click', uploadKmlProfile);
els.kmlUpload.addEventListener('change', () => {
  if (els.kmlUploadButton.dataset.state === 'fault' || els.kmlUploadButton.dataset.state === 'available') {
    els.kmlUploadButton.dataset.state = 'idle';
    els.kmlUploadButton.setAttribute('aria-pressed', 'false');
  }
});
els.kmlDeleteButton.addEventListener('click', deleteSelectedKmlProfile);
els.cleanCookieButton.addEventListener('click', cleanClientCookies);
[els.kmlDeleteButton, els.cleanCookieButton].forEach((button) => {
  button.addEventListener('pointerdown', () => {
    button.classList.add('is-pressing');
  });
  ['pointerup', 'pointercancel', 'pointerleave', 'blur'].forEach((eventName) => {
    button.addEventListener(eventName, () => {
      button.classList.remove('is-pressing');
    });
  });
});

els.profile.addEventListener('change', async (event) => {
  stopLocationWatch();
  setSimulationSwitchState(false);
  syncKmlProfileActions();
  els.kmlProfileStatus.textContent = '';
  if (!event.target.value) {
    clearRouteState();
  }
  saveSettings();
  await loadNavigation(event.target.value);
  applySavedSettingsAfterNavigation();
  baselineState = structuredClone(state);
  saveSettings();
  debugLog(event.target.value ? `KML profile switched to ${event.target.value}` : 'KML profile cleared');
});

els.controlsToggle.addEventListener('click', () => {
  setControlsCollapsed(!els.controlsPanel.classList.contains('collapsed'));
  saveSettings();
});

els.mobileControlsToggle.addEventListener('click', () => {
  setControlsCollapsed(!els.controlsPanel.classList.contains('collapsed'));
  saveSettings();
});

document.addEventListener('pointerdown', (event) => {
  if (els.controlsPanel.classList.contains('collapsed')) return;
  if (els.controlsPanel.contains(event.target)) return;
  if (els.mobileControlsToggle?.contains(event.target)) return;
  if (els.controlsToggle?.contains(event.target)) return;
  setControlsCollapsed(true);
  saveSettings();
});

els.unit.addEventListener('change', () => {
  syncRangeOptionLabels();
  els.trueAirSpeedReadout.textContent = speedText(state.trueAirSpeed);
  els.windSpeedReadout.textContent = speedText(state.wind.speed);
  visibleNavaidTableSignature = '';
  visibleAirportTableSignature = '';
  saveSettings();
  debugLog(`Units changed to ${distanceUnitText()}`);
});

els.hudMode.addEventListener('change', (event) => {
  els.instrument.classList.toggle('hud-mirror', event.target.checked);
  saveSettings();
  debugLog(`HUD mirror ${event.target.checked ? 'enabled' : 'disabled'}`);
});

els.headingControl.addEventListener('input', (event) => {
  stopLocationWatch();
  state.heading = Number(event.target.value);
  applyWindCorrection();
  saveSettings();
});

function updateManualPosition() {
  const lat = Number(els.latitudeControl.value);
  const lon = Number(els.longitudeControl.value);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;

  state.currentPosition = {
    ...(state.currentPosition || {}),
    lat,
    lon,
    routeDistanceNm: nearestRouteDistance({lat, lon}),
  };
  syncPositionControls();
  recomputeNavigationFromPosition();
  recomputeNavaidsFromPosition();
  recomputeAirportsFromPosition();
  saveSettings();
}

els.latitudeControl.addEventListener('change', updateManualPosition);
els.latitudeControl.addEventListener('input', stopLocationWatch);
els.longitudeControl.addEventListener('change', updateManualPosition);
els.longitudeControl.addEventListener('input', stopLocationWatch);

els.progressControl.addEventListener('input', (event) => {
  stopLocationWatch();
  const ratio = Number(event.target.value) / 1000;
  setRouteProgress(ratio);
});

els.trueAirSpeedControl.addEventListener('input', (event) => {
  state.trueAirSpeed = Number(event.target.value);
  els.trueAirSpeedReadout.textContent = speedText(state.trueAirSpeed);
  applyWindCorrection();
  saveSettings();
});

els.windSpeedControl.addEventListener('input', (event) => {
  state.wind.speed = Number(event.target.value);
  els.windSpeedReadout.textContent = speedText(state.wind.speed);
  applyWindCorrection();
  saveSettings();
});

els.windDirectionControl.addEventListener('input', (event) => {
  state.wind.direction = Number(event.target.value);
  els.windDirectionReadout.textContent = `${headingText(state.wind.direction)}°`;
  applyWindCorrection();
  saveSettings();
});

els.gpsHeadingMinSpeedControl.addEventListener('input', (event) => {
  state.gpsHeadingMinSpeedMps = Number(event.target.value);
  els.gpsHeadingMinSpeedReadout.textContent = gpsHeadingMinSpeedText(state.gpsHeadingMinSpeedMps);
  saveSettings();
});

els.modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    updateModeButtons();
    saveSettings();
  });
});

els.play.addEventListener('click', () => {
  if (simulationPlaying) {
    stopLocationWatch();
    resetSimulation();
    return;
  }

  stopLocationWatch();
  setSimulationSwitchState(true);
});

els.sound.addEventListener('click', () => {
  if (!soundAvailable) {
    const reason = 'Sound unavailable: autopilot disconnect MP3 is not loaded';
    setSoundSwitchState(false, {fault: true, message: reason});
    debugLog(reason);
    return;
  }
  setSoundSwitchState(!soundEnabled);
  saveSettings();
});

els.location.addEventListener('click', () => {
  if (locationWatchId !== null || els.location.dataset.state === 'fault' || els.location.dataset.state === 'available') {
    stopLocationWatch();
  } else {
    startLocationWatch();
  }
});

// Comment out this line to disable click-to-log canvas coordinates.
enableCanvasCoordinateDebug();

setControlsCollapsed(savedSettings.controlsCollapsed ?? true);

Promise.all([loadServerConfig(), loadProfiles(), preloadAutopilotDisconnectSound()]).then(() => loadNavigation(els.profile.value)).finally(() => {
  applySavedSettingsAfterNavigation();
  baselineState = structuredClone(state);
  draw();
  hideLoadingOverlay();
  requestAnimationFrame(tick);
});
