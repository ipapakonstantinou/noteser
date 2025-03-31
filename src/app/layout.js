// app/layout.js
import './globals.css';

export const metadata = {
    title: 'Noteser',
    description: 'A simple note-taking app',
};

export default function RootLayout({ children }) {
    return (
        <html lang="en">
            <body className="bg-gray-900 text-white">{children}</body>
        </html>
    );
}
