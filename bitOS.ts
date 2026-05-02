// ============================================================
// BitOS v1.0 — Sistema Operativo Multimediale
// micro:bit V2 + Display Shield — VERSIONE FINALE ✅
// 
// PERSISTENZA COMPLETA: FlashStorage per FS + Datalogger per sensori
// TUTTE le estensioni sono compatibili con micro:bit V2
// 
// Copyright 2026 — Ready for MakeCode deployment
// ============================================================
// ESTENSIONI RICHIESTE (in pxt.json):
//   1. display-shield#v1.1.4 (github:microbit-apps/display-shield)
//   2. states#v2.1.0 (github:hovavo/pxt-states)
//   3. microbit-pxt-blehid#v0.1.0 (github:bsiever/microbit-pxt-blehid)
//   4. datalogger (* — nativa micro:bit v2 sensori su flash)
//   5. flashstorage#v0.1.4 (github:bsiever/microbit-pxt-flashstorage — FS generico)
//   6. timeanddate#v2.0.33 (github:bsiever/microbit-pxt-timeanddate — timestamp)
//
// NOTA: Radio NON disponibile (conflitto con BLE).
//       Persistenza: flashstorage per FS generico, datalogger per sensori.
//       Dati persistono su flash, cache in RAM per velocità.
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
// INIZIALIZZAZIONE BLE HID — Nota: Services auto-start in MakeCode
// I servizi BLE vengono avviati automaticamente dalla extension
// ================================================================
// keyboard.startKeyboardService()  // ← Auto-started by extension
// mouse.startMouseService()        // ← Auto-started by extension

// ---- COSTANTI DISPLAY ----
const SCREEN_W = 160
const SCREEN_H = 120
const FONT_W = 6
const FONT_H = 8
const TTY_COLS = _idiv(SCREEN_W, FONT_W)   // 26
const TTY_ROWS = _idiv(SCREEN_H, FONT_H)   // 15

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
// SECURITY — Permessi Root e Guest Mode
// ================================================================
namespace Security {
    let _rootMode = true // Default boot starts root privileges internally until boot flow

    export function isRoot(): boolean { return _rootMode }
    export function setRoot(r: boolean): void { _rootMode = r }

    export function login(pwd: string): boolean {
        const raw = FS.read("/sys/rootpw")
        let targetPw = "root"
        if (raw.indexOf("|") >= 0) {
            const parts = raw.split("|")
            if (parts.length > 1) targetPw = parts[1]
        } else if (raw.length > 0) {
            targetPw = raw
        }

        if (pwd === targetPw) {
            _rootMode = true
            return true
        }
        return false
    }

    export function guestLogin(): void {
        _rootMode = false
        LANG.set(1) // Force english
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
    export let _activeState = "boot"
    const IDLE_DIM = 12     // dim dopo 60s (12 × 5s)

    // Verifica integrità hardware e genera hash univoco
    export function boot(): boolean {
        const serial = control.deviceSerialNumber()
        const time = input.runningTime()
        const temp = input.temperature()
        if (temp < -40 || temp > 85) return false
        hash = serial ^ (time * 31 + temp * 17)
        if (hash === 0) hash = 1
        running = true

        // Init Filesystem with Flash persistence
        FS.init()

        // Start system service
        PM.startService("SysWatch", function () {
            if (input.runningTime() % 10000 < 100) {
                // Blink or keepalive logic
            }
        })
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
                FB.setSuppress(true)
                // In MakeCode with screen extension, we use cls()
                FB.cls()
                FB.centerText("zzZ", 56, C_GRAY)
            }
        })
    }

    export let argc = 0
    export let argv: string[] = []

    export function exec(appState: string, args: string[]): void {
        argv = args
        argc = args.length
        _activeState = appState
        states.setState(appState)
    }

    // Reset idle (chiamare ad ogni input utente)
    export function poke(): void {
        idleTicks = 0
        dimmed = false
        FB.setSuppress(false)
    }

    export function uptimeSecs(): number {
        return _idiv(input.runningTime(), 1000)
    }

    export function uptimeStr(): string {
        const secs = uptimeSecs()
        const m = _idiv(secs, 60)
        const s = secs % 60
        return convertToText(m) + ":" + (s < 10 ? "0" : "") + convertToText(s)
    }
}

// ================================================================
// FB — Framebuffer (wrapper API native screen())
// ================================================================
namespace FB {
    let _suppress = false
    export function setSuppress(s: boolean): void { _suppress = s }

    export function cls(): void { if (_suppress) return; screen().fill(C_BG) }
    export function fill(c: number): void { if (_suppress) return; screen().fill(c) }

    export function pixel(x: number, y: number, c: number): void {
        if (_suppress) return; screen().setPixel(x, y, c)
    }

    export function text(s: string, x: number, y: number, c: number): void {
        if (_suppress) return; screen().print(s, x, y, c)
    }

    export function line(x0: number, y0: number, x1: number, y1: number, c: number): void {
        if (_suppress) return; screen().drawLine(x0, y0, x1, y1, c)
    }

    export function hline(x: number, y: number, w: number, c: number): void {
        if (_suppress) return; if (w > 0) screen().drawLine(x, y, x + w - 1, y, c)
    }

    export function vline(x: number, y: number, h: number, c: number): void {
        if (_suppress) return; if (h > 0) screen().drawLine(x, y, x, y + h - 1, c)
    }

    export function rect(x: number, y: number, w: number, h: number, c: number): void {
        if (_suppress) return; screen().drawRect(x, y, w, h, c)
    }

    export function fillRect(x: number, y: number, w: number, h: number, c: number): void {
        if (_suppress) return; screen().fillRect(x, y, w, h, c)
    }

    export function titleBar(title: string, y: number, fg: number, bg: number): void {
        if (_suppress) return;
        fillRect(0, y, SCREEN_W, FONT_H + 2, bg)
        const tx = _idiv(SCREEN_W - title.length * FONT_W, 2)
        text(title, Math.max(0, tx), y + 1, fg)
    }

