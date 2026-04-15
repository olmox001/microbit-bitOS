// ============================================================
// BitOS v1.0 — Sistema Operativo Multimediale
// micro:bit V2 + Display Shield
//
// ESTENSIONI RICHIESTE (aggiungi in MakeCode):
//   1. display-shield
//   2. states
//   3. microbit-pxt-blehid (bsiever/microbit-pxt-blehid)
//   4. datalogger
//
// NOTA: Radio NON disponibile (conflitto con BLE).
//       Persistenza flash NON disponibile senza pxt-settings.
//       Tutti i dati vivono in RAM per la sessione corrente.
//
// ARCHITETTURA:
//   LANG    → Internazionalizzazione (IT/EN)
//   Kernel  → Boot, panic, watchdog, power
//   FB      → Framebuffer (API native screen())
//   SND     → Audio ed effetti sonori
//   KBD     → Input: coda eventi + repeat tasti
//   TTY     → Terminale a scroll
//   FS      → Filesystem RAM (sessione corrente)
//   PM      → Background services manager
//   UI      → Widget: menu, dialog, progress, toast
//   VKB     → Tastiera virtuale on-screen
//   SENS    → Astrazione sensori
//   BLE     → BLE HID (keyboard + mouse)
//   DL      → Data Logger (sensori su flash)
//   APP     → Framework applicazioni + Launcher
//
// APPLICAZIONI INTEGRATE:
//   Shell, File Manager, System Info, Sensori + Log,
//   Snake, BLE Tastiera, BLE Controller, Impostazioni
// ============================================================

// ================================================================
// INIZIALIZZAZIONE BLE HID — DEVE essere PRIMA di tutto
// I servizi BLE vanno avviati prima di qualsiasi basic.pause()
// ================================================================
keyboard.startKeyboardService()
mouse.startMouseService()

// ---- COSTANTI DISPLAY ----
const SCREEN_W = 160
const SCREEN_H = 120
const FONT_W = 6
const FONT_H = 8
const TTY_COLS = Math.idiv(SCREEN_W, FONT_W)   // 26
const TTY_ROWS = Math.idiv(SCREEN_H, FONT_H)   // 15

// ---- COLORI (palette 16 colori display shield) ----
const C_BG = 0       // nero / sfondo
const C_FG = 1       // bianco / primo piano
const C_ERR = 2      // rosso
const C_PINK = 3     // rosa
const C_ORANGE = 4   // arancione
const C_WARN = 5     // giallo
const C_TEAL = 6     // teal
const C_OK = 7       // verde
const C_BLUE = 8     // blu
const C_LBLUE = 9    // azzurro
const C_PURPLE = 10  // viola
const C_GRAY = 12    // grigio scuro
const C_TAN = 13     // beige
const C_BROWN = 14   // marrone
const C_BLACK = 15   // nero pieno



// ================================================================
// LANG — Internazionalizzazione (IT/EN)
// Stato in RAM — default Italiano
// ================================================================
namespace LANG {
    export let id = 0  // 0 = Italiano, 1 = English

    export function set(lang: number): void {
        id = lang
    }

    // Ritorna la stringa nella lingua corrente
    export function t(it: string, en: string): string {
        return id === 0 ? it : en
    }
}

// ================================================================
// KERNEL — Boot, Panic, Watchdog, Power
// ================================================================
namespace Kernel {
    export let hash = 0
    export let running = false
    export let tick = 0
    export let idleTicks = 0
    export let dimmed = false
    const IDLE_DIM = 12     // dim dopo 60s (12 × 5s)

    // Verifica integrità hardware e genera hash univoco
    export function boot(): boolean {
        const serial = control.deviceSerialNumber()
        const time = input.runningTime()
        const temp = input.temperature()
        // Verifica sensore temperatura funzionante
        if (temp < -40 || temp > 85) return false
        hash = serial ^ (time * 31 + temp * 17)
        if (hash === 0) hash = 1
        running = true
        return true
    }

    // Schermo errore con codice e messaggio
    export function panic(code: number, msg: string): void {
        screen().fill(C_ERR)
        screen().print("!! KERNEL PANIC !!", 10, 20, C_FG)
        screen().print("Codice: " + convertToText(code), 10, 36, C_FG)
        if (msg.length > 0) {
            screen().print(msg.substr(0, 24), 10, 52, C_FG)
        }
        screen().print("Reset in 3s", 10, 72, C_FG)
        basic.pause(3000)
        control.reset()
    }

    // Watchdog: verifica stato e incrementa tick
    export function startWatchdog(): void {
        loops.everyInterval(5000, function () {
            if (!running) control.reset()
            tick++
            idleTicks++
            if (idleTicks >= IDLE_DIM && !dimmed) {
                dimmed = true
            }
        })
    }

    // Reset idle (chiamare ad ogni input utente)
    export function poke(): void {
        idleTicks = 0
        dimmed = false
    }

    export function uptimeSecs(): number {
        return Math.idiv(input.runningTime(), 1000)
    }

    export function uptimeStr(): string {
        const secs = uptimeSecs()
        const m = Math.idiv(secs, 60)
        const s = secs % 60
        return convertToText(m) + ":" + (s < 10 ? "0" : "") + convertToText(s)
    }
}

// ================================================================
// FB — Framebuffer (wrapper API native screen())
// ================================================================
namespace FB {
    export function cls(): void { screen().fill(C_BG) }
    export function fill(c: number): void { screen().fill(c) }

    export function pixel(x: number, y: number, c: number): void {
        screen().setPixel(x, y, c)
    }

    export function text(s: string, x: number, y: number, c: number): void {
        screen().print(s, x, y, c)
    }

    export function line(x0: number, y0: number, x1: number, y1: number, c: number): void {
        screen().drawLine(x0, y0, x1, y1, c)
    }

    export function hline(x: number, y: number, w: number, c: number): void {
        if (w > 0) screen().drawLine(x, y, x + w - 1, y, c)
    }

    export function vline(x: number, y: number, h: number, c: number): void {
        if (h > 0) screen().drawLine(x, y, x, y + h - 1, c)
    }

    export function rect(x: number, y: number, w: number, h: number, c: number): void {
        screen().drawRect(x, y, w, h, c)
    }

    export function fillRect(x: number, y: number, w: number, h: number, c: number): void {
        screen().fillRect(x, y, w, h, c)
    }

    export function titleBar(title: string, y: number, fg: number, bg: number): void {
        fillRect(0, y, SCREEN_W, FONT_H + 2, bg)
        const tx = Math.idiv(SCREEN_W - title.length * FONT_W, 2)
        text(title, Math.max(0, tx), y + 1, fg)
    }

    export function centerText(s: string, y: number, c: number): void {
        const x = Math.idiv(SCREEN_W - s.length * FONT_W, 2)
        text(s, Math.max(0, x), y, c)
    }
}

// ================================================================
// SND — Audio ed Effetti Sonori
// ================================================================
namespace SND {
    let _mute = false

    export function setMute(m: boolean): void { _mute = m }
    export function isMuted(): boolean { return _mute }

    export function beep(freq: number, ms: number): void {
        if (_mute) return
        control.runInBackground(function () {
            music.playTone(freq, ms)
        })
    }

    export function click(): void { beep(1200, 15) }
    export function ok(): void { beep(880, 40) }
    export function error(): void { beep(220, 150) }
    export function nav(): void { beep(600, 10) }

    export function bootMelody(): void {
        if (_mute) return
        control.runInBackground(function () {
            music.playTone(523, 80)
            basic.pause(100)
            music.playTone(659, 80)
            basic.pause(100)
            music.playTone(784, 80)
            basic.pause(100)
            music.playTone(1047, 200)
        })
    }
}

// ================================================================
// KBD — Input Manager (coda eventi + stato + repeat D-pad)
// ================================================================
namespace KBD {
    export const UP = 0
    export const DOWN = 1
    export const LEFT = 2
    export const RIGHT = 3
    export const A = 4
    export const B = 5
    export const MENU = 6

    const MAX_QUEUE = 16
    let _state: boolean[] = [false, false, false, false, false, false, false]
    let _queue: number[] = []
    let _repCtr: number[] = [0, 0, 0, 0, 0, 0, 0]
    const REP_DELAY = 8    // frame prima di repeat (~264ms)
    const REP_RATE = 3     // frame tra repeat (~99ms)

