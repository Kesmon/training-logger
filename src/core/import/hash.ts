/**
 * A stable content hash of imported source text, used to answer one question:
 * has the coach's sheet changed since we last looked?
 *
 * Deliberately **not** `crypto.subtle`. That needs a secure context, which a
 * home-screen PWA has but a plain-http LAN dev server does not — the same
 * reason `core/ids.ts` carries fallbacks. Collision resistance is irrelevant
 * here: the value is compared against exactly one predecessor, and a manual
 * refresh is the escape hatch if it ever went wrong.
 *
 * This is only the cheap first gate. A changed hash does not by itself justify
 * a new routine version — the source is parsed and diffed before anything is
 * written, because a trailing blank row in a spreadsheet changes the bytes
 * without changing the programme.
 */

/**
 * Transport noise that says nothing about the routine: the BOM Excel and Google
 * Sheets prepend, line-ending differences, and trailing blank lines. Normalised
 * away so a re-publish with no edits does not read as a change.
 *
 * Whitespace *within* a line is left alone — that is content, and a coach who
 * edits a cell has edited the routine.
 */
function normalise(text: string): string {
  return text
    .replace(/^﻿/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\n+$/, '')
}

/** FNV-1a, 32-bit, as eight hex characters. */
export function hashSource(text: string): string {
  let h = 0x811c9dc5
  const s = normalise(text)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    // The FNV prime. Math.imul keeps the multiply in 32-bit space; a plain `*`
    // would lose the low bits to floating point once the value grows.
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}
