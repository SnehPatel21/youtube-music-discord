// Content script with force reset logic for automatic song changes
let previousData = null;
let currentSongId = null;
const SERVER_URL = 'http://localhost:3000/update';
const CHECK_INTERVAL = 500; // Check every 500ms

// Function to extract song information from YouTube Music
function extractSongData() {
  try {
    // Get video element for playback status
    const videoElement = document.querySelector('video');
    const isVideoAvailable = !!videoElement;
    const isVideoPlaying = isVideoAvailable && 
                           !videoElement.paused && 
                           videoElement.currentTime > 0 &&
                           !videoElement.ended;
    
    // Get song title
    const songTitleElement = document.querySelector('.title.ytmusic-player-bar');
    const songTitle = songTitleElement ? songTitleElement.textContent.trim() : 'Unknown Song';

    // Get artist
    const artistElement = document.querySelector('.byline.ytmusic-player-bar');
    let artist = 'Unknown Artist';
    let album = '';
    
    if (artistElement) {
      const fullText = artistElement.textContent.trim();
      const separator = fullText.indexOf(' • ');
      
      if (separator !== -1) {
        artist = fullText.substring(0, separator).trim();
        if (separator < fullText.length - 3) {
          album = fullText.substring(separator + 3).trim();
        }
      } else {
        artist = fullText;
      }
    }

    // Get album art URL
    const artworkElement = document.querySelector('.image.ytmusic-player-bar');
    let albumArt = '';
    
    if (artworkElement && artworkElement.src) {
      albumArt = artworkElement.src.replace(/=w\d+-h\d+/, '=w480-h480');
    }
    
    // Get current time and duration
    let currentTime = '0:00';
    let duration = '0:00';
    let rawCurrentTime = 0;
    let rawDuration = 0;
    
    if (isVideoAvailable) {
      rawCurrentTime = videoElement.currentTime;
      rawDuration = videoElement.duration;
      
      const formatTime = (seconds) => {
        if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      };
      
      currentTime = formatTime(rawCurrentTime);
      duration = formatTime(rawDuration);
    }
    
    // Get video ID for song URL
    let songUrl = '';
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (videoId) {
      songUrl = `https://music.youtube.com/watch?v=${videoId}`;
    } else {
      const pathMatch = window.location.pathname.match(/\/watch\/([a-zA-Z0-9_-]+)/);
      if (pathMatch && pathMatch[1]) {
        songUrl = `https://music.youtube.com/watch?v=${pathMatch[1]}`;
      }
    }
    
    // Generate a unique ID for this song+time combination
    // The goal is to force Discord to see this as a new activity when the song changes
    const newSongId = `${songTitle}-${artist}-${Date.now()}`;
    
    // Check if song has changed
    const songChanged = !currentSongId || 
                        (previousData && 
                         (previousData.songTitle !== songTitle || 
                          previousData.artist !== artist));
    
    // Update song ID if changed
    if (songChanged) {
      console.log(`Song changed: "${previousData?.songTitle || ''}" → "${songTitle}"`);
      currentSongId = newSongId;
    }
    
    // Return complete song data
    return {
      songTitle,
      artist,
      album,
      isPlaying: isVideoPlaying,
      currentTime,
      duration,
      albumArt,
      songUrl,
      rawCurrentTime,
      rawDuration,
      songId: currentSongId,
      songChanged,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('Error extracting song data:', error);
    return null;
  }
}

// Send data to server with retry
function sendDataToLocalServer(data) {
  return new Promise((resolve, reject) => {
    console.log('Sending data to server:', data);
    
    fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.json();
    })
    .then(responseData => {
      console.log('Data sent successfully:', responseData);
      resolve(responseData);
    })
    .catch(error => {
      console.error('Error sending data to local server:', error);
      
      // Retry once
      setTimeout(() => {
        console.log('Retrying server connection...');
        fetch(SERVER_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(data)
        })
        .then(response => response.json())
        .then(responseData => {
          console.log('Retry successful:', responseData);
          resolve(responseData);
        })
        .catch(retryError => {
          console.error('Retry failed:', retryError);
          reject(retryError);
        });
      }, 1000);
    });
  });
}

