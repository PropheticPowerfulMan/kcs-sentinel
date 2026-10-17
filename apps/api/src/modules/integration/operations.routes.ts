import crypto from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { loadOrbitDirectory, resolveOrbitPersonFromCandidates } from "../integration/directory.js";
import { captureFingerprintTemplate, isLiveBiometricCaptureEnabled } from "../biometrics/biometric.provider.js";

const router = Router();
const safe = (handler: (req: any, res: any, next: any) => unknown) => (req: any, res: any, next: any) => Promise.resolve(handler(req, res, next)).catch(next);
type Session = { sub: string; role: string; personId: string; fullName: string };
const auth = (req: any, res: any, next: any) => { try { const token=String(req.headers.authorization||'').replace(/^Bearer /,''); req.sentinelUser=jwt.verify(token,env.jwtSecret) as Session; next(); } catch { res.status(401).json({message:'Invalid or expired institutional session'}); } };
const manager = (req:any,res:any,next:any) => ['admin','super_admin','school_admin','security_operator'].includes(String(req.sentinelUser?.role).toLowerCase()) ? next() : res.status(403).json({message:'Guard or administrator access required'});
const protectBiometric = (identityId:string,template:string) => 'v1:' + crypto.createHmac('sha256',env.biometricSecret).update(identityId).update('\0').update(template).digest('hex');
const secureEqual = (left:string,right:string) => { const a=Buffer.from(left),b=Buffer.from(right); return a.length===b.length&&crypto.timingSafeEqual(a,b); };
const deviceContextSchema = z.object({
  timezone: z.string().trim().min(1).max(120).default("UTC"),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional()
}).default({ timezone: "UTC" });

