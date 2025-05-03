// Completely revised server.js using the discord-rpc library for better compatibility
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const DiscordRPC = require('discord-rpc');
const fs = require('fs');
const path = require('path');

// Load environment variables
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const PORT = process.env.PORT || 3000;

// Validate required environment variables
if (!CLIENT_ID) {
  console.error('Error: DISCORD_CLIENT_ID is required in .env file');
  process.exit(1);
}

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// Initialize the RPC client
const rpc = new DiscordRPC.Client({ transport: 'ipc' });
let connected = false;
let lastSongData = null;

// Connect to Discord
async function connectDiscord() {
  if (connected) return;
  
  try {
    // Register event handlers
    rpc.on('ready', () => {
      console.log('Connected to Discord RPC!');
      connected = true;
    });
    
    // Login with client ID
    await rpc.login({ clientId: CLIENT_ID });
  } catch (error) {
    console.error('Failed to connect to Discord:', error);
    connected = false;
    setTimeout(connectDiscord, 10000);
  }
}

// Function to format time string to seconds
function timeStringToSeconds(timeStr) {
  if (!timeStr) return 0;
  
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1]; // MM:SS format
  } else if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2]; // HH:MM:SS format
  }
  return 0;
}

// Clear the Rich Presence when music is paused
async function clearActivity() {
  if (!connected) {
    await connectDiscord();
  }
  
  try {
    console.log('Clearing Discord activity');
    await rpc.clearActivity();
  } catch (error) {
    console.error('Error clearing Discord activity:', error);
    connected = false;
    await connectDiscord();
  }
}

// Update the Rich Presence with song information
async function updateActivity(songData) {
  if (!connected) {
    await connectDiscord();
  }
  
  try {
    console.log('Updating Discord presence with song:', songData.songTitle);
    
    // Calculate timestamps for the progress bar
    const now = Date.now();
    let startTimestamp = now;
    let endTimestamp = null;
    
    if (songData.currentTime && songData.duration) {
      const currentSeconds = timeStringToSeconds(songData.currentTime);
      const durationSeconds = timeStringToSeconds(songData.duration);
      
      if (durationSeconds > 0) {
        // Calculate when the song started (now - how far we are into the song)
        startTimestamp = now - (currentSeconds * 1000);
        // Calculate when the song will end
        endTimestamp = now + ((durationSeconds - currentSeconds) * 1000);
      }
    }
    
    // Create the activity data
    // Note: Using setActivity instead of updatePresence for consistent behavior
    const activity = {
      details: songData.songTitle || 'Unknown Song',
      state: `by ${songData.artist || 'Unknown Artist'}`,
      largeImageKey: 'youtube-music-symbole1',
      largeImageText: songData.album ? `on ${songData.album}` : 'YouTube Music',
      smallImageKey: 'play',
      smallImageText: 'Playing',
      startTimestamp: Math.floor(startTimestamp / 1000),
      endTimestamp: endTimestamp ? Math.floor(endTimestamp / 1000) : undefined,
      instance: false,
    };
    
    // Add buttons if we have a valid URL
    if (songData.songUrl) {
      activity.buttons = [
        { label: "Listen on YouTube Music", url: songData.songUrl }
      ];
    }
    
    console.log('Setting activity data:', activity);
    
    // Update Discord Rich Presence
    await rpc.setActivity(activity);
  } catch (error) {
    console.error('Error updating Discord activity:', error);
    connected = false;
    await connectDiscord();
  }
}

// Main handler for presence updates
async function updatePresence(songData) {
  // Track if song has changed from last update
  const songChanged = !lastSongData || 
                    lastSongData.songTitle !== songData.songTitle || 
                    lastSongData.artist !== songData.artist;
  
  // Update with activity or clear based on playback state
  if (songData.isPlaying) {
    await updateActivity(songData);
  } else {
    await clearActivity();
  }
  
  // Store the last song data for comparison
  lastSongData = {...songData};
  
  return songChanged;
}

// Handle extension requests
app.post('/update', async (req, res) => {
  const songData = req.body;
  console.log('Received song data:', songData);
  
  try {
    // Update Discord Rich Presence
    const songChanged = await updatePresence(songData);
    
    // Send response with song change status
    res.json({ 
      status: 'success',
      songChanged: songChanged
    });
  } catch (error) {
    console.error('Error in update endpoint:', error);
    res.status(500).json({ 
      status: 'error',
      message: error.message
    });
  }
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    connected: connected,
    currentSong: lastSongData
  });
});

// Simple homepage
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>YouTube Music Discord RP</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          pre { background: #f4f4f4; padding: 10px; border-radius: 5px; }
        </style>
      </head>
      <body>
        <h1>YouTube Music Discord Rich Presence</h1>
        <p>Server is running. Check your Discord profile to see your music status.</p>
        <pre id="status">Loading...</pre>
        
        <script>
          async function updateStatus() {
            try {
              const response = await fetch('/status');
              const data = await response.json();
              document.getElementById('status').textContent = JSON.stringify(data, null, 2);
            } catch (error) {
              document.getElementById('status').textContent = "Error: " + error;
            }
            setTimeout(updateStatus, 5000);
          }
          updateStatus();
        </script>
      </body>
    </html>
  `);
});

// Start the server
app.listen(PORT, async () => {
  console.log(`YouTube Music Discord Rich Presence server running on port ${PORT}`);
  await connectDiscord();
});

// Handle process termination
process.on('SIGINT', async () => {
  if (connected) {
    await clearActivity();
    rpc.destroy().catch(console.error);
  }
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception:', err);
});