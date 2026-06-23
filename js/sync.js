// js/sync.js - Offline-first sync engine for JSONBin.io

import { JsonBinApi, createBin } from './api.js';
import { getActiveTrip, updateTrip, getTripItemsKey } from './trip-registry.js';

const SYNC_QUEUE_KEY = 'trip_sync_queue';

// Internal sync state
let _syncInProgress = false;
let _statusListeners = [];
let _remoteDeletedListeners = [];

/**
 * Get the sync queue key for current trip
 */
function getSyncQueueKey() {
    const trip = getActiveTrip();
    return trip ? `trip_sync_queue_${trip.id}` : SYNC_QUEUE_KEY;
}

/**
 * Get the sync queue (pending changes when offline)
 * @returns {Array}
 */
function getSyncQueue() {
    const key = getSyncQueueKey();
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
}

/**
 * Save the sync queue
 * @param {Array} queue
 */
function saveSyncQueue(queue) {
    const key = getSyncQueueKey();
    localStorage.setItem(key, JSON.stringify(queue));
}

/**
 * Add an item to the sync queue
 * @param {string} operation - 'create', 'update', 'delete'
 * @param {Object} item
 */
function enqueueChange(operation, item) {
    const queue = getSyncQueue();
    // Remove any existing operation for this item
    const filtered = queue.filter(q => q.item.ItemID !== item.ItemID);
    filtered.push({ operation, item, timestamp: Date.now() });
    saveSyncQueue(filtered);
}

/**
 * Clear the sync queue
 */
function clearSyncQueue() {
    const key = getSyncQueueKey();
    localStorage.removeItem(key);
}

/**
 * Get sync status for current trip
 * @returns {string} 'unconfigured' | 'synced' | 'pending' | 'offline' | 'error'
 */
export function getSyncStatus() {
    const trip = getActiveTrip();
    if (!trip || !trip.binId) {
        return 'unconfigured';
    }
    const statusKey = `trip_sync_status_${trip.id}`;
    return localStorage.getItem(statusKey) || 'synced';
}

/**
 * Update sync status and notify listeners
 * @param {string} status
 */
function updateSyncStatus(status) {
    const trip = getActiveTrip();
    if (trip) {
        const statusKey = `trip_sync_status_${trip.id}`;
        localStorage.setItem(statusKey, status);
    }
    _statusListeners.forEach(cb => cb(status));
}

/**
 * Subscribe to sync status changes
 * @param {Function} callback(status)
 * @returns {Function} Unsubscribe function
 */
export function onSyncStatusChange(callback) {
    _statusListeners.push(callback);
    return () => {
        _statusListeners = _statusListeners.filter(cb => cb !== callback);
    };
}

/**
 * Determine if an error indicates the bin is gone (404 / not found)
 * @param {Error} error
 * @returns {boolean}
 */
function isRemoteDeletedError(error) {
    const msg = (error && error.message) ? String(error.message) : '';
    return /404|not found|read failed: 404|write failed: 404/i.test(msg);
}

/**
 * Notify listeners that the active trip's bin is no longer available remotely
 * @param {string} tripId
 */
function notifyRemoteDeleted(tripId) {
    _remoteDeletedListeners.forEach(cb => cb(tripId));
}

/**
 * Subscribe to remote-deleted events
 * @param {Function} callback(tripId)
 * @returns {Function} Unsubscribe function
 */
export function onRemoteDeleted(callback) {
    _remoteDeletedListeners.push(callback);
    return () => {
        _remoteDeletedListeners = _remoteDeletedListeners.filter(cb => cb !== callback);
    };
}

/**
 * Check if we have internet connectivity
 * @returns {Promise<boolean>}
 */
