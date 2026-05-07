# Sistema de Turnos Municipal — Villa La Angostura
# CLAUDE.md — Contexto del proyecto para Claude Code
# Branch activo: web

---

## ¿Qué es este proyecto?

Bot de WhatsApp para reservar turnos en la Municipalidad de Villa La Angostura.
Actualmente en fase de Prueba de Concepto (PoC) con número de prueba de Meta.
El motor de reservas es Easy!Appointments (self-hosted en Docker).

---

## Branches del repositorio

| Branch | Estado | Descripción |
|---|---|---|
| main | Abandonado | Versión original con Telegram (node-telegram-bot-api + polling) |
| whatsapp | Desactualizado | Primera versión WhatsApp. Superado por el branch web |
| web | ✅ Activo | Branch actual. WhatsApp + endpoints API para selector web |

Todo el desarrollo nuevo va en el branch **web**.

---

## Stack tecnológico

| Componente | Tecnología |
|---|---|
| Motor de reservas | Easy!Appointments (GPL v3.0, Docker) |
| Base de datos | MySQL 8.0 (contenedor Docker, exclusivo de Easy!Appointments) |
| Bot / Middleware | Node.js |
| Servidor web | Express.js (recibe webhooks de WhatsApp via HTTPS) |
| Canal | WhatsApp Business API (Meta, Graph API v25.0) |
| Logging | Winston + winston-daily-rotate-file (rotación diaria, 14 días) |
| Túnel local (PoC) | ngrok (reemplazar por Nginx + SSL en producción) |
| Automatización (futuro) | n8n self-hosted |
| Infraestructura | Docker + Docker Compose |

---

## Archivos principales

- `index.js` — Bot principal. Lógica conversacional, estados de sesión, webhooks de Meta, envío de mensajes via Graph API, endpoints REST para selector web.
- `ea.js` — Módulo de integración con la API REST de Easy!Appointments. El bot importa este módulo y NUNCA habla directamente con la API ni con MySQL.
- `logger.js` — Configuración de Winston para logging en consola y archivos rotativos.
- `docker-compose.yml` — Levanta Easy!Appointments + MySQL en contenedores.
- `.env` — Variables de entorno (no subir al repo).

---

## Variables de entorno requeridas (.env)

```
EA_BASE_URL=http://localhost
EA_TOKEN=mvla-turnos-2026-api-token
WHATSAPP_TOKEN=token_permanente_de_meta
WHATSAPP_PHONE_ID=id_del_numero_de_whatsapp
WHATSAPP_VERIFY_TOKEN=token_de_verificacion_webhook
WHATSAPP_APP_SECRET=secreto_de_la_app_meta
RATE_LIMIT_WHITELIST=numero1,numero2
PORT=3000
GOOGLE_SHEET_REQUISITOS_URL=url_csv_publicado_de_google_sheets
TRAMITES_HABILITADOS=2
```

---

## Configuración actual de Easy!Appointments

- URL local: http://localhost
- API Token: mvla-turnos-2026-api-token
- Servicios:
  - Licencia de Conducir (ID: 2, duración: 30 min)
  - Pago Multas (ID: 3, duración: 15 min)
- Operadores:
  - IDs 4, 5, 6 → Licencias de Conducir
  - IDs 7, 8 → Tribunal de Faltas

---

## Funciones disponibles en ea.js

Estas son las únicas funciones que el bot debe usar para interactuar con Easy!Appointments:

```javascript
obtenerServicios()                                      // Array de servicios: { id, name, duration }
obtenerProveedores()                                    // Array de operadores: { id, firstName, lastName, services[] }
obtenerDisponibilidad(serviceId, providerId, fecha)     // Array de strings: ["08:30", "09:00", ...]
obtenerDisponibilidadServicio(serviceId, fecha)         // { horariosLibres[], mapaHorarioOperador{} }
crearCita(datos)                                        // Crea cita en EA, devuelve objeto con ID asignado
cancelarCita(appointmentId)                             // Elimina cita por ID numérico
obtenerCitasDelCliente(email)                           // Citas activas buscando por email ficticio
```

Email ficticio del vecino: `dni_NUMERODNI@municipio.local`

---

## Reglas de desarrollo — CRÍTICAS

