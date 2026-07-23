import { fetchEtaDb, fetchEtas } from "https://esm.sh/hk-bus-eta@3?bundle";
import * as Config from './config.js';
import * as Utils from './utils.js';
import * as Fare from './fare.js';
import * as Scheduler from './scheduler.js';

/* ---------------- 全局 State ---------------- */
let etaDb = null;
let routeFareDb = null;      
let timeIntervalDb = null;   
let kmbBbiStopDb = null;             
let regionalTwoWayFareDb = null;     
let ctbRouteIdsDb = null;            
let ctbLiveInterchangeCache = new Map();
let mtrBusRouteFareDb = null;        
let bbiF1Db = null;                  
let bbiB1Db = null;                  
let bbiHeavyLoaded = false;          
let bbiLightLoaded = false;          
let kmbLiveServiceTypesByRoute = null;   
let kmbRouteIndexLoaded = false;
let ctbLiveBoundsByRoute = null;         
let nlbRouteTagDb = null;                
let stopRouteIndex = null;   
let gridIndex = null;        
let routeSiblingIndex = null; 
let origin = null;           
let destination = null;
let sortMode = "time";

const $ = (sel) => document.querySelector(sel);

// 初始化資料庫與事件監聽器
async function initApp() {
  console.log("應用程式初始化中...");
  // 於此處放置 API fetch 資料載入 logic 及 UI Listener...
}

document.addEventListener("DOMContentLoaded", initApp);