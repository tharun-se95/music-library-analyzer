// ============================================
// CONSTANTS
// ============================================
const WS_URL = `ws://${window.location.host}/ws`;
const TOAST_DURATION = 4000; // 4 seconds
const BPM_MIN = 30;
const BPM_MAX = 300;

// ============================================
// TOAST NOTIFICATION SYSTEM
// ============================================

/**
 * Show a toast notification
 * @param {string} message - The message to display
 * @param {string} type - Type of toast: 'success', 'error', 'warning', 'info'
 * @param {number} duration - Duration in ms (default: 4000)
 */
function showToast(message, type = 'info', duration = TOAST_DURATION) {
    // Create toast container if it doesn't exist
    let container = document.querySelector('.toast-container');
    if (!container) {
        container = document.createElement('div');
        container.className = 'toast-container';
        document.body.appendChild(container);
    }

    // Create toast element
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;

    // Icon based on type
    const icons = {
        success: '✓',
        error: '✕',
        warning: '⚠',
        info: 'ℹ'
    };

    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-message">${message}</span>
        <span class="toast-close" onclick="this.parentElement.remove()">×</span>
    `;

    container.appendChild(toast);

    // Auto remove after duration
    setTimeout(() => {
        toast.style.animation = 'slideOut 0.3s ease-out';
        setTimeout(() => toast.remove(), 300);
    }, duration);
}

/**
 * Set loading state on a button
 * @param {HTMLElement} button - The button element
 * @param {boolean} loading - Whether to show loading state
 */
function setButtonLoading(button, loading) {
    if (loading) {
        button.classList.add('loading');
        button.disabled = true;
    } else {
        button.classList.remove('loading');
        button.disabled = false;
    }
}

/**
 * Validate BPM value
 * @param {number} bpm - BPM value to validate
 * @returns {boolean} - Whether the BPM is valid
 */
function isValidBPM(bpm) {
    return bpm >= BPM_MIN && bpm <= BPM_MAX;
}

/**
 * Validate energy value
 * @param {number} energy - Energy value to validate
 * @returns {boolean} - Whether the energy is valid
 */
function isValidEnergy(energy) {
    return energy >= 0 && energy <= 1;
}

/**
 * Debounce function to limit rate of function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in ms
 * @returns {Function} - Debounced function
 */
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// ============================================
// WEBSOCKET & GLOBAL VARIABLES
// ============================================

const ws = new WebSocket(WS_URL);
const consoleOutput = document.getElementById('consoleOutput');
const processedCount = document.getElementById('processedCount');
const totalCount = document.getElementById('totalCount');
const analysisTableBody = document.getElementById('analysisTableBody');
const fileRows = new Map(); // Track table rows by path
const scanBtn = document.getElementById('scanBtn');
const stopBtn = document.getElementById('stopBtn');
const activityIndicator = document.getElementById('activityIndicator');
const statusText = document.getElementById('statusText');
const currentFile = document.getElementById('currentFile');
const currentFilename = document.getElementById('currentFilename');
const progressBarFill = document.getElementById('progressBarFill');
let sortColumn = null;
let sortDirection = 'asc';

ws.onopen = function () {
    console.log('WebSocket connected');
    document.getElementById('activityIndicator').style.background = '#10b981';
};

ws.onerror = function (error) {
    console.error('WebSocket error:', error);
    showToast('WebSocket connection error. Please refresh the page.', 'error');
};

ws.onclose = function () {
    console.log('WebSocket disconnected');
    document.getElementById('activityIndicator').style.background = '#ef4444';
    showToast('Lost connection to server. Please refresh the page.', 'warning');
};

ws.onmessage = function (event) {
    const data = JSON.parse(event.data);

    if (data.type === 'start') {
        // Clear table and create rows for all files
        analysisTableBody.innerHTML = '';
        fileRows.clear();
        document.getElementById('processedCount').innerText = '0';
        document.getElementById('totalCount').innerText = data.total;
        scanBtn.disabled = true;
        stopBtn.style.display = 'block';
        activityIndicator.classList.add('active');
        statusText.textContent = 'Scanning...';
        currentFile.style.display = 'none';
        
        // Create table rows for all files
        if (data.files && data.files.length > 0) {
            data.files.forEach((file, index) => {
                const row = createTableRow(file.filename, file.path, index);
                fileRows.set(file.path, row);
                analysisTableBody.appendChild(row);
            });
        }
    }

    else if (data.type === 'analyzing') {
        document.getElementById('processedCount').innerText = data.current;
        
        // Update current status
        statusText.textContent = 'Analyzing...';
        currentFile.style.display = 'block';
        currentFilename.textContent = data.filename;
        
        // Update progress bar
        const progress = (data.current / data.total) * 100;
        progressBarFill.style.width = `${progress}%`;
        
        // Update row status
        const row = fileRows.get(data.path);
        if (row) {
            updateRowStatus(row, 'analyzing');
        }
    }

    else if (data.type === 'file_done') {
        const row = fileRows.get(data.path);
        if (row) {
            // Update row with tags if available
            if (data.tags && Object.keys(data.tags).length > 0) {
                updateRowData(row, data.tags, data.path);
            } else if (data.status && data.status.includes('Skipped')) {
                // If skipped, mark as completed but don't update data
                updateRowStatus(row, 'completed');
            } else {
                // Mark as completed even without tags
                updateRowStatus(row, 'completed');
            }
        }
        
        // Update processed count from server data
        if (data.current !== undefined && data.total !== undefined) {
            document.getElementById('processedCount').innerText = data.current;
            document.getElementById('totalCount').innerText = data.total;
            
            // Update progress bar
            const progress = Math.min((data.current / data.total) * 100, 100);
            progressBarFill.style.width = `${progress}%`;
        }
        
        // Update current status
        const current = parseInt(document.getElementById('processedCount').innerText) || 0;
        const total = parseInt(document.getElementById('totalCount').innerText) || 0;
        
        if (current >= total && total > 0) {
            statusText.textContent = 'Complete';
            currentFile.style.display = 'none';
            progressBarFill.style.width = '100%';
        } else {
            statusText.textContent = 'Analyzing...';
        }
    }

    else if (data.type === 'complete') {
        document.getElementById('activityIndicator').style.background = '#10b981';
        scanBtn.disabled = false;
        stopBtn.style.display = 'none';
        activityIndicator.classList.remove('active');
        statusText.textContent = 'Ready';
        currentFile.style.display = 'none';
        showToast('Analysis complete!', 'success');
    }
    
    else if (data.type === 'cancelled') {
        document.getElementById('activityIndicator').style.background = '#fbbf24';
        scanBtn.disabled = false;
        stopBtn.style.display = 'none';
        activityIndicator.classList.remove('active');
        statusText.textContent = 'Cancelled';
        currentFile.style.display = 'none';
        showToast(`Analysis cancelled. Processed ${data.processed || 0} of ${data.total || 0} files.`, 'warning');
    }
    
    else if (data.type === 'error') {
        document.getElementById('activityIndicator').style.background = '#ef4444';
        scanBtn.disabled = false;
        stopBtn.style.display = 'none';
        activityIndicator.classList.remove('active');
        statusText.textContent = 'Error';
        currentFile.style.display = 'none';
        showToast(data.message || 'An error occurred during analysis', 'error');
        console.error('Scan error:', data.message);
    }
    
    else if (data.type === 'log') {
        // Log messages for debugging
        console.log('Scan log:', data.message);
    }
};

/**
 * Start scanning directory for music files
 */
function startScan() {
    const directory = document.getElementById('directoryInput').value;
    const force = document.getElementById('forceAnalyze').checked;
    const scanBtn = document.getElementById('scanBtn');

    // Validate input
    if (!directory || directory.trim() === '') {
        showToast('Please select a directory to scan', 'warning');
        return;
    }

    // Set loading state
    if (scanBtn) setButtonLoading(scanBtn, true);

    fetch('/scan', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            directory: directory,
            force: force
        }),
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            showToast('Scan started successfully', 'success');
        })
        .catch(error => {
            console.error('Scan error:', error);
            showToast(`Failed to start scan: ${error.message}`, 'error');
            document.getElementById('stopBtn').style.display = 'none';
        })
        .finally(() => {
            if (scanBtn) setButtonLoading(scanBtn, false);
        });
}

/**
 * Stop the current analysis scan
 */
function stopScan() {
    const stopBtn = document.getElementById('stopBtn');
    if (stopBtn) setButtonLoading(stopBtn, true);

    fetch('/stop', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
    })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json();
        })
        .then(data => {
            showToast('Stopping analysis...', 'info');
        })
        .catch(error => {
            console.error('Stop error:', error);
            showToast(`Failed to stop scan: ${error.message}`, 'error');
        })
        .finally(() => {
            if (stopBtn) setButtonLoading(stopBtn, false);
        });
}

// File Browser Logic
let currentBrowserPath = '';

function openFileBrowser() {
    document.getElementById('fileBrowserModal').style.display = 'block';
    // Load initial path (root or current input)
    const inputPath = document.getElementById('directoryInput').value;
    loadDirectory(inputPath || null);
}

function closeFileBrowser() {
    document.getElementById('fileBrowserModal').style.display = 'none';
}

function loadDirectory(path) {
    fetch('/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path })
    })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                log(`<span style="color:red">Error: ${data.error}</span>`);
                return;
            }

            currentBrowserPath = data.current_path;
            document.getElementById('browserCurrentPath').innerText = currentBrowserPath;

            const list = document.getElementById('fileList');
            list.innerHTML = '';

            data.items.forEach(item => {
                const div = document.createElement('div');
                div.className = `file-item ${item.type}`;
                const icon = item.type === 'directory' ? '📁' : 'cY';
                div.innerHTML = `<span>${icon}</span> ${item.name}`;

                if (item.type === 'directory') {
                    div.onclick = () => loadDirectory(item.path);
                }

                list.appendChild(div);
            });
        });
}

function selectCurrentDirectory() {
    document.getElementById('directoryInput').value = currentBrowserPath;
    closeFileBrowser();
}

// Close modal if clicked outside
window.onclick = function (event) {
    const modal = document.getElementById('fileBrowserModal');
    if (event.target == modal) {
        closeFileBrowser();
    }
}

function createTableRow(filename, path, index) {
    const row = document.createElement('tr');
    row.className = 'table-row waiting';
    row.dataset.path = path;
    row.dataset.filename = filename;
    
    // Extract directory path
    const dirPath = path.substring(0, path.lastIndexOf('/'));
    const displayPath = dirPath.length > 50 ? '...' + dirPath.slice(-47) : dirPath;
    
    // Extract artist and title from filename if possible
    const parts = filename.replace(/\.[^/.]+$/, '').split(' - ');
    const artist = parts.length > 1 ? parts[0].trim() : '';
    const title = parts.length > 1 ? parts.slice(1).join(' - ').trim() : filename.replace(/\.[^/.]+$/, '');
    
    row.innerHTML = `
        <td class="col-status">
            <div class="status-icon">⏳</div>
        </td>
        <td class="col-title">${title || filename}</td>
        <td class="col-artist">${artist || '-'}</td>
        <td class="col-bpm">-</td>
        <td class="col-key">-</td>
        <td class="col-energy">-</td>
        <td class="col-mood">-</td>
        <td class="col-genre">-</td>
        <td class="col-popularity">-</td>
        <td class="col-location" title="${dirPath}" style="cursor: pointer; color: #8b5cf6; text-decoration: underline;">
            📁 ${displayPath}
        </td>
    `;
    
    // Add click handler to open folder
    const locationCell = row.querySelector('.col-location');
    locationCell.addEventListener('click', (e) => {
        e.stopPropagation();
        openFolder(dirPath);
    });
    
    // Add click handler to row (excluding location)
    row.addEventListener('click', (e) => {
        if (!e.target.closest('.col-location')) {
            openFolder(dirPath);
        }
    });
    
    return row;
}

function updateRowStatus(row, status) {
    const statusIcon = row.querySelector('.status-icon');
    row.className = `table-row ${status}`;
    
    if (status === 'analyzing') {
        statusIcon.innerHTML = '<div class="spinner"></div>';
        row.classList.add('analyzing-row');
    } else if (status === 'completed') {
        statusIcon.innerHTML = '✅';
        row.classList.remove('analyzing-row');
    } else if (status === 'error') {
        statusIcon.innerHTML = '❌';
        row.classList.remove('analyzing-row');
    }
}

function updateRowData(row, tags, path) {
    updateRowStatus(row, 'completed');
    
    // Update BPM
    if (tags.bpm) {
        row.querySelector('.col-bpm').textContent = Math.round(tags.bpm);
    }
    
    // Update Key
    if (tags.key) {
        const keyCell = row.querySelector('.col-key');
        keyCell.textContent = tags.key;
        // Add Camelot code if available
        if (tags.key.includes('Major') || tags.key.includes('Minor')) {
            // Could add Camelot conversion here if needed
        }
    }
    
    // Update Energy
    if (tags.energy !== undefined) {
        row.querySelector('.col-energy').textContent = tags.energy.toFixed(2);
    }
    
    // Update Mood
    if (tags.mood) {
        row.querySelector('.col-mood').textContent = tags.mood;
    }
    
    // Update Genre
    if (tags.genres && Array.isArray(tags.genres) && tags.genres.length > 0) {
        row.querySelector('.col-genre').textContent = tags.genres.slice(0, 2).join(', ');
    } else if (tags.genres) {
        row.querySelector('.col-genre').textContent = String(tags.genres).slice(0, 50);
    }
    
    // Update Popularity
    if (tags.popularity !== undefined) {
        row.querySelector('.col-popularity').textContent = tags.popularity;
    }
    
    // Update Artist/Title if available
    if (tags.artist) {
        row.querySelector('.col-artist').textContent = tags.artist;
    }
    if (tags.title) {
        row.querySelector('.col-title').textContent = tags.title;
    }
    
    // Store tags for re-analysis
    row.dataset.tags = JSON.stringify(tags);
    
    // Add double-click handler for re-analysis
    row.ondblclick = () => reanalyzeTrack(path);
    row.style.cursor = 'pointer';
    row.title = 'Double-click to re-analyze';
}

function sortTable(column) {
    const tbody = analysisTableBody;
    const rows = Array.from(tbody.querySelectorAll('tr.table-row'));
    
    // Remove existing sort indicators
    document.querySelectorAll('.sort-indicator').forEach(ind => {
        ind.textContent = '↕';
    });
    
    // Toggle sort direction
    if (sortColumn === column) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = column;
        sortDirection = 'asc';
    }
    
    // Update sort indicator
    const header = document.querySelector(`th.col-${column}`);
    if (header) {
        const indicator = header.querySelector('.sort-indicator');
        indicator.textContent = sortDirection === 'asc' ? '↑' : '↓';
    }
    
    // Sort rows
    rows.sort((a, b) => {
        let aVal, bVal;
        
        switch(column) {
            case 'title':
                aVal = a.querySelector('.col-title').textContent.trim();
                bVal = b.querySelector('.col-title').textContent.trim();
                break;
            case 'artist':
                aVal = a.querySelector('.col-artist').textContent.trim();
                bVal = b.querySelector('.col-artist').textContent.trim();
                break;
            case 'bpm':
                aVal = parseFloat(a.querySelector('.col-bpm').textContent) || 0;
                bVal = parseFloat(b.querySelector('.col-bpm').textContent) || 0;
                break;
            case 'key':
                aVal = a.querySelector('.col-key').textContent.trim();
                bVal = b.querySelector('.col-key').textContent.trim();
                break;
            case 'energy':
                aVal = parseFloat(a.querySelector('.col-energy').textContent) || 0;
                bVal = parseFloat(b.querySelector('.col-energy').textContent) || 0;
                break;
            case 'popularity':
                aVal = parseFloat(a.querySelector('.col-popularity').textContent) || 0;
                bVal = parseFloat(b.querySelector('.col-popularity').textContent) || 0;
                break;
            default:
                return 0;
        }
        
        if (typeof aVal === 'string') {
            return sortDirection === 'asc' 
                ? aVal.localeCompare(bVal)
                : bVal.localeCompare(aVal);
        } else {
            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }
    });
    
    // Re-append sorted rows
    rows.forEach(row => tbody.appendChild(row));
}

// Playlist Management
// Utility function for escaping HTML
function escapeHtml(text) {
    if (text == null || text === undefined) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function renderPlaylistTable(tracks) {
    // This function is kept for backward compatibility but now renders a drag-and-drop list
    renderPlaylistList(tracks);
}

function renderPlaylistList(tracks) {
    const listContainer = document.getElementById('playlistList');
    if (!listContainer) return;
    
    if (tracks.length === 0) {
        listContainer.innerHTML = '<div class="playlist-empty-state">No tracks in playlist</div>';
        return;
    }
    
    listContainer.innerHTML = tracks.map((track, index) => {
        const title = escapeHtml(track.title || track.filename || '-');
        const artist = escapeHtml(track.artist || '-');
        const bpm = track.bpm ? Math.round(track.bpm) : '-';
        const key = escapeHtml(track.key || '-');
        const energy = track.energy !== undefined ? track.energy.toFixed(2) : '-';
        const mood = escapeHtml(track.mood || '-');
        
        return `
            <div class="playlist-item" draggable="true" data-index="${index}" data-track-id="${track.path || index}">
                <div class="playlist-item-handle">☰</div>
                <div class="playlist-item-number">${index + 1}</div>
                <div class="playlist-item-content">
                    <div class="playlist-item-title">${title}</div>
                    <div class="playlist-item-artist">${artist}</div>
                </div>
                <div class="playlist-item-meta">
                    <span class="playlist-meta-item"><strong>BPM:</strong> ${bpm}</span>
                    <span class="playlist-meta-item"><strong>Key:</strong> ${key}</span>
                    <span class="playlist-meta-item"><strong>Energy:</strong> ${energy}</span>
                    ${mood !== '-' ? `<span class="playlist-meta-item"><strong>Mood:</strong> ${mood}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
    
    // Attach drag event listeners
    attachPlaylistDragListeners();
}

let draggedPlaylistItem = null;
let draggedPlaylistIndex = null;

function attachPlaylistDragListeners() {
    const items = document.querySelectorAll('.playlist-item');
    
    items.forEach((item) => {
        item.addEventListener('dragstart', (e) => {
            draggedPlaylistItem = item;
            draggedPlaylistIndex = parseInt(item.dataset.index);
            item.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', ''); // Required for Firefox
        });
        
        item.addEventListener('dragend', (e) => {
            item.classList.remove('dragging');
            // Remove drag-over class from all items
            document.querySelectorAll('.playlist-item').forEach(i => {
                i.classList.remove('drag-over');
            });
            draggedPlaylistItem = null;
            draggedPlaylistIndex = null;
        });
        
        item.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            if (draggedPlaylistItem && draggedPlaylistItem !== item) {
                const afterElement = getDragAfterElement(item.parentElement, e.clientY);
                const dragging = document.querySelector('.dragging');
                
                if (afterElement == null) {
                    item.parentElement.appendChild(dragging);
                } else {
                    item.parentElement.insertBefore(dragging, afterElement);
                }
            }
        });
        
        item.addEventListener('dragenter', (e) => {
            e.preventDefault();
            if (item !== draggedPlaylistItem) {
                item.classList.add('drag-over');
            }
        });
        
        item.addEventListener('dragleave', (e) => {
            item.classList.remove('drag-over');
        });
        
        item.addEventListener('drop', (e) => {
            e.preventDefault();
            item.classList.remove('drag-over');
            
            if (draggedPlaylistItem && draggedPlaylistItem !== item) {
                // Get all items in their current order (after visual reordering)
                const allItems = Array.from(item.parentElement.querySelectorAll('.playlist-item'));
                const dropIndex = allItems.indexOf(item);
                
                // Reorder the tracks array based on the new position
                const tracks = [...currentPlaylistTracks];
                const [removed] = tracks.splice(draggedPlaylistIndex, 1);
                
                // Adjust drop index if dragging down
                let newIndex = dropIndex;
                if (draggedPlaylistIndex < dropIndex) {
                    newIndex = dropIndex;
                }
                
                tracks.splice(newIndex, 0, removed);
                
                // Update currentPlaylistTracks
                currentPlaylistTracks = tracks;
                
                // Re-render the list with updated indices
                renderPlaylistList(currentPlaylistTracks);
                
                showToast('Playlist reordered', 'success', 2000);
            }
        });
    });
}

function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.playlist-item:not(.dragging)')];
    
    return draggableElements.reduce((closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        
        if (offset < 0 && offset > closest.offset) {
            return { offset: offset, element: child };
        } else {
            return closest;
        }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
}

function sortPlaylistTable(column) {
    // Sorting is now handled by drag-and-drop, but keeping this for backward compatibility
    // Users can manually reorder tracks by dragging
    showToast('Use drag and drop to reorder tracks', 'info', 2000);
}

async function savePlaylist() {
    if (currentPlaylistTracks.length === 0) {
        showToast('No playlist to save. Generate a playlist first.', 'warning');
        return;
    }
    
    const name = prompt('Enter playlist name:');
    if (!name || !name.trim()) {
        return;
    }
    
    try {
        const response = await fetch('/library/save_playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name.trim(),
                tracks: currentPlaylistTracks
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.success) {
            showToast(`Playlist "${name}" saved successfully`, 'success');
            loadSavedPlaylists();
        } else {
            showToast(`Failed to save playlist: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Error saving playlist:', error);
        showToast(`Failed to save playlist: ${error.message}`, 'error');
    }
}

