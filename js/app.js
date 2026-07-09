// js/app.js

import { batchGetLocalData, generateUUID, appendLocalRecord, updateLocalRecord, deleteLocalRecord, clearItemsCache } from './data.js';
import {
    getSyncStatus,
    onSyncStatusChange,
    onRemoteDeleted,
    initSync,
    syncToRemote,
    fetchRemoteAndMerge,
    createRemoteTrip,
    joinRemoteTrip,
    getLastSyncText,
} from './sync.js';
import {
    initializeTrips,
    getActiveTrip,
    getActiveTripId,
    setActiveTrip,
    getAllTrips,
    addTrip,
    updateTrip,
    removeTrip,
    createLocalTrip,
    switchTrip,
    getTripItemsKey,
} from './trip-registry.js';

let allItems = [];
let currentDetailItemId = null;

window.app = window.app || {};

window.app.updateStatus = function(message) {
    const statusElement = document.getElementById('app-status');
    if (statusElement) {
        statusElement.textContent = message;
    } else {
        console.log('App Status:', message);
    }
};

async function fetchAndRenderData() {
    try {
        const response = await batchGetLocalData();
        allItems = response[0] || [];

        const trip = getActiveTrip();
        if (trip && trip.binId) {
            const updated = await fetchRemoteAndMerge();
            if (updated) {
                const refreshed = await batchGetLocalData();
                allItems = refreshed[0] || [];
            }
        }

        renderItems();
    } catch (error) {
        console.error('Error fetching data:', error);
        window.app.updateStatus(`Error loading data: ${error.message}`);
    }
}

function normalizeDate(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
}

function isSameDay(d1, d2) {
    return normalizeDate(d1).getTime() === normalizeDate(d2).getTime();
}

/**
 * Check if a date is today
 * @param {Date} date
 * @returns {boolean}
 */
function isToday(date) {
    return isSameDay(date, new Date());
}

function addDays(date, days) {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
}

function formatDateHeader(date) {
    return new Date(date).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
}

function getItemIcon(itemType) {
    switch (itemType) {
        case 'Travel':
            return '✈️';
        case 'Accommodation':
            return '🛏️';
        case 'Activity':
            return '🚶';
        case 'Other':
            return '📋';
        case 'Global':
            return '🌍';
        default:
            return '📋';
    }
}

function getTypePriority(type) {
    switch (type) {
        case 'Accommodation':
            return 0;
        case 'Travel':
            return 1;
        case 'Activity':
            return 2;
        case 'Other':
            return 3;
        default:
            return 4;
    }
}

function renderItems() {
    const allItemsContainer = document.getElementById('all-items');
    if (allItemsContainer) {
        allItemsContainer.innerHTML = '';

        let filteredItems = allItems.filter(item => {
            if (item.Type === 'Travel' && !filterState.showTravel) return false;
            if (item.Type === 'Accommodation' && !filterState.showAccommodation) return false;
            if (item.Type === 'Activity' && !filterState.showActivity) return false;
            if (item.Type === 'Other' && !filterState.showOther) return false;

            if (filterState.searchTerm) {
                const titleMatch = item.Title && item.Title.toLowerCase().includes(filterState.searchTerm);
                return titleMatch;
            }

            return true;
        });

        if (filteredItems.length === 0) {
            allItemsContainer.innerHTML = '<p class="text-center text-base-content">No items match your filters.</p>';
            return;
        }

        // Separate items with and without dates
        const itemsWithDates = filteredItems.filter(item => item.StartDateTime);
        const itemsWithoutDates = filteredItems.filter(item => !item.StartDateTime);

        // Render dated items in agenda view
        if (itemsWithDates.length > 0) {
            let minDate = new Date(8640000000000000);
            let maxDate = new Date(-8640000000000000);

            itemsWithDates.forEach(item => {
                const start = normalizeDate(item.StartDateTime);
                const end = normalizeDate(item.EndDateTime || item.StartDateTime);
                if (start < minDate) minDate = start;
                if (end > maxDate) maxDate = end;
            });

            let currentDate = normalizeDate(minDate);

            while (currentDate.getTime() <= maxDate.getTime()) {
                const itemsForThisDay = itemsWithDates.filter(item => {
                    const itemStart = normalizeDate(item.StartDateTime);
                    const itemEnd = normalizeDate(item.EndDateTime || item.StartDateTime);
                    return (itemStart.getTime() <= currentDate.getTime() && itemEnd.getTime() >= currentDate.getTime());
                }).sort((a, b) => {
                    const priorityDiff = getTypePriority(a.Type) - getTypePriority(b.Type);
                    if (priorityDiff !== 0) return priorityDiff;
                    return new Date(a.StartDateTime) - new Date(b.StartDateTime);
                });

                const dateRow = document.createElement('div');
                    dateRow.className = 'flex items-center justify-between sticky z-20 bg-base-100 py-1 mt-4';
                    dateRow.style.top = 'var(--sticky-header-offset, 0px)';

                    const dateHeader = document.createElement('h4');
                    dateHeader.className = 'text-xl font-bold text-primary';
                    dateHeader.dataset.date = currentDate.toISOString().slice(0, 10);
                    dateHeader.textContent = formatDateHeader(currentDate);

                    // Highlight today's date header more prominently
                    if (isToday(currentDate)) {
                        dateHeader.classList.remove('text-primary');
                        dateHeader.classList.add('text-primary-content');
                        dateRow.classList.add('bg-primary', 'rounded-lg', 'px-3', 'shadow-md');
                    }

                    // Format as local date (toISOString is UTC which shifts the day for
                    // non-zero timezones). datetime-local expects local time.
                    const dateIso = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;

                    // Floating popup that appears when the + button is clicked
                    const popup = document.createElement('div');
                    popup.className = 'date-add-popup hidden absolute right-0 top-full mt-1 z-50 bg-base-100 rounded-box w-44 shadow-lg border border-base-300 p-1';
                    const typeList = ['Travel', 'Accommodation', 'Activity', 'Other'];
                    typeList.forEach(t => {
                        const btn = document.createElement('button');
                        btn.className = 'btn btn-ghost btn-xs justify-start gap-2 w-full';
                        btn.innerHTML = `${getItemIcon(t)} ${t}`;
                        btn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            popup.classList.add('hidden');
                            const dateValue = `${dateIso}T12:00`;
                            currentItemType = t;
                            editingItemId = null;
                            cameFromDetailView = false;
                            itemForm.reset();
                            document.getElementById('item-start-datetime').value = dateValue;
                            extraFieldsContainer.classList.add('hidden');
                            toggleExtraFieldsBtn.textContent = '+ Add End Date/Time & To Location';
                            itemTypeSelect.value = t;
                            itemModalTitle.textContent = `Add New ${t} Item`;
                            itemModalIcon.textContent = getItemIcon(t);
                            saveItemButton.textContent = 'Save Item';
                            itemModal.showModal();
                        });
                        popup.appendChild(btn);
                    });

                    // + button with its own relative wrapper for the popup
                    const btnWrapper = document.createElement('div');
                    btnWrapper.className = 'relative flex-shrink-0 ml-2';
                    const addDateBtn = document.createElement('button');
                    addDateBtn.className = 'btn btn-ghost btn-xs btn-square opacity-70 hover:opacity-100 transition-opacity'
                        + (isToday(currentDate) ? ' text-primary-content' : '');
                    addDateBtn.title = 'Add item on this date';
                    addDateBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" /></svg>';
                    addDateBtn.addEventListener('click', (e) => {
                        e.stopPropagation();
                        const wasHidden = popup.classList.contains('hidden');
                        // Close all date-header popups first
                        document.querySelectorAll('.date-add-popup').forEach(p => p.classList.add('hidden'));
                        if (wasHidden) {
                            popup.classList.remove('hidden');
                        }
                    });
                    btnWrapper.appendChild(addDateBtn);
                    btnWrapper.appendChild(popup);

                    dateRow.appendChild(dateHeader);
                    dateRow.appendChild(btnWrapper);
                    allItemsContainer.appendChild(dateRow);

                    const dayItemList = document.createElement('div');
                    dayItemList.className = 'space-y-1 sm:space-y-1.5';
                    if (itemsForThisDay.length > 0) {
                        itemsForThisDay.forEach(item => {
                            const itemCard = createItemCard(item);
                            dayItemList.appendChild(itemCard);
                        });
                    } else {
                        const emptyHint = document.createElement('p');
                        emptyHint.className = 'text-xs text-base-content-secondary py-2 italic';
                        emptyHint.textContent = 'No items planned for this day. Click + to add one.';
                        dayItemList.appendChild(emptyHint);
                    }
                    allItemsContainer.appendChild(dayItemList);
                currentDate = addDays(currentDate, 1);
            }
        }

        // Render items without dates under "Other Items" section
        if (itemsWithoutDates.length > 0) {
            const otherHeader = document.createElement('h4');
            otherHeader.className = 'text-xl font-bold mt-6 mb-1 text-secondary sticky z-20 bg-base-100 py-1';
            otherHeader.style.top = 'var(--sticky-header-offset, 0px)';
            otherHeader.textContent = 'Other Items';
            allItemsContainer.appendChild(otherHeader);

            const otherItemList = document.createElement('div');
            otherItemList.className = 'space-y-2';

            itemsWithoutDates.forEach(item => {
                const itemCard = createItemCard(item);
                otherItemList.appendChild(itemCard);
            });
            allItemsContainer.appendChild(otherItemList);
        }

        document.querySelectorAll('[data-item-id]').forEach(card => {
            card.addEventListener('click', (e) => viewItemDetails(e.currentTarget.dataset.itemId));
        });

        // If today is one of the rendered dates, scroll to it.
        scrollToToday();
        // Update calendar strip whenever items are rendered.
        renderCalendar();
    }
}

