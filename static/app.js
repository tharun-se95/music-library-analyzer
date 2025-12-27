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
    const activityIndicator = document.getElementById('activityIndicator');
    if (activityIndicator) {
        activityIndicator.style.background = '#10b981';
    }
};

ws.onerror = function (error) {
    console.error('WebSocket error:', error);
    showToast('WebSocket connection error. Please refresh the page.', 'error');
};

ws.onclose = function () {
    console.log('WebSocket disconnected');
    const activityIndicator = document.getElementById('activityIndicator');
    if (activityIndicator) {
        activityIndicator.style.background = '#ef4444';
    }
    showToast('Lost connection to server. Please refresh the page.', 'warning');
};

ws.onmessage = function (event) {
    let data;
    try {
        data = JSON.parse(event.data);
        console.log('WebSocket message received:', data.type, data);
    } catch (e) {
        console.error('Error parsing WebSocket message:', e, event.data);
        return;
    }

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
        
        // Show browser progress bar
        const progressContainer = document.getElementById('browserProgressContainer');
        if (progressContainer) {
            progressContainer.style.display = 'block';
            document.getElementById('browserProgressStatus').textContent = 'Starting analysis...';
            document.getElementById('browserProgressCurrent').textContent = '0';
            document.getElementById('browserProgressTotal').textContent = data.total || '0';
            document.getElementById('browserProgressPercent').textContent = '0%';
            document.getElementById('browserProgressBar').style.width = '0%';
            
            // Reset stats counters
            window.analysisStats = { analyzed: 0, skipped: 0, failed: 0 };
            document.getElementById('browserProgressAnalyzed').textContent = '✓ Analyzed: 0';
            document.getElementById('browserProgressSkipped').textContent = '⊘ Skipped: 0';
            document.getElementById('browserProgressFailed').textContent = '✗ Failed: 0';
        }
        
        // Initialize stats tracking
        window.analysisStats = {
            analyzed: 0,
            skipped: 0,
            failed: 0
        };
    }

    else if (data.type === 'analyzing' || data.type === 'processing') {
        // Update browser file row progress
        const browserRow = browserFileRows.get(data.path);
        if (browserRow) {
            const statusSpan = browserRow.querySelector('.file-status');
            if (statusSpan) {
                statusSpan.textContent = '⏳ Analyzing...';
                statusSpan.style.color = 'var(--accent-color)';
            }
        }
        
        // Update old analyzer table if it exists
        const row = fileRows.get(data.path);
        if (row) {
            updateRowStatus(row, 'analyzing');
        }
        
        // Update counters if available
        if (data.current !== undefined && data.total !== undefined) {
            const processedEl = document.getElementById('processedCount');
            const totalEl = document.getElementById('totalCount');
            if (processedEl) processedEl.innerText = data.current;
            if (totalEl) totalEl.innerText = data.total;
            
            if (statusText) statusText.textContent = 'Analyzing...';
            if (currentFile) {
                currentFile.style.display = 'block';
                if (currentFilename) currentFilename.textContent = data.filename || '';
            }
            
            const progress = (data.current / data.total) * 100;
            if (progressBarFill) progressBarFill.style.width = `${progress}%`;
            
            // Update browser progress bar
            const progressContainer = document.getElementById('browserProgressContainer');
            if (progressContainer) {
                progressContainer.style.display = 'block';
                const progressPercent = Math.round(progress);
                document.getElementById('browserProgressStatus').textContent = `Analyzing: ${data.filename || 'Processing...'}`;
                document.getElementById('browserProgressCurrent').textContent = data.current;
                document.getElementById('browserProgressTotal').textContent = data.total;
                document.getElementById('browserProgressPercent').textContent = `${progressPercent}%`;
                document.getElementById('browserProgressBar').style.width = `${progressPercent}%`;
            }
        }
    }

    else if (data.type === 'file_done') {
        // Update stats counters
        if (!window.analysisStats) {
            window.analysisStats = { analyzed: 0, skipped: 0, failed: 0 };
        }
        
        if (data.status && data.status.includes('Skipped')) {
            window.analysisStats.skipped++;
            const skippedEl = document.getElementById('browserProgressSkipped');
            if (skippedEl) skippedEl.textContent = `⊘ Skipped: ${window.analysisStats.skipped}`;
        } else if (data.status && data.status.includes('Failed')) {
            window.analysisStats.failed++;
            const failedEl = document.getElementById('browserProgressFailed');
            if (failedEl) failedEl.textContent = `✗ Failed: ${window.analysisStats.failed}`;
        } else if (data.tags && Object.keys(data.tags).length > 0) {
            window.analysisStats.analyzed++;
            const analyzedEl = document.getElementById('browserProgressAnalyzed');
            if (analyzedEl) analyzedEl.textContent = `✓ Analyzed: ${window.analysisStats.analyzed}`;
        }
        
        // Update browser file row with analysis data
        const browserRow = browserFileRows.get(data.path);
        if (browserRow) {
            const statusSpan = browserRow.querySelector('.file-status');
            if (statusSpan) {
                if (data.status && data.status.includes('Skipped')) {
                    statusSpan.textContent = '⊘ Skipped';
                    statusSpan.style.color = 'var(--text-secondary)';
                } else if (data.status && data.status.includes('Failed')) {
                    statusSpan.textContent = '✗ Failed';
                    statusSpan.style.color = '#ef4444';
                } else if (data.tags && Object.keys(data.tags).length > 0) {
                    // Update table cells with analysis data
                    const cells = browserRow.querySelectorAll('td');
                    if (cells.length >= 8) {
                        // BPM cell (index 3)
                        if (data.tags.bpm) {
                            cells[3].textContent = Math.round(data.tags.bpm);
                        }
                        // Key cell (index 4)
                        if (data.tags.key) {
                            cells[4].textContent = data.tags.key;
                        }
                        // Energy cell (index 5)
                        if (data.tags.energy !== undefined) {
                            cells[5].textContent = Math.round(data.tags.energy);
                        }
                        // Duration cell (index 6) - if available
                        if (data.tags.duration) {
                            const minutes = Math.floor(data.tags.duration / 60);
                            const seconds = Math.floor(data.tags.duration % 60);
                            cells[6].textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
                        }
                    }
                    statusSpan.textContent = '✓ Done';
                    statusSpan.style.color = '#10b981';
                    
                    // Update analysis data display (always exists, just update it)
                    const analysisDiv = browserRow.querySelector('.analysis-data');
                    if (analysisDiv) {
                        const bpm = data.tags.bpm ? `BPM: ${data.tags.bpm}` : '';
                        const key = data.tags.key ? `Key: ${data.tags.key}` : '';
                        const energy = data.tags.energy !== undefined ? `Energy: ${Math.round(data.tags.energy)}` : '';
                        analysisDiv.innerHTML = [bpm, key, energy].filter(Boolean).join(' | ');
                    }
                } else {
                    statusSpan.textContent = '✓ Done';
                    statusSpan.style.color = '#10b981';
                }
            }
        }
        
        // Update old analyzer table if it exists
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
            if (progressBarFill) progressBarFill.style.width = `${progress}%`;
            
            // Update browser progress bar
            const progressContainer = document.getElementById('browserProgressContainer');
            if (progressContainer) {
                const progressPercent = Math.round(progress);
                document.getElementById('browserProgressCurrent').textContent = data.current;
                document.getElementById('browserProgressTotal').textContent = data.total;
                document.getElementById('browserProgressPercent').textContent = `${progressPercent}%`;
                document.getElementById('browserProgressBar').style.width = `${progressPercent}%`;
            }
        }

        // Update current status
        const current = parseInt(document.getElementById('processedCount')?.innerText || '0') || 0;
        const total = parseInt(document.getElementById('totalCount')?.innerText || '0') || 0;

        if (current >= total && total > 0) {
            if (statusText) statusText.textContent = 'Complete';
            if (currentFile) currentFile.style.display = 'none';
            if (progressBarFill) progressBarFill.style.width = '100%';
            
            // Update browser progress to 100%
            const progressContainer = document.getElementById('browserProgressContainer');
            if (progressContainer) {
                document.getElementById('browserProgressStatus').textContent = 'Analysis complete!';
                document.getElementById('browserProgressPercent').textContent = '100%';
                document.getElementById('browserProgressBar').style.width = '100%';
            }
        } else {
            if (statusText) statusText.textContent = 'Analyzing...';
        }
    }

    else if (data.type === 'complete') {
        document.getElementById('activityIndicator').style.background = '#10b981';
        if (scanBtn) scanBtn.disabled = false;
        if (stopBtn) stopBtn.style.display = 'none';
        if (activityIndicator) activityIndicator.classList.remove('active');
        if (statusText) statusText.textContent = 'Ready';
        if (currentFile) currentFile.style.display = 'none';
        showToast('Analysis complete!', 'success');
        
        // Re-enable analyze button
        const analyzeBtn = document.getElementById('analyzeSelectedBtn');
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = '⚡ Analyze Selected';
        }
        
        // Update browser progress bar
        const progressContainer = document.getElementById('browserProgressContainer');
        if (progressContainer) {
            const stats = window.analysisStats || { analyzed: 0, skipped: 0, failed: 0 };
            const summary = `Complete: ${stats.analyzed} analyzed, ${stats.skipped} skipped, ${stats.failed} failed`;
            document.getElementById('browserProgressStatus').textContent = summary;
            document.getElementById('browserProgressPercent').textContent = '100%';
            document.getElementById('browserProgressBar').style.width = '100%';
            document.getElementById('browserProgressBar').style.background = '#10b981';
            
            // Show completion message
            if (stats.skipped > 0) {
                showToast(`Analysis complete! ${stats.analyzed} analyzed, ${stats.skipped} skipped. Check "Force Re-analyze" to re-analyze skipped files.`, 'info', 5000);
            } else {
                showToast(`Analysis complete! ${stats.analyzed} files analyzed.`, 'success');
            }
            
            // Hide progress bar after 5 seconds
            setTimeout(() => {
                progressContainer.style.display = 'none';
                document.getElementById('browserProgressBar').style.background = 'var(--accent-color)';
            }, 5000);
        }
        
        // Refresh browser tree when analysis completes
        if (document.getElementById('analyzer-tab').classList.contains('active')) {
            setTimeout(() => {
                loadBrowserTree();
                // Reload current folder to show updated analysis data
                const currentTitle = document.getElementById('browserFilePanelTitle').textContent;
                if (currentTitle && currentTitle !== 'Select a folder or playlist') {
                    // Try to reload the current folder
                    const treeItems = document.querySelectorAll('.tree-item.active');
                    if (treeItems.length > 0) {
                        const activeItem = treeItems[0];
                        const path = activeItem.dataset.path;
                        const type = activeItem.dataset.type;
                        if (path) {
                            setTimeout(() => loadBrowserFiles(path, type), 1000);
                        }
                    }
                }
            }, 500);
        }
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