    export function init(): void {
        controller.up.onEvent(ControllerButtonEvent.Pressed, function () { _press(UP) })
        controller.up.onEvent(ControllerButtonEvent.Released, function () { _release(UP) })
        controller.down.onEvent(ControllerButtonEvent.Pressed, function () { _press(DOWN) })
        controller.down.onEvent(ControllerButtonEvent.Released, function () { _release(DOWN) })
        controller.left.onEvent(ControllerButtonEvent.Pressed, function () { _press(LEFT) })
        controller.left.onEvent(ControllerButtonEvent.Released, function () { _release(LEFT) })
        controller.right.onEvent(ControllerButtonEvent.Pressed, function () { _press(RIGHT) })
        controller.right.onEvent(ControllerButtonEvent.Released, function () { _release(RIGHT) })
        controller.A.onEvent(ControllerButtonEvent.Pressed, function () { _press(A) })
        controller.A.onEvent(ControllerButtonEvent.Released, function () { _release(A) })
        controller.B.onEvent(ControllerButtonEvent.Pressed, function () { _press(B) })
        controller.B.onEvent(ControllerButtonEvent.Released, function () { _release(B) })
        controller.menu.onEvent(ControllerButtonEvent.Pressed, function () { _press(MENU) })
        controller.menu.onEvent(ControllerButtonEvent.Released, function () { _release(MENU) })
    }

    function _press(k: number): void {
        _state[k] = true
        _repCtr[k] = 0
        Kernel.poke()
        if (_queue.length < MAX_QUEUE) _queue.push(k)
    }

    function _release(k: number): void {
        _state[k] = false
        _repCtr[k] = 0
    }

    export function isDown(k: number): boolean { return _state[k] }

    export function poll(): number {
        if (_queue.length === 0) return -1
        return _queue.removeAt(0)
    }

    export function flush(): void { _queue = [] }

    // Genera ripetizioni per tasti direzionali (0-3)
    export function updateRepeat(): void {
        for (let i = 0; i <= 3; i++) {
            if (_state[i]) {
                _repCtr[i]++
                if (_repCtr[i] === REP_DELAY ||
                    (_repCtr[i] > REP_DELAY && _repCtr[i] % REP_RATE === 0)) {
                    if (_queue.length < MAX_QUEUE) _queue.push(i)
                }
            } else {
                _repCtr[i] = 0
            }
        }
    }
}

// ================================================================
// TTY — Terminale a Scroll
// ================================================================
namespace TTY {
    let _buf: string[] = []
    let _row = 0
    let _col = 0
    let _offY = 0
    let _rows = 0

    export function init(offsetY: number): void {
        _offY = offsetY
        _rows = Math.idiv(SCREEN_H - offsetY, FONT_H)
        _buf = []
        for (let i = 0; i < _rows; i++) _buf.push("")
        _row = 0
        _col = 0
    }

    export function clear(): void {
        for (let i = 0; i < _buf.length; i++) _buf[i] = ""
        _row = 0
        _col = 0
    }

    export function write(s: string): void {
        for (let i = 0; i < s.length; i++) {
            const ch = s.charAt(i)
            if (ch === "\n" || _col >= TTY_COLS) {
                _row++
                _col = 0
                if (_row >= _buf.length) _scroll()
            }
            if (ch !== "\n") {
                _buf[_row] = _buf[_row] + ch
                _col++
            }
        }
    }

    export function writeln(s: string): void { write(s + "\n") }
    export function writeNum(n: number): void { write(convertToText(n)) }

    function _scroll(): void {
        _buf.removeAt(0)
        _buf.push("")
        _row = _buf.length - 1
    }

    export function render(): void {
        for (let r = 0; r < _buf.length; r++) {
            if (_buf[r].length > 0) {
                FB.text(_buf[r], 0, _offY + r * FONT_H, C_FG)
            }
        }
    }

    export function rowCount(): number { return _rows }
}

// ================================================================
// FS — Filesystem in RAM (nessuna persistenza senza pxt-settings)
// Dati validi solo per la sessione corrente.
// Per persistenza: aggiungere estensione pxt-settings a MakeCode.
// ================================================================
namespace FS {
    const MAX_FILES = 24
    const MAX_SIZE = 512

    let _names: string[] = []
    let _data: string[] = []
    let _sizes: number[] = []
    let _inodes: number[] = []
    let _nextInode = 1

    function _find(name: string): number {
        for (let i = 0; i < _names.length; i++) {
            if (_names[i] === name) return i
        }
        return -1
    }

    export function write(name: string, data: string): boolean {
        if (data.length > MAX_SIZE) return false
        const idx = _find(name)
        if (idx >= 0) {
            _data[idx] = data
            _sizes[idx] = data.length
            return true
        }
        if (_names.length >= MAX_FILES) return false
        _names.push(name)
        _data.push(data)
        _sizes.push(data.length)
        _inodes.push(_nextInode++)
        return true
    }

    export function append(name: string, data: string): boolean {
        const idx = _find(name)
        if (idx < 0) return write(name, data)
        const nd = _data[idx] + data
        if (nd.length > MAX_SIZE) return false
        _data[idx] = nd
        _sizes[idx] = nd.length
        return true
    }

    export function read(name: string): string {
        const idx = _find(name)
        return idx >= 0 ? _data[idx] : ""
    }

    export function exists(name: string): boolean { return _find(name) >= 0 }

    export function remove(name: string): boolean {
        const idx = _find(name)
        if (idx < 0) return false
        _names.removeAt(idx)
        _data.removeAt(idx)
        _sizes.removeAt(idx)
        _inodes.removeAt(idx)
        return true
    }

    export function list(): string[] {
        const out: string[] = []
        for (let i = 0; i < _names.length; i++) out.push(_names[i])
        return out
    }

    export function fileCount(): number { return _names.length }

    export function stat(name: string): string {
        const idx = _find(name)
        if (idx < 0) return LANG.t("non trovato", "not found")
        return _names[idx] + " " + convertToText(_sizes[idx]) + "b #" + convertToText(_inodes[idx])
    }

    export function fileSize(name: string): number {
        const idx = _find(name)
        return idx >= 0 ? _sizes[idx] : 0
    }

    export function usedBytes(): number {
        let tot = 0
        for (let i = 0; i < _sizes.length; i++) tot += _sizes[i]
        return tot
    }

    export function freeBytes(): number {
        return MAX_FILES * MAX_SIZE - usedBytes()
    }

    export function format(): void {
        _names = []
        _data = []
        _sizes = []
        _inodes = []
        _nextInode = 1
    }
}

// ================================================================
// PM — Background Services Manager
// ================================================================
namespace PM {
    const MAX_SVC = 6
    let _names: string[] = []
    let _alive: boolean[] = []
    let _count = 0

    export function startService(name: string, fn: () => void): number {
        if (_count >= MAX_SVC) return -1
        const idx = _count
        _names.push(name)
        _alive.push(true)
        _count++
        control.runInBackground(function () {
            while (_alive[idx]) {
                fn()
                basic.pause(100)
            }
        })
        return idx
    }

    export function stopService(idx: number): void {
        if (idx >= 0 && idx < _count) _alive[idx] = false
    }

    export function serviceCount(): number { return _count }

    export function list(): string[] {
        const out: string[] = []
        for (let i = 0; i < _count; i++) {
            out.push((_alive[i] ? "+" : "-") + _names[i])
        }
        return out
    }
}

// ================================================================
// UI — Widget Library
// ================================================================
namespace UI {
    // Menu verticale con scroll e selezione evidenziata
    export function menu(
        items: string[], sel: number,
        x: number, y: number, w: number,
        maxVisible: number
    ): void {
        const start = sel >= maxVisible ? sel - maxVisible + 1 : 0
        const end = Math.min(items.length, start + maxVisible)
        for (let i = start; i < end; i++) {
            const iy = y + (i - start) * (FONT_H + 2)
            const label = items[i].substr(0, Math.idiv(w - FONT_W, FONT_W))
            if (i === sel) {
                FB.fillRect(x, iy, w, FONT_H + 2, C_FG)
                FB.text(">" + label, x + 1, iy + 1, C_BG)
            } else {
                FB.text(" " + label, x + 1, iy + 1, C_FG)
            }
        }
        // Indicatori scroll
        if (items.length > maxVisible) {
            if (start > 0) FB.text("^", x + w - FONT_W, y, C_TEAL)
            if (end < items.length) FB.text("v", x + w - FONT_W, y + (maxVisible - 1) * (FONT_H + 2), C_TEAL)
        }
    }

    // Menu con titolo e divisore
    export function titledMenu(
        title: string, items: string[], sel: number,
        x: number, y: number, w: number, maxVisible: number
    ): void {
        FB.text(title, x + 2, y, C_LBLUE)
        FB.hline(x, y + FONT_H + 1, w, C_GRAY)
        menu(items, sel, x, y + FONT_H + 3, w, maxVisible)
    }

    // Dialog box con titolo e righe di testo
    export function dialog(
        title: string, lines: string[],
        x: number, y: number, w: number, h: number
    ): void {
        FB.fillRect(x, y, w, h, C_BG)
        FB.rect(x, y, w, h, C_FG)
        FB.fillRect(x + 1, y + 1, w - 2, FONT_H + 2, C_BLUE)
        const maxC = Math.idiv(w - 4, FONT_W)
        FB.text(title.substr(0, maxC), x + 2, y + 2, C_FG)
        for (let i = 0; i < lines.length; i++) {
            FB.text(lines[i].substr(0, maxC), x + 3, y + FONT_H + 5 + i * (FONT_H + 1), C_FG)
        }
    }