/** Build the 7-column calendar strip showing the trip's date range. */
function renderCalendar() {
    const grid = document.getElementById('calendar-grid');
    if (!grid) return;

    const itemsWithDates = allItems.filter(item => {
        if (item.Type === 'Travel' && !filterState.showTravel) return false;
        if (item.Type === 'Accommodation' && !filterState.showAccommodation) return false;
        if (item.Type === 'Activity' && !filterState.showActivity) return false;
        if (item.Type === 'Other' && !filterState.showOther) return false;
        if (filterState.searchTerm) {
            const titleMatch = item.Title && item.Title.toLowerCase().includes(filterState.searchTerm);
            if (!titleMatch) return false;
        }
        return !!item.StartDateTime;
    });

    if (itemsWithDates.length === 0) {
        grid.innerHTML = '<p class="text-sm text-base-content-secondary w-full text-center py-2">No dated items to show</p>';
        return;
    }

    // Compute the full range (minDate → maxDate) from filtered items.
    // Start from a far-future sentinel so the first item always sets minDate.
    let minDate = new Date(8640000000000000);
    let maxDate = new Date(-8640000000000000);
    itemsWithDates.forEach(item => {
        const start = normalizeDate(item.StartDateTime);
        const end = normalizeDate(item.EndDateTime || item.StartDateTime);
        if (start < minDate) minDate = start;
        if (end > maxDate) maxDate = end;
    });

    // Build a map: date-iso → Set<type>
    const dateTypes = new Map();
    itemsWithDates.forEach(item => {
        const start = normalizeDate(item.StartDateTime);
        const end = normalizeDate(item.EndDateTime || item.StartDateTime);
        let cursor = new Date(start);
        while (cursor <= end) {
            const key = cursor.toISOString().slice(0, 10);
            if (!dateTypes.has(key)) dateTypes.set(key, new Set());
            dateTypes.get(key).add(item.Type);
            cursor = addDays(cursor, 1);
        }
    });

    const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const now = new Date();
    const todayKey = now.toISOString().slice(0, 10);

    grid.innerHTML = '';
    let cursor = new Date(minDate);
    while (cursor <= maxDate) {
        const key = cursor.toISOString().slice(0, 10);
        const types = dateTypes.get(key);
        const isToday = key === todayKey;
        const dow = cursor.getDay(); // 0=Sun, 6=Sat
        const isWeekend = dow === 0 || dow === 6;

        const cell = document.createElement('div');
        let cellClass = 'flex-shrink-0 flex flex-col items-center gap-0 px-2 py-1.5 rounded-lg cursor-pointer hover:bg-base-200 transition-colors'
            + (isToday ? ' bg-primary text-primary-content shadow-sm' : '')
            + (isWeekend && !isToday ? ' opacity-70' : '');
        cell.className = cellClass;

        // Day letter: Mo, Tu, We, Th, Fr, Sa, Su
        const dayLetter = document.createElement('span');
        dayLetter.className = 'text-[10px] leading-tight font-medium'
            + (isToday ? ' text-primary-content' : isWeekend ? ' text-base-content-secondary' : ' text-base-content-tertiary');
        dayLetter.textContent = DAY_NAMES[dow];
        cell.appendChild(dayLetter);

        // Date label: "d/m" e.g. "14/7"
        const label = document.createElement('span');
        label.className = 'text-xs font-semibold leading-tight' + (isToday ? '' : ' text-base-content');
        label.textContent = `${cursor.getDate()}/${cursor.getMonth() + 1}`;
        cell.appendChild(label);

        // Type icons row (max 4 icons to keep it compact)
        if (types && types.size > 0) {
            const iconsRow = document.createElement('div');
            iconsRow.className = 'flex gap-0.5 text-xs leading-none mt-0.5';
            const sorted = ['Travel', 'Accommodation', 'Activity', 'Other'];
            sorted.forEach(t => {
                if (types.has(t)) {
                    const iconSpan = document.createElement('span');
                    iconSpan.textContent = getItemIcon(t);
                    iconsRow.appendChild(iconSpan);
                }
            });
            cell.appendChild(iconsRow);
        } else {
            // Placeholder for consistent cell height
            const placeholder = document.createElement('div');
            placeholder.className = 'text-xs leading-none invisible mt-0.5';
            placeholder.textContent = '·';
            cell.appendChild(placeholder);
        }

        // Click scrolls the agenda to this date
        cell.dataset.date = key;
        cell.addEventListener('click', () => {
            // Close the calendar if it was opened on mobile
            scrollToDate(key);
        });

        grid.appendChild(cell);
        cursor = addDays(cursor, 1);
    }
}

