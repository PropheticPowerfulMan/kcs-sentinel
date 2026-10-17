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
  const result=await pool.query<{server_utc:string}>('SELECT NOW()::text AS server_utc');
  res.json({serverUtc:result.rows[0]?.server_utc??new Date().toISOString(),deviceTimezone:String(req.query.timezone||'UTC'),authority:'KCS Sentinel server/PostgreSQL'});
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
  await pool.query('INSERT INTO sentinel_movements(id,person_id,person_type,direction,gate,source,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,person.id,'ORBIT',input.direction,input.gate,'BIOMETRIC',req.sentinelUser.sub]);
  res.json({matched:true,movementId:id,person:{id:person.id,fullName:person.fullName,kind:person.kind,displayId:person.displayId},direction:input.direction,gate:input.gate,occurredAt:new Date().toISOString()});
}));
router.get('/visitors',auth,manager,safe(async(req,res)=>{const q=String(req.query.q||'').trim();const values:any[]=[];let where='';if(q){values.push(`%${q}%`);where='WHERE full_name ILIKE $1';}const result=await pool.query(`SELECT id,full_name,last_name,middle_name,first_name,phone,organization,purpose,host_name,id_document,created_at FROM sentinel_visitors ${where} ORDER BY created_at DESC LIMIT 250`,values);res.json({visitors:result.rows});}));
router.post('/visitors',auth,manager,safe(async(req,res)=>{const p=z.object({lastName:z.string().trim().min(2),middleName:z.string().trim().optional(),firstName:z.string().trim().min(2),phone:z.string().trim().optional(),organization:z.string().trim().optional(),purpose:z.string().trim().min(2),hostName:z.string().trim().min(2),idDocument:z.string().trim().optional()}).parse(req.body);const id=crypto.randomUUID();const fullName=[p.lastName,p.middleName,p.firstName].filter(Boolean).join(' ');await pool.query('INSERT INTO sentinel_visitors(id,full_name,last_name,middle_name,first_name,phone,organization,purpose,host_name,id_document) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,fullName,p.lastName,p.middleName||null,p.firstName,p.phone||null,p.organization||null,p.purpose,p.hostName,p.idDocument||null]);res.status(201).json({id,fullName,...p});}));
router.post('/movements',auth,manager,safe(async(req:any,res)=>{const p=z.object({personId:z.string().min(1),personType:z.enum(['ORBIT','VISITOR']),direction:z.enum(['ENTRY','EXIT']),gate:z.string().default('Main Gate'),source:z.enum(['BIOMETRIC','QR','MANUAL']).default('MANUAL'),deviceContext:deviceContextSchema}).parse(req.body);const id=crypto.randomUUID();const result=await pool.query<{occurred_at:string}>('INSERT INTO sentinel_movements(id,person_id,person_type,direction,gate,source,recorded_by,observed_timezone,observed_latitude,observed_longitude) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING occurred_at::text',[id,p.personId,p.personType,p.direction,p.gate,p.source,req.sentinelUser.sub,p.deviceContext.timezone,p.deviceContext.latitude??null,p.deviceContext.longitude??null]);res.status(201).json({id,...p,occurredAt:result.rows[0]?.occurred_at,clockAuthority:'server'});}));
router.get('/movements/live',auth,manager,safe(async(_req,res)=>{const r=await pool.query('SELECT * FROM sentinel_movements ORDER BY occurred_at DESC LIMIT 200');res.json(r.rows);}));
router.post('/justifications',auth,safe(async(req:any,res)=>{const p=z.object({incidentType:z.enum(['ABSENCE','LATE']),incidentDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),reason:z.string().trim().min(10).max(2000),evidenceUrl:z.string().url().optional()}).parse(req.body);const id=crypto.randomUUID();await pool.query('INSERT INTO sentinel_justifications(id,person_id,incident_type,incident_date,reason,evidence_url) VALUES($1,$2,$3,$4,$5,$6)',[id,req.sentinelUser.personId,p.incidentType,p.incidentDate,p.reason,p.evidenceUrl||null]);res.status(201).json({id,personId:req.sentinelUser.personId,...p,status:'PENDING'});}));
router.get('/justifications',auth,safe(async(req:any,res)=>{const canManage=['admin','super_admin','school_admin','security_operator'].includes(String(req.sentinelUser.role).toLowerCase());const target=canManage&&req.query.personId?String(req.query.personId):req.sentinelUser.personId;const r=await pool.query('SELECT * FROM sentinel_justifications WHERE person_id=$1 ORDER BY incident_date DESC,created_at DESC LIMIT 250',[target]);res.json({justifications:r.rows});}));
router.patch('/justifications/:id/review',auth,manager,safe(async(req:any,res)=>{const p=z.object({status:z.enum(['APPROVED','REJECTED']),reviewNote:z.string().trim().min(3).max(1000)}).parse(req.body);const r=await pool.query('UPDATE sentinel_justifications SET status=$2,review_note=$3,reviewer_id=$4,reviewed_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *',[req.params.id,p.status,p.reviewNote,req.sentinelUser.sub]);if(!r.rows[0])return res.status(404).json({message:'Justification not found'});res.json(r.rows[0]);}));
router.get('/reports/:personId',auth,safe(async(req:any,res)=>{if(req.sentinelUser.role==='entity'&&req.sentinelUser.personId!==req.params.personId)return res.status(403).json({message:'You may only view your own attendance'});res.json(await statistics(req.params.personId));}));
async function statistics(personId:string){const r=await pool.query(`SELECT occurred_at,direction,gate,source FROM sentinel_movements WHERE person_id=$1 ORDER BY occurred_at DESC LIMIT 1000`,[personId]);const now=new Date();const windows=[['daily',1],['weekly',7],['monthly',31],['yearly',366]] as const;return {personId,generatedAt:now.toISOString(),periods:Object.fromEntries(windows.map(([name,days])=>{const floor=now.getTime()-days*86400000;const rows=r.rows.filter(x=>new Date(x.occurred_at).getTime()>=floor);return [name,{entries:rows.filter(x=>x.direction==='ENTRY').length,exits:rows.filter(x=>x.direction==='EXIT').length,movements:rows}]}))};}
export default router;
