# Vietnamese IME Fix — Technical Analysis

## Problem

Vietnamese Telex/VNI input in the terminal loses final consonants after toned vowels:
- "viết" → "viế" (missing 't')
- "việc" → "việ" (missing 'c')
- "tại" → "tạ" (missing 'i')
- "vẫn" → "vẫ" (missing 'n')

## Root Cause

### Discovery: macOS Vietnamese IME does NOT use composition events

After extensive debugging, we discovered that the macOS Vietnamese Telex IME operates in **inline-replacement mode**, NOT composition mode:

- **No `compositionstart`/`compositionend` events** fire at all
- **No `keyCode 229`** events fire
- The IME sends **backspace (DEL) + replacement text** through normal keyboard events
- The IME also updates the **textarea directly** via `input` events with the correct text

### The actual bug: incomplete keyboard replacement

When the IME replaces a vowel that has consonants after it, the keyboard data path is **incomplete**:

```
Example: typing "vieets" (Telex for "viết")

v → onData "v"                    terminal: "v"
i → onData "i"                    terminal: "vi"
e → onData "e"                    terminal: "vie"
e → onData DEL + "ê"              terminal: "viê"     (e→ê, 1:1 OK)
t → onData "t"                    terminal: "viêt"
s → onData DEL DEL + "ế"          terminal: "viế"     (BUG!)
     input event data="ết"         textarea has "ết"   (correct!)
```

When applying tone 's' (sắc) to "ê" in "viêt":
1. IME sends **2 DELs** — removes "êt" (2 characters)
2. IME sends **"ế"** via keyboard — only the toned vowel (1 character)
3. The **"t"** after the vowel is **NOT re-sent** through the keyboard path
4. The textarea/input event correctly has **"ết"** (2 characters) but xterm.js ignores it

### Why xterm.js ignores the input event

xterm.js's `_inputEvent` handler (capture phase) checks:
```typescript
if (!ev.composed || !this._keyDownSeen) { /* process */ }
```
Since `_keyDownSeen` is `true` and `ev.composed` is `true` for IME input events, the condition is `false` and the input event is NOT processed.

## Fix Applied

**File**: `src/components/terminal/TerminalView.tsx`

### Approach: IME inline-replacement tracking

Track DEL+replacement patterns in `onData`. When the subsequent `input` event shows the IME intended more text than what was sent via keyboard, send the missing characters.

```
State machine:
  onData DEL     → imeActive=true, imeDelCount++, imeReplacementSent=""
  onData DEL     → imeDelCount++
  onData "ế"     → imeReplacementSent="ế" (first non-DEL after DELs)
  input  "ết"    → compare: sent="ế" expected="ết" → send missing "t"
  onData "x"     → (next normal char) reset tracking
```

### Key code locations

1. **IME state tracking** (variables: `imeDelCount`, `imeReplacementSent`, `imeActive`)
2. **onData handler**: detects DEL characters and tracks the replacement text sent via keyboard
3. **onInput handler**: compares `inputEvent.data` with `imeReplacementSent`, sends missing suffix

### Composition event handlers (retained)

The composition event handlers (`compositionstart`/`compositionend`) are retained for IMEs that DO use composition events (Japanese, Chinese, Korean, and potentially some Vietnamese IMEs on other platforms). They block xterm.js's `CompositionHelper` from interfering.

## Failed Approaches (for reference)

### 1. Intercepting composition events only
- **Why it failed**: macOS Vietnamese Telex doesn't USE composition events at all

### 2. Standalone capture-phase keydown handler for keyCode 229
- **Why it failed**: xterm.js registers its capture-phase keydown handler FIRST (during `term.open()`), so our handler fires SECOND. `stopImmediatePropagation()` is useless.

### 3. `attachCustomKeyEventHandler` for keyCode 229
- **Why it partially works**: This callback runs INSIDE xterm.js's `_keyDown()` BEFORE `CompositionHelper.keydown()`. Good for composition-based IMEs. But irrelevant for macOS Vietnamese since no keyCode 229 fires.

