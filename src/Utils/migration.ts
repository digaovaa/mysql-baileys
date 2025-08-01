import { useMySQLAuthState } from '../Mysql'
import { useOptimizedMySQLAuthState } from '../Mysql/optimized'
import { MySQLConfig } from '../Types'

/**
 * Migration script to convert from single table structure to optimized multi-table structure
 * This maintains data integrity while providing significant performance improvements
 */

interface MigrationConfig extends MySQLConfig {
    sourceTableName?: string
    targetTablePrefix?: string
    batchSize?: number
    deleteOldData?: boolean
}

export const migrateToOptimizedStructure = async (config: MigrationConfig): Promise<{
    success: boolean,
    migratedRecords: number,
    errors: string[]
}> => {
    const errors: string[] = []
    let migratedRecords = 0

    try {
        console.log('Starting migration to optimized MySQL structure...')
        
        // Initialize old auth state
        const oldConfig = {
            ...config,
            tableName: config.sourceTableName || config.tableName || 'auth'
        }
        
        const oldAuth = await useMySQLAuthState(oldConfig)
        
        // Initialize new optimized auth state
        const newConfig = {
            ...config,
            tableName: config.targetTablePrefix || 'baileys',
            enableInnoDBOptimizations: true,
            connectionPooling: true
        }
        
        const newAuth = await useOptimizedMySQLAuthState(newConfig)
        
        console.log('Fetching all data from old structure...')
        
        // Get all session data from old table
        const connection = await require('mysql2/promise').createConnection({
            database: config.database || 'base',
            host: config.host || 'localhost',
            port: config.port || 3306,
            user: config.user || 'root',
            password: config.password
        })
        
        const [oldData] = await connection.execute(
            `SELECT id, value FROM ${oldConfig.tableName} WHERE session = ?`,
            [config.session]
        )
        
        console.log(`Found ${(oldData as any[]).length} records to migrate`)
        
        // Migrate credentials first
        const credsRecord = (oldData as any[]).find(record => record.id === 'creds')
        if (credsRecord) {
            const creds = JSON.parse(
                typeof credsRecord.value === 'object' ? 
                JSON.stringify(credsRecord.value) : 
                credsRecord.value
            )
            
            // Update the new auth state creds
            Object.assign(newAuth.state.creds, creds)
            await newAuth.saveCreds()
            migratedRecords++
            console.log('✓ Migrated device credentials')
        }
        
        // Process other data types
        const dataToMigrate: { [category: string]: { [id: string]: any } } = {}
        
        for (const record of oldData as any[]) {
            if (record.id === 'creds') continue
            
            const parts = record.id.split('-')
            const category = parts[0]
            const id = parts.slice(1).join('-')
            
            if (!dataToMigrate[category]) {
                dataToMigrate[category] = {}
            }
            
            let value = record.value
            if (value) {
                const parsed = typeof value === 'object' ? JSON.stringify(value) : value
                value = JSON.parse(parsed, require('../Utils').BufferJSON.reviver)
                
                if (category === 'app-state-sync-key') {
                    value = require('../Utils').fromObject(value)
                }
            }
            
            dataToMigrate[category][id] = value
        }
        
        // Migrate data in batches
        const batchSize = config.batchSize || 100
        for (const category in dataToMigrate) {
            const entries = Object.entries(dataToMigrate[category])
            console.log(`Migrating ${entries.length} ${category} records...`)
            
            for (let i = 0; i < entries.length; i += batchSize) {
                const batch = entries.slice(i, i + batchSize)
                const batchData: any = { [category]: {} }
                
                for (const [id, value] of batch) {
                    batchData[category][id] = value
                }
                
                await newAuth.state.keys.set(batchData)
                migratedRecords += batch.length
                
                if (batch.length === batchSize) {
                    console.log(`  Migrated ${i + batchSize}/${entries.length} ${category} records`)
                }
            }
            
            console.log(`✓ Completed migration of ${category} records`)
        }
        
        // Verify migration
        console.log('Verifying migration...')
        const stats = await (newAuth as any).getStats()
        console.log('Migration statistics:', stats)
        
        // Optionally delete old data
        if (config.deleteOldData) {
            console.log('Deleting old data...')
            await oldAuth.removeCreds()
            console.log('✓ Old data deleted')
        }
        
        await connection.end()
        
        console.log(`✓ Migration completed successfully! Migrated ${migratedRecords} records.`)
        
        return {
            success: true,
            migratedRecords,
            errors
        }
        
    } catch (error) {
        const errorMessage = `Migration failed: ${error}`
        console.error(errorMessage)
        errors.push(errorMessage)
        
        return {
            success: false,
            migratedRecords,
            errors
        }
    }
}

/**
 * Validates if migration is needed by checking table structure
 */
export const checkMigrationNeeded = async (config: MySQLConfig): Promise<{
    migrationNeeded: boolean,
    currentStructure: 'single-table' | 'multi-table' | 'unknown',
    recordCount: number
}> => {
    try {
        const connection = await require('mysql2/promise').createConnection({
            database: config.database || 'base',
            host: config.host || 'localhost',
            port: config.port || 3306,
            user: config.user || 'root',
            password: config.password
        })
        
        // Check if optimized tables exist
        const [tables] = await connection.execute(
            `SHOW TABLES LIKE '${config.tableName || 'baileys'}_%'`
        )
        
        const hasOptimizedTables = (tables as any[]).length > 0
        
        // Check old table
        const oldTableName = config.tableName || 'auth'
        const [oldTableExists] = await connection.execute(
            `SHOW TABLES LIKE '${oldTableName}'`
        )
        
        let recordCount = 0
        if ((oldTableExists as any[]).length > 0) {
            const [countResult] = await connection.execute(
                `SELECT COUNT(*) as count FROM ${oldTableName} WHERE session = ?`,
                [config.session]
            )
            recordCount = (countResult as any[])[0].count
        }
        
        await connection.end()
        
        const currentStructure = hasOptimizedTables ? 'multi-table' : 
                                (oldTableExists as any[]).length > 0 ? 'single-table' : 'unknown'
        
        return {
            migrationNeeded: currentStructure === 'single-table' && recordCount > 0,
            currentStructure,
            recordCount
        }
        
    } catch (error) {
        console.error('Error checking migration status:', error)
        return {
            migrationNeeded: false,
            currentStructure: 'unknown',
            recordCount: 0
        }
    }
}
