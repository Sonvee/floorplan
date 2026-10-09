import {$, area, esc, fmt, loadJson, perim, planToolSVG} from './utils.js';
import {
  DOORS,
  ROOMS,
  WALLS,
  WINS,
  applyView,
  commit,
  drawer,
  planWindowMarkup,
  renderAll,
  renderLabels,
  renderOpenings,
  renderRooms,
  renderWalls,
  replaceState,
  snap,
  renderDims,
  state,
  syncPlanRefs,
  ui,
  view
} from './app.js';
/* 户型编辑器：房间、墙体、窗户和门的独立绘制与编辑逻辑。 */
const planTools = $('#planTools');
const furnitureLibrary = $('#lib');
const planSvg = $('#plan');
const draftLayer = $('#gDraft');
const selectionLayer = $('#gSel');
const planPanel = $('#panel');
const planTypes = loadJson('assets/json/plan-elements.json');
const PANES = 'huxing-panes';

const PLAN_RULES = {
  grid: 10,
  snapTolerance: 12,
  orthogonalAngle: 10,
  editOrthogonalAngle: 3,
  editSnapTolerance: 4,
  wallThickness: 240,
  windowThickness: 240,
  floorWindowThickness: 240,
  bayWindowThickness: 240,
  bayWindowDepth: 570,
  doorThickness: 240,
  minimumPrimitiveLength: 100,
  minimumDoorLength: 500
};

const WALL_TYPES = Object.fromEntries((planTypes.walls || []).map(item => [item.type, item.name]));
const WINDOW_TYPES = Object.fromEntries((planTypes.windows || []).map(item => [item.type, item.name]));
const DOOR_SWINGS = Object.fromEntries((planTypes.doors || []).map(item => [item.type, item.name]));
const PLAN_DEFINITIONS = {
  wall: Object.fromEntries((planTypes.walls || []).map(item => [item.type, item])),
  window: Object.fromEntries((planTypes.windows || []).map(item => [item.type, item])),
  door: Object.fromEntries((planTypes.doors || []).map(item => [item.type, item]))
};

const editor = {
  active: false,
  mode: 'edit',
  type: null,
  selected: null,
  draft: {kind: null, type: null, points: [], start: null, current: null},
  guides: [],
  drag: null
};

const emptyDraft = () => ({kind: null, type: null, points: [], start: null, current: null});
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const samePoint = (a, b, tolerance = 1) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tolerance;
const nextId = prefix => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const safeWallType = value => WALL_TYPES[value] ? value : 'n';
const safeWindowType = value => WINDOW_TYPES[value] ? value : 'normal';
const safeDoorSwing = value => DOOR_SWINGS[value] ? value : 'in-left';
const clampPositive = (value, fallback, minimum = 1) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(minimum, parsed) : fallback;
};

function normalizeAxis(axis, rect) {
  if (axis === 'h' || axis === 'v') return axis;
  return Math.abs(rect[2] - rect[0]) >= Math.abs(rect[3] - rect[1]) ? 'h' : 'v';
}

function normalizeRect(values) {
  const [x0, y0, x1, y1] = values.map(Number);
  return [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)];
}

function normalizeRectEntity(entity, kind, type, fallbackType) {
  const values = normalizeRect(entity.slice(0, 4));
  const normalized = [...values, type(entity[4]) || fallbackType, normalizeAxis(entity[5], values)];
  if (kind === 'window' && normalized[4] === 'bay') {
    normalized[6] = Number(entity[6]) === 1 ? 1 : -1;
    normalized[7] = Number(entity[7]) > 0 ? Number(entity[7]) : PLAN_RULES.bayWindowDepth;
  }
  return normalized;
}

function ensurePlanData() {
  state.plan ||= {foundation: null, walls: [], wins: [], doors: [], rooms: [], dimensions: []};
  state.plan.foundation ??= null;
  state.demolished = Array.isArray(state.demolished) ? state.demolished : [];
  state.plan.walls = (state.plan.walls || []).filter(Array.isArray)
    .map(wall => normalizeRectEntity(wall, 'wall', safeWallType, 'n'));
  state.plan.wins = (state.plan.wins || []).filter(Array.isArray)
    .map(win => normalizeRectEntity(win, 'window', safeWindowType, 'normal'));
  state.plan.doors = (state.plan.doors || []).filter(door => door && Array.isArray(door.rect))
    .map(door => {
      const normalized = {...door, rect: normalizeRect(door.rect), swing: safeDoorSwing(door.swing), type: door.type || 'hinged'};
      normalized.axis = normalizeAxis(normalized.axis, normalized.rect);
      updateDoorGeometry(normalized);
      return normalized;
    });
  state.plan.rooms = (state.plan.rooms || []).filter(room => Array.isArray(room?.poly) && room.poly.length >= 3)
    .map(room => {
      const poly = room.poly.map(point => [Number(point[0]), Number(point[1])]);
      const legacyRectangle = !room.shape && isAxisAlignedRectangle({poly});
      return {
        ...room,
        id: room.id || nextId('r'),
        shape: room.shape === 'rectangle' || legacyRectangle ? 'rectangle' : 'polygon',
        poly
      };
    });
  state.rooms ||= {};
  state.plan.rooms.forEach(room => {
    state.rooms[room.id] ||= {name: room.name || room.id, mat: 'wood'};
    room.name ||= state.rooms[room.id].name || room.id;
    room.at = polygonCenter(room.poly);
  });
  syncPlanRefs();
}

function polygonCenter(polygon) {
  return polygon.reduce((sum, point) => [sum[0] + point[0] / polygon.length, sum[1] + point[1] / polygon.length], [0, 0]);
}

