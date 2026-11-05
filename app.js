/* ============================================================
   SKLAD-TERMINAL ENTERPRISE v10.0 • ПРОМЫШЛЕННОЕ ЯДРО УЧЁТА СКАНЕРОВ
   Архитектура: Offline-First IndexedDB ⇄ Supabase Cloud Sync
   Оборудование: Только сканеры штрихкода (Point Mobile / Zebra RS5100)
   ============================================================ */

const SUPABASE_URL = "https://sgpkvnymkqwuhepkaoxw.supabase.co";
const SUPABASE_KEY = "sb_publishable_dqlmOngeOHVYMFUG1s4kLw_N1Pxi9KW";
const OVERDUE_H = 14;
const BACKUP_BUCKET = 'sklad-backups';
const BACKUP_KEEP = 7;
const BACKUP_MIN_INTERVAL = 6 * 60 * 60 * 1000;
const RECENT_LOCAL_TTL = 60 * 1000;
const OP_COOLDOWN_MS = 1200; // Анти-дубль защита от двойного пика сканера (1.2 сек)
const THEME_STORAGE_KEY = 'sklad_exec_theme';
const DRAFT_KEY = 'sklad_draft_iss';
const DRAFT_TTL_MS = 5 * 60 * 1000;
const SN_REGEX = /^[A-Z0-9\-_.]{2,60}$/;
const MOVES_ROTATE_THRESHOLD = 6000;
const MOVES_ROTATE_KEEP = 3000;
const DEBT_REGISTRY_KEY = 'sklad_debtors_registry';
const DEBT_RECORDED_KEY = 'sklad_debtors_recorded';
const ALERTED_DEBTORS_KEY = 'sklad_alerted_debtors';
const DEBT_ALERT_DISMISSED_KEY = 'sklad_debt_alert_dismissed';
const REPAIR_MAP_KEY = 'sklad_repair_map_v10';
const NEW_OVERDUE_HIGHLIGHT_MS = 30000;
const NET_TIMEOUT_MS = 15000;
const SYNC_TIMEOUT_MS = 45000;
const SYNC_BASE_INTERVAL = 20000;
const SYNC_MAX_INTERVAL = 300000;
const SYNC_JITTER = 0.25;
const THEMES = ['berry', 'sapphire', 'carbon', 'quartz'];
const THEME_NAMES = {
  berry: '🔮 WB Berry (Корпоративная)',
  sapphire: '💎 Сапфир (Executive Dark)',
  carbon: '🌑 Карбон (Высокий контраст)',
  quartz: '☀️ Светлая (Дневной пост)'
};
const THEME_META_COLORS = {
  berry: '#07040e',
  sapphire: '#060812',
  carbon: '#090a0d',
  quartz: '#eef2f6'
};

// Предзагруженный слепок реального парка сканеров СЦ (193 шт.: Point Mobile и Zebra RS5100)
const INITIAL_SCANNER_FLEET = [{"serial": "23075523022193", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-27T16:50:56.152Z", "defect": ""}, {"serial": "2426210015", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T08:57:18.955Z", "defect": ""}, {"serial": "2426210039", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-01T12:04:11.642Z", "defect": ""}, {"serial": "2426210160", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T16:20:09.410Z", "defect": ""}, {"serial": "2426210161", "model": "Point Mobile", "status": "issued", "holder": "573613", "shift": "Дневная", "issued_at": "2026-11-03T03:17:08.469Z", "last_move": "2026-11-03T03:17:08.469Z", "defect": ""}, {"serial": "24262101614", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-31T15:18:37.072Z", "defect": ""}, {"serial": "2426310331", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-14T07:57:34.945Z", "defect": ""}, {"serial": "2426310951", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T12:56:14.773Z", "defect": ""}, {"serial": "2426310976", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-31T15:17:22.552Z", "defect": ""}, {"serial": "2426311071", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T13:01:54.800Z", "defect": ""}, {"serial": "2426311525", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-29T07:29:38.501Z", "defect": ""}, {"serial": "2426311552", "model": "Point Mobile", "status": "repair", "holder": "", "shift": "Дневная", "issued_at": null, "last_move": "2026-10-06T14:05:21.333Z", "defect": "Требуется диагностика / замена АКБ"}, {"serial": "2426311561", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-28T01:33:10.996Z", "defect": ""}, {"serial": "2426311567", "model": "Point Mobile", "status": "issued", "holder": "5219088", "shift": "Дневная", "issued_at": "2026-11-03T05:19:58.619Z", "last_move": "2026-11-03T05:19:58.619Z", "defect": ""}, {"serial": "2426311573", "model": "Point Mobile", "status": "free", "holder": "", "shift": "Дневная", "issued_at": null, "last_move": "2026-10-06T12:20:33.911Z", "defect": ""}, {"serial": "2426410227", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-15T18:24:53.483Z", "defect": ""}, {"serial": "2426510192", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-01T12:49:22.715Z", "defect": ""}, {"serial": "2523011210", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-30T19:30:08.829Z", "defect": ""}, {"serial": "2523020684", "model": "Point Mobile", "status": "repair", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-13T13:31:35.552Z", "defect": "Требуется диагностика / замена АКБ"}, {"serial": "2523110231", "model": "Point Mobile", "status": "issued", "holder": "3818471", "shift": "Дневная", "issued_at": "2026-11-03T05:15:50.398Z", "last_move": "2026-11-03T05:15:50.398Z", "defect": ""}, {"serial": "2523211044", "model": "Point Mobile", "status": "repair", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-24T13:33:32.419Z", "defect": "Требуется диагностика / замена АКБ"}, {"serial": "2523211089", "model": "Point Mobile", "status": "issued", "holder": "1619030", "shift": "Дневная", "issued_at": "2026-11-03T03:41:10.963Z", "last_move": "2026-11-03T03:41:10.963Z", "defect": ""}, {"serial": "2523211090", "model": "Point Mobile", "status": "issued", "holder": "5302862", "shift": "Дневная", "issued_at": "2026-11-03T05:37:28.753Z", "last_move": "2026-11-03T05:37:28.753Z", "defect": ""}, {"serial": "2523211096", "model": "Point Mobile", "status": "issued", "holder": "5933671", "shift": "Дневная", "issued_at": "2026-11-03T03:51:52.320Z", "last_move": "2026-11-03T03:51:52.320Z", "defect": ""}, {"serial": "2523211097", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-30T16:14:34.410Z", "defect": ""}, {"serial": "2523211098", "model": "Point Mobile", "status": "issued", "holder": "6309685", "shift": "Дневная", "issued_at": "2026-11-03T04:44:41.393Z", "last_move": "2026-11-03T04:44:41.393Z", "defect": ""}, {"serial": "2523220089", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-30T13:17:31.465Z", "defect": ""}, {"serial": "2523221088", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-28T23:51:29.321Z", "defect": ""}, {"serial": "2523221089", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T03:21:19.782Z", "defect": ""}, {"serial": "2523221093", "model": "Point Mobile", "status": "repair", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.361Z", "defect": "Требуется диагностика / замена АКБ"}, {"serial": "2523221095", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-22T04:43:39.828Z", "defect": ""}, {"serial": "2523221096", "model": "Point Mobile", "status": "repair", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-01T03:06:57.537Z", "defect": "Требуется диагностика / замена АКБ"}, {"serial": "2523221163", "model": "Point Mobile", "status": "issued", "holder": "879776", "shift": "Дневная", "issued_at": "2026-11-03T02:45:18.127Z", "last_move": "2026-11-03T02:45:18.127Z", "defect": ""}, {"serial": "2523310050", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.360Z", "defect": ""}, {"serial": "2523310084", "model": "Point Mobile", "status": "issued", "holder": "6408440", "shift": "Дневная", "issued_at": "2026-11-03T04:53:48.627Z", "last_move": "2026-11-03T04:53:48.627Z", "defect": ""}, {"serial": "2523310100", "model": "Point Mobile", "status": "repair", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.362Z", "defect": "Требуется диагностика / замена АКБ"}, {"serial": "2523310103", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.362Z", "defect": ""}, {"serial": "2523310115", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T04:13:48.817Z", "defect": ""}, {"serial": "2523310117", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T05:36:38.893Z", "defect": ""}, {"serial": "2523310119", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T11:54:26.568Z", "defect": ""}, {"serial": "2523310126", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-30T19:30:01.429Z", "defect": ""}, {"serial": "2523310138", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-01T14:34:14.427Z", "defect": ""}, {"serial": "2523310156", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T04:11:35.676Z", "defect": ""}, {"serial": "2523310158", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T14:08:44.808Z", "defect": ""}, {"serial": "2523310168", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.360Z", "defect": ""}, {"serial": "2523310204", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-21T02:57:07.957Z", "defect": ""}, {"serial": "2523310219", "model": "Point Mobile", "status": "issued", "holder": "6414567", "shift": "Дневная", "issued_at": "2026-11-03T05:29:28.092Z", "last_move": "2026-11-03T05:29:28.092Z", "defect": ""}, {"serial": "2523310223", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-26T13:38:42.395Z", "defect": ""}, {"serial": "2523310255", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-19T13:10:25.952Z", "defect": ""}, {"serial": "2523310317", "model": "Point Mobile", "status": "repair", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.361Z", "defect": "Требуется диагностика / замена АКБ"}, {"serial": "2523310328", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-28T07:08:49.015Z", "defect": ""}, {"serial": "2523310387", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-31T14:03:16.312Z", "defect": ""}, {"serial": "2523310413", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.362Z", "defect": ""}, {"serial": "2523310435", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-30T17:39:08.027Z", "defect": ""}, {"serial": "2523320074", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-01T15:50:29.495Z", "defect": ""}, {"serial": "2523320075", "model": "Point Mobile", "status": "issued", "holder": "6418131", "shift": "Дневная", "issued_at": "2026-11-03T05:15:40.993Z", "last_move": "2026-11-03T05:15:40.993Z", "defect": ""}, {"serial": "2523320077", "model": "Point Mobile", "status": "issued", "holder": "6254733", "shift": "Дневная", "issued_at": "2026-11-03T03:55:18.275Z", "last_move": "2026-11-03T03:55:18.275Z", "defect": ""}, {"serial": "2523320085", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-29T07:26:35.935Z", "defect": ""}, {"serial": "2523320086", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.362Z", "defect": ""}, {"serial": "2523320089", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-29T15:02:49.887Z", "defect": ""}, {"serial": "2523320122", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.360Z", "defect": ""}, {"serial": "2523320176", "model": "Point Mobile", "status": "issued", "holder": "6090422", "shift": "Дневная", "issued_at": "2026-11-03T05:00:13.706Z", "last_move": "2026-11-03T05:00:13.706Z", "defect": ""}, {"serial": "2523320219", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-29T04:37:11.448Z", "defect": ""}, {"serial": "2523320238", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-31T14:58:48.416Z", "defect": ""}, {"serial": "2523320326", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T03:50:57.270Z", "defect": ""}, {"serial": "2523320328", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T04:11:36.649Z", "defect": ""}, {"serial": "2523320348", "model": "Point Mobile", "status": "issued", "holder": "1037274", "shift": "Дневная", "issued_at": "2026-11-03T02:45:04.032Z", "last_move": "2026-11-03T02:45:04.032Z", "defect": ""}, {"serial": "2523320402", "model": "Point Mobile", "status": "issued", "holder": "6457478", "shift": "Дневная", "issued_at": "2026-11-03T04:44:12.278Z", "last_move": "2026-11-03T04:44:12.278Z", "defect": ""}, {"serial": "2523320411", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T16:33:49.295Z", "defect": ""}, {"serial": "2523320417", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T16:37:44.714Z", "defect": ""}, {"serial": "2523320423", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-30T17:44:31.187Z", "defect": ""}, {"serial": "2525010490", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.362Z", "defect": ""}, {"serial": "2525010524", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T03:50:59.791Z", "defect": ""}, {"serial": "2525010529", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-22T03:42:37.158Z", "defect": ""}, {"serial": "2525010544", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.362Z", "defect": ""}, {"serial": "2525010640", "model": "Point Mobile", "status": "issued", "holder": "5708465", "shift": "Дневная", "issued_at": "2026-11-03T04:54:02.259Z", "last_move": "2026-11-03T04:54:02.259Z", "defect": ""}, {"serial": "2525010716", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-25T14:12:10.690Z", "defect": ""}, {"serial": "2525010744", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T16:03:12.182Z", "defect": ""}, {"serial": "2525011174", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.361Z", "defect": ""}, {"serial": "2525011176", "model": "Point Mobile", "status": "repair", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-24T11:35:47.792Z", "defect": "Требуется диагностика / замена АКБ"}, {"serial": "2525011185", "model": "Point Mobile", "status": "repair", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.362Z", "defect": "Требуется диагностика / замена АКБ"}, {"serial": "2525011194", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T13:57:06.250Z", "defect": ""}, {"serial": "2525011212", "model": "Point Mobile", "status": "issued", "holder": "6021958", "shift": "Дневная", "issued_at": "2026-11-03T05:06:51.836Z", "last_move": "2026-11-03T05:06:51.836Z", "defect": ""}, {"serial": "2525015024", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-09T16:48:13.254Z", "defect": ""}, {"serial": "2525020542", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-30T08:17:45.993Z", "defect": ""}, {"serial": "2525020612", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T07:48:19.459Z", "defect": ""}, {"serial": "2525020700", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-30T15:53:43.463Z", "defect": ""}, {"serial": "2525110740", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T16:03:07.848Z", "defect": ""}, {"serial": "2525111098", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T04:08:17.313Z", "defect": ""}, {"serial": "2525410429", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-01T14:49:19.811Z", "defect": ""}, {"serial": "2525410547", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-01T16:56:40.694Z", "defect": ""}, {"serial": "2525510028", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T01:45:20.337Z", "defect": ""}, {"serial": "2525510030", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-24T09:10:09.158Z", "defect": ""}, {"serial": "2525510040", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T03:04:59.002Z", "defect": ""}, {"serial": "2525610875", "model": "Point Mobile", "status": "repair", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.360Z", "defect": "Требуется диагностика / замена АКБ"}, {"serial": "2525620734", "model": "Point Mobile", "status": "issued", "holder": "6418036", "shift": "Дневная", "issued_at": "2026-11-03T05:14:54.642Z", "last_move": "2026-11-03T05:14:54.642Z", "defect": ""}, {"serial": "2525621001", "model": "Point Mobile", "status": "issued", "holder": "6504925", "shift": "Дневная", "issued_at": "2026-11-03T04:42:28.265Z", "last_move": "2026-11-03T04:42:28.265Z", "defect": ""}, {"serial": "2525621047", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T16:49:11.264Z", "defect": ""}, {"serial": "2525710131", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-17T03:53:16.782Z", "defect": ""}, {"serial": "2525710344", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:35.360Z", "defect": ""}, {"serial": "2525710397", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-01T16:49:13.592Z", "defect": ""}, {"serial": "5219088", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-26T14:08:20.560Z", "defect": ""}, {"serial": "6049653", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-31T04:47:59.338Z", "defect": ""}, {"serial": "760809", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-24T16:29:42.622Z", "defect": ""}, {"serial": "88BCAC01DA34", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T04:08:18.768Z", "defect": ""}, {"serial": "88BCAC01DA35", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-31T14:58:48.048Z", "defect": ""}, {"serial": "88BCAC02056B", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-27T11:34:59.752Z", "defect": ""}, {"serial": "88BCAC026C83", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T15:28:42.672Z", "defect": ""}, {"serial": "88BCAC02716B", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-28T03:50:12.056Z", "defect": ""}, {"serial": "88BCAC027263", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-27T15:37:09.627Z", "defect": ""}, {"serial": "88BCAC027264", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T17:07:02.079Z", "defect": ""}, {"serial": "88BCAC027328", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-29T14:54:05.255Z", "defect": ""}, {"serial": "C81CFE97FB7C", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T13:58:58.207Z", "defect": ""}, {"serial": "C81CFE980759", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-28T03:55:32.467Z", "defect": ""}, {"serial": "C81CFED1B416", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-30T13:32:37.485Z", "defect": ""}, {"serial": "C81CFED1B48C", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-27T14:36:36.200Z", "defect": ""}, {"serial": "C81CFED1BBB2", "model": "Point Mobile", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T02:41:44.248Z", "defect": ""}, {"serial": "S23074523022062", "model": "Zebra RS5100", "status": "issued", "holder": "6494887", "shift": "Дневная", "issued_at": "2026-11-03T04:47:10.059Z", "last_move": "2026-11-03T04:47:10.059Z", "defect": ""}, {"serial": "S23075523022193", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T08:55:10.339Z", "defect": ""}, {"serial": "S23076523022863", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T03:52:11.686Z", "defect": ""}, {"serial": "S23077523021968", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-01T17:24:33.840Z", "defect": ""}, {"serial": "S23078523020318", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-29T14:42:08.263Z", "defect": ""}, {"serial": "S23079523021281", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T01:23:24.611Z", "defect": ""}, {"serial": "S23080523022246", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.152Z", "defect": ""}, {"serial": "S23081523021602", "model": "Zebra RS5100", "status": "issued", "holder": "5157848", "shift": "Дневная", "issued_at": "2026-11-03T03:50:10.542Z", "last_move": "2026-11-03T03:50:10.542Z", "defect": ""}, {"serial": "S24184523022440", "model": "Zebra RS5100", "status": "issued", "holder": "5614697", "shift": "Дневная", "issued_at": "2026-11-03T03:41:19.076Z", "last_move": "2026-11-03T03:41:19.076Z", "defect": ""}, {"serial": "S24184523022490", "model": "Zebra RS5100", "status": "issued", "holder": "1514241", "shift": "Дневная", "issued_at": "2026-11-03T03:12:45.736Z", "last_move": "2026-11-03T03:12:45.736Z", "defect": ""}, {"serial": "S24185523020463", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T03:20:05.902Z", "defect": ""}, {"serial": "S24185523020687", "model": "Zebra RS5100", "status": "issued", "holder": "514238", "shift": "Дневная", "issued_at": "2026-11-03T03:19:53.499Z", "last_move": "2026-11-03T03:19:53.499Z", "defect": ""}, {"serial": "S24185523021845", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T05:06:15.659Z", "defect": ""}, {"serial": "S24186523020660", "model": "Zebra RS5100", "status": "issued", "holder": "515993", "shift": "Дневная", "issued_at": "2026-11-03T02:53:32.703Z", "last_move": "2026-11-03T02:53:32.703Z", "defect": ""}, {"serial": "S24186523020949", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-01T15:25:44.735Z", "defect": ""}, {"serial": "S24186523023341", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T15:32:34.861Z", "defect": ""}, {"serial": "S24187523020574", "model": "Zebra RS5100", "status": "issued", "holder": "1070240", "shift": "Ночная", "issued_at": "2026-11-03T01:40:24.467Z", "last_move": "2026-11-03T01:40:24.467Z", "defect": ""}, {"serial": "S24187523023314", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T15:28:40.804Z", "defect": ""}, {"serial": "S24216523022456", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.152Z", "defect": ""}, {"serial": "S24219523020537", "model": "Zebra RS5100", "status": "issued", "holder": "1282640", "shift": "Дневная", "issued_at": "2026-11-03T04:11:26.404Z", "last_move": "2026-11-03T04:11:26.404Z", "defect": ""}, {"serial": "S24219523022430", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-31T15:46:20.809Z", "defect": ""}, {"serial": "S24220523026419", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-30T15:49:47.879Z", "defect": ""}, {"serial": "S24221523020043", "model": "Zebra RS5100", "status": "issued", "holder": "805884", "shift": "Дневная", "issued_at": "2026-11-03T04:41:19.397Z", "last_move": "2026-11-03T04:41:19.397Z", "defect": ""}, {"serial": "S24221523020051", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.152Z", "defect": ""}, {"serial": "S24221523020052", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-21T13:42:33.062Z", "defect": ""}, {"serial": "S24221523020070", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.152Z", "defect": ""}, {"serial": "S24221523020076", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-23T17:17:21.595Z", "defect": ""}, {"serial": "S24221523020103", "model": "Zebra RS5100", "status": "issued", "holder": "511140", "shift": "Дневная", "issued_at": "2026-11-03T04:09:48.029Z", "last_move": "2026-11-03T04:09:48.029Z", "defect": ""}, {"serial": "S24221523020124", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-22T05:51:04.945Z", "defect": ""}, {"serial": "S24221523020131", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-14T11:13:00.632Z", "defect": ""}, {"serial": "S24221523020135", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-24T10:31:29.967Z", "defect": ""}, {"serial": "S24221523020139", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T05:40:36.672Z", "defect": ""}, {"serial": "S24221523020173", "model": "Zebra RS5100", "status": "issued", "holder": "6446216", "shift": "Дневная", "issued_at": "2026-11-03T04:13:40.641Z", "last_move": "2026-11-03T04:13:40.641Z", "defect": ""}, {"serial": "S24221523020174", "model": "Zebra RS5100", "status": "issued", "holder": "1282614", "shift": "Дневная", "issued_at": "2026-11-03T04:15:11.719Z", "last_move": "2026-11-03T04:15:11.719Z", "defect": ""}, {"serial": "S2422152302019", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-07T15:15:11.230Z", "defect": ""}, {"serial": "S24221523020196", "model": "Zebra RS5100", "status": "issued", "holder": "798369", "shift": "Дневная", "issued_at": "2026-11-03T04:47:27.527Z", "last_move": "2026-11-03T04:47:27.527Z", "defect": ""}, {"serial": "S24224523020196", "model": "Zebra RS5100", "status": "issued", "holder": "6463120", "shift": "Дневная", "issued_at": "2026-11-03T04:37:31.114Z", "last_move": "2026-11-03T04:37:31.114Z", "defect": ""}, {"serial": "S24224523020282", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T05:40:37.620Z", "defect": ""}, {"serial": "S24224523020288", "model": "Zebra RS5100", "status": "issued", "holder": "6234799", "shift": "Дневная", "issued_at": "2026-11-03T04:10:48.559Z", "last_move": "2026-11-03T04:10:48.559Z", "defect": ""}, {"serial": "S24224523020319", "model": "Zebra RS5100", "status": "issued", "holder": "2419593", "shift": "Дневная", "issued_at": "2026-11-03T03:50:18.820Z", "last_move": "2026-11-03T03:50:18.820Z", "defect": ""}, {"serial": "S24224523020376", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.153Z", "defect": ""}, {"serial": "S24224523020388", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.152Z", "defect": ""}, {"serial": "S24224523020393", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T17:05:23.193Z", "defect": ""}, {"serial": "S24225523021852", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.152Z", "defect": ""}, {"serial": "S24226523020286", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.152Z", "defect": ""}, {"serial": "S24226523020339", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-14T15:28:01.670Z", "defect": ""}, {"serial": "S24226523020344", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-17T21:11:41.795Z", "defect": ""}, {"serial": "S24226523020395", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-31T13:27:38.612Z", "defect": ""}, {"serial": "S24226523020406", "model": "Zebra RS5100", "status": "issued", "holder": "5070968", "shift": "Дневная", "issued_at": "2026-11-03T04:09:37.576Z", "last_move": "2026-11-03T04:09:37.576Z", "defect": ""}, {"serial": "S24226523020419", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.151Z", "defect": ""}, {"serial": "S24226523020431", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.152Z", "defect": ""}, {"serial": "S24232523020661", "model": "Zebra RS5100", "status": "issued", "holder": "6204571", "shift": "Дневная", "issued_at": "2026-11-03T04:36:20.763Z", "last_move": "2026-11-03T04:36:20.763Z", "defect": ""}, {"serial": "S24232523020720", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-03T05:40:37.131Z", "defect": ""}, {"serial": "S24232523020743", "model": "Zebra RS5100", "status": "issued", "holder": "1334754", "shift": "Дневная", "issued_at": "2026-11-03T04:52:56.501Z", "last_move": "2026-11-03T04:52:56.501Z", "defect": ""}, {"serial": "S24232523020845", "model": "Zebra RS5100", "status": "issued", "holder": "5874801", "shift": "Дневная", "issued_at": "2026-11-03T04:58:52.167Z", "last_move": "2026-11-03T04:58:52.167Z", "defect": ""}, {"serial": "S24232523020920", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.152Z", "defect": ""}, {"serial": "S24232523020954", "model": "Zebra RS5100", "status": "issued", "holder": "646484", "shift": "Дневная", "issued_at": "2026-11-03T03:15:45.533Z", "last_move": "2026-11-03T03:15:45.533Z", "defect": ""}, {"serial": "S24233523020052", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.152Z", "defect": ""}, {"serial": "S24233523020178", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.152Z", "defect": ""}, {"serial": "S24233523020580", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.152Z", "defect": ""}, {"serial": "S24233523020635", "model": "Zebra RS5100", "status": "issued", "holder": "680649", "shift": "Ночная", "issued_at": "2026-11-02T16:44:55.710Z", "last_move": "2026-11-02T16:44:55.710Z", "defect": ""}, {"serial": "S24233523020668", "model": "Zebra RS5100", "status": "issued", "holder": "961726", "shift": "Дневная", "issued_at": "2026-11-03T04:36:30.074Z", "last_move": "2026-11-03T04:36:30.074Z", "defect": ""}, {"serial": "S24233523020765", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-02T13:35:07.227Z", "defect": ""}, {"serial": "S24233523020783", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-30T18:05:02.895Z", "defect": ""}, {"serial": "S24233523020786", "model": "Zebra RS5100", "status": "issued", "holder": "5620178", "shift": "Дневная", "issued_at": "2026-11-03T04:31:02.191Z", "last_move": "2026-11-03T04:31:02.191Z", "defect": ""}, {"serial": "S24233523020816", "model": "Zebra RS5100", "status": "issued", "holder": "868177", "shift": "Дневная", "issued_at": "2026-11-03T04:08:32.848Z", "last_move": "2026-11-03T04:08:32.848Z", "defect": ""}, {"serial": "S24233523020817", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-31T16:10:58.476Z", "defect": ""}, {"serial": "S24233523020819", "model": "Zebra RS5100", "status": "issued", "holder": "5856903", "shift": "Дневная", "issued_at": "2026-11-03T04:08:46.756Z", "last_move": "2026-11-03T04:08:46.756Z", "defect": ""}, {"serial": "S24233523020881", "model": "Zebra RS5100", "status": "issued", "holder": "1334765", "shift": "Дневная", "issued_at": "2026-11-03T04:39:55.582Z", "last_move": "2026-11-03T04:39:55.582Z", "defect": ""}, {"serial": "S24233523020903", "model": "Zebra RS5100", "status": "issued", "holder": "1645727", "shift": "Дневная", "issued_at": "2026-11-03T04:45:22.476Z", "last_move": "2026-11-03T04:45:22.476Z", "defect": ""}, {"serial": "S24233523020904", "model": "Zebra RS5100", "status": "issued", "holder": "5438599", "shift": "Дневная", "issued_at": "2026-11-03T03:55:32.809Z", "last_move": "2026-11-03T03:55:32.809Z", "defect": ""}, {"serial": "S24233523020914", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "Дневная", "issued_at": null, "last_move": "2026-10-06T12:25:56.841Z", "defect": ""}, {"serial": "S24233523020931", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.152Z", "defect": ""}, {"serial": "S24233523020939", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-11-01T04:52:22.214Z", "defect": ""}, {"serial": "S24233523020958", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-06T08:24:48.152Z", "defect": ""}, {"serial": "S24233523020968", "model": "Zebra RS5100", "status": "free", "holder": "", "shift": "—", "issued_at": null, "last_move": "2026-10-31T03:45:52.505Z", "defect": ""}];
const DEBUG = false;
function dbg(...args) { if (DEBUG) console.log('[DBG]', ...args); }

const state = {
  devices: [],
  filter: 'all',
  modelFilter: 'all',
  sortField: 'default',
  sortAsc: true,
  theme: 'berry',
  rightMode: 'return', // 'return' | 'defect'
  issueShift: 'Дневная',
  issueShiftAuto: true,
  workerShifts: {},
  repairMap: {}, // sn -> defect reason
  syncing: false,
  dbReady: false,
  lastError: '—',
  pendingSwap: null,
  justIssued: null,
  justReturned: null,
  fastDeskMode: 'issue',
  undoAction: null,
  undoTimer: null,
  toastTimer: null,
  flashTimer: null,
  auditSn: null,
  lastDropQuery: null,
  lastRetDropQuery: null,
  syncToken: 0,
  syncBackoff: 0,
  issDropNavigated: false,
  opLock: false, // Глобальный мьютекс активной транзакции
  debtorsRegistry: {},
  debtorsRecorded: {},
  alertedDebtors: {},
  justOverdueHighlights: {},
  debtAlertDismissedUntil: 0,
  lastDebtAlertInfo: null,
  sessionOut: 0,
  sessionIn: 0,
  sessionRep: 0,
  recentEvents: []
};

try { const st = localStorage.getItem(THEME_STORAGE_KEY); if (st && THEMES.includes(st)) state.theme = st; } catch(e) {}
try { state.workerShifts = JSON.parse(localStorage.getItem('sklad_worker_shifts') || '{}'); } catch(e) {}
try { state.repairMap = JSON.parse(localStorage.getItem(REPAIR_MAP_KEY) || '{}'); } catch(e) {}
try { state.debtorsRegistry = JSON.parse(localStorage.getItem(DEBT_REGISTRY_KEY) || '{}'); } catch(e) {}
try { state.debtorsRecorded = JSON.parse(localStorage.getItem(DEBT_RECORDED_KEY) || '{}'); } catch(e) {}
try { state.alertedDebtors = JSON.parse(localStorage.getItem(ALERTED_DEBTORS_KEY) || '{}'); } catch(e) {}
try { state.debtAlertDismissedUntil = parseInt(localStorage.getItem(DEBT_ALERT_DISMISSED_KEY) || '0', 10) || 0; } catch(e) {}

const recentLocal = new Map();
const opCooldownMap = new Map(); // sn -> timestamp защиты от двойного пика сканера
const $ = id => document.getElementById(id);
const nowIso = () => new Date().toISOString();

/* ===== ЗАЩИТА ОТ ДВОЙНОГО ПИКА СКАНЕРА (COOLDOWN LOCK) ===== */
function isSerialInCooldown(sn) {
  if (!sn) return false;
  const key = String(sn).toUpperCase();
  const last = opCooldownMap.get(key) || 0;
  if (Date.now() - last < OP_COOLDOWN_MS) return true;
  opCooldownMap.set(key, Date.now());
  return false;
}

function saveRepairMap() {
  try { localStorage.setItem(REPAIR_MAP_KEY, JSON.stringify(state.repairMap)); } catch(e) {}
}

/* ===== КАСТОМНОЕ МОДАЛЬНОЕ ОКНО ПОДТВЕРЖДЕНИЯ (ВМЕСТО BLOCKED CONFIRM) ===== */
let confirmDialogResolver = null;
function askConfirmDialog(title, message, okLabel = 'Подтвердить (Enter)') {
  return new Promise(resolve => {
    confirmDialogResolver = resolve;
    $('confirmDialogTitle').innerText = title || 'Подтверждение';
    $('confirmDialogMessage').innerText = message || '';
    $('confirmDialogOkBtn').innerText = okLabel;
    openModal('confirmDialogModal');
    setTimeout(() => $('confirmDialogOkBtn')?.focus(), 50);
  });
}
function resolveConfirmDialog(result) {
  closeModal('confirmDialogModal');
  if (confirmDialogResolver) {
    const fn = confirmDialogResolver;
    confirmDialogResolver = null;
    fn(result);
  }
}

/* ===== ТЕМЫ ОФОРМЛЕНИЯ ===== */
function applyTheme(themeName, notify = false) {
  const t = THEMES.includes(themeName) ? themeName : 'berry';
  state.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  const meta = $('metaThemeColor');
  if (meta) meta.setAttribute('content', THEME_META_COLORS[t] || '#07040e');
  document.querySelectorAll('[data-set-theme]').forEach(btn => btn.classList.toggle('active', btn.dataset.setTheme === t));
  try { localStorage.setItem(THEME_STORAGE_KEY, t); } catch(e) {}
  if (notify) showToast('СТИЛЬ ИНТЕРФЕЙСА', THEME_NAMES[t]);
}
function cycleTheme() {
  const i = THEMES.indexOf(state.theme);
  applyTheme(THEMES[(i + 1) % THEMES.length], true);
}
applyTheme(state.theme, false);

/* ===== ПОЛНОЭКРАННАЯ ИНДИКАЦИЯ ("В ОДИН ПИК") И ТИКЕР ===== */
function triggerScanFlash(kind = 'ok') {
  const ov = $('scanFlashOverlay');
  if (!ov) return;
  ov.className = 'scan-flash-overlay ' + (kind === 'err' ? 'flash-err' : (kind === 'warn' ? 'flash-warn' : 'flash-ok'));
  clearTimeout(state.flashTimer);
  state.flashTimer = setTimeout(() => {
    ov.className = 'scan-flash-overlay';
  }, kind === 'err' ? 650 : 380);
}

function pushTickerEvent(kind, sn, worker) {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  state.recentEvents.unshift({ kind, sn, worker: worker || 'Склад', t });
  if (state.recentEvents.length > 5) state.recentEvents.pop();
  if (kind === 't-iss' || kind === 't-swp') state.sessionOut++;
  else if (kind === 't-ret') state.sessionIn++;
  else if (kind === 't-rep') state.sessionRep++;
  renderTicker();
}

function renderTicker() {
  const sEl = $('sessionStats');
  if (sEl) sEl.innerText = `Сессия: 📤 ${state.sessionOut} · 📥 ${state.sessionIn} · 🛠 ${state.sessionRep}`;
  const wrap = $('liveTicker');
  if (!wrap || !state.recentEvents.length) return;
  wrap.innerHTML = state.recentEvents.map(ev => {
    const icon = ev.kind === 't-ret' ? '📥' : (ev.kind === 't-swp' ? '🔄' : (ev.kind === 't-rep' ? '🛠' : '📤'));
    return `<span class="ticker-chip ${ev.kind}" data-ticker-sn="${esc(ev.sn)}" title="Клик — открыть досье сканера ${esc(ev.sn)}">${icon} <b>${esc(ev.sn.slice(-4))}</b> · ${esc(ev.worker)} <span style="opacity:0.68;">${ev.t}</span></span>`;
  }).join('');
}

/* ===== КОПИРОВАНИЕ СВОДКИ В БУФЕР ОБМЕНА (С FALLBACK) ===== */
function copyTextSafe(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopyText(text));
  }
  return Promise.resolve(fallbackCopyText(text));
}
function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(ta);
}