/** Scroll the agenda to the date header matching the given ISO date. */
function scrollToDate(isoDate) {
    const target = document.querySelector(`[data-date="${isoDate}"]`);
    if (!target) return;
    const stickyOffset = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--sticky-header-offset')
    ) || 0;
    // The target (<h4>) is inside a sticky dateRow. We insert a plain marker
    // BEFORE the sticky container (as a sibling), so scrollIntoView isn't
    // affected by sticky positioning.
    const dateRow = target.parentNode;
    if (!dateRow || !dateRow.parentNode) return;
    const marker = document.createElement('div');
    marker.style.height = '1px';
    marker.style.scrollMarginTop = stickyOffset + 'px';
    dateRow.parentNode.insertBefore(marker, dateRow);
    marker.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setTimeout(() => marker.remove(), 800);
}

/** Measure the fixed header height and set a CSS variable so sticky date
 * headers sit just beneath the header when scrolling.
 */
function updateStickyHeaderOffset() {
    const header = document.querySelector('#app > div');
    if (header) {
        let offset = header.offsetHeight;
        // If the search bar is visible, account for its height too
        const searchBar = document.getElementById('search-filter-container');
        if (searchBar && !searchBar.classList.contains('hidden')) {
            offset += searchBar.offsetHeight;
        }
        document.documentElement.style.setProperty('--sticky-header-offset', `${offset}px`);
        // Search bar sits just below the header with a 4px gap
        document.documentElement.style.setProperty('--search-bar-offset', `${header.offsetHeight + 4}px`);
    }
}

/**
 * On initial open, scroll the agenda to today's date header (if present).
 * Only auto-scrolls once per app open, so user scrolling isn't overridden.
 */
let _hasScrolledToToday = false;
function scrollToToday() {
    if (_hasScrolledToToday) return;
    const todayIso = new Date().toISOString().slice(0, 10);
    const target = document.querySelector(`[data-date="${todayIso}"]`);
    if (target) {
        _hasScrolledToToday = true;
        const stickyOffset = parseFloat(
            getComputedStyle(document.documentElement).getPropertyValue('--sticky-header-offset')
        ) || 0;
        const dateRow = target.parentNode;
        if (!dateRow || !dateRow.parentNode) return;
        const marker = document.createElement('div');
        marker.style.height = '1px';
        marker.style.scrollMarginTop = stickyOffset + 'px';
        dateRow.parentNode.insertBefore(marker, dateRow);
        requestAnimationFrame(() => {
            marker.scrollIntoView({ behavior: 'auto', block: 'start' });
            setTimeout(() => marker.remove(), 100);
        });
    }
}

function createItemCard(item) {
    const itemCard = document.createElement('div');
    const id = item.ItemID || item.TaskID;
    itemCard.dataset.itemId = id;
    itemCard.className = `card card-compact rounded-box border-l-4 ${getItemColorClass(item.Type)} bg-base-100 shadow-md cursor-pointer`;

    const isAccommodation = item.Type === 'Accommodation';
    const isOther = item.Type === 'Other';
    const cardPadding = isAccommodation ? 'py-0.5 px-2' : 'p-2 sm:p-3';
    const titleSize = isAccommodation ? 'text-xs' : 'text-sm sm:text-base';
    const iconSize = isAccommodation ? 'text-base' : 'text-lg sm:text-xl';
    const iconMargin = isAccommodation ? 'mr-2' : 'mr-2 sm:mr-3';

    // Show time range for items with dates, except Accommodation
    let timeDisplay = '';
    if (!isAccommodation && item.StartDateTime) {
        timeDisplay = `<p class="text-xs text-base-content-secondary">${formatTimeRange(item.StartDateTime, item.EndDateTime || item.StartDateTime)}</p>`;
    }

    itemCard.innerHTML = `
        <div class="card-body ${cardPadding} flex flex-row items-center">
            <span class="${iconSize} ${iconMargin} flex-shrink-0">${getItemIcon(item.Type)}</span>
            <div class="flex flex-col flex-grow min-w-0">
                <h5 class="card-title ${titleSize} leading-none line-clamp-1 mb-0">${item.Title}</h5>
                ${timeDisplay}
            </div>
        </div>
    `;
    return itemCard;
}

function updateFilterButtonState(button, isActive) {
    if (isActive) {
        button.classList.remove('btn-ghost', 'opacity-50');
        button.classList.add('btn-primary');
    } else {
        button.classList.remove('btn-primary');
        button.classList.add('btn-ghost', 'opacity-50');
    }
}

function getItemColorClass(itemType) {
    switch (itemType) {
        case 'Travel':
            return 'border-blue-600';
        case 'Accommodation':
            return 'border-success';
        case 'Activity':
            return 'border-warning';
        case 'Other':
            return 'border-secondary';
        case 'Global':
            return 'border-info';
        default:
            return 'border-base-300';
    }
}

