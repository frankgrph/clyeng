import { cleanStopName } from './utils.js';
import { OFFICIAL_INTERCHANGE_REGEX, NLB_E_TRANSFER_DISCOUNT, NLB_E_TRANSFER_TIME_LIMIT_MIN } from './config.js';

export function isHolidayFareDate(when, routeFareDb) {
  const w = when || new Date();
  if (w.getDay() === 0) return true;
  if (!routeFareDb || !Array.isArray(routeFareDb.holidays)) return false;
  const yyyy = w.getFullYear();
  const mm = String(w.getMonth() + 1).padStart(2, '0');
  const dd = String(w.getDate()).padStart(2, '0');
  return routeFareDb.holidays.includes(`${yyyy}${mm}${dd}`);
}

export function _fareNameNorm(s) {
  return String(s || "")
    .replace(/\(.*?\)|（.*?）/g, "")
    .replace(/[\s ]/g, "")
    .trim();
}

export function buildMtrBusFareIndex(mtrBusRoutesJson) {
  const out = {};
  if (!mtrBusRoutesJson || typeof mtrBusRoutesJson !== "object") return out;
  for (const rec of Object.values(mtrBusRoutesJson)) {
    if (!rec || !rec.route) continue;
    const bound = (rec.bound && rec.bound["mtr-bus"]) || "O";
    const fares = Array.isArray(rec.fares) ? rec.fares.map(parseFloat).filter(Number.isFinite) : [];
    const faresHol = Array.isArray(rec.faresHoliday) ? rec.faresHoliday.map(parseFloat).filter(Number.isFinite) : [];
    if (!fares.length) continue;
    const flatFare = fares[0];
    const flatFareHol = faresHol.length ? faresHol[0] : null;
    if (!out[rec.route]) out[rec.route] = {};
    out[rec.route][bound] = { fare: flatFare, fareHoliday: flatFareHol };
  }
  return out;
}

export function _findStopIdxByName(stops, targetName, etaDb) {
  const target = _fareNameNorm(targetName);
  if (!target || !stops) return -1;
  let best = -1;
  for (let i = 0; i < stops.length; i++) {
    const s = etaDb.stopList[stops[i]];
    if (!s) continue;
    const name = _fareNameNorm(s.name?.zh || s.name?.en || "");
    if (!name) continue;
    if (name === target) return i;
    if (best === -1 && (name.includes(target) || target.includes(name))) best = i;
  }
  return best;
}

export function getRegionalTwoWayFare(r, co, boardIdx, alightIdx, regionalTwoWayFareDb, etaDb) {
  if (!regionalTwoWayFareDb || !Array.isArray(regionalTwoWayFareDb.routes)) return null;
  if (co !== "kmb" && co !== "nlb") return null;
  const routeNo = String(r.route || "").toUpperCase();
  const candidates = regionalTwoWayFareDb.routes.filter(x => String(x.route_number || "").toUpperCase() === routeNo);
  if (!candidates.length) return null;
  const stops = (r.stops && (r.stops[co] || r.stops[r.primaryCo])) || null;
  if (!stops) return null;

  let bestFare = null;
  for (const cand of candidates) {
    const idxA = _findStopIdxByName(stops, cand.start, etaDb);
    const idxB = _findStopIdxByName(stops, cand.end, etaDb);
    if (idxA < 0 || idxB < 0) continue;
    const lo = Math.min(idxA, idxB), hi = Math.max(idxA, idxB);
    if (boardIdx >= lo && boardIdx <= hi && alightIdx >= lo && alightIdx <= hi) {
      const f = parseFloat(cand.fare);
      if (Number.isFinite(f) && (bestFare === null || f < bestFare)) bestFare = f;
    }
  }
  return bestFare;
}