function copyTelegramSummary() {
  let free = 0, issued = 0, repair = 0, overdue = 0, dayCount = 0, nightCount = 0;
  const debts = [];
  state.devices.forEach(d => {
    if (d.status === 'issued') {
      issued++;
      const h = hoursSince(d.issued_at);
      if (h >= OVERDUE_H) { overdue++; debts.push({ sn: d.serial, holder: d.holder, h }); }
      if (d.shift === 'Ночная') nightCount++; else dayCount++;
    } else if (d.status === 'repair') {
      repair++;
    } else {
      free++;
    }
  });
  const dt = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const lines = [
    `📊 СВОДКА ПАРКА СКАНЕРОВ СЦ (${dt} • ${state.issueShift})`,
    `📦 Всего сканеров в парке: ${state.devices.length} шт.`,
    `🟢 Свободно в резерве: ${free} шт.`,
    `⚡ На руках (в смене): ${issued} шт. (☀️ День: ${dayCount} | 🌙 Ночь: ${nightCount})`,
    `🛠 В ремонте / браке: ${repair} шт.`,
    `🚨 Просрочено (>14ч): ${overdue} шт.`
  ];
  debts.sort((a, b) => b.h - a.h).slice(0, 15).forEach(x => {
    lines.push(`  • ${x.sn} — ${x.holder} (${fmtHoursShort(x.h)})`);
  });
  copyTextSafe(lines.join('\n')).then(
    () => showToast('📋 СВОДКА СКОПИРОВАНА', 'Отчёт по парку сканеров готов к отправке руководству'),
    () => showToast('ОШИБКА', 'Не удалось скопировать сводку', 'err')
  );
}

/* ===== УТИЛИТЫ И РАСПОЗНАВАНИЕ ТОЛЬКО СКАНЕРОВ ===== */
function esc(s) {
  return String(s !== null && s !== undefined ? s : '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`⏱ Таймаут: ${label} (${ms}мс)`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
function pluralN(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

const RU = { 'й':'q','ц':'w','у':'e','к':'r','е':'t','н':'y','г':'u','ш':'i','щ':'o','з':'p','х':'[','ъ':']','ф':'a','ы':'s','в':'d','а':'f','п':'g','р':'h','о':'j','л':'k','д':'l','ж':';','э':'\'','я':'z','ч':'x','с':'c','м':'v','и':'b','т':'n','ь':'m','б':',','ю':'.','ё':'`' };
function fixLayout(s) {
  return String(s ? s : '').split('').map(ch => {
    const lo = ch.toLowerCase();
    return RU[lo] !== undefined ? RU[lo] : ch;
  }).join('').toUpperCase().replace(/\s+/g, '');
}
function hasCyr(s) { return /[а-яёА-ЯЁ]/.test(String(s || '')); }

// СТРОГО ТОЛЬКО СКАНЕРЫ: Zebra RS5100 или Point Mobile (без планшетов, раций и рохлей)
function detectScannerModel(sn, rawModel) {
  const s = String(sn || '').toUpperCase().trim();
  const m = String(rawModel || '').toUpperCase().trim();
  if (s.startsWith('S') || m.includes('ZEBRA') || m.includes('RS5100') || m.includes('RS6000')) {
    return 'Zebra RS5100';
  }
  return 'Point Mobile';
}

function formatSnSplit(sn) {
  const s = String(sn || '');
  if (s.length <= 4) return `<span class="sn-tail">${esc(s)}</span>`;
  return `<span class="sn-prefix">${esc(s.slice(0, -4))}</span><span class="sn-tail">${esc(s.slice(-4))}</span>`;
}
function getInitials(h) {
  const s = String(h || '').trim();
  if (!s) return '•';
  const l = s.match(/[А-ЯЁA-Z]/gi);
  if (l && l.length >= 2) return (l[0] + l[1]).toUpperCase();
  return s.slice(-2).toUpperCase();
}
function hoursSince(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (isNaN(t)) return 0;
  return Math.max(0, (Date.now() - t) / 3600000);
}
function parseTime(v) {
  if (!v) return 0;
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}
function fmtHoursShort(h) {
  if (!isFinite(h) || h < 0) return '—';
  const m = Math.round(h * 60), H = Math.floor(m / 60), M = m % 60;
  if (H === 0) return M + 'м';
  if (M === 0) return H + 'ч';
  return H + 'ч ' + M + 'м';
}
function timeClass(h) {
  if (!isFinite(h)) return 'fresh';
  if (h >= OVERDUE_H) return 'over';
  if (h >= 8) return 'late';
  if (h >= 4) return 'mid';
  return 'fresh';
}
function timeBarWidth(h) {
  if (!isFinite(h) || h < 0) return 3;
  return Math.max(3, Math.min(100, (h / OVERDUE_H) * 100));
}
function isInheritedTime(d) {
  if (!d || d.status !== 'issued' || !d.issued_at || !d.last_move) return false;
  const t1 = Date.parse(d.last_move), t2 = Date.parse(d.issued_at);
  if (isNaN(t1) || isNaN(t2)) return false;
  return Math.abs(t1 - t2) > 60 * 1000;
}
function logMsg(msg) {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const el = $('logStatus');
  if (el) el.textContent = `[${t}] ${msg}`;
}

function hideBoot() {
  const el = $('bootOverlay');
  if (!el) return;
  el.classList.add('hide');
  setTimeout(() => { try { el.remove(); } catch(e) {} }, 450);
}
function bootText(txt) {
  const el = $('bootText');
  if (el) el.textContent = txt;
}
function refreshScrollLock() {
  const anyModal = document.querySelector('.modal-overlay.show');
  const drawer = $('auditDrawer') && $('auditDrawer').classList.contains('open');
  document.body.classList.toggle('no-scroll', !!(anyModal || drawer));
}

/* ===== АВТОФОКУС КОНВЕЙЕРА (SMART FOCUS GUARD) ===== */
function focusActiveTerminalInput() {
  const anyModal = document.querySelector('.modal-overlay.show');
  const drawer = $('auditDrawer') && $('auditDrawer').classList.contains('open');
  if (anyModal || drawer) return;
  if (state.rightMode === 'defect' && document.activeElement === $('defReason')) return;
  const wVal = $('issWorker')?.value.trim() || '';
  if (!wVal) {
    $('issWorker')?.focus();
  } else {
    $('issSn')?.focus();
  }
}

/* ===== ОТМЕНА ПОСЛЕДНЕГО ДЕЙСТВИЯ (CTRL+Z) ===== */
function setUndo(label, cb, ttl = 7000) {
  state.undoAction = { label, callback: cb, ttl };
  clearTimeout(state.undoTimer);
  state.undoTimer = setTimeout(() => {
    state.undoAction = null;
    const el = $('toast');
    const b = el?.querySelector('.t-undo');
    if (b) b.remove();
  }, ttl);
}
function clearUndo() {
  state.undoAction = null;
  clearTimeout(state.undoTimer);
  state.undoTimer = null;
  const el = $('toast');
  if (!el) return;
  const b = el.querySelector('.t-undo');
  if (b) b.remove();
}
async function undoLast() {
  if (state.undoAction && state.undoAction.callback) {
    const cb = state.undoAction.callback;
    clearUndo();
    await cb();
    return true;
  }
  return false;
}

function showUndoToast(title, desc, undoLabel, undoCallback, kind = 'ok') {
  clearUndo();
  const el = $('toast');
  $('tTitle').innerText = title;
  $('tDesc').innerText = desc || '';
  $('tIcon').innerText = kind === 'swap' ? '🔁' : (kind === 'warn' ? '🛠' : '✓');
  $('tIcon').style.background = '';
  $('tIcon').style.borderColor = '';
  $('tIcon').style.color = '';
  $('tTitle').style.color = '';
  const oldBtn = el.querySelector('.t-undo');
  if (oldBtn) oldBtn.remove();
  if (undoCallback) {
    const btn = document.createElement('button');
    btn.className = 't-undo';
    btn.innerText = undoLabel || '↩ Отменить (Ctrl+Z)';
    btn.onclick = () => undoLast();
    el.appendChild(btn);
    setUndo(undoLabel, undoCallback, 7000);
  }
  el.className = kind === 'warn' ? 'warn' : '';
  el.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      const b = el.querySelector('.t-undo');
      if (b) b.remove();
    }, 400);
  }, 6500);
}

