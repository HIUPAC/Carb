import{t as __testT,languageControl as __testLanguageControl,getLanguage as __testLocale}from"./test-i18n.js";
import{Dn as e,va as t,xa as n}from"./index-dY3kjCLH.js";var r=[`image/png`,`image/jpeg`,`image/webp`,`image/avif`,`image/gif`,`image/bmp`],i=2560,a=1600;function o(e){return`blur${e}@${a}`}o(14);var s=`image/webp`,c=.9,l=class extends Error{};function u(e){if(!r.includes(e.type))return(__testT("Choose a PNG, JPEG, WebP, AVIF, GIF or BMP image."));if(e.size>41943040)return(__testT("Choose an image under 40 MB."));if(e.size===0)return(__testT("That file is empty."))}function d(e,t,n){let r=Math.min(1,n/Math.max(e,t,1));return{width:Math.max(1,Math.round(e*r)),height:Math.max(1,Math.round(t*r))}}function f(e,t){if(typeof OffscreenCanvas<`u`){let n=new OffscreenCanvas(e,t),r=n.getContext(`2d`);if(!r)throw new l(`This window cannot draw images.`);return{context:r,toBlob:()=>n.convertToBlob({type:s,quality:c})}}let n=document.createElement(`canvas`);n.width=e,n.height=t;let r=n.getContext(`2d`);if(!r)throw new l(`This window cannot draw images.`);return{context:r,toBlob:()=>new Promise((e,t)=>n.toBlob(n=>n?e(n):t(new l(`The image could not be saved.`)),s,c))}}async function p(e,t,n){let r=d(e.width,e.height,t),{context:i,toBlob:a}=f(r.width,r.height);if(n>0){let t=n*2;i.filter=`blur(${n}px)`,i.drawImage(e,-t,-t,r.width+t*2,r.height+t*2)}else i.drawImage(e,0,0,r.width,r.height);return a()}async function m(e){try{return await createImageBitmap(e)}catch{throw new l(`That image could not be opened.`)}}async function h(e,t=14){let n=u(e);if(n)throw new l(n);let r=await m(e);try{return{id:`${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`,original:await p(r,i,0),display:await p(r,a,t),displayVersion:o(t)}}finally{r.close()}}async function g(e,t,n=14){let r=o(n);if(e.displayVersion===r)return e.display;let i=await m(e.original);try{let o=await p(i,a,n);return await t.saveDisplay({...e,display:o,displayVersion:r}).catch(()=>{}),o}finally{i.close()}}var ee=`carb-app-background`,_=`images`,v=`current`;function te(){return new Promise((e,t)=>{if(typeof indexedDB>`u`){t(new l(`This window cannot store images.`));return}let n=indexedDB.open(ee,1);n.onupgradeneeded=()=>n.result.createObjectStore(_),n.onsuccess=()=>e(n.result),n.onerror=()=>t(new l(`This window cannot store images.`))})}async function y(e,t){let n=await te();try{return await new Promise((r,i)=>{let a=n.transaction(_,e),o=t(a.objectStore(_));a.oncomplete=()=>r(o.result),a.onerror=()=>i(new l(`The image could not be stored.`)),a.onabort=()=>i(new l(`The image could not be stored.`))})}finally{n.close()}}function b(e){if(typeof e!=`object`||!e)return!1;let t=e;return t.original instanceof Blob&&t.display instanceof Blob&&typeof t.displayVersion==`string`&&(t.id===void 0||typeof t.id==`string`)}var ne={load:async()=>{let e=await y(`readonly`,e=>e.get(v));return b(e)?e:void 0},save:async e=>{await y(`readwrite`,t=>t.put(e,v))},saveDisplay:async e=>{let t=!1;return await y(`readwrite`,n=>{let r=n.get(v);return r.onsuccess=()=>{let i=r.result;b(i)&&i.id===e.id&&(n.put(e,v),t=!0)},r}),t},clear:async()=>{await y(`readwrite`,e=>e.delete(v))}},x=n(t(),1),S=8,C=.6,w=56,T=3.4;function re(){let e=[[0]];for(;e.length<8;){let t=e,n=e=>t.map(t=>t.map(t=>4*t+e)),[r,i,a,o]=[n(0),n(2),n(3),n(1)];e=[...r.map((e,t)=>[...e,...i[t]??[]]),...a.map((e,t)=>[...e,...o[t]??[]])]}return e}function E(e,t,n){return t*Math.max(0,1-e)**+n}function D(){let e=re();return Array.from({length:224},(t,n)=>{let r=E(n/224,C,2);return Array.from({length:S},(t,i)=>r>((e[n%8]?.[i]??0)+.5)/64)})}function O(e,t,n,r){let i=`<svg xmlns="http://www.w3.org/2000/svg" width="${e}" height="${t}" viewBox="0 0 ${e} ${t}" shape-rendering="${n}">${r}</svg>`;return`url("data:image/svg+xml,${encodeURIComponent(i)}")`}function ie(){let e=``;D().forEach((t,n)=>{let r=0;for(;r<t.length;){if(!t[r]){r++;continue}let i=r;for(;i<t.length&&t[i];)i++;e+=`M${r} ${n}h${i-r}v1h${r-i}z`,r=i}});let t=S*2;return{image:O(S,224,`crispEdges`,`<path d="${e}"/>`),size:`${t}px 448px`,width:t,height:448}}function ae(e){return Math.round(e*100)/100}function oe(){let e=8*w,t=``;for(let n=0;n<w;n++)for(let[r,i]of[[8/2,n*8+8/2],[8*1.5,(n+1)*8]]){let n=T*E(i/e,1,1.5);n<.3||(t+=`<circle cx="${r}" cy="${i}" r="${ae(n)}"/>`)}return{image:O(16,e,`geometricPrecision`,t),size:`16px ${e}px`,width:16,height:e}}var k=new Map;function A(e){let t=k.get(e);return t||(t=e===`dither`?ie():oe(),k.set(e,t)),t}function se(e){let t=A(e);return{"--app-bg-pattern":t.image,"--app-bg-pattern-size":t.size}}var j=1e3/30,M=100,N=2,ce=`(prefers-reduced-motion: reduce)`,le=[.5,.5,.5],P=new Set,F=0,I,L,R,z=!0,B,V=!1;function H(){return F}function U(){return typeof document.hasFocus!=`function`||document.hasFocus()}function W(){return P.size>0&&z&&document.visibilityState!==`hidden`&&!(B?.matches??!1)}function G(){L!==void 0&&clearInterval(L),L=void 0,I=void 0}function ue(e){e.draw(F)}function de(){if(!W()){G();return}let e=performance.now();I!==void 0&&(F+=Math.min(Math.max(0,e-I),M)/1e3),I=e,P.forEach(ue)}function K(){W()?L===void 0&&(L=setInterval(de,j)):G()}function q(){z=!0,K()}function J(){R!==void 0&&clearTimeout(R),R=setTimeout(()=>{R=void 0,z=U(),K()},0)}function fe(){V||(V=!0,B=typeof matchMedia==`function`?matchMedia(ce):void 0,B?.addEventListener(`change`,K),document.addEventListener(`visibilitychange`,K),window.addEventListener(`focus`,q),window.addEventListener(`blur`,J),z=U())}function pe(){V&&(V=!1,B?.removeEventListener(`change`,K),B=void 0,document.removeEventListener(`visibilitychange`,K),window.removeEventListener(`focus`,q),window.removeEventListener(`blur`,J),R!==void 0&&clearTimeout(R),R=void 0)}function me(e){return P.add(e),fe(),e.draw(F),K(),()=>{P.delete(e)&&(P.size>0||(G(),pe()))}}function Y(e,t,n,r){if(e===`dither`){let e=2*n,r=Math.max(1,Math.ceil(t/e));return{width:r,height:224,cssWidth:r*e,cssHeight:224*e,unit:1/2}}let i=Math.min(N,Math.max(1,r)),a=Math.max(1,Math.ceil(t*i)),o=Math.max(1,Math.ceil(448*n*i));return{width:a,height:o,cssWidth:a/i,cssHeight:o/i,unit:n*i}}function X(e){return Number.isInteger(e)?`${e}.0`:String(e)}var he=`
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`,Z=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform vec2 u_size;
uniform float u_unit;
uniform float u_time;
uniform vec3 u_color;

