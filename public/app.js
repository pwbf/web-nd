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

const ARC_SWEEP_DEG = 142;
const ARC_HALF_SWEEP = ARC_SWEEP_DEG / 2;
const FONT = '"Roboto Mono", "Consolas", "Lucida Console", monospace';

const fallbackState = {
  callsign: 'JX801',
  navLabel: 'ILS05L',
  mode: 'ARC',
  source: 'SIM',
  heading: 257,
  track: 257,
  groundSpeed: 250,
  trueAirSpeed: 250,
  rangeNm: 20,
  currentPosition: {lat: 35.765278, lon: 140.385556, altitudeFt: 41, routeDistanceNm: 0},
  routePath: [],
  routeDistanceNm: 0,
  trafficMode: 'HIDDEN',
  nextWaypoint: '87POY',
  eta: '00:00',
  distanceNm: 1,
  wind: {direction: 0, speed: 0},
  radios: {
    vor1: {frequency: '110.90', distanceNm: 0.38},
    vor2: {frequency: '115.15', distanceNm: null},
  },
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

const state = structuredClone(fallbackState);
let simulationPlaying = false;
let lastTime = performance.now();
let baselineState = structuredClone(fallbackState);

const els = {
  gs: document.getElementById('gsReadout'),
  tas: document.getElementById('tasReadout'),
  windArrow: document.getElementById('windArrow'),
  windDirectionTop: document.getElementById('windDirectionReadoutTop'),
  windSpeedTop: document.getElementById('windSpeedReadoutTop'),
  heading: document.getElementById('headingReadout'),
  nextDistance: document.getElementById('nextDistanceReadout'),
  eta: document.getElementById('etaReadout'),
  vor1Freq: document.getElementById('vor1Freq'),
  vor1Dist: document.getElementById('vor1Dist'),
  vor2Freq: document.getElementById('vor2Freq'),
  vor2Dist: document.getElementById('vor2Dist'),
  trafficStatus: document.getElementById('trafficStatus'),
  trafficControl: document.getElementById('trafficControl'),
  range: document.getElementById('rangeControl'),
  headingControl: document.getElementById('headingControl'),
  latitudeControl: document.getElementById('latitudeControl'),
  longitudeControl: document.getElementById('longitudeControl'),
  progressControl: document.getElementById('progressControl'),
  progressReadout: document.getElementById('progressReadout'),
  trueAirSpeedControl: document.getElementById('trueAirSpeedControl'),
  trueAirSpeedReadout: document.getElementById('trueAirSpeedReadout'),
  windSpeedControl: document.getElementById('windSpeedControl'),
  windSpeedReadout: document.getElementById('windSpeedReadout'),
  windDirectionControl: document.getElementById('windDirectionControl'),
  windDirectionReadout: document.getElementById('windDirectionReadout'),
  play: document.getElementById('playButton'),
  recenter: document.getElementById('recenterButton'),
  modeButtons: document.querySelectorAll('[data-mode]'),
};

function normalizeDegrees(value) {
  return ((value % 360) + 360) % 360;
}

function headingText(value) {
  const normalized = Math.round(normalizeDegrees(value));
  return String(normalized === 0 ? 360 : normalized).padStart(3, '0');
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
    return '--- NM';
  }
  return `${Number(value).toFixed(value < 10 ? 2 : 0)}NM`;
}

function rangeLabel(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
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
  Object.assign(state, nextState);
  state.radios = {...fallbackState.radios, ...(nextState.radios || {})};
  state.wind = {...fallbackState.wind, ...(nextState.wind || {})};
  state.waypoints = nextState.waypoints || state.waypoints;
  state.route = nextState.route || state.route;
  state.routePath = nextState.routePath || state.routePath || [];
  els.range.value = String(state.rangeNm);
  els.trafficControl.value = state.trafficMode || 'HIDDEN';
  els.headingControl.value = String(Math.round(state.heading));
  els.trueAirSpeedControl.value = String(Math.round(state.trueAirSpeed));
  els.trueAirSpeedReadout.textContent = `${Math.round(state.trueAirSpeed)} NM/H`;
  els.windSpeedControl.value = String(Math.round(state.wind.speed));
  els.windSpeedReadout.textContent = `${Math.round(state.wind.speed)} NM/H`;
  els.windDirectionControl.value = String(Math.round(state.wind.direction));
  els.windDirectionReadout.textContent = `${headingText(state.wind.direction)}°`;
  syncPositionControls();
  recomputeNavigationFromPosition();
  applyWindCorrection();
  updateModeButtons();
}

async function loadNavigation() {
  try {
    const response = await fetch('/api/navigation');
    if (!response.ok) return;
    mergeNavigation(await response.json());
  } catch (error) {
    console.warn('Using local navigation state', error);
  }
}

