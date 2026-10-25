/**
 * 同步公共模块源码到各云函数（P0-05 起）
 *
 * 背景：uniCloud 阿里云版不支持「云端安装依赖」，且 HBuilderX CLI 上传不会打包 node_modules；
 * 因此 `common/<模块名>/index.js` 作为唯一源码，上传前复制为各云函数内的本地文件 `lib/<模块名>.js`，
 * 云函数通过 require('./lib/<模块名>') 引用。
 *
 * 覆盖模块：common/ 下所有含 index.js 的目录（当前为 club-common、sensitive-filter）。
 * 用法：node scripts/sync-common.js（修改任一公共模块后、上传云函数前执行）
 */
'use strict'
const fs = require('fs')
const path = require('path')

const CF_ROOT = path.join(__dirname, '..', 'uniCloud-aliyun', 'cloudfunctions')
const COMMON_ROOT = path.join(CF_ROOT, 'common')
const FUNCTIONS = ['user', 'club', 'activity', 'recruitment', 'message', 'admin', 'home', 'search', 'sensitive_words', 'moderation', 'dashboard', 'announcement', 'stats']

const modules = fs
  .readdirSync(COMMON_ROOT)
  .filter((name) => fs.existsSync(path.join(COMMON_ROOT, name, 'index.js')))

if (!modules.length) {
  console.error('未找到任何公共模块：' + COMMON_ROOT)
  process.exit(1)
}

FUNCTIONS.forEach((fn) => {
  modules.forEach((mod) => {
    const source = fs.readFileSync(path.join(COMMON_ROOT, mod, 'index.js'), 'utf8')
    const dest = path.join(CF_ROOT, fn, 'lib', `${mod}.js`)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, source, 'utf8')
    console.log(`synced -> ${fn}/lib/${mod}.js`)
  })
})

console.log(`done. ${modules.length} 个公共模块（${modules.join('、')}）已同步至 ${FUNCTIONS.length} 个云函数`)
