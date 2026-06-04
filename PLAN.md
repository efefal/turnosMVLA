# Plan de Desarrollo — Motor de Reservas Propio (motor.js)

## Contexto

El sistema actual usa Easy!Appointments (EA) como motor de reservas, accedido a través del módulo `ea.js`. El objetivo es reemplazar EA con un motor propio en Node.js que ejecute queries directamente sobre una base de datos MySQL (`motor_turnos`), ganando control total sobre la lógica de negocio: round-robin de operadores, anti-superposición con transacciones, bloqueos de agenda, y recordatorios automáticos.

**Restricción central**: `index.js` no se toca durante el desarrollo. El único cambio al final es `require('./ea')` → `require('./motor')`. Esto significa que `motor.js` debe ser un reemplazo exacto de `ea.js`: mismas funciones exportadas, mismas firmas, mismos formatos de retorno.

El nuevo sistema corre en puerto 3001 en paralelo con el actual (puerto 3000) hasta el corte definitivo.

---

## Paso previo obligatorio antes de escribir una línea de motor.js

**Leer todas las referencias a propiedades de `cita` en `index.js`** — buscar con grep `cita\.` para identificar exactamente qué campos usa el bot de los objetos devueltos por `obtenerCitasDelCliente()`. Por ejemplo: ¿accede a `cita.start`? ¿`cita.service.name`? ¿`cita.provider.id`? Esta información es el contrato de compatibilidad que motor.js debe respetar al pie de la letra.

**Resultado del análisis (completado):**
| Campo | Tipo | Usos en index.js |
|---|---|---|
| `cita.id` | `number` | `editar_${cita.id}`, `borrar_${cita.id}`, `.find((c) => c.id === appointmentId)` |
| `cita.start` | `"YYYY-MM-DD HH:MM:SS"` | `new Date(cita.start)`, `.substring(0,10)`, `.substring(11,16)`, `.startsWith(fechaClave)` |
| `cita.serviceId` | `number` | `TRAMITES_COMPLETOS.find((s) => s.id === cita.serviceId)` — igualdad estricta |

---

## ✅ Fase 0 — Infraestructura de base de datos (completada 2026-06-04)

**Objetivo**: conexión MySQL funcional y esquema desplegado.

| Tarea | Archivo | Estado |
|---|---|---|
| Instalar mysql2 | package.json | ✅ ya estaba instalado (v3.22.4) |
| Crear módulo de conexión con pool | `db.js` | ✅ completado |
| Ejecutar esquema en MySQL | `db/motor_turnos_mvla.sql` | ✅ ejecutado, BD motor_turnos activa |
| Agregar variables de entorno a .env | `.env` | ✅ completado |

**Variables agregadas al .env:**
```
MOTOR_DB_HOST=localhost
MOTOR_DB_PORT=3306
MOTOR_DB_USER=motor_user
MOTOR_DB_PASSWORD=...
MOTOR_DB_NAME=motor_turnos
JWT_SECRET=...
```

**Notas de implementación:**
- `dateStrings: true` en el pool para que fechas y horas lleguen como strings "YYYY-MM-DD" / "HH:MM:SS" sin conversiones por zona horaria.
- mysql2 ya estaba instalado (no era necesario agregarlo, a diferencia de lo que preveía el plan). `pg` y `node-telegram-bot-api` siguen instalados pero sin usar — pendiente de limpieza en el futuro.

---

## ✅ Fase 1 — motor.js: funciones de lectura (completada 2026-06-04)

**Objetivo**: implementar las funciones que solo leen datos.

### Función 1: `obtenerServicios()` ✅
- Query con alias SQL (`nombre AS name`, `duracion_min AS duration`) para respetar el contrato de `TRAMITES_COMPLETOS` sin mapeo JS.
- Retorno: `[{ id, name, duration }]`

### Función 2: `obtenerProveedores()` ✅
- JOIN entre `usuarios`, `horarios` y `usuario_areas` con `GROUP_CONCAT` para traer todos los servicios de cada operador en una sola fila.
- Nombre completo partido en `firstName`/`lastName` en JS (primer espacio como separador).
- Retorno: `[{ id, firstName, lastName, services[] }]`

