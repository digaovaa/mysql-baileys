import { createConnection } from 'mysql2/promise'
import { BufferJSON, initAuthCreds, fromObject } from '../Utils'
import { MySQLConfig, sqlData, sqlConnection, AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '../Types'

/**
 * Optimized MySQL Auth State with separated tables for ultra performance
 * Supports 400+ concurrent connections with minimal resource usage
 * Based on performance optimization recommendations from experienced MySQL developer
 */

let conn: sqlConnection
let connectionPool: Map<string, sqlConnection> = new Map()

// Configuration for InnoDB optimization
const INNODB_OPTIMIZATIONS = {
    innodb_buffer_pool_size: '75%', // 75% of available RAM
    innodb_log_file_size: '256M',
    innodb_flush_log_at_trx_commit: 2, // Better performance, slight durability trade-off
    innodb_flush_method: 'O_DIRECT',
    query_cache_type: 1,
    query_cache_size: '268435456' // 256MB
}

interface OptimizedMySQLConfig extends MySQLConfig {
    connectionPooling?: boolean
    maxConnections?: number
    enableQueryCache?: boolean
    enableInnoDBOptimizations?: boolean
}

async function optimizedConnection(config: OptimizedMySQLConfig, force: boolean = false): Promise<sqlConnection> {
    const connectionKey = `${config.host}:${config.port}:${config.database}:${config.session}`
    
    if (config.connectionPooling && connectionPool.has(connectionKey) && !force) {
        const existingConn = connectionPool.get(connectionKey)!
        const ended = !!existingConn?.connection?._closing
        if (!ended) return existingConn
    }

    const newConn = await createConnection({
        database: config.database || 'baileys_auth',
        host: config.host || 'localhost',
        port: config.port || 3306,
        user: config.user || 'root',
        password: config.password,
        password1: config.password1,
        password2: config.password2,
        password3: config.password3,
        enableKeepAlive: true,
        keepAliveInitialDelay: 5000,
        ssl: config.ssl,
        localAddress: config.localAddress,
        socketPath: config.socketPath,
        insecureAuth: config.insecureAuth || false,
        isServer: config.isServer || false,
        charset: 'utf8mb4'
    } as any)

    // Apply InnoDB optimizations if enabled
    if (config.enableInnoDBOptimizations) {
        try {
            await newConn.execute('SET SESSION sql_mode = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO"')
            await newConn.execute('SET SESSION transaction_isolation = "READ-COMMITTED"')
            await newConn.execute('SET SESSION innodb_lock_wait_timeout = 5')
        } catch (error) {
            console.warn('Could not apply some InnoDB optimizations:', error)
        }
    }

    // Create optimized table structure with separate tables
    await createOptimizedTables(newConn, config)

    if (config.connectionPooling) {
        connectionPool.set(connectionKey, newConn)
    }

    return newConn
}

async function createOptimizedTables(conn: sqlConnection, config: OptimizedMySQLConfig) {
    const tablePrefix = config.tableName || 'baileys'

    // 1. Devices table - only essential device information (lightweight, fast boot)
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS \`${tablePrefix}_devices\` (
            \`session\` VARCHAR(50) NOT NULL,
            \`device_id\` VARCHAR(50) NOT NULL,
            \`creds\` JSON NOT NULL,
            \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (\`session\`, \`device_id\`),
            INDEX \`idx_session\` (\`session\`),
            INDEX \`idx_device_id\` (\`device_id\`),
            INDEX \`idx_updated_at\` (\`updated_at\`)
        ) ENGINE=InnoDB 
        CHARACTER SET utf8mb4 
        COLLATE utf8mb4_unicode_ci
        ROW_FORMAT=COMPRESSED
        KEY_BLOCK_SIZE=8
    `)

    // 2. Pre-keys table - frequently accessed, lightweight
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS \`${tablePrefix}_prekeys\` (
            \`session\` VARCHAR(50) NOT NULL,
            \`key_id\` VARCHAR(100) NOT NULL,
            \`key_data\` JSON NOT NULL,
            \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (\`session\`, \`key_id\`),
            INDEX \`idx_session\` (\`session\`),
            INDEX \`idx_key_id\` (\`key_id\`),
            INDEX \`idx_session_key\` (\`session\`, \`key_id\`)
        ) ENGINE=InnoDB 
        CHARACTER SET utf8mb4 
        COLLATE utf8mb4_unicode_ci
        ROW_FORMAT=COMPRESSED
        KEY_BLOCK_SIZE=8
    `)

    // 3. Sessions table - heavy data, separate from device boot process
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS \`${tablePrefix}_sessions\` (
            \`session\` VARCHAR(50) NOT NULL,
            \`session_id\` VARCHAR(100) NOT NULL,
            \`session_data\` LONGBLOB NOT NULL,
            \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (\`session\`, \`session_id\`),
            INDEX \`idx_session\` (\`session\`),
            INDEX \`idx_session_id\` (\`session_id\`),
            INDEX \`idx_updated_at\` (\`updated_at\`)
        ) ENGINE=InnoDB 
        CHARACTER SET utf8mb4 
        COLLATE utf8mb4_unicode_ci
        ROW_FORMAT=COMPRESSED
        KEY_BLOCK_SIZE=8
    `)

    // 4. Sender keys table - separate for better indexing
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS \`${tablePrefix}_sender_keys\` (
            \`session\` VARCHAR(50) NOT NULL,
            \`sender_id\` VARCHAR(100) NOT NULL,
            \`key_data\` BLOB NOT NULL,
            \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (\`session\`, \`sender_id\`),
            INDEX \`idx_session\` (\`session\`),
            INDEX \`idx_sender_id\` (\`sender_id\`),
            INDEX \`idx_updated_at\` (\`updated_at\`)
        ) ENGINE=InnoDB 
        CHARACTER SET utf8mb4 
        COLLATE utf8mb4_unicode_ci
        ROW_FORMAT=COMPRESSED
        KEY_BLOCK_SIZE=8
    `)

    // 5. App state sync keys table
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS \`${tablePrefix}_app_state_keys\` (
            \`session\` VARCHAR(50) NOT NULL,
            \`key_id\` VARCHAR(100) NOT NULL,
            \`key_data\` JSON NOT NULL,
            \`version_data\` JSON DEFAULT NULL,
            \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (\`session\`, \`key_id\`),
            INDEX \`idx_session\` (\`session\`),
            INDEX \`idx_key_id\` (\`key_id\`),
            INDEX \`idx_updated_at\` (\`updated_at\`)
        ) ENGINE=InnoDB 
        CHARACTER SET utf8mb4 
        COLLATE utf8mb4_unicode_ci
        ROW_FORMAT=COMPRESSED
        KEY_BLOCK_SIZE=8
    `)

    // 6. Sender key memory table - for tracking group message states
    await conn.execute(`
        CREATE TABLE IF NOT EXISTS \`${tablePrefix}_sender_key_memory\` (
            \`session\` VARCHAR(50) NOT NULL,
            \`jid\` VARCHAR(100) NOT NULL,
            \`status\` BOOLEAN NOT NULL DEFAULT FALSE,
            \`created_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (\`session\`, \`jid\`),
            INDEX \`idx_session\` (\`session\`),
            INDEX \`idx_jid\` (\`jid\`),
            INDEX \`idx_status\` (\`status\`),
            INDEX \`idx_session_status\` (\`session\`, \`status\`)
        ) ENGINE=InnoDB 
        CHARACTER SET utf8mb4 
        COLLATE utf8mb4_unicode_ci
        ROW_FORMAT=COMPRESSED
        KEY_BLOCK_SIZE=8
    `)
}