export async function isOnline() {
    if (!navigator.onLine) return false;
    try {
        await fetch('https://api.jsonbin.io/v3', { method: 'HEAD', mode: 'no-cors' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Initialize sync: check connectivity and trigger sync if needed
 */
export async function initSync() {
    const trip = getActiveTrip();
    if (!trip || !trip.binId) {
        updateSyncStatus('unconfigured');
        return;
    }

    const online = await isOnline();
    if (!online) {
        updateSyncStatus('offline');
        return;
    }

    // On startup, verify the bin is still reachable
    try {
        const api = new JsonBinApi(trip.binId, trip.accessKey);
        await api.read();
    } catch (error) {
        if (isRemoteDeletedError(error)) {
            updateSyncStatus('remote-deleted');
            notifyRemoteDeleted(trip.id);
            return;
        }
        updateSyncStatus('error');
        return;
    }

    const queue = getSyncQueue();
    if (queue.length > 0) {
        await syncToRemote();
    } else {
        updateSyncStatus('synced');
    }
}

/**
 * Trigger a sync to JSONBin
 * @param {string} operation - 'create', 'update', 'delete'
 * @param {Object} item - The item that changed
 */
export async function triggerSync(operation, item) {
    const trip = getActiveTrip();
    if (!trip || !trip.binId) {
        updateSyncStatus('unconfigured');
        return;
    }

    const online = await isOnline();
    if (!online) {
        enqueueChange(operation, item);
        updateSyncStatus('offline');
        return;
    }

    enqueueChange(operation, item);
    await syncToRemote();
}

/**
 * Sync all pending changes to JSONBin
 */
export async function syncToRemote() {
    if (_syncInProgress) return;
    _syncInProgress = true;

    const trip = getActiveTrip();
    if (!trip || !trip.binId) {
        _syncInProgress = false;
        return;
    }

    try {
        const api = new JsonBinApi(trip.binId, trip.accessKey);

        let remoteRecord;
        try {
            remoteRecord = await api.read();
        } catch (readError) {
            if (isRemoteDeletedError(readError)) {
                updateSyncStatus('remote-deleted');
                notifyRemoteDeleted(trip.id);
                _syncInProgress = false;
                return;
            }
            // Non-fatal read error: assume empty remote and proceed to write
            remoteRecord = { metadata: { tripName: trip.name, version: 1 }, items: [] };
        }

        const storageKey = getTripItemsKey(trip.id);
        const localItems = JSON.parse(localStorage.getItem(storageKey) || '[]');

        const mergedItems = mergeItems(localItems, remoteRecord.items || []);

        const updatedRecord = {
            metadata: {
                ...remoteRecord.metadata,
                tripName: trip.name,
                updatedAt: new Date().toISOString(),
            },
            items: mergedItems,
        };

        try {
            await api.write(updatedRecord);
        } catch (writeError) {
            if (isRemoteDeletedError(writeError)) {
                updateSyncStatus('remote-deleted');
                notifyRemoteDeleted(trip.id);
                _syncInProgress = false;
                return;
            }
            throw writeError;
        }

        localStorage.setItem(storageKey, JSON.stringify(mergedItems));

        clearSyncQueue();

        updateTrip(trip.id, {
            lastSync: new Date().toISOString(),
        });

        updateSyncStatus('synced');
    } catch (error) {
        console.error('Sync failed:', error);
        updateSyncStatus('error');
    } finally {
        _syncInProgress = false;
    }
}

/**
 * Fetch remote data and merge with local
 * @returns {Promise<boolean>} true if data was updated
 */
export async function fetchRemoteAndMerge() {
    const trip = getActiveTrip();
    if (!trip || !trip.binId) return false;

    const online = await isOnline();
    if (!online) {
        updateSyncStatus('offline');
        return false;
    }

    try {
        const api = new JsonBinApi(trip.binId, trip.accessKey);
        let remoteRecord;
        try {
            remoteRecord = await api.read();
        } catch (readError) {
            if (isRemoteDeletedError(readError)) {
                updateSyncStatus('remote-deleted');
                notifyRemoteDeleted(trip.id);
                return false;
            }
            throw readError;
        }
        const remoteItems = remoteRecord.items || [];

        const storageKey = getTripItemsKey(trip.id);
        const localItems = JSON.parse(localStorage.getItem(storageKey) || '[]');

        const mergedItems = mergeItems(localItems, remoteItems);

        localStorage.setItem(storageKey, JSON.stringify(mergedItems));

        updateTrip(trip.id, {
            lastSync: new Date().toISOString(),
        });

        updateSyncStatus('synced');
        return JSON.stringify(localItems) !== JSON.stringify(mergedItems);
    } catch (error) {
        console.error('Fetch remote failed:', error);
        updateSyncStatus('error');
        return false;
    }
}

/**
 * Create a new trip bin on JSONBin
 * @param {string} masterKey - JSONBin Master Key
 * @param {string} tripName - Name of the trip
 * @param {Array} items - Initial items
 * @returns {Promise<{binId: string}>}
 */
export async function createRemoteTrip(masterKey, tripName, items = []) {
    const initialRecord = {
        metadata: {
            tripName: tripName || 'My Trip',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            version: 1,
        },
        items: items.map(item => ({
            ...item,
            updatedAt: item.updatedAt || new Date().toISOString(),
        })),
    };

    return await createBin(masterKey, initialRecord);
}

/**
 * Join an existing trip by binId and accessKey
 * @param {string} binId
 * @param {string} accessKey
 * @returns {Promise<Object>} The remote record
 */
export async function joinRemoteTrip(binId, accessKey) {
    const api = new JsonBinApi(binId, accessKey);
    const record = await api.read();
    return record;
}

/**
 * Merge local and remote items using last-write-wins
 * @param {Array} localItems
 * @param {Array} remoteItems
 * @returns {Array}
 */
function mergeItems(localItems, remoteItems) {
    const merged = new Map();

    localItems.forEach(item => merged.set(item.ItemID || item.TaskID, item));

    remoteItems.forEach(remoteItem => {
        const id = remoteItem.ItemID || remoteItem.TaskID;
        const localItem = merged.get(id);

        if (!localItem) {
            merged.set(id, remoteItem);
        } else {
            const remoteTime = new Date(remoteItem.updatedAt || 0).getTime();
            const localTime = new Date(localItem.updatedAt || localItem.updatedAt || 0).getTime();
            if (remoteTime > localTime) {
                merged.set(id, remoteItem);
            }
        }
    });

    return Array.from(merged.values());
}

/**
 * Format last sync time for display
 * @returns {string}
 */
export function getLastSyncText() {
    const trip = getActiveTrip();
    if (!trip || !trip.lastSync) return 'Never synced';

    const lastSync = new Date(trip.lastSync);
    const now = new Date();
    const diffMs = now - lastSync;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return lastSync.toLocaleDateString();
}

// Listen for online/offline events
window.addEventListener('online', () => {
    const trip = getActiveTrip();
    if (trip && trip.binId) {
        updateSyncStatus('pending');
        syncToRemote();
    }
});

window.addEventListener('offline', () => {
    const trip = getActiveTrip();
    if (trip && trip.binId) {
        updateSyncStatus('offline');
    }
});
