import { useMySQLAuthState } from '../src/Mysql'
import { useOptimizedMySQLAuthState } from '../src/Mysql/optimized'
import { MySQLConfig } from '../src/Types'

/**
 * Benchmark script to compare performance between old and optimized MySQL structures
 */

interface BenchmarkResult {
    name: string
    avgTime: number
    minTime: number
    maxTime: number
    operations: number
    opsPerSecond: number
    memoryUsage: number
}

class PerformanceBenchmark {
    private config: MySQLConfig

    constructor(config: MySQLConfig) {
        this.config = config
    }

    private async measureTime<T>(operation: () => Promise<T>, iterations: number = 10): Promise<BenchmarkResult> {
        const times: number[] = []
        const startMemory = process.memoryUsage().heapUsed
        
        // Warm up
        await operation()
        
        for (let i = 0; i < iterations; i++) {
            const start = performance.now()
            await operation()
            const end = performance.now()
            times.push(end - start)
        }
        
        const endMemory = process.memoryUsage().heapUsed
        const avgTime = times.reduce((a, b) => a + b, 0) / times.length
        
        return {
            name: '',
            avgTime,
            minTime: Math.min(...times),
            maxTime: Math.max(...times),
            operations: iterations,
            opsPerSecond: 1000 / avgTime,
            memoryUsage: endMemory - startMemory
        }
    }

    async benchmarkInitialization(): Promise<{ old: BenchmarkResult, optimized: BenchmarkResult }> {
        console.log('🔄 Benchmarking initialization performance...')
        
        // Old structure
        const oldResult = await this.measureTime(async () => {
            const oldConfig = { ...this.config, tableName: 'auth_benchmark_old' }
            return await useMySQLAuthState(oldConfig)
        }, 5)
        oldResult.name = 'Old Structure Init'
        
        // Optimized structure
        const optimizedResult = await this.measureTime(async () => {
            const newConfig = { 
                ...this.config, 
                tableName: 'baileys_benchmark',
                enableInnoDBOptimizations: true,
                connectionPooling: true
            }
            return await useOptimizedMySQLAuthState(newConfig)
        }, 5)
        optimizedResult.name = 'Optimized Structure Init'
        
        return { old: oldResult, optimized: optimizedResult }
    }

    async benchmarkDataReading(): Promise<{ old: BenchmarkResult, optimized: BenchmarkResult }> {
        console.log('🔄 Benchmarking data reading performance...')
        
        // Setup test data
        await this.setupTestData()
        
        // Old structure reading
        const oldAuth = await useMySQLAuthState({ ...this.config, tableName: 'auth_benchmark_old' })
        const oldResult = await this.measureTime(async () => {
            return await oldAuth.state.keys.get('session', ['test-session-1', 'test-session-2', 'test-session-3'])
        }, 20)
        oldResult.name = 'Old Structure Read'
        
        // Optimized structure reading
        const optimizedAuth = await useOptimizedMySQLAuthState({ 
            ...this.config, 
            tableName: 'baileys_benchmark',
            enableInnoDBOptimizations: true 
        })
        const optimizedResult = await this.measureTime(async () => {
            return await optimizedAuth.state.keys.get('session', ['test-session-1', 'test-session-2', 'test-session-3'])
        }, 20)
        optimizedResult.name = 'Optimized Structure Read'
        
        return { old: oldResult, optimized: optimizedResult }
    }

    async benchmarkDataWriting(): Promise<{ old: BenchmarkResult, optimized: BenchmarkResult }> {
        console.log('🔄 Benchmarking data writing performance...')
        
        const testData = {
            'session': {
                'write-test-1': new Uint8Array([1, 2, 3, 4, 5]),
                'write-test-2': new Uint8Array([6, 7, 8, 9, 10]),
                'write-test-3': new Uint8Array([11, 12, 13, 14, 15])
            }
        }
        
        // Old structure writing
        const oldAuth = await useMySQLAuthState({ ...this.config, tableName: 'auth_benchmark_old' })
        const oldResult = await this.measureTime(async () => {
            await oldAuth.state.keys.set(testData)
        }, 15)
        oldResult.name = 'Old Structure Write'
        
        // Optimized structure writing
        const optimizedAuth = await useOptimizedMySQLAuthState({ 
            ...this.config, 
            tableName: 'baileys_benchmark',
            enableInnoDBOptimizations: true 
        })
        const optimizedResult = await this.measureTime(async () => {
            await optimizedAuth.state.keys.set(testData)
        }, 15)
        optimizedResult.name = 'Optimized Structure Write'
        
        return { old: oldResult, optimized: optimizedResult }
    }