export const useOptimizedMySQLAuthState = async(config: OptimizedMySQLConfig): Promise<{ 
    state: AuthenticationState, 
    saveCreds: () => Promise<void>, 
    clear: () => Promise<void>, 
    removeCreds: () => Promise<void>,
    clearSenderKeyMemory: () => Promise<sqlData>,
    getStats: () => Promise<{
        deviceCount: number,
        sessionCount: number,
        preKeyCount: number,
        senderKeyCount: number,
        appStateKeyCount: number,
        memoryUsage: any
    }>
}> => {
    // Set default optimizations
    const optimizedConfig: OptimizedMySQLConfig = {
        ...config,
        connectionPooling: config.connectionPooling ?? true,
        maxConnections: config.maxConnections ?? 50,
        enableQueryCache: config.enableQueryCache ?? true,
        enableInnoDBOptimizations: config.enableInnoDBOptimizations ?? true,
        tableName: config.tableName || 'baileys'
    }

    const sqlConn = await optimizedConnection(optimizedConfig)
    const tablePrefix = optimizedConfig.tableName!
    const retryRequestDelayMs = optimizedConfig.retryRequestDelayMs || 200
    const maxtRetries = optimizedConfig.maxtRetries || 10

    // Optimized query function with prepared statements and connection reuse
    const query = async (sql: string, values: any[] = []) => {
        for (let x = 0; x < maxtRetries; x++){
            try {
                const [rows] = await sqlConn.execute(sql, values)
                return rows as sqlData
            } catch(e){
                console.warn(`Query attempt ${x + 1} failed:`, e)
                if (x === maxtRetries - 1) {
                    // Try to reconnect on final attempt
                    try {
                        const newConn = await optimizedConnection(optimizedConfig, true)
                        const [rows] = await newConn.execute(sql, values)
                        return rows as sqlData
                    } catch (reconnectError) {
                        console.error('Failed to reconnect and retry query:', reconnectError)
                        throw e
                    }
                }
                await new Promise(r => setTimeout(r, retryRequestDelayMs))
            }
        }
        return [] as sqlData
    }

    // Fast device credential loading (only essential data)
    const readDeviceData = async (): Promise<AuthenticationCreds | null> => {
        const data = await query(
            `SELECT creds FROM ${tablePrefix}_devices WHERE session = ? LIMIT 1`,
            [optimizedConfig.session]
        )
        if (!data[0]?.creds) return null
        
        const creds = typeof data[0].creds === 'object' ? JSON.stringify(data[0].creds) : data[0].creds
        return JSON.parse(creds, BufferJSON.reviver)
    }

    // Fast device credential saving
    const writeDeviceData = async (creds: AuthenticationCreds) => {
        const credsFixed = JSON.stringify(creds, BufferJSON.replacer)
        await query(
            `INSERT INTO ${tablePrefix}_devices (session, device_id, creds) 
             VALUES (?, ?, ?) 
             ON DUPLICATE KEY UPDATE creds = ?, updated_at = CURRENT_TIMESTAMP`,
            [optimizedConfig.session, creds.deviceId || 'default', credsFixed, credsFixed]
        )
    }

    // Optimized data reading by type with specific table targeting
    const readDataByType = async (type: keyof SignalDataTypeMap, id: string) => {
        let tableName: string
        let query_sql: string
        let values: any[]

        switch (type) {
            case 'pre-key':
                tableName = `${tablePrefix}_prekeys`
                query_sql = `SELECT key_data FROM ${tableName} WHERE session = ? AND key_id = ? LIMIT 1`
                values = [optimizedConfig.session, id]
                break
            case 'session':
                tableName = `${tablePrefix}_sessions`
                query_sql = `SELECT session_data FROM ${tableName} WHERE session = ? AND session_id = ? LIMIT 1`
                values = [optimizedConfig.session, id]
                break
            case 'sender-key':
                tableName = `${tablePrefix}_sender_keys`
                query_sql = `SELECT key_data FROM ${tableName} WHERE session = ? AND sender_id = ? LIMIT 1`
                values = [optimizedConfig.session, id]
                break
            case 'app-state-sync-key':
                tableName = `${tablePrefix}_app_state_keys`
                query_sql = `SELECT key_data FROM ${tableName} WHERE session = ? AND key_id = ? LIMIT 1`
                values = [optimizedConfig.session, id]
                break
            case 'app-state-sync-version':
                tableName = `${tablePrefix}_app_state_keys`
                query_sql = `SELECT version_data FROM ${tableName} WHERE session = ? AND key_id = ? LIMIT 1`
                values = [optimizedConfig.session, id]
                break
            case 'sender-key-memory':
                tableName = `${tablePrefix}_sender_key_memory`
                query_sql = `SELECT jid, status FROM ${tableName} WHERE session = ? AND jid = ? LIMIT 1`
                values = [optimizedConfig.session, id]
                break
            default:
                return null
        }

        const data = await query(query_sql, values)
        if (!data[0]) return null

        if (type === 'sender-key-memory') {
            return { [data[0].jid]: data[0].status }
        }

        const column = type === 'session' ? 'session_data' : 
                      type === 'app-state-sync-version' ? 'version_data' : 'key_data'
        
        const value = data[0][column]
        if (!value) return null

        if (type === 'session' || type === 'sender-key') {
            return Buffer.from(value)
        }

        const parsed = typeof value === 'object' ? JSON.stringify(value) : value
        const result = JSON.parse(parsed, BufferJSON.reviver)
        
        if (type === 'app-state-sync-key') {
            return fromObject(result)
        }

        return result
    }

    // Optimized batch data reading
    const readBatchData = async (type: keyof SignalDataTypeMap, ids: string[]) => {
        if (ids.length === 0) return {}

        const data: { [id: string]: SignalDataTypeMap[typeof type] } = {}
        
        // Use batch queries for better performance
        let tableName: string
        let query_sql: string
        let idColumn: string
        let dataColumn: string

        switch (type) {
            case 'pre-key':
                tableName = `${tablePrefix}_prekeys`
                idColumn = 'key_id'
                dataColumn = 'key_data'
                break
            case 'session':
                tableName = `${tablePrefix}_sessions`
                idColumn = 'session_id'
                dataColumn = 'session_data'
                break
            case 'sender-key':
                tableName = `${tablePrefix}_sender_keys`
                idColumn = 'sender_id'
                dataColumn = 'key_data'
                break
            case 'app-state-sync-key':
                tableName = `${tablePrefix}_app_state_keys`
                idColumn = 'key_id'
                dataColumn = 'key_data'
                break
            case 'app-state-sync-version':
                tableName = `${tablePrefix}_app_state_keys`
                idColumn = 'key_id'
                dataColumn = 'version_data'
                break
            case 'sender-key-memory':
                tableName = `${tablePrefix}_sender_key_memory`
                idColumn = 'jid'
                dataColumn = 'status'
                break
            default:
                return data
        }

        // Batch query with IN clause for better performance
        const placeholders = ids.map(() => '?').join(',')
        query_sql = `SELECT ${idColumn}, ${dataColumn} FROM ${tableName} WHERE session = ? AND ${idColumn} IN (${placeholders})`
        
        const results = await query(query_sql, [optimizedConfig.session, ...ids])

        for (const row of results as any[]) {
            const id = row[idColumn]
            const value = row[dataColumn]
            
            if (!value) continue

            if (type === 'sender-key-memory') {
                data[id] = { [id]: value } as any
                continue
            }

            if (type === 'session' || type === 'sender-key') {
                data[id] = Buffer.from(value) as any
                continue
            }

            const parsed = typeof value === 'object' ? JSON.stringify(value) : value
            let result = JSON.parse(parsed, BufferJSON.reviver)
            
            if (type === 'app-state-sync-key') {
                result = fromObject(result)
            }
            
            data[id] = result
        }

        return data
    }

    // Optimized data writing by type
    const writeDataByType = async (type: keyof SignalDataTypeMap, id: string, value: any) => {
        if (!value) {
            return removeDataByType(type, id)
        }

        let tableName: string
        let query_sql: string
        let values: any[]

        const processedValue = (type === 'session' || type === 'sender-key') 
            ? value 
            : JSON.stringify(value, BufferJSON.replacer)

        switch (type) {
            case 'pre-key':
                tableName = `${tablePrefix}_prekeys`
                query_sql = `INSERT INTO ${tableName} (session, key_id, key_data) 
                           VALUES (?, ?, ?) 
                           ON DUPLICATE KEY UPDATE key_data = ?`
                values = [optimizedConfig.session, id, processedValue, processedValue]
                break
            case 'session':
                tableName = `${tablePrefix}_sessions`
                query_sql = `INSERT INTO ${tableName} (session, session_id, session_data) 
                           VALUES (?, ?, ?) 
                           ON DUPLICATE KEY UPDATE session_data = ?, updated_at = CURRENT_TIMESTAMP`
                values = [optimizedConfig.session, id, processedValue, processedValue]
                break
            case 'sender-key':
                tableName = `${tablePrefix}_sender_keys`
                query_sql = `INSERT INTO ${tableName} (session, sender_id, key_data) 
                           VALUES (?, ?, ?) 
                           ON DUPLICATE KEY UPDATE key_data = ?, updated_at = CURRENT_TIMESTAMP`
                values = [optimizedConfig.session, id, processedValue, processedValue]
                break
            case 'app-state-sync-key':
                tableName = `${tablePrefix}_app_state_keys`
                query_sql = `INSERT INTO ${tableName} (session, key_id, key_data) 
                           VALUES (?, ?, ?) 
                           ON DUPLICATE KEY UPDATE key_data = ?, updated_at = CURRENT_TIMESTAMP`
                values = [optimizedConfig.session, id, processedValue, processedValue]
                break
            case 'app-state-sync-version':
                tableName = `${tablePrefix}_app_state_keys`
                query_sql = `INSERT INTO ${tableName} (session, key_id, version_data) 
                           VALUES (?, ?, ?) 
                           ON DUPLICATE KEY UPDATE version_data = ?, updated_at = CURRENT_TIMESTAMP`
                values = [optimizedConfig.session, id, processedValue, processedValue]
                break
            case 'sender-key-memory':
                tableName = `${tablePrefix}_sender_key_memory`
                const status = Object.values(value)[0] as boolean
                query_sql = `INSERT INTO ${tableName} (session, jid, status) 
                           VALUES (?, ?, ?) 
                           ON DUPLICATE KEY UPDATE status = ?, updated_at = CURRENT_TIMESTAMP`
                values = [optimizedConfig.session, id, status, status]
                break
            default:
                return
        }

        await query(query_sql, values)
    }

    // Optimized data removal by type
    const removeDataByType = async (type: keyof SignalDataTypeMap, id: string) => {
        let tableName: string
        let idColumn: string

        switch (type) {
            case 'pre-key':
                tableName = `${tablePrefix}_prekeys`
                idColumn = 'key_id'
                break
            case 'session':
                tableName = `${tablePrefix}_sessions`
                idColumn = 'session_id'
                break
            case 'sender-key':
                tableName = `${tablePrefix}_sender_keys`
                idColumn = 'sender_id'
                break
            case 'app-state-sync-key':
            case 'app-state-sync-version':
                tableName = `${tablePrefix}_app_state_keys`
                idColumn = 'key_id'
                break
            case 'sender-key-memory':
                tableName = `${tablePrefix}_sender_key_memory`
                idColumn = 'jid'
                break
            default:
                return
        }

        await query(
            `DELETE FROM ${tableName} WHERE session = ? AND ${idColumn} = ?`,
            [optimizedConfig.session, id]
        )
    }

    // Clear all data except device credentials
    const clearAll = async () => {
        const tables = ['prekeys', 'sessions', 'sender_keys', 'app_state_keys', 'sender_key_memory']
        const promises = tables.map(table => 
            query(`DELETE FROM ${tablePrefix}_${table} WHERE session = ?`, [optimizedConfig.session])
        )
        await Promise.all(promises)
    }

    // Remove all data including device credentials
    const removeAll = async () => {
        const tables = ['devices', 'prekeys', 'sessions', 'sender_keys', 'app_state_keys', 'sender_key_memory']
        const promises = tables.map(table => 
            query(`DELETE FROM ${tablePrefix}_${table} WHERE session = ?`, [optimizedConfig.session])
        )
        await Promise.all(promises)
    }

    // Clear sender key memory with optimized query
    const clearSenderKeyMemory = async () => {
        const result = await query(
            `DELETE FROM ${tablePrefix}_sender_key_memory WHERE session = ?`,
            [optimizedConfig.session]
        )
        console.log(`Cleared ${result.affectedRows || 0} sender key memory entries`)
        return result
    }

    // Get performance statistics
    const getStats = async () => {
        const statsQueries = [
            query(`SELECT COUNT(*) as count FROM ${tablePrefix}_devices WHERE session = ?`, [optimizedConfig.session]),
            query(`SELECT COUNT(*) as count FROM ${tablePrefix}_sessions WHERE session = ?`, [optimizedConfig.session]),
            query(`SELECT COUNT(*) as count FROM ${tablePrefix}_prekeys WHERE session = ?`, [optimizedConfig.session]),
            query(`SELECT COUNT(*) as count FROM ${tablePrefix}_sender_keys WHERE session = ?`, [optimizedConfig.session]),
            query(`SELECT COUNT(*) as count FROM ${tablePrefix}_app_state_keys WHERE session = ?`, [optimizedConfig.session])
        ]

        const [deviceStats, sessionStats, preKeyStats, senderKeyStats, appStateStats] = await Promise.all(statsQueries)

        return {
            deviceCount: deviceStats[0]?.count || 0,
            sessionCount: sessionStats[0]?.count || 0,
            preKeyCount: preKeyStats[0]?.count || 0,
            senderKeyCount: senderKeyStats[0]?.count || 0,
            appStateKeyCount: appStateStats[0]?.count || 0,
            memoryUsage: process.memoryUsage()
        }
    }

    // Load device credentials (fast boot)
    const creds: AuthenticationCreds = await readDeviceData() || initAuthCreds()

    return {
        state: {
            creds: creds,
            keys: {
                get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
                    // Use batch reading for better performance
                    return await readBatchData(type, ids) as { [id: string]: SignalDataTypeMap[T] }
                },
                set: async (data) => {
                    // Batch write operations for better performance
                    const writePromises: Promise<void>[] = []
                    
                    for (const category in data) {
                        for (const id in data[category]) {
                            const value = data[category][id]
                            writePromises.push(
                                writeDataByType(category as keyof SignalDataTypeMap, id, value)
                            )
                        }
                    }
                    
                    await Promise.all(writePromises)
                }
            }
        },
        saveCreds: async () => {
            await writeDeviceData(creds)
        },
        clear: clearAll,
        removeCreds: removeAll,
        clearSenderKeyMemory,
        getStats
    }
}