function syncReadouts() {
  els.gs.textContent = Math.round(state.groundSpeed);
  els.tas.textContent = Math.round(state.trueAirSpeed);
  els.windDirectionTop.textContent = headingText(state.wind.direction);
  els.windSpeedTop.textContent = Math.round(state.wind.speed);
  els.windArrow.style.transform = `rotate(${bearingDelta(state.wind.direction, state.heading) - 90}deg)`;
  els.heading.textContent = headingText(state.track);
  els.nextDistance.textContent = Number(state.distanceNm).toFixed(0);
  els.eta.textContent = etaText(state.distanceNm, state.groundSpeed);
  els.vor1Freq.textContent = state.radios.vor1.frequency;
  els.vor1Dist.textContent = nmText(state.radios.vor1.distanceNm);
  els.vor2Freq.textContent = state.radios.vor2.frequency;
  els.vor2Dist.textContent = nmText(state.radios.vor2.distanceNm);
  els.trafficStatus.textContent = state.trafficMode;
  els.trafficStatus.hidden = state.trafficMode === 'HIDDEN';
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

  if (clampedRatio >= 1) {
    simulationPlaying = false;
    els.play.textContent = 'Play';
  }
}

function nearestRouteDistance(position) {
  if (!state.routePath?.length) return 0;

  return state.routePath.reduce((nearest, routePoint) => {
    const distance = distanceNmBetween(position, routePoint);
    return distance < nearest.distance ? {distance, routeDistanceNm: routePoint.routeDistanceNm} : nearest;
  }, {distance: Number.POSITIVE_INFINITY, routeDistanceNm: 0}).routeDistanceNm;
}

function recomputeNavigationFromPosition() {
  const ownship = state.currentPosition;
  if (!ownship) return;
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
    state.heading = nextWaypoint.bearing;
    els.headingControl.value = String(Math.round(state.heading));
    applyWindCorrection();
  }
}

function updateModeButtons() {
  els.modeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === state.mode);
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
    bearing: courseAdjustedBearing(bearingBetween(state.currentPosition, point)),
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
  [1, 2].forEach((multiple) => {
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

  const waypointMap = new Map(state.waypoints.map((wp) => [wp.id, wp]));
  const active = waypointMap.get(state.nextWaypoint);
  if (active) {
    const target = toScreen({...active, bearing: courseAdjustedBearing(active.bearing)}, view);
    if (target.visible) {
      ctx.beginPath();
      ctx.moveTo(view.cx, view.cy);
      ctx.lineTo(target.x, target.y);
      ctx.stroke();
    }
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
  ctx.save();
  clipToAzimuth(view);
  state.waypoints.forEach((wp) => {
    const screen = toScreen({...wp, bearing: courseAdjustedBearing(wp.bearing)}, view);
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

function drawOwnship(view) {
  ctx.save();
  ctx.translate(view.cx, view.cy);
  ctx.strokeStyle = colors.amber;
  ctx.fillStyle = colors.amber;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(0, -2);
  ctx.lineTo(0, 44);
  ctx.moveTo(-20, 15);
  ctx.lineTo(20, 15);
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
  ctx.fillText(`${state.mode} ${state.source}`, 28, view.h - 96);

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
  drawBackground(view);
  drawRosePlanOverlay(view);
  drawRange(view);
  drawCompass(view);
  drawCourseDetails(view);
  drawRoute(view);
  drawWaypoints(view);
  drawOwnship(view);
  syncReadouts();
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
});

els.headingControl.addEventListener('input', (event) => {
  state.heading = Number(event.target.value);
  applyWindCorrection();
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
}

els.latitudeControl.addEventListener('change', updateManualPosition);
els.longitudeControl.addEventListener('change', updateManualPosition);

els.progressControl.addEventListener('input', (event) => {
  const ratio = Number(event.target.value) / 1000;
  setRouteProgress(ratio);
});

els.trueAirSpeedControl.addEventListener('input', (event) => {
  state.trueAirSpeed = Number(event.target.value);
  els.trueAirSpeedReadout.textContent = `${Math.round(state.trueAirSpeed)} NM/H`;
  applyWindCorrection();
});

els.windSpeedControl.addEventListener('input', (event) => {
  state.wind.speed = Number(event.target.value);
  els.windSpeedReadout.textContent = `${Math.round(state.wind.speed)} NM/H`;
  applyWindCorrection();
});

els.windDirectionControl.addEventListener('input', (event) => {
  state.wind.direction = Number(event.target.value);
  els.windDirectionReadout.textContent = `${headingText(state.wind.direction)}°`;
  applyWindCorrection();
});

els.trafficControl.addEventListener('change', (event) => {
  state.trafficMode = event.target.value;
});

els.modeButtons.forEach((button) => {
  button.addEventListener('click', () => {
    state.mode = button.dataset.mode;
    updateModeButtons();
  });
});

els.play.addEventListener('click', () => {
  simulationPlaying = !simulationPlaying;
  els.play.textContent = simulationPlaying ? 'Pause' : 'Play';
});

els.recenter.addEventListener('click', () => {
  mergeNavigation(structuredClone(baselineState));
  simulationPlaying = false;
  els.play.textContent = 'Play';
});

loadNavigation().finally(() => {
  baselineState = structuredClone(state);
  updateModeButtons();
  requestAnimationFrame(tick);
});
