import { parseKeywords, matchesAllKeywords, highlightMatches } from '../utils/fuzzy_filter';
import type { Command } from './init';

const hoverClasses = ['bg-neutral-300', 'dark:bg-neutral-700'];
const highlightClasses = ['text-green-600', 'dark:text-green-500', 'underline'];

interface Item {
  li: HTMLLIElement;
  nameSpan: HTMLSpanElement;
  name: string;
  description: string;
}

let list: HTMLUListElement;
let items: Item[] = [];
let filtered: Item[] = [];
let selectedIndex = -1;
let onExecute: ((name: string) => void) | null = null;
let promptInput: HTMLInputElement;

export function setupCommandCompletions(
  commandPrompt: HTMLInputElement,
  commands: Record<string, Command>,
  execute: (name: string) => void
) {
  onExecute = execute;
  promptInput = commandPrompt;

  // Create the completion list element
  list = document.createElement('ul');
  list.id = 'commandCompletionList';
  list.className = 'max-h-60 overflow-y-auto list-none m-0 p-0 hidden border-t border-neutral-400 dark:border-white';
  // Append to the outer rounded container, not the input's immediate relative wrapper
  commandPrompt.closest('.flex.flex-col.overflow-hidden')!.appendChild(list);

  // Build items from registered commands
  const commandNames = Object.keys(commands);
  for (const name of commandNames) {
    const { description } = commands[name];
    const li = document.createElement('li');
    li.className = 'px-4 h-10 cursor-pointer text-sm text-neutral-700 dark:text-neutral-200 hover:bg-neutral-300 dark:hover:bg-neutral-600 flex items-center justify-between gap-3';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'font-mono';
    nameSpan.textContent = name;

    const descSpan = document.createElement('span');
    descSpan.className = 'font-mono text-xs text-neutral-500 dark:text-neutral-400 truncate';
    descSpan.textContent = description;

    li.appendChild(nameSpan);
    li.appendChild(descSpan);
    li.addEventListener('click', () => {
      onExecute?.(name);
    });
    list.appendChild(li);
    items.push({ li, nameSpan, name, description });
  }

  filtered = [...items];

  // Filter on input
  commandPrompt.addEventListener('input', () => {
    update(commandPrompt.value);
  });
}

function resetItem(item: Item) {
  item.li.classList.remove('hidden', ...hoverClasses);
  item.nameSpan.textContent = item.name;
}

function update(query: string) {
  const trimmed = query.trim();
  selectedIndex = -1;

  if (trimmed === '') {
    for (const item of items) {
      resetItem(item);
    }
    filtered = [...items];
    list.classList.remove('hidden');
    return;
  }

  const keywords = parseKeywords(trimmed);
  if (keywords.length === 0) {
    list.classList.add('hidden');
    return;
  }

  filtered = [];
  for (const item of items) {
    item.li.classList.remove(...hoverClasses);
    if (matchesAllKeywords(item.name, keywords)) {
      item.li.classList.remove('hidden');
      item.nameSpan.innerHTML = highlightMatches(item.name, keywords, highlightClasses);
      filtered.push(item);
    } else {
      item.li.classList.add('hidden');
    }
  }

  if (filtered.length > 0) {
    list.classList.remove('hidden');
  } else {
    list.classList.add('hidden');
  }
}

/** Handle keyboard events. Returns true if the event was consumed. */
export function handleKey(event: KeyboardEvent): boolean {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    if (filtered.length === 0) return true;
    if (selectedIndex >= 0) {
      filtered[selectedIndex].li.classList.remove(...hoverClasses);
    }
    selectedIndex = (selectedIndex + 1) % filtered.length;
    filtered[selectedIndex].li.classList.add(...hoverClasses);
    filtered[selectedIndex].li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    promptInput.value = filtered[selectedIndex].name;
    return true;
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault();
    if (filtered.length === 0) return true;
    if (selectedIndex >= 0) {
      filtered[selectedIndex].li.classList.remove(...hoverClasses);
    }
    selectedIndex = selectedIndex <= 0 ? filtered.length - 1 : selectedIndex - 1;
    filtered[selectedIndex].li.classList.add(...hoverClasses);
    filtered[selectedIndex].li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    promptInput.value = filtered[selectedIndex].name;
    return true;
  }

  if (event.key === 'Enter' && selectedIndex >= 0) {
    event.preventDefault();
    onExecute?.(filtered[selectedIndex].name);
    return true;
  }

  return false;
}

export function hide() {
  if (!list) return;
  list.classList.add('hidden');
  selectedIndex = -1;
  for (const item of items) {
    item.li.classList.remove(...hoverClasses);
  }
}

export function show() {
  if (!list) return;
  for (const item of items) {
    resetItem(item);
  }
  filtered = [...items];
  selectedIndex = -1;
  list.classList.remove('hidden');
}