async function loadSavedPlaylists() {
    const tbody = document.getElementById('savedPlaylistsTableBody');
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Loading playlists...</td></tr>';
    
    try {
        const response = await fetch('/library/playlists', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        const playlists = data.playlists || [];
        
        if (playlists.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" class="empty-state">No saved playlists yet</td></tr>';
            return;
        }
        
        tbody.innerHTML = playlists.map(playlist => {
            const date = new Date(playlist.created || Date.now());
            return `
                <tr class="table-row">
                    <td class="col-title">${playlist.name}</td>
                    <td class="col-bpm">${playlist.track_count || 0}</td>
                    <td class="col-key">${date.toLocaleDateString()}</td>
                    <td class="col-energy">
                        <button class="secondary-btn" onclick="loadPlaylist('${playlist.id}')" style="margin-right: 0.5rem;">Load</button>
                        <button class="secondary-btn" onclick="deletePlaylist('${playlist.id}')">Delete</button>
                    </td>
                </tr>
            `;
        }).join('');
        
    } catch (error) {
        console.error('Error loading playlists:', error);
        tbody.innerHTML = '<tr><td colspan="4" class="empty-state" style="color: #f87171;">Error loading playlists: ' + error.message + '</td></tr>';
    }
}

async function loadPlaylist(playlistId) {
    try {
        const response = await fetch(`/library/playlists/${playlistId}`, {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.success) {
            currentPlaylistTracks = data.tracks || [];
            
            // Update loaded playlist section
            const loadedSection = document.getElementById('loadedPlaylistSection');
            const loadedName = document.getElementById('loadedPlaylistName');
            const loadedCount = document.getElementById('loadedPlaylistCount');
            const loadedTableBody = document.getElementById('loadedPlaylistTableBody');
            
            if (loadedSection && loadedName && loadedCount && loadedTableBody) {
                loadedName.textContent = data.name;
                loadedCount.textContent = currentPlaylistTracks.length;
                loadedSection.style.display = 'block';
                
                // Render tracks in the loaded playlist table
                renderLoadedPlaylistTable(currentPlaylistTracks);
                
                // Scroll to loaded playlist section
                loadedSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else {
                // Fallback: use existing playlist table if loaded section doesn't exist
                const playlistCount = document.getElementById('playlistCount');
                if (playlistCount) playlistCount.innerText = currentPlaylistTracks.length;
                renderPlaylistTable(currentPlaylistTracks);
            }
            
            showToast(`Playlist loaded: ${data.name}`, 'success');
        } else {
            showToast(`Failed to load playlist: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Error loading playlist:', error);
        showToast(`Failed to load playlist: ${error.message}`, 'error');
    }
}

function renderLoadedPlaylistTable(tracks) {
    const tbody = document.getElementById('loadedPlaylistTableBody');
    if (!tbody) return;
    
    if (tracks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No tracks in playlist</td></tr>';
        return;
    }
    
    tbody.innerHTML = tracks.map((track, index) => {
        const statusIcon = track.status === 'completed' ? '✅' : track.status === 'error' ? '❌' : '⏳';
        return `
            <tr class="table-row">
                <td class="col-status">${index + 1}</td>
                <td class="col-title">${escapeHtml(track.title || track.filename || '-')}</td>
                <td class="col-artist">${escapeHtml(track.artist || '-')}</td>
                <td class="col-bpm">${track.bpm ? track.bpm.toFixed(0) : '-'}</td>
                <td class="col-key">${escapeHtml(track.key || '-')}</td>
                <td class="col-energy">${track.energy ? track.energy.toFixed(2) : '-'}</td>
                <td class="col-mood">${escapeHtml(track.mood || '-')}</td>
            </tr>
        `;
    }).join('');
}

async function deletePlaylist(playlistId) {
    if (!confirm('Are you sure you want to delete this playlist? This action cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch(`/library/playlists/${playlistId}`, {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.success) {
            showToast('Playlist deleted successfully', 'success');
            
            // Hide loaded playlist section if the deleted playlist was loaded
            const loadedSection = document.getElementById('loadedPlaylistSection');
            if (loadedSection && loadedSection.style.display !== 'none') {
                // Check if the loaded playlist matches the deleted one
                const loadedName = document.getElementById('loadedPlaylistName');
                if (loadedName && savedPlaylistsData.find(p => p.id === playlistId && p.name === loadedName.textContent)) {
                    loadedSection.style.display = 'none';
                    currentPlaylistTracks = [];
                }
            }
            
            loadSavedPlaylists();
        } else {
            showToast(`Failed to delete playlist: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Error deleting playlist:', error);
        showToast(`Failed to delete playlist: ${error.message}`, 'error');
    }
}

async function reanalyzeTrack(path) {
    if (!path) {
        showToast('Path not available for re-analysis', 'error');
        return;
    }

    const row = fileRows.get(path);
    if (!row) {
        showToast('File row not found', 'error');
        return;
    }

    // Update row status to analyzing
    updateRowStatus(row, 'analyzing');

    try {
        const response = await fetch('/analyze_file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path, force: true })
        });

        const result = await response.json();
        if (result.success) {
            updateRowData(row, result.tags, path);
            showToast(`Re-analyzed successfully!`, 'success');
        } else {
            updateRowStatus(row, 'error');
            showToast(`Error: ${result.error}`, 'error');
        }
    } catch (e) {
        updateRowStatus(row, 'error');
        showToast(`Failed to re-analyze: ${e.message}`, 'error');
    }
}

function openFolder(dirPath) {
    if (!dirPath) return;
    // Use fetch to open folder via backend
    fetch('/open_folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: dirPath })
    }).catch(err => {
        console.error('Failed to open folder:', err);
        showToast('Failed to open folder', 'error');
    });
}

function toggleSelectAllLibrary() {
    const selectAllCheckbox = document.getElementById('selectAllLibraryCheckbox');
    if (!selectAllCheckbox) return;
    const checkboxes = document.querySelectorAll('.library-row-checkbox');
    checkboxes.forEach(cb => {
        cb.checked = selectAllCheckbox.checked;
    });
    updateReanalyzeLibraryButton();
}

function updateReanalyzeLibraryButton() {
    const checkboxes = document.querySelectorAll('.library-row-checkbox:checked');
    const reanalyzeBtn = document.getElementById('reanalyzeLibrarySelectedBtn');
    if (!reanalyzeBtn) return;
    
    if (checkboxes.length > 0) {
        reanalyzeBtn.style.display = 'inline-block';
        reanalyzeBtn.textContent = `🔄 Reanalyze Selected (${checkboxes.length})`;
        reanalyzeBtn.disabled = false;
    } else {
        reanalyzeBtn.style.display = 'none';
    }
}

async function reanalyzeLibrarySelected() {
    const checkboxes = document.querySelectorAll('.library-row-checkbox:checked');
    if (checkboxes.length === 0) {
        showToast('No files selected', 'warning');
        return;
    }
    
    const paths = Array.from(checkboxes).map(cb => {
        const row = cb.closest('tr');
        return row ? row.dataset.path : null;
    }).filter(path => path); // Filter out empty paths
    
    if (paths.length === 0) {
        showToast('No valid file paths found', 'error');
        return;
    }
    
    if (!confirm(`Reanalyze ${paths.length} selected file(s)?`)) {
        return;
    }
    
    // Disable button during processing
    const reanalyzeBtn = document.getElementById('reanalyzeLibrarySelectedBtn');
    if (!reanalyzeBtn) return;
    reanalyzeBtn.disabled = true;
    reanalyzeBtn.textContent = `⏳ Processing...`;
    
    try {
        const response = await fetch('/analyze_files_batch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: paths, force: true })
        });
        
        const result = await response.json();
        if (result.success) {
            // Update rows with new data
            let successCount = 0;
            result.results.forEach(item => {
                if (item.success) {
                    successCount++;
                    // Find and update the row
                    const rows = document.querySelectorAll('#libraryTableBody tr');
                    rows.forEach(row => {
                        if (row.dataset.path === item.path) {
                            // Update row data
                            const tags = item.tags;
                            if (tags.bpm) {
                                const bpmCell = row.querySelector('.col-bpm');
                                if (bpmCell) bpmCell.textContent = Math.round(tags.bpm);
                            }
                            if (tags.key) {
                                const keyCell = row.querySelector('.col-key');
                                if (keyCell) keyCell.textContent = tags.key;
                            }
                            if (tags.energy !== undefined) {
                                const energyCell = row.querySelector('.col-energy');
                                if (energyCell) energyCell.textContent = tags.energy.toFixed(2);
                            }
                            if (tags.mood) {
                                const moodCell = row.querySelector('.col-mood');
                                if (moodCell) moodCell.textContent = tags.mood;
                            }
                            if (tags.genres) {
                                const genreCell = row.querySelector('.col-genre');
                                if (genreCell) {
                                    const genre = Array.isArray(tags.genres) ? tags.genres.join(', ') : String(tags.genres);
                                    genreCell.textContent = genre.length > 50 ? genre.substring(0, 50) + '...' : genre;
                                }
                            }
                            if (tags.popularity !== undefined) {
                                const popCell = row.querySelector('.col-popularity');
                                if (popCell) popCell.textContent = tags.popularity;
                            }
                            if (tags.title) {
                                const titleCell = row.querySelector('.col-title span');
                                if (titleCell) titleCell.textContent = tags.title;
                            }
                            if (tags.artist) {
                                const artistCell = row.querySelector('.col-artist span');
                                if (artistCell) artistCell.textContent = tags.artist;
                            }
                            // Update status
                            const statusIcon = row.querySelector('.status-icon');
                            if (statusIcon) statusIcon.textContent = '✅';
                            row.className = 'table-row completed';
                        }
                    });
                }
            });
            
            // Uncheck all checkboxes
            checkboxes.forEach(cb => cb.checked = false);
            const selectAllCheckbox = document.getElementById('selectAllLibraryCheckbox');
            if (selectAllCheckbox) selectAllCheckbox.checked = false;
            updateReanalyzeLibraryButton();
            
            showToast(`Successfully reanalyzed ${successCount} file(s)`, 'success');
            
            // Reload library to refresh data
            setTimeout(() => {
                loadLibrary();
            }, 1000);
        } else {
            showToast(`Error: ${result.error}`, 'error');
        }
    } catch (e) {
        showToast(`Failed to reanalyze: ${e.message}`, 'error');
    } finally {
        const reanalyzeBtn = document.getElementById('reanalyzeLibrarySelectedBtn');
        if (reanalyzeBtn) {
            reanalyzeBtn.disabled = false;
            updateReanalyzeLibraryButton();
        }
    }
}

// --- Library & DJ Features ---

function switchTab(tabName) {
    // Update Buttons
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    if (event && event.target) {
        event.target.classList.add('active');
    } else {
        // Fallback: find button by text content
        document.querySelectorAll('.nav-btn').forEach(btn => {
            if (btn.textContent.includes('Dashboard') && tabName === 'dashboard') btn.classList.add('active');
            if (btn.textContent.includes('Libraries') && tabName === 'library') btn.classList.add('active');
            if (btn.textContent.includes('Playlists') && tabName === 'playlists') btn.classList.add('active');
        });
    }

    // Update Content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    const tabId = `${tabName}-tab`;
    const tabElement = document.getElementById(tabId);
    if (tabElement) {
        tabElement.classList.add('active');
    }
    
    // Load data when switching to Library tab
    if (tabName === 'library') {
        loadLibrary();
        // Don't auto-load stats, only load when shown
    }
    
    // Load saved playlists when switching to Playlists tab
    if (tabName === 'playlists') {
        loadSavedPlaylists();
    }
}

// Library Management
let currentLibraryTracks = [];
let currentPlaylistTracks = [];

// Collapsible sections state
let filtersAndBuilderExpanded = false;

function toggleFiltersAndBuilder() {
    const container = document.getElementById('filtersAndBuilderContainer');
    const toggleBtn = document.getElementById('toggleFiltersAndBuilderBtn');
    const toggleIcon = document.getElementById('filtersAndBuilderToggleIcon');
    
    if (!container || !toggleBtn || !toggleIcon) return;
    
    filtersAndBuilderExpanded = !filtersAndBuilderExpanded;
    
    if (filtersAndBuilderExpanded) {
        container.style.display = 'block';
        toggleIcon.textContent = '▲';
        toggleBtn.innerHTML = '<span id="filtersAndBuilderToggleIcon">▲</span> Hide Options';
    } else {
        container.style.display = 'none';
        toggleIcon.textContent = '▼';
        toggleBtn.innerHTML = '<span id="filtersAndBuilderToggleIcon">▼</span> Show Options';
    }
}

// Backward compatibility functions
function toggleFilters() {
    if (!filtersAndBuilderExpanded) {
        toggleFiltersAndBuilder();
    }
}

function togglePlaylistBuilder() {
    if (!filtersAndBuilderExpanded) {
        toggleFiltersAndBuilder();
    }
}

async function loadLibrary() {
    const tbody = document.getElementById('libraryTableBody');
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Loading library...</td></tr>';
    
    try {
        // Query all tracks (no filters)
        const response = await fetch('/library/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        currentLibraryTracks = data.tracks || [];
        
        document.getElementById('libraryCount').innerText = data.count || 0;
        renderLibraryTable(currentLibraryTracks);
        
        // Populate genre dropdown
        populateGenreDropdown(currentLibraryTracks);
        
    } catch (error) {
        console.error('Error loading library:', error);
        tbody.innerHTML = '<tr><td colspan="11" class="empty-state" style="color: #f87171;">Error loading library: ' + error.message + '</td></tr>';
    }
}

function populateGenreDropdown(tracks) {
    const genreSelect = document.getElementById('genreFilter');
    const genres = new Set();
    
    tracks.forEach(track => {
        if (track.genre) {
            // Handle comma-separated genres
            const trackGenres = track.genre.split(',').map(g => g.trim()).filter(g => g);
            trackGenres.forEach(g => genres.add(g));
        }
    });
    
    // Clear existing options except "Any Genre"
    genreSelect.innerHTML = '<option value="">Any Genre</option>';
    
    // Sort and add genres
    Array.from(genres).sort().forEach(genre => {
        const option = document.createElement('option');
        option.value = genre;
        option.textContent = genre;
        genreSelect.appendChild(option);
    });
}

function renderLibraryTable(tracks) {
    const tbody = document.getElementById('libraryTableBody');
    
    if (tracks.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" class="empty-state">No tracks found in library</td></tr>';
        return;
    }
    
    // Escape HTML to prevent XSS
    // escapeHtml is now defined globally, no need to redefine here
    
    tbody.innerHTML = tracks.map(track => {
        // Determine status icon based on track completeness
        let statusIcon = '✅';
        let statusClass = 'completed';
        
        // Check if track has essential metadata
        const hasBPM = track.bpm && track.bpm > 0;
        const hasKey = track.key && track.key.trim();
        const hasEnergy = track.energy !== undefined && track.energy > 0;
        
        if (!hasBPM || !hasKey) {
            statusIcon = '⚠️';
            statusClass = 'waiting';
        }
        
        // Format genre (handle comma-separated or array)
        let genre = '-';
        if (track.genres) {
            if (Array.isArray(track.genres)) {
                genre = track.genres.join(', ');
            } else {
                genre = String(track.genres);
            }
        } else if (track.genre) {
            genre = Array.isArray(track.genre) ? track.genre.join(', ') : String(track.genre);
        }
        const genreDisplay = genre.length > 50 ? genre.substring(0, 50) + '...' : genre;
        
        // Format mood
        const mood = track.mood || '-';
        const moodDisplay = mood.length > 30 ? mood.substring(0, 30) + '...' : mood;
        
        // Extract directory path
        const path = track.path || '';
        const dirPath = path ? path.substring(0, path.lastIndexOf('/')) : '';
        const displayPath = dirPath.length > 50 ? '...' + dirPath.slice(-47) : dirPath;
        
        return `
        <tr class="table-row ${statusClass}" data-path="${escapeHtml(path)}" data-filename="${escapeHtml(track.filename || '')}">
            <td class="col-checkbox">
                <input type="checkbox" class="library-row-checkbox" onchange="updateReanalyzeLibraryButton()">
            </td>
            <td class="col-status">
                <div class="status-icon">${statusIcon}</div>
            </td>
            <td class="col-title" title="${escapeHtml(track.title || track.filename || '-')}">
                <span style="display: block; max-width: 100%;">${escapeHtml(track.title || track.filename || '-')}</span>
            </td>
            <td class="col-artist" title="${escapeHtml(track.artist || '-')}">
                <span style="display: block; max-width: 100%;">${escapeHtml(track.artist || '-')}</span>
            </td>
            <td class="col-bpm">${hasBPM ? Math.round(track.bpm) : '-'}</td>
            <td class="col-key">${escapeHtml(track.key || '-')}</td>
            <td class="col-energy">${hasEnergy ? track.energy.toFixed(2) : '-'}</td>
            <td class="col-mood" title="${escapeHtml(mood)}">${escapeHtml(moodDisplay)}</td>
            <td class="col-genre" title="${escapeHtml(genre)}">${escapeHtml(genreDisplay)}</td>
            <td class="col-popularity">${track.popularity !== undefined ? track.popularity : '-'}</td>
            <td class="col-location" title="${escapeHtml(dirPath)}" style="cursor: pointer; color: #8b5cf6; text-decoration: underline;">
                ${dirPath ? '📁 ' + escapeHtml(displayPath) : '-'}
            </td>
        </tr>
    `;
    }).join('');
    
    // Add click handlers for location cells and rows
    tbody.querySelectorAll('tr').forEach(row => {
        const path = row.dataset.path;
        if (!path) return;
        
        const dirPath = path.substring(0, path.lastIndexOf('/'));
        const locationCell = row.querySelector('.col-location');
        
        if (locationCell && dirPath) {
            locationCell.addEventListener('click', (e) => {
                e.stopPropagation();
                openFolder(dirPath);
            });
        }
        
        // Add click handler to row (excluding checkbox and location)
        row.addEventListener('click', (e) => {
            if (e.target.type !== 'checkbox' && !e.target.closest('.col-location') && !e.target.closest('.col-checkbox') && dirPath) {
                openFolder(dirPath);
            }
        });
    });
}

function sortLibraryTable(column) {
    if (currentLibraryTracks.length === 0) return;
    
    const tbody = document.getElementById('libraryTableBody');
    const rows = Array.from(tbody.querySelectorAll('tr.table-row'));
    
    // Remove existing sort indicators from library table
    document.querySelectorAll('#libraryTable .sort-indicator').forEach(ind => {
        ind.textContent = '↕';
    });
    
    // Toggle sort direction
    if (sortColumn === column && sortColumn.startsWith('library_')) {
        sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        sortColumn = 'library_' + column;
        sortDirection = 'asc';
    }
    
    // Update sort indicator
    const header = document.querySelector(`#libraryTable th.col-${column}`);
    if (header) {
        const indicator = header.querySelector('.sort-indicator');
        indicator.textContent = sortDirection === 'asc' ? '↑' : '↓';
    }
    
    // Sort tracks
    const sortedTracks = [...currentLibraryTracks].sort((a, b) => {
        let aVal, bVal;
        
        switch(column) {
            case 'title':
                aVal = (a.title || a.filename || '').toLowerCase();
                bVal = (b.title || b.filename || '').toLowerCase();
                break;
            case 'artist':
                aVal = (a.artist || '').toLowerCase();
                bVal = (b.artist || '').toLowerCase();
                break;
            case 'bpm':
                aVal = parseFloat(a.bpm) || 0;
                bVal = parseFloat(b.bpm) || 0;
                break;
            case 'key':
                aVal = (a.key || '').toLowerCase();
                bVal = (b.key || '').toLowerCase();
                break;
            case 'energy':
                aVal = parseFloat(a.energy) || 0;
                bVal = parseFloat(b.energy) || 0;
                break;
            default:
                return 0;
        }
        
        if (typeof aVal === 'string') {
            return sortDirection === 'asc' 
                ? aVal.localeCompare(bVal)
                : bVal.localeCompare(aVal);
        } else {
            return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
        }
    });
    
    renderLibraryTable(sortedTracks);
}

function scanLibrary() {
    const directory = document.getElementById('directoryInput').value;
    if (!directory) {
        alert("Please select a directory in the Dashboard first.");
        return;
    }

    fetch('/library/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ directory: directory })
    })
        .then(res => res.json())
        .then(data => {
            alert(data.message + ` (${data.count} tracks)`);
            queryLibrary(); // Refresh list
        });
}

function getFilters() {
    const bpmMin = document.getElementById('bpmMin').value;
    const bpmMax = document.getElementById('bpmMax').value;
    const energyMin = document.getElementById('energyMin').value;
    const energyMax = document.getElementById('energyMax').value;
    
    return {
        bpm_min: bpmMin && bpmMin !== '60' ? parseFloat(bpmMin) : null,
        bpm_max: bpmMax && bpmMax !== '180' ? parseFloat(bpmMax) : null,
        energy_min: energyMin && energyMin !== '0' ? parseFloat(energyMin) / 100 : null,
        energy_max: energyMax && energyMax !== '100' ? parseFloat(energyMax) / 100 : null,
        key: document.getElementById('keyFilter').value || null,
        genre: document.getElementById('genreFilter').value || null
    };
}

// Initialize dual-range sliders
function initDualRangeSliders() {
    const bpmMin = document.getElementById('bpmMin');
    const bpmMax = document.getElementById('bpmMax');
    const energyMin = document.getElementById('energyMin');
    const energyMax = document.getElementById('energyMax');
    
    // BPM sliders
    if (bpmMin && bpmMax) {
        function updateBPMDisplay() {
            const min = parseInt(bpmMin.value);
            const max = parseInt(bpmMax.value);
            document.getElementById('bpmRangeDisplay').textContent = `${min} - ${max}`;
            
            // Ensure min <= max
            if (min > max) {
                bpmMin.value = max;
            }
            if (max < min) {
                bpmMax.value = min;
            }
            
            updateRangeTrack(bpmMin, bpmMax, 'bpm');
        }
        
        bpmMin.addEventListener('input', updateBPMDisplay);
        bpmMax.addEventListener('input', updateBPMDisplay);
        updateBPMDisplay();
    }
    
    // Energy sliders
    if (energyMin && energyMax) {
        function updateEnergyDisplay() {
            const min = parseFloat(energyMin.value) / 100;
            const max = parseFloat(energyMax.value) / 100;
            document.getElementById('energyRangeDisplay').textContent = `${min.toFixed(1)} - ${max.toFixed(1)}`;
            
            // Ensure min <= max
            if (parseInt(energyMin.value) > parseInt(energyMax.value)) {
                energyMin.value = energyMax.value;
            }
            if (parseInt(energyMax.value) < parseInt(energyMin.value)) {
                energyMax.value = energyMin.value;
            }
            
            updateRangeTrack(energyMin, energyMax, 'energy');
        }
        
        energyMin.addEventListener('input', updateEnergyDisplay);
        energyMax.addEventListener('input', updateEnergyDisplay);
        updateEnergyDisplay();
    }
}

function updateRangeTrack(minSlider, maxSlider, prefix) {
    const container = minSlider.closest('.dual-range-container');
    if (!container) return;
    
    const track = container.querySelector('.range-track');
    if (!track) return;
    
    const min = parseFloat(minSlider.value);
    const max = parseFloat(maxSlider.value);
    const minPercent = ((min - parseFloat(minSlider.min)) / (parseFloat(minSlider.max) - parseFloat(minSlider.min))) * 100;
    const maxPercent = ((max - parseFloat(maxSlider.min)) / (parseFloat(maxSlider.max) - parseFloat(maxSlider.min))) * 100;
    
    track.style.setProperty('--range-min', `${minPercent}%`);
    track.style.setProperty('--range-max', `${maxPercent}%`);
}

/**
 * Query library with filters
 */
function queryLibrary() {
    const queryBtn = document.querySelector('#library-tab button');
    if (queryBtn) setButtonLoading(queryBtn, true);

    fetch('/library/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(getFilters())
    })
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            currentLibraryTracks = data.tracks || [];
            document.getElementById('libraryCount').innerText = data.count || 0;
            renderLibraryTable(currentLibraryTracks);
            showToast(`Found ${data.count} track${data.count !== 1 ? 's' : ''}`, 'success');
        })
        .catch(error => {
            console.error('Query error:', error);
            showToast(`Failed to query library: ${error.message}`, 'error');
        })
        .finally(() => {
            if (queryBtn) setButtonLoading(queryBtn, false);
        });
}

