/**
 * dsh-desktop-wallpaper — 宿主半边（host half）。
 *
 * 职责很小：用几条普通 HTTP 路由把背景图和自检数据交给客户端半边。
 *
 * 为什么需要宿主半边：桌面外壳的窗口文档来自打包好的静态资源，宿主 web 服务的
 * index 注入（webServer.tapIndex）到不了窗口；但窗口里所有非静态路径都会被外壳
 * 带上 cookie 转发回宿主。所以图片必须由一条普通路由提供。
 *
 * 路由（前缀 PREFIX）：
 *   /image   背景图：优先用 config.imagePath（用户自己的文件），否则用随包内置的默认图
 *   /mark    客户端半边回打的运行标记（自检用）
 *   /status  读取标记列表与探针计数（JSON）
 *   /request 让探针计数 +1；客户端半边下一次轮询就会回打一份现场快照
 *
 * 本包不依赖任何 import 期解析的 dsh 包：只用 ctx 提供的 webServer / fs 服务，
 * 因此安装时不需要额外的同伴依赖，只有 package.json 里的 peerDependencies 声明
 * 供 dsh 的兼容性策略做版本判定。
 */
import { fileURLToPath } from 'node:url'

const PREFIX = '/dsh-desktop-wallpaper'
const ROUTE = PREFIX + '/image'

/**
 * 随包内置的默认背景图，按顺序尝试（jpg → png → svg）。
 * 想换默认图，放一张同名文件即可；三个都没有时路由返回 404，
 * 界面会保持原样而不会报错。
 */
const BUNDLED_IMAGES = [
  fileURLToPath(new URL('../assets/default.jpg', import.meta.url)),
  fileURLToPath(new URL('../assets/default.png', import.meta.url)),
  fileURLToPath(new URL('../assets/default.svg', import.meta.url)),
]

const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
}

/** 客户端半边每次运行都会往这里留一条记录。 */
const MARKS = []

/** 实时探针计数：外部调一次 /request 就 +1。 */
let PROBE = 0

function json(res, status, value) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(value))
}

export const name = 'dsh-desktop-wallpaper'

export function apply(ctx, config = {}) {
  const webServer = ctx.get('webServer')
  const fs = ctx.get('fs')
  if (webServer === undefined || fs === undefined) return

  const configured = typeof config.imagePath === 'string' && config.imagePath.trim() !== ''
    ? config.imagePath.trim()
    : null
  const candidates = configured === null ? [...BUNDLED_IMAGES] : [configured, ...BUNDLED_IMAGES]

  /** 依次尝试每个候选路径，返回第一个真实存在的文件内容。 */
  async function readImage() {
    for (const candidate of candidates) {
      try {
        const file = await fs.resolve(candidate)
        const info = await fs.stat(file)
        if (info === undefined || info.type !== 'file') continue
        const bytes = await fs.readBytes(file, undefined, 50 * 1024 * 1024)
        const dot = candidate.lastIndexOf('.')
        const ext = dot === -1 ? '' : candidate.slice(dot).toLowerCase()
        return { bytes, type: MIME[ext] ?? 'application/octet-stream', source: candidate }
      } catch {
        // 该候选不可用，试下一个。
      }
    }
    return null
  }

  // 背景图：每次请求实时读盘，换图后刷新即可，无需重启。
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: async (req, res) => {
      const image = await readImage()
      if (image === null) {
        res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('wallpaper image not found')
        return
      }
      res.writeHead(200, {
        'content-type': image.type,
        'cache-control': 'no-store',
      })
      res.end(image.bytes)
    },
  }), 'desktop-wallpaper: image route')

  // 自检：客户端半边回打的所有字段原样留存，便于事后定位。
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: PREFIX + '/mark',
    handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const fields = {}
      for (const [key, value] of url.searchParams.entries()) fields[key] = value
      MARKS.push({ at: new Date().toISOString(), ...fields })
      if (MARKS.length > 100) MARKS.splice(0, MARKS.length - 100)
      json(res, 200, { ok: true, count: MARKS.length })
    },
  }), 'desktop-wallpaper: mark route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: PREFIX + '/request',
    handler: async (req, res) => {
      PROBE += 1
      json(res, 200, { probe: PROBE })
    },
  }), 'desktop-wallpaper: probe request route')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: PREFIX + '/status',
    handler: async (req, res) => {
      const image = await readImage()
      json(res, 200, {
        configured,
        candidates,
        serving: image === null ? null : image.source,
        probe: PROBE,
        marks: MARKS,
      })
    },
  }), 'desktop-wallpaper: status route')
}

export const route = ROUTE
