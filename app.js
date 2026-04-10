// Use a public CORS proxy because the target server uses port 4431, which is blocked by Cloudflare Workers and standard browsers natively.
const API_URL = 'https://corsproxy.io/?' + encodeURIComponent('https://telematics.otodatanetwork.com:4431/v1.0/DataService.svc/devices');
const REFRESH_INTERVAL_MS = 15 * 60 * 1000; // 15 mins
const LBS_PER_GAL_ANHYDROUS = 5.15;
const LBS_PER_TON = 2000;

// Hardcoded tank map based on previous requirements
const TANKS_MAP = {
    '29646599': { loc: 'Altus', name: 'East', capacity: 30000 },
    '29646372': { loc: 'Altus', name: 'West', capacity: 30000 },
    '29273850': { loc: 'Dalhart', name: 'Tank 1', capacity: 12000 },
    '29273837': { loc: 'Dalhart', name: 'Tank 2', capacity: 12000 },
    '29273797': { loc: 'Slaton', name: 'Small Tank', capacity: 12000 },
    '29273818': { loc: 'Slaton', name: 'Big Tank', capacity: 30000 },
    '29252234': { loc: 'Texline', name: 'Plant Tank', capacity: 30000 },
    '29273834': { loc: 'Texline', name: 'Small Tank', capacity: 12000 },
    '29273848': { loc: 'Texline', name: 'South Tank', capacity: 30000 }
};

let autoRefreshTimer = null;

// DOM Elements
const tankContainer = document.getElementById('tank-container');
const loader = document.getElementById('loader');
const lastUpdatedEl = document.getElementById('last-updated');
const settingsModal = document.getElementById('settings-modal');
const apiKeyInput = document.getElementById('api-key-input');
const saveSettingsBtn = document.getElementById('save-settings-btn');
const settingsBtn = document.getElementById('settings-btn');
const refreshBtn = document.getElementById('refresh-btn');
const pullIndicator = document.getElementById('pull-indicator');

// Time Formatter
function timeSince(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    let interval = seconds / 3600;
    if (interval > 1) return Math.floor(interval) + " hrs ago";
    interval = seconds / 60;
    if (interval > 1) return Math.floor(interval) + " mins ago";
    return "just now";
}

// Logic to load API key
function getApiKey() {
    return localStorage.getItem('otodata_api_key');
}

function setApiKey(key) {
    localStorage.setItem('otodata_api_key', key.trim());
}

// Init Function
function init() {
    // Check if API key exists
    if (!getApiKey()) {
        settingsModal.classList.add('active');
    } else {
        fetchData();
        startAutoRefresh();
    }

    // Events
    settingsBtn.addEventListener('click', () => {
        apiKeyInput.value = getApiKey() || '';
        settingsModal.classList.add('active');
    });

    saveSettingsBtn.addEventListener('click', () => {
        const key = apiKeyInput.value;
        if (key) {
            setApiKey(key);
            settingsModal.classList.remove('active');
            fetchData();
            startAutoRefresh();
        }
    });

    refreshBtn.addEventListener('click', () => {
        fetchData();
    });

    setupPullToRefresh();
}

function startAutoRefresh() {
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(fetchData, REFRESH_INTERVAL_MS);
}

