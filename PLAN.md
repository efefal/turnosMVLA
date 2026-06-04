# Plan de Desarrollo — Motor de Reservas Propio (motor.js)

## Contexto

El sistema actual usa Easy!Appointments (EA) como motor de reservas, accedido a través del módulo `ea.js`. El objetivo es reemplazar EA con un motor propio en Node.js que ejecute queries directamente sobre una base de datos MySQL (`motor_turnos`), ganando control total sobre la lógica de negocio: round-robin de operadores, anti-superposición con transacciones, bloqueos de agenda, y recordatorios automáticos.

**Restricción central**: `index.js` no se toca durante el desarrollo. El único cambio al final es `require('./ea')` → `require('./motor')`. Esto significa que `motor.js` debe ser un reemplazo exacto de `ea.js`: mismas funciones exportadas, mismas firmas, mismos formatos de retorno.

El nuevo sistema corre en puerto 3001 en paralelo con el actual (puerto 3000) hasta el corte definitivo.

---

## Paso previo obligatorio antes de escribir una línea de motor.js

**Leer todas las referencias a propiedades de `cita` en `index.js`** — buscar con grep `cita\.` para identificar exactamente qué campos usa el bot de los objetos devueltos por `obtenerCitasDelCliente()`. Por ejemplo: ¿accede a `cita.start`? ¿`cita.service.name`? ¿`cita.provider.id`? Esta información es el contrato de compatibilidad que motor.js debe respetar al pie de la letra.

---

## Fase 0 — Infraestructura de base de datos (Semana 1)

**Objetivo**: conexión MySQL funcional y esquema desplegado.

| Tarea | Archivo | Complejidad | Depende de |
|---|---|---|---|
| Instalar mysql2 | package.json | Baja | — |
| Crear módulo de conexión con pool | `db.js` | Baja | mysql2 instalado |
| Ejecutar esquema en MySQL | `db/motor_turnos_mvla.sql` | Baja | MySQL accesible |
| Agregar variables de entorno a .env | `.env` | Baja | — |

**Variables nuevas en .env:**
```
MOTOR_DB_HOST=localhost
MOTOR_DB_PORT=3306
MOTOR_DB_USER=motor_user
MOTOR_DB_PASSWORD=...
MOTOR_DB_NAME=motor_turnos
JWT_SECRET=...
```

**Riesgo**: El repo tiene `pg` (PostgreSQL) instalado sin usar. No usarlo — agregar `mysql2`. Confirmar si MySQL del motor es la misma instancia Docker de EA (misma base, diferente database) o una instancia nueva. Recomendación: misma instancia Docker, diferente database `motor_turnos`.

---

## Fase 1 — motor.js: funciones de lectura (Semana 1–2)

**Objetivo**: implementar las funciones que solo leen datos. Son la base de todo lo que sigue.

### Función 1: `obtenerServicios()`
- **Query**: `SELECT s.id, s.nombre AS name, s.duracion_min AS duration FROM servicios s WHERE s.activo = true`
- **Retorno esperado**: `[{ id, name, duration }]` — mismo formato que EA
- **Complejidad**: Baja

### Función 2: `obtenerProveedores()`
- **Query**: JOIN entre `usuarios`, `usuario_areas`, y `servicios` para armar `{ id, firstName, lastName, services[] }`
- El campo `nombre` de MySQL se debe partir en `firstName` / `lastName` (o guardar separados — verificar qué espera index.js exactamente)
- **Complejidad**: Baja

### Función 3: `obtenerDisponibilidad(serviceId, providerId, fecha)`
Esta es la función más compleja del módulo. Lógica en orden:

1. Verificar que `fecha` no sea feriado (`SELECT 1 FROM feriados WHERE fecha = ?`)
2. Obtener `dia_semana` de la fecha (1=lunes ... 7=domingo)
3. Buscar el horario del operador para ese día/servicio en tabla `horarios`
4. Generar todos los slots de ese horario con paso = `duracion_min` del servicio
5. Restar los slots ya ocupados (turnos `estado != 'cancelado'` para ese operador/fecha)
6. Restar bloqueos: `tipo='individual'` para ese `usuario_id`, y `tipo='oficina'` para el `area_id` del servicio
7. Devolver array de strings `["08:00", "09:00", ...]`

- **Complejidad**: Alta
- **Riesgo**: La intersección de bloqueos parciales (bloqueo con `hora_inicio` y `hora_fin`) requiere lógica cuidadosa para no eliminar slots válidos. Cubrir el caso `hora_inicio IS NULL` (día completo bloqueado).

### Función 4: `obtenerDisponibilidadServicio(serviceId, fecha)`
- Obtener todos los operadores que atienden ese servicio (via `horarios` + `usuario_areas`)
- Llamar a `obtenerDisponibilidad()` para cada uno en paralelo (Promise.all)
- Construir `mapaHorarioOperador`: para cada slot, asignar el operador con menos turnos futuros ese día (round-robin por carga, en lugar del FIFO de EA)
- **Retorno**: `{ horariosLibres: ["08:00", ...], mapaHorarioOperador: { "08:00": 4, ... } }`
- **Complejidad**: Media

