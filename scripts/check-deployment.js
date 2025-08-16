#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 Verificando configuración para despliegue...\n');

// Verificar archivos necesarios
const requiredFiles = [
  'package.json',
  'nuxt.config.ts',
  'vercel.json',
  'vercel-build.sh',
  'prisma/schema.prisma',
  'env.example'
];

console.log('📁 Verificando archivos necesarios:');
requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log(`✅ ${file}`);
  } else {
    console.log(`❌ ${file} - FALTANTE`);
  }
});

// Verificar package.json
console.log('\n📦 Verificando package.json:');
try {
  const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  
  // Verificar scripts
  const requiredScripts = ['build', 'vercel-build'];
  requiredScripts.forEach(script => {
    if (packageJson.scripts && packageJson.scripts[script]) {
      console.log(`✅ Script ${script} encontrado`);
    } else {
      console.log(`❌ Script ${script} faltante`);
    }
  });

  // Verificar dependencias
  const requiredDeps = ['@prisma/client', 'nuxt'];
  requiredDeps.forEach(dep => {
    if (packageJson.dependencies && packageJson.dependencies[dep]) {
      console.log(`✅ Dependencia ${dep} encontrada`);
    } else {
      console.log(`❌ Dependencia ${dep} faltante`);
    }
  });

} catch (error) {
  console.log('❌ Error leyendo package.json:', error.message);
}

// Verificar vercel.json
console.log('\n⚙️ Verificando vercel.json:');
try {
  const vercelConfig = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  
  if (vercelConfig.buildCommand) {
    console.log('✅ buildCommand configurado');
  } else {
    console.log('❌ buildCommand faltante');
  }

  if (vercelConfig.framework === 'nuxt') {
    console.log('✅ Framework configurado como nuxt');
  } else {
    console.log('❌ Framework no configurado como nuxt');
  }

} catch (error) {
  console.log('❌ Error leyendo vercel.json:', error.message);
}

// Verificar variables de entorno
console.log('\n🔐 Verificando variables de entorno requeridas:');
const requiredEnvVars = [
  'DATABASE_URL',
  'JWT_SECRET',
  'GEMINI_API_KEY'
];

console.log('Variables requeridas:');
requiredEnvVars.forEach(varName => {
  console.log(`- ${varName}`);
});

console.log('\n📋 Resumen:');
console.log('1. Copia env.example a .env y configura las variables');
console.log('2. Configura tu base de datos PostgreSQL');
console.log('3. Obtén las API keys necesarias');
console.log('4. Ejecuta: npm run vercel-build para probar localmente');
console.log('5. Despliega con: vercel --prod');

console.log('\n✅ Verificación completada!');
