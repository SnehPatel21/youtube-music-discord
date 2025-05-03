# YouTube Music Discord Rich Presence

This project integrates YouTube Music playback with Discord Rich Presence, allowing you to display your current song, artist, and playback status on your Discord profile.

## Features

- Displays the current song title, artist, album, and playback status in Discord.
- Updates in real-time as you play, pause, or change songs on YouTube Music.
- Includes a progress bar and optional "Listen on YouTube Music" button in Discord.
- Works with a local server and a browser extension.

## Prerequisites

- [Node.js](https://nodejs.org/) installed on your system.
- A Discord application with a client ID. You can create one at the [Discord Developer Portal](https://discord.com/developers/applications).
- A Chromium-based browser (e.g., Chrome, Edge) for the extension.

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/your-repo/youtube-music-discord.git
cd youtube-music-discord
```

### 2. Set Up the Local Server

1. Navigate to the `local-server` directory:
   ```bash
   cd local-server
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Create a `.env` file in the `local-server` directory and add your Discord client ID:
   ```
   DISCORD_CLIENT_ID=your_discord_client_id
   PORT=3000
   ```

4. Start the server:
   ```bash
   node server.js
   ```

   The server will run on `http://localhost:3000`.

### 3. Set Up the Browser Extension

1. Navigate to the `extension` directory:
   ```bash
   cd ../extension
   ```

2. Open your browser and go to the extensions page:
   - Chrome: `chrome://extensions/`
   - Edge: `edge://extensions/`

3. Enable "Developer mode" and click "Load unpacked."

4. Select the `extension` folder from this project.

## Usage

1. Start the local server as described above.
2. Open YouTube Music in your browser.
3. Play a song, and your Discord Rich Presence will update automatically.

## Troubleshooting

- **Server not connecting to Discord:** Ensure your Discord client is running and the client ID in the `.env` file is correct.
- **Extension not working:** Verify that the extension is loaded correctly and that the server is running on `http://localhost:3000`.

## Contributing

Feel free to submit issues or pull requests to improve this project.

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.