### Función 3: `obtenerDisponibilidad(serviceId, providerId, fecha)` ✅
Lógica implementada:
1. Verificar feriado (tabla `feriados`, incluye nacionales y locales)
2. Calcular `dia_semana` con `T12:00:00` para evitar desfases de zona horaria
3. Consultar horario del operador + duración del servicio en paralelo (`Promise.all`)
4. Generar slots con función auxiliar `generarSlots()`
5. Restar turnos ocupados + bloqueos en paralelo (`Promise.all`)
6. Bloqueos: día completo si `hora_inicio IS NULL`; parcial con fórmula `slotIni < bFin && slotFin > bIni`
- Retorno: `["08:00", "09:00", ...]`

### Función 4: `obtenerDisponibilidadServicio(serviceId, fecha)` ✅
- Obtiene operadores desde `horarios` (no desde `obtenerProveedores()`) para mayor eficiencia.
- `ORDER BY h.usuario_id` para desempate determinístico en el round-robin.
- Llama a `obtenerDisponibilidad()` para cada operador en paralelo.
- Round-robin por carga real: asigna cada slot al operador con menos turnos ese día (carga DB + slots ya asignados en la misma llamada).
- Retorno: `{ horariosLibres: ["08:00", ...], mapaHorarioOperador: { "08:00": 302, ... } }`

**Nota sobre round-robin**: con 2 operadores y carga inicial igual (0 turnos cada uno), la distribución alterna: 08:00→302, 08:30→303, 09:00→302, etc. Cuando un operador ya tiene más carga en BD, los slots compartidos se asignan al de menor carga total. El incremento del contador en cada asignación garantiza distribución equitativa entre slots del mismo llamado.

---

## ✅ Fase 2 — motor.js: funciones de escritura (completada 2026-06-04)

**Objetivo**: implementar creación, cancelación y consulta de turnos.

### Función 5: `crearCita(datos)` ✅
- DNI desde `datos.dni` directamente (no extraído del email).
- Canal: `datos.canal || 'whatsapp'` (válidos: 'whatsapp', 'web', 'presencial').
- Auditoría: canal `'bot'` para whatsapp/web, `'panel'` para presencial.
- Transacción completa con `pool.getConnection()`:
  1. UPSERT vecinos con `LAST_INSERT_ID(id)` para obtener el ID siempre (nuevo o existente).
  2. SELECT FOR UPDATE en hora exacta — anti-superposición concurrente.
  3. INSERT turnos.
  4. INSERT auditoria con detalle JSON.
- Retorno: `{ id, start, end, serviceId, providerId, vecinoId, estado, canal }`
- **Nota sobre mysql2 y JSON**: las columnas `JSON` de MySQL se devuelven como objetos JS (no strings) — no usar `JSON.parse()` al leerlas.

### Función 6: `cancelarCita(appointmentId)` ✅
- Verifica existencia y estado previo con error descriptivo.
- Transacción: UPDATE + INSERT auditoría atómicos.

### Función 7: `obtenerCitasDelCliente(email)` ✅
- Extrae DNI con regex `/^dni_(.+)@municipio\.local$/i`.
- Vecino inexistente → `{ citas: [], nombreCliente: null }` sin error.
- Solo devuelve turnos `estado = 'agendado'` (el filtro de futuros vs pasados lo hace index.js con `esCitaFutura()`).
- Retorno: `{ citas: [{ id, start, end, serviceId }], nombreCliente }` con tipos numéricos para `id` y `serviceId`.

---

## ✅ Fase 3 — Scripts de administración CLI (completada 2026-06-04)

**Objetivo**: herramientas de terminal para poblar la base de datos sin interfaz gráfica.

Todos los scripts van en `admin/` y usan `require('dotenv').config()` al inicio.

| Script | Estado | Notas |
|---|---|---|
| `admin/crear-usuario.js` | ✅ | bcrypt (10 salt rounds), transacción usuario+usuario_areas, verifica email duplicado |
| `admin/crear-horario.js` | ✅ | Valida formato HH:MM, verifica FK de usuario y servicio, detecta horario duplicado |
| `admin/crear-servicio.js` | ✅ | `--anticipacion` opcional (default 30), tip al final sobre TRAMITES_HABILITADOS |
| `admin/importar-feriados.js` | ✅ | HTTPS nativo (sin axios), `ER_DUP_ENTRY` salteado silenciosamente, idempotente |

