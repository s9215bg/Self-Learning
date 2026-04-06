import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, set, push, remove, get, child } from "firebase/database";

// --- Firebase Configuration ---
const firebaseConfig = {
  apiKey: "AIzaSyDY0Bovx3F37Kjp3KxjMteu8USgn_lueS8",
  authDomain: "self-learning-0623.firebaseapp.com",
  databaseURL: "https://self-learning-0623-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "self-learning-0623",
  storageBucket: "self-learning-0623.firebasestorage.app",
  messagingSenderId: "587292275586",
  appId: "1:587292275586:web:0b034bd93dbe0b6d96d59b",
  measurementId: "G-H996XDMVYR"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// --- State ---
let currentPath = []; // Array of path segments
let commandHistory = [];
let historyIndex = -1;
let dbSnapshot = null;

const outputEl = document.getElementById('terminal-output');
const inputForm = document.getElementById('input-form');
const terminalInput = document.getElementById('terminal-input');
const promptEl = document.getElementById('prompt');
const monitorEl = document.getElementById('db-monitor');
const statusDot = document.getElementById('connection-status');

// --- Initialization ---
function init() {
    // Listen to the whole DB for the Monitor
    const rootRef = ref(db, '/');
    onValue(rootRef, (snapshot) => {
        dbSnapshot = snapshot.val();
        renderMonitor(dbSnapshot);
        statusDot.classList.add('online');
    }, (error) => {
        statusDot.classList.remove('online');
        logOutput(`Firebase Error: ${error.message}`, 'error');
    });

    // Mobile Viewport Handling
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', handleViewportChange);
    }

    // Keyboard Helper
    document.querySelectorAll('#keyboard-helper button').forEach(btn => {
        btn.addEventListener('click', () => handleHelperKey(btn.dataset.key));
    });

    // Auto-focus terminal on click
    document.getElementById('terminal-container').addEventListener('click', () => {
        terminalInput.focus();
    });

    // Initial Practice Data (Optional)
    checkAndSeedData();
}

// --- Terminal Logic ---
inputForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const command = terminalInput.value.trim();
    if (command) {
        processCommand(command);
        commandHistory.push(command);
        historyIndex = commandHistory.length;
    }
    terminalInput.value = '';
});

async function processCommand(rawInput) {
    // Robust parsing: handles quotes and redirection
    const tokens = [];
    const regex = /[^\s"'>]+|"[^"]*"|'[^']*'|>/g;
    let match;
    while ((match = regex.exec(rawInput)) !== null) {
        let token = match[0];
        if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
            token = token.substring(1, token.length - 1);
        }
        tokens.push(token);
    }

    if (tokens.length === 0) return;

    // Handle Redirection ">"
    let redirectPath = null;
    let commandTokens = [...tokens];
    const redirectIndex = tokens.indexOf('>');
    if (redirectIndex !== -1) {
        commandTokens = tokens.slice(0, redirectIndex);
        redirectPath = tokens[redirectIndex + 1];
    }

    const cmd = commandTokens[0].toLowerCase();
    const args = [];
    const options = [];

    for (let i = 1; i < commandTokens.length; i++) {
        if (commandTokens[i].startsWith('-')) {
            options.push(commandTokens[i]);
        } else {
            args.push(commandTokens[i]);
        }
    }

    logOutput(`<span class="prompt-line">${getPromptText()}</span> ${rawInput}`);

    let result = null; // Store output for redirection

    switch (cmd) {
        case 'help':
            logOutput(`Available commands:
  ls [-l] [path] - List children
  cd [path]      - Change directory
  mkdir [path]   - Create a node (directory)
  touch [path]   - Create an empty node (file)
  rm [path]      - Remove a node
  cat [path]     - Show node value
  echo [text] [> path] - Print text or save to path
  clear          - Clear terminal
  pwd            - Print working directory
  help           - Show this message`);
            break;

        case 'clear':
            outputEl.innerHTML = '';
            break;

        case 'pwd':
            logOutput('/' + currentPath.join('/'));
            break;

        case 'ls':
            handleLs(args[0], options);
            break;

        case 'cd':
            handleCd(args[0]);
            break;

        case 'mkdir':
            handleMkdir(args[0]);
            break;

        case 'touch':
            handleTouch(args[0]);
            break;

        case 'rm':
            handleRm(args[0]);
            break;

        case 'cat':
            handleCat(args[0]);
            break;

        case 'echo':
            result = args.join(' ');
            if (redirectPath) {
                await handleWriteData(redirectPath, result);
            } else {
                logOutput(result);
            }
            break;

        default:
            logOutput(`-bash: ${cmd}: command not found`, 'error');
    }

    scrollToBottom();
}

async function handleWriteData(target, value) {
    if (!target) {
        logOutput('bash: syntax error near unexpected token `newline`');
        return;
    }
    const pathSegments = resolvePath(target);
    try {
        await set(ref(db, pathSegments.join('/')), value);
        logOutput(`Written to ${target}`);
    } catch (e) {
        logOutput(`bash: ${target}: ${e.message}`, 'error');
    }
}

