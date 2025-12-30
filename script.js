document.addEventListener('DOMContentLoaded', () => {
    // DOM Elements
    const inputText = document.getElementById('input-text');
    const outputCode = document.getElementById('output-code');
    const secondsInput = document.getElementById('seconds-input');
    const secondsSlider = document.getElementById('seconds-slider');
    const btnMinus = document.getElementById('btn-minus');
    const btnPlus = document.getElementById('btn-plus');
    const strictModeCheckbox = document.getElementById('strict-mode');
    const hideLowTimeCheckbox = document.getElementById('hide-low-time');
    const copyBtn = document.getElementById('copy-btn');
    const btnContentDefault = copyBtn.querySelector('.default-state');
    const btnContentCopied = copyBtn.querySelector('.copied-state');

    // State
    let remainingSeconds = 30;
    let strictMode = false;
    let hideLowTime = true;

    // --- Core Logic ---

    const processText = () => {
        const text = inputText.value;
        const offset = remainingSeconds - 90;

        const lines = text.split('\n');

        // Calculate max line length for separator padding
        const maxLineLength = lines.reduce((max, line) => Math.max(max, line.length), 0);

        const processedLines = [];
        let warningShown = false;
        let shouldSkipFollowers = false;

        lines.forEach(line => {
            let matchCount = 0;
            let lineHasLowTime = false;

            // Regex from user requirements
            const lineRegex = /(?<!\d)([01]{0,2}?):?([0-5]?\d)(?!\d)/g;

            const processedLine = line.replace(lineRegex, (match, p1, p2) => {
                // Strict Mode: Only replace the first match per line
                if (match.length == 1 && match < 10 && match > 0) { return match; }

                if (strictMode && matchCount > 0) {
                    return match;
                }

                let minutes = 0;
                let seconds = 0;

                if (p1 && p1.length > 0) {
                    minutes = parseInt(p1, 10);
                }
                seconds = parseInt(p2, 10);

                let totalSeconds = minutes * 60 + seconds;
                let newTotalSeconds = totalSeconds + offset;

                // Check for low time warning (< 1 second)
                if (newTotalSeconds < 1) {
                    lineHasLowTime = true;
                }

                const isNegative = newTotalSeconds < 0;
                let absSeconds = Math.abs(newTotalSeconds);

                let newMin = Math.floor(absSeconds / 60);
                let newSec = absSeconds % 60;

                let formattedMin = newMin.toString();
                let formattedSec = newSec.toString().padStart(2, '0');

                matchCount++;

                if (isNegative) {
                    if (newMin > 0) {
                        return `-${formattedMin}${formattedSec}`;
                    } else {
                        return `-${formattedSec}`;
                    }
                } else {
                    return `${formattedMin}${formattedSec}`;
                }
            });

            // Logic check for hiding lines (Parent + Children)
            if (matchCount > 0) {
                if (lineHasLowTime && hideLowTime) {
                    shouldSkipFollowers = true;
                    return;
                } else {
                    shouldSkipFollowers = false;
                }
            } else {
                if (shouldSkipFollowers) {
                    return;
                }
            }

            // Insert warning line if triggered
            if (lineHasLowTime && !warningShown) {
                const baseText = "=== 補償時間不足 ===";
                const totalPadding = Math.max(0, maxLineLength - baseText.length);
                const leftPad = Math.floor(totalPadding / 2);
                const rightPad = totalPadding - leftPad;

                const warningLine = "=".repeat(leftPad) + baseText + "=".repeat(rightPad);
                processedLines.push("// " + warningLine);
                warningShown = true;
            }

            processedLines.push(processedLine);
        });

        const result = processedLines.join('\n');

        // Update Output
        outputCode.textContent = result;

        // Trigger Highlight.js
        if (window.hljs) {
            outputCode.removeAttribute('data-highlighted');
            hljs.highlightElement(outputCode);
        }
    };

    const updateState = (newVal) => {
        // Clamp 0-90
        let val = Math.max(0, Math.min(90, newVal));
        remainingSeconds = val;

        // Sync Inputs
        secondsInput.value = val;
        secondsSlider.value = val;

        localStorage.setItem('pcr_timeline_seconds', val);

        processText();
    };

    // --- Event Listeners ---

    // Input Text Change
    inputText.addEventListener('input', () => {
        localStorage.setItem('pcr_timeline_input', inputText.value);
        processText();
    });

    // Number Input Change
    secondsInput.addEventListener('input', (e) => {
        let val = parseInt(e.target.value);
        if (!isNaN(val)) {
            updateState(val);
        }
    });

    // Slider Change
    secondsSlider.addEventListener('input', (e) => {
        let val = parseInt(e.target.value);
        updateState(val);
    });

    // Plus/Minus Buttons
    btnMinus.addEventListener('click', () => {
        updateState(remainingSeconds - 1);
    });

    btnPlus.addEventListener('click', () => {
        updateState(remainingSeconds + 1);
    });

    // Strict Mode Toggle
    strictModeCheckbox.addEventListener('change', (e) => {
        strictMode = e.target.checked;
        localStorage.setItem('pcr_timeline_strict', strictMode);
        processText();
    });

    // Hide Low Time Toggle
    hideLowTimeCheckbox.addEventListener('change', (e) => {
        hideLowTime = e.target.checked;
        localStorage.setItem('pcr_timeline_hide_low', hideLowTime);
        processText();
    });

    // Input Panel Collapse Toggle
    const inputPanel = document.getElementById('input-panel');
    const inputHeaderToggle = document.getElementById('input-header-toggle');
    const toggleLabel = inputHeaderToggle.querySelector('.toggle-label');

    inputHeaderToggle.addEventListener('click', () => {
        inputPanel.classList.toggle('collapsed');
        if (inputPanel.classList.contains('collapsed')) {
            toggleLabel.textContent = "展開";
        } else {
            toggleLabel.textContent = "收縮";
        }
    });

    // Copy Button
    copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(outputCode.textContent).then(() => {
            copyBtn.classList.add('copied');
            btnContentDefault.style.display = 'none';
            btnContentCopied.style.display = 'flex';

            setTimeout(() => {
                copyBtn.classList.remove('copied');
                btnContentDefault.style.display = 'flex';
                btnContentCopied.style.display = 'none';
            }, 2000);
        });
    });

    // --- Theme Logic ---
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

    // Initialize Theme
    setTheme(getPreferredTheme());

    themeToggleBtn.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
    });

    // --- Initial Render ---
    const savedInput = localStorage.getItem('pcr_timeline_input');
    if (savedInput !== null) {
        inputText.value = savedInput;
    }

    const savedSeconds = localStorage.getItem('pcr_timeline_seconds');
    if (savedSeconds !== null) {
        updateState(parseInt(savedSeconds, 10));
    } else {
        // If no saved seconds, we might still have saved checkboxes, so we need to processText later
        // But updateState calls processText.
        // Let's handle checkboxes below.
    }

    // Load Checkbox States
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

    // Now trigger processText to ensure UI reflects loaded state
    if (savedSeconds === null) {
        processText();
    }
});
