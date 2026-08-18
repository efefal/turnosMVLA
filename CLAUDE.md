# Sistema de Turnos Municipal — Villa La Angostura
# CLAUDE.md — Contexto del proyecto para Claude Code
# Branch activo: web

---

## ⚠️ Nota sobre documentos de planificación del proyecto

Este repositorio y el conocimiento del proyecto incluyen documentos de
planificación más viejos (`Propuesta de Proyecto...pdf`,
`plan_proyecto_turnos_v2.docx.pdf`). Esos documentos describen una etapa
**anterior** del proyecto — branch `whatsapp`, motor Easy!Appointments vía
API REST exclusivamente, `n8n` planificado, etc.

**Ese estado ya no es el actual.** El proyecto evolucionó a un motor propio
sobre el branch `web` (el HEAD real del repositorio, confirmado). Este
archivo (`CLAUDE.md`) es la fuente de verdad vigente. Si algo en los
documentos de planificación contradice lo que dice acá, **este archivo
tiene prioridad** — son decisiones posteriores, no una versión alternativa.

Existe también un documento formal actualizado equivalente a esos PDFs
viejos: `Plan_Proyecto_Turnos_v3.docx`, con el mismo nivel de detalle
institucional pero reflejando el estado real del sistema.

---

## ¿Qué es este proyecto?

Sistema de turnos municipal con tres frentes: un bot de WhatsApp para
que los vecinos reserven turnos, un selector web (embebible en el sitio
del municipio o como página independiente) con el mismo flujo de
reserva pero en formato de formulario, y un panel web interno para que
los empleados municipales gestionen la agenda, bloqueos, usuarios y
áreas.

El selector web y el bot de WhatsApp comparten el mismo motor de
reservas (`motor.js`) y los mismos endpoints de disponibilidad — un
turno reservado por un canal se refleja de inmediato en el otro.

Actualmente en fase de Prueba de Concepto (PoC) con número de prueba de
Meta para el bot. El panel de empleados está en uso en ambiente local
de desarrollo.

---

## Branches del repositorio

