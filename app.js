// ============================================================
// Jimmikub Timer
// ============================================================

const PLAYERS = [
  { id: 'jay',   name: 'Jay',   avatar: 'avatars/Jay.png',
    bg: 'radial-gradient(circle at 35% 30%, #7CB8F5 0%, #2E6FD1 100%)' },
  { id: 'jim',   name: 'Jim',   avatar: 'avatars/Jim.png',
    bg: 'radial-gradient(circle at 35% 30%, #A8E063 0%, #3B8B2E 100%)' },
  { id: 'catie', name: 'Catie', avatar: 'avatars/Catie.png',
    bg: 'radial-gradient(circle at 35% 30%, #F48FB1 0%, #C2185B 100%)' },
  { id: 'lucas', name: 'Lucas', avatar: 'avatars/Lucas.png',
    bg: 'radial-gradient(circle at 35% 30%, #FFCC80 0%, #E65100 100%)' },
];
const JOKER_AVATAR = 'avatars/joker.png';
const JOKER_BG = 'radial-gradient(circle at 35% 30%, #FFE082 0%, #FF6F00 100%)';

const STORAGE_KEY = 'jimmikub.settings.v2';

// ------------ State ------------
const state = {
  seatOrder: PLAYERS.map(p => p.id),  // active players, CCW order; persists
  benched: [],                         // players sitting out this game; persists
  firstId: null,                       // who deals this round; null → seatOrder[0]
  durationSec: 90,
  // play-time fields
  playOrder: [],                       // rotated order for the current game
  currentIdx: 0,
  turnStartMs: 0,
  rafId: null,
  lastSecondShown: null,
  overtime: false,
  overtimeChimeAt: 0,
  audioCtx: null,
  wakeLock: null,
};

function rotatedOrder() {
  if (state.seatOrder.length === 0) return [];
  const fid = state.firstId && state.seatOrder.includes(state.firstId)
    ? state.firstId
    : state.seatOrder[0];
  const i = state.seatOrder.indexOf(fid);
  return state.seatOrder.slice(i).concat(state.seatOrder.slice(0, i));
}

// ------------ DOM ------------
const $ = (sel) => document.querySelector(sel);
const setupScreen = $('#setup-screen');
const timerScreen = $('#timer-screen');
const seatCircle = $('#seat-circle');
const benchEl = $('#bench');
const firstPicker = $('#first-picker');
const presetRow = $('#duration-presets');
const customInput = $('#duration-custom');
const startBtn = $('#start-btn');
const backBtn = $('#back-btn');
const timerStage = $('#timer-stage');
const currentAvatar = $('#current-avatar');
const currentName = $('#current-name');
const timeDisplay = $('#time-display');

// ============================================================
// Setup screen
// ============================================================

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const d = JSON.parse(raw);
      const validIds = new Set(PLAYERS.map(p => p.id));
      if (Array.isArray(d.seatOrder)) {
        state.seatOrder = d.seatOrder.filter(id => validIds.has(id));
      }
      if (Array.isArray(d.benched)) {
        state.benched = d.benched.filter(id => validIds.has(id) && !state.seatOrder.includes(id));
      }
      state.firstId = null;
      state.durationSec = 90;
      // Ensure every player is accounted for; first player and duration reset each load.
      PLAYERS.forEach(p => {
        if (!state.seatOrder.includes(p.id) && !state.benched.includes(p.id)) {
          state.seatOrder.push(p.id);
        }
      });
    }
  } catch {}
}

function saveSettings() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      seatOrder: state.seatOrder,
      benched: state.benched,
    }));
  } catch {}
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const CHART_W = 300;
const CHART_CX = 150;
const CHART_CY = 142;
const AVATAR_RADIUS = 28;
const SEAT_CORE_WIDTH = AVATAR_RADIUS * 2;
const SEAT_NAME_GAP = 4;
const SEAT_NAME_HEIGHT = 14;
const SEAT_NAME_WIDTH = 42;
const CONTROL_GAP = 10;
const CONTROL_BUTTON_SIZE = 26;
const CONTROL_BUTTON_GAP = 4;
const ARROW_GAP = 12;
const TRIANGLE_BASE_ARROW_GAP = 12;
const ARROW_LENGTH = 9;
const ARROW_WIDTH = 8;
const CHART_PAD_Y = 4;

