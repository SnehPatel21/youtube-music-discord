// Server with complete reset logic for Discord Rich Presence
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const DiscordRPC = require('discord-rpc');
const fs = require('fs');
const path = require('path');

// Load environment variables
const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const PORT = process.env.PORT || 3000;

// Enable debug logging
const DEBUG = true;

// Validate required environment variables
if (!CLIENT_ID) {
  console.error('Error: DISCORD_CLIENT_ID is required in .env file');
  process.exit(1);
}

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// Initialize Discord RPC
const rpc = new DiscordRPC.Client({ transport: 'ipc' });
let connected = false;
let lastSongData = null;
let activeSongId = null;

// Connect to Discord
async function connectDiscord() {
  if (connected) return;
  
  try {
    // Set up ready handler
    rpc.on('ready', () => {
      console.log('Connected to Discord RPC!');
      console.log('Application:', rpc.application);
      connected = true;
    });
    
    // Login with application ID
    await rpc.login({ clientId: CLIENT_ID });
  } catch (error) {
    console.error('Failed to connect to Discord:', error);
    connected = false;
    setTimeout(connectDiscord, 10000);
  }
}

// Parse time string to seconds
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

// Clear activity when paused
async function clearActivity() {
  if (!connected) {
    await connectDiscord();
    return;
  }
  
  try {
    console.log('Clearing Discord activity');
    // Reset active song ID when clearing
    activeSongId = null;
    await rpc.clearActivity();
  } catch (error) {
    console.error('Error clearing Discord activity:', error);
    connected = false;
    await connectDiscord();
  }
}