router.post('/auth/login', safe(async (req,res) => {
  const payload=z.object({identifier:z.string().trim().min(2),password:z.string().min(1)}).parse(req.body);
  const response=await fetch(new URL('/api/auth/login',env.nexusApiUrl),{method:'POST',headers:{'content-type':'application/json','x-kcs-client':'KCS_SENTINEL'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
  const body=await response.json().catch(()=>null) as any;
  if(!response.ok||!body?.data?.user)return res.status(401).json({message:body?.message||'Institutional authentication failed'});
  const nexus=body.data.user; const person=await resolveOrbitPersonFromCandidates([nexus.orbitUserId,nexus.id,nexus.email,nexus.accessCode,payload.identifier]);
  if(!person && String(nexus.role).toLowerCase()!=='admin')return res.status(403).json({message:'No active Orbit identity is linked to this account'});
  const rawRole=String(nexus.role).toLowerCase(); const role=['admin','superadmin','super_admin'].includes(rawRole)?'super_admin':['administrator','principal','school_admin'].includes(rawRole)?'school_admin':person?.kind==='STAFF'&&/guard|security|gardien/i.test(String(person?.jobTitle||'')+' '+String(person?.department||''))?'security_operator':'entity';
  const session:Session={sub:String(nexus.id),role,personId:person?.id||String(nexus.id),fullName:person?.fullName||[nexus.lastName,nexus.firstName].filter(Boolean).join(' ')};
  res.json({token:jwt.sign(session,env.jwtSecret,{expiresIn:'12h'}),user:session});
}));
router.get('/me',auth,safe(async(req:any,res)=>res.json({user:req.sentinelUser,statistics:await statistics(req.sentinelUser.personId)})));
router.get('/directory',auth,manager,safe(async(req,res)=>{const q=String(req.query.q||'').trim().toLowerCase();const people=await loadOrbitDirectory(req.query.refresh==='true');res.json({people:(q?people.filter(p=>[p.fullName,p.email,p.displayId,p.className,p.jobTitle].some(v=>v?.toLowerCase().includes(q))):people).slice(0,250)});}));
router.get('/time/reference',auth,safe(async(req,res)=>{
  const result=await pool.query<{server_utc:string;kinshasa_time:string}>("SELECT TO_CHAR(NOW() AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS server_utc, TO_CHAR(NOW() AT TIME ZONE 'Africa/Kinshasa', 'YYYY-MM-DD HH24:MI:SS') AS kinshasa_time");
  res.json({serverUtc:result.rows[0]?.server_utc??new Date().toISOString(),schoolTime:result.rows[0]?.kinshasa_time,schoolTimezone:'Africa/Kinshasa',deviceTimezone:String(req.query.timezone||'UTC'),authority:'PostgreSQL authoritative clock'});
}));
router.post('/biometrics/orbit/:personId/enroll',auth,manager,safe(async(req:any,res)=>{
  const person=(await loadOrbitDirectory()).find(item=>item.id===req.params.personId);
  if(!person)return res.status(404).json({message:'Active Orbit identity not found'});
  const input=z.object({template:z.string().min(3).optional()}).parse(req.body??{});
  const template=isLiveBiometricCaptureEnabled()?await captureFingerprintTemplate('enroll'):input.template;
  if(!template)return res.status(409).json({message:'Connect the fingerprint bridge or provide a scanner template'});
  await pool.query('INSERT INTO sentinel_biometric_identities(identity_id,template_hash,enrolled_by) VALUES($1,$2,$3) ON CONFLICT(identity_id) DO UPDATE SET template_hash=EXCLUDED.template_hash,enrolled_by=EXCLUDED.enrolled_by,updated_at=NOW()',[person.id,protectBiometric(person.id,template),req.sentinelUser.sub]);
  res.status(201).json({identityId:person.id,fullName:person.fullName,kind:person.kind,enrolled:true,provider:isLiveBiometricCaptureEnabled()?'http-bridge':'authorized-template'});
}));
router.post('/biometrics/orbit/identify',auth,manager,safe(async(req:any,res)=>{
  const input=z.object({template:z.string().min(3).optional(),direction:z.enum(['ENTRY','EXIT']).default('ENTRY'),gate:z.string().default('Main Gate')}).parse(req.body??{});
  const template=isLiveBiometricCaptureEnabled()?await captureFingerprintTemplate(input.direction==='EXIT'?'exit':'verify'):input.template;
  if(!template)return res.status(409).json({message:'Connect the fingerprint bridge or provide a scanner template'});
  const registered=await pool.query('SELECT identity_id,template_hash FROM sentinel_biometric_identities');
  const match=registered.rows.find(row=>secureEqual(protectBiometric(row.identity_id,template),row.template_hash));
  if(!match)return res.status(404).json({message:'Fingerprint not recognized'});
  const person=(await loadOrbitDirectory()).find(item=>item.id===match.identity_id);
  if(!person)return res.status(409).json({message:'Fingerprint is no longer linked to an active Orbit identity'});
  const id=crypto.randomUUID();
  const recorded=await pool.query<{occurred_at:string}>("INSERT INTO sentinel_movements(id,person_id,person_type,direction,gate,source,recorded_by,observed_timezone) VALUES($1,$2,$3,$4,$5,$6,$7,'Africa/Kinshasa') RETURNING TO_CHAR(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') AS occurred_at",[id,person.id,'ORBIT',input.direction,input.gate,'BIOMETRIC',req.sentinelUser.sub]);
  res.json({matched:true,movementId:id,person:{id:person.id,fullName:person.fullName,kind:person.kind,displayId:person.displayId},direction:input.direction,gate:input.gate,occurredAt:recorded.rows[0]?.occurred_at,clockAuthority:'server'});
}));
router.get('/visitors',auth,manager,safe(async(req,res)=>{const q=String(req.query.q||'').trim();const values:any[]=[];let where='';if(q){values.push(`%${q}%`);where='WHERE v.full_name ILIKE $1 OR v.organization ILIKE $1 OR v.host_name ILIKE $1 OR v.purpose ILIKE $1';}const result=await pool.query(`SELECT v.id,v.full_name,v.last_name,v.middle_name,v.first_name,v.phone,v.organization,v.purpose,v.host_name,v.id_document,v.created_at,COUNT(m.id)::int AS movement_count,COUNT(m.id) FILTER (WHERE m.direction='ENTRY')::int AS visit_count,MAX(m.occurred_at) AS last_visit_at FROM sentinel_visitors v LEFT JOIN sentinel_movements m ON m.person_id=v.id AND m.person_type='VISITOR' ${where} GROUP BY v.id ORDER BY COALESCE(MAX(m.occurred_at),v.created_at) DESC LIMIT 250`,values);res.json({visitors:result.rows});}));
router.get('/visitors/:id/history',auth,manager,safe(async(req,res)=>{const visitor=await pool.query('SELECT * FROM sentinel_visitors WHERE id=$1',[req.params.id]);if(!visitor.rows[0])return res.status(404).json({message:'Visitor not found'});const movements=await pool.query("SELECT id,direction,gate,source,occurred_at,observed_timezone FROM sentinel_movements WHERE person_id=$1 AND person_type='VISITOR' ORDER BY occurred_at DESC LIMIT 1000",[req.params.id]);res.json({visitor:visitor.rows[0],movements:movements.rows,totalVisits:movements.rows.filter(row=>row.direction==='ENTRY').length});}));
router.post('/visitors',auth,manager,safe(async(req:any,res)=>{const p=z.object({lastName:z.string().trim().min(2),middleName:z.string().trim().optional(),firstName:z.string().trim().min(2),phone:z.string().trim().optional(),organization:z.string().trim().optional(),purpose:z.string().trim().min(2),hostName:z.string().trim().min(2),idDocument:z.string().trim().optional(),gate:z.string().trim().default('Main Gate'),deviceContext:deviceContextSchema}).parse(req.body);const id=crypto.randomUUID();const movementId=crypto.randomUUID();const fullName=[p.lastName,p.middleName,p.firstName].filter(Boolean).join(' ');const client=await pool.connect();try{await client.query('BEGIN');await client.query('INSERT INTO sentinel_visitors(id,full_name,last_name,middle_name,first_name,phone,organization,purpose,host_name,id_document) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,fullName,p.lastName,p.middleName||null,p.firstName,p.phone||null,p.organization||null,p.purpose,p.hostName,p.idDocument||null]);const movement=await client.query<{occurred_at:string}>("INSERT INTO sentinel_movements(id,person_id,person_type,direction,gate,source,recorded_by,observed_timezone,observed_latitude,observed_longitude) VALUES($1,$2,'VISITOR','ENTRY',$3,'MANUAL',$4,$5,$6,$7) RETURNING occurred_at::text",[movementId,id,p.gate,req.sentinelUser.sub,p.deviceContext.timezone,p.deviceContext.latitude??null,p.deviceContext.longitude??null]);await client.query('COMMIT');res.status(201).json({id,fullName,...p,movementId,enteredAt:movement.rows[0]?.occurred_at});}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}}));
router.post('/movements',auth,manager,safe(async(req:any,res)=>{const p=z.object({personId:z.string().min(1),personType:z.enum(['ORBIT','VISITOR']),direction:z.enum(['ENTRY','EXIT']),gate:z.string().default('Main Gate'),source:z.enum(['BIOMETRIC','QR','MANUAL']).default('MANUAL'),deviceContext:deviceContextSchema}).parse(req.body);const id=crypto.randomUUID();const result=await pool.query<{occurred_at:string}>('INSERT INTO sentinel_movements(id,person_id,person_type,direction,gate,source,recorded_by,observed_timezone,observed_latitude,observed_longitude) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING occurred_at::text',[id,p.personId,p.personType,p.direction,p.gate,p.source,req.sentinelUser.sub,p.deviceContext.timezone,p.deviceContext.latitude??null,p.deviceContext.longitude??null]);res.status(201).json({id,...p,occurredAt:result.rows[0]?.occurred_at,clockAuthority:'server'});}));
router.get('/movements/live',auth,manager,safe(async(_req,res)=>{const r=await pool.query('SELECT * FROM sentinel_movements ORDER BY occurred_at DESC LIMIT 200');res.json(r.rows);}));
router.post('/justifications',auth,safe(async(req:any,res)=>{const p=z.object({incidentType:z.enum(['ABSENCE','LATE']),incidentDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),reason:z.string().trim().min(10).max(2000),evidenceUrl:z.string().url().optional()}).parse(req.body);const id=crypto.randomUUID();await pool.query('INSERT INTO sentinel_justifications(id,person_id,incident_type,incident_date,reason,evidence_url) VALUES($1,$2,$3,$4,$5,$6)',[id,req.sentinelUser.personId,p.incidentType,p.incidentDate,p.reason,p.evidenceUrl||null]);res.status(201).json({id,personId:req.sentinelUser.personId,...p,status:'PENDING'});}));
router.get('/justifications',auth,safe(async(req:any,res)=>{const canManage=['admin','super_admin','school_admin','security_operator'].includes(String(req.sentinelUser.role).toLowerCase());const target=canManage&&req.query.personId?String(req.query.personId):req.sentinelUser.personId;const r=await pool.query('SELECT * FROM sentinel_justifications WHERE person_id=$1 ORDER BY incident_date DESC,created_at DESC LIMIT 250',[target]);res.json({justifications:r.rows});}));
router.patch('/justifications/:id/review',auth,manager,safe(async(req:any,res)=>{const p=z.object({status:z.enum(['APPROVED','REJECTED']),reviewNote:z.string().trim().min(3).max(1000)}).parse(req.body);const r=await pool.query('UPDATE sentinel_justifications SET status=$2,review_note=$3,reviewer_id=$4,reviewed_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *',[req.params.id,p.status,p.reviewNote,req.sentinelUser.sub]);if(!r.rows[0])return res.status(404).json({message:'Justification not found'});res.json(r.rows[0]);}));
router.get('/reports/operations',auth,manager,safe(async(req,res)=>{
  const range=z.object({from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).parse(req.query);
  if(range.from>range.to)return res.status(400).json({message:'Invalid report date range'});
  const days=Math.floor((new Date(`${range.to}T12:00:00Z`).getTime()-new Date(`${range.from}T12:00:00Z`).getTime())/86400000)+1;
  if(days<1||days>370)return res.status(400).json({message:'The report range must be between 1 and 370 days'});
  const result=await pool.query(`SELECT m.id,m.person_id,m.person_type,m.direction,m.gate,m.source,m.occurred_at,m.observed_timezone,v.full_name AS visitor_name,v.organization,v.purpose,v.host_name FROM sentinel_movements m LEFT JOIN sentinel_visitors v ON v.id::text=m.person_id AND m.person_type='VISITOR' WHERE (m.occurred_at AT TIME ZONE 'Africa/Kinshasa')::date BETWEEN $1::date AND $2::date ORDER BY m.occurred_at DESC LIMIT 20000`,[range.from,range.to]);
  const directory=await loadOrbitDirectory(); const orbitById=new Map(directory.map(person=>[person.id,person]));
  const movements=result.rows.map(row=>{const person=row.person_type==='ORBIT'?orbitById.get(row.person_id):null;return {...row,fullName:person?.fullName||row.visitor_name||'Identité non résolue',kind:person?.kind||(row.person_type==='VISITOR'?'VISITOR':'ORBIT'),displayId:person?.displayId||null,className:person?.className||null,jobTitle:person?.jobTitle||null};});
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kinshasa',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const employeeToday=new Map<string,any>();
  for(const row of movements){const localDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Kinshasa',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(row.occurred_at));if(localDate!==today||row.person_type!=='ORBIT'||!['TEACHER','STAFF'].includes(String(row.kind)))continue;const current=employeeToday.get(row.person_id)||{...row,firstEntry:null,lastExit:null,latestDirection:row.direction,latestAt:row.occurred_at};if(row.direction==='ENTRY'&&(!current.firstEntry||new Date(row.occurred_at)<new Date(current.firstEntry)))current.firstEntry=row.occurred_at;if(row.direction==='EXIT'&&(!current.lastExit||new Date(row.occurred_at)>new Date(current.lastExit)))current.lastExit=row.occurred_at;if(new Date(row.occurred_at)>=new Date(current.latestAt)){current.latestAt=row.occurred_at;current.latestDirection=row.direction;}employeeToday.set(row.person_id,current);}
  const employeePresence=[...employeeToday.values()].sort((a,b)=>String(a.fullName).localeCompare(String(b.fullName),'fr'));
  const entries=movements.filter(row=>row.direction==='ENTRY').length; const exits=movements.filter(row=>row.direction==='EXIT').length;
  res.json({from:range.from,to:range.to,timezone:'Africa/Kinshasa',generatedAt:new Date().toISOString(),summary:{movements:movements.length,entries,exits,orbitMovements:movements.filter(row=>row.person_type==='ORBIT').length,visitorMovements:movements.filter(row=>row.person_type==='VISITOR').length,uniquePeople:new Set(movements.map(row=>`${row.person_type}:${row.person_id}`)).size,presentEmployees:employeePresence.filter(row=>row.latestDirection==='ENTRY').length},employeePresence,movements});
}));
router.get('/reports/:personId',auth,safe(async(req:any,res)=>{if(req.sentinelUser.role==='entity'&&req.sentinelUser.personId!==req.params.personId)return res.status(403).json({message:'You may only view your own attendance'});const range=z.object({from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()}).parse(req.query);if((range.from&&!range.to)||(!range.from&&range.to))return res.status(400).json({message:'Both from and to dates are required'});if(range.from&&range.to&&range.from>range.to)return res.status(400).json({message:'Invalid report date range'});res.json(await statistics(req.params.personId,range.from,range.to));}));
async function statistics(personId:string,reportFrom?:string,reportTo?:string){
  const result=await pool.query(`SELECT occurred_at,direction,gate,source FROM sentinel_movements WHERE person_id=$1 ORDER BY occurred_at DESC LIMIT 5000`,[personId]);
  const now=new Date();
  const schoolTimezone='Africa/Kinshasa';
  const localParts=(date:Date)=>Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone:schoolTimezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(part=>part.type!=='literal').map(part=>[part.type,part.value]));
  const localDateKey=(date:Date)=>{const parts=localParts(date);return `${parts.year}-${parts.month}-${parts.day}`;};
  const localClockMinutes=(date:Date)=>{const parts=localParts(date);return Number(parts.hour)*60+Number(parts.minute);};
  const windows=[['daily',1],['weekly',7],['monthly',31],['yearly',366]] as const;
  const rows=result.rows.map(row=>({...row,occurredAt:new Date(row.occurred_at)})).filter(row=>Number.isFinite(row.occurredAt.getTime()));
  const summarize=(days:number,exactRange?:{from:string;to:string})=>{
    const floor=now.getTime()-days*86400000;
    const previousFloor=floor-days*86400000;
    const current=exactRange?rows.filter(row=>{const key=localDateKey(row.occurredAt);return key>=exactRange.from&&key<=exactRange.to;}):rows.filter(row=>row.occurredAt.getTime()>=floor);
    const previous=exactRange?[]:rows.filter(row=>row.occurredAt.getTime()>=previousFloor&&row.occurredAt.getTime()<floor);
    const byDay=new Map<string,typeof current>();
    for(const row of current){const key=localDateKey(row.occurredAt);byDay.set(key,[...(byDay.get(key)||[]),row]);}
    const dayDetails=[...byDay.entries()].sort(([a],[b])=>b.localeCompare(a)).map(([date,events])=>{
      const entries=events.filter(event=>event.direction==='ENTRY').sort((a,b)=>a.occurredAt.getTime()-b.occurredAt.getTime());
      const exits=events.filter(event=>event.direction==='EXIT').sort((a,b)=>a.occurredAt.getTime()-b.occurredAt.getTime());
      const firstEntry=entries[0]?.occurredAt??null; const lastExit=exits.at(-1)?.occurredAt??null;
      const durationMinutes=firstEntry&&lastExit&&lastExit>firstEntry?Math.round((lastExit.getTime()-firstEntry.getTime())/60000):null;
      const late=Boolean(firstEntry&&localClockMinutes(firstEntry)>450);
      return {date,firstEntry:firstEntry?.toISOString()??null,lastExit:lastExit?.toISOString()??null,durationMinutes,late,gate:events[0]?.gate??null,source:events[0]?.source??null};
    });
    const arrivalMinutes=dayDetails.filter(day=>day.firstEntry).map(day=>localClockMinutes(new Date(day.firstEntry!)));
    const departureMinutes=dayDetails.filter(day=>day.lastExit).map(day=>localClockMinutes(new Date(day.lastExit!)));
    const durations=dayDetails.map(day=>day.durationMinutes).filter((value):value is number=>value!==null);
    const attendanceDays=dayDetails.length; const lateDays=dayDetails.filter(day=>day.late).length;
    const rangeStart=exactRange?new Date(`${exactRange.from}T12:00:00Z`):new Date(floor);
    const rangeEnd=exactRange?new Date(`${exactRange.to}T12:00:00Z`):now;
    const elapsedDays=Math.max(1,Math.min(days,Math.floor((rangeEnd.getTime()-rangeStart.getTime())/86400000)+1));
    let expectedSchoolDays=0; for(let index=0;index<elapsedDays;index+=1){const date=new Date(rangeStart.getTime()+index*86400000);if(date.getUTCDay()!==0&&date.getUTCDay()!==6)expectedSchoolDays+=1;}
    const average=(values:number[])=>values.length?Math.round(values.reduce((sum,value)=>sum+value,0)/values.length):null;
    const formatClock=(minutes:number|null)=>minutes===null?null:`${String(Math.floor(minutes/60)).padStart(2,'0')}:${String(minutes%60).padStart(2,'0')}`;
    const previousDays=new Set(previous.map(row=>localDateKey(row.occurredAt))).size;
    return {entries:current.filter(row=>row.direction==='ENTRY').length,exits:current.filter(row=>row.direction==='EXIT').length,attendanceDays,completeDays:dayDetails.filter(day=>day.firstEntry&&day.lastExit).length,lateDays,punctualityRate:attendanceDays?Number((((attendanceDays-lateDays)/attendanceDays)*100).toFixed(1)):0,presenceRate:expectedSchoolDays?Number((Math.min(attendanceDays/expectedSchoolDays,1)*100).toFixed(1)):0,averageArrival:formatClock(average(arrivalMinutes)),averageDeparture:formatClock(average(departureMinutes)),totalPresenceMinutes:durations.reduce((sum,value)=>sum+value,0),averagePresenceMinutes:average(durations)??0,trendDays:attendanceDays-previousDays,dayDetails,movements:current.map(({occurredAt,...row})=>({...row,occurred_at:occurredAt.toISOString()}))};
  };
  return {personId,generatedAt:now.toISOString(),timezone:schoolTimezone,periods:Object.fromEntries(windows.map(([name,days])=>[name,summarize(days)])),...(reportFrom&&reportTo?{custom:{from:reportFrom,to:reportTo,...summarize(Math.max(1,Math.floor((new Date(reportTo).getTime()-new Date(reportFrom).getTime())/86400000)+1),{from:reportFrom,to:reportTo})}}:{})};
}
export default router;
