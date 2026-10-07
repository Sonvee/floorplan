import {$, aabb, area, bbox, esc, fmt, furnSVG, loadJson, norm, perim} from './utils.js';

// JSON 资源位于页面根目录下，保持家具库和材料配置与业务逻辑分离。
const MATS = loadJson('assets/json/materials.json');
const LIB = loadJson('assets/json/furniture.json').map(group => ({
  cat: group.category,
  items: group.items.map(item => [item.type, item.name, item.width, item.depth, item.color])
}));
const typeColor = t => { for (const c of LIB) for (const i of c.items) if (i[0]===t) return i[4]; return '#eee'; };

let _n = 1;
const uid = () => 'f' + Date.now().toString(36) + (_n++);
const F = (type,name,cx,cy,w,d,rot=0,color) => ({id:uid(),type,name,cx,cy,w,d,rot,color:color||typeColor(type)});

function defaultFurniture(){ return []; }

function defaultState(){
  return {
    furniture:defaultFurniture(),
    plan:{walls:[], wins:[], doors:[], slides:[], rooms:[], dimensions:[]},
    rooms:{},
    demolished:[],
    measures:[]
  };
}

function deriveDimensions(plan){
  const points = [];
  (plan.walls || []).forEach(([x0,y0,x1,y1]) => points.push([x0,y0],[x1,y1]));
  (plan.rooms || []).forEach(r => (r.poly || []).forEach(point => points.push(point)));
  if (!points.length) return [];
  const xs = points.map(([x]) => x), ys = points.map(([,y]) => y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const padX = Math.max(500, (maxX - minX) * .08), padY = Math.max(500, (maxY - minY) * .08);
  return [
    {orientation:'h', offset:minY - padY, start:minX, segments:[maxX - minX]},
    {orientation:'h', offset:maxY + padY, start:minX, segments:[maxX - minX]},
    {orientation:'v', offset:minX - padX, start:minY, segments:[maxY - minY]},
    {orientation:'v', offset:maxX + padX, start:minY, segments:[maxY - minY]}
  ];
}

const STORE = 'huxing-design-v1';
const LAYER_STORE = 'huxing-layers-v1';
const DEFAULT_LAYERS = {dims:true, labels:true, furn:true, grid:true, bearing:true, wallSnap:true};

function loadLayers(){
  const layers = {...DEFAULT_LAYERS};
  try {
    const saved = JSON.parse(localStorage.getItem(LAYER_STORE));
    Object.keys(layers).forEach(key => {
      if (typeof saved?.[key] === 'boolean') layers[key] = saved[key];
    });
  } catch(e) {}
  return layers;
}
function saveLayers(){
  try { localStorage.setItem(LAYER_STORE, JSON.stringify(ui.layers)); } catch(e) {}
}

function load(){
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    const hasPlan = s?.plan && ['walls','wins','doors','slides','rooms','dimensions'].some(k => Array.isArray(s.plan[k]) && s.plan[k].length);
    if (s && Array.isArray(s.furniture) && hasPlan) return fixState(s);
  } catch(e) {}
  return null;
}

/**
 * 将旧版本用“不可计入房间 + 三块普通窗”拼出的飘窗迁移为单个 bay 窗户。
 * 仅处理明确标记为飘窗的旧房间，避免影响普通房间和用户已有窗户。
 * @param {{rooms?: Array, wins?: Array}} plan 户型数据
 * @param {Record<string, {name?: string}>} roomSettings 房间设置
 */
