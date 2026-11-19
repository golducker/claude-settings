// Catppuccin Mocha widgets for the Dev servers panel, the same family as
// mission-control's: a dark base card, one live colour (green), animations
// phased from the clock so redraws continue them. Same layout rule too:
// effects keep to marked `fx-zone`s, text is measured and cut to its room.

export const C = {
  pink: '#F5C2E7',
  mauve: '#CBA6F7',
  red: '#F38BA8',
  peach: '#FAB387',
  yellow: '#F9E2AF',
  green: '#A6E3A1',
  teal: '#94E2D5',
  blue: '#89B4FA',
  text: '#CDD6F4',
  subtext: '#A6ADC8',
  overlay: '#7F849C',
  surface1: '#45475A',
  surface0: '#313244',
  base: '#1E1E2E',
  crust: '#11111B',
} as const

const SANS = "'Segoe UI Variable Text','Segoe UI',system-ui,-apple-system,sans-serif"
const MONO = "'Cascadia Code','JetBrains Mono',Consolas,ui-monospace,monospace"

type Face = 'sans' | 'bold' | 'mono'

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function tw(s: string, size: number, face: Face = 'sans'): number {
  if (face === 'mono') return s.length * size * 0.61

  let em = 0

  for (const ch of s) {
    em += /[A-Z]/.test(ch) ? 0.68 : /[mwMW@%]/.test(ch) ? 0.86 : /[il.,:;'|!·\s]/.test(ch) ? 0.3 : 0.56
  }

  return em * size * (face === 'bold' ? 1.08 : 1)
}

function fit(s: string, px: number, size: number, face: Face = 'sans'): string {
  const flat = s.replace(/\s+/g, ' ').trim()

  if (tw(flat, size, face) <= px) return flat
  if (px < size) return ''

  let lo = 0
  let hi = flat.length

  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)

    if (tw(`${flat.slice(0, mid)}…`, size, face) <= px) lo = mid
    else hi = mid - 1
  }

  return lo === 0 ? '' : `${flat.slice(0, lo).trimEnd()}…`
}

function phase(nowMs: number, dur: number): string {
  return `-${((nowMs / 1000) % dur).toFixed(2)}s`
}

function zone(x: number, y: number, w: number, h: number): string {
  return `<rect class="fx-zone" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" fill="none"/>`
}

function text(x: number, y: number, s: string, size: number, fill: string, opts: { face?: Face; anchor?: 'end' | 'middle'; spacing?: number; weight?: number } = {}): string {
  if (s === '') return ''
  const face = opts.face ?? 'sans'

  return `<text x="${x.toFixed(1)}" y="${y}" font-family="${face === 'mono' ? MONO : SANS}" font-size="${size}" font-weight="${opts.weight ?? (face === 'bold' ? 700 : 400)}" fill="${fill}"${opts.anchor ? ` text-anchor="${opts.anchor}"` : ''}${opts.spacing ? ` letter-spacing="${opts.spacing}"` : ''}>${esc(s)}</text>`
}

