-- ========================================
-- MIGRAÇÃO DE DADOS DO SCHEMA LEGADO PARA SCHEMA OTIMIZADO
-- Migra dados da tabela `auth` para as novas tabelas normalizadas
-- ========================================

-- NOTA: Execute este script APÓS criar o novo schema
-- IMPORTANTE: Faça backup da tabela `auth` antes de executar

-- ========================================
-- FUNÇÃO PARA EXTRAIR JSON FIELDS DE FORMA SEGURA
-- ========================================

DELIMITER $$

-- Função auxiliar para extrair dados JSON de forma segura
CREATE FUNCTION IF NOT EXISTS SAFE_JSON_EXTRACT(json_data JSON, json_path VARCHAR(255))
RETURNS TEXT
READS SQL DATA
DETERMINISTIC
BEGIN
    DECLARE result TEXT DEFAULT NULL;
    DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET result = NULL;
    
    IF json_data IS NOT NULL THEN
        SET result = JSON_UNQUOTE(JSON_EXTRACT(json_data, json_path));
        IF result = 'null' THEN
            SET result = NULL;
        END IF;
    END IF;
    
    RETURN result;
END$$

DELIMITER ;

-- ========================================
-- PROCEDURE PRINCIPAL DE MIGRAÇÃO
-- ========================================

DELIMITER $$

