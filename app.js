// ===== 設定 =====
const TIME_SLOTS = [
    { id: 5, label: '⑤', time: '15:50~' },
    { id: 6, label: '⑥', time: '17:20~' },
    { id: 7, label: '⑦', time: '18:50~' },
    { id: 8, label: '⑧', time: '20:20~' },
];

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const ROWS_PER_SLOT = 4; // 各時限のブース数

// ===== 状態管理 =====
let scheduleData = {}; // { "2026-04-06": { "5-0-mon": "生徒名", ... } }
let currentWeekStart = getMonday(new Date());
let githubScheduleSha = null;
let githubToken = localStorage.getItem('timetable_github_token') || '';
let saveTimeout = null;
let isSaving = false;

// ===== DOM要素 =====
const scheduleBody = document.getElementById('scheduleBody');
const weekLabel = document.getElementById('weekLabel');
const settingsBtn = document.getElementById('settingsBtn');
const settingsSection = document.getElementById('settingsSection');
const tokenInput = document.getElementById('githubToken');
const saveTokenBtn = document.getElementById('saveTokenBtn');
const syncStatus = document.getElementById('syncStatus');
const loadingOverlay = document.getElementById('loadingOverlay');
const saveIndicator = document.getElementById('saveIndicator');
const saveIndicatorText = document.getElementById('saveIndicatorText');

// ===== ユーティリティ =====

// 指定日の週の月曜日を取得
function getMonday(date) {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
}

// 日付を YYYY-MM-DD 形式に
function formatDateKey(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

// 週のラベル表示 (例: 4/6(月) 〜 4/11(土))
function formatWeekLabel(monday) {
    const sat = new Date(monday);
    sat.setDate(sat.getDate() + 5);

    const mMonth = monday.getMonth() + 1;
    const mDate = monday.getDate();
    const sMonth = sat.getMonth() + 1;
    const sDate = sat.getDate();

    return `${mMonth}/${mDate}(月) 〜 ${sMonth}/${sDate}(土)`;
}

// 今日の曜日キーを取得 (mon, tue, ...)
function getTodayDayKey() {
    const dayIndex = new Date().getDay(); // 0=日, 1=月, ...
    const map = { 1: 'mon', 2: 'tue', 3: 'wed', 4: 'thu', 5: 'fri', 6: 'sat' };
    return map[dayIndex] || null;
}

// 表示中の週が今週かどうか
function isCurrentWeek() {
    const thisMonday = getMonday(new Date());
    return formatDateKey(currentWeekStart) === formatDateKey(thisMonday);
}

// 現在の週のデータを取得
function getCurrentWeekData() {
    const key = formatDateKey(currentWeekStart);
    if (!scheduleData[key]) {
        scheduleData[key] = {};
    }
    return scheduleData[key];
}

// ===== テーブル構築 =====
function buildTable() {
    scheduleBody.innerHTML = '';
    const weekData = getCurrentWeekData();
    const todayKey = isCurrentWeek() ? getTodayDayKey() : null;

    // 今日の列をハイライト
    DAYS.forEach(day => {
        const th = document.getElementById(`dayHead-${day}`);
        if (th) {
            th.classList.toggle('day-today', day === todayKey);
        }
    });

    TIME_SLOTS.forEach(slot => {
        for (let row = 0; row < ROWS_PER_SLOT; row++) {
            const tr = document.createElement('tr');
            tr.className = `slot-${slot.id}`;
            if (row === 0) tr.classList.add('slot-group-first');

            // 時限ラベル（最初の行だけ rowSpan で結合）
            if (row === 0) {
                const th = document.createElement('td');
                th.className = `slot-label slot-${slot.id}-label`;
                th.rowSpan = ROWS_PER_SLOT;
                th.innerHTML = `<div class="slot-number">${slot.label}</div><div class="slot-time">${slot.time}</div>`;
                tr.appendChild(th);
            }

            // 各曜日のセル
            DAYS.forEach(day => {
                const td = document.createElement('td');
                td.className = 'schedule-cell';
                if (day === todayKey) {
                    td.style.background = 'rgba(59, 130, 246, 0.04)';
                }

                const cellKey = `${slot.id}-${row}-${day}`;
                const value = weekData[cellKey] || '';

                const cellDiv = document.createElement('div');
                cellDiv.className = 'cell-content' + (value ? ' filled' : '');
                cellDiv.dataset.key = cellKey;
                cellDiv.tabIndex = 0;
                cellDiv.textContent = value;

                // クリックで編集開始
                cellDiv.addEventListener('click', () => startEdit(cellDiv, cellKey));
                cellDiv.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        startEdit(cellDiv, cellKey);
                    }
                });

                td.appendChild(cellDiv);
                tr.appendChild(td);
            });

            scheduleBody.appendChild(tr);
        }
    });

    // 週ラベルの更新
    weekLabel.textContent = formatWeekLabel(currentWeekStart);
}