function frame(w: number, h: number, body: string, edge: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs>
  <radialGradient id="aura" cx=".08" cy="0" r="1"><stop offset="0" stop-color="${C.green}" stop-opacity=".14"/><stop offset="1" stop-color="${C.base}" stop-opacity="0"/></radialGradient>
  <linearGradient id="mint" x1="0" x2="1"><stop offset="0" stop-color="${C.green}"/><stop offset="1" stop-color="${C.teal}"/></linearGradient>
  <filter id="soft" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.6"/></filter>
</defs>
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="12" fill="${C.base}"/>
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="12" fill="url(#aura)"/>
<rect x=".5" y=".5" width="${w - 1}" height="${h - 1}" rx="12" fill="none" stroke="${edge}"/>
${body}
</svg>`
}

export function headerSvg(a: { width: number; now: number; running: number; ports: readonly number[]; ago: string }): string {
  const w = a.width
  const h = 68
  const right = w - 16
  const b = phase(a.now, 1.6)
  const title = a.running > 0 ? `${a.running} running` : 'Nothing running'
  const titleEnd = 42 + Math.max(tw(title, 17, 'bold'), tw('DEV SERVERS', 10, 'bold') + 18, tw(a.ago, 10.5))
  // As many port chips as fit to the right of the title; the rest become "+n".
  const chipW = (p: number) => tw(`:${p}`, 11.5, 'mono') + 16
  const room = right - titleEnd - 16
  const shown: number[] = []
  let used = 0

  for (const p of a.ports) {
    const need = chipW(p) + 6
    const moreW = shown.length + 1 < a.ports.length ? tw('+99', 11, 'bold') + 10 : 0

    if (used + need + moreW > room) break
    shown.push(p)
    used += need
  }

  const hidden = a.ports.length - shown.length
  let x = right
  const chips: string[] = []

  if (hidden > 0 && room > 30) {
    const t = `+${hidden}`
    x -= tw(t, 11, 'bold')
    chips.push(text(x, 39, t, 11, C.green, { face: 'bold' }))
    x -= 8
  }

  for (const p of [...shown].reverse()) {
    const cw = chipW(p)
    x -= cw
    chips.push(`<rect class="solid" x="${x.toFixed(1)}" y="23" width="${cw.toFixed(1)}" height="22" rx="11" fill="${C.green}" fill-opacity=".16"/>${text(x + cw / 2, 38, `:${p}`, 11.5, C.green, { face: 'mono', anchor: 'middle', weight: 700 })}`)
    x -= 6
  }

  return frame(w, h, `
${a.running > 0 ? `<circle cx="24" cy="26" r="4.5" fill="${C.green}" opacity=".4"><animate attributeName="r" values="4.5;10" dur="1.6s" begin="${b}" repeatCount="indefinite"/><animate attributeName="opacity" values=".45;0" dur="1.6s" begin="${b}" repeatCount="indefinite"/></circle>${zone(14, 16, 20, 20)}` : ''}
<circle cx="24" cy="26" r="4.5" fill="${a.running > 0 ? C.green : C.surface1}"/>
${text(42, 22, 'DEV SERVERS', 10, C.overlay, { face: 'bold', spacing: 1.6 })}
${text(42, 42, title, 17, C.text, { face: 'bold', weight: 750 })}
${text(42, 58, a.ago, 10.5, C.overlay)}
${chips.join('')}`, a.running > 0 ? `${C.green}40` : C.surface0)
}

export function serverSvg(a: { width: number; now: number; port: number; extraPorts: readonly number[]; name: string; command: string; pid: number; isStopping: boolean }): string {
  const w = a.width
  const h = 70
  const right = w - 16
  const perim = 2 * (w + h)
  const tone = a.isStopping ? C.yellow : C.green
  const portS = `:${a.port}`
  const badgeW = tw(portS, 16, 'mono') + 20
  const textX = 16 + badgeW + 14
  const pidS = `pid ${a.pid}`
  const pidW = tw(pidS, 10.5, 'mono')
  const name = fit(a.name, right - pidW - 14 - textX, 13.5, 'bold')
  const stopping = a.isStopping ? 'stopping…' : ''
  const extra = a.extraPorts.length ? `  +${a.extraPorts.map(p => `:${p}`).join(' ')}` : ''
  const cmd = fit(a.command + extra, right - (stopping ? tw(stopping, 11, 'bold') + 12 : 0) - textX, 11, 'mono')
  const comet = a.isStopping ? '' : `<rect x="1.5" y="1.5" width="${w - 3}" height="${h - 3}" rx="11.5" fill="none" stroke="url(#mint)" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="60 ${perim}" filter="url(#soft)">
  <animate attributeName="stroke-dashoffset" values="0;-${perim + 60}" dur="4s" begin="${phase(a.now, 4)}" repeatCount="indefinite"/></rect>`

  return frame(w, h, `
${comet}
<rect class="solid" x="16" y="15" width="${badgeW.toFixed(1)}" height="40" rx="10" fill="${tone}" fill-opacity=".14"/>
${text(16 + badgeW / 2, 41, portS, 16, tone, { face: 'mono', anchor: 'middle', weight: 800 })}
${text(textX, 31, name, 13.5, C.text, { face: 'bold' })}
${text(textX, 50, cmd, 11, C.overlay, { face: 'mono' })}
${text(right, 31, pidS, 10.5, C.overlay, { face: 'mono', anchor: 'end' })}
${stopping ? text(right, 50, stopping, 11, C.yellow, { face: 'bold', anchor: 'end', weight: 600 }) : ''}`, a.isStopping ? `${C.yellow}55` : `${C.green}30`)
}