function migrateLegacyBayRooms(plan, roomSettings){
  const rooms = Array.isArray(plan.rooms) ? plan.rooms : [];
  const windows = Array.isArray(plan.wins) ? plan.wins : [];
  const legacyRooms = rooms.filter(room => {
    const name = room?.name || roomSettings?.[room?.id]?.name || '';
    return room?.counted === false && (String(name).includes('飘窗') || /^bay/i.test(room?.id || ''));
  });
  if (!legacyRooms.length) return;

  const consumedWindows = new Set();
  const migratedWindows = [];
  const expand = 240;
  const thickness = 50;
  const boundsOf = poly => {
    const xs = poly.map(([x]) => x), ys = poly.map(([, y]) => y);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const intersects = (a, b) => !(a[2] < b[0] - expand || a[0] > b[2] + expand
    || a[3] < b[1] - expand || a[1] > b[3] + expand);

  legacyRooms.forEach(room => {
    if (!Array.isArray(room.poly) || room.poly.length < 3) return;
    const roomBounds = boundsOf(room.poly);
    const candidates = windows
      .map((win, index) => ({win, index}))
      .filter(({win}) => Array.isArray(win) && win.length >= 4 && intersects(win, roomBounds));
    if (!candidates.length) return;

    candidates.forEach(({index}) => consumedWindows.add(index));
    const union = candidates.reduce((acc, {win}) => [
      Math.min(acc[0], win[0]), Math.min(acc[1], win[1]),
      Math.max(acc[2], win[2]), Math.max(acc[3], win[3])
    ], [...candidates[0].win.slice(0, 4)]);
    const [x0, y0, x1, y1] = roomBounds;
    const horizontal = x1 - x0 >= y1 - y0;
    const outwardPositive = horizontal ? union[3] > y1 : union[2] > x1;
    const outwardNegative = horizontal ? union[1] < y0 : union[0] < x0;
    const side = outwardPositive ? 1 : outwardNegative ? -1 : -1;
    const back = horizontal
      ? (side === 1 ? union[1] : union[3])
      : (side === 1 ? union[0] : union[2]);
    const outer = horizontal
      ? (side === 1 ? union[3] : union[1])
      : (side === 1 ? union[2] : union[0]);
    const spanStart = horizontal ? x0 : y0;
    const spanEnd = horizontal ? x1 : y1;
    const opening = horizontal
      ? [spanStart, Math.min(back, back + side * thickness), spanEnd, Math.max(back, back + side * thickness)]
      : [Math.min(back, back + side * thickness), spanStart, Math.max(back, back + side * thickness), spanEnd];
    const depth = Math.max(240, Math.abs(outer - (back + side * thickness)));
    migratedWindows.push([...opening, 'bay', horizontal ? 'h' : 'v', side, depth]);
  });

  plan.wins = windows.filter((_, index) => !consumedWindows.has(index)).concat(migratedWindows);
  plan.rooms = rooms.filter(room => !legacyRooms.includes(room));
  legacyRooms.forEach(room => { if (room?.id) delete roomSettings[room.id]; });
}

function fixState(s){
  const d = defaultState(), p = s.plan || {};
  const plan = {
    walls: Array.isArray(p.walls) ? p.walls : d.plan.walls,
    wins: Array.isArray(p.wins) ? p.wins : d.plan.wins,
    doors: Array.isArray(p.doors) ? p.doors : d.plan.doors,
    slides: Array.isArray(p.slides) ? p.slides : d.plan.slides,
    rooms: Array.isArray(p.rooms) ? p.rooms : d.plan.rooms
  };
  s.rooms = s.rooms && typeof s.rooms === 'object' ? s.rooms : {};
  migrateLegacyBayRooms(plan, s.rooms);
  s.plan = {...plan, dimensions:Array.isArray(p.dimensions) ? p.dimensions : deriveDimensions(plan)};
  const roomDefaults = {}; s.plan.rooms.forEach(r => roomDefaults[r.id] = {name:r.name || r.id, mat:r.mat || 'wood'});
  s.rooms = Object.assign(roomDefaults, s.rooms || {});
  s.demolished = Array.isArray(s.demolished) ? s.demolished : [];
  s.measures = Array.isArray(s.measures) ? s.measures : [];
  return s;
}

const PX_MM = 25.4 / 96;                       // 1 CSS px = 0.2646 mm
const COARSE = matchMedia('(pointer:coarse)').matches;   // iPad / 手机等触屏为主的设备
const TAP = COARSE ? 9 : 4;                    // 手指按下后移动超过该像素才算拖动
const narrow = () => matchMedia('(max-width:1100px)').matches;
const BOUNDS = {x:-1850, y:-1750, w:15600, h:14100};
const svg = $('#plan');


/* ======================= 状态 / 历史 / 存储 ======================= */
const state = load() || defaultState();
let WALLS = [], WINS = [], DOORS = [], SLIDES = [], ROOMS = [];
function syncPlanRefs(){
  WALLS = state.plan.walls; WINS = state.plan.wins; DOORS = state.plan.doors; SLIDES = state.plan.slides; ROOMS = state.plan.rooms;
}
syncPlanRefs();
const ui = {tool:'select', sel:null, mA:null, mCur:null, layers:loadLayers()};
let view = {x0:0, y0:0, s:.06};
const undoStack = [], redoStack = [];

function save(){ try { localStorage.setItem(STORE, JSON.stringify(state)); } catch(e) {} }
const snap = () => JSON.stringify(state);
function replaceState(next){
  const normalized = fixState(next);
  Object.keys(state).forEach(key => delete state[key]);
  Object.assign(state, normalized);
  syncPlanRefs();
}
function commit(before){ undoStack.push(before); if (undoStack.length > 150) undoStack.shift(); redoStack.length = 0; save(); }
function mutate(fn){ const b = snap(); fn(); commit(b); renderAll(); }
function undo(){ if (!undoStack.length) return toast('没有可撤销的操作'); redoStack.push(snap()); replaceState(JSON.parse(undoStack.pop())); renderOpenings(); validateSel(); save(); renderAll(); }
function redo(){ if (!redoStack.length) return; undoStack.push(snap()); replaceState(JSON.parse(redoStack.pop())); renderOpenings(); validateSel(); save(); renderAll(); }
function validateSel(){ if (ui.sel?.kind==='furn' && !getF(ui.sel.id)) ui.sel = null; }
const getF = id => state.furniture.find(f => f.id === id);

/* ======================= 几何工具 ======================= */

function snapRects(){ return WALLS.filter((w,i) => !state.demolished.includes('w'+i)).concat(WINS); }

/* ======================= 颜色 / 材质图案 ======================= */


function buildDefs(){
  const plank = (id,base,line) => `<pattern id="m-${id}" patternUnits="userSpaceOnUse" width="1800" height="360">
      <rect width="1800" height="360" fill="${base}"/>
      <path d="M0 0H1800M0 180H1800M1200 0V180M600 180V360" stroke="${line}" stroke-width="10"/>
      <path d="M100 70Q500 60 900 85T1700 75M200 260Q700 250 1100 275T1750 262" stroke="${line}" stroke-width="5" fill="none" opacity=".45"/></pattern>`;
  const tile = (id,size,base,line) => `<pattern id="m-${id}" patternUnits="userSpaceOnUse" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" fill="${base}"/><path d="M0 0H${size}M0 0V${size}" stroke="${line}" stroke-width="10"/></pattern>`;
  $('#defs').innerHTML =
    plank('wood','#dcc09a','#bf9d70') + plank('walnut','#a57c56','#80593a') +
    tile('tile800',800,'#ece7de','#d3cabb') + tile('tile600',600,'#e2e6e3','#c4cbc6') + tile('antislip',300,'#d6dbd7','#b3bab4') +
    `<pattern id="m-marble" patternUnits="userSpaceOnUse" width="1200" height="1200">
      <rect width="1200" height="1200" fill="#f3f0ea"/><path d="M0 0H1200M0 0V1200" stroke="#dcd5c8" stroke-width="10"/>
      <path d="M-50 300C250 260 380 520 700 470S1100 640 1260 600M200 1200C300 950 520 980 640 820" stroke="#d6cfc2" stroke-width="12" fill="none"/></pattern>
    <pattern id="m-terrazzo" patternUnits="userSpaceOnUse" width="500" height="500">
      <rect width="500" height="500" fill="#e8e1d5"/>
      <circle cx="60" cy="80" r="22" fill="#b9a58c"/><circle cx="310" cy="140" r="16" fill="#8fa3a0"/><circle cx="190" cy="330" r="26" fill="#c9b7a2"/>
      <circle cx="420" cy="400" r="18" fill="#a88f76"/><circle cx="90" cy="440" r="12" fill="#8fa3a0"/><circle cx="440" cy="40" r="10" fill="#b9a58c"/></pattern>
    <pattern id="m-carpet" patternUnits="userSpaceOnUse" width="120" height="120">
      <rect width="120" height="120" fill="#c9c3d3"/><circle cx="30" cy="30" r="8" fill="#bab3c6"/><circle cx="90" cy="90" r="8" fill="#bab3c6"/></pattern>
    <pattern id="grid" patternUnits="userSpaceOnUse" width="1000" height="1000">
      <path d="M500 0V1000M0 500H1000" stroke="#e5dfd3" stroke-width="8"/><path d="M0 0V1000M0 0H1000" stroke="#d8d0c1" stroke-width="14"/></pattern>`;
}

/* ======================= 家具图例 ======================= */


/* ======================= 渲染 ======================= */
const NOLABEL = ['plant','floorlamp','sidetable','barstool','beanbag'];
function renderRooms(){
  let s = '';
  ROOMS.forEach(r => s += `<polygon class="room" data-room="${r.id}" points="${r.poly.map(p=>p.join(',')).join(' ')}" fill="url(#m-${state.rooms[r.id].mat})"/>`);
  const sill = ([a,b,c,d]) => `<rect x="${a}" y="${b}" width="${c-a}" height="${d-b}" fill="#e2dacb" stroke="#b9b0a0" stroke-width="1" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  DOORS.forEach(d => s += sill(d.rect)); SLIDES.forEach(d => s += sill(d.rect));
  $('#gRooms').innerHTML = s;
}

function renderFurn(){
  const g = $('#gFurn');
  g.setAttribute('display', ui.layers.furn ? 'inline' : 'none');
  g.innerHTML = state.furniture.map(f => {
    const fs = Math.max(80, Math.min(170, Math.min(f.w,f.d)*.2));
    const label = Math.min(f.w,f.d) >= 380 && !NOLABEL.includes(f.type)
      ? `<text transform="rotate(${-f.rot})" font-size="${fs}" text-anchor="middle" dominant-baseline="central" fill="#4a443c" opacity=".8" pointer-events="none">${esc(f.name)}</text>` : '';
    return `<g class="furn" data-fid="${f.id}" transform="translate(${f.cx} ${f.cy}) rotate(${f.rot})">${furnSVG(f.type,f.w,f.d,f.color)}${label}</g>`;
  }).join('');
}

function renderWalls(){
  $('#gWalls').innerHTML = WALLS.map((w,i) => {
    const [x0,y0,x1,y1,k] = w, id = 'w'+i, dem = state.demolished.includes(id);
    let fill = k==='b' ? (ui.layers.bearing ? '#b8412c' : '#26241f') : k==='low' ? '#e9e3d8' : k==='e' ? '#8f897d' : '#a7a195';
    let ex = k==='low' ? 'stroke="#8f897d" stroke-width="1" vector-effect="non-scaling-stroke"' : '';
    if (dem){ fill = 'rgba(198,91,58,.12)'; ex = 'stroke="#c65b3a" stroke-width="1.2" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"'; }
    return `<rect class="wall" data-wall="${id}" x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}" fill="${fill}" ${ex}/>`;
  }).join('');
}

/**
 * 生成 2D 窗户图形。飘窗使用“缺一边”的 U 形三面窗，
 * 不再用上下两条断开的装饰线模拟。
 */