    // Conferma Si/No
    let _confirmResult = -1
    let _confirmSel = 0

    export function confirmReset(): void {
        _confirmResult = -1
        _confirmSel = 0
    }

    export function confirmDraw(title: string, msg: string): void {
        const w = 120
        const h = 48
        const x = Math.idiv(SCREEN_W - w, 2)
        const y = Math.idiv(SCREEN_H - h, 2)
        FB.fillRect(x, y, w, h, C_BG)
        FB.rect(x, y, w, h, C_WARN)
        FB.text(title, x + 4, y + 4, C_WARN)
        FB.text(msg.substr(0, 18), x + 4, y + 16, C_FG)
        const si = LANG.t("Si", "Yes")
        const no = LANG.t("No", "No")
        if (_confirmSel === 0) {
            FB.fillRect(x + 10, y + 30, 40, FONT_H + 2, C_FG)
            FB.text("[" + si + "]", x + 12, y + 31, C_BG)
            FB.text(" " + no + " ", x + 62, y + 31, C_FG)
        } else {
            FB.text(" " + si + " ", x + 12, y + 31, C_FG)
            FB.fillRect(x + 60, y + 30, 40, FONT_H + 2, C_FG)
            FB.text("[" + no + "]", x + 62, y + 31, C_BG)
        }
    }

    export function confirmKey(k: number): number {
        if (k === KBD.LEFT || k === KBD.RIGHT) {
            _confirmSel = _confirmSel === 0 ? 1 : 0
        } else if (k === KBD.A) {
            _confirmResult = _confirmSel === 0 ? 1 : 0
        } else if (k === KBD.B) {
            _confirmResult = 0
        }
        return _confirmResult
    }

    // Barra di progresso
    export function progressBar(
        x: number, y: number, w: number, h: number,
        value: number, maxVal: number, c: number
    ): void {
        FB.rect(x, y, w, h, C_FG)
        if (maxVal > 0) {
            const fill = Math.idiv((w - 2) * Math.min(value, maxVal), maxVal)
            if (fill > 0) FB.fillRect(x + 1, y + 1, fill, h - 2, c)
        }
    }

    // Status bar superiore
    export function statusBar(left: string, right: string): void {
        FB.fillRect(0, 0, SCREEN_W, FONT_H + 2, C_BLUE)
        FB.text(left.substr(0, 14), 2, 1, C_FG)
        if (right.length > 0) {
            const rx = SCREEN_W - right.length * FONT_W - 2
            FB.text(right, Math.max(0, rx), 1, C_FG)
        }
    }

    // Toast
    export function toast(msg: string): void {
        const w = Math.min(msg.length * FONT_W + 10, SCREEN_W - 8)
        const x = Math.idiv(SCREEN_W - w, 2)
        const y = SCREEN_H - 24
        FB.fillRect(x, y, w, FONT_H + 6, C_BG)
        FB.rect(x, y, w, FONT_H + 6, C_OK)
        FB.text(msg.substr(0, Math.idiv(w - 8, FONT_W)), x + 5, y + 3, C_OK)
    }

    // Spinner
    export function spinner(x: number, y: number, ctr: number): void {
        const f = ["|", "/", "-", "\\"]
        FB.text(f[ctr % 4], x, y, C_FG)
    }
}

// ================================================================
// VKB — Tastiera Virtuale On-Screen
// 3 pagine + riga funzione (SPC DEL OK Layout)
// ================================================================
namespace VKB {
    const _pages: string[][] = [
        ["qwertyuiop", "asdfghjkl.", "zxcvbnm,!?"],
        ["QWERTYUIOP", "ASDFGHJKL.", "ZXCVBNM,!?"],
        ["1234567890", "+-=*/%&@#$", "()[]{}:;\"'"]
    ]
    const _pageLabels = ["ABC", "abc", "?!1"]

    let _page = 0
    let _curR = 0
    let _curC = 0
    let _buf = ""
    let _visible = false
    let _cb: ((s: string) => void) | null = null
    const FUNC_ROW = 3
    const FUNC_COUNT = 4

    export function show(callback: (s: string) => void, initial: string): void {
        _cb = callback
        _buf = initial
        _page = 0
        _curR = 0
        _curC = 0
        _visible = true
    }

    export function hide(): void {
        _visible = false
        _cb = null
    }

    export function isVisible(): boolean { return _visible }
    export function getBuffer(): string { return _buf }

    export function handleKey(k: number): void {
        if (!_visible) return
        if (k === KBD.UP) {
            _curR = (_curR + FUNC_ROW) % (FUNC_ROW + 1)
            _clampCol()
        } else if (k === KBD.DOWN) {
            _curR = (_curR + 1) % (FUNC_ROW + 1)
            _clampCol()
        } else if (k === KBD.LEFT) {
            const maxC = _curR === FUNC_ROW ? FUNC_COUNT - 1 : _pages[_page][_curR].length - 1
            _curC = _curC > 0 ? _curC - 1 : maxC
        } else if (k === KBD.RIGHT) {
            const maxC = _curR === FUNC_ROW ? FUNC_COUNT - 1 : _pages[_page][_curR].length - 1
            _curC = _curC < maxC ? _curC + 1 : 0
        } else if (k === KBD.A) {
            _activate()
        } else if (k === KBD.B) {
            if (_buf.length > 0) _buf = _buf.substr(0, _buf.length - 1)
        } else if (k === KBD.MENU) {
            _page = (_page + 1) % _pages.length
            _clampCol()
        }
    }

    function _clampCol(): void {
        if (_curR === FUNC_ROW) {
            _curC = Math.min(_curC, FUNC_COUNT - 1)
        } else {
            _curC = Math.min(_curC, _pages[_page][_curR].length - 1)
        }
    }

    function _activate(): void {
        if (_curR === FUNC_ROW) {
            if (_curC === 0) {
                _buf += " "
            } else if (_curC === 1) {
                if (_buf.length > 0) _buf = _buf.substr(0, _buf.length - 1)
            } else if (_curC === 2) {
                if (_cb !== null) _cb(_buf)
                hide()
            } else if (_curC === 3) {
                _page = (_page + 1) % _pages.length
                _clampCol()
            }
        } else {
            _buf += _pages[_page][_curR].charAt(_curC)
        }
    }

    export function render(): void {
        if (!_visible) return
        const KW = 12
        const KH = 11
        const kbY = SCREEN_H - 4 * KH - 20
        const kbW = SCREEN_W

        // Sfondo tastiera
        FB.fillRect(0, kbY - FONT_H - 4, kbW, SCREEN_H - kbY + FONT_H + 4, C_BG)
        FB.hline(0, kbY - FONT_H - 5, kbW, C_GRAY)

        // Buffer input
        const inputY = kbY - FONT_H - 2
        FB.fillRect(2, inputY, kbW - 4, FONT_H + 2, C_BG)
        FB.rect(2, inputY, kbW - 4, FONT_H + 2, C_TEAL)
        const maxBufChars = Math.idiv(kbW - 12, FONT_W)
        const display = "> " + _buf + "_"
        const showStr = display.length > maxBufChars ?
            display.substr(display.length - maxBufChars) : display
        FB.text(showStr, 5, inputY + 1, C_FG)

        // Tasti (righe 0-2)
        const rows = _pages[_page]
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r]
            const totalW = row.length * KW
            const startX = Math.idiv(kbW - totalW, 2)
            for (let c = 0; c < row.length; c++) {
                const kx = startX + c * KW
                const ky = kbY + r * KH
                const sel = (r === _curR && c === _curC)
                if (sel) {
                    FB.fillRect(kx, ky, KW - 1, KH - 1, C_FG)
                    FB.text(row.charAt(c), kx + 3, ky + 2, C_BG)
                } else {
                    FB.rect(kx, ky, KW - 1, KH - 1, C_GRAY)
                    FB.text(row.charAt(c), kx + 3, ky + 2, C_FG)
                }
            }
        }

        // Riga funzione (riga 3)
        const funcY = kbY + 3 * KH + 2
        const funcLabels = ["SPC", "DEL", "OK", _pageLabels[_page]]
        const funcW = 32
        const funcGap = 6
        const totalFuncW = FUNC_COUNT * funcW + (FUNC_COUNT - 1) * funcGap
        const funcStartX = Math.idiv(kbW - totalFuncW, 2)

        for (let f = 0; f < FUNC_COUNT; f++) {
            const fx = funcStartX + f * (funcW + funcGap)
            const sel2 = (_curR === FUNC_ROW && _curC === f)
            const fc = f === 2 ? C_OK : (f === 1 ? C_ERR : C_TEAL)
            if (sel2) {
                FB.fillRect(fx, funcY, funcW, KH, fc)
                FB.text(funcLabels[f], fx + 2, funcY + 2, C_BG)
            } else {
                FB.rect(fx, funcY, funcW, KH, fc)
                FB.text(funcLabels[f], fx + 2, funcY + 2, fc)
            }
        }

        // Indicatore pagina
        for (let p = 0; p < _pages.length; p++) {
            FB.text(p === _page ? "#" : ".", SCREEN_W - (_pages.length - p) * FONT_W - 2, kbY - 1, p === _page ? C_FG : C_GRAY)
        }
    }
}

