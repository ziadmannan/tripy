// js/api.js - JSONBin.io API wrapper

const BASE_URL = 'https://api.jsonbin.io/v3/b';

/**
 * JSONBin API wrapper for per-trip operations
 */
export class JsonBinApi {
    constructor(binId, accessKey) {
        this.binId = binId;
        this.accessKey = accessKey;
    }

    _headers() {
        return {
            'Content-Type': 'application/json',
            'X-Access-Key': this.accessKey,
        };
    }

    /**
     * Read the latest version of the bin
     * @returns {Promise<Object>} The bin record
     */
    async read() {
        const res = await fetch(`${BASE_URL}/${this.binId}/latest`, {
            headers: this._headers()
        });
        if (!res.ok) {
            throw new Error(`Read failed: ${res.status}`);
        }
        const data = await res.json();
        return data.record;
    }

    /**
     * Write (replace) the entire bin content
     * @param {Object} record
     * @returns {Promise<Object>}
     */
    async write(record) {
        const res = await fetch(`${BASE_URL}/${this.binId}`, {
            method: 'PUT',
            headers: this._headers(),
            body: JSON.stringify(record)
        });
        if (!res.ok) {
            throw new Error(`Write failed: ${res.status}`);
        }
        const data = await res.json();
        return data.record;
    }

    /**
     * Validate the bin is accessible
     * @returns {Promise<boolean>}
     */
    async validate() {
        try {
            await this.read();
            return true;
        } catch {
            return false;
        }
    }
}

/**
 * Create a new JSONBin (requires Master Key)
 * @param {string} masterKey
 * @param {Object} initialRecord
 * @returns {Promise<{binId: string}>}
 */
export async function createBin(masterKey, initialRecord) {
    const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Master-Key': masterKey,
            'X-Bin-Private': 'true',
        },
        body: JSON.stringify(initialRecord),
    });

    if (!res.ok) {
        throw new Error(`Create failed: ${res.status}`);
    }

    const data = await res.json();
    return {
        binId: data.metadata.id,
    };
}
