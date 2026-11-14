import {isOfficialSchoolDay,type AcademicCalendar} from '../calendar/academic-calendar.js';
import {kinshasaClockMinutes} from './attendance-policy.js';
export type Movement={occurred_at:Date|string;direction:string;gate?:string;source?:string};
export type Justification={incident_date:string|Date;incident_type:string;status:string;reason:string};
const schoolDateFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kinshasa',year:'numeric',month:'2-digit',day:'2-digit'});
export const schoolDate=(date:Date)=>schoolDateFormatter.format(date);
export function summarizePresence(input:{from:string;to:string;now:Date;movements:Movement[];justifications:Justification[];calendars:AcademicCalendar[];overrides:Map<string,boolean>;lateAfterMinutes:number|null;arrivalDeadlineMinutes?:number;attendanceObligation?:boolean}){
 const {from,to,now,calendars,overrides}=input,today=schoolDate(now),end=to<today?to:today;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(from)||!/^\d{4}-\d{2}-\d{2}$/.test(to)||from>to)throw Error('Invalid attendance report range');
 const all=input.movements.map(row=>({...row,at:new Date(row.occurred_at)})).filter(row=>Number.isFinite(row.at.getTime())&&schoolDate(row.at)>=from&&schoolDate(row.at)<=end);
 const byDay=new Map<string,typeof all>();for(const row of all){const day=schoolDate(row.at);byDay.set(day,[...(byDay.get(day)||[]),row])}
 const dayDetails=[];
 for(const cursor=new Date(from+'T12:00:00Z');cursor.toISOString().slice(0,10)<=end;cursor.setUTCDate(cursor.getUTCDate()+1)){
  const date=cursor.toISOString().slice(0,10);if(input.attendanceObligation!==false&&!isOfficialSchoolDay(date,calendars,overrides))continue;if(input.attendanceObligation===false&&!byDay.has(date))continue;
  const events=byDay.get(date)||[],entries=events.filter(e=>e.direction==='ENTRY').sort((a,b)=>+a.at-+b.at),exits=events.filter(e=>e.direction==='EXIT').sort((a,b)=>+a.at-+b.at),first=entries[0]?.at??null,last=exits.at(-1)?.at??null;
  const justifications=input.justifications.filter(j=>String(j.incident_date instanceof Date?j.incident_date.toISOString().slice(0,10):j.incident_date).slice(0,10)===date&&j.incident_type==='ABSENCE'&&j.status!=='REJECTED');
  const justification=justifications.find(j=>j.status==='APPROVED')||justifications[0];
  const due=date<today||kinshasaClockMinutes(now)>=(input.arrivalDeadlineMinutes??input.lateAfterMinutes??480);
  const late=Boolean(first&&input.lateAfterMinutes!==null&&kinshasaClockMinutes(first)>input.lateAfterMinutes);
  dayDetails.push({date,firstEntry:first?.toISOString()??null,lastExit:last?.toISOString()??null,durationMinutes:first&&last&&last>first?Math.round((+last-+first)/60000):null,late,status:first?(late?'LATE':'PRESENT'):input.attendanceObligation===false?'UNCONFIRMED':due?'ABSENT':'NOT_DUE',excused:!first&&due&&justification?.status==='APPROVED',justificationStatus:justification?.status??null,justificationReason:justification?.reason??null,missingEntry:!first&&Boolean(last),gate:events[0]?.gate??null,source:events[0]?.source??null});
 }
 const present=dayDetails.filter(d=>d.firstEntry),absent=dayDetails.filter(d=>d.status==='ABSENT'),expected=input.attendanceObligation===false?0:present.length+absent.length;
 const average=(values:number[])=>values.length?Math.round(values.reduce((a,b)=>a+b,0)/values.length):null,clock=(minutes:number|null)=>minutes===null?null:`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
 const durations=present.map(d=>d.durationMinutes).filter((v):v is number=>v!==null),lateDays=present.filter(d=>d.late).length;
 return {hasAttendanceObligation:input.attendanceObligation!==false,expectedSchoolDays:expected,scheduledSchoolDays:dayDetails.length,notYetDueDays:dayDetails.filter(d=>d.status==='NOT_DUE').length,attendanceDays:present.length,absentDays:absent.length,excusedAbsentDays:absent.filter(d=>d.excused).length,pendingJustificationDays:absent.filter(d=>d.justificationStatus==='PENDING').length,unjustifiedAbsentDays:absent.filter(d=>!d.excused).length,lateDays,completeDays:present.filter(d=>d.lastExit).length,entries:all.filter(r=>r.direction==='ENTRY').length,exits:all.filter(r=>r.direction==='EXIT').length,punctualityRate:present.length?Number(((present.length-lateDays)/present.length*100).toFixed(1)):0,presenceRate:expected?Number((present.length/expected*100).toFixed(1)):0,averageArrival:clock(average(present.map(d=>kinshasaClockMinutes(new Date(d.firstEntry!))))),averageDeparture:clock(average(present.filter(d=>d.lastExit).map(d=>kinshasaClockMinutes(new Date(d.lastExit!))))),totalPresenceMinutes:durations.reduce((a,b)=>a+b,0),averagePresenceMinutes:average(durations)??0,dayDetails:dayDetails.reverse(),movements:all.map(({at,...row})=>({...row,occurred_at:at.toISOString()}))};
}
