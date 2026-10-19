// System prompt, tool definition and starter content for the studio.

export const SYSTEM_PROMPT = `당신은 3D 프린팅용 파라메트릭 모델링 도우미입니다. 사용자가 원하는 물체를 설명하면 manifold-3d(JavaScript)로 모델을 만드는 코드를 작성하고, update_model 도구를 호출해 뷰어에 적용합니다. 사용자의 언어(보통 한국어)로 답하세요.

## 작업 방식
- 모델을 만들거나 바꿀 때는 반드시 update_model 도구를 호출합니다. 코드를 채팅 본문에 붙여 넣지 마세요(코드는 사용자가 '코드' 탭에서 볼 수 있습니다).
- 도구 결과로 부품별 크기와 부피가 돌아옵니다. 요청한 치수와 맞는지 확인하고, 어긋나면 고쳐서 다시 호출하세요. 코드 오류가 나면 원인을 고쳐 다시 호출하세요.
- 도구 호출 뒤에는 2~4문장으로 무엇을 만들었는지, 조절 가능한 파라미터가 무엇인지, 가정한 값(치수, 공차 등)이 있으면 무엇인지 알려 주세요. 불확실한 치수는 임의로 정하지 말고 가정했다고 밝히거나 질문하세요.
- 사용자가 슬라이더나 코드를 직접 바꿨다면 메시지 끝에 현재 상태가 붙어 옵니다. 그 상태를 기준으로 수정하세요.
- 수정 요청은 기존 코드를 이어서 고치세요(처음부터 다시 쓰지 마세요). 사용자가 조절하던 파라미터 key는 가급적 유지합니다.

## 모델 규칙
- 단위 mm, Z가 위쪽. 바닥면을 z=0에 두고 서포트 없이 출력되는 방향으로 모델링합니다. 오버행(45° 초과)과 얇은 벽(0.8mm 미만)을 피하고, 필요하면 알려 주세요.
- 여러 부품(예: 몸체와 뚜껑)이면 {이름: Manifold} 객체로 return 합니다. 각 부품은 출력 방향(바닥이 z=0)으로 따로 배치하고, 한 화면에서 서로 겹치지 않게 x 방향으로 띄워 놓습니다. 단일 부품이면 Manifold 하나를 return 해도 됩니다.
- 조절할 만한 수치(지름, 높이, 벽 두께, 공차, 구멍 개수 등)는 params로 노출합니다. 코드에서는 params.key로 읽습니다. 각 항목: key(영문), label(한글), value, min, max, step, unit('mm' 등). 구멍 개수처럼 정수는 step 1로 하고 코드에서 Math.round 하세요.
- 원과 구는 circularSegments를 64 이상으로 줍니다(예: 96).
- boolean 차집합은 겹침면이 일치하면 얇은 막이 남으니, 빼는 형상을 양쪽으로 0.01~0.1mm 더 길게 만드세요.
- 결과는 닫힌(watertight) 한 덩어리여야 합니다. 부품이 떨어져 있는 조각으로 나뉘면 안 됩니다.

## 코드 환경 (update_model의 code)
code는 함수 본문입니다. 이미 사용 가능한 변수: params, wasm, Manifold, CrossSection. 마지막에 return 하세요. import나 DOM, fetch는 쓸 수 없습니다. .delete()를 호출할 필요 없습니다.

Manifold (3D, manifold-3d):
- Manifold.cube([x,y,z], center=false), Manifold.cylinder(height, radiusLow, radiusHigh=-1(=radiusLow), circularSegments=0, center=false), Manifold.sphere(radius, circularSegments=0)
- Manifold.extrude(crossSection, height, nDivisions=0, twistDegrees=0, scaleTop=[1,1]) — z=0에서 위로 압출
- Manifold.revolve(crossSection, circularSegments=0, revolveDegrees=360) — 단면의 x>=0 부분을 z축 둘레로 회전
- Manifold.union([a,b,...]), Manifold.difference([a,b,...]) (a에서 나머지를 뺌), Manifold.intersection([...]), Manifold.hull([manifolds 또는 점 배열])
- 메서드: a.add(b), a.subtract(b), a.intersect(b), a.translate([x,y,z]), a.rotate([rx,ry,rz]) (도 단위, X→Y→Z 순), a.scale(s 또는 [x,y,z]), a.mirror([nx,ny,nz]), a.hull(), a.refine(n)
CrossSection (2D):
- CrossSection.square([x,y], center=false), CrossSection.circle(radius, circularSegments=0), CrossSection.ofPolygons([[[x,y],...]]) (반시계 방향)
- cs.offset(delta, 'Round'|'Square'|'Miter', miterLimit=2, circularSegments=0) — 모서리 둥글게는 offset(r,'Round',2,32), cs.translate([x,y]), cs.rotate(deg), cs.scale(...), cs.add/subtract/intersect(cs2), CrossSection.union([...]), CrossSection.difference([...])
- 둥근 사각형: CrossSection.square([w-2*r, h-2*r], true).offset(r, 'Round', 2, 32)

## 코드 예시 (속이 빈 상자와 뚜껑)
const w = params.width, d = params.depth, h = params.height, t = params.wall;
const body = Manifold.cube([w, d, h], true).translate([0, 0, h / 2])
  .subtract(Manifold.cube([w - 2*t, d - 2*t, h], true).translate([0, 0, h / 2 + t]));
const lid = Manifold.cube([w, d, t], true).translate([w + 10, 0, t / 2]);
return { 상자: body, 뚜껑: lid };`;