export function getSegFare(r, co, boardIdx, alightIdx, when, context) {
  const { etaDb, routeFareDb, mtrBusRouteFareDb, regionalTwoWayFareDb } = context;
  if (!r || boardIdx == null || alightIdx == null || alightIdx <= boardIdx) return null;

  const stops = (r.stops && (r.stops[co] || r.stops[r.primaryCo])) || null;

  if (stops && boardIdx + 1 < stops.length) {
    const currentStopId = stops[boardIdx];
    const nextStopId = stops[boardIdx + 1];
    if (currentStopId && nextStopId) {
      const currentName = _fareNameNorm(etaDb.stopList[currentStopId]?.name?.zh || "");
      const nextName = _fareNameNorm(etaDb.stopList[nextStopId]?.name?.zh || "");
      if (currentName.includes("城門隧道轉車站") && nextName.includes("城門隧道轉車站")) {
        boardIdx = boardIdx + 1;
      }
    }
  }

  if ((co === "mtrb" || co === "mtr-bus") && mtrBusRouteFareDb) {
    const routeEntry = mtrBusRouteFareDb[r.route];
    if (routeEntry) {
      const bound = (r.bound && (r.bound[co] || r.bound.mtrb || r.bound["mtr-bus"])) || Object.keys(routeEntry)[0];
      const info = routeEntry[bound] || routeEntry[Object.keys(routeEntry)[0]];
      if (info) {
        const isHol = isHolidayFareDate(when, routeFareDb);
        const v = (isHol && Number.isFinite(info.fareHoliday)) ? info.fareHoliday : info.fare;
        if (Number.isFinite(v)) return Math.round(v * 10) / 10;
      }
    }
  }

  const regionalFare = getRegionalTwoWayFare(r, co, boardIdx, alightIdx, regionalTwoWayFareDb, etaDb);
  const isHol = isHolidayFareDate(when, routeFareDb);
  const table = (isHol && Array.isArray(r.faresHoliday) && r.faresHoliday.length) ? r.faresHoliday : r.fares;

  let normalFare = null;
  if (Array.isArray(table) && table.length) {
    const stops = (r.stops && (r.stops[co] || r.stops[r.primaryCo])) || null;
    if (stops && table.length === stops.length - 1) {
      const fareVal = parseFloat(table[boardIdx]);
      if (Number.isFinite(fareVal)) {
        normalFare = Math.round(fareVal * 10) / 10;
      }
    } else if (table.length === 1) {
      const fareVal = parseFloat(table[0]);
      if (Number.isFinite(fareVal)) {
        normalFare = Math.round(fareVal * 10) / 10;
      }
    } else if (stops && stops.length > 1) {
      const ratio = boardIdx / (stops.length - 1);
      const idx = Math.min(table.length - 1, Math.max(0, Math.floor(ratio * table.length)));
      const fareVal = parseFloat(table[idx]);
      if (Number.isFinite(fareVal)) {
        normalFare = Math.round(fareVal * 10) / 10;
      }
    }
  }

  if (regionalFare !== null) {
    if (normalFare === null || regionalFare < normalFare) return Math.round(regionalFare * 10) / 10;
  }
  return normalFare;
}

let kmbBbiInterchangeNames = new Set();
export function buildKmbBbiInterchangeNames(kmbBbiStopDb) {
  kmbBbiInterchangeNames = new Set();
  if (!kmbBbiStopDb) return;
  for (const entries of Object.values(kmbBbiStopDb)) {
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      const zh = (e && e.zh) ? cleanStopName(e.zh) : "";
      if (zh) kmbBbiInterchangeNames.add(zh);
    }
  }
}

export function isOfficialInterchangeName(name) {
  if (!name) return false;
  if (OFFICIAL_INTERCHANGE_REGEX.test(name)) return true;
  if (!kmbBbiInterchangeNames.size) return false;
  const cleaned = cleanStopName(name);
  if (!cleaned) return false;
  for (const bbiName of kmbBbiInterchangeNames) {
    if (cleaned.includes(bbiName) || bbiName.includes(cleaned)) return true;
  }
  return false;
}

export function _routeKeyForBbi(routeNo) {
  return String(routeNo || "").toUpperCase().trim();
}

