/* ============================================================
 * 共享工具方法
 * 供 app.js、plan-editor.js 和 scene3d.js 复用。
 * ============================================================ */

export function loadJson(path){
  const request = new XMLHttpRequest();
  request.open('GET', new URL(path, document.baseURI), false);
  request.send();
  if ((request.status >= 200 && request.status < 300) || (request.status === 0 && request.responseText)) {
    return JSON.parse(request.responseText);
  }
  throw new Error(`JSON 资源加载失败：${path} (${request.status})`);
}

export const $ = selector => document.querySelector(selector);

/* 几何与数字工具 */
export const area = poly => Math.abs(poly.reduce((a,p,i) => { const q = poly[(i+1)%poly.length]; return a + p[0]*q[1] - q[0]*p[1]; }, 0)) / 2 / 1e6;
export const perim = poly => poly.reduce((a,p,i) => { const q = poly[(i+1)%poly.length]; return a + Math.hypot(q[0]-p[0], q[1]-p[1]); }, 0) / 1000;
export const bbox = poly => { const xs = poly.map(p=>p[0]), ys = poly.map(p=>p[1]); return [Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)]; };
export function aabb(f){ const a = f.rot*Math.PI/180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)); return {hw:f.w/2*c + f.d/2*s, hh:f.w/2*s + f.d/2*c}; }
export const fmt = (n, d=2) => n.toFixed(d);
export const norm = a => ((Math.round(a) % 360) + 360) % 360;

/* 颜色工具 */
export function hex2rgb(h){ h = h.replace('#',''); if (h.length===3) h = h.split('').map(c=>c+c).join(''); const n = parseInt(h,16); return [(n>>16)&255,(n>>8)&255,n&255]; }
export function shade(h,k){ const f = v => Math.max(0,Math.min(255,Math.round(k>1 ? v+(255-v)*(k-1)*2 : v*k))); return '#'+hex2rgb(h).map(v=>f(v).toString(16).padStart(2,'0')).join(''); }

