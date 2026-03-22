// ┌──────────────────────────────────────┐ \\
// │ Copyright © 2024-2025 Ioannis Nezis  │ \\
// ├──────────────────────────────────────┤ \\
// │ Licensed under the MIT license.      │ \\
// └──────────────────────────────────────┘ \\

import { debounce } from '../utils';
import { parseKeywords, matchesAllKeywords, highlightMatches } from '../utils/fuzzy_filter';

export function setupKeywordSearch() {
  const examplesModal = document.getElementById('examplesModal')!;
  const examplesList = document.getElementById('examplesList')! as HTMLUListElement;
  const keywordSearchInput = document.getElementById(
    'examplesKeywordSearchInput'
  )! as HTMLInputElement;

  const hoverClasses: string[] = ['bg-neutral-500', 'dark:bg-neutral-700', 'text-white'];
  const highlightClasses: string[] = ['text-green-600', 'dark:text-green-500', 'underline'];

  // This variable contains the actual example spans that match the query.
  let examples: HTMLLIElement[] = [];
  let examplesFiltered: HTMLLIElement[] = [];
  // This variable keeps track of the selected example.
  let selectedExample = -1;

  // NOTE: Keyboard navigation:
  keywordSearchInput.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      examplesModal.classList.add('hidden');
      cleanup();
    }
    if (examplesFiltered.length > 0) {
      if (event.key === 'ArrowDown') {
        if (selectedExample >= 0) {
          examplesFiltered[selectedExample].classList.remove(...hoverClasses);
        }
        selectedExample = (selectedExample + 1) % examplesFiltered.length;
        examplesFiltered[selectedExample].classList.add(...hoverClasses);
        examplesFiltered[selectedExample].scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        });
      } else if (event.key === 'ArrowUp') {
        examplesFiltered[selectedExample].classList.remove(...hoverClasses);
        selectedExample = selectedExample - 1;
        if (selectedExample == -1) {
          selectedExample = examplesFiltered.length - 1;
        }
        examplesFiltered[selectedExample].classList.add(...hoverClasses);
        examplesFiltered[selectedExample].scrollIntoView({
          block: 'nearest',
          behavior: 'smooth',
        });
      } else if (event.key === 'Enter' && selectedExample >= 0) {
        examplesFiltered[selectedExample].click();
        event.stopPropagation();
      }
    }
  });

  document.addEventListener('examples-loaded', () => {
    examples = Array.from(examplesList.children) as HTMLLIElement[];
    examplesFiltered = [...examples];
  });

  function filterExamples(query: string) {
    cleanup();
    const keywords = parseKeywords(query);

    let hits = 0;
    examplesFiltered = examples.filter((example) => {
      const exampleName = example.innerText.trim();
      if (matchesAllKeywords(exampleName, keywords)) {
        example.classList.add('keyword-search-match');
        example.innerHTML = highlightMatches(exampleName, keywords, highlightClasses);
        hits++;
        return true;
      } else {
        example.classList.add('hidden');
        return false;
      }
    });
    if (hits === 0) {
      console.log('no matches :(');
      document.getElementById('noExampleMatchWarning')!.classList.remove('hidden');
      document.getElementById('noExampleMatchWarning')!.classList.add('inline-flex');
    } else {
      document.getElementById('noExampleMatchWarning')!.classList.remove('inline-flex');
      document.getElementById('noExampleMatchWarning')!.classList.add('hidden');
    }
  }

  const filterExamplesDebounced = debounce(filterExamples, 200);
  function cleanup() {
    examplesFiltered = [...examples];
    // Reset the selected example to nothing.
    selectedExample = -1;
    // Remove artifacts from previous usage.
    examplesFiltered.forEach((element) => {
      element.classList.remove('keyword-search-match');
      element.classList.remove('hidden');
      element.classList.remove(...hoverClasses);
      // NOTE: This removes inner styling.
      element.innerText = element.innerText;
    });
  }

  keywordSearchInput.addEventListener('input', () => {
    filterExamplesDebounced(keywordSearchInput.value);
  });

  document.addEventListener('example-selected', cleanup);

  document.addEventListener('examples-closed', cleanup);
}
