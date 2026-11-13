// RR Launcher — appels Win32 natifs via koffi (FFI à binaires précompilés, aucune compilation).
// Chargé uniquement sous Windows et toujours dans un try/catch par l'appelant : si koffi ou une DLL
// manque, le launcher fonctionne comme avant (sans bouton Guide hors focus ni mise au premier plan fine).
//
// HWND, HANDLE et pointeurs sont déclarés en intptr_t : ce sont de simples nombres côté JS (le HWND
// d'Electron arrive dans un Buffer, voir hwndOf()).
'use strict';

if (process.platform !== 'win32') throw new Error('Windows uniquement');
const koffi = require('koffi');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

// ---------------------------------------------------------------- XInput
// XInputGetStateEx (ordinal 100, non documentée) = XInputGetState + bit Guide 0x0400.
// XINPUT_STATE : DWORD dwPacketNumber ; XINPUT_GAMEPAD { WORD wButtons ; … } → wButtons à l'offset 4.
const ERROR_SUCCESS = 0;
let xinputOk = false, xinputError = null, getStateEx = null, xinputDll = null;
for (const dll of ['xinput1_4.dll', 'xinput1_3.dll']) {
  try {
    const lib = koffi.load(dll);
    getStateEx = lib.func(100, 'uint32', ['uint32', 'uint8_t *']);
    xinputDll = dll;
    xinputOk = true;
    break;
  } catch (e) { xinputError = `${dll} : ${e.message}`; }
}
const xbuf = Buffer.alloc(32);
// Slot déconnecté : on ne le resonde que toutes les ~2 s (XInputGetState est lent sur un slot vide)
const xEmptyUntil = [0, 0, 0, 0];
function xinputButtons() {
  const out = [null, null, null, null];
  const now = Date.now();
  for (let i = 0; i < 4; i++) {
    if (now < xEmptyUntil[i]) continue;
    xbuf.fill(0);
    const r = getStateEx(i, xbuf);
    if (r === ERROR_SUCCESS) out[i] = xbuf.readUInt16LE(4);
    else xEmptyUntil[i] = now + 2000;
  }
  return out;
}

// ---------------------------------------------------------------- Fenêtres
const EnumWindowsProc = koffi.proto('bool __stdcall RREnumWindowsProc(intptr_t hwnd, intptr_t lParam)');
const EnumWindows = user32.func('bool __stdcall EnumWindows(RREnumWindowsProc *cb, intptr_t lParam)');
const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)');
const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)');
const IsIconic = user32.func('bool __stdcall IsIconic(intptr_t hwnd)');
const GetWindow = user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32_t cmd)');
const GetWindowLongW = user32.func('int32_t __stdcall GetWindowLongW(intptr_t hwnd, int nIndex)');
const RECT = koffi.struct('RR_RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
const GetWindowRect = user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ RR_RECT *rect)');
const ShowWindow = user32.func('bool __stdcall ShowWindow(intptr_t hwnd, int cmd)');
const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(intptr_t hwnd)');
const BringWindowToTop = user32.func('bool __stdcall BringWindowToTop(intptr_t hwnd)');
const GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()');
const AttachThreadInput = user32.func('bool __stdcall AttachThreadInput(uint32_t idAttach, uint32_t idAttachTo, bool fAttach)');
const AllowSetForegroundWindow = user32.func('bool __stdcall AllowSetForegroundWindow(uint32_t pid)');
const keybd_event = user32.func('void __stdcall keybd_event(uint8_t vk, uint8_t scan, uint32_t flags, uintptr_t extra)');
const GetCurrentThreadId = kernel32.func('uint32_t __stdcall GetCurrentThreadId()');

const GW_OWNER = 4, GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80;
const SW_RESTORE = 9, SW_SHOW = 5;
const ASFW_ANY = 0xffffffff;
const VK_MENU = 0x12, KEYEVENTF_KEYUP = 0x2;

const hwndOf = (buf) => (Buffer.isBuffer(buf) ? Number(buf.length >= 8 ? buf.readBigUInt64LE(0) : buf.readUInt32LE(0)) : Number(buf) || 0);

function threadOf(hwnd) { return GetWindowThreadProcessId(hwnd, [0]); }

// Fenêtre principale d'un ensemble de processus : visible, sans propriétaire, pas « tool window »,
// la plus grande (les petits splash / launchers passent après la fenêtre du jeu).
function findMainWindow(pids) {
  const set = new Set([...pids].map(Number));
  if (!set.size) return 0;
  let best = 0, bestArea = -1;
  const cb = (hwnd) => {
    const out = [0];
    GetWindowThreadProcessId(hwnd, out);
    if (!set.has(out[0])) return true;
    if (!IsWindowVisible(hwnd) || GetWindow(hwnd, GW_OWNER)) return true;
    if (GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) return true;
    const r = {};
    GetWindowRect(hwnd, r);
    const area = Math.max(0, (r.right - r.left) * (r.bottom - r.top)) + (IsIconic(hwnd) ? 0 : 1);
    if (area > bestArea) { bestArea = area; best = hwnd; }
    return true;
  };
  EnumWindows(cb, 0); // rappel « transitoire » : valable seulement pendant l'appel, c'est le cas ici
  return best;
}

