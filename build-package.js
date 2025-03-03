const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configurações
const outputDir = path.join(__dirname, 'lib');

console.log('🚀 Iniciando build do pacote mysql-baileys...');

// Verifica se o diretório lib existe, senão cria
if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    console.log('📁 Diretório lib criado');
}

try {
    // Compilar o projeto TypeScript
    console.log('🔨 Compilando TypeScript...');
    execSync('npx tsc', { stdio: 'inherit' });
    console.log('✅ Compilação TypeScript concluída');

    // Copiar package.json para o diretório lib
    const packageJson = require('./package.json');
    
    // Simplificar o package.json para incluir apenas o necessário
    const distPackageJson = {
        name: packageJson.name,
        version: packageJson.version,
        description: packageJson.description,
        main: "index.js",
        types: "index.d.ts",
        type: "commonjs",
        exports: {
            ".": {
                "require": "./index.js",
                "import": "./index.mjs"
            }
        },
        author: packageJson.author,
        license: packageJson.license,
        dependencies: {
            "libsignal": "github:adiwajshing/libsignal-node",
            "mysql2": "^3.6.5"
        }
    };

    fs.writeFileSync(
        path.join(outputDir, 'package.json'),
        JSON.stringify(distPackageJson, null, 2)
    );
    console.log('📄 package.json copiado para lib/');
    
    // Criar versão ESM do index.js para compatibilidade
    console.log('📝 Criando wrapper ESM...');
    const indexJs = fs.readFileSync(path.join(outputDir, 'index.js'), 'utf8');
    
    // Gera o arquivo ESM compatível
    const esmWrapper = `// ESM wrapper for mysql-baileys
import mysqlBaileys from './index.js';

export const useMySQLAuthState = mysqlBaileys.useMySQLAuthState;
export const monitorConnectionPool = mysqlBaileys.monitorConnectionPool;
export const encryption = mysqlBaileys.encryption;
export const performance = mysqlBaileys.performance;
export const sqlSanitize = mysqlBaileys.sqlSanitize;

export default mysqlBaileys.useMySQLAuthState;
`;

    fs.writeFileSync(
        path.join(outputDir, 'index.mjs'),
        esmWrapper
    );
    console.log('✅ Wrapper ESM criado');
    
    // Copiar README para o diretório lib
    if (fs.existsSync(path.join(__dirname, 'README.md'))) {
        fs.copyFileSync(
            path.join(__dirname, 'README.md'),
            path.join(outputDir, 'README.md')
        );
        console.log('📄 README.md copiado para lib/');
    }
    
    console.log('✨ Build concluído com sucesso!');
    console.log('\nVocê pode instalar o pacote a partir deste diretório usando:');
    console.log('\n  npm install C:/Users/Matrix/Desktop/javascript/mysql-baileys/lib\n');
    
} catch (error) {
    console.error('❌ Erro durante o build:', error);
    process.exit(1);
}
