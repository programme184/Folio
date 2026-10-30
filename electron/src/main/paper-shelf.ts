import { realpath, readdir, readFile, stat } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'

export const DEFAULT_PAPER_ROOT = '/home/ubuntu/Zotero/Context/Hand'
// Same ceiling as workspace PDF preview, which follows the server's 100 MiB default.
export const PAPER_PDF_BYTE_LIMIT = 100 * 1024 * 1024
const MAX_PAPERS = 2000
const MAX_DEPTH = 8

export interface PaperFileEntry {
  path: string
  name: string
  bytes: number
}

export interface PaperListResult {
  root: string
  files: PaperFileEntry[]
  error?: string
}

export interface PaperBytes {
  path: string
  name: string
  data: Uint8Array
}

export interface PaperRootResult {
  root: string
  changed: boolean
}

export interface PaperShelf {
  root(): Promise<string>
  chooseRoot(): Promise<PaperRootResult>
  list(): Promise<PaperListResult>
  read(relativePath: string): Promise<PaperBytes>
}

export interface PaperShelfDependencies {
  readRoot(): string | null
  writeRoot(root: string): void
  chooseDirectory(defaultPath: string): Promise<string | null>
  maxBytes?: number
}

export function createPaperShelfWith(dependencies: PaperShelfDependencies): PaperShelf {
  const maxBytes = dependencies.maxBytes ?? PAPER_PDF_BYTE_LIMIT
  const configured = () => {
    const stored = dependencies.readRoot()
    return stored && isAbsolute(stored) ? stored : DEFAULT_PAPER_ROOT
  }
  return {
    root: async () => configured(),
    async chooseRoot() {
      const current = configured()
      const picked = await dependencies.chooseDirectory(current)
      if (!picked) return { root: current, changed: false }
      const real = await directory(picked)
      dependencies.writeRoot(real)
      return { root: real, changed: real !== current }
    },
    async list() {
      const current = configured()
      try {
        const root = await directory(current)
        return { root, files: await collectPdfs(root) }
      } catch (error) {
        return { root: current, files: [], error: codeOf(error) }
      }
    },
    async read(relativePath: string) {
      const parts = portableParts(relativePath)
      if (!parts) throw new Error('papers_path_escapes_root')
      const root = await directory(configured())
      const absolute = resolve(root, ...parts)
      let real: string
      try {
        real = await realpath(absolute)
      } catch {
        throw new Error('papers_root_unreadable')
      }
      if (!isInside(root, real) || !real.toLowerCase().endsWith('.pdf')) throw new Error('papers_path_escapes_root')
      const info = await stat(real)
      if (!info.isFile()) throw new Error('papers_not_pdf')
      if (info.size > maxBytes) throw new Error('papers_file_too_large')
      const buffer = await readFile(real)
      const data = new Uint8Array(buffer.byteLength)
      data.set(buffer)
      return { path: parts.join('/'), name: parts[parts.length - 1], data }
    }
  }
}

async function directory(path: string): Promise<string> {
  try {
    const real = await realpath(path)
    const info = await stat(real)
    if (!info.isDirectory()) throw new Error('papers_not_a_directory')
    return real
  } catch (error) {
    if (error instanceof Error && error.message === 'papers_not_a_directory') throw error
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') throw new Error('papers_root_missing')
    throw new Error('papers_root_unreadable')
  }
}

async function collectPdfs(root: string): Promise<PaperFileEntry[]> {
  const files: PaperFileEntry[] = []
  const seen = new Set<string>()
  const walk = async (directoryPath: string, depth: number): Promise<void> => {
    if (depth > MAX_DEPTH || files.length >= MAX_PAPERS) return
    const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => [])
    for (const entry of entries) {
      if (files.length >= MAX_PAPERS || entry.name.startsWith('.')) continue
      const real = await realpath(resolve(directoryPath, entry.name)).catch(() => null)
      if (!real || !isInside(root, real) || seen.has(real)) continue
      seen.add(real)
      const info = await stat(real).catch(() => null)
      if (!info) continue
      if (info.isDirectory()) await walk(real, depth + 1)
      else if (info.isFile() && real.toLowerCase().endsWith('.pdf')) {
        files.push({
          path: relative(root, real).split(sep).join('/'),
          name: entry.name,
          bytes: info.size
        })
      }
    }
  }
  await walk(root, 0)
  return files.sort((a, b) => a.path.localeCompare(b.path))
}

function portableParts(input: string): string[] | null {
  if (typeof input !== 'string' || !input || input.length > 1024 || input.includes('\0') || input.includes('\\')) return null
  if (input.startsWith('/')) return null
  const parts = input.split('/')
  if (parts.some(part => !part || part === '.' || part === '..')) return null
  if (!parts[parts.length - 1].toLowerCase().endsWith('.pdf')) return null
  return parts
}

function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function codeOf(error: unknown): string {
  return error instanceof Error && error.message.startsWith('papers_') ? error.message : 'papers_root_unreadable'
}
