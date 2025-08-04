-- ========================================
-- SCHEMA OTIMIZADO MYSQL-BAILEYS
-- Migração do schema monolítico para estrutura normalizada
-- ========================================

-- TABELA PRINCIPAL - DEVICES (dados essenciais, leve para boot rápido)
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
    
    -- Índices para performance
    INDEX idx_whatsapp_id (whatsapp_id),
    INDEX idx_session (session),
    INDEX idx_jid (jid),
    INDEX idx_status (status),
    INDEX idx_session_status (session, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TABELAS SEPARADAS POR TIPO (carregadas sob demanda)
CREATE TABLE IF NOT EXISTS sender_keys (
    key_id VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    device_id INT NOT NULL,
    session VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (key_id, device_id),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    INDEX idx_device_id (device_id),
    INDEX idx_session (session)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
    key_id VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    device_id INT NOT NULL,
    session VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (key_id, device_id),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    INDEX idx_device_id (device_id),
    INDEX idx_session (session)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sender_key_memory (
    key_id VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    device_id INT NOT NULL,
    session VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (key_id, device_id),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    INDEX idx_device_id (device_id),
    INDEX idx_session (session)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pre_keys (
    key_id VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    device_id INT NOT NULL,
    session VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (key_id, device_id),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    INDEX idx_device_id (device_id),
    INDEX idx_session (session)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_state_sync_versions (
    key_id VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    device_id INT NOT NULL,
    session VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (key_id, device_id),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    INDEX idx_device_id (device_id),
    INDEX idx_session (session)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_state_sync_keys (
    key_id VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    device_id INT NOT NULL,
    session VARCHAR(50) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    
    PRIMARY KEY (key_id, device_id),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE,
    INDEX idx_device_id (device_id),
    INDEX idx_session (session)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- TABELAS AUXILIARES PARA APLICAÇÃO COMPLETA (OPCIONAIS)
CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(255) PRIMARY KEY,
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS contacts (
    id VARCHAR(255) NOT NULL,
    device_id INT NOT NULL,
    session VARCHAR(50) NOT NULL,
    name VARCHAR(255),
    notify VARCHAR(255),
    verified_name VARCHAR(255),
    img_url TEXT,
    status TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    
    PRIMARY KEY (id, device_id),
    INDEX idx_device_id (device_id),
    INDEX idx_session (session),
    FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========================================
-- ÍNDICES ESTRATÉGICOS PARA PERFORMANCE MÁXIMA
-- ========================================

-- Índices compostos para consultas frequentes
CREATE INDEX idx_devices_session_whatsapp ON devices(session, whatsapp_id);
CREATE INDEX idx_devices_session_status ON devices(session, status);

-- Índices para foreign keys e consultas de relacionamento
CREATE INDEX idx_sender_keys_device_session ON sender_keys(device_id, session);
CREATE INDEX idx_sessions_device_session ON sessions(device_id, session);
CREATE INDEX idx_pre_keys_device_session ON pre_keys(device_id, session);

-- Índices para consultas de limpeza
CREATE INDEX idx_sender_key_memory_session ON sender_key_memory(session);
CREATE INDEX idx_messages_device_session ON messages(device_id, session);

-- ========================================
-- CONFIGURAÇÕES DE OTIMIZAÇÃO
-- ========================================

-- Configurar charset e collation para performance
ALTER TABLE devices CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE sender_keys CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE sessions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE sender_key_memory CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE pre_keys CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE app_state_sync_versions CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE app_state_sync_keys CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