---

## Fase 2 — motor.js: funciones de escritura (Semana 2)

**Objetivo**: implementar creación, cancelación y consulta de turnos.

### Función 5: `crearCita(datos)`
Parámetros recibidos de index.js: `{ serviceId, providerId, nombre, apellido, email, telefono, fechaHora, fechaHoraFin, notas }`

Lógica con transacción:
```
BEGIN TRANSACTION
  1. UPSERT en vecinos (por DNI extraído del email ficticio)
  2. SELECT FOR UPDATE en turnos WHERE operador_id=? AND fecha=? AND hora_inicio=? AND estado != 'cancelado'
     → Si hay resultado: ROLLBACK + throw Error('Horario ya ocupado')
  3. INSERT INTO turnos (vecino_id, servicio_id, operador_id, fecha, hora_inicio, hora_fin, estado, canal_origen)
  4. INSERT INTO auditoria (entidad_tipo='turno', accion='crear', canal='bot', detalle=JSON)
COMMIT
```
- Retornar objeto con formato compatible EA: `{ id, start, end, service: {...}, ... }`
- **Complejidad**: Alta
- **Riesgo**: La transacción con `SELECT FOR UPDATE` requiere que el pool de conexiones use la misma conexión para toda la transacción. Necesita `connection.beginTransaction()` en lugar de `pool.query()` directamente.

### Función 6: `cancelarCita(appointmentId)`
- `UPDATE turnos SET estado='cancelado', updated_at=NOW() WHERE id=?`
- `INSERT INTO auditoria ...`
- **Complejidad**: Baja

### Función 7: `obtenerCitasDelCliente(email)`
- Extraer DNI del email (`dni_XXXXXX@municipio.local` → `XXXXXX`)
- `SELECT t.*, s.nombre, s.duracion_min, v.nombre FROM turnos t JOIN servicios s JOIN vecinos v WHERE v.dni=? AND t.estado='agendado'`
- Construir objetos cita en formato exactamente igual a EA (ver paso previo obligatorio arriba)
- **Retorno**: `{ citas: [...], nombreCliente: "..." }`
- **Complejidad**: Media

---

## Fase 3 — Scripts de administración CLI (Semana 2–3)

**Objetivo**: herramientas de terminal para poblar la base de datos sin interfaz gráfica.

Todos los scripts van en `admin/` y registran sus acciones en la tabla `auditoria`.

| Script | Función | Complejidad |
|---|---|---|
| `admin/crear-usuario.js` | Crea empleado con nombre, email, password (bcrypt), área y rol | Baja |
| `admin/crear-horario.js` | Asigna bloque horario a usuario+servicio+día | Baja |
| `admin/crear-servicio.js` | Agrega servicio a un área | Baja |
| `admin/importar-feriados.js` | Consulta api.argentinadatos.com y llena tabla `feriados` | Baja |
| `admin/migrar-vecinos.js` | Lee `data/usuarios.json` y hace UPSERT en tabla `vecinos` | Baja |

**Dependencia**: estos scripts son necesarios para tener datos de prueba antes de trabajar en el panel y el selector.

---

## Fase 4 — Panel de empleados (Semana 3–4)

**Objetivo**: frontend HTML/JS + rutas Express protegidas con JWT.

### Backend (rutas Express)

Archivo: `routes/panel.js` — montado en `index.js` como `app.use('/panel', require('./routes/panel'))`
Middleware: `middleware/auth.js` — verifica JWT en header `Authorization: Bearer <token>`

**Rutas de autenticación** (`routes/auth.js`):
- `POST /panel/login` — valida email+password, devuelve JWT (exp: 8h)
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
- `presencial.html` — formulario de carga presencial (compartirá el componente fecha/horario con selector web)
- `bloqueos.html` — CRUD de bloqueos

**Complejidad total**: Alta (es el módulo más grande)
**Riesgo**: El límite de tiempo es la restricción principal. Priorizar flujos críticos (agenda del día, carga presencial, cancelación) sobre funcionalidades secundarias.

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

**Componente fecha/horario compartido**: extraer como función/módulo JS reutilizable entre selector.html y panel/presencial.html.

**Complejidad**: Media

---

## Fase 6 — Cron job de recordatorios (Semana 5)

**Objetivo**: enviar WhatsApp automático a vecinos con turno en las próximas 24 horas.

**Implementación**: archivo `cron.js` requerido desde `index.js` junto al swap final (es el segundo cambio permitido en index.js).

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
Para cada resultado:
1. Enviar WhatsApp via Graph API (Message Template aprobado por Meta)
2. `UPDATE turnos SET recordatorio_enviado = TRUE WHERE id = ?`
3. `INSERT INTO auditoria ...`