/* ===== УМНОЕ УПРАВЛЕНИЕ СМЕНАМИ ===== */
function computeSmartShift(worker) {
  const now = new Date();
  const hm = now.getHours() * 60 + now.getMinutes();
  const w = String(worker || '').trim().toUpperCase();
  if (w) {
    const ex = state.devices.find(d => d.status === 'issued' && d.holder && d.holder.toUpperCase() === w && d.shift && d.shift !== '—');
    if (ex) return ex.shift;
    if (state.workerShifts[w]) return state.workerShifts[w];
  }
  if (hm >= 5 * 60 && hm < 6 * 60) return 'Дневная';
  if (hm >= 17 * 60 && hm < 19 * 60) return 'Ночная';
  return (hm >= 6 * 60 && hm < 18 * 60) ? 'Дневная' : 'Ночная';
}
function updateShiftPill() {
  const pill = $('shiftPill');
  if (!pill) return;
  const isDay = state.issueShift === 'Дневная';
  pill.className = 'shift-pill ' + (isDay ? 'day' : 'night') + (state.issueShiftAuto ? '' : ' manual');
  $('shiftIcon').innerText = isDay ? '☀' : '🌙';
  $('shiftLabel').innerText = isDay ? 'ДЕНЬ' : 'НОЧЬ';
  const badge = $('shiftBadge');
  if (state.issueShiftAuto) {
    badge.className = 'badge-auto';
    badge.innerText = 'AUTO';
  } else {
    badge.className = 'badge-manual';
    badge.innerText = 'РУЧН ↻';
  }
  const now = new Date();
  $('shiftTime').innerText = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
}
function saveShiftPref() {
  try { localStorage.setItem('sklad_shift_pref', JSON.stringify({ auto: state.issueShiftAuto, shift: state.issueShift })); } catch(e) {}
}
function toggleShift() {
  if (state.issueShiftAuto) {
    state.issueShift = state.issueShift === 'Дневная' ? 'Ночная' : 'Дневная';
    state.issueShiftAuto = false;
    saveShiftPref();
    updateShiftPill();
    showToast('РУЧНОЙ РЕЖИМ СМЕНЫ', `Смена зафиксирована: ${state.issueShift}`, 'warn');
  } else {
    state.issueShiftAuto = true;
    state.issueShift = computeSmartShift($('issWorker').value.trim());
    saveShiftPref();
    updateShiftPill();
    showToast('АВТОРЕЖИМ СМЕНЫ', 'Смена определяется автоматически по времени', 'warn');
  }
}
function resetShiftToAuto(e) {
  if (e) e.stopPropagation();
  state.issueShiftAuto = true;
  state.issueShift = computeSmartShift($('issWorker').value.trim());
  saveShiftPref();
  updateShiftPill();
  showToast('АВТОРЕЖИМ СМЕНЫ', 'Смена определяется автоматически', 'warn');
}
function refreshSmartShift() {
  if (!state.issueShiftAuto) { updateShiftPill(); return; }
  const w = $('issWorker').value.trim();
  const s = computeSmartShift(w);
  if (s !== state.issueShift) state.issueShift = s;
  updateShiftPill();
}
function rememberWorkerShift(worker, shift) {
  if (!worker) return;
  const key = String(worker).trim().toUpperCase();
  state.workerShifts[key] = shift;
  const keys = Object.keys(state.workerShifts);
  if (keys.length > 500) delete state.workerShifts[keys[0]];
  try { localStorage.setItem('sklad_worker_shifts', JSON.stringify(state.workerShifts)); } catch(e) {}
}
async function toggleDeviceShift(sn) {
  const dev = state.devices.find(d => d.serial === sn);
  if (!dev || dev.status !== 'issued') {
    showToast('НЕДОСТУПНО', 'Сканер не на руках — смена не назначена', 'warn');
    return;
  }
  const oldShift = dev.shift;
  const newShift = oldShift === 'Ночная' ? 'Дневная' : 'Ночная';
  const ts = nowIso();
  const updated = { ...dev, shift: newShift, last_move: ts };
  const idx = state.devices.findIndex(d => d.serial === sn);
  const snapshot = { ...dev };
  if (idx >= 0) state.devices[idx] = updated;
  renderTable();
  try {
    await saveDevice(updated, `Смена вручную: ${oldShift || '—'} → ${newShift}`, dev.holder);
    rememberWorkerShift(dev.holder, newShift);
    beep('issue');
    showToast('СМЕНА ОБНОВЛЕНА', `${sn}: ${oldShift || '—'} → ${newShift} (${dev.holder})`);
    logMsg(`🔀 СМЕНА: ${sn} · ${oldShift || '—'} → ${newShift} · ${dev.holder}`);
    if (state.auditSn === sn) openAudit(sn);
  } catch(e) {
    if (idx >= 0) state.devices[idx] = snapshot;
    renderTable();
    beep('err');
    showToast('ОШИБКА', e.message || 'Не удалось сохранить', 'err');
  }
}

/* ===== АУДИО- И ВИБРО-ИНДИКАЦИЯ ОПЕРАТОРА ===== */
let audioCtx = null;
function beep(type) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    if (type === 'return') {
      const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      osc.connect(g); g.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(580, t);
      osc.frequency.exponentialRampToValueAtTime(1180, t + 0.14);
      g.gain.setValueAtTime(0.18, t);
      g.gain.linearRampToValueAtTime(0.01, t + 0.17);
      osc.start(t); osc.stop(t + 0.17);
    } else if (type === 'issue') {
      const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      osc.connect(g); g.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(1320, t + 0.11);
      g.gain.setValueAtTime(0.15, t);
      g.gain.linearRampToValueAtTime(0.01, t + 0.13);
      osc.start(t); osc.stop(t + 0.13);
    } else if (type === 'swap') {
      const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      osc.connect(g); g.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.linearRampToValueAtTime(1120, t + 0.19);
      g.gain.setValueAtTime(0.16, t);
      g.gain.linearRampToValueAtTime(0.01, t + 0.21);
      osc.start(t); osc.stop(t + 0.21);
    } else if (type === 'debt' || type === 'err') {
      for (let i = 0; i < 2; i++) {
        const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain();
        o2.connect(g2); g2.connect(audioCtx.destination);
        o2.type = 'sawtooth';
        o2.frequency.setValueAtTime(220, t + i * 0.14);
        g2.gain.setValueAtTime(0.20, t + i * 0.14);
        g2.gain.linearRampToValueAtTime(0.01, t + i * 0.14 + 0.12);
        o2.start(t + i * 0.14); o2.stop(t + i * 0.14 + 0.12);
      }
    }
  } catch(e) {}
  try {
    if (navigator.vibrate) {
      navigator.vibrate(type === 'err' ? [80, 40, 80] : (type === 'debt' ? [100, 50, 100] : 35));
    }
  } catch(e) {}
}

/* ===== БАЗА ДАННЫХ INDEXEDDB ⇄ SUPABASE (БЕЗ ГОНОК И ДУБЛЕЙ) ===== */
let cloud = null;
try {
  if (typeof supabase !== 'undefined' && supabase.createClient) {
    cloud = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });
  }
} catch(e) {}

let db = null;
const DB_REQ = indexedDB.open("SkladDB", 3);
DB_REQ.onupgradeneeded = e => {
  const d = e.target.result;
  if (!d.objectStoreNames.contains("devices")) d.createObjectStore("devices", { keyPath: "serial" });
  if (!d.objectStoreNames.contains("queue")) d.createObjectStore("queue", { autoIncrement: true });
  if (!d.objectStoreNames.contains("moves")) d.createObjectStore("moves", { autoIncrement: true });
};
DB_REQ.onblocked = () => showToast('БАЗА ЗАНЯТА', 'Закройте дублирующие вкладки браузера', 'warn');
DB_REQ.onsuccess = async e => {
  db = e.target.result;
  state.dbReady = true;
  bootText('Загрузка парка сканеров…');
  await loadLocal();
  if (state.devices.length === 0 && Array.isArray(INITIAL_SCANNER_FLEET) && INITIAL_SCANNER_FLEET.length > 0) {
    await seedInitialFleetIfEmpty();
  }
  await rotateMovesIfNeeded();
  hideBoot();
  restoreDraft();
  scheduleSync(600);
  setTimeout(() => checkAutoBackup(), 6000);
};
DB_REQ.onerror = e => {
  state.dbReady = false;
  bootText('Переход в автономный режим памяти…');
  state.devices = (INITIAL_SCANNER_FLEET || []).map(normalizeCloudDevice).filter(Boolean);
  renderTable();
  setTimeout(hideBoot, 600);
};

async function seedInitialFleetIfEmpty() {
  if (!db) return;
  try {
    await new Promise(resolve => {
      const t = db.transaction("devices", "readwrite");
      const s = t.objectStore("devices");
      INITIAL_SCANNER_FLEET.forEach(raw => {
        const d = normalizeCloudDevice(raw);
        if (d) {
          if (raw.status === 'repair') {
            d.status = 'repair';
            d.defect = raw.defect || 'Требуется диагностика';
            state.repairMap[d.serial] = d.defect;
          }
          s.put(d);
        }
      });
      t.oncomplete = () => resolve();
      t.onerror = () => resolve();
      t.onabort = () => resolve();
    });
    saveRepairMap();
    await loadLocal();
    logMsg(`📦 Загружен базовый парк сканеров: ${state.devices.length} шт.`);
  } catch(e) { dbg('seed error', e); }
}

function loadLocal() {
  return new Promise(resolve => {
    if (!db) return resolve();
    try {
      const tx = db.transaction("devices", "readonly");
      const req = tx.objectStore("devices").getAll();
      req.onsuccess = () => {
        const rawList = req.result || [];
        // Применяем фильтр: только сканеры + восстанавливаем статус ремонта из локального реестра брака
        state.devices = rawList.map(d => {
          const cleanModel = detectScannerModel(d.serial, d.model);
          const isRep = d.status === 'repair' || Boolean(state.repairMap[d.serial]);
          const st = d.status === 'issued' ? 'issued' : (isRep ? 'repair' : 'free');
          return {
            ...d,
            model: cleanModel,
            status: st,
            defect: st === 'repair' ? (d.defect || state.repairMap[d.serial] || 'На диагностике') : ''
          };
        });
        renderTable();
        updateIssBanner(fixLayout($('issSn')?.value || ''));
        setTimeout(() => { checkDebtors(); alertNewDebtors(); }, 80);
        resolve();
      };
      req.onerror = () => { state.devices = []; renderTable(); resolve(); };
      tx.onabort = () => { state.devices = []; renderTable(); resolve(); };
    } catch(e) { state.devices = []; renderTable(); resolve(); }
  });
}

async function rotateMovesIfNeeded() {
  try {
    const count = await new Promise(r => {
      const t = db.transaction('moves', 'readonly');
      const req = t.objectStore('moves').count();
      req.onsuccess = () => r(req.result || 0);
      req.onerror = () => r(0);
      t.onabort = () => r(0);
    });
    if (count <= MOVES_ROTATE_THRESHOLD) return;
    const toDelete = count - MOVES_ROTATE_KEEP;
    if (toDelete <= 0) return;
    await new Promise(r => {
      const t = db.transaction('moves', 'readwrite');
      const s = t.objectStore('moves');
      let deleted = 0;
      const req = s.openCursor();
      req.onsuccess = e => {
        const cur = e.target.result;
        if (cur && deleted < toDelete) { cur.delete(); deleted++; cur.continue(); }
      };
      t.oncomplete = () => r(); t.onerror = () => r(); t.onabort = () => r();
    });
  } catch(e) {}
}

