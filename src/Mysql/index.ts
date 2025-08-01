import { createConnection } from 'mysql2/promise'
import { BufferJSON, initAuthCreds, fromObject } from '../Utils'
import { MySQLConfig, sqlData, sqlConnection, AuthenticationCreds, AuthenticationState, SignalDataTypeMap } from '../Types'

/**
 * Stores the full authentication state in mysql
 * Far more efficient than file
 * @param {string} host - The hostname of the database you are connecting to. (Default: localhost)
 * @param {number} port - The port number to connect to. (Default: 3306)
 * @param {string} user - The MySQL user to authenticate as. (Default: root)
 * @param {string} password - The password of that MySQL user
 * @param {string} password1 - Alias for the MySQL user password. Makes a bit more sense in a multifactor authentication setup (see "password2" and "password3")
 * @param {string} password2 - 2nd factor authentication password. Mandatory when the authentication policy for the MySQL user account requires an additional authentication method that needs a password.
 * @param {string} password3 - 3rd factor authentication password. Mandatory when the authentication policy for the MySQL user account requires two additional authentication methods and the last one needs a password.
 * @param {string} database - Name of the database to use for this connection. (Default: base)
 * @param {string} tableName - MySql table name. (Default: auth)
 * @param {number} retryRequestDelayMs - Retry the query at each interval if it fails. (Default: 200ms)
 * @param {number} maxtRetries - Maximum attempts if the query fails. (Default: 10)
 * @param {string} session - Session name to identify the connection, allowing multisessions with mysql.
 * @param {string} localAddress - The source IP address to use for TCP connection.
 * @param {string} socketPath - The path to a unix domain socket to connect to. When used host and port are ignored.
 * @param {boolean} insecureAuth - Allow connecting to MySQL instances that ask for the old (insecure) authentication method. (Default: false)
 * @param {boolean} isServer - If your connection is a server. (Default: false)
 */

let conn: sqlConnection

async function connection(config: MySQLConfig, force: boolean = false){
	const ended = !!conn?.connection?._closing
	const newConnection = conn === undefined

	if (newConnection || ended || force){
		conn = await createConnection({
			database: config.database || 'base',
			host: config.host || 'localhost',
			port: config.port || 3306,
			user: config.user || 'root',
			password: config.password,
			password1: config.password1,
			password2: config.password2,
			password3: config.password3,
			enableKeepAlive: true,
			keepAliveInitialDelay: 5000,
			ssl: config.ssl,
			localAddress: config.localAddress,
			socketPath: config.socketPath,
			insecureAuth: config.insecureAuth || false,
			isServer: config.isServer || false
		})

		if (newConnection) {
			// Optimized table creation with InnoDB engine and proper indexing
			await conn.execute(`CREATE TABLE IF NOT EXISTS \`${config.tableName || 'auth'}\` (
				\`session\` varchar(50) NOT NULL, 
				\`id\` varchar(80) NOT NULL, 
				\`value\` json DEFAULT NULL, 
				UNIQUE KEY \`idxunique\` (\`session\`,\`id\`), 
				KEY \`idxsession\` (\`session\`), 
				KEY \`idxid\` (\`id\`)
			) ENGINE=InnoDB CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci ROW_FORMAT=COMPRESSED;`)
		}
	}

	return conn
}