function formatDateTime(isoString) {
    if (!isoString) return '';
    const date = new Date(isoString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatTimeRange(startIso, endIso) {
    const startDate = new Date(startIso);
    const endDate = new Date(endIso);

    const startTime = startDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const endTime = endDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (isSameDay(startDate, endDate)) {
        return `${startTime} - ${endTime}`;
    } else {
        return `${formatDateTime(startIso)} - ${formatDateTime(endIso)}`;
    }
}

function formatDateTimeForDisplay(isoString) {
    if (!isoString) return '—';
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
        weekday: 'short',
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function generateMarkdownPreview(text) {
    if (!text) return '<em class="text-base-content-secondary">No notes</em>';
    let html = escapeHtml(text);

    const lines = html.split('\n');
    const result = [];
    let inList = null;

    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        const trimmed = line.trim();

        if (/^[-*]\s/.test(trimmed)) {
            if (inList !== 'ul') {
                if (inList) result.push(inList === 'ul' ? '</ul>' : '</ol>');
                result.push('<ul class="list-disc pl-5 my-2">');
                inList = 'ul';
            }
            const content = trimmed.replace(/^[-*]\s+/, '');
            result.push(`<li>${processInlineMarkdown(content)}</li>`);
            continue;
        }

        if (/^\d+\.\s/.test(trimmed)) {
            if (inList !== 'ol') {
                if (inList) result.push(inList === 'ul' ? '</ul>' : '</ol>');
                result.push('<ol class="list-decimal pl-5 my-2">');
                inList = 'ol';
            }
            const content = trimmed.replace(/^\d+\.\s+/, '');
            result.push(`<li>${processInlineMarkdown(content)}</li>`);
            continue;
        }

        if (inList) {
            result.push(inList === 'ul' ? '</ul>' : '</ol>');
            inList = null;
        }

        if (/^#{3}\s/.test(trimmed)) {
            result.push(`<h3 class="text-lg font-bold mt-4 mb-2">${trimmed.replace(/^#{3}\s+/, '')}</h3>`);
            continue;
        }
        if (/^#{2}\s/.test(trimmed)) {
            result.push(`<h2 class="text-xl font-bold mt-4 mb-2">${trimmed.replace(/^#{2}\s+/, '')}</h2>`);
            continue;
        }
        if (/^#{1}\s/.test(trimmed)) {
            result.push(`<h1 class="text-2xl font-bold mt-4 mb-2">${trimmed.replace(/^#{1}\s+/, '')}</h1>`);
            continue;
        }

        if (trimmed === '') {
            result.push('<br>');
            continue;
        }

        result.push(`<p>${processInlineMarkdown(line)}</p>`);
    }

    if (inList) {
        result.push(inList === 'ul' ? '</ul>' : '</ol>');
    }

    return result.join('');
}

function processInlineMarkdown(text) {
    const urlRegex = /(https?:\/\/[^\s<]+)/g;
    text = text.replace(urlRegex, (match) => {
        // If the URL looks like an image, embed it with overlay buttons
        if (/\.(jpe?g|png|gif|webp|svg|bmp|ico)(\?[^\s]*)?$/i.test(match)) {
            const encodedUrl = encodeURIComponent(match);
            return `<div class="relative inline-block max-w-full my-2 rounded-lg overflow-hidden group">
                <a href="${match}" target="_blank" rel="noopener" class="block">
                    <img src="${match}" alt="Image" loading="lazy" class="max-w-full h-auto rounded-lg block" />
                </a>
                <div class="absolute top-1 right-1 flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button data-img-url="${encodedUrl}" data-img-action="download" class="btn btn-xs btn-circle btn-ghost bg-base-100/80 backdrop-blur-sm shadow" title="Download image">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3" /></svg>
                    </button>
                </div>
            </div>`;
        }
        return `<a href="${match}" target="_blank" rel="noopener noreferrer" class="link link-primary">${match}</a>`;
    });
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    text = text.replace(/(?<!\*)\*(?!\*)(.*?)\*(?!\*)/g, '<em>$1</em>');
    text = text.replace(/`([^`]+)`/g, '<code class="bg-base-300 px-1 rounded">$1</code>');
    return text;
}

// In-memory store for fetched image blobs (avoids re-downloading during the session).
const _imageBlobs = new Map();

/** Download an image once, then open it from the cached blob on subsequent clicks. */
async function handleImageAction(encodedUrl) {
    const url = decodeURIComponent(encodedUrl);
    try {
        let blob = _imageBlobs.get(url);
        if (!blob) {
            const response = await fetch(url, { mode: 'cors', cache: 'force-cache' });
            if (!response.ok) throw new Error('Fetch failed');
            blob = await response.blob();
            _imageBlobs.set(url, blob);
        }
        const blobUrl = URL.createObjectURL(blob);
        window.open(blobUrl, '_blank');
        setTimeout(() => URL.revokeObjectURL(blobUrl), 120000);
    } catch (e) {
        window.open(url, '_blank', 'noopener');
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function updateMapsPreview(from, to) {
    const container = document.getElementById('maps-preview-container');
    const iframe = document.getElementById('maps-embed-iframe');
    const openLink = document.getElementById('maps-open-link');

    const hasFrom = from && from !== '' && from !== '—';
    const hasTo = to && to !== '' && to !== '—';

    if (!hasFrom && !hasTo) {
        container.classList.add('hidden');
        return;
    }

    container.classList.remove('hidden');

    let embedUrl;
    let openUrl;

    if (hasFrom && hasTo) {
        // Directions — use the "from X to Y" search format. Google Maps
        // auto-fits the viewport to show both locations (no zoom param
        // since a fixed zoom can't guarantee both are visible).
        const query = encodeURIComponent(`from ${from} to ${to}`);
        embedUrl = `https://maps.google.com/maps?q=${query}&output=embed`;
        openUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from)}&destination=${encodeURIComponent(to)}`;
    } else {
        // Single location
        const loc = hasFrom ? from : to;
        const encoded = encodeURIComponent(loc);
        embedUrl = `https://maps.google.com/maps?q=${encoded}&output=embed&z=12`;
        openUrl = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
    }

    iframe.src = embedUrl;
    openLink.href = openUrl;
}

// Trip UI elements
const tripSelectorBtn = document.getElementById('trip-selector-btn');
const currentTripName = document.getElementById('current-trip-name');
const tripListContainer = document.getElementById('trip-list-container');
const addTripBtn = document.getElementById('add-trip-btn');
const joinTripLink = document.getElementById('join-trip-link');
const addTripModal = document.getElementById('add_trip_modal');
const addTripForm = document.getElementById('add-trip-form');
const newTripNameInput = document.getElementById('new-trip-name');

// Sync UI elements
const syncStatusBtn = document.getElementById('sync-status-btn');
const syncIndicator = document.getElementById('sync-indicator');
const syncText = document.getElementById('sync-text');

// Install-app button (PWA install prompt)
const installAppBtn = document.getElementById('install-app-btn');
let deferredInstallPrompt = null;
const syncModal = document.getElementById('sync_modal');
const syncModalIndicator = document.getElementById('sync-modal-indicator');
const syncModalStatus = document.getElementById('sync-modal-status');
const syncModalLast = document.getElementById('sync-modal-last');
const syncTripInfo = document.getElementById('sync-trip-info');
const syncSetupActions = document.getElementById('sync-setup-actions');
const syncConnectedActions = document.getElementById('sync-connected-actions');
const syncTripName = document.getElementById('sync-trip-name');
const syncBinId = document.getElementById('sync-bin-id');

// Sync-to-JSONBin modal elements
const syncToJsonbinModal = document.getElementById('sync_to_jsonbin_modal');
const syncToJsonbinForm = document.getElementById('sync-to-jsonbin-form');
const syncToJsonbinName = document.getElementById('sync-to-jsonbin-name');
const syncToJsonbinMasterKey = document.getElementById('sync-to-jsonbin-master-key');
const openSyncToJsonbinBtn = document.getElementById('open-sync-to-jsonbin-btn');

// Join trip modal elements
const joinTripModal = document.getElementById('join_trip_modal');
const joinTripForm = document.getElementById('join-trip-form');
const joinTripNameInput = document.getElementById('join-trip-name-input');
const joinBinId = document.getElementById('join-bin-id');
const joinAccessKey = document.getElementById('join-access-key');

// Share trip modal elements
const shareTripModal = document.getElementById('share_trip_modal');
const shareTripUnavailable = document.getElementById('share-trip-unavailable');
const shareTripContent = document.getElementById('share-trip-content');
const shareBinId = document.getElementById('share-bin-id');
const shareAccessKey = document.getElementById('share-access-key');
const copyShareBinIdBtn = document.getElementById('copy-share-bin-id');
const toggleShareAccessKeyBtn = document.getElementById('toggle-share-access-key');
const copyShareAccessKeyBtn = document.getElementById('copy-share-access-key');
const copyShareAllBtn = document.getElementById('copy-share-all');

// Remote deleted modal elements
const remoteDeletedModal = document.getElementById('remote_deleted_modal');
const remoteDeletedResyncBtn = document.getElementById('remote-deleted-resync-btn');

// Rename trip modal elements
const renameTripModal = document.getElementById('rename_trip_modal');
const renameTripForm = document.getElementById('rename-trip-form');
const renameTripInput = document.getElementById('rename-trip-input');
let currentRenameTripId = null;

// Item modals
const addItemFab = document.getElementById('add-item-fab');
const itemModal = document.getElementById('item_modal');
const itemForm = document.getElementById('item-form');
const itemModalTitle = document.getElementById('item-modal-title');
const itemModalIcon = document.getElementById('item-modal-icon');
const saveItemButton = document.getElementById('save-item-button');
const itemTypeSelect = document.getElementById('item-type');
const itemNotesInput = document.getElementById('item-notes');
const itemNotesPreview = document.getElementById('item-notes-preview');
const extraFieldsContainer = document.getElementById('extra-fields-container');
const toggleExtraFieldsBtn = document.getElementById('toggle-extra-fields-btn');

