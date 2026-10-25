// Behavioral regressions for fail-closed authentication. No external calls are made.
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
const cwd = path.resolve(__dirname, '..')
function isolated(label, code) {
  const result = spawnSync(process.execPath, ['-e', code], {cwd, encoding:'utf8', windowsHide:true})
  assert.equal(result.status, 0, `${label}\n${result.stdout}\n${result.stderr}`)
  console.log(`PASS ${label}`)
}
isolated('missing JWT configuration cannot sign or verify, including offline runtime', `
  const assert=require('node:assert/strict');
  delete process.env.CLUBHUB_JWT_SECRET;
  const club=require('./uniapp/uniCloud-aliyun/cloudfunctions/common/club-common');
  assert.throws(()=>club.signToken({type:'admin',role:'super'}),/required/);
  process.env.CLUBHUB_JWT_SECRET='clubhub-security-test-fixture-only';
  const token=club.signToken({type:'admin',role:'super'});
  delete process.env.CLUBHUB_JWT_SECRET;
  assert.equal(club.verifyToken(token),null);
`)
isolated('legacy test identity mapping cannot bypass WeChat verification', `
  const assert=require('node:assert/strict');
  process.env.CLUBHUB_JWT_SECRET='clubhub-security-test-fixture-only';
  process.env.WX_APPID='test-fixture-only'; process.env.WX_SECRET='test-fixture-only';
  process.env.TEST_CODE2OPENID='fake-code:fake-admin-openid';
  let calls=0;
  global.uniCloud={httpclient:{request:async()=>{calls++;return {data:{errcode:40029}}}}};
  const user=require('./uniapp/uniCloud-aliyun/cloudfunctions/user');
  user.main({httpMethod:'POST',path:'/login',headers:{},body:JSON.stringify({code:'fake-code',platform:'mp-weixin'})})
    .then(result=>{const body=JSON.parse(result.body);assert.equal(calls,1);assert.notEqual(body.code,0);assert.ok(!body.data?.token)})
    .catch(error=>{console.error(error);process.exitCode=1});
`)
