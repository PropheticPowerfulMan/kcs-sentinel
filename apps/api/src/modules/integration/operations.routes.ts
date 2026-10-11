import crypto from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../../config/env.js";
import { pool } from "../../db/pool.js";
import { loadOrbitDirectory, resolveOrbitPerson } from "../integration/directory.js";

const router = Router();
type Session = { sub: string; role: string; personId: string; fullName: string };
const auth = (req: any, res: any, next: any) => { try { const token=String(req.headers.authorization||'').replace(/^Bearer /,''); req.sentinelUser=jwt.verify(token,env.jwtSecret) as Session; next(); } catch { res.status(401).json({message:'Invalid or expired institutional session'}); } };
const manager = (req:any,res:any,next:any) => ['admin','super_admin','security_operator'].includes(String(req.sentinelUser?.role).toLowerCase()) ? next() : res.status(403).json({message:'Guard or administrator access required'});

router.post('/auth/login', async (req,res) => {
  const payload=z.object({identifier:z.string().trim().min(2),password:z.string().min(1)}).parse(req.body);
  const response=await fetch(new URL('/api/auth/login',env.nexusApiUrl),{method:'POST',headers:{'content-type':'application/json','x-kcs-client':'KCS_SENTINEL'},body:JSON.stringify(payload),signal:AbortSignal.timeout(12000)});
  const body=await response.json().catch(()=>null) as any;
  if(!response.ok||!body?.data?.user)return res.status(401).json({message:body?.message||'Institutional authentication failed'});
  const nexus=body.data.user; const person=await resolveOrbitPerson(nexus.email||nexus.accessCode||payload.identifier);
  if(!person && String(nexus.role).toLowerCase()!=='admin')return res.status(403).json({message:'No active Orbit identity is linked to this account'});
  const role=String(nexus.role).toLowerCase()==='admin'?'super_admin':person?.kind==='STAFF'&&/guard|security|gardien/i.test(`${person.jobTitle} ${person.department}`)?'security_operator':'entity';
  const session:Session={sub:String(nexus.id),role,personId:person?.id||String(nexus.id),fullName:person?.fullName||[nexus.lastName,nexus.firstName].filter(Boolean).join(' ')};
  res.json({token:jwt.sign(session,env.jwtSecret,{expiresIn:'12h'}),user:session});
});
router.use(auth);
router.get('/me',async(req:any,res)=>res.json({user:req.sentinelUser,statistics:await statistics(req.sentinelUser.personId)}));
router.get('/directory',manager,async(req,res)=>{const q=String(req.query.q||'').trim().toLowerCase();const people=await loadOrbitDirectory(req.query.refresh==='true');res.json({people:(q?people.filter(p=>[p.fullName,p.email,p.displayId,p.className,p.jobTitle].some(v=>v?.toLowerCase().includes(q))):people).slice(0,250)});});
router.post('/visitors',manager,async(req,res)=>{const p=z.object({fullName:z.string().min(2),phone:z.string().optional(),organization:z.string().optional(),purpose:z.string().min(2),hostName:z.string().min(2),idDocument:z.string().optional()}).parse(req.body);const id=crypto.randomUUID();await pool.query('INSERT INTO sentinel_visitors(id,full_name,phone,organization,purpose,host_name,id_document) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,p.fullName,p.phone||null,p.organization||null,p.purpose,p.hostName,p.idDocument||null]);res.status(201).json({id,...p});});
router.post('/movements',manager,async(req:any,res)=>{const p=z.object({personId:z.string().min(1),personType:z.enum(['ORBIT','VISITOR']),direction:z.enum(['ENTRY','EXIT']),gate:z.string().default('Main Gate'),source:z.enum(['BIOMETRIC','QR','MANUAL']).default('MANUAL')}).parse(req.body);const id=crypto.randomUUID();await pool.query('INSERT INTO sentinel_movements(id,person_id,person_type,direction,gate,source,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,p.personId,p.personType,p.direction,p.gate,p.source,req.sentinelUser.sub]);res.status(201).json({id,...p,timestamp:new Date().toISOString()});});
router.get('/movements/live',manager,async(_req,res)=>{const r=await pool.query('SELECT * FROM sentinel_movements ORDER BY occurred_at DESC LIMIT 200');res.json(r.rows);});
router.post('/justifications',async(req:any,res)=>{const p=z.object({incidentType:z.enum(['ABSENCE','LATE']),incidentDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),reason:z.string().trim().min(10).max(2000),evidenceUrl:z.string().url().optional()}).parse(req.body);const id=crypto.randomUUID();await pool.query('INSERT INTO sentinel_justifications(id,person_id,incident_type,incident_date,reason,evidence_url) VALUES($1,$2,$3,$4,$5,$6)',[id,req.sentinelUser.personId,p.incidentType,p.incidentDate,p.reason,p.evidenceUrl||null]);res.status(201).json({id,personId:req.sentinelUser.personId,...p,status:'PENDING'});});
router.get('/justifications',async(req:any,res)=>{const canManage=['admin','super_admin','security_operator'].includes(String(req.sentinelUser.role).toLowerCase());const target=canManage&&req.query.personId?String(req.query.personId):req.sentinelUser.personId;const r=await pool.query('SELECT * FROM sentinel_justifications WHERE person_id=$1 ORDER BY incident_date DESC,created_at DESC LIMIT 250',[target]);res.json({justifications:r.rows});});
router.patch('/justifications/:id/review',manager,async(req:any,res)=>{const p=z.object({status:z.enum(['APPROVED','REJECTED']),reviewNote:z.string().trim().min(3).max(1000)}).parse(req.body);const r=await pool.query('UPDATE sentinel_justifications SET status=$2,review_note=$3,reviewer_id=$4,reviewed_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING *',[req.params.id,p.status,p.reviewNote,req.sentinelUser.sub]);if(!r.rows[0])return res.status(404).json({message:'Justification not found'});res.json(r.rows[0]);});
router.get('/reports/:personId',async(req:any,res)=>{if(req.sentinelUser.role==='entity'&&req.sentinelUser.personId!==req.params.personId)return res.status(403).json({message:'You may only view your own attendance'});res.json(await statistics(req.params.personId));});
async function statistics(personId:string){const r=await pool.query(`SELECT occurred_at,direction,gate,source FROM sentinel_movements WHERE person_id=$1 ORDER BY occurred_at DESC LIMIT 1000`,[personId]);const now=new Date();const windows=[['daily',1],['weekly',7],['monthly',31],['yearly',366]] as const;return {personId,generatedAt:now.toISOString(),periods:Object.fromEntries(windows.map(([name,days])=>{const floor=now.getTime()-days*86400000;const rows=r.rows.filter(x=>new Date(x.occurred_at).getTime()>=floor);return [name,{entries:rows.filter(x=>x.direction==='ENTRY').length,exits:rows.filter(x=>x.direction==='EXIT').length,movements:rows}]}))};}
export default router;