// --- Command Handlers ---

function handleLs(targetPath = '.', options = []) {
    const isLong = options.includes('-l');
    const fullPath = resolvePath(targetPath);
    const data = getNestedData(dbSnapshot, fullPath);

    if (data === undefined || data === null) {
        logOutput(`ls: cannot access '${targetPath}': No such path`);
        return;
    }

    if (typeof data !== 'object') {
        if (isLong) {
            logOutput(formatLsLong(targetPath.split('/').pop() || 'node', data));
        } else {
            logOutput(targetPath);
        }
    } else {
        const keys = Object.keys(data).filter(k => k !== '_createdAt');
        if (keys.length === 0) return;

        if (isLong) {
            keys.forEach(key => {
                logOutput(formatLsLong(key, data[key]));
            });
        } else {
            logOutput(keys.join('   '));
        }
    }
}

function formatLsLong(name, value) {
    const isDir = value !== null && typeof value === 'object';
    const perms = isDir ? 'drwxr-xr-x' : '-rw-r--r--';
    const owner = 'user';
    const group = 'group';
    const size = isDir ? 4096 : JSON.stringify(value).length;
    
    // Date formatting
    let dateStr = "";
    const created = (value && typeof value === 'object') ? value['_createdAt'] : null;
    const dateObj = created ? new Date(created) : new Date();
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const month = months[dateObj.getMonth()];
    const day = dateObj.getDate().toString().padStart(2, ' ');
    const hours = dateObj.getHours().toString().padStart(2, '0');
    const mins = dateObj.getMinutes().toString().padStart(2, '0');
    dateStr = `${month} ${day} ${hours}:${mins}`;

    return `<div class="ls-row">
        <span class="ls-perms">${perms}</span>
        <span class="ls-owner">${owner}</span>
        <span class="ls-group">${group}</span>
        <span class="ls-size">${size.toString().padStart(5, ' ')}</span>
        <span class="ls-date">${dateStr}</span>
        <span class="ls-name ${isDir ? 'is-dir' : ''}">${name}</span>
    </div>`;
}

function handleCd(targetPath) {
    if (!targetPath || targetPath === '~') {
        currentPath = [];
        updatePrompt();
        return;
    }
    if (targetPath === '.') return;
    
    if (targetPath === '..') {
        currentPath.pop();
        updatePrompt();
        return;
    }

    const newPath = resolvePath(targetPath);
    const data = getNestedData(dbSnapshot, newPath);

    if (data && typeof data === 'object') {
        currentPath = newPath;
        updatePrompt();
    } else {
        logOutput(`-bash: cd: ${targetPath}: No such directory`);
    }
}

async function handleMkdir(name) {
    if (!name) {
        logOutput('mkdir: missing operand');
        return;
    }
    const targetPath = resolvePath(name);
    try {
        const snapshot = await get(ref(db, targetPath.join('/')));
        if (snapshot.exists()) {
            logOutput(`mkdir: cannot create directory '${name}': File exists`, 'error');
            return;
        }
        await set(ref(db, targetPath.join('/')), {
            "_createdAt": Date.now(),
            "info": "Empty directory"
        });
        logOutput(`Created node: ${name}`);
    } catch (e) {
        logOutput(`mkdir: ${e.message}`, 'error');
    }
}

async function handleTouch(name) {
    if (!name) {
        logOutput('touch: missing operand');
        return;
    }
    const targetPath = resolvePath(name);
    try {
        const snapshot = await get(ref(db, targetPath.join('/')));
        if (snapshot.exists()) {
            // Standard touch behavior: don't overwrite if it exists
            logOutput(`touch: ${name}: File already exists (updated timestamp)`);
            return;
        }
        // Create an empty string node (acts like a file)
        await set(ref(db, targetPath.join('/')), "");
        logOutput(`Created file: ${name}`);
    } catch (e) {
        logOutput(`touch: ${e.message}`, 'error');
    }
}

async function handleRm(target) {
    if (!target) {
        logOutput('rm: missing operand');
        return;
    }
    const pathSegments = resolvePath(target);
    try {
        await remove(ref(db, pathSegments.join('/')));
        logOutput(`Removed: ${target}`);
    } catch (e) {
        logOutput(`rm: ${e.message}`, 'error');
    }
}

function handleCat(target) {
    if (!target) {
        logOutput('cat: missing operand');
        return;
    }
    const pathSegments = resolvePath(target);
    const data = getNestedData(dbSnapshot, pathSegments);
    if (data === undefined) {
        logOutput(`cat: ${target}: No such file or directory`);
    } else {
        logOutput(JSON.stringify(data, null, 2));
    }
}

// --- Utilities ---

function resolvePath(target) {
    if (!target) return [...currentPath];
    if (target.startsWith('/')) return target.split('/').filter(Boolean);
    
    const parts = target.split('/').filter(Boolean);
    let result = [...currentPath];

    for (const part of parts) {
        if (part === '..') result.pop();
        else if (part !== '.') result.push(part);
    }
    return result;
}

