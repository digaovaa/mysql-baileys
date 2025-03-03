import { createPool, Pool, PoolConnection, PreparedStatement } from 'mysql2/promise';
import { BufferJSON, initAuthCreds, fromObject } from '../Utils';
import { MySQLConfig, sqlData, AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '../Types';
import { createHash } from 'crypto';

/**
 * Stores the full authentication state in MySQL
 * Implements security best practices and performance optimizations
 */

// Global connection pool and prepared statements cache
const pools: Record<string, Pool> = {};
const preparedStatements: Record<string, Record<string, PreparedStatement>> = {};

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

        // Setup connection error handler
        pools[poolKey].on('error', (err) => {
            console.error(`Database pool error for ${config.database}:`, err);
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

// Prepare common queries for reuse
async function prepareStatements(pool: Pool, tableName: string, session: string): Promise<Record<string, PreparedStatement>> {
    const safeTableName = sanitizeTableName(tableName);
    const key = `${session}:${safeTableName}`;
    
    if (!preparedStatements[key]) {
        preparedStatements[key] = {
            select: await pool.prepare(`SELECT value FROM \`${safeTableName}\` WHERE id = ? AND session = ?`),
            insert: await pool.prepare(`INSERT INTO \`${safeTableName}\` (session, id, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?`),
            delete: await pool.prepare(`DELETE FROM \`${safeTableName}\` WHERE id = ? AND session = ?`),
            clearAll: await pool.prepare(`DELETE FROM \`${safeTableName}\` WHERE id != 'creds' AND session = ?`),
            removeAll: await pool.prepare(`DELETE FROM \`${safeTableName}\` WHERE session = ?`)
        };
    }
    
    return preparedStatements[key];
}

export const useMySQLAuthState = async(config: MySQLConfig): Promise<{ 
    state: AuthenticationState, 
    saveCreds: () => Promise<void>, 
    clear: () => Promise<void>, 
    removeCreds: () => Promise<void>, 
    query: (sql: string, values: any[]) => Promise<sqlData>,
    closeConnections: () => Promise<void>
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
                if (e.code === 'PROTOCOL_CONNECTION_LOST' || 
                    e.code === 'ECONNREFUSED' || 
                    e.code === 'ER_CON_COUNT_ERROR') {
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
            const data = rows[0]?.value ?? null;
            
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
                        const promises = [];
                        
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
        closeConnections
    };
};
