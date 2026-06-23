// js/data.js - Local-first storage with per-trip support

import { triggerSync } from './sync.js';
import { getActiveTripId, getTripItemsKey } from './trip-registry.js';

// Initial dummy data for new trips
const INITIAL_ITEMS = [
    {
        ItemID: crypto.randomUUID(),
        Type: 'Travel',
        Title: 'Flight to Paris',
        StartDateTime: new Date(new Date().setDate(new Date().getDate() + 1)).toISOString(),
        EndDateTime: new Date(new Date().setDate(new Date().getDate() + 1)).toISOString(),
        FromLocation: 'London',
        ToLocation: 'Paris',
        Notes: 'Flight BA200, Terminal 5',
        updatedAt: new Date().toISOString(),
    },
    {
        ItemID: crypto.randomUUID(),
        Type: 'Accommodation',
        Title: 'Hotel Check-in',
        StartDateTime: new Date(new Date().setDate(new Date().getDate() + 2)).toISOString(),
        EndDateTime: new Date(new Date().setDate(new Date().getDate() + 4)).toISOString(),
        FromLocation: '',
        ToLocation: 'Paris',
        Notes: 'Hotel du Louvre',
        updatedAt: new Date().toISOString(),
    },
    {
        ItemID: crypto.randomUUID(),
        Type: 'Activity',
        Title: 'Eiffel Tower Visit',
        StartDateTime: new Date(new Date().setDate(new Date().getDate() + 3)).toISOString(),
        EndDateTime: new Date(new Date().setDate(new Date().getDate() + 3)).toISOString(),
        FromLocation: '',
        ToLocation: 'Paris',
        Notes: 'Booked tickets online',
        updatedAt: new Date().toISOString(),
    },
    {
        ItemID: crypto.randomUUID(),
        Type: 'Other',
        Title: 'Travel Insurance',
        StartDateTime: '',
        EndDateTime: '',
        FromLocation: '',
        ToLocation: '',
        Notes: 'Need to buy travel insurance before departure',
        updatedAt: new Date().toISOString(),
    },
];

// In-memory cache for current trip's items
let cachedItems = null;
let cachedTripId = null;

/**
 * Get the storage key for the current active trip
 * @returns {string|null}
 */
function getCurrentStorageKey() {
    const tripId = getActiveTripId();
    return tripId ? getTripItemsKey(tripId) : null;
}

/**
 * Load items for the current trip from local storage
 * @returns {Array}
 */
export function loadItemsFromLocalStorage() {
    const tripId = getActiveTripId();
    const storageKey = getCurrentStorageKey();

    if (!storageKey) {
        return [];
    }

    // Return cached if same trip
    if (cachedTripId === tripId && cachedItems !== null) {
        return cachedItems;
    }

    const stored = localStorage.getItem(storageKey);

    if (stored) {
        cachedItems = JSON.parse(stored);
    } else {
        // Initialize with default data for new trips
        cachedItems = JSON.parse(JSON.stringify(INITIAL_ITEMS));
        saveItemsToLocalStorage(cachedItems);
    }

    cachedTripId = tripId;
    return cachedItems;
}

/**
 * Save items to local storage for current trip
 * @param {Array} items
 */
function saveItemsToLocalStorage(items) {
    const storageKey = getCurrentStorageKey();
    if (!storageKey) {
        console.error('No active trip to save to');
        return;
    }

    try {
        localStorage.setItem(storageKey, JSON.stringify(items));
        cachedItems = items;
        cachedTripId = getActiveTripId();
    } catch (e) {
        console.error('Error saving items to local storage:', e);
    }
}

/**
 * Clear the cache (call when switching trips)
 */
export function clearItemsCache() {
    cachedItems = null;
    cachedTripId = null;
}

/**
 * Get all items for current trip
 * @returns {Promise<Array>}
 */
export async function batchGetLocalData() {
    return new Promise(resolve => {
        const items = loadItemsFromLocalStorage();
        resolve([items]);
    });
}

/**
 * Append a new item to current trip
 * @param {Object} item
 * @returns {Promise<Object>}
 */
export async function appendLocalRecord(item) {
    return new Promise(resolve => {
        // Ensure item has required fields
        const newItem = {
            ...item,
            ItemID: item.ItemID || item.TaskID || generateUUID(),
            updatedAt: new Date().toISOString(),
        };

        const items = loadItemsFromLocalStorage();
        items.push(newItem);
        saveItemsToLocalStorage(items);

        // Trigger sync in background (non-blocking)
        triggerSync('create', newItem).catch(console.error);

        resolve(newItem);
    });
}

/**
 * Update an existing item in current trip
 * @param {string} idValue - The ItemID/TaskID
 * @param {Object} updatedFields
 * @returns {Promise<Object|null>}
 */
export async function updateLocalRecord(idValue, updatedFields) {
    return new Promise(resolve => {
        const items = loadItemsFromLocalStorage();
        const index = items.findIndex(item =>
            item.ItemID === idValue || item.TaskID === idValue
        );

        if (index !== -1) {
            items[index] = {
                ...items[index],
                ...updatedFields,
                ItemID: items[index].ItemID || items[index].TaskID,
                updatedAt: new Date().toISOString(),
            };
            saveItemsToLocalStorage(items);

            // Trigger sync in background
            triggerSync('update', items[index]).catch(console.error);

            resolve(items[index]);
        } else {
            console.error(`Item with ID ${idValue} not found.`);
            resolve(null);
        }
    });
}

/**
 * Delete an item by ID from current trip
 * @param {string} idValue
 * @returns {Promise<boolean>}
 */
export async function deleteLocalRecord(idValue) {
    return new Promise(resolve => {
        const items = loadItemsFromLocalStorage();
        const index = items.findIndex(item =>
            item.ItemID === idValue || item.TaskID === idValue
        );

        if (index !== -1) {
            const deletedItem = items[index];
            items.splice(index, 1);
            saveItemsToLocalStorage(items);

            // Trigger sync in background
            triggerSync('delete', deletedItem).catch(console.error);

            resolve(true);
        } else {
            console.error(`Item with ID ${idValue} not found for deletion.`);
            resolve(false);
        }
    });
}

/**
 * Get all items directly for current trip
 * @returns {Array}
 */
export function getAllItems() {
    return loadItemsFromLocalStorage();
}

/**
 * Save all items for current trip (used after merge from remote)
 * @param {Array} items
 */
export function saveAllItems(items) {
    saveItemsToLocalStorage(items);
}

/**
 * Generate a UUID
 * @returns {string}
 */
export function generateUUID() {
    return crypto.randomUUID();
}
