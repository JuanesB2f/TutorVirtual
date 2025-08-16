#!/bin/bash

# Script de build para Vercel
set -e  # Exit on any error

echo "🚀 Iniciando build para Vercel..."

# Verificar que estamos en el directorio correcto
if [ ! -f "package.json" ]; then
    echo "❌ Error: No se encontró package.json"
    exit 1
fi

# Instalar dependencias si no están instaladas
if [ ! -d "node_modules" ]; then
    echo "📦 Instalando dependencias..."
    npm install
fi

# Generar cliente de Prisma
echo "📦 Generando cliente de Prisma..."
npx prisma generate --schema=./prisma/schema.prisma

# Verificar que la base de datos esté disponible
echo "🔍 Verificando conexión a la base de datos..."
if [ -z "$DATABASE_URL" ]; then
    echo "❌ Error: DATABASE_URL no está definida"
    exit 1
fi

# Ejecutar migraciones
echo "🗄️ Ejecutando migraciones de base de datos..."
npx prisma migrate deploy

# Ejecutar seed si es necesario
echo "🌱 Ejecutando seed de base de datos..."
npx prisma db seed

# Build de Nuxt (sin migraciones para evitar problemas)
echo "🏗️ Construyendo aplicación Nuxt..."
NODE_ENV=production npx nuxt build

echo "✅ Build completado exitosamente!"