export function _transferGapMinutes(prevLeg, nextLeg) {
  if (!prevLeg || !nextLeg || !prevLeg.departTime || !nextLeg.departTime) return null;
  return Math.max(0, (nextLeg.departTime.getTime() - prevLeg.departTime.getTime()) / 60000);
}

export function _kmbBbiDiscountFor(prevLeg, nextLeg, transferIndex = 1, bbiF1Db, bbiB1Db, bbiHeavyLoaded) {
  if (!bbiHeavyLoaded || (!bbiF1Db && !bbiB1Db)) return 0;
  if (prevLeg.co !== "kmb" || nextLeg.co !== "kmb") return 0;
  const gap = _transferGapMinutes(prevLeg, nextLeg);
  if (gap === null) return 0;

  const key = _routeKeyForBbi(prevLeg.routeNo);
  const nextRoute = _routeKeyForBbi(nextLeg.routeNo);
  const tables = [bbiF1Db, bbiB1Db];

  let best = 0;
  for (const table of tables) {
    if (!table) continue;
    const entries = table[key] || table[prevLeg.routeNo] || null;
    if (!Array.isArray(entries)) continue;
    for (const e of entries) {
      if (_routeKeyForBbi(e.bbi_route_number) !== nextRoute) continue;

      const maxChange = parseInt(e.max_change, 10);
      if (Number.isFinite(maxChange) && maxChange > 0 && transferIndex > maxChange) continue;

      const timeLimit = parseFloat(e.time_limit);
      if (Number.isFinite(timeLimit) && gap > timeLimit) continue;

      const rawVal = parseFloat(e.discount);
      let candidateDiscount = 0;
      switch (e.discount_type) {
        case "free":
          candidateDiscount = (typeof nextLeg.fare === "number") ? nextLeg.fare : 0;
          break;
        case "discount":
        case "return":
          if (Number.isFinite(rawVal)) candidateDiscount = rawVal;
          break;
        case "combined_fare":
          if (Number.isFinite(rawVal) && typeof prevLeg.fare === "number" && typeof nextLeg.fare === "number") {
            candidateDiscount = (prevLeg.fare + nextLeg.fare) - rawVal;
          }
          break;
        case "fixed_fare":
          if (Number.isFinite(rawVal) && typeof nextLeg.fare === "number") {
            candidateDiscount = nextLeg.fare - rawVal;
          }
          break;
        default:
          candidateDiscount = 0;
      }

      if (candidateDiscount > best) best = candidateDiscount;
    }
  }
  return Math.max(0, best);
}

export function _kmbNlbTransferDiscountFor(prevLeg, nextLeg) {
  if (!prevLeg || !nextLeg) return 0;

  const isLwbERoute = (leg) => leg.co === "kmb" && /^E\d/i.test(String(leg.routeNo || "").trim());
  const nlbDiscountKeyFor = (leg) => {
    if (leg.co !== "nlb") return null;
    const rn = String(leg.routeNo || "").trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(NLB_E_TRANSFER_DISCOUNT, rn) ? rn : null;
  };

  let nlbKey = null;
  if (isLwbERoute(prevLeg)) {
    nlbKey = nlbDiscountKeyFor(nextLeg);
  } else if (isLwbERoute(nextLeg)) {
    nlbKey = nlbDiscountKeyFor(prevLeg);
  }
  if (!nlbKey) return 0;

  const gap = _transferGapMinutes(prevLeg, nextLeg);
  if (gap === null || gap > NLB_E_TRANSFER_TIME_LIMIT_MIN) return 0;

  return NLB_E_TRANSFER_DISCOUNT[nlbKey];
}

export function _ctbTrimUp(s) {
  return String(s || "").trim().toUpperCase();
}

export function _ctbSplitAnchors(str) {
  if (!str) return [];
  return str.split(/[\/或,、]/).map(s => s.trim()).filter(Boolean);
}