/* 家具 SVG 图例工具 */
export const ST = 'stroke="#3d3a34" stroke-width="1" vector-effect="non-scaling-stroke"';
export const rc = (x,y,w,h,f,ex='') => `<rect x="${x}" y="${y}" width="${Math.max(0,w)}" height="${Math.max(0,h)}" fill="${f}" ${ST} ${ex}/>`;
export const ec = (cx,cy,rx,ry,f,ex='') => `<ellipse cx="${cx}" cy="${cy}" rx="${Math.max(0,rx)}" ry="${Math.max(0,ry)}" fill="${f}" ${ST} ${ex}/>`;
export const ln = (x1,y1,x2,y2,ex='') => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${ST} ${ex}/>`;
export const pa = (d,f='none',ex='') => `<path d="${d}" fill="${f}" ${ST} ${ex}/>`;
export const DASH = 'stroke-dasharray="4 3"';

export function furnSVG(t,w,d,c){
  const x = -w/2, y = -d/2, m = Math.min(w,d);
  switch (t){
    case 'bed': {
      let s = rc(x,y,w,d,'#fbf8f2','rx="30"') + rc(x,y,w,Math.min(90,d*.05),shade(c,.62),'rx="20"');
      const ph = Math.min(360,d*.18), py = y+150;
      if (w >= 1300){ const pw = (w-240)/2; s += rc(x+80,py,pw,ph,'#fff','rx="70"') + rc(x+160+pw,py,pw,ph,'#fff','rx="70"'); }
      else s += rc(x+80,py,w-160,ph,'#fff','rx="70"');
      const by = py+ph+110, bh = y+d-15-by;
      s += rc(x+15,by,w-30,bh,c,'rx="40"') + pa(`M${x+15} ${by+300}H${x+w-15}`,'none',DASH);
      s += pa(`M${x+w-15-Math.min(420,w*.3)} ${by}L${x+w-15} ${by}L${x+w-15} ${by+Math.min(420,w*.3)}Z`, shade(c,1.12));
      return s;
    }
    case 'sofa': case 'armchair': {
      const b = d*.24, a = Math.min(200,w*.13), n = t==='armchair' ? 1 : (w>2200 ? 3 : 2), cw = (w-2*a)/n, dk = shade(c,.85);
      let s = rc(x,y,w,d,dk,'rx="60"');
      for (let i=0;i<n;i++) s += rc(x+a+i*cw,y+b,cw,d-b-40,c,'rx="40"');
      return s + rc(x,y,w,b,dk,'rx="50"') + rc(x,y,a,d,dk,'rx="50"') + rc(x+w-a,y,a,d,dk,'rx="50"');
    }
    case 'cornersofa': {
      const k = Math.min(950,d*.56,w*.4), b = 220, dk = shade(c,.85);
      let s = pa(`M${x} ${y}H${x+w}V${y+k}H${x+k}V${y+d}H${x}Z`, dk);
      const cw = (w-b-200)/2;
      s += rc(x+b,y+b,cw,k-b-30,c,'rx="40"') + rc(x+b+cw,y+b,cw,k-b-30,c,'rx="40"') + rc(x+b,y+k,k-b-30,d-k-200,c,'rx="40"');
      return s + rc(x,y,w,b,dk,'rx="50"') + rc(x,y,b,d,dk,'rx="50"') + rc(x+w-200,y,200,k,dk,'rx="50"') + rc(x,y+d-200,k,200,dk,'rx="50"');
    }
    case 'nightstand': return rc(x,y,w,d,c,'rx="30"') + `<circle r="${m*.24}" fill="#fff6dd" ${ST}/>` + `<circle r="${m*.08}" fill="${shade(c,.8)}" ${ST}/>`;
    case 'wardrobe': {
      let s = rc(x,y,w,d,c) + ln(x+50,0,x+w-50,0);
      for (let hx = x+160; hx < x+w-100; hx += 180) s += ln(hx-45,-d*.28,hx+45,d*.28,'opacity=".6"');
      return s;
    }
    case 'cabinet': case 'shoecab': return rc(x,y,w,d,c) + ln(x,y+d,x+w,y);
    case 'dresser': return rc(x,y,w,d,c,'rx="20"') + rc(x+w*.2,y,w*.6,55,'#dfe9ee') + ec(0,d/2+180,160,140,shade(c,.9));
    case 'desk': return rc(x,y,w,d,c,'rx="20"') + rc(-w*.18,y+50,w*.36,45,'#555') + rc(-w*.14,y+d*.45,w*.28,d*.28,'#f4f4f4','rx="10"');
    case 'chair': return rc(x+25,y+d*.16,w-50,d*.84-10,c,'rx="60"') + rc(x,y,w,d*.2,shade(c,.78),'rx="40"');
    case 'bookshelf': { let s = rc(x,y,w,d,c); for (let bx = x+400; bx < x+w-50; bx += 400) s += ln(bx,y,bx,y+d); return s; }
    case 'baycushion': return rc(x,y,w,d,c,'rx="60"') + rc(x+60,y+80,w-120,Math.min(300,d*.2),'#fff','rx="60"') + rc(x+60,y+d-80-Math.min(300,d*.2),w-120,Math.min(300,d*.2),'#fff','rx="60"');
    case 'coffeetable': return rc(x,y,w,d,c,'rx="80"') + rc(x+60,y+60,w-120,d-120,shade(c,1.06),'rx="50"');
    case 'tvstand': return rc(x,y,w,d,c) + rc(x+w*.15,y+30,w*.7,55,'#3a3a3a');
    case 'rug': return rc(x,y,w,d,c,'rx="40" fill-opacity=".6"') + rc(x+90,y+90,w-180,d-180,'none','rx="30" stroke-dasharray="3 3" opacity=".6"');
    case 'plant': {
      let s = `<circle r="${m/2}" fill="${c}" fill-opacity=".85" ${ST}/>`;
      for (let k=0;k<8;k++) s += `<ellipse cx="0" cy="${-m*.27}" rx="${m*.1}" ry="${m*.21}" transform="rotate(${k*45})" fill="${shade(c,.8)}" ${ST}/>`;
      return s + `<circle r="${m*.1}" fill="#8a6a4a" ${ST}/>`;
    }
    case 'table': return rc(x,y,w,d,c,'rx="30"') + rc(x+50,y+50,w-100,d-100,'none','rx="20" opacity=".4"');
    case 'roundtable': return ec(0,0,w/2,d/2,c) + ec(0,0,w/2-50,d/2-50,'none','opacity=".4"');
    case 'counter': return rc(x,y,w,d,c) + ln(x,y+d-40,x+w,y+d-40,DASH);
    case 'stove': {
      let s = rc(x,y,w,d,'#2f2f2f','rx="20"'); const r = m*.26;
      const pts = w/d > 1.4 ? [[-w/4,0],[w/4,0]] : [[-w/4,-d/4],[w/4,-d/4],[-w/4,d/4],[w/4,d/4]];
      pts.forEach(([px,py]) => s += `<circle cx="${px}" cy="${py}" r="${r}" fill="none" stroke="#bbb" stroke-width="1" vector-effect="non-scaling-stroke"/><circle cx="${px}" cy="${py}" r="${r*.45}" fill="#666"/>`);
      return s;
    }
    case 'ksink': return rc(x,y,w,d,c,'rx="20"') + rc(x+w*.06,y+d*.18,w*.42,d*.66,'#fff','rx="50"') + rc(x+w*.52,y+d*.18,w*.42,d*.66,'#fff','rx="50"') + `<circle cx="0" cy="${y+d*.09}" r="22" fill="#999"/>`;
    case 'fridge': return rc(x,y,w,d,c,'rx="30"') + ln(x,y+d*.14,x+w,y+d*.14) + ln(0,y+d*.14,0,y+d) + rc(-70,y+d*.5,40,d*.25,'#aab') + rc(30,y+d*.5,40,d*.25,'#aab');
    case 'toilet': return rc(x+w*.04,y,w*.92,d*.27,c,'rx="30"') + ec(0,y+d*.27+d*.36,w*.47,d*.36,c) + ec(0,y+d*.27+d*.4,w*.3,d*.24,'#eef4f7');
    case 'vanity': return rc(x,y,w,d,c,'rx="20"') + ec(0,y+d*.57,Math.min(w*.32,260),d*.28,'#fff') + `<circle cx="0" cy="${y+d*.17}" r="26" fill="#999"/>`;
    case 'shower': return rc(x,y,w,d,c) + ln(x,y,x+w,y+d,DASH) + ln(x+w,y,x,y+d,DASH) + `<circle r="45" fill="#fff" ${ST}/>`;
    case 'bathtub': return rc(x,y,w,d,c,'rx="40"') + rc(x+80,y+80,w-160,d-160,'#fff',`rx="${m*.33}"`) + `<circle cx="${x+w-260}" cy="0" r="35" fill="#ccc" ${ST}/>`;
    case 'washer': case 'dryer': return rc(x,y,w,d,c,'rx="30"') + rc(x,y,w,d*.14,shade(c,.9)) + `<circle cy="${d*.06}" r="${m*.34}" fill="#fff" ${ST}/><circle cy="${d*.06}" r="${m*.24}" fill="${t==='dryer'?'#e9dccb':'#cfdde4'}" ${ST}/>`;
    case 'crib': {
      let s = rc(x,y,w,d,c,'rx="20"') + rc(x+45,y+45,w-90,d-90,'#fff','rx="20"');
      for (let sx = x+90; sx < x+w-60; sx += 90) s += ln(sx,y,sx,y+45,'opacity=".5"') + ln(sx,y+d-45,sx,y+d,'opacity=".5"');
      return s;
    }
    case 'beanbag': return ec(0,0,w/2,d/2,c) + ec(-w*.04,-d*.06,w*.3,d*.28,shade(c,1.12),'opacity=".9"');
    case 'sidetable': return ec(0,0,w/2,d/2,c) + ec(0,0,w*.12,d*.12,'none','opacity=".5"');
    case 'floorlamp': return `<circle r="${m*.5}" fill="#fff6dd" fill-opacity=".85" ${ST}/>` + `<circle r="${m*.32}" fill="none" ${ST} ${DASH}/>` + `<circle r="${m*.07}" fill="${c}" ${ST}/>`;
    case 'island': return rc(x,y,w,d,c) + ln(x,y+d-250,x+w,y+d-250,DASH);
    case 'barstool': return `<circle r="${m/2}" fill="${c}" ${ST}/><circle r="${m*.3}" fill="${shade(c,1.15)}" ${ST}/>`;
    case 'waterheater': return rc(x,y,w,d,c,`rx="${d/2}" ${DASH}`) + ln(x+w*.2,0,x+w*.8,0,DASH);
    case 'tv': return rc(x,y,w,d,c,'rx="10"') + rc(x+w*.3,y+d,w*.4,Math.min(40,d),'#666');
    case 'aircon': return rc(x,y,w,d,c,'rx="30"') + ln(x+40,y+d*.72,x+w-40,y+d*.72) + ln(x+40,y+d*.86,x+w-40,y+d*.86);
    case 'acwall': {
      let s = rc(x,y,w,d,c,`rx="30" ${DASH}`);
      [.25,.5,.75].forEach(k => s += ln(x+w*k,y+d,x+w*k,y+d+200,`${DASH} opacity=".6"`));
      return s;
    }
    case 'dishwasher': return rc(x,y,w,d,c,'rx="15"') + ln(x,y+d-70,x+w,y+d-70) + rc(x+w*.3,y+d-45,w*.4,25,'#888');
    case 'ovencol': return rc(x,y,w,d,c) + ln(x,y,x+w,y+d) + ln(x+w,y,x,y+d);
    case 'purifier': return rc(x,y,w,d,c,'rx="60"') + rc(x+45,y+45,w-90,d-90,'none',`rx="40" ${DASH}`);
    case 'officechair': {
      let s = '';
      for (let k = 0; k < 5; k++) s += `<line x1="0" y1="0" x2="0" y2="${m*.48}" transform="rotate(${k*72+36})" stroke="#555" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      return s + rc(x+w*.12,y+d*.22,w*.76,d*.66,c,'rx="80"') + rc(x+w*.15,y+d*.04,w*.7,d*.16,shade(c,.78),'rx="40"')
        + rc(x+w*.02,y+d*.3,w*.1,d*.45,shade(c,.7),'rx="30"') + rc(x+w*.88,y+d*.3,w*.1,d*.45,shade(c,.7),'rx="30"');
    }
    case 'piano': {
      let s = rc(x,y,w,d*.55,c,'rx="10"') + rc(x+40,y+d*.55,w-80,d*.4,shade(c,1.4),'rx="10"');
      const kx = x+90, kw = w-180, kd = d*.2;
      s += rc(kx,y+d*.55,kw,kd,'#faf8f3');
      for (let i = 1; i < 26; i++) s += ln(kx+kw*i/26,y+d*.55,kx+kw*i/26,y+d*.55+kd,'opacity=".5"');
      return s;
    }
    case 'treadmill': return rc(x,y,w,d,c,'rx="50"') + rc(x+90,y+320,w-180,d-400,'#1c1c1e','rx="25"') + rc(x,y,w,230,shade(c,1.4),'rx="40"');
    default: return rc(x,y,w,d,c);
  }
}

/* HTML 输出安全转义 */
export const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