**Dependencia adicional instalada**: `bcrypt` (v5.x).

**Datos cargados en Fase 3:**
- Sofía Romero (ID 302): operadora en Licencias, lunes–viernes 08:00–13:00 para servicio 1
- Carlos Mendez (ID 303): operador en Licencias, lunes/miércoles/viernes 13:00–17:00 para servicio 1
- Laura Vidal (ID 304): encargada en Tribunal de Faltas
- Servicio 3: "Renovación de Licencia" (20 min, área 1)
- 19 feriados nacionales 2026 importados desde api.argentinadatos.com

---

## ✅ Verificación end-to-end (completada 2026-06-04)

Ejecutada contra BD real con datos de Fase 3. Fecha de prueba: 2026-06-08 (lunes). Servicio: Nueva Licencia (ID 1, 30 min). Operadores: Sofía Romero (302) y Carlos Mendez (303).

| Paso | Descripción | Resultado |
|---|---|---|
| 1 | Carga de motor.js y conexión a BD `motor_turnos` | ✅ 7 funciones exportadas; BD accesible con 3 servicios, 3 usuarios, 8 horarios, 19 feriados |
| 2 | Flujo completo: DNI nuevo → disponibilidad → crearCita → verificar en BD | ✅ Turno creado, vecino en tabla vecinos, hora_inicio correcta, estado=agendado |
| 3 | Mismo vecino, mismo trámite → bloqueo | ✅ obtenerCitasDelCliente devuelve turno activo; index.js lo usa para bloquear segundo turno; motor rechaza mismo slot con SELECT FOR UPDATE |
| 4 | Cancelar → BD actualizada → slot recuperado | ✅ estado='cancelado' en BD, registro en auditoria, slot reaparece en obtenerDisponibilidadServicio |
| 5 | Modificar: cancelar + reasignar a otro horario | ✅ Original cancelado, nuevo creado en slot diferente, ambos verificados en BD |
| 6 | Equivalente a GET /api/disponibilidad | ✅ 16 slots devueltos, slot ocupado excluido, mapaHorarioOperador con IDs numéricos correctos |
| 7 | Race condition: dos crearCita() simultáneas al mismo slot | ✅ Solo 1 aceptada, 1 rechazada con error descriptivo, BD consistente (1 turno en ese slot) |

**Motor listo para el corte.**

---

## Fase 4 — Panel de empleados (Semana 3–4)

**Objetivo**: frontend HTML/JS + rutas Express protegidas con JWT.

### Backend (rutas Express)

Archivo: `routes/panel.js` — montado en `index.js` como `app.use('/panel', require('./routes/panel'))`
Middleware: `middleware/auth.js` — verifica JWT en header `Authorization: Bearer <token>`

**Rutas de autenticación** (`routes/auth.js`):
- `POST /panel/login` — valida email+password (bcrypt.compare), devuelve JWT (exp: 8h)
- `POST /panel/logout` — invalida sesión (si se implementa lista negra de tokens)

**Rutas del panel** (todas requieren JWT):
- `GET /panel/agenda?fecha=YYYY-MM-DD` — turnos del día con vecino, servicio y operador
- `POST /panel/turno` — carga presencial (canal: 'presencial'), misma lógica anti-overlap que motor.js
- `PATCH /panel/turno/:id/estado` — marcar presente / ausente / atendido
- `DELETE /panel/turno/:id` — cancelar con motivo obligatorio
- `GET /panel/bloqueos` — bloqueos activos del área
- `POST /panel/bloqueos` — crear bloqueo individual u oficina
- `DELETE /panel/bloqueos/:id` — eliminar bloqueo

**Permisos por rol**:
- `operador`: solo puede ver y operar su propia agenda, cargar turnos presenciales
- `encargado`: todo lo anterior + bloqueos de oficina + ver agenda de otros operadores

### Frontend (vanilla JS)

Archivos en `public/panel/`:
- `login.html` — formulario email+password, guarda JWT en localStorage
- `agenda.html` — tabla de turnos del día/semana, filtro por operador (encargado), botones de acción inline
- `presencial.html` — formulario de carga presencial
- `bloqueos.html` — CRUD de bloqueos

**Nota sobre autenticación**: los usuarios (empleados) ya están en la tabla `usuarios` con `password_hash` bcrypt. El login verifica con `bcrypt.compare()`. JWT firmado con `JWT_SECRET` del .env.

