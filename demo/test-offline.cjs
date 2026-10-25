const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const cwd = path.resolve(__dirname, '../uniapp')
const files = fs.readdirSync(path.join(cwd, 'scripts')).filter(f => /^test-p.*\.js$/.test(f)).sort()
const results = []
for (const file of files) {
  const r = spawnSync(process.execPath, [path.join('scripts', file)], { cwd, encoding: 'utf8', timeout: 60000, windowsHide: true })
  const output = `${r.stdout || ''}\n${r.stderr || ''}`
  results.push({file, passed:r.status===0, summary:output.trim().split('\n').slice(-4).join('\n')})
  console.log(`${r.status===0?'PASS':'FAIL'} ${file}`)
  if(r.status!==0) console.log(output.slice(-2500))
}
fs.mkdirSync(path.resolve(__dirname,'../.recordings'),{recursive:true})
fs.writeFileSync(path.resolve(__dirname,'../.recordings/offline-tests.json'),JSON.stringify(results,null,2))
console.log(`${results.filter(r=>r.passed).length}/${results.length} scripts passed`)
process.exitCode=results.every(r=>r.passed)?0:1
