import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import Anthropic from '@anthropic-ai/sdk';
import { SYSTEM_PROMPT, TOOL, SAMPLE, EXAMPLES } from './prompt.js';

const $ = (id) => document.getElementById(id);
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};
const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const status = $('status');

// ---------- 3D scene ----------
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
stage.prepend(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 0.5, 5000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.autoRotateSpeed = 1.6;
scene.add(new THREE.HemisphereLight(0xffffff, 0x8090a0, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(80, 140, 100); scene.add(key);
const rim = new THREE.DirectionalLight(0xffffff, 0.9); rim.position.set(-90, 40, -90); scene.add(rim);

const root = new THREE.Group();      // model space is z-up (mm); rotate into three's y-up
root.rotation.x = -Math.PI / 2;
scene.add(root);
const grid = new THREE.GridHelper(400, 40, 0x8a97a4, 0xb9c2cb);
grid.material.transparent = true; grid.material.opacity = 0.45;
scene.add(grid);

function themeBackground() {
  scene.background = new THREE.Color(css('--stage') || '#e4e8ec');
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  grid.material.opacity = dark ? 0.25 : 0.45;
}
themeBackground();
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', themeBackground);

function resize() {
  const r = stage.getBoundingClientRect();
  renderer.setSize(r.width, r.height, false);
  camera.aspect = r.width / Math.max(r.height, 1);
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

const PALETTE = ['#8aa4c8', '#d9824f', '#7fae8b', '#c9b25e', '#a58bc4', '#c97b8d', '#6fb3b8'];
let meshes = [];
let size = new THREE.Vector3(60, 60, 60);

function setView(dir) {
  const r = Math.max(size.x, size.y, size.z, 10) * 2.6;
  const v = { iso: [0.9, 0.7, 1], top: [0, 1, 0.001], front: [0, 0.15, 1], side: [1, 0.15, 0] }[dir];
  camera.position.copy(new THREE.Vector3(...v).normalize().multiplyScalar(r).add(controls.target));
  controls.update();
}

// ---------- worker build ----------
function build(code, params) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => { worker.terminate(); reject(new Error('30초 안에 끝나지 않아 중단했습니다 (너무 복잡하거나 무한 루프).')); }, 30000);
    worker.onmessage = ({ data }) => {
      clearTimeout(timer); worker.terminate();
      data.ok ? resolve(data.parts) : reject(new Error(data.error));
    };
    worker.onerror = (e) => { clearTimeout(timer); worker.terminate(); reject(new Error(e.message || 'Worker 오류')); };
    worker.postMessage({ id: 1, code, params });
  });
}

// ---------- model state ----------
let model = null;       // { title, summary, code, params: [{key,label,value,min,max,step,unit}] }
let values = {};
let built = [];         // parts from worker
let hidden = new Set();
let codeDirty = false;  // user edited code/params manually since Claude last saw them
let buildSeq = 0;

const fmt = (n, d = 1) => Number(n).toFixed(d);

function renderParts(first) {
  for (const m of meshes) { root.remove(m); m.geometry.dispose(); m.material.dispose(); }
  meshes = built.map((p, i) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
    geo.setIndex(new THREE.BufferAttribute(p.indices, 1));
    const flat = geo.toNonIndexed(); flat.computeVertexNormals(); geo.dispose();
    const mesh = new THREE.Mesh(flat, new THREE.MeshStandardMaterial({ color: PALETTE[i % PALETTE.length], roughness: 0.62, side: THREE.DoubleSide }));
    mesh.visible = !hidden.has(p.name);
    root.add(mesh);
    return mesh;
  });
  const box = overallBox();
  const c = new THREE.Vector3((box.min[0] + box.max[0]) / 2, (box.min[1] + box.max[1]) / 2, box.min[2]);
  root.position.set(-c.x, -c.z, c.y);   // center in x/y, rest on the grid (model z -> three y)
  size = new THREE.Vector3(box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]);
  controls.target.set(0, size.z / 2, 0);
  if (first) setView('iso'); else controls.update();
}

function overallBox() {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of built) for (let k = 0; k < 3; k++) { min[k] = Math.min(min[k], p.bbox.min[k]); max[k] = Math.max(max[k], p.bbox.max[k]); }
  return { min, max };
}