**Complejidad total**: Alta
**Riesgo**: Priorizar flujos críticos (agenda del día, carga presencial, cancelación) sobre funcionalidades secundarias.

---

## Fase 5 — Selector web (Semana 4)

**Objetivo**: actualizar `public/selector.html` para que funcione con el nuevo motor.

**Nuevo endpoint necesario**: `GET /api/vecino/:dni` — devuelve vecino y sus turnos activos (o 404 si no existe)

**Flujo del selector**:
1. Ingresar DNI → llamar a `/api/vecino/:dni`
   - Si tiene turno activo: mostrar turno + botones "Cancelar" / "Cambiar fecha-horario"
   - Si no tiene: ir al paso 2
2. Seleccionar servicio → `/api/servicios`
3. Seleccionar fecha (excluyendo feriados y sin disponibilidad)
4. Seleccionar horario → `/api/disponibilidad?serviceId=X&fecha=Y`
5. Confirmar → `POST /api/turno`

**Nota**: el endpoint `/api/turno` (POST) ya existe en index.js y llama a `ea.crearCita()`. Tras el corte llamará a `motor.crearCita()` automáticamente.

**Complejidad**: Media

---

## Fase 6 — Cron job de recordatorios (Semana 5)

**Objetivo**: enviar WhatsApp automático a vecinos con turno en las próximas 24 horas.

**Implementación**: archivo `cron.js` requerido desde `index.js` junto al swap final.

**Lógica del cron** (en `cron.js`):
```sql
SELECT t.id, t.hora_inicio, t.fecha, v.telefono, v.nombre, s.nombre AS servicio
FROM turnos t
JOIN vecinos v ON t.vecino_id = v.id
JOIN servicios s ON t.servicio_id = s.id
WHERE t.fecha = CURDATE() + INTERVAL 1 DAY
  AND t.estado = 'agendado'
  AND t.recordatorio_enviado = FALSE
  AND v.telefono IS NOT NULL
```

**Nota**: la tabla `vecinos` tiene columna `telefono` (VARCHAR, puede ser NULL si el vecino se registró solo por web). Solo enviar recordatorio si `telefono IS NOT NULL`.

**Riesgo crítico**: WhatsApp solo permite mensajes proactivos via Message Templates aprobados por Meta. Iniciar la solicitud de aprobación del template antes de implementar este cron.

**Complejidad**: Media

---

## Fase 7 — Migración y corte (Semana 5–6)

**Objetivo**: pasar del sistema EA al motor propio en producción.

| Tarea | Orden | Estado |
|---|---|---|
| `node admin/importar-feriados.js 2026` | 1 | ✅ Ejecutado (19 feriados nacionales) |
| Cargar operadores reales con horarios via scripts admin | 2 | ✅ Sofía Romero (302), Carlos Mendez (303), Laura Vidal (304) cargados |
| `node admin/migrar-vecinos.js` (JSON → MySQL) | 3 | ⏳ pendiente — script no implementado aún |
| Correr motor.js en puerto 3001 para pruebas paralelas | 4 | ⏳ pendiente |
| Verificar todos los flujos de WhatsApp end-to-end | 5 | ✅ Verificado programáticamente (ver sección anterior) |
| Corte: cambiar `require('./ea')` → `require('./motor')` en index.js | 6 | ⏳ pendiente |
| Reiniciar PM2: `pm2 restart turnosMVLA` | 7 | ⏳ pendiente |

**Nota sobre migrar-vecinos.js**: los vecinos en `data/usuarios.json` tienen DNI, nombre y teléfono. El script debe hacer UPSERT en la tabla `vecinos` con `canal_registro='whatsapp'`. Si un vecino ya existe por DNI (creado durante las pruebas del motor), solo actualizar el teléfono si no lo tiene.

---

## Dependencias entre fases (orden obligatorio)

```
Fase 0 (DB) → Fase 1 (motor lectura) → Fase 2 (motor escritura) → Fase 7 (corte)
Fase 0 (DB) → Fase 3 (admin scripts) → Fase 4 (panel) → Fase 5 (selector web)
Fase 2 (motor escritura) → Fase 5 (selector web)
Fase 2 (motor escritura) → Fase 6 (cron)
```

