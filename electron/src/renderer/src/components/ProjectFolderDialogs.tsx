import { t } from '@shared/i18n'
import { normalizeProjectDirectories, projectDirectories } from '@shared/project-workspaces'
import { FolderOpen, X } from 'lucide-react'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useLocale } from '../lib/i18n'
import { useTransientClose } from '../lib/transient-close'
import { useAppStore } from '../store/app-store'
import { WorkingDirectoryInput } from './WorkingDirectoryInput'

export function FolderDialog() {
  useLocale()
  const open = useAppStore(state => state.modals.folder)
  const [name, setName] = useState('')
  const [directories, setDirectories] = useState<string[]>([])
  useEffect(() => {
    if (!open) return
    setName('')
    setDirectories([])
  }, [open])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!useAppStore.getState().createProject(name, directories)) return
    useAppStore.getState().setModal('folder', false)
  }
  return <Shell open={open} onOpenChange={value => useAppStore.getState().setModal('folder', value)} title={t('ui.Dialogs.FolderDialog.new_folder_cf28f49')} description={t('ui.Dialogs.FolderDialog.create_an_empty_chat_folder_then_drag_or_m_b438439')}>
    <form onSubmit={submit} className="dialog-form">
      <label><span>{t('ui.Dialogs.FolderDialog.project_name')}</span><input autoFocus value={name} onChange={event => setName(event.target.value)} /></label>
      <ProjectDirectoryEditor directories={directories} onChange={setDirectories} />
      <footer>
        <button type="button" className="quiet-button" onClick={() => useAppStore.getState().setModal('folder', false)}>{t('ui.Dialogs.FolderDialog.cancel_19766ed')}</button>
        <button className="primary-button" disabled={!name.trim() || directories.length === 0}>{t('ui.Dialogs.FolderDialog.create_folder_82b9e1e')}</button>
      </footer>
    </form>
  </Shell>
}

export function RenameProjectDialog() {
  useLocale()
  const [folder, setFolder] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<string>).detail
      if (typeof next !== 'string' || !next.trim()) return
      setFolder(next)
      setName(next)
      setSaving(false)
    }
    window.addEventListener('agentsdock:rename-project', open)
    return () => window.removeEventListener('agentsdock:rename-project', open)
  }, [])
  const close = () => { if (!saving) setFolder(null) }
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!folder || saving) return
    setSaving(true)
    const renamed = await useAppStore.getState().renameProject(folder, name)
    setSaving(false)
    if (renamed) setFolder(null)
  }
  return <Shell open={Boolean(folder)} onOpenChange={open => { if (!open) close() }} title={t('ui.Dialogs.FolderDialog.rename_project')} description={t('ui.Dialogs.FolderDialog.rename_project_description')} closeDisabled={saving}>
    <form onSubmit={event => void submit(event)} className="dialog-form">
      <label><span>{t('ui.Dialogs.FolderDialog.project_name')}</span><input autoFocus disabled={saving} value={name} onChange={event => setName(event.target.value)} onFocus={event => event.currentTarget.select()} /></label>
      <footer>
        <button type="button" className="quiet-button" disabled={saving} onClick={close}>{t('ui.Dialogs.FolderDialog.cancel_19766ed')}</button>
        <button className="primary-button" disabled={saving || !name.trim()}>{t('ui.Dialogs.FolderDialog.rename')}</button>
      </footer>
    </form>
  </Shell>
}

export function ProjectFoldersDialog() {
  useLocale()
  const [folder, setFolder] = useState<string | null>(null)
  const [directories, setDirectories] = useState<string[]>([])
  useEffect(() => {
    const open = (event: Event) => {
      const next = (event as CustomEvent<string>).detail
      if (typeof next !== 'string' || !next.trim()) return
      setFolder(next)
      setDirectories(projectDirectories(useAppStore.getState().projectWorkspaces, next))
    }
    window.addEventListener('agentsdock:edit-project-folders', open)
    return () => window.removeEventListener('agentsdock:edit-project-folders', open)
  }, [])
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!folder) return
    if (!useAppStore.getState().setProjectDirectories(folder, directories)) return
    setFolder(null)
  }
  return <Shell open={Boolean(folder)} onOpenChange={open => { if (!open) setFolder(null) }} title={t('ui.Dialogs.FolderDialog.change_folders')} description={folder ? t('ui.Dialogs.FolderDialog.change_folders_description', { name: folder }) : ''}>
    <form onSubmit={submit} className="dialog-form">
      <ProjectDirectoryEditor directories={directories} onChange={setDirectories} />
      <footer>
        <button type="button" className="quiet-button" onClick={() => setFolder(null)}>{t('ui.Dialogs.FolderDialog.cancel_19766ed')}</button>
        <button className="primary-button" disabled={directories.length === 0}>{t('ui.Dialogs.FolderDialog.save')}</button>
      </footer>
    </form>
  </Shell>
}

function ProjectDirectoryEditor({ directories, onChange }: { directories: string[]; onChange: (directories: string[]) => void }) {
  useLocale()
  const defaultCwd = useAppStore(state => state.health?.default_cwd?.trim() || '')
  const available = useAppStore(state => state.health?.capabilities?.working_directory_completion?.available === true)
  const [draft, setDraft] = useState('')
  const add = (value = draft) => {
    const added = normalizeProjectDirectories([value])
    if (!added.length) return
    const next = normalizeProjectDirectories([...directories, ...added])
    onChange(next)
    setDraft('')
  }
  return <div className="project-directories">
    <span>{t('ui.Dialogs.FolderDialog.local_folders')}</span>
    {directories.length === 0
      ? <p className="project-directories-empty">{t('ui.Dialogs.FolderDialog.choose_at_least_one_local_folder')}</p>
      : <ul className="project-directories-list">
        {directories.map(directory => <li key={directory}>
          <FolderOpen size={14} aria-hidden="true" />
          <code title={directory}>{directory}</code>
          <button type="button" className="icon-button" aria-label={t('ui.Dialogs.FolderDialog.remove_folder', { folder: directory })} onClick={() => onChange(directories.filter(item => item !== directory))}><X size={13} /></button>
        </li>)}
      </ul>}
    <div className="project-directories-add">
      <WorkingDirectoryInput
        value={draft}
        onChange={setDraft}
        onCommit={add}
        defaultCwd={defaultCwd || directories[0] || ''}
        available={available}
        showBrowseButton
        hideLabel
        label={t('ui.Dialogs.FolderDialog.add_folder_path')}
        placeholder={t('ui.Dialogs.FolderDialog.add_folder_placeholder')}
      />
      <button type="button" className="quiet-button" disabled={!draft.trim()} onClick={() => add()}>{t('ui.Dialogs.FolderDialog.add_folder')}</button>
    </div>
  </div>
}

function Shell({ open, onOpenChange, title, description, children, closeDisabled = false }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  closeDisabled?: boolean
}) {
  useLocale()
  useTransientClose(open, () => onOpenChange(false))
  return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="dialog-overlay" /><Dialog.Content className="form-dialog project-folder-dialog"><header><div><Dialog.Title>{title}</Dialog.Title>{description && <Dialog.Description>{description}</Dialog.Description>}</div><button type="button" className="icon-button" aria-label={t('ui.Dialogs.Shell.close_31a8910', { name: title })} disabled={closeDisabled} onClick={() => onOpenChange(false)}><X size={16} /></button></header><div className="form-dialog-body">{children}</div></Dialog.Content></Dialog.Portal></Dialog.Root>
}