function controlsLongSize(n) {
  const buttonCount = n <= 2 ? 1 : 3;
  return CONTROL_BUTTON_SIZE * buttonCount + CONTROL_BUTTON_GAP * (buttonCount - 1);
}

function viewportHeight() {
  return window.visualViewport?.height ?? window.innerHeight;
}

function seatRadius(n) {
  const compact = viewportHeight() < 760;
  if (n === 4) return compact ? 82 : 86;
  if (n === 3) return compact ? 68 : 74;
  if (n === 2) return 62;
  return 0;
}

function seatPositions(n) {
  if (n === 0) return [];
  if (n === 1) return [{ x: CHART_CX, y: CHART_CY }];
  if (n === 2) {
    const r = seatRadius(n);
    return [
      { x: CHART_CX - r, y: CHART_CY },
      { x: CHART_CX + r, y: CHART_CY },
    ];
  }
  // Counterclockwise from top.
  const r = seatRadius(n);
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 - (2 * Math.PI / n) * i;
    return { x: CHART_CX + r * Math.cos(angle), y: CHART_CY + r * Math.sin(angle) };
  });
}

function unitOutward(pos, center) {
  const dx = pos.x - center.x;
  const dy = pos.y - center.y;
  const len = Math.hypot(dx, dy);
  if (!len) return { x: 0, y: -1 };
  return { x: dx / len, y: dy / len };
}

function seatCoreRect(pos) {
  return {
    left: pos.x - SEAT_CORE_WIDTH / 2,
    right: pos.x + SEAT_CORE_WIDTH / 2,
    top: pos.y - AVATAR_RADIUS,
    bottom: pos.y + AVATAR_RADIUS + SEAT_NAME_GAP + SEAT_NAME_HEIGHT,
  };
}

function seatNameRect(pos) {
  return {
    left: pos.x - SEAT_NAME_WIDTH / 2,
    right: pos.x + SEAT_NAME_WIDTH / 2,
    top: pos.y + AVATAR_RADIUS + SEAT_NAME_GAP,
    bottom: pos.y + AVATAR_RADIUS + SEAT_NAME_GAP + SEAT_NAME_HEIGHT,
  };
}

function controlStyle(pos, center) {
  const outward = unitOutward(pos, center);
  const core = seatCoreRect(pos);
  const coreCenterY = (core.top + core.bottom) / 2;
  const vertical = Math.abs(outward.x) > Math.abs(outward.y);
  let x;
  let y;
  let transform;
  if (vertical) {
    x = outward.x < 0 ? core.left - CONTROL_GAP : core.right + CONTROL_GAP;
    y = coreCenterY;
    transform = outward.x < 0 ? 'translate(-100%, -50%)' : 'translate(0, -50%)';
  } else {
    x = pos.x;
    y = outward.y < 0 ? core.top - CONTROL_GAP : core.bottom + CONTROL_GAP;
    transform = outward.y < 0 ? 'translate(-50%, -100%)' : 'translate(-50%, 0)';
  }
  return { x, y, vertical, transform };
}

function controlRect(pos, center, n) {
  const controls = controlStyle(pos, center);
  const outward = unitOutward(pos, center);
  const longSize = controlsLongSize(n);
  if (controls.vertical) {
    return {
      left: outward.x < 0 ? controls.x - CONTROL_BUTTON_SIZE : controls.x,
      right: outward.x < 0 ? controls.x : controls.x + CONTROL_BUTTON_SIZE,
      top: controls.y - longSize / 2,
      bottom: controls.y + longSize / 2,
    };
  }
  return {
    left: controls.x - longSize / 2,
    right: controls.x + longSize / 2,
    top: outward.y < 0 ? controls.y - CONTROL_BUTTON_SIZE : controls.y,
    bottom: outward.y < 0 ? controls.y : controls.y + CONTROL_BUTTON_SIZE,
  };
}

function layoutBounds(positions, center, n) {
  return positions.reduce((bounds, pos) => {
    [seatCoreRect(pos), controlRect(pos, center, n)].forEach((rect) => {
      bounds.top = Math.min(bounds.top, rect.top);
      bounds.bottom = Math.max(bounds.bottom, rect.bottom);
    });
    return bounds;
  }, { top: Infinity, bottom: -Infinity });
}

