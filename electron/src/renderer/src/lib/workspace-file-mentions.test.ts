import { describe, expect, it } from 'vitest'
import { insertWorkspaceFileMention, workspaceMentionText } from './workspace-file-mentions'

describe('workspace file mentions', () => {
  it('formats plain, spaced and directory paths', () => {
    expect(workspaceMentionText('src/a.ts')).toBe('@src/a.ts')
    expect(workspaceMentionText('my dir/a b.ts')).toBe('@"my dir/a b.ts"')
    expect(workspaceMentionText('src/', 'directory')).toBe('@src/')
  })
  it('replaces the @query span and adds spacing', () => {
    expect(insertWorkspaceFileMention('see @ab', 4, 7, 'src/abc.ts')).toEqual({ text: 'see @src/abc.ts ', caret: 16 })
    expect(insertWorkspaceFileMention('hi', 2, 2, 'a.ts').text).toBe('hi @a.ts ')
    expect(insertWorkspaceFileMention('x @q tail', 2, 4, 'a.ts').text).toBe('x @a.ts tail')
  })
  it('starts a new line after a standalone file reference', () => {
    expect(insertWorkspaceFileMention('@ab', 0, 3, 'src/abc.ts')).toEqual({
      text: '@src/abc.ts\n', caret: 12
    })
    expect(insertWorkspaceFileMention('  @ab', 2, 5, 'src/abc.ts')).toEqual({
      text: '  @src/abc.ts\n', caret: 14
    })
  })
})