export function _ctbParseRemarkConstraints(remarkText) {
  const out = [];
  const raw = String(remarkText || "").trim();
  if (!raw) return out;

  const normalizedRaw = raw.replace(/不適用於/g, "。不適用於");
  const sentences = normalizedRaw
    .split(/[\r\n]+|(?<=。)/)
    .flatMap(s => s.split(/(?:^- \s*)/)) 
    .map(s => s.trim())
    .filter(Boolean);

  for (let sentence of sentences) {
    let isExclude = false;
    if (sentence.includes("不適用於")) {
      isExclude = true;
      sentence = sentence.replace(/^不適用於\s*/, "");
    }

    sentence = sentence.replace(/^(?:- \s*)?(?:優惠)?只適用於[：:]?\s*/, "");
    sentence = sentence.replace(/^(?:在|於)\s*/, "");

    if (!sentence) continue;

    const c = _ctbParseOneRemarkSentence(sentence);
    if (c) {
      if (isExclude) c.exclude = true;
      out.push(c);
    } else {
      console.debug(`[城巴轉乘] remark 句子未能識別格式，略過檢查：「${sentence}」`);
    }
  }
  return out;
}

export function _ctbParseOneRemarkSentence(sentence) {
  let m;
  const isAlight = sentence.includes("下車");
  const action = isAlight ? "alight" : "board";

  m = sentence.match(/(首程|次程)(?:繳付全程車資)/);
  if (m) {
    return { leg: m[1] === "次程" ? "second" : "first", action, type: "full_fare" };
  }

  m = sentence.match(/轉乘往(.+)/);
  if (m) {
    return { leg: "second", action: "board", type: "direction", anchors: _ctbSplitAnchors(m[1]) };
  }

  m = sentence.match(/(首程|次程)?(?:享用)?(.+?)(?:分段收費)/);
  if (m) {
    const leg = (m[1] === "次程" || sentence.includes("次程")) ? "second" : "first";
    return { leg, action, type: "section_fare", anchors: [m[2].trim()] };
  }

  m = sentence.match(/(首程|次程)?(?:在|於)?(.+?)(?:及|至|到)(.+?)(?:之間)?(?:沿途)?(?:各站)?(?:登(?:上.*?|車)|下車)/);
  if (m) {
    const finalLeg = m[1] === "次程" ? "second" : (m[1] === "首程" ? "first" : (sentence.includes("次程") ? "second" : "first"));
    return {
      leg: finalLeg,
      action,
      type: "between",
      anchors: [..._ctbSplitAnchors(m[2]), ..._ctbSplitAnchors(m[3])]
    };
  }

  m = sentence.match(/(首程|次程)?(?:在|於)?(.+?)(?:站)?(?:各站)?(?:或)?(?:之前|以前|前)(?:沿途)?(?:各站)?(?:登(?:上.*?|車)|下車)/);
  if (m) {
    const finalLeg = m[1] === "次程" ? "second" : (m[1] === "首程" ? "first" : (sentence.includes("次程") ? "second" : "first"));
    return {
      leg: finalLeg,
      action,
      type: "before",
      anchors: _ctbSplitAnchors(m[2])
    };
  }

  m = sentence.match(/(首程|次程)?(?:在|於)?(.+?)(?:站)?(?:各站)?(?:或)?(?:之後|其後|後)(?:沿途)?(?:各站)?(?:登(?:上.*?|車)|下車)/);
  if (m) {
    const finalLeg = m[1] === "次程" ? "second" : (m[1] === "首程" ? "first" : (sentence.includes("次程") ? "second" : "first"));
    return {
      leg: finalLeg,
      action,
      type: "after",
      anchors: _ctbSplitAnchors(m[2])
    };
  }

  m = sentence.match(/(首程|次程)?(?:在|於)?(.+?)(?:沿途)?(?:各站)?(?:登(?:上.*?|車(?:往.*?)?)|下車)/);
  if (m) {
    const finalLeg = m[1] === "次程" ? "second" : (m[1] === "首程" ? "first" : (sentence.includes("次程") ? "second" : "first"));
    return {
      leg: finalLeg,
      action,
      type: "along",
      anchors: _ctbSplitAnchors(m[2])
    };
  }

  return null;
}