function seatLayout(n) {
  const rawPositions = seatPositions(n);
  if (n === 0) {
    return { positions: [], center: { x: CHART_CX, y: CHART_CY }, height: 0 };
  }

  const rawCenter = { x: CHART_CX, y: CHART_CY };
  const bounds = layoutBounds(rawPositions, rawCenter, n);
  const shiftY = CHART_PAD_Y - bounds.top;
  return {
    positions: rawPositions.map(pos => ({ x: pos.x, y: pos.y + shiftY })),
    center: { x: CHART_CX, y: CHART_CY + shiftY },
    height: Math.ceil(bounds.bottom - bounds.top + CHART_PAD_Y * 2),
  };
}

function rayRectExitDistance(origin, ux, uy, rect) {
  let tMin = -Infinity;
  let tMax = Infinity;
  const axes = [
    { origin: origin.x, dir: ux, min: rect.left, max: rect.right },
    { origin: origin.y, dir: uy, min: rect.top, max: rect.bottom },
  ];

  for (const axis of axes) {
    if (Math.abs(axis.dir) < 0.0001) {
      if (axis.origin < axis.min || axis.origin > axis.max) return null;
      continue;
    }
    const t1 = (axis.min - axis.origin) / axis.dir;
    const t2 = (axis.max - axis.origin) / axis.dir;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
  }

  if (tMax < 0 || tMin > tMax) return null;
  return tMax;
}

function pointOutsideSeatVisual(pos, toward, gap = ARROW_GAP) {
  const dx = toward.x - pos.x;
  const dy = toward.y - pos.y;
  const len = Math.hypot(dx, dy);
  if (!len) return { ...pos };

  const ux = dx / len;
  const uy = dy / len;
  const nameExit = rayRectExitDistance(pos, ux, uy, seatNameRect(pos));
  const edgeDistance = Math.max(AVATAR_RADIUS, nameExit ?? 0);

  return {
    x: pos.x + ux * (edgeDistance + gap),
    y: pos.y + uy * (edgeDistance + gap),
  };
}

function drawSeatArrow(svg, from, to, offset = 0, gap = ARROW_GAP) {
  const start = pointOutsideSeatVisual(from, to, gap);
  const tip = pointOutsideSeatVisual(to, from, gap);
  const dx = tip.x - start.x;
  const dy = tip.y - start.y;
  const len = Math.hypot(dx, dy);
  if (len <= ARROW_LENGTH + 2) return;

  const ux = dx / len;
  const uy = dy / len;
  const ox = -uy * offset;
  const oy = ux * offset;
  const x1 = start.x + ox;
  const y1 = start.y + oy;
  const tipX = tip.x + ox;
  const tipY = tip.y + oy;
  const baseX = tipX - ux * ARROW_LENGTH;
  const baseY = tipY - uy * ARROW_LENGTH;
  const perpX = -uy * ARROW_WIDTH / 2;
  const perpY = ux * ARROW_WIDTH / 2;

  const group = document.createElementNS(SVG_NS, 'g');
  group.setAttribute('opacity', '0.58');

  const line = document.createElementNS(SVG_NS, 'line');
  line.setAttribute('x1', x1);
  line.setAttribute('y1', y1);
  line.setAttribute('x2', baseX);
  line.setAttribute('y2', baseY);
  line.setAttribute('stroke', '#f4f4ff');
  line.setAttribute('stroke-width', '2.4');
  line.setAttribute('stroke-linecap', 'round');
  group.appendChild(line);

  const head = document.createElementNS(SVG_NS, 'polygon');
  head.setAttribute('points', [
    `${tipX},${tipY}`,
    `${baseX + perpX},${baseY + perpY}`,
    `${baseX - perpX},${baseY - perpY}`,
  ].join(' '));
  head.setAttribute('fill', '#f4f4ff');
  group.appendChild(head);

  svg.appendChild(group);
}

function directionArrow(from, to) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const arrows = ['→', '↘', '↓', '↙', '←', '↖', '↑', '↗'];
  const index = (Math.round(angle / (Math.PI / 4)) + 8) % 8;
  return arrows[index];
}

