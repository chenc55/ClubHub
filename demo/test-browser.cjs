/** Dependency-upgrade regression: real local pages, synthetic API only. */
const { chromium } = require('playwright')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const http = require('node:http')
const { spawn } = require('node:child_process')
const XLSX = require('../admin/node_modules/xlsx')
const Jimp = require('../uniapp/node_modules/jimp')
const root = path.resolve(__dirname, '..')
const out = path.join(root, '.recordings')
fs.mkdirSync(out, { recursive: true })
const children = [], checks = [], errors = []
let browser
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
async function ready(url) {
  for (let i=0;i<180;i++) {
    try { if ((await fetch(url)).ok) return } catch {}
    await pause(500)
  }
  throw new Error(`Server did not start: ${url}`)
}
function start(cwd, script, args=[]) {
  const log = fs.openSync(path.join(out, path.basename(cwd)+'-'+path.basename(script)+'.log'), 'w')
  const child = spawn(process.execPath, [script,...args], {cwd,windowsHide:true,stdio:['ignore',log,log],env:{...process.env,VITE_API_BASE:'http://127.0.0.1:4175',VITE_ENABLE_TEST_LOGIN:'true'}})
  fs.closeSync(log)
  child.on('error', error => errors.push(error.message))
  children.push(child)
}
async function check(label, action) {
  let timer
  try { await Promise.race([action(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(`Regression timed out: ${label}`)),60000)})]) }
  finally { clearTimeout(timer) }
  checks.push(label)
  console.log(`PASS ${label}`)
}
function workbook(rows, bookType='xlsx') {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(rows),'演示')
  return XLSX.write(book,{type:'buffer',bookType})
}
async function upload(page, rows, name='demo.xlsx', bookType='xlsx') {
  await page.locator('input[type=file]').setInputFiles({name,mimeType:'application/octet-stream',buffer:workbook(rows,bookType)})
}
;(async()=>{
  await check('patched image decoder and HTTP image-loading compatibility', async()=>{
    const logo=fs.readFileSync(path.join(root,'uniapp/src/static/logo.png'))
    const image=await Jimp.read(logo)
    const jpeg=await image.getBufferAsync(Jimp.MIME_JPEG)
    assert.equal((await Jimp.read(jpeg)).bitmap.width,image.bitmap.width)
    const server=http.createServer((req,res)=>{res.setHeader('Content-Type','image/png');res.end(logo)})
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
    server.unref()
    try { assert.equal((await Jimp.read(`http://127.0.0.1:${server.address().port}/logo.png`)).bitmap.width,image.bitmap.width) }
    finally { await new Promise(resolve=>server.close(resolve)) }
  })
  start(root,path.join(root,'demo/server.cjs'))
  start(path.join(root,'admin'),path.join(root,'admin/node_modules/vite/bin/vite.js'),['--host','127.0.0.1','--port','5174','--strictPort'])
  start(path.join(root,'uniapp'),path.join(root,'uniapp/node_modules/@dcloudio/vite-plugin-uni/bin/uni.js'),['--host','127.0.0.1','--port','5173','--strictPort'])
  await Promise.all([ready('http://127.0.0.1:4175/health'),ready('http://127.0.0.1:5174'),ready('http://127.0.0.1:5173')])
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH})
  const context=await browser.newContext({viewport:{width:1440,height:1000},timezoneId:'Asia/Shanghai'})
  const page=await context.newPage()
  page.on('pageerror', error=>errors.push(error.message))
  const captures=[]
  // These fixtures validate the frontend upload contract without writing cloud data.
  await page.route('**/admin/users/query',route=>route.fulfill({json:{code:0,data:{list:[],total:0},message:'ok'}}))
  await page.route('**/club/query',route=>route.fulfill({json:{code:0,data:{list:[],total:0,pending_total:0},message:'ok'}}))
  for (const endpoint of ['/admin/whitelist/import','/club/import']) {
    await page.route('**'+endpoint,route=>{
      const payload=route.request().postDataJSON()
      captures.push({endpoint,payload})
      return route.fulfill({json:{code:0,message:'ok',data:{success:payload.rows.length,skipped:[],failed:[]}}})
    })
  }
  await check('student login, activity registration and persisted registration view',async()=>{
    await page.goto('http://127.0.0.1:5173/#/pages/subpages/login/index',{waitUntil:'networkidle'})
    await page.getByText('同意并继续',{exact:true}).click()
    await page.getByText('开发测试登录',{exact:true}).click()
    await page.getByText('认证态',{exact:true}).waitFor()
    await page.goto('http://127.0.0.1:5173/#/pages/home/index',{waitUntil:'networkidle'})
    await page.getByText('一起去看星星 · 校园观星夜',{exact:true}).click()
    await page.getByText('去报名',{exact:true}).click()
    await page.locator('textarea').fill('依赖升级交互回归')
    const saved=page.waitForResponse(r=>r.url().endsWith('/activity/register')&&r.request().method()==='POST')
    await page.getByText('提交报名',{exact:true}).click()
    assert.equal((await (await saved).json()).data.status,'approved')
    await page.goto('http://127.0.0.1:5173/#/pages/subpages/my-registrations/index',{waitUntil:'networkidle'})
    await page.getByText('已报名',{exact:true}).waitFor()
  })
  await check('recruitment single-choice and text fields',async()=>{
    await page.goto('http://127.0.0.1:5173/#/pages/subpages/recruitment-register/index?id=rec-1',{waitUntil:'networkidle'})
    await page.getByText('活动策划部',{exact:true}).click()
    await page.locator('input').first().fill('依赖升级回归')
    assert((await page.getByText('活动策划部',{exact:true}).getAttribute('class')).includes('--on'))
  })
  await check('admin login, confirmation and approved-list update',async()=>{
    await page.goto('http://127.0.0.1:5174/',{waitUntil:'networkidle'})
    await page.getByPlaceholder('请输入管理员账号').fill('demo')
    await page.getByPlaceholder('请输入密码').fill('DemoOnly@2026')
    await page.getByPlaceholder('输入右侧字符').fill('DEMO')
    await page.getByRole('button',{name:'登录',exact:true}).click()
    await page.getByRole('heading',{name:'管理工作台'}).waitFor()
    await page.getByRole('button',{name:/待审活动/}).click()
    await page.getByRole('button',{name:'通过',exact:true}).click()
    const saved=page.waitForResponse(r=>r.url().endsWith('/activity/review')&&r.request().method()==='POST')
    await page.getByRole('button',{name:'确认通过',exact:true}).click()
    assert.equal((await (await saved).json()).data.activity.status,'approved')
    await page.locator('select:visible').selectOption('approved')
    await page.getByRole('button',{name:'查询',exact:true}).click()
    await page.getByText('校园星空摄影工作坊',{exact:true}).waitFor()
  })
  await check('xlsx whitelist template download, Chinese headers and duplicate/invalid row filtering',async()=>{
    await page.goto('http://127.0.0.1:5174/#/users',{waitUntil:'networkidle'})
    const downloaded=page.waitForEvent('download')
    await page.getByRole('button',{name:/下载.*模板|模板下载/}).click()
    const template=XLSX.readFile(await (await downloaded).path())
    assert.deepEqual(XLSX.utils.sheet_to_json(template.Sheets[template.SheetNames[0]],{header:1})[0],['学号','姓名','学院','专业'])
    await upload(page,[['学号','姓名','学院','专业'],['20260001','演示甲','信息学院','软件工程'],['20260001','重复','信息学院','软件工程'],['','空学号','',''],['20260002','演示乙','信息学院','软件工程']])
    await page.getByText('待导入 2 行',{exact:true}).waitFor()
    await page.getByText('跳过 1 行',{exact:true}).waitFor()
    await page.getByText('失败 1 行',{exact:true}).waitFor()
    await page.getByRole('button',{name:'3. 开始导入',exact:true}).click()
    await page.getByText('成功 2 行',{exact:true}).waitFor()
    const submitted=captures.find(c=>c.endpoint==='/admin/whitelist/import').payload
    assert.deepEqual(submitted.rows.map(r=>r.student_no),['20260001','20260002'])
    assert.equal(submitted.mode,'append')
    assert.equal(submitted.reset,false)
    await page.screenshot({path:path.join(out,'whitelist-upgraded.png'),fullPage:true})
  })
  await check('xls parsing and missing-header validation',async()=>{
    await upload(page,[['学号','姓名'],['20260003','演示丙']],'demo.xls','biff8')
    await page.getByText('待导入 1 行',{exact:true}).waitFor()
    await upload(page,[['错误表头'],['演示']])
    await page.getByText(/表格缺少必需列/).waitFor()
    assert(await page.getByRole('button',{name:'3. 开始导入',exact:true}).isDisabled())
  })
  await check('whitelist row limit remains enforced',async()=>{
    await upload(page,[['学号','姓名'],...Array.from({length:20001},(_,i)=>[String(20260000+i),'演示'])])
    await page.getByText(/单批最多 20000 行/).waitFor()
    assert(await page.getByRole('button',{name:'3. 开始导入',exact:true}).isDisabled())
  })
  await check('club template, category validation and import payload',async()=>{
    await page.goto('http://127.0.0.1:5174/#/clubs',{waitUntil:'networkidle'})
    await page.getByRole('heading',{name:'社团管理',exact:true}).waitFor()
    const downloaded=page.waitForEvent('download')
    await page.getByRole('button',{name:/下载.*模板|模板下载/}).click()
    const template=XLSX.readFile(await (await downloaded).path())
    assert.deepEqual(XLSX.utils.sheet_to_json(template.Sheets[template.SheetNames[0]],{header:1})[0],['社团名称','简介','分类','联系方式'])
    await upload(page,[['社团名称','简介','分类','联系方式'],['演示天文社','演示','学术科技','站内联系'],['演示天文社','重复','学术科技','站内联系'],['无效分类社团','演示','不存在的分类','']])
    await page.getByText('待导入 1 行',{exact:true}).waitFor()
    await page.getByText('跳过 1 行',{exact:true}).waitFor()
    await page.getByText('失败 1 行',{exact:true}).waitFor()
    await page.getByRole('button',{name:'2. 开始导入',exact:true}).click()
    await page.getByText('成功 1 行',{exact:true}).waitFor()
    assert.equal(captures.find(c=>c.endpoint==='/club/import').payload.rows[0].name,'演示天文社')
  })
  await check('statistics page and time-range controls',async()=>{
    await page.goto('http://127.0.0.1:5174/#/stats',{waitUntil:'networkidle'})
    await page.getByText('128',{exact:true}).waitFor()
    await page.getByRole('button',{name:'近 30 天',exact:true}).click()
    await page.getByText('128',{exact:true}).waitFor()
    await page.screenshot({path:path.join(out,'stats-upgraded.png'),fullPage:true})
  })
  assert.deepEqual(errors,[])
  console.log(`${checks.length} browser/image regressions passed; no page errors`)
})().catch(error=>{console.error(error);errors.push(error.message);process.exitCode=1}).finally(async()=>{
  if(browser) await browser.close()
  for(const child of children) child.kill()
  fs.writeFileSync(path.join(out,'browser-regression.json'),JSON.stringify({checks,errors,mode:'local-synthetic-only'},null,2))
})