// ================================================================
// SENS — Astrazione Sensori
// ================================================================
namespace SENS {
    export function temp(): number { return input.temperature() }
    export function light(): number { return input.lightLevel() }
    export function compass(): number { return input.compassHeading() }
    export function accelX(): number { return input.acceleration(Dimension.X) }
    export function accelY(): number { return input.acceleration(Dimension.Y) }
    export function accelZ(): number { return input.acceleration(Dimension.Z) }
    export function sound(): number { return input.soundLevel() }
    export function accelMag(): number {
        return Math.idiv(
            Math.abs(input.acceleration(Dimension.X)) +
            Math.abs(input.acceleration(Dimension.Y)) +
            Math.abs(input.acceleration(Dimension.Z)), 10
        )
    }
}

// ================================================================
// BLE — BLE HID Driver (keyboard + mouse)
// Servizi già avviati nel blocco on start (righe 38-39)
// ================================================================
namespace BLE {
    let _lastSent = ""

    export function sendKeys(text: string): void {
        keyboard.sendString(text)
        _lastSent = text
    }

    export function sendSpecialKey(key: keyboard._Key): void {
        keyboard.sendString(keyboard.keys(key))
    }

    export function sendRawScancode(code: number): void {
        keyboard.sendString(keyboard.rawScancode(code))
    }

    export function mouseMove(x: number, y: number): void {
        mouse.movexy(
            Math.max(-127, Math.min(127, x)),
            Math.max(-127, Math.min(127, y))
        )
    }

    export function mouseClickLeft(): void {
        mouse.click()
    }

    export function mouseClickRight(): void {
        mouse.rightClick()
    }

    export function mouseScroll(amount: number): void {
        mouse.scroll(Math.max(-127, Math.min(127, amount)))
    }

    export function lastSent(): string { return _lastSent }
}

// ================================================================
// DL — Data Logger (wrapper datalogger extension)
// Salva dati sensori su flash, scaricabili via USB come CSV
// ================================================================
namespace DL {
    let _initialized = false
    let _logging = false
    let _logCount = 0

    export function init(): void {
        if (_initialized) return
        datalogger.includeTimestamp(FlashLogTimeStampFormat.Seconds)
        datalogger.setColumnTitles("temp", "light", "accel", "sound")
        _initialized = true
    }

    export function isLogging(): boolean { return _logging }
    export function logCount(): number { return _logCount }

    export function startLogging(): void {
        init()
        _logging = true
    }

    export function stopLogging(): void {
        _logging = false
    }

    export function toggleLogging(): void {
        if (_logging) stopLogging()
        else startLogging()
    }

    // Registra una riga di dati sensori
    export function logSensors(): void {
        if (!_logging) return
        datalogger.log(
            datalogger.createCV("temp", SENS.temp()),
            datalogger.createCV("light", SENS.light()),
            datalogger.createCV("accel", SENS.accelMag()),
            datalogger.createCV("sound", SENS.sound())
        )
        _logCount++
    }

    export function clearLog(): void {
        datalogger.deleteLog()
        _logCount = 0
    }
}

// ================================================================
// APP — Framework Applicazioni
// ================================================================
namespace APP {
    let _names: string[] = []
    let _icons: string[] = []
    let _stateNames: string[] = []
    let _colors: number[] = []

    export function register(name: string, icon: string, stateName: string, color: number): void {
        _names.push(name)
        _icons.push(icon)
        _stateNames.push(stateName)
        _colors.push(color)
    }

    export function count(): number { return _names.length }
    export function getName(i: number): string { return _names[i] }
    export function getIcon(i: number): string { return _icons[i] }
    export function getState(i: number): string { return _stateNames[i] }
    export function getColor(i: number): number { return _colors[i] }
}

// ================================================================
// REGISTRAZIONE APPLICAZIONI
// ================================================================
APP.register("Shell", "S", "app_shell", C_TEAL)
APP.register("File", "F", "app_files", C_ORANGE)
APP.register(LANG.t("Info", "Info"), "I", "app_sysinfo", C_LBLUE)
APP.register(LANG.t("Sensori", "Sensors"), "#", "app_sensors", C_OK)
APP.register("Snake", "~", "app_snake", C_OK)
APP.register(LANG.t("BLE Tast", "BLE Keys"), "K", "app_blekeys", C_PURPLE)
APP.register(LANG.t("BLE Ctrl", "BLE Ctrl"), "M", "app_blectrl", C_WARN)
APP.register(LANG.t("Config", "Settings"), "*", "app_config", C_GRAY)

// ================================================================
// LAUNCHER — Home Screen con Griglia Icone
// ================================================================
let _launchSel = 0
const LAUNCH_COLS = 4
const LAUNCH_CELL_W = Math.idiv(SCREEN_W, LAUNCH_COLS)
const LAUNCH_CELL_H = 46

states.setEnterHandler("launcher", function () {
    KBD.flush()
    _launchSel = 0
})

states.addLoopHandler("launcher", function () {
    KBD.updateRepeat()
    let k = KBD.poll()
    while (k >= 0) {
        const total = APP.count()
        const cols = LAUNCH_COLS
        const curCol = _launchSel % cols
        if (k === KBD.RIGHT) {
            _launchSel = (_launchSel + 1) % total
            SND.nav()
        } else if (k === KBD.LEFT) {
            _launchSel = (_launchSel + total - 1) % total
            SND.nav()
        } else if (k === KBD.DOWN) {
            const next = _launchSel + cols
            _launchSel = next < total ? next : curCol
            SND.nav()
        } else if (k === KBD.UP) {
            const prev = _launchSel - cols
            if (prev >= 0) {
                _launchSel = prev
            } else {
                const lastRow = Math.idiv(total - 1, cols)
                const target = lastRow * cols + curCol
                _launchSel = target < total ? target : total - 1
            }
            SND.nav()
        } else if (k === KBD.A) {
            SND.ok()
            states.setState(APP.getState(_launchSel))
        }
        k = KBD.poll()
    }

    // ---- Render ----
    FB.cls()
    UI.statusBar("BitOS", Kernel.uptimeStr())

    const topY = FONT_H + 6
    for (let i = 0; i < APP.count(); i++) {
        const col = i % LAUNCH_COLS
        const row = Math.idiv(i, LAUNCH_COLS)
        const cx = col * LAUNCH_CELL_W
        const cy = topY + row * LAUNCH_CELL_H
        const sel = i === _launchSel
        const iconSize = 22
        const iconX = cx + Math.idiv(LAUNCH_CELL_W - iconSize, 2)
        const iconY = cy + 2

        if (sel) {
            FB.fillRect(iconX, iconY, iconSize, iconSize, APP.getColor(i))
            FB.text(APP.getIcon(i), iconX + 8, iconY + 7, C_BG)
            FB.rect(iconX - 1, iconY - 1, iconSize + 2, iconSize + 2, C_FG)
        } else {
            FB.rect(iconX, iconY, iconSize, iconSize, APP.getColor(i))
            FB.text(APP.getIcon(i), iconX + 8, iconY + 7, APP.getColor(i))
        }
        const name = APP.getName(i)
        const nameX = cx + Math.idiv(LAUNCH_CELL_W - name.length * FONT_W, 2)
        FB.text(name, Math.max(cx, nameX), iconY + iconSize + 3, sel ? C_FG : C_GRAY)
    }

    FB.text("[A]" + LANG.t("Apri", "Open"), 4, SCREEN_H - FONT_H - 1, C_GRAY)
    if (Kernel.dimmed) FB.text("zzZ", SCREEN_W - 24, SCREEN_H - FONT_H - 1, C_GRAY)
    if (DL.isLogging()) FB.text("REC", SCREEN_W - 30, 1, C_ERR)

    basic.pause(33)
})

// ================================================================
// UTILITY
// ================================================================
function _exitToLauncher(): void {
    states.setState("launcher")
}

function _trim(s: string): string {
    let start = 0
    let end = s.length - 1
    while (start <= end && s.charAt(start) === " ") start++
    while (end >= start && s.charAt(end) === " ") end--
    if (start > end) return ""
    return s.substr(start, end - start + 1)
}