const itemDetailModal = document.getElementById('item_detail_modal');
const detailItemTitle = document.getElementById('detail-item-title');
const detailItemIcon = document.getElementById('detail-item-icon');
const detailStartDatetime = document.getElementById('detail-start-datetime');
const detailEndDatetime = document.getElementById('detail-end-datetime');
const detailFromLocation = document.getElementById('detail-from-location');
const detailToLocation = document.getElementById('detail-to-location');
const detailItemNotes = document.getElementById('detail-item-notes');
const editFromDetailButton = document.getElementById('edit-from-detail-btn');
const deleteFromDetailButton = document.getElementById('delete-from-detail-btn');

// Search and Filter elements
const searchFab = document.getElementById('search-fab');
const searchFilterContainer = document.getElementById('search-filter-container');
const searchInput = document.getElementById('search-input');
const filterTravelBtn = document.getElementById('filter-travel');
const filterAccommodationBtn = document.getElementById('filter-accommodation');
const filterActivityBtn = document.getElementById('filter-activity');
const filterOtherBtn = document.getElementById('filter-other');

let editingItemId = null;
let currentItemType = 'Travel';
let cameFromDetailView = false;

let filterState = {
    searchTerm: '',
    showTravel: true,
    showAccommodation: true,
    showActivity: true,
    showOther: true
};

// Update trip dropdown display
function updateTripDropdown() {
    const trips = getAllTrips();
    const activeTrip = getActiveTrip();

    // Update header
    if (activeTrip) {
    currentTripName.textContent = activeTrip.name;
    } else {
        currentTripName.textContent = 'No Trip';
    }

    // Update dropdown list
    tripListContainer.innerHTML = '';
    trips.forEach(trip => {
        const isActive = trip.id === getActiveTripId();
        const li = document.createElement('li');

        // Create the main container for the trip row
        const div = document.createElement('div');
        div.className = 'flex items-center justify-between p-2 hover:bg-base-200 rounded-lg cursor-pointer group';

        // Left side: Tick (if active) and trip name
        const leftSide = document.createElement('div');
        leftSide.className = 'flex items-center gap-2 flex-grow min-w-0';

        // Tick icon (shown if active, invisible placeholder if not to maintain alignment)
        const tickIcon = document.createElement('span');
        tickIcon.className = 'w-5 h-5 flex items-center justify-center flex-shrink-0';
        if (isActive) {
            tickIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" /></svg>';
        }
        leftSide.appendChild(tickIcon);

        // Trip name
        const nameSpan = document.createElement('span');
        nameSpan.className = 'truncate font-medium' + (isActive ? ' text-primary' : '');
        nameSpan.textContent = trip.name;
        leftSide.appendChild(nameSpan);

        div.appendChild(leftSide);

        // Right side: Share icon + Delete icon
        const rightSide = document.createElement('div');
        rightSide.className = 'flex items-center gap-1 flex-shrink-0';

        // Share button (only shown for synced trips)
        if (trip.binId) {
            const shareBtn = document.createElement('button');
            shareBtn.className = 'btn btn-ghost btn-xs btn-square opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-info';
            shareBtn.title = 'Share trip';
            shareBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" /></svg>';
            shareBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openShareModal(trip.id);
            });
            rightSide.appendChild(shareBtn);
        }

        // Rename icon (pencil) - rename trip locally
        const renameBtn = document.createElement('button');
        renameBtn.className = 'btn btn-ghost btn-xs btn-square opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-warning';
        renameBtn.title = 'Rename trip';
        renameBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>';
        renameBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            openRenameModal(trip.id, trip.name);
        });
        rightSide.appendChild(renameBtn);

        // Delete icon (dustbin) - local only deletion
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'btn btn-ghost btn-xs btn-square opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity text-error';
        deleteBtn.title = 'Delete trip (local only)';
        deleteBtn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>';

        // Prevent the row click when clicking delete
        deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const remoteNote = trip.binId
                ? 'This only removes the trip from your device. The shared data on JSONBin will not be deleted — others can still access it. To delete the remote bin, do so from your JSONBin dashboard.'
                : 'This removes the trip and its local data from your device.';
            if (confirm(`Delete "${trip.name}"?\n\n${remoteNote}`)) {
                removeTrip(trip.id, false);
                updateTripDropdown();

                // If we deleted the active trip, switch to another
                if (isActive) {
                    const remainingTrips = getAllTrips();
                    if (remainingTrips.length > 0) {
                        clearItemsCache();
                        setActiveTrip(remainingTrips[0].id);
                        updateTripDropdown();
                        updateSyncDisplay();
                        fetchAndRenderData();
                    } else {
                        // No trips left - create a default one
                        const newTripId = createLocalTrip('My Trip');
                        setActiveTrip(newTripId);
                        clearItemsCache();
                        updateTripDropdown();
                        updateSyncDisplay();
                        fetchAndRenderData();
                    }
                }
            }
        });
        rightSide.appendChild(deleteBtn);

        div.appendChild(rightSide);

        // Click on row to switch trip
        div.addEventListener('click', () => {
            if (!isActive) {
                switchToTrip(trip.id);
            }
            // Close dropdown
            tripSelectorBtn.blur();
            document.activeElement?.blur();
        });

        li.appendChild(div);
        tripListContainer.appendChild(li);
    });
}

// Switch to a different trip
async function switchToTrip(tripId) {
    if (tripId === getActiveTripId()) return;

    clearItemsCache();
    switchTrip(tripId);
    updateTripDropdown();
    updateSyncDisplay();

    // Close dropdown
    tripSelectorBtn.blur();
    document.activeElement?.blur();

    await fetchAndRenderData();
    window.app.updateStatus('Switched trip');
}

// Open add trip modal
addTripBtn.addEventListener('click', () => {
    newTripNameInput.value = '';
    addTripModal.showModal();
    // Close the trip dropdown
    tripSelectorBtn.blur();
    document.activeElement?.blur();
});

// Add trip form submit
addTripForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = newTripNameInput.value.trim();
    if (name) {
        const tripId = createLocalTrip(name);
        clearItemsCache();
        setActiveTrip(tripId);
        updateTripDropdown();
        updateSyncDisplay();
        addTripModal.close();
        fetchAndRenderData();
        window.app.updateStatus('New trip created');
    }
});

// Open join trip modal from dropdown
joinTripLink.addEventListener('click', () => {
    // Close the trip dropdown
    tripSelectorBtn.blur();
    document.activeElement?.blur();

    joinTripForm.reset();
    joinTripModal.showModal();
});

// Sync status display
function updateSyncDisplay() {
    const trip = getActiveTrip();
    const status = getSyncStatus();

    const statusMap = {
        'unconfigured': { icon: '💾', text: 'Local only' },
        'synced': { icon: '🟢', text: 'Synced' },
        'pending': { icon: '🟡', text: 'Unsynced' },
        'offline': { icon: '🔴', text: 'Offline' },
        'error': { icon: '⚠️', text: 'Sync error' },
        'remote-deleted': { icon: '⚠️', text: 'Remote unavailable' },
    };

    const { icon, text } = statusMap[status] || statusMap['unconfigured'];
    syncIndicator.textContent = icon;
    syncText.textContent = text;

    // Update modal
    syncModalIndicator.textContent = icon;
    syncModalStatus.textContent = text;
    syncModalLast.textContent = `Last sync: ${getLastSyncText()}`;

    // Show/hide connected state
    if (trip && trip.binId) {
        syncTripInfo.classList.remove('hidden');
        syncSetupActions.classList.add('hidden');
        syncConnectedActions.classList.remove('hidden');
        syncTripName.value = trip.name || 'My Trip';
        syncBinId.value = trip.binId || '';
    } else {
        syncTripInfo.classList.add('hidden');
        syncSetupActions.classList.remove('hidden');
        syncConnectedActions.classList.add('hidden');
    }
}

