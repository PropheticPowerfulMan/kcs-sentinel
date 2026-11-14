import {createHash} from 'node:crypto'
export const identifierHash=(value:unknown)=>createHash('sha256').update(String(value??'').normalize('NFKC').trim().toLowerCase()).digest('hex')
export function createAccessVerifier(config:{url:string;key:string;organization:string;app:string},request:typeof fetch=fetch,now=Date.now){
 let snapshot=new Set<string>(),expires=0,pending:Promise<void>|null=null
 return async(identifiers:unknown[])=>{
  if(!config.url&&!config.key&&!config.organization)return
  if(!config.url||!config.key||!config.organization)throw Object.assign(new Error('Institutional access verification is not configured'),{status:503})
  if(now()>=expires){if(!pending)pending=(async()=>{try{const url=new URL('/api/integration/read/account-access/snapshot',config.url);url.searchParams.set('organizationId',config.organization);const r=await request(url,{headers:{'x-api-key':config.key,'x-app-slug':config.app},signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('Access registry unavailable');const data=await r.json() as {blockedHashes?:string[]};if(!Array.isArray(data.blockedHashes)||data.blockedHashes.some(h=>!/^([a-f0-9]{64})$/.test(h)))throw Error('Invalid access registry response');snapshot=new Set(data.blockedHashes);expires=now()+5000}finally{pending=null}})();try{await pending}catch{throw Object.assign(new Error('Institutional account verification is temporarily unavailable. Your data has not been changed.'),{status:503})}}
  if(identifiers.filter(Boolean).some(value=>snapshot.has(identifierHash(value))))throw Object.assign(new Error('This institutional account has been blocked by Super Administration. Contact KCS. / Ce compte a été bloqué par la Superadministration. Contactez KCS.'),{status:403})
 }
}