function planWindowMarkup(values, type = 'normal', opacity = 1) {
  const [x0, y0, x1, y1] = values;
  const width = x1 - x0;
  const height = y1 - y0;
  const fill = type === 'floor' ? '#c9edf8' : type === 'bay' ? '#dceafa' : '#f7fbfd';
  const stroke = '#4f7394';
  const strokeWidth = type === 'floor' ? 2 : 1;
  const common = `fill="${fill}" fill-opacity="${opacity}" stroke="${stroke}" stroke-width="${strokeWidth}" vector-effect="non-scaling-stroke"`;
  if (type !== 'bay') {
    let output = `<rect x="${x0}" y="${y0}" width="${width}" height="${height}" ${common}/>`;
    if (width >= height) [1 / 3, 2 / 3].forEach(t => {
      output += `<line x1="${x0 + width * t}" y1="${y0}" x2="${x0 + width * t}" y2="${y1}" stroke="${stroke}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    });
    else [1 / 3, 2 / 3].forEach(t => {
      output += `<line x1="${x0}" y1="${y0 + height * t}" x2="${x1}" y2="${y0 + height * t}" stroke="${stroke}" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    });
    if (type === 'floor') output += `<rect x="${x0 + width * .08}" y="${y0 + height * .08}" width="${width * .84}" height="${height * .84}" fill="none" stroke="#8cc9dc" stroke-width="1" vector-effect="non-scaling-stroke"/>`;
    return output;
  }

  const frame = Math.max(24, Math.min(width, height) * .14);
  const horizontal = width >= height;
  const side = Number(values[6]) === 1 ? 1 : -1;
  const storedDepth = Number(values[7]);
  const depth = Number.isFinite(storedDepth) && storedDepth > 0
    ? storedDepth
    : 570;
  if (horizontal) {
    const backY = side === 1 ? y1 : y0;
    const frontY = backY + side * depth;
    const frontStart = Math.min(backY, frontY);
    return `<g ${common}>
      <rect x="${x0}" y="${side === 1 ? frontY - frame : frontY}" width="${width}" height="${frame}"/>
      <rect x="${x0}" y="${frontStart}" width="${frame}" height="${Math.abs(frontY - backY)}"/>
      <rect x="${x1 - frame}" y="${frontStart}" width="${frame}" height="${Math.abs(frontY - backY)}"/>
      <path d="M${x0} ${backY}V${frontY}H${x1}V${backY}" fill="none" stroke="#6e91ad" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    </g>`;
  }

  const backX = side === 1 ? x1 : x0;
  const frontX = backX + side * depth;
  const frontStart = Math.min(backX, frontX);
  return `<g ${common}>
    <rect x="${side === 1 ? frontX - frame : frontX}" y="${y0}" width="${frame}" height="${height}"/>
    <rect x="${frontStart}" y="${y0}" width="${Math.abs(frontX - backX)}" height="${frame}"/>
    <rect x="${frontStart}" y="${y1 - frame}" width="${Math.abs(frontX - backX)}" height="${frame}"/>
    <path d="M${backX} ${y0}H${frontX}V${y1}H${backX}" fill="none" stroke="#6e91ad" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
  </g>`;
}
function renderOpenings(){
  let s = '';
  WINS.forEach((win, index) => {
    const [x0, y0, x1, y1, type = 'normal'] = win;
    s += `<g data-window="${index}">${planWindowMarkup(win, type)}</g>`;
  });
  const DS = 'stroke="#3d3a34" stroke-width="1" vector-effect="non-scaling-stroke"';
  DOORS.forEach((d, index) => {
    if (!Array.isArray(d.h) || !Array.isArray(d.o) || !Array.isArray(d.c)) return;
    const [hx,hy] = d.h, L = Number(d.len) || 800, T = 40;
    const ox = hx + d.o[0]*L, oy = hy + d.o[1]*L, cx = hx + d.c[0]*L, cy = hy + d.c[1]*L;
    const sweep = d.o[0]*d.c[1] - d.o[1]*d.c[0] > 0 ? 1 : 0;
    const col = d.entry ? '#b5653a' : '#3d3a34';
    s += `<g data-door="${index}"><polygon points="${hx},${hy} ${ox},${oy} ${ox+d.c[0]*T},${oy+d.c[1]*T} ${hx+d.c[0]*T},${hy+d.c[1]*T}" fill="#fff" stroke="${col}" stroke-width="${d.entry?1.8:1}" vector-effect="non-scaling-stroke"/>`;
    s += `<path d="M${ox} ${oy}A${L} ${L} 0 0 ${sweep} ${cx} ${cy}" fill="none" ${DS} stroke-dasharray="5 3" opacity=".7"/></g>`;
  });
  SLIDES.forEach(({rect:[x0,y0,x1,y1],v}) => {
    if (v){ const L = y1-y0, m = (x0+x1)/2; s += `<rect x="${m-45}" y="${y0}" width="40" height="${L*.55}" fill="#fff" ${DS}/><rect x="${m+5}" y="${y1-L*.55}" width="40" height="${L*.55}" fill="#fff" ${DS}/>`; }
    else { const L = x1-x0, m = (y0+y1)/2; s += `<rect x="${x0}" y="${m-45}" width="${L*.55}" height="40" fill="#fff" ${DS}/><rect x="${x1-L*.55}" y="${m+5}" width="${L*.55}" height="40" fill="#fff" ${DS}/>`; }
  });
  $('#gOpen').innerHTML = s;
}

function renderLabels(){
  const g = $('#gLabels');
  g.setAttribute('display', ui.layers.labels ? 'inline' : 'none');
  g.innerHTML = ROOMS.filter(r => r.at).map(r => {
    const [x,y] = r.at, halo = 'stroke="#fbf9f4" stroke-width="45" paint-order="stroke" stroke-linejoin="round"';
    return `<text x="${x}" y="${y}" font-size="250" font-weight="600" text-anchor="middle" fill="#2b2824" ${halo}>${esc(state.rooms[r.id].name)}</text>
      <text x="${x}" y="${y+260}" font-size="175" text-anchor="middle" fill="#7d7366" ${halo}>${fmt(area(r.poly))} m²</text>`;
  }).join('');
}

function renderDims(){
  const DC = '#7d7160', LS = `stroke="${DC}" stroke-width="1" vector-effect="non-scaling-stroke"`, TK = `stroke="${DC}" stroke-width="2" vector-effect="non-scaling-stroke"`;
  const txt = (x,y,v,rot) => `<text x="${x}" y="${y}" font-size="${v<400?140:200}" text-anchor="middle" fill="${DC}" ${rot?`transform="rotate(-90 ${x} ${y})"`:''}>${Math.round(v)}</text>`;
  const chain = (horiz, at, start, segs) => {
    const pts = [start]; segs.forEach(v => pts.push(pts[pts.length-1] + v));
    let s = horiz ? `<line x1="${pts[0]}" y1="${at}" x2="${pts.at(-1)}" y2="${at}" ${LS}/>` : `<line x1="${at}" y1="${pts[0]}" x2="${at}" y2="${pts.at(-1)}" ${LS}/>`;
    pts.forEach(p => s += horiz
      ? `<line x1="${p}" y1="${at-170}" x2="${p}" y2="${at+170}" ${LS}/><line x1="${p-80}" y1="${at+80}" x2="${p+80}" y2="${at-80}" ${TK}/>`
      : `<line x1="${at-170}" y1="${p}" x2="${at+170}" y2="${p}" ${LS}/><line x1="${at-80}" y1="${p+80}" x2="${at+80}" y2="${p-80}" ${TK}/>`);
    segs.forEach((v,i) => { const mid = (pts[i] + pts[i+1]) / 2; s += horiz ? txt(mid, at-70, v) : txt(at-70, mid, v, true); });
    return s;
  };
  const g = $('#gDims'), dims = state.plan.dimensions || [];
  g.innerHTML = dims.map(d => {
    const segs = Array.isArray(d.segments) ? d.segments.filter(Number.isFinite) : [];
    if (!segs.length || !Number.isFinite(d.offset) || !Number.isFinite(d.start)) return '';
    return chain(d.orientation !== 'v', d.offset, d.start, segs);
  }).join('');
  g.setAttribute('display', ui.layers.dims && g.innerHTML ? 'inline' : 'none');
}

function renderGrid(){
  $('#gGrid').innerHTML = `<rect x="-20000" y="-20000" width="55000" height="55000" fill="${ui.layers.grid ? 'url(#grid)' : 'transparent'}" data-bg="1"/>`;
}

function renderMeasure(){
  const k = 1/view.s, fs = 12*k;
  const one = (a,b,tmp) => {
    const L = Math.hypot(b.x-a.x, b.y-a.y); if (L < 1) return '';
    let ang = Math.atan2(b.y-a.y, b.x-a.x)*180/Math.PI; if (ang > 90 || ang < -90) ang += 180;
    const mx = (a.x+b.x)/2, my = (a.y+b.y)/2, nx = -(b.y-a.y)/L*5*k, ny = (b.x-a.x)/L*5*k;
    const col = tmp ? '#2f5d62' : '#b5653a', S = `stroke="${col}" stroke-width="1.5" vector-effect="non-scaling-stroke"`;
    return `<line x1="${a.x}" y1="${a.y}" x2="${b.x}" y2="${b.y}" ${S}/>
      <line x1="${a.x-nx}" y1="${a.y-ny}" x2="${a.x+nx}" y2="${a.y+ny}" ${S}/><line x1="${b.x-nx}" y1="${b.y-ny}" x2="${b.x+nx}" y2="${b.y+ny}" ${S}/>
      <text x="${mx}" y="${my-5*k}" font-size="${fs}" text-anchor="middle" fill="${col}" font-weight="600" transform="rotate(${ang} ${mx} ${my})"
        stroke="#fff" stroke-width="${3.5*k}" paint-order="stroke">${Math.round(L)} mm</text>`;
  };
  let s = state.measures.map(m => one(m.a,m.b)).join('');
  if (ui.mA && ui.mCur) s += one(ui.mA, ui.mCur, true);
  if (ui.mA) s += `<circle cx="${ui.mA.x}" cy="${ui.mA.y}" r="${3*k}" fill="#2f5d62"/>`;
  $('#gMeasure').innerHTML = s;
}

