import { createConnection } from 'mysql2/promise'
import { MySQLConfig } from '../Types'

/**
 * MySQL optimization configuration script
 * Automatically applies recommended settings for ultra-fast performance with 400+ connections
 */

interface MySQLOptimizationConfig extends MySQLConfig {
    applyGlobalSettings?: boolean
    skipWarnings?: boolean
    ramSizeGB?: number
}

export class MySQLOptimizer {
    private config: MySQLOptimizationConfig

    constructor(config: MySQLOptimizationConfig) {
        this.config = config
    }

    /**
     * Apply all recommended MySQL optimizations
     */
    async optimizeMySQL(): Promise<{
        applied: string[]
        skipped: string[]
        errors: string[]
    }> {
        const applied: string[] = []
        const skipped: string[] = []
        const errors: string[] = []

        try {
            const connection = await createConnection({
                host: this.config.host || 'localhost',
                port: this.config.port || 3306,
                user: this.config.user || 'root',
                password: this.config.password,
                database: this.config.database
            })

            console.log('🔧 Applying MySQL optimizations for ultra-fast performance...')

            // Session-level optimizations (immediate effect)
            const sessionOptimizations = [
                // Transaction isolation for better concurrency
                { query: 'SET SESSION transaction_isolation = "READ-COMMITTED"', description: 'Set optimized transaction isolation' },
                
                // Reduce lock wait timeouts
                { query: 'SET SESSION innodb_lock_wait_timeout = 5', description: 'Reduce lock wait timeout' },
                
                // Optimize SQL mode
                { query: 'SET SESSION sql_mode = "STRICT_TRANS_TABLES,NO_ZERO_DATE,NO_ZERO_IN_DATE,ERROR_FOR_DIVISION_BY_ZERO"', description: 'Set optimized SQL mode' },
                
                // Query cache (if available)
                { query: 'SET SESSION query_cache_type = 1', description: 'Enable query cache for session' }
            ]

            for (const optimization of sessionOptimizations) {
                try {
                    await connection.execute(optimization.query)
                    applied.push(optimization.description)
                    console.log(`✓ ${optimization.description}`)
                } catch (error) {
                    if (!this.config.skipWarnings) {
                        console.warn(`⚠️ Could not apply: ${optimization.description} - ${error}`)
                    }
                    skipped.push(`${optimization.description}: ${error}`)
                }
            }

            // Global optimizations (requires SUPER privilege)
            if (this.config.applyGlobalSettings) {
                const ramSize = this.config.ramSizeGB || 4
                const bufferPoolSize = Math.floor(ramSize * 0.75 * 1024 * 1024 * 1024) // 75% of RAM

                const globalOptimizations = [
                    // InnoDB buffer pool (most important for performance)
                    { query: `SET GLOBAL innodb_buffer_pool_size = ${bufferPoolSize}`, description: `Set InnoDB buffer pool to ${Math.floor(ramSize * 0.75)}GB` },
                    
                    // InnoDB log settings
                    { query: 'SET GLOBAL innodb_log_file_size = 268435456', description: 'Set InnoDB log file size to 256MB' },
                    { query: 'SET GLOBAL innodb_flush_log_at_trx_commit = 2', description: 'Optimize log flushing for performance' },
                    { query: 'SET GLOBAL innodb_flush_method = "O_DIRECT"', description: 'Set optimal flush method' },
                    
                    // Query cache
                    { query: 'SET GLOBAL query_cache_size = 268435456', description: 'Set query cache to 256MB' },
                    { query: 'SET GLOBAL query_cache_type = 1', description: 'Enable query cache globally' },
                    
                    // Connection settings
                    { query: 'SET GLOBAL max_connections = 1000', description: 'Increase max connections to 1000' },
                    { query: 'SET GLOBAL connect_timeout = 60', description: 'Set connection timeout' },
                    { query: 'SET GLOBAL wait_timeout = 600', description: 'Set wait timeout' },
                    
                    // InnoDB concurrency
                    { query: 'SET GLOBAL innodb_thread_concurrency = 0', description: 'Optimize InnoDB thread concurrency' },
                    { query: 'SET GLOBAL innodb_read_io_threads = 8', description: 'Increase read IO threads' },
                    { query: 'SET GLOBAL innodb_write_io_threads = 8', description: 'Increase write IO threads' },
                    
                    // Table cache
                    { query: 'SET GLOBAL table_open_cache = 4096', description: 'Increase table open cache' },
                    { query: 'SET GLOBAL table_definition_cache = 2048', description: 'Increase table definition cache' }
                ]

                for (const optimization of globalOptimizations) {
                    try {
                        await connection.execute(optimization.query)
                        applied.push(optimization.description)
                        console.log(`✓ ${optimization.description}`)
                    } catch (error) {
                        if (!this.config.skipWarnings) {
                            console.warn(`⚠️ Could not apply global setting: ${optimization.description} - ${error}`)
                        }
                        skipped.push(`${optimization.description}: ${error}`)
                    }
                }
            }

            await connection.end()

            console.log(`\n🎯 Optimization Summary:`)
            console.log(`   Applied: ${applied.length} optimizations`)
            console.log(`   Skipped: ${skipped.length} optimizations`)
            console.log(`   Errors: ${errors.length} errors`)

            return { applied, skipped, errors }

        } catch (error) {
            const errorMessage = `Failed to connect to MySQL: ${error}`
            console.error(`❌ ${errorMessage}`)
            errors.push(errorMessage)
            return { applied, skipped, errors }
        }
    }