    async benchmarkBatchOperations(): Promise<{ old: BenchmarkResult, optimized: BenchmarkResult }> {
        console.log('🔄 Benchmarking batch operations performance...')
        
        // Generate large batch data
        const batchData: any = { 'pre-key': {}, 'session': {}, 'sender-key': {} }
        for (let i = 1; i <= 50; i++) {
            batchData['pre-key'][`batch-prekey-${i}`] = { 
                public: new Uint8Array(32).fill(i),
                private: new Uint8Array(32).fill(i + 100)
            }
            batchData['session'][`batch-session-${i}`] = new Uint8Array(64).fill(i)
            batchData['sender-key'][`batch-sender-${i}`] = new Uint8Array(48).fill(i)
        }
        
        // Old structure batch
        const oldAuth = await useMySQLAuthState({ ...this.config, tableName: 'auth_benchmark_old' })
        const oldResult = await this.measureTime(async () => {
            await oldAuth.state.keys.set(batchData)
        }, 5)
        oldResult.name = 'Old Structure Batch'
        
        // Optimized structure batch
        const optimizedAuth = await useOptimizedMySQLAuthState({ 
            ...this.config, 
            tableName: 'baileys_benchmark',
            enableInnoDBOptimizations: true 
        })
        const optimizedResult = await this.measureTime(async () => {
            await optimizedAuth.state.keys.set(batchData)
        }, 5)
        optimizedResult.name = 'Optimized Structure Batch'
        
        return { old: oldResult, optimized: optimizedResult }
    }

    async benchmarkConcurrentConnections(): Promise<{ old: BenchmarkResult, optimized: BenchmarkResult }> {
        console.log('🔄 Benchmarking concurrent connections...')
        
        const connectionCount = 20 // Reduced for testing
        
        // Old structure concurrent connections
        const oldResult = await this.measureTime(async () => {
            const promises: Promise<any>[] = []
            for (let i = 1; i <= connectionCount; i++) {
                promises.push(useMySQLAuthState({ 
                    ...this.config, 
                    tableName: 'auth_benchmark_old',
                    session: `concurrent_old_${i}` 
                }))
            }
            await Promise.all(promises)
        }, 3)
        oldResult.name = 'Old Structure Concurrent'
        
        // Optimized structure concurrent connections
        const optimizedResult = await this.measureTime(async () => {
            const promises: Promise<any>[] = []
            for (let i = 1; i <= connectionCount; i++) {
                promises.push(useOptimizedMySQLAuthState({ 
                    ...this.config, 
                    tableName: 'baileys_benchmark',
                    session: `concurrent_opt_${i}`,
                    enableInnoDBOptimizations: true,
                    connectionPooling: true,
                    maxConnections: 5
                }))
            }
            await Promise.all(promises)
        }, 3)
        optimizedResult.name = 'Optimized Structure Concurrent'
        
        return { old: oldResult, optimized: optimizedResult }
    }

    private async setupTestData() {
        // Setup some test data for benchmarking
        const connection = await require('mysql2/promise').createConnection({
            database: this.config.database || 'test',
            host: this.config.host || 'localhost',
            port: this.config.port || 3306,
            user: this.config.user || 'root',
            password: this.config.password
        })

        // Create test sessions for old structure
        const testSessions = [
            { id: 'session-test-session-1', value: JSON.stringify(new Uint8Array(1024)) },
            { id: 'session-test-session-2', value: JSON.stringify(new Uint8Array(1024)) },
            { id: 'session-test-session-3', value: JSON.stringify(new Uint8Array(1024)) }
        ]

        for (const session of testSessions) {
            await connection.execute(
                `INSERT INTO auth_benchmark_old (session, id, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?`,
                [this.config.session, session.id, session.value, session.value]
            )
        }

        await connection.end()
    }

