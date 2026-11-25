import { decode, encode } from './fileio'

describe('decode/encode', () => {
  it('round-trips through every charset family', () => {
    for (const cs of [
      'utf8',
      'utf8-bom',
      'utf16',
      'utf16be-bom',
      'utf32le',
      'winansi',
      'shiftjis',
      'koi8-r'
    ]) {
      const text = cs === 'shiftjis' ? 'abc 日本\n' : cs === 'koi8-r' ? 'привет\n' : 'café €\n'
      const r = decode(encode(text, cs), cs)
      expect(r.text).toBe(text)
      expect(r.binary).toBe(false)
    }
  })

  it('lets a byte-order mark override a unicode/system charset', () => {
    const r = decode(encode('hé', 'utf16be-bom'), 'none')
    expect(r).toMatchObject({ text: 'hé', charset: 'utf16be-bom', suspect: false })
    expect([...encode('a', 'utf8-bom')]).toEqual([0xef, 0xbb, 0xbf, 0x61])
  })

  it('flags binary and invalid UTF-8', () => {
    expect(decode(new Uint8Array([1, 0, 2]), 'none').binary).toBe(true)
    expect(decode(new Uint8Array([0x63, 0xe9, 0x0a]), 'none').suspect).toBe(true)
    expect(decode(new Uint8Array([0x63, 0xe9, 0x0a]), 'winansi')).toMatchObject({
      text: 'cé\n',
      suspect: false
    })
  })
})
