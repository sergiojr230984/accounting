# CRM La Cuevita Furniture

CRM web para gestionar los leads que llegan por WhatsApp a las vendedoras,
verlos en un panel centralizado y asignarlos manual o automáticamente.

Está construido como un módulo dentro de la app Next.js existente, reutilizando
su autenticación, base de datos y diseño. Comparte stack con el módulo de
contabilidad pero es independiente: las vendedoras solo ven el CRM.

---

## 1. Stack

| Capa            | Tecnología                                  |
|-----------------|---------------------------------------------|
| Frontend        | Next.js 15 (App Router) + React + Tailwind  |
| Backend         | Next.js API Routes (Node.js)                |
| Base de datos   | PostgreSQL                                  |
| ORM             | Prisma                                      |
| Autenticación   | NextAuth (JWT) con credenciales             |
| WhatsApp        | Meta WhatsApp Business Cloud API            |
| Gráficas        | Recharts                                    |

---

## 2. Estructura del módulo CRM

```
app/
├─ (dashboard)/crm/
│  ├─ dashboard/page.tsx        # Panel con métricas y gráficas
│  ├─ leads/page.tsx            # Tabla de leads + filtros + alta + asignación
│  ├─ leads/[id]/page.tsx       # Detalle: conversación, notas, estado, reasignar
│  └─ team/page.tsx             # Vendedoras + modo de asignación (admin)
└─ api/crm/
   ├─ leads/route.ts                  # GET lista (con filtros) / POST crear
   ├─ leads/[id]/route.ts             # GET detalle / PATCH actualizar
   ├─ leads/[id]/assign/route.ts      # POST asignar/reasignar (manual o auto)
   ├─ leads/[id]/messages/route.ts    # POST enviar mensaje de WhatsApp
   ├─ metrics/route.ts                # GET métricas del panel
   ├─ salespeople/route.ts            # GET lista / POST crear vendedora
   ├─ salespeople/[id]/route.ts       # PATCH editar vendedora
   ├─ settings/route.ts               # GET/PATCH modo de asignación
   └─ webhook/route.ts                # GET verificación / POST mensajes entrantes

components/
├─ Sidebar.tsx          # Navegación (CRM + Contabilidad según rol)
├─ LeadStatusBadge.tsx  # Badge de estado del lead
└─ PriorityBadge.tsx    # Badge de prioridad

lib/
├─ crm.ts          # Permisos por rol, asignación, round-robin
├─ whatsapp.ts     # Cliente de WhatsApp Cloud API + parser del webhook
└─ prisma.ts       # Cliente Prisma compartido

prisma/schema.prisma  # Modelos Lead, LeadMessage, LeadAssignment, CrmSetting
```

---

## 3. Modelo de datos (Prisma)

- **User** — usuarios del sistema. Roles: `ADMIN`, `MANAGER`, `SALES` (vendedora).
  Las vendedoras tienen `whatsappNumber` y `whatsappPhoneNumberId` (id del número
  en Meta, usado para saber a quién le escribió el cliente).
- **Lead** — prospecto. Tiene nombre, teléfono (único, anti-duplicados), estado,
  prioridad, origen, vendedora asignada, notas, fecha de entrada, último mensaje
  y próxima fecha de seguimiento.
- **LeadMessage** — cada mensaje del historial (`INBOUND` / `OUTBOUND`), con
  `waMessageId` único para deduplicar webhooks reenviados por Meta.
- **LeadAssignment** — auditoría de cambios de asignación (de quién a quién, por
  quién y por qué motivo).
- **CrmSetting** — fila única con el modo de asignación (`MANUAL` / `ROUND_ROBIN`)
  y el puntero de rotación.

### Estados del lead
`NEW` (Nuevo) → `CONTACTED` (Contactado) → `FOLLOW_UP` (En seguimiento) →
`CLOSED` (Cerrado / ganado) o `LOST` (Perdido).

---

## 4. Roles y permisos

| Acción                                | ADMIN / MANAGER | SALES (vendedora) |
|---------------------------------------|:---------------:|:-----------------:|
| Ver todos los leads                   | ✅              | Solo los suyos    |
| Filtrar por vendedora                 | ✅              | —                 |
| Crear / actualizar estado y notas     | ✅              | Solo los suyos    |
| Enviar mensajes de WhatsApp           | ✅              | Solo los suyos    |
| Asignar / reasignar leads             | ✅              | ❌                |
| Crear / editar vendedoras             | Solo ADMIN      | ❌                |
| Cambiar modo de asignación            | Solo ADMIN      | ❌                |

El alcance se aplica en cada endpoint (ver `leadScopeWhere` en `lib/crm.ts`) y la
navegación de contabilidad se oculta a las vendedoras.

---

## 5. Instalación y ejecución local

### Requisitos
- Node.js 18+
- PostgreSQL (local o en Supabase/Railway/Render)

### Pasos

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
#   Edita .env y pon tu DATABASE_URL y AUTH_SECRET.
#   Genera un AUTH_SECRET con:  openssl rand -base64 32

# 3. Crear el esquema en la base de datos
npm run db:push          # o  npm run db:migrate  para migraciones versionadas

# 4. Cargar datos de demo (admin + 3 vendedoras + leads de ejemplo)
npm run db:seed

