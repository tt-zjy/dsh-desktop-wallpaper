/**
 * unit.cjs — 客户端半边的单元测试，不依赖浏览器、不依赖任何第三方包。
 *
 * 做法：伪造一个最小 DOM（注册表式 getElementById、可记录的内联样式、假 localStorage /
 * MutationObserver / Image / fetch / 计时器），用 new Function 执行 lib/client.js，
 * 拿到它经 window.__ModuleLoader__.load 注册的 factory，再调用 apply() 观察结果。
 *
 * 四个场景：
 *   1. 默认：桌面协议、无存档        → 建好样式/背景层/面板，参数取默认值
 *   2. 默认：桌面协议、有存档        → 用自定义图 + 存档里的透明度与模糊
 *   3. 默认：网页协议、有存档        → 默认对所有界面生效，所以同样建好
 *   4. 把 DESKTOP_ONLY 改成 true     → 网页协议下什么都不建（桌面限定开关有效）
 *
 * 注意：包名与路由前缀是从 package.json / 源码里读出来的，不写死——
 * 这样 scripts/set-package-name.mjs 改名之后测试依然成立。
 *
 * 用法：node tests/unit.cjs
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const CLIENT_PATH = path.join(ROOT, 'lib', 'client.js')
const SOURCE = fs.readFileSync(CLIENT_PATH, 'utf8')
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

const PKG = MANIFEST.name
const PREFIX_MATCH = /const PREFIX = '([^']+)'/.exec(SOURCE)
const PREFIX = PREFIX_MATCH === null ? '/dsh-desktop-wallpaper' : PREFIX_MATCH[1]
const LAYER_ID = 'dsh-desktop-wallpaper-layer'
const PANEL_ID = 'dsh-desktop-wallpaper-panel'
const BUTTON_ID = 'dsh-desktop-wallpaper-button'
const STORAGE_KEY = 'dsh.desktop-wallpaper.v1'

const STORED = JSON.stringify({
  image: 'data:image/jpeg;base64,ZZZZ',
  imageName: 'my-image.jpg',
  uiAlpha: 0.3,
  blur: 12,
})

let registry = []

function makeNode(tag) {
  const node = {
    tagName: String(tag).toUpperCase(),
    id: '',
    dataset: {},
    children: [],
    listeners: {},
    files: [],
    value: '',
    type: '',
    accept: '',
    title: '',
    textContent: '',
    style: { cssText: '', setProperty: (key, value) => { node.style[key] = value } },
    setAttribute(key, value) { if (key === 'id') node.id = value },
    addEventListener(type, handler) { (node.listeners[type] = node.listeners[type] || []).push(handler) },
    appendChild(child) { node.children.push(child); registry.push(child); return child },
    click() { (node.listeners.click || []).forEach((handler) => handler()) },
    getContext() { return { drawImage() {} } },
    toDataURL() { return 'data:image/jpeg;base64,AAAA' },
  }
  return node
}

/** 用给定协议与存档跑一遍 apply()，返回可断言的观察结果。 */
function run(protocol, store, source) {
  registry = []
  const inlineTokens = {}
  const beacons = []

  const root = makeNode('div')
  root.id = 'root'
  registry.push(root)

  const body = makeNode('body')
  body.hasAttribute = () => false
  body.style = {
    setProperty: (key, value, priority) => { inlineTokens[key] = value + (priority ? ' !' + priority : '') },
  }

  const document = {
    body,
    head: makeNode('head'),
    createElement: (tag) => makeNode(tag),
    getElementById: (id) => registry.find((node) => node.id === id) || null,
    elementFromPoint: () => null,
  }

  const window = {
    location: { protocol },
    innerWidth: 1600,
    innerHeight: 900,
    localStorage: {
      getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
      setItem: (key, value) => { store[key] = value },
    },
    addEventListener: () => {},
    __ModuleLoader__: { load: (definition) => { window.__definition = definition } },
  }

  const saved = {
    setTimeout: globalThis.setTimeout,
    setInterval: globalThis.setInterval,
    Image: globalThis.Image,
    MutationObserver: globalThis.MutationObserver,
  }
  globalThis.setTimeout = () => 0
  globalThis.setInterval = () => 0
  globalThis.MutationObserver = class { observe() {} }
  globalThis.Image = class {
    set src(value) { this._src = value; if (this.onload) this.onload() }
    get naturalWidth() { return 2048 }
    get naturalHeight() { return 1365 }
  }

  try {
    const factory = new Function('window', 'document', 'getComputedStyle', 'fetch', 'MutationObserver', source)
    factory(
      window,
      document,
      () => ({ backgroundColor: 'rgba(0, 0, 0, 0)', getPropertyValue: () => 'rgba(249, 250, 251, 0.15)' }),
      (url) => { beacons.push(url); return Promise.resolve({ json: () => Promise.resolve({ probe: 0 }) }) },
      globalThis.MutationObserver,
    )

    const definition = window.__definition
    if (definition === undefined) throw new Error('the bundle never called window.__ModuleLoader__.load')
    if (definition.id !== PKG) {
      throw new Error('bundle id must equal the package name: got ' + JSON.stringify(definition.id)
        + ', expected ' + JSON.stringify(PKG))
    }

    const mod = definition.factory(() => {
      throw new Error('this plugin must have no runtime dependencies')
    })
    mod.apply()

    const byId = (id) => registry.find((node) => node.id === id) || null
    const layer = byId(LAYER_ID)
    const styleTag = byId(PKG + '-style')
    const applyBeacon = beacons.find((url) => url.indexOf('ev=apply') >= 0) || ''
    const field = (key) => {
      const match = new RegExp('[?&]' + key + '=([^&]*)').exec(applyBeacon)
      return match ? decodeURIComponent(match[1]) : null
    }

    return {
      exportApply: typeof mod.apply,
      styleTag: styleTag === null ? 0 : 1,
      styleHasTokens: styleTag !== null && styleTag.textContent.indexOf('--dsw-alias-bg-base') >= 0 ? 1 : 0,
      inlineTokenCount: Object.keys(inlineTokens).length,
      inlineBase: inlineTokens['--dsw-alias-bg-base'] || null,
      layer: layer === null ? 0 : 1,
      layerImage: layer === null ? null : String(layer.style.backgroundImage),
      layerFilter: layer === null ? null : layer.style.filter,
      panel: byId(PANEL_ID) === null ? 0 : 1,
      button: byId(BUTTON_ID) === null ? 0 : 1,
      report: {
        styleTag: field('styleTag'),
        inlineTokens: field('inlineTokens'),
        layer: field('layer'),
        ui: field('ui'),
        storage: field('storage'),
        custom: field('custom'),
        uiAlpha: field('uiAlpha'),
        blur: field('blur'),
      },
    }
  } finally {
    globalThis.setTimeout = saved.setTimeout
    globalThis.setInterval = saved.setInterval
    globalThis.Image = saved.Image
    globalThis.MutationObserver = saved.MutationObserver
  }
}

