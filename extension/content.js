// Enhanced content script for YouTube Music
let previousData = null;
let resetNextUpdate = false;
const SERVER_URL = 'http://localhost:3000/update';
const CHECK_INTERVAL = 1000; // Check every second

// Enhanced song data extraction with additional error handling
function extractSongData() {
  try {
    // Get song title
    const songTitleElement = document.querySelector('.title.ytmusic-player-bar');
    const songTitle = songTitleElement ? songTitleElement.textContent.trim() : 'Unknown Song';

    // Get artist name with improved parsing
    const artistElement = document.querySelector('.byline.ytmusic-player-bar');
    let artist = 'Unknown Artist';
    let album = '';
    
    if (artistElement) {
      const fullText = artistElement.textContent.trim();
      const separator = fullText.indexOf(' • ');
      
      if (separator !== -1) {
        // Split artist and album if separator exists
        artist = fullText.substring(0, separator).trim();
        if (separator < fullText.length - 3) {
          album = fullText.substring(separator + 3).trim();
        }
      } else {
        // Just artist, no album
        artist = fullText;
      }
    }

    // Get video element for accurate playback info
    const videoElement = document.querySelector('video');
    let isPlaying = false;
    let currentTime = '0:00';
    let duration = '0:00';
    
    if (videoElement) {
      // Check if actually playing (not paused and time is advancing)
      isPlaying = !videoElement.paused && videoElement.currentTime > 0;
      
      // Format time values
      const formatTime = (seconds) => {
        if (!seconds || isNaN(seconds) || seconds < 0) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
      };
      
      currentTime = formatTime(videoElement.currentTime);
      duration = formatTime(videoElement.duration);
    }

    // Get album art URL - try to get higher resolution
    const artworkElement = document.querySelector('.image.ytmusic-player-bar');
    let albumArt = '';
    
    if (artworkElement && artworkElement.src) {
      albumArt = artworkElement.src.replace(/=w\d+-h\d+/, '=w480-h480');
    }
    
    // Get the YouTube video ID for the song URL
    let songUrl = '';
    const videoId = new URLSearchParams(window.location.search).get('v');
    if (videoId) {
      songUrl = `https://music.youtube.com/watch?v=${videoId}`;
    } else {
      // Try the URL path for mobile or alternative formats
      const pathMatch = window.location.pathname.match(/\/watch\/([a-zA-Z0-9_-]+)/);
      if (pathMatch && pathMatch[1]) {
        songUrl = `https://music.youtube.com/watch?v=${pathMatch[1]}`;
      }
    }
    
    return {
      songTitle,
      artist,
      album,
      isPlaying,
      currentTime,
      duration,
      albumArt,
      songUrl,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('Error extracting song data:', error);
    return null;
  }
}

// Enhanced data sending with retry logic and timeout
function sendDataToLocalServer(data) {
  return new Promise((resolve, reject) => {
    console.log('Sending data to server:', data);
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
    
    fetch(SERVER_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data),
      signal: controller.signal
    })
    .then(response => {
      clearTimeout(timeoutId);
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
      clearTimeout(timeoutId);
      console.error('Error sending data to local server:', error);
      reject(error);
    });
  });
}

// Detect significant changes that warrant an update
function hasSignificantChanges(current, previous) {
  // Force update if flag is set (for song changes)
  if (resetNextUpdate) {
    resetNextUpdate = false;
    return true;
  }
  
  // First update or missing data
  if (!previous) return true;
  
  // Playing status changed
  if (current.isPlaying !== previous.isPlaying) return true;
  
  // Song changed
  if (current.songTitle !== previous.songTitle || 
      current.artist !== previous.artist) {
    // Set flag to force another update on the next interval
    // This helps ensure Discord gets the reset signal
    resetNextUpdate = true;
    return true;
  }
  
  // Only check time progress if playing
  if (current.isPlaying) {
    const parseTimeToSeconds = (timeStr) => {
      if (!timeStr) return 0;
      const parts = timeStr.split(':').map(Number);
      if (parts.length === 2) {
        return parts[0] * 60 + parts[1]; // MM:SS format
      } else if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2]; // HH:MM:SS format
      }
      return 0;
    };
    
    const currentTimeSeconds = parseTimeToSeconds(current.currentTime);
    const previousTimeSeconds = parseTimeToSeconds(previous.currentTime);
    const durationSeconds = parseTimeToSeconds(current.duration);
    
    // Update if:
    // - Time jumped by more than 2 seconds (user skipped)
    // - Near beginning (first few seconds)
    // - Near end (last few seconds)
    // - Every 10 seconds for regular updates
    if (Math.abs(currentTimeSeconds - previousTimeSeconds) >= 2 ||
        currentTimeSeconds < 3 || 
        (durationSeconds > 0 && durationSeconds - currentTimeSeconds < 5) ||
        Math.floor(currentTimeSeconds / 10) > Math.floor(previousTimeSeconds / 10)) {
      return true;
    }
  }
  
  return false;
}

// Main function to check and send data
async function checkAndSendData() {
  try {
    const currentData = extractSongData();
    
    if (currentData && hasSignificantChanges(currentData, previousData)) {
      console.log('Song data changed, sending update:', currentData);
      
      // Update our tracking before sending to avoid race conditions
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

// Add various event listeners for more responsive updates

// Play/pause button clicks
document.addEventListener('click', (event) => {
  if (event.target.closest('.play-pause-button')) {
    setTimeout(checkAndSendData, 100);
  }
});

// Seekbar/timeline changes
document.addEventListener('mouseup', (event) => {
  if (event.target.closest('.bar.ytmusic-player-bar')) {
    setTimeout(checkAndSendData, 100);
  }
});

// Auto-detect song changes through mutations in the player bar
const setupMutationObserver = () => {
  const playerBar = document.querySelector('ytmusic-player-bar');
  if (playerBar) {
    const observer = new MutationObserver((mutations) => {
      // Check if title or artist changed
      const titleChanged = mutations.some(m => 
        m.target.classList.contains('title') || 
        m.target.querySelector('.title')
      );
      
      const artistChanged = mutations.some(m => 
        m.target.classList.contains('byline') || 
        m.target.querySelector('.byline')
      );
      
      if (titleChanged || artistChanged) {
        console.log('Detected song change through DOM mutation');
        resetNextUpdate = true;
        setTimeout(checkAndSendData, 100);
      }
    });
    
    observer.observe(playerBar, { 
      subtree: true, 
      childList: true,
      characterData: true
    });
    
    console.log('Set up mutation observer for player bar');
  } else {
    // Try again if player bar not found yet
    setTimeout(setupMutationObserver, 1000);
  }
};

// Set up video element listeners
const setupVideoListener = () => {
  const videoElement = document.querySelector('video');
  if (videoElement) {
    ['play', 'pause', 'seeking', 'seeked', 'loadeddata', 'canplay'].forEach(event => {
      videoElement.addEventListener(event, () => {
        setTimeout(checkAndSendData, 100);
      });
    });
    console.log('Added video element listeners');
  } else {
    // Try again if video element not found yet
    setTimeout(setupVideoListener, 1000);
  }
};

// Initialize observers and listeners
setupMutationObserver();
setupVideoListener();

// Clean up on page unload
window.addEventListener('beforeunload', () => {
  clearInterval(intervalId);
});

console.log('YouTube Music Discord Rich Presence extension loaded!');