/**
 * set-package-name.mjs — 改包名时，把三处必须一致的地方一次改完。
 *
 * 必须一致的三处（漏一处插件就会加载失败或对不上号）：
 *   1. package.json 的 name
 *   2. lib/index.js 的 export const name
 *   3. lib/client.js 的 __ModuleLoader__.load({ id }) 与 const PKG
 *
 * 顺带把路由前缀换成由新包名派生的 slug，这样两个不同名字的壁纸插件同时安装时
 * 不会争抢同一条路由。旧前缀是从当前 package.json 的 name 推导的，因此改名是**可逆的**：
 * 来回改两次会回到原样。
 *
 * 用法：node scripts/set-package-name.mjs <新包名>
 *   例：node scripts/set-package-name.mjs @yourname/desk-wallpaper
 * 改完请跑：npm run verify
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/

const name = (process.argv[2] ?? '').trim()
if (!PACKAGE_NAME.test(name)) {
  console.error('usage: node scripts/set-package-name.mjs <package-name>')
  console.error('  package name must be lowercase and may start with a scope, e.g. @you/desk-wallpaper')
  process.exit(1)
}

const root = fileURLToPath(new URL('..', import.meta.url))

/** 包名 -> 路由前缀用的 slug：去掉 scope，非字母数字换成连字符。 */
const slugOf = (value) => value.replace(/^@[^/]+\//, '').replace(/[^a-z0-9-]+/g, '-')

let manifest
try {
  manifest = JSON.parse(readFileSync(root + 'package.json', 'utf8'))
} catch (error) {
  console.error('cannot read package.json: ' + String(error && error.message ? error.message : error))
  process.exit(1)
}

const oldName = String(manifest.name ?? '')
if (oldName === '') {
  console.error('package.json has no name to rewrite')
  process.exit(1)
}

const OLD_PREFIX = '/' + slugOf(oldName)
const NEW_PREFIX = '/' + slugOf(name)
const changed = []

function rewrite(relative, replacers) {
  const file = root + relative
  const before = readFileSync(file, 'utf8')
  let after = before
  for (const [pattern, replacement] of replacers) after = after.replace(pattern, replacement)
  if (after !== before) {
    writeFileSync(file, after)
    changed.push(relative)
  }
}

rewrite('package.json', [[/("name"\s*:\s*")[^"]+(")/, `$1${name}$2`]])
rewrite('lib/index.js', [
  [/(export const name = ')[^']+(')/, `$1${name}$2`],
  [new RegExp(OLD_PREFIX, 'g'), NEW_PREFIX],
])
rewrite('lib/client.js', [
  [/(\n\s*id: ')[^']+(')/, `$1${name}$2`],
  [/(const PKG = ')[^']+(')/, `$1${name}$2`],
  [new RegExp(OLD_PREFIX, 'g'), NEW_PREFIX],
])

console.log('package name: ' + oldName + ' -> ' + name)
console.log('route prefix: ' + OLD_PREFIX + ' -> ' + NEW_PREFIX)
console.log(changed.length === 0 ? 'nothing changed' : 'updated: ' + changed.join(', '))
console.log('now run: npm run verify')
