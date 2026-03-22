import { settings } from '../settings/init';
import type { Head } from '../types/lsp_messages';
import type { Binding, BindingValue, BlankNodeValue, LiteralValue, URIValue } from '../types/rdf';
import { extractIriLabel, isImageUrl } from './utils';

export async function renderTableHeader(head: Head) {
  const resultTable = document.getElementById('resultsTable') as HTMLTableElement;
  resultTable.innerText = '';

  // NOTE: Use document fragment to batch DOM updates.
  const fragment = document.createDocumentFragment();

  // NOTE: Header row, containing the selected variables.
  const headerRow = document.createElement('tr');
  headerRow.classList = 'border-b-2 border-gray-300 dark:border-b-gray-600 text-green-600';

  const thIndex = document.createElement('th');
  thIndex.textContent = '#';
  thIndex.className = 'text-left p-2 w-10';
  headerRow.appendChild(thIndex);

  for (let selectedVar of head.vars) {
    const th = document.createElement('th');
    th.textContent = selectedVar;
    th.className = 'text-left p-2 truncate min-w-24';
    headerRow.appendChild(th);
  }

  fragment.appendChild(headerRow);
  resultTable.appendChild(fragment);
}

export function renderTableRows(head: Head, bindings: Binding[], offset: number = 0) {
  const resultTable = document.getElementById('resultsTable') as HTMLTableElement;
  const fragment = document.createDocumentFragment();
  let index = 1 + offset;
  for (const binding of bindings) {
    const tr = document.createElement('tr');
    tr.classList =
      'dark:even:bg-[#1F1F26] not-dark:odd:bg-neutral-50 border-b border-b-gray-300 dark:border-b-gray-600';
    const td = document.createElement('td');
    td.textContent = `${index}`;
    td.className = 'p-2 text-neutral-400';
    tr.appendChild(td);
    for (const variable of head.vars) {
      const element = renderValue(binding[variable]);
      tr.appendChild(element);
    }
    fragment.appendChild(tr);
    index++;
  }

  resultTable.appendChild(fragment);
}

function renderValue(value: BindingValue | undefined): HTMLTableCellElement {
  if (value != undefined) {
    switch (value.type) {
      case 'uri':
        return renderUri(value);
      case 'literal':
        return renderLiteral(value);
      case 'bnode':
        return renderBlankNode(value);
    }
  }
  return document.createElement('td');
}

function renderBlankNode(value: BlankNodeValue): HTMLTableCellElement {
  const td = document.createElement('td') as HTMLTableCellElement;
  td.classList.add('p-2', 'truncate');
  td.textContent = `_:${value.value}`;
  copyOnClick(td, value.value);
  return td;
}

function renderLiteral(value: LiteralValue): HTMLTableCellElement {
  const td = document.createElement('td') as HTMLTableCellElement;
  td.classList.add('p-2', 'truncate');
  copyOnClick(td, value.value);
  if (
    value.datatype === 'http://www.w3.org/2001/XMLSchema#decimal' &&
    isNumericString(value.value)
  ) {
    td.textContent = parseFloat(value.value).toLocaleString('en-US');
  } else {
    td.textContent = value.value.length > 200 ? value.value.substring(0, 200) + '...' : value.value;
  }
  td.title = td.textContent;

  if (value['xml:lang']) {
    const langSpan = document.createElement('span');
    langSpan.textContent = ` @${value['xml:lang']}`;
    langSpan.className = 'lang-tag text-gray-500 dark:text-gray-400 text-sm';
    if (!settings.results.langAnnotations) {
      langSpan.classList.add('hidden');
    }
    td.appendChild(langSpan);
  }
  if (value.datatype) {
    const datatypeSpan = document.createElement('span');
    datatypeSpan.textContent = ` (${getShortDatatype(value.datatype!)})`;
    datatypeSpan.className = 'type-tag text-gray-500 dark:text-gray-400 text-sm';
    if (!settings.results.typeAnnotations) {
      datatypeSpan.classList.add('hidden');
    }
    td.appendChild(datatypeSpan);
  }
  return td;
}

function renderUri(value: URIValue): HTMLTableCellElement {
  const td = document.createElement('td') as HTMLTableCellElement;
  td.classList.add('p-2', 'truncate');
  td.title = value.value;
  if (settings.results.loadImages && isImageUrl(value.value)) {
    const img = document.createElement('img');
    img.src = value.value;
    img.alt = value.value;
    img.className = 'w-20  object-cover bg-gray-100';
    td.appendChild(img);
  } else {
    const link = document.createElement('a');
    link.href = value.value;
    link.title = value.value;
    link.className = 'text-blue-600 dark:text-blue-400 hover:underline';
    link.target = '_blank';
    link.rel = 'noopener noreferrer';

    if (value.curie) {
      link.textContent = value.curie;
    } else {
      const shortLabel = extractIriLabel(value.value);
      const shortSpan = document.createElement('span');
      shortSpan.className = 'iri-short';
      shortSpan.textContent = shortLabel;
      if (!settings.results.shortenIris) {
        shortSpan.classList.add('hidden');
      }

      const fullSpan = document.createElement('span');
      fullSpan.className = 'iri-full';
      fullSpan.textContent = value.value;
      if (settings.results.shortenIris) {
        fullSpan.classList.add('hidden');
      }

      link.appendChild(shortSpan);
      link.appendChild(fullSpan);
    }
    td.appendChild(link);
  }
  return td;
}

function copyOnClick(td: HTMLTableCellElement, value: string) {
  td.classList.add('hover:text-blue-400', 'cursor-pointer');
  td.onclick = () => {
    navigator.clipboard.writeText(value);
    document.dispatchEvent(
      new CustomEvent('toast', {
        detail: { type: 'success', message: 'Copied to clipboard!', duration: 3000 },
      })
    );
  };
}

function getShortDatatype(datatype: string): string {
  const xsdPrefix = 'http://www.w3.org/2001/XMLSchema#';
  if (datatype.startsWith(xsdPrefix)) {
    return 'xsd:' + datatype.slice(xsdPrefix.length);
  }
  const match = datatype.match(/[#/]([^#/]+)$/);
  return match ? match[1] : datatype;
}

function isNumericString(str: string): boolean {
  return !isNaN(Number(str)) && !isNaN(parseFloat(str));
}