function renderDims() {
  if (!built.length) { $('dims').innerHTML = '<p class="muted">아직 모델이 없습니다.</p>'; return; }
  const b = overallBox();
  const [w, d, h] = [0, 1, 2].map((k) => b.max[k] - b.min[k]);
  const vol = built.reduce((a, p) => a + p.volume, 0) / 1000;           // cm³
  const area = built.reduce((a, p) => a + p.area, 0) / 100;             // cm²
  const rows = built.map((p, i) => {
    const s = [0, 1, 2].map((k) => fmt(p.bbox.max[k] - p.bbox.min[k])).join(' × ');
    return `<tr><td><label><input type="checkbox" data-part="${i}" ${hidden.has(p.name) ? '' : 'checked'}> ${esc(p.name)}</label></td><td>${s}</td><td>${fmt(p.volume / 1000, 2)}</td><td>${p.tris.toLocaleString()}</td></tr>`;
  }).join('');
  $('dims').innerHTML = `
    <div class="big">${fmt(w)} × ${fmt(d)} × ${fmt(h)} mm</div>
    <p class="muted">전체 가로 × 세로 × 높이 · 부피 ${fmt(vol, 2)} cm³ · 표면적 ${fmt(area, 1)} cm² · PLA 100% 채움 기준 약 ${fmt(vol * 1.24, 1)} g</p>
    <table><thead><tr><th>부품</th><th>크기 (mm)</th><th>부피 cm³</th><th>삼각형</th></tr></thead><tbody>${rows}</tbody></table>
    <p class="muted">모든 부품은 닫힌(watertight) 메시입니다. 실제 무게는 채움 비율에 따라 달라집니다.</p>`;
  $('dims').querySelectorAll('input[data-part]').forEach((el) => el.addEventListener('change', () => {
    const p = built[+el.dataset.part];
    el.checked ? hidden.delete(p.name) : hidden.add(p.name);
    meshes[+el.dataset.part].visible = el.checked;
  }));
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderSliders() {
  const box = $('sliders'); box.innerHTML = '';
  const ps = model?.params ?? [];
  $('noParams').style.display = ps.length ? 'none' : '';
  for (const p of ps) {
    const wrap = document.createElement('div'); wrap.className = 'slider';
    const id = 'p_' + p.key;
    wrap.innerHTML = `<label for="${id}">${esc(p.label || p.key)}</label><output id="${id}_o"></output><input id="${id}" type="range" min="${p.min}" max="${p.max}" step="${p.step}">`;
    box.append(wrap);
    const input = wrap.querySelector('input'), out = wrap.querySelector('output');
    const show = () => { out.textContent = `${values[p.key]}${p.unit ? ' ' + p.unit : ''}`; };
    input.value = values[p.key]; show();
    input.addEventListener('input', () => { values[p.key] = parseFloat(input.value); show(); syncJson(); codeDirty = true; scheduleRebuild(); });
  }
}
let rebuildTimer;
function scheduleRebuild() { clearTimeout(rebuildTimer); rebuildTimer = setTimeout(() => rebuild(), 150); }

function syncJson() { $('paramsJson').value = JSON.stringify(values, null, 2); }

async function rebuild({ first = false } = {}) {
  const seq = ++buildSeq;
  status.textContent = '모델 생성 중…';
  const t0 = performance.now();
  try {
    const parts = await build(model.code, values);
    if (seq !== buildSeq) return null;
    built = parts;
    renderParts(first); renderDims();
    status.textContent = `생성 완료 · ${Math.round(performance.now() - t0)} ms · 부품 ${parts.length}개`;
    return { ok: true, parts };
  } catch (err) {
    if (seq !== buildSeq) return null;
    status.textContent = '오류: ' + err.message;
    return { ok: false, error: err.message };
  }
}

function setModel(m, { first = true, fromUser = false } = {}) {
  model = { title: m.title || '모델', summary: m.summary || '', code: m.code, params: (m.params || []).map(normParam) };
  values = {}; for (const p of model.params) values[p.key] = p.value;
  hidden = new Set();
  $('title').textContent = model.title; $('summary').textContent = model.summary;
  $('code').value = model.code; syncJson(); renderSliders();
  store.set('studio.model', JSON.stringify(model));
  codeDirty = fromUser;
  return rebuild({ first });
}
function normParam(p) {
  const value = Number(p.value), min = Number(p.min ?? value / 4), max = Number(p.max ?? value * 4);
  return { key: String(p.key), label: p.label ?? p.key, value, min: Math.min(min, value), max: Math.max(max, value), step: Number(p.step) || Math.max((max - min) / 100, 0.01), unit: p.unit ?? '' };
}

// ---------- export ----------
function stlBytes(list) {
  let tris = 0; for (const p of list) tris += p.indices.length / 3;
  const buf = new ArrayBuffer(84 + tris * 50), dv = new DataView(buf);
  dv.setUint32(80, tris, true);
  let off = 84;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  for (const { positions: P, indices: I } of list) {
    for (let t = 0; t < I.length; t += 3) {
      a.fromArray(P, I[t] * 3); b.fromArray(P, I[t + 1] * 3); c.fromArray(P, I[t + 2] * 3);
      n.subVectors(c, b).cross(a.clone().sub(b)).normalize();
      for (const v of [n, a, b, c]) { dv.setFloat32(off, v.x, true); dv.setFloat32(off + 4, v.y, true); dv.setFloat32(off + 8, v.z, true); off += 12; }
      off += 2;
    }
  }
  return new Uint8Array(buf);
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = ~0; for (const x of b) c = crcTable[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
function zip(files) {
  const chunks = [], central = []; let off = 0;
  for (const { name, data } of files) {
    const n = new TextEncoder().encode(name), crc = crc32(data);
    const h = new DataView(new ArrayBuffer(30));
    [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, n.length, 2]].forEach(([o, v, w]) => w === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
    const c = new DataView(new ArrayBuffer(46));
    [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, n.length, 2], [42, off, 4]].forEach(([o, v, w]) => w === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
    chunks.push(h, n, data); central.push(c, n);
    off += 30 + n.length + data.length;
  }
  const sz = central.reduce((s, x) => s + x.byteLength, 0);
  const e = new DataView(new ArrayBuffer(22));
  [[0, 0x06054b50, 4], [8, files.length, 2], [10, files.length, 2], [12, sz, 4], [16, off, 4]].forEach(([o, v, w]) => w === 4 ? e.setUint32(o, v, true) : e.setUint16(o, v, true));
  return new Blob([...chunks, ...central, e], { type: 'application/zip' });
}
function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
}
const slug = (s) => (String(s).trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '') || 'model');
$('dlAll').onclick = () => {
  if (!built.length) return;
  const base = slug(model.title);
  if (built.length === 1) return save(new Blob([stlBytes(built)], { type: 'model/stl' }), `${base}.stl`);
  save(zip(built.map((p) => ({ name: `${base}-${slug(p.name)}.stl`, data: stlBytes([p]) }))), `${base}-stl.zip`);
};
$('dlMerged').onclick = () => { if (built.length) save(new Blob([stlBytes(built)], { type: 'model/stl' }), `${slug(model.title)}.stl`); };

// ---------- chat + Claude ----------
const chat = $('chat');
function addMsg(text, cls = 'bot') {
  const el = document.createElement('div'); el.className = 'msg ' + cls; el.textContent = text;
  chat.append(el); chat.scrollTop = chat.scrollHeight; return el;
}
const bump = () => { chat.scrollTop = chat.scrollHeight; };

let messages = [];          // Anthropic.MessageParam[], kept exactly as returned (thinking blocks included)
let busy = false;
let currentStream = null;
let useFallback = true;

const apiKeyEl = $('apiKey');
apiKeyEl.value = store.get('studio.apiKey') || '';
$('model').value = store.get('studio.model.id') || 'claude-opus-5-5';
if ($('model').selectedIndex < 0) $('model').value = 'claude-opus-5-5';
apiKeyEl.addEventListener('change', () => store.set('studio.apiKey', apiKeyEl.value.trim()));
$('model').addEventListener('change', () => store.set('studio.model.id', $('model').value));
$('clearKey').onclick = () => { apiKeyEl.value = ''; store.del('studio.apiKey'); addMsg('저장된 API 키를 지웠습니다.', 'sys'); };
$('gear').onclick = () => { const o = $('settings').classList.toggle('open'); $('gear').setAttribute('aria-expanded', o); };
if (!apiKeyEl.value) $('settings').classList.add('open');

function validTool(input) {
  if (!input || typeof input.code !== 'string' || !input.code.trim()) return '`code`가 비어 있습니다.';
  if (!Array.isArray(input.params ?? [])) return '`params`는 배열이어야 합니다.';
  for (const p of input.params ?? []) if (!p || typeof p.key !== 'string' || !Number.isFinite(Number(p.value))) return `params 항목이 잘못됐습니다: ${JSON.stringify(p)}`;
  return null;
}
function summarize(parts) {
  return parts.map((p) => {
    const s = [0, 1, 2].map((k) => fmt(p.bbox.max[k] - p.bbox.min[k], 2)).join(' × ');
    return `- ${p.name}: ${s} mm, 부피 ${fmt(p.volume / 1000, 3)} cm³, 삼각형 ${p.tris}, bbox z ${fmt(p.bbox.min[2], 2)}..${fmt(p.bbox.max[2], 2)}`;
  }).join('\n');
}

async function runTool(block) {
  const bad = validTool(block.input);
  if (bad) return { type: 'tool_result', tool_use_id: block.id, is_error: true, content: `입력 오류: ${bad}` };
  const note = addMsg('모델 생성 중…', 'sys');
  const res = await setModel(block.input, { first: !model || !built.length, fromUser: false });
  if (res?.ok) {
    note.textContent = `모델 적용: ${block.input.title || ''} (${res.parts.length}개 부품)`;
    return { type: 'tool_result', tool_use_id: block.id, content: `성공. 현재 모델 치수:\n${summarize(res.parts)}` };
  }
  note.textContent = '코드 오류: ' + (res?.error ?? '알 수 없음'); note.classList.add('err');
  return { type: 'tool_result', tool_use_id: block.id, is_error: true, content: `코드 실행 실패: ${res?.error ?? '알 수 없음'}\n코드를 고쳐서 update_model을 다시 호출하세요.` };
}

async function converse(userText) {
  const apiKey = apiKeyEl.value.trim();
  if (!apiKey) { $('settings').classList.add('open'); addMsg('먼저 설정에서 Anthropic API 키를 입력하세요.', 'sys err'); return; }
  store.set('studio.apiKey', apiKey);
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const modelId = $('model').value;

  // State the user may have changed by hand since Claude last saw it
  let content = userText;
  if (model) {
    const state = codeDirty
      ? `\n\n[현재 모델 상태 — 사용자가 직접 수정했을 수 있음]\n파라미터: ${JSON.stringify(values)}\n코드:\n${model.code === $('code').value ? model.code : $('code').value}`
      : `\n\n[현재 파라미터: ${JSON.stringify(values)}]`;
    content += state;
  }
  const rollback = messages.length;
  messages.push({ role: 'user', content });
  addMsg(userText, 'user');
  busy = true; $('send').textContent = '중지'; $('send').classList.remove('primary');

  try {
    for (let turn = 0; turn < 5; turn++) {
      const bubble = addMsg('…', 'bot'); let started = false;
      const params = {
        model: modelId,
        max_tokens: 32000,
        thinking: { type: 'adaptive' },
        system: SYSTEM_PROMPT,
        tools: [TOOL],
        messages,
      };
      const open = () => useFallback
        ? client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
        : client.messages.stream(params);
      let stream = open();
      const wire = (s) => {
        currentStream = s;
        s.on('text', (d) => { if (!started) { bubble.textContent = ''; started = true; } bubble.textContent += d; bump(); });
        s.on('streamEvent', (e) => {
          if (e.type !== 'content_block_start') return;
          if (!started && e.content_block.type === 'thinking') bubble.textContent = '생각하는 중…';
          if (!started && e.content_block.type === 'tool_use') bubble.textContent = '모델링 코드를 작성하는 중…';
        });
      };
      wire(stream);
      let msg;
      try { msg = await stream.finalMessage(); }
      catch (err) {
        if (useFallback && err instanceof Anthropic.BadRequestError && /fallback/i.test(err.message)) {
          useFallback = false; stream = open(); wire(stream); msg = await stream.finalMessage();
        } else throw err;
      }
      if (!started) bubble.remove();
      messages.push({ role: 'assistant', content: msg.content });   // keep blocks unchanged (thinking, tool_use)

      if (msg.stop_reason === 'refusal') { addMsg('Claude가 이 요청을 거절했습니다.', 'sys err'); break; }
      if (msg.stop_reason === 'max_tokens') { addMsg('응답이 길이 제한에 걸려 중간에 끊겼습니다. 더 작은 단위로 나눠 요청해 보세요.', 'sys err'); }
      if (msg.stop_reason !== 'tool_use') break;
      const results = [];
      for (const b of msg.content) if (b.type === 'tool_use') results.push(await runTool(b));
      messages.push({ role: 'user', content: results });
      codeDirty = false;
    }
  } catch (err) {
    messages.length = rollback;   // drop the unfinished turn so history stays valid
    const aborted = err?.name === 'APIUserAbortError' || /abort/i.test(err?.message || '');
    if (aborted) addMsg('중지했습니다.', 'sys');
    else if (err instanceof Anthropic.AuthenticationError) addMsg('API 키가 올바르지 않습니다. 설정에서 확인하세요.', 'sys err');
    else if (err instanceof Anthropic.RateLimitError) addMsg('요청이 너무 많습니다. 잠시 후 다시 시도하세요.', 'sys err');
    else if (err instanceof Anthropic.APIError) addMsg(`API 오류 (${err.status}): ${err.message}`, 'sys err');
    else addMsg('오류: ' + (err?.message ?? err), 'sys err');
  } finally {
    busy = false; currentStream = null; $('send').textContent = '보내기'; $('send').classList.add('primary');
  }
}

function send() {
  if (busy) { currentStream?.abort(); return; }
  const text = $('prompt').value.trim();
  if (!text) return;
  $('prompt').value = '';
  converse(text);
}
$('send').onclick = send;
$('prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
$('newChat').onclick = () => {
  if (busy) return;
  messages = []; chat.innerHTML = ''; greet();
};

function greet() {
  addMsg('만들고 싶은 모델을 설명해 주세요. 치수, 용도, 구멍이나 홈 같은 디테일을 알려 주시면 Claude가 파라메트릭 코드를 만들어 바로 보여 줍니다. 슬라이더로 수치를 바꾸고, STL로 저장할 수 있습니다.', 'bot');
  const chips = document.createElement('div'); chips.className = 'chips';
  for (const ex of EXAMPLES) { const b = document.createElement('button'); b.textContent = ex.label; b.onclick = () => { $('prompt').value = ex.text; $('prompt').focus(); }; chips.append(b); }
  chat.append(chips);
}

// ---------- code tab, tabs, views ----------
$('runCode').onclick = async () => {
  let v;
  try { v = JSON.parse($('paramsJson').value || '{}'); } catch { status.textContent = '파라미터 JSON 형식이 올바르지 않습니다.'; return; }
  model.code = $('code').value;
  values = v;
  for (const p of model.params) if (v[p.key] === undefined) values[p.key] = p.value;
  store.set('studio.model', JSON.stringify(model));
  codeDirty = true; renderSliders();
  const res = await rebuild();
  if (res && !res.ok) addMsg('코드 오류: ' + res.error, 'sys err');
};
$('copyCode').onclick = async () => { try { await navigator.clipboard.writeText($('code').value); status.textContent = '코드를 복사했습니다'; } catch { status.textContent = '복사할 수 없습니다'; } };

document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((o) => o.setAttribute('aria-selected', o === t));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('open', p.id === t.dataset.pane));
}));
$('vIso').onclick = () => setView('iso'); $('vTop').onclick = () => setView('top');
$('vFront').onclick = () => setView('front'); $('vSide').onclick = () => setView('side');
$('spin').onclick = () => { controls.autoRotate = !controls.autoRotate; $('spin').setAttribute('aria-pressed', controls.autoRotate); };

// ---------- go ----------
resize();
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });
let saved = null;
try { saved = JSON.parse(store.get('studio.model') || 'null'); } catch { /* ignore */ }
greet();
setModel(saved?.code ? saved : SAMPLE, { first: true }).then((r) => { if (r && !r.ok && saved) setModel(SAMPLE, { first: true }); });