function sortedMoveButtons(pos, controls, prevPos, nextPos, prevName, nextName, playerName, n) {
  if (n <= 2) return '';

  return [
    {
      act: 'prev',
      target: prevPos,
      label: `Move ${playerName} toward ${prevName ?? 'previous seat'}`,
      arrow: directionArrow(pos, prevPos),
    },
    {
      act: 'next',
      target: nextPos,
      label: `Move ${playerName} toward ${nextName ?? 'next seat'}`,
      arrow: directionArrow(pos, nextPos),
    },
  ]
    .sort((a, b) => controls.vertical ? a.target.y - b.target.y : a.target.x - b.target.x)
    .map(btn => `<button type="button" data-act="${btn.act}" aria-label="${btn.label}" ${n < 2 ? 'disabled' : ''}>${btn.arrow}</button>`)
    .join('');
}

function renderSeatCircle() {
  seatCircle.innerHTML = '';
  const n = state.seatOrder.length;
  const layout = seatLayout(n);
  const positions = layout.positions;
  const center = layout.center;
  seatCircle.style.height = `${layout.height}px`;

  // Arrows between consecutive seats (CCW)
  if (n >= 2) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.classList.add('seat-arrows');
    svg.setAttribute('viewBox', `0 0 ${CHART_W} ${layout.height}`);
    for (let i = 0; i < n; i++) {
      const a = positions[i];
      const b = positions[(i + 1) % n];
      const gap = n === 3 && Math.abs(a.y - b.y) < 1 ? TRIANGLE_BASE_ARROW_GAP : ARROW_GAP;
      drawSeatArrow(svg, a, b, n === 2 ? 7 : 0, gap);
    }
    seatCircle.appendChild(svg);
  }

  // Seats
  state.seatOrder.forEach((id, i) => {
    const p = PLAYERS.find(pp => pp.id === id);
    const pos = positions[i];
    const prevPos = positions[(i - 1 + n) % n] ?? pos;
    const nextPos = positions[(i + 1) % n] ?? pos;
    const prevPlayer = PLAYERS.find(pp => pp.id === state.seatOrder[(i - 1 + n) % n]);
    const nextPlayer = PLAYERS.find(pp => pp.id === state.seatOrder[(i + 1) % n]);
    const controls = controlStyle(pos, center);
    const moveButtons = sortedMoveButtons(
      pos,
      controls,
      prevPos,
      nextPos,
      prevPlayer?.name,
      nextPlayer?.name,
      p.name,
      n
    );
    const div = document.createElement('div');
    div.className = 'seat';
    div.dataset.id = id;
    div.innerHTML = `
      <div class="seat-core" style="left: ${pos.x}px; top: ${pos.y - AVATAR_RADIUS}px;">
        <img class="avatar" src="${p.avatar}" alt="" style="background: ${p.bg};" />
        <div class="name">${p.name}</div>
      </div>
      <div class="controls ${controls.vertical ? 'vertical' : ''}" style="left: ${controls.x}px; top: ${controls.y}px; transform: ${controls.transform};">
        ${moveButtons}
        <button type="button" data-act="remove" class="remove" aria-label="Remove ${p.name}">✕</button>
      </div>
    `;
    seatCircle.appendChild(div);
  });
}

function renderBench() {
  benchEl.innerHTML = '';
  if (state.benched.length === 0) {
    benchEl.hidden = true;
    return;
  }
  benchEl.hidden = false;
  const label = document.createElement('div');
  label.className = 'label';
  label.textContent = 'Not playing';
  benchEl.appendChild(label);

  const row = document.createElement('div');
  row.className = 'bench-row';
  state.benched.forEach((id) => {
    const p = PLAYERS.find(pp => pp.id === id);
    const div = document.createElement('div');
    div.className = 'bench-player';
    div.dataset.id = id;
    div.innerHTML = `
      <img class="avatar" src="${p.avatar}" alt="" style="background: ${p.bg};" />
      <div class="name">${p.name}</div>
      <button type="button" class="add" data-act="add" aria-label="Add ${p.name} back">+</button>
    `;
    row.appendChild(div);
  });
  benchEl.appendChild(row);
}

