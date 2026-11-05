const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
function load(file) {
  const mod = { exports: {} }
  const js = ts.transpileModule(fs.readFileSync(file,'utf8'),{ compilerOptions:{ module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020 } }).outputText
  new Function('module','exports',js)(mod,mod.exports)
  return mod.exports
}
const { routeRanks, combineRoutePairs } = load('lib/route-order.ts')
const { resizeBlock, canPlaceBlock, twoFingerFrame, zoomScroll } = load('lib/map-geometry.ts')
const pair = (a,b,n=2,score=1) => ({ a_id:a,b_id:b,a_before_b:score,n })

test('half-finished lists teach only observed relative order', () => {
  const small = routeRanks(['C','B','A'],[pair('A','B')])
  const large = routeRanks(['C',...Array.from({length:100},(_,i)=>`unpicked-${i}`),'B','A'],[pair('A','B')])
  assert.ok(small.A.avg < small.B.avg); assert.ok(large.A.avg < large.B.avg)
  assert.equal(small.C,undefined); assert.equal(large['unpicked-50'],undefined)
  assert.equal(small.A.n,large.A.n)
})
test('transitive comparisons order a route even when products were picked on different partial trips', () => {
  const r=routeRanks(['C','B','A'],[pair('A','B'),pair('B','C')])
  assert.ok(r.A.avg < r.B.avg && r.B.avg < r.C.avg)
})
test('uncertain comparisons leave the manual fallback alone', () => {
  assert.deepEqual(routeRanks(['B','A'],[pair('A','B',8,0.51)]),{})
  assert.equal(routeRanks(['B','A'],[pair('A','B',1)]).A.n,1)
})
test('contradictory routes break weak cycles deterministically', () => {
  const pairs=[pair('A','B',8),pair('B','C',8),pair('A','C',1,0.2)]
  const r=routeRanks(['C','B','A'],pairs)
  assert.ok(r.A.avg<r.B.avg && r.B.avg<r.C.avg)
  assert.deepEqual(routeRanks(['C','B','A'],pairs),r)
})
test('shared section evidence is combined without exposing product comparisons', () => {
  const rows=combineRoutePairs([pair('A','B',100,1),pair('A','B',2,0)])
  assert.equal(rows.length,1); assert.equal(rows[0].n,10); assert.equal(rows[0].a_before_b,0.8)
})

const block={ section_id:'section',col:4,row:5,width:6,height:7 }
test('all four edges resize while keeping the opposite edge fixed', () => {
  assert.deepEqual(resizeBlock(block,'left',-2,0,24,28),{...block,col:2,width:8})
  assert.deepEqual(resizeBlock(block,'right',2,0,24,28),{...block,width:8})
  assert.deepEqual(resizeBlock(block,'top',0,-3,24,28),{...block,row:2,height:10})
  assert.deepEqual(resizeBlock(block,'bottom',0,3,24,28),{...block,height:10})
})
test('resizing cannot invert a tile or leave the grid', () => {
  const left=resizeBlock(block,'left',100,0,24,28)
  assert.equal(left.width,1); assert.equal(left.col+left.width,block.col+block.width)
  const top=resizeBlock(block,'top',0,-100,24,28)
  assert.equal(top.row,0); assert.equal(top.height,block.row+block.height)
  assert.equal(resizeBlock(block,'right',100,0,24,28).width,20)
  assert.equal(resizeBlock(block,'bottom',0,100,24,28).height,23)
})
test('large edge hit targets do not permit overlapping sections', () => {
  const neighbor={...block,col:10,width:2}
  assert.equal(canPlaceBlock(block,[block,neighbor],24,28,0),true)
  assert.equal(canPlaceBlock(resizeBlock(block,'right',1,0,24,28),[block,neighbor],24,28,0),false)
})
test('two-finger translation pans without changing zoom distance', () => {
  const a=twoFingerFrame({x:10,y:20},{x:110,y:20}), b=twoFingerFrame({x:40,y:60},{x:140,y:60})
  assert.equal(a.distance,b.distance)
  const x=zoomScroll({x:0.5,y:0.5},a.center,2,360,24,28), y=zoomScroll({x:0.5,y:0.5},b.center,2,360,24,28)
  assert.equal(y.left-x.left,-30); assert.equal(y.top-x.top,-40)
})
test('pinch zoom keeps the same content point beneath its centre', () => {
  const anchor={x:0.3,y:0.7}, centre={x:140,y:180}, zoom=3
  const scroll=zoomScroll(anchor,centre,zoom,360,24,28), width=360*zoom-48
  assert.equal(24+anchor.x*width-scroll.left,centre.x)
  assert.ok(Math.abs(24+anchor.y*width*28/24-scroll.top-centre.y)<1e-8)
  assert.equal(twoFingerFrame({x:0,y:0},{x:200,y:0}).distance/twoFingerFrame({x:0,y:0},{x:100,y:0}).distance,2)
})