// Open sync modal
syncStatusBtn.addEventListener('click', () => {
    updateSyncDisplay();
    syncModal.showModal();
});

// Open the "sync to JSONBin" modal from the sync settings modal
openSyncToJsonbinBtn.addEventListener('click', () => {
    const trip = getActiveTrip();
    syncToJsonbinName.value = trip ? trip.name : '';
    syncToJsonbinMasterKey.value = '';
    syncModal.close();
    syncToJsonbinModal.showModal();
});

// Sync-to-JSONBin form: create a new bin for the current local trip
syncToJsonbinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const tripName = syncToJsonbinName.value.trim();
    const masterKey = syncToJsonbinMasterKey.value.trim();

    const btn = syncToJsonbinForm.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Creating bin...';

    try {
        const items = await batchGetLocalData().then(r => r[0] || []);
        const { binId } = await createRemoteTrip(masterKey, tripName, items);

        // Update the current (active) trip with sync info — keep local name
        const activeTrip = getActiveTrip();
        if (activeTrip) {
            updateTrip(activeTrip.id, {
                binId,
                accessKey: masterKey,
                lastSync: new Date().toISOString(),
            });
        } else {
            addTrip({
                name: tripName,
                binId,
                accessKey: masterKey,
                lastSync: new Date().toISOString(),
            });
        }

        updateTripDropdown();
        updateSyncDisplay();
        window.app.updateStatus('Trip synced to JSONBin! Use Share to invite others.');
        syncToJsonbinForm.reset();
        syncToJsonbinModal.close();
    } catch (error) {
        alert('Failed to create bin: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
});

// Join trip form: connect to an existing shared bin
joinTripForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const localName = joinTripNameInput.value.trim() || 'Shared Trip';
    const binId = joinBinId.value.trim();
    const accessKey = joinAccessKey.value.trim();

    const btn = joinTripForm.querySelector('button[type="submit"]');
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Connecting...';

    try {
        const record = await joinRemoteTrip(binId, accessKey);

        // Use the local name the user entered (does NOT change the remote trip name)
        const tripId = addTrip({
            name: localName,
            binId,
            accessKey,
            lastSync: new Date().toISOString(),
        });

        // Write fetched items into this new trip's storage
        localStorage.setItem(getTripItemsKey(tripId), JSON.stringify(record.items || []));

        clearItemsCache();
        setActiveTrip(tripId);
        updateTripDropdown();
        updateSyncDisplay();
        await fetchAndRenderData();
        window.app.updateStatus('Joined shared trip!');
        joinTripForm.reset();
        joinTripModal.close();
    } catch (error) {
        alert('Failed to connect: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = originalText;
    }
});

// Sync now button
document.getElementById('sync-now-btn').addEventListener('click', async () => {
    const btn = document.getElementById('sync-now-btn');
    btn.disabled = true;
    btn.textContent = 'Syncing...';

    try {
        // syncToRemote reads remote, merges with local, writes both back up
        // and to localStorage, then invalidates the item cache.
        await syncToRemote();
        // Re-read the now-fresh local data and re-render.
        allItems = (await batchGetLocalData())[0] || [];
        renderItems();
        updateSyncDisplay();
        window.app.updateStatus('Synced!');
    } catch (error) {
        alert('Sync failed: ' + error.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Sync Now';
    }
});

// Disconnect button (removes cloud link, keeps local data)
document.getElementById('disconnect-btn').addEventListener('click', () => {
    if (confirm('Disconnect from cloud sync? Your local data will be kept. The shared bin on JSONBin is not deleted.')) {
        const trip = getActiveTrip();
        if (trip) {
            updateTrip(trip.id, {
                binId: null,
                accessKey: null,
                lastSync: null,
            });
            updateTripDropdown();
            updateSyncDisplay();
            window.app.updateStatus('Disconnected from cloud');
        }
    }
});

// Copy bin ID button (in sync modal)
document.getElementById('copy-bin-id').addEventListener('click', () => {
    const binId = syncBinId.value;
    navigator.clipboard.writeText(binId).then(() => {
        window.app.updateStatus('Bin ID copied!');
    });
});

// --- Share modal ---

// --- Rename modal ---

function openRenameModal(tripId, currentName) {
    currentRenameTripId = tripId;
    renameTripInput.value = currentName;

    // Close the trip dropdown
    tripSelectorBtn.blur();
    document.activeElement?.blur();

    renameTripModal.showModal();
    // Focus and select the name for easy replacement
    renameTripInput.focus();
    renameTripInput.select();
}

renameTripForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const newName = renameTripInput.value.trim();
    if (!newName || !currentRenameTripId) return;

    updateTrip(currentRenameTripId, { name: newName });
    updateTripDropdown();
    updateSyncDisplay();
    renameTripModal.close();
    window.app.updateStatus(`Trip renamed to "${newName}"`);
    currentRenameTripId = null;
});

// --- Share modal

function openShareModal(tripId) {
    const trip = getAllTrips().find(t => t.id === tripId);
    if (!trip) return;

    // Close the trip dropdown
    tripSelectorBtn.blur();
    document.activeElement?.blur();

    if (trip.binId) {
        shareTripUnavailable.classList.add('hidden');
        shareTripContent.classList.remove('hidden');
        shareBinId.value = trip.binId;
        shareAccessKey.value = trip.accessKey || '';
        shareAccessKey.type = 'password';
    } else {
        shareTripUnavailable.classList.remove('hidden');
        shareTripContent.classList.add('hidden');
    }

    shareTripModal.showModal();
}

copyShareBinIdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shareBinId.value).then(() => {
        window.app.updateStatus('Bin ID copied!');
    });
});

copyShareAccessKeyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shareAccessKey.value).then(() => {
        window.app.updateStatus('Access Key copied!');
    });
});

toggleShareAccessKeyBtn.addEventListener('click', () => {
    shareAccessKey.type = shareAccessKey.type === 'password' ? 'text' : 'password';
});

copyShareAllBtn.addEventListener('click', () => {
    const trip = getActiveTrip();
    const tripName = trip ? trip.name : 'Shared Trip';
    const binId = shareBinId.value;
    const accessKey = shareAccessKey.value;
    // Build a deep link URL — when opened, the app reads the query params
    // and pre-fills the Join Trip modal.
    const url = `${window.location.origin}${window.location.pathname}?joinName=${encodeURIComponent(tripName)}&joinBin=${encodeURIComponent(binId)}&joinKey=${encodeURIComponent(accessKey)}`;
    const text = `Join my trip "${tripName}" on Tripy!\n\n${url}`;
    navigator.clipboard.writeText(text).then(() => {
        window.app.updateStatus('Share link copied!');
    });
});

// --- Remote-deleted handling ---

let _remoteDeletedTripId = null;