async function fetchData() {
    const apiKey = getApiKey();
    if (!apiKey) return;

    // Show loading UI
    tankContainer.innerHTML = '';
    loader.style.display = 'block';

    try {
        const response = await fetch(API_URL, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Accept': 'application/json'
            }
        });

        if (!response.ok) {
            throw new Error(`API Error: ${response.status} ${response.statusText}`);
        }

        const data = await response.json();
        renderTanks(data);
        lastUpdatedEl.textContent = `Updated: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;

    } catch (error) {
        console.error("Failed to fetch data", error);
        tankContainer.innerHTML = `<div style="text-align:center; padding: 2rem;">
            <p>Error loading data. Check API Key or Network.</p>
            <p style="font-size: 0.8rem; color: var(--text-secondary); margin-top: 0.5rem;">${error.message}</p>
        </div>`;
    } finally {
        loader.style.display = 'none';
        pullIndicator.classList.remove('visible');
    }
}

function renderTanks(devices) {
    tankContainer.innerHTML = '';

    // Filter to known tanks or display all and map selectively
    const relevantTanks = devices.filter(d => {
        const serial = d.Id || d.SerialNumber || d.TankSerialNumber;
        return !!TANKS_MAP[serial];
    }).map(device => {
        const serial = device.Id || device.SerialNumber || device.TankSerialNumber;
        const config = TANKS_MAP[serial];
        const capacityGal = config.capacity;

        const currentLevelPct = device.CurrentLevel || (device.Ullage ? 100 - device.Ullage : 0);
        const levelFraction = currentLevelPct / 100;

        const inventoryGallons = capacityGal * levelFraction;
        const inventoryTons = (inventoryGallons * LBS_PER_GAL_ANHYDROUS) / LBS_PER_TON;

        const maxFillGallons = capacityGal * 0.85;
        const maxFillTons = (maxFillGallons * LBS_PER_GAL_ANHYDROUS) / LBS_PER_TON;
        const spaceToFillTons = Math.max(0, maxFillTons - inventoryTons);

        let lastCommsStr = 'unknown';
        if (device.LastCommunication || device.LastReadingDate) {
            lastCommsStr = timeSince(new Date(device.LastCommunication || device.LastReadingDate));
        }

        let statusClass = 'status-normal';
        if (levelFraction <= 0.1) statusClass = 'status-critical';
        else if (levelFraction <= 0.3) statusClass = 'status-warning';

        return {
            serial,
            location: config.loc,
            name: config.name,
            levelPct: currentLevelPct.toFixed(1),
            inventoryTons: inventoryTons.toFixed(2),
            spaceToFillTons: spaceToFillTons.toFixed(2),
            lastComms: lastCommsStr,
            statusClass,
            // Group sorting keys
            locSort: config.loc
        };
    });

    // Sort by Location then Name
    relevantTanks.sort((a, b) => {
        if (a.locSort < b.locSort) return -1;
        if (a.locSort > b.locSort) return 1;
        if (a.name < b.name) return -1;
        if (a.name > b.name) return 1;
        return 0;
    });

    relevantTanks.forEach(tank => {
        const tankEl = document.createElement('div');
        tankEl.className = `tank-card ${tank.statusClass}`;

        tankEl.innerHTML = `
            <div class="card-header">
                <div>
                    <div class="tank-name">${tank.name}</div>
                    <div class="tank-location">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                        ${tank.location}
                    </div>
                </div>
                <div class="tank-percentage">${tank.levelPct}%</div>
            </div>
            
            <div class="progress-track">
                <div class="progress-fill" style="width: ${tank.levelPct}%"></div>
            </div>

            <div class="card-stats">
                <div class="stat-item">
                    <span class="stat-label">Inventory</span>
                    <span class="stat-value">${tank.inventoryTons} Tons</span>
                </div>
                <div class="stat-item">
                    <span class="stat-label">Space to Fill</span>
                    <span class="stat-value">${tank.spaceToFillTons} Tons</span>
                </div>
            </div>
            
            <div style="font-size: 0.75rem; color: var(--text-secondary); text-align: right; margin-top: 0.5rem;">
                Last reading: ${tank.lastComms}
            </div>
        `;
        tankContainer.appendChild(tankEl);
    });
}

// Pull to Refresh Logic
function setupPullToRefresh() {
    let touchstartY = 0;
    let touchendY = 0;
    const pTrThreshold = 100;

    document.addEventListener('touchstart', e => {
        // Only trigger if at top of page
        if (window.scrollY === 0) {
            touchstartY = e.touches[0].clientY;
        } else {
            touchstartY = 0;
        }
    }, { passive: true });

    document.addEventListener('touchmove', e => {
        if (!touchstartY) return;
        const y = e.touches[0].clientY;
        if (y - touchstartY > 50 && window.scrollY === 0) {
            pullIndicator.classList.add('visible');
            pullIndicator.textContent = "Pull down to refresh...";
            if (y - touchstartY > pTrThreshold) {
                pullIndicator.textContent = "Release to refresh";
            }
        }
    }, { passive: true });

    document.addEventListener('touchend', e => {
        if (!touchstartY) return;
        touchendY = e.changedTouches[0].clientY;
        if (touchendY - touchstartY > pTrThreshold && window.scrollY === 0) {
            pullIndicator.classList.add('visible');
            pullIndicator.textContent = "Refreshing...";
            fetchData();
        } else {
            pullIndicator.classList.remove('visible');
        }
        touchstartY = 0;
    }, { passive: true });
}

// Boot up
document.addEventListener('DOMContentLoaded', init);

// Register Service Worker
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(err => {
            console.log('ServiceWorker registration failed: ', err);
        });
    });
}
