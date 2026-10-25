/**
 * 文件上传公共能力（P0-07 / COM-03）
 *
 * 规格来源：《功能需求.md》2.6 文件上传规格（UPLOAD_SCENES 为其代码化，云端 user/index.js 有同构副本）
 * 流程：选图 → 规格校验（张数/大小/格式，超限前端拦截、不落库）→ 本地压缩（长边 ≤2000px）
 *       → 读为 base64 → POST /user/upload（JSON）→ 云函数写入 uniCloud 云存储 → 返回可访问 URL
 *
 * 通道说明：阿里云 URL 化网关（Spring）会自行消费 multipart/form-data 且不透传原始 body，
 * 故不使用 uni.uploadFile，改用 JSON + base64（body 上限实测约 1.43MB）。
 *
 * 已知偏差：受上述上限与 base64 33% 膨胀影响，压缩后单张原图上限 950KB，
 * 因此「动态配图」的 GIF（无法本地压缩）上限为 950KB 而非 2.6 的 5MB；静态图压缩后不受影响。
 */
import { APP_CONFIG } from './config'
import { getToken } from './session'

/** 压缩后长边上限（2.6 要求） */
export const MAX_SIDE = 2000

/** 压缩后单张体积上限：网关 JSON body 约 1.43MB，base64 膨胀 33%，取 950KB 原图 */
const TRANSPORT_MAX_BYTES = 950 * 1024

/** 上传超时（ms） */
const UPLOAD_TIMEOUT = 60000

const MIME_MAP = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp' }

/**
 * 上传场景规格
 * count       单次可选张数上限（2.6）
 * maxMB       原图上限（2.6）
 * gifMaxMB    动图专项上限（仅允许 gif 的场景使用，见文件头偏差说明）
 * accept      允许的扩展名
 */
