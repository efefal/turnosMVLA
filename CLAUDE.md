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
Meta para el bot. El panel de empleados fue sometido a una ronda extensa
de pruebas manuales con datos reales en ambiente local (ver sección
"Ronda de pruebas manuales" más abajo) y está considerablemente más
maduro que en revisiones anteriores de este documento.

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

## ⚠️ REGLA CRÍTICA — Filtrado de área en endpoints nuevos

**Cualquier endpoint que filtre datos por área debe usar
`resolverAreaIds(req, ...)`, nunca `req.usuario.areaIds` crudo.** El uso
directo del array del JWT ignora el bypass que necesita el rol
`sistemas` (acceso a todas las áreas sin restricción).

Este patrón de bug apareció de forma **idéntica 4 veces** en una sola
ronda de pruebas manuales con datos reales (`/panel/servicios`,
`/panel/feriados-bloqueos`, `/panel/operadores`, y el filtro del
buscador global) — estaba latente desde antes de esa sesión, oculto
porque los datos de prueba anteriores siempre le daban acceso total al
usuario `sistemas` por casualidad (todas las áreas asignadas de
entrada). Un reset de la base con un usuario `sistemas` realista (sin
todas las áreas preasignadas) fue lo que expuso el problema.

**Antes de agregar un endpoint nuevo con lógica de filtrado por área,
verificar explícitamente contra este patrón** — ya sea reusando
`resolverAreaIds()` o, si el caso es genuinamente distinto, dejar
documentado por qué no aplica.

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
├── servicios-admin.html  — ABM de servicios/trámites (rol sistemas)
└── areas.html            — ABM de áreas municipales (rol sistemas)
```

**Design system:** `public/assets/design-tokens.css` — variables CSS
(colores, tipografía, espaciado, componentes). Todo el CSS de las 9
páginas usa exclusivamente estas variables, sin colores hardcodeados.
Fuentes: Outfit (UI) + DM Mono (números/horarios). **Dark/Light mode
implementado** (ver sección propia más abajo).

**Regla de oro para cualquier cambio visual:** nunca hardcodear un
color o tamaño. Si `design-tokens.css` no tiene la variable que hace
falta, agregarla ahí primero.

**Autenticación del panel:** JWT guardado en `sessionStorage` (no
`localStorage`, para que la sesión expire al cerrar el navegador). Keys:
`panel_token`, `panel_usuario`. Flag `debe_cambiar_clave` fuerza
redirección a `cambiar-clave.html` en el primer login. JWT con
expiración de 1 hora — sesiones largas de trabajo pueden requerir
volver a loguearse.

**Roles:** `operador`, `encargado`, `directivo`, `sistemas` (máximo
privilegio). El rol NO está en la tabla `usuarios` — está en la tabla
`usuario_areas` (un usuario puede tener distinto rol en distintas
áreas). Columna `atiende_turnos` (boolean) distingue encargados que
atienden turnos de los que solo administran. El rol `directivo` es de
**solo lectura** en todo el panel — patrón consistente: ocultar
controles de escritura en el frontend (botones, campos editables) Y
rechazar con 403 en el backend (defensa en profundidad, nunca confiar
solo en ocultar el botón).

**Dato de UX pendiente, no crítico:** el sidebar de `directivo` hoy
muestra los links "Usuarios" y "Servicios" aunque el backend rechaza el
acceso con 403 al entrar — decisión consciente de dejarlo así por
ahora, no es un bug no detectado.

---

## Esquema de base de datos (motor_turnos)

```
areas            — Licencias de Conducir, Tribunal de Faltas, etc. (ABM completo)
auditoria        — log de acciones del sistema
bloqueos         — bloqueos de oficina o de operador individual
feriados         — feriados nacionales/locales
horarios         — disponibilidad de cada operador por servicio
servicios        — trámites disponibles (con area_id, duracion_min, mensaje_confirmacion)
turnos           — reservas (fecha, hora_inicio, estado, operador_id, vecino asociado,
                    notas, notas_actualizada_por, notas_actualizada_en)
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
del motor propio.

**Login por `usuario`, no por `email`.** La columna `email` fue
eliminada de `usuarios` — el login es exclusivamente por `usuario`
(nombre de usuario simple, no email). El email ficticio de `vecinos`
(`dni_NUMERODNI@municipio.local`) es un mecanismo completamente
distinto, para el bot, y no fue tocado por este cambio.

**Charset:** el pool de `db.js` fuerza `charset: 'utf8mb4'`. Si se
insertan datos con caracteres especiales (tildes, ñ) fuera de la
aplicación (por ejemplo, ejecutando un `.sql` con un cliente que no
declare utf8mb4), pueden corromperse.

