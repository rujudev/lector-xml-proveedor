# 🔄 Configuración de Sincronización Automática

## Versión Actualizada - v1.3.0

Esta guía se ha actualizado para reflejar las mejoras implementadas en la versión 1.3.0, incluyendo la corrección de la API de Shopify y el soporte mejorado para Google Shopping XML.

## 📅 Sincronización Automática de Proveedores XML

La aplicación soporta sincronización automática de productos desde proveedores XML. Configuración recomendada: cada 6-8 horas para mantener el inventario actualizado.

### ✨ Nuevas Características v1.3.0
- ✅ **API Corregida**: Problema de variantes resuelto (GraphQL + REST API híbrido)
- ✅ **Google Shopping**: Soporte completo para elementos `g:*`
- ✅ **Logging Optimizado**: Logs filtrados para mejor debugging
- ✅ **Procesamiento Masivo**: Hasta 1814+ productos por lote

## 🔧 Configuración

### 1. Variables de Entorno

Añade a tu archivo `.env`:

```env
CRON_AUTH_TOKEN=tu_token_secreto_aqui
LOG_LEVEL=warn
NODE_ENV=production
```

### 2. Configurar Cron Job (Servidor Linux/macOS)

Ejecuta `crontab -e` y añade:

```bash
# Sincronizar proveedores XML cada 8 horas
0 0,8,16 * * * curl -X POST -H "Authorization: Bearer tu_token_secreto_aqui" https://tu-app.com/api/sync-cron

# O cada 4 horas para mayor frecuencia
0 0,4,8,12,16,20 * * * curl -X POST -H "Authorization: Bearer tu_token_secreto_aqui" https://tu-app.com/api/sync-cron
```

### 3. Alternativas de Configuración

#### A) GitHub Actions (Recomendado para apps en cloud)

Crea `.github/workflows/sync-cron.yml`:

```yaml
name: XML Provider Sync
on:
  schedule:
    - cron: '0 0,8,16 * * *'  # Cada 8 horas
  workflow_dispatch:  # Permite ejecutar manualmente

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Sync XML Providers
        run: |
          curl -X POST \\
            -H "Authorization: Bearer ${{ secrets.CRON_AUTH_TOKEN }}" \\
            https://your-app.com/api/sync-cron
```

#### B) Vercel Cron Jobs

En `vercel.json`:

```json
{
  "crons": [
    {
      "path": "/api/sync-cron",
      "schedule": "0 0,8,16 * * *"
    }
  ]
}
```

#### C) Heroku Scheduler

```bash
heroku addons:create scheduler:standard
heroku addons:open scheduler
```

Luego añade el comando:
```bash
curl -X POST -H "Authorization: Bearer $CRON_AUTH_TOKEN" https://your-app.herokuapp.com/api/sync-cron
```

### 4. Servicios de Cron externos

#### Cron-job.org
1. Visita https://cron-job.org
2. Configura URL: `https://tu-app.com/api/sync-cron`
3. Método: POST
4. Headers: `Authorization: Bearer tu_token_secreto_aqui`
5. Horario: `0 0,8,16 * * *`

#### EasyCron
1. Visita https://www.easycron.com
2. Configura la misma URL y headers

## 🚀 Uso

### Desde la Interfaz Web

1. Ve a la página "Sincronización" en tu app
2. Añade proveedores XML con sus URLs
3. Configura frecuencia de sincronización
4. Habilita "Auto-sync" para sincronización en tiempo real
5. Usa "Sincronizar Ahora" para pruebas manuales

### Mediante API

#### Verificar estado:
```bash
GET /api/sync-cron
```

#### Ejecutar sincronización:
```bash
POST /api/sync-cron
Authorization: Bearer tu_token_secreto_aqui
```

## 📊 Monitoreo

### Logs de Sincronización

Cada sincronización genera logs con:
- ✅ **Estado**: success/error/partial
- 📊 **Estadísticas**: productos creados/actualizados/errores
- ⏱️ **Duración**: tiempo de procesamiento
- 📝 **Detalles**: información específica de errores

### Dashboard de Estado

La página de sincronización muestra:
- ⏰ Proveedores pendientes de sincronización
- 📈 Historial de sincronizaciones
- 🔄 Estado actual de cada proveedor
- 📋 Logs detallados

## 🛠️ Solución de Problemas

### Error "No autorizado"
- Verifica que `CRON_AUTH_TOKEN` esté configurado
- Confirma que el header Authorization sea correcto

### Sincronización no funciona
1. Verifica que el proveedor esté activo
2. Confirma que la URL XML sea válida
3. Revisa los logs en la página de sincronización
4. Verifica que `nextSync` no sea futuro

### Productos no se actualizan
- Los productos se actualizan solo si el precio cambió
- Verifica que el XML tenga el mismo ID/SKU
- Confirma el mapeo en la base de datos

## 🔒 Seguridad

1. **Token de autorización**: Siempre usa un token fuerte
2. **HTTPS**: Nunca uses HTTP en producción
3. **Rate limiting**: El sistema limita a 20 productos por sync
4. **Logs**: Todos los accesos se registran

## 📈 Escalabilidad

### Para muchos proveedores:
- Considera aumentar el límite de productos por sync
- Implementa queue system (Redis/Bull)
- Usa workers separados para cada tienda
- Monitorea uso de API de Shopify

### Optimizaciones:
- Cache de XMLs para evitar descargas duplicadas
- Procesamiento incremental basado en timestamps
- Compresión de logs antiguos
- Índices de base de datos optimizados