CREATE PROCEDURE IF NOT EXISTS MigrateLegacyAuthData(
    IN legacy_table_name VARCHAR(64) DEFAULT 'auth',
    IN target_session VARCHAR(50),
    IN dry_run BOOLEAN DEFAULT TRUE
)
BEGIN
    DECLARE done INT DEFAULT FALSE;
    DECLARE session_name VARCHAR(50);
    DECLARE device_id INT DEFAULT 0;
    DECLARE creds_data JSON;
    DECLARE migration_count INT DEFAULT 0;
    
    -- Cursor para processar cada sessão
    DECLARE session_cursor CURSOR FOR 
        SELECT DISTINCT session FROM auth WHERE session = target_session OR target_session = 'ALL';
    
    DECLARE CONTINUE HANDLER FOR NOT FOUND SET done = TRUE;
    
    -- Log início da migração
    SELECT CONCAT('Iniciando migração - Dry Run: ', dry_run, ' - Sessão: ', target_session) AS status;
    
    OPEN session_cursor;
    
    session_loop: LOOP
        FETCH session_cursor INTO session_name;
        IF done THEN
            LEAVE session_loop;
        END IF;
        
        SELECT CONCAT('Processando sessão: ', session_name) AS status;
        
        -- ========================================
        -- 1. MIGRAR DADOS DE CREDENCIAIS (CREDS)
        -- ========================================
        
        SELECT value INTO creds_data 
        FROM auth 
        WHERE id = 'creds' AND session = session_name 
        LIMIT 1;
        
        IF creds_data IS NOT NULL THEN
            
            IF NOT dry_run THEN
                INSERT INTO devices (
                    whatsapp_id, session,
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
                ) VALUES (
                    COALESCE(SAFE_JSON_EXTRACT(creds_data, '$.registrationId'), session_name),
                    session_name,
                    SAFE_JSON_EXTRACT(creds_data, '$.noiseKey.public'),
                    SAFE_JSON_EXTRACT(creds_data, '$.noiseKey.private'),
                    SAFE_JSON_EXTRACT(creds_data, '$.pairingEphemeralKeyPair.public'),
                    SAFE_JSON_EXTRACT(creds_data, '$.pairingEphemeralKeyPair.private'),
                    SAFE_JSON_EXTRACT(creds_data, '$.signedIdentityKey.public'),
                    SAFE_JSON_EXTRACT(creds_data, '$.signedIdentityKey.private'),
                    SAFE_JSON_EXTRACT(creds_data, '$.signedPreKey.keyPair.public'),
                    SAFE_JSON_EXTRACT(creds_data, '$.signedPreKey.keyPair.private'),
                    SAFE_JSON_EXTRACT(creds_data, '$.signedPreKey.signature'),
                    SAFE_JSON_EXTRACT(creds_data, '$.signedPreKey.keyId'),
                    SAFE_JSON_EXTRACT(creds_data, '$.registrationId'),
                    SAFE_JSON_EXTRACT(creds_data, '$.advSecretKey'),
                    SAFE_JSON_EXTRACT(creds_data, '$.processedHistoryMessages'),
                    SAFE_JSON_EXTRACT(creds_data, '$.nextPreKeyId'),
                    SAFE_JSON_EXTRACT(creds_data, '$.firstUnuploadedPreKeyId'),
                    SAFE_JSON_EXTRACT(creds_data, '$.accountSyncCounter'),
                    SAFE_JSON_EXTRACT(creds_data, '$.accountSettings'),
                    SAFE_JSON_EXTRACT(creds_data, '$.pairingCode'),
                    SAFE_JSON_EXTRACT(creds_data, '$.lastPropHash'),
                    SAFE_JSON_EXTRACT(creds_data, '$.routingInfo'),
                    SAFE_JSON_EXTRACT(creds_data, '$.me.id'),
                    SAFE_JSON_EXTRACT(creds_data, '$.me.lid'),
                    SAFE_JSON_EXTRACT(creds_data, '$.me.name'),
                    SAFE_JSON_EXTRACT(creds_data, '$.account.details'),
                    SAFE_JSON_EXTRACT(creds_data, '$.account.accountSignatureKey'),
                    SAFE_JSON_EXTRACT(creds_data, '$.account.accountSignature'),
                    SAFE_JSON_EXTRACT(creds_data, '$.account.deviceSignature'),
                    SAFE_JSON_EXTRACT(creds_data, '$.signalIdentities'),
                    SAFE_JSON_EXTRACT(creds_data, '$.platform'),
                    SAFE_JSON_EXTRACT(creds_data, '$.deviceId'),
                    SAFE_JSON_EXTRACT(creds_data, '$.phoneId'),
                    SAFE_JSON_EXTRACT(creds_data, '$.identityId'),
                    CAST(SAFE_JSON_EXTRACT(creds_data, '$.registered') AS UNSIGNED),
                    SAFE_JSON_EXTRACT(creds_data, '$.backupToken'),
                    SAFE_JSON_EXTRACT(creds_data, '$.registration'),
                    SAFE_JSON_EXTRACT(creds_data, '$.lastAccountSyncTimestamp'),
                    SAFE_JSON_EXTRACT(creds_data, '$.myAppStateKeyId')
                ) ON DUPLICATE KEY UPDATE
                    noise_key_public = VALUES(noise_key_public),
                    noise_key_private = VALUES(noise_key_private),
                    updated_at = CURRENT_TIMESTAMP;
                
                -- Obter o device_id inserido/atualizado
                SELECT id INTO device_id FROM devices WHERE session = session_name LIMIT 1;
                
            ELSE
                SELECT CONCAT('DRY RUN - Migraria credenciais para sessão: ', session_name) AS status;
                SET device_id = 999; -- ID fictício para dry run
            END IF;
            
            SET migration_count = migration_count + 1;
        END IF;
        
        -- ========================================
        -- 2. MIGRAR SENDER KEYS (ATENÇÃO À PRECEDÊNCIA!)
        -- ========================================
        
        -- 2.1 Migrar sender-key-memory PRIMEIRO (prefixo mais específico)
        IF NOT dry_run THEN
            INSERT INTO sender_key_memory (key_id, value, device_id, session)
            SELECT 
                SUBSTRING(id, 18) AS key_id,  -- Remove 'sender-key-memory-'
                value,
                device_id,
                session
            FROM auth 
            WHERE id LIKE 'sender-key-memory-%' 
            AND session = session_name
            AND device_id > 0
            ON DUPLICATE KEY UPDATE value = VALUES(value);
        ELSE
            SELECT COUNT(*) AS sender_key_memory_count, 'DRY RUN - sender-key-memory' AS type
            FROM auth 
            WHERE id LIKE 'sender-key-memory-%' AND session = session_name;
        END IF;
        
        -- 2.2 Migrar sender-key (excluindo sender-key-memory)
        IF NOT dry_run THEN
            INSERT INTO sender_keys (key_id, value, device_id, session)
            SELECT 
                SUBSTRING(id, 12) AS key_id,  -- Remove 'sender-key-'
                value,
                device_id,
                session
            FROM auth 
            WHERE id LIKE 'sender-key-%' 
            AND id NOT LIKE 'sender-key-memory-%'  -- EXCLUSÃO EXPLÍCITA!
            AND session = session_name
            AND device_id > 0
            ON DUPLICATE KEY UPDATE value = VALUES(value);
        ELSE
            SELECT COUNT(*) AS sender_key_count, 'DRY RUN - sender-key' AS type
            FROM auth 
            WHERE id LIKE 'sender-key-%' 
            AND id NOT LIKE 'sender-key-memory-%' 
            AND session = session_name;
        END IF;
        
        -- ========================================
        -- 3. MIGRAR SESSIONS
        -- ========================================
        
        IF NOT dry_run THEN
            INSERT INTO sessions (key_id, value, device_id, session)
            SELECT 
                SUBSTRING(id, 9) AS key_id,  -- Remove 'session-'
                value,
                device_id,
                session
            FROM auth 
            WHERE id LIKE 'session-%' 
            AND session = session_name
            AND device_id > 0
            ON DUPLICATE KEY UPDATE value = VALUES(value);
        ELSE
            SELECT COUNT(*) AS sessions_count, 'DRY RUN - sessions' AS type
            FROM auth 
            WHERE id LIKE 'session-%' AND session = session_name;
        END IF;
        
        -- ========================================
        -- 4. MIGRAR PRE-KEYS
        -- ========================================
        
        IF NOT dry_run THEN
            INSERT INTO pre_keys (key_id, value, device_id, session)
            SELECT 
                SUBSTRING(id, 9) AS key_id,  -- Remove 'pre-key-'
                value,
                device_id,
                session
            FROM auth 
            WHERE id LIKE 'pre-key-%' 
            AND session = session_name
            AND device_id > 0
            ON DUPLICATE KEY UPDATE value = VALUES(value);
        ELSE
            SELECT COUNT(*) AS pre_keys_count, 'DRY RUN - pre-keys' AS type
            FROM auth 
            WHERE id LIKE 'pre-key-%' AND session = session_name;
        END IF;
        
        -- ========================================
        -- 5. MIGRAR APP STATE SYNC (ATENÇÃO À PRECEDÊNCIA!)
        -- ========================================
        
        -- 5.1 Migrar app-state-sync-version PRIMEIRO (prefixo mais específico)
        IF NOT dry_run THEN
            INSERT INTO app_state_sync_versions (key_id, value, device_id, session)
            SELECT 
                SUBSTRING(id, 23) AS key_id,  -- Remove 'app-state-sync-version-'
                value,
                device_id,
                session
            FROM auth 
            WHERE id LIKE 'app-state-sync-version-%' 
            AND session = session_name
            AND device_id > 0
            ON DUPLICATE KEY UPDATE value = VALUES(value);
        ELSE
            SELECT COUNT(*) AS app_state_sync_versions_count, 'DRY RUN - app-state-sync-version' AS type
            FROM auth 
            WHERE id LIKE 'app-state-sync-version-%' AND session = session_name;
        END IF;
        
        -- 5.2 Migrar app-state-sync-key (excluindo version)
        IF NOT dry_run THEN
            INSERT INTO app_state_sync_keys (key_id, value, device_id, session)
            SELECT 
                SUBSTRING(id, 19) AS key_id,  -- Remove 'app-state-sync-key-'
                value,
                device_id,
                session
            FROM auth 
            WHERE id LIKE 'app-state-sync-key-%' 
            AND id NOT LIKE 'app-state-sync-version-%'  -- EXCLUSÃO EXPLÍCITA!
            AND session = session_name
            AND device_id > 0
            ON DUPLICATE KEY UPDATE value = VALUES(value);
        ELSE
            SELECT COUNT(*) AS app_state_sync_keys_count, 'DRY RUN - app-state-sync-key' AS type
            FROM auth 
            WHERE id LIKE 'app-state-sync-key-%' 
            AND id NOT LIKE 'app-state-sync-version-%' 
            AND session = session_name;
        END IF;
        
    END LOOP;
    
    CLOSE session_cursor;
    
    -- ========================================
    -- RELATÓRIO FINAL
    -- ========================================
    
    SELECT CONCAT('Migração concluída. Sessões processadas: ', migration_count) AS status;
    
    IF NOT dry_run THEN
        -- Estatísticas pós-migração
        SELECT 
            'DEVICES' AS table_name,
            COUNT(*) AS total_records 
        FROM devices
        WHERE session = target_session OR target_session = 'ALL'
        
        UNION ALL
        
        SELECT 
            'SENDER_KEYS' AS table_name,
            COUNT(*) AS total_records 
        FROM sender_keys sk
        INNER JOIN devices d ON sk.device_id = d.id
        WHERE d.session = target_session OR target_session = 'ALL'
        
        UNION ALL
        
        SELECT 
            'SENDER_KEY_MEMORY' AS table_name,
            COUNT(*) AS total_records 
        FROM sender_key_memory skm
        INNER JOIN devices d ON skm.device_id = d.id
        WHERE d.session = target_session OR target_session = 'ALL'
        
        UNION ALL
        
        SELECT 
            'SESSIONS' AS table_name,
            COUNT(*) AS total_records 
        FROM sessions s
        INNER JOIN devices d ON s.device_id = d.id
        WHERE d.session = target_session OR target_session = 'ALL'
        
        UNION ALL
        
        SELECT 
            'PRE_KEYS' AS table_name,
            COUNT(*) AS total_records 
        FROM pre_keys pk
        INNER JOIN devices d ON pk.device_id = d.id
        WHERE d.session = target_session OR target_session = 'ALL'
        
        UNION ALL
        
        SELECT 
            'APP_STATE_SYNC_KEYS' AS table_name,
            COUNT(*) AS total_records 
        FROM app_state_sync_keys ask
        INNER JOIN devices d ON ask.device_id = d.id
        WHERE d.session = target_session OR target_session = 'ALL'
        
        UNION ALL
        
        SELECT 
            'APP_STATE_SYNC_VERSIONS' AS table_name,
            COUNT(*) AS total_records 
        FROM app_state_sync_versions asv
        INNER JOIN devices d ON asv.device_id = d.id
        WHERE d.session = target_session OR target_session = 'ALL';
    END IF;
    
