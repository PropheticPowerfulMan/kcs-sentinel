export type AcademicCalendar = {name:string;startDate:string;endDate:string;status?:string;isCurrent?:boolean};
export type CalendarSnapshot = {calendars:AcademicCalendar[];source:'ORBIT'|'STALE_ORBIT'|'LOCAL_FALLBACK';fetchedAt:number|null};
export function createAcademicCalendarReader(config:{url:string;key:string;organization:string},request:typeof fetch=fetch,now=Date.now){
 let cached:CalendarSnapshot={calendars:[],source:'LOCAL_FALLBACK',fetchedAt:null},expires=0,pending:Promise<CalendarSnapshot>|null=null;
 return async():Promise<CalendarSnapshot>=>{
  if(now()<expires)return cached;
  if(pending)return pending;
  pending=(async()=>{try{
   const url=new URL('/api/integration/read/academic-calendar',config.url);url.searchParams.set('organizationId',config.organization);
   const response=await request(url,{headers:{'x-api-key':config.key,'x-app-slug':'KCS_SENTINEL'},signal:AbortSignal.timeout(4000)});
   if(!response.ok)throw new Error('Published calendar unavailable');
   const body=await response.json() as {calendars?:AcademicCalendar[]};
   if(!Array.isArray(body.calendars)||!body.calendars.length||body.calendars.some(c=>!/^\d{4}-\d{4}$/.test(c.name)||!Number.isFinite(Date.parse(c.startDate))||!Number.isFinite(Date.parse(c.endDate))||c.startDate>c.endDate))throw new Error('Invalid published calendar');
   cached={calendars:body.calendars,source:'ORBIT',fetchedAt:now()};expires=now()+30000;
  }catch{cached={...cached,source:cached.calendars.length?'STALE_ORBIT':'LOCAL_FALLBACK'};expires=now()+15000}finally{pending=null}return cached})();
  return pending;
 };
}
export function isOfficialSchoolDay(day:string,calendars:AcademicCalendar[],overrides:Map<string,boolean>){
 const date=new Date(day+'T12:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day)return false;
 if(calendars.length&&!calendars.some(c=>c.status!=='PLANNED'&&day>=c.startDate.slice(0,10)&&day<=c.endDate.slice(0,10)))return false;
 return overrides.get(day)??(date.getUTCDay()!==0&&date.getUTCDay()!==6);
}
export function countOfficialSchoolDays(from:string,to:string,calendars:AcademicCalendar[],overrides:Map<string,boolean>){
 let total=0;const cursor=new Date(from+'T12:00:00Z'),end=new Date(to+'T12:00:00Z');for(;cursor<=end;cursor.setUTCDate(cursor.getUTCDate()+1))if(isOfficialSchoolDay(cursor.toISOString().slice(0,10),calendars,overrides))total++;return total;
}