# 5. Arrancar en desarrollo
npm run dev
#   Abre http://localhost:3000
```

### Credenciales de demo

| Rol             | Email                  | Contraseña |
|-----------------|------------------------|------------|
| Admin CRM       | admin@lacuevita.com    | admin123   |
| Vendedora (Ana) | ana@lacuevita.com      | ventas123  |
| Vendedora (Brenda) | brenda@lacuevita.com | ventas123  |
| Vendedora (Carla) | carla@lacuevita.com  | ventas123  |

> El CRM funciona completo **sin WhatsApp** (alta manual de leads, asignación,
> estados, notas, métricas). La integración de WhatsApp es opcional y se activa
> con las variables de entorno de la sección siguiente.

---

## 6. Variables de entorno

```bash
DATABASE_URL=postgresql://...        # Conexión a PostgreSQL
AUTH_SECRET=...                      # Secreto de NextAuth (openssl rand -base64 32)
NEXTAUTH_URL=http://localhost:3000   # URL pública de la app

# WhatsApp Business Cloud API (Meta) — opcional
WHATSAPP_TOKEN=...                   # Token permanente del System User
WHATSAPP_PHONE_NUMBER_ID=...         # phone_number_id por defecto para enviar
WHATSAPP_VERIFY_TOKEN=cuevita-...    # Cadena secreta que tú inventas
WHATSAPP_API_VERSION=v21.0           # (opcional)
```

---

## 7. Conectar WhatsApp Business API (Meta Cloud API)

### a) Crear la app en Meta
1. Entra a [developers.facebook.com](https://developers.facebook.com) → **My Apps**
   → **Create App** → tipo **Business**.
2. Agrega el producto **WhatsApp**. Meta te da un número de prueba y un
   `phone_number_id` para empezar.

### b) Obtener el token permanente
1. En **Meta Business Suite → Configuración → Usuarios → Usuarios del sistema**,
   crea un System User y genera un token con permisos
   `whatsapp_business_messaging` y `whatsapp_business_management`.
2. Ese token va en `WHATSAPP_TOKEN`.

### c) Configurar el webhook
1. Despliega la app (Vercel) para tener una URL pública **HTTPS**. Para probar en
   local usa un túnel como `ngrok http 3000`.
2. En el panel de WhatsApp → **Configuration → Webhook**, pon:
   - **Callback URL**: `https://TU-DOMINIO/api/crm/webhook`
   - **Verify token**: el mismo valor que pusiste en `WHATSAPP_VERIFY_TOKEN`.
3. Meta hará un `GET` de verificación; nuestro endpoint responde el `challenge`
   automáticamente si el token coincide.
4. Suscríbete al campo **`messages`** para recibir los mensajes entrantes.

### d) Identificar a cada vendedora
Cada vendedora tiene un número de WhatsApp distinto. En Meta, cada número tiene su
propio `phone_number_id`. En **Vendedoras → editar**, pon ese `phone_number_id` en
el campo correspondiente. Así, cuando un cliente escribe al número de Ana, el
webhook detecta el `phone_number_id` destino y asigna el lead a Ana
automáticamente.

> Si el mensaje llega a un número sin vendedora mapeada, el lead se asigna por
> **rotación automática** (round-robin) entre las vendedoras activas, siempre que
> el modo de asignación esté en *Rotación automática* (Vendedoras → configuración).

### e) Flujo de un mensaje entrante
```
Cliente escribe por WhatsApp
        │
        ▼
Meta → POST /api/crm/webhook
        │
        ├─ ¿Mensaje ya guardado? (waMessageId)  → se ignora (dedupe)
        ├─ ¿Teléfono ya es un lead?  → reutiliza el lead (anti-duplicados)
        │   └─ si no, crea el lead (estado NEW, origen WHATSAPP)
        ├─ Guarda el mensaje INBOUND + actualiza "último mensaje"
        └─ Asigna vendedora:
             • por phone_number_id destino, o
             • por round-robin si está activado
```

---

## 8. Despliegue

- **Frontend + API**: Vercel (un solo proyecto Next.js).
- **Base de datos**: Supabase, Railway o Render (PostgreSQL).
- Configura las mismas variables de entorno en el panel del proveedor.
- Tras desplegar, ejecuta `npm run db:push` (o `db:migrate deploy`) y opcionalmente
  `npm run db:seed` contra la base de datos de producción.
- Recuerda registrar la **Callback URL** del webhook con tu dominio de producción.

---

## 9. Resumen de endpoints

| Método | Ruta                                | Descripción                          |
|--------|-------------------------------------|--------------------------------------|
| GET    | `/api/crm/leads`                    | Lista de leads (filtros + por rol)   |
| POST   | `/api/crm/leads`                    | Crear lead manual                    |
| GET    | `/api/crm/leads/:id`                | Detalle con conversación e historial |
| PATCH  | `/api/crm/leads/:id`                | Actualizar estado/prioridad/notas    |
| POST   | `/api/crm/leads/:id/assign`         | Asignar/reasignar (manual o auto)    |
| POST   | `/api/crm/leads/:id/messages`       | Enviar mensaje de WhatsApp           |
| GET    | `/api/crm/metrics`                  | Métricas del panel                   |
| GET    | `/api/crm/salespeople`              | Lista de vendedoras                  |
| POST   | `/api/crm/salespeople`              | Crear vendedora (admin)              |
| PATCH  | `/api/crm/salespeople/:id`          | Editar vendedora (admin)             |
| GET/PATCH | `/api/crm/settings`              | Modo de asignación                   |
| GET    | `/api/crm/webhook`                  | Verificación del webhook (Meta)      |
| POST   | `/api/crm/webhook`                  | Recepción de mensajes (Meta)         |
