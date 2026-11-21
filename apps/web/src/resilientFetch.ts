type Timing={timeoutMs:number;budgetMs:number;baseDelayMs:number}
const transient=new Set([408,425,429,502,503,504])
const abortError=()=>new DOMException('Request cancelled','AbortError')
async function delay(ms:number,signal?:AbortSignal|null){
 await new Promise<void>((resolve,reject)=>{
  const done=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);resolve()}
  const cancel=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);reject(abortError())}
  const timer=setTimeout(done,ms)
  if(signal?.aborted)cancel();else signal?.addEventListener('abort',cancel,{once:true})
 })
}
export async function resilientFetch<T=Response>(input:RequestInfo|URL,options:RequestInit={},consume:(response:Response)=>Promise<T>=async response=>response as T,timing:Partial<Timing>={}):Promise<T>{
 const policy={timeoutMs:30000,budgetMs:65000,baseDelayMs:500,...timing}
 const read=['GET','HEAD','OPTIONS'].includes(String(options.method||(input instanceof Request?input.method:'GET')).toUpperCase()),start=performance.now()
 for(let attempt=0;;attempt++){
  if(options.signal?.aborted)throw abortError()
  const remaining=policy.budgetMs-(performance.now()-start)
  if(remaining<=0)throw new DOMException('Request timed out','TimeoutError')
  const controller=new AbortController(),cancel=()=>controller.abort(),timer=setTimeout(cancel,Math.min(policy.timeoutMs,remaining))
  options.signal?.addEventListener('abort',cancel,{once:true})
  let pause=policy.baseDelayMs*2**attempt
  try{
   const response=await fetch(input,{...options,signal:controller.signal})
   const directive=response.headers.get('Retry-After')
   if(directive){const seconds=Number(directive);pause=Math.max(pause,Number.isFinite(seconds)?seconds*1000:Math.max(0,Date.parse(directive)-Date.now()))}
   if(!read||!transient.has(response.status)||attempt>=2||performance.now()-start+pause>=policy.budgetMs)return await consume(response)
   await response.body?.cancel().catch(()=>undefined)
  }catch(error:any){
   const status=Number(error?.status)||0
   if(options.signal?.aborted)throw abortError()
   if(!read||attempt>=2||status&&!transient.has(status)||performance.now()-start+pause>=policy.budgetMs)throw error
   if(!status&&!(error instanceof TypeError)&&!['AbortError','TimeoutError'].includes(error?.name))throw error
  }finally{clearTimeout(timer);options.signal?.removeEventListener('abort',cancel)}
  await delay(pause,options.signal)
 }
}
