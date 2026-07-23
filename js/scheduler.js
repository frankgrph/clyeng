import { _toMinutes, computeIsLantauTrip, isTungChungOrAirportLocal, distM, getAdaptiveWalkLimits, nearbyStops } from './utils.js';
import { PENALTY_TRANSFER, PENALTY_CROSS_CO, MULTIPLIER_WALK, LANTAU_KEYWORDS } from './config.js';
import { isOfficialInterchangeName } from './fare.js';

export function _isDesignatedPublicHoliday(when, routeFareDb) {
  if (!routeFareDb || !Array.isArray(routeFareDb.holidays)) return false;
  const yyyy = when.getFullYear();
  const mm = String(when.getMonth() + 1).padStart(2, '0');
  const dd = String(when.getDate()).padStart(2, '0');
  return routeFareDb.holidays.includes(`${yyyy}${mm}${dd}`);
}

export function _resolveFreqDayTypeKey(freq, when, routeFareDb) {
  if (!freq) return null;
  const dayTypes = Object.keys(freq);
  if (!dayTypes.length) return null;

  const day = when.getDay();

  let textKey = null;
  if (day === 0) {
    textKey = dayTypes.find(k => /sun|holiday/i.test(k));
  } else if (day === 6) {
    textKey = dayTypes.find(k => /sat/i.test(k)) || dayTypes.find(k => /weekend|holiday/i.test(k));
  } else {
    textKey = dayTypes.find(k => /weekday|normal/i.test(k)) || dayTypes.find(k => /mon|tue|wed|thu|fri/i.test(k));
  }
  if (textKey) return textKey;

  const allNumeric = dayTypes.every(k => /^\d+$/.test(k));
  if (!allNumeric) return null;

  const DOW_BIT = [64, 1, 2, 4, 8, 16, 32];
  const dowBit = DOW_BIT[day];
  const isHoliday = _isDesignatedPublicHoliday(when, routeFareDb);

  const parsedKeys = dayTypes.map(k => ({
    key: k,
    mask: parseInt(k, 10) & 0xff
  }));

  const countBits = (n) => {
    let count = 0;
    let val = n;
    while (val > 0) {
      if (val & 1) count++;
      val >>= 1;
    }
    return count;
  };

  if (isHoliday) {
    const holidayKeys = parsedKeys.filter(item => (item.mask & 128) === 128);
    if (holidayKeys.length > 0) {
      holidayKeys.sort((a, b) => countBits(a.mask) - countBits(b.mask));
      return holidayKeys[0].key;
    }

    const weekendOrSunKeys = parsedKeys.filter(item => (item.mask & (64 | 32)) > 0);
    if (weekendOrSunKeys.length > 0) {
      weekendOrSunKeys.sort((a, b) => countBits(a.mask) - countBits(b.mask));
      return weekendOrSunKeys[0].key;
    }
  }

  const strictDowKeys = parsedKeys.filter(item => (item.mask & dowBit) === dowBit && (item.mask & 128) === 0);
  if (strictDowKeys.length > 0) {
    strictDowKeys.sort((a, b) => countBits(a.mask) - countBits(b.mask));
    return strictDowKeys[0].key;
  }

  const anyDowKeys = parsedKeys.filter(item => (item.mask & dowBit) === dowBit);
  if (anyDowKeys.length > 0) {
    anyDowKeys.sort((a, b) => countBits(a.mask) - countBits(b.mask));
    return anyDowKeys[0].key;
  }

  return null;
}

export function _freqEntryToMinutes(entry) {
  if (entry == null) return null;
  if (Array.isArray(entry)) {
    const headwaySecs = Number(entry[1]);
    if (Number.isFinite(headwaySecs) && headwaySecs > 0) {
      return Math.max(1, Math.round(headwaySecs / 60));
    }
    return null;
  }
  const nums = String(entry).match(/\d+/g);
  if (!nums) return null;
  return Math.max(...nums.map(Number));
}

export function _nextGridDeparture(blockStartMins, headwayMins, nowMins) {
  const elapsed = nowMins - blockStartMins;
  const steps = Math.ceil(elapsed / headwayMins);
  return blockStartMins + Math.max(0, steps) * headwayMins;
}