function getNestedData(obj, pathArr) {
    let current = obj;
    for (const key of pathArr) {
        if (current && typeof current === 'object' && key in current) {
            current = current[key];
        } else {
            return undefined;
        }
    }
    return current;
}

function logOutput(html, type = '') {
    const div = document.createElement('div');
    div.className = `line ${type}`;
    div.innerHTML = html;
    outputEl.appendChild(div);
}

function updatePrompt() {
    promptEl.innerText = getPromptText();
}

function getPromptText() {
    const pathStr = currentPath.length === 0 ? '~' : '~/' + currentPath.join('/');
    return `${pathStr} $`;
}

function scrollToBottom() {
    outputEl.scrollTop = outputEl.scrollHeight;
}

// --- UI / Mobile Helpers ---

function handleHelperKey(key) {
    switch (key) {
        case 'Tab':
            // Simple Tab completion for 'ls' results in current path
            const val = terminalInput.value;
            const parts = val.split(' ');
            const lastPart = parts[parts.length - 1];
            if (dbSnapshot && currentPath) {
                const data = getNestedData(dbSnapshot, currentPath);
                if (data && typeof data === 'object') {
                    const keys = Object.keys(data).filter(k => k.startsWith(lastPart));
                    if (keys.length === 1) {
                        parts[parts.length - 1] = keys[0];
                        terminalInput.value = parts.join(' ') + '/';
                    }
                }
            }
            break;
        case 'ArrowUp':
            if (historyIndex > 0) {
                historyIndex--;
                terminalInput.value = commandHistory[historyIndex];
            }
            break;
        case 'ArrowDown':
            if (historyIndex < commandHistory.length - 1) {
                historyIndex++;
                terminalInput.value = commandHistory[historyIndex];
            } else {
                historyIndex = commandHistory.length;
                terminalInput.value = '';
            }
            break;
        case 'clear':
            terminalInput.value = '';
            break;
        default:
            // Just insert the character at cursor
            const start = terminalInput.selectionStart;
            const end = terminalInput.selectionEnd;
            const text = terminalInput.value;
            terminalInput.value = text.substring(0, start) + key + text.substring(end);
            terminalInput.selectionStart = terminalInput.selectionEnd = start + key.length;
    }
    terminalInput.focus();
}

function handleViewportChange() {
    const vv = window.visualViewport;
    const terminal = document.getElementById('terminal-container');
    // Adjust height when keyboard appears
    if (vv.height < window.innerHeight) {
        terminal.style.flexBasis = `${vv.height * 0.5}px`;
    } else {
        terminal.style.flexBasis = '40%';
    }
}

// --- Monitor Rendering ---

function renderMonitor(data) {
    if (!data) {
        monitorEl.innerHTML = '<div class="monitor-placeholder">資料庫為空</div>';
        return;
    }
    monitorEl.innerHTML = '';
    const root = document.createElement('div');
    root.appendChild(createTreeNode('root', data));
    monitorEl.appendChild(root);
}

function createTreeNode(key, value) {
    const container = document.createElement('div');
    container.className = 'tree-node';
    
    const label = document.createElement('div');
    const isObject = value !== null && typeof value === 'object';
    
    let content = `<span class="tree-key">${key}</span>: `;
    
    if (isObject) {
        content += `{`;
        label.innerHTML = content;
        container.appendChild(label);
        
        const childrenContainer = document.createElement('div');
        Object.entries(value).forEach(([childKey, childValue]) => {
            if (childKey === '_createdAt') return;
            childrenContainer.appendChild(createTreeNode(childKey, childValue));
        });
        container.appendChild(childrenContainer);
        
        const closeBrace = document.createElement('div');
        closeBrace.innerHTML = `}`;
        container.appendChild(closeBrace);
    } else {
        const type = typeof value;
        const valClass = `tree-${type}`;
        const displayedValue = type === 'string' ? `"${value}"` : value;
        content += `<span class="${valClass}">${displayedValue}</span>`;
        label.innerHTML = content;
        container.appendChild(label);
    }
    
    return container;
}

// --- Seed Data ---
async function checkAndSeedData() {
    // Only seed if root is empty (wait a bit for onValue)
    setTimeout(async () => {
        if (!dbSnapshot) {
            logOutput('Initializing practice data...');
            const seed = {
                "users": {
                    "admin": { "role": "superuser", "active": true },
                    "guest": { "role": "visitor", "active": false }
                },
                "system": {
                    "version": "1.0.0",
                    "status": "online"
                },
                "test": {
                    "readme": "Welcome to Firebase Shell Simulator!"
                }
            };
            try {
                await set(ref(db, '/'), seed);
                logOutput('Practice data initialized.', 'success');
            } catch (e) {
                console.error(e);
            }
        }
    }, 2000);
}

document.addEventListener('DOMContentLoaded', init);