// ===== セル編集 =====
function startEdit(cellEl, cellKey) {
    // 既に編集中ならスキップ
    if (cellEl.querySelector('input')) return;

    const currentValue = getCurrentWeekData()[cellKey] || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue;
    input.className = 'cell-input';

    cellEl.textContent = '';
    cellEl.classList.remove('filled');
    cellEl.appendChild(input);
    input.focus();
    input.select();

    input.addEventListener('blur', () => finishEdit(cellEl, cellKey, input.value));
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            // Tabのように次のセルに移動
            input.blur();
            moveFocusToNextCell(cellKey);
        } else if (e.key === 'Escape') {
            input.value = currentValue;
            input.blur();
        } else if (e.key === 'Tab') {
            e.preventDefault();
            input.blur();
            if (e.shiftKey) {
                moveFocusToPrevCell(cellKey);
            } else {
                moveFocusToNextCell(cellKey);
            }
        }
    });
}

function finishEdit(cellEl, cellKey, value) {
    const weekData = getCurrentWeekData();
    const trimmed = value.trim();
    const oldValue = weekData[cellKey] || '';

    if (trimmed) {
        weekData[cellKey] = trimmed;
    } else {
        delete weekData[cellKey];
    }

    cellEl.textContent = trimmed;
    cellEl.classList.toggle('filled', !!trimmed);

    // 値が変わった場合のみ保存
    if (trimmed !== oldValue) {
        debouncedSave();
    }
}

// 次のセルにフォーカス移動
function moveFocusToNextCell(currentKey) {
    const allCells = Array.from(document.querySelectorAll('.cell-content'));
    const currentIndex = allCells.findIndex(el => el.dataset.key === currentKey);
    if (currentIndex >= 0 && currentIndex < allCells.length - 1) {
        const nextCell = allCells[currentIndex + 1];
        nextCell.click();
    }
}

function moveFocusToPrevCell(currentKey) {
    const allCells = Array.from(document.querySelectorAll('.cell-content'));
    const currentIndex = allCells.findIndex(el => el.dataset.key === currentKey);
    if (currentIndex > 0) {
        const prevCell = allCells[currentIndex - 1];
        prevCell.click();
    }
}

// ===== 保存インジケーター =====
function showSaveIndicator(type, text) {
    saveIndicator.className = `save-indicator visible ${type}`;
    saveIndicatorText.textContent = text;

    // mini-spinnerの表示/非表示
    const spinner = saveIndicator.querySelector('.mini-spinner');
    if (spinner) {
        spinner.style.display = type === 'saving' ? 'block' : 'none';
    }
}

function hideSaveIndicator() {
    saveIndicator.classList.remove('visible');
}

// ===== 自動保存 (デバウンス) =====
function debouncedSave() {
    clearTimeout(saveTimeout);
    showSaveIndicator('saving', '保存中...');
    saveTimeout = setTimeout(async () => {
        const success = await saveDataToGitHub();
        if (success) {
            showSaveIndicator('saved', '保存完了 ✓');
        } else {
            showSaveIndicator('error', '保存失敗 ✗');
        }
        setTimeout(hideSaveIndicator, 2000);
    }, 1500);
}

// ===== 週ナビゲーション =====
document.getElementById('prevWeek').addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() - 7);
    currentWeekStart = new Date(currentWeekStart);
    buildTable();
});

document.getElementById('nextWeek').addEventListener('click', () => {
    currentWeekStart.setDate(currentWeekStart.getDate() + 7);
    currentWeekStart = new Date(currentWeekStart);
    buildTable();
});

document.getElementById('todayBtn').addEventListener('click', () => {
    currentWeekStart = getMonday(new Date());
    buildTable();
});

