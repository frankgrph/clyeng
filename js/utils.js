import {
  MERGE_RADIUS_M,
  MERGE_FALLBACK_DIST_M,
  STOP_SUFFIX_WORDS,
  LONG_TRIP_THRESHOLD_M,
  MAX_TRANSFER_WALK_M,
  NORMAL_TRIP_ENDPOINT_WALK_M,
  LANTAU_KEYWORDS,
  HK_ISLAND_KEYWORDS
} from './config.js';

export const CELL = 0.005;

export function cellKey(lat, lng) { 
  return Math.floor(lat / CELL) + "," + Math.floor(lng / CELL); 
}

export function distM(a, b) {
  if (!a || !b || !Number.isFinite(a.lat) || !Number.isFinite(a.lng) || !Number.isFinite(b.lat) || !Number.isFinite(b.lng)) {
    return 0;
  }
  const latDist = Math.abs(b.lat - a.lat) * 111320;
  const avgLat = (a.lat + b.lat) / 2;
  const lngDist = Math.abs(b.lng - a.lng) * (40075000 * Math.cos(avgLat * Math.PI / 180) / 360);
  const manhattanDist = latDist + lngDist;
  return manhattanDist * 1.2;
}

export function bearingDeg(from, to) {
  const lat1 = from.lat * Math.PI / 180, lat2 = to.lat * Math.PI / 180;
  const dLng = (to.lng - from.lng) * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

export function bearingDiffDeg(b1, b2) {
  const d = Math.abs(b1 - b2) % 360;
  return d > 180 ? 360 - d : d;
}

export async function getRealWalkingData(fromLoc, toLoc) {
  try {
    const url = `https://seep.eu.org/https://router.project-osrm.org/route/v1/foot/${fromLoc.lng},${fromLoc.lat};${toLoc.lng},${toLoc.lat}?overview=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error("OSRM API error");
    const json = await res.json();
    
    if (json.code === "Ok" && json.routes && json.routes.length > 0) {
      const route = json.routes[0];
      return {
        distM: route.distance,
        durationS: route.duration,
        success: true
      };
    }
  } catch (err) {
    console.warn("無法取得第三方地圖路徑，降級至直線估算:", err);
  }
  return { success: false };
}

const walkCache = new Map();
export async function getRealWalkingDataCached(cacheKey, fromLoc, toLoc) {
  if (walkCache.has(cacheKey)) {
    return walkCache.get(cacheKey);
  }
  const result = await getRealWalkingData(fromLoc, toLoc);
  walkCache.set(cacheKey, result);
  return result;
}

export function getAdaptiveWalkLimits(straightLineTotalM) {
  if (straightLineTotalM > LONG_TRIP_THRESHOLD_M) {
    return { transferWalk: MAX_TRANSFER_WALK_M, endpointWalk: 700 };
  }
  return { transferWalk: MAX_TRANSFER_WALK_M, endpointWalk: NORMAL_TRIP_ENDPOINT_WALK_M };
}

export function buildGridIndex(stopList) {
  const gridIndex = new Map();
  for (const [stopId, s] of Object.entries(stopList)) {
    if (!s || !s.location) continue;
    const key = cellKey(s.location.lat, s.location.lng);
    if (!gridIndex.has(key)) gridIndex.set(key, []);
    gridIndex.get(key).push(stopId);
  }
  return gridIndex;
}

export function cleanStopName(name) {
  if (!name) return "";
  let s = name.toString()
             .replace(/[\(（].*?[\)）]/g, "")
             .replace(/[\s,，.。\-_]/g, "")
             .toLowerCase()
             .trim();
  for (const suffix of STOP_SUFFIX_WORDS) {
    if (s.length > suffix.length && s.endsWith(suffix)) {
      s = s.slice(0, -suffix.length);
      break;
    }
  }
  return s;
}

export function isSameTransferPoint(stopA, stopB) {
  if (!stopA || !stopB) return false;
  const dist = distM(stopA.location, stopB.location);
  if (dist > MERGE_RADIUS_M) return false;
  
  const zhA = cleanStopName(stopA.name.zh);
  const zhB = cleanStopName(stopB.name.zh);
  const enA = cleanStopName(stopA.name.en);
  const enB = cleanStopName(stopB.name.en);
  
  if (zhA && zhB) {
    if (zhA === zhB || zhA.includes(zhB) || zhB.includes(zhA)) return true;
  }
  if (enA && enB) {
    if (enA === enB || enA.includes(enB) || enB.includes(enA)) return true;
  }
  if (dist <= MERGE_FALLBACK_DIST_M) return true;
  
  return false;
}

export function nearbyStops(lat, lng, radiusM, etaDb, gridIndex) {
  const found = [];
  const seenStopIds = new Set();

  const latMPerDeg = 111320;
  const lngMPerDeg = Math.max(111320 * Math.cos(lat * Math.PI / 180), 1);
  const latCellM = latMPerDeg * CELL;
  const lngCellM = lngMPerDeg * CELL;

  const latCell = Math.floor(lat / CELL), lngCell = Math.floor(lng / CELL);
  const latOffsetM = (lat - latCell * CELL) * latMPerDeg;
  const lngOffsetM = (lng - lngCell * CELL) * lngMPerDeg;

  const negLatSpan = Math.max(0, Math.ceil((radiusM - latOffsetM) / latCellM));
  const posLatSpan = Math.max(0, Math.ceil((radiusM - (latCellM - latOffsetM)) / latCellM));
  const negLngSpan = Math.max(0, Math.ceil((radiusM - lngOffsetM) / lngCellM));
  const posLngSpan = Math.max(0, Math.ceil((radiusM - (lngCellM - lngOffsetM)) / lngCellM));

  for (let dlat = -negLatSpan; dlat <= posLatSpan; dlat++) {
    for (let dlng = -negLngSpan; dlng <= posLngSpan; dlng++) {
      const bucket = gridIndex.get((latCell + dlat) + "," + (lngCell + dlng));
      if (!bucket) continue;
      for (const stopId of bucket) {
        if (seenStopIds.has(stopId)) continue;
        const s = etaDb.stopList[stopId];
        if (!s) continue;
        const d = distM({ lat, lng }, s.location);
        if (d <= radiusM) {
          found.push({ stopId, dist: d });
          seenStopIds.add(stopId);
        }
      }
    }
  }
  
  const merged = [];
  found.forEach(f => {
    const existing = merged.find(m => isSameTransferPoint(etaDb.stopList[m.stopId], etaDb.stopList[f.stopId]));
    if (!existing) {
      merged.push(f);
    } else {
      f.dist = existing.dist;
      merged.push(f);
    }
  });
  
  merged.sort((a, b) => a.dist - b.dist);
  return merged;
}

export function stopName(stopId, etaDb) {
  const s = etaDb?.stopList?.[stopId];
  if (!s) return stopId;
  return s.name.zh || s.name.en || stopId;
}

export function fmtTime(d) {
  if (!d || isNaN(d)) return "--:--";
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}

export function fmtDist(m) {
  return m < 1000 ? Math.round(m) + "米" : (m / 1000).toFixed(1) + "公里";
}

export function _toMinutes(timeStr) {
  if (!timeStr) return 0;
  const s = String(timeStr).padStart(4, '0');
  const hh = parseInt(s.substring(0, s.length - 2), 10) || 0;
  const mm = parseInt(s.substring(s.length - 2), 10) || 0;
  return hh * 60 + mm;
}

export function isLantauCoord(lat, lng) {
  return lat >= 22.19 && lat <= 22.36 && lng >= 113.83 && lng <= 114.06;
}

export function computeIsLantauTrip(origin, destination) {
  if (LANTAU_KEYWORDS.test(origin.name) || LANTAU_KEYWORDS.test(destination.name)) return true;
  if (isLantauCoord(origin.lat, origin.lng) || isLantauCoord(destination.lat, destination.lng)) return true;
  return false;
}

export function isHKIslandCoord(lat, lng) {
  return lat >= 22.19 && lat <= 22.30 && lng >= 114.11 && lng <= 114.27;
}

export function computeIsCrossHarbourTrip(orig, dest) {
  const origHKI = HK_ISLAND_KEYWORDS.test(orig.name) || isHKIslandCoord(orig.lat, orig.lng);
  const destHKI = HK_ISLAND_KEYWORDS.test(dest.name) || isHKIslandCoord(dest.lat, dest.lng);
  return origHKI !== destHKI;
}

export function getRegionWalkLimit(lat, lng, name) {
  const KOWLOON_KEYWORDS = /尖沙咀|尖東|旺角|油麻地|佐敦|深水埗|長沙灣|荔枝角|美孚|九龍城|土瓜灣|紅磡|啟德|新蒲崗|黃大仙|鑽石山|慈雲山|牛池灣|九龍灣|牛頭角|觀塘|藍田|油塘|秀茂坪|順利|九龍塘|何文田|大角咀|石夾尾/;
  const isHKIsland = isHKIslandCoord(lat, lng) || HK_ISLAND_KEYWORDS.test(name);
  const isKowloon = KOWLOON_KEYWORDS.test(name) || (lat > 22.298 && lat <= 22.355 && lng >= 114.09 && lng <= 114.24);

  if (isHKIsland || isKowloon) {
    return 500; 
  }
  return 700; 
}

export function isTungChungOrAirportLocal(orig, dest) {
  if (!orig || !dest) return false;
  const localKeywords = /東涌|逸東|滿東|迎東|裕雅|富東|裕東|映灣園|藍天海岸|昇薈|東環|機場|博覽館|航天城|國泰城|後勤區|飛機維修區|民航處|客運大樓|地面運輸中心/i;
  const isLocalCoord = (lat, lng) => lat >= 22.27 && lat <= 22.34 && lng >= 113.88 && lng <= 113.97;
  
  const origLocal = localKeywords.test(orig.name) || isLocalCoord(orig.lat, orig.lng);
  const destLocal = localKeywords.test(dest.name) || isLocalCoord(dest.lat, dest.lng);
  
  return origLocal && destLocal;
}