    /**
     * Generate my.cnf configuration file content for permanent optimizations
     */
    generateMyCnfConfig(): string {
        const ramSize = this.config.ramSizeGB || 4
        const bufferPoolSize = `${Math.floor(ramSize * 0.75)}G`

        return `# MySQL Configuration for mysql-baileys ultra performance
# Generated for ${ramSize}GB RAM system

[mysqld]
# InnoDB Settings (most important)
innodb_buffer_pool_size = ${bufferPoolSize}
innodb_log_file_size = 256M
innodb_log_buffer_size = 64M
innodb_flush_log_at_trx_commit = 2
innodb_flush_method = O_DIRECT
innodb_file_per_table = 1
innodb_open_files = 4000

# Connection Settings
max_connections = 1000
max_connect_errors = 1000000
connect_timeout = 60
wait_timeout = 600
interactive_timeout = 600

# Query Cache
query_cache_type = 1
query_cache_size = 256M
query_cache_limit = 2M

# Table Cache
table_open_cache = 4096
table_definition_cache = 2048

# MyISAM Settings (for compatibility)
key_buffer_size = 256M
myisam_sort_buffer_size = 512M

# General Settings
thread_cache_size = 50
sort_buffer_size = 2M
read_buffer_size = 2M
read_rnd_buffer_size = 8M
join_buffer_size = 8M

# Binary Logging (optional, disable for max performance)
# log-bin = mysql-bin
# binlog_format = ROW
# expire_logs_days = 7

# Error Logging
log-error = /var/log/mysql/error.log

# Slow Query Log (for monitoring)
slow_query_log = 1
slow_query_log_file = /var/log/mysql/slow.log
long_query_time = 2

# Character Set
character-set-server = utf8mb4
collation-server = utf8mb4_unicode_ci

[mysql]
default-character-set = utf8mb4

[client]
default-character-set = utf8mb4`
    }

    /**
     * Check current MySQL configuration and suggest improvements
     */
    async analyzeCurrentConfig(): Promise<{
        current: { [key: string]: string }
        recommendations: string[]
        performance_score: number
    }> {
        try {
            const connection = await createConnection({
                host: this.config.host || 'localhost',
                port: this.config.port || 3306,
                user: this.config.user || 'root',
                password: this.config.password,
                database: this.config.database
            })

            console.log('🔍 Analyzing current MySQL configuration...')

            // Variables to check
            const importantVars = [
                'innodb_buffer_pool_size',
                'innodb_log_file_size',
                'innodb_flush_log_at_trx_commit',
                'query_cache_size',
                'query_cache_type',
                'max_connections',
                'table_open_cache',
                'innodb_thread_concurrency'
            ]

            const current: { [key: string]: string } = {}
            const recommendations: string[] = []

            for (const variable of importantVars) {
                try {
                    const [rows] = await connection.execute(`SHOW VARIABLES LIKE '${variable}'`)
                    const result = rows as any[]
                    if (result[0]) {
                        current[variable] = result[0].Value
                    }
                } catch (error) {
                    current[variable] = 'unknown'
                }
            }

            // Analyze and generate recommendations
            let score = 100

            // InnoDB Buffer Pool Size
            const bufferPoolSize = parseInt(current.innodb_buffer_pool_size) || 0
            const optimalBufferPool = (this.config.ramSizeGB || 4) * 0.75 * 1024 * 1024 * 1024
            if (bufferPoolSize < optimalBufferPool * 0.5) {
                recommendations.push(`Increase innodb_buffer_pool_size to at least ${Math.floor(optimalBufferPool / 1024 / 1024 / 1024)}GB`)
                score -= 30
            }

            // Query Cache
            if (current.query_cache_type === '0' || current.query_cache_type === 'OFF') {
                recommendations.push('Enable query cache for better read performance')
                score -= 15
            }

            // Max Connections
            const maxConnections = parseInt(current.max_connections) || 0
            if (maxConnections < 500) {
                recommendations.push('Increase max_connections to at least 500 for high concurrency')
                score -= 10
            }

            // Log flushing
            if (current.innodb_flush_log_at_trx_commit === '1') {
                recommendations.push('Set innodb_flush_log_at_trx_commit=2 for better performance (slight durability trade-off)')
                score -= 10
            }

            await connection.end()

            console.log(`\n📊 Performance Analysis:`)
            console.log(`   Current Score: ${score}/100`)
            console.log(`   Recommendations: ${recommendations.length}`)

            return { current, recommendations, performance_score: score }

        } catch (error) {
            console.error('❌ Failed to analyze configuration:', error)
            return { 
                current: {}, 
                recommendations: ['Could not analyze current configuration'], 
                performance_score: 0 
            }
        }
    }

