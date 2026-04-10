// Vercel handles the CORS and port 4431 constraints natively via vercel.json. We fetch cleanly from the same origin!
const API_URL = '/api/otodata';
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
const locationSorterContainer = document.getElementById('location-sorter');
let currentSettingsOrder = [];

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

// LocalStorage arrays for Priority Mapping
function getLocationOrder() {
    try {
        const stored = localStorage.getItem('otodata_location_order');
        if (stored) return JSON.parse(stored);
    } catch(e) {}
    // Build default initial map sorting Texline first
    const baseOrder = [...new Set(Object.values(TANKS_MAP).map(t => t.loc))].sort();
    const texIdx = baseOrder.indexOf('Texline');
    if (texIdx > -1) {
        baseOrder.splice(texIdx, 1);
        baseOrder.unshift('Texline');
    }
    return baseOrder;
}

function setLocationOrder(orderArray) {
    localStorage.setItem('otodata_location_order', JSON.stringify(orderArray));
}

// Interactive Location Sorter DOM Generation
function renderSorter() {
    if (!locationSorterContainer) return;
    locationSorterContainer.innerHTML = '';
    currentSettingsOrder.forEach((loc, index) => {
        const item = document.createElement('div');
        item.className = 'sorter-item';
        
        const nameEl = document.createElement('span');
        nameEl.textContent = loc;
        nameEl.style.fontWeight = '600';
        
        const actions = document.createElement('div');
        actions.className = 'sorter-actions';
        
        const upBtn = document.createElement('button');
        upBtn.className = 'sorter-btn';
        upBtn.innerHTML = '▲';
        if (index === 0) upBtn.disabled = true;
        upBtn.onclick = () => {
            [currentSettingsOrder[index - 1], currentSettingsOrder[index]] = [currentSettingsOrder[index], currentSettingsOrder[index - 1]];
            renderSorter();
        };
        
        const downBtn = document.createElement('button');
        downBtn.className = 'sorter-btn';
        downBtn.innerHTML = '▼';
        if (index === currentSettingsOrder.length - 1) downBtn.disabled = true;
        downBtn.onclick = () => {
            [currentSettingsOrder[index], currentSettingsOrder[index + 1]] = [currentSettingsOrder[index + 1], currentSettingsOrder[index]];
            renderSorter();
        };
        
        actions.appendChild(upBtn);
        actions.appendChild(downBtn);
        item.appendChild(nameEl);
        item.appendChild(actions);
        
        locationSorterContainer.appendChild(item);
    });
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
        currentSettingsOrder = getLocationOrder();
        renderSorter();
        settingsModal.classList.add('active');
    });

    saveSettingsBtn.addEventListener('click', () => {
        const key = apiKeyInput.value;
        if (key) {
            setApiKey(key);
            setLocationOrder(currentSettingsOrder);
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

        let levelFraction = 0;
        if (device.LastLevel !== undefined) {
            levelFraction = device.LastLevel; // API returns 0.00 to 1.00
        } else if (device.CurrentLevel !== undefined) {
            levelFraction = device.CurrentLevel > 1 ? device.CurrentLevel / 100 : device.CurrentLevel;
        }
        
        const currentLevelPct = levelFraction * 100;
        const inventoryGallons = capacityGal * levelFraction;
        const inventoryTons = (inventoryGallons * LBS_PER_GAL_ANHYDROUS) / LBS_PER_TON;

        const maxFillGallons = capacityGal * 0.85;
        const maxFillTons = (maxFillGallons * LBS_PER_GAL_ANHYDROUS) / LBS_PER_TON;
        const spaceToFillTons = Math.max(0, maxFillTons - inventoryTons);

        let lastCommsStr = 'unknown';
        let lastReadRaw = device.LastRead || device.LastCommunication || device.LastReadingDate;
        
        if (lastReadRaw) {
            if (typeof lastReadRaw === 'string' && lastReadRaw.indexOf('/Date(') >= 0) {
                // Parse WCF /Date(1234567890)/ format natively
                const timestamp = parseInt(lastReadRaw.match(/-?\d+/)[0], 10);
                lastCommsStr = timeSince(new Date(timestamp));
            } else if (typeof lastReadRaw === 'number') {
                const isSeconds = lastReadRaw.toString().length < 12;
                lastCommsStr = timeSince(new Date(isSeconds ? lastReadRaw * 1000 : lastReadRaw));
            } else if (!lastReadRaw.toString().includes('1900-01-01')) {
                // Parse standard ISO strings
                let isoStr = lastReadRaw.toString();
                // Append 'Z' if there is no trailing timezone match like -05:00, +0500, or Z
                if (!isoStr.endsWith('Z') && !isoStr.match(/[+-]\d{2}:?\d{2}$/)) {
                    isoStr += 'Z';
                }
                const parsedDate = new Date(isoStr);
                if (!isNaN(parsedDate)) {
                    lastCommsStr = timeSince(parsedDate);
                }
            }
        }

        let statusClass = 'status-normal';
        if (levelFraction <= 0.1) statusClass = 'status-critical';
        else if (levelFraction <= 0.3) statusClass = 'status-warning';

        return {
            serial,
            location: config.loc,
            name: config.name,
            levelPct: currentLevelPct.toFixed(0),
            inventoryTons: inventoryTons.toFixed(1),
            spaceToFillTons: spaceToFillTons.toFixed(1),
            lastComms: lastCommsStr,
            statusClass,
            // Group sorting keys
            locSort: config.loc
        };
    });

    // Group by location
    const groupedTanks = {};
    relevantTanks.forEach(tank => {
        if (!groupedTanks[tank.location]) {
            groupedTanks[tank.location] = [];
        }
        groupedTanks[tank.location].push(tank);
    });

    const activeOrder = getLocationOrder();
    const sortedLocations = Object.keys(groupedTanks).sort((a, b) => {
        let idxA = activeOrder.indexOf(a);
        let idxB = activeOrder.indexOf(b);
        if (idxA === -1) idxA = 999;
        if (idxB === -1) idxB = 999;
        return idxA - idxB;
    });

    sortedLocations.forEach(loc => {
        const tanksInLoc = groupedTanks[loc].sort((a, b) => a.name.localeCompare(b.name));

        let totalLocInventory = 0;
        let totalLocSpace = 0;
        tanksInLoc.forEach(t => {
            totalLocInventory += parseFloat(t.inventoryTons);
            totalLocSpace += parseFloat(t.spaceToFillTons);
        });

        const spaceReadyClass = totalLocSpace > 23 ? 'loc-space-ready' : '';

        const locHeader = document.createElement('div');
        locHeader.className = 'location-header-wrapper';
        locHeader.innerHTML = `
            <div class="location-header">${loc}</div>
            <div class="location-stats">
                <span class="loc-stat"><span class="stat-label">Inv</span> ${totalLocInventory.toFixed(1)}</span>
                <span class="loc-stat"><span class="stat-label">Space</span> <span class="${spaceReadyClass}">${totalLocSpace.toFixed(1)}</span></span>
            </div>
        `;
        tankContainer.appendChild(locHeader);

        tanksInLoc.forEach(tank => {
            const tankEl = document.createElement('div');
            tankEl.className = `tank-card ${tank.statusClass}`;

            tankEl.innerHTML = `
                <div class="card-header">
                    <div class="tank-name">${tank.name}</div>
                    <div class="last-reading">Last reading: ${tank.lastComms}</div>
                </div>
                
                <div class="progress-wrapper">
                    <div class="progress-track">
                        <div class="progress-fill" style="width: ${tank.levelPct}%"></div>
                    </div>
                    <div class="tank-percentage">${tank.levelPct}%</div>
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
            `;
            tankContainer.appendChild(tankEl);
        });
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