const failures = []
let checks = 0

function check(label, condition) {
  checks += 1
  if (!condition) failures.push(label)
}

const desktopOnlySource = SOURCE.replace('const DESKTOP_ONLY = false', 'const DESKTOP_ONLY = true')
if (desktopOnlySource === SOURCE) {
  checks += 1
  failures.push('could not find the DESKTOP_ONLY switch to test scenario 4')
}

// 场景 1：桌面协议、无存档
const a = run('dsh-app:', {}, SOURCE)
check('1 apply is exported', a.exportApply === 'function')
check('1 style tag injected', a.styleTag === 1 && a.styleHasTokens === 1)
check('1 seven inline tokens', a.inlineTokenCount === 7)
check('1 default alpha 0.6 * 0.5 = 0.300', a.inlineBase === 'rgba(249, 250, 251, 0.300) !important')
check('1 background layer created', a.layer === 1)
check('1 layer uses the host route', a.layerImage === 'url("' + PREFIX + '/image")')
check('1 no blur by default', a.layerFilter === 'none')
check('1 panel and button created', a.panel === 1 && a.button === 1)
check('1 report reflects defaults', a.report.styleTag === '1' && a.report.inlineTokens === '7'
  && a.report.layer === '1' && a.report.ui === '1' && a.report.storage === 'ok'
  && a.report.custom === '0' && a.report.uiAlpha === '0.6' && a.report.blur === '0')

// 场景 2：桌面协议、有存档
const b = run('dsh-app:', { [STORAGE_KEY]: STORED }, SOURCE)
check('2 custom image used', b.layerImage === 'url("data:image/jpeg;base64,ZZZZ")')
check('2 blur applied', b.layerFilter === 'blur(12.0px)')
check('2 stored alpha 0.3 * 0.5 = 0.150', b.inlineBase === 'rgba(249, 250, 251, 0.150) !important')
check('2 report reflects stored settings', b.report.custom === '1' && b.report.uiAlpha === '0.3' && b.report.blur === '12')

// 场景 3：网页协议（默认对所有界面生效）
const c = run('http:', { [STORAGE_KEY]: STORED }, SOURCE)
check('3 works on the web surface too', c.styleTag === 1 && c.layer === 1 && c.panel === 1 && c.button === 1)

// 场景 4：把桌面限定开关打开
const d = run('http:', { [STORAGE_KEY]: STORED }, desktopOnlySource)
check('4 desktop-only switch skips non-desktop surfaces',
  d.styleTag === 0 && d.layer === 0 && d.panel === 0 && d.button === 0 && d.inlineTokenCount === 0)

if (failures.length > 0) {
  console.error('FAILED ' + failures.length + '/' + checks)
  for (const failure of failures) console.error('  - ' + failure)
  process.exit(1)
}

console.log('OK: ' + checks + ' assertions passed (package: ' + PKG + ', prefix: ' + PREFIX + ')')
