// Run real cloud-function routes against isolated synthetic collections. No network.
const assert = require('node:assert/strict')
const path = require('node:path')
const root = path.resolve(__dirname, '../uniapp/uniCloud-aliyun/cloudfunctions')
process.env.CLUBHUB_JWT_SECRET = 'admin-authorization-test-fixture-only'
const club = require(path.join(root, 'common/club-common'))
let stores, mutations, failDatabase = false, passed = 0
function query(name) {
  let condition = {}
  const q = {
    where(value) { condition = value; return q },
    limit() { return q }, field() { return q },
    async get() {
      return {data:(stores[name] || []).filter(row=>Object.entries(condition).every(([key,value])=>value?.in ? value.in.includes(row[key]) : row[key] === value))}
    },
    async add(docs) { mutations++; stores[name].push(...(Array.isArray(docs)?docs:[docs])); return {id:'fixture-created'} },
    async remove() { mutations++; stores[name]=[]; return {deleted:1} },
    doc(id) { return {async update(patch) { mutations++; Object.assign(stores[name].find(row=>row._id===id),patch); return {updated:1} }} },
  }
  return q
}
global.uniCloud = {database() {
  if (failDatabase) throw new Error('Synthetic database outage')
  return {collection:query,command:{in:values=>({in:values})}}
}}
const admin = require(path.join(root,'admin'))
function reset(role='super',status='normal',deleted=0) {
  failDatabase=false;mutations=0
  stores={admins:[{_id:'actor',username:'synthetic-admin',name:'Fixture',role,status,deleted}],users:[{_id:'student',status:'normal',deleted:0}],whitelist:[{student_no:'existing-fixture'}]}
}
const token = (role='super',id='actor') => club.signToken({type:'admin',adminId:id,role},7200)
async function call(fn,route,jwt,body={},method='POST') {
  const result=await fn.main({httpMethod:method,path:route,headers:{authorization:`Bearer ${jwt}`},body:JSON.stringify(body),queryStringParameters:{}})
  return JSON.parse(result.body)
}
const importBody = mode=>({mode,batch_no:'offline-authorization',chunk_index:0,chunk_total:1,reset:mode==='full',rows:[{student_no:'20260001',name:'Synthetic student'}]})
async function check(label, action) { await action();passed++;console.log(`PASS ${label}`) }
;(async()=>{
  for(const mode of ['append','full']) await check(`viewer cannot ${mode}-import or reset whitelist`,async()=>{
    reset('viewer');const before=JSON.stringify(stores.whitelist)
    assert.equal((await call(admin,'/whitelist/import',token('viewer'),importBody(mode))).code,403)
    assert.equal(mutations,0);assert.equal(JSON.stringify(stores.whitelist),before)
  })
  for(const role of ['super','auditor']) await check(`${role} retains authorized whitelist import`,async()=>{
    reset(role);const result=await call(admin,'/whitelist/import',token(role),importBody('append'))
    assert.equal(result.code,0);assert.equal(result.data.success,1)
  })
  await check('disabling an existing administrator blocks its previously issued token',async()=>{
    reset();const jwt=token();stores.admins[0].status='disabled'
    assert.equal((await call(admin,'/session',jwt,{},'GET')).code,403)
    assert.equal((await call(admin,'/users/disable',jwt,{user_id:'student'})).code,403)
    assert.equal(mutations,0);assert.equal(stores.users[0].status,'normal')
  })
  await check('demotion rejects old privileges and fresh viewer token remains read-only',async()=>{
    reset();const old=token();stores.admins[0].role='viewer'
    assert.equal((await call(admin,'/users/disable',old,{user_id:'student'})).code,401)
    assert.equal((await call(admin,'/users/disable',token('viewer'),{user_id:'student'})).code,403)
    assert.equal((await call(admin,'/session',token('viewer'),{},'GET')).code,0)
    assert.equal(mutations,0)
  })
  await check('deleted and missing administrators cannot reuse signed tokens',async()=>{
    reset();const jwt=token();stores.admins[0].deleted=1
    assert.equal((await call(admin,'/users/disable',jwt,{user_id:'student'})).code,401)
    reset();stores.admins=[]
    assert.equal((await call(admin,'/users/disable',token(),{user_id:'student'})).code,401)
    assert.equal(mutations,0)
  })
  await check('normal auditor retains user-management permission',async()=>{
    reset('auditor');assert.equal((await call(admin,'/users/disable',token('auditor'),{user_id:'student'})).code,0)
    assert.equal(stores.users[0].status,'disabled')
  })
  for(const [domain,route,method] of [['activity','/review','POST'],['recruitment','/review','POST'],['club','/review','POST'],['moderation','/review','POST'],['sensitive_words','/save','POST'],['announcement','/publish','POST'],['dashboard','/summary','GET'],['stats','/overview','GET']]) {
    await check(`disabled token blocked across ${domain} domain`,async()=>{
      reset('super','disabled');const fn=require(path.join(root,domain))
      assert.equal((await call(fn,route,token(),{},method)).code,403)
      assert.equal(mutations,0)
    })
  }
  await check('database failure cannot fall back to JWT-only administrator access',async()=>{
    reset();failDatabase=true;const originalError=console.error;console.error=()=>{}
    try { assert.equal((await call(admin,'/users/disable',token(),{user_id:'student'})).code,500) }
    finally { console.error=originalError;failDatabase=false }
    assert.equal(mutations,0)
  })
  await check('student token validation remains synchronous before active-student guard',async()=>{
    reset();const jwt=club.signToken({type:'student',token_kind:'access',userId:'student',openid:'fixture'})
    assert.equal(club.requireAuth('student')({event:{headers:{authorization:`Bearer ${jwt}`}}}),true)
  })
  console.log(`${passed} administrator authorization regressions passed`)
})().catch(error=>{console.error(error);process.exitCode=1})
