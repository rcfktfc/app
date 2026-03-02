// =================================================================
// === УМНОЕ ОБЛАКО TELEGRAM (CLOUD STORAGE С ОБХОДОМ ЛИМИТА 4 КБ) ===
// =================================================================
window.AppStorage = {
    // Проверяем, доступно ли облако (если открыто в браузере вне ТГ, будет fallback на localStorage)
    isSupported: !!(window.Telegram && window.Telegram.WebApp && window.Telegram.WebApp.CloudStorage),
    
    async set(key, value) {
        if (!this.isSupported) return localStorage.setItem(key, value);

        return new Promise((resolve, reject) => {
            const chunkSize = 3500; // Безопасный размер куска (лимит ТГ - 4096 байт)
            const chunks = [];
            for (let i = 0; i < value.length; i += chunkSize) {
                chunks.push(value.slice(i, i + chunkSize));
            }
            
            // Сохраняем информацию о том, на сколько кусков разбиты данные
            window.Telegram.WebApp.CloudStorage.setItem(key + '_meta', chunks.length.toString(), (err) => {
                if (err) return reject(err);
                if (chunks.length === 0) return resolve();
                
                let saved = 0;
                chunks.forEach((chunk, idx) => {
                    window.Telegram.WebApp.CloudStorage.setItem(key + '_' + idx, chunk, (err2) => {
                        if (err2) reject(err2);
                        saved++;
                        if (saved === chunks.length) resolve(); // Все куски успешно загружены
                    });
                });
            });
        });
    },
    
    async get(key) {
        if (!this.isSupported) return localStorage.getItem(key);

        return new Promise((resolve, reject) => {
            window.Telegram.WebApp.CloudStorage.getItem(key + '_meta', (err, metaStr) => {
                if (err) return reject(err);
                
                // Если меты нет, возможно это старые данные или их вообще нет
                if (!metaStr) {
                    window.Telegram.WebApp.CloudStorage.getItem(key, (err3, oldVal) => {
                        resolve(oldVal || null);
                    });
                    return;
                }
                
                const count = parseInt(metaStr);
                if (count === 0) return resolve('');
                
                const keysToFetch = [];
                for (let i = 0; i < count; i++) keysToFetch.push(key + '_' + i);
                
                // Скачиваем все куски разом
                window.Telegram.WebApp.CloudStorage.getItems(keysToFetch, (err2, values) => {
                    if (err2) return reject(err2);
                    let fullString = '';
                    for (let i = 0; i < count; i++) {
                        fullString += (values[key + '_' + i] || '');
                    }
                    resolve(fullString); // Склеиваем и возвращаем
                });
            });
        });
    },
    
    async clearAll() {
        if (!this.isSupported) return localStorage.clear();

        return new Promise((resolve, reject) => {
            window.Telegram.WebApp.CloudStorage.getKeys((err, keys) => {
                if (err) return reject(err);
                if (!keys || keys.length === 0) return resolve();
                window.Telegram.WebApp.CloudStorage.removeItems(keys, (err2) => {
                    if (err2) reject(err2);
                    resolve();
                });
            });
        });
    }
};

// =================================================================
// === ИНИЦИАЛИЗАЦИЯ TELEGRAM И РОУТЕР (МЕНЮ) ===
// =================================================================
document.addEventListener('DOMContentLoaded', function() {
    if (window.Telegram && window.Telegram.WebApp) {
        const tg = window.Telegram.WebApp;
        tg.ready();
        tg.expand();

        const tgUser = tg.initDataUnsafe?.user;
        if (tgUser) {
            const firstName = tgUser.first_name || '';
            const lastName = tgUser.last_name || '';
            const fullName = `${firstName} ${lastName}`.trim() || 'Telegram User';
            const username = tgUser.username ? `@${tgUser.username}` : 'No username';
            const photoUrl = tgUser.photo_url; 

            const profileNameEl = document.querySelector('.profile-name');
            if (profileNameEl) profileNameEl.textContent = fullName;
            const profileEmailEl = document.querySelector('.profile-email');
            if (profileEmailEl) profileEmailEl.textContent = username;

            const fullNameInput = document.getElementById('full-name');
            if (fullNameInput) fullNameInput.value = fullName;
            const emailInput = document.getElementById('email');
            if (emailInput) {
                emailInput.value = username;
                emailInput.type = "text"; 
                const emailLabel = emailInput.previousElementSibling;
                if (emailLabel && emailLabel.tagName.toLowerCase() === 'LABEL') emailLabel.textContent = 'Telegram Username';
            }

            const sidebarAccountSpan = document.querySelector('.account-text');
            if (sidebarAccountSpan) {
                // Если имя есть - пишем его, если пустое - пишем "Account"
                sidebarAccountSpan.textContent = firstName.trim() ? firstName.trim() : 'Account';
            }

            if (photoUrl) {
                const avatars = document.querySelectorAll('.big-avatar, .avatar-mini');
                avatars.forEach(avatar => {
                    avatar.style.backgroundImage = `url(${photoUrl})`;
                    avatar.style.backgroundSize = 'cover';
                    avatar.style.backgroundPosition = 'center';
                });
            }
        }
    }

    const navLinks = document.querySelectorAll('.nav-link');
    const pages = document.querySelectorAll('.page');

    function showPage(pageId) {
        pages.forEach(page => page.classList.remove('active'));
        navLinks.forEach(link => link.classList.remove('active'));

        const targetPage = document.getElementById('page-' + pageId);
        if (targetPage) targetPage.classList.add('active');

        const activeLinks = document.querySelectorAll(`.nav-link[data-page="${pageId}"]`);
        activeLinks.forEach(link => link.classList.add('active'));
        
        if (window.innerWidth <= 900) document.body.classList.add('sidebar-closed');

        document.dispatchEvent(new CustomEvent('pageOpened', { detail: pageId }));
        window.dispatchEvent(new Event('resize'));
    }

    document.addEventListener('click', function(event) {
        const link = event.target.closest('.nav-link');
        if (link) {
            const pageId = link.getAttribute('data-page');
            if (pageId) showPage(pageId);
        }
    });

    showPage('main');

    const sidebarToggleBtns = document.querySelectorAll('.sidebar-toggle-btn');
    sidebarToggleBtns.forEach(btn => {
        btn.addEventListener('click', () => document.body.classList.toggle('sidebar-closed'));
    });

    const sidebarWrapper = document.querySelector('.sidebar-wrapper');
    if (sidebarWrapper) {
        sidebarWrapper.addEventListener('click', function(e) {
            if (e.target === sidebarWrapper) document.body.classList.add('sidebar-closed');
        });
    }
});