export const UPLOAD_SCENES = {
  moments: { label: '动态配图', count: 9, maxMB: 5, gifMaxMB: 0.93, accept: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
  activity_cover: { label: '活动/招新封面', count: 1, maxMB: 5, accept: ['jpg', 'jpeg', 'png', 'webp'] },
  club_logo: { label: '社团 Logo', count: 1, maxMB: 2, accept: ['jpg', 'jpeg', 'png'] },
  club_cover: { label: '社团封面', count: 1, maxMB: 5, accept: ['jpg', 'jpeg', 'png', 'webp'] },
  announcement_banner: { label: '公告 Banner', count: 1, maxMB: 5, accept: ['jpg', 'jpeg', 'png', 'webp'] },
  appeal_proof: { label: '申诉证明', count: 3, maxMB: 5, accept: ['jpg', 'jpeg', 'png'] },
}

/** 取扩展名（小写，不含点） */
export function extOf(pathOrName) {
  const name = String(pathOrName || '').split('?')[0]
  const dot = name.lastIndexOf('.')
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase()
}

/** 由 chooseImage 返回的文件项提取元信息（小程序只有 path/size，H5 还有 name/type） */
function fileMeta(file) {
  const raw = file || {}
  const path = raw.path || raw.tempFilePath || ''
  return {
    path,
    size: Number(raw.size || 0),
    ext: extOf(raw.name || path),
  }
}

function mb(bytes) {
  return (bytes / 1024 / 1024).toFixed(2)
}

function base64Bytes(base64) {
  const len = String(base64 || '').length
  return Math.floor((len * 3) / 4)
}

/**
 * 校验单个文件
 * @returns {string|null} 通过返回 null，否则返回提示文案
 */
export function validateFile(sceneKey, file) {
  const scene = UPLOAD_SCENES[sceneKey]
  if (!scene) return '上传场景不合法'
  const { ext, size } = fileMeta(file)

  if (!ext || scene.accept.indexOf(ext) === -1) {
    return `${scene.label}仅支持 ${scene.accept.join(' / ')} 格式`
  }
  const limitMB = ext === 'gif' && scene.gifMaxMB ? scene.gifMaxMB : scene.maxMB
  if (size > limitMB * 1024 * 1024) {
    return `${scene.label}单张不能超过 ${limitMB}MB（当前 ${mb(size)}MB）`
  }
  return null
}

/**
 * 校验本次选图（张数 + 逐文件）
 * @param {string} sceneKey 场景
 * @param {Array} files chooseImage 的 tempFiles
 * @param {number} existingCount 已选数量（多图追加时传入）
 * @returns {{ok:boolean, message:string}}
 */
export function validatePick(sceneKey, files, existingCount = 0) {
  const scene = UPLOAD_SCENES[sceneKey]
  if (!scene) return { ok: false, message: '上传场景不合法' }
  const list = files || []
  if (!list.length) return { ok: false, message: '未选择任何图片' }
  if (existingCount + list.length > scene.count) {
    return { ok: false, message: `${scene.label}最多选择 ${scene.count} 张（已选 ${existingCount} 张）` }
  }
  for (const file of list) {
    const error = validateFile(sceneKey, file)
    if (error) return { ok: false, message: error }
  }
  return { ok: true, message: '' }
}

/* ============================================================
 * 本地压缩 + 读取 base64
 * - H5：canvas 缩放 + 逐级降质，直接产出 jpeg base64
 * - 小程序 / App：uni.compressImage 缩放降质 → FileSystemManager 读取 base64
 * - GIF 动图不压缩（压缩会丢帧）
 * ============================================================ */

/** 读取图片宽高 */
function imageInfo(src) {
  return new Promise((resolve, reject) => {
    uni.getImageInfo({ src, success: resolve, fail: reject })
  })
}

/** 按长边上限计算目标尺寸（不放大） */
function fitSize(width, height) {
  const side = Math.max(width, height)
  if (side <= MAX_SIDE) return { width, height }
  const scale = MAX_SIDE / side
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** 读取本地文件为 base64（小程序 / App） */
function readBase64(filePath) {
  return new Promise((resolve, reject) => {
    const fs = typeof uni.getFileSystemManager === 'function' ? uni.getFileSystemManager() : null
    if (!fs) {
      reject(new Error('当前环境不支持读取本地文件'))
      return
    }
    fs.readFile({
      filePath,
      encoding: 'base64',
      success: (res) => resolve(res.data),
      fail: () => reject(new Error('图片读取失败')),
    })
  })
}

// #ifdef H5
/** H5：canvas 缩放 + 逐级降质，返回 jpeg base64 */
function compressByCanvas(src, width, height) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      canvas.getContext('2d').drawImage(image, 0, 0, width, height)
      const qualities = [0.85, 0.7, 0.55, 0.4]
      let dataUrl = ''
      for (let i = 0; i < qualities.length; i += 1) {
        dataUrl = canvas.toDataURL('image/jpeg', qualities[i])
        if (base64Bytes(String(dataUrl).split(',')[1]) <= TRANSPORT_MAX_BYTES) break
      }
      const base64 = String(dataUrl).split(',')[1] || ''
      if (!base64) {
        reject(new Error('图片压缩失败'))
        return
      }
      resolve(base64)
    }
    image.onerror = () => reject(new Error('图片读取失败'))
    image.src = src
  })
}
// #endif

/** 小程序 / App：压缩一次（指定质量），失败时回退原图 */
async function compressOnce(src, size, quality) {
  // 尺寸已达标则仅做质量压缩，避免无谓的重绘
  if (size.scaled) {
    const res = await new Promise((resolve, reject) => {
      uni.compressImage({ src, quality, success: resolve, fail: reject })
    })
    return res.tempFilePath || src
  }
  const res = await new Promise((resolve, reject) => {
    uni.compressImage({
      src,
      quality,
      compressedWidth: size.width,
      compressedHeight: size.height,
      success: resolve,
      fail: reject,
    })
  })
  return res.tempFilePath || src
}

/**
 * 压缩并产出 base64
 * @param {string} src 本地临时路径
 * @param {string} ext 原始扩展名
 * @returns {Promise<{base64:string, ext:string}>} ext 为压缩后实际格式（H5 统一输出 jpeg）
 */
