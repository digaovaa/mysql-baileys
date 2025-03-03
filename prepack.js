const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const archiver = require('archiver');

// Configurações
const packageDir = path.join(__dirname, 'package');
const sourceDir = path.join(__dirname, 'src');
const libDir = path.join(__dirname, 'lib');

console.log('🚀 Criando pacote pré-compilado mysql-baileys...');

// Limpar diretórios anteriores
if (fs.existsSync(packageDir)) {
    console.log('🗑️ Removendo diretório package anterior...');
    fs.rmSync(packageDir, { recursive: true, force: true });
}

// Criar diretório package
fs.mkdirSync(packageDir, { recursive: true });
console.log('📁 Diretório package criado');

try {
    // Compilar o projeto
    console.log('🛠️ Compilando TypeScript...');
    execSync('npx tsc', { stdio: 'inherit' });
    console.log('✅ Compilação concluída');
    
    // Copiar arquivos compilados para o diretório package
    console.log('📋 Copiando arquivos compilados...');
    fs.cpSync(libDir, path.join(packageDir, 'lib'), { recursive: true });

    // Criar package.json simplificado
    const packageJson = require('./package.json');
    const packagePackageJson = {
        name: packageJson.name,
        version: packageJson.version,
        description: packageJson.description,
        main: "lib/index.js",
        types: "lib/index.d.ts",
        type: "commonjs",
        author: packageJson.author,
        license: packageJson.license,
        dependencies: {
            "libsignal": "github:adiwajshing/libsignal-node",
            "mysql2": "^3.6.5"
        }
    };

    fs.writeFileSync(
        path.join(packageDir, 'package.json'),
        JSON.stringify(packagePackageJson, null, 2)
    );
    console.log('📄 package.json criado');

    // Copiar README
    if (fs.existsSync(path.join(__dirname, 'README.md'))) {
        fs.copyFileSync(
            path.join(__dirname, 'README.md'),
            path.join(packageDir, 'README.md')
        );
        console.log('📄 README.md copiado');
    }

    // Criar arquivo index.js na raiz que aponta para lib/index.js
    fs.writeFileSync(
        path.join(packageDir, 'index.js'),
        `module.exports = require('./lib/index.js');`
    );
    console.log('📄 index.js de redirecionamento criado');

    // Criar arquivo index.d.ts na raiz que aponta para lib/index.d.ts
    fs.writeFileSync(
        path.join(packageDir, 'index.d.ts'),
        `export * from './lib/index';
export { default } from './lib/index';`
    );
    console.log('📄 index.d.ts de redirecionamento criado');

    // Criar ZIP do pacote
    console.log('📦 Criando arquivo ZIP do pacote...');
    const output = fs.createWriteStream(path.join(__dirname, 'mysql-baileys.zip'));
    const archive = archiver('zip', {
        zlib: { level: 9 }
    });

    output.on('close', () => {
        console.log(`✅ Pacote mysql-baileys.zip criado (${archive.pointer()} bytes)`);
        console.log('\n🎉 Processo concluído! Você pode instalar o pacote usando:');
        console.log('\n  npm install C:/Users/Matrix/Desktop/javascript/mysql-baileys/package\n');
        console.log('Ou descompactando o arquivo mysql-baileys.zip e instalando a partir dele.');
    });

    archive.on('error', (err) => {
        throw err;
    });

    archive.pipe(output);
    archive.directory(packageDir, false);
    archive.finalize();

} catch (error) {
    console.error('❌ Erro durante a criação do pacote:', error);
    process.exit(1);
}