1. **Nunca conectar directamente a MySQL.** Toda interacción con Easy!Appointments pasa exclusivamente por las funciones de `ea.js`.

2. **Cal.com está descartado definitivamente.** No se menciona ni se evalúa como alternativa.

3. **El vecino nunca elige operador.** La asignación es automática: `obtenerDisponibilidadServicio()` devuelve `mapaHorarioOperador{}` que el bot usa internamente.

4. **Integración con WhatsApp exclusivamente via Graph API v25.0.** No usar librerías de terceros para WhatsApp.

5. **Los números argentinos se normalizan.** El webhook de Meta envía números con prefijo 549 (ej: 5492944123456). Se normalizan a +54 antes de enviar mensajes.

6. **Un solo archivo de módulo de integración (ea.js).** Centralizar todas las llamadas a EA en un único archivo evita tener que corregir cambios en múltiples lugares si la API cambia. No crear módulos adicionales de conexión.

7. **Comentar el "por qué" de cada bloque, no solo el "qué".** El código tiene comentarios explicativos extensos; mantener ese estilo en cualquier código nuevo.

8. **Todo el código nuevo debe comentarse en español con lenguaje simple.**

---

## Seguridad

- Verificación HMAC-SHA256 de firma Meta en cada webhook POST
- Token permanente de Meta via System User (no expira)
- Variables de entorno sensibles nunca logueadas
- Rate limiting: 15 mensajes por 60 segundos por número, con whitelist configurable
- `.env` en `.gitignore`

---

## Estados de conversación del bot (index.js)

```
INICIAL                → Sin flujo activo
ESPERANDO_DNI          → Pedimos DNI, aguardamos respuesta
ESPERANDO_NOMBRE       → DNI nuevo, pedimos nombre y apellido
MENU_GESTION           → DNI existente, mostramos menú de opciones
ESPERANDO_TRAMITE      → Elegir trámite (lista interactiva de WhatsApp)
ESPERANDO_DIA          → Elegir semana (lista interactiva)
ESPERANDO_FECHA        → Elegir día hábil (lista interactiva)
ESPERANDO_HORARIO      → Elegir horario (lista interactiva, 8 por página)
ESPERANDO_CONFIRMACION → Confirmar o cancelar el turno (botones de respuesta rápida)
ESPERANDO_CANCELACION  → Elegir qué turno cancelar (lista interactiva)
ESPERANDO_MODIFICACION → Elegir qué turno modificar (lista interactiva)
```

---

## Lógica de memoria en sesión (registrosEnProceso)

```javascript
// Objeto en memoria. Clave: chatId (wa_id normalizado). Valor: datos parciales del flujo activo.
registrosEnProceso[chatId] = {
  dni,
  nombre,
  tramite,              // nombre del trámite (string), no el índice
  fecha,                // "YYYY-MM-DD"
  serviceId,            // ID numérico del servicio en Easy!Appointments
  horario,              // string "HH:MM"
  providerId,           // ID numérico del operador asignado automáticamente
  fechaHora,            // "YYYY-MM-DD HH:MM:SS"
  fechaHoraFin,         // "YYYY-MM-DD HH:MM:SS"
  mapaHorarioOperador,  // { "08:00": 4, "09:00": 5, ... }
  esModificacion,       // true si el flujo viene de "editar_N"
  citasCancelacion,     // array de citas futuras para cancelar
  citasModificacion,    // array de citas futuras para modificar
}
```

---

## Palabras clave globales

El bot reconoce estas palabras en cualquier punto del flujo:
- `menu` → reinicia la sesión desde cero (vuelve a pedir DNI)
- `cancelar` → sale del flujo actual sin borrar turnos existentes
- `finalizar` → cierra la sesión activa

---

## Timeout de sesión

- Duración: 10 minutos (600.000 ms) de inactividad
- Función: `gestionarTimeout(chatId)` en `index.js`
- Se llama al inicio de CADA mensaje y CADA callback
- No se crea timeout si el estado es INICIAL
- Al expirar: limpia `registrosEnProceso[chatId]`, vuelve a estado INICIAL, envía aviso

---

## Límite de turnos por vecino

