import { useMySQLAuthState, useMySQLAuthStateOptimized, useMySQLAuthStateBest } from './Mysql'

// Exportar versão original (compatibilidade)
export { useMySQLAuthState }

// Exportar versão otimizada (performance máxima)
export { useMySQLAuthStateOptimized }

// Exportar função que escolhe automaticamente a melhor versão
export { useMySQLAuthStateBest }

// Export default para compatibilidade
export default useMySQLAuthState

/**
 * GUIA DE MIGRAÇÃO RÁPIDA:
 * 
 * 1. SUBSTITUIR:
 *    import { useMySQLAuthState } from 'mysql-baileys'
 * 
 * 2. POR:
 *    import { useMySQLAuthStateBest } from 'mysql-baileys'
 * 
 * 3. OU PARA MÁXIMA PERFORMANCE:
 *    import { useMySQLAuthStateOptimized } from 'mysql-baileys'
 * 
 * 4. CONFIGURAÇÃO:
 *    const { state, saveCreds, clear, removeCreds, migrateFromLegacy } = 
 *        await useMySQLAuthStateOptimized(config)
 * 
 * 5. MIGRAÇÃO DOS DADOS:
 *    await migrateFromLegacy() // Execute uma vez para migrar dados existentes
 * 
 * BENEFITS:
 * ⚡ Boot 10x mais rápido
 * 🚀 Consultas otimizadas
 * 💾 Uso eficiente de memória
 * 🔄 Cache inteligente
 * 📊 Métricas de performance
 */
