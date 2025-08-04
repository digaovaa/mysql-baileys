# 🚀 MYSQL-BAILEYS OTIMIZADO - GUIA DE MIGRAÇÃO

## 📊 Performance Esperada

| Métrica | Antes (Legacy) | Depois (Otimizado) | Melhoria |
|---------|----------------|-------------------|----------|
| **Boot Time** | 5-15 segundos | < 1 segundo | **10-15x mais rápido** |
| **Memória (200 devices)** | ~50MB | ~5MB | **90% redução** |
| **Consulta pre-key** | 100-500ms | < 10ms | **10-50x mais rápido** |
| **Storage InnoDB** | N/A | Cache automático | **Cache inteligente** |

## 🔄 Migração Rápida (5 minutos)

### 1. Atualizar Código

**ANTES:**
```typescript
import { useMySQLAuthState } from 'mysql-baileys'

const { state, saveCreds, clear } = await useMySQLAuthState({
    host: 'localhost',
    user: 'root',
    password: 'password',
    database: 'whatsapp',
    session: 'session1'
})
```

**DEPOIS:**
```typescript
import { useMySQLAuthStateOptimized } from 'mysql-baileys'

const { state, saveCreds, clear, migrateFromLegacy, getPerformanceStats } = 
    await useMySQLAuthStateOptimized({
        host: 'localhost',
        user: 'root',
        password: 'password',
        database: 'whatsapp',
        session: 'session1'
    })

// Migrar dados existentes (execute apenas uma vez)
await migrateFromLegacy()

// Ver estatísticas de performance
console.log(await getPerformanceStats())
```

### 2. Executar Scripts SQL

```bash
# 1. Criar schema otimizado
mysql -u root -p < migration/01-create-optimized-schema.sql

# 2. Migrar dados (execute com cuidado!)
mysql -u root -p -e "CALL MigrateLegacyAuthData('auth', 'YOUR_SESSION', FALSE);"
```

### 3. Configurar MySQL (Opcional)

```bash
# Copiar configuração otimizada
cp config/mysql-optimized.cnf /etc/mysql/conf.d/
sudo systemctl restart mysql
```

## 🔧 Configurações Avançadas

### Schema Híbrido (Migração Gradual)

```typescript
import { useMySQLAuthStateBest } from 'mysql-baileys'

// Escolhe automaticamente a melhor versão disponível
const authState = await useMySQLAuthStateBest({
    host: 'localhost',
    user: 'root', 
    password: 'password',
    database: 'whatsapp',
    session: 'session1',
    useOptimized: true  // Tentar otimizado primeiro
})
```

### Configuração de Cache

```typescript
const authState = await useMySQLAuthStateOptimized({
    // ... config básica
    retryRequestDelayMs: 100,  // Reduzir delay entre tentativas
    maxtRetries: 5             // Menos tentativas para falhar rápido
})
```

## 📋 Checklist de Migração

### Pré-Migração
- [ ] **Backup completo** da tabela `auth`
- [ ] **Testar** em ambiente de desenvolvimento
- [ ] **Verificar** versão MySQL >= 5.7 (suporte a JSON)
- [ ] **Configurar** InnoDB Buffer Pool adequadamente

### Durante a Migração
- [ ] **Executar** script de criação do schema
- [ ] **Testar** migração com `DRY_RUN=TRUE`
- [ ] **Migrar** dados com stored procedure
- [ ] **Verificar** integridade dos dados

### Pós-Migração
- [ ] **Testar** inicialização de sessões
- [ ] **Monitorar** performance e logs
- [ ] **Medir** tempo de boot
- [ ] **Configurar** limpeza automática de cache

## 🚨 Pontos de Atenção

### 1. Identificação Correta de Tipos

**⚠️ PROBLEMA:** Confundir `sender-key` com `sender-key-memory`

**✅ SOLUÇÃO:** Usar precedência de prefixos mais específicos primeiro
```sql
-- CORRETO: Migrar sender-key-memory PRIMEIRO
WHERE id LIKE 'sender-key-memory-%'

-- DEPOIS: Migrar sender-key (excluindo memory)
WHERE id LIKE 'sender-key-%' AND id NOT LIKE 'sender-key-memory-%'
```

