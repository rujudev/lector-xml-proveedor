# Lector XML Proveedor - Changelog

## v1.3.0 - 2025.11.02

### 🔧 Correcciones Críticas
- **FIXED**: Error de API GraphQL - Cambiado de `productVariantUpdate` (inexistente) a REST API para actualización de variantes
- **FIXED**: Problema con `ProductVariantInput` - Implementada solución híbrida GraphQL + REST
- **IMPROVED**: Gestión de variantes ahora usa `admin.rest.Variant` para precio y SKU

### ✨ Nuevas Características
- **NEW**: Soporte completo para Google Shopping XML format (elementos `g:*`)
- **NEW**: Detección automática de 1814+ productos en archivos XML grandes
- **NEW**: Sistema de logging filtrado para reducir ruido en consola
- **NEW**: Eliminación de logs HTTP excesivos en `entry.server.jsx`

### 🏗️ Refactoring
- **REFACTOR**: Consolidación de funciones duplicadas entre `app._index.jsx` y `xml-sync.server.js`
- **REFACTOR**: Centralización de helpers en service layer (`extractImages`, `extractTags`, `extractVariants`)
- **REFACTOR**: Implementación de `safeGraphQLCall` wrapper para mejor error handling

## v1.2.0 - 2025.11.01

### ✨ Nuevas Características
- **NEW**: Configuración de eliminación automática de productos
- **NEW**: Modelo `AutoDeleteConfig` en Prisma schema
- **NEW**: Tracking de eliminación de productos (`ProductDeletion`)
- **NEW**: Endpoint de sincronización cron `/api/sync-cron`

### 🔧 Base de Datos
- **MIGRATION**: `add_auto_delete_config` - Tabla de configuración para eliminación automática
- **MIGRATION**: `add_product_deletion_tracking` - Seguimiento de productos eliminados
- **SCHEMA**: Actualizado Prisma schema con nuevos modelos

## v1.1.0 - 2025.10.30

### ✨ Nuevas Características
- **NEW**: Servicio de sincronización XML (`xml-sync.server.js`)
- **NEW**: Parser XML con soporte para múltiples formatos
- **NEW**: Procesamiento por lotes para importación masiva
- **NEW**: Manejo de imágenes y tags desde XML

### 🔧 Infraestructura
- **MIGRATION**: `create_session_table` - Gestión de sesiones de usuario
- **MIGRATION**: `add_xml_provider_models` - Modelos para proveedores XML
- **CONFIG**: Variables de entorno para logging (`LOG_LEVEL`, `NODE_ENV`)

## v1.0.0 - 2025.10.25

### 🎉 Lanzamiento Inicial
- **BASE**: Fork de shopify-app-template-react-router
- **BASE**: Configuración inicial de Shopify App con React Router
- **BASE**: Autenticación y configuración básica de Shopify Admin API
- **BASE**: Estructura de proyecto con Vite y Prisma

---

# Historial del Template Original

## 2025.10.10

