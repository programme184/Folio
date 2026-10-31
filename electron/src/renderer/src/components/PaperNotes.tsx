import { useEffect, useState } from 'react'
import { Eye, Pencil, Plus, Trash2 } from 'lucide-react'
import { t } from '@shared/i18n'
import { PAPER_NOTE_BODY_LIMIT, PAPER_NOTE_LIMIT } from '@shared/paper-notes'
import { useLocale } from '../lib/i18n'
import { MarkdownContent } from './MarkdownContent'
import { usePaperNoteFiles, type PaperNoteFiles } from './paper-notes'

const noteTitle = (name: string) => name.replace(/\.md$/i, '')

/** Markdown notes in the PDF's notes folder. Mount with a key per document so selection resets on switch. */
export function PaperNotesPanel({ files }: { files: PaperNoteFiles | null }) {
  useLocale()
  const { names, selected, body, failed, select, edit, create, remove } = usePaperNoteFiles(files)
  const [preview, setPreview] = useState(false)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    setPreview(false)
    setArmed(false)
  }, [selected])

  return <aside className="paper-notes" aria-label={t('papers.notes')}>
    <div className="paper-notes-list-pane">
      <button
        type="button"
        className="paper-notes-new"
        disabled={!files || names === null || names.length >= PAPER_NOTE_LIMIT}
        onClick={() => void create()}
      ><Plus size={14} aria-hidden="true" /><span>{t('papers.notesNew')}</span></button>
      {!files && <p className="paper-notes-hint" role="status">{t('papers.notesUnavailable')}</p>}
      {files && names === null && <p className="paper-notes-hint" role="status">{t('papers.notesLoading')}</p>}
      {names?.length === 0 && <p className="paper-notes-hint">{t('papers.notesEmpty')}</p>}
      {names && names.length > 0 && <ul className="paper-notes-list">
        {names.map(name => <li key={name}>
          <button
            type="button"
            className="paper-notes-item"
            aria-current={name === selected ? 'true' : undefined}
            onClick={() => select(name)}
          ><span className="paper-notes-item-title">{noteTitle(name)}</span></button>
        </li>)}
      </ul>}
    </div>
    <div className="paper-notes-editor">
      {failed && <p className="paper-notes-hint" role="alert">{t('papers.notesFailed')}</p>}
      {!selected && <p className="paper-notes-hint">{t('papers.notesSelect')}</p>}
      {selected && <>
        <div className="paper-notes-bar">
          <span className="paper-notes-name" title={selected}>{noteTitle(selected)}</span>
          <button
            type="button"
            className="paper-tool-button"
            aria-pressed={preview}
            aria-label={preview ? t('papers.notesEdit') : t('papers.notesPreview')}
            title={preview ? t('papers.notesEdit') : t('papers.notesPreview')}
            onClick={() => setPreview(value => !value)}
          >{preview ? <Pencil size={14} /> : <Eye size={14} />}</button>
          <button
            type="button"
            className={`paper-tool-button paper-notes-delete${armed ? ' is-armed' : ''}`}
            aria-label={armed ? t('papers.notesDeleteConfirm') : t('papers.notesDelete')}
            title={armed ? t('papers.notesDeleteConfirm') : t('papers.notesDelete')}
            onClick={() => {
              if (!armed) return setArmed(true)
              setArmed(false)
              void remove(selected)
            }}
            onBlur={() => setArmed(false)}
          ><Trash2 size={14} /></button>
        </div>
        {preview
          ? <div className="paper-notes-body paper-notes-preview">
            {body === null ? <p className="paper-notes-hint">{t('papers.notesLoading')}</p>
              : body.trim() ? <MarkdownContent text={body} fold={false} />
                : <p className="paper-notes-hint">{t('papers.notesEmptyBody')}</p>}
          </div>
          : <textarea
            className="paper-notes-body"
            aria-label={t('papers.notesBody')}
            spellCheck={false}
            maxLength={PAPER_NOTE_BODY_LIMIT}
            disabled={body === null}
            value={body ?? ''}
            onChange={event => edit(event.target.value)}
          />}
      </>}
    </div>
  </aside>
}
