/**
 * 桌面壁纸插件（客户端半边）— 高级版。
 *
 * 功能：手动换图（选择或拖拽）、界面不透明度、背景模糊，全部实时预览；
 * 设置存在窗口自身的 localStorage，重启应用后自动恢复。
 *
 * 结构（为什么这样做）：
 *   - 背景画在独立的固定层 #dsh-desktop-wallpaper-layer 上，而不是 #root：
 *     这样模糊只作用于背景，不会把整个界面一起糊掉。
 *   - 界面不透明度靠覆盖 --dsw-alias-* 主题 token 实现，并用两条路径下发：
 *       (1) 注入 <style>（与主题样式同优先级，兜底）
 *       (2) 内联 !important 写到 body 上（内联 + important 必然胜过样式表，与顺序无关）
 *     这是实测结论：只靠样式表会输给主题自己的样式。
 *   - 用户选的图存成 data URL 放在 localStorage，因此宿主半边不需要写盘。
 *
 * 维护约定：所有"随 DSH 版本可能变"的东西都集中在 TOKEN_SPEC 与诊断行；
 * 任何一步失败都只降级，不抛错、不影响界面。
 */
window.__ModuleLoader__.load({
  id: 'dsh-desktop-wallpaper',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const PKG = 'dsh-desktop-wallpaper'
    const PREFIX = '/dsh-desktop-wallpaper'
    const DEFAULT_IMAGE = PREFIX + '/image'
    const STORAGE_KEY = 'dsh.desktop-wallpaper.v1'
    const LAYER_ID = 'dsh-desktop-wallpaper-layer'
    const PANEL_ID = 'dsh-desktop-wallpaper-panel'
    const BUTTON_ID = 'dsh-desktop-wallpaper-button'
    const REVISION = '1.0.0'

    /**
     * true  = 只在桌面外壳（dsh-app: 协议）里生效
     * false = 所有界面都生效，包括 dsh web —— 对外发布用这个默认值
     */
    const DESKTOP_ONLY = false

    const DEFAULTS = { image: null, imageName: '', uiAlpha: 0.6, blur: 0 }

    /**
     * 主题 token 规格（唯一源：样式表与内联覆盖都由它派生）。
     * factor/offset 决定各层不透明度随"界面不透明度"滑块如何变化。
     */
    const TOKEN_SPEC = [
      { token: '--dsw-alias-bg-base', light: '249, 250, 251', dark: '9, 12, 20', factor: 0.5, offset: 0 },
      { token: '--dsw-alias-bg-layer-1', light: '255, 255, 255', dark: '24, 28, 38', factor: 1, offset: 0 },
      { token: '--dsw-alias-bg-layer-2', light: '243, 244, 246', dark: '17, 20, 28', factor: 1, offset: 0.08 },
      { token: '--dsw-alias-bg-layer-3', light: '243, 244, 246', dark: '17, 20, 28', factor: 1, offset: 0.14 },
      { token: '--dsw-alias-bg-layer-4', light: '249, 250, 251', dark: '9, 12, 20', factor: 1, offset: 0.2 },
      { token: '--dsw-specific-sidebar-fill', light: '241, 243, 246', dark: '13, 16, 24', factor: 0.85, offset: 0 },
      { token: '--dsw-alias-bg-module-platform', light: '255, 255, 255', dark: '24, 28, 38', factor: 1, offset: 0 },
    ]

    const MAX_EDGE = 2560
    const JPEG_QUALITY = 0.85

    let settings = { image: null, imageName: '', uiAlpha: DEFAULTS.uiAlpha, blur: DEFAULTS.blur }
    let storageState = 'unknown'
    let diagNode = null
    let warnNode = null
    let alphaLabel = null
    let blurLabel = null
    let nameLabel = null
    let diagVisible = false

    // ---------------------------------------------------------------- 设置

    function clamp(value, min, max, fallback) {
      const n = Number(value)
      if (!Number.isFinite(n)) return fallback
      return Math.min(max, Math.max(min, n))
    }

    function sanitize(raw) {
      const value = raw && typeof raw === 'object' ? raw : {}
      return {
        image: typeof value.image === 'string' && value.image.indexOf('data:') === 0 ? value.image : null,
        imageName: typeof value.imageName === 'string' ? value.imageName.slice(0, 120) : '',
        uiAlpha: clamp(value.uiAlpha, 0, 1, DEFAULTS.uiAlpha),
        blur: clamp(value.blur, 0, 60, DEFAULTS.blur),
      }
    }

    function loadSettings() {
      try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        settings = raw === null ? { ...DEFAULTS } : sanitize(JSON.parse(raw))
        storageState = 'ok'
      } catch {
        settings = { ...DEFAULTS }
        storageState = 'unavailable'
      }
    }

    function saveSettings() {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
        storageState = 'ok'
      } catch {
        storageState = 'quota-or-blocked'
      }
      refreshDiagnostics()
    }

    // ---------------------------------------------------------------- 上报

    function report(event, fields) {
      try {
        if (typeof fetch !== 'function') return
        let url = PREFIX + '/mark?ev=' + encodeURIComponent(event) + '&rev=' + encodeURIComponent(REVISION)
        const keys = Object.keys(fields)
        for (let i = 0; i < keys.length; i += 1) {
          url += '&' + keys[i] + '=' + encodeURIComponent(String(fields[keys[i]]))
        }
        fetch(url, { cache: 'no-store' }).catch(() => {})
      } catch {
        // 上报失败不影响功能
      }
    }

    function isDark() {
      try {
        return document.body.hasAttribute('data-ds-dark-theme')
      } catch {
        return false
      }
    }

    // ------------------------------------------------------------ 主题 token

    function alphaOf(spec) {
      return Math.min(1, Math.max(0, settings.uiAlpha * spec.factor + spec.offset))
    }

    function valueOf(spec, dark) {
      return 'rgba(' + (dark ? spec.dark : spec.light) + ', ' + alphaOf(spec).toFixed(3) + ')'
    }

    function tokenCss() {
      const rows = ['body {']
      for (let i = 0; i < TOKEN_SPEC.length; i += 1) {
        rows.push('  ' + TOKEN_SPEC[i].token + ': ' + valueOf(TOKEN_SPEC[i], false) + ';')
      }
      rows.push('}', 'body[data-ds-dark-theme] {')
      for (let i = 0; i < TOKEN_SPEC.length; i += 1) {
        rows.push('  ' + TOKEN_SPEC[i].token + ': ' + valueOf(TOKEN_SPEC[i], true) + ';')
      }
      rows.push('}')
      return rows.join('\n')
    }

    function ensureStyleTag() {
      try {
        let tag = document.getElementById(PKG + '-style')
        if (tag === null) {
          tag = document.createElement('style')
          tag.id = PKG + '-style'
          tag.dataset.plugin = PKG
          document.head.appendChild(tag)
        }
        tag.textContent = tokenCss()
        return 1
      } catch {
        return 0
      }
    }

    /** 内联 !important 覆盖：与样式表顺序无关，必然生效。 */
    function applyInlineTokens() {
      let count = 0
      try {
        const style = document.body.style
        const dark = isDark()
        for (let i = 0; i < TOKEN_SPEC.length; i += 1) {
          style.setProperty(TOKEN_SPEC[i].token, valueOf(TOKEN_SPEC[i], dark), 'important')
          count += 1
        }
      } catch {
        // 忽略
      }
      return count
    }

    // -------------------------------------------------------------- 背景层

    function ensureLayer() {
      try {
        let layer = document.getElementById(LAYER_ID)
        if (layer === null) {
          layer = document.createElement('div')
          layer.id = LAYER_ID
          layer.setAttribute('aria-hidden', 'true')
          document.body.appendChild(layer)
        }
        return layer
      } catch {
        return null
      }
    }

    function applyBackground() {
      const layer = ensureLayer()
      if (layer === null) return 0
      // 模糊会让边缘变透明，所以把层放大一点（溢出量随模糊半径增长）。
      const overhang = Math.round(settings.blur * 1.5 + 12)
      const style = layer.style
      style.position = 'fixed'
      style.left = -overhang + 'px'
      style.top = -overhang + 'px'
      style.right = -overhang + 'px'
      style.bottom = -overhang + 'px'
      style.zIndex = '-1'
      style.pointerEvents = 'none'
      style.backgroundPosition = 'center'
      style.backgroundRepeat = 'no-repeat'
      style.backgroundSize = 'cover'
      style.backgroundColor = 'transparent'
      style.backgroundImage = 'url("' + (settings.image === null ? DEFAULT_IMAGE : settings.image) + '")'
      style.filter = settings.blur > 0 ? 'blur(' + settings.blur.toFixed(1) + 'px)' : 'none'
      return 1
    }

    // ------------------------------------------------------------ 控制面板

    function el(tag, style, text) {
      const node = document.createElement(tag)
      if (style) node.style.cssText = style
      if (text !== undefined) node.textContent = text
      return node
    }

    const PANEL_CSS = [
      'position: fixed', 'right: 16px', 'bottom: 16px', 'z-index: 2147483000',
      'width: 272px', 'padding: 12px 14px', 'border-radius: 12px',
      'font: 12px/1.6 system-ui, "Segoe UI", sans-serif',
      'color: #1f2328', 'background: rgba(255,255,255,0.95)',
      'border: 1px solid rgba(0,0,0,0.12)', 'box-shadow: 0 8px 28px rgba(0,0,0,0.22)',
      'display: none',
    ].join(';')

    const BUTTON_CSS = [
      'position: fixed', 'right: 16px', 'bottom: 16px', 'z-index: 2147483000',
      'width: 34px', 'height: 34px', 'border-radius: 50%', 'cursor: pointer',
      'border: 1px solid rgba(0,0,0,0.12)', 'background: rgba(255,255,255,0.9)',
      'box-shadow: 0 4px 14px rgba(0,0,0,0.18)', 'font-size: 15px', 'line-height: 1',
      'display: flex', 'align-items: center', 'justify-content: center', 'padding: 0',
      'opacity: 0.72',
    ].join(';')

    /** 从 rgb()/rgba() 字面量里取 alpha；取不到（例如主题原来的不透明色）返回 null。 */
    function alphaFrom(css) {
      const match = /,\s*([0-9.]+)\s*\)\s*$/.exec(String(css).trim())
      if (match === null) return null
      const value = Number(match[1])
      return Number.isFinite(value) ? value : null
    }

    /**
     * 健康自检：返回失效项清单。只有非空时才在面板上露出提示，
     * 这样平时界面干净，DSH 升级导致某环失效时又能立刻看见。
     */
    function health() {
      const issues = []
      const layer = document.getElementById(LAYER_ID)
      if (storageState !== 'ok') issues.push('设置无法保存')
      if (document.getElementById('root') === null) issues.push('找不到 #root')
      if (layer === null) issues.push('背景层未建立')
      else if (String(layer.style.backgroundImage).indexOf('url(') !== 0) issues.push('背景图未设置')
      if (document.getElementById(PKG + '-style') === null) issues.push('样式未注入')
      try {
        const actual = alphaFrom(getComputedStyle(document.body).getPropertyValue('--dsw-alias-bg-base'))
        if (actual === null || Math.abs(actual - alphaOf(TOKEN_SPEC[0])) > 0.03) issues.push('主题透明度未生效')
      } catch {
        issues.push('读取主题失败')
      }
      return issues
    }

    function detailText() {
      const layer = document.getElementById(LAYER_ID)
      return 'v' + REVISION
        + ' · 存储:' + storageState
        + ' · #root:' + (document.getElementById('root') === null ? 0 : 1)
        + ' · 背景层:' + (layer === null ? 0 : 1)
        + ' · ' + (settings.image === null ? '默认图' : '自定义图')
        + ' · 透明度' + Math.round(settings.uiAlpha * 100) + '%'
        + ' · 模糊' + settings.blur.toFixed(0) + 'px'
    }

    function refreshDiagnostics() {
      const issues = health()
      if (warnNode !== null) {
        warnNode.textContent = issues.length === 0 ? '' : '⚠ ' + issues.join('、')
        warnNode.style.display = issues.length === 0 ? 'none' : 'block'
      }
      if (diagNode !== null) {
        diagNode.textContent = detailText()
        diagNode.style.display = diagVisible || issues.length > 0 ? 'block' : 'none'
      }
    }

    function applyLabels() {
      if (alphaLabel !== null) alphaLabel.textContent = Math.round(settings.uiAlpha * 100) + '%'
      if (blurLabel !== null) blurLabel.textContent = settings.blur.toFixed(0) + 'px'
      if (nameLabel !== null) {
        nameLabel.textContent = settings.image === null
          ? '当前：默认图'
          : '当前：' + (settings.imageName === '' ? '自定义图' : settings.imageName)
      }
    }

    /** 重画全部受设置影响的东西（滑块实时调用）。 */
    function refreshAll() {
      ensureStyleTag()
      applyInlineTokens()
      applyBackground()
      applyLabels()
      refreshDiagnostics()
    }

    function row(parent, labelText, control) {
      const line = el('div', 'display:flex;align-items:center;gap:8px;margin:7px 0')
      line.appendChild(el('span', 'flex:0 0 76px;color:#5b6169', labelText))
      line.appendChild(control)
      parent.appendChild(line)
      return line
    }

    function smallButton(text, onClick) {
      const button = el('button', 'flex:1;padding:5px 8px;border-radius:7px;border:1px solid rgba(0,0,0,0.14);background:#fff;cursor:pointer;font-size:12px', text)
      button.addEventListener('click', onClick)
      return button
    }

    /** 把文件读成降采样后的 data URL，控制体积以便放进 localStorage。 */
    function fileToDataUrl(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onerror = () => reject(new Error('read failed'))
        reader.onload = () => {
          const raw = String(reader.result)
          const img = new Image()
          img.onerror = () => {
            if (raw.length <= 3.5 * 1024 * 1024) resolve(raw)
            else reject(new Error('decode failed'))
          }
          img.onload = () => {
            try {
              const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
              const width = Math.max(1, Math.round(img.naturalWidth * scale))
              const height = Math.max(1, Math.round(img.naturalHeight * scale))
              const canvas = document.createElement('canvas')
              canvas.width = width
              canvas.height = height
              const ctx = canvas.getContext('2d')
              if (ctx === null) throw new Error('no 2d context')
              ctx.drawImage(img, 0, 0, width, height)
              resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY))
            } catch (error) {
              reject(error)
            }
          }
          img.src = raw
        }
        reader.readAsDataURL(file)
      })
    }

    function applyPickedFile(file) {
      if (!file || String(file.type).indexOf('image/') !== 0) {
        report('pick', { ok: 0, reason: 'not-image' })
        return
      }
      fileToDataUrl(file).then((dataUrl) => {
        settings.image = dataUrl
        settings.imageName = String(file.name || '').slice(0, 120)
        saveSettings()
        refreshAll()
        report('pick', { ok: 1, name: settings.imageName, chars: dataUrl.length })
      }).catch((error) => {
        report('pick', { ok: 0, reason: String(error && error.message ? error.message : error) })
      })
    }

    function setPanelOpen(next) {
      try {
        const panel = document.getElementById(PANEL_ID)
        const button = document.getElementById(BUTTON_ID)
        if (panel !== null) panel.style.display = next ? 'block' : 'none'
        if (button !== null) button.style.display = next ? 'none' : 'flex'
        if (next) refreshDiagnostics()
      } catch {
        // 忽略
      }
      report('panel', { open: next ? 1 : 0 })
    }

    function buildPanel() {
      const panel = el('div', PANEL_CSS)
      panel.id = PANEL_ID

      const head = el('div', 'display:flex;align-items:center;justify-content:space-between;margin-bottom:4px')
      head.appendChild(el('strong', 'font-size:13px', '桌面壁纸'))
      const headRight = el('div', 'display:flex;align-items:center;gap:2px')
      const info = el('button', 'border:none;background:none;cursor:pointer;font-size:12px;line-height:1;color:#c2c7cc;padding:0 2px', 'ⓘ')
      info.title = '诊断信息'
      info.addEventListener('click', () => {
        diagVisible = !diagVisible
        refreshDiagnostics()
      })
      headRight.appendChild(info)
      const close = el('button', 'border:none;background:none;cursor:pointer;font-size:15px;line-height:1;color:#5b6169;padding:0 2px', '×')
      close.title = '关闭'
      close.addEventListener('click', () => setPanelOpen(false))
      headRight.appendChild(close)
      head.appendChild(headRight)
      panel.appendChild(head)

      nameLabel = el('div', 'color:#5b6169;margin:2px 0 6px;word-break:break-all')
      panel.appendChild(nameLabel)

      const fileRow = el('div', 'display:flex;gap:8px;margin:6px 0')
      const input = el('input')
      input.type = 'file'
      input.accept = 'image/*'
      input.style.display = 'none'
      input.addEventListener('change', () => {
        const file = input.files && input.files.length > 0 ? input.files[0] : null
        if (file) applyPickedFile(file)
        input.value = ''
      })
      fileRow.appendChild(smallButton('选择图片', () => input.click()))
      fileRow.appendChild(smallButton('恢复默认', () => {
        settings.image = null
        settings.imageName = ''
        saveSettings()
        refreshAll()
        report('pick', { ok: 1, name: '(default)' })
      }))
      panel.appendChild(fileRow)
      panel.appendChild(input)
      panel.appendChild(el('div', 'color:#8a9099;font-size:11px', '也可以把图片直接拖到窗口里'))

      const alpha = el('input')
      alpha.type = 'range'
      alpha.min = '0'
      alpha.max = '100'
      alpha.step = '1'
      alpha.value = String(Math.round(settings.uiAlpha * 100))
      alpha.style.cssText = 'flex:1'
      alphaLabel = el('span', 'flex:0 0 40px;text-align:right;color:#5b6169')
      alpha.addEventListener('input', () => {
        settings.uiAlpha = clamp(Number(alpha.value) / 100, 0, 1, DEFAULTS.uiAlpha)
        refreshAll()
      })
      alpha.addEventListener('change', () => {
        saveSettings()
        report('tune', { uiAlpha: settings.uiAlpha, blur: settings.blur })
      })
      row(panel, '界面不透明', alpha).appendChild(alphaLabel)

      const blur = el('input')
      blur.type = 'range'
      blur.min = '0'
      blur.max = '60'
      blur.step = '1'
      blur.value = String(Math.round(settings.blur))
      blur.style.cssText = 'flex:1'
      blurLabel = el('span', 'flex:0 0 40px;text-align:right;color:#5b6169')
      blur.addEventListener('input', () => {
        settings.blur = clamp(Number(blur.value), 0, 60, DEFAULTS.blur)
        refreshAll()
      })
      blur.addEventListener('change', () => {
        saveSettings()
        report('tune', { uiAlpha: settings.uiAlpha, blur: settings.blur })
      })
      row(panel, '背景模糊', blur).appendChild(blurLabel)

      // 平时都不显示：出问题才露出的橙色提示 + 点 ⓘ 才展开的细节行
      warnNode = el('div', 'display:none;margin-top:8px;padding-top:7px;border-top:1px solid rgba(0,0,0,0.08);color:#b25e00;font-size:11px;word-break:break-all')
      panel.appendChild(warnNode)
      diagNode = el('div', 'display:none;margin-top:6px;color:#a8adb3;font-size:10.5px;word-break:break-all')
      panel.appendChild(diagNode)

      const foot = el('div', 'display:flex;gap:8px;margin-top:8px')
      foot.appendChild(smallButton('重置全部', () => {
        settings = { ...DEFAULTS }
        alpha.value = String(Math.round(DEFAULTS.uiAlpha * 100))
        blur.value = String(Math.round(DEFAULTS.blur))
        saveSettings()
        refreshAll()
        report('reset', {})
      }))
      panel.appendChild(foot)

      return panel
    }

    function buildUi() {
      try {
        if (document.getElementById(PANEL_ID) === null) document.body.appendChild(buildPanel())
        if (document.getElementById(BUTTON_ID) === null) {
          const button = el('button', BUTTON_CSS, '🎨')
          button.id = BUTTON_ID
          button.title = '桌面壁纸设置'
          button.addEventListener('click', () => setPanelOpen(true))
          document.body.appendChild(button)
        }
        window.addEventListener('dragover', (event) => {
          try {
            if (event.dataTransfer && event.dataTransfer.types && event.dataTransfer.types.indexOf('Files') >= 0) {
              event.preventDefault()
            }
          } catch {
            // 忽略
          }
        })
        window.addEventListener('drop', (event) => {
          try {
            const files = event.dataTransfer ? event.dataTransfer.files : null
            if (files && files.length > 0) {
              event.preventDefault()
              applyPickedFile(files[0])
            }
          } catch {
            // 忽略
          }
        })
        return 1
      } catch {
        return 0
      }
    }

    // -------------------------------------------------------------- 实时探针

    function topChain() {
      let chain = ''
      try {
        let node = document.elementFromPoint(Math.floor(window.innerWidth / 2), Math.floor(window.innerHeight / 2))
        const parts = []
        for (let i = 0; node && i < 5; i += 1) {
          parts.push(node.tagName.toLowerCase() + (node.id ? '#' + node.id : '') + '|bg=' + getComputedStyle(node).backgroundColor)
          node = node.parentElement
        }
        chain = parts.join(' < ')
      } catch {
        // 忽略
      }
      return chain
    }

    function fullReport(event) {
      let base = ''
      let bodyBg = ''
      try {
        const cs = getComputedStyle(document.body)
        base = cs.getPropertyValue('--dsw-alias-bg-base').trim()
        bodyBg = cs.backgroundColor
      } catch {
        // 忽略
      }
      const layer = document.getElementById(LAYER_ID)
      report(event, {
        p: window.location.protocol,
        root: document.getElementById('root') === null ? 0 : 1,
        layer: layer === null ? 0 : 1,
        layerImg: layer === null ? '' : String(layer.style.backgroundImage).slice(0, 48),
        blur: settings.blur,
        uiAlpha: settings.uiAlpha,
        custom: settings.image === null ? 0 : 1,
        storage: storageState,
        issues: health().join('|'),
        base: base,
        bodyBg: bodyBg,
        top: topChain(),
        viewport: window.innerWidth + 'x' + window.innerHeight,
      })
    }

    function watchProbe() {
      let seen = -1
      const tick = () => {
        try {
          fetch(PREFIX + '/status', { cache: 'no-store' })
            .then((res) => res.json())
            .then((data) => {
              const value = Number(data && data.probe)
              if (!Number.isFinite(value)) return
              if (seen === -1) {
                seen = value
                return
              }
              if (value === seen) return
              seen = value
              fullReport('probe')
            })
            .catch(() => {})
        } catch {
          // 忽略
        }
      }
      try {
        setInterval(tick, 5000)
        tick()
      } catch {
        // 忽略
      }
    }

    // ------------------------------------------------------------------ 入口

    function apply() {
      if (typeof window === 'undefined' || typeof document === 'undefined') return
      const protocol = window.location.protocol
      const desktop = !DESKTOP_ONLY || protocol === 'dsh-app:'
      loadSettings()

      let styleTag = 0
      let inlineTokens = 0
      let layer = 0
      let ui = 0

      if (desktop) {
        styleTag = ensureStyleTag()
        inlineTokens = applyInlineTokens()
        layer = applyBackground()
        ui = buildUi()
        refreshAll()
      }

      report('apply', {
        p: protocol,
        styleTag: styleTag,
        inlineTokens: inlineTokens,
        layer: layer,
        ui: ui,
        storage: storageState,
        custom: settings.image === null ? 0 : 1,
        uiAlpha: settings.uiAlpha,
        blur: settings.blur,
      })

      if (!desktop) return

      // 主题明暗切换时，token 的两套值要跟着换
      try {
        const observer = new MutationObserver(() => {
          applyInlineTokens()
          ensureStyleTag()
        })
        observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
      } catch {
        // 忽略
      }

      // 主题或布局可能在稍后重渲染，重申几次覆盖
      const reass = [1000, 3000, 8000, 20000]
      for (let i = 0; i < reass.length; i += 1) {
        setTimeout(() => {
          ensureStyleTag()
          applyInlineTokens()
          applyBackground()
          if (i === reass.length - 1) fullReport('late')
        }, reass[i])
      }

      watchProbe()
    }

    exports.apply = apply
    exports.inject = []
    return module.exports
  },
})
