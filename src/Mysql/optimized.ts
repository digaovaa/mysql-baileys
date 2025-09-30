import { createConnection } from 'mysql2/promise'
import { BufferJSON, initAuthCreds, fromObject } from '../Utils'
import { MySQLConfig, sqlData, sqlConnection, AuthenticationCreds, AuthenticationState, SignalDataTypeMap, SignalDataSet } from '../Types'

/**
 * MYSQL-BAILEYS OTIMIZADO COM SCHEMA NORMALIZADO
 * 
 * Implementação otimizada com separação de dados por tipo:
 * - devices: dados essenciais para boot rápido
 * - sender_keys, sessions, pre_keys: dados carregados sob demanda
 * - Cache inteligente e consultas otimizadas
 * 
 * Performance esperada:
 * - Boot instantâneo (< 1s para 200+ devices)
 * - Consultas específicas em < 0.01s
 * - Uso eficiente do InnoDB buffer pool
 */

let conn: sqlConnection

// Cache em memória para dados frequentemente acessados
const deviceCache = new Map<string, any>()
const keyCache = new Map<string, any>()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutos

interface CacheEntry {
    data: any
    timestamp: number
}

async function connection(config: MySQLConfig, force: boolean = false) {
    const ended = !!conn?.connection?._closing
    const newConnection = conn === undefined

    if (newConnection || ended || force) {
        conn = await createConnection({
            database: config.database || 'base',
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
            timezone: '+00:00', // UTC timezone
            charset: 'utf8mb4'
        })

        if (newConnection) {
            // Criar schema otimizado se não existir
            await createOptimizedSchema(config)
        }
    }

    return conn
}

