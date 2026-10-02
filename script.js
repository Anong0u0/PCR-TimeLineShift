document.addEventListener('DOMContentLoaded', () => {
    const $ = (selector) => document.querySelector(selector);
    const $$ = (selector) => Array.from(document.querySelectorAll(selector));

    const app = $('#app');
    const inputText = $('#input-text');
    const outputCode = $('#output-code');
    const outputEmpty = $('#output-empty');
    const outputStats = $('#output-stats');
    const outputTag = $('#output-tag');
    const codeContent = $('.code-content');
    const secondsInput = $('#seconds-input');
    const secondsSlider = $('#seconds-slider');
    const shiftDelta = $('#shift-delta');
    const btnMinus = $('#btn-minus');
    const btnPlus = $('#btn-plus');
    const strictModeCheckbox = $('#strict-mode');
    const hideLowTimeCheckbox = $('#hide-low-time');
    const ignoreCommentCheckbox = $('#ignore-comment');
    const highlightTimeCheckbox = $('#highlight-time');
    const wrapLinesCheckbox = $('#wrap-lines');
    const fontSizeGroup = $('#font-size-group');
    const optionsBtn = $('#options-btn');
    const optionsPopover = $('#options-popover');
    const optionsSummary = $('#options-summary');
    const moreBtn = $('#more-btn');
    const moreMenu = $('#more-menu');
    const popoverBackdrop = $('#popover-backdrop');
    const toastRegion = $('#toast-region');
    const ocrUploadBtn = $('#ocr-upload-btn');
    const ocrFileInput = $('#ocr-file-input');
    const ocrDropOverlay = $('#ocr-drop-overlay');
    const slotList = $('#slot-list');
    const slotCount = $('#slot-count');
    const slotTitle = $('#slot-title');
    const slotAddBtn = $('#slot-add');
    const fullscreenToggle = $('#fullscreen-toggle');
    const themeToggleBtn = $('#theme-toggle');
    const themeColorMeta = $('meta[name="theme-color"]');
    const copyButtons = $$('.js-copy');

    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const narrowScreen = window.matchMedia('(max-width: 767px)');

    let remainingSeconds = 90;
    let strictMode = false;
    let hideLowTime = true;
    let matchCommentTime = false;
    let highlightTime = false;
    let ocrEngine = null;
    let ocrInitPromise = null;
    let ocrInitProgressUnsub = null;
    let ocrProcessing = false;
    let ocrRecognizing = false;
    let dragDepth = 0;
    let slots = [];
    let activeSlotId = null;
    let placeholderSlotId = null;
    const slotsKey = 'pcr_timeline_slots';
    const activeSlotKey = 'pcr_timeline_active_slot';
    const highlightMarker = '\u{E0251}';
    const exampleTimeline = [
        '範例：5王 物理刀',
        '1:30 開場',
        '1:18 UB 凱留',
        '1:05 UB 鏡華 // 等貓劍出手',
        '0:52 UB 凱留',
        '0:31 UB 鏡華、凱留',
        '0:12 UB 全員',
    ].join('\n');

    const storage = {
        get: (key) => {
            try {
                return localStorage.getItem(key);
            } catch (error) {
                return null;
            }
        },
        set: (key, value) => {
            try {
                localStorage.setItem(key, value);
            } catch (error) {
                console.error('[storage] save failed:', error);
            }
        },
    };

    const createIcon = (id) => {
        const svgNs = 'http://www.w3.org/2000/svg';
        const svg = document.createElementNS(svgNs, 'svg');
        const use = document.createElementNS(svgNs, 'use');
        svg.setAttribute('class', 'icon');
        svg.setAttribute('aria-hidden', 'true');
        use.setAttribute('href', `#${id}`);
        svg.append(use);
        return svg;
    };

    /* ---------- Toasts ---------- */
    const toastsById = new Map();
    const toastModeIcons = { 'is-ready': 'i-check', 'is-error': 'i-x' };

    const dismissToast = (toast) => {
        if (!toast || toast.el.classList.contains('leaving')) {
            return;
        }
        clearTimeout(toast.timer);
        if (toast.id && toastsById.get(toast.id) === toast) {
            toastsById.delete(toast.id);
        }
        toast.el.classList.add('leaving');
        setTimeout(() => toast.el.remove(), 180);
    };

    const showToast = (message, { id = '', mode = '', action = null, timeout = 4000 } = {}) => {
        let toast = id ? toastsById.get(id) : null;
        if (!toast) {
            const el = document.createElement('div');
            el.className = 'toast';
            const icon = document.createElement('span');
            icon.className = 'toast-icon';
            const text = document.createElement('span');
            text.className = 'toast-text';
            const actionBtn = document.createElement('button');
            actionBtn.type = 'button';
            actionBtn.className = 'toast-action';
            el.append(icon, text, actionBtn);
            toast = { id, el, icon, text, actionBtn, timer: null };
            el.toast = toast;
            if (id) {
                toastsById.set(id, toast);
            }
            toastRegion.append(el);
            const live = Array.from(toastRegion.children).filter((child) => !child.classList.contains('leaving'));
            if (live.length > 3) {
                dismissToast(live[0].toast);
            }
        }

        toast.el.dataset.mode = mode;
        toast.text.textContent = message;
        if (mode === 'is-loading') {
            const spinner = document.createElement('span');
            spinner.className = 'spinner';
            toast.icon.replaceChildren(spinner);
        } else if (toastModeIcons[mode]) {
            toast.icon.replaceChildren(createIcon(toastModeIcons[mode]));
        } else {
            toast.icon.replaceChildren();
        }
        toast.icon.hidden = !toast.icon.firstChild;

        toast.actionBtn.hidden = !action;
        toast.actionBtn.onclick = null;
        if (action) {
            toast.actionBtn.textContent = action.label;
            toast.actionBtn.onclick = () => {
                dismissToast(toast);
                action.onClick();
            };
        }

        clearTimeout(toast.timer);
        if (timeout) {
            toast.timer = setTimeout(() => dismissToast(toast), timeout);
        }
        return toast;
    };

    /* ---------- Time shift ---------- */
    const toHalfwidthDigits = (value) => value.replace(/[０-９]/g, (digit) =>
        String.fromCharCode(digit.charCodeAt(0) - 0xFF10 + 0x30));
    const toFullwidthDigits = (value) => value.replace(/\d/g, (digit) =>
        String.fromCharCode(digit.charCodeAt(0) + 0xFF10 - 0x30));
    const getDigitPattern = (value) => value.split('').map((digit) => /[０-９]/.test(digit));
    const applyDigitWidth = (value, pattern) => value
        .split('')
        .map((digit, index) => {
            const useFullwidth = pattern[index] ?? pattern[pattern.length - 1] ?? false;
            return useFullwidth ? toFullwidthDigits(digit) : digit;
        })
        .join('');
    const wrapHighlightMarker = (value) => highlightTime
        ? `${highlightMarker}${value}${highlightMarker}`
        : value;

    const renderStats = ({ hasInput, shiftedCount, hiddenCount, warningShown }) => {
        if (!hasInput) {
            outputStats.replaceChildren();
            return;
        }
        const createStat = (parts, warn = false) => {
            const stat = document.createElement('span');
            stat.className = warn ? 'stat stat-warn' : 'stat';
            if (warn) {
                const dot = document.createElement('span');
                dot.className = 'stat-dot';
                stat.append(dot);
            }
            parts.forEach((part) => {
                if (typeof part === 'number') {
                    const value = document.createElement('b');
                    value.textContent = part;
                    stat.append(value);
                } else {
                    stat.append(part);
                }
            });
            return stat;
        };
        const stats = [createStat(['換算 ', shiftedCount, ' 個時間'])];
        if (hiddenCount > 0) {
            stats.push(createStat(['隱藏 ', hiddenCount, ' 行（補償時間不足）'], true));
        }
        if (warningShown) {
            stats.push(createStat(['有軸補償時間不足'], true));
        }
        outputStats.replaceChildren(...stats);
    };

    const processText = () => {
        const text = inputText.value;
        const offset = remainingSeconds - 90;

        const lines = text.split('\n');

        const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0);

        const processedLines = [];
        let warningShown = false;
        let shouldSkipFollowers = false;
        let shiftedCount = 0;
        let hiddenCount = 0;

        lines.forEach((line) => {
            if (/https?:\/\//.test(line)) {
                processedLines.push(line);
                return;
            }

            let commentIndex = -1;
            if (!matchCommentTime) {
                const hashIndex = line.indexOf('#');
                const slashIndex = line.indexOf('//');
                if (hashIndex !== -1 && (slashIndex === -1 || hashIndex < slashIndex)) {
                    commentIndex = hashIndex;
                } else if (slashIndex !== -1) {
                    commentIndex = slashIndex;
                }
            }

            if (commentIndex === 0) {
                processedLines.push(line);
                return;
            }

            const lineToProcess = commentIndex > -1 ? line.slice(0, commentIndex) : line;
            const commentTail = commentIndex > -1 ? line.slice(commentIndex) : '';

            let matchCount = 0;
            let lineHasLowTime = false;

            const lineRegex = /(?<![,.\drRkKvV０-９])(?:(?<minuteColon>[0０]?[01０１]?)(?<colon>[:：])(?<secondColon>[0-5０-５][\d０-９])|(?<![:：])(?<minuteCompact>[0０]?[01０１]??)(?<secondCompact>[0-5０-５][\d０-９])(?![:：]))(?![\dwW\-０-９])/g;

            const processedLine = lineToProcess.replace(lineRegex, (match, ...args) => {
                const groups = args[args.length - 1] || {};
                const { minuteColon, secondColon, minuteCompact, secondCompact, colon } = groups;
                if (strictMode && matchCount > 0) {
                    return match;
                }

                const hasColon = Boolean(colon);
                const minutesPart = hasColon ? minuteColon : minuteCompact;
                const secondsPart = hasColon ? secondColon : secondCompact;
                const minutePattern = minutesPart ? getDigitPattern(minutesPart) : [];
                const secondPattern = secondsPart ? getDigitPattern(secondsPart) : [];
                const minutes = minutesPart ? parseInt(toHalfwidthDigits(minutesPart), 10) : 0;
                const seconds = parseInt(toHalfwidthDigits(secondsPart), 10);

                const newTotalSeconds = minutes * 60 + seconds + offset;

                if (newTotalSeconds < 1) {
                    lineHasLowTime = true;
                }

                const isNegative = newTotalSeconds < 0;
                const absSeconds = Math.abs(newTotalSeconds);

                const newMin = Math.floor(absSeconds / 60);
                const newSec = absSeconds % 60;
                const minutesWidth = minutesPart ? minutesPart.length : 0;
                const secondsWidth = secondsPart ? secondsPart.length : 0;
                const sign = isNegative ? '-' : '';

                matchCount++;

                const minWidth = hasColon ? Math.max(1, minutesWidth) : minutesWidth;
                const formattedMin = minWidth > 0
                    ? applyDigitWidth(newMin.toString().padStart(minWidth, '0'), minutePattern)
                    : '';
                const formattedSec = applyDigitWidth(newSec.toString().padStart(secondsWidth, '0'), secondPattern);
                const separator = hasColon ? colon : '';

                return wrapHighlightMarker(`${sign}${formattedMin}${separator}${formattedSec}`);
            });

            if (matchCount > 0) {
                shouldSkipFollowers = lineHasLowTime && hideLowTime;
                if (shouldSkipFollowers) {
                    hiddenCount += line.trim() ? 1 : 0;
                    return;
                }
            } else if (shouldSkipFollowers) {
                hiddenCount += line.trim() ? 1 : 0;
                return;
            }

            if (lineHasLowTime && !warningShown) {
                const baseText = "=== 補償時間不足 ===";
                const totalPadding = Math.max(0, maxLineLength - baseText.length);
                const leftPad = Math.floor(totalPadding / 2);
                const rightPad = totalPadding - leftPad;

                const warningLine = "=".repeat(leftPad) + baseText + "=".repeat(rightPad);
                processedLines.push("// " + warningLine);
                warningShown = true;
            }

            shiftedCount += matchCount;
            processedLines.push(`${processedLine}${commentTail}`);
        });

        outputCode.textContent = processedLines.join('\n');
        if (window.hljs) {
            outputCode.removeAttribute('data-highlighted');
            hljs.highlightElement(outputCode);
        }
        if (highlightTime) {
            const parts = outputCode.innerHTML.split(highlightMarker);
            if (parts.length > 1) {
                outputCode.innerHTML = parts
                    .map((part, index) => index % 2 === 1
                        ? `<span class="time-highlight">${part}</span>`
                        : part)
                    .join('');
            }
        }

        const hasInput = text.trim() !== '';
        outputEmpty.hidden = hasInput;
        renderStats({ hasInput, shiftedCount, hiddenCount, warningShown });
    };

    /* ---------- Remaining seconds ---------- */
    const renderSeconds = () => {
        const offset = remainingSeconds - 90;
        secondsSlider.style.setProperty('--pct', `${(remainingSeconds / 90) * 100}%`);
        shiftDelta.textContent = offset === 0 ? '不需平移' : `所有時間 −${-offset} 秒`;
        shiftDelta.classList.toggle('is-zero', offset === 0);
        outputTag.textContent = `${remainingSeconds} 秒`;
    };

    const updateState = (newVal) => {
        let val = Math.max(0, Math.min(90, newVal));
        remainingSeconds = val;

        secondsInput.value = val;
        secondsSlider.value = val;

        storage.set('pcr_timeline_seconds', val);

        renderSeconds();
        processText();
    };

    const bindHoldRepeat = (button, step) => {
        let delayTimer = null;
        let repeatTimer = null;
        const stop = () => {
            clearTimeout(delayTimer);
            clearInterval(repeatTimer);
            delayTimer = null;
            repeatTimer = null;
        };
        button.addEventListener('pointerdown', (event) => {
            if (event.button !== 0) {
                return;
            }
            event.preventDefault();
            stop();
            step();
            delayTimer = setTimeout(() => {
                repeatTimer = setInterval(step, 60);
            }, 380);
        });
        ['pointerup', 'pointerleave', 'pointercancel'].forEach((type) => button.addEventListener(type, stop));
        window.addEventListener('blur', stop);
        // Keyboard activation has no pointer events.
        button.addEventListener('click', (event) => {
            if (event.detail === 0) {
                step();
            }
        });
        button.addEventListener('contextmenu', (event) => event.preventDefault());
    };

    bindHoldRepeat(btnMinus, () => updateState(remainingSeconds - 1));
    bindHoldRepeat(btnPlus, () => updateState(remainingSeconds + 1));

    secondsInput.addEventListener('input', (e) => {
        let val = parseInt(e.target.value);
        if (!isNaN(val)) {
            updateState(val);
        }
    });
    secondsInput.addEventListener('focus', () => secondsInput.select());
    secondsInput.addEventListener('blur', () => {
        secondsInput.value = remainingSeconds;
    });
    secondsInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            secondsInput.blur();
        }
    });

    secondsSlider.addEventListener('input', (e) => {
        let val = parseInt(e.target.value);
        updateState(val);
    });

    /* ---------- Slots (記憶管理) ---------- */
    const createSlot = (text = '', name = '') => ({
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        name,
        text,
        updatedAt: Date.now(),
    });
    const getActiveSlot = () => slots.find((slot) => slot.id === activeSlotId);
    const getSlotLabel = (slot) => {
        const name = slot.name.trim();
        if (name) {
            return name;
        }
        const firstLine = slot.text.split('\n').map((line) => line.trim()).find(Boolean);
        return firstLine ? firstLine.slice(0, 50) : '未命名';
    };
    const formatUpdatedAt = (timestamp) => {
        if (!timestamp) {
            return '';
        }
        const date = new Date(timestamp);
        const pad = (value) => String(value).padStart(2, '0');
        const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
        return date.toDateString() === new Date().toDateString()
            ? time
            : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
    };
    const getSlotMeta = (slot) => {
        const lineCount = slot.text.split('\n').filter((line) => line.trim()).length;
        return [lineCount ? `${lineCount} 行` : '空白', formatUpdatedAt(slot.updatedAt)]
            .filter(Boolean)
            .join(' · ');
    };

    const readSlots = () => {
        try {
            const parsed = JSON.parse(localStorage.getItem(slotsKey));
            if (Array.isArray(parsed)) {
                return parsed
                    .filter((slot) => slot && typeof slot.id === 'string')
                    .map((slot) => ({
                        id: slot.id,
                        name: typeof slot.name === 'string' ? slot.name : '',
                        text: typeof slot.text === 'string' ? slot.text : '',
                        updatedAt: Number(slot.updatedAt) || 0,
                    }));
            }
        } catch (error) {
            console.error('[slots] read failed:', error);
        }
        return [];
    };

    const saveSlots = () => {
        try {
            localStorage.setItem(slotsKey, JSON.stringify(slots));
            localStorage.setItem(activeSlotKey, activeSlotId);
            // Mirror the active slot so a page without slots still restores the last input.
            localStorage.setItem('pcr_timeline_input', getActiveSlot()?.text ?? '');
        } catch (error) {
            console.error('[slots] save failed:', error);
        }
    };

    const fillSlotItem = (item, slot) => {
        const label = getSlotLabel(slot);
        item.querySelector('.slot-name').textContent = label;
        item.querySelector('.slot-meta').textContent = getSlotMeta(slot);
        item.title = label;
    };

    const createSlotItem = (slot) => {
        const item = document.createElement('button');
        const name = document.createElement('span');
        const meta = document.createElement('span');
        item.type = 'button';
        item.className = 'slot-item';
        item.dataset.slotId = slot.id;
        name.className = 'slot-name';
        meta.className = 'slot-meta';
        item.append(name, meta);
        fillSlotItem(item, slot);
        const isActive = slot.id === activeSlotId;
        item.classList.toggle('active', isActive);
        item.tabIndex = isActive ? 0 : -1;
        if (isActive) {
            item.setAttribute('aria-current', 'true');
        }
        return item;
    };

    const scrollItemIntoView = (item) => {
        const margin = 8;
        if (slotList.scrollWidth > slotList.clientWidth) {
            if (item.offsetLeft < slotList.scrollLeft) {
                slotList.scrollLeft = item.offsetLeft - margin;
            } else if (item.offsetLeft + item.offsetWidth > slotList.scrollLeft + slotList.clientWidth) {
                slotList.scrollLeft = item.offsetLeft + item.offsetWidth - slotList.clientWidth + margin;
            }
        }
        if (slotList.scrollHeight > slotList.clientHeight) {
            if (item.offsetTop < slotList.scrollTop) {
                slotList.scrollTop = item.offsetTop - margin;
            } else if (item.offsetTop + item.offsetHeight > slotList.scrollTop + slotList.clientHeight) {
                slotList.scrollTop = item.offsetTop + item.offsetHeight - slotList.clientHeight + margin;
            }
        }
    };

    const getActiveItem = () => slotList.querySelector('.slot-item.active');

    const updateScrollHint = () => {
        const hasMoreRight = slotList.scrollLeft + slotList.clientWidth < slotList.scrollWidth - 2;
        slotList.classList.toggle('can-scroll-right', hasMoreRight);
    };

    const renderSlotList = () => {
        const hadFocus = slotList.contains(document.activeElement);
        slotList.replaceChildren(...slots.map(createSlotItem));
        slotCount.textContent = slots.length;
        const activeItem = getActiveItem();
        if (activeItem) {
            scrollItemIntoView(activeItem);
            if (hadFocus) {
                activeItem.focus({ preventScroll: true });
            }
        }
        updateScrollHint();
    };

    const renderTitle = () => {
        const slot = getActiveSlot();
        if (!slot) {
            return;
        }
        if (document.activeElement !== slotTitle) {
            slotTitle.value = slot.name;
        }
        slotTitle.placeholder = getSlotLabel({ ...slot, name: '' });
    };

    const updateActiveSlotItem = () => {
        const slot = getActiveSlot();
        const activeItem = getActiveItem();
        if (slot && activeItem) {
            fillSlotItem(activeItem, slot);
            scrollItemIntoView(activeItem);
            updateScrollHint();
        }
    };

    const setView = (view) => {
        app.dataset.view = view;
        $$('.view-switch .seg-btn').forEach((button) => {
            button.setAttribute('aria-selected', String(button.dataset.view === view));
        });
    };

    const loadActiveSlot = () => {
        const text = getActiveSlot()?.text ?? '';
        inputText.value = text;
        inputText.scrollTop = 0;
        codeContent.scrollTop = 0;
        if (!text.trim()) {
            setView('input');
        }
        saveSlots();
        renderSlotList();
        renderTitle();
        processText();
    };

    const setActiveSlotText = (text) => {
        const slot = getActiveSlot();
        if (!slot) {
            return;
        }
        slot.text = text;
        slot.updatedAt = Date.now();
        saveSlots();
        updateActiveSlotItem();
        renderTitle();
    };

    const setInputText = (text) => {
        inputText.value = text;
        setActiveSlotText(text);
        processText();
    };

    const switchSlot = (id) => {
        if (id === activeSlotId || !slots.some((slot) => slot.id === id)) {
            return;
        }
        activeSlotId = id;
        loadActiveSlot();
    };

    const insertSlot = (slot, index = slots.length) => {
        slots.splice(index, 0, slot);
        activeSlotId = slot.id;
        loadActiveSlot();
    };

    const addSlot = () => {
        insertSlot(createSlot());
        if (finePointer.matches) {
            inputText.focus();
        }
    };

    const duplicateActiveSlot = () => {
        const source = getActiveSlot();
        if (!source) {
            return;
        }
        insertSlot(createSlot(source.text, `${getSlotLabel(source)} 複本`), slots.indexOf(source) + 1);
        showToast('已建立複本', { id: 'duplicate', mode: 'is-ready', timeout: 2500 });
    };

    const restoreSlot = (slot, index) => {
        if (slots.some((item) => item.id === slot.id)) {
            return;
        }
        const placeholder = slots.find((item) => item.id === placeholderSlotId);
        if (placeholder && !placeholder.text && !placeholder.name) {
            slots.splice(slots.indexOf(placeholder), 1);
        }
        placeholderSlotId = null;
        insertSlot(slot, Math.min(index, slots.length));
    };

    const deleteActiveSlot = () => {
        const slot = getActiveSlot();
        if (!slot) {
            return;
        }
        const index = slots.indexOf(slot);
        slots.splice(index, 1);
        placeholderSlotId = null;
        if (slots.length === 0) {
            const blank = createSlot();
            slots.push(blank);
            placeholderSlotId = blank.id;
        }
        activeSlotId = slots[Math.min(index, slots.length - 1)].id;
        loadActiveSlot();
        if (slot.text.trim() || slot.name.trim()) {
            showToast(`已刪除「${getSlotLabel(slot)}」`, {
                id: 'slot-delete',
                timeout: 8000,
                action: { label: '復原', onClick: () => restoreSlot(slot, index) },
            });
        }
    };

    const startRenameSlot = () => {
        slotTitle.focus();
        slotTitle.select();
    };

    const clearActiveSlotText = () => {
        const slot = getActiveSlot();
        if (!slot || !inputText.value) {
            return;
        }
        const previous = inputText.value;
        const slotId = slot.id;
        setInputText('');
        setView('input');
        showToast('已清空原始軸', {
            id: 'clear',
            timeout: 8000,
            action: {
                label: '復原',
                onClick: () => {
                    const target = slots.find((item) => item.id === slotId);
                    if (!target || target.text) {
                        return;
                    }
                    if (activeSlotId !== slotId) {
                        switchSlot(slotId);
                    }
                    setInputText(previous);
                },
            },
        });
        if (finePointer.matches) {
            inputText.focus();
        }
    };

    // Keep the current 刀 intact: incoming text goes to a fresh slot unless the current one is empty.
    const applyIncomingText = (text = '') => {
        const normalized = text.replace(/\r\n?/g, '\n');
        if (inputText.value.trim()) {
            insertSlot(createSlot(normalized));
            return true;
        }
        setInputText(normalized);
        return false;
    };

    const initSlots = () => {
        slots = readSlots();
        if (slots.length === 0) {
            slots = [createSlot(storage.get('pcr_timeline_input') ?? '')];
        }
        const savedActiveId = storage.get(activeSlotKey);
        activeSlotId = slots.some((slot) => slot.id === savedActiveId) ? savedActiveId : slots[0].id;
        inputText.value = getActiveSlot().text;
        saveSlots();
        renderSlotList();
        renderTitle();
        setView(inputText.value.trim() ? 'output' : 'input');
    };

    inputText.addEventListener('input', () => {
        setActiveSlotText(inputText.value);
        processText();
    });

    slotList.addEventListener('click', (event) => {
        const item = event.target.closest('.slot-item');
        if (item) {
            switchSlot(item.dataset.slotId);
        }
    });

    slotList.addEventListener('dblclick', (event) => {
        const item = event.target.closest('.slot-item');
        if (item && item.dataset.slotId === activeSlotId) {
            startRenameSlot();
        }
    });

    slotList.addEventListener('keydown', (event) => {
        const steps = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
        if (event.key === 'Home' || event.key === 'End') {
            event.preventDefault();
            switchSlot(slots[event.key === 'Home' ? 0 : slots.length - 1].id);
            getActiveItem()?.focus();
            return;
        }
        if (!(event.key in steps)) {
            return;
        }
        event.preventDefault();
        const index = slots.findIndex((slot) => slot.id === activeSlotId);
        const next = slots[Math.max(0, Math.min(slots.length - 1, index + steps[event.key]))];
        switchSlot(next.id);
        getActiveItem()?.focus();
    });

    slotAddBtn.addEventListener('click', addSlot);
    slotList.addEventListener('scroll', updateScrollHint, { passive: true });
    window.addEventListener('resize', updateScrollHint);

    let titleBeforeEdit = '';
    slotTitle.addEventListener('focus', () => {
        titleBeforeEdit = getActiveSlot()?.name ?? '';
    });
    slotTitle.addEventListener('input', () => {
        const slot = getActiveSlot();
        if (!slot) {
            return;
        }
        slot.name = slotTitle.value;
        slot.updatedAt = Date.now();
        saveSlots();
        updateActiveSlotItem();
    });
    slotTitle.addEventListener('keydown', (event) => {
        if (event.isComposing || event.keyCode === 229) {
            return;
        }
        if (event.key === 'Enter') {
            event.preventDefault();
            slotTitle.blur();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            slotTitle.value = titleBeforeEdit;
            slotTitle.dispatchEvent(new Event('input'));
            slotTitle.blur();
        }
    });
    slotTitle.addEventListener('blur', () => {
        const slot = getActiveSlot();
        if (!slot) {
            return;
        }
        const trimmed = slot.name.trim();
        if (trimmed !== slot.name) {
            slot.name = trimmed;
            saveSlots();
        }
        slotTitle.value = slot.name;
        updateActiveSlotItem();
    });

    // Another tab saved its slots: adopt them so our next save doesn't overwrite theirs.
    window.addEventListener('storage', (event) => {
        if (event.key !== slotsKey) {
            return;
        }
        const nextSlots = readSlots();
        if (nextSlots.length === 0) {
            return;
        }
        slots = nextSlots;
        if (!getActiveSlot()) {
            activeSlotId = slots[0].id;
        }
        const activeText = getActiveSlot().text;
        if (inputText.value !== activeText) {
            inputText.value = activeText;
            processText();
        }
        renderSlotList();
        renderTitle();
    });

    /* ---------- View switch (narrow screens) ---------- */
    $$('.view-switch .seg-btn').forEach((button) => {
        button.addEventListener('click', () => setView(button.dataset.view));
    });

    /* ---------- Copy / paste / clear ---------- */
    copyButtons.forEach((button) => {
        const label = button.querySelector('.copy-label');
        button.dataset.label = label.textContent;
    });
    let copyResetTimer = null;
    const showCopyState = () => {
        copyButtons.forEach((button) => {
            button.classList.add('copied');
            button.querySelector('.copy-label').textContent = '已複製';
        });
        clearTimeout(copyResetTimer);
        copyResetTimer = setTimeout(() => {
            copyButtons.forEach((button) => {
                button.classList.remove('copied');
                button.querySelector('.copy-label').textContent = button.dataset.label;
            });
        }, 2000);
    };

    const fallbackCopy = (text) => {
        const temp = document.createElement('textarea');
        temp.value = text;
        temp.setAttribute('readonly', '');
        temp.style.position = 'absolute';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        try {
            const ok = document.execCommand('copy');
            if (ok) {
                showCopyState();
            } else {
                showToast('複製失敗，請手動選取文字', { mode: 'is-error' });
            }
        } finally {
            document.body.removeChild(temp);
        }
    };

    const copyOutput = () => {
        const text = outputCode.textContent;
        if (!text.trim()) {
            showToast('還沒有可以複製的結果', { id: 'copy', timeout: 2500 });
            return;
        }
        if (navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(text)
                .then(showCopyState)
                .catch(() => fallbackCopy(text));
            return;
        }
        fallbackCopy(text);
    };

    const pasteText = (text) => {
        if (!text.trim()) {
            showToast('剪貼簿裡沒有文字或圖片', { id: 'paste', timeout: 3000 });
            return;
        }
        const createdNew = applyIncomingText(text);
        showToast(createdNew ? '已貼上，另存成新的一刀' : '已貼上', { id: 'paste', mode: 'is-ready', timeout: 2500 });
        setView('output');
    };

    const pasteFromClipboard = async () => {
        const clipboard = navigator.clipboard;
        try {
            if (clipboard?.read) {
                const items = await clipboard.read();
                for (const item of items) {
                    const imageType = item.types.find((type) => type.startsWith('image/'));
                    if (imageType) {
                        const blob = await item.getType(imageType);
                        runOcrFromFile(new File([blob], 'clipboard-image', { type: imageType }));
                        return;
                    }
                }
                const textItem = items.find((item) => item.types.includes('text/plain'));
                pasteText(textItem ? await (await textItem.getType('text/plain')).text() : '');
                return;
            }
            if (clipboard?.readText) {
                pasteText(await clipboard.readText());
                return;
            }
            throw new Error('Clipboard API unavailable');
        } catch (error) {
            console.warn('[paste] clipboard read failed:', error);
            setView('input');
            showToast('無法讀取剪貼簿，請在輸入框長按或按 Ctrl+V 貼上', { id: 'paste', mode: 'is-error', timeout: 5000 });
        }
    };

    copyButtons.forEach((button) => button.addEventListener('click', copyOutput));
    $$('.js-paste').forEach((button) => button.addEventListener('click', pasteFromClipboard));
    $$('.js-clear').forEach((button) => button.addEventListener('click', clearActiveSlotText));

    $('#load-example').addEventListener('click', () => {
        applyIncomingText(exampleTimeline);
        setView('output');
    });

    /* ---------- OCR ---------- */
    const setOcrStatus = (message = '', mode = '') => {
        const busy = mode === 'is-loading';
        ocrUploadBtn.classList.toggle('is-busy', busy);
        ocrUploadBtn.setAttribute('aria-busy', String(busy));
        if (!message) {
            dismissToast(toastsById.get('ocr'));
            return;
        }
        const timeout = { 'is-loading': 0, 'is-error': 7000 }[mode] ?? 2500;
        showToast(message, { id: 'ocr', mode, timeout });
    };
    const setIdleOcrStatus = (message, mode) => {
        if (!ocrRecognizing) {
            setOcrStatus(message, mode);
        }
    };
    const getErrorMessage = (error) => error?.message || String(error);
    const setOcrError = (prefix, error) => setOcrStatus(`${prefix}: ${getErrorMessage(error)}`, 'is-error');
    const toPercentText = (value) => `${Math.max(0, Math.min(100, Math.round(Number(value) || 0)))}%`;
    const resolveOcrProgressStatus = (progress) => {
        const failText = `辨識模型載入失敗: ${progress.message || 'unknown error'}`;
        const unified = progress.progress;
        if (unified) {
            if (unified.state === 'failed' || progress.state === 'failed' || progress.phase === 'error') {
                return ['圖片辨識失敗: ' + (progress.message || 'unknown error'), 'is-error'];
            }
            if (unified.kind === 'recognize') {
                return unified.state === 'done'
                    ? ['辨識完成', 'is-ready']
                    : [`辨識中 ${toPercentText(unified.percent)}`, 'is-loading'];
            }
            if (unified.kind === 'init') {
                return (unified.percent >= 100 || (progress.phase === 'ready' && progress.state === 'done'))
                    ? ['辨識模型已就緒', 'is-ready']
                    : [`載入辨識模型 ${toPercentText(unified.percent)}`, 'is-loading'];
            }
        }
        if (progress.phase === 'download' && progress.download?.overall) {
            return [`載入辨識模型 ${toPercentText(progress.download.overall.percent)}`, 'is-loading'];
        }
        if (progress.phase === 'warmup' && progress.warmup?.total) {
            return [`辨識模型暖機 ${progress.warmup.current}/${progress.warmup.total}`, 'is-loading'];
        }
        if (progress.phase === 'ready' && progress.state === 'done') {
            return ['辨識模型已就緒', 'is-ready'];
        }
        if (progress.phase === 'error' || progress.state === 'failed') {
            return [failText, 'is-error'];
        }
        if (progress.state === 'loading' || progress.state === 'creating' || progress.state === 'running') {
            return ['載入辨識模型...', 'is-loading'];
        }
        return null;
    };
    const isImageFile = (file) => Boolean(file?.type?.startsWith('image/'));
    const getFirstImageFile = (files) => Array.from(files || []).find(isImageFile) || null;
    const getClipboardImageFile = (clipboardData) => {
        if (!clipboardData) {
            return null;
        }
        const fileFromFiles = getFirstImageFile(clipboardData.files);
        return fileFromFiles || null;
    };
    const dragHasFiles = (event) => Array.from(event?.dataTransfer?.types || []).includes('Files');
    const setDropOverlayVisible = (visible) => {
        if (ocrDropOverlay) {
            ocrDropOverlay.classList.toggle('visible', visible);
        }
    };

    const renderOcrProgress = (progress) => {
        if (!progress) {
            return;
        }

        const nextStatus = resolveOcrProgressStatus(progress);
        if (nextStatus) {
            setOcrStatus(nextStatus[0], nextStatus[1]);
        }
    };
    const startOcrInitInBackground = () => {
        if (!window.PPOCRv5) {
            setOcrStatus('圖片辨識元件未載入，請重新整理頁面', 'is-error');
            return null;
        }
        if (!ocrInitProgressUnsub) {
            ocrInitProgressUnsub = window.PPOCRv5.onInitProgress(renderOcrProgress);
        }
        if (ocrEngine) {
            return Promise.resolve(ocrEngine);
        }
        if (!ocrInitPromise) {
            setIdleOcrStatus('載入辨識模型...', 'is-loading');
            ocrInitPromise = window.PPOCRv5.init()
                .then((engine) => {
                    ocrEngine = engine;
                    setIdleOcrStatus('辨識模型已就緒', 'is-ready');
                    return engine;
                })
                .catch((error) => {
                    ocrInitPromise = null;
                    ocrEngine = null;
                    setOcrError('辨識模型載入失敗', error);
                    throw error;
                });
        }
        return ocrInitPromise;
    };
    const ensureOcrEngine = async () => {
        const initPromise = startOcrInitInBackground();
        if (!initPromise) {
            throw new Error('PPOCRv5 plugin not loaded');
        }
        return await initPromise;
    };
    const runOcrFromFile = async (file) => {
        if (!isImageFile(file)) {
            setOcrStatus('請選擇圖片檔', 'is-error');
            return;
        }
        if (ocrProcessing) {
            setOcrStatus('正在辨識上一張圖片，請稍候', 'is-loading');
            return;
        }
        ocrProcessing = true;
        try {
            const engine = await ensureOcrEngine();
            ocrRecognizing = true;
            setOcrStatus('辨識中...', 'is-loading');
            const result = await engine.recognizeFile(file);
            const text = result?.text || '';
            if (!text.trim()) {
                setOcrStatus('圖片中沒有辨識到文字', 'is-error');
                return;
            }
            const createdNew = applyIncomingText(text);
            setView('output');
            setOcrStatus(createdNew ? '辨識完成，另存成新的一刀' : '辨識完成', 'is-ready');
        } catch (error) {
            setOcrError(ocrRecognizing ? '圖片辨識失敗' : '辨識模型載入失敗', error);
        } finally {
            ocrRecognizing = false;
            ocrProcessing = false;
        }
    };

    const isEditableTarget = (target) => target instanceof Element
        && Boolean(target.closest('input, textarea, [contenteditable="true"]'));

    document.addEventListener('paste', (event) => {
        const imageFile = getClipboardImageFile(event.clipboardData);
        if (imageFile) {
            event.preventDefault();
            startOcrInitInBackground();
            runOcrFromFile(imageFile);
            return;
        }
        // Ctrl+V outside the editors: take the text as a timeline instead of dropping it.
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (isEditableTarget(event.target) || !text.trim()) {
            return;
        }
        event.preventDefault();
        pasteText(text);
    }, true);

    $$('.js-ocr').forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            startOcrInitInBackground();
            ocrFileInput.value = '';
            ocrFileInput.click();
        });
    });

    ocrFileInput.addEventListener('change', (event) => {
        const [file] = event.target.files || [];
        if (file) {
            runOcrFromFile(file);
        }
        event.target.value = '';
    });

    const prepareForDrop = (event) => {
        if (!dragHasFiles(event)) {
            return false;
        }
        event.preventDefault();
        startOcrInitInBackground();
        return true;
    };

    window.addEventListener('dragenter', (event) => {
        if (!prepareForDrop(event)) {
            return;
        }
        dragDepth += 1;
        setDropOverlayVisible(true);
    });

    window.addEventListener('dragover', (event) => {
        if (!prepareForDrop(event)) {
            return;
        }
        if (event.dataTransfer) {
            event.dataTransfer.dropEffect = 'copy';
        }
        setDropOverlayVisible(true);
    });

    window.addEventListener('dragleave', (event) => {
        if (dragDepth === 0 && !ocrDropOverlay?.classList.contains('visible')) {
            return;
        }
        event.preventDefault();
        dragDepth = Math.max(0, dragDepth - 1);
        if (dragDepth === 0) {
            setDropOverlayVisible(false);
        }
    });

    window.addEventListener('dragend', () => {
        dragDepth = 0;
        setDropOverlayVisible(false);
    });

    window.addEventListener('drop', (event) => {
        if (!prepareForDrop(event)) {
            return;
        }
        dragDepth = 0;
        setDropOverlayVisible(false);
        const imageFile = getFirstImageFile(event.dataTransfer?.files);
        if (!imageFile) {
            setOcrStatus('拖曳的內容不是圖片檔', 'is-error');
            return;
        }
        runOcrFromFile(imageFile);
    });

    /* ---------- Popovers (options, more menu) ---------- */
    let openPopover = null;

    const positionPopover = () => {
        if (!openPopover) {
            return;
        }
        const { popover, trigger } = openPopover;
        const asSheet = narrowScreen.matches;
        popover.classList.toggle('as-sheet', asSheet);
        popoverBackdrop.hidden = !asSheet;
        if (asSheet) {
            popover.style.left = '';
            popover.style.top = '';
            return;
        }
        const margin = 8;
        const rect = trigger.getBoundingClientRect();
        const width = popover.offsetWidth;
        const height = popover.offsetHeight;
        const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin));
        let top = rect.bottom + 6;
        if (top + height > window.innerHeight - margin) {
            top = Math.max(margin, rect.top - height - 6);
        }
        popover.style.left = `${left}px`;
        popover.style.top = `${top}px`;
    };

    const closePopover = ({ restoreFocus = true } = {}) => {
        if (!openPopover) {
            return;
        }
        const { popover, trigger } = openPopover;
        openPopover = null;
        popover.hidden = true;
        popoverBackdrop.hidden = true;
        trigger.setAttribute('aria-expanded', 'false');
        if (restoreFocus) {
            trigger.focus({ preventScroll: true });
        }
    };

    const togglePopover = (popover, trigger) => {
        if (openPopover?.popover === popover) {
            closePopover();
            return;
        }
        closePopover({ restoreFocus: false });
        openPopover = { popover, trigger };
        popover.hidden = false;
        trigger.setAttribute('aria-expanded', 'true');
        positionPopover();
        popover.querySelector('.menu-item:not([hidden]), .switch')?.focus({ preventScroll: true });
    };

    optionsBtn.addEventListener('click', () => togglePopover(optionsPopover, optionsBtn));
    moreBtn.addEventListener('click', () => togglePopover(moreMenu, moreBtn));
    $$('.js-popover-close').forEach((button) => button.addEventListener('click', () => closePopover()));
    popoverBackdrop.addEventListener('click', () => closePopover({ restoreFocus: false }));

    document.addEventListener('pointerdown', (event) => {
        if (!openPopover) {
            return;
        }
        const { popover, trigger } = openPopover;
        if (!popover.contains(event.target) && !trigger.contains(event.target)) {
            closePopover({ restoreFocus: false });
        }
    }, true);

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && openPopover) {
            event.preventDefault();
            closePopover();
        }
    });

    window.addEventListener('resize', positionPopover);

    moreMenu.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
            return;
        }
        event.preventDefault();
        const items = $$('#more-menu .menu-item:not([hidden])');
        const index = items.indexOf(document.activeElement);
        const step = event.key === 'ArrowDown' ? 1 : -1;
        items[(index + step + items.length) % items.length]?.focus();
    });

    moreMenu.addEventListener('click', (event) => {
        const item = event.target.closest('.menu-item');
        if (!item) {
            return;
        }
        const { action } = item.dataset;
        closePopover({ restoreFocus: action !== 'rename' });
        if (action === 'rename') {
            startRenameSlot();
        } else if (action === 'duplicate') {
            duplicateActiveSlot();
        } else if (action === 'delete') {
            deleteActiveSlot();
        } else if (action === 'fullscreen') {
            if (document.fullscreenElement) {
                document.exitFullscreen();
            } else {
                document.documentElement.requestFullscreen().catch(() => { });
            }
        }
    });

    /* ---------- Options ---------- */
    const renderOptionsSummary = () => {
        const pills = $$('#options-popover .switch[data-summary]')
            .filter((checkbox) => checkbox.checked)
            .map((checkbox) => {
                const pill = document.createElement('span');
                pill.className = 'summary-pill';
                pill.textContent = checkbox.dataset.summary;
                return pill;
            });
        optionsSummary.replaceChildren(...pills);
    };

    const applyWrapLines = (wrap) => {
        app.classList.toggle('wrap-lines', wrap);
        inputText.wrap = wrap ? 'soft' : 'off';
    };

    const applyFontSize = (size) => {
        const value = ['sm', 'md', 'lg'].includes(size) ? size : 'md';
        document.documentElement.dataset.fontSize = value;
        $$('#font-size-group .seg-btn').forEach((button) => {
            button.setAttribute('aria-checked', String(button.dataset.size === value));
        });
    };

    strictModeCheckbox.addEventListener('change', (e) => {
        strictMode = e.target.checked;
        storage.set('pcr_timeline_strict', strictMode);
        processText();
    });

    hideLowTimeCheckbox.addEventListener('change', (e) => {
        hideLowTime = e.target.checked;
        storage.set('pcr_timeline_hide_low', hideLowTime);
        processText();
    });

    ignoreCommentCheckbox.addEventListener('change', (e) => {
        matchCommentTime = e.target.checked;
        storage.set('pcr_timeline_ignore_comment', matchCommentTime);
        processText();
    });

    highlightTimeCheckbox.addEventListener('change', (e) => {
        highlightTime = e.target.checked;
        storage.set('pcr_timeline_highlight_time', highlightTime);
        processText();
    });

    wrapLinesCheckbox.addEventListener('change', (e) => {
        applyWrapLines(e.target.checked);
        storage.set('pcr_timeline_wrap', e.target.checked);
    });

    $$('#options-popover .switch[data-summary]').forEach((checkbox) => {
        checkbox.addEventListener('change', renderOptionsSummary);
    });

    fontSizeGroup.addEventListener('click', (event) => {
        const button = event.target.closest('.seg-btn');
        if (!button) {
            return;
        }
        applyFontSize(button.dataset.size);
        storage.set('pcr_timeline_font_size', button.dataset.size);
    });

    /* ---------- Fullscreen ---------- */
    const updateFullscreenState = () => {
        const isFullscreen = Boolean(document.fullscreenElement);
        fullscreenToggle.querySelector('.fullscreen-label').textContent = isFullscreen ? '離開全螢幕' : '全螢幕';
    };

    if (document.fullscreenEnabled) {
        fullscreenToggle.hidden = false;
        document.addEventListener('fullscreenchange', updateFullscreenState);
        updateFullscreenState();
    }

    /* ---------- Theme ---------- */
    const themeColors = { light: '#f4f5fa', dark: '#0c0e15' };

    const setTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        themeColorMeta?.setAttribute('content', themeColors[theme] || themeColors.light);
        storage.set('theme', theme);
    };

    const getPreferredTheme = () => {
        const savedTheme = storage.get('theme');
        if (savedTheme) {
            return savedTheme;
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    setTheme(getPreferredTheme());

    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
    });

    /* ---------- Init ---------- */
    initSlots();

    const savedSeconds = storage.get('pcr_timeline_seconds');
    if (savedSeconds !== null) {
        updateState(parseInt(savedSeconds, 10));
    }

    const savedStrict = storage.get('pcr_timeline_strict');
    if (savedStrict !== null) {
        strictMode = (savedStrict === 'true');
        strictModeCheckbox.checked = strictMode;
    }

    const savedHideLow = storage.get('pcr_timeline_hide_low');
    if (savedHideLow !== null) {
        hideLowTime = (savedHideLow === 'true');
        hideLowTimeCheckbox.checked = hideLowTime;
    }

    const savedIgnoreComment = storage.get('pcr_timeline_ignore_comment');
    if (savedIgnoreComment !== null) {
        matchCommentTime = (savedIgnoreComment === 'true');
        ignoreCommentCheckbox.checked = matchCommentTime;
    }

    const savedHighlightTime = storage.get('pcr_timeline_highlight_time');
    if (savedHighlightTime !== null) {
        highlightTime = (savedHighlightTime === 'true');
        highlightTimeCheckbox.checked = highlightTime;
    }

    const savedWrap = storage.get('pcr_timeline_wrap');
    wrapLinesCheckbox.checked = savedWrap === null ? true : savedWrap === 'true';
    applyWrapLines(wrapLinesCheckbox.checked);
    applyFontSize(storage.get('pcr_timeline_font_size'));

    if (!window.PPOCRv5) {
        ocrUploadBtn.title = '圖片辨識元件未載入';
    }

    renderSeconds();
    renderOptionsSummary();
    processText();
});
