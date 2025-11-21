const ws = new WebSocket(`ws://${window.location.host}/ws`);
const consoleOutput = document.getElementById('consoleOutput');
const processedCount = document.getElementById('processedCount');
const totalCount = document.getElementById('totalCount');
const statusText = document.getElementById('statusText');
const scanBtn = document.getElementById('scanBtn');
const activityIndicator = document.getElementById('activityIndicator');

ws.onopen = () => {
    log("Connected to server.");
    activityIndicator.classList.add('active'); // Just to show connection
    setTimeout(() => activityIndicator.classList.remove('active'), 500);
};

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    if (data.type === 'start') {
        totalCount.innerText = data.total;
        processedCount.innerText = 0;
        statusText.innerText = "Scanning...";
        scanBtn.disabled = true;
        activityIndicator.classList.add('active');
    } else if (data.type === 'progress') {
        processedCount.innerText = data.current;
        statusText.innerText = data.status;
    } else if (data.type === 'log') {
        log(data.message);
    } else if (data.type === 'file_done') {
        const tags = data.tags;
        const tagStr = `BPM: ${tags.bpm} | Key: ${tags.key} | Energy: ${tags.energy}`;
        log(`<span class="success">✓ ${data.filename}</span> <span class="highlight">[${tagStr}]</span>`);
    } else if (data.type === 'complete') {
        statusText.innerText = "Completed";
        scanBtn.disabled = false;
        activityIndicator.classList.remove('active');
        log("Analysis complete.");
    }
};

function startScan() {
    const directory = document.getElementById('directoryInput').value;
    if (!directory) return;

    fetch('/scan', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ directory: directory }),
    });

    consoleOutput.innerHTML = ''; // Clear logs
}

function log(message) {
    const div = document.createElement('div');
    div.className = 'log-entry';
    div.innerHTML = message;
    consoleOutput.appendChild(div);
    consoleOutput.scrollTop = consoleOutput.scrollHeight;
}
