import type { Root, RootContent } from 'hast'

/** A run of text with Prism token classes ('' for plain text). */
export interface SyntaxSeg {
  text: string
  cls: string
}

const EXT_LANG: Record<string, string> = {
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  hxx: 'cpp',
  cs: 'csharp',
  java: 'java',
  kt: 'kotlin',
  kts: 'kotlin',
  scala: 'scala',
  go: 'go',
  rs: 'rust',
  swift: 'swift',
  m: 'objectivec',
  mm: 'objectivec',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'jsx',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  json: 'json',
  json5: 'json5',
  py: 'python',
  pyw: 'python',
  rb: 'ruby',
  php: 'php',
  pl: 'perl',
  pm: 'perl',
  lua: 'lua',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  psm1: 'powershell',
  bat: 'batch',
  cmd: 'batch',
  sql: 'sql',
  html: 'markup',
  htm: 'markup',
  xml: 'markup',
  xsd: 'markup',
  xsl: 'markup',
  svg: 'markup',
  vue: 'markup',
  css: 'css',
  scss: 'scss',
  sass: 'sass',
  less: 'less',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'toml',
  ini: 'ini',
  cfg: 'ini',
  properties: 'properties',
  dockerfile: 'docker',
  makefile: 'makefile',
  mk: 'makefile',
  cmake: 'cmake',
  gradle: 'groovy',
  groovy: 'groovy',
  dart: 'dart',
  r: 'r',
  hs: 'haskell',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  clj: 'clojure',
  fs: 'fsharp',
  vb: 'vbnet',
  pas: 'pascal',
  diff: 'diff',
  patch: 'diff',
  tex: 'latex',
  graphql: 'graphql',
  proto: 'protobuf',
  tf: 'hcl',
  nim: 'nim',
  zig: 'zig'
}

/** Guess the language from a file name (the path, or the label when there is no path). */
export function languageFor(name: string | undefined): string | null {
  if (!name) return null
  const base = name.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (base === 'dockerfile') return 'docker'
  if (base === 'makefile' || base === 'gnumakefile') return 'makefile'
  if (base === 'cmakelists.txt') return 'cmake'
  const dot = base.lastIndexOf('.')
  if (dot < 0) return null
  return EXT_LANG[base.slice(dot + 1)] ?? null
}

/** Above this size, highlighting is skipped: it would stall the window. */
const MAX_CHARS = 2_000_000

type RefractorModule = typeof import('refractor/all')
let refractorPromise: Promise<RefractorModule> | null = null

/** Highlight a whole document and cut the result into lines. */
export async function highlightLines(
  lines: readonly string[],
  lang: string | null
): Promise<SyntaxSeg[][] | null> {
  if (!lang) return null
  let total = 0
  for (const l of lines) total += l.length + 1
  if (total > MAX_CHARS) return null
  refractorPromise ??= import('refractor/all')
  const { refractor } = await refractorPromise
  if (!refractor.registered(lang)) return null
  let tree: Root
  try {
    tree = refractor.highlight(lines.join('\n'), lang)
  } catch {
    return null
  }
  const out: SyntaxSeg[][] = [[]]
  const walk = (nodes: readonly RootContent[], cls: string): void => {
    for (const n of nodes) {
      if (n.type === 'text') {
        const parts = n.value.split('\n')
        parts.forEach((p, i) => {
          if (i > 0) out.push([])
          if (p) out[out.length - 1].push({ text: p, cls })
        })
      } else if (n.type === 'element') {
        const c = n.properties.className
        const names = Array.isArray(c) ? c.join(' ') : typeof c === 'string' ? c : ''
        walk(n.children, cls ? `${cls} ${names}` : names)
      }
    }
  }
  walk(tree.children, '')
  return out
}