// Check if we should update Discord
function shouldUpdateDiscord(current, previous) {
  // First update or missing data
  if (!previous) return true;
  
  // Song changed
  if (current.songChanged) {
    return true;
  }
  
  // Playing status changed
  if (current.isPlaying !== previous.isPlaying) {
    return true;
  }
  
  // For time updates, only send every ~15 seconds if playing
  if (current.isPlaying) {
    const currentTimeInSeconds = Math.floor(current.rawCurrentTime);
    const previousTimeInSeconds = Math.floor(previous.rawCurrentTime);
    
    return Math.floor(currentTimeInSeconds / 15) > Math.floor(previousTimeInSeconds / 15);
  }
  
  return false;
}

// Main function to check and send data
async function checkAndSendData() {
  try {
    const currentData = extractSongData();
    if (!currentData) return;
    
    if (shouldUpdateDiscord(currentData, previousData)) {
      console.log('Update needed, sending to server');
      
      // Update our tracking before sending
      previousData = {...currentData};
      
      // Send data to server
      await sendDataToLocalServer(currentData);
    }
  } catch (error) {
    console.error('Error in check and send cycle:', error);
  }
}

// Set up interval to check for changes
const intervalId = setInterval(checkAndSendData, CHECK_INTERVAL);

// Check immediately when the script loads
checkAndSendData();

// Set up video element mutation observer for song changes
function setupVideoObserver() {
  // Find and monitor the video element
  const videoElement = document.querySelector('video');
  if (videoElement) {
    // Listen for the 'loadstart' event which often indicates a new song
    videoElement.addEventListener('loadstart', () => {
      console.log('Video loadstart event detected - likely a new song');
      // Force null previous data to ensure update
      previousData = null;
      setTimeout(checkAndSendData, 500);
    });
    
    // Listen for 'ended' event to detect end of songs
    videoElement.addEventListener('ended', () => {
      console.log('Video ended event detected');
      // Force null previous data to ensure update for next song
      previousData = null;
      currentSongId = null;
      setTimeout(checkAndSendData, 500);
    });
    
    console.log('Video element listeners set up');
  } else {
    // Try again if video not found
    setTimeout(setupVideoObserver, 1000);
  }
}

// Setup DOM mutation observer for song changes
function setupMutationObserver() {
  // Track changes to player bar (titles, artwork, etc)
  const playerBar = document.querySelector('ytmusic-player-bar');
  if (playerBar) {
    const observer = new MutationObserver((mutations) => {
      // Look for significant mutations that indicate song changes
      const significantChange = mutations.some(mutation => {
        // Title or artist changes
        if (mutation.target.classList && 
            (mutation.target.classList.contains('title') || 
             mutation.target.classList.contains('byline'))) {
          return true;
        }
        
        // Image changes (album art)
        if (mutation.target.tagName === 'IMG' || 
            (mutation.target.querySelector && mutation.target.querySelector('img'))) {
          return true;
        }
        
        return false;
      });
      
      if (significantChange) {
        console.log('Significant player bar change detected');
        // Force null previous data and song ID to ensure update
        previousData = null;
        currentSongId = null;
        setTimeout(checkAndSendData, 300);
      }
    });
    
    observer.observe(playerBar, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['src', 'style']
    });
    
    console.log('Player bar mutation observer set up');
  } else {
    // Try again if player bar not found
    setTimeout(setupMutationObserver, 1000);
  }
}

// Initialize all observers
setupVideoObserver();
setupMutationObserver();

// Set up click listeners for manual navigation
document.addEventListener('click', (event) => {
  // Check for next/previous button clicks
  if (event.target.closest('.next-button') || 
      event.target.closest('.previous-button')) {
    console.log('Next/Previous button clicked');
    // Force null previous data and song ID to ensure update
    previousData = null;
    currentSongId = null;
    setTimeout(checkAndSendData, 300);
  }
  
  // Check for timeline clicks
  if (event.target.closest('.bar.ytmusic-player-bar')) {
    console.log('Timeline clicked');
    setTimeout(checkAndSendData, 200);
  }
});

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  clearInterval(intervalId);
});

console.log('YouTube Music Discord Rich Presence extension loaded with force reset logic!');