function renderSel(){
  const k = 1/view.s; let s = '';
  if (ui.sel?.kind === 'furn'){
    const f = getF(ui.sel.id);
    if (f){
      // 触屏上手柄更大、离家具更远，并各带一圈透明的大热区
      const p = 5*k, A = 'stroke="#b5653a" vector-effect="non-scaling-stroke"', hs = COARSE ? 1.7 : 1, ro = (COARSE ? 40 : 26)*k, hit = (COARSE ? 24 : 11)*k;
      const sx = f.w/2+p, sy = f.d/2+p;
      s += `<g transform="translate(${f.cx} ${f.cy}) rotate(${f.rot})">
        <rect x="${-f.w/2-p}" y="${-f.d/2-p}" width="${f.w+2*p}" height="${f.d+2*p}" fill="none" ${A} stroke-width="1.5" stroke-dasharray="5 3" pointer-events="none"/>
        <line x1="0" y1="${-f.d/2-p}" x2="0" y2="${-f.d/2-ro}" ${A} stroke-width="1" pointer-events="none"/>
        <circle data-handle="rot" cx="0" cy="${-f.d/2-ro}" r="${hit}" fill="transparent"/>
        <circle data-handle="rot" cx="0" cy="${-f.d/2-ro}" r="${6*hs*k}" fill="#fff" ${A} stroke-width="1.5"><title>拖动旋转（Shift 自由角度）</title></circle>
        <circle data-handle="size" cx="${sx}" cy="${sy}" r="${hit}" fill="transparent"/>
        <rect data-handle="size" x="${sx-5*hs*k}" y="${sy-5*hs*k}" width="${10*hs*k}" height="${10*hs*k}" fill="#b5653a"><title>拖动调整尺寸</title></rect></g>`;
      const {hh} = aabb(f);
      s += `<text x="${f.cx}" y="${f.cy+hh+24*k}" font-size="${12*k}" text-anchor="middle" fill="#b5653a" font-weight="600" pointer-events="none"
        stroke="#fff" stroke-width="${3*k}" paint-order="stroke">${f.w} × ${f.d}</text>`;
    }
  } else if (ui.sel?.kind === 'room'){
    const r = ROOMS.find(r => r.id === ui.sel.id);
    s += `<polygon points="${r.poly.map(p=>p.join(',')).join(' ')}" fill="rgba(181,101,58,.08)" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  }
  $('#gSel').innerHTML = s;
}

function renderAll(){
  renderGrid(); renderRooms(); renderFurn(); renderWalls(); renderOpenings(); renderDims(); renderLabels(); renderMeasure(); renderSel(); renderPanel(); updateHeader();
  window.PlanEditor?.syncRender?.();
  window.View3D?.sync();
}

function updateHeader(){
  const tot = ROOMS.filter(r => r.counted !== false).reduce((a,r) => a + area(r.poly), 0);
  $('#subtitle').textContent = `套内使用面积约 ${fmt(tot)} m² · 尺寸单位 mm · 原图比例 1:60`;
  $('#undo').disabled = !undoStack.length; $('#redo').disabled = !redoStack.length;
  $('#undo').style.opacity = undoStack.length ? 1 : .4; $('#redo').style.opacity = redoStack.length ? 1 : .4;
}

/* ======================= 右侧面板 ======================= */
function renderPanel(){
  renderFab();
  const p = $('#panel');
  if (ui.sel?.kind === 'furn'){ const f = getF(ui.sel.id); if (f){ p.innerHTML = furnPanel(f); bindFurnPanel(f); return; } }
  if (ui.sel?.kind === 'room'){ p.innerHTML = roomPanel(ROOMS.find(r => r.id === ui.sel.id)); bindRoomPanel(); return; }
  p.innerHTML = overviewPanel(); bindOverview();
}

function overviewPanel(){
  const rows = ROOMS.map(r => {
    const st = state.rooms[r.id];
    return `<tr class="click" data-room="${r.id}"><td><span class="sw" style="background:${MATS[st.mat].sw}"></span>${esc(st.name)}${r.counted===false?' <span class="muted">*</span>':''}</td>
      <td class="r">${fmt(area(r.poly))} m²</td></tr>`;
  }).join('');
  const tot = ROOMS.filter(r => r.counted !== false).reduce((a,r) => a + area(r.poly), 0);
  const byMat = {};
  ROOMS.forEach(r => { const m = state.rooms[r.id].mat; byMat[m] = (byMat[m]||0) + area(r.poly); });
  let cost = 0;
  const matRows = Object.entries(byMat).map(([m,a]) => { const c = a*MATS[m].price*1.05; cost += c;
    return `<tr><td><span class="sw" style="background:${MATS[m].sw}"></span>${MATS[m].name}</td><td class="r">${fmt(a,1)} m²</td><td class="r">¥${Math.round(c).toLocaleString()}</td></tr>`; }).join('');
  const dem = state.demolished.map(id => WALLS[+id.slice(1)]);
  const demLen = dem.reduce((a,w) => a + Math.max(w[2]-w[0], w[3]-w[1]), 0) / 1000;
  return `
  <section><h3>房间面积 <small>点击查看 / 更换地面</small></h3>
    <table>${rows}</table>
    <div class="total"><span>套内使用面积</span><b>${fmt(tot)} m²</b></div>
    <div class="muted" style="font-size:11px;margin-top:4px">* 飘窗不计入使用面积；面积按墙体内净尺寸计算</div></section>
  <section><h3>地面材料估算 <small>含 5% 损耗</small></h3>
    <table>${matRows}</table>
    <div class="total"><span>地面材料合计</span><b>¥${Math.round(cost).toLocaleString()}</b></div></section>
  <section><h3>方案统计</h3>
    <div class="stats"><div><small>家具数量</small><span class="big">${state.furniture.length}</span></div>
      <div><small>拆除墙体</small><span class="big">${fmt(demLen,1)}</span> m</div></div>
    <div class="actions"><button class="btn" id="clearMeasure">清除测量 (${state.measures.length})</button>
      <button class="btn danger" id="clearFurn">清空家具</button></div></section>
  ${COARSE ? `<section><h3>触屏操作</h3><div class="kbd">
    <kbd>单指拖动</kbd><span>空白处平移画面</span><kbd>双指</kbd><span>捏合缩放、拖动平移</span>
    <kbd>家具库</kbd><span>点一下放到画面中央，或按住向右拖到指定位置</span>
    <kbd>点家具</kbd><span>选中后拖动移动；拖顶部圆点旋转、右下方块改尺寸</span>
    <kbd>工具条</kbd><span>选中后底部可旋转 / 复制 / 删除</span>
    <kbd>测量</kbd><span>按住拖出一条线，或依次点两点</span>
    <kbd>3D 漫游</kbd><span>左下摇杆移动，拖动屏幕转向，点门开关</span>
  </div></section>` : ''}
  ${`<section><h3>键盘快捷键</h3><div class="kbd">
    <kbd>拖拽</kbd><span>左侧家具拖入平面图</span><kbd>V</kbd><span>选择 / 移动</span><kbd>M</kbd><span>测量（Shift 水平/垂直）</span>
    <kbd>X</kbd><span>拆改非承重墙（黑色为承重墙）</span><kbd>R</kbd><span>旋转 90°（Shift 反向）</span><kbd>方向键</kbd><span>微调 10mm（Shift 100mm）</span>
    <kbd>⌘/Ctrl D</kbd><span>复制</span><kbd>Delete</kbd><span>删除</span><kbd>⌘/Ctrl Z</kbd><span>撤销</span><kbd>T</kbd><span>切换 2D / 3D</span><kbd>F</kbd><span>适应窗口</span><kbd>Esc</kbd><span>取消选择</span>
  </div></section>`}`;
}
function bindOverview(){
  document.querySelectorAll('#panel tr[data-room]').forEach(tr => tr.onclick = () => { select({kind:'room', id:tr.dataset.room}); if (is3D()) window.View3D.flyToRoom(tr.dataset.room); });
  $('#clearMeasure').onclick = () => state.measures.length && mutate(() => state.measures = []);
  $('#clearFurn').onclick = clearLayout;
}

// 底部浮动工具条：触屏没有键盘，旋转 / 复制 / 删除都放在这里
function renderFab(){
  const fab = $('#fab'), f = ui.sel?.kind === 'furn' && getF(ui.sel.id), r = ui.sel?.kind === 'room' && ROOMS.find(r => r.id === ui.sel.id);
  if (!f && !r){ fab.classList.remove('show'); return; }
  fab.innerHTML = f
    ? `<span class="name">${esc(f.name)}</span><button class="btn" data-a="rotL">↺</button><button class="btn" data-a="rotR">↻ 旋转</button>
       <button class="btn" data-a="dup">复制</button><button class="btn danger" data-a="del">删除</button><span class="sep"></span>
       <button class="btn narrow-only" data-a="prop">属性</button><button class="btn" data-a="done">完成</button>`
    : `<span class="name">${esc(state.rooms[r.id].name)}</span><button class="btn narrow-only" data-a="prop">地面 / 属性</button><button class="btn" data-a="done">完成</button>`;
  fab.classList.add('show');
  fab.querySelectorAll('[data-a]').forEach(b => b.onclick = () => ({
    rotL:() => rotateSel(-90), rotR:() => rotateSel(90), dup:duplicateSel, del:deleteSel,
    prop:() => drawer('panel', true), done:() => { select(null); closeDrawers(); },
  })[b.dataset.a]());
}

function clearLayout(){
  const n = state.furniture.length;
  if (!n) return toast('当前没有布置任何家具');
  if (!confirm(`确定清空全部 ${n} 件家具 / 家电吗？\n墙体、地面材料和测量线会保留，可点「撤销」恢复。`)) return;
  ui.sel = null; mutate(() => state.furniture = []);
  toast('已清空家具，可点「撤销」恢复');
}

function clearCanvas(){
  const hasContent = state.furniture.length || state.plan.walls.length || state.plan.wins.length
    || state.plan.doors.length || state.plan.slides.length || state.plan.rooms.length
    || state.plan.dimensions.length || Object.keys(state.rooms).length
    || state.demolished.length || state.measures.length;
  if (!hasContent) return toast('当前画布已经为空');
  if (!confirm('确定清空整个画布吗？\n家具、墙体、门窗、房间、地面材料、拆改标记和测量线都会删除，可点「撤销」恢复。')) return;
  ui.sel = null;
  ui.mA = null;
  ui.mCur = null;
  mutate(() => {
    replaceState(defaultState());
    syncPlanRefs();
    renderOpenings();
  });
  toast('已清空画布，可点「撤销」恢复');
}

/* 侧栏开合：which = 'lib' | 'panel' | null，open 不传则切换。
 * 宽屏：侧栏在布局中收起 / 展开（记住选择）；窄屏：侧栏是浮层抽屉，一次只开一个，which = null 表示全部关闭 */
const PANES = 'huxing-panes';
const panes = (() => { try { return JSON.parse(localStorage.getItem(PANES)) || {}; } catch(e) { return {}; } })();
function drawer(which, open){
  const app = $('.app'), els = {lib:$('aside.lib'), panel:$('aside.right')}, n = narrow();
  if (n){
    Object.entries(els).forEach(([k, el]) => el.classList.toggle('open', k === which && (open ?? !el.classList.contains('open'))));
  } else {
    Object.values(els).forEach(el => el.classList.remove('open'));
    if (which){
      const k = which === 'lib' ? 'hideLib' : 'hidePanel';
      panes[k] = open === undefined ? !panes[k] : !open;
      try { localStorage.setItem(PANES, JSON.stringify(panes)); } catch(e) {}
    }
  }
  app.classList.toggle('hide-lib', !!panes.hideLib); app.classList.toggle('hide-panel', !!panes.hidePanel);
  syncPaneBtns();
}
function syncPaneBtns(){
  const els = {lib:$('aside.lib'), panel:$('aside.right')}, n = narrow();
  const vis = k => n ? els[k].classList.contains('open') : !panes[k === 'lib' ? 'hideLib' : 'hidePanel'];
  const planActive = window.PlanEditor?.isActive?.() === true;
  $('#tgPlan').classList.toggle('on', planActive);
  $('#tgLib').classList.toggle('on', !planActive && vis('lib'));
  $('#tgPanel').classList.toggle('on', vis('panel'));
  $('#tgLib').title = vis('lib') ? '收起家具库 ( [ )' : '展开家具库 ( [ )';
  $('#tgPanel').title = vis('panel') ? '收起属性面板 ( ] )' : '展开属性面板 ( ] )';
  $('#stage').classList.toggle('drawer-panel', n && vis('panel'));   // 属性抽屉盖住画面时让出底部工具条
}
function closeDrawers(){ if (narrow()) drawer(null); }

function roomPanel(r){
  const st = state.rooms[r.id], a = area(r.poly), [x0,y0,x1,y1] = bbox(r.poly), inside = state.furniture.filter(f => f.cx>x0&&f.cx<x1&&f.cy>y0&&f.cy<y1);
  const mats = Object.entries(MATS).map(([k,m]) => `<button class="mat ${k===st.mat?'on':''}" data-mat="${k}"><i style="background:${m.sw}"></i><span>${m.name}<small>¥${m.price}/m²</small></span></button>`).join('');
  return `<section><h3>房间</h3>
    <div class="form"><label class="full">名称<input id="rName" value="${esc(st.name)}"></label></div>
    <div class="stats" style="margin-top:10px">
      <div><small>使用面积</small><span class="big">${fmt(a)}</span> m²</div>
      <div><small>周长</small><span class="big">${fmt(perim(r.poly),1)}</span> m</div>
      <div><small>开间</small><span class="big">${x1-x0}</span> mm</div>
      <div><small>进深</small><span class="big">${y1-y0}</span> mm</div></div>
    <div class="muted">${`墙面面积（层高 2.8m，未扣门窗）约 ${fmt(perim(r.poly)*2.8,1)} m²`}</div></section>
  <section><h3>地面材料</h3><div class="mats">${mats}</div>
    <div class="total"><span>材料估价</span><b>¥${Math.round(a*MATS[st.mat].price*1.05).toLocaleString()}</b></div></section>
  <section><h3>房间内家具 <small>${`${inside.length} 件`}</small></h3>
    <table>${inside.map(f => `<tr class="click" data-fid="${f.id}"><td>${esc(f.name)}</td><td class="r muted">${f.w}×${f.d}</td></tr>`).join('') || `<tr><td class="muted">暂无</td></tr>`}</table>
    <div class="actions"><button class="btn" id="back">← 返回总览</button></div></section>`;
}
function bindRoomPanel(){
  const id = ui.sel.id;
  $('#rName').onchange = e => mutate(() => state.rooms[id].name = e.target.value.trim() || state.rooms[id].name);
  document.querySelectorAll('#panel [data-mat]').forEach(b => b.onclick = () => mutate(() => state.rooms[id].mat = b.dataset.mat));
  document.querySelectorAll('#panel tr[data-fid]').forEach(tr => tr.onclick = () => select({kind:'furn', id:tr.dataset.fid}));
  $('#back').onclick = () => select(null);
}

function furnPanel(f){
  return `<section><h3>家具属性</h3>
    <div class="form">
      <label class="full">名称<input id="fName" value="${esc(f.name)}"></label>
      <label>宽 (mm)<input type="number" id="fW" value="${f.w}" min="50" step="10"></label>
      <label>深 (mm)<input type="number" id="fD" value="${f.d}" min="50" step="10"></label>
      <label>中心 X (mm)<input type="number" id="fX" value="${Math.round(f.cx)}" step="10"></label>
      <label>中心 Y (mm)<input type="number" id="fY" value="${Math.round(f.cy)}" step="10"></label>
      <label>旋转 (°)<input type="number" id="fR" value="${f.rot}" step="15"></label>
      <label>颜色<input type="color" id="fC" value="${f.color}"></label>
    </div>
    <div class="muted" style="margin-top:8px">占地面积 ${fmt(f.w*f.d/1e6)} m²</div>
    <div class="actions">
      <button class="btn" id="aRot">旋转 90°</button><button class="btn" id="aDup">复制</button>
      <button class="btn" id="aTop">置于顶层</button><button class="btn" id="aBot">置于底层</button>
      <button class="btn danger" id="aDel">删除</button><button class="btn" id="back">← 返回</button>
    </div></section>
  <section class="muted" style="font-size:12px">拖动家具移动；拖动上方圆点旋转；拖动右下角方块调整尺寸。开启「吸附」后绘制和移动时会自动贴齐。</section>`;
}
function bindFurnPanel(f){
  const upd = (fn) => mutate(() => { const g = getF(f.id); if (g) fn(g); });
  const num = (id, fn) => $(id).onchange = e => { const v = parseFloat(e.target.value); if (!isNaN(v)) upd(g => fn(g, v)); };
  $('#fName').onchange = e => upd(g => g.name = e.target.value.trim() || g.name);
  num('#fW', (g,v) => g.w = Math.max(50, Math.round(v)));
  num('#fD', (g,v) => g.d = Math.max(50, Math.round(v)));
  num('#fX', (g,v) => g.cx = v); num('#fY', (g,v) => g.cy = v); num('#fR', (g,v) => g.rot = norm(v));
  $('#fC').onchange = e => upd(g => g.color = e.target.value);
  $('#aRot').onclick = () => rotateSel(90);
  $('#aDup').onclick = duplicateSel;
  $('#aDel').onclick = deleteSel;
  $('#aTop').onclick = () => mutate(() => { const i = state.furniture.findIndex(g => g.id===f.id); state.furniture.push(...state.furniture.splice(i,1)); });
  $('#aBot').onclick = () => mutate(() => { const i = state.furniture.findIndex(g => g.id===f.id); state.furniture.unshift(...state.furniture.splice(i,1)); });
  $('#back').onclick = () => select(null);
}

/* ======================= 操作 ======================= */
function select(sel){ ui.sel = sel; renderSel(); renderPanel(); }
function rotateSel(d){ if (ui.sel?.kind==='furn') mutate(() => { const f = getF(ui.sel.id); f.rot = norm(f.rot + d); }); }
function deleteSel(){ if (ui.sel?.kind==='furn'){ const id = ui.sel.id; ui.sel = null; mutate(() => state.furniture = state.furniture.filter(f => f.id !== id)); } }
function duplicateSel(){
  if (ui.sel?.kind !== 'furn') return;
  const f = getF(ui.sel.id), n = {...f, id:uid(), cx:f.cx+200, cy:f.cy+200};
  ui.sel = {kind:'furn', id:n.id}; mutate(() => state.furniture.push(n));
}
// 新放下的家具若压在墙 / 窗上，沿穿透较浅的方向推出来，刚好贴墙
function pushOut(f){
  for (let n = 0; n < 4; n++){
    let moved = false;
    for (const r of snapRects()){
      const {hw, hh} = aabb(f), ox = Math.min(f.cx+hw, r[2]) - Math.max(f.cx-hw, r[0]), oy = Math.min(f.cy+hh, r[3]) - Math.max(f.cy-hh, r[1]);
      if (ox <= 0 || oy <= 0) continue;
      if (ox < oy) f.cx = f.cx < (r[0]+r[2])/2 ? r[0]-hw : r[2]+hw;
      else f.cy = f.cy < (r[1]+r[3])/2 ? r[1]-hh : r[3]+hh;
      moved = true;
    }
    if (!moved) return;
  }
}
function addItem(it, x, y){
  const [type,name,w,d,color] = it, f = F(type,name,Math.round(x/10)*10,Math.round(y/10)*10,w,d,0,color);
  pushOut(f);
  ui.sel = {kind:'furn', id:f.id};
  mutate(() => type==='rug' ? state.furniture.unshift(f) : state.furniture.push(f));
  toast(`已添加「${name}」${w}×${d}`);
}
function toggleWall(id){
  const w = WALLS[+id.slice(1)];
  if (w[4]==='b') return toast('承重墙（黑色）不可拆除');
  if (w[4]==='e') return toast('外墙属于建筑外围护结构，不建议拆除');
  const on = state.demolished.includes(id);
  mutate(() => state.demolished = on ? state.demolished.filter(x => x!==id) : [...state.demolished, id]);
  toast(on ? '已恢复墙体' : `已标记拆除 ${Math.max(w[2]-w[0], w[3]-w[1])} mm 墙体`);
}

function setTool(t){
  ui.tool = t; ui.mA = null; ui.mCur = null;
  svg.setAttribute('class', 'tool-' + t);
  document.querySelectorAll('#tools .btn').forEach(b => b.classList.toggle('on', b.dataset.tool === t));
  syncModeHint();
  renderMeasure();
}
function syncModeHint(){
  const hints = {select:'',
    measure:COARSE ? '按住拖出测量线，或依次点两点 · 靠近墙面自动吸附 · 点「选择」退出'
      : '点击两点（或按住拖动）测量距离 · 靠近墙面自动吸附 · Shift 锁定水平/垂直 · Esc 取消',
    demolish:'点击灰色非承重墙标记拆除，再次点击恢复 · 黑色承重墙不可拆'};
  const h = $('#modehint'); h.textContent = hints[ui.tool]; h.classList.toggle('show', !!hints[ui.tool]);
}

/* ======================= 视图 ======================= */
function applyView(){
  const W = svg.clientWidth, H = svg.clientHeight;
  svg.setAttribute('viewBox', `${view.x0} ${view.y0} ${W/view.s} ${H/view.s}`);
  const ratio = 1/(view.s*PX_MM);
  $('#ratio').textContent = '1:' + Math.round(ratio);
  const nice = [100,200,500,1000,2000,5000].find(v => v*view.s >= 60) || 5000;
  $('#sbBar').style.width = nice*view.s + 'px';
  $('#sbText').textContent = nice >= 1000 ? `${nice/1000} m` : `${nice} mm`;
  renderSel(); renderMeasure(); window.PlanEditor?.syncOverlay?.();
}
function fitView(){
  const W = svg.clientWidth, H = svg.clientHeight;
  view.s = Math.min(W/BOUNDS.w, H/BOUNDS.h);
  view.x0 = BOUNDS.x - (W/view.s - BOUNDS.w)/2; view.y0 = BOUNDS.y - (H/view.s - BOUNDS.h)/2;
  applyView();
}
function zoomAt(ns, mx, my){
  ns = Math.max(.012, Math.min(2, ns));
  const px = view.x0 + mx/view.s, py = view.y0 + my/view.s;
  view.s = ns; view.x0 = px - mx/ns; view.y0 = py - my/ns; applyView();
}
const zoomCenter = k => zoomAt(view.s*k, svg.clientWidth/2, svg.clientHeight/2);
const setRatio = r => zoomAt(1/(r*PX_MM), svg.clientWidth/2, svg.clientHeight/2);

function toMM(e){
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}

/* ======================= 吸附 ======================= */
const grid = () => 10;
function snapMove(f, cx, cy){
  let nx = Math.round(cx/grid())*grid(), ny = Math.round(cy/grid())*grid();
  if (!ui.layers.wallSnap) return [nx, ny];
  const {hw, hh} = aabb(f), tol = 10/view.s;
  let bx = tol, by = tol;
  for (const r of snapRects()){
    if (!(r[3] < cy-hh-tol || r[1] > cy+hh+tol)) for (const ex of [r[0], r[2]]) for (const c of [ex+hw, ex-hw]) if (Math.abs(c-cx) < bx){ bx = Math.abs(c-cx); nx = c; }
    if (!(r[2] < cx-hw-tol || r[0] > cx+hw+tol)) for (const ey of [r[1], r[3]]) for (const c of [ey+hh, ey-hh]) if (Math.abs(c-cy) < by){ by = Math.abs(c-cy); ny = c; }
  }
  return [nx, ny];
}
function snapPoint(p, shift){
  let x = Math.round(p.x/10)*10, y = Math.round(p.y/10)*10;
  const tol = 8/view.s; let bx = tol, by = tol;
  for (const r of snapRects()){
    for (const ex of [r[0], r[2]]) if (Math.abs(ex-p.x) < bx){ bx = Math.abs(ex-p.x); x = ex; }
    for (const ey of [r[1], r[3]]) if (Math.abs(ey-p.y) < by){ by = Math.abs(ey-p.y); y = ey; }
  }
  if (shift && ui.mA){ if (Math.abs(x-ui.mA.x) > Math.abs(y-ui.mA.y)) y = ui.mA.y; else x = ui.mA.x; }
  return {x, y};
}

/* ======================= 指针交互 ======================= */
let drag = null, pinch = null;
const touches = new Map();                     // 当前按在平面图上的手指
const svgXY = (x, y) => { const r = svg.getBoundingClientRect(); return [x - r.left, y - r.top]; };
function pinchInfo(){
  const [a, b] = [...touches.values()];
  return {d:Math.max(1, Math.hypot(b.x-a.x, b.y-a.y)), c:svgXY((a.x+b.x)/2, (a.y+b.y)/2)};
}
// 结束当前拖动：移动过的家具记入撤销栈
function endDrag(cancel){
  const d = drag; drag = null; svg.classList.remove('panning');
  if (!d) return;
  if (d.kind === 'measure'){
    if (cancel){ ui.mA = ui.mCur = null; renderMeasure(); return; }
    if (d.moved && ui.mA && ui.mCur && Math.hypot(ui.mCur.x-ui.mA.x, ui.mCur.y-ui.mA.y) > 20){
      const a = ui.mA, b = ui.mCur; ui.mA = ui.mCur = null; mutate(() => state.measures.push({a, b}));
    }
    renderMeasure(); return;                   // 没拖动：保留起点，等第二次点击
  }
  if (d.kind === 'pan'){
    if (!cancel && !d.moved && ui.tool === 'select') select(d.room ? {kind:'room', id:d.room} : null);
    return;
  }
  if (d.moved){ commit(d.before); renderAll(); }
}

svg.addEventListener('pointerdown', e => {
  if (e.button === 1 || e.button === 2) return;
  closeDrawers(); $('details.menu').open = false;
  if (e.pointerType !== 'mouse'){
    touches.set(e.pointerId, {x:e.clientX, y:e.clientY});
    svg.setPointerCapture(e.pointerId);
    if (touches.size >= 2){                    // 第二根手指落下：取消单指操作，进入双指缩放 / 平移
      endDrag(drag?.kind === 'measure' || drag?.kind === 'pan');
      const {d, c} = pinchInfo();
      pinch = {d, c, s:view.s, px:view.x0 + c[0]/view.s, py:view.y0 + c[1]/view.s};
      return;
    }
  }
  if (pinch) return;
  const p = toMM(e), t = e.target;
  if (ui.tool === 'measure'){
    const q = snapPoint(p, e.shiftKey);
    if (!ui.mA){ ui.mA = q; ui.mCur = q; drag = {kind:'measure', sx:e.clientX, sy:e.clientY, moved:false}; svg.setPointerCapture(e.pointerId); }
    else { const a = ui.mA; ui.mA = null; ui.mCur = null; if (Math.hypot(q.x-a.x, q.y-a.y) > 20) mutate(() => state.measures.push({a, b:q})); }
    renderMeasure(); return;
  }
  const h = t.closest('[data-handle]');
  if (h && ui.sel?.kind === 'furn'){
    drag = {kind:h.dataset.handle, id:ui.sel.id, sx:e.clientX, sy:e.clientY, before:snap(), moved:false};
  } else if (ui.tool === 'demolish' && t.closest('[data-wall]')){
    toggleWall(t.closest('[data-wall]').dataset.wall); return;
  } else if (ui.tool === 'select' && t.closest('[data-fid]')){
    const f = getF(t.closest('[data-fid]').dataset.fid);
    if (ui.sel?.id !== f.id) select({kind:'furn', id:f.id});
    drag = {kind:'move', id:f.id, sx:e.clientX, sy:e.clientY, ox:p.x-f.cx, oy:p.y-f.cy, before:snap(), moved:false};
  } else {
    const room = t.closest('[data-room]');
    drag = {kind:'pan', sx:e.clientX, sy:e.clientY, x0:view.x0, y0:view.y0, room:room && room.dataset.room, moved:false};
  }
  svg.setPointerCapture(e.pointerId);
});

svg.addEventListener('pointermove', e => {
  if (touches.has(e.pointerId)) touches.set(e.pointerId, {x:e.clientX, y:e.clientY});
  if (pinch){
    if (touches.size < 2) return;
    const {d, c} = pinchInfo(), ns = Math.max(.012, Math.min(2, pinch.s * d / pinch.d));
    view.s = ns; view.x0 = pinch.px - c[0]/ns; view.y0 = pinch.py - c[1]/ns; applyView();
    return;
  }
  const p = toMM(e);
  $('#cx').textContent = Math.round(p.x) + ' mm'; $('#cy').textContent = Math.round(p.y) + ' mm';
  if (!drag){
    const room = e.target.closest && e.target.closest('[data-room]');
    $('#hover').innerHTML = room ? `<b>${esc(state.rooms[room.dataset.room].name)}</b> ${fmt(area(ROOMS.find(r=>r.id===room.dataset.room).poly))} m²` : '';
    if (ui.tool === 'measure' && ui.mA){ ui.mCur = snapPoint(p, e.shiftKey); renderMeasure(); }
    return;
  }
  const far = Math.hypot(e.clientX-drag.sx, e.clientY-drag.sy) >= TAP;
  if (drag.kind === 'measure'){
    if (far) drag.moved = true;
    ui.mCur = snapPoint(p, e.shiftKey); renderMeasure(); return;
  }
  if (drag.kind === 'pan'){
    if (!drag.moved && !far) return;
    drag.moved = true; svg.classList.add('panning');
    view.x0 = drag.x0 - (e.clientX-drag.sx)/view.s; view.y0 = drag.y0 - (e.clientY-drag.sy)/view.s; applyView(); return;
  }
  const f = getF(drag.id); if (!f) return;
  if (!drag.moved && !far) return;             // 轻点家具不应让它抖动一下
  drag.moved = true;
  if (drag.kind === 'move'){
    [f.cx, f.cy] = snapMove(f, p.x-drag.ox, p.y-drag.oy);
  } else if (drag.kind === 'rot'){
    let a = Math.atan2(p.y-f.cy, p.x-f.cx)*180/Math.PI + 90;
    f.rot = norm(e.shiftKey ? a : Math.round(a/15)*15);
  } else if (drag.kind === 'size'){
    const a = f.rot*Math.PI/180, c = Math.cos(a), s = Math.sin(a);
    const dx = p.x-f.cx, dy = p.y-f.cy, lx = dx*c + dy*s, ly = -dx*s + dy*c;
    const ax = -f.w/2, ay = -f.d/2;
    const nw = Math.max(100, Math.round((lx-ax)/10)*10), nd = Math.max(100, Math.round((ly-ay)/10)*10);
    const mx = ax + nw/2, my = ay + nd/2;
    f.cx += mx*c - my*s; f.cy += mx*s + my*c; f.w = nw; f.d = nd;
  }
  renderFurn(); renderSel();
});

function onPointerEnd(e){
  touches.delete(e.pointerId);
  if (pinch){ if (touches.size < 2) pinch = null; return; }   // 双指结束后，剩下的手指不再触发操作
  endDrag(e.type === 'pointercancel');
}
svg.addEventListener('pointerup', onPointerEnd);
svg.addEventListener('pointercancel', onPointerEnd);
// 阻止 iPad Safari 把双指手势当成整页缩放
['gesturestart','gesturechange','gestureend'].forEach(t => document.addEventListener(t, e => e.preventDefault()));

svg.addEventListener('wheel', e => {
  e.preventDefault();
  const r = svg.getBoundingClientRect();
  zoomAt(view.s*Math.exp(-e.deltaY*(e.ctrlKey ? .01 : .0015)), e.clientX-r.left, e.clientY-r.top);
}, {passive:false});
svg.addEventListener('dblclick', e => { if (ui.tool==='select' && e.target.closest('[data-fid]')) rotateSel(90); });
svg.addEventListener('contextmenu', e => { if (ui.tool==='measure'){ e.preventDefault(); ui.mA = null; renderMeasure(); } });


/* ======================= 键盘 ======================= */
document.addEventListener('keydown', e => {
  if (e.target.matches('input,select,textarea')) return;
  if (window.View3D?.walking()) return;
  const mod = e.metaKey || e.ctrlKey, k = e.key.toLowerCase();
  if (mod && k === 'z'){ e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if (mod && k === 'y'){ e.preventDefault(); redo(); return; }
  if (mod && k === 'd'){ e.preventDefault(); duplicateSel(); return; }
  if (mod) return;
  if (k === '[' || k === ']'){ drawer(k === '[' ? 'lib' : 'panel'); return; }
  if (k === 'f' && e.shiftKey){ toggleFullscreen(); return; }
  if (k === 't') setView(is3D() ? '2d' : '3d');
  else if (is3D() && ['v','m','x','f','+','=','-'].includes(k)) return;
  else if (k === 'v') setTool('select');
  else if (k === 'm') setTool('measure');
  else if (k === 'x') setTool('demolish');
  else if (k === 'f') fitView();
  else if (k === 'r') rotateSel(e.shiftKey ? -90 : 90);
  else if (k === 'delete' || k === 'backspace'){ e.preventDefault(); deleteSel(); }
  else if (k === 'escape'){ if (ui.mA){ ui.mA = null; renderMeasure(); } else { if (ui.tool !== 'select') setTool('select'); select(null); } }
  else if (k.startsWith('arrow') && ui.sel?.kind === 'furn'){
    e.preventDefault(); const st = e.shiftKey ? 100 : 10;
    mutate(() => { const f = getF(ui.sel.id); if (k==='arrowleft') f.cx -= st; if (k==='arrowright') f.cx += st; if (k==='arrowup') f.cy -= st; if (k==='arrowdown') f.cy += st; });
  }
  else if (k === '+' || k === '=') zoomCenter(1.25);
  else if (k === '-') zoomCenter(.8);
});

/* ======================= 家具库 ======================= */
function buildLib(){
  $('#lib').innerHTML = LIB.map((c,ci) => `<h4>${c.cat}</h4><div class="lib-grid">${c.items.map((it,ii) => {
    const [t,n,w,d,col] = it, pad = Math.max(w,d)*.08;
    return `<div class="item" data-key="${ci}:${ii}" title="点击添加，或拖到平面图中的指定位置">
      <svg viewBox="${-w/2-pad} ${-d/2-pad} ${w+2*pad} ${d+2*pad}">${furnSVG(t,w,d,col)}</svg><b>${esc(n)}</b><small>${w}×${d}</small></div>`;
  }).join('')}</div>`).join('') + `<div class="hint">${`家具按真实尺寸（mm）绘制。${COARSE ? '点一下放到画面中央，或按住向右拖到平面图 / 3D 地面上的指定位置（上下滑动为滚动列表）。' : '点击添加到画面中央，或直接拖到平面图 / 3D 地面上。'}添加后可在右侧修改宽深与颜色。`}</div>`;
  document.querySelectorAll('.item').forEach(el => el.addEventListener('pointerdown', e => {
    if (e.button) return;
    libDrag = {el, id:e.pointerId, sx:e.clientX, sy:e.clientY, it:itemOf(el), ghost:null};
  }));
}
const itemOf = el => { const [ci, ii] = el.dataset.key.split(':').map(Number); return LIB[ci].items[ii]; };

// 家具库拖放：用 pointer 事件实现（iPad 上 HTML5 拖放不可靠）。
// 列表设置了 touch-action:pan-y，竖向滑动交给浏览器滚动（会触发 pointercancel），横向拖动才开始拖放。
let libDrag = null;
// 屏幕坐标 → 户型坐标（mm）。2D 取平面图坐标，3D 取射线与地面的交点；s = 该处每 mm 的屏幕像素数
function dropPoint(x, y){
  const r = $('#stage').getBoundingClientRect();
  if (x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
  if (document.elementFromPoint(x, y)?.closest('aside.open,#fab,#walkOverlay,#joy,#walkExit')) return null;
  if (is3D()) return window.View3D?.groundAt(x, y) || null;
  const p = toMM({clientX:x, clientY:y}); return {x:p.x, y:p.y, s:view.s};
}
addEventListener('pointermove', e => {
  if (!libDrag || e.pointerId !== libDrag.id) return;
  const {it} = libDrag;
  if (!libDrag.ghost){
    if (Math.hypot(e.clientX-libDrag.sx, e.clientY-libDrag.sy) < TAP) return;
    const g = libDrag.ghost = document.createElement('div'); g.id = 'ghost';
    g.innerHTML = `<svg viewBox="${-it[2]/2} ${-it[3]/2} ${it[2]} ${it[3]}">${furnSVG(it[0],it[2],it[3],it[4])}</svg>`;
    document.body.appendChild(g); libDrag.el.classList.add('dragging');
  }
  // 幽灵图按落点处的比例显示真实大小（3D 中近大远小）
  const g = libDrag.ghost, s = Math.max(dropPoint(e.clientX, e.clientY)?.s || (is3D() ? .05 : view.s), .02);
  Object.assign(g.style, {width:Math.max(28, it[2]*s)+'px', height:Math.max(20, it[3]*s)+'px', left:e.clientX+'px', top:e.clientY+'px'});
  const lib = $('aside.lib');
  if (narrow() && lib.classList.contains('open') && e.clientX > lib.getBoundingClientRect().right) drawer(null);   // 拖出抽屉后自动收起
});
function endLibDrag(e, ok){
  if (!libDrag || e.pointerId !== libDrag.id) return;
  const d = libDrag; libDrag = null;
  d.el.classList.remove('dragging');
  if (d.ghost){
    d.ghost.remove();
    if (!ok) return;
    const p = dropPoint(e.clientX, e.clientY);
    if (p) addItem(d.it, p.x, p.y);
    else if (is3D() && e.clientX > $('#stage').getBoundingClientRect().left) toast('请拖到地面上');
    return;
  }
  if (!ok) return;
  // 轻点：放到选中房间中心，否则放到画面中心（3D 取屏幕中心对应的地面位置）
  let p = null;
  if (ui.sel?.kind === 'room'){ const b = bbox(ROOMS.find(r => r.id===ui.sel.id).poly); p = {x:(b[0]+b[2])/2, y:(b[1]+b[3])/2}; }
  else if (is3D()){ const r = $('#stage').getBoundingClientRect(); p = window.View3D.groundAt(r.left + r.width/2, r.top + r.height/2); }
  if (!p) p = {x:view.x0 + svg.clientWidth/2/view.s, y:view.y0 + svg.clientHeight/2/view.s};
  addItem(d.it, p.x, p.y);
  closeDrawers();
}
addEventListener('pointerup', e => endLibDrag(e, true));
addEventListener('pointercancel', e => endLibDrag(e, false));

/* ======================= 导入导出 ======================= */
function download(name, blob){ const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }
function exportPNG(){
  if (is3D()) return window.View3D.shot();
  const clone = svg.cloneNode(true), W = 3200, H = Math.round(W*BOUNDS.h/BOUNDS.w);
  clone.setAttribute('viewBox', `${BOUNDS.x} ${BOUNDS.y} ${BOUNDS.w} ${BOUNDS.h}`);
  clone.setAttribute('width', W); clone.setAttribute('height', H);
  clone.querySelector('#gSel').innerHTML = '';
  clone.querySelector('#gGrid').innerHTML = `<rect x="-20000" y="-20000" width="55000" height="55000" fill="${ui.layers.grid?'url(#grid)':'#f7f4ee'}"/>`;
  const bg = document.createElementNS('http://www.w3.org/2000/svg','rect');
  Object.entries({x:-20000,y:-20000,width:55000,height:55000,fill:'#f7f4ee'}).forEach(([k,v]) => bg.setAttribute(k,v));
  clone.insertBefore(bg, clone.querySelector('#gGrid'));
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    cv.getContext('2d').drawImage(img, 0, 0, W, H);
    cv.toBlob(b => download('户型装修方案' + '.png', b));
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone));
}

/* ======================= 杂项 ======================= */
let toastT;
function toast(msg){ const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 1800); }

/* ======================= 2D / 3D 切换 ======================= */
let viewMode = '2d', switching = false;
const is3D = () => viewMode === '3d';
const TIPS = () => COARSE
  ? {'2d':'点或拖动家具库添加 · 单指拖动平移 · 双指缩放 · 选中家具后底部工具条可旋转 / 复制 / 删除',
     '3d':'单指旋转 · 双指缩放 / 平移 · 点家具或地面编辑 · 点门开关'}
  : {'2d':'拖动左侧家具到平面图 · 滚轮缩放 · 拖动空白处平移 · T 切换 3D',
     '3d':'3D 场景与平面方案实时同步 · 右侧面板修改会立即生效 · T 返回 2D'};
async function setView(m){
  if (m === viewMode || switching) return;
  if (!window.View3D) return toast('3D 引擎仍在加载或加载失败（需要联网加载 three.js）');
  switching = true; document.body.classList.add('busy');
  viewMode = m;
  if (m === '3d'){ if (ui.tool !== 'select') setTool('select'); ui.mA = null; document.body.classList.add('m3d'); await window.View3D.enter(); }
  else { document.body.classList.remove('m3d'); await window.View3D.exit(); applyView(); }
  $('#tip').textContent = TIPS()[m];
  switching = false; document.body.classList.remove('busy');
}
document.querySelectorAll('.menu-pop .btn').forEach(b => b.addEventListener('click', () => b.closest('details').open = false));
document.querySelectorAll('#viewSeg .btn').forEach(b => b.onclick = () => setView(b.dataset.view));

document.querySelectorAll('#tools .btn').forEach(b => b.onclick = () => setTool(b.dataset.tool));
function syncLayerButtons(){
  document.querySelectorAll('#layers .btn').forEach(b => b.classList.toggle('on', !!ui.layers[b.dataset.layer]));
}
syncLayerButtons();
document.querySelectorAll('#layers .btn').forEach(b => b.onclick = () => {
  const k = b.dataset.layer;
  ui.layers[k] = !ui.layers[k];
  saveLayers();
  b.classList.toggle('on', ui.layers[k]);
  if (k === 'dims') $('#gDims').setAttribute('display', ui.layers.dims ? 'inline' : 'none');
  else if (k === 'wallSnap') window.PlanEditor?.syncOverlay?.();
  else renderAll();
});
$('#zoomIn').onclick = () => zoomCenter(1.25);
$('#zoomOut').onclick = () => zoomCenter(.8);
$('#fit').onclick = fitView;
$('#s60').onclick = () => { setRatio(60); toast('已按 1:60 显示（与原始户型图同比例）'); };
$('#s100').onclick = () => setRatio(100);
$('#undo').onclick = undo; $('#redo').onclick = redo;
$('#clearAll').onclick = clearLayout;
$('#clearCanvas').onclick = clearCanvas;

/* 全屏：标准 API + Safari（iPad）的 webkit 前缀版本 */
const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
function toggleFullscreen(){
  const de = document.documentElement;
  if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
  else {
    const req = de.requestFullscreen || de.webkitRequestFullscreen;
    if (!req) return toast('当前浏览器不支持网页全屏，可在 Safari 中「添加到主屏幕」后以全屏方式打开');
    Promise.resolve(req.call(de)).catch(() => toast('无法进入全屏'));
  }
}
function syncFullscreen(){
  const on = !!fsEl(), b = $('#fullscreen');
  b.textContent = '⛶ ' + (on ? '退出全屏' : '全屏');
  b.title = (on ? '退出全屏' : '全屏') + ' (Shift+F)';
}
$('#fullscreen').onclick = toggleFullscreen;
['fullscreenchange', 'webkitfullscreenchange'].forEach(t => document.addEventListener(t, syncFullscreen));
// 已从主屏幕以独立 App 方式打开时本就是全屏，隐藏按钮
if (navigator.standalone || matchMedia('(display-mode: standalone)').matches) $('#fullscreen').hidden = true;
$('#tgLib').onclick = () => drawer('lib');
$('#tgPanel').onclick = () => drawer('panel');
// 触屏上点菜单以外的地方收起「文件」菜单
document.addEventListener('pointerdown', e => { const m = $('details.menu'); if (m.open && !m.contains(e.target)) m.open = false; });
matchMedia('(max-width:1100px)').addEventListener('change', () => drawer(null));
drawer(null);                                  // 恢复上次的面板收起状态
$('#exportPng').onclick = exportPNG;
$('#exportJson').onclick = () => download('户型装修方案' + '.json', new Blob([JSON.stringify(state, null, 2)], {type:'application/json'}));
$('#importJson').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = e => {
  const file = e.target.files[0]; if (!file) return;
  file.text().then(txt => {
    try { const s = JSON.parse(txt); if (!Array.isArray(s.furniture)) throw 0; const b = snap(); replaceState(s); renderOpenings(); ui.sel = null; commit(b); renderAll(); toast('方案已导入'); }
    catch(err){ toast('文件格式不正确'); }
  });
  e.target.value = '';
};
// 横竖屏切换、表头换行等都会改变画布尺寸；尺寸从 0 恢复（如首次布局）时重新适应窗口
// 其余尺寸变化（收起 / 展开面板等）保持画面中心不动
let lastW = 0, lastH = 0;
new ResizeObserver(() => {
  const w = svg.clientWidth, h = svg.clientHeight; if (!w) return;
  if (!lastW) fitView();
  else { view.x0 -= (w - lastW)/2/view.s; view.y0 -= (h - lastH)/2/view.s; applyView(); }
  lastW = w; lastH = h;
}).observe(svg);


syncFullscreen();
buildDefs(); buildLib(); renderOpenings();
$('#tip').textContent = TIPS()['2d'];
fitView(); renderAll();

export {
  BOUNDS,
  COARSE,
  DOORS,
  LIB,
  ROOMS,
  SLIDES,
  TAP,
  WALLS,
  WINS,
  applyView,
  closeDrawers,
  commit,
  drawer,
  getF,
  planWindowMarkup,
  renderAll,
  renderLabels,
  renderOpenings,
  renderRooms,
  renderWalls,
  replaceState,
  select,
  snap,
  snapMove,
  state,
  syncPlanRefs,
  ui,
  view
};