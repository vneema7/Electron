# Electron Airdrop 📱

A desktop file-sharing application for Windows/Mac/Linux that works like Apple's AirDrop. Drag and drop files to share them instantly with anyone else running the app.

## Features ✨

- **Drag & Drop File Sharing**: Simply drag files into the app to share them
- **Real-time File List**: See all shared files from all devices in real-time
- **One-Click Download**: Download any shared file with a single click
- **Cross-Platform**: Works on Windows, macOS, and Linux
- **Auto-cleanup**: Old files are automatically removed after 1 hour
- **Secure**: Uses Express server for local network sharing

## Prerequisites

- Node.js (v14 or higher)
- npm (comes with Node.js)

## Installation

1. Clone or open the project folder:
```bash
cd /Users/mahirarora/Documents/Electron
```

2. Install dependencies:
```bash
npm install
```

## Usage

### Start the app:
```bash
npm start
```

### Development mode (with DevTools):
```bash
npm run dev
```

## How It Works

1. **Upload**: Drag files onto the drop zone to share them
2. **Share**: The file is uploaded to your local server and assigned a unique ID
3. **Discover**: The app broadcasts the file to all instances
4. **Download**: Other users can see and download the shared file
5. **Cleanup**: Files are automatically deleted after 1 hour

## File Storage

Shared files are stored in your system's temporary directory:
- **macOS/Linux**: `/tmp/electron-airdrop-shared`
- **Windows**: `%APPDATA%\Local\Temp\electron-airdrop-shared`

## Architecture

```
main.js          - Electron main process + Express server
preload.js       - Secure IPC bridge
index.html       - UI with drag-drop interface
```

## Keyboard Shortcuts

- `Ctrl/Cmd + Q` - Quit the app

## Troubleshooting

**Files not showing up:**
- Make sure all instances are running on the same network
- Check that the Express server is running (look in DevTools console)

**Can't drag files:**
- Try clicking the drop zone and browsing for a file instead

**Server port errors:**
- The app automatically finds an available port. Check the console for the port number.

## Future Enhancements

- Network discovery for multiple machines on the same network
- Folder sharing
- Image preview
- File compression
- Transfer progress indicator
- Local device storage Instead of temp folder

## License

MIT