function renderFirstPicker() {
  firstPicker.innerHTML = '';
  if (state.seatOrder.length === 0) return;
  const fid = state.firstId && state.seatOrder.includes(state.firstId) ? state.firstId : state.seatOrder[0];
  state.seatOrder.forEach((id) => {
    const p = PLAYERS.find(pp => pp.id === id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'first-option' + (id === fid ? ' selected' : '');
    btn.dataset.id = id;
    btn.innerHTML = `
      <img class="avatar" src="${p.avatar}" alt="" style="background: ${p.bg};" />
      <div class="name">${p.name}</div>
    `;
    firstPicker.appendChild(btn);
  });
}

function renderAll() {
  renderSeatCircle();
  renderBench();
  renderFirstPicker();
  updateStartBtn();
}

seatCircle.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const seat = btn.closest('.seat');
  if (!seat) return;
  const id = seat.dataset.id;
  const idx = state.seatOrder.indexOf(id);
  if (idx === -1) return;
  const n = state.seatOrder.length;
  const act = btn.dataset.act;
  if (act === 'next' && n > 1) {
    const j = (idx + 1) % n;
    [state.seatOrder[idx], state.seatOrder[j]] = [state.seatOrder[j], state.seatOrder[idx]];
  } else if (act === 'prev' && n > 1) {
    const j = (idx - 1 + n) % n;
    [state.seatOrder[idx], state.seatOrder[j]] = [state.seatOrder[j], state.seatOrder[idx]];
  } else if (act === 'remove') {
    state.seatOrder.splice(idx, 1);
    state.benched.push(id);
    if (state.firstId === id) state.firstId = state.seatOrder[0] ?? null;
  }
  saveSettings();
  renderAll();
});

benchEl.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-act="add"]');
  if (!btn) return;
  const bp = btn.closest('.bench-player');
  if (!bp) return;
  const id = bp.dataset.id;
  const i = state.benched.indexOf(id);
  if (i === -1) return;
  state.benched.splice(i, 1);
  state.seatOrder.push(id);
  saveSettings();
  renderAll();
});

firstPicker.addEventListener('click', (e) => {
  const btn = e.target.closest('.first-option');
  if (!btn) return;
  state.firstId = btn.dataset.id;
  renderFirstPicker();
  updateStartBtn();
  saveSettings();
});

let resizeRenderId = null;
function scheduleSetupRender() {
  if (!setupScreen.classList.contains('active')) return;
  if (resizeRenderId) cancelAnimationFrame(resizeRenderId);
  resizeRenderId = requestAnimationFrame(() => {
    resizeRenderId = null;
    renderAll();
  });
}
window.addEventListener('resize', scheduleSetupRender);
window.visualViewport?.addEventListener('resize', scheduleSetupRender);

function updateStartBtn() {
  if (state.seatOrder.length < 2) {
    startBtn.disabled = true;
    startBtn.textContent = 'Need at least 2 players';
    return;
  }
  if (!Number.isFinite(state.durationSec)) {
    startBtn.disabled = true;
    startBtn.textContent = 'Choose turn length';
    return;
  }
  const fid = state.firstId && state.seatOrder.includes(state.firstId) ? state.firstId : state.seatOrder[0];
  const first = PLAYERS.find(p => p.id === fid);
  startBtn.disabled = false;
  startBtn.textContent = `Start · ${first.name} first · ${state.durationSec}s`;
}

// Duration presets
presetRow.addEventListener('click', (e) => {
  const btn = e.target.closest('.preset');
  if (!btn) return;
  setDuration(parseInt(btn.dataset.seconds, 10), 'preset');
});

function setDuration(seconds, source) {
  state.durationSec = seconds;
  presetRow.querySelectorAll('.preset').forEach((btn) => {
    const isActivePreset = source === 'preset' && parseInt(btn.dataset.seconds, 10) === seconds;
    btn.classList.toggle('active', isActivePreset);
  });
  customInput.classList.toggle('active', source === 'custom');
  if (source === 'preset') customInput.value = '';
  updateStartBtn();
  saveSettings();
}

function clearDurationSelection({ customActive = false } = {}) {
  state.durationSec = null;
  presetRow.querySelectorAll('.preset').forEach(btn => btn.classList.remove('active'));
  customInput.classList.toggle('active', customActive);
  updateStartBtn();
}

function readCustomDuration() {
  if (customInput.value.trim() === '') return false;
  const v = Math.round(Number(customInput.value));
  return Number.isFinite(v) && v >= 1 && v <= 600 ? v : null;
}

function commitCustomDuration({ normalize = false } = {}) {
  const v = readCustomDuration();
  if (v === false) {
    clearDurationSelection();
    return true;
  }
  if (v === null) {
    clearDurationSelection({ customActive: true });
    return false;
  }
  if (normalize) customInput.value = String(v);
  setDuration(v, 'custom');
  return true;
}