### 4. Overriding `_isSendingComposition` via Object.defineProperty
- **Why it failed**: The public `Terminal` is a wrapper; `_compositionHelper` lives on `_core`, not the public instance.

## Why the fix was unstable (Claude Code vs Codex CLI)

Claude Code (Bun binary) frequently queries the terminal for cursor position (`\x1b[6n`)
while rendering its TUI prompt. xterm.js answers these queries by firing `onData` with the
response (e.g. `\x1b[24;10R`). Because `onData` is also used for user keystrokes, the
cursor-position response was hitting the `else` branch of the IME state machine and
resetting `imeActive = false` before the browser `input` event had a chance to fire.

Codex CLI (Rust binary with `stdio: "inherit"`) rarely queries cursor position during
typing, so the race never occurred.

**Fix**: treat any `data` starting with ESC (`0x1b`) as a terminal response sequence and
skip it in the IME state machine — let it pass through to the PTY without touching
`imeActive`, `imeDelCount`, or `imeReplacementSent`.

## V2 Improvements (March 2026)

### Problem: text jumping and disappearing in Claude Code

Even after the initial fix, Claude Code CLI still caused:
- **Text jumping**: Claude Code's TUI re-renders during IME replacement showed
  intermediate states (e.g. "viế" flashing before "viết" appeared)
- **Text disappearing**: Multi-character DEL sequences arriving in a single onData
  event (e.g. `"\x7f\x7f"`) were not detected as DELs because the old code only
  checked single-character data

Gemini CLI and Codex worked stably because they re-render less frequently during typing.

### Fixes applied

1. **Multi-character DEL detection**: Scan for leading DEL/BS characters in each
   onData string instead of only checking `data.length === 1`. This handles cases
   where the IME sends `"\x7f\x7fế"` (2 DELs + replacement) in a single event.

2. **PTY output deferral during IME**: Set `imeFlushDeferred = true` when DELs are
   detected. `scheduleFlush()` skips scheduling while deferred. This batches all of
   Claude Code's intermediate TUI re-renders into a single flush after the IME
   operation completes, eliminating visual jumps.

3. **Replacement text accumulation**: Changed from capturing only the first non-DEL
   chunk to accumulating all non-DEL text while `imeActive` is true. This handles
   edge cases where the IME sends replacement text in multiple onData chunks.

4. **Safety timeout (30ms)**: If `onInput` doesn't fire within 30ms after the last
   DEL, `imeReset()` clears all IME state and resumes output flushing. This prevents
   stuck state from normal backspace usage or unexpected IME behavior.

5. **Centralized imeReset()**: Single function that clears all IME state variables,
   clears the timeout, undefers output, and triggers a flush. Used by both onInput
   handler and the safety timeout.

6. **Removed debug console.log**: The `[IME] fix:` log lines were removed for
   production.

## Edge Cases & Future Enhancement Ideas

### Known limitations
- The fix relies on `inputEvent.data` starting with `imeReplacementSent`.
- The textarea accumulates text across keystrokes. xterm.js manages cleanup, but if it doesn't, this could grow unbounded.
- Only tested on macOS Vietnamese Telex. Other Vietnamese IMEs (GoTiengViet, UniKey, EVKey) untested.

### Potential enhancements
- **Direct textarea diff tracking**: Track textarea value changes instead of onData patterns. More robust but more complex.
- **Test with other Vietnamese IMEs**: GoTiengViet, UniKey, EVKey — they may use different mechanisms (composition events, keyCode 229, or inline replacement).
- **Test on Linux/Windows**: Different OS IME behaviors. Linux ibus/fcitx may use composition events. Windows may differ too.

## References

- xterm.js `CompositionHelper`: `node_modules/@xterm/xterm/src/browser/input/CompositionHelper.ts`
- xterm.js `Terminal._keyDown`: `node_modules/@xterm/xterm/src/browser/Terminal.ts` ~line 1001
- xterm.js `Terminal._inputEvent`: `node_modules/@xterm/xterm/src/browser/Terminal.ts` ~line 1172
- gonhanh.org Vietnamese IME (studied for reference): uses synchronous keystroke→Result model, never uses composition events
- WebKit Bug #164369: compositionend may not fire on blur