// Update activity with song information
async function updateActivity(songData) {
  if (!connected) {
    await connectDiscord();
    return;
  }
  
  try {
    // Check if this is a new song or first update
    const songChanged = songData.songChanged === true || 
                        songData.songId !== activeSongId;
    
    if (songChanged) {
      console.log(`Song changed - updating from "${activeSongId || 'none'}" to "${songData.songId}"`);
      
      // If we're changing songs, first clear the current activity
      // This is critical for forcing Discord to reset the timer
      if (activeSongId) {
        console.log('Forcing activity clear before setting new song');
        await rpc.clearActivity();
        
        // Small delay to ensure Discord processes the clear
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      
      // Update our tracking
      activeSongId = songData.songId;
    }
    
    // Calculate timestamps for timeline
    const now = Date.now();
    let startTimestamp = now;
    let endTimestamp = null;
    
    // If we have time info, calculate proper timestamps
    if (songData.currentTime && songData.duration) {
      const currentSeconds = timeStringToSeconds(songData.currentTime);
      const durationSeconds = timeStringToSeconds(songData.duration);
      
      if (durationSeconds > 0) {
        // Calculate when the song started based on current position
        if (songData.rawCurrentTime) {
          startTimestamp = now - (songData.rawCurrentTime * 1000);
        } else {
          startTimestamp = now - (currentSeconds * 1000);
        }
        
        // Calculate when the song will end
        if (songData.rawDuration) {
          endTimestamp = startTimestamp + (songData.rawDuration * 1000);
        } else {
          endTimestamp = startTimestamp + (durationSeconds * 1000);
        }
      }
    }
    
    // Create activity object
    const activity = {
      details: songData.songTitle || 'Unknown Song',
      state: `by ${songData.artist || 'Unknown Artist'}`,
      largeImageKey: 'youtube-music-symbole1',
      largeImageText: songData.album ? `on ${songData.album}` : 'YouTube Music',
      smallImageKey: 'play',
      smallImageText: 'Playing',
      startTimestamp: Math.floor(startTimestamp / 1000),
      endTimestamp: endTimestamp ? Math.floor(endTimestamp / 1000) : undefined,
      buttons: [
        {
          label: "Listen on YouTube Music",
          url: songData.songUrl || "https://music.youtube.com"
        }
      ],
      instance: false
    };
    
    if (DEBUG) {
      console.log('Setting activity:', {
        song: songData.songTitle,
        artist: songData.artist,
        songId: songData.songId,
        startTime: new Date(startTimestamp).toISOString(),
        endTime: endTimestamp ? new Date(endTimestamp).toISOString() : 'none'
      });
    }
    
    // Set the activity
    await rpc.setActivity(activity);
  } catch (error) {
    console.error('Error updating Discord activity:', error);
    console.error('Error details:', error.message);
    connected = false;
    await connectDiscord();
  }
}

// Main handler for presence updates
async function updatePresence(songData) {
  try {
    // Handle based on playback state
    if (songData.isPlaying) {
      await updateActivity(songData);
    } else {
      await clearActivity();
    }
    
    // Update last song data
    lastSongData = {...songData};
    
    return true;
  } catch (error) {
    console.error('Error in updatePresence:', error);
    return false;
  }
}

// Route to receive updates from the browser extension
app.post('/update', async (req, res) => {
  const songData = req.body;
  console.log(`Received update: ${songData.songTitle} by ${songData.artist}`);
  
  try {
    // Process song changes
    if (songData.songChanged) {
      console.log('Song change flag detected from extension');
    }
    
    // Update Discord presence
    await updatePresence(songData);
    
    // Send response
    res.json({ 
      status: 'success',
      activeSongId: activeSongId,
      songChanged: songData.songChanged
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
    currentSong: lastSongData,
    activeSongId: activeSongId
  });
});

// Debug endpoints
app.post('/reset', async (req, res) => {
  console.log('Manual reset requested');
  
  try {
    // Clear current activity
    await rpc.clearActivity();
    activeSongId = null;
    
    // Wait briefly
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Set activity again if we have song data
    if (lastSongData && lastSongData.isPlaying) {
      await updatePresence({...lastSongData, songChanged: true});
    }
    
    res.json({
      status: 'success',
      message: 'Discord activity reset'
    });
  } catch (error) {
    console.error('Error during manual reset:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

app.post('/force-disconnect', async (req, res) => {
  try {
    console.log('Forcing Discord RPC disconnect');
    
    // Clear activity and destroy client
    if (connected) {
      await rpc.clearActivity();
      rpc.destroy();
    }
    
    connected = false;
    activeSongId = null;
    
    // Reconnect after a brief delay
    setTimeout(connectDiscord, 2000);
    
    res.json({
      status: 'success',
      message: 'Discord RPC disconnected and will reconnect'
    });
  } catch (error) {
    console.error('Error during forced disconnect:', error);
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
});

// Home page
app.get('/', (req, res) => {
  res.send(`
    <html>
      <head>
        <title>YouTube Music Discord RP</title>
        <style>
          body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
          pre { background: #f4f4f4; padding: 10px; border-radius: 5px; }
          .status { margin-top: 20px; }
          button { padding: 8px 16px; background: #738ADB; color: white; border: none; border-radius: 4px; cursor: pointer; margin-right: 10px; }
          button:hover { background: #5865F2; }
        </style>
      </head>
      <body>
        <h1>YouTube Music Discord Rich Presence</h1>
        <p>Server with complete reset logic is running.</p>
        
        <div class="status">
          <h2>Current Status</h2>
          <pre id="status">Loading...</pre>
        </div>
        
        <div style="margin-top: 20px;">
          <button id="resetButton">Force Reset</button>
          <button id="disconnectButton">Force Disconnect</button>
        </div>
        
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
          
          document.getElementById('resetButton').addEventListener('click', async () => {
            try {
              const response = await fetch('/reset', { method: 'POST' });
              const data = await response.json();
              alert('Reset: ' + data.message);
              updateStatus();
            } catch (error) {
              alert('Error: ' + error);
            }
          });
          
          document.getElementById('disconnectButton').addEventListener('click', async () => {
            try {
              const response = await fetch('/force-disconnect', { method: 'POST' });
              const data = await response.json();
              alert('Disconnect: ' + data.message);
              updateStatus();
            } catch (error) {
              alert('Error: ' + error);
            }
          });
          
          updateStatus();
        </script>
      </body>
    </html>
  `);
});

// Start the server
app.listen(PORT, async () => {
  console.log(`Discord RPC server running on port ${PORT}`);
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