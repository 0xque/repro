import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const html = await readFile(new URL('./index.html', import.meta.url), 'utf8');
const [style, script] = ['style','script'].map(tag => html.match(new RegExp('<'+tag+'>([\\s\\S]*?)</'+tag+'>'))?.[1]);
assert.ok(style && script);
const worker = (await import('./worker.mjs')).default;
const labels = ['Overview','Inspect','Replay','Verify','Limits'];

class Element {
  attrs={}; hidden=true; scrollLeft=0; value='0'; textContent='';
  handlers={}; children={}; classList=new Set();
  style={ setProperty:(key,value)=>this.style[key]=value };
  constructor({ label, left }={}) {
    this.dataset={ label };
    this.offsetLeft=left;
    this.classList.remove=this.classList.delete.bind(this.classList);
  }
  addEventListener(event, callback) { this.handlers[event]=callback; }
  querySelector(sel) { return this.children[sel]; }
  querySelectorAll(sel) { return this.children[sel]; }
  setAttribute(name,value){ this.attrs[name]=value; }
  scrollTo(value){ this.lastScroll=value; this.scrollLeft=value.left; this.trigger('scroll'); }
  trigger(name, properties={}) {
    let prevented=false;
    this.handlers[name]?.({ target:this, preventDefault:()=>{prevented=true;}, ...properties });
    return prevented;
  }
}

function setup({ reduced=false, panelStep=1064 }={}) {
  const rail=new Element();
  const nav=new Element();
  const step=new Element();
  const page=new Element();
  const scale=new Element();
  const prev=new Element();
  const next=new Element();
  const scrub=new Element();
  const number=new Element();
  const name=new Element();
  const copy=new Element();
  const command=new Element();
  const message=new Element();
  let clipboard='';
  const frames=[];
  command.textContent='repro compare checkout.repro before.json after.json';
  rail.children['.panel']=labels.map((label,index)=>new Element({label, left:panelStep*index+32}));
  Object.assign(nav.children,{ '.scale':scale,'.rail-prev':prev,'.rail-next':next,'.scrub':scrub });
  Object.assign(step.children,{ strong:number,span:name });
  const doc={
    querySelector:sel=>({'.rail':rail,'.rail-position':step,'.rail-nav':nav})[sel],
    getElementById:id=>({ copy,cmd:command,'copy-state':message })[id]
  };
  vm.runInNewContext(script,{
    window:page,document:doc,
    navigator:{clipboard:{writeText:async value=>{clipboard=value;}}},
    matchMedia:()=>({matches:reduced}),
    requestAnimationFrame:callback=>{ frames.push(callback); return frames.length; }
  });
  return { rail,page,nav,step,scale,scrub,prev,next,number,name,copy,message,command,clipboard:()=>clipboard, flush:()=>{while(frames.length)frames.shift()();} };
}

test('nav controls, rail offsets and exact keyboard boundaries',()=>{
  const u=setup();
  assert.equal(u.nav.hidden,false);
  assert.equal(u.step.hidden,false);
  assert.ok(u.rail.classList.has('has-controls'));
  assert.equal(u.prev.attrs['aria-disabled'],'true');
  u.next.trigger('click'); u.flush();
  assert.equal(u.rail.lastScroll.left,1064);
  assert.equal(u.scrub.attrs['aria-valuetext'],'2 of 5: Inspect');
  assert.equal(u.scrub.trigger('keydown',{key:'ArrowRight'}),true); u.flush();
  assert.equal(u.name.textContent,'Replay');
  assert.equal(u.rail.trigger('keydown',{key:'End'}),true); u.flush();
  assert.equal(u.number.textContent,'05 / 05');
  assert.equal(u.next.attrs['aria-disabled'],'true');
  assert.equal(u.rail.trigger('keydown',{key:'PageDown'}),false);
  assert.equal(u.scrub.trigger('keydown',{key:'Home'}),true); u.flush();
  assert.equal(u.name.textContent,'Overview');
});

test('pointer input scrubs the full rail and snaps to the closest panel',()=>{
  const u=setup();
  u.scrub.trigger('pointerdown',{pointerId:1});
  assert.ok(u.rail.classList.has('scrubbing'));
  u.scrub.value='720';
  u.scrub.trigger('input'); u.rail.trigger('scroll'); u.flush();
  assert.ok(Math.abs(u.rail.scrollLeft-3064.32)<.01);
  assert.equal(u.name.textContent,'Verify');
  assert.equal(u.scrub.value,'720');
  u.page.trigger('pointerup',{pointerId:1}); u.flush();
  assert.equal(u.rail.classList.has('scrubbing'),false);
  assert.equal(u.rail.scrollLeft,3192);
  assert.equal(u.scrub.value,'750');
});

test('compact panel offsets honor reduced motion and native scrolling updates the ruler',()=>{
  for (const panelStep of [340,270]) {
    const u=setup({reduced:true,panelStep});
    u.next.trigger('click'); u.flush();
    assert.equal(u.rail.lastScroll.behavior,'auto');
    assert.equal(u.rail.lastScroll.left,panelStep);
    u.rail.scrollLeft=panelStep*3;
    u.rail.trigger('scroll'); u.flush();
    assert.equal(u.name.textContent,'Verify');
    assert.equal(u.scale.style['--progress'],'75%');
  }
  assert.match(style,/overflow-x:auto/);
  assert.match(style,/scroll-snap-type:x mandatory/);
  assert.match(style,/prefers-reduced-motion:reduce/);
  assert.doesNotMatch(script,/addEventListener\(['"]wheel/);
});

test('clipboard copies the exact draft comparison command',async()=>{
  const u=setup();
  await u.copy.handlers.click();
  assert.equal(u.message.textContent,'Copied.');
  assert.equal(u.clipboard(),u.command.textContent);
});

test('worker serves the exact HTML and locks inline style and script to content hashes',async()=>{
  const url='http://localhost/';
  const response=worker.fetch(new Request(url));
  assert.equal(response.status,200);
  assert.equal(await response.text(),html);
  const csp=response.headers.get('content-security-policy');
  for(const asset of [style,script]) assert.ok(csp.includes('sha256-'+createHash('sha256').update(asset).digest('base64')));
  assert.match(csp,/frame-ancestors 'none'/);
  for(const id of ['case-note','packet','workflow','evidence','limits']){
    assert.ok(html.includes('href="#'+id+'"'));
    assert.ok(html.includes('id="'+id+'"'));
  }
  assert.equal(worker.fetch(new Request(url,{method:'POST'})).status,405);
  assert.equal(worker.fetch(new Request(new URL('anything',url))).status,404);
});