// A soft band of light, 0 to 1, that drifts sideways at about 25 CSS pixels a
// second and sways slowly; p is a point of the window in CSS pixels.
float light(vec2 p) {
  float sway = 1.7 * sin(p.x * 0.0021 - u_time * 0.07);
  return 0.5 + 0.5 * sin(p.x * 0.0047 + p.y * 0.004 - u_time * 0.12 + sway);
}
`,ge={dither:`${Z}
float bayer2(vec2 a) {
  a = floor(a);
  return fract(a.x * 0.5 + a.y * a.y * 0.75);
}

// The 8x8 Bayer threshold, 0 to 63/64, built from three 2x2 steps.
float bayer8(vec2 a) {
  return bayer2(a) + 0.25 * bayer2(a * 0.5) + 0.0625 * bayer2(a * 0.25);
}

void main() {
  vec2 cell = floor(vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y));
  float fade = pow(max(0.0, 1.0 - cell.y / ${X(224)}), 2.0);
  float level = ${X(C)} * fade * (0.7 + 0.6 * light((cell + 0.5) * ${X(2)}));
  float lit = step(bayer8(mod(cell, 8.0)) + 0.5 / 64.0, level);
  gl_FragColor = vec4(u_color, 1.0) * lit;
}
`,halftone:`${Z}
float disc(vec2 p, vec2 centre) {
  float fade = pow(max(0.0, 1.0 - centre.y / ${X(448)}), 1.5);
  float radius = ${X(T)} * fade * (0.75 + 0.45 * light(centre));
  radius = min(radius, ${X(8/2-.1)});
  if (radius < 0.3) return 0.0;
  return clamp((radius - distance(p, centre)) * u_unit + 0.5, 0.0, 1.0);
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y) / u_unit;
  // Two columns every two pitches, the second half a pitch lower.
  vec2 lattice = vec2(${X(16)}, ${X(8)});
  vec2 first = vec2(${X(8/2)}, ${X(8/2)});
  vec2 second = vec2(${X(8*1.5)}, ${X(8)});
  vec2 a = first + lattice * floor((p - first) / lattice + 0.5);
  vec2 b = second + lattice * floor((p - second) / lattice + 0.5);
  gl_FragColor = vec4(u_color, 1.0) * max(disc(p, a), disc(p, b));
}
`},_e={alpha:!0,premultipliedAlpha:!0,antialias:!1,depth:!1,stencil:!1,preserveDrawingBuffer:!1,powerPreference:`low-power`,failIfMajorPerformanceCaveat:!0};function Q(e,t,n){let r=e.createShader(t);if(r){if(e.shaderSource(r,n),e.compileShader(r),e.getShaderParameter(r,e.COMPILE_STATUS))return r;e.deleteShader(r)}}function ve(e){try{let t=e.getContext(`webgl`,_e);return t&&!t.isContextLost()?t:void 0}catch{return}}function ye(e,t){let n=ve(e);if(!n)return;let r=Q(n,n.VERTEX_SHADER,he),i=Q(n,n.FRAGMENT_SHADER,ge[t]),a=r&&i?n.createProgram():null,o=a?n.createBuffer():null,s=()=>{o&&n.deleteBuffer(o),a&&n.deleteProgram(a),r&&n.deleteShader(r),i&&n.deleteShader(i)};if(!r||!i||!a||!o){s();return}if(n.attachShader(a,r),n.attachShader(a,i),n.linkProgram(a),!n.getProgramParameter(a,n.LINK_STATUS)){s();return}n.useProgram(a),n.bindBuffer(n.ARRAY_BUFFER,o),n.bufferData(n.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),n.STATIC_DRAW);let c=n.getAttribLocation(a,`a_position`);n.enableVertexAttribArray(c),n.vertexAttribPointer(c,2,n.FLOAT,!1,0,0);let l=n.getUniformLocation(a,`u_size`),u=n.getUniformLocation(a,`u_unit`),d=n.getUniformLocation(a,`u_time`),f=n.getUniformLocation(a,`u_color`);return n.clearColor(0,0,0,0),{resize(t){e.width=t.width,e.height=t.height,e.style.width=`${t.cssWidth}px`,e.style.height=`${t.cssHeight}px`,n.viewport(0,0,t.width,t.height),n.uniform2f(l,t.width,t.height),n.uniform1f(u,t.unit)},draw(e,t){n.uniform1f(d,e),n.uniform3f(f,t[0],t[1],t[2]),n.clear(n.COLOR_BUFFER_BIT),n.drawArrays(n.TRIANGLES,0,3)},dispose(){s(),setTimeout(()=>{e.isConnected||n.getExtension(`WEBGL_lose_context`)?.loseContext()},0)}}}function be(e){let t=/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(e);if(t)return[Number(t[1])/255,Number(t[2])/255,Number(t[3])/255];let n=/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/i.exec(e);if(n)return[Number(n[1]),Number(n[2]),Number(n[3])]}function xe(e){try{let t=document.createElement(`canvas`);t.width=1,t.height=1;let n=t.getContext(`2d`,{willReadFrequently:!0});if(!n)return;n.fillStyle=e,n.fillRect(0,0,1,1);let[r=0,i=0,a=0]=n.getImageData(0,0,1,1).data;return[r/255,i/255,a/255]}catch{return}}function $(e){let t=getComputedStyle(e).color;return be(t)??xe(t)??le}function Se(e,t){return e[0]===t[0]&&e[1]===t[1]&&e[2]===t[2]}var Ce=[`class`,`style`,`data-theme`,`data-accent`,`data-backdrop`];function we(e,t,n={}){let r=ye(e,t);if(!r)return;let i=r,a=e.parentElement??e,o=$(e),s,c=e=>{s!==void 0&&i.draw(e,o)},l=e=>{if(e===s)return;s=e;let r=n.windowWidth?e/n.windowWidth:1;i.resize(Y(t,e,r,window.devicePixelRatio||1)),c(H())},u=typeof ResizeObserver==`function`?new ResizeObserver(e=>{let t=e.at(-1);t&&l(t.contentRect.width)}):void 0;u?u.observe(a):l(a.clientWidth);let d=new MutationObserver(()=>{let t=$(e);Se(t,o)||(o=t,c(H()))});d.observe(document.documentElement,{attributes:!0,attributeFilter:Ce});let f=me({draw:c}),p=!1;function m(){p||(p=!0,f(),u?.disconnect(),d.disconnect(),e.removeEventListener(`webglcontextlost`,h),i.dispose())}function h(){m(),n.onLost?.()}return e.addEventListener(`webglcontextlost`,h),m}var Te=e(),Ee=(0,x.memo)(function(e){let t=(0,x.useRef)(null),{effect:n,windowWidth:r,onDrawing:i}=e;return(0,x.useEffect)(()=>{let e=t.current;if(!e)return;let a=we(e,n,{windowWidth:r,onLost:()=>i(!1)});return i(a!==void 0),()=>{a?.(),i(!1)}},[n,r,i]),(0,Te.jsx)(`canvas`,{ref:t,className:`app-bg__motion`,"aria-hidden":!0})});export{l as a,ne as c,r as i,h as l,A as n,a as o,se as r,g as s,Ee as t};