// ================================================================
// APP: SHELL — Terminale con Parser Comandi
// ================================================================
function _shellExec(cmd: string): void {
    if (cmd.length === 0) return
    FS.append("history", cmd + "\n")
    const parts = cmd.split(" ")
    const verb = parts[0]

    if (verb === "help") {
        TTY.writeln(LANG.t("Comandi:", "Commands:"))
        TTY.writeln(" help  ls  cat  echo")
        TTY.writeln(" rm  ps  clear  reboot")
        TTY.writeln(" temp  light  sound")
        TTY.writeln(" beep  free  uname  ble")
    } else if (verb === "ls") {
        const fl = FS.list()
        if (fl.length === 0) {
            TTY.writeln(LANG.t("(vuoto)", "(empty)"))
        } else {
            for (let i = 0; i < fl.length; i++) {
                TTY.writeln(" " + fl[i] + " " + convertToText(FS.fileSize(fl[i])) + "b")
            }
            TTY.writeln(convertToText(fl.length) + LANG.t(" file", " files"))
        }
    } else if (verb === "cat") {
        if (parts.length < 2) {
            TTY.writeln(LANG.t("uso: cat <file>", "usage: cat <file>"))
        } else {
            const content = FS.read(parts[1])
            if (content.length === 0 && !FS.exists(parts[1])) {
                TTY.writeln(LANG.t("non trovato: ", "not found: ") + parts[1])
            } else {
                TTY.writeln(content)
            }
        }
    } else if (verb === "echo") {
        const redir = cmd.indexOf(">")
        if (redir >= 0 && redir > 5) {
            const txt = _trim(cmd.substr(5, redir - 5))
            const fname = _trim(cmd.substr(redir + 1))
            if (fname.length > 0) {
                if (FS.write(fname, txt)) {
                    TTY.writeln(LANG.t("scritto: ", "written: ") + fname)
                } else {
                    TTY.writeln(LANG.t("errore scrittura", "write error"))
                }
            }
        } else if (cmd.length > 5) {
            TTY.writeln(cmd.substr(5))
        }
    } else if (verb === "rm") {
        if (parts.length < 2) {
            TTY.writeln(LANG.t("uso: rm <file>", "usage: rm <file>"))
        } else {
            if (FS.remove(parts[1])) TTY.writeln(LANG.t("rimosso", "removed"))
            else TTY.writeln(LANG.t("non trovato", "not found"))
        }
    } else if (verb === "ps") {
        const pl = PM.list()
        for (let i = 0; i < pl.length; i++) TTY.writeln(" " + pl[i])
        TTY.writeln(convertToText(pl.length) + LANG.t(" servizi", " services"))
    } else if (verb === "clear") {
        TTY.clear()
    } else if (verb === "reboot") {
        TTY.writeln(LANG.t("Riavvio...", "Rebooting..."))
        basic.pause(500)
        control.reset()
    } else if (verb === "temp") {
        TTY.writeln(LANG.t("Temp: ", "Temp: ") + convertToText(SENS.temp()) + "C")
    } else if (verb === "light") {
        TTY.writeln(LANG.t("Luce: ", "Light: ") + convertToText(SENS.light()))
    } else if (verb === "sound") {
        TTY.writeln(LANG.t("Suono: ", "Sound: ") + convertToText(SENS.sound()))
    } else if (verb === "beep") {
        SND.beep(440, 200)
        TTY.writeln("beep!")
    } else if (verb === "free") {
        TTY.writeln(LANG.t("Usati: ", "Used: ") + convertToText(FS.usedBytes()) + "b")
        TTY.writeln(LANG.t("Liberi: ", "Free: ") + convertToText(FS.freeBytes()) + "b")
        TTY.writeln(LANG.t("File: ", "Files: ") + convertToText(FS.fileCount()) + "/24")
    } else if (verb === "uname") {
        TTY.writeln("BitOS v1.0 microbit-v2")
        TTY.writeln("hash=" + convertToText(Kernel.hash))
    } else if (verb === "ble") {
        TTY.writeln("BLE HID: keyboard+mouse")
        TTY.writeln(LANG.t("Accoppia da host BT", "Pair from BT host"))
    } else {
        TTY.writeln(LANG.t("sconosciuto: ", "unknown: ") + verb)
    }
}

states.setEnterHandler("app_shell", function () {
    KBD.flush()
    TTY.init(FONT_H + 4)
    TTY.writeln("BitOS Shell v1.0")
    TTY.writeln(LANG.t("[A]=tastiera [B]=esci", "[A]=keyboard [B]=exit"))
    TTY.writeln(LANG.t("Digita 'help'", "Type 'help'"))
    TTY.write("$ ")
})

states.addLoopHandler("app_shell", function () {
    KBD.updateRepeat()
    let k = KBD.poll()
    while (k >= 0) {
        if (VKB.isVisible()) {
            VKB.handleKey(k)
        } else {
            if (k === KBD.B) { _exitToLauncher(); return }
            else if (k === KBD.A) {
                VKB.show(function (inp: string) {
                    if (inp.length > 0) {
                        TTY.writeln(inp)
                        _shellExec(inp)
                        TTY.write("$ ")
                    }
                }, "")
            }
        }
        k = KBD.poll()
    }
    FB.cls()
    UI.statusBar("Shell", Kernel.uptimeStr())
    TTY.render()
    if (VKB.isVisible()) VKB.render()
    basic.pause(33)
})

states.setExitHandler("app_shell", function () { VKB.hide() })

// ================================================================
// APP: FILE MANAGER
// ================================================================
let _fmSel = 0
let _fmMode = 0   // 0=lista 1=visualizza 2=conferma elimina
let _fmScroll = 0
let _fmViewContent = ""

states.setEnterHandler("app_files", function () {
    KBD.flush()
    _fmSel = 0; _fmMode = 0; _fmScroll = 0; _fmViewContent = ""
})

states.addLoopHandler("app_files", function () {
    KBD.updateRepeat()
    const flist = FS.list()
    let k = KBD.poll()
    while (k >= 0) {
        if (_fmMode === 0) {
            if (k === KBD.B) { _exitToLauncher(); return }
            else if (k === KBD.UP && flist.length > 0) {
                _fmSel = (_fmSel + flist.length - 1) % flist.length; SND.nav()
            } else if (k === KBD.DOWN && flist.length > 0) {
                _fmSel = (_fmSel + 1) % flist.length; SND.nav()
            } else if (k === KBD.A && flist.length > 0) {
                _fmViewContent = FS.read(flist[_fmSel]); _fmMode = 1; _fmScroll = 0; SND.ok()
            } else if (k === KBD.MENU && flist.length > 0) {
                UI.confirmReset(); _fmMode = 2
            }
        } else if (_fmMode === 1) {
            if (k === KBD.B) _fmMode = 0
            else if (k === KBD.UP && _fmScroll > 0) _fmScroll--
            else if (k === KBD.DOWN) _fmScroll++
        } else if (_fmMode === 2) {
            const res = UI.confirmKey(k)
            if (res === 1) {
                FS.remove(flist[_fmSel])
                _fmMode = 0; _fmSel = Math.max(0, _fmSel - 1); SND.ok()
            } else if (res === 0) { _fmMode = 0 }
        }
        k = KBD.poll()
    }
    // Render
    FB.cls()
    UI.statusBar(LANG.t("File Manager", "File Manager"), convertToText(FS.fileCount()) + "/24")
    if (_fmMode === 0) {
        if (flist.length === 0) FB.centerText(LANG.t("Nessun file", "No files"), 50, C_GRAY)
        else UI.menu(flist, _fmSel, 2, FONT_H + 6, SCREEN_W - 4, 10)
        FB.text("[A]" + LANG.t("Apri", "Open") + " [M]" + LANG.t("Elim", "Del"), 2, SCREEN_H - FONT_H - 1, C_GRAY)
    } else if (_fmMode === 1) {
        FB.text(flist[_fmSel], 2, FONT_H + 4, C_LBLUE)
        FB.hline(0, FONT_H + 13, SCREEN_W, C_GRAY)
        const lines = _fmViewContent.split("\n")
        for (let i = _fmScroll; i < Math.min(lines.length, _fmScroll + 10); i++)
            FB.text(lines[i].substr(0, TTY_COLS), 2, FONT_H + 16 + (i - _fmScroll) * FONT_H, C_FG)
        FB.text("[B]" + LANG.t("Indietro", "Back"), 2, SCREEN_H - FONT_H - 1, C_GRAY)
    } else if (_fmMode === 2) {
        if (flist.length > 0) UI.menu(flist, _fmSel, 2, FONT_H + 6, SCREEN_W - 4, 10)
        UI.confirmDraw(LANG.t("Elimina?", "Delete?"), flist[_fmSel])
    }
    basic.pause(33)
})

// ================================================================
// APP: SYSTEM INFO
// ================================================================
states.setEnterHandler("app_sysinfo", function () { KBD.flush() })