    /**
     * Test database performance with current settings
     */
    async testPerformance(): Promise<{
        connection_time: number
        query_time: number
        insert_time: number
        select_time: number
        concurrent_connections: number
    }> {
        const startConnect = performance.now()
        
        try {
            const connection = await createConnection({
                host: this.config.host || 'localhost',
                port: this.config.port || 3306,
                user: this.config.user || 'root',
                password: this.config.password,
                database: this.config.database
            })

            const connection_time = performance.now() - startConnect

            // Test simple query
            const startQuery = performance.now()
            await connection.execute('SELECT 1')
            const query_time = performance.now() - startQuery

            // Test table creation and insert
            const testTable = `performance_test_${Date.now()}`
            await connection.execute(`CREATE TABLE ${testTable} (id INT AUTO_INCREMENT PRIMARY KEY, data TEXT, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)`)
            
            const startInsert = performance.now()
            for (let i = 0; i < 100; i++) {
                await connection.execute(`INSERT INTO ${testTable} (data) VALUES (?)`, [`test_data_${i}`])
            }
            const insert_time = performance.now() - startInsert

            // Test select performance
            const startSelect = performance.now()
            await connection.execute(`SELECT * FROM ${testTable} LIMIT 50`)
            const select_time = performance.now() - startSelect

            // Clean up
            await connection.execute(`DROP TABLE ${testTable}`)

            // Test concurrent connections
            const concurrent_start = performance.now()
            const concurrent_promises: Promise<any>[] = []
            for (let i = 0; i < 20; i++) {
                concurrent_promises.push(createConnection({
                    host: this.config.host || 'localhost',
                    port: this.config.port || 3306,
                    user: this.config.user || 'root',
                    password: this.config.password,
                    database: this.config.database
                }))
            }
            
            const concurrent_connections_result = await Promise.all(concurrent_promises)
            const concurrent_time = performance.now() - concurrent_start

            // Close concurrent connections
            await Promise.all(concurrent_connections_result.map(conn => conn.end()))
            await connection.end()

            const results = {
                connection_time: Math.round(connection_time * 100) / 100,
                query_time: Math.round(query_time * 100) / 100,
                insert_time: Math.round(insert_time * 100) / 100,
                select_time: Math.round(select_time * 100) / 100,
                concurrent_connections: Math.round(concurrent_time * 100) / 100
            }

            console.log('\n⚡ Performance Test Results:')
            console.log(`   Connection Time: ${results.connection_time}ms`)
            console.log(`   Query Time: ${results.query_time}ms`)
            console.log(`   Insert Time (100 rows): ${results.insert_time}ms`)
            console.log(`   Select Time: ${results.select_time}ms`)
            console.log(`   Concurrent Connections (20): ${results.concurrent_connections}ms`)

            return results

        } catch (error) {
            console.error('❌ Performance test failed:', error)
            throw error
        }
    }
}

// Example usage
export async function optimizeMySQL(config: MySQLOptimizationConfig) {
    const optimizer = new MySQLOptimizer(config)
    
    console.log('🚀 MySQL Optimization Suite for mysql-baileys\n')
    
    // Analyze current configuration
    const analysis = await optimizer.analyzeCurrentConfig()
    
    if (analysis.performance_score < 80) {
        console.log('\n⚠️ Current configuration needs optimization!')
        console.log('Recommendations:')
        analysis.recommendations.forEach(rec => console.log(`  • ${rec}`))
    }
    
    // Apply optimizations
    const result = await optimizer.optimizeMySQL()
    
    // Test performance
    console.log('\n🧪 Testing performance with current settings...')
    const perfResults = await optimizer.testPerformance()
    
    // Generate my.cnf
    if (config.applyGlobalSettings) {
        console.log('\n📝 Recommended my.cnf configuration:')
        console.log('Save this to /etc/mysql/my.cnf (Linux) or my.ini (Windows)\n')
        console.log(optimizer.generateMyCnfConfig())
    }
    
    return {
        optimization_result: result,
        performance_test: perfResults,
        configuration_analysis: analysis
    }
}

if (require.main === module) {
    // Example usage
    const config = {
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'your_password',
        database: 'baileys_production',
        session: 'optimization_test',
        applyGlobalSettings: false, // Set to true if you have SUPER privileges
        ramSizeGB: 8 // Your server's RAM size
    }
    
    optimizeMySQL(config).catch(console.error)
}
