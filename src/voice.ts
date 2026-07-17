import { getMicrosoftAccessToken } from "./onedrive";
const endpoint="https://casa-em-ordem-gemini.olcinofilho.workers.dev";
const toBase64=(blob:Blob)=>new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error("Não foi possível ler o áudio."));reader.onload=()=>resolve(String(reader.result).split(",")[1]);reader.readAsDataURL(blob)});
export interface VoiceTransaction {transcricao?:string;tipo?:"despesa"|"receita"|"transferência"|"aporte";descricao?:string;valor?:number;data?:string;categoriaSugerida?:string;subcategoriaSugerida?:string;contaOuCartaoSugerido?:string;responsavelSugerido?:string;escopoSugerido?:string;parcelas?:number;observacoes?:string;confianca?:number;}
export async function readVoiceExpense(blob:Blob,context:{categories:Array<{name:string;subcategories:string[]}>;accounts:Array<{name:string;institution:string;holder?:string;operator:string}>}):Promise<VoiceTransaction>{
  if(blob.size>18_000_000)throw new Error("O áudio deve ter menos de 18 MB.");
  const response=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${await getMicrosoftAccessToken()}`},body:JSON.stringify({audio:await toBase64(blob),mimeType:blob.type||"audio/mp4",context})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error([result.error,result.detail].filter(Boolean).join(" — ")||`Falha no áudio (${response.status}).`);
  return result.transaction;
}
