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
    const parts = rawInput.split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);

    logOutput(`<span class="prompt-line">${getPromptText()}</span> ${rawInput}`);

    switch (cmd) {
        case 'help':
            logOutput(`Available commands:
  ls [path]    - List children
  cd [path]    - Change directory
  mkdir [name] - Create a node
  rm [path]    - Remove a node
  cat [path]   - Show node value
  clear        - Clear terminal
  pwd          - Print working directory
  help         - Show this message`);
            break;

        case 'clear':
            outputEl.innerHTML = '';
            break;

        case 'pwd':
            logOutput('/' + currentPath.join('/'));
            break;

        case 'ls':
            handleLs(args[0]);
            break;

        case 'cd':
            handleCd(args[0]);
            break;

        case 'mkdir':
            handleMkdir(args[0]);
            break;

        case 'rm':
            handleRm(args[0]);
            break;

        case 'cat':
            handleCat(args[0]);
            break;

        default:
            logOutput(`-bash: ${cmd}: command not found`, 'error');
    }

    scrollToBottom();
}

// --- Command Handlers ---

function handleLs(targetPath = '.') {
    const fullPath = resolvePath(targetPath);
    const data = getNestedData(dbSnapshot, fullPath);

    if (data === undefined || data === null) {
        logOutput(`ls: cannot access '${targetPath}': No such path`);
    } else if (typeof data !== 'object') {
        logOutput(targetPath); // It's a leaf node
    } else {
        const keys = Object.keys(data).filter(k => k !== '.created');
        if (keys.length > 0) {
            logOutput(keys.join('   '));
        }
    }
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
        await set(ref(db, targetPath.join('/')), {
            ".created": Date.now(),
            "info": "Empty directory"
        });
        logOutput(`Created node: ${name}`);
    } catch (e) {
        logOutput(`mkdir: ${e.message}`, 'error');
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
            if (childKey === '.created') return;
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