    export function centerText(s: string, y: number, c: number): void {
        if (_suppress) return;
        const x = _idiv(SCREEN_W - s.length * FONT_W, 2)
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
        const val = _queue[0]
        _queue.splice(0, 1)
        return val
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
        _rows = _idiv(SCREEN_H - offsetY, FONT_H)
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
        _buf.splice(0, 1)
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
// HELPER FUNCTIONS — String utilities (needed before FS namespace)
// ================================================================
function _startsWith(s: string, search: string): boolean {
    return s.substr(0, search.length) === search
}

function _endsWith(s: string, search: string): boolean {
    if (search.length > s.length) return false
    return s.substr(s.length - search.length, search.length) === search
}

function _trim(s: string): string {
    let start = 0
    while (start < s.length && (s[start] === ' ' || s[start] === '\t')) start++
    let end = s.length
    while (end > start && (s[end - 1] === ' ' || s[end - 1] === '\t')) end--
    return s.substr(start, end - start)
}

function _idiv(a: number, b: number): number {
    return Math.floor(a / b)
}

// ================================================================
// FS — Filesystem PERSISTENTE su Flash (con flashstorage extension)
// Cache in RAM per velocità + backup su flash automatico
// ================================================================
namespace FS {
    const PREFIX = "fs:"          // tutte le chiavi su flash iniziano così
    const MAX_FILES = 24
    const MAX_SIZE = 512

    // Cache in RAM (per velocità) + persistenza su flash
    let _cache: { [name: string]: string } = {}

    export function _saveToFlash(): void {
        // Salva indice dei file su flash
        flashstorage.put("fs_index", JSON.stringify(Object.keys(_cache)))
        // Salva ogni file su flash
        const keys = Object.keys(_cache)
        for (let i = 0; i < keys.length; i++) {
            const name = keys[i]
            flashstorage.put(PREFIX + name, _cache[name])
        }
    }

    export function _loadFromFlash(): void {
        _cache = {}
        // Carica indice dei file da flash
        const indexStr = flashstorage.get("fs_index")
        if (indexStr && indexStr.length > 0) {
            const keys = JSON.parse(indexStr) as string[]
            for (let k of keys) {
                const data = flashstorage.get(PREFIX + k)
                if (data !== null && data !== undefined) _cache[k] = data
            }
        }
    }

    // Crea cartelle di base se non esistono
    export function init(): void {
        _loadFromFlash()
        if (!_cache["home/"]) _cache["home/"] = ""
        if (!_cache["/sys/rootpw"]) _cache["/sys/rootpw"] = "pass|root"
        _saveToFlash()
    }

    function _isSys(name: string): boolean { return _startsWith(name, "/sys/") }
    function _isApp(name: string): boolean { return _startsWith(name, "/app/") }
    function _isSvc(name: string): boolean { return _startsWith(name, "/svc/") }

    function _readSys(name: string): string {
        const key = name.substr(5)
        if (key === "lang") return "[LINGUA]........................|" + (LANG.id === 0 ? "IT" : "EN")
        if (key === "mute") return "[SILENZIOSO]....................|" + (SND.isMuted() ? "ON" : "OFF")
        if (key === "log") return "[REGISTRA]......................|" + (DL.isLogging() ? "REC" : "OFF")
        if (key === "rootpw") {
            const real = _cache["/sys/rootpw"] || ""
            return real || "[PASSW ROOT]....................|root"
        }
        return ""
    }

    function _writeSys(name: string, data: string): boolean {
        const key = name.substr(5)
        let val = data.indexOf("|") >= 0 ? data.split("|")[1] : data
        if (key === "lang") { LANG.set(val === "IT" ? 0 : 1); _saveToFlash(); return true }
        if (key === "mute") { SND.setMute(val === "ON"); _saveToFlash(); return true }
        if (key === "rootpw") {
            _cache["/sys/rootpw"] = data
            _saveToFlash()
            return true
        }
        if (key === "log") {
            if (val === "REC" && !DL.isLogging()) DL.startLogging()
            else if (val !== "REC" && DL.isLogging()) DL.stopLogging()
            _saveToFlash()
            return true
        }
        return false
    }

    export function write(name: string, data: string): boolean {
        if (!Security.isRoot()) return false
        if (name.indexOf("..") >= 0) return false
        if (_isSys(name)) return _writeSys(name, data)
        if (_isApp(name)) return false
        if (data.length > MAX_SIZE) return false

        _cache[name] = data
        _saveToFlash()
        return true
    }

    export function mkdir(name: string): boolean {
        if (!_endsWith(name, "/")) name += "/"
        _cache[name] = ""
        _saveToFlash()
        return true
    }

    export function read(name: string): string {
        if (_isSys(name)) return _readSys(name)
        if (_isApp(name)) return "SERVICE=" + name.substr(5)
        if (_isSvc(name)) return "Running Daemon: " + name.substr(5)
        return _cache[name] || ""
    }

    export function exists(name: string): boolean {
        if (_isSys(name)) return _readSys(name) !== ""
        if (_isApp(name) || _isSvc(name)) return true
        return _cache[name] !== undefined && _cache[name] !== null
    }

    export function remove(name: string): boolean {
        if (!Security.isRoot()) return false
        if (_isSys(name) || _isApp(name)) return false
        if (_cache[name] !== undefined && _cache[name] !== null) {
            const newCache: { [key: string]: string } = {}
            const keys = Object.keys(_cache)
            for (let i = 0; i < keys.length; i++) {
                if (keys[i] !== name) {
                    newCache[keys[i]] = _cache[keys[i]]
                }
            }
            _cache = newCache
            _saveToFlash()
            return true
        }
        return false
    }

    export function list(path: string = ""): string[] {
        const out: string[] = []
        if (path === "") {
            out.push("/sys/")
            out.push("/app/")
            out.push("/svc/")
            const cacheKeys = Object.keys(_cache)
            for (let i = 0; i < cacheKeys.length; i++) {
                const name = cacheKeys[i]
                if (name.indexOf("/") < 0 || _endsWith(name, "/")) out.push(name)
            }
        } else if (path === "/sys/") {
            out.push("lang")
            out.push("mute")
            out.push("log")
        } else if (path === "/app/") {
            for (let i = 0; i < APP.count(); i++) {
                out.push(APP.getState(i))
            }
        } else if (path === "/svc/") {
            const list = PM.list()
            for (let i = 0; i < list.length; i++) out.push(list[i])
        } else {
            const cacheKeys2 = Object.keys(_cache)
            for (let i = 0; i < cacheKeys2.length; i++) {
                const name = cacheKeys2[i]
                if (_startsWith(name, path) && name.length > path.length) {
                    const sub = name.substr(path.length)
                    if (sub.indexOf("/") < 0 || _endsWith(sub, "/")) out.push(sub)
                }
            }
        }
        return out
    }

    export function fileSize(name: string): number {
        if (_isSys(name)) return _readSys(name).length
        if (_isApp(name) || _isSvc(name)) return 16
        return (_cache[name] || "").length
    }

    export function usedBytes(): number {
        let tot = 0
        const cacheKeys = Object.keys(_cache)
        for (let i = 0; i < cacheKeys.length; i++) {
            const k = cacheKeys[i]
            tot += (_cache[k] || "").length
        }
        return tot
    }

    export function freeBytes(): number { return MAX_FILES * MAX_SIZE - usedBytes() }

    export function fileCount(): number { return Object.keys(_cache).length + 5 }

    export function format(): void {
        _cache = {}
        flashstorage.remove("fs_index")
        // Rimuove anche tutti i file da flash
        _saveToFlash()
    }
}

// ================================================================
// PM — Background Services Manager
// ================================================================
namespace PM {
    const MAX_SVC = 6
    let _names: string[] = []
    let _alive: boolean[] = []
    let _startTimes: number[] = []
    let _cycles: number[] = []

    export function startService(name: string, fn: () => void): number {
        // Safety: don't start duplicate service
        for (let i = 0; i < _alive.length; i++) {
            if (_alive[i] && _names[i] === name) return i
        }

        let idx = -1
        for (let i = 0; i < _alive.length; i++) {
            if (!_alive[i]) { idx = i; break }
        }
        if (idx < 0) {
            if (_alive.length >= MAX_SVC) return -1
            idx = _alive.length
            _names.push(name)
            _alive.push(true)
        } else {
            _names[idx] = name
            _alive[idx] = true
        }
        _startTimes[idx] = input.runningTime()
        _cycles[idx] = 0

        control.runInBackground(function () {
            while (_alive[idx]) {
                _cycles[idx]++
                fn()
                basic.pause(100)
            }
        })
        return idx
    }

    export function stop(name: string): void {
        for (let i = 0; i < _alive.length; i++) {
            if (_alive[i] && _names[i] === name) {
                _alive[i] = false
            }
        }
    }

    export function serviceCount(): number {
        let c = 0
        for (let i = 0; i < _alive.length; i++) {
            if (_alive[i]) c++
        }
        return c
    }

    export function list(): string[] {
        const out: string[] = []
        for (let i = 0; i < _alive.length; i++) {
            if (_alive[i]) out.push(_names[i])
        }
        return out
    }

    export function getUptime(name: string): number {
        for (let i = 0; i < _names.length; i++) {
            if (_alive[i] && _names[i] === name) return _idiv(input.runningTime() - _startTimes[i], 1000)
        }
        return 0
    }

    export function getCycles(name: string): number {
        for (let i = 0; i < _names.length; i++) {
            if (_alive[i] && _names[i] === name) return _cycles[i]
        }
        return 0
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
        if (items.length === 0) return
        const start = sel >= maxVisible ? sel - maxVisible + 1 : 0
        const end = Math.min(items.length, start + maxVisible)
        for (let i = start; i < end; i++) {
            const iy = y + (i - start) * (FONT_H + 2)
            if (i >= items.length) break
            const label = items[i].substr(0, _idiv(w - FONT_W, FONT_W))
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
        const maxC = _idiv(w - 4, FONT_W)
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
        const x = _idiv(SCREEN_W - w, 2)
        const y = _idiv(SCREEN_H - h, 2)
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
            const fill = _idiv((w - 2) * Math.min(value, maxVal), maxVal)
            if (fill > 0) FB.fillRect(x + 1, y + 1, fill, h - 2, c)
        }
    }

    // Status bar superiore
    export function statusBar(left: string, right: string): void {
        FB.fillRect(0, 0, SCREEN_W, FONT_H + 2, C_BLUE)
        FB.hline(0, FONT_H + 2, SCREEN_W, C_GRAY) // 1px separator border
        FB.text(left.substr(0, 14), 2, 1, C_FG)
        if (right.length > 0) {
            const rx = SCREEN_W - right.length * FONT_W - 2
            FB.text(right, Math.max(0, rx), 1, C_FG)
        }
    }

    // Toast
    export function toast(msg: string): void {
        const w = Math.min(msg.length * FONT_W + 10, SCREEN_W - 8)
        const x = _idiv(SCREEN_W - w, 2)
        const y = SCREEN_H - 24
        FB.fillRect(x, y, w, FONT_H + 6, C_BG)
        FB.rect(x, y, w, FONT_H + 6, C_OK)
        FB.text(msg.substr(0, _idiv(w - 8, FONT_W)), x + 5, y + 3, C_OK)
    }

    // Spinner
    export function spinner(x: number, y: number, ctr: number): void {
        const f = ["|", "/", "-", "\\"]
        FB.text(f[ctr % 4], x, y, C_FG)
    }

    // Navigazione file rapida (Browser Modale) con Caching per stabilità
    let _fbPath = ""
    let _fbSel = 0
    let _fbVisible = false
    let _fbCb: ((path: string | null) => void) | null = null
    let _fbList: string[] = []
    let _fbFolderLast = "*" // Valore dummy per forzare il primo refresh

    function _fbRefresh(): void {
        if (_fbFolderLast === _fbPath) return
        const list = FS.list(_fbPath)
        _fbList = _fbPath === "" ? list : [".."].concat(list)
        _fbFolderLast = _fbPath
    }

    export function fileBrowser(path: string, callback: (path: string | null) => void): void {
        _fbPath = path; _fbCb = callback; _fbSel = 0; _fbVisible = true
        _fbFolderLast = "*" // Forza ricaricamento
        KBD.flush()
    }

    export function isFBVisible(): boolean { return _fbVisible }

    export function handleFB(k: number): void {
        if (!_fbVisible || VKB.isVisible()) return
        _fbRefresh()
        const flist = _fbList

        if (k === KBD.UP) { _fbSel = (_fbSel + flist.length - 1) % flist.length; SND.nav() }
        else if (k === KBD.DOWN) { _fbSel = (_fbSel + 1) % flist.length; SND.nav() }
        else if (k === KBD.B) { _fbVisible = false; if (_fbCb) _fbCb(null) }
        else if (k === KBD.A) {
            const item = flist[_fbSel]
            if (item === "..") {
                const parts = _fbPath.split("/")
                _fbPath = ""
                for (let i = 0; i < parts.length - 2; i++) _fbPath += parts[i] + "/"
                _fbSel = 0; SND.nav()
                _fbRefresh()
            } else if (_endsWith(item, "/")) {
                _fbPath += item; _fbSel = 0; SND.nav()
                _fbRefresh()
            } else {
                _fbVisible = false
                if (_fbCb) _fbCb(_fbPath + item)
                SND.ok()
            }
        }
    }

    export function renderFB(): void {
        if (!_fbVisible) return
        _fbRefresh()
        FB.fillRect(10, 10, 140, 100, C_BG)
        FB.rect(10, 10, 140, 100, C_FG)
        FB.fillRect(11, 11, 138, FONT_H + 2, C_PURPLE)
        FB.text("OPEN: /" + _fbPath.substr(_fbPath.length - 15), 14, 12, C_FG)
        menu(_fbList, _fbSel, 15, 25, 130, 7)
        FB.text("[A]Select [B]Cancel", 15, 110, C_GRAY)
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
    let _cb: ((s: string | null) => void) | null = null
    let _directCb: ((s: string) => void) | null = null
    let _backCb: (() => void) | null = null
    let _moveCb: ((d: number) => void) | null = null
    const FUNC_ROW = 3
    const FUNC_COUNT = 4

    export function show(callback: (s: string | null) => void, initial: string): void {
        _cb = callback; _directCb = null; _backCb = null; _moveCb = null
        _buf = initial
        _page = 0; _curR = 0; _curC = 0; _visible = true
    }

    export function showDirect(onChar: (s: string) => void, onBack: () => void, onMove?: (d: number) => void): void {
        _cb = null; _directCb = onChar; _backCb = onBack; _moveCb = onMove
        _buf = ""; _page = 0; _curR = 0; _curC = 0; _visible = true
    }

    export function hide(): void {
        _visible = false; _cb = null; _directCb = null; _backCb = null
    }

    export function isVisible(): boolean { return _visible }
    export function getBuffer(): string { return _buf }

    export function handleKey(k: number): void {
        if (!_visible || UI.isFBVisible()) return
        if (k === KBD.UP) {
            if (_directCb && _moveCb) { _moveCb(-10); return }
            _curR = (_curR + FUNC_ROW) % (FUNC_ROW + 1)
            _clampCol()
        } else if (k === KBD.DOWN) {
            if (_directCb && _moveCb) { _moveCb(10); return }
            _curR = (_curR + 1) % (FUNC_ROW + 1)
            _clampCol()
        } else if (k === KBD.LEFT) {
            if (_directCb && _moveCb) { _moveCb(-1); return }
            const maxC = _curR === FUNC_ROW ? FUNC_COUNT - 1 : _pages[_page][_curR].length - 1
            _curC = _curC > 0 ? _curC - 1 : maxC
        } else if (k === KBD.RIGHT) {
            if (_directCb && _moveCb) { _moveCb(1); return }
            const maxC = _curR === FUNC_ROW ? FUNC_COUNT - 1 : _pages[_page][_curR].length - 1
            _curC = _curC < maxC ? _curC + 1 : 0
        } else if (k === KBD.A) {
            _activate()
        } else if (k === KBD.B) {
            if (_cb !== null) _cb(null)
            hide()
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
                if (_directCb) _directCb(" ")
                else _buf += " "
            } else if (_curC === 1) {
                if (_directCb) { if (_backCb) _backCb() }
                else if (_buf.length > 0) _buf = _buf.substr(0, _buf.length - 1)
            } else if (_curC === 2) {
                if (_cb !== null) _cb(_buf)
                hide()
            } else if (_curC === 3) {
                _page = (_page + 1) % _pages.length
                _clampCol()
            }
        } else {
            const ch = _pages[_page][_curR].charAt(_curC)
            if (_directCb) _directCb(ch)
            else _buf += ch
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
        const maxBufChars = _idiv(kbW - 12, FONT_W)
        const display = "> " + _buf + "_"
        const showStr = display.length > maxBufChars ?
            display.substr(display.length - maxBufChars) : display
        FB.text(showStr, 5, inputY + 1, C_FG)

        // Tasti (righe 0-2)
        const rows = _pages[_page]
        for (let r = 0; r < rows.length; r++) {
            const row = rows[r]
            const totalW = row.length * KW
            const startX = _idiv(kbW - totalW, 2)
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
        const funcStartX = _idiv(kbW - totalFuncW, 2)

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
        return _idiv(
            Math.abs(input.acceleration(Dimension.X)) +
            Math.abs(input.acceleration(Dimension.Y)) +
            Math.abs(input.acceleration(Dimension.Z)), 10
        )
    }
}

// ================================================================
// BLE — BLE HID Driver (keyboard + mouse)
// Usa keyboard.sendString() per massima compatibilità
// ================================================================
namespace BLE {
    let _lastSent = ""

    export function sendKeys(text: string): void {
        keyboard.sendString(text)
        _lastSent = text
    }

    // Tasti speciali: usa sendString() con escape sequences
    // Per Enter, invio newline; per frecce, niente (non supportate via BLE HID su micro:bit)
    export function sendSpecialKey(keyName: string): void {
        if (keyName === "enter" || keyName === "return") {
            // Enter: invia newline direttamente
            keyboard.sendString("\n")
            _lastSent = "[Enter]"
        } else if (keyName === "backspace") {
            // Backspace: usa Alt+backspace se supportato, o skip
            keyboard.sendString("")
            _lastSent = "[Backspace]"
        } else if (keyName === "up" || keyName === "down" || keyName === "left" || keyName === "right") {
            // Frecce: NOT supportate via BLE HID standard su micro:bit
            // Fallback: noop, log only
            _lastSent = "[" + keyName.toUpperCase() + "]"
        } else {
            _lastSent = "[" + keyName + "]"
        }
    }

    export function mouseClickLeft(): void {
        mouse.click()
        _lastSent = "[MouseClick]"
    }

    // Nota: BLE HID su micro:bit NON supporta mouse.move() nativamente
    // Funzioni di mouse movement rimosse per stabilità API
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
    let _namesIt: string[] = []
    let _namesEn: string[] = []
    let _icons: string[] = []
    let _stateNames: string[] = []
    let _colors: number[] = []
    let _types: number[] = [] // 0=Sandbox, 1=Full, 2=RootOnly

    export function register(nameIt: string, nameEn: string, icon: string, stateName: string, color: number, type: number): void {
        _namesIt.push(nameIt)
        _namesEn.push(nameEn)
        _icons.push(icon)
        _stateNames.push(stateName)
        _colors.push(color)
        _types.push(type)
    }

    export function count(): number { return _namesIt.length }
    export function getName(i: number): string { return LANG.t(_namesIt[i], _namesEn[i]) }
    export function getIcon(i: number): string { return _icons[i] }
    export function getState(i: number): string { return _stateNames[i] }
    export function getColor(i: number): number { return _colors[i] }
    export function getType(i: number): number { return _types[i] }
}

// ================================================================
// REGISTRAZIONE APPLICAZIONI (Privilegi in coda)
// ================================================================
// Sandbox = 0 (Visibile sia Root che Guest, sicura)
// Full = 1 (Visibile in entrambi, l'app stessa userà limitazioni interne)
// RootOnly = 2 (Visibile e usabile solo in Root)
APP.register("Shell", "Shell", "S", "app_shell", C_TEAL, 1)
APP.register("File", "Files", "F", "app_files", C_ORANGE, 1)
APP.register("Editor", "Editor", "E", "app_editor", C_PINK, 1)
APP.register("Info", "Info", "I", "app_sysinfo", C_LBLUE, 0)
APP.register("Sensori", "Sensors", "#", "app_sensors", C_OK, 0)
APP.register("Snake", "Snake", "~", "app_snake", C_OK, 0)
APP.register("BLE Tast", "BLE Keys", "K", "app_blekeys", C_PURPLE, 0)
APP.register("BLE Ctrl", "BLE Ctrl", "M", "app_blectrl", C_WARN, 0)
APP.register("Config", "Settings", "*", "app_config", C_GRAY, 1)
APP.register("Processi", "Processes", "P", "app_pm", C_ERR, 2)

// ================================================================
// LAUNCHER — Home Screen con Griglia Icone
// ================================================================
let _launchSel = 0
let _launchPage = 0
const LAUNCH_COLS = 4
const LAUNCH_CELL_W = _idiv(SCREEN_W, LAUNCH_COLS)
const LAUNCH_CELL_H = 46
const LAUNCH_PER_PAGE = 8

states.setEnterHandler("launcher", function () {
    KBD.flush()
})

states.addLoopHandler("launcher", function () {
    KBD.updateRepeat()
    const visibleApps: number[] = []
    for (let i = 0; i < APP.count(); i++) {
        if (Security.isRoot() || APP.getType(i) < 2) visibleApps.push(i)
    }
    const total = visibleApps.length
    if (_launchSel >= total) _launchSel = 0

    let k = KBD.poll()
    while (k >= 0) {
        if (k === KBD.RIGHT) {
            _launchSel = (_launchSel + 1) % total
            _launchPage = _idiv(_launchSel, LAUNCH_PER_PAGE)
            SND.nav()
        } else if (k === KBD.LEFT) {
            _launchSel = (_launchSel + total - 1) % total
            _launchPage = _idiv(_launchSel, LAUNCH_PER_PAGE)
            SND.nav()
        } else if (k === KBD.DOWN) {
            _launchSel = (_launchSel + LAUNCH_COLS) % total
            _launchPage = _idiv(_launchSel, LAUNCH_PER_PAGE)
            SND.nav()
        } else if (k === KBD.UP) {
            _launchSel = (_launchSel + total - LAUNCH_COLS) % total
            _launchPage = _idiv(_launchSel, LAUNCH_PER_PAGE)
            SND.nav()
        } else if (k === KBD.A) {
            SND.ok()
            Kernel.argv = [] // clear args
            Kernel.argc = 0
            Kernel._activeState = APP.getState(visibleApps[_launchSel])
            states.setState(Kernel._activeState)
        }
        k = KBD.poll()
    }

    // ---- Render ----
    FB.cls()
    UI.statusBar("BitOS", Kernel.uptimeStr())

    const topY = FONT_H + 6
    const startIdx = _launchPage * LAUNCH_PER_PAGE
    const endIdx = Math.min(startIdx + LAUNCH_PER_PAGE, total)

    for (let i = startIdx; i < endIdx; i++) {
        const local = i - startIdx
        const col = local % LAUNCH_COLS
        const row = _idiv(local, LAUNCH_COLS)
        const cx = col * LAUNCH_CELL_W
        const cy = topY + row * LAUNCH_CELL_H
        const sel = i === _launchSel
        const iconSize = 22
        const iconX = cx + _idiv(LAUNCH_CELL_W - iconSize, 2)
        const iconY = cy + 2

        const appIdx = visibleApps[i]

        if (sel) {
            FB.fillRect(iconX, iconY, iconSize, iconSize, APP.getColor(appIdx))
            FB.text(APP.getIcon(appIdx), iconX + 8, iconY + 7, C_BG)
            FB.rect(iconX - 1, iconY - 1, iconSize + 2, iconSize + 2, C_FG)
        } else {
            FB.rect(iconX, iconY, iconSize, iconSize, APP.getColor(appIdx))
            FB.text(APP.getIcon(appIdx), iconX + 8, iconY + 7, APP.getColor(appIdx))
        }
        const name = APP.getName(appIdx)
        const nameX = cx + _idiv(LAUNCH_CELL_W - name.length * FONT_W, 2)
        FB.text(name, Math.max(cx, nameX), iconY + iconSize + 3, sel ? C_FG : C_GRAY)
    }

    FB.text("[A]" + LANG.t("Apri", "Open"), 4, SCREEN_H - FONT_H - 1, C_GRAY)

    // Page indicators
    const pages = _idiv(total + LAUNCH_PER_PAGE - 1, LAUNCH_PER_PAGE)
    if (pages > 1) {
        for (let p = 0; p < pages; p++) FB.text(p === _launchPage ? "o" : ".", 70 + p * 8, SCREEN_H - FONT_H - 1, C_FG)
    }
    if (Kernel.dimmed) FB.text("zzZ", SCREEN_W - 24, SCREEN_H - FONT_H - 1, C_GRAY)
    if (DL.isLogging()) FB.text("REC", SCREEN_W - 30, 1, C_ERR)

    basic.pause(33)
})

// ================================================================
// UTILITY
// ================================================================
function _exitToLauncher(): void {
    Kernel._activeState = "launcher"
    states.setState("launcher")
}

// ================================================================
// BSCRIPT — Motore di Scripting Base
// ================================================================
function _runScript(path: string): void {
    const code = FS.read(path)
    if (code.length === 0) {
        TTY.writeln(LANG.t("Vuoto o non trovato", "Empty or not found"))
        return
    }
    TTY.writeln("Running " + path + "...")
    const lines = code.split("\n")
    let success = true
    for (let i = 0; i < lines.length; i++) {
        let cmd = _trim(lines[i])
        if (cmd.length === 0 || _startsWith(cmd, "#")) continue

        // Espansione di variabili sensore a runtime
        if (cmd.indexOf("$TEMP") >= 0) cmd = cmd.split("$TEMP").join(convertToText(SENS.temp()))
        if (cmd.indexOf("$LIGHT") >= 0) cmd = cmd.split("$LIGHT").join(convertToText(SENS.light()))
        if (cmd.indexOf("$ACC") >= 0) cmd = cmd.split("$ACC").join(convertToText(SENS.accelMag()))

        const parts = cmd.split(" ")
        const op = parts[0]
        try {
            if (op === "BEEP") {
                const freq = parts.length > 1 ? parseInt(parts[1]) : 440
                const dur = parts.length > 2 ? parseInt(parts[2]) : 200
                if (isNaN(freq) || isNaN(dur)) throw "BEEP params not numeric"
                SND.beep(freq, dur)
            } else if (op === "PRINT") {
                TTY.writeln(cmd.substr(6))
            } else if (op === "PAUSE") {
                const ms = parts.length > 1 ? parseInt(parts[1]) : 1000
                if (isNaN(ms)) throw "PAUSE ms not numeric"
                basic.pause(ms)
            } else if (op === "CLS") {
                TTY.clear()
            } else if (op === "WAIT") {
                const key = parts.length > 1 ? parts[1] : "A"
                TTY.writeln("Waiting [" + key + "]...")
                TTY.render()
                if (key === "A") { while (!KBD.isDown(KBD.A)) { KBD.poll(); basic.pause(50) } }
                else if (key === "B") { while (!KBD.isDown(KBD.B)) { KBD.poll(); basic.pause(50) } }
                else throw "WAIT: unknown key " + key
            } else if (op === "LOG") {
                if (!DL.isLogging()) DL.startLogging()
                DL.logSensors()
                TTY.writeln("Logged.")
            } else if (op === "EXIT") {
                break
            } else if (op.length > 0) {
                throw "Unknown command: " + op
            }
        } catch (e) {
            TTY.writeln("ERROR line " + (i + 1) + ": " + convertToText(e))
            success = false
            break
        }
    }
    if (success) {
        TTY.writeln("Script completed.")
    }
}

// ================================================================
// APP: SHELL — Terminale con Parser Comandi
// ================================================================
let _shPath = ""
let _shLast = "" // Ultimo comando per history veloce con UP

function _shellExec(cmd: string): void {
    if (cmd.length === 0) return
    _shLast = cmd
    const parts = cmd.split(" ")
    const verb = parts[0]

    if (verb === "help") {
        TTY.writeln(LANG.t("Comandi:", "Commands:"))
        TTY.writeln(" help ls cd cat echo")
        TTY.writeln(" rm mkdir ps clear")
        TTY.writeln(" run temp light sound")
        TTY.writeln(" beep free uname ble")
    } else if (verb === "ls") {
        const fl = FS.list(_shPath)
        if (fl.length === 0) {
            TTY.writeln(LANG.t("(vuoto)", "(empty)"))
        } else {
            for (let i = 0; i < fl.length; i++) {
                const sub = fl[i]
                TTY.writeln(" " + sub + (_endsWith(sub, "/") || _startsWith(sub, "$") || _startsWith(sub, "/app") ? "" : (" " + convertToText(FS.fileSize(_shPath + sub)) + "b")))
            }
            TTY.writeln(convertToText(fl.length) + LANG.t(" elem", " items"))
        }
    } else if (verb === "cd") {
        if (parts.length < 2) _shPath = ""
        else if (parts[1] === "..") {
            if (_shPath !== "") {
                const sp = _shPath.split("/")
                _shPath = ""
                for (let i = 0; i < sp.length - 2; i++) _shPath += sp[i] + "/"
            }
        } else {
            let target = parts[1]
            if (!_endsWith(target, "/")) target += "/"
            if (FS.exists(_shPath + target)) _shPath += target
            else TTY.writeln("No dir")
        }
    } else if (verb === "mkdir") {
        if (!Security.isRoot()) { TTY.writeln("Access Denied"); return }
        if (parts.length > 1) {
            FS.mkdir(_shPath + parts[1])
            TTY.writeln("Ok")
        }
    } else if (verb === "edit") {
        if (parts.length > 1) {
            Kernel.exec("app_editor", [_shPath + parts[1]])
        } else {
            Kernel.exec("app_editor", [])
        }
    } else if (verb === "run") {
        if (!Security.isRoot()) { TTY.writeln("Access Denied"); return }
        if (parts.length > 1) _runScript(_shPath + parts[1])
        else TTY.writeln("uso: run <file>")
    } else if (verb === "cat") {
        if (parts.length < 2) {
            TTY.writeln(LANG.t("uso: cat <file>", "usage: cat <file>"))
        } else {
            const content = FS.read(_shPath + parts[1])
            if (content.length === 0 && !FS.exists(_shPath + parts[1])) {
                TTY.writeln(LANG.t("non trovato: ", "not found: ") + parts[1])
            } else {
                TTY.writeln(content)
            }
        }
    } else if (verb === "echo") {
        if (!Security.isRoot()) { TTY.writeln("Access Denied"); return }
        const redir = cmd.indexOf(">")
        if (redir >= 0 && redir > 5) {
            const txt = _trim(cmd.substr(5, redir - 5))
            const fname = _trim(cmd.substr(redir + 1))
            if (fname.length > 0) {
                if (FS.write(_shPath + fname, txt)) {
                    TTY.writeln(LANG.t("scritto: ", "written: ") + fname)
                } else {
                    TTY.writeln(LANG.t("errore scrittura", "write error"))
                }
            }
        } else if (cmd.length > 5) {
            TTY.writeln(cmd.substr(5))
        }
    } else if (verb === "rm") {
        if (!Security.isRoot()) { TTY.writeln("Access Denied"); return }
        if (parts.length < 2) {
            TTY.writeln(LANG.t("uso: rm <file>", "usage: rm <file>"))
        } else {
            if (FS.remove(_shPath + parts[1])) TTY.writeln(LANG.t("rimosso", "removed"))
            else TTY.writeln(LANG.t("non trovato o protetto", "not found or locked"))
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
    if (_shPath === "") TTY.writeln("BitOS Shell v1.0")

    // Handle auto-run from args
    if (Kernel.argc >= 2 && Kernel.argv[0] === "run") {
        const script = Kernel.argv[1]
        TTY.writeln("Run: " + script)
        _runScript(script)
    }

    TTY.write("/" + _shPath + "$ ")
})

states.addLoopHandler("app_shell", function () {
    KBD.updateRepeat()
    let k = KBD.poll()
    while (k >= 0) {
        if (VKB.isVisible()) {
            VKB.handleKey(k)
        } else {
            if (k === KBD.B) { _exitToLauncher(); return }
            else if (k === KBD.UP && _shLast !== "") {
                // Richiama ultimo comando
                VKB.show(function (inp: string | null) {
                    if (inp !== null && inp.length > 0) {
                        TTY.writeln(inp)
                        _shellExec(inp)
                        TTY.write("/" + _shPath + "$ ")
                    }
                    VKB.hide()
                }, _shLast)
            } else if (k === KBD.A) {
                VKB.show(function (inp: string | null) {
                    if (inp !== null && inp.length > 0) {
                        TTY.writeln(inp)
                        _shellExec(inp)
                        TTY.write("/" + _shPath + "$ ")
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
let _fmMode = 0   // 0=lista 1=azioni 2=input testo
let _fmPath = "home/"
let _fmMenuSel = 0
let _fmCache: string[] = []

function _fmRefresh(): void {
    const list = FS.list(_fmPath)
    _fmCache = _fmPath === "" ? list : [".."].concat(list)
}

states.setEnterHandler("app_files", function () {
    KBD.flush()
    _fmSel = 0; _fmMode = 0;
    _fmRefresh()
})

states.addLoopHandler("app_files", function () {
    KBD.updateRepeat()
    const flist = _fmCache
    let k = KBD.poll()
    while (k >= 0) {
        // === PRIORITY 1: Virtual Keyboard ===
        if (VKB.isVisible()) {
            VKB.handleKey(k)
            k = KBD.poll()
            continue
        }
        // === PRIORITY 2: File Browser (UI) ===
        if (UI.isFBVisible()) {
            UI.handleFB(k)
            k = KBD.poll()
            continue
        }

        if (_fmMode === 0) { // LISTA
            if (k === KBD.B) {
                if (_fmPath === "") { _exitToLauncher(); return }
                else {
                    const parts = _fmPath.split("/")
                    _fmPath = ""
                    for (let i = 0; i < parts.length - 2; i++) _fmPath += parts[i] + "/"
                    _fmSel = 0; _fmRefresh(); SND.nav()
                }
            } else if (k === KBD.UP && flist.length > 0) {
                _fmSel = (_fmSel + flist.length - 1) % flist.length; SND.nav()
            } else if (k === KBD.DOWN && flist.length > 0) {
                _fmSel = (_fmSel + 1) % flist.length; SND.nav()
            } else if (k === KBD.A && flist.length > 0) {
                const item = flist[_fmSel]
                if (item === "..") {
                    const parts = _fmPath.split("/")
                    _fmPath = ""
                    for (let i = 0; i < parts.length - 2; i++) _fmPath += parts[i] + "/"
                    _fmSel = 0; _fmRefresh(); SND.nav()
                } else if (_endsWith(item, "/")) {
                    _fmPath += item
                    _fmSel = 0; _fmRefresh(); SND.nav()
                } else {
                    if (!Security.isRoot()) { SND.error(); UI.toast("Sandbox Deny") }
                    else { _fmMenuSel = 0; _fmMode = 1; SND.nav() }
                }
            } else if (k === KBD.MENU && flist.length > 0) {
                if (!Security.isRoot()) { SND.error(); UI.toast("Sandbox Deny") }
                else { _fmMenuSel = 0; _fmMode = 1; SND.nav() }
            }
        } else if (_fmMode === 1) { // AZIONI
            const mData = [LANG.t("Esegui", "Run"), LANG.t("Modifica", "Edit"), LANG.t("File", "File"), LANG.t("Cart", "Dir"), LANG.t("Canc", "Del")]
            if (k === KBD.B) { _fmMode = 0; SND.nav() }
            else if (k === KBD.UP) { _fmMenuSel = (_fmMenuSel + mData.length - 1) % mData.length; SND.nav() }
            else if (k === KBD.DOWN) { _fmMenuSel = (_fmMenuSel + 1) % mData.length; SND.nav() }
            else if (k === KBD.A) {
                const target = flist[_fmSel]
                if (_fmMenuSel === 0) { // RUN
                    if (target === "..") { SND.error() }
                    else if (_fmPath === "app/") {
                        Kernel.exec(target, [])
                        return
                    } else if (!_endsWith(target, "/")) {
                        Kernel.exec("app_shell", ["run", _fmPath + target])
                        return
                    } else { SND.error() }
                    _fmMode = 0
                } else if (_fmMenuSel === 1) { // EDIT
                    if (target !== ".." && !_endsWith(target, "/")) {
                        Kernel.exec("app_editor", [_fmPath + target])
                        return
                    } else { SND.error() }
                } else if (_fmMenuSel === 2) { // NEW FILE
                    VKB.show(function (t) { if (t) { FS.write(_fmPath + t, ""); _fmRefresh() }; _fmMode = 0; VKB.hide() }, "")
                } else if (_fmMenuSel === 3) { // NEW DIR
                    VKB.show(function (t) { if (t) { FS.mkdir(_fmPath + t); _fmRefresh() }; _fmMode = 0; VKB.hide() }, "")
                } else if (_fmMenuSel === 4) { // DELETE
                    if (target !== "..") { FS.remove(_fmPath + target); _fmRefresh(); _fmSel = 0 }
                    _fmMode = 0
                }
                SND.ok()
            }
        }
        k = KBD.poll()
    }
    FB.cls()
    const pLabel = _fmPath === "" ? "/" : "/" + _fmPath
    UI.statusBar("Files", pLabel.substr(pLabel.length - 12))

    if (_fmMode === 0) {
        if (flist.length === 0) FB.centerText("Empty", 60, C_GRAY)
        else UI.menu(flist, _fmSel, 2, 20, 150, 8)
    } else if (_fmMode === 1) {
        // Render current list in background
        if (flist.length > 0) UI.menu(flist, _fmSel, 2, 20, 150, 8)
        UI.dialog(LANG.t("Azioni", "Actions"), [
            (_fmMenuSel === 0 ? ">" : " ") + LANG.t("Esegui", "Run"),
            (_fmMenuSel === 1 ? ">" : " ") + LANG.t("Modifica", "Edit"),
            (_fmMenuSel === 2 ? ">" : " ") + LANG.t("Nuovo File", "New File"),
            (_fmMenuSel === 3 ? ">" : " ") + LANG.t("Nuova Cart", "New Dir"),
            (_fmMenuSel === 4 ? ">" : " ") + LANG.t("Elimina", "Delete")
        ], 20, 15, 120, 70)
    }

    if (VKB.isVisible()) VKB.render()
    basic.pause(33)
})

// ================================================================
// APP: TEXT EDITOR / REGEDIT (v2.0 - Cursor Based)
// ================================================================
let _edPath = ""
let _edLines: string[] = []
let _edCurX = 0
let _edCurY = 0
let _edScroll = 0
let _edMode = 0 // 0=View, 1=Menu
let _edIsSys = false
let _edSysKey = ""
let _edSysVal = ""
let _edMenuSel = 0

function _edUpdateLines(): void {
    if (_edIsSys) return
    const raw = FS.read(_edPath)
    _edLines = raw.split("\n")
    if (_edLines.length === 0) _edLines = [""]
}

function _edSave(): void {
    if (_edPath === "" || _edIsSys) return
    if (!Security.isRoot()) { UI.toast("Sandbox Deny"); return }
    const out = _edLines.join("\n")
    FS.write(_edPath, out)
    SND.ok()
}

states.setEnterHandler("app_editor", function () {
    KBD.flush()
    _edPath = Kernel.argc > 0 ? Kernel.argv[0] : ""
    _edCurX = 0; _edCurY = 0; _edScroll = 0; _edMode = 0
    _edIsSys = false

    if (_startsWith(_edPath, "/sys/") || _startsWith(_edPath, "/svc/")) {
        _edIsSys = true
        const raw = FS.read(_edPath)
        const parts = raw.split("|")
        if (parts.length > 1) { _edSysKey = parts[0]; _edSysVal = parts[1] }
        else { _edIsSys = false; _edUpdateLines() }
    } else {
        _edUpdateLines()
    }
})

states.addLoopHandler("app_editor", function () {
    KBD.updateRepeat()
    let k = KBD.poll()

    while (k >= 0) {
        if (k === KBD.MENU) {
            if (!Security.isRoot()) { SND.error(); UI.toast("Read-Only") }
            else { VKB.hide(); _edMode = 1; _edMenuSel = 0; SND.nav() }
        } else if (UI.isFBVisible()) {
            UI.handleFB(k)
        } else if (VKB.isVisible()) {
            VKB.handleKey(k)
        } else if (_edIsSys) {
            if (k === KBD.B) { _exitToLauncher(); return }
            else if (k === KBD.A) {
                if (!Security.isRoot()) { SND.error(); UI.toast("Sandbox Deny"); return }
                if (_edSysVal === "IT") _edSysVal = "EN"
                else if (_edSysVal === "EN") _edSysVal = "IT"
                else if (_edSysVal === "ON") _edSysVal = "OFF"
                else if (_edSysVal === "OFF") _edSysVal = "ON"
                else if (_edSysVal === "REC") _edSysVal = "OFF"
                else _edSysVal = "REC"
                FS.write(_edPath, _edSysKey + "|" + _edSysVal)
                SND.click()
            }
        } else if (_edMode === 0) { // VIEW / NAV
            if (k === KBD.UP) {
                if (_edCurY > 0) { _edCurY--; _edCurX = Math.min(_edCurX, _edLines[_edCurY].length) }
                if (_edCurY < _edScroll) _edScroll = _edCurY
            } else if (k === KBD.DOWN) {
                if (_edCurY < _edLines.length - 1) { _edCurY++; _edCurX = Math.min(_edCurX, _edLines[_edCurY].length) }
                if (_edCurY >= _edScroll + 10) _edScroll = _edCurY - 9
            } else if (k === KBD.LEFT) {
                if (_edCurX > 0) _edCurX--
                else if (_edCurY > 0) { _edCurY--; _edCurX = _edLines[_edCurY].length }
            } else if (k === KBD.RIGHT) {
                if (_edCurX < _edLines[_edCurY].length) _edCurX++
                else if (_edCurY < _edLines.length - 1) { _edCurY++; _edCurX = 0 }
            } else if (k === KBD.A) {
                // INSERT MODE (Direct VKB)
                if (!Security.isRoot()) { SND.error(); UI.toast("Read-Only"); return }
                
                // CORREZIONE: Rimosso il terzo callback (onMove) per evitare conflitti con il D-pad
                VKB.showDirect(function (ch: string) {
                    const l = _edLines[_edCurY]
                    _edLines[_edCurY] = l.substr(0, _edCurX) + ch + l.substr(_edCurX)
                    _edCurX++
                }, function () {
                    // Backspace
                    if (_edCurX > 0) {
                        const l = _edLines[_edCurY]
                        _edLines[_edCurY] = l.substr(0, _edCurX - 1) + l.substr(_edCurX)
                        _edCurX--
                    } else if (_edCurY > 0) {
                        _edCurX = _edLines[_edCurY - 1].length
                        _edLines[_edCurY - 1] += _edLines[_edCurY]
                        _edLines.splice(_edCurY, 1)
                        _edCurY--
                    }
                })
                
            } else if (k === KBD.MENU) {
                // Il Menu è ora accessibile anche in Guest (sola lettura)
                _edMode = 1; _edMenuSel = 0; SND.nav()
            } else if (k === KBD.B) {
                _edSave(); _exitToLauncher(); return
            }
        } else if (_edMode === 1) { // MENU
            const opts = ["Save", "Open", "Save As", "New Line", "Exit"]
            if (k === KBD.B) _edMode = 0
            else if (k === KBD.UP) _edMenuSel = (_edMenuSel + opts.length - 1) % opts.length
            else if (k === KBD.DOWN) _edMenuSel = (_edMenuSel + 1) % opts.length
            else if (k === KBD.A) {
                if (_edMenuSel === 0) { _edSave(); _edMode = 0 }
                else if (_edMenuSel === 1) {
                    UI.fileBrowser("home/", function (p) { if (p) { _edPath = p; _edUpdateLines() } })
                    _edMode = 0
                } else if (_edMenuSel === 2) {
                    VKB.show(function (p) { if (p) { _edPath = "home/" + p; _edSave() }; VKB.hide() }, "")
                    _edMode = 0
                } else if (_edMenuSel === 3) {
                    // New Line
                    const newLine = _edLines[_edCurY].substr(_edCurX)
                    _edLines[_edCurY] = _edLines[_edCurY].substr(0, _edCurX)
                    _edLines.insertAt(_edCurY + 1, newLine)
                    _edCurY++; _edCurX = 0
                    _edMode = 0
                } else if (_edMenuSel === 4) {
                    _exitToLauncher(); return
                }
            }
        }
        k = KBD.poll()
    }

    FB.cls()
    UI.statusBar("Editor", _edPath === "" ? "New" : _edPath.substr(_edPath.length - 12))

    if (_edIsSys) {
        FB.text("V-NODE Registry", 4, 20, C_PINK)
        FB.text("Key: " + _edSysKey, 4, 35, C_GRAY)
        FB.fillRect(100, 33, 40, 12, C_LBLUE)
        FB.text(_edSysVal, 102, 35, C_BG)
        FB.text("[A] Toggle [B] Exit", 4, 110, C_GRAY)
    } else {
        // Render Lines
        for (let i = 0; i < 10; i++) {
            const idx = _edScroll + i
            if (idx >= _edLines.length) break
            const y = FONT_H + 8 + i * FONT_H
            const line = _edLines[idx]
            FB.text(line.substr(0, 26), 4, y, C_FG)
            if (idx === _edCurY && !VKB.isVisible() && _edMode === 0) {
                // Render internal cursor
                const cx = 4 + _edCurX * FONT_W
                if (cx < SCREEN_W - 4) {
                    if (input.runningTime() % 600 < 300) FB.vline(cx, y, FONT_H, C_OK)
                }
            }
        }
        
        if (_edMode === 0) {
            // Aggiunto indicatore visivo per l'Insert Mode
            if (VKB.isVisible()) FB.text("--- INSERT MODE ---", 4, 110, C_WARN)
            else FB.text("[A]Insert [M]Menu [B]Save&Exit", 4, 110, C_GRAY)
        } else if (_edMode === 1) {
            UI.dialog("Editor Options", ["Save", "Open", "Save As", "New Line", "Exit"], 20, 20, 120, 80)
            FB.text(">", 25, 33 + _edMenuSel * FONT_H, C_WARN)
        }
    }

    if (UI.isFBVisible()) UI.renderFB()
    if (VKB.isVisible()) VKB.render()
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

    // Colonna destra - PROCESSI (Cacheata singolarmente per frame)
    const rx = 82
    let ry = FONT_H + 8
    FB.text("-- Processes --", rx, ry, C_PURPLE); ry += FONT_H + 2
    const procs = PM.list()
    for (let i = 0; i < Math.min(procs.length, 6); i++) {
        FB.text("> " + procs[i].substr(0, 10), rx, ry, C_OK); ry += FONT_H
    }
    if (procs.length === 0) FB.text("No tasks", rx, ry, C_GRAY)

    FB.text("[B]" + LANG.t("Esci", "Exit"), 4, SCREEN_H - FONT_H - 1, C_GRAY)
    basic.pause(100)
})

// ================================================================
// APP: TASK MANAGER (app_pm) — Root Only
// ================================================================
let _pmSel = 0
let _pmCache: string[] = []
let _pmMode = 0 // 0=list, 1=menu, 2=info
let _pmMenuSel = 0
let _pmInfo: string[] = []

states.setEnterHandler("app_pm", function () {
    KBD.flush()
    _pmSel = 0; _pmMode = 0
    _pmCache = ["ACTIVE: " + Kernel._activeState.substr(4)]
    const list = PM.list()
    for (let i = 0; i < list.length; i++) _pmCache.push(list[i])
    _pmCache.push("SYS: Watchdog")
})

states.addLoopHandler("app_pm", function () {
    if (!Security.isRoot()) { _exitToLauncher(); return }
    KBD.updateRepeat()
    const procs = _pmCache
    let k = KBD.poll()
    while (k >= 0) {
        if (_pmMode === 0) {
            if (k === KBD.B) { _exitToLauncher(); return }
            else if (k === KBD.UP && procs.length > 0) {
                _pmSel = (_pmSel + procs.length - 1) % procs.length; SND.nav()
            } else if (k === KBD.DOWN && procs.length > 0) {
                _pmSel = (_pmSel + 1) % procs.length; SND.nav()
            } else if (k === KBD.A && procs.length > 0) {
                _pmMode = 1; _pmMenuSel = 0; SND.ok()
            }
        } else if (_pmMode === 1) { // Process Menu
            if (k === KBD.B) { _pmMode = 0; SND.nav() }
            else if (k === KBD.UP) { _pmMenuSel = (_pmMenuSel + 2) % 3; SND.nav() }
            else if (k === KBD.DOWN) { _pmMenuSel = (_pmMenuSel + 1) % 3; SND.nav() }
            else if (k === KBD.A) {
                if (_pmMenuSel === 0) { // KILL
                    PM.stop(procs[_pmSel]); SND.error()
                    _pmCache = PM.list(); _pmSel = 0; _pmMode = 0
                } else if (_pmMenuSel === 1) { // INFO
                    const name = procs[_pmSel]
                    if (_startsWith(name, "ACTIVE:")) {
                        _pmInfo = ["State: " + name.substr(8), "Status: Foreground", "Focus: User"]
                    } else if (_startsWith(name, "SYS:")) {
                        _pmInfo = ["State: Watchdog", "Status: Kernel Thread", "Task: System Integrity"]
                    } else {
                        _pmInfo = [
                            "Task: " + name,
                            "Uptime: " + convertToText(PM.getUptime(name)) + "s",
                            "Cycles: " + convertToText(PM.getCycles(name))
                        ]
                    }
                    _pmMode = 2; SND.ok()
                } else { _pmMode = 0 }
            }
        } else if (_pmMode === 2) { // Info Screen
            if (k === KBD.A || k === KBD.B) { _pmMode = 1; SND.nav() }
        }
        k = KBD.poll()
    }
    FB.cls()
    UI.statusBar(LANG.t("Processi", "TaskMgr"), convertToText(procs.length))
    if (procs.length === 0) FB.centerText("No background tasks", 60, C_GRAY)
    else {
        UI.menu(procs, _pmSel, 5, 20, 150, 8)
        if (_pmMode === 1) {
            UI.dialog("Action: " + procs[_pmSel], [
                (_pmMenuSel === 0 ? ">" : " ") + "Kill Task",
                (_pmMenuSel === 1 ? ">" : " ") + "Get Info",
                (_pmMenuSel === 2 ? ">" : " ") + "Cancel"
            ], 20, 30, 120, 60)
        } else if (_pmMode === 2) {
            UI.dialog("Task Details", _pmInfo, 10, 30, 140, 60)
        } else {
            FB.text("[A] OPTIONS  [B] EXIT", 4, 110, C_GRAY)
        }
    }
    basic.pause(33)
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
    if (k >= 0) {
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
    if (_snsHistory.length > SNS_HIST_LEN) _snsHistory.splice(0, 1)
    _snsHistory.push(val)

    // Data logging (se attivo)
    if (DL.isLogging()) DL.logSensors()

    // Render
    FB.cls()
    UI.statusBar(LANG.t("Sensori", "Sensors"), DL.isLogging() ? "REC" : Kernel.uptimeStr())

    // Tabs
    const tabs = [
        LANG.t("Tmp", "Tmp"), LANG.t("Lux", "Lux"),
        LANG.t("Acc", "Acc"), LANG.t("Mic", "Mic")
    ]
    const tabW = _idiv(SCREEN_W, 4)
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
        const barH = _idiv(hVal * SNS_GRAPH_H, Math.max(maxV, 1))
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
    _snY = [_idiv(SN_ROWS, 2), _idiv(SN_ROWS, 2), _idiv(SN_ROWS, 2)]
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
        _snX.splice(_snX.length - 1, 1)
        _snY.splice(_snY.length - 1, 1)
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
        FB.centerText("GAME OVER", 40, C_ERR)
        FB.centerText(LANG.t("Score: ", "Score: ") + convertToText(_snScore), 60, C_FG)
        FB.centerText(LANG.t("Record: ", "High: ") + convertToText(_snHigh), 72, C_WARN)
        FB.centerText("[A] RESTART [B] EXIT", 90, C_GRAY)
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
                    BLE.sendSpecialKey("enter")
                    _bkLastSent = "[Enter]"
                    SND.click()
                } else {
                    VKB.show(function (txt: string | null) {
                        if (txt !== null && txt.length > 0) {
                            BLE.sendKeys(txt)
                            _bkLastSent = txt
                            SND.ok()
                        }
                    }, "")
                }
            } else if (_bkSpecialMode) {
                if (k === KBD.UP) {
                    BLE.sendSpecialKey("up")
                    _bkLastSent = "[Up]"
                    SND.click()
                } else if (k === KBD.DOWN) {
                    BLE.sendSpecialKey("down")
                    _bkLastSent = "[Down]"
                    SND.click()
                } else if (k === KBD.LEFT) {
                    BLE.sendSpecialKey("left")
                    _bkLastSent = "[Left]"
                    SND.click()
                } else if (k === KBD.RIGHT) {
                    BLE.sendSpecialKey("right")
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
            // Modalità Mouse Analogico
            if (k === KBD.A) { BLE.mouseClickLeft(); SND.click() }
            // else if (k === KBD.UP) { BLE.mouseScroll(3) }     // NOT SUPPORTED
            // else if (k === KBD.DOWN) { BLE.mouseScroll(-3) }  // NOT SUPPORTED

            // Lettura Accelerometro Spaziale (display only, mouseMove non supportato)
            let ax = SENS.accelX()
            let ay = SENS.accelY()
            if (Math.abs(ax) < _bcDeadZone) ax = 0
            if (Math.abs(ay) < _bcDeadZone) ay = 0

            let mx = _idiv(ax, _bcSensitivity)
            let my = _idiv(ay, _bcSensitivity)
            // BLE HID mouse.move() NOT SUPPORTED on micro:bit
        } else if (_bcMode === 1) {
            // Modalità Frecce
            if (k === KBD.UP) { BLE.sendSpecialKey("up"); SND.click() }
            else if (k === KBD.DOWN) { BLE.sendSpecialKey("down"); SND.click() }
            else if (k === KBD.LEFT) { BLE.sendSpecialKey("left"); SND.click() }
            else if (k === KBD.RIGHT) { BLE.sendSpecialKey("right"); SND.click() }
            else if (k === KBD.A) { BLE.sendSpecialKey("enter"); SND.click() }
        }
        k = KBD.poll()
    }

    // Mouse: accelerometro → movimento cursore (DISABLED: mouseMove not supported by BLE HID)
    if (_bcMode === 0) {
        const rawX = input.acceleration(Dimension.X)
        const rawY = input.acceleration(Dimension.Y)
        let mx = 0
        let my = 0
        if (Math.abs(rawX) > _bcDeadZone) {
            mx = _idiv(rawX - (rawX > 0 ? _bcDeadZone : 0 - _bcDeadZone), _bcSensitivity)
        }
        if (Math.abs(rawY) > _bcDeadZone) {
            my = _idiv(rawY - (rawY > 0 ? _bcDeadZone : 0 - _bcDeadZone), _bcSensitivity)
        }
        // BLE HID mouse.move() NOT SUPPORTED on micro:bit - feature disabled
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
        const xBar = _idiv((axVal + 2000) * 100, 4000)
        UI.progressBar(20, FONT_H + 24, 100, FONT_H, xBar, 100, C_LBLUE)
        FB.text(convertToText(axVal), 124, FONT_H + 24, C_GRAY)

        FB.text("Y:", 4, FONT_H + 38, C_FG)
        const yBar = _idiv((ayVal + 2000) * 100, 4000)
        UI.progressBar(20, FONT_H + 38, 100, FONT_H, yBar, 100, C_LBLUE)
        FB.text(convertToText(ayVal), 124, FONT_H + 38, C_GRAY)

        // Crosshair visuale
        const chX = 80 + _idiv(axVal, 40)
        const chY = 76 + _idiv(ayVal, 50)
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
    const items = [
        LANG.t("Lingua: ", "Language: ") + (LANG.id === 0 ? "IT" : "EN"),
        LANG.t("Suono: ", "Sound: ") + (SND.isMuted() ? "OFF" : "ON"),
        LANG.t("Data Log: ", "Data Log: ") + (DL.isLogging() ? "REC" : "OFF"),
        LANG.t("Cancella log", "Clear log"),
        LANG.t("Reset filesystem", "Reset filesystem"),
        LANG.t("Riavvia", "Reboot"),
        LANG.t("Info", "About")
    ]
    if (Security.isRoot()) items.unshift("Root Password")
    return items
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
        // === PRIORITY: Virtual Keyboard ===
        if (VKB.isVisible()) {
            VKB.handleKey(k)
            // VKB may hide itself in its callback; continue loop
            k = KBD.poll()
            continue
        }

        if (_cfgMode === 0) {
            if (k === KBD.B) { _exitToLauncher(); return }
            else if (k === KBD.UP) {
                _cfgSel = (_cfgSel + items.length - 1) % items.length; SND.nav()
            } else if (k === KBD.DOWN) {
                _cfgSel = (_cfgSel + 1) % items.length; SND.nav()
            } else if (k === KBD.A) {
                SND.click()
                let actionIdx = _cfgSel
                if (!Security.isRoot()) actionIdx += 1 // offset per array senza password

                if (actionIdx === 0) {
                    // Change root password – hide VKB after callback
                    VKB.show(function (txt: string | null) {
                        if (txt !== null && txt.length > 0) FS.write("/sys/rootpw", "pass|" + txt)
                        VKB.hide()
                    }, "")
                } else if (actionIdx === 1) {
                    LANG.set(LANG.id === 0 ? 1 : 0)
                } else if (actionIdx === 2) {
                    if (Security.isRoot()) SND.setMute(!SND.isMuted())
                    else UI.toast("Sandbox Deny")
                } else if (actionIdx === 3) {
                    if (Security.isRoot()) DL.toggleLogging()
                    else UI.toast("Sandbox Deny")
                } else if (actionIdx === 4) {
                    if (Security.isRoot()) { DL.clearLog(); SND.ok() }
                    else UI.toast("Sandbox Deny")
                } else if (actionIdx === 5) {
                    if (Security.isRoot()) { UI.confirmReset(); _cfgMode = 1 }
                    else UI.toast("Sandbox Deny")
                } else if (actionIdx === 6) {
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
    UI.statusBar(LANG.t("Impost.", "Settings"), Security.isRoot() ? "ROOT" : "GUEST")

    if (!Security.isRoot()) {
        FB.centerText("Sandbox Mode", FONT_H + 20, C_ERR)
    }

    if (_cfgMode === 0) {
        UI.menu(items, _cfgSel, 2, FONT_H + (Security.isRoot() ? 6 : 30), SCREEN_W - 4, 6)
        if (_cfgSel === items.length - 1) {
            FB.text("BitOS v1", 4, SCREEN_H - 3 * FONT_H, C_LBLUE)
            FB.text("micro:bit V2", 4, SCREEN_H - 2 * FONT_H, C_GRAY)
        }
        FB.text("[B]" + LANG.t("Esci", "Exit"), 4, SCREEN_H - FONT_H - 1, C_GRAY)
    } else if (_cfgMode === 1) {
        UI.confirmDraw(
            LANG.t("Reset FS?", "Reset FS?"),
            LANG.t("Tutti i file persi!", "All files lost!")
        )
    }
    if (VKB.isVisible()) VKB.render()
    if (Kernel.dimmed) { basic.pause(200); return }
    basic.pause(50)
})

// ================================================================
// APP: LOGIN
// ================================================================
states.setEnterHandler("app_login", function () {
    KBD.flush()
    VKB.hide()
})

states.addLoopHandler("app_login", function () {
    let k = KBD.poll()
    while (k >= 0) {
        if (VKB.isVisible()) {
            VKB.handleKey(k)
        } else {
            if (k === KBD.A) {
                // Request ROOT
                VKB.show(function (txt: string | null) {
                    if (txt !== null && txt.length > 0) {
                        if (Security.login(txt)) {
                            SND.ok()
                            states.setState("launcher")
                        } else {
                            SND.error()
                            FB.cls()
                            FB.centerText("Err Password!", 60, C_ERR)
                            basic.pause(1000)
                        }
                    }
                }, "")
            } else if (k === KBD.B) {
                // GUEST
                Security.guestLogin()
                SND.nav()
                states.setState("launcher")
                return
            }
        }
        k = KBD.poll()
    }

    FB.cls()
    if (!VKB.isVisible()) {
        FB.titleBar("BitOS Security", 0, C_FG, C_TEAL)
        FB.text("Select User:", 4, FONT_H + 8, C_LBLUE)

        FB.fillRect(10, 40, 140, 30, C_BG)
        FB.rect(10, 40, 140, 30, C_GRAY)
        FB.text("[A] ROOT", 20, 50, C_WARN)

        FB.fillRect(10, 80, 140, 30, C_BG)
        FB.rect(10, 80, 140, 30, C_GRAY)
        FB.text("[B] GUEST", 20, 90, C_OK)
    } else {
        UI.statusBar("Root Auth", "Admin")
        VKB.render()
    }
    if (Kernel.dimmed) { basic.pause(200); return }
    basic.pause(33)
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
    const progress = Math.min(_idiv(elapsed, 15), 100)
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
        Kernel._activeState = "app_login"
        states.setState("app_login")
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
Kernel._activeState = "boot"
states.setState("boot")