- [#95](https://github.com/Shopify/shopify-app-template-react-router/pull/95) Swap the product link for [admin intents](https://shopify.dev/docs/apps/build/admin/admin-intents).

## 2025.10.02

- [#81](https://github.com/Shopify/shopify-app-template-react-router/pull/81) Add shopify global to eslint for ui extensions

## 2025.10.01

- [#79](https://github.com/Shopify/shopify-app-template-react-router/pull/78) Update API version to 2025-10.
- [#77](https://github.com/Shopify/shopify-app-template-react-router/pull/77) Update `@shopify/shopify-app-react-router` to V1.
- [#73](https://github.com/Shopify/shopify-app-template-react-router/pull/73/files) Rename @shopify/app-bridge-ui-types to @shopify/polaris-types

## 2025.08.30

- [#70](https://github.com/Shopify/shopify-app-template-react-router/pull/70/files) Upgrade `@shopify/app-bridge-ui-types` from 0.2.1 to 0.3.1.

## 2025.08.17

- [#58](https://github.com/Shopify/shopify-app-template-react-router/pull/58) Update Shopify & React Router dependencies.  Use Shopify React Router in graphqlrc, not shopify-api
- [#57](https://github.com/Shopify/shopify-app-template-react-router/pull/57) Update Webhook API version in `shopify.app.toml` to `2025-07`
- [#56](https://github.com/Shopify/shopify-app-template-react-router/pull/56) Remove local CLI from package.json in favor of global CLI installation
- [#53](https://github.com/Shopify/shopify-app-template-react-router/pull/53) Add the Shopify Dev MCP to the template

## 2025.08.16

- [#52](https://github.com/Shopify/shopify-app-template-react-router/pull/52) Use `ApiVersion.July25` rather than `LATEST_API_VERSION` in `.graphqlrc`.

## 2025.07.24

- [14](https://github.com/Shopify/shopify-app-template-react-router/pull/14/files) Add [App Bridge web components](https://shopify.dev/docs/api/app-home/app-bridge-web-components) to the template.

## July 2025

Forked the [shopify-app-template repo](https://github.com/Shopify/shopify-app-template-remix)

# @shopify/shopify-app-template-remix

## 2025.03.18

-[#998](https://github.com/Shopify/shopify-app-template-remix/pull/998) Update to Vite 6

## 2025.03.01

- [#982](https://github.com/Shopify/shopify-app-template-remix/pull/982) Add Shopify Dev Assistant extension to the VSCode extension recommendations

## 2025.01.31

- [#952](https://github.com/Shopify/shopify-app-template-remix/pull/952) Update to Shopify App API v2025-01

## 2025.01.23

- [#923](https://github.com/Shopify/shopify-app-template-remix/pull/923) Update `@shopify/shopify-app-session-storage-prisma` to v6.0.0

## 2025.01.8

- [#923](https://github.com/Shopify/shopify-app-template-remix/pull/923) Enable GraphQL autocomplete for Javascript

## 2024.12.19

- [#904](https://github.com/Shopify/shopify-app-template-remix/pull/904) bump `@shopify/app-bridge-react` to latest
-
## 2024.12.18

- [875](https://github.com/Shopify/shopify-app-template-remix/pull/875) Add Scopes Update Webhook
## 2024.12.05

- [#910](https://github.com/Shopify/shopify-app-template-remix/pull/910) Install `openssl` in Docker image to fix Prisma (see [#25817](https://github.com/prisma/prisma/issues/25817#issuecomment-2538544254))
- [#907](https://github.com/Shopify/shopify-app-template-remix/pull/907) Move `@remix-run/fs-routes` to `dependencies` to fix Docker image build
- [#899](https://github.com/Shopify/shopify-app-template-remix/pull/899) Disable v3_singleFetch flag
- [#898](https://github.com/Shopify/shopify-app-template-remix/pull/898) Enable the `removeRest` future flag so new apps aren't tempted to use the REST Admin API.

## 2024.12.04

- [#891](https://github.com/Shopify/shopify-app-template-remix/pull/891) Enable remix future flags.

## 2024.11.26

- [888](https://github.com/Shopify/shopify-app-template-remix/pull/888) Update restResources version to 2024-10

## 2024.11.06

- [881](https://github.com/Shopify/shopify-app-template-remix/pull/881) Update to the productCreate mutation to use the new ProductCreateInput type

## 2024.10.29

- [876](https://github.com/Shopify/shopify-app-template-remix/pull/876) Update shopify-app-remix to v3.4.0 and shopify-app-session-storage-prisma to v5.1.5

## 2024.10.02

- [863](https://github.com/Shopify/shopify-app-template-remix/pull/863) Update to Shopify App API v2024-10 and shopify-app-remix v3.3.2

## 2024.09.18

- [850](https://github.com/Shopify/shopify-app-template-remix/pull/850) Removed "~" import alias

## 2024.09.17

- [842](https://github.com/Shopify/shopify-app-template-remix/pull/842) Move webhook processing to individual routes

## 2024.08.19

Replaced deprecated `productVariantUpdate` with `productVariantsBulkUpdate`

## v2024.08.06

Allow `SHOP_REDACT` webhook to process without admin context

## v2024.07.16

Started tracking changes and releases using calver
