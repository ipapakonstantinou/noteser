"use client";

import { PlusIcon, PencilIcon, FolderIcon, ArrowUpTrayIcon, Squares2X2Icon } from "@heroicons/react/24/outline";

const Sidebar = ({ notes, onAddNewNote, onSelectNote }) => {
  return (
    <div className="w-64 h-screen bg-gray-800 text-white flex flex-col p-4">
      {/* Title */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold mb-4">Noteser</h1>
        {/* Icon Actions */}
        <div className="flex flex-col space-y-3">
          <button
            onClick={onAddNewNote}
            className="p-1 rounded hover:bg-gray-700 flex justify-center items-center"
            title="Add New Note"
          >
            <PlusIcon className="w-5 h-5 text-gray-300 hover:text-white" />
          </button>
          <button
            className="p-1 rounded hover:bg-gray-700 flex justify-center items-center"
            title="Edit Note"
          >
            <PencilIcon className="w-5 h-5 text-gray-300 hover:text-white" />
          </button>
          <button
            className="p-1 rounded hover:bg-gray-700 flex justify-center items-center"
            title="Folders"
          >
            <FolderIcon className="w-5 h-5 text-gray-300 hover:text-white" />
          </button>
          <button
            className="p-1 rounded hover:bg-gray-700 flex justify-center items-center"
            title="Upload"
          >
            <ArrowUpTrayIcon className="w-5 h-5 text-gray-300 hover:text-white" />
          </button>
          <button
            className="p-1 rounded hover:bg-gray-700 flex justify-center items-center"
            title="View Grid"
          >
            <Squares2X2Icon className="w-5 h-5 text-gray-300 hover:text-white" />
          </button>
        </div>
      </div>

      {/* Notes List */}
      <ul className="space-y-3">
        {notes.map((note) => (
          <li
            key={note.id}
            className="p-3 bg-gray-700 rounded hover:bg-gray-600 cursor-pointer"
            onClick={() => onSelectNote(note)}
          >
            {note.title || "Untitled Note"}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default Sidebar;