**Complejidad**: Media
**Riesgo crítico**: WhatsApp solo permite mensajes proactivos via Message Templates aprobados por Meta. El proceso de aprobación puede demorar 1-2 semanas. **Iniciar la solicitud de aprobación del template al inicio del desarrollo**, no al final.

---

## Fase 7 — Migración y corte (Semana 5–6)

**Objetivo**: pasar del sistema EA al motor propio en producción.

| Tarea | Orden |
|---|---|
| `node admin/importar-feriados.js 2026` | 1 |
| Cargar operadores reales con horarios via scripts admin | 2 |
| `node admin/migrar-vecinos.js` (JSON → MySQL) | 3 |
| Correr motor.js en puerto 3001 para pruebas paralelas | 4 |
| Verificar todos los flujos de WhatsApp end-to-end | 5 |
| Corte: cambiar `require('./ea')` → `require('./motor')` en index.js | 6 |
| Reiniciar PM2: `pm2 restart turnosMVLA` | 7 |

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

| Fase | Descripción | Complejidad |
|---|---|---|
| 0 | Infraestructura DB | Baja |
| 1 | motor.js lecturas | Alta (disponibilidad es compleja) |
| 2 | motor.js escrituras | Alta (transacciones) |
| 3 | Scripts CLI | Baja |
| 4 | Panel de empleados | Alta |
| 5 | Selector web | Media |
| 6 | Cron recordatorios | Media |
| 7 | Migración y corte | Baja (si las fases anteriores están bien probadas) |

---

## Riesgos identificados

### R1 — Compatibilidad exacta del formato de citas (CRÍTICO)
`index.js` accede a propiedades específicas de los objetos `cita` devueltos por `obtenerCitasDelCliente()` (por ejemplo: `cita.start`, `cita.service.name`, etc.). Si motor.js devuelve un formato diferente, el bot falla silenciosamente o muestra datos incorrectos.
**Mitigación**: antes de implementar Fase 2, hacer grep de `cita\.` en `index.js` para mapear todos los campos que usa.

### R2 — Doble persistencia de vecinos
`index.js` escribe en `data/usuarios.json` (lógica conversacional del bot). `motor.js` usa la tabla MySQL `vecinos`. Al momento del corte, los vecinos del JSON que nunca sacaron turno en el sistema nuevo no estarán en MySQL.
**Mitigación**: ejecutar `admin/migrar-vecinos.js` antes del corte. `obtenerCitasDelCliente()` debe devolver `{ citas: [], nombreCliente: null }` para vecinos que no están en MySQL (sin error).

### R3 — Race condition en creación de turnos
Si dos vecinos eligen el mismo slot simultáneamente, solo uno debe confirmar.
**Mitigación**: `SELECT FOR UPDATE` dentro de una transacción InnoDB garantiza exclusión mutua. La conexión del pool debe mantenerse abierta durante toda la transacción (no usar `pool.query()` directo).

### R4 — Message Templates de WhatsApp para recordatorios
Los recordatorios proactivos requieren un Template aprobado por Meta Business Manager. La aprobación puede demorar 1-2 semanas y puede ser rechazada.
**Mitigación**: iniciar el proceso en la primera semana. Si se rechaza o demora, el cron puede escribir a la tabla de auditoria sin enviar, y el mensaje se agrega cuando llegue la aprobación.

### R5 — Bloqueos de oficina parciales (horas)
Un bloqueo con `hora_inicio` y `hora_fin` debe eliminar solo los slots que se superpongan, no todos los del día.
**Mitigación**: en `obtenerDisponibilidad()`, para bloqueos con horas definidas, verificar superposición slot-a-slot: `slot_inicio < bloqueo_fin AND slot_fin > bloqueo_inicio`.

### R6 — Dependencias sin usar (pg, node-telegram-bot-api)
El `package.json` tiene `node-telegram-bot-api` y `pg` instalados pero no usados. Al agregar `mysql2`, conviene limpiarlos.

---

## Verificación end-to-end

Una vez implementado motor.js (Fases 0-2), la verificación antes del corte es:

1. Iniciar el bot en puerto 3001 con variables `MOTOR_*` cargadas
2. Desde WhatsApp, completar el flujo completo: DNI nuevo → nombre → trámite → semana → fecha → horario → confirmación → verificar en MySQL que existe el turno
3. Verificar que el mismo vecino no puede sacar un segundo turno del mismo trámite
4. Cancelar el turno → verificar que `estado='cancelado'` en MySQL y que el slot vuelve a aparecer disponible
5. Modificar el turno (cancelar + reasignar) → verificar ambas operaciones
6. Consultar `/api/disponibilidad?serviceId=2&fecha=YYYY-MM-DD` y comparar con los turnos en MySQL para esa fecha
7. Simular dos reservas simultáneas al mismo slot → verificar que solo una entra y la otra recibe error