function showRemoteDeletedModal(tripId) {
    _remoteDeletedTripId = tripId;
    remoteDeletedModal.showModal();
}

remoteDeletedResyncBtn.addEventListener('click', () => {
    remoteDeletedModal.close();
    // Open the sync-to-jsonbin modal to create a fresh bin
    syncToJsonbinName.value = '';
    syncToJsonbinMasterKey.value = '';
    syncToJsonbinModal.showModal();
});

document.addEventListener('DOMContentLoaded', () => {
    console.log('App.js loaded.');

    // Measure sticky header offset now and on resize
    updateStickyHeaderOffset();

    // Close any open date-header popup when clicking outside
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.date-add-popup:not(.hidden)').forEach(p => p.classList.add('hidden'));
        // Handle image download/open buttons
        const btn = e.target.closest('[data-img-action]');
        if (btn) {
            e.preventDefault();
            handleImageAction(btn.dataset.imgUrl, btn.dataset.imgAction);
        }
    });
    window.addEventListener('resize', updateStickyHeaderOffset);

    // Initialize trips
    initializeTrips();
    updateTripDropdown();

    // Initialize sync
    initSync().then(() => {
        updateSyncDisplay();
    });

    // Listen for sync status changes
    onSyncStatusChange(updateSyncDisplay);

    // Listen for remote-deleted events (bin no longer available on JSONBin)
    onRemoteDeleted((tripId) => {
        updateSyncDisplay();
        showRemoteDeletedModal(tripId);
    });

    fetchAndRenderData();

    // --- Deep-link join: check for ?joinBin=...&joinKey=... in the URL ---
    (function checkJoinParams() {
        const params = new URLSearchParams(window.location.search);
        const joinBin = params.get('joinBin');
        const joinKey = params.get('joinKey');
        const joinName = params.get('joinName');
        if (joinBin && joinKey) {
            joinBinId.value = joinBin;
            joinAccessKey.value = joinKey;
            if (joinName) joinTripNameInput.value = joinName;
            // Open join modal pre-filled. The user just hits Connect.
            joinTripModal.showModal();
        }
    })();

    // --- PWA install prompt ---
    // Capture the browser's install prompt and surface an Install button.
    // (Chrome/Edge/Android fire beforeinstallprompt; iOS Safari uses the
    // Share → Add to Home Screen flow and won't fire this, but the manifest
    // + apple-touch-icon above still make it installable there.)
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent the default mini-infobar so we can show our own button.
        e.preventDefault();
        deferredInstallPrompt = e;
        installAppBtn.classList.remove('hidden');
    });

    installAppBtn.addEventListener('click', async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        const { outcome } = await deferredInstallPrompt.userChoice;
        if (outcome === 'accepted') {
            window.app.updateStatus('Tripy installed!');
        }
        deferredInstallPrompt = null;
        installAppBtn.classList.add('hidden');
    });

    // If the app is already installed (running standalone), hide the button.
    window.addEventListener('appinstalled', () => {
        deferredInstallPrompt = null;
        installAppBtn.classList.add('hidden');
    });

    if (window.matchMedia('(display-mode: standalone)').matches) {
        installAppBtn.classList.add('hidden');
    }

    // --- Auto-sync: pull collaborators' changes in the background ---
    // A manual sync reads remote + merges + writes back, but only a reload
    // used to show others' edits because the in-memory item cache went stale.
    // The cache is now invalidated on remote writes (see sync.js), so polling
    // fetchRemoteAndMerge + re-rendering surfaces new data live.

    let _autoSyncTimer = null;

    async function autoSyncPull() {
        const trip = getActiveTrip();
        if (!trip || !trip.binId) return;

        // Don't poll if we're offline or the bin is known-unavailable
        const status = getSyncStatus();
        if (status === 'offline' || status === 'remote-deleted' || status === 'unconfigured') {
            return;
        }

        try {
            const changed = await fetchRemoteAndMerge();
            if (changed) {
                // Cache was invalidated inside fetchRemoteAndMerge; re-read + render
                allItems = (await batchGetLocalData())[0] || [];
                renderItems();
                updateSyncDisplay();
            }
        } catch (e) {
            console.error('Auto-sync pull failed:', e);
        }
    }

    // Pull on a 30s interval while the tab is active
    _autoSyncTimer = setInterval(autoSyncPull, 30000);

    // Pull immediately when the user returns to the tab (catches changes made
    // while the app was backgrounded, without spamming the rate-limited API)
    window.addEventListener('focus', autoSyncPull);

    // Clear the timer if the page is hidden to respect the rate limit
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && _autoSyncTimer) {
            clearInterval(_autoSyncTimer);
            _autoSyncTimer = null;
        } else if (!document.hidden && !_autoSyncTimer) {
            autoSyncPull();
            _autoSyncTimer = setInterval(autoSyncPull, 30000);
        }
    });

    itemNotesInput.addEventListener('input', () => {
        itemNotesPreview.innerHTML = generateMarkdownPreview(itemNotesInput.value);
    });

    // Only target buttons in the FAB dropdown (buttons with data-task-type)
    // Toggle extra fields (End Date/Time, To Location)
    toggleExtraFieldsBtn.addEventListener('click', () => {
        const wasHidden = extraFieldsContainer.classList.contains('hidden');
        extraFieldsContainer.classList.toggle('hidden');
        toggleExtraFieldsBtn.textContent = extraFieldsContainer.classList.contains('hidden')
            ? '+ Add End Date/Time & To Location'
            : '− Hide extra fields';

        // If expanding and a start datetime is set but end is empty, copy start to end
        if (wasHidden) {
            const startInput = document.getElementById('item-start-datetime');
            const endInput = document.getElementById('item-end-datetime');
            if (startInput.value && !endInput.value) {
                endInput.value = startInput.value;
            }
        }
    });

    // Snap any datetime-local value to the nearest 5-minute mark when the user
    // finishes picking or blurs the field (some browsers ignore step="300" and
    // let users pick any minute).
    function snapToFiveMinutes(input) {
        input.addEventListener('blur', () => {
            if (!input.value) return;
            const d = new Date(input.value);
            if (isNaN(d.getTime())) return;
            d.setMinutes(Math.round(d.getMinutes() / 5) * 5, 0, 0);
            // Use local time methods — toISOString() returns UTC which would
            // shift the hour/day for non-UTC timezones. datetime-local expects
            // local time values.
            const y = d.getFullYear();
            const m = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            const h = String(d.getHours()).padStart(2, '0');
            const min = String(d.getMinutes()).padStart(2, '0');
            input.value = `${y}-${m}-${day}T${h}:${min}`;
        });
    }
    snapToFiveMinutes(document.getElementById('item-start-datetime'));
    snapToFiveMinutes(document.getElementById('item-end-datetime'));

    document.querySelectorAll('.dropdown-content button[data-task-type]').forEach(button => {
        button.addEventListener('click', (e) => {
            const itemType = e.target.dataset.taskType;
            currentItemType = itemType;
            editingItemId = null;
            cameFromDetailView = false;
            itemModalTitle.textContent = `Add New ${itemType} Item`;
            itemModalIcon.textContent = getItemIcon(itemType);
            itemForm.reset();
            itemNotesPreview.innerHTML = '<em class="text-base-content-secondary">No notes</em>';

            // Hide extra fields for a fresh add
            extraFieldsContainer.classList.add('hidden');
            toggleExtraFieldsBtn.textContent = '+ Add End Date/Time & To Location';

            // No default date is set — all item types can be created without
            // a date. The user fills in the date only if they know it.
            itemTypeSelect.value = itemType;

            saveItemButton.textContent = 'Save Item';
            itemModal.showModal();
        });
    });

    itemForm.addEventListener('submit', async (event) => {
        event.preventDefault();

        const newItemData = {
            ItemID: editingItemId || generateUUID(),
            Type: document.getElementById('item-type').value,
            Title: document.getElementById('item-title').value,
            StartDateTime: document.getElementById('item-start-datetime').value,
            EndDateTime: document.getElementById('item-end-datetime').value,
            FromLocation: document.getElementById('item-from-location').value,
            ToLocation: document.getElementById('item-to-location').value,
            Notes: document.getElementById('item-notes').value,
        };

        if (editingItemId) {
            await updateLocalRecord(editingItemId, newItemData);
            window.app.updateStatus('Item updated successfully!');
        } else {
            await appendLocalRecord(newItemData);
            window.app.updateStatus('Item added successfully!');
        }

        itemModal.close();
        await fetchAndRenderData();

        // If we came from the detail view, reopen it to show the updated item
        if (cameFromDetailView && editingItemId) {
            cameFromDetailView = false;
            viewItemDetails(editingItemId);
        }

        editingItemId = null;
    });

    editFromDetailButton.addEventListener('click', () => {
        if (currentDetailItemId) {
            cameFromDetailView = true;
            itemDetailModal.close();
            openItemModalForEdit(currentDetailItemId);
        }
    });

    // Clear the maps iframe when the detail modal closes so stale views
    // don't flash before the next item's map loads.
    itemDetailModal.addEventListener('close', () => {
        document.getElementById('maps-embed-iframe').src = '';
    });

    // Clicking outside the modal-box (on the backdrop) closes the detail modal
    itemDetailModal.addEventListener('click', (e) => {
        if (e.target === itemDetailModal) {
            itemDetailModal.close();
        }
    });

    deleteFromDetailButton.addEventListener('click', async () => {
        if (currentDetailItemId) {
            const confirmed = confirm('Are you sure you want to delete this item? This action cannot be undone.');
            if (confirmed) {
                const result = await deleteLocalRecord(currentDetailItemId);
                if (result) {
                    itemDetailModal.close();
                    fetchAndRenderData();
                    window.app.updateStatus('Item deleted successfully!');
                } else {
                    alert('Failed to delete item. It may have already been removed.');
                }
            }
        }
    });

    searchInput.addEventListener('input', (e) => {
        filterState.searchTerm = e.target.value.toLowerCase();
        renderItems();
    });

    filterTravelBtn.addEventListener('click', () => {
        filterState.showTravel = !filterState.showTravel;
        updateFilterButtonState(filterTravelBtn, filterState.showTravel);
        renderItems();
    });

    filterAccommodationBtn.addEventListener('click', () => {
        filterState.showAccommodation = !filterState.showAccommodation;
        updateFilterButtonState(filterAccommodationBtn, filterState.showAccommodation);
        renderItems();
    });

    filterActivityBtn.addEventListener('click', () => {
        filterState.showActivity = !filterState.showActivity;
        updateFilterButtonState(filterActivityBtn, filterState.showActivity);
        renderItems();
    });

    filterOtherBtn.addEventListener('click', () => {
        filterState.showOther = !filterState.showOther;
        updateFilterButtonState(filterOtherBtn, filterState.showOther);
        renderItems();
    });

    updateFilterButtonState(filterTravelBtn, filterState.showTravel);
    updateFilterButtonState(filterAccommodationBtn, filterState.showAccommodation);
    updateFilterButtonState(filterActivityBtn, filterState.showActivity);
    updateFilterButtonState(filterOtherBtn, filterState.showOther);
    updateFilterButtonState(filterActivityBtn, filterState.showActivity);

    searchFab.addEventListener('click', () => {
        searchFilterContainer.classList.toggle('hidden');
        if (!searchFilterContainer.classList.contains('hidden')) {
            searchInput.focus();
        }
        // Recalculate sticky offsets now that search bar visibility changed
        updateStickyHeaderOffset();
    });

    });