/**
 * Export library to M3U playlist
 */
function exportM3U() {
    if (currentPlaylistTracks.length === 0) {
        showToast('No playlist to export. Generate a playlist first.', 'warning');
        return;
    }
    
    const btn = event.target;
    setButtonLoading(btn, true);

    fetch('/library/export/m3u', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: currentPlaylistTracks })
    })
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            showToast(`Playlist exported to: ${data.path}`, 'success', 6000);
        })
        .catch(error => {
            console.error('Export error:', error);
            showToast(`Failed to export M3U: ${error.message}`, 'error');
        })
        .finally(() => {
            setButtonLoading(btn, false);
        });
}

/**
 * Export library to Rekordbox XML
 */
function exportRekordbox() {
    if (currentPlaylistTracks.length === 0) {
        showToast('No playlist to export. Generate a playlist first.', 'warning');
        return;
    }
    
    const btn = event.target;
    setButtonLoading(btn, true);

    fetch('/library/export/rekordbox', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tracks: currentPlaylistTracks })
    })
        .then(res => {
            if (!res.ok) {
                throw new Error(`HTTP error! status: ${res.status}`);
            }
            return res.json();
        })
        .then(data => {
            showToast(`Rekordbox XML exported to: ${data.path}`, 'success', 6000);
        })
        .catch(error => {
            console.error('Export error:', error);
            showToast(`Failed to export Rekordbox XML: ${error.message}`, 'error');
        })
        .finally(() => {
            setButtonLoading(btn, false);
        });
}