// Close modals if clicked outside
window.onclick = function (event) {
    const fileBrowserModal = document.getElementById('fileBrowserModal');
    const importFolderModal = document.getElementById('importFolderModal');
    const createPlaylistModal = document.getElementById('createPlaylistModal');
    
    if (event.target == fileBrowserModal) {
        closeFileBrowser();
    }
    if (event.target == importFolderModal) {
        closeImportFolderDialog();
    }
    if (event.target == createPlaylistModal) {
        closeCreatePlaylistDialog();
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
        row.querySelector('.col-energy').textContent = Math.round(tags.energy);
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

        switch (column) {
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
        const energy = track.energy !== undefined ? Math.round(track.energy) : '-';
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
    const grid = document.getElementById('playlistsGrid');
    if (!grid) return;

    grid.innerHTML = '<div class="playlist-empty-state">Loading playlists...</div>';

    try {
        const response = await fetch('/library/playlists', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        savedPlaylistsData = data.playlists || [];

        if (savedPlaylistsData.length === 0) {
            grid.innerHTML = '<div class="playlist-empty-state">No saved playlists yet. Generate and save playlists from the Libraries tab.</div>';
            return;
        }

        renderPlaylistCards(savedPlaylistsData);

    } catch (error) {
        console.error('Error loading playlists:', error);
        grid.innerHTML = '<div class="playlist-empty-state" style="color: #f87171;">Error loading playlists: ' + error.message + '</div>';
    }
}

function renderPlaylistCards(playlists) {
    const grid = document.getElementById('playlistsGrid');
    if (!grid) return;

    grid.innerHTML = playlists.map(playlist => {
        const date = new Date(playlist.created || Date.now());
        const formattedDate = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

        // Use album art if available, otherwise use default playlist image
        const albumArtUrl = playlist.album_art || getDefaultPlaylistImage(playlist.name);

        // Format duration
        const durationHours = Math.floor((playlist.duration_minutes || 0) / 60);
        const durationMins = Math.round((playlist.duration_minutes || 0) % 60);
        let durationText = '';
        if (durationHours > 0) {
            durationText = `${durationHours}h ${durationMins}m`;
        } else {
            durationText = `${durationMins}m`;
        }

        // Prepare overlay content (artists, styles, genres)
        const allArtists = playlist.artists || [];
        const artistList = allArtists.map(artist => escapeHtml(artist)).join(', ');
        const genres = playlist.genres || [];
        const genreChips = genres.map(genre =>
            `<span class="overlay-genre-chip">${escapeHtml(genre)}</span>`
        ).join('');

        return `
            <div class="playlist-card" onclick="loadPlaylist('${escapeHtml(playlist.id)}')">
                <div class="playlist-card-image">
                    <img src="${albumArtUrl}" alt="${escapeHtml(playlist.name)}" onerror="this.src='${getDefaultPlaylistImage(playlist.name)}'">
                    <div class="playlist-card-overlay">
                        <button class="playlist-card-action playlist-card-action-play" onclick="event.stopPropagation(); loadPlaylist('${escapeHtml(playlist.id)}')" title="Load Playlist">
                            ▶
                        </button>
                        <button class="playlist-card-action playlist-card-action-delete" onclick="event.stopPropagation(); deletePlaylist('${escapeHtml(playlist.id)}')" title="Delete Playlist">
                            ✕
                        </button>
                        <div class="playlist-overlay-details">
                            ${allArtists.length > 0 ? `
                                <div class="overlay-section">
                                    <div class="overlay-section-title">Artists</div>
                                    <div class="overlay-artists">${artistList}</div>
                                </div>
                            ` : ''}
                            ${playlist.style ? `
                                <div class="overlay-section">
                                    <div class="overlay-section-title">Style</div>
                                    <div class="overlay-style">${escapeHtml(playlist.style)}</div>
                                </div>
                            ` : ''}
                            ${genres.length > 0 ? `
                                <div class="overlay-section">
                                    <div class="overlay-section-title">Genres</div>
                                    <div class="overlay-genres">${genreChips}</div>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                </div>
                <div class="playlist-card-content">
                    <h4 class="playlist-card-title">${escapeHtml(playlist.name)}</h4>
                    <div class="playlist-card-stats">
                        <span class="playlist-stat-item">
                            <span class="playlist-stat-icon">🎵</span>
                            <span class="playlist-stat-value">${playlist.track_count || 0}</span>
                        </span>
                        <span class="playlist-stat-item">
                            <span class="playlist-stat-icon">⏱️</span>
                            <span class="playlist-stat-value">${durationText}</span>
                        </span>
                    </div>
                    <div class="playlist-card-date">${formattedDate}</div>
                </div>
            </div>
        `;
    }).join('');
}

function getDefaultPlaylistImage(playlistName) {
    // Generate a colorful gradient based on playlist name hash
    const colors = [
        ['#667eea', '#764ba2'], // Purple
        ['#f093fb', '#f5576c'], // Pink
        ['#4facfe', '#00f2fe'], // Blue
        ['#43e97b', '#38f9d7'], // Green
        ['#fa709a', '#fee140'], // Orange
        ['#30cfd0', '#330867'], // Teal
        ['#a8edea', '#fed6e3'], // Mint
        ['#ff9a9e', '#fecfef'], // Rose
    ];

    // Simple hash function
    let hash = 0;
    for (let i = 0; i < playlistName.length; i++) {
        hash = playlistName.charCodeAt(i) + ((hash << 5) - hash);
    }
    const colorIndex = Math.abs(hash) % colors.length;
    const [color1, color2] = colors[colorIndex];

    // Create SVG gradient
    return `data:image/svg+xml,${encodeURIComponent(`
        <svg width="300" height="300" xmlns="http://www.w3.org/2000/svg">
            <defs>
                <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
                    <stop offset="0%" style="stop-color:${color1};stop-opacity:1" />
                    <stop offset="100%" style="stop-color:${color2};stop-opacity:1" />
                </linearGradient>
            </defs>
            <rect width="300" height="300" fill="url(#grad)"/>
            <text x="150" y="140" font-family="Arial, sans-serif" font-size="60" fill="white" text-anchor="middle" opacity="0.3">🎵</text>
        </svg>
    `)}`;
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
            const tracks = data.tracks || [];
            
            // Store loaded playlist state
            currentLoadedPlaylist = tracks;
            originalLoadedPlaylist = JSON.parse(JSON.stringify(tracks)); // Deep copy for reset
            currentLoadedPlaylistId = playlistId;
            currentLoadedPlaylistName = data.name;
            currentPlaylistTracks = tracks; // Keep for backward compatibility

            // Update loaded playlist section
            const loadedSection = document.getElementById('loadedPlaylistSection');
            const loadedName = document.getElementById('loadedPlaylistName');

            if (loadedSection && loadedName) {
                loadedName.textContent = data.name;
                loadedSection.style.display = 'block';

                // Render tracks using the same format as generated playlist
                renderLoadedPlaylist(currentLoadedPlaylist);

                // Scroll to loaded playlist section
                loadedSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }

            // Show appropriate message based on track count
            if (tracks.length === 0) {
                showToast(`Playlist "${data.name}" is empty (0 tracks). Generate and save a playlist with tracks.`, 'warning');
            } else {
                showToast(`Playlist loaded: ${data.name} (${tracks.length} tracks)`, 'success');
                // Load playlist to audio player only if it has tracks
                loadPlaylistToPlayer(tracks, data.name);
            }
        } else {
            showToast(`Failed to load playlist: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Error loading playlist:', error);
        showToast(`Failed to load playlist: ${error.message}`, 'error');
    }
}

// Render loaded playlist (same format as generated playlist)
function renderLoadedPlaylist(playlist) {
    const previewTable = document.getElementById('loadedPlaylistTable');
    const statsEl = document.getElementById('loadedPlaylistStats');
    
    if (!previewTable) return;

    if (!playlist || playlist.length === 0) {
        previewTable.innerHTML = '<div class="empty-state">No tracks in playlist</div>';
        if (statsEl) statsEl.textContent = '';
        return;
    }

    // Calculate statistics
    const stats = calculatePlaylistStatistics(playlist);
    
    // Display statistics
    if (statsEl) {
        statsEl.innerHTML = `
            <span>${playlist.length} tracks</span> • 
            <span>${stats.totalDuration}</span> • 
            <span>Avg BPM: ${stats.avgBpm}</span> • 
            <span>Energy: ${stats.minEnergy}-${stats.maxEnergy}</span>
        `;
    }

    // Render table (same format as generated playlist)
    let tableHTML = `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <th style="padding: 0.75rem; text-align: left; color: var(--text-secondary); font-weight: 500; width: 40px;">#</th>
                    <th style="padding: 0.75rem; text-align: left; color: var(--text-secondary); font-weight: 500; width: 30px;"></th>
                    <th style="padding: 0.75rem; text-align: left; color: var(--text-secondary); font-weight: 500;">Title</th>
                    <th style="padding: 0.75rem; text-align: left; color: var(--text-secondary); font-weight: 500;">Artist</th>
                    <th style="padding: 0.75rem; text-align: center; color: var(--text-secondary); font-weight: 500; width: 60px;">BPM</th>
                    <th style="padding: 0.75rem; text-align: center; color: var(--text-secondary); font-weight: 500; width: 70px;">Key</th>
                    <th style="padding: 0.75rem; text-align: center; color: var(--text-secondary); font-weight: 500; width: 70px;">Energy</th>
                    <th style="padding: 0.75rem; text-align: center; color: var(--text-secondary); font-weight: 500; width: 80px;">Duration</th>
                    <th style="padding: 0.75rem; text-align: center; color: var(--text-secondary); font-weight: 500; width: 60px;">Actions</th>
                </tr>
            </thead>
            <tbody id="loadedPlaylistTbody">
    `;

    playlist.forEach((track, index) => {
        // Handle title - prefer title, fallback to filename, then extract from path
        let title = track.title;
        if (!title || title === 'None' || title === 'null') {
            title = track.filename;
        }
        if (!title || title === 'None' || title === 'null') {
            if (track.path) {
                title = track.path.split('/').pop().split('\\').pop();
                title = title.replace(/\.[^/.]+$/, '');
            }
        }
        if (!title || title === 'None' || title === 'null') {
            title = 'Unknown';
        }
        
        // Handle artist
        let artist = track.artist;
        if (artist && typeof artist === 'string') {
            artist = artist.trim();
        }
        if (!artist || artist === null || artist === undefined || artist === 'None' || artist === 'null' || artist === '' || String(artist).trim() === '') {
            if (track.filename) {
                const parts = track.filename.split(' - ');
                if (parts.length > 1) {
                    artist = parts[0].trim();
                }
            }
            if ((!artist || artist === '') && track.path) {
                const filename = track.path.split('/').pop().split('\\').pop();
                const parts = filename.split(' - ');
                if (parts.length > 1) {
                    artist = parts[0].trim();
                }
            }
            if (!artist || artist === '') {
                artist = 'Unknown Artist';
            }
        }
        
        const bpm = track.bpm || '-';
        const key = track.key || '-';
        const energy = track.energy !== undefined ? Math.round(track.energy) : '-';
        
        let duration = '-';
        if (track.duration) {
            const dur = parseFloat(track.duration);
            if (!isNaN(dur) && dur > 0) {
                duration = formatDuration(dur);
            }
        }
        
        // Use a unique identifier for each track (path or a combination of properties)
        // This ensures we can track tracks even after reordering
        const trackId = track.path || `${track.title || ''}_${track.artist || ''}_${index}`;
        
        tableHTML += `
            <tr class="loaded-playlist-row" draggable="true" data-index="${index}" data-track-id="${escapeHtml(trackId)}" style="border-bottom: 1px solid var(--border-color); cursor: move;">
                <td style="padding: 0.75rem; color: var(--text-secondary);">${index + 1}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary); cursor: grab;">☰</td>
                <td style="padding: 0.75rem;">${escapeHtml(title)}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${escapeHtml(artist)}</td>
                <td style="padding: 0.75rem; text-align: center;">${bpm}</td>
                <td style="padding: 0.75rem; text-align: center; font-family: monospace;">${escapeHtml(key)}</td>
                <td style="padding: 0.75rem; text-align: center;">${energy}</td>
                <td style="padding: 0.75rem; text-align: center; color: var(--text-secondary);">${duration}</td>
                <td style="padding: 0.75rem; text-align: center;">
                    <button onclick="removeTrackFromLoadedPlaylist(${index})" style="background: transparent; border: none; color: #ef4444; cursor: pointer; font-size: 1.2rem;" title="Remove">×</button>
                </td>
            </tr>
        `;
    });

    tableHTML += `
            </tbody>
        </table>
    `;

    previewTable.innerHTML = tableHTML;

    // Attach drag and drop handlers
    attachLoadedPlaylistDragHandlers();
}

// Attach drag and drop handlers for loaded playlist reordering
function attachLoadedPlaylistDragHandlers() {
    const tbody = document.getElementById('loadedPlaylistTbody');
    if (!tbody) return;

    let draggedRow = null;

    tbody.querySelectorAll('.loaded-playlist-row').forEach(row => {
        row.addEventListener('dragstart', (e) => {
            draggedRow = row;
            e.dataTransfer.effectAllowed = 'move';
            row.style.opacity = '0.5';
        });

        row.addEventListener('dragend', () => {
            if (draggedRow) draggedRow.style.opacity = '1';
            draggedRow = null;
        });

        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            const afterElement = getDragAfterElement(tbody, e.clientY);
            if (afterElement == null) {
                tbody.appendChild(draggedRow);
            } else {
                tbody.insertBefore(draggedRow, afterElement);
            }
        });

        row.addEventListener('drop', (e) => {
            e.preventDefault();
            if (draggedRow && draggedRow !== row) {
                reorderLoadedPlaylistTracks();
            }
        });
    });
}

// Reorder loaded playlist tracks based on DOM order
function reorderLoadedPlaylistTracks() {
    const tbody = document.getElementById('loadedPlaylistTbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('.loaded-playlist-row'));
    
    // Build a map of track IDs to track objects (using path as unique identifier)
    const trackMap = new Map();
    rows.forEach(row => {
        const originalIndex = parseInt(row.dataset.index);
        if (originalIndex >= 0 && originalIndex < currentLoadedPlaylist.length) {
            const track = currentLoadedPlaylist[originalIndex];
            const trackId = track.path || `${track.title || ''}_${track.artist || ''}_${originalIndex}`;
            trackMap.set(trackId, track);
        }
    });
    
    // Create new order based on current DOM order
    const newOrder = rows.map(row => {
        const trackId = row.dataset.trackId;
        return trackMap.get(trackId);
    }).filter(track => track !== undefined); // Filter out any undefined tracks

    // Only update if we got all tracks
    if (newOrder.length === currentLoadedPlaylist.length) {
        currentLoadedPlaylist = newOrder;
        console.log('[REORDER] Updated playlist order:', newOrder.length, 'tracks');
        
        // Re-render with updated order and updated data-index attributes
        renderLoadedPlaylist(currentLoadedPlaylist);
    } else {
        console.warn('[REORDER] Track count mismatch:', newOrder.length, 'vs', currentLoadedPlaylist.length);
    }
}

// Remove track from loaded playlist
function removeTrackFromLoadedPlaylist(index) {
    if (index >= 0 && index < currentLoadedPlaylist.length) {
        currentLoadedPlaylist.splice(index, 1);
        renderLoadedPlaylist(currentLoadedPlaylist);
    }
}

// Reset loaded playlist to original order
function resetLoadedPlaylist() {
    if (originalLoadedPlaylist.length === 0) {
        showToast('No original playlist to reset to.', 'warning');
        return;
    }
    
    if (currentLoadedPlaylist.length === 0) {
        showToast('No playlist to reset', 'warning');
        return;
    }
    
    // Restore original order
    currentLoadedPlaylist = JSON.parse(JSON.stringify(originalLoadedPlaylist));
    
    // Re-render
    renderLoadedPlaylist(currentLoadedPlaylist);
    
    showToast('Playlist order reset to original', 'success');
}

// Save loaded playlist changes
async function saveLoadedPlaylist() {
    if (!currentLoadedPlaylistId || !currentLoadedPlaylistName) {
        showToast('No playlist loaded to save', 'warning');
        return;
    }

    if (currentLoadedPlaylist.length === 0) {
        showToast('Cannot save empty playlist', 'warning');
        return;
    }

    // Ensure we have the latest order from DOM before saving
    const tbody = document.getElementById('loadedPlaylistTbody');
    if (tbody) {
        const rows = Array.from(tbody.querySelectorAll('.loaded-playlist-row'));
        if (rows.length > 0 && rows.length === currentLoadedPlaylist.length) {
            // Build a map of track IDs to track objects (using path as unique identifier)
            const trackMap = new Map();
            rows.forEach(row => {
                const originalIndex = parseInt(row.dataset.index);
                if (originalIndex >= 0 && originalIndex < currentLoadedPlaylist.length) {
                    const track = currentLoadedPlaylist[originalIndex];
                    const trackId = track.path || `${track.title || ''}_${track.artist || ''}_${originalIndex}`;
                    trackMap.set(trackId, track);
                }
            });
            
            // Create new order based on current DOM order
            const newOrder = rows.map(row => {
                const trackId = row.dataset.trackId;
                return trackMap.get(trackId);
            }).filter(track => track !== undefined);
            
            if (newOrder.length === currentLoadedPlaylist.length) {
                currentLoadedPlaylist = newOrder;
                console.log('[SAVE] Updated playlist order from DOM before saving:', newOrder.length, 'tracks');
            } else {
                console.warn('[SAVE] Track count mismatch:', newOrder.length, 'vs', currentLoadedPlaylist.length);
            }
        }
    }

    try {
        // Use the playlist ID as the name to ensure we update the correct file
        // The playlist ID is the filename without .json extension
        // The save endpoint will use name.replace('/', '_') to create the filename
        const payload = {
            name: currentLoadedPlaylistId, // Use ID to match the filename (without .json)
            tracks: currentLoadedPlaylist
        };

        console.log('[SAVE] Saving loaded playlist:', {
            id: currentLoadedPlaylistId,
            name: currentLoadedPlaylistName,
            trackCount: currentLoadedPlaylist.length,
            firstTrack: currentLoadedPlaylist[0] ? (currentLoadedPlaylist[0].title || currentLoadedPlaylist[0].filename || 'unknown') : 'none'
        });

        const response = await fetch('/library/save_playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.success) {
            // Update original state to current state after saving
            originalLoadedPlaylist = JSON.parse(JSON.stringify(currentLoadedPlaylist));
            showToast(`Playlist "${currentLoadedPlaylistName}" saved successfully`, 'success');
            // Refresh playlists list
            loadSavedPlaylists();
        } else {
            showToast(`Failed to save playlist: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Error saving loaded playlist:', error);
        showToast(`Failed to save playlist: ${error.message}`, 'error');
    }
}

// Close loaded playlist section
function closeLoadedPlaylist() {
    const loadedSection = document.getElementById('loadedPlaylistSection');
    if (loadedSection) {
        loadedSection.style.display = 'none';
    }
    // Clear state
    currentLoadedPlaylist = [];
    originalLoadedPlaylist = [];
    currentLoadedPlaylistId = null;
    currentLoadedPlaylistName = null;
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

            // Stop player if deleted playlist is currently playing
            if (audioPlayer.currentPlaylistName && savedPlaylistsData.find(p => p.id === playlistId && p.name === audioPlayer.currentPlaylistName)) {
                if (audioPlayer.audio) {
                    audioPlayer.audio.pause();
                    audioPlayer.audio.src = '';
                }
                audioPlayer.playlist = [];
                audioPlayer.currentIndex = -1;
                const player = document.getElementById('audioPlayer');
                if (player) {
                    player.style.display = 'none';
                    document.body.style.paddingBottom = '0';
                }
                // Close playlist section if open
                const collapsible = document.getElementById('playerPlaylistCollapsible');
                const section = document.querySelector('.audio-player-playlist-section');
                if (collapsible) collapsible.style.display = 'none';
                if (section) section.classList.remove('expanded');
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
                                if (energyCell) energyCell.textContent = Math.round(tags.energy);
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

function switchTab(tabName, event) {
    // Update URL hash for routing (this will trigger handleHashChange)
    if (window.location.hash.slice(1) !== tabName) {
        window.location.hash = tabName;
    } else {
        // If hash is already correct, just update UI directly
        updateTabUI(tabName, event);
    }
}

function updateTabUI(tabName, event) {
    // Update Buttons
    document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
    if (event && event.target) {
        event.target.classList.add('active');
    } else {
        // Fallback: find button by text content
        document.querySelectorAll('.nav-btn').forEach(btn => {
            if (btn.textContent.includes('Home') && tabName === 'home') btn.classList.add('active');
            if (btn.textContent.includes('Analyzer') && tabName === 'analyzer') btn.classList.add('active');
            if (btn.textContent.includes('Libraries') && tabName === 'library') btn.classList.add('active');
            if (btn.textContent.includes('Playlists') && tabName === 'playlists') btn.classList.add('active');
            if (btn.textContent.includes('Spotify') && tabName === 'spotify') btn.classList.add('active'); // Added for Spotify tab
        });
    }

    // Update Content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
    const tabId = `${tabName}-tab`;
    const tabElement = document.getElementById(tabId);
    if (tabElement) {
        tabElement.classList.add('active');
    }

    // Load browser when switching to Analyzer tab
    if (tabName === 'analyzer') {
        console.log('[BROWSER] Analyzer tab activated in updateTabUI');
        loadBrowserTree().catch(err => {
            console.error('[BROWSER] Error loading browser tree:', err);
        });
        // Restore analysis progress state if available
        restoreAnalysisProgress();
    }

    // Load saved playlists and folders when switching to Playlists tab
    if (tabName === 'playlists') {
        loadSavedPlaylists();
        loadFolders();
        initializePlaylistGenerator();
    } else if (tabName === 'analyzer') {
        // Initialize browser when analyzer tab is activated
        console.log('[BROWSER] Analyzer tab activated, initializing browser...');
        setTimeout(() => {
            initializeBrowserOnLoad();
        }, 100);
    }
}

// Initialize browser tree on page load if analyzer tab is active
function initializeBrowserOnLoad() {
    console.log('[BROWSER] Initializing browser on load...');
    // Check if we're on the analyzer tab
    const analyzerTab = document.getElementById('analyzer-tab');
    console.log('[BROWSER] Analyzer tab found:', !!analyzerTab, 'Active:', analyzerTab?.classList.contains('active'));
    
    if (analyzerTab && analyzerTab.classList.contains('active')) {
        console.log('[BROWSER] Loading browser tree...');
        // Load browser tree first (non-blocking)
        loadBrowserTree().catch(err => {
            console.error('[BROWSER] Error loading browser tree:', err);
        });
        // Restore analysis progress state (already non-blocking)
        restoreAnalysisProgress();
    } else {
        console.log('[BROWSER] Analyzer tab not active, skipping initialization');
    }
}

// Restore analysis progress state from current view
async function restoreAnalysisProgress() {
    try {
        // Restore current browser path/type from localStorage
        const savedPath = localStorage.getItem('currentBrowserPath');
        const savedType = localStorage.getItem('currentBrowserType') || 'folder';
        
        if (savedPath) {
            window.currentBrowserPath = savedPath;
            window.currentBrowserType = savedType;
            // Reload files to restore their status (non-blocking)
            // Use setTimeout to avoid blocking UI
            setTimeout(() => {
                loadBrowserFiles(savedPath, savedType).catch(err => {
                    console.error('Error restoring browser files:', err);
                });
            }, 100);
        }
        
        // Check if there are any tracks with 'analyzing' status
        // This would indicate an interrupted analysis
        const progressContainer = document.getElementById('browserProgressContainer');
        if (progressContainer) {
            // Hide progress bar if no active analysis
            // (We could check database for active analysis, but for now just hide it)
            progressContainer.style.display = 'none';
        }
    } catch (error) {
        console.error('Error restoring analysis progress:', error);
    }
}

// Handle URL hash changes (for browser back/forward and refresh)
function handleHashChange() {
    const hash = window.location.hash.slice(1) || 'analyzer'; // Default to 'analyzer' if no hash
    const validTabs = ['analyzer', 'playlists'];

    if (validTabs.includes(hash)) {
        // Use updateTabUI to avoid triggering hash change again
        updateTabUI(hash, null);
    }
}

// Initialize routing on page load
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => {
        console.log('[BROWSER] DOMContentLoaded fired');
        // Check if there's a hash in the URL
        if (window.location.hash) {
            handleHashChange();
        } else {
            // Default to analyzer page
            window.location.hash = 'analyzer';
            handleHashChange();
        }
        // Initialize browser tree after tab is set (with delay to avoid blocking UI)
        setTimeout(() => {
            console.log('[BROWSER] Calling initializeBrowserOnLoad after DOMContentLoaded');
            initializeBrowserOnLoad();
        }, 200);
    });
} else {
    // DOM already loaded
    console.log('[BROWSER] DOM already loaded');
    if (window.location.hash) {
        handleHashChange();
    } else {
        // Default to analyzer page
        window.location.hash = 'analyzer';
        handleHashChange();
    }
    // Initialize browser tree after tab is set
    setTimeout(() => {
        console.log('[BROWSER] Calling initializeBrowserOnLoad (DOM already loaded)');
        initializeBrowserOnLoad();
    }, 100);
}

// Listen for hash changes (browser back/forward)
window.addEventListener('hashchange', handleHashChange);

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
        tbody.innerHTML = '<tr><td colspan="12" class="empty-state">No tracks found in library</td></tr>';
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

        // Format analyzed date/time
        let analyzedDisplay = '-';
        let analyzedTitle = '';
        if (track.analyzed_at) {
            try {
                const analyzedDate = new Date(track.analyzed_at);
                // Format as: "Dec 25, 2025 3:39 PM"
                analyzedDisplay = analyzedDate.toLocaleDateString('en-US', { 
                    month: 'short', 
                    day: 'numeric', 
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    hour12: true
                });
                // Full timestamp for tooltip
                analyzedTitle = analyzedDate.toLocaleString('en-US', {
                    month: 'long',
                    day: 'numeric',
                    year: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            } catch (e) {
                analyzedDisplay = track.analyzed_at;
            }
        }

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
            <td class="col-energy">${hasEnergy ? Math.round(track.energy) : '-'}</td>
            <td class="col-mood" title="${escapeHtml(mood)}">${escapeHtml(moodDisplay)}</td>
            <td class="col-genre" title="${escapeHtml(genre)}">${escapeHtml(genreDisplay)}</td>
            <td class="col-popularity">${track.popularity !== undefined ? track.popularity : '-'}</td>
            <td class="col-analyzed" title="${analyzedTitle || '-'}">${escapeHtml(analyzedDisplay)}</td>
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

        switch (column) {
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
            case 'popularity':
                aVal = parseFloat(a.popularity) || 0;
                bVal = parseFloat(b.popularity) || 0;
                break;
            case 'analyzed_at':
                aVal = a.analyzed_at ? new Date(a.analyzed_at).getTime() : 0;
                bVal = b.analyzed_at ? new Date(b.analyzed_at).getTime() : 0;
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
        alert("Please select a directory in the Analyzer first.");
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
        energy_min: energyMin && energyMin !== '0' ? parseFloat(energyMin) : null,
        energy_max: energyMax && energyMax !== '100' ? parseFloat(energyMax) : null,
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
            const min = parseInt(energyMin.value) || 0;
            const max = parseInt(energyMax.value) || 100;
            const displayElement = document.getElementById('energyRangeDisplay');
            if (displayElement) {
                displayElement.textContent = `${min} - ${max}`;
            }

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
        // Initialize display immediately
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
async function exportM3U() {
    // Use audio player playlist if available, otherwise use currentPlaylistTracks
    const tracks = audioPlayer.playlist && audioPlayer.playlist.length > 0
        ? audioPlayer.playlist
        : currentPlaylistTracks;

    if (!tracks || tracks.length === 0) {
        showToast('No playlist to export. Load a playlist first.', 'warning');
        return;
    }

    try {
        const response = await fetch('/library/export/m3u', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracks: tracks })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        showToast(`M3U playlist exported to: ${data.path}`, 'success', 6000);
    } catch (error) {
        console.error('Export error:', error);
        showToast(`Failed to export M3U: ${error.message}`, 'error');
    }
}

/**
 * Export library to Rekordbox XML
 */
async function exportRekordbox() {
    // Use audio player playlist if available, otherwise use currentPlaylistTracks
    const tracks = audioPlayer.playlist && audioPlayer.playlist.length > 0
        ? audioPlayer.playlist
        : currentPlaylistTracks;

    if (!tracks || tracks.length === 0) {
        showToast('No playlist to export. Load a playlist first.', 'warning');
        return;
    }

    try {
        const response = await fetch('/library/export/rekordbox', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracks: tracks })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        showToast(`Rekordbox XML exported to: ${data.path}`, 'success', 6000);
    } catch (error) {
        console.error('Export error:', error);
        showToast(`Failed to export Rekordbox XML: ${error.message}`, 'error');
    }
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

async function clearAllData() {
    const clearPlaylists = confirm('Clear playlists as well?');
    const clearExports = confirm('Clear exported files as well?');
    
    const confirmMessage = `⚠️ WARNING: This will permanently delete ALL library data${clearPlaylists ? ', playlists' : ''}${clearExports ? ', and exports' : ''}.\n\nThis action cannot be undone!\n\nAre you absolutely sure?`;
    
    if (!confirm(confirmMessage)) {
        return;
    }
    
    // Double confirmation
    if (!confirm('FINAL CONFIRMATION: Delete everything? This is your last chance to cancel.')) {
        return;
    }
    
    try {
        const response = await fetch('/library/clear_all', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                confirm: true,
                clear_playlists: clearPlaylists,
                clear_exports: clearExports
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast('All data cleared successfully', 'success');
            // Reload library to show empty state
            loadLibrary();
            // Reload playlists if they were cleared
            if (clearPlaylists) {
                loadSavedPlaylists();
            }
        } else {
            showToast(`Failed to clear data: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Error clearing data:', error);
        showToast(`Failed to clear data: ${error.message}`, 'error');
    }
}

async function organizeByFolders() {
    try {
        const response = await fetch('/library/organize/folders', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        if (data.success) {
            const folders = data.folders;
            const folderCount = data.folder_count;
            
            // Create a display of folder organization
            let message = `📁 Library organized by ${folderCount} folders:\n\n`;
            
            // Sort folders by track count (descending)
            const sortedFolders = Object.values(folders).sort((a, b) => b.track_count - a.track_count);
            
            sortedFolders.slice(0, 10).forEach(folder => {
                const displayPath = folder.path.length > 60 ? '...' + folder.path.slice(-57) : folder.path;
                message += `📂 ${displayPath}\n   ${folder.track_count} tracks\n\n`;
            });
            
            if (sortedFolders.length > 10) {
                message += `... and ${sortedFolders.length - 10} more folders`;
            }
            
            alert(message);
            showToast(`Organized by ${folderCount} folders`, 'success');
        } else {
            showToast(`Failed to organize: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Error organizing by folders:', error);
        showToast(`Failed to organize: ${error.message}`, 'error');
    }
}

async function organizeByPlaylists() {
    try {
        const response = await fetch('/library/organize/playlists', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        if (data.success) {
            const playlists = data.playlists;
            const playlistCount = data.playlist_count;
            
            if (playlistCount === 0) {
                alert('No playlists found. Create some playlists first!');
                return;
            }
            
            // Create a display of playlist organization
            let message = `🎵 Library organized by ${playlistCount} playlists:\n\n`;
            
            // Sort playlists by track count (descending)
            const sortedPlaylists = Object.values(playlists).sort((a, b) => b.track_count - a.track_count);
            
            sortedPlaylists.forEach(playlist => {
                message += `🎧 ${playlist.name}\n   ${playlist.track_count} tracks\n\n`;
            });
            
            alert(message);
            showToast(`Organized by ${playlistCount} playlists`, 'success');
        } else {
            showToast(`Failed to organize: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Error organizing by playlists:', error);
        showToast(`Failed to organize: ${error.message}`, 'error');
    }
}

// Folder Management Functions
let importFolderCurrentPath = '/';

async function loadFolders() {
    const grid = document.getElementById('foldersGrid');
    if (!grid) return;

    grid.innerHTML = '<div class="playlist-empty-state">Loading folders...</div>';

    try {
        const response = await fetch('/library/organize/folders', {
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (data.success) {
            const folders = data.folders;
            const folderCount = data.folder_count;

            if (folderCount === 0) {
                grid.innerHTML = '<div class="playlist-empty-state">No folders imported yet. Click "Import Folder" to get started.</div>';
                return;
            }

            renderFolderCards(Object.values(folders));
        } else {
            grid.innerHTML = '<div class="playlist-empty-state" style="color: #f87171;">Error loading folders: ' + data.error + '</div>';
        }
    } catch (error) {
        console.error('Error loading folders:', error);
        grid.innerHTML = '<div class="playlist-empty-state" style="color: #f87171;">Error loading folders: ' + error.message + '</div>';
    }
}

function renderFolderCards(folders) {
    const grid = document.getElementById('foldersGrid');
    if (!grid) return;

    // Sort folders by track count (descending)
    const sortedFolders = folders.sort((a, b) => b.track_count - a.track_count);

    grid.innerHTML = sortedFolders.map(folder => {
        const displayPath = folder.path.length > 50 ? '...' + folder.path.slice(-47) : folder.path;
        const folderName = folder.path.split('/').pop() || folder.path;

        return `
            <div class="folder-card" style="background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 8px; padding: 1rem; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s;" 
                 onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 12px rgba(0,0,0,0.3)'"
                 onmouseout="this.style.transform=''; this.style.boxShadow=''"
                 onclick="viewFolderTracks('${folder.path.replace(/'/g, "\\'")}')">
                <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 0.75rem;">
                    <div style="font-size: 2rem;">📁</div>
                    <div style="flex: 1;">
                        <h4 style="margin: 0; color: var(--text-primary); font-size: 1rem; font-weight: 600;">${escapeHtml(folderName)}</h4>
                        <p style="margin: 0.25rem 0 0 0; color: var(--text-secondary); font-size: 0.875rem; word-break: break-all;">${escapeHtml(displayPath)}</p>
                    </div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; padding-top: 0.75rem; border-top: 1px solid var(--border-color);">
                    <div style="color: var(--accent-color); font-weight: 600;">${folder.track_count} tracks</div>
                    <button class="secondary-btn" style="padding: 0.25rem 0.75rem; font-size: 0.875rem;" 
                            onclick="event.stopPropagation(); analyzeFolder('${folder.path.replace(/'/g, "\\'")}')">
                        🔄 Re-analyze
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

function showImportFolderDialog() {
    const modal = document.getElementById('importFolderModal');
    if (modal) {
        modal.style.display = 'block';
        importFolderCurrentPath = '/';
        loadImportFolderDirectory('/');
    } else {
        console.error('Import folder modal not found!');
        showToast('Error: Import folder modal not found. Please refresh the page.', 'error');
    }
}

function closeImportFolderDialog() {
    const modal = document.getElementById('importFolderModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function loadImportFolderDirectory(path) {
    fetch('/browse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: path })
    })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                showToast(`Error: ${data.error}`, 'error');
                return;
            }

            importFolderCurrentPath = data.current_path;
            document.getElementById('importFolderCurrentPath').textContent = importFolderCurrentPath;

            const list = document.getElementById('importFolderFileList');
            list.innerHTML = '';

            data.items.forEach(item => {
                const div = document.createElement('div');
                div.className = `file-item ${item.type}`;
                const icon = item.type === 'directory' ? '📁' : '🎵';
                div.innerHTML = `<span>${icon}</span> ${escapeHtml(item.name)}`;

                if (item.type === 'directory') {
                    div.onclick = () => loadImportFolderDirectory(item.path);
                    div.style.cursor = 'pointer';
                } else {
                    div.style.color = 'var(--text-secondary)';
                }

                list.appendChild(div);
            });
        })
        .catch(error => {
            console.error('Error loading directory:', error);
            showToast(`Failed to load directory: ${error.message}`, 'error');
        });
}

async function importSelectedFolder() {
    if (!importFolderCurrentPath) {
        showToast('Please select a folder', 'warning');
        return;
    }

    try {
        showToast('Starting folder import and analysis...', 'info');
        closeImportFolderDialog();

        // Switch to analyzer tab
        switchTab('analyzer');
        await new Promise(resolve => setTimeout(resolve, 300));

        // Use the new analyze/selected endpoint
        const response = await fetch('/analyze/selected', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: [],
                folders: [importFolderCurrentPath],
                playlists: [],
                force: false
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast(`Started analyzing ${data.file_count} files from folder`, 'success');
            
            // Show progress bar
            const progressContainer = document.getElementById('browserProgressContainer');
            if (progressContainer) {
                progressContainer.style.display = 'block';
                document.getElementById('browserProgressStatus').textContent = 'Starting analysis...';
                document.getElementById('browserProgressCurrent').textContent = '0';
                document.getElementById('browserProgressTotal').textContent = data.file_count || '0';
                document.getElementById('browserProgressPercent').textContent = '0%';
                document.getElementById('browserProgressBar').style.width = '0%';
                
                // Reset stats counters
                window.analysisStats = { analyzed: 0, skipped: 0, failed: 0 };
                document.getElementById('browserProgressAnalyzed').textContent = '✓ Analyzed: 0';
                document.getElementById('browserProgressSkipped').textContent = '⊘ Skipped: 0';
                document.getElementById('browserProgressFailed').textContent = '✗ Failed: 0';
            }
            
            // Refresh browser tree immediately to show new folder
            loadBrowserTree();
        } else {
            showToast(`Failed to start analysis: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Error importing folder:', error);
        showToast(`Failed to import folder: ${error.message}`, 'error');
    }
}

async function analyzeFolder(folderPath) {
    if (!confirm(`Re-analyze all tracks in this folder?\n\n${folderPath}`)) {
        return;
    }

    try {
        showToast('Starting folder re-analysis...', 'info');
        
        // Switch to analyzer tab
        switchTab('analyzer');
        await new Promise(resolve => setTimeout(resolve, 500));

        // Set directory and start with force re-analyze
        const directoryInput = document.getElementById('directoryInput');
        const forceCheckbox = document.getElementById('forceReanalyze');
        
        if (directoryInput) {
            directoryInput.value = folderPath;
        }
        if (forceCheckbox) {
            forceCheckbox.checked = true;
        }

        const startBtn = document.querySelector('#analyzer-tab button[onclick*="startScan"]');
        if (startBtn) {
            startBtn.click();
        }

        showToast(`Re-analyzing folder: ${folderPath}`, 'success');
    } catch (error) {
        console.error('Error analyzing folder:', error);
        showToast(`Failed to analyze folder: ${error.message}`, 'error');
    }
}

async function viewFolderTracks(folderPath) {
    // Switch to library tab and filter by folder
    switchTab('library');
    await new Promise(resolve => setTimeout(resolve, 500));

    // Query library for tracks from this folder
    try {
        const response = await fetch('/library/query', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({})
        });

        const data = await response.json();
        if (data.tracks) {
            // Filter tracks by folder path
            const folderTracks = data.tracks.filter(track => 
                track.path && track.path.startsWith(folderPath)
            );
            renderLibraryTable(folderTracks);
            showToast(`Showing ${folderTracks.length} tracks from folder`, 'success');
        }
    } catch (error) {
        console.error('Error loading folder tracks:', error);
        showToast(`Failed to load folder tracks: ${error.message}`, 'error');
    }
}

// Playlist Creation Functions
function showCreatePlaylistDialog() {
    const modal = document.getElementById('createPlaylistModal');
    if (modal) {
        modal.style.display = 'block';
        
        // Ensure button calls createNewPlaylist (for creating empty playlists)
        const createButton = modal.querySelector('.modal-footer .primary-btn');
        if (createButton) {
            createButton.textContent = 'Create Playlist';
            createButton.setAttribute('onclick', 'createNewPlaylist()');
        }
        
        document.getElementById('newPlaylistName').value = '';
        document.getElementById('newPlaylistDescription').value = '';
        document.getElementById('newPlaylistName').focus();
    }
}

function closeCreatePlaylistDialog() {
    const modal = document.getElementById('createPlaylistModal');
    if (modal) {
        modal.style.display = 'none';
        
        // Reset button to default (createNewPlaylist)
        const createButton = modal.querySelector('.modal-footer .primary-btn');
        if (createButton) {
            createButton.textContent = 'Create Playlist';
            createButton.setAttribute('onclick', 'createNewPlaylist()');
        }
    }
}

async function createNewPlaylist() {
    const name = document.getElementById('newPlaylistName').value.trim();
    const description = document.getElementById('newPlaylistDescription').value.trim();

    if (!name) {
        showToast('Please enter a playlist name', 'warning');
        return;
    }

    try {
        // Create empty playlist
        const playlistData = {
            name: name,
            tracks: [],
            created: new Date().toISOString(),
            track_count: 0,
            description: description || ''
        };

        const response = await fetch('/library/save_playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: name,
                tracks: []
            })
        });

        const data = await response.json();

        if (data.success) {
            showToast(`Playlist "${name}" created successfully`, 'success');
            closeCreatePlaylistDialog();
            loadSavedPlaylists();
        } else {
            showToast(`Failed to create playlist: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Error creating playlist:', error);
        showToast(`Failed to create playlist: ${error.message}`, 'error');
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

// ============================================
// AUDIO PLAYER
// ============================================

let audioPlayer = {
    audio: null,
    playlist: [],
    currentIndex: -1,
    isPlaying: false,
    isShuffled: false,
    isRepeating: false,
    isMuted: false,
    volume: 1.0,
    shuffledPlaylist: [],
    currentPlaylistName: null,
    shouldAutoPlay: false
};

// Initialize audio player
function initAudioPlayer() {
    audioPlayer.audio = document.getElementById('audioElement');
    if (!audioPlayer.audio) {
        console.error('Audio element not found');
        return;
    }

    // Set preload and crossOrigin
    audioPlayer.audio.preload = 'metadata';
    audioPlayer.audio.crossOrigin = 'anonymous';

    // Event listeners
    audioPlayer.audio.addEventListener('loadedmetadata', () => {
        console.log('Audio metadata loaded');
        updateAudioPlayerTime();
    });
    audioPlayer.audio.addEventListener('timeupdate', updateAudioPlayerProgress);
    audioPlayer.audio.addEventListener('ended', audioPlayerNext);
    audioPlayer.audio.addEventListener('error', handleAudioError);
    audioPlayer.audio.addEventListener('play', () => {
        audioPlayer.isPlaying = true;
        updatePlayButton();
    });
    audioPlayer.audio.addEventListener('pause', () => {
        audioPlayer.isPlaying = false;
        updatePlayButton();
    });
    audioPlayer.audio.addEventListener('canplay', () => {
        console.log('Audio can play');
        // Auto-play when loading from playlist card
        if (audioPlayer.shouldAutoPlay) {
            audioPlayer.shouldAutoPlay = false;
            const playPromise = audioPlayer.audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    console.error('Error auto-playing audio:', err);
                    if (err.name === 'NotAllowedError') {
                        showToast('Autoplay blocked. Click play to start.', 'warning');
                    }
                });
            }
        }
    });
    audioPlayer.audio.addEventListener('canplaythrough', () => {
        console.log('Audio can play through');
    });
    audioPlayer.audio.addEventListener('loadstart', () => {
        console.log('Audio load started');
    });

    // Set initial volume
    audioPlayer.audio.volume = audioPlayer.volume;

    console.log('Audio player initialized');
}

function loadPlaylistToPlayer(tracks, playlistName) {
    if (!tracks || tracks.length === 0) {
        showToast('No tracks in playlist', 'warning');
        return;
    }

    audioPlayer.playlist = tracks;
    audioPlayer.currentIndex = 0;
    audioPlayer.shuffledPlaylist = [];
    audioPlayer.currentPlaylistName = playlistName;
    audioPlayer.shouldAutoPlay = true; // Flag to auto-play when audio is ready

    // Show player
    const player = document.getElementById('audioPlayer');
    if (player) {
        player.style.display = 'block';
        // Update body padding to account for sticky player
        if (document.body.style.paddingBottom !== '90px') {
            document.body.style.paddingBottom = '90px';
        }
        // Update playlist section and button
        renderPlaylistSection();
    }

    // Update playlist info
    const playlistInfo = document.getElementById('playerPlaylistInfo');
    const playlistNameEl = document.getElementById('playerPlaylistName');
    const trackCountEl = document.getElementById('playerTrackCount');
    const exportActions = document.getElementById('playerExportActions');

    if (playlistInfo) playlistInfo.style.display = 'flex';
    if (playlistNameEl) playlistNameEl.textContent = playlistName;
    if (trackCountEl) trackCountEl.textContent = `${tracks.length} tracks`;
    if (exportActions) exportActions.style.display = 'flex';

    // Load first track and start playing
    loadTrackToPlayer(0);

    // Start playing after a short delay to ensure audio is loaded
    setTimeout(() => {
        if (audioPlayer.audio) {
            const playPromise = audioPlayer.audio.play();
            if (playPromise !== undefined) {
                playPromise.catch(err => {
                    console.error('Error playing audio:', err);
                    if (err.name === 'NotAllowedError') {
                        showToast('Autoplay blocked. Click play to start.', 'warning');
                    } else {
                        showToast(`Error playing audio: ${err.message}`, 'error');
                    }
                });
            }
        }
    }, 100);
}

function loadTrackToPlayer(index) {
    if (index < 0 || index >= audioPlayer.playlist.length) return;

    const track = audioPlayer.playlist[index];
    audioPlayer.currentIndex = index;

    // Update playlist section if visible
    const collapsible = document.getElementById('playerPlaylistCollapsible');
    if (collapsible && collapsible.style.display !== 'none') {
        renderPlaylistSection();
    }

    if (!track.path) {
        showToast('Track path not available', 'error');
        return;
    }

    // Update UI
    updatePlayerTrackInfo(track);

    // Load audio - use backend endpoint to serve files
    if (audioPlayer.audio) {
        // Encode the file path properly - encode each segment separately
        let audioPath = track.path;

        // Remove leading slash, split, encode each segment, then join with /
        // This preserves the path structure while encoding special characters
        const pathParts = audioPath.startsWith('/')
            ? audioPath.substring(1).split('/').map(part => encodeURIComponent(part))
            : audioPath.split('/').map(part => encodeURIComponent(part));
        const encodedPath = pathParts.join('/');

        const audioUrl = `/audio/${encodedPath}`;
        console.log('Loading audio:', audioUrl);
        console.log('Original path:', track.path);

        const ext = track.path.split('.').pop().toLowerCase();
        console.log('File extension:', ext);

        // Check browser support before loading
        const mimeTypes = {
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'flac': 'audio/flac',
            'ogg': 'audio/ogg',
            'm4a': 'audio/mp4',
            'aac': 'audio/aac'
        };
        const mimeType = mimeTypes[ext] || 'audio/mpeg';
        const canPlay = audioPlayer.audio.canPlayType(mimeType);
        console.log(`Browser can play ${ext} (${mimeType}):`, canPlay);

        // Clear previous source
        audioPlayer.audio.src = '';
        audioPlayer.audio.load();

        // Set new source
        audioPlayer.audio.src = audioUrl;

        // Add error handler
        const errorHandler = (e) => {
            console.error('Audio load error:', e);
            console.error('Audio src:', audioPlayer.audio.src);
            console.error('Error code:', audioPlayer.audio.error?.code);
            console.error('Error message:', audioPlayer.audio.error?.message);

            // Try to fetch the file to check if it's accessible
            fetch(audioUrl)
                .then(async response => {
                    console.log('File GET request status:', response.status);
                    console.log('File Content-Type:', response.headers.get('Content-Type'));
                    console.log('File Content-Length:', response.headers.get('Content-Length'));

                    const contentType = response.headers.get('Content-Type');

                    if (!response.ok) {
                        // Try to get error message from JSON response
                        let errorMsg = `Server error: ${response.status} ${response.statusText}`;
                        try {
                            const errorData = await response.json();
                            if (errorData.error) {
                                errorMsg = errorData.error;
                            }
                        } catch (e) {
                            // Not JSON, use status text
                        }
                        showToast(errorMsg, 'error');
                    } else if (contentType && !contentType.startsWith('audio/')) {
                        // Server returned wrong content type - might be an error JSON
                        try {
                            const errorData = await response.json();
                            if (errorData.error) {
                                showToast(`Server error: ${errorData.error}`, 'error');
                            } else {
                                showToast(`Invalid Content-Type: ${contentType}. Expected audio/*`, 'error');
                            }
                        } catch (e) {
                            showToast(`Invalid Content-Type: ${contentType}. Expected audio/*`, 'error');
                        }
                    }
                })
                .catch(err => {
                    console.error('File GET request failed:', err);
                    showToast(`Cannot access audio file: ${err.message}`, 'error');
                });

            let errorMsg = `Error loading audio: ${track.title || track.filename}`;
            if (audioPlayer.audio.error) {
                const errorCode = audioPlayer.audio.error.code;
                if (errorCode === 4) {
                    errorMsg = `Audio format not supported. File: ${ext}`;
                    console.error('Browser audio support:', {
                        mp3: audioPlayer.audio.canPlayType('audio/mpeg'),
                        wav: audioPlayer.audio.canPlayType('audio/wav'),
                        flac: audioPlayer.audio.canPlayType('audio/flac'),
                        ogg: audioPlayer.audio.canPlayType('audio/ogg'),
                        m4a: audioPlayer.audio.canPlayType('audio/mp4')
                    });
                } else if (errorCode === 2) {
                    errorMsg = 'Network error loading audio file';
                } else if (errorCode === 3) {
                    errorMsg = 'Audio decoding error';
                }
            }
            // Don't show duplicate toast if fetch already showed one
            setTimeout(() => showToast(errorMsg, 'error'), 100);
        };

        audioPlayer.audio.addEventListener('error', errorHandler, { once: true });
        audioPlayer.audio.addEventListener('loadstart', () => console.log('Audio load started'));
        audioPlayer.audio.addEventListener('loadeddata', () => console.log('Audio data loaded'));
        audioPlayer.audio.addEventListener('canplay', () => {
            console.log('Audio can play');
            // Auto-play when loading from playlist card
            if (audioPlayer.shouldAutoPlay) {
                audioPlayer.shouldAutoPlay = false;
                const playPromise = audioPlayer.audio.play();
                if (playPromise !== undefined) {
                    playPromise.catch(err => {
                        console.error('Error auto-playing audio:', err);
                        if (err.name === 'NotAllowedError') {
                            showToast('Autoplay blocked. Click play to start.', 'warning');
                        }
                    });
                }
            }
        });

        // Load the audio
        audioPlayer.audio.load();
    }
}

function updatePlayerTrackInfo(track) {
    const titleEl = document.getElementById('playerTrackTitle');
    const artistEl = document.getElementById('playerTrackArtist');
    const albumArtEl = document.getElementById('playerAlbumArt');
    const albumArtPlaceholder = document.getElementById('playerAlbumArtPlaceholder');

    if (titleEl) titleEl.textContent = track.title || track.filename || 'Unknown Title';
    if (artistEl) artistEl.textContent = track.artist || 'Unknown Artist';

    // Update album art
    const albumArtUrl = track.album_art || track.album_art_url || track.image_url;
    if (albumArtEl && albumArtPlaceholder) {
        if (albumArtUrl) {
            albumArtEl.src = albumArtUrl;
            albumArtEl.style.display = 'block';
            albumArtPlaceholder.style.display = 'none';
        } else {
            albumArtEl.style.display = 'none';
            albumArtPlaceholder.style.display = 'block';
        }
    }
}

function audioPlayerToggle() {
    if (!audioPlayer.audio) return;

    if (audioPlayer.isPlaying) {
        audioPlayer.audio.pause();
    } else {
        if (audioPlayer.currentIndex === -1 && audioPlayer.playlist.length > 0) {
            loadTrackToPlayer(0);
        }

        const playPromise = audioPlayer.audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(err => {
                console.error('Error playing audio:', err);
                console.error('Audio src:', audioPlayer.audio.src);
                console.error('Current track:', audioPlayer.playlist[audioPlayer.currentIndex]);

                // More specific error messages
                if (err.name === 'NotAllowedError') {
                    showToast('Autoplay blocked. Click play again.', 'warning');
                } else if (err.name === 'NotSupportedError') {
                    showToast('Audio format not supported', 'error');
                } else {
                    showToast(`Error playing audio: ${err.message}`, 'error');
                }
            });
        }
    }
}

function audioPlayerNext() {
    if (audioPlayer.playlist.length === 0) return;

    let nextIndex;
    if (audioPlayer.isShuffled) {
        if (audioPlayer.shuffledPlaylist.length === 0) {
            // Create shuffled playlist
            audioPlayer.shuffledPlaylist = [...Array(audioPlayer.playlist.length).keys()];
            for (let i = audioPlayer.shuffledPlaylist.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [audioPlayer.shuffledPlaylist[i], audioPlayer.shuffledPlaylist[j]] =
                    [audioPlayer.shuffledPlaylist[j], audioPlayer.shuffledPlaylist[i]];
            }
        }
        const currentShuffledIndex = audioPlayer.shuffledPlaylist.indexOf(audioPlayer.currentIndex);
        if (currentShuffledIndex < audioPlayer.shuffledPlaylist.length - 1) {
            nextIndex = audioPlayer.shuffledPlaylist[currentShuffledIndex + 1];
        } else {
            nextIndex = audioPlayer.shuffledPlaylist[0]; // Loop back
        }
    } else {
        nextIndex = (audioPlayer.currentIndex + 1) % audioPlayer.playlist.length;
        if (nextIndex === 0 && !audioPlayer.isRepeating) {
            // End of playlist
            audioPlayer.audio.pause();
            return;
        }
    }

    loadTrackToPlayer(nextIndex);
    if (audioPlayer.isPlaying) {
        audioPlayer.audio.play();
    }
}

function audioPlayerPrevious() {
    if (audioPlayer.playlist.length === 0) return;

    let prevIndex;
    if (audioPlayer.isShuffled && audioPlayer.shuffledPlaylist.length > 0) {
        const currentShuffledIndex = audioPlayer.shuffledPlaylist.indexOf(audioPlayer.currentIndex);
        if (currentShuffledIndex > 0) {
            prevIndex = audioPlayer.shuffledPlaylist[currentShuffledIndex - 1];
        } else {
            prevIndex = audioPlayer.shuffledPlaylist[audioPlayer.shuffledPlaylist.length - 1];
        }
    } else {
        prevIndex = audioPlayer.currentIndex - 1;
        if (prevIndex < 0) {
            prevIndex = audioPlayer.playlist.length - 1;
        }
    }

    loadTrackToPlayer(prevIndex);
    if (audioPlayer.isPlaying) {
        audioPlayer.audio.play();
    }
}

function audioPlayerSeek(event) {
    if (!audioPlayer.audio) return;
    const percent = event.target.value / 100;
    audioPlayer.audio.currentTime = percent * audioPlayer.audio.duration;
}

function audioPlayerSetVolume(event) {
    const volume = event.target.value / 100;
    audioPlayer.volume = volume;
    if (audioPlayer.audio) {
        audioPlayer.audio.volume = volume;
    }
    updateMuteButton();
}

function audioPlayerToggleMute() {
    audioPlayer.isMuted = !audioPlayer.isMuted;
    if (audioPlayer.audio) {
        audioPlayer.audio.muted = audioPlayer.isMuted;
    }
    updateMuteButton();
}

function audioPlayerToggleShuffle() {
    audioPlayer.isShuffled = !audioPlayer.isShuffled;
    audioPlayer.shuffledPlaylist = []; // Reset shuffle order
    const btn = document.getElementById('playerShuffleBtn');
    if (btn) {
        btn.style.opacity = audioPlayer.isShuffled ? '1' : '0.5';
    }
}

function audioPlayerToggleRepeat() {
    audioPlayer.isRepeating = !audioPlayer.isRepeating;
    const btn = document.getElementById('playerRepeatBtn');
    if (btn) {
        btn.style.opacity = audioPlayer.isRepeating ? '1' : '0.5';
    }
}

function audioPlayerTogglePlaylistSection() {
    // Toggle collapsible playlist section
    const collapsible = document.getElementById('playerPlaylistCollapsible');
    const section = document.querySelector('.audio-player-playlist-section');

    if (!collapsible || !section) return;

    const isExpanded = collapsible.style.display !== 'none';

    if (isExpanded) {
        collapsible.style.display = 'none';
        section.classList.remove('expanded');
    } else {
        renderPlaylistSection();
        collapsible.style.display = 'block';
        section.classList.add('expanded');
    }
}

function renderPlaylistSection() {
    const playlistList = document.getElementById('playerPlaylistList');
    const toggleName = document.getElementById('playlistToggleName');
    const toggleCount = document.getElementById('playlistToggleCount');

    if (!playlistList) return;

    // Update playlist button info
    if (audioPlayer.playlist && audioPlayer.playlist.length > 0) {
        const count = audioPlayer.playlist.length;
        const playlistName = audioPlayer.currentPlaylistName || 'Playlist';

        if (toggleName) {
            toggleName.textContent = playlistName;
        }
        if (toggleCount) {
            toggleCount.textContent = `${count} ${count === 1 ? 'track' : 'tracks'}`;
        }
    } else {
        if (toggleName) toggleName.textContent = 'Playlist';
        if (toggleCount) toggleCount.textContent = '0 tracks';
    }

    if (!audioPlayer.playlist || audioPlayer.playlist.length === 0) {
        playlistList.innerHTML = '<div class="empty-state" style="padding: 1.5rem; text-align: center; color: var(--text-secondary); font-size: 0.875rem;">No tracks in playlist</div>';
        if (headerInfo) headerInfo.textContent = '';
        return;
    }

    playlistList.innerHTML = audioPlayer.playlist.map((track, index) => {
        const isActive = index === audioPlayer.currentIndex;
        return `
            <div class="audio-player-playlist-item ${isActive ? 'active' : ''}" onclick="playTrackFromPlaylist(${index})">
                <div class="audio-player-playlist-item-number">${index + 1}</div>
                <div class="audio-player-playlist-item-info">
                    <div class="audio-player-playlist-item-title">${escapeHtml(track.title || track.filename || 'Unknown')}</div>
                    <div class="audio-player-playlist-item-artist">${escapeHtml(track.artist || 'Unknown Artist')}</div>
                </div>
                <div class="audio-player-playlist-item-meta">
                    ${track.bpm ? `<span>${track.bpm} BPM</span>` : ''}
                    ${track.key ? `<span>${escapeHtml(track.key)}</span>` : ''}
                    ${track.energy !== undefined && track.energy !== null ? `<span>${Math.round(track.energy * 100)}% Energy</span>` : ''}
                    ${track.mood ? `<span>${escapeHtml(track.mood)}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function playTrackFromPlaylist(index) {
    if (!audioPlayer.playlist || index < 0 || index >= audioPlayer.playlist.length) return;

    // Load the track
    loadTrackToPlayer(index);

    // Start playing
    if (audioPlayer.audio) {
        const playPromise = audioPlayer.audio.play();
        if (playPromise !== undefined) {
            playPromise.catch(err => {
                console.error('Error playing audio:', err);
                if (err.name === 'NotAllowedError') {
                    showToast('Autoplay blocked. Click play again.', 'warning');
                } else {
                    showToast(`Error playing audio: ${err.message}`, 'error');
                }
            });
        }
    }
}

function updatePlayButton() {
    const btn = document.getElementById('playerPlayBtn');
    if (btn) {
        btn.textContent = audioPlayer.isPlaying ? '⏸' : '▶';
    }
}

function updateMuteButton() {
    const btn = document.getElementById('playerMuteBtn');
    if (btn) {
        if (audioPlayer.isMuted || audioPlayer.volume === 0) {
            btn.textContent = '🔇';
        } else if (audioPlayer.volume < 0.5) {
            btn.textContent = '🔉';
        } else {
            btn.textContent = '🔊';
        }
    }
}

function updateAudioPlayerProgress() {
    if (!audioPlayer.audio) return;

    const progressBar = document.getElementById('playerProgressBar');
    const progressBarFill = document.getElementById('playerProgressBarFill');

    if (audioPlayer.audio.duration) {
        const percent = (audioPlayer.audio.currentTime / audioPlayer.audio.duration) * 100;

        // Update progress bar
        if (progressBar) progressBar.value = percent;
        if (progressBarFill) progressBarFill.style.width = percent + '%';
    }

    updateAudioPlayerTime();
}

function updateAudioPlayerTime() {
    if (!audioPlayer.audio) return;

    const currentTimeEl = document.getElementById('playerCurrentTime');
    const totalTimeEl = document.getElementById('playerTotalTime');

    if (currentTimeEl) {
        currentTimeEl.textContent = formatTime(audioPlayer.audio.currentTime || 0);
    }
    if (totalTimeEl && audioPlayer.audio.duration) {
        totalTimeEl.textContent = formatTime(audioPlayer.audio.duration);
    }
}

function formatTime(seconds) {
    if (isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

function handleAudioError(event) {
    console.error('Audio error:', event);
    showToast('Error loading audio file', 'error');
}

// Initialize audio player when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initAudioPlayer();
        initDualRangeSliders();
    });
} else {
    initAudioPlayer();
    initDualRangeSliders();
}

// ============================================
// SPOTIFY PUBLIC BROWSING LOGIC
// ============================================

let currentSection = 'trending';

function initSpotifyTab() {
    // Check status then load default
    fetch('/spotify/public/status')
        .then(res => res.json())
        .then(data => {
            if (data.connected) {
                // Initialize features
                loadSpotifyTrending();
                loadSpotifyGenres(); // Load genres for builder
            } else {
                showToast('Spotify API Credentials Missing in Backend', 'error');
            }
        });
}

function showSpotifySection(section) {
    currentSection = section;

    // Toggle UI
    document.getElementById('spotifyTrendingSection').style.display = section === 'trending' ? 'block' : 'none';
    document.getElementById('spotifyNewReleasesSection').style.display = section === 'new' ? 'block' : 'none';
    document.getElementById('spotifySetBuilderSection').style.display = section === 'builder' ? 'block' : 'none';
    document.getElementById('spotifyAlbumDetailSection').style.display = 'none'; // Hide detail view

    // Toggle Buttons
    document.getElementById('btnTrending').classList.toggle('active', section === 'trending');
    document.getElementById('btnNewReleases').classList.toggle('active', section === 'new');
    document.getElementById('btnSetBuilder').classList.toggle('active', section === 'builder');

    // Load Data
    if (section === 'trending') loadSpotifyTrending();
    if (section === 'new') loadSpotifyNewReleases();
}

async function loadSpotifyGenres() {
    const select = document.getElementById('spotifyBuilderGenre');
    try {
        const response = await fetch('/spotify/public/genres');
        const data = await response.json();
        if (data.success) {
            select.innerHTML = '<option value="">Select Genre...</option>' +
                data.genres.map(g => `<option value="${g}">${g}</option>`).join('');
        }
    } catch (e) {
        console.error("Failed to load genres", e);
    }
}

async function buildSpotifySet() {
    const genre = document.getElementById('spotifyBuilderGenre').value;
    const energy = document.getElementById('spotifyBuilderEnergy').value;
    const bpm = document.getElementById('spotifyBuilderBPM').value;

    if (!genre) {
        showToast('Please select a genre', 'warning');
        return;
    }

    const tbody = document.getElementById('spotifyBuilderTableBody');
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Generating Set from Spotify AI...</td></tr>';

    // Convert energy 0-100 to 0-1
    let energyParam = energy ? parseInt(energy) / 100 : '';
    let queryParams = `genre=${genre}`;
    if (energyParam !== '') queryParams += `&energy=${energyParam}`;
    if (bpm) queryParams += `&bpm=${bpm}`;

    try {
        const response = await fetch(`/spotify/public/recommendations?${queryParams}`);
        const data = await response.json();

        if (data.success) {
            window.currentSpotifyTracks = data.tracks;

            if (data.tracks.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="empty-state">No recommendations found. Try broader params.</td></tr>';
                return;
            }

            tbody.innerHTML = data.tracks.map(track => `
                <tr>
                    <td class="col-status"><span style="color: grey;">-</span></td>
                    <td class="col-title">${escapeHtml(track.name)}</td>
                    <td class="col-artist">${escapeHtml(track.artists.join(', '))}</td>
                    <td class="col-album">${escapeHtml(track.album)}</td>
                    <td class="col-duration">${formatTime(track.duration_ms / 1000)}</td>
                </tr>
            `).join('');

            showToast(`Generated ${data.tracks.length} track set!`, 'success');
        } else {
            tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Error: ${data.error}</td></tr>`;
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="5" class="empty-state">Error generating set</td></tr>`;
    }
}

async function loadSpotifyTrending() {
    const tbody = document.getElementById('spotifyTrendingTableBody');
    if (tbody.children.length > 1) return; // Already loaded

    tbody.innerHTML = '<tr><td colspan="6" class="empty-state">Loading Global Top 50...</td></tr>';

    try {
        const response = await fetch('/spotify/public/trending');
        const data = await response.json();

        if (data.success) {
            window.currentSpotifyTracks = data.tracks; // Store for import

            tbody.innerHTML = data.tracks.map(track => `
                <tr>
                    <td class="col-status"><span style="color: grey;">-</span></td>
                    <td class="col-image"><img src="${track.image}" style="width: 40px; height: 40px; border-radius: 4px;"></td>
                    <td class="col-title">${escapeHtml(track.name)}</td>
                    <td class="col-artist">${escapeHtml(track.artists.join(', '))}</td>
                    <td class="col-album">${escapeHtml(track.album)}</td>
                    <td class="col-duration">${formatTime(track.duration_ms / 1000)}</td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Error: ${data.error}</td></tr>`;
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Failed to load trending</td></tr>`;
    }
}

async function loadSpotifyNewReleases() {
    const grid = document.getElementById('spotifyNewReleasesGrid');
    if (grid.children.length > 0) return; // Already loaded

    grid.innerHTML = '<div class="playlist-empty-state">Loading New Releases...</div>';

    try {
        const response = await fetch('/spotify/public/new');
        const data = await response.json();

        if (data.success) {
            grid.innerHTML = data.albums.map(album => `
                <div class="playlist-card" onclick="openSpotifyAlbum('${album.id}')">
                    <div class="playlist-card-image" style="background-image: url('${album.image}'); background-size: cover;"></div>
                    <div class="playlist-card-content">
                        <div class="playlist-card-title">${escapeHtml(album.name)}</div>
                        <div class="playlist-card-meta">${escapeHtml(album.artists.join(', '))} • ${album.total_tracks} tracks</div>
                    </div>
                </div>
            `).join('');
        } else {
            grid.innerHTML = `<div class="playlist-empty-state">Error: ${data.error}</div>`;
        }
    } catch (e) {
        grid.innerHTML = `<div class="playlist-empty-state">Failed to load new releases</div>`;
    }
}

async function openSpotifyAlbum(albumId) {
    document.getElementById('spotifyNewReleasesSection').style.display = 'none';
    document.getElementById('spotifyAlbumDetailSection').style.display = 'block';

    const tbody = document.getElementById('spotifyAlbumTableBody');
    tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Loading Album...</td></tr>';

    try {
        const response = await fetch(`/spotify/public/album/${albumId}`);
        const data = await response.json();

        if (data.success) {
            document.getElementById('spotifyAlbumTitle').textContent = data.album_name;
            window.currentSpotifyTracks = data.tracks; // Store for import

            tbody.innerHTML = data.tracks.map(track => `
                <tr>
                    <td class="col-status"><span style="color: grey;">-</span></td>
                    <td class="col-title">${escapeHtml(track.name)}</td>
                    <td class="col-artist">${escapeHtml(track.artists.join(', '))}</td>
                    <td class="col-duration">${formatTime(track.duration_ms / 1000)}</td>
                </tr>
            `).join('');
        } else {
            tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Error: ${data.error}</td></tr>`;
        }
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="4" class="empty-state">Failed to load album</td></tr>`;
    }
}

async function importSpotifyPlaylist() {
    if (!window.currentSpotifyTracks) return;

    let activeSection = document.getElementById('spotifyTrendingSection').style.display === 'block' ? 'trending' : 'album';
    if (document.getElementById('spotifySetBuilderSection').style.display === 'block') activeSection = 'builder';

    let btnSelector, tbodySelector;

    if (activeSection === 'trending') {
        btnSelector = '#spotifyTrendingSection .primary-btn';
        tbodySelector = '#spotifyTrendingTableBody';
    } else if (activeSection === 'builder') {
        btnSelector = '#spotifySetBuilderSection .primary-btn';
        tbodySelector = '#spotifyBuilderTableBody';
    } else {
        btnSelector = '#spotifyAlbumDetailSection .primary-btn';
        tbodySelector = '#spotifyAlbumTableBody';
    }

    const btn = document.querySelector(btnSelector);
    const originalText = btn.textContent;
    btn.textContent = 'Matching...';
    btn.disabled = true;

    try {
        const response = await fetch('/spotify/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tracks: window.currentSpotifyTracks })
        });

        const data = await response.json();

        if (data.success) {
            showToast(`Match complete!`, 'success');

            // Update UI to show matches
            const tbody = document.querySelector(tbodySelector);
            const rows = tbody.querySelectorAll('tr');

            data.results.forEach((result, index) => {
                const row = rows[index];
                if (row) {
                    const statusCell = row.querySelector('.col-status');
                    if (result.match_found) {
                        statusCell.innerHTML = '✅ <span style="font-size:0.8em; color:#10b981;">Found</span>';
                        row.style.background = 'rgba(16, 185, 129, 0.1)';
                    } else {
                        statusCell.innerHTML = '❌ <span style="font-size:0.8em; color:grey;">Missing</span>';
                    }
                }
            });

            const foundCount = data.results.filter(r => r.match_found).length;
            showToast(`Found ${foundCount} of ${data.results.length} tracks in your library.`, 'info', 5000);

        } else {
            showToast(`Import error: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('Import error:', error);
        showToast('Failed to import playlist', 'error');
    } finally {
        if (btn) {
            btn.textContent = originalText;
            btn.disabled = false;
        }
    }
}

function formatTime(seconds) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
}

// ============================================
// BROWSER FUNCTIONALITY (Rekordbox-style)
// ============================================

// Browser state
let selectedItems = {
    files: [],
    folders: [],
    playlists: []
};

let browserTreeData = {
    folders: [],
    playlists: []
};

let expandedTreeNodes = new Set();

// Load browser tree structure
async function loadBrowserTree() {
    try {
        console.log('[BROWSER] Loading browser tree...');
        const treeContainer = document.getElementById('browserTree');
        if (!treeContainer) {
            console.error('[BROWSER] browserTree element not found!');
            return;
        }
        
        // Show loading state
        treeContainer.innerHTML = '<div style="padding: 1rem; color: var(--text-secondary);">Loading folders...</div>';
        
        const response = await fetch('/browser/tree', {
            signal: AbortSignal.timeout(10000) // 10 second timeout
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        console.log('[BROWSER] Browser tree data received:', data);
        
        if (data.success) {
            browserTreeData = {
                folders: data.folders || [],
                playlists: data.playlists || []
            };
            console.log('[BROWSER] Browser tree data set:', browserTreeData);
            renderBrowserTree();
        } else {
            console.error('[BROWSER] Failed to load browser tree:', data.error);
            treeContainer.innerHTML = `<div style="padding: 1rem; color: #ef4444;">Error: ${data.error}</div>`;
            showToast(`Failed to load browser tree: ${data.error}`, 'error');
        }
    } catch (error) {
        console.error('[BROWSER] Error loading browser tree:', error);
        const treeContainer = document.getElementById('browserTree');
        if (treeContainer) {
            treeContainer.innerHTML = `<div style="padding: 1rem; color: #ef4444;">Error: ${error.message}</div>`;
        }
        if (error.name !== 'AbortError') {
            showToast(`Failed to load browser tree: ${error.message}`, 'error');
        }
    }
}

// Render browser tree
function renderBrowserTree() {
    const treeContainer = document.getElementById('browserTree');
    if (!treeContainer) {
        console.error('[BROWSER] browserTree element not found!');
        return;
    }
    
    console.log('[BROWSER] Rendering browser tree with folders:', browserTreeData.folders.length, 'playlists:', browserTreeData.playlists.length);
    
    treeContainer.innerHTML = '';
    
    // Users can browse filesystem by clicking directories in the file list
    // or use the Import Folder button to browse and import
    
    // Folders section
    if (browserTreeData.folders.length > 0) {
        const foldersHeader = document.createElement('div');
        foldersHeader.className = 'tree-header';
        foldersHeader.innerHTML = '<span>📁 Analyzed Folders</span>';
        treeContainer.appendChild(foldersHeader);
        
        browserTreeData.folders.forEach(folder => {
            const folderItem = createTreeItem('folder', folder.split('/').pop() || folder, folder);
            treeContainer.appendChild(folderItem);
        });
        console.log('[BROWSER] Rendered', browserTreeData.folders.length, 'folders');
    }
    
    // Playlists section
    if (browserTreeData.playlists.length > 0) {
        const playlistsHeader = document.createElement('div');
        playlistsHeader.className = 'tree-header';
        playlistsHeader.innerHTML = '<span>🎵 Playlists</span>';
        treeContainer.appendChild(playlistsHeader);
        
        browserTreeData.playlists.forEach(playlist => {
            const playlistItem = createTreeItem('playlist', playlist, playlist);
            treeContainer.appendChild(playlistItem);
        });
        console.log('[BROWSER] Rendered', browserTreeData.playlists.length, 'playlists');
    }
    
    if (browserTreeData.folders.length === 0 && browserTreeData.playlists.length === 0) {
        const emptyMsg = document.createElement('div');
        emptyMsg.className = 'empty-state';
        emptyMsg.textContent = 'No analyzed folders yet. Import a folder to get started.';
        treeContainer.appendChild(emptyMsg);
        console.log('[BROWSER] No folders or playlists to display');
    }
}

// Create tree item
function createTreeItem(type, name, path) {
    const item = document.createElement('div');
    item.className = 'tree-item';
    item.dataset.type = type;
    item.dataset.path = path;
    item.dataset.name = name;
    
    const icon = type === 'folder' ? '📁' : '🎵';
    
    // Create checkbox for selection
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'tree-item-checkbox';
    checkbox.dataset.path = path;
    checkbox.dataset.type = type;
    
    // Check if this item is already selected
    const key = type === 'folder' ? 'folders' : 'playlists';
    checkbox.checked = selectedItems[key].includes(path);
    
    // Build the item structure
    const iconSpan = document.createElement('span');
    iconSpan.className = 'tree-item-icon';
    iconSpan.textContent = icon;
    
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tree-item-name';
    nameSpan.textContent = name;
    
    // Append elements to item (checkbox first, then icon, then name)
    item.appendChild(checkbox);
    item.appendChild(iconSpan);
    item.appendChild(nameSpan);
    
    // Attach event listener AFTER adding to DOM
    checkbox.addEventListener('change', (e) => {
        e.stopPropagation(); // Prevent triggering the item click
        const isSelected = checkbox.checked;
        console.log('[SELECTION] Tree checkbox changed:', { path, type, checked: isSelected });
        toggleBrowserSelection(path, type, isSelected);
    });
    
    // Make the item clickable to load files (but not when clicking checkbox)
    item.addEventListener('click', (e) => {
        // Don't navigate if clicking the checkbox
        if (e.target.type === 'checkbox' || e.target.closest('.tree-item-checkbox')) {
            return;
        }
        e.stopPropagation();
        loadBrowserFiles(path, type);
    });
    
    return item;
}

// Load files for selected folder/playlist
// Store current browser path/type for restoration
window.currentBrowserPath = null;
window.currentBrowserType = null;

async function loadBrowserFiles(path, type) {
    const fileList = document.getElementById('browserFileList');
    const filePanelTitle = document.getElementById('browserFilePanelTitle');
    
    if (!fileList || !filePanelTitle) {
        console.error('Browser file list elements not found');
        return;
    }
    
    // Show loading state immediately to prevent UI freeze
    fileList.innerHTML = '<div class="empty-state">Loading files...</div>';
    
    try {
        // Store current path/type for restoration (both in memory and localStorage)
        window.currentBrowserPath = path;
        window.currentBrowserType = type;
        localStorage.setItem('currentBrowserPath', path);
        localStorage.setItem('currentBrowserType', type);
        
        const response = await fetch('/browser/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: path, type: type }),
            signal: AbortSignal.timeout(30000) // 30 second timeout for large folders
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            renderBrowserFileList(data.files, path, type);
            const displayName = path.split('/').pop() || path.split('\\').pop() || path;
            filePanelTitle.textContent = 
                type === 'playlist' ? `Playlist: ${displayName}` : `Folder: ${displayName}`;
        } else {
            showToast(`Failed to load files: ${data.error}`, 'error');
            fileList.innerHTML = `<div class="empty-state" style="color: #ef4444;">Error: ${data.error}</div>`;
            filePanelTitle.textContent = 'Error';
        }
    } catch (error) {
        console.error('Error loading files:', error);
        if (error.name === 'AbortError') {
            showToast('Request timed out. Try refreshing.', 'warning');
            fileList.innerHTML = '<div class="empty-state" style="color: #ef4444;">Request timed out. Try refreshing.</div>';
        } else {
            showToast(`Failed to load files: ${error.message}`, 'error');
            fileList.innerHTML = `<div class="empty-state" style="color: #ef4444;">Error loading files: ${error.message}</div>`;
        }
        filePanelTitle.textContent = 'Error';
    }
}

// Track file rows for progress updates
let browserFileRows = new Map();

// Browser table sorting state
let browserSortState = {
    column: null,
    direction: 'asc' // 'asc' or 'desc'
};

// Current browser files data (for sorting)
let currentBrowserFiles = [];

// Playlist generation state
let currentGeneratedPlaylist = [];
let originalGeneratedPlaylist = []; // Store original playlist state for reset
let playlistGeneratorSettings = {};

// Loaded playlist state
let currentLoadedPlaylist = [];
let originalLoadedPlaylist = []; // Store original loaded playlist state for reset
let currentLoadedPlaylistId = null;
let currentLoadedPlaylistName = null;

// Render file list in center panel
function renderBrowserFileList(files, path, type) {
    const fileList = document.getElementById('browserFileList');
    if (!fileList) return;
    
    // Store files for sorting and filtering
    currentBrowserFiles = files;
    filteredBrowserFiles = null; // Reset filter when loading new files
    
    fileList.innerHTML = '';
    browserFileRows.clear();
    
    // Reset search input
    const searchInput = document.getElementById('browserSearchInput');
    if (searchInput) {
        searchInput.value = '';
    }
    
    // Reset select all checkbox
    const selectAllCheckbox = document.getElementById('selectAllFilesTable');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
    }
    
    if (files.length === 0) {
        fileList.innerHTML = '<div class="empty-state">No files found</div>';
        return;
    }
    
    // Create table structure
    const table = document.createElement('table');
    table.className = 'browser-file-table';
    
    // Create table header
    const thead = document.createElement('thead');
    thead.innerHTML = `
        <tr>
            <th colspan="8" style="padding: 0.5rem; border-bottom: none;">
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <input type="checkbox" id="selectAllFilesTable" onclick="toggleSelectAllFiles()" style="cursor: pointer;">
                    <label for="selectAllFilesTable" style="cursor: pointer; font-size: 0.875rem; color: var(--text-secondary); margin: 0;">Select All</label>
                    <div style="flex: 1;"></div>
                    <input type="text" id="browserSearchInput" placeholder="Search files..." style="padding: 0.375rem 0.75rem; border: 1px solid var(--border-color); border-radius: 4px; background: var(--bg-secondary); color: var(--text-primary); font-size: 0.875rem; min-width: 200px;" oninput="filterBrowserFiles(this.value)">
                </div>
            </th>
        </tr>
        <tr>
            <th style="width: 40px; padding: 0.5rem;">
            </th>
            <th class="sortable-header" data-column="name" style="padding: 0.5rem; text-align: left; cursor: pointer; user-select: none;">
                <span>Name</span>
                <span class="sort-indicator"></span>
            </th>
            <th class="sortable-header" data-column="artist" style="padding: 0.5rem; text-align: left; cursor: pointer; user-select: none;">
                <span>Artist</span>
                <span class="sort-indicator"></span>
            </th>
            <th class="sortable-header" data-column="bpm" style="padding: 0.5rem; text-align: center; cursor: pointer; user-select: none; width: 80px;">
                <span>BPM</span>
                <span class="sort-indicator"></span>
            </th>
            <th class="sortable-header" data-column="key" style="padding: 0.5rem; text-align: center; cursor: pointer; user-select: none; width: 100px;">
                <span>Key</span>
                <span class="sort-indicator"></span>
            </th>
            <th class="sortable-header" data-column="energy" style="padding: 0.5rem; text-align: center; cursor: pointer; user-select: none; width: 80px;">
                <span>Energy</span>
                <span class="sort-indicator"></span>
            </th>
            <th class="sortable-header" data-column="duration" style="padding: 0.5rem; text-align: center; cursor: pointer; user-select: none; width: 100px;">
                <span>Duration</span>
                <span class="sort-indicator"></span>
            </th>
            <th style="padding: 0.5rem; text-align: center; width: 100px;">Status</th>
        </tr>
    `;
    
    // Attach sort handlers to headers
    const sortHeaders = thead.querySelectorAll('.sortable-header');
    sortHeaders.forEach(header => {
        header.addEventListener('click', () => {
            const column = header.dataset.column;
            sortBrowserFiles(column);
        });
    });
    
    // Create table body
    const tbody = document.createElement('tbody');
    tbody.id = 'browserFileTableBody';
    
    table.appendChild(thead);
    table.appendChild(tbody);
    fileList.appendChild(table);
    
    // Render files
    renderBrowserFileRows(files);
}

// Render browser file rows (used for initial render and after sorting)
function renderBrowserFileRows(files) {
    const tbody = document.getElementById('browserFileTableBody');
    if (!tbody) return;
    
    tbody.innerHTML = '';
    browserFileRows.clear();
    
    files.forEach(file => {
        const row = createBrowserFileRow(file);
        tbody.appendChild(row);
    });
    
    // Update select all checkbox state
    updateSelectAllState();
}

// Filter browser files based on search query
function filterBrowserFiles(searchQuery) {
    if (!currentBrowserFiles || currentBrowserFiles.length === 0) return;
    
    const query = searchQuery.trim().toLowerCase();
    
    if (query === '') {
        // No filter, show all files
        filteredBrowserFiles = null;
        const filesToShow = browserSortState.column ? 
            sortFilesArray([...currentBrowserFiles], browserSortState.column, browserSortState.direction) : 
            currentBrowserFiles;
        renderBrowserFileRows(filesToShow);
        return;
    }
    
    // Filter files based on search query
    let filtered = currentBrowserFiles.filter(file => {
        const name = (file.name || file.path.split('/').pop() || file.path.split('\\').pop() || '').toLowerCase();
        const artist = (file.artist || '').toLowerCase();
        const key = (file.key || '').toLowerCase();
        const bpm = file.bpm ? String(Math.round(file.bpm)) : '';
        
        return name.includes(query) || 
               artist.includes(query) || 
               key.includes(query) || 
               bpm.includes(query);
    });
    
    // Apply current sort if any
    if (browserSortState.column) {
        filtered = sortFilesArray(filtered, browserSortState.column, browserSortState.direction);
    }
    
    filteredBrowserFiles = filtered;
    renderBrowserFileRows(filtered);
}

// Helper function to sort an array of files without re-rendering
function sortFilesArray(files, column, direction) {
    return [...files].sort((a, b) => {
        let aVal, bVal;
        
        switch(column) {
            case 'name':
                aVal = (a.name || a.path.split('/').pop() || a.path.split('\\').pop() || '').toLowerCase();
                bVal = (b.name || b.path.split('/').pop() || b.path.split('\\').pop() || '').toLowerCase();
                break;
            case 'artist':
                aVal = (a.artist || '').toLowerCase();
                bVal = (b.artist || '').toLowerCase();
                break;
            case 'bpm':
                aVal = a.bpm || 0;
                bVal = b.bpm || 0;
                break;
            case 'key':
                aVal = (a.key || '').toLowerCase();
                bVal = (b.key || '').toLowerCase();
                break;
            case 'energy':
                aVal = a.energy !== undefined ? a.energy : 0;
                bVal = b.energy !== undefined ? b.energy : 0;
                break;
            case 'duration':
                aVal = a.duration || 0;
                bVal = b.duration || 0;
                break;
            default:
                return 0;
        }
        
        if (aVal < bVal) return direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return direction === 'asc' ? 1 : -1;
        return 0;
    });
}

// Create a single browser file row
function createBrowserFileRow(file) {
    const row = document.createElement('tr');
    row.className = 'browser-file-row';
    row.dataset.path = file.path;
    row.dataset.type = file.type;
    row.id = `file-row-${file.path.replace(/[^a-zA-Z0-9]/g, '_')}`;
    
    // Checkbox cell
    const checkboxCell = document.createElement('td');
    checkboxCell.style.cssText = 'padding: 0.5rem; text-align: center;';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'file-item-checkbox';
    checkbox.dataset.path = file.path;
    checkbox.dataset.type = file.type;
    checkbox.addEventListener('change', (e) => {
        console.log('[SELECTION] File checkbox changed:', { path: file.path, type: file.type, checked: e.target.checked });
        toggleBrowserSelection(file.path, file.type, e.target.checked);
        updateSelectAllState();
    });
    checkboxCell.appendChild(checkbox);
    
    // Name cell
    const nameCell = document.createElement('td');
    nameCell.style.cssText = 'padding: 0.5rem;';
    const icon = file.type === 'directory' ? '📁' : '🎵';
    const displayName = file.name || file.path.split('/').pop() || file.path.split('\\').pop();
    // Escape HTML manually
    const escapedName = displayName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
    nameCell.innerHTML = `<span>${icon}</span> <span>${escapedName}</span>`;
    
    // Artist cell
    const artistCell = document.createElement('td');
    artistCell.style.cssText = 'padding: 0.5rem; color: var(--text-secondary);';
    artistCell.textContent = file.artist || '-';
    
    // BPM cell
    const bpmCell = document.createElement('td');
    bpmCell.style.cssText = 'padding: 0.5rem; text-align: center;';
    bpmCell.textContent = file.bpm ? Math.round(file.bpm) : '-';
    
    // Key cell
    const keyCell = document.createElement('td');
    keyCell.style.cssText = 'padding: 0.5rem; text-align: center;';
    keyCell.textContent = file.key || '-';
    
    // Energy cell
    const energyCell = document.createElement('td');
    energyCell.style.cssText = 'padding: 0.5rem; text-align: center;';
    energyCell.textContent = file.energy !== undefined ? Math.round(file.energy) : '-';
    
    // Duration cell
    const durationCell = document.createElement('td');
    durationCell.style.cssText = 'padding: 0.5rem; text-align: center;';
    if (file.duration) {
        const minutes = Math.floor(file.duration / 60);
        const seconds = Math.floor(file.duration % 60);
        durationCell.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    } else {
        durationCell.textContent = '-';
    }
    
    // Status cell
    const statusCell = document.createElement('td');
    statusCell.style.cssText = 'padding: 0.5rem; text-align: center;';
    const statusSpan = document.createElement('span');
    statusSpan.className = 'file-status';
    statusSpan.style.cssText = 'font-size: 0.75rem;';
    
    if (file.type === 'file' && file.analysis_status) {
        switch(file.analysis_status) {
            case 'analyzed':
                statusSpan.textContent = '✓ Done';
                statusSpan.style.color = '#10b981';
                break;
            case 'analyzing':
                statusSpan.textContent = '⏳ Analyzing...';
                statusSpan.style.color = 'var(--accent-color)';
                break;
            case 'skipped':
                statusSpan.textContent = '⊘ Skipped';
                statusSpan.style.color = 'var(--text-secondary)';
                break;
            case 'failed':
                statusSpan.textContent = '✗ Failed';
                statusSpan.style.color = '#ef4444';
                break;
            default:
                statusSpan.textContent = '-';
        }
    } else {
        statusSpan.textContent = '-';
    }
    statusCell.appendChild(statusSpan);
    
    // Append all cells to row
    row.appendChild(checkboxCell);
    row.appendChild(nameCell);
    row.appendChild(artistCell);
    row.appendChild(bpmCell);
    row.appendChild(keyCell);
    row.appendChild(energyCell);
    row.appendChild(durationCell);
    row.appendChild(statusCell);
    
    // Store reference to file row for progress updates
    if (file.type === 'file') {
        browserFileRows.set(file.path, row);
    }
    
    // If it's a directory, make it clickable to navigate (but not when clicking checkbox)
    if (file.type === 'directory') {
        row.style.cursor = 'pointer';
        nameCell.style.cursor = 'pointer';
        nameCell.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            loadBrowserFiles(file.path, 'folder');
        });
    }
    
    return row;
}

// Sort browser files
function sortBrowserFiles(column) {
    // Use filtered files if filter is active, otherwise use all files
    const filesToSort = filteredBrowserFiles !== null ? filteredBrowserFiles : currentBrowserFiles;
    
    if (!filesToSort || filesToSort.length === 0) return;
    
    // Toggle sort direction if clicking the same column
    if (browserSortState.column === column) {
        browserSortState.direction = browserSortState.direction === 'asc' ? 'desc' : 'asc';
    } else {
        browserSortState.column = column;
        browserSortState.direction = 'asc';
    }
    
    // Sort the files
    const sortedFiles = [...filesToSort].sort((a, b) => {
        let aVal, bVal;
        
        switch(column) {
            case 'name':
                aVal = (a.name || a.path.split('/').pop() || a.path.split('\\').pop() || '').toLowerCase();
                bVal = (b.name || b.path.split('/').pop() || b.path.split('\\').pop() || '').toLowerCase();
                break;
            case 'artist':
                aVal = (a.artist || '').toLowerCase();
                bVal = (b.artist || '').toLowerCase();
                break;
            case 'bpm':
                aVal = a.bpm || 0;
                bVal = b.bpm || 0;
                break;
            case 'key':
                aVal = (a.key || '').toLowerCase();
                bVal = (b.key || '').toLowerCase();
                break;
            case 'energy':
                aVal = a.energy !== undefined ? a.energy : 0;
                bVal = b.energy !== undefined ? b.energy : 0;
                break;
            case 'duration':
                aVal = a.duration || 0;
                bVal = b.duration || 0;
                break;
            default:
                return 0;
        }
        
        if (aVal < bVal) return browserSortState.direction === 'asc' ? -1 : 1;
        if (aVal > bVal) return browserSortState.direction === 'asc' ? 1 : -1;
        return 0;
    });
    
    // Update filtered files if filter is active, otherwise update current files
    if (filteredBrowserFiles !== null) {
        filteredBrowserFiles = sortedFiles;
    } else {
        currentBrowserFiles = sortedFiles;
    }
    
    // Re-render rows
    renderBrowserFileRows(sortedFiles);
    
    // Update sort indicators
    updateSortIndicators();
}

// Update sort indicators in table headers
function updateSortIndicators() {
    const headers = document.querySelectorAll('.sortable-header');
    headers.forEach(header => {
        const indicator = header.querySelector('.sort-indicator');
        const column = header.dataset.column;
        
        if (browserSortState.column === column) {
            indicator.textContent = browserSortState.direction === 'asc' ? ' ▲' : ' ▼';
            indicator.style.color = 'var(--accent-color)';
            header.style.color = 'var(--accent-color)';
        } else {
            indicator.textContent = '';
            header.style.color = '';
        }
    });
}

// Toggle select all files
function toggleSelectAllFiles() {
    const selectAllCheckbox = document.getElementById('selectAllFilesTable');
    if (!selectAllCheckbox) return;
    
    const isChecked = selectAllCheckbox.checked;
    
    const checkboxes = document.querySelectorAll('.file-item-checkbox');
    
    checkboxes.forEach(checkbox => {
        if (checkbox.dataset.type === 'file' || checkbox.dataset.type === 'directory') {
            checkbox.checked = isChecked;
            const path = checkbox.dataset.path;
            const type = checkbox.dataset.type;
            toggleBrowserSelection(path, type, isChecked);
        }
    });
}

// Update select all checkbox state
function updateSelectAllState() {
    const selectAllCheckbox = document.getElementById('selectAllFilesTable');
    
    const checkboxes = document.querySelectorAll('.file-item-checkbox');
    const checkedCount = Array.from(checkboxes).filter(cb => cb.checked && (cb.dataset.type === 'file' || cb.dataset.type === 'directory')).length;
    const totalCount = Array.from(checkboxes).filter(cb => cb.dataset.type === 'file' || cb.dataset.type === 'directory').length;
    
    const isChecked = totalCount > 0 && checkedCount === totalCount;
    const isIndeterminate = checkedCount > 0 && checkedCount < totalCount;
    
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = isChecked;
        selectAllCheckbox.indeterminate = isIndeterminate;
    }
}

// Toggle selection of browser item
function toggleBrowserSelection(path, type, selected) {
    console.log('[SELECTION] toggleBrowserSelection called:', { path, type, selected });
    
    // Map type to key: 'file' -> 'files', 'folder' or 'directory' -> 'folders', else -> 'playlists'
    let key;
    if (type === 'file') {
        key = 'files';
    } else if (type === 'folder' || type === 'directory') {
        key = 'folders';
    } else {
        key = 'playlists';
    }
    
    console.log('[SELECTION] Using key:', key, 'Current selectedItems:', selectedItems);
    
    if (selected) {
        if (!selectedItems[key].includes(path)) {
            selectedItems[key].push(path);
            console.log('[SELECTION] Added to selection. New state:', selectedItems);
        } else {
            console.log('[SELECTION] Path already in selection');
        }
    } else {
        selectedItems[key] = selectedItems[key].filter(p => p !== path);
        console.log('[SELECTION] Removed from selection. New state:', selectedItems);
    }
    
    updateSelectedQueue();
    updateSelectionCount();
    
    // Update selected tracks count in playlist generator if on playlists tab
    setTimeout(() => updateSelectedTracksCount(), 100);
}

// Update selected queue display
function updateSelectedQueue() {
    const queue = document.getElementById('browserSelectedQueue');
    if (!queue) return;
    
    queue.innerHTML = '';
    
    const total = selectedItems.files.length + selectedItems.folders.length + selectedItems.playlists.length;
    
    if (total === 0) {
        queue.innerHTML = '<div class="empty-state">No items selected</div>';
        return;
    }
    
    // Files
    selectedItems.files.forEach(path => {
        const item = createSelectedQueueItem('file', path);
        queue.appendChild(item);
    });
    
    // Folders
    selectedItems.folders.forEach(path => {
        const item = createSelectedQueueItem('folder', path);
        queue.appendChild(item);
    });
    
    // Playlists
    selectedItems.playlists.forEach(name => {
        const item = createSelectedQueueItem('playlist', name);
        queue.appendChild(item);
    });
}

// Create selected queue item
function createSelectedQueueItem(type, path) {
    const item = document.createElement('div');
    item.className = 'selected-queue-item';
    item.dataset.type = type;
    item.dataset.path = path;
    
    const icon = type === 'file' ? '🎵' : type === 'folder' ? '📁' : '🎵';
    const displayName = type === 'playlist' ? path : (path.split('/').pop() || path.split('\\').pop());
    
    item.innerHTML = `
        <span>${icon}</span>
        <span style="flex: 1; overflow: hidden; text-overflow: ellipsis;">${displayName}</span>
        <button onclick="removeFromSelection('${type}', '${path}')" class="remove-btn">×</button>
    `;
    
    return item;
}

// Remove item from selection
function removeFromSelection(type, path) {
    // Map type to key: 'file' -> 'files', 'folder' or 'directory' -> 'folders', else -> 'playlists'
    let key;
    if (type === 'file') {
        key = 'files';
    } else if (type === 'folder' || type === 'directory') {
        key = 'folders';
    } else {
        key = 'playlists';
    }
    selectedItems[key] = selectedItems[key].filter(p => p !== path);
    
    // Also uncheck in file list
    const fileItem = document.querySelector(`[data-path="${path}"]`);
    if (fileItem) {
        const checkbox = fileItem.querySelector('.file-item-checkbox');
        if (checkbox) checkbox.checked = false;
    }
    
    // Also uncheck in tree
    const treeItem = document.querySelector(`.tree-item[data-path="${path}"]`);
    if (treeItem) {
        const checkbox = treeItem.querySelector('.tree-item-checkbox');
        if (checkbox) checkbox.checked = false;
    }
    
    updateSelectedQueue();
    updateSelectionCount();
}

// Update selection count
function updateSelectionCount() {
    if (!selectedItems) {
        console.error('[SELECTION] selectedItems is undefined in updateSelectionCount!');
        return;
    }
    
    const filesCount = selectedItems.files ? selectedItems.files.length : 0;
    const foldersCount = selectedItems.folders ? selectedItems.folders.length : 0;
    const playlistsCount = selectedItems.playlists ? selectedItems.playlists.length : 0;
    const count = filesCount + foldersCount + playlistsCount;
    
    console.log('[SELECTION] updateSelectionCount:', { filesCount, foldersCount, playlistsCount, total: count });
    
    const countElement = document.getElementById('browserSelectionCount');
    if (countElement) {
        countElement.textContent = `${count} selected`;
    }
    
    const analyzeBtn = document.getElementById('analyzeSelectedBtn');
    if (analyzeBtn) {
        analyzeBtn.disabled = count === 0;
        console.log('[SELECTION] Analyze button disabled:', count === 0);
    }
}

// Clear browser selection
function clearBrowserSelection() {
    selectedItems = {
        files: [],
        folders: [],
        playlists: []
    };
    
    // Uncheck all checkboxes in file list
    document.querySelectorAll('.file-item-checkbox').forEach(cb => cb.checked = false);
    
    // Uncheck all checkboxes in tree
    document.querySelectorAll('.tree-item-checkbox').forEach(cb => cb.checked = false);
    
    // Reset select all checkbox
    const selectAllCheckbox = document.getElementById('selectAllFiles');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = false;
        selectAllCheckbox.indeterminate = false;
    }
    
    updateSelectedQueue();
    updateSelectionCount();
}

// Refresh browser
function refreshBrowser() {
    loadBrowserTree();
    clearBrowserSelection();
    const fileList = document.getElementById('browserFileList');
    if (fileList) {
        fileList.innerHTML = '<div class="empty-state">Select a folder or playlist from the tree to view files</div>';
    }
    document.getElementById('browserFilePanelTitle').textContent = 'Select a folder or playlist';
}

// Analyze selected items
async function analyzeSelectedItems() {
    // Debug: Log current selection state
    console.log('[ANALYSIS] analyzeSelectedItems called');
    console.log('[ANALYSIS] Current selectedItems object:', selectedItems);
    
    // Check if selectedItems exists and has the right structure
    if (!selectedItems) {
        console.error('[ANALYSIS] selectedItems is undefined!');
        showToast('Selection state error. Please refresh the page.', 'error');
        return;
    }
    
    const filesCount = selectedItems.files ? selectedItems.files.length : 0;
    const foldersCount = selectedItems.folders ? selectedItems.folders.length : 0;
    const playlistsCount = selectedItems.playlists ? selectedItems.playlists.length : 0;
    const total = filesCount + foldersCount + playlistsCount;
    
    console.log('[ANALYSIS] Selection counts:', { filesCount, foldersCount, playlistsCount, total });
    
    if (total === 0) {
        showToast('No items selected. Please select files (from file list), folders (from tree or file list), or playlists (from tree) to analyze.', 'warning');
        console.warn('[ANALYSIS] No items selected. Full selectedItems state:', JSON.stringify(selectedItems, null, 2));
        return;
    }
    
    // Get force re-analyze option
    const forceReanalyzeCheckbox = document.getElementById('forceReanalyze');
    const forceReanalyze = forceReanalyzeCheckbox ? forceReanalyzeCheckbox.checked : false;
    
    const analyzeBtn = document.getElementById('analyzeSelectedBtn');
    if (analyzeBtn) {
        analyzeBtn.disabled = true;
        analyzeBtn.textContent = forceReanalyze ? '🔄 Force Re-analyzing...' : '⚡ Analyzing...';
    }
    
    try {
        console.log('[ANALYSIS] Starting analysis:', {
            files: selectedItems.files.length,
            folders: selectedItems.folders.length,
            playlists: selectedItems.playlists.length,
            force: forceReanalyze
        });
        
        const response = await fetch('/analyze/selected', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                files: selectedItems.files || [],
                folders: selectedItems.folders || [],
                playlists: selectedItems.playlists || [],
                force: forceReanalyze
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.success) {
            const message = forceReanalyze 
                ? `Force re-analyzing ${data.file_count} files...`
                : `Started analyzing ${data.file_count} files...`;
            showToast(message, 'success');
            
            // Show progress bar
            const progressContainer = document.getElementById('browserProgressContainer');
            if (progressContainer) {
                progressContainer.style.display = 'block';
                document.getElementById('browserProgressStatus').textContent = forceReanalyze ? 'Force re-analyzing...' : 'Starting analysis...';
                document.getElementById('browserProgressCurrent').textContent = '0';
                document.getElementById('browserProgressTotal').textContent = data.file_count || '0';
                document.getElementById('browserProgressPercent').textContent = '0%';
                document.getElementById('browserProgressBar').style.width = '0%';
                document.getElementById('browserProgressBar').style.background = 'var(--accent-color)';
                
                // Reset stats counters
                window.analysisStats = { analyzed: 0, skipped: 0, failed: 0 };
                const analyzedEl = document.getElementById('browserProgressAnalyzed');
                const skippedEl = document.getElementById('browserProgressSkipped');
                const failedEl = document.getElementById('browserProgressFailed');
                if (analyzedEl) analyzedEl.textContent = '✓ Analyzed: 0';
                if (skippedEl) skippedEl.textContent = '⊘ Skipped: 0';
                if (failedEl) failedEl.textContent = '✗ Failed: 0';
            }
            
            // Refresh browser tree immediately to show newly imported folders
            if (selectedItems.folders.length > 0) {
                setTimeout(() => loadBrowserTree(), 500);
            }
            
            // WebSocket will handle progress updates and button re-enabling on completion
            // Don't re-enable button here - let WebSocket completion message handle it
        } else {
            showToast(`Failed to start analysis: ${data.error}`, 'error');
            // Hide progress bar on error
            const progressContainer = document.getElementById('browserProgressContainer');
            if (progressContainer) {
                progressContainer.style.display = 'none';
            }
            // Re-enable button on error
            if (analyzeBtn) {
                analyzeBtn.disabled = false;
                analyzeBtn.textContent = '⚡ Analyze Selected';
            }
        }
    } catch (error) {
        console.error('[ANALYSIS] Error analyzing selected items:', error);
        showToast(`Failed to analyze: ${error.message}`, 'error');
        // Re-enable button on error
        const analyzeBtn = document.getElementById('analyzeSelectedBtn');
        if (analyzeBtn) {
            analyzeBtn.disabled = false;
            analyzeBtn.textContent = '⚡ Analyze Selected';
        }
        // Hide progress bar on error
        const progressContainer = document.getElementById('browserProgressContainer');
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
    }
}

// ============================================
// PLAYLIST GENERATOR FUNCTIONALITY
// ============================================

// Initialize playlist generator UI
function initializePlaylistGenerator() {
    // Populate start key dropdown with Camelot keys
    const startKeySelect = document.getElementById('startKey');
    if (startKeySelect) {
        const camelotKeys = [
            '8A', '9A', '10A', '11A', '12A', '1A', '2A', '3A', '4A', '5A', '6A', '7A',
            '8B', '9B', '10B', '11B', '12B', '1B', '2B', '3B', '4B', '5B', '6B', '7B'
        ];
        camelotKeys.forEach(key => {
            const option = document.createElement('option');
            option.value = key;
            option.textContent = key;
            startKeySelect.appendChild(option);
        });
    }

    // Populate genre dropdown (will be populated from library)
    loadGenresForGenerator();

    // Render initial energy curve visualization
    renderEnergyCurve('gradual_build');

    // Update selected tracks count
    updateSelectedTracksCount();

    // Listen for energy curve changes
    const energyCurveSelect = document.getElementById('energyCurve');
    if (energyCurveSelect) {
        energyCurveSelect.addEventListener('change', (e) => {
            renderEnergyCurve(e.target.value);
        });
    }
}

// Load genres from library for genre filter
async function loadGenresForGenerator() {
    try {
        const response = await fetch('/library/statistics', {
            signal: AbortSignal.timeout(10000) // 10 second timeout
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        if (data.success && data.genres) {
            const genreSelect = document.getElementById('playlistGenre');
            if (genreSelect) {
                genreSelect.innerHTML = '';
                data.genres.forEach(genre => {
                    const option = document.createElement('option');
                    option.value = genre;
                    option.textContent = genre;
                    genreSelect.appendChild(option);
                });
            }
        }
    } catch (error) {
        console.error('Error loading genres:', error);
        // Don't show error toast for genre loading - it's not critical
    }
}

// Update selected tracks count display
function updateSelectedTracksCount() {
    const countEl = document.getElementById('selectedTracksCount');
    if (countEl && selectedItems) {
        const totalSelected = (selectedItems.files || []).length;
        countEl.textContent = `(${totalSelected})`;
        if (totalSelected === 0) {
            const sourceSelected = document.getElementById('sourceSelected');
            if (sourceSelected) {
                sourceSelected.disabled = true;
            }
        } else {
            const sourceSelected = document.getElementById('sourceSelected');
            if (sourceSelected) {
                sourceSelected.disabled = false;
            }
        }
    }
}

// Toggle advanced options visibility
function toggleAdvancedOptions() {
    const advancedOptions = document.getElementById('advancedOptions');
    const toggleBtn = document.getElementById('toggleAdvancedOptions');
    if (advancedOptions && toggleBtn) {
        const isVisible = advancedOptions.style.display !== 'none';
        advancedOptions.style.display = isVisible ? 'none' : 'block';
        toggleBtn.textContent = isVisible ? '▼ Advanced Options' : '▲ Advanced Options';
    }
}

// Render energy curve visualization
function renderEnergyCurve(curveName) {
    const canvas = document.getElementById('energyCurveCanvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.parentElement.clientWidth || 300;
    const height = 60;
    canvas.width = width;
    canvas.height = height;

    // Clear canvas
    ctx.clearRect(0, 0, width, height);

    // Get curve data
    let curve = [];
    if (curveName === 'gradual_build') {
        curve = [[0, 30], [0.3, 50], [0.7, 80], [1.0, 90]];
    } else if (curveName === 'peak_sustain') {
        curve = [[0, 40], [0.2, 70], [0.8, 90], [1.0, 80]];
    } else if (curveName === 'rollercoaster') {
        curve = [[0, 50], [0.25, 80], [0.5, 40], [0.75, 90], [1.0, 60]];
    } else if (curveName === 'chill_down') {
        curve = [[0, 70], [0.5, 50], [1.0, 30]];
    } else {
        curve = [[0, 30], [0.3, 50], [0.7, 80], [1.0, 90]];
    }

    // Draw grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = (height / 4) * i;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
    }

    // Draw curve
    ctx.strokeStyle = '#3b82f6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    
    for (let i = 0; i < curve.length; i++) {
        const [progress, energy] = curve[i];
        const x = progress * width;
        const y = height - (energy / 100) * height;
        
        if (i === 0) {
            ctx.moveTo(x, y);
        } else {
            ctx.lineTo(x, y);
        }
    }
    ctx.stroke();

    // Fill area under curve
    ctx.fillStyle = 'rgba(59, 130, 246, 0.2)';
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fill();
}

// Main playlist generation function
async function generatePlaylist() {
    const generateBtn = document.getElementById('generatePlaylistBtn');
    const statusEl = document.getElementById('playlistGeneratorStatus');
    
    // Get all UI values
    const duration = parseInt(document.getElementById('playlistDuration').value) || 60;
    const energyCurve = document.getElementById('energyCurve').value;
    const startKey = document.getElementById('startKey').value || null;
    const mood = document.getElementById('playlistMood').value || null;
    
    // Get source selection
    const sourceRadios = document.querySelectorAll('input[name="playlistSource"]');
    let source = 'library';
    for (const radio of sourceRadios) {
        if (radio.checked) {
            source = radio.value;
            break;
        }
    }

    // Get advanced options
    const bpmMin = document.getElementById('playlistBpmMin').value ? parseInt(document.getElementById('playlistBpmMin').value) : null;
    const bpmMax = document.getElementById('playlistBpmMax').value ? parseInt(document.getElementById('playlistBpmMax').value) : null;
    const genreSelect = document.getElementById('playlistGenre');
    const genres = genreSelect ? Array.from(genreSelect.selectedOptions).map(opt => opt.value) : [];
    const keyStrictness = document.getElementById('keyStrictness').value;
    const avoidArtistRepeats = document.getElementById('avoidArtistRepeats').checked;
    const trackDurationMin = document.getElementById('playlistTrackDurationMin').value ? parseFloat(document.getElementById('playlistTrackDurationMin').value) : null;
    const trackDurationMax = document.getElementById('playlistTrackDurationMax').value ? parseFloat(document.getElementById('playlistTrackDurationMax').value) : null;

    // Validate duration
    if (duration < 1 || duration > 300) {
        showToast('Please enter a valid duration (1-300 minutes)', 'warning');
        return;
    }

    // Set loading state
    if (generateBtn) {
        generateBtn.disabled = true;
        generateBtn.textContent = '⏳ Generating...';
    }
    if (statusEl) {
        statusEl.textContent = 'Generating playlist...';
        statusEl.style.color = 'var(--accent-color)';
    }

    // Store settings for regeneration
    playlistGeneratorSettings = {
        duration, energyCurve, startKey, mood, source,
        bpmMin, bpmMax, genres, keyStrictness, avoidArtistRepeats,
        trackDurationMin, trackDurationMax
    };

    try {
        let requestBody = {
            duration: duration,
            energy_curve: energyCurve,
            start_key: startKey,
            mood: mood,
            bpm_min: bpmMin,
            bpm_max: bpmMax,
            genres: genres.length > 0 ? genres : null,
            key_strictness: keyStrictness,
            avoid_artist_repeats: avoidArtistRepeats,
            track_duration_min: trackDurationMin,
            track_duration_max: trackDurationMax
        };

        // Handle source selection
        if (source === 'selected') {
            // Get selected tracks from browser
            const selectedFiles = selectedItems.files || [];
            if (selectedFiles.length === 0) {
                showToast('No tracks selected. Please select tracks in the Analyzer tab.', 'warning');
                if (generateBtn) {
                    generateBtn.disabled = false;
                    generateBtn.textContent = '🎵 Generate Playlist';
                }
                if (statusEl) statusEl.textContent = '';
                return;
            }
            
            // Fetch track data for selected files
            const tracks = [];
            for (const filePath of selectedFiles) {
                const track = await fetchTrackData(filePath);
                if (track) {
                    // Ensure all string fields are properly set (not None)
                    if (!track.artist) track.artist = '';
                    if (!track.genre) track.genre = '';
                    if (!track.mood) track.mood = '';
                    if (!track.key) track.key = '';
                    if (track.genres && Array.isArray(track.genres)) {
                        track.genres = track.genres.filter(g => g); // Remove None/null values
                    }
                    tracks.push(track);
                }
            }
            
            if (tracks.length === 0) {
                showToast('No valid tracks found in selection. Please ensure tracks are analyzed.', 'warning');
                if (generateBtn) {
                    generateBtn.disabled = false;
                    generateBtn.textContent = '🎵 Generate Playlist';
                }
                if (statusEl) statusEl.textContent = '';
                return;
            }
            
            requestBody.tracks = tracks;
        } else if (source === 'filtered') {
            // Use current library filters
            const filters = getFilters();
            requestBody.filters = filters;
        }
        // else: source === 'library' - use entire library (no filters)

        const response = await fetch('/library/generate_smart_playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
            const tracks = data.tracks || [];
            console.log('[GENERATE] Received tracks from server:', tracks.length, 'tracks');
            console.log('[GENERATE] First track sample:', tracks[0] || 'None');
            
            currentGeneratedPlaylist = tracks;
            // Save original state for reset functionality
            originalGeneratedPlaylist = JSON.parse(JSON.stringify(tracks)); // Deep copy
            
            console.log('[GENERATE] Stored currentGeneratedPlaylist length:', currentGeneratedPlaylist.length);
            console.log('[GENERATE] Stored originalGeneratedPlaylist length:', originalGeneratedPlaylist.length);
            
            if (statusEl) {
                statusEl.textContent = `✅ Generated ${data.count} tracks`;
                statusEl.style.color = '#10b981';
            }
            showToast(`Generated playlist with ${data.count} tracks`, 'success');

            // Render preview
            renderGeneratedPlaylist(currentGeneratedPlaylist);
            
            // Show preview section
            const previewSection = document.getElementById('playlistPreviewSection');
            if (previewSection) {
                previewSection.style.display = 'block';
            }
        } else {
            throw new Error(data.error || 'Failed to generate playlist');
        }
    } catch (error) {
        console.error('Playlist generation error:', error);
        if (statusEl) {
            statusEl.textContent = `❌ Error: ${error.message}`;
            statusEl.style.color = '#ef4444';
        }
        showToast(`Failed to generate playlist: ${error.message}`, 'error');
    } finally {
        if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.textContent = '🎵 Generate Playlist';
        }
    }
}

// Fetch track data for a file path
async function fetchTrackData(filePath) {
    try {
        // Try to get from browser files API
        const parentPath = filePath.substring(0, filePath.lastIndexOf('/'));
        const response = await fetch('/browser/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: parentPath,
                type: 'folder'
            })
        });
        const data = await response.json();
        if (data.success && data.files) {
            return data.files.find(f => f.path === filePath);
        }
    } catch (error) {
        console.error('Error fetching track data:', error);
    }
    return null;
}

// Render generated playlist preview
function renderGeneratedPlaylist(playlist) {
    const previewTable = document.getElementById('playlistPreviewTable');
    const statsEl = document.getElementById('playlistPreviewStats');
    
    if (!previewTable) return;

    if (!playlist || playlist.length === 0) {
        previewTable.innerHTML = '<div class="empty-state">No tracks in playlist</div>';
        if (statsEl) statsEl.textContent = '';
        return;
    }

    // Calculate statistics
    const stats = calculatePlaylistStatistics(playlist);
    
    // Display statistics
    if (statsEl) {
        statsEl.innerHTML = `
            <span>${playlist.length} tracks</span> • 
            <span>${stats.totalDuration}</span> • 
            <span>Avg BPM: ${stats.avgBpm}</span> • 
            <span>Energy: ${stats.minEnergy}-${stats.maxEnergy}</span>
        `;
    }

    // Render table
    let tableHTML = `
        <table style="width: 100%; border-collapse: collapse;">
            <thead>
                <tr style="border-bottom: 1px solid var(--border-color);">
                    <th style="padding: 0.75rem; text-align: left; color: var(--text-secondary); font-weight: 500; width: 40px;">#</th>
                    <th style="padding: 0.75rem; text-align: left; color: var(--text-secondary); font-weight: 500; width: 30px;"></th>
                    <th style="padding: 0.75rem; text-align: left; color: var(--text-secondary); font-weight: 500;">Title</th>
                    <th style="padding: 0.75rem; text-align: left; color: var(--text-secondary); font-weight: 500;">Artist</th>
                    <th style="padding: 0.75rem; text-align: center; color: var(--text-secondary); font-weight: 500; width: 60px;">BPM</th>
                    <th style="padding: 0.75rem; text-align: center; color: var(--text-secondary); font-weight: 500; width: 70px;">Key</th>
                    <th style="padding: 0.75rem; text-align: center; color: var(--text-secondary); font-weight: 500; width: 70px;">Energy</th>
                    <th style="padding: 0.75rem; text-align: center; color: var(--text-secondary); font-weight: 500; width: 80px;">Duration</th>
                    <th style="padding: 0.75rem; text-align: center; color: var(--text-secondary); font-weight: 500; width: 60px;">Actions</th>
                </tr>
            </thead>
            <tbody id="playlistPreviewTbody">
    `;

    playlist.forEach((track, index) => {
        // Handle title - prefer title, fallback to filename, then extract from path
        let title = track.title;
        if (!title || title === 'None' || title === 'null') {
            title = track.filename;
        }
        if (!title || title === 'None' || title === 'null') {
            // Extract filename from path if available
            if (track.path) {
                title = track.path.split('/').pop().split('\\').pop();
                // Remove extension
                title = title.replace(/\.[^/.]+$/, '');
            }
        }
        if (!title || title === 'None' || title === 'null') {
            title = 'Unknown';
        }
        
        // Handle artist - check for null, undefined, empty string, or string 'None'/'null'
        let artist = track.artist;
        // Convert to string and trim to handle any whitespace issues
        if (artist && typeof artist === 'string') {
            artist = artist.trim();
        }
        // Check if artist is valid
        if (!artist || artist === null || artist === undefined || artist === 'None' || artist === 'null' || artist === '' || String(artist).trim() === '') {
            // Try to extract artist from filename if available (format: "Artist - Title")
            if (track.filename) {
                const parts = track.filename.split(' - ');
                if (parts.length > 1) {
                    artist = parts[0].trim();
                }
            }
            // If still no artist, try extracting from path
            if ((!artist || artist === '') && track.path) {
                const filename = track.path.split('/').pop().split('\\').pop();
                const parts = filename.split(' - ');
                if (parts.length > 1) {
                    artist = parts[0].trim();
                }
            }
            // Final fallback
            if (!artist || artist === '') {
                artist = 'Unknown Artist';
            }
        }
        
        const bpm = track.bpm || '-';
        const key = track.key || '-';
        const energy = track.energy !== undefined ? Math.round(track.energy) : '-';
        
        // Handle duration - duration should be in seconds
        let duration = '-';
        if (track.duration) {
            // If duration is a number, use it directly
            const dur = parseFloat(track.duration);
            if (!isNaN(dur) && dur > 0) {
                duration = formatDuration(dur);
            }
        }
        
        tableHTML += `
            <tr class="playlist-preview-row" draggable="true" data-index="${index}" style="border-bottom: 1px solid var(--border-color); cursor: move;">
                <td style="padding: 0.75rem; color: var(--text-secondary);">${index + 1}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary); cursor: grab;">☰</td>
                <td style="padding: 0.75rem;">${escapeHtml(title)}</td>
                <td style="padding: 0.75rem; color: var(--text-secondary);">${escapeHtml(artist)}</td>
                <td style="padding: 0.75rem; text-align: center;">${bpm}</td>
                <td style="padding: 0.75rem; text-align: center; font-family: monospace;">${escapeHtml(key)}</td>
                <td style="padding: 0.75rem; text-align: center;">${energy}</td>
                <td style="padding: 0.75rem; text-align: center; color: var(--text-secondary);">${duration}</td>
                <td style="padding: 0.75rem; text-align: center;">
                    <button onclick="removeTrackFromPlaylist(${index})" style="background: transparent; border: none; color: #ef4444; cursor: pointer; font-size: 1.2rem;" title="Remove">×</button>
                </td>
            </tr>
        `;
    });

    tableHTML += `
            </tbody>
        </table>
    `;

    previewTable.innerHTML = tableHTML;

    // Attach drag and drop handlers
    attachPlaylistDragHandlers();
}

// Format duration in seconds to MM:SS
function formatDuration(seconds) {
    if (!seconds) return '-';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Calculate playlist statistics
function calculatePlaylistStatistics(playlist) {
    if (!playlist || playlist.length === 0) {
        return {
            totalDuration: '0:00',
            avgBpm: 0,
            minEnergy: 0,
            maxEnergy: 0,
            keyDistribution: {},
            genres: []
        };
    }

    let totalDuration = 0;
    let totalBpm = 0;
    let bpmCount = 0;
    let energies = [];
    const keyDistribution = {};
    const genreSet = new Set();

    playlist.forEach(track => {
        // Handle duration - ensure it's a number
        if (track.duration) {
            const dur = parseFloat(track.duration);
            if (!isNaN(dur) && dur > 0) {
                totalDuration += dur;
            }
        }
        if (track.bpm) {
            const bpmVal = parseFloat(track.bpm);
            if (!isNaN(bpmVal) && bpmVal > 0) {
                totalBpm += bpmVal;
                bpmCount++;
            }
        }
        if (track.energy !== undefined) {
            const energyVal = parseFloat(track.energy);
            if (!isNaN(energyVal)) {
                energies.push(energyVal);
            }
        }
        if (track.key) {
            keyDistribution[track.key] = (keyDistribution[track.key] || 0) + 1;
        }
        if (track.genres && Array.isArray(track.genres)) {
            track.genres.forEach(g => genreSet.add(g));
        }
    });

    const mins = Math.floor(totalDuration / 60);
    const secs = Math.floor(totalDuration % 60);
    const totalDurationStr = `${mins}:${secs.toString().padStart(2, '0')}`;

    return {
        totalDuration: totalDurationStr,
        avgBpm: bpmCount > 0 ? Math.round(totalBpm / bpmCount) : 0,
        minEnergy: energies.length > 0 ? Math.round(Math.min(...energies)) : 0,
        maxEnergy: energies.length > 0 ? Math.round(Math.max(...energies)) : 0,
        keyDistribution: keyDistribution,
        genres: Array.from(genreSet)
    };
}

// Attach drag and drop handlers for playlist reordering
function attachPlaylistDragHandlers() {
    const tbody = document.getElementById('playlistPreviewTbody');
    if (!tbody) return;

    let draggedRow = null;

    tbody.querySelectorAll('.playlist-preview-row').forEach(row => {
        row.addEventListener('dragstart', (e) => {
            draggedRow = row;
            e.dataTransfer.effectAllowed = 'move';
            row.style.opacity = '0.5';
        });

        row.addEventListener('dragend', () => {
            if (draggedRow) draggedRow.style.opacity = '1';
            draggedRow = null;
        });

        row.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            
            const afterElement = getDragAfterElement(tbody, e.clientY);
            if (afterElement == null) {
                tbody.appendChild(draggedRow);
            } else {
                tbody.insertBefore(draggedRow, afterElement);
            }
        });

        row.addEventListener('drop', (e) => {
            e.preventDefault();
            if (draggedRow && draggedRow !== row) {
                reorderPlaylistTracks();
            }
        });
    });
}

// Get element after which to insert dragged element
function getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.playlist-preview-row:not(.dragging)')];
    
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

// Reorder playlist tracks based on DOM order
function reorderPlaylistTracks() {
    const tbody = document.getElementById('playlistPreviewTbody');
    if (!tbody) return;

    const rows = Array.from(tbody.querySelectorAll('.playlist-preview-row'));
    const newOrder = rows.map(row => {
        const index = parseInt(row.dataset.index);
        return currentGeneratedPlaylist[index];
    });

    currentGeneratedPlaylist = newOrder;
    
    // Re-render with updated order
    renderGeneratedPlaylist(currentGeneratedPlaylist);
}

// Remove track from playlist
function removeTrackFromPlaylist(index) {
    if (index >= 0 && index < currentGeneratedPlaylist.length) {
        currentGeneratedPlaylist.splice(index, 1);
        renderGeneratedPlaylist(currentGeneratedPlaylist);
    }
}

// Regenerate playlist with same settings
function regeneratePlaylist() {
    // Restore settings to UI
    if (playlistGeneratorSettings.duration) {
        document.getElementById('playlistDuration').value = playlistGeneratorSettings.duration;
    }
    if (playlistGeneratorSettings.energyCurve) {
        document.getElementById('energyCurve').value = playlistGeneratorSettings.energyCurve;
        renderEnergyCurve(playlistGeneratorSettings.energyCurve);
    }
    if (playlistGeneratorSettings.startKey) {
        document.getElementById('startKey').value = playlistGeneratorSettings.startKey;
    }
    if (playlistGeneratorSettings.mood) {
        document.getElementById('playlistMood').value = playlistGeneratorSettings.mood;
    }
    
    // Restore source
    const sourceRadios = document.querySelectorAll('input[name="playlistSource"]');
    for (const radio of sourceRadios) {
        radio.checked = (radio.value === playlistGeneratorSettings.source);
    }

    // Restore advanced options
    if (playlistGeneratorSettings.bpmMin) {
        document.getElementById('playlistBpmMin').value = playlistGeneratorSettings.bpmMin;
    }
    if (playlistGeneratorSettings.bpmMax) {
        document.getElementById('playlistBpmMax').value = playlistGeneratorSettings.bpmMax;
    }
    if (playlistGeneratorSettings.genres && playlistGeneratorSettings.genres.length > 0) {
        const genreSelect = document.getElementById('playlistGenre');
        if (genreSelect) {
            Array.from(genreSelect.options).forEach(opt => {
                opt.selected = playlistGeneratorSettings.genres.includes(opt.value);
            });
        }
    }
    if (playlistGeneratorSettings.keyStrictness) {
        document.getElementById('keyStrictness').value = playlistGeneratorSettings.keyStrictness;
    }
    if (playlistGeneratorSettings.avoidArtistRepeats !== undefined) {
        document.getElementById('avoidArtistRepeats').checked = playlistGeneratorSettings.avoidArtistRepeats;
    }
    if (playlistGeneratorSettings.trackDurationMin) {
        document.getElementById('playlistTrackDurationMin').value = playlistGeneratorSettings.trackDurationMin;
    }
    if (playlistGeneratorSettings.trackDurationMax) {
        document.getElementById('playlistTrackDurationMax').value = playlistGeneratorSettings.trackDurationMax;
    }

    // Generate again
    generatePlaylist();
}

// Reset playlist to original generated order
function resetPlaylist() {
    if (originalGeneratedPlaylist.length === 0) {
        showToast('No original playlist to reset to. Generate a playlist first.', 'warning');
        return;
    }
    
    if (currentGeneratedPlaylist.length === 0) {
        showToast('No playlist to reset', 'warning');
        return;
    }
    
    // Restore original order
    currentGeneratedPlaylist = JSON.parse(JSON.stringify(originalGeneratedPlaylist));
    
    // Re-render with original order
    renderGeneratedPlaylist(currentGeneratedPlaylist);
    
    showToast('Playlist reset to original order', 'success');
}

// Show save playlist modal
function showSavePlaylistModal() {
    console.log('[SAVE MODAL] Checking playlist state:', {
        length: currentGeneratedPlaylist.length,
        hasTracks: currentGeneratedPlaylist.length > 0
    });
    
    if (!currentGeneratedPlaylist || currentGeneratedPlaylist.length === 0) {
        showToast('Cannot save empty playlist. Generate a playlist with tracks first.', 'warning');
        return;
    }
    
    // Reuse existing create playlist modal
    const modal = document.getElementById('createPlaylistModal');
    if (modal) {
        modal.style.display = 'block';
        
        // Change the button to call saveGeneratedPlaylist instead of createNewPlaylist
        const createButton = modal.querySelector('.modal-footer .primary-btn');
        if (createButton) {
            createButton.textContent = '💾 Save Playlist';
            createButton.onclick = saveGeneratedPlaylist;
        }
        
        // Clear the name field
        const nameInput = document.getElementById('newPlaylistName');
        if (nameInput) {
            nameInput.value = '';
            nameInput.focus();
        }
        
        // Clear description field
        const descInput = document.getElementById('newPlaylistDescription');
        if (descInput) {
            descInput.value = '';
        }
    }
}

// Save generated playlist
async function saveGeneratedPlaylist() {
    const nameInput = document.getElementById('newPlaylistName');
    const name = nameInput ? nameInput.value.trim() : '';
    
    if (!name) {
        showToast('Please enter a playlist name', 'warning');
        return;
    }

    // Debug: Log current playlist state
    console.log('[SAVE] Current playlist length:', currentGeneratedPlaylist.length);
    console.log('[SAVE] Current playlist:', currentGeneratedPlaylist);
    
    if (!currentGeneratedPlaylist || currentGeneratedPlaylist.length === 0) {
        showToast('Cannot save empty playlist. Generate a playlist with tracks first.', 'warning');
        return;
    }

    try {
        const payload = {
            name: name,
            tracks: currentGeneratedPlaylist
        };
        
        console.log('[SAVE] Sending payload:', {
            name: payload.name,
            trackCount: payload.tracks.length,
            firstTrack: payload.tracks[0] || null
        });
        
        const response = await fetch('/library/save_playlist', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (data.success) {
            showToast(`Playlist '${name}' saved successfully`, 'success');
            closeCreatePlaylistDialog();
            
            // Always refresh playlists list (will update if Playlists tab is active)
            console.log('[SAVE] Refreshing playlists list...');
            loadSavedPlaylists();
        } else {
            showToast(`Failed to save playlist: ${data.error}`, 'error');
        }
    } catch (error) {
        showToast(`Failed to save playlist: ${error.message}`, 'error');
    }
}

// Export playlist
async function exportPlaylist(format) {
    if (currentGeneratedPlaylist.length === 0) {
        showToast('No playlist to export. Generate a playlist first.', 'warning');
        return;
    }

    try {
        const endpoint = format === 'm3u' ? '/library/export/m3u' : '/library/export/rekordbox';
        
        // Try to get playlist name from save modal if available
        let exportName = null;
        const nameInput = document.getElementById('newPlaylistName');
        if (nameInput && nameInput.value) {
            exportName = nameInput.value;
        }
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tracks: currentGeneratedPlaylist,
                name: exportName
            })
        });

        const data = await response.json();

        if (data.success === false) {
            showToast(`Failed to export playlist: ${data.error}`, 'error');
            return;
        }

        if (data.path) {
            if (format === 'm3u') {
                showToast(`M3U exported to ${data.path}\nImport in Rekordbox: File > Import > Import Playlist`, 'success');
            } else {
                showToast(`XML exported to ${data.path}\nNote: Use M3U format for playlist import in Rekordbox`, 'success');
            }
        } else {
            showToast(data.message || 'Playlist exported successfully', 'success');
        }
    } catch (error) {
        console.error('Error exporting playlist:', error);
        // Try to parse error response if it's JSON
        try {
            const errorData = await error.response?.json();
            if (errorData?.error) {
                showToast(`Failed to export playlist: ${errorData.error}`, 'error');
            } else {
                showToast(`Failed to export playlist: ${error.message}`, 'error');
            }
        } catch {
            showToast(`Failed to export playlist: ${error.message}`, 'error');
        }
    }
}

// Export loaded playlist
async function exportLoadedPlaylist(format) {
    if (!currentLoadedPlaylist || currentLoadedPlaylist.length === 0) {
        showToast('No playlist loaded to export. Load a playlist first.', 'warning');
        return;
    }

    // Ensure we have the latest order from DOM before exporting
    const tbody = document.getElementById('loadedPlaylistTbody');
    if (tbody) {
        const rows = Array.from(tbody.querySelectorAll('.loaded-playlist-row'));
        if (rows.length > 0 && rows.length === currentLoadedPlaylist.length) {
            // Build a map of track IDs to track objects (using path as unique identifier)
            const trackMap = new Map();
            rows.forEach(row => {
                const originalIndex = parseInt(row.dataset.index);
                if (originalIndex >= 0 && originalIndex < currentLoadedPlaylist.length) {
                    const track = currentLoadedPlaylist[originalIndex];
                    const trackId = track.path || `${track.title || ''}_${track.artist || ''}_${originalIndex}`;
                    trackMap.set(trackId, track);
                }
            });
            
            // Create new order based on current DOM order
            const newOrder = rows.map(row => {
                const trackId = row.dataset.trackId;
                return trackMap.get(trackId);
            }).filter(track => track !== undefined);
            
            if (newOrder.length === currentLoadedPlaylist.length) {
                currentLoadedPlaylist = newOrder;
                console.log('[EXPORT] Updated playlist order from DOM before exporting:', newOrder.length, 'tracks');
            }
        }
    }

    try {
        const endpoint = format === 'm3u' ? '/library/export/m3u' : '/library/export/rekordbox';
        
        // Use playlist name for the export filename if available
        const exportName = currentLoadedPlaylistName || 'playlist';
        
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                tracks: currentLoadedPlaylist,
                name: exportName
            })
        });

        const data = await response.json();

        if (data.success === false) {
            showToast(`Failed to export playlist: ${data.error}`, 'error');
            return;
        }

        if (data.path) {
            if (format === 'm3u') {
                showToast(`M3U exported to ${data.path}\nImport in Rekordbox: File > Import > Import Playlist`, 'success');
            } else {
                showToast(`XML exported to ${data.path}\nNote: Use M3U format for playlist import in Rekordbox`, 'success');
            }
        } else {
            showToast(data.message || 'Playlist exported successfully', 'success');
        }
    } catch (error) {
        console.error('Error exporting loaded playlist:', error);
        // Try to parse error response if it's JSON
        try {
            const errorData = await error.response?.json();
            if (errorData?.error) {
                showToast(`Failed to export playlist: ${errorData.error}`, 'error');
            } else {
                showToast(`Failed to export playlist: ${error.message}`, 'error');
            }
        } catch {
            showToast(`Failed to export playlist: ${error.message}`, 'error');
        }
    }
}
