// js/data.js - Local-first storage with per-trip support

import { triggerSync, registerCacheInvalidator } from './sync.js';
import { getActiveTripId, getTripItemsKey } from './trip-registry.js';

// Register our cache invalidator with the sync layer so that whenever sync
// writes merged remote data straight to localStorage, our in-memory cache is
// dropped and the next read reflects the fresh data.
registerCacheInvalidator(clearItemsCache);

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
        // Keep tombstones (deleted items) inside the cache so that a later
        // save (append/update/delete) doesn't wipe them — sync.js needs them
        // in storage to honour deletions across devices. Callers that display
        // items get a tombstone-free view via loadVisibleItems().
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
 * Get visible (non-deleted) items for current trip.
 * Tombstones are kept in storage/cache for sync but excluded from the UI.
 * @returns {Promise<Array>}
 */
export async function batchGetLocalData() {
    return new Promise(resolve => {
        const items = loadItemsFromLocalStorage();
        resolve([items.filter(item => !item.deleted)]);
    });
}

/**
 * Get all visible items directly (no tombstones).
 * @returns {Array}
 */
export function getAllItems() {
    return loadItemsFromLocalStorage().filter(item => !item.deleted);
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
 * Delete an item by ID from current trip.
 *
 * Rather than physically removing the item, we mark it as a tombstone
 * (deleted: true, deletedAt: <now>) and keep it in storage. This lets the
 * sync merge layer honour the deletion against a stale remote copy of the
 * item — otherwise the merge would just resurrect the item from the remote.
 * Render functions filter out tombstones so they're invisible to the user.
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
            const now = new Date().toISOString();
            // Mark as tombstone (also bump updatedAt so LWW treats the delete
            // as the newest version of this item).
            const tombstone = {
                ...items[index],
                ItemID: items[index].ItemID || items[index].TaskID,
                deleted: true,
                deletedAt: now,
                updatedAt: now,
            };
            items[index] = tombstone;
            saveItemsToLocalStorage(items);

            // Trigger sync in background
            triggerSync('delete', tombstone).catch(console.error);

            resolve(true);
        } else {
            console.error(`Item with ID ${idValue} not found for deletion.`);
            resolve(false);
        }
    });
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
