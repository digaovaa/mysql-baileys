import { useMySQLAuthState } from './Mysql'
import { useOptimizedMySQLAuthState } from './Mysql/optimized'
import { migrateToOptimizedStructure, checkMigrationNeeded } from './Utils/migration'

export { 
    useMySQLAuthState, 
    useOptimizedMySQLAuthState,
    migrateToOptimizedStructure,
    checkMigrationNeeded
}
export default useMySQLAuthState
