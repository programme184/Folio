import { describe, expect, it } from 'vitest'
import {
  normalizeProjectDirectories,
  normalizeProjectSSHWorkspace,
  normalizeProjectWorkspaces,
  projectDirectories,
  projectSSHWorkspace,
  renameProjectWorkspace,
  withoutProject
} from './project-workspaces'

describe('project workspaces', () => {
  it('keeps distinct absolute directories and drops relative or duplicate paths', () => {
    expect(normalizeProjectDirectories([
      ' /home/ubuntu/Hand ',
      '/home/ubuntu/Hand/',
      '/home/ubuntu/Hand/../Hand',
      'relative/path',
      '',
      '/home/ubuntu/Notes',
      'C:\\Work\\Lab\\'
    ])).toEqual(['/home/ubuntu/Hand', '/home/ubuntu/Hand/../Hand', '/home/ubuntu/Notes', 'C:\\Work\\Lab'])
  })

  it('stores only named projects that have at least one directory', () => {
    expect(normalizeProjectWorkspaces({
      ' Humanoid ': { directories: ['/work/humanoid'] },
      Empty: { directories: [] },
      Bad: { directories: ['../outside'] },
      Notes: null
    })).toEqual({ Humanoid: { directories: ['/work/humanoid'] } })
  })

  it('normalizes an SSH workspace without treating its remote path as local', () => {
    expect(normalizeProjectSSHWorkspace({ host: ' ubuntu@Synria ', path: ' /home/ubuntu/project/ ' }))
      .toEqual({ host: 'ubuntu@Synria', path: '/home/ubuntu/project' })
    expect(normalizeProjectSSHWorkspace({ host: '-oProxyCommand=bad', path: '/project' })).toBeNull()
    expect(normalizeProjectSSHWorkspace({ host: 'Synria', path: 'relative' })).toBeNull()
    const workspaces = normalizeProjectWorkspaces({
      Remote: { directories: [], ssh_workspace: { host: 'Synria', path: '/home/ubuntu/project' } }
    })
    expect(projectDirectories(workspaces, 'Remote')).toEqual([])
    expect(projectSSHWorkspace(workspaces, 'Remote')).toEqual({ host: 'Synria', path: '/home/ubuntu/project' })
  })

  it('renames and removes a project without changing its directories', () => {
    const stored = { Humanoid: { directories: ['/work/a', '/work/b'] }, test: { directories: ['/work/test'] } }
    expect(projectDirectories(stored, 'Humanoid')).toEqual(['/work/a', '/work/b'])
    expect(renameProjectWorkspace(stored, 'Humanoid', 'Robot')).toEqual({
      Robot: { directories: ['/work/a', '/work/b'] },
      test: { directories: ['/work/test'] }
    })
    expect(withoutProject(stored, 'test')).toEqual({ Humanoid: { directories: ['/work/a', '/work/b'] } })
    expect(withoutProject(stored, 'missing')).toBe(stored)
  })
})
