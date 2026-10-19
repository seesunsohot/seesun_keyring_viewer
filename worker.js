// Runs model code in an isolated module worker: no DOM, no localStorage, and the API key is never sent here.
// Contract: `code` is the body of a function (params, wasm) that returns
//   a Manifold | an array of Manifold or {name, manifold} | an object {name: Manifold}.
import ManifoldModule from './vendor/manifold.js';

const isManifold = (m) => m && typeof m.getMesh === 'function';

function normalize(out) {
  if (isManifold(out)) return [{ name: '모델', manifold: out }];
  if (Array.isArray(out)) {
    return out.map((o, i) => (isManifold(o) ? { name: `부품 ${i + 1}`, manifold: o } : { name: String(o?.name ?? `부품 ${i + 1}`), manifold: o?.manifold }));
  }
  if (out && typeof out === 'object') return Object.entries(out).map(([name, manifold]) => ({ name, manifold }));
  throw new Error('코드가 Manifold, 배열, 또는 {이름: Manifold} 객체를 return 해야 합니다.');
}

self.onmessage = async ({ data: { id, code, params } }) => {
  try {
    const wasm = await ManifoldModule({ locateFile: (f) => new URL('./vendor/' + f, import.meta.url).href });
    wasm.setup();
    const run = new Function('params', 'wasm', `"use strict";\nconst { Manifold, CrossSection } = wasm;\n${code}`);
    const parts = normalize(run(params, wasm));
    const result = [];
    const transfer = [];
    for (const { name, manifold } of parts) {
      if (!isManifold(manifold)) throw new Error(`"${name}"이(가) Manifold가 아닙니다.`);
      if (manifold.isEmpty()) throw new Error(`"${name}"이(가) 비어 있습니다 (boolean 결과가 비었거나 크기가 0).`);
      const mesh = manifold.getMesh();
      const positions = new Float32Array(mesh.numVert * 3);
      for (let i = 0; i < mesh.numVert; i++) for (let j = 0; j < 3; j++) positions[3 * i + j] = mesh.vertProperties[i * mesh.numProp + j];
      const indices = new Uint32Array(mesh.triVerts);
      const bb = manifold.boundingBox();
      result.push({
        name, positions, indices,
        bbox: { min: Array.from(bb.min), max: Array.from(bb.max) },
        volume: manifold.volume(),
        area: manifold.surfaceArea(),
        genus: manifold.genus(),
        tris: indices.length / 3,
      });
      transfer.push(positions.buffer, indices.buffer);
    }
    self.postMessage({ id, ok: true, parts: result }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message ?? err) });
  }
};
