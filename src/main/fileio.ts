import { promises as fs } from 'fs'
import iconv from 'iconv-lite'
import { CHARSETS, findCharset, type Charset } from '../shared/charsets'
import type { LoadedFile } from '../shared/ipc'

const BOMS: { bytes: number[]; charset: string }[] = [
  { bytes: [0xef, 0xbb, 0xbf], charset: 'utf8-bom' },
  { bytes: [0xff, 0xfe, 0x00, 0x00], charset: 'utf32le-bom' },
  { bytes: [0x00, 0x00, 0xfe, 0xff], charset: 'utf32be-bom' },
  { bytes: [0xff, 0xfe], charset: 'utf16le-bom' },
  { bytes: [0xfe, 0xff], charset: 'utf16be-bom' }
]

export function detectBom(buf: Uint8Array): Charset | undefined {
  for (const b of BOMS) {
    if (buf.length >= b.bytes.length && b.bytes.every((x, i) => buf[i] === x))
      return findCharset(b.charset)
  }
  return undefined
}

function looksBinary(buf: Uint8Array): boolean {
  const n = Math.min(buf.length, 8000)
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true
  return false
}

function validUtf8(buf: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf)
    return true
  } catch {
    return false
  }
}

/**
 * Decode file bytes. A byte-order mark wins over a Unicode or system charset; `suspect` is set
 * when the bytes are not valid in the charset used (the user is then offered another one).
 */
export function decode(buf: Uint8Array, charsetId: string): Omit<LoadedFile, 'path' | 'size'> {
  const requested = findCharset(charsetId) ?? CHARSETS[0]
  const bom = detectBom(buf)
  const cs = bom && requested.unicode ? bom : requested
  const hasBom = bom !== undefined && cs === bom
  const body = hasBom ? buf.subarray(bomLength(bom)) : buf
  const binary = !cs.iconv.startsWith('utf16') && !cs.iconv.startsWith('utf32') && looksBinary(body)
  const suspect = cs.iconv === 'utf8' && !validUtf8(body)
  const text = iconv.decode(Buffer.from(body.buffer, body.byteOffset, body.byteLength), cs.iconv, {
    stripBOM: false
  })
  return { text, charset: cs.id, binary, suspect }
}

function bomLength(cs: Charset): number {
  if (cs.iconv === 'utf8') return 3
  if (cs.iconv.startsWith('utf32')) return 4
  return 2
}

export function encode(text: string, charsetId: string): Buffer {
  const cs = findCharset(charsetId) ?? CHARSETS[0]
  const body = iconv.encode(text, cs.iconv, { addBOM: false })
  if (!cs.bom) return body
  const bom = iconv.encode('﻿', cs.iconv, { addBOM: false })
  return Buffer.concat([bom, body])
}

export async function loadFile(path: string, charsetId: string): Promise<LoadedFile> {
  const buf = await fs.readFile(path)
  return { path, size: buf.length, ...decode(buf, charsetId) }
}

export async function saveFile(path: string, text: string, charsetId: string): Promise<void> {
  await fs.writeFile(path, encode(text, charsetId))
}