export const useMySQLAuthState = async(config: MySQLConfig): Promise<{ 
    state: AuthenticationState, 
    saveCreds: () => Promise<void>, 
    clear: () => Promise<void>, 
    removeCreds: () => Promise<void>,
    clearSenderKeyMemory: () => Promise<sqlData>
}> => {
	const sqlConn = await connection(config)

	const tableName = config.tableName || 'auth'
	const retryRequestDelayMs = config.retryRequestDelayMs || 200
	const maxtRetries = config.maxtRetries || 10

	const query = async (sql: string, values: string[]) => {
		for (let x = 0; x < maxtRetries; x++){
			try {
				const [rows] = await sqlConn.execute(sql, values)
				return rows as sqlData
			} catch(e){
				console.warn(`Query attempt ${x + 1} failed:`, e)
				if (x === maxtRetries - 1) {
					// Try to reconnect on final attempt
					try {
						await connection(config, true)
						const [rows] = await sqlConn.execute(sql, values)
						return rows as sqlData
					} catch (reconnectError) {
						console.error('Failed to reconnect and retry query:', reconnectError)
						throw e
					}
				}
				await new Promise(r => setTimeout(r, retryRequestDelayMs))
			}
		}
		return [] as sqlData
	}

	const readData = async (id: string) => {
		const data = await query(`SELECT value FROM ${tableName} WHERE id = ? AND session = ? LIMIT 1`, [id, config.session])
		if(!data[0]?.value){
			return null
		}
		const creds = typeof data[0].value === 'object' ? JSON.stringify(data[0].value) : data[0].value
		const credsParsed = JSON.parse(creds, BufferJSON.reviver)
		return credsParsed
	}

	const writeData = async (id: string, value: object) => {
		const valueFixed = JSON.stringify(value, BufferJSON.replacer)
		await query(`INSERT INTO ${tableName} (session, id, value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE value = ?`, [config.session, id, valueFixed, valueFixed])
	}

	const removeData = async (id: string) => {
		await query(`DELETE FROM ${tableName} WHERE id = ? AND session = ?`, [id, config.session])
	}

	const clearAll = async () => {
		await query(`DELETE FROM ${tableName} WHERE id != 'creds' AND session = ?`, [config.session])
	}

	const removeAll = async () => {
		await query(`DELETE FROM ${tableName} WHERE session = ?`, [config.session])
	}

    // Function to clear sender-key-memory entries with optimized performance
    const clearSenderKeyMemory = async () => {
        const result = await query(`DELETE FROM ${tableName} WHERE id LIKE 'sender-key-memory-%' AND session = ?`, [config.session]);
        console.log(`Deleted ${result.affectedRows || 0} rows from sender-key-memory`);
        return result;
    };

	const creds: AuthenticationCreds = await readData('creds') || initAuthCreds()

	return {
		state: {
			creds: creds,
			keys: {
				get: async (type, ids) => {
					const data: { [id: string]: SignalDataTypeMap[typeof type] } = { }
					
					// Batch processing for better performance
					if (ids.length > 10) {
						// Use batch query for large requests
						const placeholders = ids.map(() => '?').join(',')
						const batchQuery = `SELECT id, value FROM ${tableName} WHERE session = ? AND id IN (${placeholders})`
						const results = await query(batchQuery, [config.session, ...ids.map(id => `${type}-${id}`)])
						
						for (const row of results as any[]) {
							const id = row.id.replace(`${type}-`, '')
							let value = row.value
							
							if (value) {
								const parsed = typeof value === 'object' ? JSON.stringify(value) : value
								value = JSON.parse(parsed, BufferJSON.reviver)
								
								if (type === 'app-state-sync-key' && value) {
									value = fromObject(value)
								}
								data[id] = value
							}
						}
					} else {
						// Use individual queries for small requests
						for(const id of ids){
							let value = await readData(`${type}-${id}`)
							if (type === 'app-state-sync-key' && value){
								value = fromObject(value)
							}
							data[id] = value
						}
					}
					
					return data
				},
				set: async (data) => {
					// Batch write operations for better performance
					const writePromises: Promise<void>[] = []
					
					for(const category in data) {
						for(const id in data[category]) {
							const value = data[category][id]
							const name = `${category}-${id}`
							if (value){
								writePromises.push(writeData(name, value))
							} else {
								writePromises.push(removeData(name))
							}
						}
					}
					
					// Execute all writes in parallel for better performance
					await Promise.all(writePromises)
				}
			}
		},
		saveCreds: async () => {
			await writeData('creds', creds)
		},
		clear: async () => {
			await clearAll()
		},
		removeCreds: async () => {
			await removeAll()
		},
        clearSenderKeyMemory
	}
}
