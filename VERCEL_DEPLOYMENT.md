# 🚀 Guía de Despliegue en Vercel - TutorVirtual

## 📋 Requisitos Previos

### **1. Cuentas Necesarias**
- [Vercel](https://vercel.com) - Plataforma de despliegue
- [Supabase](https://supabase.com) - Base de datos PostgreSQL (recomendado)
- [Google Cloud](https://cloud.google.com) - Para Gemini AI API
- [News API](https://newsapi.org) - Para noticias de IA

### **2. Variables de Entorno Requeridas**

```env
# Database Configuration
DATABASE_URL="postgresql://username:password@host:port/database"
DIRECT_URL="postgresql://username:password@host:port/database"

# JWT Configuration
JWT_SECRET="your-super-secret-jwt-key-here"

# AI Services
GEMINI_API_KEY="your-gemini-api-key"

# External APIs
VITE_NEWS_API_KEY="your-news-api-key"
YOUTUBE_API_KEY="your-youtube-api-key"

# Supabase Configuration (opcional)
SUPABASE_URL="your-supabase-url"
SUPABASE_KEY="your-supabase-anon-key"

# Nuxt Configuration
NUXT_PUBLIC_API_BASE="/api"
```

## 🛠️ Configuración de Base de Datos

### **Opción A: Supabase (Recomendado)**

1. **Crear proyecto en Supabase**
   ```bash
   # Ir a https://supabase.com
   # Crear nuevo proyecto
   # Copiar las credenciales de conexión
   ```

2. **Configurar variables de entorno**
   ```env
   DATABASE_URL="postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres"
   DIRECT_URL="postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres"
   ```

## 🔧 Pasos de Despliegue

### **1. Preparar el Repositorio**

```bash
# Clonar el repositorio
git clone [tu-repositorio]
cd TutorVirtual

# Instalar dependencias
npm install

# Verificar que todo funciona localmente
npm run dev
```

### **2. Configurar Vercel**

```bash
# Instalar Vercel CLI
npm i -g vercel

# Iniciar sesión
vercel login

# Configurar el proyecto
vercel
```

### **3. Configurar Variables de Entorno en Vercel**

1. **Ir al Dashboard de Vercel**
2. **Seleccionar tu proyecto**
3. **Settings → Environment Variables**
4. **Agregar todas las variables de entorno**

### **4. Desplegar**

```bash
# Despliegue de producción
vercel --prod

# O usar el botón "Deploy" en el dashboard de Vercel
```

## 🔍 Verificación Post-Despliegue

### **1. Verificar Base de Datos**
- Las migraciones se ejecutan automáticamente
- El seed crea un usuario administrador por defecto
- Credenciales: `admin@tutorvirtual.com` / `admin123`

### **2. Verificar APIs**
- `/api/news` - Noticias de IA
- `/api/gemini` - Integración con Gemini AI
- `/api/auth/login` - Autenticación

### **3. Verificar Funcionalidades**
- Login/registro de usuarios
- Dashboard de administrador
- Dashboard de docente
- Dashboard de estudiante
- Chat con IA

## 🚨 Solución de Problemas

### **Error: "Database connection failed"**
```bash
# Verificar variables de entorno
# Verificar que la base de datos esté activa
# Verificar que las credenciales sean correctas
```

### **Error: "Prisma generate failed"**
```bash
# Verificar que @prisma/client esté instalado
# Verificar que el schema.prisma sea válido
```

### **Error: "Gemini API key invalid"**
```bash
# Verificar que GEMINI_API_KEY esté configurada
# Verificar que la API key sea válida
# Verificar cuotas de la API
```

### **Error: "Build timeout"**
```bash
# Verificar que vercel-build.sh tenga permisos de ejecución
# Verificar que las dependencias estén correctamente instaladas
```

## 📊 Monitoreo

### **1. Logs de Vercel**
- Dashboard → Functions → Ver logs
- Monitorear errores de build y runtime

### **2. Métricas de Rendimiento**
- Dashboard → Analytics
- Monitorear tiempo de respuesta
- Monitorear uso de recursos

### **3. Base de Datos**
- Supabase Dashboard → Database
- Monitorear consultas y rendimiento

## 🔄 Actualizaciones

### **1. Despliegue Automático**
- Cada push a `main` despliega automáticamente
- Preview deployments en pull requests

### **2. Rollback**
- Dashboard → Deployments → Seleccionar versión anterior
- Click en "Promote to Production"

### **3. Variables de Entorno**
- Dashboard → Settings → Environment Variables
- Cambios requieren nuevo despliegue

## 🎯 Optimizaciones Recomendadas

### **1. Performance**
- Habilitar Edge Functions para APIs críticas
- Configurar CDN para assets estáticos
- Optimizar imágenes y recursos

### **2. Seguridad**
- Rotar JWT_SECRET regularmente
- Configurar rate limiting
- Monitorear logs de seguridad

### **3. Escalabilidad**
- Configurar auto-scaling en base de datos
- Monitorear uso de recursos
- Optimizar consultas de base de datos

## 📞 Soporte

### **Recursos Útiles**
- [Documentación de Vercel](https://vercel.com/docs)
- [Documentación de Nuxt 3](https://nuxt.com/docs)
- [Documentación de Prisma](https://www.prisma.io/docs)
- [Documentación de Supabase](https://supabase.com/docs)

### **Comandos Útiles**
```bash
# Ver logs en tiempo real
vercel logs

# Abrir proyecto en Vercel
vercel open

# Listar deployments
vercel ls

# Ver información del proyecto
vercel inspect
```
