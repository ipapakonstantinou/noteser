"use client";

const Sidebar = ({ notes, onAddNewNote, onSelectNote }) => {
  return (
    <div className="w-64 h-screen bg-obsidianGray text-white flex flex-col p-4">
      <h1 className="text-2xl font-bold mb-6">Noteser</h1>
      <button
        className="bg-blue-500 hover:bg-blue-600 text-white py-2 px-4 rounded mb-6"
        onClick={onAddNewNote}
      >
        Add New Note
      </button>
      <ul className="space-y-3">
        {notes.map((note) => (
          <li
            key={note.id}
            className="p-3 bg-obsidianDark rounded hover:bg-blue-600 cursor-pointer"
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
