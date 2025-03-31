// src/components/ShortcutsModal.js
import { XMarkIcon } from '@heroicons/react/24/outline'

const ShortcutsModal = ({ isOpen, onClose }) => {
  return isOpen ? (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-obsidianGray rounded-lg max-w-lg w-full shadow-obsidian">
        <div className="flex justify-between items-center p-4 border-b border-obsidianBorder">
          <h2 className="text-lg font-medium">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="obsidian-button">
            <XMarkIcon className="obsidian-icon" />
          </button>
        </div>
        <div className="p-4 max-h-[70vh] overflow-y-auto">
          <table className="w-full">
            <tbody>
              <tr className="border-b border-obsidianBorder">
                <td className="py-2 pr-4">Ctrl+Shift+7</td>
                <td className="py-2">Numbered List</td>
              </tr>
              {/* Add more shortcuts here */}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  ) : null
}

export default ShortcutsModal