**Notas de turno:** columna `turnos.notas` (TEXT, nullable) — una nota
única por turno, editable las veces que haga falta (no versionado).
Trazabilidad de quién y cuándo vía `notas_actualizada_por` (FK a
`usuarios.id`) y `notas_actualizada_en` (datetime). Editable por
cualquier rol con acceso al área del turno (no restringido a "solo mi
turno asignado" — el caso de uso es justamente que otro operador vea
contexto de un turno que no tomó él). `directivo` no puede editar
(solo lectura, defensa en ambas capas).

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
  turnos, usuarios, bloqueos, auditoría, áreas, notas, etc.)
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

Email ficticio del vecino (patrón LEGADO — ya no necesario en el motor
propio, ver esquema de base de datos arriba):
`dni_NUMERODNI@municipio.local`

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
    el patrón de email ficticio en código nuevo.

12. **Ver la regla crítica de `resolverAreaIds()` más arriba** —
    aplica a cualquier endpoint nuevo con filtrado por área.

13. **Reusar funciones existentes en vez de duplicar lógica al agregar
    UI nueva que dispara la misma acción desde otro lugar.** Ejemplo
    real: los botones de acción del modal de detalle de turno llaman a
    las mismas funciones que usan las cards de la agenda
    (`tomarTurno()`, `cambiarEstado()`, `liberarTurno()`), envueltas en
    wrappers finos que solo agregan el comportamiento extra necesario
    (refresco del modal), sin reimplementar la llamada a la API.

14. **Los modales del panel cierran con Escape y con click en el
    backdrop, además del botón explícito.** Cada archivo con modales
    tiene su propio listener de `keydown` (no hay una función genérica
    cross-archivo — cada modal limpia su propio estado interno al
    cerrarse, y no hay sistema de módulos entre archivos vanilla JS).
    Al agregar un modal nuevo, replicar este patrón.

---

## Seguridad

- Verificación HMAC-SHA256 de firma Meta en cada webhook POST
- Token permanente de Meta via System User (no expira)
- Variables de entorno sensibles nunca logueadas
- Rate limiting: 15 mensajes por 60 segundos por número, con whitelist
  configurable
- `.env` en `.gitignore`
- JWT en `sessionStorage` para el panel (expira al cerrar navegador,
  también expira a la hora — ver nota en sección "Panel de empleados")

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

**Nota:** el bot de WhatsApp no fue tocado ni probado en la ronda de
pruebas manuales más reciente (todo el trabajo fue sobre el panel de
empleados). No debería estar afectado por ninguno de esos cambios,
pero eso no fue confirmado con evidencia — sigue pendiente.

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

Un vecino no puede tener más de un turno activo por trámite. Se
considera "activo" un turno con `estado='agendado'` y fecha/hora
futura (`fecha > CURDATE() OR (fecha = CURDATE() AND hora_inicio >
CURTIME())`) — esta es la definición exacta usada de forma consistente
en `routes/publico.js` y `routes/panel.js` para el chequeo
anti-duplicado. Un turno ya `presente`/`ausente`/`atendido` no cuenta
como activo, así que un vecino puede sacar un turno nuevo del mismo
trámite una vez que el anterior ya fue procesado.

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
stack activo.

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

Si aparece `GOOGLE_SHEET_REQUISITOS_URL` en `.env` o una llamada a
`obtenerRequisitos()` en código activo, señalarlo — es candidato a
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

### Núcleo
- Login con JWT, roles por área, cambio de contraseña forzado en
  primer ingreso
- Agenda con vista día/semana/mes, toma/liberación de turnos,
  cambio de estado (presente/ausente)
- Polling automático cada 10s en la agenda, con diffing (no
  re-renderiza si no hay cambios) y pausa cuando la pestaña no está
  visible o hay un modal abierto
- Carga de turnos presenciales (formulario multi-paso con stepper)
- Bloqueos de oficina o de operador individual, por día u horario,
  con overlay diagonal + watermark visible en la agenda
- Dashboard con KPIs, gráficos, analíticas
- Auditoría con log de acciones y filtros (por usuario, acción,
  entidad, área, rango de fechas)
- ABM de usuarios (rol sistemas): alta, edición, horarios, resetear
  contraseña (genera clave temporal), desactivar/reactivar
- ABM de servicios (rol sistemas): alta, edición, desactivar con
  aviso condicional si hay turnos futuros asociados
- ABM de áreas (rol sistemas): alta, edición, desactivar con aviso
  condicional si hay servicios o usuarios asociados
- Turnos superpuestos en la misma franja: se dividen horizontalmente
  entre las cards disponibles, sin fuga hacia columnas vecinas —
  validado con hasta 4 operadores reales y 4 turnos simultáneos en
  las 3 vistas (día, semana, mes)

### Buscador global
Funcional en agenda.html: busca por nombre parcial (con o sin tildes),
DNI (completo o parcial), y número de turno exacto (incluidos IDs de
un solo dígito). Click en un resultado navega a la fecha correcta,
resalta la card, y abre el modal de detalle de ese turno.