states.addLoopHandler("app_sysinfo", function () {
    let k = KBD.poll()
    while (k >= 0) {
        if (k === KBD.B) { _exitToLauncher(); return }
        k = KBD.poll()
    }
    FB.cls()
    UI.statusBar(LANG.t("Sistema", "System"), Kernel.uptimeStr())
    const lx = 4
    let ly = FONT_H + 8

    FB.text("BitOS v1.0", lx, ly, C_LBLUE); ly += FONT_H + 4
    FB.text("Hash: " + convertToText(Kernel.hash), lx, ly, C_FG); ly += FONT_H + 2
    FB.text("Tick: " + convertToText(Kernel.tick), lx, ly, C_FG); ly += FONT_H + 2
    FB.text("Uptime: " + Kernel.uptimeStr(), lx, ly, C_FG); ly += FONT_H + 4

    FB.text(LANG.t("-- Filesystem --", "-- Filesystem --"), lx, ly, C_TEAL); ly += FONT_H + 2
    FB.text(LANG.t("File: ", "Files: ") + convertToText(FS.fileCount()) + "/24", lx, ly, C_FG); ly += FONT_H + 2
    FB.text(LANG.t("Usati: ", "Used: ") + convertToText(FS.usedBytes()) + "b", lx, ly, C_FG); ly += FONT_H + 4

    FB.text(LANG.t("-- Sensori --", "-- Sensors --"), lx, ly, C_TEAL); ly += FONT_H + 2
    FB.text(LANG.t("Temp: ", "Temp: ") + convertToText(SENS.temp()) + "C", lx, ly, C_FG); ly += FONT_H + 2
    FB.text(LANG.t("Luce: ", "Light: ") + convertToText(SENS.light()), lx, ly, C_FG)

    // Colonna destra
    const rx = 82
    let ry = FONT_H + 8
    FB.text("-- BLE HID --", rx, ry, C_TEAL); ry += FONT_H + 2
    FB.text("Keyboard: ON", rx, ry, C_FG); ry += FONT_H + 2
    FB.text("Mouse: ON", rx, ry, C_FG); ry += FONT_H + 4
    FB.text(LANG.t("-- Servizi --", "-- Services --"), rx, ry, C_TEAL); ry += FONT_H + 2
    FB.text(convertToText(PM.serviceCount()) + LANG.t(" attivi", " active"), rx, ry, C_FG); ry += FONT_H + 4
    FB.text(LANG.t("-- Data Log --", "-- Data Log --"), rx, ry, C_TEAL); ry += FONT_H + 2
    FB.text(DL.isLogging() ? "REC" : "OFF", rx, ry, DL.isLogging() ? C_ERR : C_GRAY); ry += FONT_H + 2
    FB.text(LANG.t("Righe: ", "Rows: ") + convertToText(DL.logCount()), rx, ry, C_FG)

    FB.text("[B]" + LANG.t("Esci", "Exit"), 4, SCREEN_H - FONT_H - 1, C_GRAY)
    basic.pause(100)
})

// ================================================================
// APP: SENSOR DASHBOARD + Data Logger
// ================================================================
let _snsSel = 0
let _snsHistory: number[] = []
const SNS_HIST_LEN = 80
const SNS_GRAPH_H = 50
const SNS_GRAPH_Y = 40

states.setEnterHandler("app_sensors", function () {
    KBD.flush()
    _snsSel = 0
    _snsHistory = []
    for (let i = 0; i < SNS_HIST_LEN; i++) _snsHistory.push(0)
})

states.addLoopHandler("app_sensors", function () {
    let k = KBD.poll()
    while (k >= 0) {
        if (k === KBD.B) { _exitToLauncher(); return }
        else if (k === KBD.LEFT) {
            _snsSel = (_snsSel + 3) % 4
            _snsHistory = []
            for (let j = 0; j < SNS_HIST_LEN; j++) _snsHistory.push(0)
            SND.nav()
        } else if (k === KBD.RIGHT) {
            _snsSel = (_snsSel + 1) % 4
            _snsHistory = []
            for (let j2 = 0; j2 < SNS_HIST_LEN; j2++) _snsHistory.push(0)
            SND.nav()
        } else if (k === KBD.MENU) {
            DL.toggleLogging()
            SND.ok()
        } else if (k === KBD.A) {
            DL.clearLog()
            SND.click()
        }
        k = KBD.poll()
    }

    // Lettura sensore selezionato
    let val = 0
    let maxV = 100
    let label = ""
    let unit = ""
    if (_snsSel === 0) {
        val = SENS.temp(); maxV = 50
        label = LANG.t("Temperatura", "Temperature"); unit = "C"
    } else if (_snsSel === 1) {
        val = SENS.light(); maxV = 255
        label = LANG.t("Luce", "Light"); unit = ""
    } else if (_snsSel === 2) {
        val = SENS.accelMag(); maxV = 300
        label = LANG.t("Accelerometro", "Accelerometer"); unit = "mg"
    } else {
        val = SENS.sound(); maxV = 255
        label = LANG.t("Microfono", "Microphone"); unit = ""
    }

    // Aggiorna history
    _snsHistory.removeAt(0)
    _snsHistory.push(val)

    // Data logging (se attivo)
    DL.logSensors()

    // Render
    FB.cls()
    UI.statusBar(LANG.t("Sensori", "Sensors"), DL.isLogging() ? "REC" : Kernel.uptimeStr())

    // Tabs
    const tabs = [
        LANG.t("Tmp", "Tmp"), LANG.t("Lux", "Lux"),
        LANG.t("Acc", "Acc"), LANG.t("Mic", "Mic")
    ]
    const tabW = Math.idiv(SCREEN_W, 4)
    for (let ti = 0; ti < 4; ti++) {
        const tx = ti * tabW
        if (ti === _snsSel) {
            FB.fillRect(tx, FONT_H + 3, tabW, FONT_H + 2, C_TEAL)
            FB.text(tabs[ti], tx + 4, FONT_H + 4, C_BG)
        } else {
            FB.text(tabs[ti], tx + 4, FONT_H + 4, C_GRAY)
        }
    }

    // Valore corrente + logging status
    FB.text(label + ": " + convertToText(val) + unit, 4, FONT_H + 16, C_FG)
    if (DL.isLogging()) {
        FB.text("LOG:" + convertToText(DL.logCount()), SCREEN_W - 60, FONT_H + 16, C_ERR)
    }

    // Grafico
    FB.rect(4, SNS_GRAPH_Y, SNS_HIST_LEN + 2, SNS_GRAPH_H + 2, C_GRAY)
    for (let hi = 0; hi < _snsHistory.length; hi++) {
        const hVal = Math.min(_snsHistory[hi], maxV)
        const barH = Math.idiv(hVal * SNS_GRAPH_H, Math.max(maxV, 1))
        if (barH > 0) {
            FB.vline(5 + hi, SNS_GRAPH_Y + SNS_GRAPH_H - barH + 1, barH, C_OK)
        }
    }
    FB.text(convertToText(maxV), SNS_HIST_LEN + 8, SNS_GRAPH_Y, C_GRAY)
    FB.text("0", SNS_HIST_LEN + 8, SNS_GRAPH_Y + SNS_GRAPH_H - FONT_H, C_GRAY)

    FB.text("[M]Log [A]" + LANG.t("Canc", "Clr") + " [</>]Tab", 4, SCREEN_H - FONT_H - 1, C_GRAY)
    basic.pause(100)
})

// ================================================================
// APP: SNAKE GAME
// ================================================================
const SN_COLS = 19
const SN_ROWS = 12
const SN_CELL = 8
const SN_OX = 4
const SN_OY = FONT_H + 4

let _snX: number[] = []
let _snY: number[] = []
let _snDir = 1
let _snNextDir = 1
let _snFx = 0
let _snFy = 0
let _snScore = 0
let _snAlive = true
let _snTick = 0
let _snSpeed = 5
let _snHigh = 0

function _snInit(): void {
    _snX = [4, 3, 2]
    _snY = [Math.idiv(SN_ROWS, 2), Math.idiv(SN_ROWS, 2), Math.idiv(SN_ROWS, 2)]
    _snDir = 1; _snNextDir = 1
    _snScore = 0; _snAlive = true; _snTick = 0; _snSpeed = 5
    _snSpawnFood()
}

function _snSpawnFood(): void {
    let att = 0
    do {
        _snFx = randint(0, SN_COLS - 1)
        _snFy = randint(0, SN_ROWS - 1)
        att++
    } while (_snCollides(_snFx, _snFy) && att < 100)
}

function _snCollides(x: number, y: number): boolean {
    for (let i = 0; i < _snX.length; i++) {
        if (_snX[i] === x && _snY[i] === y) return true
    }
    return false
}

function _snMove(): void {
    _snDir = _snNextDir
    let hx = _snX[0]
    let hy = _snY[0]
    if (_snDir === 0) hy--
    else if (_snDir === 1) hx++
    else if (_snDir === 2) hy++
    else hx--

    // Wrap
    if (hx < 0) hx = SN_COLS - 1
    else if (hx >= SN_COLS) hx = 0
    if (hy < 0) hy = SN_ROWS - 1
    else if (hy >= SN_ROWS) hy = 0

    if (_snCollides(hx, hy)) {
        _snAlive = false
        SND.error()
        if (_snScore > _snHigh) _snHigh = _snScore
        return
    }
    _snX.insertAt(0, hx)
    _snY.insertAt(0, hy)
    if (hx === _snFx && hy === _snFy) {
        _snScore++
        SND.ok()
        _snSpawnFood()
        if (_snSpeed > 2 && _snScore % 5 === 0) _snSpeed--
    } else {
        _snX.pop()
        _snY.pop()
    }
}

