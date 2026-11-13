import {Router} from 'express'
import {timingSafeEqual} from 'node:crypto'
import {z} from 'zod'
import {pool} from '../../db/pool.js'
import {loadOrbitDirectory} from './directory.js'
import {attendancePolicyFor,kinshasaClockMinutes} from '../attendance/attendance-policy.js'
export const nexusAttendanceRouter=Router()
nexusAttendanceRouter.get('/integration/nexus/staff-attendance',async(req,res,next)=>{
 try{
  const expected=process.env.NEXUS_ATTENDANCE_SYNC_KEY,provided=req.header('x-kcs-nexus-key')
  if(!expected||expected.length<32||!provided||Buffer.byteLength(expected)!==Buffer.byteLength(provided)||!timingSafeEqual(Buffer.from(expected),Buffer.from(provided)))return res.status(401).json({message:'Unauthorized attendance integration'})
  const range=z.object({from:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),to:z.string().regex(/^\d{4}-\d{2}-\d{2}$/)}).parse(req.query)
  const days=(Date.parse(range.to+'T12:00:00Z')-Date.parse(range.from+'T12:00:00Z'))/86400000+1
  if(!Number.isInteger(days)||days<1||days>31||[range.from,range.to].some(day=>new Date(day+'T12:00:00Z').toISOString().slice(0,10)!==day))return res.status(400).json({message:'Use a range of 1 to 31 days'})
  const[movements,justifications,directory]=await Promise.all([
   pool.query(`SELECT person_id,(occurred_at AT TIME ZONE 'Africa/Kinshasa')::date::text AS date,MIN(occurred_at) FILTER(WHERE direction='ENTRY') AS first_entry,MAX(occurred_at) FILTER(WHERE direction='EXIT') AS last_exit,MAX(occurred_at) AS last_movement,COUNT(*)::int AS movement_count FROM sentinel_movements WHERE person_type='ORBIT' AND (occurred_at AT TIME ZONE 'Africa/Kinshasa')::date BETWEEN $1::date AND $2::date GROUP BY person_id,(occurred_at AT TIME ZONE 'Africa/Kinshasa')::date ORDER BY date,person_id LIMIT 50001`,[range.from,range.to]),
   pool.query(`SELECT id,person_id,incident_date::text AS date,incident_type,reason,review_note,updated_at FROM sentinel_justifications WHERE status='APPROVED' AND incident_date BETWEEN $1::date AND $2::date ORDER BY updated_at DESC`,[range.from,range.to]),loadOrbitDirectory(),
  ])
  if(movements.rows.length>50000)return res.status(413).json({message:'Reduce the attendance date range'})
  const people=new Map(directory.filter(person=>attendancePolicyFor(person).category==='EMPLOYEE').map(person=>[person.id,person]))
  const records=new Map<string,any>()
  for(const row of movements.rows){const person=people.get(row.person_id);if(!person)continue;const first=row.first_entry?new Date(row.first_entry):null,last=row.last_exit?new Date(row.last_exit):null;records.set(row.person_id+'::'+row.date,{staffOrbitId:person.id,employeeNumber:person.displayId||person.accessCode||null,staffName:person.fullName,staffEmail:person.email||null,department:person.department||person.jobTitle||null,date:row.date,status:first&&kinshasaClockMinutes(first)>(attendancePolicyFor(person).lateAfterMinutes??Infinity)?'LATE':'PRESENT',firstEntry:first?.toISOString()??null,lastExit:last?.toISOString()??null,sourceUpdatedAt:new Date(row.last_movement).toISOString(),movementCount:row.movement_count,justification:null})}
  for(const row of justifications.rows){const person=people.get(row.person_id);if(!person)continue;const key=row.person_id+'::'+row.date,current=records.get(key);if(current){if(!current.justification)current.justification={id:row.id,type:row.incident_type,reason:row.reason,reviewNote:row.review_note};continue}if(row.incident_type==='ABSENCE')records.set(key,{staffOrbitId:person.id,employeeNumber:person.displayId||person.accessCode||null,staffName:person.fullName,staffEmail:person.email||null,department:person.department||person.jobTitle||null,date:row.date,status:'EXCUSED',firstEntry:null,lastExit:null,sourceUpdatedAt:new Date(row.updated_at).toISOString(),movementCount:0,justification:{id:row.id,type:row.incident_type,reason:row.reason,reviewNote:row.review_note}})}
  res.setHeader('Cache-Control','private, no-store');return res.json({source:'KCS_SENTINEL',timezone:'Africa/Kinshasa',from:range.from,to:range.to,generatedAt:new Date().toISOString(),records:[...records.values()]})
 }catch(error){next(error)}
})
