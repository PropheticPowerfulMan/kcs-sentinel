import test from 'node:test';import assert from 'node:assert/strict';
import {createAcademicCalendarReader,countOfficialSchoolDays,isOfficialSchoolDay} from './academic-calendar.js';
const calendars=[{name:'2026-2027',startDate:'2026-09-07T00:00:00Z',endDate:'2027-06-11T23:59:59Z',status:'ACTIVE'}];
test('published school year excludes summer and weekends, retaining explicit closures',()=>{
 const overrides=new Map([['2026-09-09',false]]);assert.equal(countOfficialSchoolDays('2026-09-01','2026-09-13',calendars,overrides),4);assert.equal(isOfficialSchoolDay('2026-07-01',calendars,new Map()),false);assert.equal(isOfficialSchoolDay('2026-09-12',calendars,new Map()),false);
});
test('historical calendars remain readable; planned years do not become active automatically',()=>{assert.equal(isOfficialSchoolDay('2026-09-08',[{...calendars[0],status:'CLOSED'}],new Map()),true);assert.equal(isOfficialSchoolDay('2026-09-08',[{...calendars[0],status:'PLANNED'}],new Map()),false)});
test('calendar refresh coalesces requests and keeps last published dates during an outage',async()=>{
 let now=0,calls=0,offline=false;const request=(async()=>{calls++;if(offline)throw Error('Offline');return new Response(JSON.stringify({calendars}),{status:200})}) as typeof fetch;
 const load=createAcademicCalendarReader({url:'https://orbit.invalid',key:'test',organization:'school'},request,()=>now);
 await Promise.all([load(),load()]);assert.equal(calls,1);now=31000;offline=true;const saved=await load();assert.equal(saved.source,'STALE_ORBIT');assert.equal(saved.calendars[0].name,'2026-2027');now=32000;await load();assert.equal(calls,2);
});
test('first-load outage exposes an explicit fallback and never invents a calendar',async()=>{const load=createAcademicCalendarReader({url:'https://orbit.invalid',key:'test',organization:'school'},(async()=>{throw Error('offline')}) as typeof fetch);const value=await load();assert.equal(value.source,'LOCAL_FALLBACK');assert.deepEqual(value.calendars,[])});
