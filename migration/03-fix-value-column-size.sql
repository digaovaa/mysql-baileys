-- Migration: Fix value column size from TEXT to LONGTEXT
-- Reason: WhatsApp sessions data can exceed TEXT limit (65KB)
-- This allows up to 4GB per value field

-- Update all key tables to use LONGTEXT instead of TEXT
ALTER TABLE sender_keys MODIFY COLUMN value LONGTEXT NOT NULL;
ALTER TABLE sessions MODIFY COLUMN value LONGTEXT NOT NULL;
ALTER TABLE sender_key_memory MODIFY COLUMN value LONGTEXT NOT NULL;
ALTER TABLE pre_keys MODIFY COLUMN value LONGTEXT NOT NULL;
ALTER TABLE app_state_sync_versions MODIFY COLUMN value LONGTEXT NOT NULL;
ALTER TABLE app_state_sync_keys MODIFY COLUMN value LONGTEXT NOT NULL;

-- Verify the changes
SELECT 
    TABLE_NAME, 
    COLUMN_NAME, 
    DATA_TYPE, 
    CHARACTER_MAXIMUM_LENGTH
FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME IN ('sender_keys', 'sessions', 'sender_key_memory', 'pre_keys', 'app_state_sync_versions', 'app_state_sync_keys')
    AND COLUMN_NAME = 'value';
