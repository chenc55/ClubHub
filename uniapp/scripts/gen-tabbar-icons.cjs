/**
 * 生成原生 tabBar 图标（10 张：5 图标 × 默认/选中两态）
 * 几何孟菲斯风格：仅用圆 / 菱形 / 圆角矩 / 三角等基础几何形
 * 用法：node scripts/gen-tabbar-icons.cjs
 */
const fs = require('fs')
const path = require('path')
const { PNG } = require('pngjs')

const SIZE = 81 // 输出画布（px，对应小程序 tabBar 图标推荐 81x81）
const SS = 3 // 超采样倍数（抗锯齿）

const COLORS = {
  normal: [100, 116, 139], // #64748B（未选中）
  active: [47, 128, 237], // #2F80ED（选中，品牌主色）
}

const C = SIZE / 2 // 画布中心

/* ---------- 基础几何（坐标系 [0, SIZE)） ---------- */
function circle(x, y, cx, cy, r) {
  const dx = x - cx
  const dy = y - cy
  return dx * dx + dy * dy <= r * r
}

function diamond(x, y, cx, cy, r) {
  return Math.abs(x - cx) + Math.abs(y - cy) <= r
}

function roundedRect(x, y, cx, cy, hw, hh, r) {
  const dx = Math.abs(x - cx)
  const dy = Math.abs(y - cy)
  const ox = hw - r
  const oy = hh - r
  if (dx <= ox || dy <= oy) return true
  const px = dx - ox
  const py = dy - oy
  return px * px + py * py <= r * r
}

function inTriangle(px, py, a, b, c) {
  const sign = (p1, p2) => (px - p2[0]) * (p1[1] - p2[1]) - (p1[0] - p2[0]) * (py - p2[1])
  const d1 = sign(a, b)
  const d2 = sign(b, c)
  const d3 = sign(c, a)
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0
  return !(hasNeg && hasPos)
}

/* ---------- 图标形状（布尔组合） ---------- */
const shapes = {
  // 首页：菱形
  home: (x, y) => diamond(x, y, C, C, 26),
  // 活动：孟菲斯实心波点
  activity: (x, y) => circle(x, y, C, C, 24),
  // 社团：三圆（一人两翼）
  club: (x, y) =>
    circle(x, y, C, 26, 12.5) || circle(x, y, 27, 52, 12.5) || circle(x, y, 54, 52, 12.5),
  // 消息：圆角对话气泡 + 左下三角尾巴
  message: (x, y) =>
    roundedRect(x, y, C + 1.5, 41, 24, 15, 9) || inTriangle(x, y, [24, 52], [10, 70], [37, 58]),
  // 我的：圆环（人形抽象）
  profile: (x, y) => circle(x, y, C, C, 23) && !circle(x, y, C, C, 12),
}

/* ---------- 渲染 ---------- */
function render(shape, [r, g, b]) {
  const png = new PNG({ width: SIZE, height: SIZE })
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let hits = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          if (shape(x + (sx + 0.5) / SS, y + (sy + 0.5) / SS)) hits++
        }
      }
      const alpha = Math.round((hits / (SS * SS)) * 255)
      const idx = (SIZE * y + x) << 2
      png.data[idx] = r
      png.data[idx + 1] = g
      png.data[idx + 2] = b
      png.data[idx + 3] = alpha
    }
  }
  return PNG.sync.write(png)
}

const outDir = path.join(__dirname, '..', 'src', 'static', 'tabbar')
fs.mkdirSync(outDir, { recursive: true })

Object.keys(shapes).forEach((name) => {
  fs.writeFileSync(path.join(outDir, `${name}.png`), render(shapes[name], COLORS.normal))
  fs.writeFileSync(path.join(outDir, `${name}-active.png`), render(shapes[name], COLORS.active))
  console.log(`generated: ${name}.png / ${name}-active.png`)
})

console.log('done ->', outDir)