### 2. Foreign Key Constraints

**⚠️ PROBLEMA:** Deletion cascade pode remover dados relacionados

**✅ SOLUÇÃO:** 
```sql
-- Device removal automaticamente limpa tudo relacionado
DELETE FROM devices WHERE session = 'session1';
-- Automaticamente remove: sender_keys, sessions, pre_keys, etc.
```

### 3. Cache Management

**⚠️ PROBLEMA:** Cache desatualizado após mudanças externas

**✅ SOLUÇÃO:**
```typescript
// Limpar cache quando necessário
await authState.clearCache() // Se implementado

// Ou reinicializar conexão
await useMySQLAuthStateOptimized(config)
```

## 📊 Monitoramento e Debugging

### Ver Estatísticas de Performance

```typescript
const stats = await authState.getPerformanceStats()
console.log('Performance Stats:', {
    bootTime: stats.bootTime + 'ms',
    cacheHitRate: (stats.cacheHits / (stats.cacheHits + stats.cacheMisses) * 100).toFixed(2) + '%',
    queriesExecuted: stats.queriesExecuted,
    memoryUsage: stats.memoryUsage
})
```

### Queries de Monitoramento

```sql
-- Ver distribuição de dados por sessão
SELECT session, COUNT(*) as total_records 
FROM devices 
GROUP BY session;

-- Ver uso de índices
SELECT TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX, COLUMN_NAME
FROM INFORMATION_SCHEMA.STATISTICS 
WHERE TABLE_SCHEMA = 'your_database'
AND TABLE_NAME IN ('devices', 'sender_keys', 'sessions');

-- Performance das queries
SELECT query, total_time, min_time, max_time, avg_time
FROM performance_schema.statement_summary_by_digest
WHERE query LIKE '%devices%' OR query LIKE '%sender_keys%'
ORDER BY total_time DESC LIMIT 10;
```

## 🔄 Rollback (Se Necessário)

Se precisar voltar para a versão anterior:

```typescript
// 1. Usar versão legacy explicitamente
import { useMySQLAuthState } from 'mysql-baileys'
const authState = await useMySQLAuthState(config)

// 2. Ou desabilitar otimização
import { useMySQLAuthStateBest } from 'mysql-baileys'
const authState = await useMySQLAuthStateBest({
    ...config,
    useOptimized: false  // Forçar legacy
})
```

```sql
-- 3. Opcional: Manter apenas tabela legacy
-- DROP TABLE devices; -- (removerá todas as tabelas relacionadas via CASCADE)
```

## 🎯 Troubleshooting

### Erro: "Cannot find table 'devices'"

**Causa:** Schema otimizado não foi criado  
**Solução:** Execute `01-create-optimized-schema.sql`

### Erro: "Foreign key constraint fails"

**Causa:** Dados órfãos ou ordem incorreta de inserção  
**Solução:** Verifique se `device_id` existe antes de inserir keys

### Performance não melhorou

**Possíveis causas:**
1. **InnoDB Buffer Pool** muito pequeno
2. **Dados não migrados** ainda usando tabela legacy
3. **MySQL não otimizado** para InnoDB

**Soluções:**
```bash
# Verificar buffer pool
mysql -e "SHOW VARIABLES LIKE 'innodb_buffer_pool_size';"

# Verificar se dados foram migrados
mysql -e "SELECT COUNT(*) FROM devices; SELECT COUNT(*) FROM auth WHERE id='creds';"

# Aplicar configuração otimizada
sudo cp config/mysql-optimized.cnf /etc/mysql/conf.d/
sudo systemctl restart mysql
```

## 🚀 Próximos Passos

1. **Monitorar** performance por 1-2 semanas
2. **Ajustar** InnoDB Buffer Pool conforme necessário
3. **Implementar** limpeza automática de dados antigos
4. **Considerar** sharding para volumes muito altos (1000+ devices)

---

**⚡ Resultado Esperado:** Boot instantâneo e queries ultra-rápidas!

Para suporte: [Criar issue no GitHub](https://github.com/tiagomatrixd/mysql-baileys/issues)