// 先週のデータをコピー
document.getElementById('copyWeekBtn').addEventListener('click', () => {
    const lastWeek = new Date(currentWeekStart);
    lastWeek.setDate(lastWeek.getDate() - 7);
    const lastWeekKey = formatDateKey(lastWeek);
    const currentWeekKey = formatDateKey(currentWeekStart);

    const lastWeekData = scheduleData[lastWeekKey];
    if (!lastWeekData || Object.keys(lastWeekData).length === 0) {
        alert('先週のデータがありません');
        return;
    }

    const currentData = getCurrentWeekData();
    if (Object.keys(currentData).length > 0) {
        if (!confirm('今週のデータを上書きしますか？')) return;
    }

    scheduleData[currentWeekKey] = { ...lastWeekData };
    buildTable();
    debouncedSave();
});

// ===== GitHub同期 =====
function showLoading(show) {
    if (show) loadingOverlay.classList.remove('hidden');
    else loadingOverlay.classList.add('hidden');
}

function showSyncStatus(message, isError = false) {
    syncStatus.textContent = message;
    syncStatus.className = `sync-status ${isError ? 'text-error' : 'text-success'}`;
    setTimeout(() => { syncStatus.textContent = ''; }, 3000);
}

async function githubRequest(method, path, body = null) {
    if (!githubToken) throw new Error('Token is missing');

    const url = `https://api.github.com/repos/${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}/contents/${path}`;
    const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'Authorization': `token ${githubToken}`
    };

    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    const res = await fetch(url, options);
    const data = await res.json();

    if (!res.ok) throw new Error(data.message || 'API Error');
    return data;
}

async function loadDataFromGitHub() {
    showLoading(true);
    try {
        const data = await githubRequest('GET', GITHUB_CONFIG.schedulePath);
        githubScheduleSha = data.sha;

        const content = decodeURIComponent(escape(atob(data.content)));
        const parsed = JSON.parse(content);
        scheduleData = parsed.schedule || {};

        localStorage.setItem('timetable_data_backup', JSON.stringify({ schedule: scheduleData }));
    } catch (e) {
        console.error('GitHub Load Error:', e);
        if (e.message.includes('Not Found')) {
            scheduleData = {};
        } else {
            showSyncStatus('同期に失敗しました（ローカルデータを使用します）', true);
            loadDataFromLocalFallback();
        }
    } finally {
        showLoading(false);
    }
}

async function saveDataToGitHub() {
    if (!githubToken) {
        return false;
    }

    isSaving = true;
    try {
        const contentStr = JSON.stringify({ schedule: scheduleData }, null, 2);
        const encodedContent = btoa(unescape(encodeURIComponent(contentStr)));

        const body = {
            message: `Update schedule.json (${new Date().toLocaleString()})`,
            content: encodedContent,
        };

        if (githubScheduleSha) {
            body.sha = githubScheduleSha;
        }

        const data = await githubRequest('PUT', GITHUB_CONFIG.schedulePath, body);
        githubScheduleSha = data.content.sha;

        localStorage.setItem('timetable_data_backup', JSON.stringify({ schedule: scheduleData }));
        return true;
    } catch (e) {
        console.error('GitHub Save Error:', e);
        return false;
    } finally {
        isSaving = false;
    }
}

function loadDataFromLocalFallback() {
    const saved = localStorage.getItem('timetable_data_backup');
    if (saved) {
        try {
            scheduleData = JSON.parse(saved).schedule || {};
        } catch (e) {
            scheduleData = {};
        }
    }
}

// ===== 設定 =====
settingsBtn.addEventListener('click', () => {
    settingsSection.classList.toggle('hidden');
});

saveTokenBtn.addEventListener('click', async () => {
    const token = tokenInput.value.trim();
    if (!token) {
        showSyncStatus('Tokenを入力してください', true);
        return;
    }

    githubToken = token;
    localStorage.setItem('timetable_github_token', token);

    await loadDataFromGitHub();
    buildTable();
    showSyncStatus('同期が完了しました');
});

// ===== 初期化 =====
async function init() {
    if (githubToken) {
        tokenInput.value = githubToken;
        await loadDataFromGitHub();
    } else {
        settingsSection.classList.remove('hidden');
        loadDataFromLocalFallback();
    }
    buildTable();
}

init();
