// --- components/note/NoteList.js ---
import EditableText from '../shared/EditableText'
import { DocumentTextIcon } from '@heroicons/react/24/outline'

const NoteList = ({
  notes,
  selectedNote,
  onSelectNote,
  onRenameNote,
  handleRightClick,
  isCollapsed,
  className = ''
}) => (
  <>
    {notes.map(note => (
      <div
        key={note.id}
        className={`obsidian-file-item ${
          selectedNote?.id === note.id ? 'bg-obsidianHighlight' : ''
        } ${className}`}
        onClick={() => onSelectNote(note)}
        onContextMenu={e => handleRightClick(e, 'note', note.id)}
      >
        <DocumentTextIcon className="w-4 h-4 mr-2" />
        <EditableText
          value={note.title}
          onSave={newTitle => onRenameNote(note.id, newTitle)}
        />
      </div>
    ))}
  </>
)

export default NoteList