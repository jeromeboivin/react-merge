/** The character sets accepted by `-C` and offered in the Character Encoding menu. */
export interface Charset {
  id: string
  label: string
  group: string
  /** iconv-lite encoding name. */
  iconv: string
  /** Write a byte-order mark when saving. */
  bom: boolean
  /** A Unicode encoding, so a byte-order mark found in the file may override it. */
  unicode: boolean
}

const C = (
  id: string,
  label: string,
  group: string,
  iconv: string,
  bom = false,
  unicode = false
): Charset => ({
  id,
  label,
  group,
  iconv,
  bom,
  unicode
})

export const CHARSETS: readonly Charset[] = [
  C('none', 'System', 'System', 'utf8', false, true),
  C('utf8', 'UTF-8', 'Unicode', 'utf8', false, true),
  C('utf8-bom', 'UTF-8 with BOM', 'Unicode', 'utf8', true, true),
  C('utf16', 'UTF-16 (BOM)', 'Unicode', 'utf16le', true, true),
  C('utf16-nobom', 'UTF-16', 'Unicode', 'utf16le', false, true),
  C('utf16be', 'UTF-16 BE', 'Unicode', 'utf16be', false, true),
  C('utf16be-bom', 'UTF-16 BE with BOM', 'Unicode', 'utf16be', true, true),
  C('utf16le', 'UTF-16 LE', 'Unicode', 'utf16le', false, true),
  C('utf16le-bom', 'UTF-16 LE with BOM', 'Unicode', 'utf16le', true, true),
  C('utf32', 'UTF-32 (BOM)', 'Unicode', 'utf32le', true, true),
  C('utf32-nobom', 'UTF-32', 'Unicode', 'utf32le', false, true),
  C('utf32be', 'UTF-32 BE', 'Unicode', 'utf32be', false, true),
  C('utf32be-bom', 'UTF-32 BE with BOM', 'Unicode', 'utf32be', true, true),
  C('utf32le', 'UTF-32 LE', 'Unicode', 'utf32le', false, true),
  C('utf32le-bom', 'UTF-32 LE with BOM', 'Unicode', 'utf32le', true, true),
  C('iso8859-1', 'ISO 8859-1', 'Western European', 'iso88591'),
  C('winansi', 'Windows 1252', 'Western European', 'win1252'),
  C('macosroman', 'Mac Roman', 'Western European', 'macintosh'),
  C('iso8859-15', 'ISO 8859-15', 'Western European', 'iso885915'),
  C('cp850', 'Code page 850', 'Western European', 'cp850'),
  C('shiftjis', 'Shift-JIS', 'Japanese', 'shiftjis'),
  C('eucjp', 'EUC-JP', 'Japanese', 'eucjp'),
  C('iso8859-5', 'ISO 8859-5', 'Cyrillic', 'iso88595'),
  C('koi8-r', 'KOI8-R', 'Cyrillic', 'koi8r'),
  C('cp1251', 'Windows 1251', 'Cyrillic', 'win1251'),
  C('cp949', 'Code page 949', 'Korean', 'cp949'),
  C('cp936', 'GBK (code page 936)', 'Chinese', 'cp936'),
  C('cp950', 'Big5 (code page 950)', 'Chinese', 'cp950'),
  C('cp1253', 'Windows 1253', 'Greek', 'win1253'),
  C('iso8859-7', 'ISO 8859-7', 'Greek', 'iso88597')
]

export const CHARSET_GROUPS: readonly string[] = [...new Set(CHARSETS.map((c) => c.group))]

export function findCharset(id: string): Charset | undefined {
  return CHARSETS.find((c) => c.id === id.toLowerCase())
}

export function charsetLabel(id: string): string {
  return findCharset(id)?.label ?? id
}