Un vecino no puede tener más de un turno activo por trámite. Si ya tiene un turno futuro de "Licencia de Conducir", no puede sacar otro del mismo trámite hasta que ese turno pase o lo cancele.

No hay límite total de turnos por chatId. Esto es intencional: permite que una persona gestione turnos para distintos familiares en trámites diferentes (por ejemplo, un hijo que saca turno para sus padres mayores).

---

## Funcionalidades implementadas

- Servidor Express con webhook GET (verificación Meta) y POST (mensajes entrantes)
- Verificación de firma HMAC-SHA256 en cada request de Meta
- Mensajes de texto via Graph API v25.0
- Listas interactivas para selección de trámites, semanas, días y horarios
- Botones de respuesta rápida para confirmaciones (máximo 3 botones)
- Paginación bidireccional de horarios (8 por página, máximo 10 filas por lista)
- Feriados nacionales via api.argentinadatos.com (excluidos del selector de días)
- Filtrado de turnos pasados en todos los puntos del flujo
- Truncado dinámico de títulos en listas (límite de 24 caracteres de WhatsApp)
- Mensaje de requisitos post-confirmación leído desde Google Sheets (CSV publicado)
- Filtrado de trámites habilitados via variable de entorno TRAMITES_HABILITADOS
- Endpoints REST para selector web embebible: /api/servicios, /api/disponibilidad, /api/turno

---

## Google Sheets — Requisitos de trámites

- La hoja se lee en cada confirmación (sin caché) para reflejar ediciones inmediatas
- Formato: CSV publicado públicamente desde Google Sheets
- Columna A: nombre exacto del trámite (debe coincidir con el campo `name` en EA)
- Columna B: texto de requisitos (puede contener comas y saltos de línea)
- La función `obtenerRequisitos(tramiteNombre)` maneja redirecciones 301, 302 y 307
- Falla silenciosamente con `logger.error()` si hay error; nunca interrumpe el flujo

---

## Trámites habilitados en el bot (TRAMITES_HABILITADOS)

La variable de entorno `TRAMITES_HABILITADOS` contiene una lista de IDs de servicios
de EA separados por comas. El bot solo muestra los trámites cuyo ID esté en esa lista.

Para habilitar más trámites en el futuro: agregar el ID al .env y reiniciar el bot.
No requiere cambios en el código.

Ejemplo: `TRAMITES_HABILITADOS=2,5,8`

---

## Próximos pasos técnicos

- [ ] Habilitar solo Licencia de Conducir para el MVP: en el archivo .env
      verificar que TRAMITES_HABILITADOS=2 esté configurado (solo el ID 2).
      No requiere cambios en el código, solo reiniciar el bot.
- [ ] Nginx + SSL en servidor municipal (requisito para salir del modo ngrok)
- [ ] n8n para recordatorios automáticos via Message Templates de Meta

---

## Estructura de carpetas

```
turnosMVLA/
├── index.js      ← Bot principal (WhatsApp + endpoints web)
├── ea.js         ← Módulo integración Easy!Appointments
├── logger.js     ← Configuración Winston
├── .env          ← Variables de entorno (no en repo)
├── CLAUDE.md     ← Este archivo
└── package.json
```

Easy!Appointments corre por separado en:
```
EasyAppointments/
├── docker-compose.yml
└── backup_easyappointments.sql
```

Repositorio: https://github.com/efefal/turnosMVLA
Branch activo: web

---

## Flujo de trabajo en cada sesión

1. Leer este archivo antes de empezar cualquier tarea.
2. Trabajar de a una tarea por vez sobre index.js. Es un archivo único y grande:
   si dos cambios se aplican en simultáneo sobre él, los resultados son impredecibles.
3. Después de completar cada tarea y verificar que funciona, hacer commit con mensaje descriptivo y `git push` antes de continuar.
4. Al terminar la sesión, actualizar la sección "Próximos pasos" marcando lo completado.

---

## Perfil del desarrollador

Trabajo en IT (soporte/helpdesk). No soy desarrollador de formación.
Estoy aprendiendo Node.js mientras construyo este proyecto.
**Explicar el "por qué" de la sintaxis y la lógica en los comentarios del código.**
No asumir conocimiento de patrones de diseño de software.
Todo el código nuevo debe comentarse en español con lenguaje simple.
