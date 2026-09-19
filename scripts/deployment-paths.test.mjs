import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relativePath) => readFileSync(resolve(root, relativePath), 'utf8')

describe('deployment-relative PWA paths', () => {
  it('keeps HTML PWA assets relative to the deployed app base', () => {
    const html = read('index.html')

    expect(html).toContain('href="icon-192.png"')
    expect(html).toContain('href="manifest.json"')
    expect(html).not.toContain('href="/icon-192.png"')
    expect(html).not.toContain('href="/manifest.json"')
  })

  it('keeps the manifest start URL, scope, and icon inside its deployment', () => {
    const manifest = JSON.parse(read('public/manifest.json'))

    expect(manifest.start_url).toBe('./')
    expect(manifest.scope).toBe('./')
    expect(manifest.icons).toEqual([
      {
        src: './favicon.svg',
        sizes: 'any',
        type: 'image/svg+xml',
      },
    ])
  })

  it('registers the service worker from Vite base URL', () => {
    const main = read('src/main.tsx')

    expect(main).toContain('`${import.meta.env.BASE_URL}sw.js`')
    expect(main).not.toContain("register('/sw.js')")
  })

  it('opens notification clicks inside the service worker scope', () => {
    const serviceWorker = read('public/sw.js')

    expect(serviceWorker).toContain('self.registration.scope')
    expect(serviceWorker).not.toContain("openWindow('/')")
  })
})