function viewItemDetails(itemId) {
    currentDetailItemId = itemId;
    const item = allItems.find(t => (t.ItemID || t.TaskID) === itemId);
    if (item) {
        const whenSection = document.getElementById('detail-when-section');
        const routeSection = document.getElementById('detail-route-section');

        detailItemTitle.textContent = item.Title;
        detailItemIcon.textContent = getItemIcon(item.Type);

        // Show/hide the "When" section based on whether the item has dates
        const hasDates = !!item.StartDateTime || !!item.EndDateTime;
        if (hasDates) {
            whenSection.classList.remove('hidden');
            detailStartDatetime.textContent = formatDateTimeForDisplay(item.StartDateTime);
            detailEndDatetime.textContent = formatDateTimeForDisplay(item.EndDateTime);
        } else {
            whenSection.classList.add('hidden');
        }

        // Show/hide the "Route" section based on whether either location is set
        const hasFrom = !!item.FromLocation;
        const hasTo = !!item.ToLocation;
        if (hasFrom || hasTo) {
            routeSection.classList.remove('hidden');
            detailFromLocation.textContent = item.FromLocation || '—';
            detailToLocation.textContent = item.ToLocation || '—';
            updateMapsPreview(item.FromLocation, item.ToLocation);
        } else {
            routeSection.classList.add('hidden');
            document.getElementById('maps-preview-container').classList.add('hidden');
        }

        detailItemNotes.innerHTML = generateMarkdownPreview(item.Notes);

        // Scroll the modal content to the top each time it opens
        itemDetailModal.scrollTop = 0;

        itemDetailModal.showModal();
    }
}

function openItemModalForEdit(itemId) {
    const item = allItems.find(t => (t.ItemID || t.TaskID) === itemId);
    if (item) {
        editingItemId = itemId;
        currentItemType = item.Type;
        itemModalTitle.textContent = 'Edit Item';
        itemModalIcon.textContent = getItemIcon(item.Type);
        saveItemButton.textContent = 'Update Item';

        document.getElementById('item-title').value = item.Title;
        document.getElementById('item-type').value = item.Type;
        document.getElementById('item-start-datetime').value = item.StartDateTime ? item.StartDateTime.substring(0, 16) : '';
        document.getElementById('item-end-datetime').value = item.EndDateTime ? item.EndDateTime.substring(0, 16) : '';
        document.getElementById('item-from-location').value = item.FromLocation;
        document.getElementById('item-to-location').value = item.ToLocation;
        document.getElementById('item-notes').value = item.Notes;

        // Show extra fields if the item has end datetime or to location filled
        const hasEndDate = !!item.EndDateTime;
        const hasToLocation = !!item.ToLocation;
        if (hasEndDate || hasToLocation) {
            extraFieldsContainer.classList.remove('hidden');
            toggleExtraFieldsBtn.textContent = '− Hide extra fields';
        } else {
            extraFieldsContainer.classList.add('hidden');
            toggleExtraFieldsBtn.textContent = '+ Add End Date/Time & To Location';
        }

        itemNotesPreview.innerHTML = generateMarkdownPreview(item.Notes);

        itemModal.showModal();
    }
}