| Branch | Estado | Descripción |
|---|---|---|
| main | Abandonado | Versión original con Telegram (node-telegram-bot-api + polling) |
| whatsapp | Desactualizado | Primera versión WhatsApp + Easy!Appointments vía API. Superado por `web` |
| web | ✅ Activo (HEAD) | Branch actual. WhatsApp + motor propio + panel de empleados |
| web-worktree | Auxiliar | Worktree de git, no es un branch de desarrollo independiente |
| claude/* | Sesiones de Claude Code | Branches temporales generados por herramientas de Claude Code |

Todo el desarrollo nuevo va en el branch **web**.

---

## Arquitectura actual — motor propio (reemplaza Easy!Appointments)

El sistema **ya no usa Easy!Appointments como motor de reservas activo**.
`motor.js` es el motor propio que reemplaza esa capa, con conexión
directa a MySQL a través de `db.js`.

```
motor.js — exporta las mismas funciones que ea.js tenía, con las mismas
firmas y formatos de retorno (mismo contrato), pero implementadas con
queries SQL directas en lugar de llamadas a la API REST de EA:

  obtenerServicios()
  obtenerProveedores()
  obtenerDisponibilidad(serviceId, providerId, fecha)
  obtenerDisponibilidadServicio(serviceId, fecha)
  crearCita(datos)
  cancelarCita(appointmentId)
  obtenerCitasDelCliente(email)
```

`ea.js` sigue presente en el repositorio y documentado como en uso —
no confirmado al 100% si todavía se invoca en algún flujo o quedó como
código legado. **Antes de modificar o eliminar `ea.js`, confirmar con
el usuario si sigue en uso.**

**Regla actualizada:** la restricción de "nunca conectar directamente a
MySQL" ya NO aplica de forma absoluta. `db.js`/`motor.js` conectan
directo a MySQL por diseño. Lo que sigue vigente es no crear módulos de
conexión adicionales por fuera de `db.js` — centralizar el pool ahí.

---

## Panel de empleados (public/panel/)

Interfaz web para operadores, encargados, directivos y administradores
del sistema ("sistemas"). 9 páginas HTML, todas con diseño unificado
bajo un design system propio.

```
public/panel/
├── login.html            — autenticación (sin sidebar)
├── cambiar-clave.html    — cambio de contraseña obligatorio (sin sidebar)
├── agenda.html           — calendario día/semana/mes, la pantalla más usada
├── presencial.html       — carga de turnos presenciales (formulario multi-paso)
├── bloqueos.html         — bloqueo de días/horarios por oficina u operador
├── dashboard.html        — KPIs, gráficos, analíticas
├── auditoria.html        — log de acciones del sistema con filtros
├── usuarios.html         — ABM de usuarios y horarios (rol sistemas)
└── servicios-admin.html  — ABM de servicios/trámites (rol sistemas)
```

**Design system:** `public/assets/design-tokens.css` — variables CSS
(colores, tipografía, espaciado, componentes). Todo el CSS de las 9
páginas usa exclusivamente estas variables, sin colores hardcodeados.
Fuentes: Outfit (UI) + DM Mono (números/horarios). Tema dark único
por ahora (light mode no implementado).

**Regla de oro para cualquier cambio visual:** nunca hardcodear un
color o tamaño. Si `design-tokens.css` no tiene la variable que hace
falta, agregarla ahí primero.

**Autenticación del panel:** login por `usuario` (nombre de usuario, no
email — ver "Migración email → usuario" en Próximos pasos técnicos) +
password. JWT guardado en `sessionStorage` (no `localStorage`, para que
la sesión expire al cerrar el navegador). Keys: `panel_token`,
`panel_usuario`. Flag `debe_cambiar_clave` fuerza redirección a
`cambiar-clave.html` en el primer login.

**Excepción intencional — `localStorage`:** el toggle de dark/light
mode (ver sección de próximos pasos completados) usa
`localStorage.panel_tema` (`'light'` o `'dark'`). Es el único uso de
`localStorage` en el panel, y es intencional: a diferencia del JWT,
el tema es una preferencia de usuario, no un dato de sesión — tiene
que sobrevivir al cierre del navegador en vez de expirar con él. No
es un error ni una inconsistencia con la regla de arriba.

**Roles:** `operador`, `encargado`, `directivo`, `sistemas` (máximo
privilegio). El rol NO está en la tabla `usuarios` — está en la tabla
`usuario_areas` (un usuario puede tener distinto rol en distintas
áreas). Columna `atiende_turnos` (boolean) distingue encargados que
atienden turnos de los que solo administran.

---

## Esquema de base de datos (motor_turnos)

```
areas            — Licencias de Conducir, Tribunal de Faltas, etc.
auditoria        — log de acciones del sistema
bloqueos         — bloqueos de oficina o de operador individual
feriados         — feriados nacionales/locales
horarios         — disponibilidad de cada operador por servicio
servicios        — trámites disponibles (con area_id, duracion_min, mensaje_confirmacion)
turnos           — reservas (fecha, hora_inicio, estado, operador_id, vecino asociado)
usuario_areas    — junction table: usuario_id + area_id + rol + atiende_turnos
usuarios         — id, nombre, usuario, password_hash, activo, debe_cambiar_clave
vecinos          — id, dni, nombre, telefono, canal_registro
```

**IMPORTANTE — IDs de servicios reales (no confundir con los viejos de EA):**

```
1 = Nueva Licencia
2 = Pago de Multas
3 = Renovación de Licencia
```

Los documentos de planificación viejos mencionan "Licencia ID:2,
Pago Multas ID:3" — esos eran los IDs de Easy!Appointments, **ya no
corresponden**. Usar siempre los IDs reales de la tabla `servicios`
del motor propio. Este mismatch ya causó un bug real (badges de
servicio mal mapeados en el panel) — verificar contra la base antes
de hardcodear cualquier ID de servicio en código nuevo.

**Charset:** el pool de `db.js` fuerza `charset: 'utf8mb4'`. Si se
insertan datos con caracteres especiales (tildes, ñ) fuera de la
aplicación (por ejemplo, ejecutando un `.sql` con un cliente que no
declare utf8mb4), pueden corromperse — ya ocurrió una vez con el seed
inicial de `servicios` y `areas`, corregido en el commit `4e64853`.

---

## Archivos principales

- `index.js` — Bot principal. Lógica conversacional, estados de sesión,
  webhooks de Meta, envío de mensajes via Graph API.
- `ea.js` — Módulo de integración con la API REST de Easy!Appointments.
  Documentado como en uso; confirmar antes de modificar o eliminar.
- `motor.js` — Motor de reservas propio, conexión directa a MySQL.
  Mismo contrato de funciones que `ea.js`.
- `db.js` — Pool de conexión MySQL (mysql2/promise), usado por
  `motor.js` y por scripts de administración.
- `logger.js` — Configuración de Winston para logging en consola y
  archivos rotativos.
- `routes/panel.js` — Endpoints REST del panel de empleados (agenda,
  turnos, usuarios, bloqueos, auditoría, etc.)
- `routes/publico.js` — Endpoints públicos usados por el selector web
  (`presencial.html` y la web de reserva del vecino).
- `docker-compose.yml` — Levanta Easy!Appointments + MySQL en
  contenedores (verificar si sigue en uso activo o quedó legado junto
  con `ea.js`).
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
TRAMITES_HABILITADOS=2

MOTOR_DB_HOST=localhost
MOTOR_DB_PORT=3306
MOTOR_DB_USER=motor_user
MOTOR_DB_PASSWORD=
MOTOR_DB_NAME=motor_turnos
```

Nota: `GOOGLE_SHEET_REQUISITOS_URL` ya no es necesaria — ver sección
"Google Sheets" más abajo, esa funcionalidad fue reemplazada.

---

## Funciones disponibles en ea.js (documentado como en uso)

```javascript
obtenerServicios()                                      // Array de servicios: { id, name, duration }
obtenerProveedores()                                    // Array de operadores: { id, firstName, lastName, services[] }
obtenerDisponibilidad(serviceId, providerId, fecha)     // Array de strings: ["08:30", "09:00", ...]
obtenerDisponibilidadServicio(serviceId, fecha)         // { horariosLibres[], mapaHorarioOperador{} }
crearCita(datos)                                        // Crea cita en EA, devuelve objeto con ID asignado
cancelarCita(appointmentId)                             // Elimina cita por ID numérico
obtenerCitasDelCliente(email)                           // Citas activas buscando por email ficticio
```

Email ficticio del vecino (patrón LEGADO — ya no necesario):
`dni_NUMERODNI@municipio.local`

**Contexto histórico:** Easy!Appointments no ofrecía un campo nativo de
"DNI" para identificar al contribuyente, así que el campo `email` se
reutilizaba con este formato como identificador indirecto.

**Confirmado (2026-07-08):** la tabla `vecinos` del motor propio ya
tiene una columna `dni` real (`varchar(15)`, `UNIQUE`). Este patrón de
email ficticio **ya no es necesario** y no debe replicarse en código
nuevo — identificar al vecino directamente por `vecinos.dni`.

Si aparece código que sigue generando o parseando este formato de
email, es candidato a limpieza/refactor, no a mantenimiento.

`motor.js` implementa el mismo contrato de funciones sobre MySQL directo.

---

## Reglas de desarrollo — CRÍTICAS

1. **Centralizar la conexión a MySQL en `db.js`.** No crear pools o
   conexiones adicionales en otros archivos.

2. **Cal.com está descartado definitivamente.** No se menciona ni se
   evalúa como alternativa.

3. **El vecino nunca elige operador.** La asignación es automática:
   `obtenerDisponibilidadServicio()` devuelve `mapaHorarioOperador{}`
   que el bot usa internamente.

4. **Integración con WhatsApp exclusivamente via Graph API v25.0.** No
   usar librerías de terceros para WhatsApp.

5. **Los números argentinos se normalizan.** El webhook de Meta envía
   números con prefijo 549 (ej: 5492944123456). Se normalizan a +54
   antes de enviar mensajes.

6. **Panel de empleados: vanilla JS puro, sin frameworks.** No usar
   React, JSX, ni ES6 modules en `public/panel/`. Toda la lógica es
   fetch + manipulación directa del DOM.

7. **Panel de empleados: cero colores hardcodeados.** Todo estilo
   nuevo usa variables de `design-tokens.css`.

8. **No tocar lógica de negocio al hacer cambios visuales.** En el
   panel, distinguir siempre entre funciones de renderizado (HTML/CSS,
   modificables) y lógica de negocio (fetch, auth, cálculo de estados,
   nunca modificar sin que se pida explícitamente).

9. **Comentar el "por qué" de cada bloque, no solo el "qué".** El
   código tiene comentarios explicativos extensos; mantener ese estilo
   en cualquier código nuevo.

10. **Todo el código nuevo debe comentarse en español con lenguaje
    simple.**

11. **Identificar al vecino por `vecinos.dni` directamente.** No usar
    el patrón de email ficticio en código nuevo (ver sección de
    funciones de `ea.js` arriba).

---

## Seguridad

- Verificación HMAC-SHA256 de firma Meta en cada webhook POST
- Token permanente de Meta via System User (no expira)
- Variables de entorno sensibles nunca logueadas
- Rate limiting: 15 mensajes por 60 segundos por número, con whitelist
  configurable
- `.env` en `.gitignore`
- JWT en `sessionStorage` para el panel (expira al cerrar navegador)

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
  serviceId,            // ID numérico del servicio (ver tabla real de IDs arriba)
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
- Al expirar: limpia `registrosEnProceso[chatId]`, vuelve a estado
  INICIAL, envía aviso

---

## Límite de turnos por vecino

Un vecino no puede tener más de un turno activo por trámite. Si ya
tiene un turno futuro de "Licencia de Conducir", no puede sacar otro
del mismo trámite hasta que ese turno pase o lo cancele.

No hay límite total de turnos por chatId. Esto es intencional: permite
que una persona gestione turnos para distintos familiares en trámites
diferentes.

**Pendiente:** límite de turnos por chatId como medida anti-abuso —
identificado como mejora a implementar antes del lanzamiento, prioridad
baja al ritmo actual de uso.

---

## Recordatorios automáticos — YA implementado, sin n8n

Los recordatorios de WhatsApp (08:00 y 18:00) están implementados con
`setTimeout` recursivo en `cron.js`, sin depender de n8n. La
dependencia de n8n fue evaluada y **descartada** — no está en el
stack activo. Los documentos de planificación viejos la listan como
"planificada"; ese plan cambió.

---

## Funcionalidades implementadas — bot de WhatsApp

- Servidor Express con webhook GET (verificación Meta) y POST
  (mensajes entrantes)
- Verificación de firma HMAC-SHA256 en cada request de Meta
- Mensajes de texto via Graph API v25.0
- Listas interactivas para selección de trámites, semanas, días y
  horarios
- Botones de respuesta rápida para confirmaciones (máximo 3 botones)
- Paginación bidireccional de horarios (8 por página, máximo 10 filas
  por lista)
- Feriados nacionales via api.argentinadatos.com (excluidos del
  selector de días)
- Filtrado de turnos pasados en todos los puntos del flujo
- Truncado dinámico de títulos en listas (límite de 24 caracteres de
  WhatsApp)
- Filtrado de trámites habilitados via variable de entorno
  TRAMITES_HABILITADOS
- Endpoints REST para selector web embebible

---

## Google Sheets — Requisitos de trámites (DESACTIVADO)

**Ya no está activo.** Al migrar a motor propio, esta funcionalidad se
incorporó directamente a la base de datos y al panel: la columna
`mensaje_confirmacion` de la tabla `servicios` cumple ahora ese rol,
editable desde `servicios-admin.html` sin depender de un servicio
externo.

Lo que sigue documentado abajo es el mecanismo viejo, que ya no se usa
— se deja como referencia histórica por si aparece código muerto que
todavía lo invoque:

- La hoja se leía en cada confirmación (sin caché) para reflejar
  ediciones inmediatas
- Formato: CSV publicado públicamente desde Google Sheets
- Columna A: nombre exacto del trámite (debía coincidir con el campo
  `name` del servicio)
- Columna B: texto de requisitos
- La función `obtenerRequisitos(tramiteNombre)` manejaba redirecciones
  301, 302 y 307
- Fallaba silenciosamente con `logger.error()` si había error

**Si aparece `GOOGLE_SHEET_REQUISITOS_URL` en `.env` o una llamada a
`obtenerRequisitos()` en código activo, señalarlo** — es candidato a
limpieza, no a mantenimiento.

---

## Trámites habilitados en el bot (TRAMITES_HABILITADOS)

La variable de entorno `TRAMITES_HABILITADOS` contiene una lista de
IDs de servicios separados por comas (ver tabla real de IDs arriba,
sección de base de datos). El bot solo muestra los trámites cuyo ID
esté en esa lista.

Para habilitar más trámites en el futuro: agregar el ID al .env y
reiniciar el bot. No requiere cambios en el código.

---

## Funcionalidades implementadas — panel de empleados

- Login con JWT, roles por área, cambio de contraseña forzado en
  primer ingreso
- Agenda con vista día/semana/mes, toma/liberación de turnos,
  cambio de estado (presente/ausente)
- Polling automático cada 10s en la agenda, con diffing (no
  re-renderiza si no hay cambios) y pausa cuando la pestaña no está
  visible o hay un modal abierto
- Carga de turnos presenciales (formulario multi-paso con stepper)
- Bloqueos de oficina o de operador individual, por día u horario
- Dashboard con KPIs, gráficos, analíticas
- Auditoría con log de acciones y filtros
- ABM de usuarios (rol sistemas): alta, edición, horarios, reset de
  contraseña
- ABM de servicios (rol sistemas)
- Turnos superpuestos en la misma franja: se dividen horizontalmente
  en lugar de superponerse (fix en commits `721f16a`, `e7da473`)

---

## Próximos pasos técnicos

- [ ] Resolver legibilidad de cards con 4+ turnos superpuestos en
      vista semana del panel (limitación conocida, documentada en
      código — ver commit `e7da473`)
- [ ] Buscador global del panel (`search-global`) — actualmente
      decorativo, sin funcionalidad conectada. Debe quedar funcional
      en las 7 páginas del panel que tienen sidebar/topbar (agenda,
      presencial, bloqueos, dashboard, auditoria, usuarios,
      servicios-admin), no exclusivamente en agenda.html
- [x] ABM de áreas en el panel (rol sistemas) — implementado
      (`public/panel/areas.html` + endpoints `GET /panel/areas/admin`,
      `POST /panel/areas`, `PATCH /panel/areas/:id` en `routes/panel.js`).
      Link "Áreas" agregado al sidebar de las 7 páginas existentes,
      visible solo para rol sistemas. Sin DELETE real (soft-delete via
      `activo`, mismo patrón que servicios/usuarios).
- [x] Vista de detalle de turno — implementado como modal en
      `agenda.html` (`#modal-detalle-fondo`), reusando
      `.modal-fondo`/`.modal-caja` con el modificador
      `.modal-caja-detalle`. Muestra turno + datos de contacto del
      vecino (nombre, DNI, teléfono con botón "Copiar" — no hay
      columna de email en `vecinos`) + historial de los últimos 10
      turnos del mismo vecino. Se abre desde: click en card de turno
      (vista semana y vista día) y desde la selección de un resultado
      del buscador global (que además navega a la vista día y resalta
      la card antes de abrir el modal). Endpoint nuevo:
      `GET /panel/turno/:id/completo`, acceso abierto a cualquier rol
      autenticado con validación de área. Ver
      `public/panel/REDESIGN_DETALLE_TURNO.md` para el detalle completo.
      **Acciones de comunicación (WhatsApp/email) quedan para una fase
      futura** — el modal ya tiene una sección "Comunicación" reservada
      en el layout a modo de placeholder, para no tener que rediseñar
      el modal cuando se implementen los botones reales.
- [x] Dark/Light mode toggle en el panel — implementado en las 10
      páginas (`data-theme="light"` en `<html>`, paleta completa en
      `:root[data-theme="light"]` de `design-tokens.css`, persistencia
      en `localStorage.panel_tema`). Botón "Modo claro"/"Modo oscuro"
      en `sidebar-footer` (páginas con sidebar) o dentro de la card
      (`login.html`, `cambiar-clave.html`, que no tienen sidebar).
      **Limitación conocida:** los gráficos SVG de `dashboard.html`
      (`COLORES_CANAL`, `COLORES_ESTADO`, `svgBarras()`) tienen su
      propio sistema de color al margen de `design-tokens.css` y no
      reaccionan al cambio de tema — ver `REDESIGN_DARKMODE.md`
      (categoría D) para el detalle y una eventual Fase 2.
- [x] Migración email → usuario en autenticación del panel —
      completada. Columna `email` de `usuarios` eliminada por completo
      (no quedó como columna opcional); reemplazada por `usuario`
      (varchar(50), NOT NULL, UNIQUE, formato `^[a-z0-9][a-z0-9._]{2,49}$`,
      normalizado a lowercase). Migración en 4 pasos con backup manual
      previo al DROP — ver `public/panel/REDESIGN_USUARIO_LOGIN.md`
      para el detalle completo (mapeo de los 18 usuarios reales, los 2
      casos de colisión resueltos con override manual — `sistemas` para
      la cuenta real, `sistemas.demo` para la de seed/demo — y los
      checkpoints de verificación de cada paso). Afectó: `routes/auth.js`
      (login, JWT), `routes/panel.js` (alta, listados, auditoría, reset
      de clave), `public/panel/login.html` y `usuarios.html`,
      `admin/crear-usuario.js`, `scripts/seed-demo.js`, `test-panel.js`.
      **No relacionado y no tocado:** el email ficticio de `vecinos`
      (`dni_NUMERODNI@municipio.local`, usado en `motor.js`/`ea.js` vía
      `obtenerCitasDelCliente(email)`) es un mecanismo completamente
      distinto para identificar vecinos ante Easy!Appointments — sigue
      existiendo igual que antes, esta migración fue exclusiva de la
      tabla `usuarios` (empleados del panel).
- [ ] Nginx + SSL en servidor municipal (requisito para salir del modo
      de pruebas del bot)
- [ ] Migración al número oficial del municipio en Meta
- [ ] Verificación de Meta Business Portfolio
- [ ] Límite de turnos por chatId (anti-abuso, prioridad baja)
- [ ] Fase 7 (futuro): módulo de cola presencial — kiosco, TV,
      Socket.io, impresora térmica

---

## Estructura de carpetas

```
turnosMVLA/
├── index.js           ← Bot principal (WhatsApp + endpoints web)
├── ea.js               ← Módulo integración Easy!Appointments (confirmar uso)
├── motor.js             ← Motor de reservas propio (MySQL directo)
├── db.js                ← Pool de conexión MySQL
├── cron.js              ← Recordatorios automáticos (setTimeout recursivo)
├── logger.js             ← Configuración Winston
├── routes/
│   ├── panel.js          ← Endpoints del panel de empleados
│   └── publico.js         ← Endpoints públicos (selector web)
├── public/
│   ├── panel/              ← Las 9 páginas HTML del panel de empleados
│   └── assets/
│       ├── design-tokens.css        ← Design system del panel
│       └── design_handoff_sistema_turnos/  ← Especificación de diseño (README, mockups)
├── .env                  ← Variables de entorno (no en repo)
├── CLAUDE.md               ← Este archivo
└── package.json
```

Repositorio: https://github.com/efefal/turnosMVLA
Branch activo: web

---

## Flujo de trabajo en cada sesión

1. Leer este archivo antes de empezar cualquier tarea.
2. Trabajar de a una tarea por vez. Si el archivo es grande (`index.js`,
   los HTML del panel), dos cambios simultáneos sobre el mismo archivo
   dan resultados impredecibles.
3. Para cambios visuales en el panel: siempre plan primero (documento
   `REDESIGN_*.md`), aprobación, después ejecución paso a paso con un
   commit por paso.
4. Después de completar cada tarea y verificar que funciona, hacer
   commit con mensaje descriptivo y `git push` antes de continuar.
5. Al terminar la sesión, actualizar la sección "Próximos pasos"
   marcando lo completado.

---

## Perfil del desarrollador

Trabajo en IT (soporte/helpdesk) en la Dirección de Sistemas e
Informática de la Municipalidad de Villa La Angostura. No soy
desarrollador de formación. Estoy aprendiendo Node.js mientras
construyo este proyecto ("vibecoding": Claude Chat + Claude Code).

**No uso Cursor.** Todo el desarrollo se hace con Claude Chat
(claude.ai) para la iteración y Claude Code para la ejecución.

**Explicar el "por qué" de la sintaxis y la lógica en los comentarios
del código.** No asumir conocimiento de patrones de diseño de software.
Todo el código nuevo debe comentarse en español con lenguaje simple.

## Flujo de trabajo real (Claude Chat + Claude Code)

1. En Claude Chat, converso en lenguaje natural sobre el requerimiento,
   modificación o problema que estoy encarando — sin necesidad de
   saber de antemano la solución técnica exacta.
2. Una vez que el requerimiento está claro, Claude Chat redacta el
   prompt completo y estructurado para Claude Code (con reglas,
   contexto, pasos de verificación).
3. Copio ese prompt y se lo paso a Claude Code, que ejecuta el
   desarrollo real sobre el repositorio.
4. Vuelvo a Claude Chat con el resultado/reporte de Claude Code para
   validarlo antes de avanzar al siguiente paso.

Este mismo documento (`CLAUDE.md`) es lo que Claude Code lee al
iniciar cada sesión — mantenerlo actualizado es parte del flujo, no
un paso opcional.