/* ===== АТОМАРНОЕ СОХРАНЕНИЕ С КОАЛЕСЦЕНЦИЕЙ ОЧЕРЕДИ (БЕЗ ДУБЛЕЙ) ===== */
function saveDevice(dev, actionName, workerName) {
  return new Promise((resolve, reject) => {
    if (!dev || !dev.serial) return reject(new Error('Не указан серийный номер сканера'));
    if (!db || !state.dbReady) {
      return reject(new Error('Локальная база недоступна. Выдача, возврат и изменение статуса временно заблокированы.'));
    }
    dev.model = detectScannerModel(dev.serial, dev.model);

    try {
      const ts = dev.last_move || nowIso();
      const moveId = (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
        ? crypto.randomUUID()
        : `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
      const t = db.transaction(["devices", "queue", "moves"], "readwrite");
      const devStore = t.objectStore("devices");
      const qStore = t.objectStore("queue");
      const mStore = t.objectStore("moves");

      devStore.put(dev);

      // Состояние сканера можно объединять: оставляем только последнее upsert.
      // События истории хранятся отдельно и никогда не удаляются этой коалесценцией.
      const qCursorReq = qStore.openCursor();
      qCursorReq.onsuccess = e => {
        const cur = e.target.result;
        if (cur) {
          const val = cur.value;
          if (val && val.type === 'upsert' && val.dev && val.dev.serial === dev.serial) {
            cur.delete();
          }
          cur.continue();
        } else {
          qStore.add({ type: 'upsert', dev: dev, ts, movementQueued: true });
          qStore.add({
            type: 'movement',
            moveId,
            serial: dev.serial,
            action: actionName,
            worker: workerName || '',
            ts
          });
        }
      };

      mStore.add({ serial: dev.serial, action: actionName, worker: workerName || '', created_at: ts, moveId });

      t.oncomplete = () => {
        if (dev.status === 'repair') {
          state.repairMap[dev.serial] = dev.defect || 'Неисправен';
          saveRepairMap();
        } else if (state.repairMap[dev.serial]) {
          delete state.repairMap[dev.serial];
          saveRepairMap();
        }
        recentLocal.set(dev.serial, Date.now());
        if (recentLocal.size > 300) {
          const cutoff = Date.now() - RECENT_LOCAL_TTL;
          for (const [k, v] of recentLocal) if (v < cutoff) recentLocal.delete(k);
        }
        loadLocal().then(() => { scheduleSync(150); resolve(); }).catch(() => { scheduleSync(150); resolve(); });
      };
      t.onerror = () => reject(t.error || new Error('Ошибка записи в локальную БД'));
      t.onabort = () => reject(t.error || new Error('Транзакция записи прервана'));
    } catch(e) { reject(e); }
  });
}

function readQueueWithKeys() {
  return new Promise((resolve, reject) => {
    if (!db || !state.dbReady) {
      return reject(new Error('Локальная база недоступна: очередь не прочитана'));
    }
    try {
      const t = db.transaction('queue', 'readonly');
      const s = t.objectStore('queue');
      const out = [];
      const req = s.openCursor();
      req.onsuccess = e => {
        const cur = e.target.result;
        if (cur) { out.push({ key: cur.primaryKey, value: cur.value }); cur.continue(); }
        else resolve(out);
      };
      req.onerror = () => reject(req.error || new Error('Не удалось прочитать очередь синхронизации'));
      t.onabort = () => reject(t.error || new Error('Чтение очереди прервано'));
      t.onerror = () => reject(t.error || new Error('Ошибка чтения очереди синхронизации'));
    } catch(e) { reject(e); }
  });
}

function deleteQueueKey(key) {
  return new Promise((resolve, reject) => {
    if (!db || !state.dbReady) {
      return reject(new Error('Локальная база недоступна: пакет не удалён из очереди'));
    }
    try {
      const t = db.transaction('queue', 'readwrite');
      t.objectStore('queue').delete(key);
      t.oncomplete = resolve;
      t.onerror = () => reject(t.error || new Error('Не удалось удалить пакет из очереди'));
      t.onabort = () => reject(t.error || new Error('Удаление пакета из очереди прервано'));
    } catch(e) { reject(e); }
  });
}

async function deleteSerial(sn) {
  if (!sn) throw new Error('Пустой серийный номер');
  delete state.repairMap[sn];
  saveRepairMap();
  if (!db) {
    state.devices = state.devices.filter(d => d.serial !== sn);
    renderTable();
    return;
  }
  const { queueKeys, moveKeys } = await new Promise((resolve, reject) => {
    const t = db.transaction(['queue', 'moves'], 'readonly');
    const qKeys = [], mKeys = [];
    t.objectStore('queue').openCursor().onsuccess = e => {
      const cur = e.target.result;
      if (cur) {
        const v = cur.value;
        if (v && v.type !== 'delete' && v.type !== 'movement' && ((v.dev && v.dev.serial === sn) || (v.serial === sn && !v.dev))) qKeys.push(cur.primaryKey);
        cur.continue();
      }
    };
    t.objectStore('moves').openCursor().onsuccess = e => {
      const cur = e.target.result;
      if (cur) {
        if (cur.value && cur.value.serial === sn) mKeys.push(cur.primaryKey);
        cur.continue();
      }
    };
    t.oncomplete = () => resolve({ queueKeys: qKeys, moveKeys: mKeys });
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Транзакция чтения отменена'));
  });
  await new Promise((resolve, reject) => {
    const t = db.transaction(['devices', 'queue', 'moves'], 'readwrite');
    t.objectStore('devices').delete(sn);
    const qs = t.objectStore('queue'); queueKeys.forEach(k => qs.delete(k));
    const ms = t.objectStore('moves'); moveKeys.forEach(k => ms.delete(k));
    qs.add({ type: 'delete', serial: sn, ts: nowIso() });
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Транзакция удаления отменена'));
  });
  recentLocal.delete(sn);
  await loadLocal();
  scheduleSync(150);
  logMsg(`🗑 СКАНЕР УДАЛЁН: ${sn}`);
}

/* ===== КОНТРОЛЬ ДОЛЖНИКОВ (>14 ЧАСОВ) ===== */
function saveDebtStorage() {
  try {
    localStorage.setItem(DEBT_REGISTRY_KEY, JSON.stringify(state.debtorsRegistry));
    localStorage.setItem(DEBT_RECORDED_KEY, JSON.stringify(state.debtorsRecorded));
    localStorage.setItem(ALERTED_DEBTORS_KEY, JSON.stringify(state.alertedDebtors));
  } catch(e) {}
}

function checkDebtors() {
  let changed = false;
  state.devices.forEach(d => {
    if (d.status !== 'issued' || !d.holder || !d.issued_at) return;
    if (hoursSince(d.issued_at) < OVERDUE_H) return;
    const holderNorm = d.holder.trim().toUpperCase();
    const key = `${holderNorm}|${d.serial}|${d.issued_at}`;
    if (state.debtorsRecorded[key]) return;
    state.debtorsRecorded[key] = nowIso();
    if (!state.debtorsRegistry[holderNorm]) {
      state.debtorsRegistry[holderNorm] = { name: d.holder.trim(), count: 0, lastDate: null, serials: [] };
    }
    const reg = state.debtorsRegistry[holderNorm];
    reg.name = d.holder.trim();
    reg.count++;
    reg.lastDate = nowIso();
    if (!reg.serials.includes(d.serial)) reg.serials.push(d.serial);
    changed = true;
  });
  if (changed) saveDebtStorage();
}

function alertNewDebtors() {
  const fresh = [];
  state.devices.forEach(d => {
    if (d.status !== 'issued' || !d.holder || !d.issued_at) return;
    if (hoursSince(d.issued_at) < OVERDUE_H) return;
    const alertKey = `${d.serial}|${d.issued_at}`;
    if (state.alertedDebtors[alertKey]) return;
    state.alertedDebtors[alertKey] = nowIso();
    fresh.push(d);
    state.justOverdueHighlights[d.serial] = Date.now();
  });

  if (!fresh.length) { updateDebtBadge(); return; }
  saveDebtStorage();
  beep('debt');

  const byWorker = {};
  fresh.forEach(d => {
    const k = d.holder.trim().toUpperCase();
    if (!byWorker[k]) byWorker[k] = { display: d.holder.trim(), list: [] };
    byWorker[k].list.push(d);
  });

  const workerKeys = Object.keys(byWorker);
  const namesList = workerKeys.map(k => `${byWorker[k].display} (${byWorker[k].list.length})`).join(', ');
  state.lastDebtAlertInfo = { namesList, total: fresh.length, workers: workerKeys.length, ts: Date.now() };
  if (Date.now() > state.debtAlertDismissedUntil) {
    showDebtAlertBar(state.lastDebtAlertInfo);
  }
  updateDebtBadge();
  renderTable();
  logMsg(`🚨 ПРОСРОЧКА >14Ч: ${fresh.length} сканеров · ${namesList}`);
}

function showDebtAlertBar(info) {
  const bar = $('debtAlertBar');
  if (!bar) return;
  $('debtAlertTitle').innerText = info.workers === 1 ? '🚨 Обнаружен должник по сканеру!' : `🚨 Обнаружено должников: ${info.workers}`;
  $('debtAlertText').innerText = `${info.namesList} · всего ${info.total} ${pluralN(info.total, 'сканер', 'сканера', 'сканеров')} >14ч`;
  bar.classList.add('show');
}

function dismissDebtAlert() {
  const bar = $('debtAlertBar');
  if (bar) bar.classList.remove('show');
  state.debtAlertDismissedUntil = Date.now() + 30 * 60 * 1000;
  try { localStorage.setItem(DEBT_ALERT_DISMISSED_KEY, String(state.debtAlertDismissedUntil)); } catch(e) {}
}

function updateDebtBadge() {
  const btn = $('debtBtn');
  const badge = $('debtBadge');
  if (!btn || !badge) return;
  const activeCount = state.devices.filter(d => d.status === 'issued' && hoursSince(d.issued_at) >= OVERDUE_H).length;
  if (activeCount > 0) {
    badge.innerText = activeCount > 99 ? '99+' : String(activeCount);
    badge.classList.add('show');
    btn.classList.add('has-debts');
  } else {
    badge.classList.remove('show');
    btn.classList.remove('has-debts');
    const bar = $('debtAlertBar');
    if (bar) bar.classList.remove('show');
  }
}

async function clearDebtHistory() {
  const ok = await askConfirmDialog(
    'Очистка истории нарушений',
    'Очистить всю накопленную историю просрочек?\nТекущие активные выдачи на руках затронуты не будут.',
    'Очистить историю'
  );
  if (!ok) return;
  state.debtorsRegistry = {};
  state.debtorsRecorded = {};
  state.alertedDebtors = {};
  saveDebtStorage();
  openDebtModal();
  showToast('ИСТОРИЯ ОЧИЩЕНА', 'Архив нарушений сброшен', 'warn');
}

/* ===== НОРМАЛИЗАЦИЯ И БЕЗОТКАЗНАЯ СИНХРОНИЗАЦИЯ SUPABASE ===== */
function normalizeCloudDevice(row) {
  if (!row) return null;
  const sn = row.serial || row.sn || row.serial_number || row.id;
  if (!sn) return null;
  const cleanSn = String(sn).trim();
  if (!/^[A-Za-z0-9\-_.]+$/.test(cleanSn)) return null;

  // Исключаем любые не-сканерные записи (если когда-то в облаке были планшеты/рохли/рации)
  const rawModelStr = String(row.model || '').toUpperCase();
  if (rawModelStr.includes('ПЛАНШЕТ') || rawModelStr.includes('РОХЛ') || rawModelStr.includes('РАЦИ')) {
    return null;
  }

  const rawHolder = String(row.holder || row.worker || '').trim();
  let status = 'free';
  const s = String(row.status || '').toLowerCase().trim();
  if (s === 'repair' || s === 'в ремонте' || s === 'брак' || state.repairMap[cleanSn]) {
    status = 'repair';
  } else if (s === 'issued' || s === 'на руках' || s === 'выдан' || s === 'в работе') {
    status = 'issued';
  } else if (s === 'free' || s === 'на складе' || s === 'свободен') {
    status = 'free';
  } else {
    status = rawHolder.length > 0 ? 'issued' : 'free';
  }

  const cleanHolder = status === 'issued' ? rawHolder : '';
  const issuedAt = status === 'issued' ? (row.issued_at || row.issue_date || null) : null;
  const lastMove = row.last_move || null;
  let shift = row.shift;
  if (!shift || shift === 'null' || shift === '') {
    if (status === 'issued' && issuedAt) {
      const h = new Date(issuedAt).getHours();
      shift = (h >= 6 && h < 18) ? 'Дневная' : 'Ночная';
    } else {
      shift = '—';
    }
  }
  return {
    serial: cleanSn,
    model: detectScannerModel(cleanSn, row.model),
    status,
    holder: cleanHolder,
    issued_at: issuedAt,
    last_move: lastMove,
    shift,
    defect: status === 'repair' ? (row.defect || state.repairMap[cleanSn] || 'На диагностике') : ''
  };
}

async function syncNow() {
  if (state.syncing) return false;
  if (!cloud || !navigator.onLine) {
    setSync(false, 'Офлайн (Локальная БД)');
    return false;
  }
  if (!state.dbReady) {
    setSync(false, 'БД инициализируется');
    return false;
  }
  const token = ++state.syncToken;
  state.syncing = true;
  setSync(true, 'Синхронизация…', true);
  const alive = () => token === state.syncToken;
  let anyFailure = false;
  const watchdog = setTimeout(() => {
    if (!alive()) return;
    state.syncing = false;
    state.lastError = 'Таймаут ответа облака (переход в офлайн-буфер)';
    setSync(false, 'Офлайн-буфер');
  }, SYNC_TIMEOUT_MS);

  try {
    const items = await readQueueWithKeys();
    if (!alive()) { clearTimeout(watchdog); return false; }
    const recentlySent = new Set();
    let failCount = 0;

    for (const item of items) {
      if (!alive()) { clearTimeout(watchdog); return false; }
      const it = item.value;
      const key = item.key;
      if (!it) { await deleteQueueKey(key); continue; }

      if (it.type === 'delete') {
        try {
          const { error: delDevErr } = await withTimeout(
            cloud.from('devices').delete().eq('serial', it.serial),
            NET_TIMEOUT_MS,
            `del ${it.serial}`
          );
          if (delDevErr) { state.lastError = 'del: ' + delDevErr.message; failCount++; continue; }
          try { await withTimeout(cloud.from('movements').delete().eq('serial', it.serial), NET_TIMEOUT_MS, 'del moves'); } catch(e) {}
          await deleteQueueKey(key);
        } catch(e) { state.lastError = 'del: ' + e.message; failCount++; }
        continue;
      }

      // Отдельная доставка события истории: событие удаляется из очереди
      // только после подтверждённого ответа Supabase без ошибки.
      if (it.type === 'movement') {
        const fullMove = {
          event_id: String(it.moveId || `legacy_${key}`),
          serial: it.serial,
          action: it.action,
          worker: it.worker || '',
          created_at: it.ts
        };
        try {
          const { error: moveErr } = await withTimeout(
            cloud.from('movements').insert(fullMove),
            NET_TIMEOUT_MS,
            `move ${fullMove.serial}`
          );
          if (moveErr) {
            // 23505 = event_id уже существует: событие ранее было успешно доставлено.
            if (moveErr.code === '23505') {
              await deleteQueueKey(key);
              continue;
            }
            state.lastError = 'movement: ' + moveErr.message;
            failCount++;
            continue;
          }
          await deleteQueueKey(key);
        } catch(e) {
          state.lastError = 'movement: ' + e.message;
          failCount++;
        }
        continue;
      }

      if (!it.dev || !it.dev.serial) { await deleteQueueKey(key); continue; }
      recentlySent.add(it.dev.serial);

      // Отправляем совместимую со схемой Supabase запись
      const cleanDev = {
        serial: it.dev.serial,
        model: detectScannerModel(it.dev.serial, it.dev.model),
        status: ['issued', 'repair'].includes(it.dev.status) ? it.dev.status : 'free',
        holder: it.dev.status === 'issued' ? (it.dev.holder || null) : null,
        shift: it.dev.status === 'issued' ? (it.dev.shift || null) : null,
        issued_at: it.dev.status === 'issued' ? it.dev.issued_at : null,
        last_move: it.dev.last_move || it.ts
      };

      if (!it.deviceUpserted) {
        try {
          const { error: devErr } = await withTimeout(
            cloud.from('devices').upsert(cleanDev, { onConflict: 'serial' }),
            NET_TIMEOUT_MS,
            `upsert ${cleanDev.serial}`
          );
          if (devErr) { state.lastError = 'upsert: ' + devErr.message; failCount++; continue; }
          it.deviceUpserted = true;
        } catch(e) { state.lastError = 'upsert: ' + e.message; failCount++; continue; }
      }

      // Совместимость со старыми пакетами очереди: у них ещё нет отдельного
      // movement-пакета. Новые upsert помечены movementQueued и историю отправляют отдельно.
      if (!it.movementQueued && it.action) {
        const fullMove = {
          serial: it.dev.serial,
          action: it.action,
          worker: it.worker || (it.dev.holder || ''),
          created_at: it.ts
        };
        try {
          const { error: moveErr } = await withTimeout(
            cloud.from('movements').insert(fullMove),
            NET_TIMEOUT_MS,
            `legacy move ${fullMove.serial}`
          );
          if (moveErr) {
            state.lastError = 'movement: ' + moveErr.message;
            failCount++;
            continue;
          }
        } catch(e) {
          state.lastError = 'movement: ' + e.message;
          failCount++;
          continue;
        }
      }

      await deleteQueueKey(key);
    }

    if (!alive()) { clearTimeout(watchdog); return false; }
    const allData = await pullAllDevices();
    if (!alive()) { clearTimeout(watchdog); return false; }
    if (allData === null) {
      setSync(false, 'Автономный режим');
      return false;
    }
    const norm = allData.map(normalizeCloudDevice).filter(Boolean);
    if (norm.length > 0) {
      await applyPull(norm, recentlySent);
    }
    if (!alive()) { clearTimeout(watchdog); return false; }
    setTimeout(() => { checkDebtors(); alertNewDebtors(); }, 80);
    anyFailure = failCount > 0;
    state.lastError = anyFailure ? `В очереди докачки: ${failCount}` : '—';
    setSync(true, anyFailure ? `Онлайн (очередь: ${failCount})` : 'Онлайн • Синхронизировано');
    return !anyFailure;
  } catch(e) {
    if (alive()) {
      state.lastError = e.message || 'Обрыв сети';
      setSync(false, 'Офлайн (автодокачка)');
    }
    return false;
  } finally {
    clearTimeout(watchdog);
    if (alive()) state.syncing = false;
  }
}

async function pullAllDevices() {
  const pageSize = 1000;
  let all = [];
  let from = 0;
  try {
    while (true) {
      const { data, error } = await withTimeout(
        cloud.from('devices').select('*').range(from, from + pageSize - 1),
        NET_TIMEOUT_MS,
        'pull devices'
      );
      if (error) { state.lastError = error.message; return null; }
      if (!data || !data.length) break;
      all = all.concat(data);
      if (data.length < pageSize) break;
      from += pageSize;
      if (from > 500000) break;
    }
    return all;
  } catch(e) { state.lastError = e.message; return null; }
}

async function applyPull(data, protectedSerials) {
  if (!data || !db) return;
  const queuedSerials = await new Promise(r => {
    const t = db.transaction('queue', 'readonly');
    const set = new Set();
    const req = t.objectStore('queue').openCursor();
    req.onsuccess = e => {
      const cur = e.target.result;
      if (cur) {
        const v = cur.value;
        if (v && v.dev && v.dev.serial) set.add(v.dev.serial);
        else if (v && v.serial) set.add(v.serial);
        cur.continue();
      } else r(set);
    };
    req.onerror = () => r(set); t.onabort = () => r(set); t.onerror = () => r(set);
  });

  const cloudSet = new Set(data.map(d => d.serial));
  const now = Date.now();
  const localMap = new Map();
  await new Promise(r => {
    try {
      const t = db.transaction('devices', 'readonly');
      const req = t.objectStore('devices').openCursor();
      req.onsuccess = e => {
        const cur = e.target.result;
        if (cur) { localMap.set(cur.value.serial, cur.value); cur.continue(); }
        else r();
      };
      req.onerror = () => r(); t.onabort = () => r(); t.onerror = () => r();
    } catch(e) { r(); }
  });

  return new Promise(resolve => {
    let settled = false;
    const done = () => { if (!settled) { settled = true; resolve(); } };
    try {
      const t = db.transaction("devices", "readwrite");
      const s = t.objectStore("devices");
      const keysReq = s.getAllKeys();
      keysReq.onsuccess = () => {
        try {
          const localKeys = keysReq.result || [];
          localKeys.forEach(sn => {
            if (cloudSet.has(sn)) return;
            if (queuedSerials.has(sn)) return;
            if (protectedSerials && protectedSerials.has(sn)) return;
            const recent = recentLocal.get(sn);
            if (recent && now - recent < RECENT_LOCAL_TTL) return;
            s.delete(sn);
          });
          data.forEach(d => {
            if (protectedSerials && protectedSerials.has(d.serial)) return;
            if (queuedSerials.has(d.serial)) return;
            const recent = recentLocal.get(d.serial);
            if (recent && now - recent < RECENT_LOCAL_TTL) return;
            const ex = localMap.get(d.serial);
            if (ex && ex.last_move && d.last_move) {
              const t1 = Date.parse(ex.last_move), t2 = Date.parse(d.last_move);
              if (!isNaN(t1) && !isNaN(t2) && t1 > t2) return;
            }
            if (state.repairMap[d.serial] && d.status !== 'issued') {
              d.status = 'repair';
              d.defect = state.repairMap[d.serial];
            }
            s.put(d);
          });
        } catch(e) { dbg('applyPull error', e); }
      };
      t.oncomplete = () => { loadLocal().then(done).catch(done); };
      t.onerror = () => done();
      t.onabort = () => done();
    } catch(e) { done(); }
  });
}

function setSync(ok, txt, busy = false) {
  const p = $('syncStatus');
  if (!p) return;
  p.className = 'pill-badge ' + (busy ? 'pill-busy' : (ok ? 'pill-online' : 'pill-offline'));
  $('syncText').innerText = txt;
}

let syncScheduledTimer = null;
function scheduleSync(delay) {
  clearTimeout(syncScheduledTimer);
  const d = typeof delay === 'number' ? delay : SYNC_BASE_INTERVAL;
  syncScheduledTimer = setTimeout(async () => {
    const ok = await syncNow();
    if (ok) {
      state.syncBackoff = 0;
      scheduleSync(SYNC_BASE_INTERVAL);
    } else {
      const exp = Math.min(state.syncBackoff + 1, 5);
      const base = Math.min(SYNC_BASE_INTERVAL * Math.pow(2, exp), SYNC_MAX_INTERVAL);
      const jitter = base * SYNC_JITTER * (Math.random() * 2 - 1);
      state.syncBackoff = exp;
      scheduleSync(Math.max(SYNC_BASE_INTERVAL, base + jitter));
    }
  }, d);
}

async function forceSync() {
  closeModal('diagModal');
  state.syncToken++;
  state.syncing = false;
  state.syncBackoff = 0;
  await syncNow();
  scheduleSync(SYNC_BASE_INTERVAL);
}

async function clearStuckQueue() {
  let items;
  try {
    items = await readQueueWithKeys();
  } catch(e) {
    showToast('ОШИБКА ЧТЕНИЯ', e.message || 'Очередь не прочитана; данные не изменены', 'err');
    return;
  }
  if (!items.length) { showToast('ОЧЕРЕДЬ ПУСТА', 'Нет пакетов для очистки', 'warn'); return; }
  const ok = await askConfirmDialog(
    'Очистка очереди синхронизации',
    `Удалить неотправленные пакеты (${items.length} шт.) из очереди?\nЛокальная база и облако не пострадают.`,
    'Очистить очередь'
  );
  if (!ok) return;
  let deleted = 0;
  try {
    for (const item of items) {
      await deleteQueueKey(item.key);
      deleted++;
    }
  } catch(e) {
    showToast('ОЧИСТКА НЕ ЗАВЕРШЕНА', `Удалено: ${deleted} из ${items.length}. Остальные пакеты сохранены. ${e.message || ''}`, 'err');
    return;
  }
  showToast('ОЧЕРЕДЬ ОЧИЩЕНА', `Удалено пакетов: ${deleted}`, 'warn');
  closeModal('diagModal');
  setTimeout(() => scheduleSync(200), 200);
}

async function renderQueuePreview() {
  let items;
  try {
    items = await readQueueWithKeys();
  } catch(e) {
    return '<div style="color:var(--rose-text);padding:6px 0;">⚠ Не удалось прочитать очередь синхронизации. Состояние очереди неизвестно.</div>';
  }
  if (!items.length) return '<div style="color:var(--text-muted);padding:6px 0;">Очередь синхронизации пуста (все пакеты доставлены)</div>';
  return items.slice(0, 30).map(item => {
    const it = item.value || {};
    const type = it.type || 'upsert';
    const sn = (it.dev && it.dev.serial) || it.serial || '?';
    const action = it.action || type;
    const t = it.ts ? new Date(it.ts).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
    const color = type === 'delete' ? 'var(--rose-text)' : 'var(--brand-text)';
    return `<div style="font-size:11px;padding:3px 0;border-bottom:1px solid var(--card-border);display:flex;gap:8px;"><span style="color:${color};font-weight:700;">${esc(type)}</span><span style="color:var(--text-main);font-family:'JetBrains Mono';flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(sn)}</span><span style="color:var(--text-muted);font-size:10px;">${esc(action)}</span><span style="color:var(--text-muted);font-size:10px;">${t}</span></div>`;
  }).join('');
}

async function hardReset() {
  const ok = await askConfirmDialog(
    'Сброс локального кэша и перезагрузка парка',
    'Локальный кэш и очередь будут перезагружены из облака Supabase (или эталонного резерва СЦ).\nПродолжить?',
    'Выполнить сброс'
  );
  if (!ok) return;
  try {
    localStorage.removeItem(DRAFT_KEY);
    if (db) {
      const stores = ['devices', 'queue', 'moves'];
      const t = db.transaction(stores, 'readwrite');
      stores.forEach(s => t.objectStore(s).clear());
      await new Promise(r => { t.oncomplete = r; t.onerror = r; t.onabort = r; });
    }
    state.devices = [];
    recentLocal.clear();
    await seedInitialFleetIfEmpty();
    renderTable();
    showToast('КЭШ ПЕРЕЗАГРУЖЕН', 'Синхронизация с облаком…', 'warn');
    closeModal('diagModal');
    scheduleSync(300);
  } catch(e) { showToast('ОШИБКА', e.message, 'err'); }
}
/* ===== ОБЛАЧНЫЕ И ЛОКАЛЬНЫЕ БЭКАПЫ ПАРКА ===== */
async function checkAutoBackup() {
  if (!cloud || !navigator.onLine || !state.devices.length) return;
  try {
    const lastDate = localStorage.getItem('sklad_last_backup_date');
    const today = new Date().toISOString().slice(0, 10);
    if (lastDate === today) return;
    const lastTime = parseInt(localStorage.getItem('sklad_last_backup_time') || '0', 10);
    if (Date.now() - lastTime < BACKUP_MIN_INTERVAL) return;
    await doBackup('auto');
  } catch(e) {}
}

async function doBackup(trigger) {
  if (!state.devices.length) {
    if (trigger === 'manual') showToast('БЭКАП', 'Нет данных для сохранения', 'warn');
    return;
  }
  if (!cloud || !navigator.onLine) {
    if (trigger === 'manual') downloadJsonBackup();
    return;
  }
  try {
    const backup = {
      version: 10,
      created_at: nowIso(),
      total: state.devices.length,
      devices: state.devices.map(d => ({
        serial: d.serial,
        model: d.model,
        status: d.status,
        holder: d.holder,
        shift: d.shift,
        issued_at: d.issued_at,
        last_move: d.last_move,
        defect: d.defect || ''
      }))
    };
    const date = new Date().toISOString().slice(0, 10);
    const time = new Date().toISOString().slice(11, 16).replace(':', '');
    const filename = `backup-${date}-${time}.json`;
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const { error } = await withTimeout(
      cloud.storage.from(BACKUP_BUCKET).upload(filename, blob, { upsert: true, contentType: 'application/json' }),
      NET_TIMEOUT_MS,
      'backup upload'
    );
    if (error) throw error;
    try {
      localStorage.setItem('sklad_last_backup_date', date);
      localStorage.setItem('sklad_last_backup_time', String(Date.now()));
    } catch(e) {}
    logMsg(`💾 Облачный бэкап: ${filename} (${state.devices.length} сканеров)`);
    if (trigger === 'manual') {
      showToast('ОБЛАЧНЫЙ БЭКАП СОЗДАН', `${state.devices.length} сканеров → ${filename}`);
      renderBackupList();
    }
    await cleanupOldBackups();
  } catch(e) {
    const msg = e.message || '?';
    state.lastError = 'backup: ' + msg;
    if (trigger === 'manual') {
      downloadJsonBackup();
      showToast('ЛОКАЛЬНЫЙ БЭКАП СКАЧАН', 'Облако недоступно — сохранён JSON-файл на ПК', 'warn');
    }
  }
}

function downloadJsonBackup() {
  const backup = {
    version: 10,
    created_at: nowIso(),
    total: state.devices.length,
    devices: state.devices
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `sklad_scanners_backup_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast('JSON-БЭКАП СКАЧАН', `Сохранено ${state.devices.length} сканеров`);
}

async function cleanupOldBackups() {
  try {
    const { data, error } = await withTimeout(
      cloud.storage.from(BACKUP_BUCKET).list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } }),
      NET_TIMEOUT_MS,
      'backup list'
    );
    if (error || !data) return;
    const backups = data.filter(f => f.name.startsWith('backup-') && f.name.endsWith('.json')).sort((a, b) => b.name.localeCompare(a.name));
    if (backups.length <= BACKUP_KEEP) return;
    for (const f of backups.slice(BACKUP_KEEP)) {
      try { await withTimeout(cloud.storage.from(BACKUP_BUCKET).remove([f.name]), NET_TIMEOUT_MS, 'backup remove'); } catch(e) {}
    }
  } catch(e) {}
}

async function listBackups() {
  if (!cloud || !navigator.onLine) return [];
  try {
    const { data, error } = await withTimeout(
      cloud.storage.from(BACKUP_BUCKET).list('', { limit: 100, sortBy: { column: 'created_at', order: 'desc' } }),
      NET_TIMEOUT_MS,
      'backup list'
    );
    if (error || !data) return [];
    return data.filter(f => f.name.startsWith('backup-') && f.name.endsWith('.json')).sort((a, b) => b.name.localeCompare(a.name));
  } catch(e) { return []; }
}

async function renderBackupList() {
  const wrap = $('backupList');
  if (!wrap) return;
  wrap.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-sub);font-size:12px;">Загрузка списка копий…</div>';
  const files = await listBackups();
  if (!files.length) {
    wrap.innerHTML = '<div style="padding:26px 20px;text-align:center;color:var(--text-muted);font-size:12px;">Облачные копии не найдены или терминал в офлайн-режиме. Вы можете скачать JSON-копию на ПК кнопкой выше.</div>';
    return;
  }
  wrap.innerHTML = files.map(f => {
    const sizeKb = Math.max(1, Math.round((f.metadata?.size || 1024) / 1024));
    const date = new Date(f.created_at || f.updated_at || Date.now());
    const dateStr = date.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
    return `<div class="backup-row"><div class="backup-info"><div class="backup-name">${esc(f.name)}</div><div class="backup-meta">${dateStr} · ${sizeKb} КБ</div></div><div style="display:flex;gap:6px;"><button type="button" class="backup-btn-restore" data-bk-action="restore" data-bk-file="${esc(f.name)}">📥 Восстановить</button><button type="button" class="backup-btn-delete" data-bk-action="delete" data-bk-file="${esc(f.name)}">🗑</button></div></div>`;
  }).join('');
}

async function restoreFromBackup(filename) {
  if (!cloud) return;
  try {
    const { data, error } = await withTimeout(cloud.storage.from(BACKUP_BUCKET).download(filename), NET_TIMEOUT_MS, 'backup download');
    if (error) throw error;
    const text = await data.text();
    const backup = JSON.parse(text);
    const devices = (backup.devices || []).map(normalizeCloudDevice).filter(Boolean);
    if (!devices.length) throw new Error('Копия не содержит валидных сканеров');
    const ok = await askConfirmDialog(
      'Восстановление из резервной копии',
      `Восстановить парк из копии "${filename}" (${devices.length} сканеров)?\nТекущие данные будут синхронизированы с выбранным слепком.`,
      'Восстановить парк'
    );
    if (!ok) return;
    showToast('ВОССТАНОВЛЕНИЕ', 'Загрузка данных…', 'warn');
    if (db) {
      await new Promise((res, rej) => {
        const t = db.transaction(['devices', 'queue'], 'readwrite');
        t.objectStore('devices').clear();
        t.objectStore('queue').clear();
        t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
      await new Promise((res, rej) => {
        const t = db.transaction('devices', 'readwrite');
        const s = t.objectStore('devices');
        devices.forEach(d => { if (d && d.serial) s.put(d); });
        t.oncomplete = res; t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    }
    await loadLocal();
    closeModal('backupModal');
    showToast('ВОССТАНОВЛЕНО', `${devices.length} сканеров загружено`);
  } catch(e) { showToast('ОШИБКА', e.message || '?', 'err'); }
}

async function deleteBackup(filename) {
  const ok = await askConfirmDialog('Удаление бэкапа', `Удалить облачную копию "${filename}"?`, 'Удалить');
  if (!ok) return;
  try {
    const { error } = await withTimeout(cloud.storage.from(BACKUP_BUCKET).remove([filename]), NET_TIMEOUT_MS, 'backup remove');
    if (error) throw error;
    showToast('УДАЛЕНО', filename, 'warn');
    renderBackupList();
  } catch(e) { showToast('ОШИБКА', e.message || '?', 'err'); }
}

function openBackupModal() {
  openModal('backupModal');
  renderBackupList();
}

/* ===== ЧЕРНОВИКИ И СБРОС ФОРМЫ ===== */
function saveDraft() {
  try {
    const sn = $('issSn').value;
    const worker = $('issWorker').value;
    if (!sn && !worker) { localStorage.removeItem(DRAFT_KEY); return; }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ sn, worker, ts: Date.now() }));
  } catch(e) {}
}
function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || !d.ts || Date.now() - d.ts > DRAFT_TTL_MS) { localStorage.removeItem(DRAFT_KEY); return; }
    if (d.worker) $('issWorker').value = d.worker;
    if (d.sn) { $('issSn').value = d.sn; updateIssBanner(fixLayout(d.sn)); }
  } catch(e) {}
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch(e) {}
}
function clearAllInputsAndFocus() {
  $('issWorker').value = '';
  $('issSn').value = '';
  $('retQuery').value = '';
  $('defSn').value = '';
  $('issWorker').classList.remove('err');
  $('issSn').classList.remove('err', 'warn-busy');
  $('retQuery').classList.remove('err');
  resetIssueDropdown();
  resetRetDropdown();
  resetWorkerDropdown();
  updateIssBanner('');
  clearDraft();
  focusActiveTerminalInput();
}

function resetIssueDropdown() {
  const drop = $('issDrop');
  if (!drop) return;
  drop.classList.remove('show');
  drop.innerHTML = '';
  state.lastDropQuery = null;
}
function resetRetDropdown() {
  const drop = $('retDrop');
  if (!drop) return;
  drop.classList.remove('show');
  drop.innerHTML = '';
  state.lastRetDropQuery = null;
}
function resetWorkerDropdown() {
  const drop = $('workerDrop');
  if (drop) { drop.classList.remove('show'); drop.innerHTML = ''; }
}

/* ===== FAST DESK: ЕДИНЫЙ ПЕРЕКЛЮЧАТЕЛЬ ОПЕРАЦИЙ ===== */
function setFastDeskMode(mode, focus = true) {
  const next = ['issue', 'return', 'replace'].includes(mode) ? mode : 'issue';
  state.fastDeskMode = next;
  const issueDeck = $('issueDeck');
  const returnDeck = $('rightDeckCard');
  const bar = $('fastDeskModeBar');
  issueDeck.hidden = next === 'return';
  returnDeck.hidden = next !== 'return';
  $('fastDesk')?.classList.toggle('fastdesk-single', next !== 'return');
  bar?.querySelectorAll('[data-fast-mode]').forEach(button => {
    const active = button.dataset.fastMode === next;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  const isReplace = next === 'replace';
  $('modelHint').innerText = isReplace
    ? 'ЗАМЕНА • сначала бейдж сотрудника, затем новый сканер'
    : 'F1 • Бейдж сотрудника ➔ Сканер';
  $('btnIssue').innerText = isReplace
    ? 'ПРОВЕРИТЬ И ПОДТВЕРДИТЬ ЗАМЕНУ'
    : 'ВЫДАТЬ СКАНЕР В СМЕНУ';
  $('rightDeckCard').hidden = next !== 'return';
  if (next === 'return') {
    setRightMode('return');
  } else if (focus) {
    (isReplace ? $('issWorker') : $('issWorker'))?.focus();
  }
}

/* ===== ПЕРЕКЛЮЧЕНИЕ ПРИЁМКИ И РЕМОНТА В ПАНЕЛИ ВОЗВРАТА ===== */
function setRightMode(mode) {
  state.rightMode = mode === 'defect' ? 'defect' : 'return';
  const card = $('rightDeckCard');
  const titleEl = $('rightDeckTitle');
  const titleText = $('rightTitleText');
  const tabRet = $('tabModeReturn');
  const tabDef = $('tabModeDefect');
  const paneRet = $('returnPane');
  const paneDef = $('defectPane');

  if (state.rightMode === 'defect') {
    card.classList.add('defect-mode');
    titleEl.style.color = 'var(--amber-text)';
    titleText.innerText = 'ПЕРЕВОД СКАНЕРА В БРАК / РЕМОНТ';
    tabRet.className = 'mode-tab';
    tabDef.className = 'mode-tab active-def';
    paneRet.style.display = 'none';
    paneDef.style.display = 'flex';
    $('defSn')?.focus();
  } else {
    card.classList.remove('defect-mode');
    titleEl.style.color = 'var(--emerald-text)';
    titleText.innerText = 'ПРИЁМКА В 1 ПИК';
    tabRet.className = 'mode-tab active-ret';
    tabDef.className = 'mode-tab';
    paneRet.style.display = 'flex';
    paneDef.style.display = 'none';
    $('retQuery')?.focus();
  }
}

/* ===== LIVE-ИНДИКАЦИЯ СКАНЕРА ПРИ ВВОДЕ ===== */
function updateIssBanner(fixedQuery) {
  const banner = $('issSnBanner');
  const inp = $('issSn');
  if (!banner || !inp) return;
  const q = String(fixedQuery || '').trim().toUpperCase();
  if (q.length < 2) {
    banner.className = 'sn-live-banner';
    banner.innerHTML = '';
    inp.classList.remove('warn-busy');
    $('modelHint').innerText = "F1 • Бейдж ➔ Сканер ➔ Авто-выдача";
    return;
  }
  const exact = state.devices.find(d => d.serial.toUpperCase() === q);
  const tailMatches = state.devices.filter(d => d.serial.toUpperCase().endsWith(q));
  const target = exact || (tailMatches.length === 1 ? tailMatches[0] : null);
  if (target) {
    if (target.status === 'repair') {
      inp.classList.add('err');
      $('modelHint').innerText = `🛠 В РЕМОНТЕ (${target.model})`;
      banner.className = 'sn-live-banner show busy';
      banner.innerHTML = `<div><b>🛠 БЛОКИРОВКА:</b> Сканер <span class="mono">${esc(target.serial)}</span> числится в ремонте (${esc(target.defect || 'неисправен')})</div><button type="button" class="banner-btn-act" data-banner-restore="${esc(target.serial)}">✅ Вернуть в строй</button>`;
      return;
    }
    inp.classList.remove('err');
    if (target.status === 'issued') {
      const h = hoursSince(target.issued_at);
      const shIcon = target.shift === 'Ночная' ? '🌙' : '☀';
      inp.classList.add('warn-busy');
      $('modelHint').innerText = `🔴 НА РУКАХ: ${target.holder}`;
      banner.className = 'sn-live-banner show busy';
      const overdueMark = h >= OVERDUE_H ? ' <span style="color:var(--rose-text);font-weight:800;">🚨 ДОЛГ</span>' : '';
      banner.innerHTML = `<div><b>🔴 УЖЕ ЧИСЛИТСЯ:</b> <span class="mono">${esc(target.serial)}</span> за <b>👤 ${esc(target.holder)}</b> (${shIcon} ${esc(target.shift || '—')} • ${fmtHoursShort(h)})${overdueMark}</div><button type="button" class="banner-btn-act" data-banner-return="${esc(target.serial)}">📥 Принять в 1 клик</button>`;
    } else {
      inp.classList.remove('warn-busy');
      $('modelHint').innerText = `🟢 Свободен (${target.model})`;
      banner.className = 'sn-live-banner show free';
      banner.innerHTML = `<div><b>🟢 ГОТОВ К ВЫДАЧЕ:</b> Сканер <span class="mono">${esc(target.serial)}</span> (${esc(target.model)}) свободен в резерве</div>`;
    }
    return;
  }
  inp.classList.remove('warn-busy', 'err');
  if (tailMatches.length > 1) {
    const busyCount = tailMatches.filter(d => d.status === 'issued').length;
    $('modelHint').innerText = `Совпадений по хвосту: ${tailMatches.length}`;
    banner.className = 'sn-live-banner show new-sn';
    banner.innerHTML = `<div>🔎 Найдено <b>${tailMatches.length}</b> сканеров с хвостом «${esc(q)}» (свободно: ${tailMatches.length - busyCount}, на руках: ${busyCount})</div>`;
    return;
  }
  $('modelHint').innerText = `⚡ Новый сканер: ${detectScannerModel(q)}`;
  banner.className = 'sn-live-banner show new-sn';
  banner.innerHTML = `<div>⚡ Новое устройство: будет зарегистрирован сканер <b>${esc(q)}</b> (${esc(detectScannerModel(q))})</div>`;
}

function handleIssSnInput() {
  const el = $('issSn');
  const raw = el.value;
  const fixed = fixLayout(raw);
  if (fixed !== el.value) {
    if (hasCyr(raw)) logMsg(`🔧 Авто-раскладка ШК: "${raw}" ➔ "${fixed}"`);
    el.value = fixed;
  }
  updateIssBanner(fixed);
  const drop = $('issDrop');
  if (fixed.length < 2) { resetIssueDropdown(); return; }
  const allMatches = state.devices.filter(d => {
    const s = d.serial.toUpperCase();
    return s.endsWith(fixed) || s.includes(fixed);
  });
  if (!allMatches.length) { resetIssueDropdown(); state.lastDropQuery = fixed; return; }
  allMatches.sort((a, b) => {
    const sa = a.serial.toUpperCase(), sb = b.serial.toUpperCase();
    const aTail = sa.endsWith(fixed) ? 0 : 1;
    const bTail = sb.endsWith(fixed) ? 0 : 1;
    if (aTail !== bTail) return aTail - bTail;
    const aFree = a.status === 'free' ? 0 : 1;
    const bFree = b.status === 'free' ? 0 : 1;
    if (aFree !== bFree) return aFree - bFree;
    return sa.localeCompare(sb);
  });
  if (allMatches.length === 1 && allMatches[0].serial.toUpperCase() === fixed) {
    resetIssueDropdown();
    state.lastDropQuery = fixed;
    return;
  }
  drop.innerHTML = allMatches.slice(0, 8).map((d, i) => {
    let rightBadge = `<span style="font-size:10.5px;color:var(--emerald-text);font-weight:700;">🟢 В РЕЗЕРВЕ</span>`;
    if (d.status === 'issued') {
      rightBadge = `<span style="font-size:11px;color:var(--rose-text);font-weight:700;">🔴 У ${esc(d.holder)} (${fmtHoursShort(hoursSince(d.issued_at))})</span>`;
    } else if (d.status === 'repair') {
      rightBadge = `<span style="font-size:11px;color:var(--amber-text);font-weight:700;">🛠 В РЕМОНТЕ</span>`;
    }
    return `<div class="drop-item ${i === 0 ? 'selected' : ''}" data-sn="${esc(d.serial)}"><div><span class="mono" style="font-weight:700;">${formatSnSplit(d.serial)}</span><span style="color:var(--text-sub);font-size:11px;margin-left:6px;">(${esc(d.model)})</span></div>${rightBadge}</div>`;
  }).join('');
  drop.classList.add('show');
  state.lastDropQuery = fixed;
}

function showIssuePickModal(items) {
  $('issPickList').innerHTML = items.map((it, idx) => {
    const sn = it.dataset.sn;
    const dev = state.devices.find(d => d.serial === sn);
    const model = dev ? esc(dev.model) : '';
    let status = `<span style="font-size:11px;color:var(--emerald-text);font-weight:700;">🟢 В РЕЗЕРВЕ</span>`;
    if (dev && dev.status === 'issued') {
      status = `<span style="font-size:11px;color:var(--rose-text);font-weight:700;">🔴 НА РУКАХ: 👤 ${esc(dev.holder)}</span>`;
    } else if (dev && dev.status === 'repair') {
      status = `<span style="font-size:11px;color:var(--amber-text);font-weight:700;">🛠 В РЕМОНТЕ</span>`;
    }
    return `<div class="drop-item ${idx === 0 ? 'selected' : ''}" data-sn="${esc(sn)}" style="padding:11px 14px;"><div><span class="mono" style="font-weight:700;">${formatSnSplit(sn)}</span><span style="color:var(--text-sub);font-size:11px;margin-left:6px;">(${model})</span></div>${status}</div>`;
  }).join('');
  resetIssueDropdown();
  openModal('issPickModal');
}

/* ===== КОНВЕЙЕРНЫЙ AUTOSUBMIT («В ОДИН ПИК СКАНЕРА») ===== */
function handleIssWorkerKeydown(e) {
  const drop = $('workerDrop');
  const items = Array.from(drop.querySelectorAll('.drop-item'));
  const cur = items.findIndex(it => it.classList.contains('selected'));
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    if (drop.classList.contains('show') && cur >= 0 && items[cur]) {
      $('issWorker').value = items[cur].dataset.worker;
    }
    resetWorkerDropdown();
    const w = $('issWorker').value.trim();
    if (!w) {
      $('issWorker').classList.add('err');
      beep('err');
      triggerScanFlash('err');
      return;
    }
    $('issWorker').classList.remove('err');
    if (state.issueShiftAuto) refreshSmartShift();
    // Если серийник сканера уже отсканирован — мгновенно подтверждаем выдачу без лишнего нажатия!
    if ($('issSn').value.trim().length >= 2) {
      submitIssue();
    } else {
      $('issSn').focus();
    }
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return;
    e.preventDefault();
    if (cur >= 0) items[cur].classList.remove('selected');
    const next = cur < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : (e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length);
    items[next].classList.add('selected');
    items[next].scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Escape') resetWorkerDropdown();
}

function handleIssSnKeydown(e) {
  const el = $('issSn');
  const drop = $('issDrop');
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    handleIssSnInput();
    const curVal = fixLayout(el.value);
    const items = Array.from(drop.querySelectorAll('.drop-item'));
    const dropIsFresh = state.lastDropQuery !== null && state.lastDropQuery === curVal;
    const dropShown = drop.classList.contains('show');
    if (dropIsFresh && dropShown && items.length > 1) {
      if (state.issDropNavigated) {
        const cur = items.findIndex(it => it.classList.contains('selected'));
        if (cur >= 0 && items[cur]) el.value = items[cur].dataset.sn;
      } else {
        showIssuePickModal(items);
        return;
      }
    } else if (dropIsFresh && dropShown && items.length === 1) {
      el.value = items[0].dataset.sn;
    }
    resetIssueDropdown();
    updateIssBanner(fixLayout(el.value));
    // КОНВЕЙЕР: если бейдж сотрудника уже введён — автоматически оформляем выдачу!
    if ($('issWorker').value.trim().length > 0) {
      submitIssue();
    } else {
      $('issWorker').focus();
    }
    return;
  }
  const items = Array.from(drop.querySelectorAll('.drop-item'));
  const cur = items.findIndex(it => it.classList.contains('selected'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return;
    e.preventDefault();
    state.issDropNavigated = true;
    if (cur >= 0) items[cur].classList.remove('selected');
    const next = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
    items[next].classList.add('selected');
    items[next].scrollIntoView({ block: 'nearest' });
    updateIssBanner(items[next].dataset.sn);
    return;
  }
  if (e.key === 'Escape') resetIssueDropdown();
}

function handleWorkerInput() {
  const raw = $('issWorker').value.trim();
  // Если в поле бейджа случайно пикнули длинный серийный номер сканера (начинается с S24... или 10+ цифр из реестра),
  // автоматически переносим его в поле сканера!
  const fixedCandidate = fixLayout(raw);
  if (fixedCandidate.length >= 9 && state.devices.some(d => d.serial.toUpperCase() === fixedCandidate)) {
    $('issSn').value = fixedCandidate;
    $('issWorker').value = '';
    updateIssBanner(fixedCandidate);
    logMsg(`⚡ Умный роутинг: распознан штрихкод сканера ${fixedCandidate}, введите бейдж сотрудника`);
    $('issWorker').focus();
    return;
  }

  const q = raw.toUpperCase();
  const drop = $('workerDrop');
  if (q.length < 2) { resetWorkerDropdown(); return; }
  const workerSet = new Set();
  state.devices.forEach(d => { if (d.holder) workerSet.add(d.holder); });
  if (state.workerShifts) Object.keys(state.workerShifts).forEach(w => workerSet.add(w));
  const matches = Array.from(workerSet).filter(w => w.toUpperCase().includes(q) && w.toUpperCase() !== q).slice(0, 5);
  if (!matches.length) { resetWorkerDropdown(); return; }
  drop.innerHTML = matches.map(w => `<div class="drop-item" data-worker="${esc(w)}"><span style="font-weight:700;">👤 ${esc(w)}</span><span style="font-size:10px;color:var(--text-muted);">выбрать</span></div>`).join('');
  drop.classList.add('show');
}

/* ===== ВЫДАЧА СКАНЕРА С ЗАЩИТОЙ ОТ ОШИБОК ОПЕРАТОРА ===== */
async function submitIssue() {
  if (state.opLock) return;
  const rawSn = $('issSn').value.trim();
  const worker = $('issWorker').value.trim();
  $('issSn').classList.remove('err');
  $('issWorker').classList.remove('err');

  if (!worker) {
    $('issWorker').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    showToast('ОШИБКА: НЕТ БЕЙДЖА', 'Отсканируйте бейдж сотрудника', 'err');
    $('issWorker').focus();
    return;
  }
  if (!rawSn) {
    $('issSn').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    showToast('ОШИБКА: НЕТ СКАНЕРА', 'Отсканируйте штрихкод сканера', 'err');
    $('issSn').focus();
    return;
  }

  const cleanRaw = fixLayout(rawSn);
  if (!SN_REGEX.test(cleanRaw)) {
    $('issSn').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    showToast('НЕВЕРНЫЙ ШТРИХКОД', 'Допустимы символы A-Z, 0-9, дефис (2–60 знаков)', 'err');
    $('issSn').select();
    return;
  }

  const exactMatch = state.devices.find(d => d.serial.toUpperCase() === cleanRaw);
  const allTailMatches = state.devices.filter(d => d.serial.toUpperCase().endsWith(cleanRaw));
  let sn = cleanRaw;

  if (!exactMatch) {
    if (allTailMatches.length === 1) {
      sn = allTailMatches[0].serial;
    } else if (allTailMatches.length > 1) {
      $('issSn').classList.add('err');
      beep('err');
      triggerScanFlash('warn');
      const fakeItems = allTailMatches.map(d => ({ dataset: { sn: d.serial } }));
      showIssuePickModal(fakeItems);
      return;
    } else if (cleanRaw.length < 6) {
      // Короткий хвост не найден в базе — блокируем случайное создание фантомного сканера из 4 цифр!
      $('issSn').classList.add('err');
      beep('err');
      triggerScanFlash('err');
      showToast('ОШИБКА: СКАНЕР НЕ НАЙДЕН', `По хвосту «${cleanRaw}» нет сканера в парке. Отсканируйте полный ШК.`, 'err');
      $('issSn').select();
      return;
    }
  }

  // Анти-дребезг (защита от двойного пика сканера)
  if (isSerialInCooldown(sn)) {
    logMsg(`🛡 Анти-дубль: повторный пик ${sn} проигнорирован`);
    return;
  }

  const dev = state.devices.find(d => d.serial === sn);

  // Блокировка выдачи сканера, находящегося в ремонте / браке
  if (dev && dev.status === 'repair') {
    $('issSn').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    showToastWithAction(
      'ОШИБКА: УСТРОЙСТВО В РЕМОНТЕ',
      `Сканер ${sn} заблокирован (${dev.defect || 'неисправен'})`,
      '✅ Вернуть в строй и выдать',
      async () => {
        delete state.repairMap[sn];
        saveRepairMap();
        dev.status = 'free';
        dev.defect = '';
        await performIssue(sn, worker, dev, state.issueShiftAuto ? computeSmartShift(worker) : state.issueShift);
      },
      'err'
    );
    return;
  }

  // Блокировка выдачи, если сканер уже числится за сотрудником
  if (dev && dev.status === 'issued') {
    $('issSn').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    updateIssBanner(sn);
    if (dev.holder && dev.holder.toUpperCase() === worker.toUpperCase()) {
      showToastWithAction(
        'ОШИБКА: УЖЕ ЧИСЛИТСЯ ЗА ЭТИМ СОТРУДНИКОМ',
        `Сканер ${sn} уже выдан сотруднику ${dev.holder}`,
        '📥 Принять на склад',
        async () => {
          await doReturn(sn);
          clearAllInputsAndFocus();
        },
        'err'
      );
    } else {
      showToastWithAction(
        `ОШИБКА: УЖЕ ЧИСЛИТСЯ ЗА ${dev.holder}`,
        `Сканер ${sn} на руках у ${dev.holder} (${fmtHoursShort(hoursSince(dev.issued_at))})`,
        `🔄 Переоформить на ${worker}`,
        async () => {
          const shift = state.issueShiftAuto ? computeSmartShift(worker) : state.issueShift;
          await performIssue(sn, worker, dev, shift);
        },
        'err'
      );
    }
    return;
  }

  state.opLock = true;
  const btn = $('btnIssue');
  btn.classList.add('busy');

  try {
    let shift = state.issueShift;
    if (state.issueShiftAuto) shift = computeSmartShift(worker);

    const existingWorkerDev = state.devices.find(
      d => d.status === 'issued' && d.holder && d.holder.toUpperCase() === worker.toUpperCase()
    );

    if (existingWorkerDev && state.fastDeskMode !== 'replace') {
      showToastWithAction(
        'СОТРУДНИК УЖЕ ИМЕЕТ СКАНЕР',
        `За ${worker} уже числится ${existingWorkerDev.serial}. Для смены устройства используйте отдельный режим замены.`,
        'Перейти к замене',
        () => setFastDeskMode('replace'),
        'warn'
      );
      return;
    }

    if (state.fastDeskMode === 'replace' && !existingWorkerDev) {
      showToast('ЗАМЕНА НЕВОЗМОЖНА', 'За этим сотрудником сейчас не числится сканер. Используйте режим «Выдать».', 'err');
      $('issWorker').focus();
      return;
    }

    if (existingWorkerDev) {
      const pending = {
        worker,
        oldSn: existingWorkerDev.serial,
        newSn: sn,
        isNew: !dev,
        shift,
        originalIssuedAt: existingWorkerDev.issued_at,
        originalShift: existingWorkerDev.shift
      };
      // Замена всегда требует отдельного подтверждения оператора.
      state.pendingSwap = pending;
      const hoursOnHands = existingWorkerDev.issued_at ? hoursSince(existingWorkerDev.issued_at) : 0;
      $('swapWorker').innerText = worker;
      $('swapOldSn').innerText = existingWorkerDev.serial;
      $('swapOldModel').innerText = existingWorkerDev.model || '—';
      $('swapNewSn').innerText = sn;
      $('swapNewModel').innerText = dev ? dev.model : detectScannerModel(sn);
      $('swapInheritTime').innerText = fmtHoursShort(hoursOnHands);
      openModal('swapModal');
      setTimeout(() => $('swapConfirm').focus(), 60);
      return;
    }

    await performIssue(sn, worker, dev, shift);
  } catch(e) {
    beep('err');
    triggerScanFlash('err');
    showToast('ОШИБКА ВЫДАЧИ', e.message || 'Не удалось выполнить операцию', 'err');
    state.pendingSwap = null;
  } finally {
    state.opLock = false;
    btn.classList.remove('busy');
  }
}

async function performIssue(sn, worker, dev, shift, inheritedIssuedAt) {
  const isNew = !dev;
  const ts = nowIso();
  const issuedAt = inheritedIssuedAt || ts;
  const updated = {
    serial: sn,
    model: dev ? detectScannerModel(sn, dev.model) : detectScannerModel(sn),
    status: 'issued',
    holder: worker,
    issued_at: issuedAt,
    last_move: ts,
    shift,
    defect: ''
  };
  const oldSnapshot = dev ? JSON.parse(JSON.stringify(dev)) : null;
  const idx = state.devices.findIndex(d => d.serial === sn);
  if (idx >= 0) state.devices[idx] = updated;
  else state.devices.push(updated);

  state.justIssued = sn;
  renderTable();
  setTimeout(() => { state.justIssued = null; }, 2200);

  const actionName = inheritedIssuedAt
    ? (isNew ? 'Создан и выдан (время перенесено)' : 'Выдан (время перенесено)')
    : (isNew ? 'Создан и выдан' : 'Выдан');

  try {
    await saveDevice(updated, actionName, worker);
    rememberWorkerShift(worker, shift);
    beep('issue');
    triggerScanFlash('ok');
    pushTickerEvent('t-iss', sn, worker);
    showUndoToast(
      'ВЫДАНО В СМЕНУ',
      `Сканер ${sn} (${updated.model}) ➔ 👤 ${worker} (${shift})`,
      '↩ Отменить (Ctrl+Z)',
      async () => {
        try {
          if (isNew) await deleteSerial(sn);
          else await saveDevice({ ...oldSnapshot, last_move: nowIso() }, 'Отмена выдачи', worker);
          beep('return');
          showToast('ВЫДАЧА ОТМЕНЕНА', `Сканер ${sn} возвращён в резерв`);
        } catch(e) { showToast('ОШИБКА ОТМЕНЫ', e.message || '?', 'err'); }
      },
      'ok'
    );
    logMsg(`✅ ВЫДАНО: ${sn} ➔ ${worker} (${shift})`);
    clearDraft();
  } catch(e) {
    if (isNew) state.devices = state.devices.filter(d => d.serial !== sn);
    else if (idx >= 0) state.devices[idx] = dev;
    renderTable();
    throw e;
  }

  // Полный сброс и возврат фокуса на поле бейджа для следующего сотрудника в очереди!
  $('issSn').value = '';
  $('issWorker').value = '';
  resetIssueDropdown();
  resetWorkerDropdown();
  updateIssBanner('');
  state.issDropNavigated = false;
  if (state.issueShiftAuto) state.issueShift = computeSmartShift('');
  updateShiftPill();
  $('issWorker').focus();
}

async function confirmSwap() {
  const p = state.pendingSwap;
  if (!p) return;
  closeModal('swapModal');
  let snapshot = null;
  try {
    const oldDev = state.devices.find(d => d.serial === p.oldSn);
    const newDev = state.devices.find(d => d.serial === p.newSn);
    const ts = nowIso();
    const inheritedIssuedAt = p.originalIssuedAt || ts;
    snapshot = {
      oldDevSnapshot: oldDev ? JSON.parse(JSON.stringify(oldDev)) : null,
      newDevSnapshot: newDev ? JSON.parse(JSON.stringify(newDev)) : null,
      worker: p.worker,
      newSn: p.newSn,
      oldSn: p.oldSn
    };
    if (oldDev) {
      const oIdx = state.devices.findIndex(d => d.serial === p.oldSn);
      if (oIdx >= 0) state.devices[oIdx] = { ...oldDev, status: 'free', holder: '', shift: '—', issued_at: null, last_move: ts };
    }
    const nIdx = state.devices.findIndex(d => d.serial === p.newSn);
    const newRecord = {
      serial: p.newSn,
      model: newDev ? detectScannerModel(p.newSn, newDev.model) : detectScannerModel(p.newSn),
      status: 'issued',
      holder: p.worker,
      issued_at: inheritedIssuedAt,
      last_move: ts,
      shift: p.shift,
      defect: ''
    };
    if (nIdx >= 0) state.devices[nIdx] = newRecord;
    else state.devices.push(newRecord);
    renderTable();

    if (oldDev) {
      await saveDevice({ ...oldDev, status: 'free', holder: '', shift: '—', issued_at: null, last_move: ts }, 'Возврат (замена)', p.worker);
    }
    await saveDevice(newRecord, p.isNew ? 'Создан и выдан (замена)' : 'Выдача (замена)', p.worker);
    rememberWorkerShift(p.worker, p.shift);
    beep('swap');
    triggerScanFlash('ok');
    pushTickerEvent('t-swp', p.newSn, p.worker);
    const hoursOnHands = hoursSince(inheritedIssuedAt);
    showUndoToast(
      `ЗАМЕНА СКАНЕРА: ${p.oldSn.slice(-4)} ➔ ${p.newSn.slice(-4)}`,
      `Сотрудник ${p.worker} · старый принят, новый выдан`,
      '↩ Отменить (Ctrl+Z)',
      async () => {
        const t = nowIso();
        try {
          if (!snapshot.newDevSnapshot) await deleteSerial(snapshot.newSn);
          else await saveDevice({ ...snapshot.newDevSnapshot, last_move: t }, 'Отмена замены (новый)', snapshot.worker);
          if (snapshot.oldDevSnapshot) await saveDevice({ ...snapshot.oldDevSnapshot, last_move: t }, 'Отмена замены (старый)', snapshot.worker);
          beep('return');
          showToast('ЗАМЕНА ОТМЕНЕНА', 'Восстановлено прежнее состояние');
        } catch(e) { showToast('ОШИБКА', e.message || '?', 'err'); }
      },
      'swap'
    );
    logMsg(`🔄 ЗАМЕНА: ${p.oldSn} ➔ ${p.newSn} у ${p.worker}`);
    state.pendingSwap = null;
    $('issSn').value = '';
    $('issWorker').value = '';
    resetIssueDropdown();
    resetWorkerDropdown();
    updateIssBanner('');
    clearDraft();
    state.issDropNavigated = false;
    if (state.issueShiftAuto) state.issueShift = computeSmartShift('');
    updateShiftPill();
    $('issWorker').focus();
  } catch(e) {
    beep('err');
    triggerScanFlash('err');
    showToast('ОШИБКА ЗАМЕНЫ', e.message || '?', 'err');
    if (!db || !state.dbReady) {
      state.devices = state.devices.filter(d => d.serial !== p.newSn);
      if (snapshot?.oldDevSnapshot) {
        const oldIdx = state.devices.findIndex(d => d.serial === p.oldSn);
        if (oldIdx >= 0) state.devices[oldIdx] = snapshot.oldDevSnapshot;
        else state.devices.push(snapshot.oldDevSnapshot);
      }
      if (snapshot?.newDevSnapshot) {
        const newIdx = state.devices.findIndex(d => d.serial === p.newSn);
        if (newIdx >= 0) state.devices[newIdx] = snapshot.newDevSnapshot;
        else state.devices.push(snapshot.newDevSnapshot);
      }
      renderTable();
    } else {
      await loadLocal();
    }
    state.pendingSwap = null;
  }
}

function showToastWithAction(title, desc, actionLabel, actionCallback, kind = 'warn') {
  clearUndo();
  const el = $('toast');
  $('tTitle').innerText = title;
  $('tDesc').innerText = desc || '';
  $('tIcon').innerText = kind === 'err' ? '✕' : '!';
  $('tIcon').style.background = '';
  $('tIcon').style.borderColor = '';
  $('tIcon').style.color = '';
  $('tTitle').style.color = '';
  const oldBtn = el.querySelector('.t-undo');
  if (oldBtn) oldBtn.remove();
  const actBtn = document.createElement('button');
  actBtn.className = 't-undo';
  actBtn.innerText = actionLabel;
  actBtn.onclick = () => { el.classList.remove('show'); actionCallback(); };
  el.appendChild(actBtn);
  el.className = kind;
  el.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      const b = el.querySelector('.t-undo');
      if (b) b.remove();
    }, 400);
  }, 6000);
}
/* ===== БЫСТРАЯ ПРИЁМКА В 1 ШАГ И ПЕРЕВОД В БРАК / РЕМОНТ ===== */
function handleRetInput() {
  const el = $('retQuery');
  const raw = el.value;
  const hasDigits = /[0-9]/.test(raw);
  const hasCyrHere = hasCyr(raw);
  if (hasCyrHere && hasDigits) {
    const fixed = fixLayout(raw);
    if (fixed !== raw) el.value = fixed;
  }
  const q = el.value.trim();
  const drop = $('retDrop');
  if (q.length < 1) {
    drop.classList.remove('show');
    drop.innerHTML = '';
    state.lastRetDropQuery = null;
    return;
  }
  const busy = state.devices.filter(d => d.status === 'issued');
  const qu = q.toUpperCase();
  const qNoSpace = qu.replace(/\s+/g, '');
  const qFixed = hasCyr(raw) ? qu : fixLayout(q);
  const matches = busy.filter(d => {
    const h = (d.holder || '').toUpperCase();
    const s = (d.serial || '').toUpperCase();
    if (h && (h === qu || h === qNoSpace || h === qFixed)) return true;
    if (h && (h.startsWith(qu) || h.includes(qu))) return true;
    if (s === qu || s === qFixed) return true;
    if (s.endsWith(qFixed) || s.endsWith(qNoSpace)) return true;
    if (s.includes(qFixed)) return true;
    return false;
  });
  if (!matches.length) {
    drop.classList.remove('show');
    drop.innerHTML = '';
    state.lastRetDropQuery = qFixed;
    return;
  }
  drop.innerHTML = matches.slice(0, 8).map((d, idx) => {
    const sh = d.shift === 'Ночная' ? '🌙' : (d.shift === 'Дневная' ? '☀' : '');
    const ov = hoursSince(d.issued_at) >= OVERDUE_H;
    return `<div class="drop-item ${idx === 0 ? 'selected' : ''}" data-sn="${esc(d.serial)}"><div><span class="mono" style="font-weight:700;">${formatSnSplit(d.serial)}</span><span style="color:var(--text-sub);font-size:11px;margin-left:6px;">(${esc(d.model)})</span></div><span style="font-size:11.5px;font-weight:700;color:${ov ? 'var(--rose-text)' : 'var(--emerald-text)'};">${ov ? '🚨 ' : ''}${sh} 👤 ${esc(d.holder || '—')} (${fmtHoursShort(hoursSince(d.issued_at))})</span></div>`;
  }).join('');
  drop.classList.add('show');
  state.lastRetDropQuery = qFixed;
}

function handleRetKeydown(e) {
  const drop = $('retDrop');
  if (e.key === 'Enter') {
    e.preventDefault();
    handleRetInput();
    const items = Array.from(drop.querySelectorAll('.drop-item'));
    const cur = items.findIndex(it => it.classList.contains('selected'));
    if (drop.classList.contains('show') && cur >= 0 && items[cur] && items.length === 1) {
      $('retQuery').value = items[cur].dataset.sn;
    }
    resetRetDropdown();
    quickReturn();
    return;
  }
  const items = Array.from(drop.querySelectorAll('.drop-item'));
  const cur = items.findIndex(it => it.classList.contains('selected'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return;
    e.preventDefault();
    if (cur >= 0) items[cur].classList.remove('selected');
    const next = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
    items[next].classList.add('selected');
    items[next].scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Escape') resetRetDropdown();
}

async function quickReturn() {
  if (state.opLock) return;
  const raw = $('retQuery').value.trim();
  if (!raw) {
    $('retQuery').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    $('retQuery').focus();
    return;
  }
  resetRetDropdown();
  const qu = raw.toUpperCase();
  const qNoSpace = qu.replace(/\s+/g, '');
  const qFixed = hasCyr(raw) ? qu : fixLayout(raw);

  // Сначала проверяем, не отсканирован ли уже свободный или ремонтный сканер по точному SN
  const exactAny = state.devices.find(d => d.serial.toUpperCase() === qFixed || d.serial.toUpperCase() === qu);
  if (exactAny && exactAny.status === 'free') {
    beep('err');
    triggerScanFlash('warn');
    showToast('УЖЕ НА СКЛАДЕ', `Сканер ${exactAny.serial} уже числится свободным в резерве`, 'warn');
    $('retQuery').value = '';
    $('retQuery').focus();
    return;
  }
  if (exactAny && exactAny.status === 'repair') {
    beep('err');
    triggerScanFlash('warn');
    showToastWithAction(
      'СКАНЕР В РЕМОНТЕ',
      `Сканер ${exactAny.serial} числится в браке/ремонте`,
      '✅ Вернуть в строй',
      async () => { await toggleDeviceRepair(exactAny.serial); },
      'warn'
    );
    $('retQuery').value = '';
    $('retQuery').focus();
    return;
  }

  const busy = state.devices.filter(d => d.status === 'issued');
  if (!busy.length) {
    beep('err');
    triggerScanFlash('warn');
    showToast('НЕТ ВЫДАННЫХ СКАНЕРОВ', 'Все сканеры уже приняты на склад', 'warn');
    $('retQuery').value = '';
    return;
  }

  const exactSerial = busy.filter(d => { const s = (d.serial || '').toUpperCase(); return s === qu || s === qFixed; });
  const exactHolders = busy.filter(d => { const h = (d.holder || '').toUpperCase(); return h === qu || h === qNoSpace || h === qFixed; });
  const tailSerial = busy.filter(d => { const s = (d.serial || '').toUpperCase(); return s.endsWith(qFixed) || s.endsWith(qNoSpace) || s.includes(qFixed); });
  const partialHolders = busy.filter(d => { const h = (d.holder || '').toUpperCase(); return h && (h.includes(qu) || h.includes(qNoSpace)); });

  const candidates = exactSerial.length
    ? exactSerial
    : (exactHolders.length ? exactHolders : (tailSerial.length ? tailSerial : partialHolders));

  if (!candidates.length) {
    beep('err');
    triggerScanFlash('err');
    showToast('ОШИБКА: НЕ НАЙДЕН В СМЕНЕ', `Запрос «${raw}» не найден среди выданных сканеров`, 'err');
    $('retQuery').classList.add('err');
    setTimeout(() => $('retQuery').classList.remove('err'), 1200);
    $('retQuery').select();
    return;
  }

  if (candidates.length === 1) {
    await doReturn(candidates[0].serial);
    return;
  }

  $('pickList').innerHTML = candidates.map((d, idx) => {
    const ov = hoursSince(d.issued_at) >= OVERDUE_H;
    const sh = d.shift === 'Ночная' ? '🌙' : (d.shift === 'Дневная' ? '☀' : '');
    return `<div class="drop-item ${idx === 0 ? 'selected' : ''}" data-sn="${esc(d.serial)}" style="padding:10px 14px;"><div><span class="mono" style="font-weight:700;">${formatSnSplit(d.serial)}</span><span style="color:var(--text-sub);margin-left:8px;">${sh} 👤 ${esc(d.holder)}</span></div><span class="mono" style="font-size:11px;color:${ov ? 'var(--rose-text)' : 'var(--brand-text)'};">${ov ? '🚨 ' : ''}${fmtHoursShort(hoursSince(d.issued_at))}</span></div>`;
  }).join('');
  openModal('pickModal');
}

async function doReturn(sn) {
  if (state.opLock) return;
  if (isSerialInCooldown(sn)) {
    logMsg(`🛡 Анти-дубль: повторный возврат ${sn} проигнорирован`);
    return;
  }
  const dev = state.devices.find(d => d.serial === sn);
  if (!dev) {
    showToast('ОШИБКА', 'Сканер не найден в базе', 'err');
    return;
  }
  const holder = dev.holder || 'Сотрудник';
  const durationStr = dev.issued_at ? fmtHoursShort(hoursSince(dev.issued_at)) : '—';
  const ts = nowIso();
  const snapshot = JSON.parse(JSON.stringify(dev));
  state.opLock = true;
  const btn = $('retBtn');
  btn.classList.add('busy');

  try {
    const updated = { ...dev, status: 'free', holder: '', shift: '—', issued_at: null, last_move: ts, defect: '' };
    const idx = state.devices.findIndex(d => d.serial === sn);
    if (idx >= 0) state.devices[idx] = updated;
    state.justReturned = sn;
    renderTable();
    updateIssBanner(fixLayout($('issSn').value));
    setTimeout(() => { state.justReturned = null; }, 2200);

    await saveDevice(updated, 'Возврат на склад', holder);
    beep('return');
    triggerScanFlash('ok');
    pushTickerEvent('t-ret', sn, holder);
    setTimeout(() => updateDebtBadge(), 150);

    showUndoToast(
      `СКАНЕР ${sn.slice(-4)} ПРИНЯТ`,
      `Принят от 👤 ${holder} (время в смене: ${durationStr})`,
      '↩ Отменить (Ctrl+Z)',
      async () => {
        try {
          const t2 = nowIso();
          await saveDevice({ ...snapshot, last_move: t2 }, 'Отмена приёма', holder);
          beep('issue');
          showToast('ПРИЁМКА ОТМЕНЕНА', `Сканер ${sn} снова числится за ${holder}`);
        } catch(e) { showToast('ОШИБКА', e.message || '?', 'err'); }
      },
      'ok'
    );
    logMsg(`📥 ПРИНЯТО: ${sn} от ${holder} (${durationStr})`);
    $('retQuery').value = '';
    resetRetDropdown();
    $('retQuery').focus();
  } catch(e) {
    const idx = state.devices.findIndex(d => d.serial === sn);
    if (idx >= 0) state.devices[idx] = snapshot;
    renderTable();
    beep('err');
    triggerScanFlash('err');
    showToast('ОШИБКА ПРИЁМКИ', e.message || '?', 'err');
  } finally {
    state.opLock = false;
    btn.classList.remove('busy');
  }
}

/* ===== ПЕРЕВОД СКАНЕРА В БРАК / РЕМОНТ И ВОЗВРАТ В СТРОЙ ===== */
async function submitDefectForm() {
  const rawSn = $('defSn').value.trim();
  const reason = $('defReason').value.trim() || 'Неисправен / На диагностике';
  if (!rawSn) {
    $('defSn').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    $('defSn').focus();
    return;
  }
  $('defSn').classList.remove('err');
  const qFixed = fixLayout(rawSn);
  const exact = state.devices.find(d => d.serial.toUpperCase() === qFixed);
  const tail = state.devices.filter(d => d.serial.toUpperCase().endsWith(qFixed));
  const target = exact || (tail.length === 1 ? tail[0] : null);
  if (!target) {
    $('defSn').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    showToast('СКАНЕР НЕ НАЙДЕН', `По запросу «${rawSn}» устройство не найдено`, 'err');
    return;
  }
  await toggleDeviceRepair(target.serial, reason);
  $('defSn').value = '';
  $('defSn').focus();
}

async function toggleDeviceRepair(sn, customReason) {
  if (state.opLock) return;
  const dev = state.devices.find(d => d.serial === sn);
  if (!dev) return;
  const snapshot = JSON.parse(JSON.stringify(dev));
  const ts = nowIso();
  const isCurrentlyRepair = dev.status === 'repair';
  const prevHolder = dev.holder || '';
  const reason = customReason || $('defReason')?.value.trim() || 'Требуется диагностика / ремонт';

  state.opLock = true;
  try {
    let updated;
    let actionLabel;
    if (isCurrentlyRepair) {
      updated = { ...dev, status: 'free', holder: '', shift: '—', issued_at: null, last_move: ts, defect: '' };
      actionLabel = 'Возвращён из ремонта в резерв';
    } else {
      updated = { ...dev, status: 'repair', holder: '', shift: '—', issued_at: null, last_move: ts, defect: reason };
      actionLabel = `Переведён в ремонт: ${reason}`;
    }

    const idx = state.devices.findIndex(d => d.serial === sn);
    if (idx >= 0) state.devices[idx] = updated;
    renderTable();
    updateIssBanner(fixLayout($('issSn').value));

    await saveDevice(updated, actionLabel, prevHolder);
    beep(isCurrentlyRepair ? 'return' : 'swap');
    triggerScanFlash(isCurrentlyRepair ? 'ok' : 'warn');
    pushTickerEvent(isCurrentlyRepair ? 't-ret' : 't-rep', sn, isCurrentlyRepair ? 'В резерв' : 'Брак');

    showUndoToast(
      isCurrentlyRepair ? `В СТРОЮ: ${sn}` : `В РЕМОНТЕ: ${sn}`,
      isCurrentlyRepair ? 'Сканер проверен и доступен для выдачи' : `Причина: ${reason}${prevHolder ? ` (снят с ${prevHolder})` : ''}`,
      '↩ Отменить (Ctrl+Z)',
      async () => {
        await saveDevice({ ...snapshot, last_move: nowIso() }, 'Отмена статуса ремонта', prevHolder);
        showToast('ОТМЕНЕНО', `Статус сканера ${sn} восстановлен`);
      },
      isCurrentlyRepair ? 'ok' : 'warn'
    );
    logMsg(`🛠 СТАТУС РЕМОНТА: ${sn} — ${actionLabel}`);
    if (state.auditSn === sn) openAudit(sn);
  } catch(e) {
    const idx = state.devices.findIndex(d => d.serial === sn);
    if (idx >= 0) state.devices[idx] = snapshot;
    renderTable();
    beep('err');
    showToast('ОШИБКА', e.message || '?', 'err');
  } finally {
    state.opLock = false;
  }
}

/* ===== МОДАЛЬНОЕ ОКНО ДОЛЖНИКОВ И ФИЛЬТРАЦИЯ ===== */
function buildDebtList() {
  const byHolder = {};
  state.devices.forEach(d => {
    if (d.status !== 'issued' || !d.holder) return;
    const h = hoursSince(d.issued_at);
    if (h < OVERDUE_H) return;
    const normKey = d.holder.trim().toUpperCase();
    if (!byHolder[normKey]) byHolder[normKey] = { holder: d.holder.trim(), count: 0, maxH: 0 };
    byHolder[normKey].count++;
    if (h > byHolder[normKey].maxH) byHolder[normKey].maxH = h;
  });
  return Object.values(byHolder).sort((a, b) => b.maxH - a.maxH);
}

function openDebtModal() {
  checkDebtors();
  const list = buildDebtList();
  $('debtModalCount').innerText = list.length;
  const wrap = $('debtModalList');
  if (!list.length) {
    wrap.innerHTML = '<div class="debt-empty-modal" style="padding:20px;">🎉 Активных просрочек (>14ч) нет</div>';
  } else {
    wrap.innerHTML = list.map(g => {
      const holder = g.holder;
      const word = pluralN(g.count, 'сканер', 'сканера', 'сканеров');
      return `<div class="debt-modal-item" data-holder="${esc(holder)}"><div class="dname"><span>👤 ${esc(holder)}</span></div><div class="dtime">${fmtHoursShort(g.maxH)}</div><div class="dmeta"><span class="dcnt">${g.count}×</span><span>${word}</span></div></div>`;
    }).join('');
  }
  const histWrap = $('debtHistoryList');
  const history = Object.values(state.debtorsRegistry).sort((a, b) => b.count - a.count);
  if (!history.length) {
    histWrap.innerHTML = '<div class="debt-empty-modal" style="padding:20px;">📜 Архив нарушений пуст</div>';
  } else {
    histWrap.innerHTML = history.map(r => {
      const lastStr = r.lastDate ? new Date(r.lastDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
      return `<div class="debt-modal-item" style="background:rgba(245,158,11,.06);border-color:rgba(245,158,11,.28);" data-holder="${esc(r.name)}"><div class="dname"><span>👤 ${esc(r.name)}</span></div><div class="dtime" style="color:var(--amber-text);">${r.count}×</div><div class="dmeta"><span style="color:var(--amber-text);">${r.serials.length} сканеров</span><span style="font-size:10px;">${lastStr}</span></div></div>`;
    }).join('');
  }
  openModal('debtModal');
}

function showAllDebtsInTable() {
  closeModal('debtModal');
  document.querySelectorAll('.kpi-card').forEach(x => x.classList.remove('active'));
  const card = document.querySelector('.kpi-card[data-filter="overdue"]');
  if (card) card.classList.add('active');
  state.filter = 'overdue';
  $('searchTable').value = '';
  updateSearchWrap();
  renderTable();
}

function filterByHolder(holder) {
  $('searchTable').value = holder;
  updateSearchWrap();
  state.filter = 'all';
  document.querySelectorAll('.kpi-card').forEach(x => x.classList.remove('active'));
  const allCard = document.querySelector('.kpi-card[data-filter="all"]');
  if (allCard) allCard.classList.add('active');
  renderTable();
}

function updateSearchWrap() {
  const w = $('searchWrap');
  if (w) w.classList.toggle('has-val', !!$('searchTable').value);
}

function setRingProgress(id, ratio) {
  const el = $(id);
  if (!el) return;
  const c = 94.2;
  const r = Math.max(0, Math.min(1, ratio || 0));
  el.style.strokeDashoffset = String(c - c * r);
}

/* ===== ОТРИСОВКА KPI-ПАНЕЛИ И РЕЕСТРА СКАНЕРОВ ===== */
function renderTable() {
  const q = ($('searchTable')?.value || '').trim().toUpperCase();
  let free = 0, issued = 0, repair = 0, overdue = 0, dayCount = 0, nightCount = 0;
  let zebraCnt = 0, pmCnt = 0;
  const issuedTimes = [];

  state.devices.forEach(d => {
    if (d.model === 'Zebra RS5100') zebraCnt++;
    else pmCnt++;

    if (d.status === 'issued') {
      issued++;
      const h = hoursSince(d.issued_at);
      issuedTimes.push(h);
      if (h >= OVERDUE_H) overdue++;
      if (d.shift === 'Ночная') nightCount++;
      else dayCount++;
    } else if (d.status === 'repair') {
      repair++;
    } else {
      free++;
    }
  });

  const total = state.devices.length;
  $('mTotal').innerText = total;
  $('mIssued').innerText = issued;
  $('mFree').innerText = free;
  $('mRepair').innerText = repair;
  $('mOverdue').innerText = overdue;
  $('mDay').innerText = dayCount;
  $('mNight').innerText = nightCount;

  $('mIssuedPct').innerText = total ? Math.round((issued / total) * 100) + '%' : '0%';
  $('mFreePct').innerText = total ? Math.round((free / total) * 100) + '%' : '0%';
  $('mRepairPct').innerText = total ? Math.round((repair / total) * 100) + '%' : '0%';

  $('mcAll').innerText = total;
  $('mcPm').innerText = pmCnt;
  $('mcZebra').innerText = zebraCnt;

  setRingProgress('ringIssued', total ? issued / total : 0);
  setRingProgress('ringFree', total ? free / total : 0);
  setRingProgress('ringRepair', total ? repair / total : 0);
  setRingProgress('ringOverdue', issued ? overdue / issued : 0);
  setRingProgress('ringShiftSplit', issued ? dayCount / issued : 0.5);

  if (total > 0) {
    $('capFree').style.width = ((free / total) * 100) + '%';
    $('capIssued').style.width = ((Math.max(0, issued - overdue) / total) * 100) + '%';
    $('capRepair').style.width = ((repair / total) * 100) + '%';
    $('capOver').style.width = ((overdue / total) * 100) + '%';
  }

  const statsEl = $('regStats');
  if (statsEl) {
    if (issuedTimes.length) {
      const avg = issuedTimes.reduce((a, b) => a + b, 0) / issuedTimes.length;
      const max = Math.max(...issuedTimes);
      const avgCls = timeClass(avg), maxCls = timeClass(max);
      const colors = { fresh: 'var(--emerald-text)', mid: 'var(--amber-text)', late: '#f97316', over: 'var(--rose-text)' };
      statsEl.innerHTML = `Среднее в смене: <b style="color:${colors[avgCls]};">${fmtHoursShort(avg)}</b> · Макс: <b style="color:${colors[maxCls]};">${fmtHoursShort(max)}</b>`;
    } else {
      statsEl.innerHTML = 'Среднее в смене: <span style="color:var(--text-muted);">—</span> · Макс: <span style="color:var(--text-muted);">—</span>';
    }
  }

  updateDebtBadge();

  const filtered = state.devices.filter(d => {
    if (state.filter === 'free' && d.status !== 'free') return false;
    if (state.filter === 'issued' && d.status !== 'issued') return false;
    if (state.filter === 'repair' && d.status !== 'repair') return false;
    if (state.filter === 'overdue') {
      if (d.status !== 'issued' || hoursSince(d.issued_at) < OVERDUE_H) return false;
    }
    if (state.filter === 'day') {
      if (d.status !== 'issued' || d.shift === 'Ночная') return false;
    }
    if (state.filter === 'night') {
      if (d.status !== 'issued' || d.shift !== 'Ночная') return false;
    }
    if (state.modelFilter !== 'all' && d.model !== state.modelFilter) return false;
    if (q) {
      const hay = (d.serial + ' ' + (d.holder || '') + ' ' + (d.model || '') + ' ' + (d.defect || '')).toUpperCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (state.sortField === 'serial') return (state.sortAsc ? 1 : -1) * String(a.serial).localeCompare(String(b.serial));
    if (state.sortField === 'model') return (state.sortAsc ? 1 : -1) * String(a.model || '').localeCompare(String(b.model || ''));
    if (state.sortField === 'status') return (state.sortAsc ? 1 : -1) * String(a.status || '').localeCompare(String(b.status || ''));
    if (state.sortField === 'holder') return (state.sortAsc ? 1 : -1) * String(a.holder || '').localeCompare(String(b.holder || ''));
    if (state.sortField === 'time') {
      const ha = a.status === 'issued' ? hoursSince(a.issued_at) : -1;
      const hb = b.status === 'issued' ? hoursSince(b.issued_at) : -1;
      return (state.sortAsc ? 1 : -1) * (ha - hb);
    }
    const order = { issued: 0, repair: 1, free: 2 };
    const oa = order[a.status] ?? 2;
    const ob = order[b.status] ?? 2;
    if (oa !== ob) return oa - ob;
    const aTime = parseTime(a.last_move) || parseTime(a.issued_at);
    const bTime = parseTime(b.last_move) || parseTime(b.issued_at);
    if (aTime !== bTime) return bTime - aTime;
    return String(a.serial).localeCompare(String(b.serial));
  });

  if (!filtered.length) {
    $('tbody').innerHTML = '<tr><td colspan="6" style="text-align:center;padding:42px;color:var(--text-muted);font-size:13px;">Сканеры по выбранному фильтру не найдены</td></tr>';
    return;
  }
  $('tbody').innerHTML = filtered.map(d => renderRow(d)).join('');
}

function renderRow(d) {
  const busy = d.status === 'issued';
  const isRep = d.status === 'repair';
  const h = busy ? hoursSince(d.issued_at) : 0;
  const over = busy && h >= OVERDUE_H;
  const inherited = busy && isInheritedTime(d);

  let badge = '';
  if (busy && over) badge = '<span class="badge-chip chip-over">🚨 ДОЛГ (&gt;14ч)</span>';
  else if (busy) badge = '<span class="badge-chip chip-busy">НА РУКАХ</span>';
  else if (isRep) badge = '<span class="badge-chip chip-repair">🛠 В РЕМОНТЕ</span>';
  else badge = '<span class="badge-chip chip-free">В РЕЗЕРВЕ</span>';

  let shiftChip = '';
  if (busy && d.shift === 'Дневная') {
    shiftChip = ` <span class="badge-chip chip-day" style="cursor:pointer;" data-action="toggle-shift" data-sn="${esc(d.serial)}" title="Клик — переключить на Ночную смену">☀ День ⇄</span>`;
  } else if (busy && d.shift === 'Ночная') {
    shiftChip = ` <span class="badge-chip chip-night" style="cursor:pointer;" data-action="toggle-shift" data-sn="${esc(d.serial)}" title="Клик — переключить на Дневную смену">🌙 Ночь ⇄</span>`;
  }

  const modelCls = d.model === 'Zebra RS5100' ? 'zebra' : 'pm';
  const holderHtml = d.holder
    ? `<span class="holder-pill mono" data-action="filter-holder" data-holder="${esc(d.holder)}" title="Клик — показать все сканеры сотрудника"><span class="holder-avatar">${esc(getInitials(d.holder))}</span>${esc(d.holder)}</span>`
    : '<span style="color:var(--text-muted);font-weight:400;">—</span>';

  let actionBtns = '';
  if (busy) {
    actionBtns = `<button type="button" class="btn-row-return" data-action="return" data-sn="${esc(d.serial)}" title="Принять сканер в 1 клик">Принять</button><button type="button" class="btn-row-repair" data-action="repair" data-sn="${esc(d.serial)}" title="Отметить брак / отправить в ремонт">🛠</button>`;
  } else if (isRep) {
    actionBtns = `<button type="button" class="btn-row-return" data-action="repair" data-sn="${esc(d.serial)}" title="Вернуть исправный сканер в резерв">✅ В строй</button>`;
  } else {
    actionBtns = `<button type="button" class="btn-row-issue" data-action="issue" data-sn="${esc(d.serial)}" title="Подставить сканер для выдачи">Выдать</button><button type="button" class="btn-row-repair" data-action="repair" data-sn="${esc(d.serial)}" title="Отправить в ремонт">🛠</button>`;
  }

  let timeHtml = '', timeTitle = '';
  if (busy) {
    const cls = timeClass(h);
    const barW = timeBarWidth(h);
    const issuedStr = d.issued_at ? new Date(d.issued_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '—';
    timeTitle = 'Выдан: ' + issuedStr;
    const inheritMark = inherited ? '<span class="inherit-mark" title="Время перенесено при замене сканера">🔁</span>' : '';
    timeHtml = `<div class="time-inline"><span class="val ${cls}">${fmtHoursShort(h)}</span><span class="bar"><span class="bar-fill ${cls}" style="width:${barW}%"></span></span>${inheritMark}</div>`;
  } else if (isRep) {
    timeTitle = d.defect || 'В ремонте';
    timeHtml = `<span style="color:var(--amber-text);font-size:11.5px;font-weight:700;">🛠 ${esc(d.defect || 'На диагностике')}</span>`;
  } else {
    const lastMoveStr = d.last_move ? new Date(d.last_move).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '—';
    timeTitle = 'Последняя операция: ' + lastMoveStr;
    timeHtml = `<div class="time-inline"><span class="val empty">Свободен</span><span class="bar"><span class="bar-fill zero" style="width:100%"></span></span></div>`;
  }

  let rowClass = '';
  if (over) rowClass = 'row-overdue';
  else if (isRep) rowClass = 'row-repair';
  if (state.justIssued === d.serial) rowClass += ' just-issued';
  if (state.justReturned === d.serial) rowClass += ' just-returned';

  return `<tr class="${rowClass}"><td><span class="mono sn-link" data-action="audit" data-sn="${esc(d.serial)}" title="Открыть досье и историю сканера">${formatSnSplit(d.serial)}</span></td><td><span class="model-pill ${modelCls}">${esc(d.model)}</span></td><td>${badge}${shiftChip}</td><td>${holderHtml}</td><td style="text-align:right;" title="${esc(timeTitle)}">${timeHtml}</td><td style="text-align:right;"><div class="row-action-cell">${actionBtns}</div></td></tr>`;
}

function quickReturnFromRow(sn) {
  doReturn(sn);
}
function pickForIssue(sn) {
  $('issSn').value = sn;
  $('issSn').classList.remove('err');
  updateIssBanner(sn);
  if ($('issWorker').value.trim()) {
    submitIssue();
  } else {
    $('issWorker').focus();
  }
}

/* ===== ДОСЬЕ СКАНЕРА И ЖУРНАЛ ДВИЖЕНИЙ ===== */
async function openAudit(sn) {
  const dev = state.devices.find(d => d.serial === sn);
  if (!dev) return;
  state.auditSn = sn;
  $('audSn').innerText = dev.serial;
  const bcTxt = $('audBarcodeText');
  if (bcTxt) bcTxt.innerText = dev.serial;
  $('audModel').innerText = dev.model || '—';
  $('audHolder').innerText = dev.holder || (dev.status === 'repair' ? 'В ремзоне' : 'На складе (в резерве)');
  const badge = $('audStatusBadge');
  if (dev.status === 'issued') {
    badge.className = 'badge-chip chip-busy';
    badge.innerText = 'На руках (в смене)';
  } else if (dev.status === 'repair') {
    badge.className = 'badge-chip chip-repair';
    badge.innerText = 'В ремонте / Браке';
  } else {
    badge.className = 'badge-chip chip-free';
    badge.innerText = 'Свободен в резерве';
  }
  $('audDuration').innerText = dev.status === 'issued' && dev.issued_at
    ? fmtHoursShort(hoursSince(dev.issued_at)) + ' (' + (dev.shift || '—') + ')'
    : (dev.status === 'repair' ? (dev.defect || 'На диагностике') : 'Готов к выдаче');

  const shiftBtn = $('audShiftBtn');
  if (shiftBtn) {
    if (dev.status === 'issued') {
      shiftBtn.style.display = 'inline-flex';
      shiftBtn.innerText = dev.shift === 'Ночная' ? '🔀 Перевести на ДЕНЬ' : '🔀 Перевести на НОЧЬ';
      shiftBtn.onclick = () => toggleDeviceShift(sn);
    } else {
      shiftBtn.style.display = 'none';
    }
  }
  const repBtn = $('audRepairBtn');
  if (repBtn) {
    repBtn.innerText = dev.status === 'repair' ? '✅ Вернуть из ремонта в строй' : '🛠 Отправить в ремонт / брак';
    repBtn.onclick = () => toggleDeviceRepair(sn);
  }

  $('auditOverlay').classList.add('show');
  $('auditDrawer').classList.add('open');
  refreshScrollLock();

  const localMoves = await new Promise(r => {
    if (!db) return r([]);
    try {
      const t = db.transaction('moves', 'readonly');
      const req = t.objectStore('moves').getAll();
      req.onsuccess = () => r(req.result || []);
      req.onerror = () => r([]);
      t.onabort = () => r([]);
    } catch(e) { r([]); }
  });
  const filteredLocal = localMoves.filter(m => m.serial === sn);

  let cloudMoves = [];
  if (cloud && navigator.onLine) {
    try {
      const { data } = await withTimeout(
        cloud.from('movements').select('*').eq('serial', sn).order('created_at', { ascending: false }).limit(25),
        NET_TIMEOUT_MS,
        'audit query'
      );
      if (state.auditSn !== sn) return;
      if (data) cloudMoves = data;
    } catch(e) {}
  }
  if (state.auditSn !== sn) return;

  const combined = [...cloudMoves, ...filteredLocal];
  const seen = new Set();
  const moves = combined.filter(m => {
    const ts = parseTime(m.created_at || m.at);
    const sig = `${m.action || ''}|${m.worker || ''}|${Math.floor(ts / 3000)}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  }).sort((a, b) => parseTime(b.created_at || b.at) - parseTime(a.created_at || a.at)).slice(0, 30);

  const tl = $('audTimeline');
  if (!moves.length) {
    tl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:15px;">Журнал операций по данному сканеру пока пуст.</div>';
    return;
  }
  tl.innerHTML = moves.map(h => {
    const isRet = h.action && h.action.startsWith('Возврат');
    const d = h.created_at || h.at;
    const t = d ? new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    const actColor = isRet ? 'var(--emerald-text)' : 'var(--brand-text)';
    return `<div class="timeline-item ${isRet ? 'return' : ''}"><div class="timeline-dot"></div><div class="timeline-time">${t}</div><div class="timeline-action" style="color:${actColor};">${esc(h.action)}</div><div class="timeline-actor">👤 ${esc(h.worker || 'Склад')}</div></div>`;
  }).join('');
}

function closeAuditDrawer() {
  state.auditSn = null;
  $('auditDrawer').classList.remove('open');
  $('auditOverlay').classList.remove('show');
  refreshScrollLock();
  focusActiveTerminalInput();
}

/* ===== ВЫГРУЗКА ОТЧЁТА ЗА СМЕНУ (CSV/EXCEL) И ПЕЧАТЬ АКТА ===== */
function csvSafe(v) {
  let str = String(v === null || v === undefined ? '' : v);
  if (/^[=+\-@\t\r]/.test(str)) str = "'" + str;
  return '"' + str.replace(/"/g, '""') + '"';
}
function exportExcel() {
  let csv = '\uFEFFСерийный номер;Модель сканера;Статус;Сотрудник (Бейдж);Смена;Время на руках;Выдан;Активность;Примечание\n';
  state.devices.forEach(d => {
    const stLabel = d.status === 'issued' ? 'В работе' : (d.status === 'repair' ? 'В ремонте' : 'На складе');
    const dur = d.status === 'issued' && d.issued_at ? fmtHoursShort(hoursSince(d.issued_at)) : '—';
    csv += [
      d.serial,
      d.model,
      stLabel,
      d.holder || '—',
      d.shift || '—',
      dur,
      d.issued_at || '',
      d.last_move || '',
      d.defect || ''
    ].map(csvSafe).join(';') + '\n';
  });
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `sklad_scanners_report_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast('ОТЧЁТ ВЫГРУЖЕН (CSV / EXCEL)', `Экспортировано ${state.devices.length} сканеров`);
}

function printShiftAct() {
  const dt = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const total = state.devices.length;
  const issued = state.devices.filter(d => d.status === 'issued').length;
  const free = state.devices.filter(d => d.status === 'free').length;
  const repair = state.devices.filter(d => d.status === 'repair').length;
  const meta = $('printActMeta');
  if (meta) {
    meta.innerText = `Дата и время: ${dt} • Смена: ${state.issueShift} • Всего сканеров: ${total} шт. (На руках: ${issued} | В резерве: ${free} | В ремонте: ${repair})`;
  }
  window.print();
}

function processImport() {
  const text = $('impText').value.trim();
  const raw = [...new Set(text.split(/\r?\n/).map(fixLayout).filter(Boolean))];
  if (!raw.length) return;
  const valid = raw.filter(sn => SN_REGEX.test(sn));
  const rejected = raw.length - valid.length;
  if (!valid.length) {
    showToast('ОШИБКА ИМПОРТА', `Все строки отклонены (${rejected})`, 'err');
    return;
  }
  const ts = nowIso();
  let added = 0, skipped = 0;

  if (!db || !state.dbReady) {
    valid.forEach(sn => {
      if (state.devices.find(d => d.serial === sn)) { skipped++; return; }
      state.devices.push({ serial: sn, model: detectScannerModel(sn), status: 'free', holder: '', shift: '—', issued_at: null, last_move: ts, defect: '' });
      added++;
    });
    closeModal('impModal');
    $('impText').value = '';
    renderTable();
    showToast('ИМПОРТ ЗАВЕРШЁН', `Добавлено сканеров: +${added} (пропущено дублей: ${skipped})`);
    return;
  }

  try {
    const txm = db.transaction(["devices", "queue"], "readwrite");
    const ds = txm.objectStore("devices");
    const qs = txm.objectStore("queue");
    valid.forEach(sn => {
      if (state.devices.find(d => d.serial === sn)) { skipped++; return; }
      const d = { serial: sn, model: detectScannerModel(sn), status: 'free', holder: '', shift: '—', issued_at: null, last_move: ts, defect: '' };
      ds.put(d);
      qs.add({ type: 'upsert', dev: d, action: 'Импорт в парк', worker: '', ts });
      added++;
    });
    txm.oncomplete = () => {
      closeModal('impModal');
      $('impText').value = '';
      beep('issue');
      showToast('ИМПОРТ СКАНЕРОВ', `+${added} добавлено, пропущено ${skipped}`);
      loadLocal().then(() => scheduleSync(500)).catch(() => scheduleSync(500));
    };
  } catch(e) { showToast('ОШИБКА ИМПОРТА', e.message, 'err'); }
}

function showDiag() {
  const countReq = db && state.dbReady
    ? new Promise(resolve => {
        try {
          const t = db.transaction('queue', 'readonly');
          const q = t.objectStore('queue').count();
          q.onsuccess = () => resolve({ count: q.result, error: false });
          q.onerror = () => resolve({ count: null, error: true });
          t.onabort = () => resolve({ count: null, error: true });
          t.onerror = () => resolve({ count: null, error: true });
        } catch(e) { resolve({ count: null, error: true }); }
      })
    : Promise.resolve({ count: null, error: true });

  Promise.all([countReq, renderQueuePreview()]).then(([countResult, preview]) => {
    const n = countResult.count;
    const queueCountText = countResult.error ? '⚠ недоступно' : String(n);
    const lastBk = localStorage.getItem('sklad_last_backup_date') || '—';
    const dbOk = state.dbReady ? '✅ IndexedDB активна' : '⚠ Автономная память';
    const dbColor = state.dbReady ? 'var(--emerald-text)' : 'var(--amber-text)';
    $('diagContent').innerHTML = `
      <div>ВЕРСИЯ ЯДРА: <span style="color:var(--brand-text);">v10.0 Enterprise (Только сканеры)</span></div>
      <div>ЛОКАЛЬНАЯ БД: <span style="color:${dbColor};">${dbOk}</span></div>
      <div>ВСЕГО СКАНЕРОВ В ПАРКЕ: <span style="color:var(--brand-text);">${state.devices.length}</span> шт.</div>
      <div>ПАКЕТОВ В ОЧЕРЕДИ SYNC: <span style="color:${countResult.error ? 'var(--rose-text)' : 'var(--brand-text)'};">${queueCountText}</span></div>
      <div>ТЕКУЩАЯ СМЕНА: <span style="color:var(--text-main);">${state.issueShift}</span> (${state.issueShiftAuto ? 'авто' : 'ручная'})</div>
      <div>ЗАМЕНА СКАНЕРА: <span style="color:var(--amber-text);">всегда с подтверждением оператора</span></div>
      <div>ПОСЛЕДНИЙ БЭКАП: <span style="color:var(--emerald-text);">${lastBk}</span></div>
      <div>СТАТУС СЕТИ / ОШИБКА: <span style="color:var(--rose-text);">${esc(state.lastError)}</span></div>
      ${countResult.error || n ? `<div style="margin-top:12px;border-top:1px solid var(--card-border);padding-top:8px;"><div style="font-size:11px;font-weight:800;color:var(--amber-text);margin-bottom:6px;">⚠ ОЧЕРЕДЬ ДОКАЧКИ:</div><div style="max-height:180px;overflow-y:auto;background:var(--input-bg);border-radius:6px;padding:6px 10px;">${preview}</div>${countResult.error ? '' : '<div style="margin-top:8px;"><button type="button" class="btn-hud" id="btnClearQueueDiag" style="border-color:rgba(244,63,94,.4);color:var(--rose-text);font-size:10px;min-width:auto;">🗑 Очистить очередь</button></div>'}</div>` : ''}
    `;
    openModal('diagModal');
    $('btnClearQueueDiag')?.addEventListener('click', clearStuckQueue);
  });
}

function openDeleteModal() {
  $('delSearch').value = '';
  renderDeleteList();
  openModal('delModal');
  setTimeout(() => $('delSearch').focus(), 50);
}
function renderDeleteList() {
  const q = ($('delSearch').value || '').trim().toUpperCase();
  const list = state.devices.filter(d => {
    if (!q) return true;
    const hay = ((d.serial || '') + ' ' + (d.model || '') + ' ' + (d.holder || '')).toUpperCase();
    return hay.includes(q);
  }).sort((a, b) => String(a.serial).localeCompare(String(b.serial)));
  const wrap = $('delList');
  if (!list.length) {
    wrap.innerHTML = '<div class="del-empty">Сканеры не найдены</div>';
    return;
  }
  wrap.innerHTML = list.map(d => {
    const status = d.status === 'issued' ? `на руках у ${esc(d.holder || '—')}` : (d.status === 'repair' ? 'в ремонте' : 'в резерве');
    return `<div class="del-row"><span class="sn">${esc(d.serial)}</span><span class="info">${esc(d.model || '—')} · ${status}</span><button type="button" class="del-btn" data-del-sn="${esc(d.serial)}">🗑 Удалить</button></div>`;
  }).join('');
}
async function confirmDelete(sn) {
  const dev = state.devices.find(d => d.serial === sn);
  if (!dev) return;
  const ok = await askConfirmDialog(
    'Удаление сканера из базы',
    `Вы действительно хотите безвозвратно удалить сканер "${sn}" (${dev.model}) из базы данных?`,
    'Удалить сканер'
  );
  if (!ok) return;
  try {
    await deleteSerial(sn);
    showToast('УДАЛЕНО ИЗ ПАРКА', sn, 'warn');
    renderDeleteList();
  } catch(e) { showToast('ОШИБКА УДАЛЕНИЯ', e.message || '?', 'err'); }
}

function openModal(id) {
  const el = $(id);
  if (el) el.classList.add('show');
  refreshScrollLock();
}
function closeModal(id) {
  const el = $(id);
  if (el) el.classList.remove('show');
  refreshScrollLock();
}

function showToast(title, desc, kind = 'ok') {
  clearUndo();
  const el = $('toast');
  $('tTitle').innerText = title;
  $('tDesc').innerText = desc || '';
  $('tIcon').innerText = kind === 'err' ? '✕' : (kind === 'warn' ? '!' : '✓');
  $('tIcon').style.background = '';
  $('tIcon').style.borderColor = '';
  $('tIcon').style.color = '';
  $('tTitle').style.color = '';
  const oldBtn = el.querySelector('.t-undo');
  if (oldBtn) oldBtn.remove();
  el.className = kind === 'err' ? 'err' : (kind === 'warn' ? 'warn' : '');
  el.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ===== ДЕЛЕГИРОВАНИЕ СОБЫТИЙ И ГОРЯЧИЕ КЛАВИШИ ===== */
function setupDelegation() {
  document.querySelectorAll('[data-set-theme]').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.setTheme, true));
  });

  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });

  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => {
      if (e.target === m) {
        if (m.id === 'confirmDialogModal') resolveConfirmDialog(false);
        else closeModal(m.id);
      }
    });
  });

  $('confirmDialogOkBtn')?.addEventListener('click', () => resolveConfirmDialog(true));
  $('confirmDialogCancelBtn')?.addEventListener('click', () => resolveConfirmDialog(false));

  $('shiftPill')?.addEventListener('click', e => {
    if (e.target.id === 'shiftBadge') resetShiftToAuto(e);
    else toggleShift();
  });
  $('syncStatus')?.addEventListener('click', showDiag);
  $('debtBtn')?.addEventListener('click', openDebtModal);
  $('btnCopySummary')?.addEventListener('click', copyTelegramSummary);
  $('btnPrintAct')?.addEventListener('click', printShiftAct);
  $('btnExportCsv')?.addEventListener('click', exportExcel);
  $('btnOpenBackup')?.addEventListener('click', openBackupModal);
  $('btnOpenImport')?.addEventListener('click', () => { openModal('impModal'); setTimeout(() => $('impText')?.focus(), 50); });

  $('btnDebtAlertShow')?.addEventListener('click', openDebtModal);
  $('btnDebtAlertClose')?.addEventListener('click', dismissDebtAlert);
  $('btnShowDebtsInTable')?.addEventListener('click', showAllDebtsInTable);
  $('btnClearDebtHistory')?.addEventListener('click', clearDebtHistory);

  $('auditOverlay')?.addEventListener('click', closeAuditDrawer);
  $('btnCloseAudit')?.addEventListener('click', closeAuditDrawer);
  $('audBarcodeCard')?.addEventListener('click', () => {
    if (state.auditSn) {
      copyTextSafe(state.auditSn).then(() => showToast('СКОПИРОВАНО', state.auditSn));
    }
  });

  $('btnProcessImport')?.addEventListener('click', processImport);
  $('btnHardReset')?.addEventListener('click', hardReset);
  $('btnForceSync')?.addEventListener('click', forceSync);
  $('btnCreateCloudBackup')?.addEventListener('click', () => doBackup('manual'));
  $('btnDownloadJsonBackup')?.addEventListener('click', downloadJsonBackup);
  $('btnRefreshBackupList')?.addEventListener('click', renderBackupList);

  $('fastDeskModeBar')?.addEventListener('click', e => {
    const button = e.target.closest('[data-fast-mode]');
    if (button) setFastDeskMode(button.dataset.fastMode);
  });
  $('tabModeReturn')?.addEventListener('click', () => setRightMode('return'));
  $('tabModeDefect')?.addEventListener('click', () => setRightMode('defect'));
  $('defBtn')?.addEventListener('click', submitDefectForm);
  $('defSn')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitDefectForm(); } });
  $('defReason')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitDefectForm(); } });

  $('modelFilterBar')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-mfilter]');
    if (!btn) return;
    document.querySelectorAll('[data-mfilter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.modelFilter = btn.dataset.mfilter;
    renderTable();
  });

  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const f = th.dataset.sort;
      if (state.sortField === f) state.sortAsc = !state.sortAsc;
      else { state.sortField = f; state.sortAsc = true; }
      document.querySelectorAll('.sort-ind').forEach(el => el.innerText = '');
      const ind = $('sort-' + f);
      if (ind) ind.innerText = state.sortAsc ? '▲' : '▼';
      renderTable();
    });
  });

  $('liveTicker')?.addEventListener('click', e => {
    const chip = e.target.closest('[data-ticker-sn]');
    if (chip) openAudit(chip.dataset.tickerSn);
  });

  $('tbody')?.addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const sn = target.dataset.sn;
    if (action === 'audit') openAudit(sn);
    else if (action === 'return') quickReturnFromRow(sn);
    else if (action === 'issue') pickForIssue(sn);
    else if (action === 'repair') toggleDeviceRepair(sn);
    else if (action === 'toggle-shift') toggleDeviceShift(sn);
    else if (action === 'filter-holder') filterByHolder(target.dataset.holder);
  });

  $('issSnBanner')?.addEventListener('click', async e => {
    const retBtn = e.target.closest('[data-banner-return]');
    if (retBtn) {
      const sn = retBtn.dataset.bannerReturn;
      await doReturn(sn);
      $('issSn').value = sn;
      updateIssBanner(sn);
      $('issWorker').focus();
      return;
    }
    const resBtn = e.target.closest('[data-banner-restore]');
    if (resBtn) {
      const sn = resBtn.dataset.bannerRestore;
      await toggleDeviceRepair(sn);
      $('issSn').value = sn;
      updateIssBanner(sn);
      $('issWorker').focus();
    }
  });

  $('issDrop')?.addEventListener('click', e => {
    const item = e.target.closest('.drop-item');
    if (!item) return;
    const sn = item.dataset.sn;
    $('issSn').value = sn;
    resetIssueDropdown();
    updateIssBanner(sn);
    if ($('issWorker').value.trim()) submitIssue();
    else $('issWorker').focus();
  });

  $('issPickList')?.addEventListener('click', e => {
    const item = e.target.closest('.drop-item');
    if (!item) return;
    const sn = item.dataset.sn;
    closeModal('issPickModal');
    $('issSn').value = sn;
    state.issDropNavigated = false;
    updateIssBanner(sn);
    if ($('issWorker').value.trim()) submitIssue();
    else $('issWorker').focus();
  });

  $('workerDrop')?.addEventListener('click', e => {
    const item = e.target.closest('.drop-item');
    if (!item) return;
    $('issWorker').value = item.dataset.worker;
    resetWorkerDropdown();
    if ($('issSn').value.trim()) submitIssue();
    else $('issSn').focus();
  });

  $('retDrop')?.addEventListener('click', e => {
    const item = e.target.closest('.drop-item');
    if (!item) return;
    $('retQuery').value = item.dataset.sn;
    resetRetDropdown();
    quickReturn();
  });

  $('pickList')?.addEventListener('click', e => {
    const item = e.target.closest('.drop-item');
    if (!item) return;
    closeModal('pickModal');
    doReturn(item.dataset.sn);
  });

  $('debtModalList')?.addEventListener('click', e => {
    const item = e.target.closest('.debt-modal-item');
    if (!item) return;
    closeModal('debtModal');
    filterByHolder(item.dataset.holder);
  });

  $('debtHistoryList')?.addEventListener('click', e => {
    const item = e.target.closest('.debt-modal-item');
    if (!item) return;
    closeModal('debtModal');
    filterByHolder(item.dataset.holder);
  });

  $('delList')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-del-sn]');
    if (!btn) return;
    confirmDelete(btn.dataset.delSn);
  });

  $('backupList')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-bk-action]');
    if (!btn) return;
    const file = btn.dataset.bkFile;
    if (btn.dataset.bkAction === 'restore') restoreFromBackup(file);
    else if (btn.dataset.bkAction === 'delete') deleteBackup(file);
  });
}

const debouncedRenderTable = debounce(renderTable, 70);

$('issSn').addEventListener('input', () => { state.issDropNavigated = false; });
$('issSn').addEventListener('input', debounce(handleIssSnInput, 35));
$('issSn').addEventListener('input', debounce(saveDraft, 400));
$('issSn').addEventListener('keydown', handleIssSnKeydown);

$('issWorker').addEventListener('input', debounce(handleWorkerInput, 45));
$('issWorker').addEventListener('input', debounce(() => { if (state.issueShiftAuto) refreshSmartShift(); }, 250));
$('issWorker').addEventListener('input', debounce(saveDraft, 400));
$('issWorker').addEventListener('keydown', handleIssWorkerKeydown);

$('issueForm').addEventListener('submit', e => { e.preventDefault(); submitIssue(); });
$('retQuery').addEventListener('input', debounce(handleRetInput, 40));
$('retQuery').addEventListener('keydown', handleRetKeydown);
$('retBtn').addEventListener('click', quickReturn);
$('searchTable').addEventListener('input', () => { updateSearchWrap(); debouncedRenderTable(); });
$('searchClearBtn').addEventListener('click', () => {
  $('searchTable').value = '';
  updateSearchWrap();
  renderTable();
  focusActiveTerminalInput();
});
$('delSearch').addEventListener('input', debounce(renderDeleteList, 90));

document.querySelectorAll('.kpi-card').forEach(s => {
  s.addEventListener('click', () => {
    const f = s.dataset.filter;
    if (f === 'overdue' && state.filter !== 'overdue') {
      openDebtModal();
      return;
    }
    if (f === 'shift_split') {
      state.filter = state.filter === 'day' ? 'night' : 'day';
      $('shiftSplitLabel').innerText = state.filter === 'day' ? 'Фильтр: ДЕНЬ' : 'Фильтр: НОЧЬ';
      document.querySelectorAll('.kpi-card').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      renderTable();
      return;
    }
    $('shiftSplitLabel').innerText = 'День / Ночь';
    if (f === 'all' && state.filter === 'all' && $('searchTable').value) {
      $('searchTable').value = '';
      updateSearchWrap();
    }
    document.querySelectorAll('.kpi-card').forEach(x => x.classList.remove('active'));
    s.classList.add('active');
    state.filter = f;
    renderTable();
  });
});

$('swapConfirm').addEventListener('click', confirmSwap);

document.addEventListener('click', e => {
  if (!e.target.closest('.hud-group')) {
    resetIssueDropdown();
    resetRetDropdown();
    resetWorkerDropdown();
  }
});

let brandClicks = 0, brandTimer = null;
$('brandTag').addEventListener('click', () => {
  brandClicks++;
  clearTimeout(brandTimer);
  brandTimer = setTimeout(() => { brandClicks = 0; }, 700);
  if (brandClicks >= 3) { brandClicks = 0; openDeleteModal(); }
});

document.addEventListener('keydown', e => {
  if ($('confirmDialogModal').classList.contains('show')) {
    if (e.key === 'Enter') { e.preventDefault(); resolveConfirmDialog(true); return; }
    if (e.key === 'Escape') { e.preventDefault(); resolveConfirmDialog(false); return; }
  }

  if ($('issPickModal').classList.contains('show')) {
    const items = Array.from($('issPickList').querySelectorAll('.drop-item'));
    const cur = items.findIndex(it => it.classList.contains('selected'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      if (cur >= 0) items[cur].classList.remove('selected');
      const next = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
      items[next].classList.add('selected');
      items[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter' && cur >= 0 && items[cur]) {
      e.preventDefault();
      const sn = items[cur].dataset.sn;
      closeModal('issPickModal');
      $('issSn').value = sn;
      state.issDropNavigated = false;
      updateIssBanner(sn);
      if ($('issWorker').value.trim()) submitIssue();
      else $('issWorker').focus();
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); closeModal('issPickModal'); return; }
  }

  if ($('pickModal').classList.contains('show')) {
    const items = Array.from($('pickList').querySelectorAll('.drop-item'));
    const cur = items.findIndex(it => it.classList.contains('selected'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      if (cur >= 0) items[cur].classList.remove('selected');
      const next = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
      items[next].classList.add('selected');
      items[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter' && cur >= 0 && items[cur]) {
      e.preventDefault();
      const sn = items[cur].dataset.sn;
      closeModal('pickModal');
      doReturn(sn);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); closeModal('pickModal'); return; }
  }

  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
    if (state.undoAction) { e.preventDefault(); undoLast(); return; }
  }
  if (e.altKey && e.key.toLowerCase() === 't') { e.preventDefault(); cycleTheme(); return; }
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'd') { e.preventDefault(); openDeleteModal(); return; }
  if ($('swapModal').classList.contains('show') && e.key === 'Enter') { e.preventDefault(); confirmSwap(); return; }

  if (e.key === 'F1') { e.preventDefault(); setFastDeskMode('issue'); }
  else if (e.key === 'F2') { e.preventDefault(); setFastDeskMode('return'); }
  else if (e.key === 'F3') { e.preventDefault(); setFastDeskMode('return'); setRightMode('defect'); }
  else if (e.key === 'F4') { e.preventDefault(); toggleShift(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); $('searchTable').focus(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'e') { e.preventDefault(); exportExcel(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); printShiftAct(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'i') { e.preventDefault(); openModal('impModal'); }
  else if (e.key === 'Escape') {
    const anyModal = document.querySelector('.modal-overlay.show');
    const drawer = $('auditDrawer') && $('auditDrawer').classList.contains('open');
    if (anyModal || drawer) {
      document.querySelectorAll('.modal-overlay.show').forEach(m => closeModal(m.id));
      closeAuditDrawer();
    } else {
      clearAllInputsAndFocus();
      showToast('ФОРМА ОЧИЩЕНА', 'Готов к новому сканированию');
    }
  }
});

setInterval(() => { if (state.issueShiftAuto) refreshSmartShift(); else updateShiftPill(); }, 30000);
setInterval(() => {
  const cutoff = Date.now() - RECENT_LOCAL_TTL;
  for (const [k, v] of recentLocal) { if (v < cutoff) recentLocal.delete(k); }
}, 30000);
setInterval(() => { renderTable(); checkDebtors(); alertNewDebtors(); }, 60000);

window.addEventListener('DOMContentLoaded', () => {
  try {
    const pref = JSON.parse(localStorage.getItem('sklad_shift_pref') || '{}');
    if (pref.auto === false && (pref.shift === 'Дневная' || pref.shift === 'Ночная')) {
      state.issueShift = pref.shift;
      state.issueShiftAuto = false;
    } else {
      state.issueShift = computeSmartShift('');
      state.issueShiftAuto = true;
    }
  } catch(e) {
    state.issueShift = computeSmartShift('');
    state.issueShiftAuto = true;
  }
  applyTheme(state.theme, false);
  updateShiftPill();
  setupDelegation();
  setFastDeskMode('issue', false);
  updateDebtBadge();
  focusActiveTerminalInput();
});

window.addEventListener('online', () => { state.syncBackoff = 0; scheduleSync(500); });
window.addEventListener('offline', () => setSync(false, 'Офлайн (Локальная БД)'));
window.addEventListener('beforeunload', () => { try { saveDraft(); } catch(e) {} });