### Dark/Light mode
Implementado en las 10 páginas del panel. Toggle persistente vía
`localStorage` bajo la clave `panel_tema` — **única excepción**
documentada a la regla de "todo en `sessionStorage`" (es una
preferencia de usuario, no un dato de sesión). Los gráficos SVG del
dashboard (`svgTorta()`, `svgBarras()`) usan colores hardcodeados por
diseño (son datos de dominio, no decoración) y no reaccionan al
cambio de tema — limitación conocida y aceptada, no un bug.

### Vista detallada de turno (modal)
Al clickear un turno (desde cualquier vista de agenda o desde el
buscador) se abre un modal con:
- Datos completos del vecino (nombre, DNI, teléfono con botón
  "Copiar")
- Datos del turno (área, operador, canal, fecha de carga)
- **Botones de acción** (Tomar/Presente/Ausente/Liberar/Cancelar) —
  idénticos en lógica a los de la card de agenda, mismas funciones
  reusadas, con refresco in-place del modal tras cada acción exitosa
  (el modal no se cierra, se actualiza mostrando el nuevo estado)
- **Sección de notas** editable (una nota por turno, reescribible,
  con trazabilidad de quién y cuándo la editó por última vez).
  `directivo` ve la nota pero no puede editarla (readonly + sin botón
  + 403 si se fuerza por API)
- **Historial del vecino**, expandible por turno (acordeón): al
  clickear un turno anterior se despliega su nota completa in-place,
  con un link "Ver turno completo →" que navega hasta ese turno viejo
  (mismo mecanismo que el buscador global: cambia fecha, cambia a
  vista día, resalta la card, reabre el modal ahí)
- Placeholder para comunicación directa (WhatsApp/email al vecino) —
  todavía sin implementar, espacio ya reservado en el layout

### Modales — cierre con Escape y backdrop-click
Los 6 modales del panel (agenda x2 — cancelar y detalle —, usuarios
x2 — editar y reset de clave —, servicios-admin, areas) cierran con
la tecla Escape y con click fuera de la caja (backdrop), además del
botón explícito. Cada archivo tiene su propio listener, reusando la
función de cierre real de cada modal (que limpia su propio estado
interno) — no hay una función genérica compartida entre archivos.

---

## Ronda de pruebas manuales (referencia histórica)

El panel de empleados fue sometido a una ronda extensa de pruebas
manuales usando Claude for Chrome, con datos reales generados desde
cero (ambiente local reseteado, 4 usuarios de cada rol, múltiples
operadores, vecinos y turnos reales). La ronda cubrió: ABMs completos,
acciones sobre turnos, presencial, bloqueos, dashboard, auditoría,
buscador, dark/light mode, y el escenario de turnos superpuestos con
múltiples operadores reales.

Esa ronda encontró y corrigió 6 bugs reales que estaban latentes desde
antes (ver la regla crítica de `resolverAreaIds()` más arriba para el
patrón que explica 4 de los 6). El detalle completo de cada uno vive
en el historial de git de la sesión correspondiente — no se repite acá
para no duplicar información que ya está mejor documentada en los
commits mismos.

---

## Próximos pasos técnicos

### Pendientes de esta ronda de pruebas (bajo riesgo, no probados aún)
- [ ] Polling con dos sesiones simultáneas — nunca probado con dos
      pestañas reales tomando el mismo turno en paralelo
- [ ] Login con credenciales incorrectas / usuario inexistente —
      confirmar que el mensaje de error es genérico en ambos casos
      (no filtrar si el usuario existe)
- [ ] Buscador — caso "sin resultados" sin probar explícitamente
- [ ] Filtro por operador en la agenda (dropdown "Todos los
      operadores") sin probar explícitamente
- [ ] Bug menor: `agenda.html?fecha=YYYY-MM-DD` como parámetro de URL
      no cambia la fecha por defecto — hay que setear el input
      manualmente
- [ ] Bug menor: "Ver agenda del día" desde la pantalla de éxito de
      `presencial.html` no navega a la fecha del turno recién creado

### Funcionalidades más grandes, sin empezar
- [ ] Vista de detalle de turno: acciones de comunicación directa
      (WhatsApp/email) — el placeholder ya está en el modal, falta
      implementar el envío real
- [ ] Deploy a producción — Fase 2 y 3 del plan de despliegue:
      backup + análisis de datos reales del servidor cloud, deploy
      del código, migraciones de esquema en producción, Nginx + SSL,
      registro del webhook de Meta, migración al número oficial de
      WhatsApp
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
3. Para cambios visuales o funcionales de tamaño medio/grande en el
   panel: siempre plan primero (documento `REDESIGN_*.md`), aprobación,
   después ejecución paso a paso con un commit por paso.
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
