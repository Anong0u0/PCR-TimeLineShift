document.addEventListener('DOMContentLoaded', () => {
    const inputText = document.getElementById('input-text');
    const outputCode = document.getElementById('output-code');
    const secondsInput = document.getElementById('seconds-input');
    const secondsSlider = document.getElementById('seconds-slider');
    const btnMinus = document.getElementById('btn-minus');
    const btnPlus = document.getElementById('btn-plus');
    const strictModeCheckbox = document.getElementById('strict-mode');
    const hideLowTimeCheckbox = document.getElementById('hide-low-time');
    const ignoreCommentCheckbox = document.getElementById('ignore-comment');
    const highlightTimeCheckbox = document.getElementById('highlight-time');
    const copyBtn = document.getElementById('copy-btn');
    const mainContent = document.querySelector('.main-content');
    const btnContentDefault = copyBtn.querySelector('.default-state');
    const btnContentCopied = copyBtn.querySelector('.copied-state');
    const ocrUploadBtn = document.getElementById('ocr-upload-btn');
    const ocrFileInput = document.getElementById('ocr-file-input');
    const ocrStatus = document.getElementById('ocr-status');
    const ocrDropOverlay = document.getElementById('ocr-drop-overlay');
    const codeContent = document.querySelector('.code-content');
    const slotTabs = document.getElementById('slot-tabs');
    const slotAddBtn = document.getElementById('slot-add');
    const slotRenameBtn = document.getElementById('slot-rename');
    const slotDuplicateBtn = document.getElementById('slot-duplicate');
    const slotDeleteBtn = document.getElementById('slot-delete');

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
    const slotsKey = 'pcr_timeline_slots';
    const activeSlotKey = 'pcr_timeline_active_slot';
    const highlightMarker = '󠉑'; // \ue0251

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
    const ocrStatusModes = ['is-loading', 'is-ready', 'is-error'];
    const setOcrStatus = (message = '', mode = '') => {
        if (!ocrStatus) {
            return;
        }
        ocrStatus.textContent = message;
        ocrStatus.classList.remove(...ocrStatusModes);
        if (mode) {
            ocrStatus.classList.add(mode);
        }
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
        const failText = `OCR 初始化失敗: ${progress.message || 'unknown error'}`;
        const unified = progress.progress;
        if (unified) {
            if (unified.state === 'failed' || progress.state === 'failed' || progress.phase === 'error') {
                return ['OCR 失敗: ' + (progress.message || 'unknown error'), 'is-error'];
            }
            if (unified.kind === 'recognize') {
                return unified.state === 'done'
                    ? ['OCR 辨識完成', 'is-ready']
                    : [`OCR 辨識中 ${toPercentText(unified.percent)}`, 'is-loading'];
            }
            if (unified.kind === 'init') {
                return (unified.percent >= 100 || (progress.phase === 'ready' && progress.state === 'done'))
                    ? ['OCR 已就緒', 'is-ready']
                    : [`OCR 初始化中 ${toPercentText(unified.percent)}`, 'is-loading'];
            }
        }
        if (progress.phase === 'download' && progress.download?.overall) {
            return [`OCR 初始化中 ${toPercentText(progress.download.overall.percent)}`, 'is-loading'];
        }
        if (progress.phase === 'warmup' && progress.warmup?.total) {
            return [`OCR 暖機 ${progress.warmup.current}/${progress.warmup.total}`, 'is-loading'];
        }
        if (progress.phase === 'ready' && progress.state === 'done') {
            return ['OCR 已就緒', 'is-ready'];
        }
        if (progress.phase === 'error' || progress.state === 'failed') {
            return [failText, 'is-error'];
        }
        if (progress.state === 'loading' || progress.state === 'creating' || progress.state === 'running') {
            return ['OCR 初始化中...', 'is-loading'];
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
    const applyOcrText = (text = '') => {
        // Keep the current 刀 intact: OCR into a fresh slot unless the current one is empty.
        if (inputText.value.trim()) {
            insertSlot(createSlot(text));
            return;
        }
        inputText.value = text;
        setActiveSlotText(text);
        processText();
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
            setOcrStatus('OCR plugin 未載入', 'is-error');
            return null;
        }
        if (!ocrInitProgressUnsub) {
            ocrInitProgressUnsub = window.PPOCRv5.onInitProgress(renderOcrProgress);
        }
        if (ocrEngine) {
            setIdleOcrStatus('OCR 已就緒', 'is-ready');
            return Promise.resolve(ocrEngine);
        }
        if (!ocrInitPromise) {
            setIdleOcrStatus('OCR 初始化中...', 'is-loading');
            ocrInitPromise = window.PPOCRv5.init()
                .then((engine) => {
                    ocrEngine = engine;
                    setIdleOcrStatus('OCR 已就緒', 'is-ready');
                    return engine;
                })
                .catch((error) => {
                    ocrInitPromise = null;
                    ocrEngine = null;
                    setOcrError('OCR 初始化失敗', error);
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
            setOcrStatus('OCR 辨識中，請稍候', 'is-loading');
            return;
        }
        ocrProcessing = true;
        try {
            const engine = await ensureOcrEngine();
            ocrRecognizing = true;
            setOcrStatus('OCR 辨識中...', 'is-loading');
            const result = await engine.recognizeFile(file);
            applyOcrText(result?.text || '');
            setOcrStatus('OCR 辨識完成', 'is-ready');
        } catch (error) {
            setOcrError(ocrRecognizing ? 'OCR 辨識失敗' : 'OCR 初始化失敗', error);
        } finally {
            ocrRecognizing = false;
            ocrProcessing = false;
        }
    };

    const processText = () => {
        const text = inputText.value;
        const offset = remainingSeconds - 90;

        const lines = text.split('\n');

        const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0);

        const processedLines = [];
        let warningShown = false;
        let shouldSkipFollowers = false;

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
                    return;
                }
            } else if (shouldSkipFollowers) {
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
    };

    const updateState = (newVal) => {
        let val = Math.max(0, Math.min(90, newVal));
        remainingSeconds = val;

        secondsInput.value = val;
        secondsSlider.value = val;

        localStorage.setItem('pcr_timeline_seconds', val);

        processText();
    };

    const createSlot = (text = '', name = '') => ({
        id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
        name,
        text,
        updatedAt: Date.now(),
    });
    const getActiveSlot = () => slots.find((slot) => slot.id === activeSlotId);
    const getSlotLabel = (slot) => {
        if (slot.name) {
            return slot.name;
        }
        const firstLine = slot.text.split('\n').map((line) => line.trim()).find(Boolean);
        return firstLine ? firstLine.slice(0, 50) : '未命名';
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

    const createSlotTab = (slot) => {
        const tab = document.createElement('button');
        const label = getSlotLabel(slot);
        tab.type = 'button';
        tab.className = 'slot-tab';
        tab.dataset.slotId = slot.id;
        tab.textContent = label;
        tab.title = label;
        if (slot.id === activeSlotId) {
            tab.classList.add('active');
            tab.setAttribute('aria-current', 'true');
        }
        return tab;
    };

    const scrollTabIntoView = (tab) => {
        const margin = 8;
        if (tab.offsetLeft < slotTabs.scrollLeft) {
            slotTabs.scrollLeft = tab.offsetLeft - margin;
        } else if (tab.offsetLeft + tab.offsetWidth > slotTabs.scrollLeft + slotTabs.clientWidth) {
            slotTabs.scrollLeft = tab.offsetLeft + tab.offsetWidth - slotTabs.clientWidth + margin;
        }
    };

    const renderSlotTabs = () => {
        slotTabs.replaceChildren(...slots.map(createSlotTab));
        const activeTab = slotTabs.querySelector('.slot-tab.active');
        if (activeTab) {
            scrollTabIntoView(activeTab);
        }
    };

    const loadActiveSlot = () => {
        inputText.value = getActiveSlot()?.text ?? '';
        inputText.scrollTop = 0;
        if (codeContent) {
            codeContent.scrollTop = 0;
        }
        saveSlots();
        renderSlotTabs();
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
        const activeTab = slotTabs.querySelector('.slot-tab.active');
        if (activeTab) {
            const label = getSlotLabel(slot);
            activeTab.textContent = label;
            activeTab.title = label;
            scrollTabIntoView(activeTab);
        }
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

    const duplicateActiveSlot = () => {
        const source = getActiveSlot();
        if (!source) {
            return;
        }
        insertSlot(createSlot(source.text, `${getSlotLabel(source)} 複本`), slots.indexOf(source) + 1);
    };

    const deleteActiveSlot = () => {
        const slot = getActiveSlot();
        if (!slot) {
            return;
        }
        if (slot.text.trim() && !window.confirm(`確定要刪除「${getSlotLabel(slot)}」嗎？此動作無法復原。`)) {
            return;
        }
        const index = slots.indexOf(slot);
        slots.splice(index, 1);
        if (slots.length === 0) {
            slots.push(createSlot());
        }
        activeSlotId = slots[Math.min(index, slots.length - 1)].id;
        loadActiveSlot();
    };

    const startRenameSlot = () => {
        const slot = getActiveSlot();
        const activeTab = slotTabs.querySelector('.slot-tab.active');
        if (!slot || !activeTab) {
            return;
        }
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'slot-rename-input';
        input.value = slot.name;
        input.placeholder = getSlotLabel({ ...slot, name: '' });
        input.maxLength = 50;
        input.setAttribute('aria-label', '刀名稱（留空則使用第一行）');

        let finished = false;
        const finish = (shouldSave) => {
            if (finished) {
                return;
            }
            finished = true;
            if (shouldSave) {
                slot.name = input.value.trim();
                slot.updatedAt = Date.now();
                saveSlots();
            }
            if (input.isConnected) {
                input.replaceWith(createSlotTab(slot));
            }
        };

        input.addEventListener('keydown', (event) => {
            if (event.isComposing || event.keyCode === 229) {
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                finish(true);
            } else if (event.key === 'Escape') {
                event.preventDefault();
                finish(false);
            }
        });
        input.addEventListener('blur', () => finish(true));

        activeTab.replaceWith(input);
        input.focus();
        input.select();
    };

    const initSlots = () => {
        slots = readSlots();
        if (slots.length === 0) {
            slots = [createSlot(localStorage.getItem('pcr_timeline_input') ?? '')];
        }
        const savedActiveId = localStorage.getItem(activeSlotKey);
        activeSlotId = slots.some((slot) => slot.id === savedActiveId) ? savedActiveId : slots[0].id;
        inputText.value = getActiveSlot().text;
        saveSlots();
        renderSlotTabs();
    };

    inputText.addEventListener('input', () => {
        setActiveSlotText(inputText.value);
        processText();
    });

    slotTabs.addEventListener('mousedown', (event) => {
        const renameInput = slotTabs.querySelector('.slot-rename-input');
        const tab = event.target.closest('.slot-tab');
        if (!renameInput || !tab) {
            return;
        }
        // Committing the rename resizes the tabs, so the click would miss: switch right away.
        event.preventDefault();
        renameInput.blur();
        switchSlot(tab.dataset.slotId);
    });

    slotTabs.addEventListener('click', (event) => {
        const tab = event.target.closest('.slot-tab');
        if (tab) {
            switchSlot(tab.dataset.slotId);
        }
    });

    slotTabs.addEventListener('dblclick', (event) => {
        if (event.target.closest('.slot-tab.active')) {
            startRenameSlot();
        }
    });

    slotAddBtn.addEventListener('click', () => {
        insertSlot(createSlot());
        if (inputPanel.classList.contains('collapsed')) {
            inputHeaderToggle.click();
        }
        if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
            inputText.focus();
        }
    });

    slotRenameBtn.addEventListener('click', startRenameSlot);
    slotDuplicateBtn.addEventListener('click', duplicateActiveSlot);
    slotDeleteBtn.addEventListener('click', deleteActiveSlot);

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
        renderSlotTabs();
    });

    document.addEventListener('paste', (event) => {
        const imageFile = getClipboardImageFile(event.clipboardData);
        if (!imageFile) {
            return;
        }
        event.preventDefault();
        startOcrInitInBackground();
        runOcrFromFile(imageFile);
    }, true);

    if (ocrUploadBtn && ocrFileInput) {
        ocrUploadBtn.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
        });

        ocrUploadBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            startOcrInitInBackground();
            ocrFileInput.value = '';
            ocrFileInput.click();
        });

        ocrFileInput.addEventListener('change', (event) => {
            const [file] = event.target.files || [];
            if (file) {
                runOcrFromFile(file);
            }
            event.target.value = '';
        });
    }

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
            setOcrStatus('拖曳內容不是圖片檔', 'is-error');
            return;
        }
        runOcrFromFile(imageFile);
    });

    secondsInput.addEventListener('input', (e) => {
        let val = parseInt(e.target.value);
        if (!isNaN(val)) {
            updateState(val);
        }
    });

    secondsSlider.addEventListener('input', (e) => {
        let val = parseInt(e.target.value);
        updateState(val);
    });

    btnMinus.addEventListener('click', () => {
        updateState(remainingSeconds - 1);
    });

    btnPlus.addEventListener('click', () => {
        updateState(remainingSeconds + 1);
    });

    strictModeCheckbox.addEventListener('change', (e) => {
        strictMode = e.target.checked;
        localStorage.setItem('pcr_timeline_strict', strictMode);
        processText();
    });

    hideLowTimeCheckbox.addEventListener('change', (e) => {
        hideLowTime = e.target.checked;
        localStorage.setItem('pcr_timeline_hide_low', hideLowTime);
        processText();
    });

    ignoreCommentCheckbox.addEventListener('change', (e) => {
        matchCommentTime = e.target.checked;
        localStorage.setItem('pcr_timeline_ignore_comment', matchCommentTime);
        processText();
    });

    highlightTimeCheckbox.addEventListener('change', (e) => {
        highlightTime = e.target.checked;
        localStorage.setItem('pcr_timeline_highlight_time', highlightTime);
        processText();
    });

    document.querySelectorAll('.checkbox-wrapper').forEach((wrapper) => {
        const checkbox = wrapper.querySelector('input[type="checkbox"]');
        if (!checkbox) {
            return;
        }

        wrapper.addEventListener('click', (e) => {
            if (e.target === checkbox || e.target.closest('label') || e.target.closest('.tooltip-container')) {
                return;
            }
            checkbox.click();
        });
    });

    const inputPanel = document.getElementById('input-panel');
    const inputHeaderToggle = document.getElementById('input-header-toggle');
    const toggleLabel = inputHeaderToggle.querySelector('.toggle-label');
    const controlsPanel = document.getElementById('controls-panel');
    const controlsHeaderToggle = document.getElementById('controls-header-toggle');
    let updateControlsHeight = () => { };
    let setControlsCollapsed = null;
    const appHeader = document.querySelector('.app-header');
    let headerOverrideVisible = false;

    const updateHeaderState = () => {
        if (!appHeader) {
            return;
        }
        const shouldCollapse = inputPanel?.classList.contains('collapsed')
            && controlsPanel?.classList.contains('collapsed')
            && !headerOverrideVisible;

        document.body.classList.toggle('header-collapsed', shouldCollapse);
    };

    inputHeaderToggle.addEventListener('click', (event) => {
        if (event.target instanceof Element
            && event.target.closest('#ocr-upload-btn, #ocr-file-input')) {
            return;
        }
        inputPanel.classList.toggle('collapsed');
        const inputCollapsed = inputPanel.classList.contains('collapsed');
        if (inputCollapsed) {
            toggleLabel.textContent = "展開原始軸";
        } else {
            toggleLabel.textContent = "摺疊";
        }
        if (mainContent) {
            mainContent.classList.toggle('input-collapsed', inputCollapsed);
            requestAnimationFrame(updateControlsHeight);
        }
        if (!inputCollapsed && setControlsCollapsed && window.matchMedia('(min-width: 1024px)').matches) {
            setControlsCollapsed(false);
        }
        headerOverrideVisible = false;
        updateHeaderState();
    });

    if (controlsPanel && controlsHeaderToggle && mainContent) {
        const controlsToggleLabel = controlsHeaderToggle.querySelector('.controls-toggle-label');

        updateControlsHeight = () => {
            if (controlsPanel.classList.contains('collapsed')) {
                return;
            }
            mainContent.style.setProperty('--controls-height', `${controlsPanel.offsetHeight}px`);
        };

        updateControlsHeight();

        window.addEventListener('resize', () => {
            updateControlsHeight();
            if (window.matchMedia('(min-width: 1024px)').matches
                && !inputPanel.classList.contains('collapsed')
                && controlsPanel.classList.contains('collapsed')) {
                setControlsCollapsed(false);
            }
        });

        setControlsCollapsed = (shouldCollapse) => {
            if (!shouldCollapse) {
                controlsPanel.classList.remove('collapsed');
                mainContent.classList.remove('controls-collapsed');
                controlsHeaderToggle.setAttribute('aria-expanded', 'true');
                if (controlsToggleLabel) {
                    controlsToggleLabel.textContent = "摺疊";
                }
                requestAnimationFrame(updateControlsHeight);
                headerOverrideVisible = false;
                updateHeaderState();
                return;
            }

            updateControlsHeight();
            controlsPanel.classList.add('collapsed');
            mainContent.classList.add('controls-collapsed');
            controlsHeaderToggle.setAttribute('aria-expanded', 'false');
            if (controlsToggleLabel) {
                controlsToggleLabel.textContent = "展開設定";
            }
            headerOverrideVisible = false;
            updateHeaderState();
        };

        const toggleControlsPanel = () => {
            const isCollapsed = controlsPanel.classList.contains('collapsed');
            setControlsCollapsed(!isCollapsed);
        };

        controlsHeaderToggle.addEventListener('click', toggleControlsPanel);
        controlsHeaderToggle.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                toggleControlsPanel();
            }
        });
    }

    const showCopyState = () => {
        copyBtn.classList.add('copied');
        btnContentDefault.style.display = 'none';
        btnContentCopied.style.display = 'flex';

        setTimeout(() => {
            copyBtn.classList.remove('copied');
            btnContentDefault.style.display = 'flex';
            btnContentCopied.style.display = 'none';
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
            }
        } finally {
            document.body.removeChild(temp);
        }
    };

    copyBtn.addEventListener('click', () => {
        const text = outputCode.textContent;
        if (navigator?.clipboard?.writeText) {
            navigator.clipboard.writeText(text)
                .then(showCopyState)
                .catch(() => fallbackCopy(text));
            return;
        }
        fallbackCopy(text);
    });

    const fullscreenToggleBtn = document.getElementById('fullscreen-toggle');
    const updateFullscreenState = () => {
        if (!fullscreenToggleBtn) {
            return;
        }
        const isFullscreen = Boolean(document.fullscreenElement);
        fullscreenToggleBtn.classList.toggle('is-fullscreen', isFullscreen);
        fullscreenToggleBtn.setAttribute('aria-pressed', String(isFullscreen));
        fullscreenToggleBtn.setAttribute('aria-label', isFullscreen ? '離開全螢幕' : '進入全螢幕');
    };

    if (fullscreenToggleBtn && document.fullscreenEnabled) {
        fullscreenToggleBtn.addEventListener('click', () => {
            if (document.fullscreenElement) {
                document.exitFullscreen();
                return;
            }
            document.documentElement.requestFullscreen().catch(() => { });
        });
        document.addEventListener('fullscreenchange', updateFullscreenState);
        updateFullscreenState();
    }

    const themeToggleBtn = document.getElementById('theme-toggle');

    const setTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('theme', theme);
    }

    const getPreferredTheme = () => {
        const savedTheme = localStorage.getItem('theme');
        if (savedTheme) {
            return savedTheme;
        }
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }

    setTheme(getPreferredTheme());

    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
    });

    initSlots();

    const savedSeconds = localStorage.getItem('pcr_timeline_seconds');
    if (savedSeconds !== null) {
        updateState(parseInt(savedSeconds, 10));
    }

    const savedStrict = localStorage.getItem('pcr_timeline_strict');
    if (savedStrict !== null) {
        strictMode = (savedStrict === 'true');
        strictModeCheckbox.checked = strictMode;
    }

    const savedHideLow = localStorage.getItem('pcr_timeline_hide_low');
    if (savedHideLow !== null) {
        hideLowTime = (savedHideLow === 'true');
        hideLowTimeCheckbox.checked = hideLowTime;
    }

    const savedIgnoreComment = localStorage.getItem('pcr_timeline_ignore_comment');
    if (savedIgnoreComment !== null) {
        matchCommentTime = (savedIgnoreComment === 'true');
        ignoreCommentCheckbox.checked = matchCommentTime;
    }

    const savedHighlightTime = localStorage.getItem('pcr_timeline_highlight_time');
    if (savedHighlightTime !== null) {
        highlightTime = (savedHighlightTime === 'true');
        highlightTimeCheckbox.checked = highlightTime;
    }

    setOcrStatus(window.PPOCRv5 ? 'OCR 待命' : 'OCR plugin 未載入', window.PPOCRv5 ? '' : 'is-error');

    processText();
    updateHeaderState();

    let lastTouchY = null;
    const isInsideCode = (target) => target instanceof Element
        && target.closest('.code-content, pre, code');
    const shouldHandleTouch = (event) => event.touches.length === 1 && !isInsideCode(event.target);

    window.addEventListener('touchstart', (event) => {
        if (!shouldHandleTouch(event)) {
            lastTouchY = null;
            return;
        }
        lastTouchY = event.touches[0].clientY;
    }, { passive: true });

    window.addEventListener('touchmove', (event) => {
        if (!shouldHandleTouch(event) || lastTouchY === null) {
            return;
        }

        const currentY = event.touches[0].clientY;
        const deltaY = lastTouchY - currentY;
        const threshold = 1;

        if (deltaY > threshold) {
            headerOverrideVisible = false;
            updateHeaderState();
        } else if (deltaY < -threshold) {
            headerOverrideVisible = true;
            updateHeaderState();
        }

        lastTouchY = currentY;
    }, { passive: true });

    window.addEventListener('touchend', () => {
        lastTouchY = null;
    }, { passive: true });

    if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
        window.addEventListener('mousemove', (event) => {
            const thresholdY = window.innerHeight * 0.04;
            if (event.clientY <= thresholdY) {
                if (!headerOverrideVisible) {
                    headerOverrideVisible = true;
                    updateHeaderState();
                }
                return;
            }

            if (headerOverrideVisible) {
                headerOverrideVisible = false;
                updateHeaderState();
            }
        });
    }

    const tooltipContainers = document.querySelectorAll('.tooltip-container');
    tooltipContainers.forEach(container => {
        const tooltip = container.querySelector('.tooltip');
        if (!tooltip) return;

        const wrapper = container.closest('.checkbox-wrapper');

        const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

        const adjustPosition = () => {
            const rect = tooltip.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const wrapperRect = wrapper ? wrapper.getBoundingClientRect() : containerRect;
            const viewportWidth = window.innerWidth;
            const margin = 10;
            const tooltipWidth = rect.width;
            const viewportLeft = margin;
            const viewportRight = viewportWidth - margin;
            const maxLeft = viewportRight - tooltipWidth;

            const baseLeft = containerRect.right - tooltipWidth;
            const leftIdeal = wrapperRect.left;
            const rightIdeal = wrapperRect.right - tooltipWidth;

            const leftAligned = clamp(leftIdeal, viewportLeft, maxLeft);
            const rightAligned = clamp(rightIdeal, viewportLeft, maxLeft);
            const desiredLeft = (Math.abs(rightAligned - rightIdeal) <= Math.abs(leftAligned - leftIdeal))
                ? rightAligned
                : leftAligned;

            const offsetX = desiredLeft - baseLeft;

            const targetX = containerRect.left + (containerRect.width / 2);
            const arrowRight = 8;
            const safeMargin = 14;
            const arrowTip = clamp(targetX, desiredLeft + safeMargin, desiredLeft + tooltipWidth - safeMargin);
            const defaultArrowTip = desiredLeft + tooltipWidth - arrowRight;
            const arrowOffsetX = arrowTip - defaultArrowTip;

            tooltip.style.setProperty('--tooltip-offset-x', `${offsetX + 3}px`);
            tooltip.style.setProperty('--tooltip-arrow-offset-x', `${arrowOffsetX + 3}px`);
        };

        container.addEventListener('mouseenter', adjustPosition);
        container.addEventListener('mousemove', adjustPosition);
    });
});