Las fases 4, 5 y 6 pueden desarrollarse en paralelo una vez que Fases 0-3 estén completas.

---

## Resumen de complejidad por fase

| Fase | Descripción | Complejidad | Estado |
|---|---|---|---|
| 0 | Infraestructura DB | Baja | ✅ Completa |
| 1 | motor.js lecturas | Alta | ✅ Completa |
| 2 | motor.js escrituras | Alta | ✅ Completa |
| 3 | Scripts CLI | Baja | ✅ Completa |
| 4 | Panel de empleados | Alta | ⏳ Pendiente |
| 5 | Selector web | Media | ⏳ Pendiente |
| 6 | Cron recordatorios | Media | ⏳ Pendiente |
| 7 | Migración y corte | Baja | ⏳ Parcialmente avanzada |

---

## Riesgos identificados

### R1 — Compatibilidad exacta del formato de citas (CRÍTICO) — ✅ RESUELTO
Contrato mapeado y verificado. Los campos que usa index.js son: `cita.id` (number), `cita.start` ("YYYY-MM-DD HH:MM:SS"), `cita.serviceId` (number). Motor devuelve exactamente ese formato.

### R2 — Doble persistencia de vecinos
`index.js` escribe en `data/usuarios.json` (lógica conversacional del bot). `motor.js` usa la tabla MySQL `vecinos`. Al momento del corte, los vecinos del JSON que nunca sacaron turno en el sistema nuevo no estarán en MySQL.
**Mitigación**: ejecutar `admin/migrar-vecinos.js` antes del corte. `obtenerCitasDelCliente()` ya devuelve `{ citas: [], nombreCliente: null }` para vecinos que no están en MySQL (sin error) — el bot los trata como nuevos y pide el nombre.

### R3 — Race condition en creación de turnos — ✅ VERIFICADO
SELECT FOR UPDATE garantiza exclusión mutua. Verificado en Paso 7 de la verificación e2e: solo 1 de 2 reservas simultáneas entra, la BD queda consistente.

**Nota**: el bloqueo es más efectivo con un índice compuesto en `(operador_id, fecha, hora_inicio)`. Sin ese índice los gap locks son menos precisos, pero la ventana de race condition es prácticamente nula para el volumen esperado del PoC municipal.

### R4 — Message Templates de WhatsApp para recordatorios
Los recordatorios proactivos requieren un Template aprobado por Meta Business Manager.
**Mitigación**: iniciar el proceso al comenzar Fase 6. Si se rechaza, el cron puede insertar en auditoria sin enviar hasta que llegue la aprobación.

### R5 — Bloqueos de oficina parciales (horas) — ✅ RESUELTO
Implementado con `slotIni < bFin && slotFin > bIni`. Verificado en tests de integración.

### R6 — Dependencias sin usar (pg, node-telegram-bot-api)
El `package.json` tiene `node-telegram-bot-api` y `pg` instalados pero no usados.
**Acción**: limpiar con `npm uninstall pg node-telegram-bot-api` antes del corte para reducir superficie de vulnerabilidades.

---

## Verificación end-to-end

### ✅ Completada el 2026-06-04

Ver tabla detallada en la sección "✅ Verificación end-to-end" más arriba.

Resumen ejecutivo:
- **Motor carga**: 7 funciones exportadas, BD `motor_turnos` accesible
- **Flujo completo**: vecino nuevo → disponibilidad → reserva → BD consistente
- **Anti-duplicación**: tramitesActivos en index.js bloquea segundo trámite; SELECT FOR UPDATE bloquea mismo slot
- **Cancelación**: BD actualizada + slot recuperado en siguiente consulta de disponibilidad
- **Modificación**: cancelar + reasignar funciona correctamente
- **API endpoint**: disponibilidad correcta, slots ocupados excluidos, mapa con IDs numéricos
- **Race condition**: InnoDB garantiza exclusión mutua con SELECT FOR UPDATE

### Verificación pendiente antes del corte definitivo

- [ ] Probar el flujo completo **desde WhatsApp real** (requiere que el bot corra con motor.js)
- [ ] Ejecutar `admin/migrar-vecinos.js` y verificar que los vecinos existentes funcionan correctamente
- [ ] Verificar el endpoint `/api/disponibilidad` con el bot corriendo en puerto 3001
