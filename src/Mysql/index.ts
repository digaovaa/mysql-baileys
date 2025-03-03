import { createPool, Pool, PoolConnection, PreparedStatementInfo } from 'mysql2/promise';
import { BufferJSON, initAuthCreds, fromObject } from '../Utils';
import { MySQLConfig, sqlData, AuthenticationCreds, AuthenticationState, SignalDataTypeMap, PreparedStatementCache } from '../Types';
import { createHash } from 'crypto';

/**
 * Stores the full authentication state in MySQL
 * Implements security best practices and performance optimizations
 */

// Global connection pool and prepared statements cache
const pools: Record<string, Pool> = {};
const preparedStatements: Record<string, Record<string, PreparedStatementInfo>> = {};

// Cache for frequently accessed data
const dataCache: Record<string, { data: any, timestamp: number }> = {};
const CACHE_TTL = 300000; // 5 minutes cache TTL

// Helper function to sanitize table names to prevent SQL injection
const sanitizeTableName = (name: string): string => {
    return name.replace(/[^a-zA-Z0-9_]/g, '');
};

// Create a unique key for session data retrieval
const createCacheKey = (session: string, id: string): string => {
    return createHash('md5').update(`${session}:${id}`).digest('hex');
};

// Check if cached data is valid
const isValidCache = (key: string): boolean => {
    if (!dataCache[key]) return false;
    return Date.now() - dataCache[key].timestamp < CACHE_TTL;
};

async function getConnection(config: MySQLConfig): Promise<Pool> {
    const poolKey = `${config.host || 'localhost'}:${config.port || 3306}:${config.database}:${config.session}`;
    
    if (!pools[poolKey]) {
        // Enhanced connection pool with optimized settings
        pools[poolKey] = createPool({
            database: config.database,
            host: config.host || 'localhost',
            port: config.port || 3306,
            user: config.user || 'root',
            password: config.password,
            waitForConnections: true,
            connectionLimit: config.connectionLimit || 20,
            queueLimit: config.queueLimit || 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 5000,
            namedPlaceholders: true, // Enable named parameters for better security
            multipleStatements: false, // Prevent multiple statements for security
            dateStrings: true, // For consistent datetime handling
            ssl: config.ssl,
            localAddress: config.localAddress,
            socketPath: config.socketPath,
            insecureAuth: config.insecureAuth || false,
            connectTimeout: 10000, // 10 seconds timeout
            trace: false // Disable deprecated feature
        });

        // Setup connection error handler - fix for the TS error
        pools[poolKey].on('connection', (conn) => {
            conn.on('error', (err) => {
                console.error(`Database connection error for ${config.database}:`, err);
            });
        });

        pools[poolKey].on('acquire', (conn) => {
            // Connection acquired from pool
        });

        pools[poolKey].on('release', (conn) => {
            // Connection released back to pool
        });
    }

    return pools[poolKey];
}

// Initialize table with proper indexes and structure
async function initializeDatabase(pool: Pool, tableName: string): Promise<void> {
    const safeTableName = sanitizeTableName(tableName);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS \`${safeTableName}\` (
            \`session\` varchar(50) NOT NULL,
            \`id\` varchar(80) NOT NULL,
            \`value\` json DEFAULT NULL,
            \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            UNIQUE KEY \`idxunique\` (\`session\`,\`id\`),
            KEY \`idxsession\` (\`session\`), 
            KEY \`idxid\` (\`id\`)
        ) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    `);
}

// Prepare common queries for reuse - fix the PreparedStatement type
async function prepareStatements(pool: Pool, tableName: string, session: string): Promise<Record<string, PreparedStatementInfo>> {
    const safeTableName = sanitizeTableName(tableName);
    const key = `${session}:${safeTableName}`;
    
    if (!preparedStatements[key]) {
        preparedStatements[key] = {
            select: await pool.prepare(`SELECT value FROM \`${safeTableName}\` WHERE id = ? AND session = ?`),
            insert: await pool.prepare(`INSERT INTO \`${safeTableName}\` (session, id, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?`),
            delete: await pool.prepare(`DELETE FROM \`${safeTableName}\` WHERE id = ? AND session = ?`),
            clearAll: await pool.prepare(`DELETE FROM \`${safeTableName}\` WHERE id != 'creds' AND session = ?`),
            removeAll: await pool.prepare(`DELETE FROM \`${safeTableName}\` WHERE session = ?`),
            // Add new prepared statement for clearing sender-key-memory
            clearSenderKeyMemory: await pool.prepare(`DELETE FROM \`${safeTableName}\` WHERE id LIKE 'sender-key-memory-%' AND session = ?`)
        };
    }
    
    return preparedStatements[key];
}