customInput.addEventListener('input', () => {
  commitCustomDuration();
});
customInput.addEventListener('change', () => {
  commitCustomDuration({ normalize: true });
});
customInput.addEventListener('blur', () => {
  commitCustomDuration({ normalize: true });
});

function syncDurationUI() {
  let matched = false;
  presetRow.querySelectorAll('.preset').forEach(b => {
    const match = parseInt(b.dataset.seconds, 10) === state.durationSec;
    b.classList.toggle('active', match);
    if (match) matched = true;
  });
  const customHasValue = customInput.value.trim() !== '';
  customInput.classList.toggle('active', !matched && customHasValue);
  if (matched) {
    customInput.value = '';
  } else if (Number.isFinite(state.durationSec)) {
    customInput.value = String(state.durationSec);
  }
}

// ============================================================
// Audio — Web Audio API generated chimes
// ============================================================

function ensureAudio() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audioCtx.state === 'suspended') state.audioCtx.resume();
  return state.audioCtx;
}

// Play a single tone with an envelope. type: 'sine'|'triangle'|'square'|'sawtooth'
function playTone({ freq, durMs, type = 'sine', gain = 0.3, attackMs = 6, releaseMs = 80, startOffset = 0 }) {
  const ctx = ensureAudio();
  const now = ctx.currentTime + startOffset;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  g.gain.setValueAtTime(0, now);
  g.gain.linearRampToValueAtTime(gain, now + attackMs / 1000);
  g.gain.setValueAtTime(gain, now + (durMs - releaseMs) / 1000);
  g.gain.exponentialRampToValueAtTime(0.0001, now + durMs / 1000);
  osc.connect(g).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + durMs / 1000 + 0.05);
}

// Single mellow "ding" used for the 1m / 30s / 15s marks (repeated 1/2/3x).
function playMarkChime(repeats) {
  const SPACING = 0.22; // seconds between dings — quick succession
  for (let i = 0; i < repeats; i++) {
    playTone({
      freq: 880,
      durMs: 320,
      type: 'sine',
      gain: 0.28,
      releaseMs: 280,
      startOffset: i * SPACING,
    });
  }
}

// Bell-like ring: layered inharmonic partials with long exponential decay.
function playBell() {
  const ctx = ensureAudio();
  const now = ctx.currentTime;
  const totalDur = 2.6;

  // Strike transient — short burst of filtered noise for the "ting".
  const noiseLen = 0.04;
  const buf = ctx.createBuffer(1, ctx.sampleRate * noiseLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const noiseFilter = ctx.createBiquadFilter();
  noiseFilter.type = 'highpass';
  noiseFilter.frequency.value = 3000;
  const noiseGain = ctx.createGain();
  noiseGain.gain.setValueAtTime(0.18, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + noiseLen);
  noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);
  noise.start(now);

  // Inharmonic partials approximating a bell's spectrum, all decaying together.
  // Fundamental E6 (1318 Hz) + characteristic bell ratios.
  const partials = [
    { freq: 1318, gain: 0.32 },  // strike tone / fundamental
    { freq: 1568, gain: 0.16 },  // minor third above (the bell's "hum")
    { freq: 2637, gain: 0.14 },  // octave (nominal)
    { freq: 3640, gain: 0.10 },  // upper partial
    { freq: 5200, gain: 0.06 },  // shimmer
  ];

  for (const p of partials) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = p.freq;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(p.gain, now + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, now + totalDur);
    osc.connect(g).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + totalDur + 0.05);
  }
}

const Chimes = {
  oneMinute()  { playMarkChime(1); },
  thirtySec()  { playMarkChime(2); },
  fifteenSec() { playMarkChime(3); },

  // 10 seconds — fast trill (distinct from the mark chime and the bell)
  tenSec() {
    for (let i = 0; i < 4; i++) {
      playTone({
        freq: i % 2 === 0 ? 1200 : 900,
        durMs: 90,
        type: 'square',
        gain: 0.2,
        attackMs: 2,
        releaseMs: 40,
        startOffset: i * 0.1,
      });
    }
  },

  // Per-second tick in last 9 seconds (9..1)
  tick() {
    playTone({ freq: 1500, durMs: 50, type: 'square', gain: 0.18, attackMs: 1, releaseMs: 30 });
  },

  // Time's up — long, high bell ring
  timesUp() {
    playBell();
  },

  // Gentle reminder during overtime (every ~6s)
  overtimeReminder() {
    playTone({ freq: 330, durMs: 250, type: 'sine', gain: 0.18, releaseMs: 200 });
  },
};

