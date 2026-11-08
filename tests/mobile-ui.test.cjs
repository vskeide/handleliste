const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const path = require('node:path')

function load(file,mocks={},cache=new Map()) {
  const full=path.resolve(file)
  if(cache.has(full))return cache.get(full).exports
  const mod={exports:{}};cache.set(full,mod)
  const js=ts.transpileModule(fs.readFileSync(full,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2020,jsx:ts.JsxEmit.ReactJSX}}).outputText
  new Function('require','module','exports',js)(id=>{
    if(Object.hasOwn(mocks,id))return mocks[id]
    if(id.startsWith('@/'))return load(id.slice(2)+(/\.[jt]sx?$/.test(id)?'':fs.existsSync(id.slice(2)+'.tsx')?'.tsx':'.ts'),mocks,cache)
    return require(id)
  },mod,mod.exports)
  return mod.exports
}

test('modal scroll locks freeze the page and restore its exact position after nested panels close',()=>{
  const previous={document:global.document,window:global.window}
  const body={position:'relative',top:'',left:'',right:'',width:'',overflow:'auto'}
  const root={overflow:'auto',overscrollBehavior:'contain'},scroll=[]
  global.document={body:{style:body},documentElement:{style:root}}
  global.window={scrollX:0,scrollY:420,scrollTo:(...args)=>scroll.push(args)}
  const cleanups=[]
  try {
    const {useBodyScrollLock}=load('lib/hooks/use-body-scroll-lock.ts',{react:{useEffect:effect=>cleanups.push(effect())}})
    useBodyScrollLock();assert.equal(body.position,'fixed');assert.equal(body.top,'-420px');assert.equal(root.overflow,'hidden')
    useBodyScrollLock();cleanups[0]()
    assert.equal(body.position,'fixed');assert.equal(scroll.length,0)
    cleanups[1]()
    assert.equal(body.position,'relative');assert.equal(body.overflow,'auto');assert.equal(root.overflow,'auto');assert.equal(root.overscrollBehavior,'contain')
    assert.deepEqual(scroll,[[0,420]])
    // React development effects mount, clean up, then mount again.
    useBodyScrollLock();cleanups[2]();useBodyScrollLock();cleanups[3]()
    assert.equal(body.position,'relative');assert.equal(scroll.length,3)
  } finally {global.document=previous.document;global.window=previous.window}
})

test('dragging or cancelling a picker gesture never marks the item picked, while taps and keyboard activation do',()=>{
  const picked=[]
  const {NextItemMode}=load('components/next-item-mode.tsx',{
    react:{useState:value=>[value,()=>{}],useRef:value=>({current:value}),useEffect:()=>{}},
    '@/components/full-screen-panel':{FullScreenPanel:()=>null},
    '@/lib/hooks/use-screen-awake':{useScreenAwake:()=>({})},
    '@/components/quantity-picker-sheet':{formatQuantityDisplay:q=>q},
    '@/components/item-name':{ItemName:()=>null,fitFontSize:()=>''},
  })
  const tree=NextItemMode({items:[{listItemId:'line',name:'Eple',quantity:'1'}],onPick:id=>picked.push(id),onUndo:()=>{},onClose:()=>{}})
  const surface=tree.props.children.props
  surface.onPointerDown({clientX:100,clientY:100});surface.onPointerMove({clientX:100,clientY:180});surface.onClick({detail:1})
  assert.deepEqual(picked,[])
  surface.onPointerDown({clientX:100,clientY:100});surface.onPointerCancel();surface.onClick({detail:1})
  assert.deepEqual(picked,[])
  surface.onPointerDown({clientX:100,clientY:100});surface.onPointerMove({clientX:102,clientY:104});surface.onClick({detail:1});surface.onClick({detail:0})
  assert.deepEqual(picked,['line','line'])
})

async function withWakeLock(request,check) {
  const previous={navigator:Object.getOwnPropertyDescriptor(global,'navigator'),document:global.document}
  const changes=[],cleanups=[],listeners={}
  Object.defineProperty(global,'navigator',{configurable:true,value:{wakeLock:{request}}})
  global.document={visibilityState:'visible',addEventListener:(name,fn)=>{listeners[name]=fn},removeEventListener:name=>{delete listeners[name]}}
  let index=0
  const api=load('lib/hooks/use-screen-awake.ts',{react:{useState:value=>{const slot=index++;return [value,next=>changes.push([slot,next])]},useEffect:effect=>{const cleanup=effect();if(cleanup)cleanups.push(cleanup)}}})
  try {api.useScreenAwake(true);await check({changes,cleanups,listeners,document:global.document})}
  finally {for(const cleanup of cleanups.splice(0))cleanup();if(previous.navigator)Object.defineProperty(global,'navigator',previous.navigator);else delete global.navigator;global.document=previous.document}
}
const settle=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()}

test('a wake-lock request resolving after leaving the page is released immediately',async()=>{
  let resolve,releases=0
  await withWakeLock(()=>new Promise(r=>{resolve=r}),async({changes,cleanups})=>{
    cleanups.shift()()
    resolve({released:false,release:async()=>{releases++},addEventListener(){}})
    await settle()
    assert.equal(releases,1);assert.equal(changes.some(([slot,value])=>slot===2&&value===true),false)
  })
})
test('wake lock resumes on return to the foreground and is released when disabled',async()=>{
  const locks=[]
  await withWakeLock(async()=>{
    const l={released:false,releases:0,release:async()=>{l.released=true;l.releases++},addEventListener:(_,fn)=>{l.onRelease=fn}};locks.push(l);return l
  },async({changes,cleanups,listeners,document})=>{
    await settle();assert.equal(locks.length,1)
    document.visibilityState='hidden';locks[0].released=true;locks[0].onRelease()
    document.visibilityState='visible';listeners.visibilitychange();await settle()
    assert.equal(locks.length,2);assert.ok(changes.some(([slot,value])=>slot===2&&value===true))
    cleanups.shift()();assert.equal(locks[1].releases,1);assert.equal(listeners.visibilitychange,undefined)
  })
})
test('a refused wake lock switches off with a useful error',async()=>{
  await withWakeLock(async()=>{throw Error('NotAllowedError')},async({changes})=>{
    await settle();assert.ok(changes.some(([slot,value])=>slot===0&&value===false));assert.ok(changes.some(([slot,value])=>slot===3&&typeof value==='string'))
  })
})

test('keyboard positioning uses the visible bottom without transforms and handles resized Android viewports',()=>{
  const previous=global.window,values=[],events={};let cleanup
  const viewport={height:450,offsetTop:20,addEventListener:(name,fn)=>{events[name]=fn},removeEventListener:name=>{delete events[name]}}
  global.window={innerHeight:800,visualViewport:viewport}
  try {
    const {useKeyboardViewport}=load('lib/hooks/use-keyboard-viewport.ts',{react:{useState:()=>[null,value=>values.push(value)],useEffect:effect=>{cleanup=effect()}}})
    useKeyboardViewport()
    assert.deepEqual(values.at(-1),{top:20,height:450,bottom:330})
    viewport.offsetTop=40;events.scroll();assert.equal(values.at(-1).bottom,310)
    // Edge/Chrome may resize the layout itself: normal bottom:0 already follows the keyboard.
    global.window.innerHeight=450;viewport.offsetTop=0;events.resize();assert.equal(values.at(-1),null)
    global.window.innerHeight=800;viewport.height=800;events.resize();assert.equal(values.at(-1),null)
    cleanup();assert.deepEqual(events,{})
  } finally {global.window=previous}
})
