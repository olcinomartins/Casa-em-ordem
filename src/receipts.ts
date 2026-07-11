import { getMicrosoftAccessToken } from "./onedrive";
const endpoint="https://casa-em-ordem-gemini.olcinofilho.workers.dev";
const toBase64=(file:File)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error("Não foi possível ler a imagem."));reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.readAsDataURL(file)});
export interface ReadReceipt { estabelecimento?:string; data?:string; total?:number; confianca?:number; observacoes?:string[]; itens?:Array<{descricao?:string;quantidade?:number;unidade?:string;valorUnitario?:number;valorTotal?:number;categoriaMacro?:string}>; }
export async function readReceipt(file:File):Promise<ReadReceipt>{
  if(!file.type.startsWith("image/"))throw new Error("Escolha uma fotografia da nota.");
  if(file.size>12_000_000)throw new Error("A fotografia deve ter no máximo 12 MB.");
  const image=await toBase64(file);const accessToken=await getMicrosoftAccessToken();let lastError="";
  for(let attempt=0;attempt<2;attempt++){
    const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${accessToken}`},body:JSON.stringify({mimeType:file.type,image})});
    const result=await response.json().catch(()=>({}));
    if(response.ok&&result.receipt)return result.receipt;
    lastError=[result.error,result.detail].filter(Boolean).join(" — ")||`Falha na leitura (${response.status}).`;
    if(response.status<429&&response.status!==502)break;
    await new Promise(resolve=>setTimeout(resolve,1500));
  }
  throw new Error(lastError);
}