    private printResults(results: BenchmarkResult[]) {
        console.log('\n📊 BENCHMARK RESULTS')
        console.log('=' .repeat(80))
        
        results.forEach(result => {
            const improvement = results.length === 2 ? 
                ((results[0].avgTime - results[1].avgTime) / results[0].avgTime * 100).toFixed(1) : 
                null
                
            console.log(`\n${result.name}:`)
            console.log(`  Average Time: ${result.avgTime.toFixed(2)}ms`)
            console.log(`  Min Time: ${result.minTime.toFixed(2)}ms`)
            console.log(`  Max Time: ${result.maxTime.toFixed(2)}ms`)
            console.log(`  Ops/Second: ${result.opsPerSecond.toFixed(0)}`)
            console.log(`  Memory Delta: ${(result.memoryUsage / 1024 / 1024).toFixed(2)}MB`)
            
            if (improvement && results.indexOf(result) === 1) {
                console.log(`  🚀 Improvement: ${improvement}% faster`)
            }
        })
    }

    async runFullBenchmark() {
        console.log('🚀 Starting MySQL-Baileys Performance Benchmark\n')
        
        try {
            // Initialization benchmark
            const initResults = await this.benchmarkInitialization()
            this.printResults([initResults.old, initResults.optimized])
            
            // Data reading benchmark
            const readResults = await this.benchmarkDataReading()
            this.printResults([readResults.old, readResults.optimized])
            
            // Data writing benchmark
            const writeResults = await this.benchmarkDataWriting()
            this.printResults([writeResults.old, writeResults.optimized])
            
            // Batch operations benchmark
            const batchResults = await this.benchmarkBatchOperations()
            this.printResults([batchResults.old, batchResults.optimized])
            
            // Concurrent connections benchmark
            const concurrentResults = await this.benchmarkConcurrentConnections()
            this.printResults([concurrentResults.old, concurrentResults.optimized])
            
            // Summary
            console.log('\n🎯 PERFORMANCE SUMMARY')
            console.log('=' .repeat(80))
            
            const improvements = [
                { name: 'Initialization', improvement: ((initResults.old.avgTime - initResults.optimized.avgTime) / initResults.old.avgTime * 100) },
                { name: 'Data Reading', improvement: ((readResults.old.avgTime - readResults.optimized.avgTime) / readResults.old.avgTime * 100) },
                { name: 'Data Writing', improvement: ((writeResults.old.avgTime - writeResults.optimized.avgTime) / writeResults.old.avgTime * 100) },
                { name: 'Batch Operations', improvement: ((batchResults.old.avgTime - batchResults.optimized.avgTime) / batchResults.old.avgTime * 100) },
                { name: 'Concurrent Connections', improvement: ((concurrentResults.old.avgTime - concurrentResults.optimized.avgTime) / concurrentResults.old.avgTime * 100) }
            ]
            
            improvements.forEach(imp => {
                console.log(`${imp.name}: ${imp.improvement.toFixed(1)}% faster`)
            })
            
            const avgImprovement = improvements.reduce((acc, imp) => acc + imp.improvement, 0) / improvements.length
            console.log(`\n🔥 Overall Average Improvement: ${avgImprovement.toFixed(1)}% faster`)
            
        } catch (error) {
            console.error('❌ Benchmark failed:', error)
        }
    }
}

// Example usage
export { PerformanceBenchmark }

if (require.main === module) {
    const config = {
        host: 'localhost',
        port: 3306,
        user: 'root',
        password: 'your_password',
        database: 'baileys_benchmark',
        session: 'benchmark_session'
    }
    
    const benchmark = new PerformanceBenchmark(config)
    benchmark.runFullBenchmark().catch(console.error)
}