// ============================================================
// Wake Lock — keep screen on during turn
// ============================================================

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
  } catch {}
}
function releaseWakeLock() {
  if (state.wakeLock) { state.wakeLock.release().catch(() => {}); state.wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && timerScreen.classList.contains('active') && !state.wakeLock) {
    requestWakeLock();
  }
});

// ============================================================
// Timer
// ============================================================

function startGame() {
  if (!commitCustomDuration({ normalize: true })) {
    customInput.reportValidity?.();
    customInput.focus();
    return;
  }
  if (!Number.isFinite(state.durationSec)) {
    customInput.focus();
    return;
  }
  ensureAudio();      // must happen inside user gesture
  state.playOrder = rotatedOrder();
  state.currentIdx = 0;
  setupScreen.classList.remove('active');
  timerScreen.classList.add('active');
  beginTurn();
  requestWakeLock();
}

function endGame() {
  cancelAnimationFrame(state.rafId);
  state.rafId = null;
  timerScreen.classList.remove('active', 'warn', 'danger', 'overtime');
  setupScreen.classList.add('active');
  releaseWakeLock();
}

function beginTurn() {
  state.turnStartMs = performance.now();
  state.lastSecondShown = null;
  state.overtime = false;
  state.overtimeChimeAt = 0;
  timerScreen.classList.remove('warn', 'danger', 'overtime');
  currentAvatar.classList.remove('joker');

  const p = PLAYERS.find(pp => pp.id === state.playOrder[state.currentIdx]);
  currentAvatar.src = p.avatar;
  currentAvatar.alt = p.name;
  currentAvatar.style.background = p.bg;
  currentName.textContent = p.name;

  if (state.rafId) cancelAnimationFrame(state.rafId);
  tick();
}

function tick() {
  const elapsedMs = performance.now() - state.turnStartMs;
  const remainingMs = state.durationSec * 1000 - elapsedMs;

  if (remainingMs > 0) {
    const remainingSec = Math.ceil(remainingMs / 1000);
    if (remainingSec !== state.lastSecondShown) {
      onSecondTick(remainingSec, state.lastSecondShown);
      state.lastSecondShown = remainingSec;
    }
    timeDisplay.textContent = formatTime(remainingSec);

    // Background color cues
    timerScreen.classList.toggle('warn', remainingSec <= 30 && remainingSec > 10);
    timerScreen.classList.toggle('danger', remainingSec <= 10);
  } else {
    if (!state.overtime) {
      state.overtime = true;
      timerScreen.classList.remove('warn', 'danger');
      timerScreen.classList.add('overtime');
      currentAvatar.src = JOKER_AVATAR;
      currentAvatar.style.background = JOKER_BG;
      currentAvatar.classList.add('joker');
      Chimes.timesUp();
      state.overtimeChimeAt = performance.now() + 6000;
    } else if (performance.now() >= state.overtimeChimeAt) {
      Chimes.overtimeReminder();
      state.overtimeChimeAt = performance.now() + 6000;
    }
    timeDisplay.textContent = '0:00';
  }

  state.rafId = requestAnimationFrame(tick);
}

function onSecondTick(remainingSec, prevSec) {
  // Trigger at the moment the displayed seconds value crosses a mark.
  // We check newly-shown value (e.g., 60 means we've just hit the 1m mark).
  if (prevSec === null) return;          // first paint, no chime
  if (remainingSec === 60) Chimes.oneMinute();
  else if (remainingSec === 30) Chimes.thirtySec();
  else if (remainingSec === 15) Chimes.fifteenSec();
  else if (remainingSec === 10) Chimes.tenSec();
  else if (remainingSec >= 1 && remainingSec <= 9) Chimes.tick();
}

function formatTime(totalSec) {
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function advanceTurn() {
  state.currentIdx = (state.currentIdx + 1) % state.playOrder.length;
  beginTurn();
}

// Tap anywhere on the stage = end turn
timerStage.addEventListener('click', advanceTurn);

backBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  endGame();
});

startBtn.addEventListener('click', startGame);

// ============================================================
// Init
// ============================================================
loadSaved();
renderAll();
syncDurationUI();
