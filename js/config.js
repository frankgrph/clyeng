/* ---------------- 全局常數與設定 ---------------- */
export const WALK_SPEED_MPS = 1.2;          // ~4.3km/h 步行(連搵路)
export const SAME_STOP_ALIGHT_BUFFER_MIN = 1; // 同站轉乘落車緩衝時間

export const DEBUG_MODE = (() => {
  try { return new URLSearchParams(location.search).get("debug") === "1"; }
  catch (e) { return false; }
})();

export const MAX_TRANSFER_WALK_M = 350;     // 轉車步行上限
export const NORMAL_TRIP_ENDPOINT_WALK_M = 500; // 常規車程（11公里內）起點替代車站搜尋範圍
export const MAX_LEGS = 4;                  // 最多3次轉車 = 4程

export const BEAM_WIDTH = 400;
export const LOOKAHEAD_STOPS = 70;
export const MAX_CANDIDATES_TO_EVAL = 100;
export const RESULTS_TO_SHOW = 10;
export const FRESH_ETA_WINDOW_MIN = 120;
export const ONESIDED_MAX_HOPS = 14;        // 逐站比對上限（最多掃14個站）
export const PRIORITY1_ALIGHT_FRESH_WINDOW_MIN = 60;

export const LONG_TRIP_THRESHOLD_M = 9000;
export const VERY_LONG_TRIP_THRESHOLD_M = 20000;
export const LONG_TRIP_TOTAL_MIN_THRESHOLD = 45;

export const MERGE_RADIUS_M = 220;
export const MERGE_FALLBACK_DIST_M = 60;

export const STOP_SUFFIX_WORDS = [
  "公共運輸交匯處", "公共交通交匯處", "運輸交匯處", "交匯處",
  "巴士總站", "小巴總站", "總站", "巴士站", "小巴站"
];

export const PENALTY_TRANSFER = 3;      
export const PENALTY_CROSS_CO = 5;     
export const MULTIPLIER_WALK = 1.1;     

export const LANTAU_KEYWORDS = /機場|東涌|迪士尼|博覽館|港珠澳|大嶼山|赤鱲角|國泰城|航天城|後勤區|飛機|大澳|梅窩|塘福|石壁|石門甲|昂坪|愉景灣|欣澳|東邨|東薈城|空運|航空|大橋香港口岸|客運大樓|貨運站|地面運輸中心|維修區/i;
export const OFFICIAL_INTERCHANGE_REGEX = /轉車站|轉乘站|城門隧道|大欖隧道|大老山隧道|獅子山隧道|青沙公路|屯門公路|粉嶺公路|將軍澳隧道|啟德隧道|西區海底隧道|海底隧道|東區海底隧道|青嶼幹線|屯門赤鱲角隧道|將藍隧道|香港仔隧道/i;
export const HK_ISLAND_KEYWORDS = /中環|金鐘|灣仔|銅鑼灣|天后|炮台山|北角|鰂魚涌|太古|西灣河|筲箕灣|柴灣|小西灣|堅尼地城|西營盤|香港大學|薄扶林|數碼港|香港仔|黃竹坑|鴨脷洲|海洋公園|赤柱|淺水灣|跑馬地|大坑/i;

export const NLB_E_TRANSFER_DISCOUNT = { "3M": 1.0, "11": 1.0, "23": 1.0, "36": 1.0, "X11R": 2.0 };
export const NLB_E_TRANSFER_TIME_LIMIT_MIN = 150;