async function createOptimizedSchema(config: MySQLConfig) {
    const tableName = config.tableName || 'auth'
    
    try {
        // 1. Criar tabela legacy se não existir (compatibilidade)
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS \`${tableName}\` (
                \`session\` varchar(50) NOT NULL, 
                \`id\` varchar(80) NOT NULL, 
                \`value\` json DEFAULT NULL, 
                UNIQUE KEY \`idxunique\` (\`session\`,\`id\`), 
                KEY \`idxsession\` (\`session\`), 
                KEY \`idxid\` (\`id\`)
            ) ENGINE=MyISAM DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `)

        // 2. Criar tabelas otimizadas
        await conn.execute(`
            CREATE TABLE IF NOT EXISTS devices (
                id INT PRIMARY KEY AUTO_INCREMENT,
                whatsapp_id VARCHAR(255) UNIQUE NOT NULL,
                session VARCHAR(50) NOT NULL,
                
                -- Noise Key
                noise_key_public BLOB,
                noise_key_private BLOB,
                
                -- Pairing Keys
                pairing_ephemeral_key_pair_public BLOB,
                pairing_ephemeral_key_pair_private BLOB,
                
                -- Identity Keys
                signed_identity_key_public BLOB,
                signed_identity_key_private BLOB,
                
                -- Pre-Key
                signed_pre_key_public BLOB,
                signed_pre_key_private BLOB,
                signed_pre_key_signature BLOB,
                signed_pre_key_id INT,
                
                -- Authentication Info
                registration_id INT,
                adv_secret_key TEXT,
                processed_history_messages TEXT,
                next_pre_key_id INT,
                first_unuploaded_pre_key_id INT,
                account_sync_counter INT,
                account_settings TEXT,
                pairing_code VARCHAR(255),
                last_prop_hash VARCHAR(255),
                routing_info BLOB,
                
                -- Contact Info
                jid VARCHAR(255),
                lid VARCHAR(255),
                name VARCHAR(255),
                
                -- Account Info
                account_details BLOB,
                account_signature_key BLOB,
                account_signature BLOB,
                account_device_signature BLOB,
                signal_identities TEXT,
                
                -- Device Info
                platform VARCHAR(100),
                device_id VARCHAR(255),
                phone_id VARCHAR(255),
                identity_id BLOB,
                registered BOOLEAN DEFAULT FALSE,
                backup_token BLOB,
                registration_options TEXT,
                
                -- Timestamps
                last_account_sync_timestamp BIGINT,
                my_app_state_key_id VARCHAR(255),
                status INT DEFAULT 1,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                
                INDEX idx_whatsapp_id (whatsapp_id),
                INDEX idx_session (session),
                INDEX idx_session_status (session, status),
                INDEX idx_jid (jid)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
        `)
      await conn.execute(`
        CREATE TABLE IF NOT EXISTS messages (
        id INT PRIMARY KEY AUTO_INCREMENT,
        wid VARCHAR(255) NOT NULL,
        remote_jid VARCHAR(255) NOT NULL,
        from_me BOOLEAN NOT NULL,
        timestamp BIGINT NOT NULL,
        push_name VARCHAR(255),
        message JSON,
        message_type VARCHAR(100),
        device_id INT NOT NULL,
        session VARCHAR(50) NOT NULL,
        key_unique VARCHAR(255) UNIQUE,
        participant VARCHAR(255),
        status INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,        
        INDEX idx_remote_jid_timestamp (remote_jid, timestamp),
        INDEX idx_device_id (device_id),
        INDEX idx_session (session),
        INDEX idx_timestamp (timestamp),
        FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`)

    await conn.execute(`
    CREATE TABLE IF NOT EXISTS chats (
    id VARCHAR(255) NOT NULL,
    device_id INT NOT NULL,
    session VARCHAR(50) NOT NULL,
    name VARCHAR(255),
    conversation_timestamp BIGINT,
    unread_count INT DEFAULT 0,
    archived BOOLEAN DEFAULT FALSE,
    pinned BOOLEAN DEFAULT FALSE,
    mute_end_time BIGINT,
    ephemeral_expiration INT,
    ephemeral_setting_timestamp BIGINT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    PRIMARY KEY (id, device_id),
    INDEX idx_device_id (device_id),
    INDEX idx_session (session),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`)

    await conn.execute(`
    CREATE TABLE IF NOT EXISTS contacts (
    id VARCHAR(255) NOT NULL,
    device_id INT NOT NULL,
    session VARCHAR(50) NOT NULL,
    name VARCHAR(255),
    notify VARCHAR(255),
    verified_name VARCHAR(255),
    img_url TEXT,
    lid VARCHAR(255),
    status TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    PRIMARY KEY (id, device_id),
    INDEX idx_device_id (device_id),
    INDEX idx_session (session),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`)

        // Criar tabelas de dados sob demanda
        const keyTables = [
            'sender_keys',
            'sessions', 
            'sender_key_memory',
            'pre_keys',
            'app_state_sync_versions',
            'app_state_sync_keys'
        ]

        for (const table of keyTables) {
            await conn.execute(`
                CREATE TABLE IF NOT EXISTS ${table} (
                    key_id VARCHAR(255) NOT NULL,
                    value LONGTEXT NOT NULL,
                    device_id INT NOT NULL,
                    session VARCHAR(50) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    
                    PRIMARY KEY (key_id, device_id),
                    INDEX idx_device_id (device_id),
                    INDEX idx_session (session),
                    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
            `)
        }

        // Atualizar tabelas existentes para usar LONGTEXT se necessário
        await updateExistingSchema(keyTables)

        console.log('✅ Schema otimizado criado com sucesso')
    } catch (error) {
        console.warn('⚠️ Erro ao criar schema otimizado, usando fallback:', error.message)
    }
}

async function updateExistingSchema(keyTables: string[]) {
    try {
        console.log('🔧 Verificando e atualizando schema existente...')
        
        for (const table of keyTables) {
            try {
                // Verificar se a tabela existe e tem coluna TEXT
                const [columns] = await conn.query(`
                    SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH 
                    FROM INFORMATION_SCHEMA.COLUMNS 
                    WHERE TABLE_SCHEMA = DATABASE() 
                    AND TABLE_NAME = ? 
                    AND COLUMN_NAME = 'value'
                `, [table]) as any[]

                if (columns[0] && columns[0].DATA_TYPE === 'text') {
                    console.log(`📝 Atualizando ${table}.value de TEXT para LONGTEXT...`)
                    
                    // Atualizar a coluna para LONGTEXT
                    await conn.execute(`
                        ALTER TABLE ${table} 
                        MODIFY COLUMN value LONGTEXT NOT NULL
                    `)
                    
                    console.log(`✅ ${table} atualizado com sucesso`)
                }
            } catch (error) {
                console.warn(`⚠️ Erro ao atualizar tabela ${table}:`, error.message)
            }
        }
    } catch (error) {
        console.warn('⚠️ Erro ao verificar schema existente:', error.message)
    }
}

