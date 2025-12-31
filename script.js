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

    let remainingSeconds = 90;
    let strictMode = false;
    let hideLowTime = true;
    let matchCommentTime = false;
    let highlightTime = false;
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

    inputText.addEventListener('input', () => {
        localStorage.setItem('pcr_timeline_input', inputText.value);
        processText();
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

    inputHeaderToggle.addEventListener('click', () => {
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

    const savedInput = localStorage.getItem('pcr_timeline_input');
    if (savedInput !== null) {
        inputText.value = savedInput;
    }

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