/**
 * Generate smart playlist with harmonic mixing and energy curves
 */
async function generateSmartPlaylist() {
    const duration = parseInt(document.getElementById('playlistDuration').value);
    const energyCurve = document.getElementById('energyCurve').value;
    const startKey = document.getElementById('startKey').value || null;
    const mood = document.getElementById('playlistMood').value || null;
    const statusDiv = document.getElementById('playlistStatus');
    const generateBtn = document.querySelector('#smartPlaylistBuilder button');

    // Validate duration
    if (!duration || duration < 1 || duration > 300) {
        showToast('Please enter a valid duration (1-300 minutes)', 'warning');
        return;
    }

    // Set loading state
    if (generateBtn) setButtonLoading(generateBtn, true);
    statusDiv.textContent = '🎵 Generating smart playlist...';
    statusDiv.style.color = 'var(--accent-color)';

    try {
        const response = await fetch('/library/generate_smart_playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                duration: duration,
                energy_curve: energyCurve,
                start_key: startKey,
                mood: mood,
                filters: getFilters()
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
            statusDiv.textContent = `✅ ${data.message}`;
            statusDiv.style.color = '#4ade80';
            showToast(`Generated playlist with ${data.count} tracks`, 'success');

            // Store current playlist
            currentPlaylistTracks = data.tracks || [];
            
            // Display the generated playlist in the playlist table
            document.getElementById('playlistCount').innerText = data.count;
            renderPlaylistTable(currentPlaylistTracks);
            
            // Switch to library tab to show the generated playlist
            if (document.getElementById('library-tab').classList.contains('active') === false) {
                // Switch to library tab
                document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
                document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
                document.getElementById('library-tab').classList.add('active');
                // Find and activate the library nav button
                const libraryBtn = Array.from(document.querySelectorAll('.nav-btn')).find(btn => btn.textContent.includes('Libraries'));
                if (libraryBtn) libraryBtn.classList.add('active');
            }
        } else {
            statusDiv.textContent = `❌ Error: ${data.error}`;
            statusDiv.style.color = '#f87171';
            showToast(`Failed to generate playlist: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Playlist generation error:', error);
        statusDiv.textContent = `❌ Error: ${error.message}`;
        statusDiv.style.color = '#f87171';
        showToast(`Failed to generate playlist: ${error.message}`, 'error');
    } finally {
        if (generateBtn) setButtonLoading(generateBtn, false);
    }
}

async function generateSmartPlaylistFromLibrary() {
    // Use filtered library tracks instead of all tracks
    if (currentLibraryTracks.length === 0) {
        showToast('No tracks available. Please apply filters or refresh library first.', 'warning');
        return;
    }

    const duration = parseInt(document.getElementById('playlistDuration').value);
    const energyCurve = document.getElementById('energyCurve').value;
    const startKey = document.getElementById('startKey').value || null;
    const mood = document.getElementById('playlistMood').value || null;
    const statusDiv = document.getElementById('playlistStatus');

    // Validate duration
    if (!duration || duration < 1 || duration > 300) {
        showToast('Please enter a valid duration (1-300 minutes)', 'warning');
        return;
    }

    statusDiv.textContent = '⏳ Generating playlist from filtered tracks...';
    statusDiv.style.color = 'var(--accent-color)';
    statusDiv.style.display = 'block';
    
    // Ensure filters and builder are expanded when generating
    if (!filtersAndBuilderExpanded) {
        toggleFiltersAndBuilder();
    }

    try {
        // Generate playlist using filtered tracks
        const response = await fetch('/library/generate_smart_playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                duration: duration,
                energy_curve: energyCurve,
                start_key: startKey,
                mood: mood,
                tracks: currentLibraryTracks // Pass filtered tracks directly
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
            statusDiv.textContent = `✅ ${data.message}`;
            statusDiv.style.color = '#4ade80';
            statusDiv.style.display = 'block';
            showToast(`Generated playlist with ${data.count} tracks from ${currentLibraryTracks.length} filtered tracks`, 'success');

            // Store current playlist
            currentPlaylistTracks = data.tracks || [];
            
            // Display the generated playlist in the playlist table
            document.getElementById('playlistCount').innerText = data.count;
            renderPlaylistTable(currentPlaylistTracks);
        } else {
            statusDiv.textContent = `❌ Error: ${data.error}`;
            statusDiv.style.color = '#f87171';
            showToast(`Failed to generate playlist: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Playlist generation error:', error);
        statusDiv.textContent = `❌ Error: ${error.message}`;
        statusDiv.style.color = '#f87171';
        showToast(`Failed to generate playlist: ${error.message}`, 'error');
    }
}

// Library Management Functions
async function loadLibraryStatistics() {
    try {
        const response = await fetch('/library/statistics', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.success) {
            updateLibraryStats(data);
        }
    } catch (error) {
        console.error('Error loading library statistics:', error);
    }
}

function updateLibraryStats(stats) {
    document.getElementById('statTotalTracks').textContent = stats.total_tracks || 0;
    document.getElementById('statHealthScore').textContent = `${stats.health_score || 0}%`;
    document.getElementById('statMissingFiles').textContent = stats.missing_files || 0;
    document.getElementById('statIncomplete').textContent = stats.incomplete_metadata || 0;
    
    // Update health score color
    const healthScoreEl = document.getElementById('statHealthScore');
    const score = stats.health_score || 0;
    if (score >= 80) {
        healthScoreEl.style.color = '#4ade80';
    } else if (score >= 60) {
        healthScoreEl.style.color = '#fbbf24';
    } else {
        healthScoreEl.style.color = '#f87171';
    }
    
    // Update coverage grid
    const coverageGrid = document.getElementById('coverageGrid');
    if (stats.coverage) {
        coverageGrid.innerHTML = Object.entries(stats.coverage).map(([key, value]) => `
            <div class="coverage-item">
                <div class="coverage-label">${key.toUpperCase()}</div>
                <div class="coverage-bar">
                    <div class="coverage-fill" style="width: ${value}%"></div>
                </div>
                <div class="coverage-value">${value}%</div>
            </div>
        `).join('');
    }
}

function showLibraryStats() {
    const statsSection = document.getElementById('libraryStatsSection');
    if (statsSection) {
        statsSection.style.display = 'block';
        loadLibraryStatistics(); // Load stats when showing
    }
}

function toggleLibraryStats() {
    const statsSection = document.getElementById('libraryStatsSection');
    if (statsSection) {
        statsSection.style.display = statsSection.style.display === 'none' ? 'block' : 'none';
        if (statsSection.style.display === 'block') {
            loadLibraryStatistics(); // Load stats when showing
        }
    }
}

async function checkLibraryHealth() {
    try {
        const response = await fetch('/library/health', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.success) {
            // Show stats section if hidden
            showLibraryStats();
            
            let message = `Health Check Complete:\n\n`;
            message += `Total Issues: ${data.issues_found}\n`;
            message += `Missing Files: ${data.missing_files.length}\n`;
            message += `Incomplete Tracks: ${data.incomplete_tracks.length}\n`;
            message += `Duplicates: ${Object.keys(data.duplicates).length}\n\n`;
            message += `Health Score: ${data.statistics.health_score}%`;
            
            if (data.issues_found > 0) {
                message += `\n\nUse cleanup functions to fix issues.`;
            }
            
            alert(message);
            loadLibraryStatistics(); // Refresh stats
        } else {
            showToast(`Health check failed: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Error checking library health:', error);
        showToast(`Failed to check health: ${error.message}`, 'error');
    }
}

async function cleanupOrphans(dryRun = true) {
    if (!dryRun && !confirm('Are you sure you want to remove orphaned tracks? This cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch('/library/cleanup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dry_run: dryRun })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.success) {
            if (dryRun) {
                if (data.removed_count > 0) {
                    const proceed = confirm(`Found ${data.removed_count} orphaned tracks.\n\nClick OK to remove them, or Cancel to keep them.`);
                    if (proceed) {
                        cleanupOrphans(false);
                    }
                } else {
                    showToast('No orphaned tracks found!', 'success');
                }
            } else {
                showToast(`Removed ${data.removed_count} orphaned tracks`, 'success');
                loadLibraryStatistics();
                loadLibrary(); // Refresh library view
            }
        } else {
            showToast(`Cleanup failed: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Error cleaning up orphans:', error);
        showToast(`Failed to cleanup: ${error.message}`, 'error');
    }
}

async function removeDuplicates(dryRun = true) {
    if (!dryRun && !confirm('Are you sure you want to remove duplicate tracks? This cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch('/library/remove_duplicates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dry_run: dryRun })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.success) {
            if (dryRun) {
                if (data.duplicate_count > 0) {
                    const proceed = confirm(`Found ${data.duplicate_count} duplicate tracks.\n\nClick OK to remove them, or Cancel to keep them.`);
                    if (proceed) {
                        removeDuplicates(false);
                    }
                } else {
                    showToast('No duplicate tracks found!', 'success');
                }
            } else {
                showToast(`Removed ${data.duplicate_count} duplicate tracks`, 'success');
                loadLibraryStatistics();
                loadLibrary(); // Refresh library view
            }
        } else {
            showToast(`Remove duplicates failed: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Error removing duplicates:', error);
        showToast(`Failed to remove duplicates: ${error.message}`, 'error');
    }
}

// Initialize dual-range sliders when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDualRangeSliders);
} else {
    initDualRangeSliders();
}