export const useMySQLAuthStateOptimized = async(config: MySQLConfig): Promise<{
    state: AuthenticationState,
    saveCreds: () => Promise<void>,
    clear: () => Promise<void>,
    removeCreds: () => Promise<void>,
    clearSenderKeyMemory: () => Promise<sqlData>,
    migrateFromLegacy: () => Promise<void>,
    getPerformanceStats: () => Promise<any>,
    diagnoseSchema: () => Promise<{ issues: string[] }>
}> => {
    const sqlConn = await connection(config)
    const tableName = config.tableName || 'auth'
    const retryRequestDelayMs = config.retryRequestDelayMs || 200
    const maxtRetries = config.maxtRetries || 10

    let deviceId: number | null = null
    let performanceStats = {
        bootTime: 0,
        cacheHits: 0,
        cacheMisses: 0,
        queriesExecuted: 0
    }

    const query = async (sql: string, values: any[] = []) => {
        performanceStats.queriesExecuted++
        for (let x = 0; x < maxtRetries; x++) {
            try {
                const [rows] = await sqlConn.query(sql, values)
                return rows as sqlData
            } catch(e) {
                console.warn(`Query failed (attempt ${x + 1}):`, e.message)
                await new Promise(r => setTimeout(r, retryRequestDelayMs))
            }
        }
        throw new Error(`Query failed after ${maxtRetries} attempts: ${sql}`)
    }

    // ========================================
    // FUNÇÕES DE CACHE
    // ========================================

    const getCacheKey = (type: string, id: string) => `${type}-${id}-${config.session}`

    const getFromCache = (key: string): any => {
        const entry = keyCache.get(key) as CacheEntry
        if (entry && (Date.now() - entry.timestamp) < CACHE_TTL) {
            performanceStats.cacheHits++
            return entry.data
        }
        performanceStats.cacheMisses++
        return null
    }

    const setCache = (key: string, data: any) => {
        keyCache.set(key, {
            data,
            timestamp: Date.now()
        })
    }

    const clearCache = () => {
        keyCache.clear()
        deviceCache.clear()
    }

    // ========================================
    // FUNÇÕES OTIMIZADAS DE DADOS
    // ========================================

    const getDeviceId = async (): Promise<number> => {
        if (deviceId !== null) return deviceId

        try {
            const result = await query(
                'SELECT id FROM devices WHERE session = ? AND status = 1 LIMIT 1',
                [config.session]
            ) as any[]
            
            if (result[0]?.id) {
                deviceId = result[0].id
                return deviceId as number
            }
        } catch (error) {
            console.warn('Erro ao buscar device_id, usando fallback')
        }

        // Fallback: criar ou usar device_id = 1
        deviceId = 1
        return deviceId
    }

    const readDeviceData = async (): Promise<AuthenticationCreds | null> => {
        const cacheKey = `device-${config.session}`
        const cached = deviceCache.get(cacheKey)
        if (cached) {
            performanceStats.cacheHits++
            return cached
        }

        try {
            // Primeiro tenta ler das tabelas otimizadas
            const result = await query(`
                SELECT 
                    id, whatsapp_id, session,
                    noise_key_public, noise_key_private,
                    pairing_ephemeral_key_pair_public, pairing_ephemeral_key_pair_private,
                    signed_identity_key_public, signed_identity_key_private,
                    signed_pre_key_public, signed_pre_key_private, signed_pre_key_signature, signed_pre_key_id,
                    registration_id, adv_secret_key, processed_history_messages,
                    next_pre_key_id, first_unuploaded_pre_key_id, account_sync_counter,
                    account_settings, pairing_code, last_prop_hash, routing_info,
                    jid, lid, name,
                    account_details, account_signature_key, account_signature, account_device_signature,
                    signal_identities, platform, device_id, phone_id, identity_id,
                    registered, backup_token, registration_options,
                    last_account_sync_timestamp, my_app_state_key_id
                FROM devices 
                WHERE session = ? AND status = 1 
                LIMIT 1
            `, [config.session]) as any[]

            if (result[0]) {
                deviceId = result[0].id
                const device = result[0]
                
                // Converter dados do banco para formato AuthenticationCreds
                // CRITICAL: Use Buffer.from() para garantir compatibilidade com libsignal
                const creds = {
                    noiseKey: {
                        public: device.noise_key_public ? Buffer.from(device.noise_key_public) : undefined,
                        private: device.noise_key_private ? Buffer.from(device.noise_key_private) : undefined
                    },
                    pairingEphemeralKeyPair: {
                        public: device.pairing_ephemeral_key_pair_public ? Buffer.from(device.pairing_ephemeral_key_pair_public) : undefined,
                        private: device.pairing_ephemeral_key_pair_private ? Buffer.from(device.pairing_ephemeral_key_pair_private) : undefined
                    },
                    signedIdentityKey: {
                        public: device.signed_identity_key_public ? Buffer.from(device.signed_identity_key_public) : undefined,
                        private: device.signed_identity_key_private ? Buffer.from(device.signed_identity_key_private) : undefined
                    },
                    signedPreKey: {
                        keyPair: {
                            public: device.signed_pre_key_public ? Buffer.from(device.signed_pre_key_public) : undefined,
                            private: device.signed_pre_key_private ? Buffer.from(device.signed_pre_key_private) : undefined
                        },
                        signature: device.signed_pre_key_signature ? Buffer.from(device.signed_pre_key_signature) : undefined,
                        keyId: device.signed_pre_key_id
                    },
                    registrationId: device.registration_id,
                    advSecretKey: device.adv_secret_key,
                    processedHistoryMessages: device.processed_history_messages ? JSON.parse(device.processed_history_messages) : [],
                    nextPreKeyId: device.next_pre_key_id,
                    firstUnuploadedPreKeyId: device.first_unuploaded_pre_key_id,
                    accountSyncCounter: device.account_sync_counter,
                    accountSettings: device.account_settings ? JSON.parse(device.account_settings) : {},
                    pairingCode: device.pairing_code,
                    lastPropHash: device.last_prop_hash,
                    routingInfo: device.routing_info ? Buffer.from(device.routing_info) : undefined,
                    me: device.jid ? {
                        id: device.jid,
                        lid: device.lid,
                        name: device.name
                    } : undefined,
                    account: {
                        details: device.account_details ? Buffer.from(device.account_details) : undefined,
                        accountSignatureKey: device.account_signature_key ? Buffer.from(device.account_signature_key) : undefined,
                        accountSignature: device.account_signature ? Buffer.from(device.account_signature) : undefined,
                        deviceSignature: device.account_device_signature ? Buffer.from(device.account_device_signature) : undefined
                    },
                    signalIdentities: device.signal_identities ? JSON.parse(device.signal_identities) : [],
                    platform: device.platform,
                    deviceId: device.device_id,
                    phoneId: device.phone_id,
                    identityId: device.identity_id ? Buffer.from(device.identity_id) : undefined,
                    registered: device.registered,
                    backupToken: device.backup_token ? Buffer.from(device.backup_token) : undefined,
                    registration: device.registration_options ? JSON.parse(device.registration_options) : {},
                    lastAccountSyncTimestamp: device.last_account_sync_timestamp,
                    myAppStateKeyId: device.my_app_state_key_id
                }

                deviceCache.set(cacheKey, creds)
                return creds as AuthenticationCreds
            }
        } catch (error) {
            console.warn('Erro ao ler dados otimizados, tentando fallback:', error.message)
        }

        // Fallback para tabela legacy
        return await readLegacyData('creds')
    }

    const readLegacyData = async (id: string) => {
        try {
            const data = await query(`SELECT value FROM ${tableName} WHERE id = ? AND session = ?`, [id, config.session])
            if (!data[0]?.value) {
                return null
            }
            const creds = typeof data[0].value === 'object' ? JSON.stringify(data[0].value) : data[0].value
            const credsParsed = JSON.parse(creds, BufferJSON.reviver)
            return credsParsed
        } catch (error) {
            console.warn('Erro ao ler dados legacy:', error.message)
            return null
        }
    }

    const readKeyData = async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]): Promise<{ [id: string]: SignalDataTypeMap[T] }> => {
        const results: { [id: string]: SignalDataTypeMap[T] } = {}
        const uncachedIds: string[] = []

        // Verificar cache primeiro
        for (const id of ids) {
            const cacheKey = getCacheKey(type, id)
            const cached = getFromCache(cacheKey)
            if (cached !== null) {
                results[id] = cached
            } else {
                uncachedIds.push(id)
            }
        }

        if (uncachedIds.length === 0) {
            return results
        }

        const currentDeviceId = await getDeviceId()
        const tableMap = {
            'sender-key': 'sender_keys',
            'session': 'sessions',
            'sender-key-memory': 'sender_key_memory',
            'pre-key': 'pre_keys',
            'app-state-sync-version': 'app_state_sync_versions',
            'app-state-sync-key': 'app_state_sync_keys'
        }

        const tableName = tableMap[type]

        try {
            if (tableName) {
                // Usar consulta otimizada por lote
                const placeholders = uncachedIds.map(() => '?').join(',')
                const data = await query(`
                    SELECT key_id, value 
                    FROM ${tableName} 
                    WHERE device_id = ? AND key_id IN (${placeholders})
                `, [currentDeviceId, ...uncachedIds]) as any[]

                for (const row of data) {
                    let value = JSON.parse(row.value, BufferJSON.reviver)
                    if (type === 'app-state-sync-key' && value) {
                        value = fromObject(value)
                    }
                    results[row.key_id] = value as SignalDataTypeMap[T]
                    
                    // Cache o resultado
                    const cacheKey = getCacheKey(type, row.key_id)
                    setCache(cacheKey, value)
                }
            }
        } catch (error) {
            console.warn(`Erro ao ler ${type} otimizado, usando fallback:`, error.message)
            
            // Fallback para tabela legacy
            for (const id of uncachedIds) {
                const legacyData = await readLegacyData(`${type}-${id}`)
                if (legacyData) {
                    let value = legacyData
                    if (type === 'app-state-sync-key' && value) {
                        value = fromObject(value)
                    }
                    results[id] = value as SignalDataTypeMap[T]
                    
                    const cacheKey = getCacheKey(type, id)
                    setCache(cacheKey, value)
                }
            }
        }

        return results
    }

    const writeKeyData = async (data: SignalDataSet) => {
        const currentDeviceId = await getDeviceId()
        
        for (const category in data) {
            const categoryData = data[category as keyof SignalDataTypeMap]
            if (!categoryData) continue

            const tableMap = {
                'sender-key': 'sender_keys',
                'session': 'sessions',
                'sender-key-memory': 'sender_key_memory',
                'pre-key': 'pre_keys',
                'app-state-sync-version': 'app_state_sync_versions',
                'app-state-sync-key': 'app_state_sync_keys'
            }

            const tableName = tableMap[category as keyof typeof tableMap]
            
            for (const id in categoryData) {
                const value = categoryData[id]
                const cacheKey = getCacheKey(category, id)
                
                if (value) {
                    const valueStr = JSON.stringify(value, BufferJSON.replacer)
                    
                    try {
                        if (tableName) {
                            await query(`
                                INSERT INTO ${tableName} (key_id, value, device_id, session) 
                                VALUES (?, ?, ?, ?) 
                                ON DUPLICATE KEY UPDATE value = VALUES(value)
                            `, [id, valueStr, currentDeviceId, config.session])
                        }
                        
                        // Atualizar cache
                        setCache(cacheKey, value)
                    } catch (error) {
                        console.warn(`Erro ao escrever ${category} otimizado, usando fallback:`, error.message)
                        
                        // Fallback para tabela legacy
                        await writeLegacyData(`${category}-${id}`, value)
                    }
                } else {
                    // Remover dados
                    try {
                        if (tableName) {
                            await query(`
                                DELETE FROM ${tableName} 
                                WHERE key_id = ? AND device_id = ?
                            `, [id, currentDeviceId])
                        }
                        
                        // Remover do cache
                        keyCache.delete(cacheKey)
                    } catch (error) {
                        console.warn(`Erro ao remover ${category} otimizado, usando fallback:`, error.message)
                        await removeLegacyData(`${category}-${id}`)
                    }
                }
            }
        }
    }

    const writeLegacyData = async (id: string, value: object) => {
        const valueFixed = JSON.stringify(value, BufferJSON.replacer)
        await query(`INSERT INTO ${tableName} (session, id, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?`, 
            [config.session, id, valueFixed, valueFixed])
    }

    const removeLegacyData = async (id: string) => {
        await query(`DELETE FROM ${tableName} WHERE id = ? AND session = ?`, [id, config.session])
    }

    const clearAll = async () => {
        const currentDeviceId = await getDeviceId()
        
        try {
            // Limpar tabelas otimizadas
            const keyTables = ['sender_keys', 'sessions', 'sender_key_memory', 'pre_keys', 'app_state_sync_versions', 'app_state_sync_keys']
            
            for (const table of keyTables) {
                await query(`DELETE FROM ${table} WHERE device_id = ?`, [currentDeviceId])
            }
        } catch (error) {
            console.warn('Erro ao limpar dados otimizados, usando fallback:', error.message)
            // Fallback
            await query(`DELETE FROM ${tableName} WHERE id != 'creds' AND session = ?`, [config.session])
        }
        
        clearCache()
    }

    const removeAll = async () => {
        try {
            const currentDeviceId = await getDeviceId()
            
            // Limpar TODAS as tabelas relacionadas ao device ID de forma explícita
            const keyTables = [
                'sender_keys',
                'sessions', 
                'sender_key_memory',
                'pre_keys',
                'app_state_sync_versions',
                'app_state_sync_keys'
            ]

            // Remover dados de todas as tabelas de chaves primeiro
            for (const table of keyTables) {
                try {
                    const result = await query(`DELETE FROM ${table} WHERE device_id = ?`, [currentDeviceId])
                   
                } catch (error) {
                    console.warn(`Erro ao limpar tabela ${table}:`, error.message)
                }
            }

            // Remover device (isso também remove via CASCADE, mas já limpamos explicitamente acima)
            const deviceResult = await query(`DELETE FROM devices WHERE session = ?`, [config.session])
           
        } catch (error) {
            console.warn('Erro ao remover dados otimizados, usando fallback:', error.message)
            
            // Fallback mais robusto - limpar TUDO da tabela legacy
            try {
                const result = await query(`DELETE FROM ${tableName} WHERE session = ?`, [config.session])
          
            } catch (fallbackError) {
                console.error('Erro ao limpar tabela legacy:', fallbackError.message)
                throw fallbackError
            }
        }
        
        // Limpar TODOS os caches relacionados
        clearCache()
        deviceCache.delete(`device-${config.session}`)
        
        // Reset do device ID
        deviceId = null
        
        
    }

    const clearSenderKeyMemory = async (): Promise<sqlData> => {
        const currentDeviceId = await getDeviceId()
        
        try {
            const result = await query(`DELETE FROM sender_key_memory WHERE device_id = ?`, [currentDeviceId])
            
            // Limpar cache relacionado
            for (const [key] of keyCache) {
                if (key.includes('sender-key-memory')) {
                    keyCache.delete(key)
                }
            }
            
            console.log(`Deleted ${result.affectedRows || 0} rows from sender-key-memory`)
            return result
        } catch (error) {
            console.warn('Erro ao limpar sender-key-memory otimizado, usando fallback:', error.message)
            // Fallback
            const result = await query(`DELETE FROM ${tableName} WHERE id LIKE 'sender-key-memory-%' AND session = ?`, [config.session])
            console.log(`Deleted ${result.affectedRows || 0} rows from sender-key-memory (fallback)`)
            return result
        }
    }

    const migrateFromLegacy = async () => {
        console.log('🔄 Iniciando migração dos dados legados...')
        
        try {
            // Definir a tabela legada de origem
            const tableName = config.tableName || 'auth'
            
            // Verificar se já existe dados otimizados
            const existingDevice = await query('SELECT id FROM devices WHERE session = ? LIMIT 1', [config.session])
            if (existingDevice[0]) {
                console.log('✅ Dados já migrados, pulando migração')
                return
            }

            // Migrar credenciais
            const credsData = await readLegacyData('creds')
            if (credsData) {
                await saveDeviceData(credsData)
                console.log('✅ Credenciais migradas')
            }

            // Migrar dados de chaves (em lotes para performance)
            const keyTypes = [
                { type: 'sender-key-memory', table: 'sender_key_memory', prefix: 'sender-key-memory-' },
                { type: 'sender-key', table: 'sender_keys', prefix: 'sender-key-' },
                { type: 'session', table: 'sessions', prefix: 'session-' },
                { type: 'pre-key', table: 'pre_keys', prefix: 'pre-key-' },
                { type: 'app-state-sync-version', table: 'app_state_sync_versions', prefix: 'app-state-sync-version-' },
                { type: 'app-state-sync-key', table: 'app_state_sync_keys', prefix: 'app-state-sync-key-' }
            ]

            const currentDeviceId = await getDeviceId()

            for (const keyType of keyTypes) {
                try {
                    let condition = `id LIKE '${keyType.prefix}%'`
                    if (keyType.type === 'sender-key') {
                        condition += ` AND id NOT LIKE 'sender-key-memory-%'` // Exclusão explícita
                    }
                    if (keyType.type === 'app-state-sync-key') {
                        condition += ` AND id NOT LIKE 'app-state-sync-version-%'` // Exclusão explícita
                    }

                    const legacyKeys = await query(`
                        SELECT id, value FROM ${tableName} 
                        WHERE ${condition} AND session = ?
                    `, [config.session]) as any[]

                    if (legacyKeys.length > 0) {
                        const values = legacyKeys.map(row => {
                            const keyId = row.id.replace(keyType.prefix, '')
                            const value = typeof row.value === 'object' ? JSON.stringify(row.value) : row.value
                            return [keyId, value, currentDeviceId, config.session]
                        })

                        // Inserir em lotes
                        const batchSize = 100
                        for (let i = 0; i < values.length; i += batchSize) {
                            const batch = values.slice(i, i + batchSize)
                            const placeholders = batch.map(() => '(?, ?, ?, ?)').join(',')
                            const flatValues = batch.flat()

                            await query(`
                                INSERT INTO ${keyType.table} (key_id, value, device_id, session) 
                                VALUES ${placeholders}
                                ON DUPLICATE KEY UPDATE value = VALUES(value)
                            `, flatValues)
                        }

                        console.log(`✅ ${keyType.type}: ${legacyKeys.length} chaves migradas`)
                    }
                } catch (error) {
                    console.warn(`⚠️ Erro ao migrar ${keyType.type}:`, error.message)
                }
            }

            console.log('🎉 Migração concluída com sucesso!')
        } catch (error) {
            console.error('❌ Erro durante a migração:', error.message)
            throw error
        }
    }

    const saveDeviceData = async (creds: AuthenticationCreds) => {
        try {
            const deviceData = {
                whatsapp_id: creds.registrationId?.toString() || config.session,
                session: config.session,
                noise_key_public: creds.noiseKey?.public ? Buffer.from(creds.noiseKey.public) : null,
                noise_key_private: creds.noiseKey?.private ? Buffer.from(creds.noiseKey.private) : null,
                pairing_ephemeral_key_pair_public: creds.pairingEphemeralKeyPair?.public ? Buffer.from(creds.pairingEphemeralKeyPair.public) : null,
                pairing_ephemeral_key_pair_private: creds.pairingEphemeralKeyPair?.private ? Buffer.from(creds.pairingEphemeralKeyPair.private) : null,
                signed_identity_key_public: creds.signedIdentityKey?.public ? Buffer.from(creds.signedIdentityKey.public) : null,
                signed_identity_key_private: creds.signedIdentityKey?.private ? Buffer.from(creds.signedIdentityKey.private) : null,
                signed_pre_key_public: creds.signedPreKey?.keyPair?.public ? Buffer.from(creds.signedPreKey.keyPair.public) : null,
                signed_pre_key_private: creds.signedPreKey?.keyPair?.private ? Buffer.from(creds.signedPreKey.keyPair.private) : null,
                signed_pre_key_signature: creds.signedPreKey?.signature ? Buffer.from(creds.signedPreKey.signature) : null,
                signed_pre_key_id: creds.signedPreKey?.keyId || null,
                registration_id: creds.registrationId || null,
                adv_secret_key: creds.advSecretKey || null,
                processed_history_messages: creds.processedHistoryMessages ? JSON.stringify(creds.processedHistoryMessages) : null,
                next_pre_key_id: creds.nextPreKeyId || null,
                first_unuploaded_pre_key_id: creds.firstUnuploadedPreKeyId || null,
                account_sync_counter: creds.accountSyncCounter || null,
                account_settings: creds.accountSettings ? JSON.stringify(creds.accountSettings) : null,
                pairing_code: creds.pairingCode || null,
                last_prop_hash: creds.lastPropHash || null,
                routing_info: creds.routingInfo ? Buffer.from(creds.routingInfo) : null,
                jid: creds.me?.id || null,
                lid: creds.me?.lid || null,
                name: creds.me?.name || null,
                account_details: creds.account?.details ? Buffer.from(creds.account.details) : null,
                account_signature_key: creds.account?.accountSignatureKey ? Buffer.from(creds.account.accountSignatureKey) : null,
                account_signature: creds.account?.accountSignature ? Buffer.from(creds.account.accountSignature) : null,
                account_device_signature: creds.account?.deviceSignature ? Buffer.from(creds.account.deviceSignature) : null,
                signal_identities: creds.signalIdentities ? JSON.stringify(creds.signalIdentities) : null,
                platform: creds.platform || null,
                device_id: creds.deviceId || null,
                phone_id: creds.phoneId || null,
                identity_id: creds.identityId ? Buffer.from(creds.identityId) : null,
                registered: creds.registered || false,
                backup_token: creds.backupToken ? Buffer.from(creds.backupToken) : null,
                registration_options: creds.registration ? JSON.stringify(creds.registration) : null,
                last_account_sync_timestamp: creds.lastAccountSyncTimestamp || null,
                my_app_state_key_id: creds.myAppStateKeyId || null
            }

            const fields = Object.keys(deviceData).join(', ')
            const placeholders = Object.keys(deviceData).map(() => '?').join(', ')
            const updateFields = Object.keys(deviceData).map(field => `${field} = VALUES(${field})`).join(', ')

            await query(`
                INSERT INTO devices (${fields}) 
                VALUES (${placeholders})
                ON DUPLICATE KEY UPDATE ${updateFields}
            `, Object.values(deviceData))

            // Atualizar cache e deviceId
            const result = await query('SELECT id FROM devices WHERE session = ? LIMIT 1', [config.session])
            if (result[0]) {
                deviceId = result[0].id
            }

            deviceCache.delete(`device-${config.session}`)
        } catch (error) {
            console.warn('Erro ao salvar dados otimizados, usando fallback:', error.message)
            // Fallback
            await writeLegacyData('creds', creds)
        }
    }

    const getPerformanceStats = async () => {
        return {
            ...performanceStats,
            cacheSize: keyCache.size,
            deviceCacheSize: deviceCache.size,
            memoryUsage: process.memoryUsage()
        }
    }

    const diagnoseSchema = async () => {
        try {
            console.log('🔍 Diagnóstico do schema...')
            
            const keyTables = ['sender_keys', 'sessions', 'sender_key_memory', 'pre_keys', 'app_state_sync_versions', 'app_state_sync_keys']
            const issues: string[] = []

            for (const table of keyTables) {
                try {
                    const [columns] = await query(`
                        SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH 
                        FROM INFORMATION_SCHEMA.COLUMNS 
                        WHERE TABLE_SCHEMA = DATABASE() 
                        AND TABLE_NAME = ? 
                        AND COLUMN_NAME = 'value'
                    `, [table]) as any[]

                    if (columns[0]) {
                        const col = columns[0]
                        if (col.DATA_TYPE === 'text') {
                            issues.push(`⚠️ Tabela ${table}: coluna 'value' ainda é TEXT (máx ${col.CHARACTER_MAXIMUM_LENGTH} bytes)`)
                        } else if (col.DATA_TYPE === 'longtext') {
                            console.log(`✅ Tabela ${table}: coluna 'value' é LONGTEXT (OK)`)
                        }
                    }
                } catch (error: any) {
                    issues.push(`❌ Erro ao verificar tabela ${table}: ${error.message}`)
                }
            }

            if (issues.length > 0) {
                console.warn('🚨 Problemas encontrados no schema:')
                issues.forEach(issue => console.warn(issue))
                console.warn('💡 Execute o script migration/03-fix-value-column-size.sql para corrigir')
            } else {
                console.log('✅ Schema está correto!')
            }

            return { issues }
        } catch (error: any) {
            console.warn('Erro no diagnóstico:', error.message)
            return { issues: [`Erro no diagnóstico: ${error.message}`] }
        }
    }

    // ========================================
    // INICIALIZAÇÃO OTIMIZADA
    // ========================================

    const startTime = Date.now()
    
    // Carregamento otimizado: APENAS dados essenciais do device
    const creds: AuthenticationCreds = await readDeviceData() || initAuthCreds()
    
    performanceStats.bootTime = Date.now() - startTime
    
    console.log(`⚡ Boot otimizado em ${performanceStats.bootTime}ms`)

    return {
        state: {
            creds: creds,
            keys: {
                get: async (type, ids) => {
                    return await readKeyData(type, ids)
                },
                set: async (data) => {
                    await writeKeyData(data)
                }
            }
        },
        saveCreds: async () => {
            await saveDeviceData(creds)
            deviceCache.delete(`device-${config.session}`)
        },
        clear: async () => {
            await clearAll()
        },
        removeCreds: async () => {
            await removeAll()
        },
        clearSenderKeyMemory,
        migrateFromLegacy,
        getPerformanceStats,
        diagnoseSchema
    }
}
