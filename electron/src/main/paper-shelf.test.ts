import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createPaperShelfWith, DEFAULT_PAPER_ROOT, type PaperShelfDependencies } from './paper-shelf'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true })))
})

async function temp(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  roots.push(path)
  return path
}

function memoryShelf(root: string | null, extras: Partial<PaperShelfDependencies> = {}) {
  let stored = root
  return createPaperShelfWith({
    readRoot: () => stored,
    writeRoot: value => { stored = value },
    chooseDirectory: async () => null,
    ...extras
  })
}

describe('local paper shelf', () => {
  it('uses the default folder until a directory is chosen', async () => {
    const shelf = memoryShelf('relative/papers')
    expect(await shelf.root()).toBe(DEFAULT_PAPER_ROOT)
    expect(await shelf.chooseRoot()).toEqual({ root: DEFAULT_PAPER_ROOT, changed: false })
  })

  it('lists and reads only PDFs inside the chosen folder', async () => {
    const root = await temp('agentsdock-papers-')
    const outside = await temp('agentsdock-papers-out-')
    await mkdir(join(root, 'nested'))
    await writeFile(join(root, 'nested', 'hand.pdf'), 'paper-bytes')
    await writeFile(join(root, 'notes.txt'), 'ignore')
    await writeFile(join(outside, 'secret.pdf'), 'secret')
    await symlink(join(outside, 'secret.pdf'), join(root, 'escape.pdf'))
    const shelf = memoryShelf(root)
    const listed = await shelf.list()
    expect(listed.error).toBeUndefined()
    expect(listed.files.map(file => file.path)).toEqual(['nested/hand.pdf'])
    const bytes = await shelf.read('nested/hand.pdf')
    expect(Buffer.from(bytes.data).toString()).toBe('paper-bytes')
    await expect(shelf.read('escape.pdf')).rejects.toThrow('papers_path_escapes_root')
    await expect(shelf.read('../secret.pdf')).rejects.toThrow('papers_path_escapes_root')
    await expect(shelf.read('/etc/passwd')).rejects.toThrow('papers_path_escapes_root')
    await expect(shelf.read('notes.txt')).rejects.toThrow('papers_path_escapes_root')
  })

  it('reports a missing folder and refuses files or oversized PDFs', async () => {
    const root = await temp('agentsdock-papers-')
    const missing = memoryShelf(join(root, 'missing'))
    expect(await missing.list()).toMatchObject({ files: [], error: 'papers_root_missing' })
    const file = join(root, 'one.pdf')
    await writeFile(file, '0123456789')
    const shelf = memoryShelf(root, {
      maxBytes: 4,
      chooseDirectory: async () => file
    })
    await expect(shelf.chooseRoot()).rejects.toThrow('papers_not_a_directory')
    await expect(shelf.read('one.pdf')).rejects.toThrow('papers_file_too_large')
    const chosen = await temp('agentsdock-papers-next-')
    const switching = memoryShelf(root, { chooseDirectory: async () => chosen })
    expect(await switching.chooseRoot()).toEqual({ root: chosen, changed: true })
    expect(await switching.root()).toBe(chosen)
  })
})