states.setEnterHandler("app_snake", function () {
    KBD.flush()
    _snInit()
})

states.addLoopHandler("app_snake", function () {
    KBD.updateRepeat()
    let k = KBD.poll()
    while (k >= 0) {
        if (!_snAlive) {
            if (k === KBD.A) { _snInit(); SND.ok() }
            else if (k === KBD.B) { _exitToLauncher(); return }
        } else {
            if (k === KBD.UP && _snDir !== 2) _snNextDir = 0
            else if (k === KBD.RIGHT && _snDir !== 3) _snNextDir = 1
            else if (k === KBD.DOWN && _snDir !== 0) _snNextDir = 2
            else if (k === KBD.LEFT && _snDir !== 1) _snNextDir = 3
            else if (k === KBD.B) { _exitToLauncher(); return }
        }
        k = KBD.poll()
    }

    if (_snAlive) {
        _snTick++
        if (_snTick >= _snSpeed) { _snTick = 0; _snMove() }
    }

    FB.cls()
    UI.statusBar("Snake", LANG.t("Punti:", "Score:") + convertToText(_snScore))
    FB.rect(SN_OX - 1, SN_OY - 1, SN_COLS * SN_CELL + 2, SN_ROWS * SN_CELL + 2, C_GRAY)

    FB.fillRect(SN_OX + _snFx * SN_CELL + 1, SN_OY + _snFy * SN_CELL + 1,
        SN_CELL - 2, SN_CELL - 2, C_ERR)

    for (let s = 0; s < _snX.length; s++) {
        FB.fillRect(SN_OX + _snX[s] * SN_CELL, SN_OY + _snY[s] * SN_CELL,
            SN_CELL - 1, SN_CELL - 1, s === 0 ? C_OK : C_TEAL)
    }

    FB.text("HI:" + convertToText(_snHigh), SCREEN_W - 50, SCREEN_H - FONT_H - 1, C_GRAY)

    if (!_snAlive) {
        FB.fillRect(20, 40, 120, 40, C_BG)
        FB.rect(20, 40, 120, 40, C_ERR)
        FB.centerText("GAME OVER", 46, C_ERR)
        FB.centerText(LANG.t("Punti: ", "Score: ") + convertToText(_snScore), 56, C_FG)
        FB.centerText("[A]" + LANG.t("Rigioca", "Retry") + " [B]" + LANG.t("Esci", "Exit"), 68, C_GRAY)
    }
    basic.pause(33)
})

// ================================================================
// APP: BLE TASTIERA — Invio tasti via Bluetooth HID
// ================================================================
let _bkLastSent = ""
let _bkSpecialMode = false  // false=testo, true=tasti speciali

states.setEnterHandler("app_blekeys", function () {
    KBD.flush()
    _bkLastSent = ""
    _bkSpecialMode = false
})

states.addLoopHandler("app_blekeys", function () {
    KBD.updateRepeat()
    let k = KBD.poll()
    while (k >= 0) {
        if (VKB.isVisible()) {
            VKB.handleKey(k)
        } else {
            if (k === KBD.B) { _exitToLauncher(); return }
            else if (k === KBD.MENU) {
                _bkSpecialMode = !_bkSpecialMode
                SND.nav()
            } else if (k === KBD.A) {
                if (_bkSpecialMode) {
                    // Tasto Invio
                    BLE.sendSpecialKey(keyboard._Key.enter)
                    _bkLastSent = "[Enter]"
                    SND.click()
                } else {
                    VKB.show(function (txt: string) {
                        if (txt.length > 0) {
                            BLE.sendKeys(txt)
                            _bkLastSent = txt
                            SND.ok()
                        }
                    }, "")
                }
            } else if (_bkSpecialMode) {
                if (k === KBD.UP) {
                    BLE.sendSpecialKey(keyboard._Key.up)
                    _bkLastSent = "[Up]"
                    SND.click()
                } else if (k === KBD.DOWN) {
                    BLE.sendSpecialKey(keyboard._Key.down)
                    _bkLastSent = "[Down]"
                    SND.click()
                } else if (k === KBD.LEFT) {
                    BLE.sendSpecialKey(keyboard._Key.left)
                    _bkLastSent = "[Left]"
                    SND.click()
                } else if (k === KBD.RIGHT) {
                    BLE.sendSpecialKey(keyboard._Key.right)
                    _bkLastSent = "[Right]"
                    SND.click()
                }
            }
        }
        k = KBD.poll()
    }

    // Render
    FB.cls()
    UI.statusBar(LANG.t("BLE Tastiera", "BLE Keyboard"), "HID")

    const modeStr = _bkSpecialMode ?
        LANG.t("Tasti Speciali", "Special Keys") :
        LANG.t("Testo Libero", "Free Text")
    FB.text(LANG.t("Modo: ", "Mode: ") + modeStr, 4, FONT_H + 8, C_LBLUE)

    if (_bkLastSent.length > 0) {
        FB.text(LANG.t("Ultimo: ", "Last: "), 4, FONT_H + 22, C_GRAY)
        FB.text(_bkLastSent.substr(0, 22), 4, FONT_H + 32, C_FG)
    }

    if (_bkSpecialMode) {
        // Mostra mappa tasti speciali
        const ky = FONT_H + 48
        FB.rect(60, ky, 40, 14, C_TEAL)
        FB.text(" Up ", 64, ky + 3, C_TEAL)
        FB.rect(20, ky + 16, 40, 14, C_TEAL)
        FB.text(" Left", 22, ky + 19, C_TEAL)
        FB.rect(100, ky + 16, 40, 14, C_TEAL)
        FB.text("Right", 102, ky + 19, C_TEAL)
        FB.rect(60, ky + 16, 40, 14, C_TEAL)
        FB.text("Down", 64, ky + 19, C_TEAL)
        FB.rect(60, ky + 32, 40, 14, C_OK)
        FB.text("Enter", 62, ky + 35, C_OK)

        FB.text("[A]=Enter [D-pad]=Frecce", 4, SCREEN_H - 18, C_GRAY)
    } else {
        // Istruzioni testo
        FB.text(LANG.t("Accoppia micro:bit dal", "Pair micro:bit from"), 4, FONT_H + 50, C_GRAY)
        FB.text(LANG.t("menu Bluetooth del PC", "PC Bluetooth menu"), 4, FONT_H + 60, C_GRAY)
        FB.text("[A]=" + LANG.t("Scrivi testo", "Type text"), 4, SCREEN_H - 18, C_GRAY)
    }
    FB.text("[M]" + LANG.t("Cambia modo", "Switch mode"), 4, SCREEN_H - FONT_H - 1, C_GRAY)

    if (VKB.isVisible()) VKB.render()
    basic.pause(33)
})

states.setExitHandler("app_blekeys", function () { VKB.hide() })

// ================================================================
// APP: BLE CONTROLLER — Mouse / Frecce via BLE HID
// ================================================================
let _bcMode = 0            // 0=mouse, 1=frecce
let _bcDeadZone = 150      // dead zone accelerometro (mg)
let _bcSensitivity = 24    // divisore sensibilità mouse

states.setEnterHandler("app_blectrl", function () {
    KBD.flush()
    _bcMode = 0
})

