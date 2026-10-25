/** Local UI demonstration adapter. Synthetic data in memory, NOT the uniCloud backend.
 * Binds only to loopback, never reads personal data or credentials, resets on restart.
 * Unsupported endpoints fail explicitly instead of pretending to succeed.
 */
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')
const now = Date.now(), day = 86400000
const asset = (name) => `http://127.0.0.1:4175/assets/${name}.svg`
const categories = ['学术科技','文艺表演','体育竞技','公益实践','创新创业','思想政治','兴趣爱好','其他'].map((name, i) => ({ _id: `cat-${i+1}`, name, sort: i+1 }))
const clubs = [
  { _id: 'club-1', name: '天文爱好者协会', intro: '把好奇心带到星空下。观星、科普与校园探索，欢迎每一位对宇宙好奇的同学。', logo: asset('stars'), cover: asset('stars'), contact: '演示社团 · 站内联系', category_id: 'cat-1', category_name: '学术科技', star_level: 5, member_count: 48, activity_count: 6, status: 'normal', created_at: now - 90*day },
  { _id: 'club-2', name: '校园音乐社', intro: '用音乐记录校园，零基础也能找到自己的舞台。', logo: asset('music'), cover: asset('music'), contact: '演示社团 · 站内联系', category_id: 'cat-2', category_name: '文艺表演', star_level: 4, member_count: 36, activity_count: 4, status: 'normal', created_at: now - 80*day },
]
const activities = [
  { _id: 'act-1', club_id: 'club-1', club_name: clubs[0].name, title: '一起去看星星 · 校园观星夜', content: '在校园草坪认识秋季星座，用望远镜探索夜空。\n活动安排：星空导览 → 望远镜体验 → 观测记录分享。\n无需自带设备，报名后请准时到场。', cover: asset('stars'), category_id: 'cat-1', location: '校园东区 · 观星草坪', start_time: now+2*day, end_time: now+2*day+7200000, signup_start: now-day, signup_end: now+day, capacity: 50, registered_count: 32, signup_count: 32, progress: 64, need_approval: false, has_waitlist: true, allow_onsite: false, signin_config: {methods:['qrcode']}, status:'signup', created_at:now-day, updated_at:now-day },
  { _id:'act-2', club_id:'club-2', club_name:clubs[1].name, title:'草坪音乐会 · 秋日即兴', content:'一次轻松的校园音乐分享，带上你喜欢的旋律。', cover:asset('music'), category_id:'cat-2', location:'艺术中心 · 音乐教室', start_time:now+3*day, end_time:now+3*day+7200000, signup_start:now-day, signup_end:now+2*day, capacity:40, registered_count:18, signup_count:18, progress:45, status:'signup', created_at:now-day },
]
const pending = { ...activities[0], _id:'review-1', title:'校园星空摄影工作坊', status:'pending', submitter_name:'演示负责人', submitter_id:'demo-leader', created_at: now-3600000 }
const user = { _id:'demo-student', name:'演示同学', nickname:'星球探索者', student_no:'20260001', student_no_masked:'2026****01', college:'信息工程学院', major:'软件工程', auth_status:'verified', status:'normal', avatar:'' }
const admin = { _id:'demo-admin', username:'demo', name:'演示管理员', role:'super', status:'normal' }
const recruitments = [{ _id:'rec-1', club_id:'club-1', club_name:clubs[0].name, club_logo:asset('stars'), title:'天文社 · 秋季干事招新', content:'寻找热爱探索的同学，一起策划观星活动与校园科普。', status:'open', signup_end:now+7*day, capacity:12, signup_count:7, remaining:5, multi_step:true, form_fields:[{key:'department',label:'意向部门',type:'single',required:true,options:['活动策划部','宣传设计部']},{key:'intro',label:'自我介绍',type:'text',required:true}], created_at:now-day }]
let registration = null
const messages = []
const list = (items) => ({ list:items, total:items.length, page:1, page_size:20, has_more:false })
const ok = (data) => ({code:0,message:'ok',data})
const fail = (code,message) => ({code,message,data:null})
function route(p, body, query, auth) {
  if (p === '/demo/reset') { registration=null; messages.length=0; activities[0].registered_count=32; activities[0].signup_count=32; activities[0].progress=64; pending.status='pending'; return ok({reset:true}) }
  if (p === '/health') return ok({mode:'synthetic-local-demo'})
  if (p === '/user/login') return ok({token:'local-demo-student',refresh_token:'local-demo-refresh',user,authStatus:'authenticated'})
  if (p === '/user/profile') return ok(user)
  if (p === '/user/session/refresh') return ok({token:'local-demo-student',user,authStatus:'authenticated'})
  if (p === '/home/index') return ok({banners:[{_id:'banner-1',title:'探索你的校园星球',content:'找社团 · 参与活动 · 开启新学期',banner:asset('stars'),created_at:now}],categories,activities:list(activities),clubs,recruitments})
  if (p === '/club/categories') return ok(list(categories))
  if (p === '/club/list') return ok(list(clubs.filter(c=>(!query.keyword||c.name.includes(query.keyword))&&(!query.category_id||c.category_id===query.category_id))))
  if (p === '/club/detail') { const club=clubs.find(c=>c._id===query.club_id); return club?ok({club,activities:activities.filter(a=>a.club_id===club._id),recruitments:recruitments.filter(r=>r.club_id===club._id)}):fail(404,'社团不存在') }
  if (p === '/club/posts/list') return ok(list([]))
  if (p === '/club/my-clubs' || p === '/club/memberships') return ok(list([{role:'president',can_edit:true,joined_at:now-30*day,club:clubs[0]}]))
  if (p === '/activity/list') return ok(list(activities.filter(a=>(!query.keyword||a.title.includes(query.keyword))&&(!query.status||query.status==='all'||a.status===query.status))))
  if (p === '/activity/detail') { const activity=activities.find(a=>a._id===query.activity_id); return activity?ok({activity,my_registration:registration?.activity_id===activity._id?registration:null}):fail(404,'活动不存在') }
  if (p === '/activity/register') {
    if(auth!=='Bearer local-demo-student') return fail(401,'请先登录演示账号')
    const activity=activities.find(a=>a._id===body.activity_id)
    if(!activity) return fail(404,'活动不存在')
    if(registration) return fail(1002,'请勿重复报名')
    registration={registration_id:'reg-1',activity_id:activity._id,status:'approved',checked_in:false,signup_at:Date.now(),remark:body.remark||'',can_cancel:true,activity}
    activity.registered_count++; activity.signup_count++; activity.progress=Math.round(activity.signup_count/activity.capacity*100)
    messages.unshift({_id:'msg-1',title:'活动报名成功',content:`你已成功报名「${activity.title}」，请准时参加。`,biz_type:'activity',biz_id:activity._id,is_read:false,created_at:Date.now()})
    return ok({status:'approved',registration,promoted:null})
  }
  if (p === '/activity/my-registrations') return ok(list(registration?[registration]:[]))
  if (p === '/recruitment/list') return ok(list(recruitments))
  if (p === '/recruitment/detail') return ok({recruitment:recruitments[0],my_registration:null})
  if (p === '/recruitment/my-status') return ok(list([]))
  if (p === '/message/list') return ok({...list(messages),unread:messages.filter(m=>!m.is_read).length})
  if (p === '/message/unread') return ok({count:messages.filter(m=>!m.is_read).length,unread:messages.filter(m=>!m.is_read).length})
  if (p === '/message/read' || p === '/message/read-all') { messages.forEach(m=>m.is_read=true); return ok({updated:messages.length}) }
  if (p === '/admin/captcha') return ok({captcha_id:'local-demo',image:'data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="44"><rect width="120" height="44" fill="#f5da68"/><text x="15" y="31" font-size="28" font-family="monospace">DEMO</text></svg>').toString('base64')})
  if (p === '/admin/login') return body.username==='demo'&&body.password==='DemoOnly@2026'&&body.captcha_code?.toUpperCase()==='DEMO'?ok({token:'local-demo-admin',expires_in:7200,admin}):fail(1001,'演示账号 demo；密码 DemoOnly@2026；验证码 DEMO')
  if (p === '/admin/session') return auth==='Bearer local-demo-admin'?ok({admin,expires_at:Date.now()+7200000}):fail(401,'请先登录')
  if (p === '/dashboard/summary') return ok({pending:{clubs:0,activities:pending.status==='pending'?1:0,recruitments:0,appeals:0,flagged_posts:0,total:pending.status==='pending'?1:0},overview:{verified_users:128,normal_clubs:8,total_activities:24,open_recruitments:6},flagged_posts:[]})
  if (p === '/activity/review-query') { const items=(!body.status||body.status===pending.status)?[pending]:[]; return ok({...list(items),pending_total:pending.status==='pending'?1:0}) }
  if (p === '/activity/review') {
    if(auth!=='Bearer local-demo-admin') return fail(403,'演示管理员身份必需')
    if(body.activity_id!==pending._id||pending.status!=='pending') return fail(1002,'仅待审活动可审核')
    if(!['approve','reject'].includes(body.action)) return fail(1001,'审核动作无效')
    if(body.action==='reject'&&String(body.reason||'').trim().length<2) return fail(1001,'请填写驳回理由')
    pending.status=body.action==='approve'?'approved':'draft'; pending.review_at=Date.now(); pending.review_by=admin.name
    return ok({activity:pending,notify:{duplicate:false}})
  }
  if (p === '/stats/overview') return ok({users:{total_verified:128,new_verified:24,dau:36,mau:96},clubs:{total:8,active_count:6,active_rate:0.75,category_distribution:[{name:'学术科技',category_name:'学术科技',count:3},{name:'文艺表演',category_name:'文艺表演',count:2},{name:'体育竞技',category_name:'体育竞技',count:2},{name:'公益实践',category_name:'公益实践',count:1}]},activities:{published_count:24,signup_count:186,signin_rate:0.86},recruitments:{count:6,signup_count:42,accepted_count:28}})
  return fail(404,`本地演示未覆盖接口 ${p}；完整后端见 uniCloud 源码`)
}
const allowedOrigins = new Set(['http://127.0.0.1:5173','http://127.0.0.1:5174'])
http.createServer(async(req,res)=>{
  const origin=req.headers.origin
  if(origin&&!allowedOrigins.has(origin)){res.writeHead(403);res.end();return}
  if(origin) res.setHeader('Access-Control-Allow-Origin',origin)
  res.setHeader('Access-Control-Allow-Headers','content-type,authorization')
  res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS')
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}
  const url=new URL(req.url,'http://127.0.0.1:4175')
  if(url.pathname==='/showcase'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(fs.readFileSync(path.join(__dirname,'showcase.html')));return}
  if(/^\/assets\/(stars|music)\.svg$/.test(url.pathname)) {res.setHeader('Content-Type','image/svg+xml');res.end(fs.readFileSync(path.join(__dirname,url.pathname.split('/').pop())));return}
  try{
    let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536)throw new Error('Request too large')}
    const result=route(url.pathname,raw?JSON.parse(raw):{},Object.fromEntries(url.searchParams),req.headers.authorization)
    res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify(result))
  }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify(fail(400,error.message)))}
}).listen(4175,'127.0.0.1',()=>console.log('Synthetic API http://127.0.0.1:4175; all state resets on restart'))