// =================================================================
// === СТРАНИЦА ANALYTICS ===
// =================================================================
document.addEventListener('DOMContentLoaded', () => {
    let assetHistory = {};
    let assetMeta = {};
    let activeTimeframe = 7;

    const analyticsContent = document.getElementById('analytics-content');
    const noDataMessage = document.getElementById('no-data-message');
    const mainChartContainer = document.getElementById('main-performance-chart');

    function parseDate(dateStr) { return dateStr ? new Date(dateStr) : null; }

    function findValueAtDate(history, targetDate) {
        let value = 0;
        if (!history || !targetDate) return 0;
        for (let i = history.length - 1; i >= 0; i--) {
            const recordDate = parseDate(history[i].date);
            if (recordDate && recordDate <= targetDate) { value = history[i].value; break; }
        }
        return value;
    }

    function formatCurrency(value, showSign = false) {
        if (typeof value !== 'number' || isNaN(value)) return showSign ? '+ $0.00' : '$0.00';
        const sign = value >= 0 ? '+' : '-';
        const formatted = `$${Math.abs(value).toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
        return showSign ? `${sign} ${formatted}` : formatted;
    }

    function formatDate(dateObj) {
        if (!dateObj) return '';
        const day = dateObj.getDate().toString().padStart(2, '0');
        const month = (dateObj.getMonth() + 1).toString().padStart(2, '0');
        return `${day}.${month}`;
    }

    async function loadData() {
        try {
            const portfolioDataRaw = await AppStorage.get('portfolioData');
            if (portfolioDataRaw) {
                const parsed = JSON.parse(portfolioDataRaw);
                assetMeta = parsed.assetMeta || {};
                assetHistory = parsed.assetHistory || {};
                return true;
            }
        } catch (e) { console.error("Ошибка загрузки аналитики:", e); }
        assetMeta = {}; assetHistory = {};
        return false;
    }

    function processData(days) {
        const endDate = new Date();
        let periodStartDate = new Date();
        if (days > 0) {
            periodStartDate.setDate(endDate.getDate() - (days - 1));
        } else {
            let firstDateEver = new Date();
            Object.values(assetHistory).forEach(h => {
                if (h && h.length > 0) { const d = parseDate(h[0].date); if (d && d < firstDateEver) firstDateEver = d; }
            });
            periodStartDate = firstDateEver;
        }
        periodStartDate.setHours(0, 0, 0, 0);

        const comparisonDate = new Date(periodStartDate);
        comparisonDate.setDate(comparisonDate.getDate() - 1);
        
        const assetPerformance = {};
        let totalCurrentValue = 0, totalGainLoss = 0;

        Object.keys(assetMeta).forEach(id => {
            const history = assetHistory[id];
            if (!history || history.length === 0) return;
            const currentValue = history[history.length - 1].value;
            const creationDate = parseDate(history[0].date);
            const creationValue = history[0].value;
            
            let startValue = (days === 0) ? creationValue : ((creationDate >= periodStartDate) ? creationValue : findValueAtDate(history, comparisonDate));
            const changeValue = currentValue - startValue;
            let changePercent = (startValue > 0) ? (changeValue / startValue) * 100 : null;
            
            assetPerformance[id] = { name: assetMeta[id].name, category: assetMeta[id].category, currentValue, changeValue, changePercent };
            totalGainLoss += changeValue;
            totalCurrentValue += currentValue;
        });
        
        const sortedAssets = Object.values(assetPerformance).sort((a, b) => b.changeValue - a.changeValue);
        const bestPerformer = sortedAssets[0] || { name: 'N/A', changeValue: 0 };
        const worstPerformer = sortedAssets[sortedAssets.length - 1] || { name: 'N/A', changeValue: 0 };
        const totalStartValue = totalCurrentValue - totalGainLoss;
        const kpiData = { totalValue: totalCurrentValue, totalGainLoss, totalGainLossPercent: (totalStartValue > 0) ? (totalGainLoss / totalStartValue) * 100 : 0, bestPerformer, worstPerformer };
        
        const allPoints = [];
        Object.values(assetHistory).forEach(h => { if (h) allPoints.push(...h.map(p => parseDate(p.date))); });
        const uniqueTimestamps = [...new Set(allPoints.filter(Boolean).map(d => d.getTime()))];

        let historyTimestamps;
        if (days > 0) {
            historyTimestamps = uniqueTimestamps.filter(ts => ts >= periodStartDate.getTime() && ts <= endDate.getTime());
            let anchorTs = 0;
            uniqueTimestamps.forEach(ts => { if (ts < periodStartDate.getTime() && ts > anchorTs) anchorTs = ts; });
            if (anchorTs > 0) historyTimestamps.unshift(anchorTs);
        } else { historyTimestamps = uniqueTimestamps; }
        
        historyTimestamps.sort((a,b) => a - b);
        
        const aggregatedHistory = [...new Set(historyTimestamps)].map(timestamp => {
            const dateObj = new Date(timestamp);
            let dailyTotal = 0;
            Object.keys(assetMeta).forEach(id => { dailyTotal += findValueAtDate(assetHistory[id], dateObj); });
            return { date: dateObj, value: dailyTotal };
        });

        return { kpiData, aggregatedHistory, assetPerformance };
    }

    function renderAnalytics() {
        const { kpiData, aggregatedHistory, assetPerformance } = processData(activeTimeframe);
        if ((!kpiData.totalValue && kpiData.totalValue !== 0) || Object.keys(kpiData).length === 0) {
            mainChartContainer.innerHTML = '<p style="text-align:center; color: var(--text-sec); padding-top: 50px;">No data to display.</p>';
            return;
        }
        
        document.getElementById('kpi-total-value').textContent = formatCurrency(kpiData.totalValue);
        document.getElementById('kpi-gain-loss').textContent = formatCurrency(kpiData.totalGainLoss, true);
        document.getElementById('kpi-gain-loss').className = `kpi-value ${kpiData.totalGainLoss >= 0 ? 'green' : 'red'}`;
        document.getElementById('kpi-gain-loss-percent').textContent = `(${kpiData.totalGainLossPercent.toFixed(2)}%)`;
        document.getElementById('kpi-gain-loss-percent').className = `kpi-sub ${kpiData.totalGainLoss >= 0 ? 'green' : 'red'}`;
        document.getElementById('kpi-best-performer').textContent = kpiData.bestPerformer.name;
        document.getElementById('kpi-best-performer-change').textContent = formatCurrency(kpiData.bestPerformer.changeValue, true);
        document.getElementById('kpi-worst-performer').textContent = kpiData.worstPerformer.name;
        document.getElementById('kpi-worst-performer-change').textContent = formatCurrency(kpiData.worstPerformer.changeValue, true);

        renderMainChart(aggregatedHistory);
        renderAssetTable(assetPerformance);
    }

    function renderMainChart(history) {
        if (!history || history.length < 2) {
            mainChartContainer.innerHTML = '<p style="text-align:center; color: var(--text-sec); padding-top: 50px;">Not enough data.</p>'; return;
        }
        const width = mainChartContainer.offsetWidth; if (width === 0) return;
        const height = 350, padding = 40;
        const values = history.map(h => h.value), maxVal = Math.max(...values, 0), minVal = 0;

        const points = history.map((point, index) => {
            const x = history.length === 1 ? width / 2 : padding + (index / (history.length - 1)) * (width - (padding * 2));
            const y = (height - padding) - ((point.value - minVal) / (maxVal - minVal || 1)) * (height - (padding * 2));
            return { x, y, val: point.value, date: point.date };
        });

        let svgContent = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
        if (points.length > 1) svgContent += `<polyline points="${points.map(p => `${p.x},${p.y}`).join(' ')}" class="graph-line" />`;

        const pointsToShow = new Set([0, points.length - 1]);
        if (points.length <= 10) for (let i = 0; i < points.length; i++) pointsToShow.add(i);
        points.forEach((p, i) => {
            if (pointsToShow.has(i)) {
                svgContent += `<circle cx="${p.x}" cy="${p.y}" r="4" class="graph-point" /><text x="${p.x}" y="${height - 15}" class="graph-text">${formatDate(p.date)}</text><text x="${p.x}" y="${p.y - 10}" class="graph-text" style="font-weight:bold">${formatCurrency(p.val)}</text>`;
            }
        });
        svgContent += `</svg>`;
        mainChartContainer.innerHTML = svgContent;
    }
    
    function renderAssetTable(assetPerformance) {
        const sortedAssets = Object.values(assetPerformance).sort((a, b) => b.currentValue - a.currentValue);
        if (sortedAssets.length === 0) {
            document.getElementById('asset-performance-tbody').innerHTML = '<tr><td colspan="5" style="text-align: center; color: var(--text-sec);">No assets</td></tr>'; return;
        }
        document.getElementById('asset-performance-tbody').innerHTML = sortedAssets.map(asset => {
            const changeClass = asset.changeValue >= 0 ? 'change-positive' : 'change-negative';
            const percentString = asset.changePercent === null ? '---' : `${asset.changePercent.toFixed(2)}%`;
            return `<tr><td>${asset.name}</td><td>${asset.category}</td><td>${formatCurrency(asset.currentValue)}</td><td class="${changeClass}">${formatCurrency(asset.changeValue, true)}</td><td class="${changeClass}">${percentString}</td></tr>`;
        }).join('');
    }

    async function main() {
        const hasData = await loadData();
        if (hasData && Object.keys(assetMeta).length > 0) {
            analyticsContent.style.display = 'block'; noDataMessage.style.display = 'none';
            renderAnalytics();
        } else {
            analyticsContent.style.display = 'none'; noDataMessage.style.display = 'block';
        }
    }
    
    document.querySelectorAll('.time-filter-btn').forEach(button => {
        button.addEventListener('click', () => {
            document.querySelectorAll('.time-filter-btn').forEach(btn => btn.classList.remove('active'));
            button.classList.add('active'); activeTimeframe = parseInt(button.dataset.days); renderAnalytics();
        });
    });
    window.addEventListener('resize', renderAnalytics);

    document.addEventListener('pageOpened', (e) => {
        if (e.detail === 'analytics') main(); 
    });

    main();
});


// =================================================================
// === СТРАНИЦА MAIN (Dashboard) ===
// =================================================================
let pies = [];
let activePieId = null;
let portfolioDataMain = { assetMeta: {}, assetHistory: {} }; 

const amountDisplay = document.getElementById('display-amount');
const hoverCategoryName = document.getElementById('hover-category-name');
const pieContainer = document.getElementById('pie-svg-container');
const breakdownList = document.getElementById('breakdown-list');
const pieSelectorContainer = document.getElementById('pie-selector-container');
const trendPath = document.getElementById('trend-path');
const hintText = document.getElementById('hint-text');

async function saveMainData() {
    await AppStorage.set('fiMaxPies', JSON.stringify({ pies, activePieId }));
}

async function loadMainData() {
    const pieData = await AppStorage.get('fiMaxPies');
    if (pieData) {
        const parsed = JSON.parse(pieData);
        pies = parsed.pies || []; activePieId = parsed.activePieId;
    } else { pies = []; activePieId = null; }

    const portfolioDataRaw = await AppStorage.get('portfolioData');
    if (portfolioDataRaw) {
        const parsed = JSON.parse(portfolioDataRaw);
        portfolioDataMain.assetMeta = parsed.assetMeta || {};
        portfolioDataMain.assetHistory = parsed.assetHistory || {};
    } else { portfolioDataMain = { assetMeta: {}, assetHistory: {} }; }
    
    if (!activePieId || !pies.find(p => p.id === activePieId)) activePieId = pies.length > 0 ? pies[0].id : null;
}

const openModal = (modalId) => document.getElementById(modalId).classList.add('active');
const closeModal = (modalId) => document.getElementById(modalId).classList.remove('active');

document.getElementById('openAddPieModal').onclick = () => openModal('modalAddPie');
document.getElementById('confirm-add-pie').onclick = async () => await addPie();
document.getElementById('openAddAssetModal').onclick = () => {
    const assetSelectionList = document.getElementById('asset-selection-list');
    assetSelectionList.innerHTML = '';
    const activePie = pies.find(p => p.id === activePieId);
    if (!activePie) {
        assetSelectionList.innerHTML = '<p style="color: var(--text-sec); text-align: center;">Create a pie first.</p>';
        openModal('modalAddAsset'); return;
    }
    const assetsInPieIds = activePie.assets.map(a => a.id);
    const availableAssets = Object.keys(portfolioDataMain.assetMeta).filter(id => !assetsInPieIds.includes(id));
    if (availableAssets.length === 0) {
        assetSelectionList.innerHTML = '<p style="color: var(--text-sec); text-align: center;">No new assets available.</p>';
    } else {
        availableAssets.forEach(id => {
            const meta = portfolioDataMain.assetMeta[id]; const history = portfolioDataMain.assetHistory[id];
            if (!meta || !history || history.length === 0) return;
            const value = history[history.length - 1].value;
            const item = document.createElement('div');
            item.className = 'asset-to-add-item';
            item.innerHTML = `<span>${meta.name} (${meta.category})</span><b>$${value.toLocaleString()}</b>`;
            item.onclick = async () => await addAssetToPie(id);
            assetSelectionList.appendChild(item);
        });
    }
    openModal('modalAddAsset');
};

window.addEventListener('click', (e) => { 
    if (e.target.classList.contains('modal-overlay')) e.target.classList.remove('active'); 
});

function getTimestamp() { return new Date().toISOString(); }

async function addPie() {
    const name = document.getElementById('new-pie-name').value.trim();
    if (!name) return alert('Please enter a name.');
    const newPie = { id: `pie-${Date.now()}`, name, assets: [], history: [{ date: getTimestamp(), value: 0 }] };
    pies.push(newPie); activePieId = newPie.id;
    document.getElementById('new-pie-name').value = '';
    closeModal('modalAddPie');
    await saveMainData();
    renderMainPage();
}

async function addAssetToPie(assetId) {
    const activePie = pies.find(p => p.id === activePieId);
    if (!activePie) return;
    const meta = portfolioDataMain.assetMeta[assetId];
    const value = portfolioDataMain.assetHistory[assetId][portfolioDataMain.assetHistory[assetId].length - 1].value;
    activePie.assets.push({ id: assetId, name: meta.name, amount: value, category: meta.category });
    updatePieHistory(activePie);
    closeModal('modalAddAsset');
    await saveMainData();
    renderMainPage();
}

async function deleteAssetFromPie(assetId) {
    const activePie = pies.find(p => p.id === activePieId);
    if (!activePie) return;
    activePie.assets = activePie.assets.filter(asset => asset.id !== assetId);
    updatePieHistory(activePie);
    await saveMainData();
    renderMainPage();
}

async function deletePie(pieIdToDelete) {
    if (!confirm(`Delete this pie?`)) return;
    pies = pies.filter(p => p.id !== pieIdToDelete);
    if (activePieId === pieIdToDelete) activePieId = pies.length > 0 ? pies[0].id : null;
    await saveMainData();
    renderMainPage();
}

function updatePieHistory(pie) {
    const newTotal = pie.assets.reduce((sum, asset) => sum + asset.amount, 0);
    pie.history.push({ date: getTimestamp(), value: newTotal });
}

function renderMainPage() {
    renderPieSelectors();
    const activePie = pies.find(p => p.id === activePieId);

    if (!activePie) {
        amountDisplay.innerText = '$0'; hoverCategoryName.innerText = 'Total Balance';
        pieContainer.innerHTML = pieContainer.querySelector('defs').outerHTML;
        breakdownList.innerHTML = '<p style="color: var(--text-sec); text-align: center;">No pie selected.</p>';
        trendPath.setAttribute('d', 'M5,45 L195,45'); hintText.textContent = 'Create a pie to see your progress.';
        return;
    }
    
    let totalAmount = 0;
    activePie.assets.forEach(asset => {
        const history = portfolioDataMain.assetHistory[asset.id];
        if (history && history.length > 0) asset.amount = history[history.length - 1].value;
        totalAmount += asset.amount;
    });
    
    renderBreakdownList(activePie.assets);
    renderPieChart(activePie.assets);
    animateValue(amountDisplay, totalAmount);
    renderSparkline(activePie.history);
}

function renderPieSelectors() {
    pieSelectorContainer.innerHTML = '';
    pies.forEach(pie => {
        const tab = document.createElement('div'); tab.className = 'pie-selector-tab';
        if (pie.id === activePieId) tab.classList.add('active');
        const tabName = document.createElement('span'); tabName.textContent = pie.name;
        tabName.onclick = async () => { if (activePieId !== pie.id) { activePieId = pie.id; await saveMainData(); renderMainPage(); }};
        const deleteBtn = document.createElement('button'); deleteBtn.className = 'btn-delete-pie'; deleteBtn.innerHTML = '✕';
        deleteBtn.onclick = async (e) => { e.stopPropagation(); await deletePie(pie.id); };
        tab.appendChild(tabName); tab.appendChild(deleteBtn); pieSelectorContainer.appendChild(tab);
    });
}

function renderPieChart(assets) {
    pieContainer.innerHTML = pieContainer.querySelector('defs').outerHTML;
    const totalAmount = assets.reduce((sum, asset) => sum + asset.amount, 0);
    if (totalAmount === 0) return;
    let startAngle = 0;
    assets.forEach((asset) => {
        const angle = (asset.amount / totalAmount) * 360; const endAngle = startAngle + angle;
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute('class', 'sector'); path.setAttribute('id', `sector-${asset.id}`);
        path.dataset.startAngle = startAngle; path.dataset.endAngle = endAngle;
        path.setAttribute('d', getArcPath(100, startAngle, endAngle)); path.setAttribute('filter', 'url(#glass-depth)');
        path.onmouseenter = () => handleHover(path, asset.amount, `breakdown-row-${asset.id}`, asset.category);
        path.onmouseleave = () => handleReset(path, totalAmount, `breakdown-row-${asset.id}`);
        pieContainer.appendChild(path); startAngle = endAngle;
    });
}

function renderBreakdownList(assets) {
    breakdownList.innerHTML = '';
    if (assets.length === 0) { breakdownList.innerHTML = '<p style="color: var(--text-sec); text-align: center;">This pie is empty.</p>'; return; }
    const totalAmount = assets.reduce((s, a) => s + a.amount, 0);
    assets.forEach(asset => {
        const row = document.createElement('div'); row.className = 'asset-row'; row.id = `breakdown-row-${asset.id}`;
        row.innerHTML = `<span class="asset-name"><span class="dot"></span> ${asset.name} (${asset.category})</span><b class="asset-val">$${asset.amount.toLocaleString()} <button class="delete-asset-btn" onclick="deleteAssetFromPie('${asset.id}')">✕</button></b>`;
        row.onmouseenter = () => handleHover(document.getElementById(`sector-${asset.id}`), asset.amount, row.id, asset.category);
        row.onmouseleave = () => handleReset(document.getElementById(`sector-${asset.id}`), totalAmount, row.id);
        breakdownList.appendChild(row);
    });
}

function renderSparkline(history) {
    if (!history || history.length < 2) { trendPath.setAttribute('d', 'M5,45 L195,45'); hintText.textContent = `Not enough data.`; return; }
    const values = history.map(h => h.value), minVal = Math.min(...values), maxVal = Math.max(...values);
    let pathData = '';
    history.forEach((point, index) => {
        const x = (index / (history.length - 1)) * 190 + 5, y = (maxVal === minVal) ? 25 : 45 - ((point.value - minVal) / (maxVal - minVal)) * 40;
        pathData += `${index === 0 ? 'M' : 'L'}${x},${y} `;
    });
    trendPath.setAttribute('d', pathData);
    const length = trendPath.getTotalLength(); trendPath.style.strokeDasharray = length; trendPath.style.strokeDashoffset = length;
    gsap.to(trendPath, { strokeDashoffset: 0, duration: 1.5, ease: "power2.inOut" });
    const startValue = history[0].value, endValue = history[history.length - 1].value;
    if (startValue > 0) {
        const percentageChange = ((endValue - startValue) / startValue) * 100;
        hintText.textContent = `Equity grown by ${percentageChange.toFixed(1)}%`;
        hintText.style.color = percentageChange >= 0 ? 'var(--profit-green)' : 'var(--loss-red)';
    } else { hintText.textContent = `Portfolio created.`; }
}

function polarToCartesian(radius, angleInDegrees) { const a = (angleInDegrees - 90) * Math.PI / 180.0; return { x: radius * Math.cos(a), y: radius * Math.sin(a) }; }
function getArcPath(radius, startAngle, endAngle) {
    if (Math.abs(endAngle - startAngle) >= 360) endAngle = startAngle + 359.999;
    const start = polarToCartesian(radius, startAngle), end = polarToCartesian(radius, endAngle);
    const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y} L 0 0 Z`;
}

let currentAmountObj = { value: 0 };
function animateValue(displayElement, targetValue) { gsap.to(currentAmountObj, { value: targetValue, duration: 0.6, ease: "power2.out", onUpdate: () => { displayElement.innerText = '$' + Math.floor(currentAmountObj.value).toLocaleString(); } }); }
function handleHover(el, val, rowId, cat) { if (!el) return; animateValue(amountDisplay, val); hoverCategoryName.textContent = cat; document.getElementById(rowId)?.classList.add('highlight'); const sa = parseFloat(el.dataset.startAngle), ea = parseFloat(el.dataset.endAngle), mid = sa + (ea - sa) / 2, vec = polarToCartesian(8, mid); gsap.to(el, { x: vec.x, y: vec.y, duration: 0.4, ease: "power3.out", overwrite: true }); }
function handleReset(el, total, rowId) { if (!el) return; animateValue(amountDisplay, total); hoverCategoryName.textContent = 'Total Balance'; document.getElementById(rowId)?.classList.remove('highlight'); gsap.to(el, { x: 0, y: 0, duration: 0.4, ease: "power3.out", overwrite: true }); }

window.addEventListener('load', async () => {
    await loadMainData();
    renderMainPage();
    gsap.from("#page-main .card", { duration: 1.2, y: 50, opacity: 0, stagger: 0.15, ease: "power4.out" });
});

document.addEventListener('pageOpened', async (e) => {
    if (e.detail === 'main') {
        await loadMainData();
        renderMainPage();
    }
});


// =================================================================
// === СТРАНИЦА PORTFOLIO ===
// =================================================================
let globalSelectedTags = [];
let portfolioAssetHistory = {}; 
let portfolioAssetMeta = {}; 

async function saveDataToCloud() {
    try {
        const dataToSave = { assetHistory: portfolioAssetHistory, assetMeta: portfolioAssetMeta };
        await AppStorage.set('portfolioData', JSON.stringify(dataToSave));
    } catch (e) { console.error("Ошибка сохранения в облако:", e); }
}

async function loadDataFromCloud() {
    try {
        const savedData = await AppStorage.get('portfolioData');
        if (savedData) {
            const parsedData = JSON.parse(savedData);
            portfolioAssetHistory = parsedData.assetHistory || {};
            portfolioAssetMeta = parsedData.assetMeta || {};
        }
    } catch (e) { console.error("Ошибка загрузки из облака:", e); }
}

function setupButtonAnims() {
    document.querySelectorAll('button:not(.pill span)').forEach(btn => {
        btn.onmouseenter = () => gsap.to(btn, { scale: 1.03, duration: 0.2 });
        btn.onmouseleave = () => gsap.to(btn, { scale: 1, duration: 0.2 });
    });
}

function calculateGroupTotal(assetName) {
    let total = 0;
    Object.keys(portfolioAssetMeta).forEach(id => {
        if (portfolioAssetMeta[id].name === assetName) {
            const history = portfolioAssetHistory[id];
            if (history && history.length > 0) total += history[history.length - 1].value;
        }
    });
    return total;
}

function updateAllGroupTotals(assetName) {
    const formattedTotal = calculateGroupTotal(assetName).toFixed(2);
    Object.keys(portfolioAssetMeta).forEach(id => {
        if (portfolioAssetMeta[id].name === assetName) {
            const el = document.getElementById(`amount-display-${id}`);
            if (el) el.textContent = formattedTotal;
        }
    });
}

function updateDashboard() {
    const totalEl = document.getElementById('globalTotalDisplay'); const catContainer = document.getElementById('categoryBreakdown');
    if(!totalEl || !catContainer) return;
    let globalSum = 0; let catSums = {};
    Object.keys(portfolioAssetMeta).forEach(id => {
        const history = portfolioAssetHistory[id];
        if (history && history.length > 0) {
            const currentVal = history[history.length - 1].value; const category = portfolioAssetMeta[id].category;
            globalSum += currentVal; if (!catSums[category]) catSums[category] = 0; catSums[category] += currentVal;
        }
    });
    totalEl.textContent = `$${globalSum.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}`;
    if (Object.keys(catSums).length === 0) { catContainer.innerHTML = `<span style="color:#444; font-size:12px;">No active assets</span>`; } 
    else { catContainer.innerHTML = Object.keys(catSums).map(cat => `<div class="stat-card"><span class="stat-label">${cat}</span><div class="stat-val">$${catSums[cat].toLocaleString('en-US', {minimumFractionDigits: 2})}</div></div>`).join(''); }
}

function selectTag(name) { if (!globalSelectedTags.find(t => t.name === name)) { globalSelectedTags.push({ name: name, price: "" }); renderGlobalTags(); } }
function handleTagInput(e) { if (e.key === 'Enter' && e.target.value.trim()) { selectTag(e.target.value.trim()); e.target.value = ''; } }

function renderGlobalTags() {
    const container = document.getElementById('activeTags'); if (!container) return;
    container.innerHTML = globalSelectedTags.map((t, index) => {
        const displayPrice = t.price ? `$${t.price}` : '$0.00'; 
        return `<div class="rec-wrapper" style="display:inline-block; margin-right:8px; margin-bottom:8px;">
            <div class="pill" style="background: rgba(255,255,255,0.05); border-color: #fff;" onclick="event.stopPropagation(); togglePricePop(${index})">
                ${t.name} <span style="font-size:10px; opacity:0.6; margin-left:6px;">${displayPrice}</span>
                <span class="remove-tag-btn" onclick="event.stopPropagation(); removeGlobalTag('${t.name}')">✕</span>
            </div>
            <div class="rec-popover" id="price-pop-${index}" onclick="event.stopPropagation()">
                <span class="card-label">Set Value for ${t.name}</span>
                <input type="number" id="input-price-${index}" class="custom-tag-input" style="width:100%; margin-bottom:12px;" value="${t.price}" placeholder="0.00" onkeydown="if(event.key === 'Enter') { event.preventDefault(); savePrice(${index}); }">
                <button class="tag-white" style="width:100%" onclick="savePrice(${index})">Save Value</button>
            </div></div>`;
    }).join('');
}

function togglePricePop(index) { document.querySelectorAll('.rec-popover').forEach(p => p.classList.remove('active')); document.getElementById(`price-pop-${index}`).classList.add('active'); setTimeout(() => { const input = document.getElementById(`input-price-${index}`); if(input) input.focus(); }, 50); }
function savePrice(index) { globalSelectedTags[index].price = document.getElementById(`input-price-${index}`).value; renderGlobalTags(); closeAllPops(); }
function removeGlobalTag(name) { if (confirm(`Remove category "${name}"?`)) { globalSelectedTags = globalSelectedTags.filter(t => t.name !== name); renderGlobalTags(); } }

async function distributeByCategories() {
    const nameInp = document.getElementById('newAssetName'); const amountInp = document.getElementById('newAssetAmount');
    const name = nameInp.value.trim() || 'New Asset'; const totalAmount = parseFloat(amountInp.value) || 0;
    if (globalSelectedTags.length === 0) return alert("Select at least one category!");
    const currentSum = globalSelectedTags.reduce((sum, tag) => sum + (parseFloat(tag.price) || 0), 0);
    if (currentSum > totalAmount) return alert(`Error: Sum (${currentSum}) exceeds Total (${totalAmount})!`);
    
    globalSelectedTags.forEach(cat => createAssetCard(cat.name, name, cat.price, totalAmount, false));
    nameInp.value = ''; amountInp.value = ''; globalSelectedTags = []; renderGlobalTags(); updateDashboard();
    
    await saveDataToCloud();
}

function createAssetCard(catName, assetName, initialValue, amount, isInitialLoad, existingId) {
    const bento = document.getElementById('portfolioBento');
    if (!bento) return;
    const id = existingId || "asset-" + Math.floor(Math.random() * 1000000);
    
    if (!isInitialLoad) {
        portfolioAssetHistory[id] = [{
            date: getTimestamp(),
            value: parseFloat(initialValue) || 0
        }];
        portfolioAssetMeta[id] = { category: catName, name: assetName };
    }

    const currentGroupTotal = calculateGroupTotal(assetName);

    const card = document.createElement('div');
    card.className = 'card';
    card.id = id;
    
    // ИСПРАВЛЕНИЕ: Кнопка со старым дизайном (del-btn), но позиционированная сверху справа (pos-top-right)
    card.innerHTML = `
        <button class="del-btn pos-top-right" onclick="removeCard('${id}')" title="Delete Asset">✕</button>
        
        <h3 class="card-label" style="padding-right: 50px;">Category: ${catName}</h3>
        <table class="asset-table">
            <thead>
                <tr>
                    <th style="width: 35%">Asset Name</th>
                    <th style="width: 20%">Value</th>
                    <th style="width: 20%">Total Amount</th>
                    <th style="width: 25%; text-align:right">Actions</th>
                </tr>
            </thead>
            <tbody>
                <tr>
                    <td>
                        <div style="font-weight:800; font-size:18px;">${assetName}</div>
                        <div class="sub-tags-container" id="sub-tags-${id}"></div>
                    </td>
                    <td><div class="price-text" id="val-display-${id}">${parseFloat(initialValue).toFixed(2)}</div></td>
                    <td><div class="amount-text" id="amount-display-${id}">${currentGroupTotal.toFixed(2)}</div></td>
                    <td>
                        <div class="actions-cell-content">
                            <button class="det-btn" onclick="toggleDetails('${id}')">Details</button>
                            
                            <div class="rec-wrapper">
                                <button class="rec-btn" onclick="event.stopPropagation(); toggleRecs('${id}')">Recommendations</button>
                                <div class="rec-popover" id="pop-${id}" onclick="event.stopPropagation()">
                                    <span class="card-label">Quick Labels</span>
                                    <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:12px;">
                                        <button class="tag-white" onclick="addSubTag('${id}', 'HODL')">HODL</button>
                                        <button class="tag-white" onclick="addSubTag('${id}', 'High Risk')">High Risk</button>
                                    </div>
                                    <input type="text" id="sub-tag-input-${id}" class="custom-tag-input" placeholder="+ sub-tag" onkeydown="handleSubTagInput(event, '${id}')">
                                </div>
                            </div>
                            
                            <div class="rec-wrapper">
                                <button class="edit-btn" onclick="event.stopPropagation(); toggleEdit('${id}')">✎</button>
                                <div class="rec-popover" id="edit-pop-${id}" onclick="event.stopPropagation()">
                                    <span class="card-label">Update Value</span>
                                    <input type="number" id="edit-input-${id}" class="custom-tag-input" 
                                           style="width:100%; margin-bottom:12px;" value="" placeholder="New Value"
                                           onkeydown="if(event.key === 'Enter') { event.preventDefault(); saveAssetEdit('${id}'); }">
                                    <button class="tag-white" style="width:100%" onclick="saveAssetEdit('${id}')">Update</button>
                                </div>
                            </div>
                            
                        </div>
                    </td>
                </tr>
                <tr id="det-row-${id}" class="details-row">
                    <td colspan="4">
                        <div class="details-box">
                            <span class="card-label">Performance Graph</span>
                            <div class="graph-container" id="graph-${id}"></div>
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
    `;
    
    bento.appendChild(card);
    
    if (!isInitialLoad) {
        gsap.from(card, { y: 20, opacity: 0, duration: 0.3 });
        updateAllGroupTotals(assetName);
    }
    
    setTimeout(() => renderGraph(id), 100);
}

function toggleDetails(id) { const row = document.getElementById(`det-row-${id}`); row.style.display = row.style.display === 'table-row' ? 'none' : 'table-row'; if (row.style.display === 'table-row') renderGraph(id); }
function toggleRecs(id) { closeAllPops(); document.getElementById(`pop-${id}`).classList.add('active'); setTimeout(() => { const input = document.getElementById(`sub-tag-input-${id}`); if(input) input.focus(); }, 50); }
function toggleEdit(id) { closeAllPops(); document.getElementById(`edit-pop-${id}`).classList.add('active'); setTimeout(() => { const input = document.getElementById(`edit-input-${id}`); if(input) { input.value = ''; input.focus(); } }, 50); }
function closeAllPops() { document.querySelectorAll('.rec-popover').forEach(p => p.classList.remove('active')); }

async function removeCard(id) {
    const assetName = portfolioAssetMeta[id] ? portfolioAssetMeta[id].name : 'this asset';
    if (!confirm(`Are you sure you want to delete "${assetName}"? This action cannot be undone.`)) return; 
    
    delete portfolioAssetHistory[id]; delete portfolioAssetMeta[id];
    const el = document.getElementById(id); if (el) el.remove();
    if (assetName) updateAllGroupTotals(assetName);
    
    updateDashboard();
    await saveDataToCloud();
}

async function saveAssetEdit(id) {
    const newVal = parseFloat(document.getElementById(`edit-input-${id}`).value); if (isNaN(newVal)) return;
    portfolioAssetHistory[id].push({ date: getTimestamp(), value: newVal });
    document.getElementById(`val-display-${id}`).textContent = newVal.toFixed(2);
    updateAllGroupTotals(portfolioAssetMeta[id].name);
    renderGraph(id); updateDashboard(); closeAllPops();
    await saveDataToCloud();
}

function renderGraph(id) {
    const container = document.getElementById(`graph-${id}`); if (!container) return;
    const history = portfolioAssetHistory[id]; if (!history || history.length === 0) return;
    const width = container.offsetWidth || 600, height = 180, padding = 20;
    const values = history.map(h => h.value), maxVal = Math.max(...values, 10), minVal = 0;
    const points = history.map((point, index) => {
        const x = history.length === 1 ? width / 2 : padding + (index / (history.length - 1)) * (width - 2 * padding), y = height - padding - ((point.value - minVal) / (maxVal - minVal)) * (height - 2 * padding), dateObj = new Date(point.date);
        return { x, y, val: point.value, date: `${dateObj.getDate().toString().padStart(2, '0')}.${(dateObj.getMonth() + 1).toString().padStart(2, '0')}` };
    });
    let svgContent = `<svg width="100%" height="100%" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;
    if (points.length > 1) svgContent += `<polyline points="${points.map(p => `${p.x},${p.y}`).join(' ')}" class="graph-line" />`;
    points.forEach(p => { svgContent += `<circle cx="${p.x}" cy="${p.y}" r="4" class="graph-point" /><text x="${p.x}" y="${height - 5}" class="graph-text">${p.date}</text><text x="${p.x}" y="${p.y - 10}" class="graph-text" style="font-weight:bold">${p.val}</text>`; });
    svgContent += `</svg>`; container.innerHTML = svgContent;
}

function addSubTag(cardId, name) { const container = document.getElementById(`sub-tags-${cardId}`); const pill = document.createElement('div'); pill.className = 'sub-pill'; pill.innerHTML = `${name} <span onclick="this.parentElement.remove()">✕</span>`; container.appendChild(pill); }
function handleSubTagInput(e, id) { if (e.key === 'Enter' && e.target.value.trim()) { addSubTag(id, e.target.value.trim()); e.target.value = ''; } }

document.addEventListener('click', () => closeAllPops());

window.addEventListener('load', async () => {
    await loadDataFromCloud();
    Object.keys(portfolioAssetMeta).forEach(id => {
        const meta = portfolioAssetMeta[id]; const history = portfolioAssetHistory[id];
        if (meta && history && history.length > 0) createAssetCard(meta.category, meta.name, history[history.length - 1].value, 0, true, id);
    });
    setupButtonAnims(); updateDashboard();
});

window.addEventListener('resize', () => { Object.keys(portfolioAssetHistory).forEach(id => renderGraph(id)); });

document.addEventListener('pageOpened', async (e) => {
    if (e.detail === 'portfolio') {
        await loadDataFromCloud();
        updateDashboard();
    }
});

// =================================================================
// === СТРАНИЦА SETTINGS (ПРОМОКОДЫ И НАСТРОЙКИ) ===
// =================================================================
document.addEventListener('DOMContentLoaded', () => {
    const currencySelect = document.getElementById('currency-select');
    const notificationToggles = document.querySelectorAll('.notification-toggle');
    const clearDataBtn = document.getElementById('clear-data-btn');
    
    // Элементы для промокодов возвращены!
    const promoCodeInput = document.getElementById('promo-code-input');
    const applyPromoBtn = document.getElementById('apply-promo-btn');

    let settings = {};

    async function loadSettings() {
        const savedSettings = JSON.parse(await AppStorage.get('appSettings')) || {};
        settings = { currency: savedSettings.currency || 'USD', 'notif-summary': savedSettings['notif-summary'] !== false };
        if(currencySelect) currencySelect.value = settings.currency;
        if(notificationToggles) notificationToggles.forEach(toggle => { toggle.checked = settings[toggle.dataset.key]; });
    }
    
    async function saveSettings() {
        await AppStorage.set('appSettings', JSON.stringify(settings));
    }

    // ЛОГИКА ПРОМОКОДОВ ВОЗВРАЩЕНА!
    function applyPromoCode() {
        if(!promoCodeInput) return;
        const code = promoCodeInput.value.trim().toUpperCase();
        if (!code) {
            alert('Please enter a promo code.');
            return;
        }
        const validCodes = ['PRO100', 'SAVE20', 'SPECIAL'];
        if (validCodes.includes(code)) {
            alert(`✅ Promo code "${code}" applied successfully!`);
        } else {
            alert(`❌ Invalid promo code.`);
        }
        promoCodeInput.value = '';
    }

    if(currencySelect) {
        currencySelect.addEventListener('change', async () => {
            settings.currency = currencySelect.value;
            await saveSettings();
        });
    }

    if(notificationToggles) {
        notificationToggles.forEach(toggle => {
            toggle.addEventListener('change', async () => {
                settings[toggle.dataset.key] = toggle.checked;
                await saveSettings();
            });
        });
    }

    if(clearDataBtn) {
        clearDataBtn.addEventListener('click', async () => {
            if (confirm('ARE YOU ABSOLUTELY SURE?\nThis will permanently delete your portfolio data from the Telegram Cloud. This action cannot be undone.')) {
                await AppStorage.clearAll();
                alert('Your application data has been cleared from the Cloud.');
                location.reload();
            }
        });
    }

    // Подключаем слушатель на кнопку промокода
    if(applyPromoBtn) {
        applyPromoBtn.addEventListener('click', applyPromoCode);
    }

    loadSettings();
});