export function _computeFreqDeparture(table, now, lookaheadMin) {
  if (!table) return null;
  const keys = Object.keys(table);
  if (!keys.length) return null;

  const nowMins = now.getHours() * 60 + now.getMinutes();
  const sortedKeys = keys.slice().sort((a, b) => _toMinutes(a) - _toMinutes(b));

  let best = null;
  const consider = (diffMins, isFutureBlock, isPointDeparture) => {
    if (diffMins < 0 || diffMins > lookaheadMin) return;
    if (!best || diffMins < best.diffMins) {
      best = {
        diffMins,
        etaDate: new Date(now.getTime() + diffMins * 60000),
        isFutureBlock,
        isPointDeparture
      };
    }
  };

  for (let i = 0; i < sortedKeys.length; i++) {
    const startKey = sortedKeys[i];
    const entry = table[startKey];

    let startMins = _toMinutes(startKey);
    let endMins = 0;
    let headwayMins = 20;

    if (Array.isArray(entry)) {
      endMins = _toMinutes(entry[0]);
      if (endMins <= startMins) endMins += 24 * 60;
      headwayMins = Math.max(1, Math.round(Number(entry[1]) / 60));
    } else if (typeof entry === 'string' || typeof entry === 'number') {
      headwayMins = _freqEntryToMinutes(entry) || 20;
      const nextKey = i < sortedKeys.length - 1 ? sortedKeys[i + 1] : null;
      endMins = nextKey ? _toMinutes(nextKey) : 1440;
    } else if (entry === null) {
      if (startMins >= nowMins) {
        consider(startMins - nowMins, true, true);
      }
      continue;
    }

    let effectiveNowMins = null;
    if (nowMins >= startMins && nowMins < endMins) {
      effectiveNowMins = nowMins;
    } else if (endMins > 1440 && (nowMins + 1440) >= startMins && (nowMins + 1440) < endMins) {
      effectiveNowMins = nowMins + 1440;
    }

    if (effectiveNowMins !== null) {
      const elapsed = effectiveNowMins - startMins;
      const steps = Math.ceil(elapsed / headwayMins);
      const nextDepMins = startMins + steps * headwayMins;

      if (nextDepMins < endMins) {
        consider(nextDepMins - effectiveNowMins, false, false);
      }
      continue;
    }

    if (nowMins < startMins) {
      consider(startMins - nowMins, true, false);
    }
  }

  if (!best) return null;
  return {
    etaDate: best.etaDate,
    isFutureBlock: best.isFutureBlock,
    isPointDeparture: best.isPointDeparture
  };
}

export function _routeBoundValue(r, co) {
  if (!r || !r.bound) return "";
  return (typeof r.bound === "object") ? (r.bound[co] || "") : (r.bound || "");
}

export function _routeSiblingKey(routeNo, co, boundVal) {
  return `${String(routeNo || "").toUpperCase()}|${co}|${boundVal || ""}`;
}

export function buildRouteSiblingIndex(etaDb) {
  if (!etaDb || !etaDb.routeList) return new Map();
  const routeSiblingIndex = new Map();
  for (const r of Object.values(etaDb.routeList)) {
    if (!r || !r.route || !Array.isArray(r.co)) continue;
    for (const co of r.co) {
      if (!r.stops || !r.stops[co] || !r.stops[co].length) continue;
      const key = _routeSiblingKey(r.route, co, _routeBoundValue(r, co));
      if (!routeSiblingIndex.has(key)) routeSiblingIndex.set(key, []);
      routeSiblingIndex.get(key).push(r);
    }
  }
  return routeSiblingIndex;
}

export function _findSiblingRoutesForStop(r, co, boardStopId, routeSiblingIndex) {
  if (!routeSiblingIndex || !r) return [];
  const key = _routeSiblingKey(r.route, co, _routeBoundValue(r, co));
  const list = routeSiblingIndex.get(key);
  if (!list || !list.length) return [];
  return list.filter(sib => {
    if (sib === r) return false;
    if (!boardStopId) return true;
    const sibStops = sib.stops && sib.stops[co];
    return !!(sibStops && sibStops.includes(boardStopId));
  });
}

export function _resolveEffectiveFreqTable(r, atTime, boardStopId, primaryCo, routeSiblingIndex, routeFareDb) {
  if (!r) return null;
  const co = primaryCo || r.primaryCo || (Array.isArray(r.co) ? r.co[0] : null);

  const tryOne = (candidate) => {
    if (!candidate || !candidate.freq) return null;
    const dayKey = _resolveFreqDayTypeKey(candidate.freq, atTime, routeFareDb);
    if (!dayKey) return null;
    const table = candidate.freq[dayKey];
    if (!table || !Object.keys(table).length) return null;
    return table;
  };

  const ownTable = tryOne(r);
  if (ownTable) return { table: ownTable, source: r };

  if (!co) return null;
  const siblings = _findSiblingRoutesForStop(r, co, boardStopId, routeSiblingIndex);
  for (const sib of siblings) {
    const table = tryOne(sib);
    if (table) return { table, source: sib };
  }
  return null;
}

