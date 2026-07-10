import {openDB} from 'idb'; import {FamilyData} from './domain'; import {createSeed} from './seed';
const dbp=openDB('casa-em-ordem',1,{upgrade(db){db.createObjectStore('data');}});
export async function loadLocal(){return (await (await dbp).get('data','family') as FamilyData|undefined)??createSeed();}
export async function saveLocal(data:FamilyData){data.lastSavedAt=new Date().toISOString();await (await dbp).put('data',structuredClone(data),'family');}
export function download(name:string,content:string,type='application/json'){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type}));a.download=name;a.click();URL.revokeObjectURL(a.href);}
export function exportJson(data:FamilyData){download(`casa-em-ordem-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(data,null,2));}
export async function restoreJson(file:File){const parsed=JSON.parse(await file.text());if(parsed.schemaVersion!==1||!Array.isArray(parsed.transactions))throw new Error('Backup incompatível.');return parsed as FamilyData;}
