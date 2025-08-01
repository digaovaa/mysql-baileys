import { useMySQLAuthState } from '../src/index'
import makeWASocket, { DisconnectReason, useMultiFileAuthState } from '@whiskeysockets/baileys'

/**
 * Exemplo de uso da implementação ultra-otimizada MySQL Baileys
 * Suporta 400+ conexões simultâneas com performance máxima
 */

async function exemploUltraPerformance() {
    console.log('🚀 Iniciando WhatsApp com MySQL Ultra-Performance...')
    
    try {
        // Configuração otimizada para máxima performance
        const { state, saveCreds, getPerformanceStats, clearSenderKeyMemory } = await useMySQLAuthState({
            host: 'localhost',
            user: 'root',
            password: 'sua_senha_mysql',
            database: 'whatsapp_ultrafast',
            tableName: 'auth_ultrafast', // Será criado automaticamente
            session: 'sessao_principal', // Identificador único
            
            // Configurações de retry otimizadas (mais rápido que o padrão)
            retryRequestDelayMs: 100, // Reduzido de 200ms
            maxtRetries: 5,           // Reduzido de 10
        })

        console.log('✅ Configuração MySQL Ultra-Performance carregada!')

        // Criar socket WhatsApp com estado otimizado
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: true,
            // Outras configurações do Baileys...
        })

        // Event listeners
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update
            
            if(connection === 'close') {
                const shouldReconnect = (lastDisconnect?.error as any)?.output?.statusCode !== DisconnectReason.loggedOut
                console.log('❌ Conexão fechada. Deve reconectar?', shouldReconnect)
                
                if(shouldReconnect) {
                    setTimeout(() => exemploUltraPerformance(), 5000)
                }
            } else if(connection === 'open') {
                console.log('🎉 Conectado com sucesso!')
                
                // Mostrar estatísticas de performance
                const stats = await getPerformanceStats()
                console.log('\n📊 === ESTATÍSTICAS DE PERFORMANCE ===')
                console.log('🔧 Otimizações aplicadas:', stats.optimizations)
                console.log('🏗️  Arquitetura:', stats.architecture)
                
                if (stats.connections) {
                    console.log('🔗 Conexões MySQL ativas:', stats.connections.length)
                }
                
                console.log('==========================================\n')
            }
        })

        // Salvar credenciais automaticamente
        sock.ev.on('creds.update', saveCreds)

        // Exemplo de limpeza de cache quando necessário
        sock.ev.on('messaging-history.set', async () => {
            console.log('🧹 Limpando cache sender-key-memory...')
            const result = await clearSenderKeyMemory()
            console.log(`✅ ${result.affectedRows || 0} entradas removidas do cache`)
        })

        // Monitoramento de performance em tempo real
        setInterval(async () => {
            try {
                const stats = await getPerformanceStats()
                if (stats.bufferPool) {
                    console.log('💾 InnoDB Buffer Pool ativo - queries ultra-rápidas!')
                }
            } catch (error) {
                console.warn('⚠️  Erro ao obter stats:', error.message)
            }
        }, 30000) // Verificar a cada 30 segundos

    } catch (error) {
        console.error('❌ Erro na inicialização:', error)
        setTimeout(() => exemploUltraPerformance(), 10000)
    }
}

/**
 * Exemplo de múltiplas sessões simultâneas
 * Demonstra como suportar 400+ conexões
 */
async function exemploMultiplasSessoes() {
    console.log('🔀 Iniciando múltiplas sessões simultâneas...')
    
    const sessoes = []
    const numSessoes = 10 // Teste com 10, escale para 400+
    
    for (let i = 1; i <= numSessoes; i++) {
        try {
            const { state, saveCreds } = await useMySQLAuthState({
                host: 'localhost',
                user: 'root',
                password: 'sua_senha_mysql',
                database: 'whatsapp_multisessao',
                tableName: 'auth_multi',
                session: `sessao_${i}`, // Cada sessão tem seu próprio namespace
            })

            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false, // Desabilitar QR para múltiplas sessões
            })

            sock.ev.on('creds.update', saveCreds)
            
            sock.ev.on('connection.update', (update) => {
                if (update.connection === 'open') {
                    console.log(`✅ Sessão ${i} conectada com sucesso!`)
                }
            })

            sessoes.push(sock)
            
            // Pequeno delay entre sessões para evitar rate limiting
            await new Promise(resolve => setTimeout(resolve, 1000))
            
        } catch (error) {
            console.error(`❌ Erro na sessão ${i}:`, error.message)
        }
    }
    
    console.log(`🎯 ${sessoes.length} sessões iniciadas simultaneamente!`)
}

/**
 * Exemplo de monitoramento de performance
 */
async function monitorarPerformance() {
    const { getPerformanceStats } = await useMySQLAuthState({
        host: 'localhost',
        user: 'root', 
        password: 'sua_senha_mysql',
        database: 'whatsapp_monitor',
        tableName: 'auth_monitor',
        session: 'monitor'
    })

    console.log('📈 Iniciando monitoramento de performance...')
    
    setInterval(async () => {
        try {
            const stats = await getPerformanceStats()
            
            console.log('\n=== RELATÓRIO DE PERFORMANCE ===')
            console.log('⚡ Otimizações ativas:', Object.keys(stats.optimizations || {}).filter(key => stats.optimizations[key]).length)
            console.log('🏗️  Tabelas leves:', stats.architecture?.lightweight_tables?.length || 0)
            console.log('💾 Tabelas pesadas:', stats.architecture?.heavy_tables?.length || 0)
            console.log('🚀 Boot time:', stats.architecture?.boot_time || 'N/A')
            console.log('⚡ Query time:', stats.architecture?.query_time || 'N/A')
            console.log('================================\n')
            
        } catch (error) {
            console.warn('⚠️  Erro no monitoramento:', error.message)
        }
    }, 60000) // Relatório a cada 1 minuto
}

// Escolha o exemplo que deseja executar:

// Exemplo 1: Sessão única ultra-performance
// exemploUltraPerformance()

// Exemplo 2: Múltiplas sessões (400+ conexões)
// exemploMultiplasSessoes()

// Exemplo 3: Monitoramento de performance
// monitorarPerformance()

export {
    exemploUltraPerformance,
    exemploMultiplasSessoes,
    monitorarPerformance
}