END$$

DELIMITER ;

-- ========================================
-- COMANDOS DE EXECUÇÃO
-- ========================================

-- TESTE A MIGRAÇÃO PRIMEIRO (DRY RUN)
-- CALL MigrateLegacyAuthData('auth', 'YOUR_SESSION_NAME', TRUE);

-- EXECUTE A MIGRAÇÃO REAL
-- CALL MigrateLegacyAuthData('auth', 'YOUR_SESSION_NAME', FALSE);

-- MIGRAR TODAS AS SESSÕES (USE COM CUIDADO!)
-- CALL MigrateLegacyAuthData('auth', 'ALL', FALSE);

-- ========================================
-- VERIFICAÇÃO DE INTEGRIDADE PÓS-MIGRAÇÃO
-- ========================================

-- Verificar se todos os creds foram migrados
-- SELECT 
--     a.session,
--     COUNT(a.id) as legacy_creds,
--     COUNT(d.id) as migrated_devices
-- FROM auth a
-- LEFT JOIN devices d ON a.session = d.session
-- WHERE a.id = 'creds'
-- GROUP BY a.session;

-- Verificar distribuição de dados por tipo
-- SELECT 
--     CASE 
--         WHEN id = 'creds' THEN 'creds'
--         WHEN id LIKE 'sender-key-memory-%' THEN 'sender-key-memory'
--         WHEN id LIKE 'sender-key-%' THEN 'sender-key'
--         WHEN id LIKE 'session-%' THEN 'session'
--         WHEN id LIKE 'pre-key-%' THEN 'pre-key'
--         WHEN id LIKE 'app-state-sync-version-%' THEN 'app-state-sync-version'
--         WHEN id LIKE 'app-state-sync-key-%' THEN 'app-state-sync-key'
--         ELSE 'other'
--     END as data_type,
--     COUNT(*) as count
-- FROM auth
-- GROUP BY data_type
-- ORDER BY count DESC;