export function isPlausibleServiceHour(routeNo, atTime) {
  const isNightRoute = /^N/i.test(routeNo);
  const hour = atTime.getHours();
  if (isNightRoute) {
    return hour >= 0 && hour < 6;
  }
  return hour >= 5 || hour === 0;
}

export function isKmbServiceTypeLive(routeNo, serviceType) {
  return true;
}

export function isRouteActiveAroundTime(r, atTime, boardStopId = null, windowMin = 90, context = {}) {
  if (!r || !atTime) return false;
  const { routeSiblingIndex, routeFareDb } = context;

  if (boardStopId && r.stops && r.primaryCo) {
    const currentStops = r.stops[r.primaryCo];
    if (!currentStops.includes(boardStopId)) return false; 
  }

  if (!isPlausibleServiceHour(r.route || "", atTime)) return false;

  if (r.primaryCo === "kmb" && r.service_type) {
    const liveCheck = isKmbServiceTypeLive(r.route, r.service_type);
    if (liveCheck === false) return false;
  }

  try {
    const freq = r.freq;
    if (freq) {
      const dayTypes = Object.keys(freq);
      if (!dayTypes.length) return true;
    }

    const resolved = _resolveEffectiveFreqTable(r, atTime, boardStopId, r.primaryCo, routeSiblingIndex, routeFareDb);
    if (!resolved) {
      if (!freq) {
        return !(r.service_type && r.service_type > 1);
      }
      return false;
    }

    const result = _computeFreqDeparture(resolved.table, atTime, windowMin);
    return !!result;
  } catch (err) {
    return false; 
  }
}

export function hasDirectService(orig, dest, atTime = null, context = {}) {
  const { etaDb, stopRouteIndex } = context;
  if (!etaDb || !stopRouteIndex || !orig || !dest) return false;

  const straightLineTotalM = distM({ lat: orig.lat, lng: orig.lng }, { lat: dest.lat, lng: dest.lng });
  const { endpointWalk: directCheckRadiusM } = getAdaptiveWalkLimits(straightLineTotalM);

  const originStops = [{ stopId: orig.stopId, dist: 0 }]
    .concat(nearbyStops(orig.lat, orig.lng, directCheckRadiusM, etaDb, context.gridIndex))
    .map(s => s.stopId);
  const uniqueOriginStops = [...new Set(originStops)];

  const destStops = [{ stopId: dest.stopId, dist: 0 }]
    .concat(nearbyStops(dest.lat, dest.lng, directCheckRadiusM, etaDb, context.gridIndex))
    .map(s => s.stopId);
  const uniqueDestStops = [...new Set(destStops)];

  for (const origId of uniqueOriginStops) {
    const origRoutes = stopRouteIndex.get(origId) || [];
    for (const origRoute of origRoutes) {
      const r = etaDb.routeList[origRoute.routeId];
      if (!r) continue;
      
      const companies = r.co || [];
      for (const co of companies) {
        const stops = r.stops[co];
        if (!stops) continue;
        const oIdx = stops.indexOf(origId);
        if (oIdx === -1) continue;
        
        for (const destId of uniqueDestStops) {
          const dIdx = stops.indexOf(destId);
          if (dIdx !== -1 && oIdx < dIdx) {
            if (atTime && !isRouteActiveAroundTime(r, atTime, origId, 90, context)) continue;
            return true; 
          }
        }
      }
    }
  }
  return false;
}

export function isMultiCompanyStation(stopId, stopRouteIndex) {
  if (!stopRouteIndex || !stopRouteIndex.has(stopId)) return false;
  const routes = stopRouteIndex.get(stopId) || [];
  const companies = new Set();
  for (const rInfo of routes) {
    if (rInfo.companies) {
      rInfo.companies.forEach(co => companies.add(co));
    }
  }
  return companies.size >= 2;
}

