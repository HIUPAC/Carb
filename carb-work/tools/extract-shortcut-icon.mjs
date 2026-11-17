import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const exe = process.argv[2] ?? 'D:/Test/Test.exe';
const out = process.argv[3] ?? 'D:/TasteCode/carb-work/branding/source-shortcut.ico';
const modules = 'D:/UIAgent/artifacts/build-tools/branding/node_modules';
const { NtExecutable, NtExecutableResource } = await import(pathToFileURL(path.join(modules, 'pe-library/dist/index.js')).href);
const entries = NtExecutableResource.from(NtExecutable.from(await readFile(exe))).entries;
const group = entries.find(e => e.type===14);
if (!group) throw new Error('No RT_GROUP_ICON');
const d=Buffer.from(group.bin); const count=d.readUInt16LE(4); const idx=Buffer.alloc(6+count*16); d.copy(idx,0,0,6); let off=idx.length; const imgs=[];
for(let i=0;i<count;i++){const a=6+i*14,b=6+i*16,id=d.readUInt16LE(a+12);const e=entries.find(x=>x.type===3&&x.id===id&&x.lang===group.lang);if(!e)throw new Error('missing '+id);const img=Buffer.from(e.bin);if(img.length!==d.readUInt32LE(a+8))throw new Error('size');d.copy(idx,b,a,a+12);idx.writeUInt32LE(off,b+12);imgs.push(img);off+=img.length;}
await mkdir(path.dirname(out),{recursive:true}); await writeFile(out,Buffer.concat([idx,...imgs]));
console.log(JSON.stringify({exe,out,count,bytes:Buffer.concat([idx,...imgs]).length,images:imgs.map((x,i)=>({i,bytes:x.length,signature:x.subarray(0,8).toString('hex')}))},null,2));