// Met une fenêtre au premier plan malgré le verrou de Windows (un processus en arrière-plan ne peut
// normalement pas voler le focus) : AttachThreadInput sur le thread de la fenêtre active, puis
// astuce Alt (une frappe Alt synthétique donne le droit de changer de premier plan).
function focusWindow(hwnd) {
  hwnd = hwndOf(hwnd);
  if (!hwnd) return false;
  try {
    if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE); else ShowWindow(hwnd, SW_SHOW);
    if (SetForegroundWindow(hwnd) && GetForegroundWindow() === hwnd) return true;
    const fg = GetForegroundWindow();
    const me = GetCurrentThreadId();
    const fgThread = fg ? threadOf(fg) : 0;
    const attached = fgThread && fgThread !== me ? AttachThreadInput(me, fgThread, true) : false;
    try {
      keybd_event(VK_MENU, 0, 0, 0);
      keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0);
      BringWindowToTop(hwnd);
      SetForegroundWindow(hwnd);
    } finally {
      if (attached) AttachThreadInput(me, fgThread, false);
    }
    return GetForegroundWindow() === hwnd;
  } catch { return false; }
}
function allowForeground() { try { AllowSetForegroundWindow(ASFW_ANY); } catch {} }

// ---------------------------------------------------------------- Processus
const PROCESSENTRY32W = koffi.struct('RR_PROCESSENTRY32W', {
  dwSize: 'uint32_t', cntUsage: 'uint32_t', th32ProcessID: 'uint32_t', th32DefaultHeapID: 'uintptr_t',
  th32ModuleID: 'uint32_t', cntThreads: 'uint32_t', th32ParentProcessID: 'uint32_t', pcPriClassBase: 'int32_t',
  dwFlags: 'uint32_t', szExeFile: koffi.array('uint16_t', 260, 'Typed'),
});
const CreateToolhelp32Snapshot = kernel32.func('intptr_t __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)');
const Process32FirstW = kernel32.func('bool __stdcall Process32FirstW(intptr_t snap, _Inout_ RR_PROCESSENTRY32W *pe)');
const Process32NextW = kernel32.func('bool __stdcall Process32NextW(intptr_t snap, _Inout_ RR_PROCESSENTRY32W *pe)');
const CloseHandle = kernel32.func('bool __stdcall CloseHandle(intptr_t h)');
const OpenProcess = kernel32.func('intptr_t __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)');
const QueryFullProcessImageNameW = kernel32.func('bool __stdcall QueryFullProcessImageNameW(intptr_t h, uint32_t flags, uint8_t *buf, _Inout_ uint32_t *size)');
const TH32CS_SNAPPROCESS = 0x2, PROCESS_QUERY_LIMITED_INFORMATION = 0x1000, INVALID_HANDLE = -1;

function exePath(pid) {
  const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
  if (!h) return '';
  try {
    const buf = Buffer.alloc(2048);
    const size = [1024];
    return QueryFullProcessImageNameW(h, 0, buf, size) ? buf.toString('utf16le', 0, size[0] * 2) : '';
  } finally { CloseHandle(h); }
}
// Liste { pid, ppid, path } de tous les processus (chemin vide si inaccessible, ex. processus système)
function listProcesses() {
  const snap = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
  if (!snap || snap === INVALID_HANDLE) throw new Error('CreateToolhelp32Snapshot');
  const out = [];
  try {
    const pe = { dwSize: koffi.sizeof(PROCESSENTRY32W) };
    let ok = Process32FirstW(snap, pe);
    while (ok) {
      out.push({ pid: pe.th32ProcessID, ppid: pe.th32ParentProcessID });
      pe.dwSize = koffi.sizeof(PROCESSENTRY32W);
      ok = Process32NextW(snap, pe);
    }
  } finally { CloseHandle(snap); }
  for (const p of out) p.path = p.pid > 4 ? exePath(p.pid) : '';
  return out;
}

// ---------------------------------------------------------------- Alimentation
// SetSuspendState(hibernate = FALSE) : veille. Si l'hibernation est désactivée par la stratégie
// ou si le PC est en « Modern Standby », Windows choisit lui-même l'état équivalent.
let SetSuspendState = null;
try { SetSuspendState = koffi.load('powrprof.dll').func('bool __stdcall SetSuspendState(bool hibernate, bool force, bool wakeupEventsDisabled)'); } catch {}
function sleep() { return SetSuspendState ? !!SetSuspendState(false, false, false) : false; }

// ---------------------------------------------------------------- Clavier (DISCORD : raccourci « Go Live »)
// keybd_event : appuie les touches dans l'ordre puis les relâche dans l'ordre inverse.
// Discord écoute ses raccourcis globalement : ils fonctionnent même quand le jeu a le focus.
const MapVirtualKeyW = user32.func('uint32_t __stdcall MapVirtualKeyW(uint32_t uCode, uint32_t uMapType)');
const EXTENDED = new Set([0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2d, 0x2e, 0xa3, 0xa5]);
function sendKeys(vks, holdMs = 60) {
  const flag = (vk, up) => (up ? 0x2 : 0) | (EXTENDED.has(vk) ? 0x1 : 0);
  for (const vk of vks) keybd_event(vk, MapVirtualKeyW(vk, 0), flag(vk, false), 0);
  const end = Date.now() + holdMs; while (Date.now() < end) { /* maintien bref */ }
  for (const vk of [...vks].reverse()) keybd_event(vk, MapVirtualKeyW(vk, 0), flag(vk, true), 0);
  return true;
}

module.exports = {
  sendKeys,
  get xinputOk() { return xinputOk; }, set xinputOk(v) { xinputOk = v; },
  get xinputError() { return xinputError; },
  xinputDll,
  xinputButtons,
  hwndOf, findMainWindow, focusWindow, allowForeground,
  listProcesses,
  canSleep: !!SetSuspendState, sleep,
};