export async function calculateRouteScore(legs, searchTime, context = {}) {
  const { etaDb, stopRouteIndex, origin, destination, sortMode, computeTripFare } = context;
  if (!legs || legs.length === 0) return { actualDuration: 0, score: Infinity, transferCount: 0 };
  
  const tripStartTime = legs[0].departTime;
  const isDeepNight = tripStartTime.getHours() >= 0 && tripStartTime.getHours() < 6;

  const safeOrigin = origin || { name: "", lat: 0, lng: 0 };
  const safeDestination = destination || { name: "", lat: 0, lng: 0 };
  const directExists = hasDirectService(origin, destination, searchTime || tripStartTime, context);
  
  const penaltyTransfer = directExists ? PENALTY_TRANSFER : 0; 

  let score = 0;
  let transferCount = 0;
  let prevCompany = null;
  let prevAlightStopId = null; 
  
  const startTime = legs[0].departTime;
  const endTime = legs[legs.length - 1].arriveTime;
  const actualDuration = (endTime - startTime) / 60000; 
  
  const waitTime = searchTime ? Math.max(0, (startTime - searchTime) / 60000) : 0;

  const totalMinutes = actualDuration + waitTime;
  score += Math.ceil(totalMinutes / 5) * 0.5;

  const isLantau = computeIsLantauTrip(safeOrigin, safeDestination);
  const isLocalTCOrAirport = isLantau && isTungChungOrAirportLocal(safeOrigin, safeDestination);

  legs.forEach((leg, idx) => {
    if (leg.type === "walk") {
      const isTransferWalk = !directExists && (idx > 0 && idx < legs.length - 1);
      if (!isTransferWalk) {
        const walkPenalty = 0;
        score += walkPenalty + (leg.minutes * MULTIPLIER_WALK);
      }
    } else if (leg.type === "ride") {
      if (prevCompany !== null) {
        transferCount++;
        
        if (!isDeepNight) {
            const alightStopName = etaDb?.stopList?.[prevAlightStopId]?.name?.zh || "";
            const boardStopName = etaDb?.stopList?.[leg.boardStopId]?.name?.zh || "";
            const isOfficialInterchange =
              isOfficialInterchangeName(alightStopName) ||
              isOfficialInterchangeName(boardStopName) ||
              isMultiCompanyStation(prevAlightStopId, stopRouteIndex) ||
              isMultiCompanyStation(leg.boardStopId, stopRouteIndex);
            
            let currentPenaltyTransfer = penaltyTransfer;
            
            if (isOfficialInterchange) {
                currentPenaltyTransfer = 0; 
                if (leg.co === "kmb" && prevCompany === "kmb") {
                    score -= 15; 
                }
            }

            score += currentPenaltyTransfer; 
            
            const isExempt = !directExists;
            if (!isExempt) {
              score += PENALTY_CROSS_CO; 
            }
        }
      }
      
      prevCompany = leg.co;
      prevAlightStopId = leg.alightStopId;

      if (isLantau) {
        if (isLocalTCOrAirport) {
          const isERoute = /^E\d+/i.test(leg.routeNo) && !/^E21/i.test(leg.routeNo);
          const isCityboundE = isERoute && leg.r && !LANTAU_KEYWORDS.test(leg.r.dest?.zh || "");
          const isSouthLantauRoute = /^(3M|11|23)$/i.test(leg.routeNo);
          const isSouthLantauOutbound = isSouthLantauRoute && leg.r && !/東涌|機場/i.test(leg.r.dest?.zh || "");

          if (isCityboundE || isSouthLantauOutbound) {
            score += 10; 
          }
        } else {
          const alightStopName = etaDb?.stopList?.[leg.alightStopId]?.name?.zh || "";
          const isLantauGatewayInterchange = /青嶼幹線|屯門赤鱲角隧道/i.test(alightStopName);
          const isCityboundAE = /^[AE]/i.test(leg.routeNo) && leg.r && !LANTAU_KEYWORDS.test(leg.r.dest?.zh || "");
          const isExemptGateway = isLantauGatewayInterchange && isCityboundAE;

          const isPreferred = /^E21/i.test(leg.routeNo) || /^S/i.test(leg.routeNo) || leg.co === "nlb" || isExemptGateway;
          if (!isPreferred) {
            score += 40; 
          }
        }
      }
    }
  });

  if (sortMode === "fare" && typeof computeTripFare === 'function') {
    const rideLegsForScore = legs.filter(l => l.type === "ride");
    const fareResultForScore = await computeTripFare(rideLegsForScore);
    score = (typeof fareResultForScore.totalFare === "number" ? fareResultForScore.totalFare : 9999) * 10 + actualDuration * 0.1;
  }

  return { actualDuration, score, transferCount };
}