states.addLoopHandler("app_blectrl", function () {
    let k = KBD.poll()
    while (k >= 0) {
        if (k === KBD.B) { _exitToLauncher(); return }
        else if (k === KBD.MENU) {
            _bcMode = (_bcMode + 1) % 2
            SND.nav()
        } else if (_bcMode === 0) {
            // Modalità Mouse
            if (k === KBD.A) { BLE.mouseClickLeft(); SND.click() }
            else if (k === KBD.UP) { BLE.mouseScroll(3) }
            else if (k === KBD.DOWN) { BLE.mouseScroll(-3) }
        } else if (_bcMode === 1) {
            // Modalità Frecce
            if (k === KBD.UP) { BLE.sendSpecialKey(keyboard._Key.up); SND.click() }
            else if (k === KBD.DOWN) { BLE.sendSpecialKey(keyboard._Key.down); SND.click() }
            else if (k === KBD.LEFT) { BLE.sendSpecialKey(keyboard._Key.left); SND.click() }
            else if (k === KBD.RIGHT) { BLE.sendSpecialKey(keyboard._Key.right); SND.click() }
            else if (k === KBD.A) { BLE.sendSpecialKey(keyboard._Key.enter); SND.click() }
        }
        k = KBD.poll()
    }

    // Mouse: accelerometro → movimento cursore
    if (_bcMode === 0) {
        const rawX = input.acceleration(Dimension.X)
        const rawY = input.acceleration(Dimension.Y)
        let mx = 0
        let my = 0
        if (Math.abs(rawX) > _bcDeadZone) {
            mx = Math.idiv(rawX - (rawX > 0 ? _bcDeadZone : 0 - _bcDeadZone), _bcSensitivity)
        }
        if (Math.abs(rawY) > _bcDeadZone) {
            my = Math.idiv(rawY - (rawY > 0 ? _bcDeadZone : 0 - _bcDeadZone), _bcSensitivity)
        }
        if (mx !== 0 || my !== 0) {
            BLE.mouseMove(mx, my)
        }
    }

    // Render
    FB.cls()
    const modeLabel = _bcMode === 0 ?
        LANG.t("Mouse", "Mouse") :
        LANG.t("Frecce", "Arrows")
    UI.statusBar("BLE Ctrl", modeLabel)

    if (_bcMode === 0) {
        // Mouse mode visual
        FB.text(LANG.t("Inclina per muovere", "Tilt to move"), 4, FONT_H + 8, C_FG)

        // Barre accelerometro
        const axVal = input.acceleration(Dimension.X)
        const ayVal = input.acceleration(Dimension.Y)
        FB.text("X:", 4, FONT_H + 24, C_FG)
        const xBar = Math.idiv((axVal + 2000) * 100, 4000)
        UI.progressBar(20, FONT_H + 24, 100, FONT_H, xBar, 100, C_LBLUE)
        FB.text(convertToText(axVal), 124, FONT_H + 24, C_GRAY)

        FB.text("Y:", 4, FONT_H + 38, C_FG)
        const yBar = Math.idiv((ayVal + 2000) * 100, 4000)
        UI.progressBar(20, FONT_H + 38, 100, FONT_H, yBar, 100, C_LBLUE)
        FB.text(convertToText(ayVal), 124, FONT_H + 38, C_GRAY)

        // Crosshair visuale
        const chX = 80 + Math.idiv(axVal, 40)
        const chY = 76 + Math.idiv(ayVal, 50)
        FB.rect(30, 56, 100, 50, C_GRAY)
        FB.line(80, 56, 80, 106, C_GRAY)
        FB.line(30, 81, 130, 81, C_GRAY)
        const cX = Math.max(32, Math.min(128, chX))
        const cY = Math.max(58, Math.min(104, chY))
        FB.fillRect(cX - 2, cY - 2, 5, 5, C_OK)

        FB.text("[A]=Click [^v]=Scroll", 4, SCREEN_H - FONT_H - 1, C_GRAY)
    } else {
        // Arrow keys mode
        FB.text(LANG.t("D-pad = Tasti freccia", "D-pad = Arrow keys"), 4, FONT_H + 8, C_FG)
        FB.text("[A] = Enter", 4, FONT_H + 22, C_FG)

        // Visualizzazione tasti
        const ky2 = FONT_H + 44
        const kx2 = 50
        FB.rect(kx2 + 20, ky2, 24, 18, C_TEAL)
        FB.text("UP", kx2 + 24, ky2 + 5, C_TEAL)
        FB.rect(kx2, ky2 + 20, 24, 18, C_TEAL)
        FB.text("LT", kx2 + 4, ky2 + 25, C_TEAL)
        FB.rect(kx2 + 40, ky2 + 20, 24, 18, C_TEAL)
        FB.text("RT", kx2 + 44, ky2 + 25, C_TEAL)
        FB.rect(kx2 + 20, ky2 + 20, 24, 18, C_TEAL)
        FB.text("DN", kx2 + 24, ky2 + 25, C_TEAL)

        FB.text("[D-pad]=" + LANG.t("Frecce", "Arrows"), 4, SCREEN_H - FONT_H - 1, C_GRAY)
    }

    FB.text("[M]" + LANG.t("Modo", "Mode"), SCREEN_W - 50, SCREEN_H - FONT_H - 1, C_GRAY)
    basic.pause(33)
})

// ================================================================
// APP: IMPOSTAZIONI
// ================================================================
let _cfgSel = 0
let _cfgMode = 0  // 0=menu 1=conferma reset

function _cfgItems(): string[] {
    return [
        LANG.t("Lingua: ", "Language: ") + (LANG.id === 0 ? "IT" : "EN"),
        LANG.t("Suono: ", "Sound: ") + (SND.isMuted() ? "OFF" : "ON"),
        LANG.t("Data Log: ", "Data Log: ") + (DL.isLogging() ? "REC" : "OFF"),
        LANG.t("Cancella log", "Clear log"),
        LANG.t("Reset filesystem", "Reset filesystem"),
        LANG.t("Riavvia", "Reboot"),
        LANG.t("Info", "About")
    ]
}

states.setEnterHandler("app_config", function () {
    KBD.flush()
    _cfgSel = 0; _cfgMode = 0
})

states.addLoopHandler("app_config", function () {
    KBD.updateRepeat()
    const items = _cfgItems()
    let k = KBD.poll()
    while (k >= 0) {
        if (_cfgMode === 0) {
            if (k === KBD.B) { _exitToLauncher(); return }
            else if (k === KBD.UP) {
                _cfgSel = (_cfgSel + items.length - 1) % items.length; SND.nav()
            } else if (k === KBD.DOWN) {
                _cfgSel = (_cfgSel + 1) % items.length; SND.nav()
            } else if (k === KBD.A) {
                SND.click()
                if (_cfgSel === 0) {
                    LANG.set(LANG.id === 0 ? 1 : 0)
                } else if (_cfgSel === 1) {
                    SND.setMute(!SND.isMuted())
                } else if (_cfgSel === 2) {
                    DL.toggleLogging()
                } else if (_cfgSel === 3) {
                    DL.clearLog()
                    SND.ok()
                } else if (_cfgSel === 4) {
                    UI.confirmReset()
                    _cfgMode = 1
                } else if (_cfgSel === 5) {
                    control.reset()
                }
            }
        } else if (_cfgMode === 1) {
            const res = UI.confirmKey(k)
            if (res === 1) {
                FS.format()
                SND.ok()
                _cfgMode = 0
            } else if (res === 0) { _cfgMode = 0 }
        }
        k = KBD.poll()
    }
    // Render
    FB.cls()
    UI.statusBar(LANG.t("Impostazioni", "Settings"), "")
    if (_cfgMode === 0) {
        UI.menu(items, _cfgSel, 2, FONT_H + 6, SCREEN_W - 4, 8)
        if (_cfgSel === 6) {
            FB.text("BitOS v1.0", 4, SCREEN_H - 3 * FONT_H, C_LBLUE)
            FB.text("micro:bit V2 + BLE HID", 4, SCREEN_H - 2 * FONT_H, C_GRAY)
        }
        FB.text("[B]" + LANG.t("Esci", "Exit"), 4, SCREEN_H - FONT_H - 1, C_GRAY)
    } else if (_cfgMode === 1) {
        UI.menu(items, _cfgSel, 2, FONT_H + 6, SCREEN_W - 4, 8)
        UI.confirmDraw(
            LANG.t("Reset FS?", "Reset FS?"),
            LANG.t("Tutti i file persi!", "All files lost!")
        )
    }
    basic.pause(50)
})

// ================================================================
// SEQUENZA DI BOOT
// ================================================================
states.setEnterHandler("boot", function () { FB.cls() })

states.addLoopHandler("boot", function () {
    FB.cls()
    FB.centerText("BitOS", 16, C_LBLUE)
    FB.centerText("v1.0", 26, C_GRAY)

    const elapsed = input.runningTime()
    const progress = Math.min(Math.idiv(elapsed, 15), 100)
    UI.progressBar(20, 44, 120, 10, progress, 100, C_TEAL)
    FB.centerText(convertToText(progress) + "%", 58, C_GRAY)

    if (progress < 25) {
        FB.centerText(LANG.t("Avvio kernel...", "Booting kernel..."), 76, C_FG)
    } else if (progress < 50) {
        FB.centerText(LANG.t("Inizializzo BLE...", "Init BLE..."), 76, C_FG)
    } else if (progress < 75) {
        FB.centerText(LANG.t("Carico driver...", "Loading drivers..."), 76, C_FG)
    } else if (progress < 100) {
        FB.centerText(LANG.t("Avvio sistema...", "Starting system..."), 76, C_FG)
    } else {
        FB.centerText(LANG.t("Pronto!", "Ready!"), 76, C_OK)
    }

    FB.text("micro:bit V2 + BLE", 28, 100, C_GRAY)

    if (progress >= 100) {
        basic.pause(400)
        states.setState("launcher")
    }
    basic.pause(33)
})

// ================================================================
// INIZIALIZZAZIONE SISTEMA
// (BLE services già avviati in cima al file)
// ================================================================
KBD.init()

if (!Kernel.boot()) {
    Kernel.panic(0xBAAD, "integrity fail")
}

Kernel.startWatchdog()
SND.bootMelody()

Kernel.running = true
states.setState("boot")
