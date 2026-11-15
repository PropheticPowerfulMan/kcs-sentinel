export type AcademicCalendar={name:string;startDate:string;endDate:string;status?:string;isCurrent?:boolean;periods?:Array<{type:string;startDate:string;endDate:string}>;nonSchoolRanges?:Array<{startDate:string;endDate:string;label:string}>;publicHolidays?:string[]};
export type CalendarSnapshot={calendars:AcademicCalendar[];source:'ORBIT'|'STALE_ORBIT'|'LOCAL_FALLBACK';fetchedAt:number|null};
export function createAcademicCalendarReader(config:{url:string;key:string;organization:string;schoolUrl?:string},request:typeof fetch=fetch,now=Date.now){
 let cached:CalendarSnapshot={calendars:[],source:'LOCAL_FALLBACK',fetchedAt:null},expires=0,pending:Promise<CalendarSnapshot>|null=null;
 const valid=(rows:AcademicCalendar[])=>Array.isArray(rows)&&rows.length>0&&rows.every(c=>/^\d{4}-\d{4}$/.test(c.name)&&Number.isFinite(Date.parse(c.startDate))&&Number.isFinite(Date.parse(c.endDate))&&c.startDate<=c.endDate);
 return async():Promise<CalendarSnapshot>=>{
  if(now()<expires)return cached;if(pending)return pending;
  pending=(async()=>{try{
   const url=new URL('/api/integration/read/academic-calendar',config.url);url.searchParams.set('organizationId',config.organization);
   const get=async(url:URL|string,headers?:Record<string,string>)=>{const r=await request(url,{headers,signal:AbortSignal.timeout(4000)});if(!r.ok)throw Error('Published calendar unavailable');return r.json()};
   const [orbit,school]=await Promise.allSettled([get(url,{'x-api-key':config.key,'x-app-slug':'KCS_SENTINEL'}),config.schoolUrl?get(config.schoolUrl):Promise.resolve(null)]);
   const published=school.status==='fulfilled'?school.value:null;
   const rows=orbit.status==='fulfilled'?orbit.value.calendars:published?.calendars;
   if(!valid(rows))throw Error('Invalid published calendar');
   const calendars=rows.map((c:AcademicCalendar)=>{
    const prior=cached.calendars.find(p=>p.name===c.name),rules=published?.closures?.find((p:{academicYear:string})=>p.academicYear===c.name);
    const ranges=Array.isArray(rules?.ranges)&&rules.ranges.every((p:{startDate:string;endDate:string})=>/^\d{4}-\d{2}-\d{2}$/.test(p.startDate)&&/^\d{4}-\d{2}-\d{2}$/.test(p.endDate)&&p.startDate<=p.endDate)?rules.ranges:prior?.nonSchoolRanges;
    return {...c,...(ranges?{nonSchoolRanges:ranges,publicHolidays:published?.publicHolidays||prior?.publicHolidays||[]}: {})};
   });cached={calendars,source:'ORBIT',fetchedAt:now()};expires=now()+30000;
  }catch{cached={...cached,source:cached.calendars.length?'STALE_ORBIT':'LOCAL_FALLBACK'};expires=now()+15000}finally{pending=null}return cached})();return pending;
 };
}
export function isOfficialSchoolDay(day:string,calendars:AcademicCalendar[],overrides:Map<string,boolean>){
 const date=new Date(day+'T12:00:00Z');if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==day||[0,6].includes(date.getUTCDay()))return false;
 const calendar=calendars.find(c=>c.status!=='PLANNED'&&day>=c.startDate.slice(0,10)&&day<=c.endDate.slice(0,10));if(calendars.length&&!calendar)return false;
 if(calendar?.publicHolidays?.includes(day.slice(5))||calendar?.nonSchoolRanges?.some(r=>day>=r.startDate&&day<=r.endDate))return false;
 const quarters=calendar?.periods?.filter(p=>['QUARTER','TRIMESTER'].includes(p.type))||[];
 if(quarters.length&&!quarters.some(p=>day>=p.startDate.slice(0,10)&&day<=p.endDate.slice(0,10)))return false;
 return overrides.get(day)??true;
}
export function countOfficialSchoolDays(from:string,to:string,calendars:AcademicCalendar[],overrides:Map<string,boolean>){
 let total=0;const cursor=new Date(from+'T12:00:00Z'),end=new Date(to+'T12:00:00Z');for(;cursor<=end;cursor.setUTCDate(cursor.getUTCDate()+1))if(isOfficialSchoolDay(cursor.toISOString().slice(0,10),calendars,overrides))total++;return total;
}

export function mergePublishedSchoolDays(rows:Array<{date:string;label:string;isSchoolDay:boolean}>,calendars:AcademicCalendar[],seeded:Array<[string,string]>,from='0000-01-01',to='9999-12-31'){
 const verified=calendars.filter(c=>c.nonSchoolRanges!==undefined),inside=(day:string)=>day>=from&&day<=to;
 const days=new Map(rows.filter(row=>!(verified.some(c=>row.date>=c.startDate.slice(0,10)&&row.date<=c.endDate.slice(0,10))&&!row.isSchoolDay&&seeded.some(([d,label])=>d===row.date&&label===row.label))).map(row=>[row.date,{...row}]));
 for(const calendar of verified){
  const start=[calendar.startDate.slice(0,10),from].sort().at(-1)!,end=[calendar.endDate.slice(0,10),to].sort()[0];
  for(const range of calendar.nonSchoolRanges||[]){
   const first=[start,range.startDate].sort().at(-1)!,last=[end,range.endDate].sort()[0];if(first>last)continue;
   for(const date=new Date(first+'T12:00:00Z');date.toISOString().slice(0,10)<=last;date.setUTCDate(date.getUTCDate()+1)){const day=date.toISOString().slice(0,10);days.set(day,{date:day,label:range.label,isSchoolDay:false})}
  }
  for(let year=Number(start.slice(0,4));year<=Number(end.slice(0,4));year++)for(const md of calendar.publicHolidays||[]){const day=year+'-'+md;if(day>=start&&day<=end&&inside(day))days.set(day,{date:day,label:days.get(day)?.label||'Jour férié RDC · DRC public holiday',isSchoolDay:false})}
 }
 return [...days.values()].filter(row=>inside(row.date)).sort((a,b)=>a.date.localeCompare(b.date));
}