function roomRectBounds(room) {
  if (!room?.poly?.length) return null;
  const xs = room.poly.map(([x]) => x);
  const ys = room.poly.map(([, y]) => y);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function isAxisAlignedRectangle(room) {
  if (!room?.poly || room.poly.length !== 4) return false;
  const [x0, y0, x1, y1] = roomRectBounds(room);
  const corners = new Set([[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(point => point.join(',')));
  return room.poly.every(([x, y]) => corners.has(`${x},${y}`)) && corners.size === 4;
}

function isRoomRectangle(room) {
  return room?.shape === 'rectangle' && isAxisAlignedRectangle(room);
}

function roomRectDimensions(room) {
  const bounds = roomRectBounds(room);
  if (!bounds) return {length: 0, width: 0};
  return {length: bounds[2] - bounds[0], width: bounds[3] - bounds[1]};
}

function setRoomRectDimensions(room, length, width) {
  const bounds = roomRectBounds(room);
  if (!bounds) return;
  const current = roomRectDimensions(room);
  const nextLength = clampPositive(length, current.length, PLAN_RULES.minimumPrimitiveLength);
  const nextWidth = clampPositive(width, current.width, PLAN_RULES.minimumPrimitiveLength);
  const centerX = (bounds[0] + bounds[2]) / 2;
  const centerY = (bounds[1] + bounds[3]) / 2;
  const halfLength = nextLength / 2;
  const halfWidth = nextWidth / 2;
  room.poly = [
    [centerX - halfLength, centerY - halfWidth],
    [centerX + halfLength, centerY - halfWidth],
    [centerX + halfLength, centerY + halfWidth],
    [centerX - halfLength, centerY + halfWidth]
  ];
  room.at = polygonCenter(room.poly);
}

function roomRectDimensionMarkup(room) {
  const dimensions = roomRectDimensions(room);
  return `<label>长度<input type="number" id="planRoomLength" value="${Math.round(dimensions.length)}" min="${PLAN_RULES.minimumPrimitiveLength}" step="10"></label>
    <label>宽度<input type="number" id="planRoomWidth" value="${Math.round(dimensions.width)}" min="${PLAN_RULES.minimumPrimitiveLength}" step="10"></label>`;
}

function screenToPlan(event) {
  const point = planSvg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  return point.matrixTransform(planSvg.getScreenCTM().inverse());
}

function snappingEnabled() {
  return ui.layers.wallSnap !== false;
}

/**
 * 收集户型实体可用于吸附的线段和关键点。
 * 线段只负责“沿线投影”，关键点负责端点、中心点和交点的精确吸附。
 * @param {{kind?: string, index?: number}|null} exclude 不参与吸附的当前编辑对象
 * @returns {{segments: Array, points: Array}}
 */
function planSnapSegments(exclude = null) {
  const segments = [];
  const points = [];
  const isExcluded = owner => owner?.kind === exclude?.kind && owner?.index === exclude?.index;
  const addPoint = (x, y, owner) => points.push({x, y, owner});
  const addSegment = (x0, y0, x1, y1, axis = 'free', owner) => {
    segments.push({a: {x: x0, y: y0}, b: {x: x1, y: y1}, axis, owner});
  };
  const addRect = (rect, owner) => {
    if (!Array.isArray(rect) || rect.length < 4 || isExcluded(owner)) return;
    const [x0, y0, x1, y1] = rect;
    const centerX = (x0 + x1) / 2;
    const centerY = (y0 + y1) / 2;
    [[x0, y0], [x1, y0], [x1, y1], [x0, y1],
      [centerX, y0], [x1, centerY], [centerX, y1], [x0, centerY], [centerX, centerY]]
      .forEach(([x, y]) => addPoint(x, y, owner));
    addSegment(x0, y0, x1, y0, 'h', owner);
    addSegment(x1, y0, x1, y1, 'v', owner);
    addSegment(x1, y1, x0, y1, 'h', owner);
    addSegment(x0, y1, x0, y0, 'v', owner);
    addSegment(x0, centerY, x1, centerY, 'h', owner);
    addSegment(centerX, y0, centerX, y1, 'v', owner);
  };

  const foundation = state.plan.foundation;
  if (foundation && !isExcluded({kind: 'foundation', index: 0})) {
    const {x, y, width, height} = foundation;
    const corners = [[x, y], [x + width, y], [x + width, y + height], [x, y + height]];
    const owner = {kind: 'foundation', index: 0};
    corners.forEach(([x0, y0], index) => {
      const [x1, y1] = corners[(index + 1) % corners.length];
      addPoint(x0, y0, owner);
      addSegment(x0, y0, x1, y1, index % 2 ? 'v' : 'h', owner);
    });
  }
  WALLS.forEach((wall, index) => {
    if (!state.demolished.includes(`w${index}`)) addRect(wall, {kind: 'wall', index});
  });
  WINS.forEach((win, index) => addRect(windowFootprintRect(win), {kind: 'window', index}));
  DOORS.forEach((door, index) => addRect(door.rect, {kind: 'door', index}));
  ROOMS.forEach((room, roomIndex) => {
    const owner = {kind: 'room', index: roomIndex};
    if (isExcluded(owner)) return;
    room.poly.forEach((start, index) => {
      const end = room.poly[(index + 1) % room.poly.length];
      addPoint(start[0], start[1], owner);
      const axis = Math.abs(start[1] - end[1]) <= 1
        ? 'h'
        : Math.abs(start[0] - end[0]) <= 1 ? 'v' : 'free';
      addSegment(start[0], start[1], end[0], end[1], axis, owner);
    });
  });
  return {segments, points};
}

function closestPointOnSegment(point, segment) {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return {...segment.a};
  const ratio = Math.max(0, Math.min(1, ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) / lengthSquared));
  return {x: segment.a.x + dx * ratio, y: segment.a.y + dy * ratio};
}

/**
 * 在实体关键点和边线上寻找最近吸附目标。
 * @param {{x: number, y: number}} point 当前鼠标对应的户型坐标
 * @param {number} tolerance 户型坐标中的吸附容差
 * @param {{kind?: string, index?: number}|null} exclude 当前编辑对象
 * @returns {{x: number, y: number, distance: number, axis: string, kind: string}|null}
 */
function geometrySnap(point, tolerance, exclude = null) {
  const geometry = planSnapSegments(exclude);
  let closest = null;
  geometry.points.forEach(target => {
    const distance = Math.hypot(target.x - point.x, target.y - point.y);
    if (distance <= tolerance && (!closest || distance < closest.distance)) {
      closest = {x: target.x, y: target.y, distance, axis: 'point', kind: 'point'};
    }
  });
  if (closest) return closest;
  geometry.segments.forEach(segment => {
    const candidate = closestPointOnSegment(point, segment);
    const distance = Math.hypot(candidate.x - point.x, candidate.y - point.y);
    if (distance <= tolerance && (!closest || distance < closest.distance)) {
      closest = {...candidate, distance, axis: segment.axis, kind: 'segment'};
    }
  });
  return closest;
}

function rawSnap(point, snapTolerance = PLAN_RULES.snapTolerance, exclude = null) {
  if (!snappingEnabled()) return {x: point.x, y: point.y, geometry: null};
  const tolerance = snapTolerance / Math.max(view.s, 0.001);
  const geometry = geometrySnap(point, tolerance, exclude);
  if (geometry) return {x: geometry.x, y: geometry.y, geometry};
  const step = PLAN_RULES.grid;
  return {
    x: Math.round(point.x / step) * step,
    y: Math.round(point.y / step) * step,
    geometry: null
  };
}

function snapRoomPoint(point, previous, {
  snapTolerance = PLAN_RULES.snapTolerance,
  orthogonalAngle = PLAN_RULES.orthogonalAngle,
  exclude = null
} = {}) {
  if (!snappingEnabled()) return {x: point.x, y: point.y, geometry: null};
  const next = rawSnap(point, snapTolerance, exclude);
  if (!previous || next.geometry) return next;
  const dx = Math.abs(next.x - previous.x);
  const dy = Math.abs(next.y - previous.y);
  const angle = orthogonalAngle * Math.PI / 180;
  if (dx > 0 && dy / dx <= Math.tan(angle)) next.y = previous.y;
  else if (dy > 0 && dx / dy <= Math.tan(angle)) next.x = previous.x;
  return next;
}

function updateSnapGuides(next) {
  editor.guides = snappingEnabled() && next ? [
    {axis: 'h', value: next.y},
    {axis: 'v', value: next.x}
  ] : [];
}

function snapGuideMarkup() {
  if (!editor.guides.length) return '';
  const width = planSvg.clientWidth / Math.max(view.s, 0.001);
  const height = planSvg.clientHeight / Math.max(view.s, 0.001);
  const x0 = view.x0 - 500;
  const y0 = view.y0 - 500;
  const x1 = view.x0 + width + 500;
  const y1 = view.y0 + height + 500;
  const style = 'stroke="#6b8588" stroke-width="1" stroke-dasharray="8 8" opacity=".42" vector-effect="non-scaling-stroke" pointer-events="none"';
  return editor.guides.map(guide => guide.axis === 'h'
    ? `<line x1="${x0}" y1="${guide.value}" x2="${x1}" y2="${guide.value}" ${style}/>`
    : `<line x1="${guide.value}" y1="${y0}" x2="${guide.value}" y2="${y1}" ${style}/>`
  ).join('');
}

function snapOrthogonal(point, start, exclude = null) {
  if (!snappingEnabled()) return {x: point.x, y: point.y, geometry: null};
  const next = rawSnap(point, PLAN_RULES.snapTolerance, exclude);
  if (!start || next.geometry) return next;
  if (Math.abs(next.x - start.x) >= Math.abs(next.y - start.y)) next.y = start.y;
  else next.x = start.x;
  return next;
}

function rectSnapAnchors(rect) {
  const [x0, y0, x1, y1] = rect;
  const centerX = (x0 + x1) / 2;
  const centerY = (y0 + y1) / 2;
  return [
    {x: x0, y: y0}, {x: x1, y: y0}, {x: x1, y: y1}, {x: x0, y: y1},
    {x: centerX, y: y0}, {x: x1, y: centerY}, {x: centerX, y: y1}, {x: x0, y: centerY},
    {x: centerX, y: centerY}
  ];
}

/**
 * 将墙、窗或门整体移动到网格，并把其关键点吸附到其他户型实体。
 * 吸附线只修正垂直于线的位移，吸附点才会同时修正 X/Y，避免实体沿墙跳动。
 * @param {{kind: string, index: number}} target 当前实体
 * @param {number[]} baseRect 移动前的矩形
 * @param {{x: number, y: number}} point 当前鼠标户型坐标
 * @param {{x: number, y: number}} anchor 开始拖拽时的鼠标户型坐标
 * @returns {{dx: number, dy: number, guide: {x: number, y: number}|null}}
 */
function snapEntityTranslation(target, baseRect, point, anchor) {
  let dx = Math.round((point.x - anchor.x) / PLAN_RULES.grid) * PLAN_RULES.grid;
  let dy = Math.round((point.y - anchor.y) / PLAN_RULES.grid) * PLAN_RULES.grid;
  if (!snappingEnabled()) return {dx, dy, guide: null};

  const movedRect = [baseRect[0] + dx, baseRect[1] + dy, baseRect[2] + dx, baseRect[3] + dy];
  const tolerance = PLAN_RULES.snapTolerance / Math.max(view.s, 0.001);
  let best = null;
  rectSnapAnchors(movedRect).forEach(anchorPoint => {
    const geometry = geometrySnap(anchorPoint, tolerance, target);
    if (!geometry) return;
    let adjustX = geometry.x - anchorPoint.x;
    let adjustY = geometry.y - anchorPoint.y;
    if (geometry.kind === 'segment' && geometry.axis === 'h') adjustX = 0;
    if (geometry.kind === 'segment' && geometry.axis === 'v') adjustY = 0;
    const score = Math.abs(adjustX) + Math.abs(adjustY);
    if (!best || score < best.score) {
      best = {adjustX, adjustY, score, guide: {x: geometry.x, y: geometry.y}};
    }
  });
  if (!best) return {dx, dy, guide: null};
  dx += best.adjustX;
  dy += best.adjustY;
  return {dx, dy, guide: best.guide};
}

/**
 * 将房间整体移动到网格，并把房间顶点/中心吸附到其他户型实体。
 * @param {{kind: string, index: number}} target 当前房间
 * @param {number[][]} basePolygon 移动前的房间顶点
 * @param {{x: number, y: number}} point 当前鼠标户型坐标
 * @param {{x: number, y: number}} anchor 开始拖拽时的鼠标户型坐标
 * @returns {{dx: number, dy: number, guide: {x: number, y: number}|null}}
 */
function snapRoomTranslation(target, basePolygon, point, anchor) {
  let dx = Math.round((point.x - anchor.x) / PLAN_RULES.grid) * PLAN_RULES.grid;
  let dy = Math.round((point.y - anchor.y) / PLAN_RULES.grid) * PLAN_RULES.grid;
  if (!snappingEnabled()) return {dx, dy, guide: null};

  const movedPolygon = basePolygon.map(([x, y]) => [x + dx, y + dy]);
  const anchors = movedPolygon.map(([x, y]) => ({x, y}));
  const center = polygonCenter(movedPolygon);
  anchors.push({x: center[0], y: center[1]});
  const tolerance = PLAN_RULES.snapTolerance / Math.max(view.s, 0.001);
  let best = null;
  anchors.forEach(anchorPoint => {
    const geometry = geometrySnap(anchorPoint, tolerance, target);
    if (!geometry) return;
    let adjustX = geometry.x - anchorPoint.x;
    let adjustY = geometry.y - anchorPoint.y;
    if (geometry.kind === 'segment' && geometry.axis === 'h') adjustX = 0;
    if (geometry.kind === 'segment' && geometry.axis === 'v') adjustY = 0;
    const score = Math.abs(adjustX) + Math.abs(adjustY);
    if (!best || score < best.score) {
      best = {adjustX, adjustY, score, guide: {x: geometry.x, y: geometry.y}};
    }
  });
  if (!best) return {dx, dy, guide: null};
  dx += best.adjustX;
  dy += best.adjustY;
  return {dx, dy, guide: best.guide};
}

function primitiveWidth(kind, type) {
  if (kind === 'wall') return PLAN_RULES.wallThickness;
  if (kind === 'door') return PLAN_RULES.doorThickness;
  if (type === 'floor') return PLAN_RULES.floorWindowThickness;
  if (type === 'bay') return PLAN_RULES.bayWindowThickness;
  return PLAN_RULES.windowThickness;
}

function rectFromSegment(start, end, kind, type) {
  const horizontal = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y);
  const width = primitiveWidth(kind, type);
  const rect = horizontal
    ? [Math.min(start.x, end.x), start.y - width / 2, Math.max(start.x, end.x), start.y + width / 2]
    : [start.x - width / 2, Math.min(start.y, end.y), start.x + width / 2, Math.max(start.y, end.y)];
  const foundation = state.plan.foundation;
  // 沿地基边绘制墙体时，让墙厚朝矩形内侧展开，外边缘保持贴合地基。
  if (kind === 'wall' && foundation) {
    if (horizontal && Math.abs(start.y - foundation.y) < 1) {
      rect[1] = foundation.y; rect[3] = foundation.y + width;
    } else if (horizontal && Math.abs(start.y - foundation.y - foundation.height) < 1) {
      rect[1] = foundation.y + foundation.height - width; rect[3] = foundation.y + foundation.height;
    } else if (!horizontal && Math.abs(start.x - foundation.x) < 1) {
      rect[0] = foundation.x; rect[2] = foundation.x + width;
    } else if (!horizontal && Math.abs(start.x - foundation.x - foundation.width) < 1) {
      rect[0] = foundation.x + foundation.width - width; rect[2] = foundation.x + foundation.width;
    }
  }
  return [...rect, horizontal ? 'h' : 'v'];
}

function entityAxis(entity, kind) {
  return normalizeAxis(kind === 'door' ? entity.axis : entity[5], kind === 'door' ? entity.rect : entity.slice(0, 4));
}

function entityDimensions(entity, kind) {
  const rect = kind === 'door' ? entity.rect : entity;
  const axis = entityAxis(entity, kind);
  return {
    axis,
    length: axis === 'h' ? rect[2] - rect[0] : rect[3] - rect[1],
    width: axis === 'h' ? rect[3] - rect[1] : rect[2] - rect[0]
  };
}

function setEntityDimensions(entity, kind, length, width, axis = entityAxis(entity, kind)) {
  const rect = kind === 'door' ? entity.rect : entity;
  const centerX = (rect[0] + rect[2]) / 2;
  const centerY = (rect[1] + rect[3]) / 2;
  const current = entityDimensions(entity, kind);
  const nextLength = clampPositive(length, current.length, kind === 'door' ? PLAN_RULES.minimumDoorLength : PLAN_RULES.minimumPrimitiveLength);
  const nextWidth = clampPositive(width, current.width, 20);
  const nextRect = axis === 'h'
    ? [centerX - nextLength / 2, centerY - nextWidth / 2, centerX + nextLength / 2, centerY + nextWidth / 2]
    : [centerX - nextWidth / 2, centerY - nextLength / 2, centerX + nextWidth / 2, centerY + nextLength / 2];
  if (kind === 'door') {
    entity.rect = nextRect;
    entity.axis = axis;
    updateDoorGeometry(entity);
  } else {
    entity[0] = nextRect[0];
    entity[1] = nextRect[1];
    entity[2] = nextRect[2];
    entity[3] = nextRect[3];
    entity[5] = axis;
  }
}

function createDoor(start, end, swing) {
  const selectedSwing = safeDoorSwing(swing);
  const axis = Math.abs(end.x - start.x) >= Math.abs(end.y - start.y) ? 'h' : 'v';
  const segment = rectFromSegment(start, end, 'door', selectedSwing);
  const door = {
    type: 'hinged',
    swing: selectedSwing,
    axis,
    rect: segment.slice(0, 4),
    entry: false
  };
  updateDoorGeometry(door);
  return door;
}

function updateDoorGeometry(door) {
  door.swing = safeDoorSwing(door.swing);
  door.rect = normalizeRect(door.rect);
  door.axis = normalizeAxis(door.axis, door.rect);
  const {axis, length} = entityDimensions(door, 'door');
  const horizontal = axis === 'h';
  const rightHinge = door.swing.endsWith('right');
  const inward = door.swing.startsWith('in');
  const middle = horizontal ? (door.rect[1] + door.rect[3]) / 2 : (door.rect[0] + door.rect[2]) / 2;
  door.h = horizontal
    ? [rightHinge ? door.rect[2] : door.rect[0], middle]
    : [middle, rightHinge ? door.rect[3] : door.rect[1]];
  door.len = Math.max(PLAN_RULES.minimumDoorLength, length);
  door.c = rightHinge ? (horizontal ? [-1, 0] : [0, -1]) : (horizontal ? [1, 0] : [0, 1]);
  door.o = horizontal
    ? [0, inward ? 1 : -1]
    : [inward ? 1 : -1, 0];
}

/**
 * 返回窗户可交互的平面包围盒；飘窗包含向外凸出的三面窗区域。
 * @param {number[]} values 窗户实体数组
 * @returns {number[]} 规范化后的 [x0, y0, x1, y1]
 */
function windowFootprintRect(values) {
  const rect = normalizeRect(values.slice(0, 4));
  if (values[4] !== 'bay') return rect;
  const [x0, y0, x1, y1] = rect;
  const axis = normalizeAxis(values[5], rect);
  const side = Number(values[6]) === 1 ? 1 : -1;
  const depth = Number(values[7]) > 0 ? Number(values[7]) : PLAN_RULES.bayWindowDepth;
  if (axis === 'h') {
    const back = side === 1 ? y1 : y0;
    const front = back + side * depth;
    return [x0, Math.min(back, front), x1, Math.max(back, front)];
  }
  const back = side === 1 ? x1 : x0;
  const front = back + side * depth;
  return [Math.min(back, front), y0, Math.max(back, front), y1];
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const intersects = ((yi > point.y) !== (yj > point.y)) && point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInRect(point, values, padding = 0) {
  return point.x >= values[0] - padding && point.x <= values[2] + padding
    && point.y >= values[1] - padding && point.y <= values[3] + padding;
}

function hitTest(point) {
  const doorPadding = Math.max(100, 18 / Math.max(view.s, 0.001));
  const openingPadding = Math.max(80, 14 / Math.max(view.s, 0.001));
  for (let index = DOORS.length - 1; index >= 0; index--) {
    if (pointInRect(point, DOORS[index].rect, doorPadding)) return {kind: 'door', index};
  }
  for (let index = WINS.length - 1; index >= 0; index--) {
    if (pointInRect(point, windowFootprintRect(WINS[index]), openingPadding)) return {kind: 'window', index};
  }
  for (let index = WALLS.length - 1; index >= 0; index--) {
    if (pointInRect(point, WALLS[index], openingPadding)) return {kind: 'wall', index};
  }
  const foundation = state.plan.foundation;
  if (foundation && ui.layers.foundation) {
    const {x, y, width, height} = foundation;
    const padding = 8 / Math.max(view.s, 0.001);
    if (pointInRect(point, [x, y, x + width, y + height], padding)
      && (Math.abs(point.x - x) <= padding || Math.abs(point.x - x - width) <= padding
        || Math.abs(point.y - y) <= padding || Math.abs(point.y - y - height) <= padding)) {
      return {kind: 'foundation', index: 0};
    }
  }
  for (let index = ROOMS.length - 1; index >= 0; index--) {
    if (pointInPolygon(point, ROOMS[index].poly)) return {kind: 'room', index, id: ROOMS[index].id};
  }
  return null;
}

function selectedRoomVertex(point) {
  if (editor.selected?.kind !== 'room') return null;
  const room = ROOMS[editor.selected.index];
  if (!room) return null;
  const tolerance = Math.max(80, 16 / Math.max(view.s, 0.001));
  let result = null;
  room.poly.forEach((vertex, index) => {
    if (Math.hypot(vertex[0] - point.x, vertex[1] - point.y) <= tolerance) result = index;
  });
  return result;
}

function segmentLength(a, b) {
  return Math.round(Math.hypot(b.x - a.x, b.y - a.y));
}

function dimensionText(a, b, color = '#2f5d62') {
  const length = segmentLength(a, b);
  if (length < 1) return '';
  const middleX = (a.x + b.x) / 2;
  const middleY = (a.y + b.y) / 2;
  let angle = Math.atan2(b.y - a.y, b.x - a.x) * 180 / Math.PI;
  if (angle > 90 || angle < -90) angle += 180;
  const fontSize = 12 / Math.max(view.s, 0.001);
  return `<text x="${middleX}" y="${middleY - 12 / view.s}" font-size="${fontSize}" text-anchor="middle" fill="${color}" font-weight="600" stroke="#fff" stroke-width="${3.5 / view.s}" paint-order="stroke" transform="rotate(${angle} ${middleX} ${middleY})">${length} mm</text>`;
}

function dimensionRectText(values, color = '#b5653a') {
  const axis = Math.abs(values[2] - values[0]) >= Math.abs(values[3] - values[1]) ? 'h' : 'v';
  const lengthLine = axis === 'h'
    ? [{x: values[0], y: values[1]}, {x: values[2], y: values[1]}]
    : [{x: values[0], y: values[1]}, {x: values[0], y: values[3]}];
  const widthLine = axis === 'h'
    ? [{x: values[2], y: values[1]}, {x: values[2], y: values[3]}]
    : [{x: values[0], y: values[3]}, {x: values[2], y: values[3]}];
  return dimensionText(lengthLine[0], lengthLine[1], color) + dimensionText(widthLine[0], widthLine[1], color);
}

function drawWindowPreview(values, type, opacity = 1) {
  const output = planWindowMarkup(values, type, opacity);
  return `<g data-plan-window-preview="${type}">${output}</g>`;
}

function drawDoorPreview(door, opacity = 1) {
  const [hx, hy] = door.h;
  const length = door.len;
  const outerX = hx + door.o[0] * length;
  const outerY = hy + door.o[1] * length;
  const endX = hx + door.c[0] * length;
  const endY = hy + door.c[1] * length;
  const sweep = door.o[0] * door.c[1] - door.o[1] * door.c[0] > 0 ? 1 : 0;
  const thickness = 40;
  return `<g opacity="${opacity}">
    <polygon points="${hx},${hy} ${outerX},${outerY} ${outerX + door.c[0] * thickness},${outerY + door.c[1] * thickness} ${hx + door.c[0] * thickness},${hy + door.c[1] * thickness}" fill="#fff" stroke="#b5653a" stroke-width="1.5" vector-effect="non-scaling-stroke"/>
    <path d="M${outerX} ${outerY}A${length} ${length} 0 0 ${sweep} ${endX} ${endY}" fill="none" stroke="#b5653a" stroke-width="1.5" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"/>
  </g>`;
}

function drawDraft() {
  if (!draftLayer) return;
  renderDims();
  const draft = editor.draft;
  const line = 'stroke="#2f5d62" stroke-width="1.6" vector-effect="non-scaling-stroke"';
  let output = snapGuideMarkup();
  if (draft.kind === 'foundation' && draft.start && draft.current) {
    const [x, y, right, bottom] = normalizeRect([draft.start.x, draft.start.y, draft.current.x, draft.current.y]);
    output += `<rect x="${x}" y="${y}" width="${right - x}" height="${bottom - y}" fill="none" stroke="#b5c2bf" stroke-width="1" stroke-dasharray="7 5" vector-effect="non-scaling-stroke"/>`;
    renderDims({...state.plan, foundation: {x, y, width: right - x, height: bottom - y}});
  } else if (draft.kind === 'room-rect' && draft.start && draft.current) {
    const values = normalizeRect([draft.start.x, draft.start.y, draft.current.x, draft.current.y]);
    output += `<rect x="${values[0]}" y="${values[1]}" width="${values[2] - values[0]}" height="${values[3] - values[1]}" fill="rgba(47,93,98,.08)" ${line} stroke-dasharray="6 4"/>`;
    output += dimensionRectText(values, '#b5653a');
  } else if (draft.kind === 'room' && draft.points.length) {
    output += `<polyline points="${draft.points.map(point => `${point[0]},${point[1]}`).join(' ')}" fill="rgba(47,93,98,.08)" ${line} stroke-dasharray="6 4"/>`;
    for (let index = 0; index < draft.points.length - 1; index++) {
      output += dimensionText({x: draft.points[index][0], y: draft.points[index][1]}, {x: draft.points[index + 1][0], y: draft.points[index + 1][1]});
    }
    const last = draft.points[draft.points.length - 1];
    if (draft.current) {
      output += `<line x1="${last[0]}" y1="${last[1]}" x2="${draft.current.x}" y2="${draft.current.y}" ${line} stroke-dasharray="6 4"/>`;
      output += dimensionText({x: last[0], y: last[1]}, draft.current, '#b5653a');
      if (draft.points.length >= 3 && distance(draft.current, {x: draft.points[0][0], y: draft.points[0][1]}) <= 180) {
        output += `<circle cx="${draft.points[0][0]}" cy="${draft.points[0][1]}" r="${12 / view.s}" fill="none" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      }
    }
    draft.points.forEach((point, index) => {
      output += `<circle cx="${point[0]}" cy="${point[1]}" r="${index === 0 ? 9 / view.s : 5 / view.s}" fill="#fff" stroke="${index === 0 ? '#b5653a' : '#2f5d62'}" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
    });
  } else if (draft.start && draft.current) {
    const segment = rectFromSegment(draft.start, draft.current, draft.kind, draft.type);
    const values = segment.slice(0, 4);
    if (draft.kind === 'wall') renderDims({...state.plan,
      walls: [...state.plan.walls, [...values, safeWallType(draft.type), segment[4]]]
    });
    if (draft.kind === 'window') output += drawWindowPreview(values, draft.type, .72);
    else if (draft.kind === 'door') output += drawDoorPreview(createDoor(draft.start, draft.current, draft.type), .85);
    else output += `<rect x="${values[0]}" y="${values[1]}" width="${values[2] - values[0]}" height="${values[3] - values[1]}" fill="rgba(181,101,58,.16)" ${line} stroke-dasharray="6 4"/>`;
    output += dimensionRectText(values);
    if (draft.kind === 'wall') output += `<rect x="${values[0]}" y="${values[1]}" width="${values[2] - values[0]}" height="${values[3] - values[1]}" fill="none" ${line} stroke-dasharray="6 4"/>`;
  }
  draftLayer.innerHTML = output;
}

function drawSelection() {
  if (!selectionLayer) return;
  const selected = editor.selected;
  if (!selected) {
    selectionLayer.innerHTML = '';
    return;
  }
  let output = '';
  if (selected.kind === 'foundation') {
    const foundation = state.plan.foundation;
    if (foundation && ui.layers.foundation) {
      output = `<rect x="${foundation.x}" y="${foundation.y}" width="${foundation.width}" height="${foundation.height}" fill="none" stroke="#8fa7a1" stroke-width="1.5" stroke-dasharray="7 5" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
    }
  } else if (selected.kind === 'room') {
    const room = ROOMS[selected.index];
    if (room) {
      output += `<polygon points="${room.poly.map(point => point.join(',')).join(' ')}" fill="rgba(181,101,58,.08)" stroke="#b5653a" stroke-width="2" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
      room.poly.forEach((point, index) => {
        const next = room.poly[(index + 1) % room.poly.length];
        output += dimensionText(
          {x: point[0], y: point[1]},
          {x: next[0], y: next[1]},
          '#b5653a'
        );
        output += `<circle data-plan-handle="room-point" data-index="${index}" cx="${point[0]}" cy="${point[1]}" r="${8 / view.s}" fill="#fff" stroke="#b5653a" stroke-width="1.5" vector-effect="non-scaling-stroke"/>`;
      });
    }
  } else {
    const entity = selected.kind === 'wall' ? WALLS[selected.index] : selected.kind === 'window' ? windowFootprintRect(WINS[selected.index]) : DOORS[selected.index]?.rect;
    if (entity) output += `<rect x="${entity[0]}" y="${entity[1]}" width="${entity[2] - entity[0]}" height="${entity[3] - entity[1]}" fill="none" stroke="#b5653a" stroke-width="2" stroke-dasharray="6 3" vector-effect="non-scaling-stroke" pointer-events="none"/>`;
  }
  selectionLayer.innerHTML = output;
}

function syncPlanToolLabels() {
  planTools.querySelectorAll('.plan-grid .plan-item[data-plan-tool]').forEach(button => {
    const {planTool, planType} = button.dataset;
    const icon = button.querySelector('b');
    if (icon) icon.innerHTML = planToolSVG(planTool, planType);
    const definition = PLAN_DEFINITIONS[planTool]?.[planType];
    if (!definition) return;
    const label = button.querySelector('span');
    const hint = button.querySelector('small');
    if (label) label.textContent = definition.name || '';
    if (hint) hint.textContent = definition.hint || '';
  });
}

function optionMarkup(values) {
  return Object.entries(values).map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
}

function axisMarkup(id, axis) {
  return `<label>方向<select id="${id}"><option value="h"${axis === 'h' ? ' selected' : ''}>水平</option><option value="v"${axis === 'v' ? ' selected' : ''}>垂直</option></select></label>`;
}

function dimensionMarkup(prefix, entity, kind) {
  const dimensions = entityDimensions(entity, kind);
  return `${axisMarkup(`${prefix}Axis`, dimensions.axis)}
    <label>长度<input type="number" id="${prefix}Length" value="${Math.round(dimensions.length)}" min="100" step="10"></label>
    <label>宽度<input type="number" id="${prefix}Width" value="${Math.round(dimensions.width)}" min="20" step="10"></label>`;
}

function bayWindowMarkup(windowEntity) {
  const axis = entityAxis(windowEntity, 'window');
  const side = Number(windowEntity[6]) === 1 ? 1 : -1;
  const positiveLabel = axis === 'h' ? '向下' : '向右';
  const negativeLabel = axis === 'h' ? '向上' : '向左';
  const depth = Number(windowEntity[7]) > 0 ? windowEntity[7] : PLAN_RULES.bayWindowDepth;
  return `<label>凸出方向<select id="planBaySide"><option value="1"${side === 1 ? ' selected' : ''}>${positiveLabel}</option><option value="-1"${side === -1 ? ' selected' : ''}>${negativeLabel}</option></select></label>
    <label>飘出进深<input type="number" id="planBayDepth" value="${Math.round(depth)}" min="240" step="10"></label>`;
}

function planPanelMarkup() {
  const selected = editor.selected;
  if (!selected) return `<section><h3>户型编辑</h3><div class="muted">先绘制地基矩形，再绘制房间、墙体和门窗。点击对象可编辑属性；地基只能在属性面板调整宽高。空白区域可拖动画布。Delete 删除，方向键微调，Ctrl/Cmd+D 复制，R 旋转。</div></section>`;
  if (selected.kind === 'foundation') {
    const foundation = state.plan.foundation;
    if (!foundation) return '';
    return `<section><h3>地基属性</h3><div class="form">
      <label>宽度 (mm)<input type="number" id="planFoundationWidth" value="${foundation.width}" min="${PLAN_RULES.minimumPrimitiveLength}" step="10"></label>
      <label>高度 (mm)<input type="number" id="planFoundationHeight" value="${foundation.height}" min="${PLAN_RULES.minimumPrimitiveLength}" step="10"></label>
      </div><div class="muted" style="margin-top:8px">左上角固定，调整宽高时标尺同步更新。地基边缘可吸附，绘制完成后不可拖动、旋转或复制。</div>
      <div class="actions"><button class="btn danger" id="planDelete">删除地基</button><button class="btn" id="planBack">← 返回</button></div></section>`;
  }
  if (selected.kind === 'room') {
    const room = ROOMS[selected.index];
    const settings = room && state.rooms[room.id];
    if (!room || !settings) return '';
    const isRectangle = isRoomRectangle(room);
    return `<section><h3>房间属性</h3><div class="form"><label class="full">名称<input id="planRoomName" value="${esc(settings.name)}"></label>
      ${isRectangle ? roomRectDimensionMarkup(room) : ''}</div>
      <div class="muted" style="margin-top:8px">面积 ${fmt(area(room.poly))} m² · 周长 ${fmt(perim(room.poly), 1)} m</div>
      <div class="actions"><button class="btn danger" id="planDelete">删除房间</button><button class="btn" id="planBack">← 返回</button></div></section>
      <section class="muted">${isRectangle ? '矩形房间可以直接调整长度和宽度，也可以拖动橙色顶点。' : '拖动橙色顶点编辑轮廓。房间支持斜边，接近水平或垂直时才会吸附。'}</section>`;
  }
  if (selected.kind === 'wall') {
    const wall = WALLS[selected.index];
    if (!wall) return '';
    return `<section><h3>墙体属性</h3><div class="form"><label class="full">类型<select id="planWallType">${optionMarkup(WALL_TYPES)}</select></label>
      ${dimensionMarkup('planWall', wall, 'wall')}</div>
      <div class="actions"><button class="btn danger" id="planDelete">删除墙体</button><button class="btn" id="planBack">← 返回</button></div></section>`;
  }
  if (selected.kind === 'window') {
    const win = WINS[selected.index];
    if (!win) return '';
    return `<section><h3>窗户属性</h3><div class="form"><label class="full">类型<select id="planWindowType">${optionMarkup(WINDOW_TYPES)}</select></label>
      ${dimensionMarkup('planWindow', win, 'window')}
      ${win[4] === 'bay' ? bayWindowMarkup(win) : ''}</div>
      <div class="actions"><button class="btn danger" id="planDelete">删除窗户</button><button class="btn" id="planBack">← 返回</button></div></section>`;
  }
  const door = DOORS[selected.index];
  if (!door) return '';
  return `<section><h3>门属性</h3><div class="form"><label class="full">开启方向<select id="planDoorSwing">${optionMarkup(DOOR_SWINGS)}</select></label>
    ${dimensionMarkup('planDoor', door, 'door')}</div>
    <div class="actions"><button class="btn danger" id="planDelete">删除门</button><button class="btn" id="planBack">← 返回</button></div></section>`;
}

function commitPlan(before, change) {
  change();
  syncPlanRefs();
  commit(before);
  renderAll();
}

function selectPlan(selection) {
  if (ui.tool === 'preview') return;
  editor.selected = selection;
  ui.sel = null;
  drawSelection();
  renderPlanPanel();
}

function bindRoomDimensions(room) {
  const length = $('#planRoomLength');
  const width = $('#planRoomWidth');
  if (!length || !width) return;
  const update = () => commitPlan(snap(), () => setRoomRectDimensions(room, length.value, width.value));
  length.onchange = update;
  width.onchange = update;
}

function bindDimensions(prefix, entity, kind) {
  const axis = $(`#${prefix}Axis`);
  const length = $(`#${prefix}Length`);
  const width = $(`#${prefix}Width`);
  const update = () => commitPlan(snap(), () => {
    const current = entityDimensions(entity, kind);
    setEntityDimensions(entity, kind,
      clampPositive(length.value, current.length, kind === 'door' ? PLAN_RULES.minimumDoorLength : PLAN_RULES.minimumPrimitiveLength),
      clampPositive(width.value, current.width, 20), axis.value);
  });
  axis.onchange = update;
  length.onchange = update;
  width.onchange = update;
}

function renderPlanPanel() {
  if (!editor.active || !planPanel) return;
  planPanel.innerHTML = planPanelMarkup();
  const selected = editor.selected;
  if (!selected) return;
  if (selected.kind === 'foundation') {
    const foundation = state.plan.foundation;
    if (!foundation) return;
    const width = $('#planFoundationWidth'), height = $('#planFoundationHeight');
    const update = () => commitPlan(snap(), () => {
      foundation.width = clampPositive(width.value, foundation.width, PLAN_RULES.minimumPrimitiveLength);
      foundation.height = clampPositive(height.value, foundation.height, PLAN_RULES.minimumPrimitiveLength);
    });
    width.onchange = update;
    height.onchange = update;
  } else if (selected.kind === 'room') {
    const room = ROOMS[selected.index];
    if (!room) return;
    $('#planRoomName').onchange = event => commitPlan(snap(), () => {
      state.rooms[room.id].name = event.target.value.trim() || state.rooms[room.id].name;
      room.name = state.rooms[room.id].name;
    });
    if (isRoomRectangle(room)) bindRoomDimensions(room);
  } else if (selected.kind === 'wall') {
    const wall = WALLS[selected.index];
    if (!wall) return;
    const type = $('#planWallType');
    type.value = wall[4];
    type.onchange = event => commitPlan(snap(), () => wall[4] = safeWallType(event.target.value));
    bindDimensions('planWall', wall, 'wall');
  } else if (selected.kind === 'window') {
    const win = WINS[selected.index];
    if (!win) return;
    const type = $('#planWindowType');
    type.value = win[4];
    type.onchange = event => commitPlan(snap(), () => {
      win[4] = safeWindowType(event.target.value);
      if (win[4] === 'bay') {
        win[6] = Number(win[6]) === 1 ? 1 : -1;
        win[7] = Number(win[7]) > 0 ? Number(win[7]) : PLAN_RULES.bayWindowDepth;
      } else {
        win.length = 6;
      }
    });
    bindDimensions('planWindow', win, 'window');
    if (win[4] === 'bay') {
      const side = $('#planBaySide');
      const depth = $('#planBayDepth');
      side.onchange = event => commitPlan(snap(), () => win[6] = Number(event.target.value) === 1 ? 1 : -1);
      depth.onchange = event => commitPlan(snap(), () => win[7] = clampPositive(event.target.value, PLAN_RULES.bayWindowDepth, 240));
    }
  } else {
    const door = DOORS[selected.index];
    if (!door) return;
    const swing = $('#planDoorSwing');
    swing.value = door.swing;
    swing.onchange = event => commitPlan(snap(), () => {
      door.swing = safeDoorSwing(event.target.value);
      updateDoorGeometry(door);
    });
    bindDimensions('planDoor', door, 'door');
  }
  $('#planDelete').onclick = deleteSelected;
  $('#planBack').onclick = () => selectPlan(null);
}

function deleteSelected() {
  const selected = editor.selected;
  if (!selected) return;
  const before = snap();
  if (selected.kind === 'foundation') {
    state.plan.foundation = null;
  } else if (selected.kind === 'room') {
    const room = state.plan.rooms[selected.index];
    state.plan.rooms.splice(selected.index, 1);
    if (room) delete state.rooms[room.id];
  } else if (selected.kind === 'wall') {
    state.plan.walls.splice(selected.index, 1);
  } else if (selected.kind === 'window') {
    state.plan.wins.splice(selected.index, 1);
  } else if (selected.kind === 'door') {
    state.plan.doors.splice(selected.index, 1);
  }
  editor.selected = null;
  commitPlan(before, () => {});
}

function nudgeSelected(dx, dy) {
  const selected = editor.selected;
  if (!selected || selected.kind === 'foundation') return;
  const before = snap();
  if (selected.kind === 'room') {
    const room = state.plan.rooms[selected.index];
    if (!room) return;
    room.poly = room.poly.map(([x, y]) => [x + dx, y + dy]);
    room.at = polygonCenter(room.poly);
  } else if (selected.kind === 'wall') {
    const wall = state.plan.walls[selected.index];
    if (!wall) return;
    for (let index = 0; index < 4; index++) wall[index] += index % 2 ? dy : dx;
  } else if (selected.kind === 'window') {
    const win = state.plan.wins[selected.index];
    if (!win) return;
    for (let index = 0; index < 4; index++) win[index] += index % 2 ? dy : dx;
  } else if (selected.kind === 'door') {
    const door = state.plan.doors[selected.index];
    if (!door) return;
    door.rect = door.rect.map((value, index) => value + (index % 2 ? dy : dx));
    updateDoorGeometry(door);
  }
  commitPlan(before, () => {});
}

function rotateSelectedPlan(direction = 1) {
  const selected = editor.selected;
  if (!selected || selected.kind === 'foundation') return;
  const before = snap();
  const turn = direction < 0 ? -1 : 1;

  if (selected.kind === 'room') {
    const room = state.plan.rooms[selected.index];
    if (!room) return;
    if (isRoomRectangle(room)) {
      const dimensions = roomRectDimensions(room);
      setRoomRectDimensions(room, dimensions.width, dimensions.length);
    } else {
      const center = polygonCenter(room.poly);
      room.poly = room.poly.map(([x, y]) => {
        const dx = x - center[0];
        const dy = y - center[1];
        return turn > 0
          ? [center[0] - dy, center[1] + dx]
          : [center[0] + dy, center[1] - dx];
      });
      room.at = polygonCenter(room.poly);
    }
    commitPlan(before, () => {});
    return;
  }

  const entity = selected.kind === 'wall'
    ? state.plan.walls[selected.index]
    : selected.kind === 'window'
      ? state.plan.wins[selected.index]
      : state.plan.doors[selected.index];
  if (!entity) return;
  const dimensions = entityDimensions(entity, selected.kind);
  setEntityDimensions(
    entity,
    selected.kind,
    dimensions.length,
    dimensions.width,
    dimensions.axis === 'h' ? 'v' : 'h'
  );
  commitPlan(before, () => {});
}

function duplicateSelectedPlan() {
  const selected = editor.selected;
  if (!selected || selected.kind === 'foundation') return;
  const before = snap();
  const offset = 200;
  let nextSelection = null;
  if (selected.kind === 'room') {
    const source = state.plan.rooms[selected.index];
    if (!source) return;
    const room = {
      ...JSON.parse(JSON.stringify(source)),
      id: nextId('r'),
      poly: source.poly.map(([x, y]) => [x + offset, y + offset]),
      at: [source.at[0] + offset, source.at[1] + offset]
    };
    state.plan.rooms.push(room);
    state.rooms[room.id] = {...state.rooms[source.id], name: `${state.rooms[source.id]?.name || room.name} 副本`};
    nextSelection = {kind: 'room', index: state.plan.rooms.length - 1, id: room.id};
  } else if (selected.kind === 'wall') {
    const source = state.plan.walls[selected.index];
    if (!source) return;
    const wall = [...source];
    for (let index = 0; index < 4; index++) wall[index] += offset;
    state.plan.walls.push(wall);
    nextSelection = {kind: 'wall', index: state.plan.walls.length - 1};
  } else if (selected.kind === 'window') {
    const source = state.plan.wins[selected.index];
    if (!source) return;
    const win = [...source];
    for (let index = 0; index < 4; index++) win[index] += offset;
    state.plan.wins.push(win);
    nextSelection = {kind: 'window', index: state.plan.wins.length - 1};
  } else if (selected.kind === 'door') {
    const source = state.plan.doors[selected.index];
    if (!source) return;
    const door = JSON.parse(JSON.stringify(source));
    door.rect = door.rect.map((value, index) => value + offset);
    updateDoorGeometry(door);
    state.plan.doors.push(door);
    nextSelection = {kind: 'door', index: state.plan.doors.length - 1};
  }
  editor.selected = nextSelection;
  commitPlan(before, () => {});
}

function closeDrawingMode(selection = null) {
  editor.mode = 'edit';
  editor.type = null;
  editor.draft = emptyDraft();
  editor.guides = [];
  editor.selected = selection;
  planSvg.setAttribute('class', 'tool-plan-edit');
  updateToolHighlight();
  drawDraft();
}

/** 将拖拽矩形提交为唯一地基，固定左上角，仅允许属性面板修改宽高。 */
function finishFoundation() {
  const draft = editor.draft;
  if (!draft.start || !draft.current) return;
  const [x, y, right, bottom] = normalizeRect([draft.start.x, draft.start.y, draft.current.x, draft.current.y]);
  if (right - x < PLAN_RULES.minimumPrimitiveLength || bottom - y < PLAN_RULES.minimumPrimitiveLength) {
    editor.draft = {kind: 'foundation', type: null, points: [], start: null, current: null};
    editor.guides = [];
    drawDraft();
    renderDims();
    return;
  }
  const before = snap();
  state.plan.foundation = {x, y, width: right - x, height: bottom - y};
  closeDrawingMode({kind: 'foundation', index: 0});
  commitPlan(before, () => {});
  drawer('panel', true);
}

function finishRoomRect() {
  const draft = editor.draft;
  if (!draft.start || !draft.current) return;
  const values = normalizeRect([draft.start.x, draft.start.y, draft.current.x, draft.current.y]);
  if (values[2] - values[0] < PLAN_RULES.minimumPrimitiveLength
    || values[3] - values[1] < PLAN_RULES.minimumPrimitiveLength) {
    editor.draft = emptyDraft();
    editor.guides = [];
    drawDraft();
    return;
  }
  const room = {
    id: nextId('r'),
    name: '新房间',
    shape: 'rectangle',
    poly: [[values[0], values[1]], [values[2], values[1]], [values[2], values[3]], [values[0], values[3]]],
    counted: true,
    at: polygonCenter([[values[0], values[1]], [values[2], values[1]], [values[2], values[3]], [values[0], values[3]]])
  };
  const before = snap();
  state.plan.rooms.push(room);
  state.rooms[room.id] = {name: room.name, mat: 'wood'};
  closeDrawingMode({kind: 'room', index: state.plan.rooms.length - 1, id: room.id});
  commitPlan(before, () => {});
}

function finishRoom() {
  const points = editor.draft.points.slice();
  if (points.length < 3) return;
  if (samePoint(points[0], points[points.length - 1], 20)) points.pop();
  if (points.length < 3 || area(points) < .25) return;
  const room = {
    id: nextId('r'),
    name: '新房间',
    shape: 'polygon',
    poly: points,
    counted: true,
    at: polygonCenter(points)
  };
  const before = snap();
  state.plan.rooms.push(room);
  state.rooms[room.id] = {name: room.name, mat: 'wood'};
  closeDrawingMode({kind: 'room', index: state.plan.rooms.length - 1, id: room.id});
  commitPlan(before, () => {});
}

function finishPrimitive() {
  const draft = editor.draft;
  if (!draft.start || !draft.current) return;
  if (distance(draft.start, draft.current) < PLAN_RULES.minimumPrimitiveLength) {
    editor.draft = emptyDraft();
    editor.guides = [];
    drawDraft();
    return;
  }
  const before = snap();
  const segment = rectFromSegment(draft.start, draft.current, draft.kind, draft.type);
  let selection;
  if (draft.kind === 'wall') {
    state.plan.walls.push([...segment.slice(0, 4), safeWallType(draft.type), segment[4]]);
    selection = {kind: 'wall', index: state.plan.walls.length - 1};
  } else if (draft.kind === 'window') {
    const type = safeWindowType(draft.type);
    const windowEntity = [...segment.slice(0, 4), type, segment[4]];
    if (type === 'bay') windowEntity.push(-1, PLAN_RULES.bayWindowDepth);
    state.plan.wins.push(windowEntity);
    selection = {kind: 'window', index: state.plan.wins.length - 1};
  } else {
    const door = createDoor(draft.start, draft.current, draft.type);
    state.plan.doors.push(door);
    selection = {kind: 'door', index: state.plan.doors.length - 1};
  }
  closeDrawingMode(selection);
  commitPlan(before, () => {});
}

function moveRectangleVertex(room, pointIndex, point, basePolygon) {
  const base = basePolygon || room.poly;
  const opposite = base[(pointIndex + 2) % 4];
  const next = snapRoomPoint(point, null, {
    snapTolerance: PLAN_RULES.editSnapTolerance,
    exclude: {kind: 'room', index: editor.drag?.roomIndex}
  });
  const minimum = PLAN_RULES.minimumPrimitiveLength;
  let x = next.x;
  let y = next.y;
  if (pointIndex === 0 || pointIndex === 3) x = Math.min(x, opposite[0] - minimum);
  else x = Math.max(x, opposite[0] + minimum);
  if (pointIndex === 0 || pointIndex === 1) y = Math.min(y, opposite[1] - minimum);
  else y = Math.max(y, opposite[1] + minimum);
  const x0 = Math.min(x, opposite[0]);
  const y0 = Math.min(y, opposite[1]);
  const x1 = Math.max(x, opposite[0]);
  const y1 = Math.max(y, opposite[1]);
  room.poly = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  room.at = polygonCenter(room.poly);
  return {x, y, geometry: next.geometry};
}

/**
 * 门的拖动只维护一个事实来源：door.rect。
 * 门槛（gRooms）和门框/门扇（gOpen）都从同一份数据立即重绘，
 * 避免拖动过程中两个图层分别使用旧坐标。
 */
function moveDoorEntityDuringDrag(door, baseDoor, dx, dy) {
  if (!door || !baseDoor?.rect) return false;
  door.rect = baseDoor.rect.map((value, index) => value + (index % 2 ? dy : dx));
  door.axis = baseDoor.axis;
  updateDoorGeometry(door);
  syncPlanRefs();
  renderRooms();
  renderOpenings();
  return true;
}

/**
 * 窗户拖动时同时刷新门槛层和窗扇层。
 * 滑动门窗由 gRooms 的门槛与 gOpen 的双扇实体共同组成，
 * 只刷新 gOpen 会让门槛/虚框暂时停留在旧位置。
 */
function moveWindowEntityDuringDrag(windowEntity, baseWindow, dx, dy) {
  if (!windowEntity || !Array.isArray(baseWindow)) return false;
  for (let index = 0; index < 4; index++) {
    windowEntity[index] = baseWindow[index] + (index % 2 ? dy : dx);
  }
  syncPlanRefs();
  renderRooms();
  renderOpenings();
  return true;
}

function moveSelected(point) {
  const drag = editor.drag;
  if (!drag) return;
  if (drag.kind === 'room') {
    const room = state.plan.rooms[drag.roomIndex];
    if (!room) return;
    const translation = snapRoomTranslation(
      {kind: 'room', index: drag.roomIndex},
      drag.base,
      point,
      drag.anchor
    );
    const {dx, dy} = translation;
    updateSnapGuides(translation.guide || {x: point.x, y: point.y});
    room.poly = drag.base.map(([x, y]) => [x + dx, y + dy]);
    room.at = polygonCenter(room.poly);
    renderRooms();
    renderLabels();
    drawDraft();
  } else if (drag.kind === 'room-point') {
    const room = state.plan.rooms[drag.roomIndex];
    if (!room) return;
    let next;
    if (isRoomRectangle(room)) {
      next = moveRectangleVertex(room, drag.pointIndex, point, drag.base);
    } else {
      const previous = room.poly[drag.pointIndex > 0 ? drag.pointIndex - 1 : room.poly.length - 1];
      next = snapRoomPoint(point, {x: previous[0], y: previous[1]}, {
        snapTolerance: PLAN_RULES.editSnapTolerance,
        orthogonalAngle: PLAN_RULES.editOrthogonalAngle,
        exclude: {kind: 'room', index: drag.roomIndex}
      });
      room.poly[drag.pointIndex] = [next.x, next.y];
      room.at = polygonCenter(room.poly);
    }
    updateSnapGuides(next);
    renderRooms();
    renderLabels();
    drawDraft();
  } else if (drag.kind === 'entity') {
    const kind = drag.target.kind;
    const baseRect = kind === 'door' ? drag.base.rect : kind === 'window' ? windowFootprintRect(drag.base) : drag.base;
    const translation = snapEntityTranslation(drag.target, baseRect, point, drag.anchor);
    const {dx, dy} = translation;
    updateSnapGuides(translation.guide || {x: point.x, y: point.y});
    if (kind === 'wall') {
      const wall = state.plan.walls[drag.target.index];
      for (let index = 0; index < 4; index++) wall[index] = drag.base[index] + (index % 2 ? dy : dx);
      syncPlanRefs();
      renderWalls();
      renderDims();
    } else if (kind === 'window') {
      moveWindowEntityDuringDrag(state.plan.wins[drag.target.index], drag.base, dx, dy);
    } else if (kind === 'door') {
      moveDoorEntityDuringDrag(state.plan.doors[drag.target.index], drag.base, dx, dy);
    }
  }
  drag.moved = true;
  syncPlanRefs();
  drawSelection();
}

function updateToolHighlight() {
  document.querySelectorAll('[data-plan-tool]').forEach(button => {
    const matchesMode = button.dataset.planTool === editor.mode;
    const matchesType = !button.dataset.planType || button.dataset.planType === editor.type;
    button.classList.toggle('on', matchesMode && matchesType);
  });
}

function setMode(mode, type = null) {
  if (mode === 'foundation') {
    if (!ui.layers.foundation) $('#layers [data-layer="foundation"]').click();
    if (state.plan.foundation) {
      setMode('edit');
      selectPlan({kind: 'foundation', index: 0});
      drawer('panel', true);
      return;
    }
  }
  editor.mode = mode;
  editor.type = type;
  editor.selected = null;
  editor.draft = mode === 'edit' ? emptyDraft() : {kind: mode, type, points: [], start: null, current: null};
  editor.guides = [];
  planSvg.setAttribute('class', mode === 'edit' ? 'tool-plan-edit' : `tool-plan-${mode}`);
  updateToolHighlight();
  drawDraft();
  drawSelection();
  renderPlanPanel();
  renderDims();
}

function setPreview() {
  if (!editor.active) return;
  setMode('edit');
  editor.drag = null;
}

function activatePlan() {
  editor.active = true;
  planTools.hidden = false;
  furnitureLibrary.hidden = true;
  setMode('edit');
  drawer('lib', true);
  $('#tgPlan').classList.add('on');
  $('#tgLib').classList.remove('on');
  renderPlanPanel();
}

function deactivatePlan(leftMode = 'lib') {
  editor.active = false;
  editor.selected = null;
  editor.drag = null;
  editor.guides = [];
  editor.draft = emptyDraft();
  planTools.hidden = true;
  furnitureLibrary.hidden = false;
  planSvg.setAttribute('class', 'tool-select');
  updateToolHighlight();
  selectionLayer.innerHTML = '';
  drawDraft();
  $('#tgPlan').classList.remove('on');
  $('#tgLib').classList.toggle('on', leftMode === 'lib');
  drawer('lib', leftMode === 'lib');
  renderAll();
}

function releasePointer(event) {
  if (planSvg.hasPointerCapture?.(event.pointerId)) planSvg.releasePointerCapture(event.pointerId);
}

function onPointerDown(event) {
  if (!editor.active || event.button === 1 || event.button === 2) return;
  if (ui.tool === 'measure') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (ui.tool === 'preview') {
    editor.selected = null;
    editor.drag = {kind:'pan', anchorScreen: [event.clientX, event.clientY], view: [view.x0, view.y0], moved: false};
    drawSelection();
    renderPlanPanel();
    planSvg.setPointerCapture(event.pointerId);
    return;
  }
  const point = screenToPlan(event);
  if (editor.mode === 'room-rect' || editor.mode === 'foundation') {
    const start = snapRoomPoint(point, null);
    editor.draft.start = start;
    editor.draft.current = start;
    updateSnapGuides(start);
    drawDraft();
    planSvg.setPointerCapture(event.pointerId);
    return;
  }
  if (editor.mode === 'room') {
    editor.guides = [];
    const first = editor.draft.points[0];
    if (editor.draft.points.length >= 3 && first && distance(point, {x: first[0], y: first[1]}) <= Math.max(180, 18 / view.s)) {
      finishRoom();
      releasePointer(event);
      return;
    }
    const previous = editor.draft.points.at(-1);
    const next = snapRoomPoint(point, previous && {x: previous[0], y: previous[1]});
    if (!previous || distance(next, {x: previous[0], y: previous[1]}) > 20) editor.draft.points.push([next.x, next.y]);
    updateSnapGuides(next);
    editor.draft.current = next;
    drawDraft();
    planSvg.setPointerCapture(event.pointerId);
    return;
  }
  if (['wall', 'window', 'door'].includes(editor.mode)) {
    const start = snapOrthogonal(point, null);
    editor.draft.start = start;
    editor.draft.current = start;
    updateSnapGuides(start);
    drawDraft();
    planSvg.setPointerCapture(event.pointerId);
    return;
  }
  editor.guides = [];
  const vertex = selectedRoomVertex(point);
  if (vertex !== null) {
    const selectedRoom = ROOMS[editor.selected.index];
    editor.drag = {
      kind: 'room-point',
      roomIndex: editor.selected.index,
      pointIndex: vertex,
      anchor: point,
      base: selectedRoom?.poly.map(([x, y]) => [x, y]),
      before: snap(),
      moved: false
    };
    planSvg.setPointerCapture(event.pointerId);
    return;
  }
  const target = hitTest(point);
  if (target) {
    selectPlan(target);
    if (target.kind === 'foundation') {
      editor.drag = null;
      drawer('panel', true);
      return;
    }
    if (target.kind === 'room') {
      const room = ROOMS[target.index];
      editor.drag = {
        kind: 'room',
        roomIndex: target.index,
        anchor: point,
        base: room.poly.map(([x, y]) => [x, y]),
        before: snap(),
        moved: false
      };
    } else {
      const entity = target.kind === 'wall' ? WALLS[target.index] : target.kind === 'window' ? WINS[target.index] : DOORS[target.index];
      editor.drag = {kind: 'entity', target, anchor: point, base: JSON.parse(JSON.stringify(entity)), before: snap(), moved: false};
    }
    planSvg.setPointerCapture(event.pointerId);
    return;
  }
  selectPlan(null);
  editor.drag = {kind: 'pan', anchorScreen: [event.clientX, event.clientY], view: [view.x0, view.y0], moved: false};
  planSvg.setPointerCapture(event.pointerId);
}

function onPointerMove(event) {
  if (!editor.active) return;
  if (ui.tool === 'measure') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const point = screenToPlan(event);
  if ((editor.mode === 'room-rect' || editor.mode === 'foundation') && editor.draft.start) {
    editor.draft.current = snapRoomPoint(point, null);
    updateSnapGuides(editor.draft.current);
    drawDraft();
  } else if (editor.mode === 'room' && editor.draft.points.length) {
    const previous = editor.draft.points.at(-1);
    editor.draft.current = snapRoomPoint(point, {x: previous[0], y: previous[1]});
    updateSnapGuides(editor.draft.current);
    drawDraft();
  } else if (editor.draft.start && ['wall', 'window', 'door'].includes(editor.mode)) {
    editor.draft.current = snapOrthogonal(point, editor.draft.start);
    updateSnapGuides(editor.draft.current);
    drawDraft();
  }
  const drag = editor.drag;
  if (!drag) return;
  if (drag.kind === 'pan') {
    if (Math.hypot(event.clientX - drag.anchorScreen[0], event.clientY - drag.anchorScreen[1]) < 2) return;
    drag.moved = true;
    view.x0 = drag.view[0] - (event.clientX - drag.anchorScreen[0]) / view.s;
    view.y0 = drag.view[1] - (event.clientY - drag.anchorScreen[1]) / view.s;
    applyView();
    return;
  }
  moveSelected(point);
}

function onPointerUp(event) {
  if (!editor.active) return;
  if (ui.tool === 'measure') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if ((editor.mode === 'room-rect' || editor.mode === 'foundation') && editor.draft.start) {
    if (editor.mode === 'foundation') finishFoundation();
    else finishRoomRect();
    releasePointer(event);
    return;
  }
  if (editor.draft.start && ['wall', 'window', 'door'].includes(editor.mode)) {
    finishPrimitive();
    releasePointer(event);
    return;
  }
  const drag = editor.drag;
  editor.drag = null;
  editor.guides = [];
  drawDraft();
  drawSelection();
  releasePointer(event);
  if (!drag || drag.kind === 'pan') return;
  if (drag.moved) {
    syncPlanRefs();
    commit(drag.before);
    renderAll();
  }
}

function onPointerCancel(event) {
  if (!editor.active) return;
  if (ui.tool === 'measure') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  releasePointer(event);
  editor.guides = [];
  drawDraft();
  if (editor.draft.kind) {
    editor.draft = {kind: editor.mode === 'edit' ? null : editor.mode, type: editor.type, points: [], start: null, current: null};
    drawDraft();
    renderDims();
    return;
  }
  const drag = editor.drag;
  editor.drag = null;
  drawSelection();
  if (drag?.moved) {
    replaceState(JSON.parse(drag.before));
    syncPlanRefs();
    renderAll();
  }
}

function onDoubleClick(event) {
  if (!editor.active || editor.mode !== 'room') return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (editor.draft.points.length >= 3) finishRoom();
}

function onPlanKeyDown(event) {
  if (!editor.active || event.target.matches('input,select,textarea')) return;
  if (ui.tool === 'preview' || ui.tool === 'measure') return;
  const key = event.key.toLowerCase();
  const modifier = event.ctrlKey || event.metaKey;
  const consume = () => {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
  };
  if ((key === 'delete' || key === 'backspace') && (editor.selected || editor.draft.kind)) {
    consume();
    if (editor.draft.kind) setMode('edit');
    else deleteSelected();
    return;
  }
  if (modifier && key === 'd' && editor.selected) {
    consume();
    duplicateSelectedPlan();
    return;
  }
  const rotateKey = event.code === 'KeyR' || key === 'r';
  if (!modifier && rotateKey && editor.selected) {
    consume();
    rotateSelectedPlan(event.shiftKey ? -1 : 1);
    return;
  }
  if (!modifier && ['arrowleft', 'arrowright', 'arrowup', 'arrowdown'].includes(key) && editor.selected) {
    consume();
    const step = event.shiftKey ? 100 : 10;
    const dx = key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0;
    const dy = key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0;
    nudgeSelected(dx, dy);
    return;
  }
  if (key === 'escape') {
    consume();
    if (editor.draft.kind) setMode('edit');
    else selectPlan(null);
  }
}

function init() {
  ensurePlanData();
  syncPlanToolLabels();
  $('#tgPlan').onclick = () => editor.active ? deactivatePlan('none') : activatePlan();
  $('#tgLib').onclick = () => editor.active ? deactivatePlan('lib') : drawer('lib');
  let savedLeftMode = null;
  try { savedLeftMode = JSON.parse(localStorage.getItem(PANES))?.leftMode; } catch(e) {}
  if (savedLeftMode === 'plan') activatePlan();
  else if (savedLeftMode === 'lib') deactivatePlan('lib');
  else if (savedLeftMode === 'none') deactivatePlan('none');
  document.documentElement.classList.remove('prehide-lib', 'prehide-panel');
  document.querySelectorAll('[data-plan-tool]').forEach(button => {
    button.onclick = () => setMode(button.dataset.planTool, button.dataset.planType || null);
  });
  planSvg.addEventListener('pointerdown', onPointerDown, true);
  planSvg.addEventListener('pointermove', onPointerMove, true);
  planSvg.addEventListener('pointerup', onPointerUp, true);
  planSvg.addEventListener('pointercancel', onPointerCancel, true);
  planSvg.addEventListener('dblclick', onDoubleClick, true);
  // Capture 阶段优先于 app.js 的家具快捷键，避免户型选中对象被家具逻辑抢先消费.
  document.addEventListener('keydown', onPlanKeyDown, true);
  window.PlanEditor.syncOverlay();
}

/**
 * 对原有家具渲染流程提供户型编辑器的最小公共接口。
 */
export const PlanEditor = {
  init,
  isActive: () => editor.active,
  setPreview,
  syncOverlay() {
    if (editor.active) {
      if (!snappingEnabled()) editor.guides = [];
      drawDraft();
      drawSelection();
    }
  },
  syncRender() {
    if (editor.active) {
      const selected = editor.selected;
      const exists = !selected || (selected.kind === 'foundation' ? state.plan.foundation
        : selected.kind === 'room' ? ROOMS[selected.index]
          : selected.kind === 'wall' ? WALLS[selected.index]
            : selected.kind === 'window' ? WINS[selected.index] : DOORS[selected.index]);
      if (!exists) editor.selected = null;
      drawDraft();
      drawSelection();
      renderPlanPanel();
    }
  }
};

window.PlanEditor = PlanEditor;
PlanEditor.init();
