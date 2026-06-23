// js/trip-registry.js - Multi-trip registry management

const TRIP_REGISTRY_KEY = 'trip_registry';
const ACTIVE_TRIP_KEY = 'active_trip_id';

/**
 * Get the trip registry (all trips)
 * @returns {Array} Array of trip objects
 */
export function getTripRegistry() {
    const raw = localStorage.getItem(TRIP_REGISTRY_KEY);
    return raw ? JSON.parse(raw) : [];
}

/**
 * Save the trip registry
 * @param {Array} registry
 */
function saveTripRegistry(registry) {
    localStorage.setItem(TRIP_REGISTRY_KEY, JSON.stringify(registry));
}

/**
 * Get the active trip ID
 * @returns {string|null}
 */
export function getActiveTripId() {
    return localStorage.getItem(ACTIVE_TRIP_KEY);
}

/**
 * Set the active trip
 * @param {string} tripId
 */
export function setActiveTrip(tripId) {
    localStorage.setItem(ACTIVE_TRIP_KEY, tripId);
}

/**
 * Add a new trip to the registry
 * @param {Object} trip - { id, name, binId, accessKey, lastSync }
 * @returns {string} The trip ID
 */
export function addTrip(trip) {
    const registry = getTripRegistry();
    const newTrip = {
        id: trip.id || crypto.randomUUID(),
        name: trip.name || 'My Trip',
        binId: trip.binId || null,
        accessKey: trip.accessKey || null,
        createdAt: trip.createdAt || new Date().toISOString(),
        lastSync: trip.lastSync || null,
    };
    registry.push(newTrip);
    saveTripRegistry(registry);

    // If this is the first trip, make it active
    if (registry.length === 1) {
        setActiveTrip(newTrip.id);
    }

    return newTrip.id;
}

/**
 * Update a trip in the registry
 * @param {string} tripId
 * @param {Object} updates
 */
export function updateTrip(tripId, updates) {
    const registry = getTripRegistry();
    const index = registry.findIndex(t => t.id === tripId);
    if (index !== -1) {
        registry[index] = { ...registry[index], ...updates };
        saveTripRegistry(registry);
    }
}

/**
 * Remove a trip from the registry
 * @param {string} tripId
 * @param {boolean} keepData - If true, keep the trip's items in localStorage
 */
export function removeTrip(tripId, keepData = true) {
    const registry = getTripRegistry();
    const filtered = registry.filter(t => t.id !== tripId);
    saveTripRegistry(filtered);

    // Clear the items storage for this trip
    if (!keepData) {
        localStorage.removeItem(getTripItemsKey(tripId));
    }

    // If this was the active trip, switch to another
    if (getActiveTripId() === tripId) {
        if (filtered.length > 0) {
            setActiveTrip(filtered[0].id);
        } else {
            localStorage.removeItem(ACTIVE_TRIP_KEY);
        }
    }
}

/**
 * Get a trip by ID
 * @param {string} tripId
 * @returns {Object|null}
 */
export function getTrip(tripId) {
    const registry = getTripRegistry();
    return registry.find(t => t.id === tripId) || null;
}

/**
 * Get the active trip
 * @returns {Object|null}
 */
export function getActiveTrip() {
    const id = getActiveTripId();
    return id ? getTrip(id) : null;
}

/**
 * Get the localStorage key for a trip's items
 * @param {string} tripId
 * @returns {string}
 */
export function getTripItemsKey(tripId) {
    return `trip_items_${tripId}`;
}

/**
 * Switch to a different trip
 * @param {string} tripId
 */
export function switchTrip(tripId) {
    const trip = getTrip(tripId);
    if (!trip) {
        throw new Error(`Trip ${tripId} not found`);
    }
    setActiveTrip(tripId);
}

/**
 * Create a new local-only trip
 * @param {string} name - Trip name
 * @returns {string} The new trip ID
 */
export function createLocalTrip(name) {
    return addTrip({
        name: name || 'New Trip',
        binId: null,
        accessKey: null,
    });
}

/**
 * Get all trips for display
 * @returns {Array}
 */
export function getAllTrips() {
    return getTripRegistry();
}

/**
 * Check if there are any trips
 * @returns {boolean}
 */
export function hasTrips() {
    return getTripRegistry().length > 0;
}

/**
 * Initialize the trip system - create a default trip if none exist
 * @returns {string} The active trip ID
 */
export function initializeTrips() {
    const registry = getTripRegistry();

    if (registry.length === 0) {
        // Migrate existing data if present (from old single-trip version)
        const oldItems = localStorage.getItem('tripy_items');

        // Create a default trip
        const defaultTripId = addTrip({
            name: 'My Trip',
            binId: null,
            accessKey: null,
        });

        // Migrate old items if they exist
        if (oldItems) {
            localStorage.setItem(getTripItemsKey(defaultTripId), oldItems);
            // Don't delete old data in case of issues
        }

        setActiveTrip(defaultTripId);
        return defaultTripId;
    }

    // Ensure we have an active trip
    const activeId = getActiveTripId();
    if (!activeId || !getTrip(activeId)) {
        setActiveTrip(registry[0].id);
        return registry[0].id;
    }

    return activeId;
}