export async function compressToBase64(src, ext) {
  if (ext === 'gif') {
    // 动图不压缩，直接读取
    // #ifdef H5
    const base64 = await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open('GET', src, true)
      xhr.responseType = 'blob'
      xhr.onload = () => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
        reader.onerror = () => reject(new Error('图片读取失败'))
        reader.readAsDataURL(xhr.response)
      }
      xhr.onerror = () => reject(new Error('图片读取失败'))
      xhr.send()
    })
    return { base64, ext: 'gif' }
    // #endif
    // #ifndef H5
    const nativeBase64 = await readBase64(src)
    return { base64: nativeBase64, ext: 'gif' }
    // #endif
  }

  const info = await imageInfo(src)
  const target = fitSize(info.width, info.height)

  // #ifdef H5
  return { base64: await compressByCanvas(src, target.width, target.height), ext: 'jpg' }
  // #endif

  // #ifndef H5
  const scaled = target.width !== info.width || target.height !== info.height
  const size = { width: target.width, height: target.height, scaled }
  const retryQualities = [80, 55]
  let smallest = null
  for (let i = 0; i < retryQualities.length; i += 1) {
    let path = src
    try {
      path = await compressOnce(src, size, retryQualities[i])
    } catch (e) {
      path = src
    }
    const base64 = await readBase64(path)
    if (!smallest || base64Bytes(base64) < base64Bytes(smallest)) smallest = base64
    if (base64Bytes(smallest) <= TRANSPORT_MAX_BYTES) break
  }
  return { base64: smallest, ext: ext === 'jpeg' ? 'jpg' : ext }
  // #endif
}

/* ============================================================
 * 上传（JSON + base64 → 云函数 → uniCloud 云存储）
 * ============================================================ */

/**
 * 上传单张图片（内部先压缩、再读 base64）
 * @returns {Promise<{code:number,data:any,message:string}>} 成功时 data 含 { url, fileID, size, ext, scene }
 */
export async function uploadImage(sceneKey, filePath, ext) {
  // mock / 未配置后端时，回传本地路径，便于离线联调
  if (APP_CONFIG.USE_MOCK || !APP_CONFIG.API_BASE) {
    return {
      code: 0,
      data: { url: filePath, fileID: '', size: 0, ext: ext || extOf(filePath), scene: sceneKey, mock: true },
      message: 'ok',
    }
  }

  let prepared
  try {
    prepared = await compressToBase64(filePath, ext || extOf(filePath))
  } catch (e) {
    return { code: -1, data: null, message: (e && e.message) || '图片压缩失败' }
  }
  if (!prepared.base64) return { code: -1, data: null, message: '图片读取失败，请重新选择' }
  if (base64Bytes(prepared.base64) > TRANSPORT_MAX_BYTES) {
    return { code: 1001, data: null, message: '图片体积过大，请压缩后重试' }
  }

  const token = getToken()
  const header = { 'content-type': 'application/json' }
  if (token) header.Authorization = `Bearer ${token}`

  return new Promise((resolve) => {
    uni.request({
      url: `${APP_CONFIG.API_BASE}/user/upload`,
      method: 'POST',
      timeout: UPLOAD_TIMEOUT,
      header,
      data: {
        scene: sceneKey,
        filename: `image.${prepared.ext}`,
        mime: MIME_MAP[prepared.ext] || 'application/octet-stream',
        base64: prepared.base64,
      },
      success: (res) => {
        const body = res.data || {}
        if (typeof body.code === 'number') {
          resolve({ code: body.code, data: body.data || null, message: body.message || '' })
          return
        }
        resolve({ code: -1, data: null, message: '上传响应格式异常' })
      },
      fail: (err) => resolve({ code: -1, data: null, message: (err && err.errMsg) || '上传失败，请稍后重试' }),
    })
  })
}

/**
 * 批量上传（顺序上传，便于按单张反馈失败原因）
 * @param {string} sceneKey 场景
 * @param {Array} files chooseImage 的 tempFiles
 * @param {Function} [onProgress] (done, total) => void
 * @returns {Promise<{ok:boolean, urls:string[], message:string}>}
 */
export async function uploadFiles(sceneKey, files, onProgress) {
  const list = files || []
  const urls = []
  for (let i = 0; i < list.length; i += 1) {
    const { path, ext } = fileMeta(list[i])
    const res = await uploadImage(sceneKey, path, ext)
    if (res.code !== 0 || !res.data) {
      return { ok: false, urls, message: res.message || '上传失败，请稍后重试' }
    }
    urls.push(res.data.url)
    if (typeof onProgress === 'function') onProgress(i + 1, list.length)
  }
  return { ok: true, urls, message: '' }
}