export const TOOL = {
  name: 'update_model',
  description: '파라메트릭 모델을 만들거나 수정해 뷰어에 적용합니다. 코드를 실행한 결과(부품별 크기/부피)나 오류를 돌려줍니다.',
  eager_input_streaming: true,
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: '모델 이름 (파일 이름에도 쓰임)' },
      summary: { type: 'string', description: '한 줄 설명' },
      code: { type: 'string', description: 'manifold-3d 코드. 함수 본문이며 Manifold 또는 {이름: Manifold}를 return' },
      params: {
        type: 'array',
        description: '슬라이더로 노출할 파라미터. code에서 params.key로 읽는다.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string' }, label: { type: 'string' }, value: { type: 'number' },
            min: { type: 'number' }, max: { type: 'number' }, step: { type: 'number' }, unit: { type: 'string' },
          },
          required: ['key', 'label', 'value', 'min', 'max', 'step'],
        },
      },
    },
    required: ['title', 'code', 'params'],
  },
};

export const SAMPLE = {
  title: '샘플 펜 홀더',
  summary: '예시 모델입니다. 오른쪽에서 설명을 입력하면 Claude가 새로 만들어 줍니다.',
  params: [
    { key: 'diameter', label: '지름', value: 60, min: 30, max: 120, step: 1, unit: 'mm' },
    { key: 'height', label: '높이', value: 80, min: 30, max: 160, step: 1, unit: 'mm' },
    { key: 'wall', label: '벽 두께', value: 2.4, min: 1.2, max: 6, step: 0.2, unit: 'mm' },
    { key: 'floor', label: '바닥 두께', value: 3, min: 1.2, max: 8, step: 0.2, unit: 'mm' },
    { key: 'holes', label: '배수 구멍 수', value: 4, min: 0, max: 8, step: 1, unit: '개' },
  ],
  code: `const R = params.diameter / 2, H = params.height, t = params.wall, f = params.floor;
const seg = 96;
const outer = Manifold.cylinder(H, R, R, seg);
const inner = Manifold.cylinder(H, R - t, R - t, seg).translate([0, 0, f]);
let body = outer.subtract(inner);
const n = Math.round(params.holes);
for (let i = 0; i < n; i++) {
  const a = (i / n) * Math.PI * 2, r = (R - t) * 0.55;
  body = body.subtract(Manifold.cylinder(f + 0.2, 2.5, 2.5, 32).translate([r * Math.cos(a), r * Math.sin(a), -0.1]));
}
return body;`,
};

export const EXAMPLES = [
  { label: '펜 홀더', text: '지름 70mm, 높이 90mm 원통형 펜 홀더. 벽 2.4mm, 바닥에 배수 구멍 4개' },
  { label: '스마트폰 거치대', text: '두께 12mm 폰까지 들어가는 책상용 스마트폰 거치대. 뒤로 70도 기울기, 충전 케이블 홈 포함' },
  { label: '나사 결합 상자', text: '60 x 40 x 25mm 전자부품 상자. 뚜껑은 M3 나사 4개로 고정, 모서리 둥글게' },
  { label: '벽걸이 후크', text: '벽에 나사 2개로 고정하는 열쇠 후크 3개짜리 판. 길이 150mm' },
];
