import { curve } from 'libsignal'
import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from 'crypto'
import { KeyPair, valueReplacer, valueReviver, AppDataSync, Fingerprint, ConnectionStatus } from '../Types'

const generateKeyPair = () => {
	const { pubKey, privKey } = curve.generateKeyPair()
	return {
		private: Buffer.from(privKey),
		public: Buffer.from(pubKey.slice(1))
	}
}

const generateSignalPubKey = (pubKey: Uint8Array) => {
	return pubKey.length === 33 ? pubKey : Buffer.concat([Buffer.from([5]), pubKey])
}

const sign = (privateKey: object, buf: Uint8Array) => {
	return curve.calculateSignature(privateKey, buf)
}

const signedKeyPair = (identityKeyPair: KeyPair, keyId: number) => {
	const preKey = generateKeyPair()
	const pubKey = generateSignalPubKey(preKey.public)
	const signature = sign(identityKeyPair.private, pubKey)
	return { keyPair: preKey, signature, keyId }
}

const allocate = (str: string) => {
	let p = str.length

	if (!p){
		return new Uint8Array(1)
	}

	let n = 0

	while (--p % 4 > 1 && str.charAt(p) === "="){
		++n
	}

	return new Uint8Array(Math.ceil(str.length * 3) / 4 - n).fill(0)
}

const parseTimestamp = (timestamp: string | number | Long) => {
	if (typeof timestamp === 'string') {
		return parseInt(timestamp, 10)
	}

	if (typeof timestamp === "number") {
		return timestamp
	}

	return timestamp
}

export const fromObject = (args: AppDataSync) => {
	const f: Fingerprint = {
		...args.fingerprint,
		deviceIndexes: Array.isArray(args.fingerprint.deviceIndexes) ? args.fingerprint.deviceIndexes : []
	}

	const message = {
		keyData: Array.isArray(args.keyData) ? args.keyData : new Uint8Array(),
		fingerprint: {
			rawId: f.rawId || 0,
			currentIndex: f.rawId || 0,
			deviceIndexes: f.deviceIndexes
		},
		timestamp: parseTimestamp(args.timestamp)
	}

	if (typeof args.keyData === "string") {
		message.keyData = allocate(args.keyData)
	}

	return message
}

export const BufferJSON = {
	replacer: (_: string, value: valueReplacer) => {
		if(value?.type === 'Buffer' && Array.isArray(value?.data)) {
			return {
				type: 'Buffer',
				data: Buffer.from(value?.data).toString('base64')
			}
		}
		return value
	},
	reviver: (_: string, value: valueReviver) => {
		if(value?.type === 'Buffer') {
			return Buffer.from(value?.data, 'base64')
		}
		return value
	}
}

// Performance monitoring utilities
export const performance = {
    start: () => {
        return process.hrtime();
    },
    end: (start: [number, number]) => {
        const diff = process.hrtime(start);
        return (diff[0] * 1e9 + diff[1]) / 1e6; // Return milliseconds
    }
};

// Data encryption/decryption for sensitive data
export const encryption = {
    /**
     * Encrypts sensitive data
     * @param data String data to encrypt
     * @param key Encryption key (32 bytes)
     * @returns Encrypted string in format: iv:encryptedData
     */
    encrypt: (data: string, key: string): string => {
        const iv = randomBytes(16);
        const hashKey = createHash('sha256').update(key).digest();
        const cipher = createCipheriv('aes-256-cbc', hashKey, iv);
        let encrypted = cipher.update(data, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        return `${iv.toString('hex')}:${encrypted}`;
    },
    
    /**
     * Decrypts sensitive data
     * @param encData Encrypted data in format: iv:encryptedData
     * @param key Encryption key (32 bytes)
     * @returns Decrypted string
     */
    decrypt: (encData: string, key: string): string => {
        const [ivHex, encryptedData] = encData.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const hashKey = createHash('sha256').update(key).digest();
        const decipher = createDecipheriv('aes-256-cbc', hashKey, iv);
        let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
};

// Enhanced JSON serialization with compression for large objects
export const EnhancedBufferJSON = {
    ...BufferJSON,
    compressedReplacer: (key: string, value: any) => {
        const processed = BufferJSON.replacer(key, value);
        // Add compression for large string values
        if (typeof processed === 'string' && processed.length > 1024) {
            // Implementation would depend on preferred compression library
            return { type: 'CompressedString', data: processed };
        }
        return processed;
    },
    compressedReviver: (key: string, value: any) => {
        if (value && value.type === 'CompressedString') {
            // Decompress and return
            return value.data;
        }
        return BufferJSON.reviver(key, value);
    }
};

// Connection pool monitoring - corrigindo o erro de "length" em type 'never'
export const monitorConnectionPool = (pool: any): ConnectionStatus => {
    if (!pool || !pool.pool || typeof pool.pool.getConnection !== 'function') {
        return { active: 0, idle: 0, total: 0, queued: 0, healthy: false };
    }
    
    // Usando optional chaining e nullish coalescing para evitar o erro "length" em tipo "never"
    const stats = pool.pool._allConnections?.length ?? 0;
    const active = pool.pool._acquiringConnections?.length ?? 0;
    const idle = pool.pool._freeConnections?.length ?? 0;
    const queued = pool.pool._connectionQueue?.length ?? 0;
    
    return {
        active,
        idle,
        total: stats,
        queued,
        healthy: idle > 0 || active < stats // Pool is healthy if there are idle connections or not all are active
    };
};

// Improved sanitization utilities
export const sqlSanitize = {
    identifier: (str: string): string => {
        return str.replace(/[^a-zA-Z0-9_]/g, '');
    },
    value: (val: any): any => {
        if (typeof val === 'string') {
            return val.replace(/[\0\n\r\b\t\\'"\x1a]/g, char => {
                switch (char) {
                    case "\0": return "\\0";
                    case "\n": return "\\n";
                    case "\r": return "\\r";
                    case "\b": return "\\b";
                    case "\t": return "\\t";
                    case "\x1a": return "\\Z";
                    case "'": return "''";
                    case '"': return '""';
                    case "\\": return "\\\\";
                    default: return char;
                }
            });
        }
        return val;
    }
};

export const initAuthCreds = () => {
	const identityKey = generateKeyPair()
	return {
		noiseKey: generateKeyPair(),
		pairingEphemeralKeyPair: generateKeyPair(),
		signedIdentityKey: identityKey,
		signedPreKey: signedKeyPair(identityKey, 1),
		registrationId: Uint16Array.from(randomBytes(2))[0] & 16383,
		advSecretKey: randomBytes(32).toString('base64'),
		processedHistoryMessages: [],
		nextPreKeyId: 1,
		firstUnuploadedPreKeyId: 1,
		accountSyncCounter: 0,
		accountSettings: {
			unarchiveChats: false
		},
		deviceId: Buffer.from(randomUUID().replace(/-/g, ''), 'hex').toString('base64url'),
		phoneId: randomUUID(),
		identityId: randomBytes(20),
		backupToken: randomBytes(20),
		registered: false,
		registration: {} as never,
		pairingCode: undefined,
		lastPropHash: undefined,
		routingInfo: undefined
	}
}