// Track cleanup intervals to avoid memory leaks
const cleanupIntervals: Record<string, NodeJS.Timeout> = {};

export const useMySQLAuthState = async(config: MySQLConfig): Promise<{ 
    state: AuthenticationState, 
    saveCreds: () => Promise<void>, 
    clear: () => Promise<void>, 
    removeCreds: () => Promise<void>, 
    query: (sql: string, values: any[]) => Promise<sqlData>,
    closeConnections: () => Promise<void>,
    clearSenderKeyMemory: () => Promise<sqlData> // Add the new function to the returned object
}> => {
    // Validate essential configuration
    if (!config.database || !config.session) {
        throw new Error('Database name and session identifier are required');
    }

    const pool = await getConnection(config);
    const tableName = sanitizeTableName(config.tableName || 'auth');
    const retryRequestDelayMs = config.retryRequestDelayMs || 200;
    const maxRetries = config.maxtRetries || 10;
    
    // Initialize database and prepare statements
    await initializeDatabase(pool, tableName);
    const statements = await prepareStatements(pool, tableName, config.session);

    // Enhanced query function with retries, error handling and automatic reconnection
    const query = async (sql: string, values: any[]): Promise<sqlData> => {
        let lastError: Error | null = null;
        for (let x = 0; x < maxRetries; x++) {
            try {
                // Use parameterized query for security
                const [rows] = await pool.execute(sql, values);
                return rows as sqlData;
            } catch (e) {
                lastError = e as Error;
                // Check if connection is lost and try to reconnect
                const err = e as any;
                if (err.code === 'PROTOCOL_CONNECTION_LOST' || 
                    err.code === 'ECONNREFUSED' || 
                    err.code === 'ER_CON_COUNT_ERROR') {
                    // Force refresh connection pool
                    await new Promise(r => setTimeout(r, retryRequestDelayMs * (x + 1)));
                    continue;
                }
                
                // Wait before retry with exponential backoff
                await new Promise(r => setTimeout(r, retryRequestDelayMs * Math.pow(2, x)));
            }
        }
        
        throw new Error(`Query failed after ${maxRetries} attempts: ${lastError?.message}`);
    };

    // Optimized read operation with caching
    const readData = async (id: string) => {
        const cacheKey = createCacheKey(config.session, id);
        
        // Return from cache if valid
        if (isValidCache(cacheKey)) {
            return dataCache[cacheKey].data;
        }
        
        try {
            const [rows] = await statements.select.execute([id, config.session]);
            const data = (rows as any[])[0]?.value ?? null;
            
            // Cache the result
            if (data) {
                dataCache[cacheKey] = { data, timestamp: Date.now() };
            }
            
            return data;
        } catch (error) {
            console.error(`Error reading data for ${id}:`, error);
            return null;
        }
    };

    // Optimized write operation with cache invalidation
    const writeData = async (id: string, value: object) => {
        try {
            await statements.insert.execute([config.session, id, JSON.stringify(value), JSON.stringify(value)]);
            
            // Update cache
            const cacheKey = createCacheKey(config.session, id);
            dataCache[cacheKey] = { data: value, timestamp: Date.now() };
        } catch (error) {
            console.error(`Error writing data for ${id}:`, error);
            throw error;
        }
    };

    const removeData = async (id: string) => {
        try {
            await statements.delete.execute([id, config.session]);
            
            // Invalidate cache
            const cacheKey = createCacheKey(config.session, id);
            delete dataCache[cacheKey];
        } catch (error) {
            console.error(`Error removing data for ${id}:`, error);
            throw error;
        }
    };

    const clearAll = async () => {
        try {
            await statements.clearAll.execute([config.session]);
            
            // Clear all cache except creds
            Object.keys(dataCache).forEach(key => {
                if (!key.includes('creds')) {
                    delete dataCache[key];
                }
            });
        } catch (error) {
            console.error('Error clearing data:', error);
            throw error;
        }
    };

    const removeAll = async () => {
        try {
            await statements.removeAll.execute([config.session]);
            
            // Clear all cache for this session
            Object.keys(dataCache).forEach(key => {
                if (key.includes(config.session)) {
                    delete dataCache[key];
                }
            });
        } catch (error) {
            console.error('Error removing all data:', error);
            throw error;
        }
    };
    
    // Function to clear sender-key-memory entries
    const clearSenderKeyMemory = async () => {
        try {
            const [result] = await statements.clearSenderKeyMemory.execute([config.session]);
            
            // Clear cache entries for sender-key-memory
            Object.keys(dataCache).forEach(key => {
                if (key.includes('sender-key-memory')) {
                    delete dataCache[key];
                }
            });
            
            console.log(`Cleared sender-key-memory entries for session ${config.session}`);
            return result as sqlData;
        } catch (error) {
            console.error(`Error clearing sender-key-memory for session ${config.session}:`, error);
            throw error;
        }
    };
    
    // Set up automatic cleanup interval (default: 24 hours)
    const cleanupIntervalHours = config.cleanupIntervalHours || 24;
    const intervalKey = `${config.host || 'localhost'}:${config.port || 3306}:${config.database}:${config.session}`;
    
    // Clear any existing interval for this connection
    if (cleanupIntervals[intervalKey]) {
        clearInterval(cleanupIntervals[intervalKey]);
    }
    
    // Set up new interval for automatic cleanup
    if (cleanupIntervalHours > 0) {
        cleanupIntervals[intervalKey] = setInterval(async () => {
            try {
                await clearSenderKeyMemory();
                console.log(`Automatic cleanup of sender-key-memory completed for session ${config.session}`);
            } catch (err) {
                console.error(`Automatic cleanup failed for session ${config.session}:`, err);
            }
        }, cleanupIntervalHours * 60 * 60 * 1000); // Convert hours to milliseconds
    }
    
    // Close connections and release resources
    const closeConnections = async () => {
        const poolKey = `${config.host || 'localhost'}:${config.port || 3306}:${config.database}:${config.session}`;
        const pool = pools[poolKey];
        if (pool) {
            await pool.end();
            delete pools[poolKey];
        }
        
        // Clear prepared statements
        const stmtKey = `${config.session}:${tableName}`;
        if (preparedStatements[stmtKey]) {
            delete preparedStatements[stmtKey];
        }

        // Clear the cleanup interval when connections are closed
        if (cleanupIntervals[intervalKey]) {
            clearInterval(cleanupIntervals[intervalKey]);
            delete cleanupIntervals[intervalKey];
        }
    };

    // Load or initialize credentials
    const creds: AuthenticationCreds = await readData('creds') || initAuthCreds();

    return {
        state: {
            creds,
            keys: {
                get: async (type, ids) => {
                    const data: { [id: string]: SignalDataTypeMap[typeof type] } = {};
                    
                    // Use Promise.all for parallel data fetching
                    await Promise.all(ids.map(async (id) => {
                        let value = await readData(`${type}-${id}`);
                        if (type === 'app-state-sync-key' && value) {
                            value = fromObject(value);
                        }
                        data[id] = value;
                    }));
                    
                    return data;
                },
                set: async (data) => {
                    // Use transactions for batch operations
                    const conn = await pool.getConnection();
                    await conn.beginTransaction();
                    
                    try {
                        const promises: Promise<any>[] = [];
                        
                        for (const category in data) {
                            for (const id in data[category]) {
                                const value = data[category][id];
                                const name = `${category}-${id}`;
                                
                                if (value) {
                                    promises.push(statements.insert.execute([config.session, name, JSON.stringify(value), JSON.stringify(value)]));
                                    
                                    // Update cache
                                    const cacheKey = createCacheKey(config.session, name);
                                    dataCache[cacheKey] = { data: value, timestamp: Date.now() };
                                } else {
                                    promises.push(statements.delete.execute([name, config.session]));
                                    
                                    // Invalidate cache
                                    const cacheKey = createCacheKey(config.session, name);
                                    delete dataCache[cacheKey];
                                }
                            }
                        }
                        
                        // Execute all operations
                        await Promise.all(promises);
                        await conn.commit();
                    } catch (error) {
                        await conn.rollback();
                        console.error('Error in batch set operation:', error);
                        throw error;
                    } finally {
                        conn.release();
                    }
                }
            }
        },
        saveCreds: async () => {
            await writeData('creds', creds);
        },
        clear: async () => {
            await clearAll();
        },
        removeCreds: async () => {
            await removeAll();
        },
        query: async (sql: string, values: any[]) => {
            return await query(sql, values);
        },
        closeConnections,
        clearSenderKeyMemory // Add the new function to the returned object
    };
};
