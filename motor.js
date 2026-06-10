// motor.js — Motor de reservas propio del sistema de turnos MVLA
//
// Reemplaza ea.js cuando el sistema esté listo para el corte definitivo.
// El único cambio necesario en index.js es:
//   require('./ea')  →  require('./motor')
//
// CONTRATO: este módulo exporta exactamente las mismas funciones que ea.js,
// con las mismas firmas y los mismos formatos de retorno. Si algo no coincide,
// el bot falla silenciosamente o muestra datos incorrectos.
//
// Funciones exportadas:
//   obtenerServicios()                                   → [{ id, name, duration }]
//   obtenerProveedores()                                 → [{ id, firstName, lastName, services[] }]
//   obtenerDisponibilidad(serviceId, providerId, fecha)  → ["08:00", "09:00", ...]
//   obtenerDisponibilidadServicio(serviceId, fecha)      → { horariosLibres[], mapaHorarioOperador{} }
//   crearCita(datos)                                     → objeto cita compatible con EA
//   cancelarCita(appointmentId)                          → void
//   obtenerCitasDelCliente(email)                        → { citas[], nombreCliente }

'use strict';

const db     = require('./db');
const logger = require('./logger');


// =============================================================================
// FUNCIONES AUXILIARES INTERNAS (no se exportan)
// =============================================================================

// Convierte "HH:MM" o "HH:MM:SS" a minutos desde medianoche.
// Se usa para comparar horas como números en lugar de strings.
// Ejemplo: "08:30" → 510
function horaAMinutos(horaStr) {
  const partes = horaStr.split(':');
  return parseInt(partes[0], 10) * 60 + parseInt(partes[1], 10);
}

// Convierte minutos desde medianoche a "HH:MM".
// Inversa de horaAMinutos(). Ejemplo: 510 → "08:30"
function minutosAHora(minutos) {
  const hh = String(Math.floor(minutos / 60)).padStart(2, '0');
  const mm = String(minutos % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

// Genera todos los slots de atención entre hora_inicio y hora_fin,
// con un intervalo de duracionMin minutos entre cada uno.
// El último slot incluido es el que termina exactamente en hora_fin,
// no el que empieza en hora_fin.
// Ejemplo: "08:00", "13:00", 30 → ["08:00", "08:30", ..., "12:30"]
function generarSlots(horaInicioStr, horaFinStr, duracionMin) {
  const inicio = horaAMinutos(horaInicioStr);
  const fin    = horaAMinutos(horaFinStr);
  const slots  = [];
  // La condición es t + duracion <= fin para que el último slot
  // no se extienda más allá del horario de cierre del operador
  for (let t = inicio; t + duracionMin <= fin; t += duracionMin) {
    slots.push(minutosAHora(t));
  }
  return slots;
}

// =============================================================================
// FUNCIÓN 1: obtenerServicios()
// =============================================================================
// Devuelve todos los servicios activos del sistema.
//
// CONTRATO con index.js: el array devuelto se guarda en TRAMITES_COMPLETOS.
// Cada elemento se accede como:
//   s.id       → para comparar con cita.serviceId
//   s.name     → para mostrar al vecino
//   s.duration → para calcular hora_fin en memoria
//
// En la base de datos el campo se llama 'nombre' y 'duracion_min',
// por eso usamos alias SQL para que el resultado tenga los nombres que
// espera index.js sin necesidad de mapear en JavaScript.
async function obtenerServicios() {
  const [rows] = await db.query(`
    SELECT
      s.id,
      s.nombre       AS name,
      s.duracion_min AS duration
    FROM servicios s
    WHERE s.activo = TRUE
    ORDER BY s.id
  `);

  logger.info(`[motor] obtenerServicios: ${rows.length} servicios cargados`);
  return rows;
}


// =============================================================================
// FUNCIÓN 2: obtenerProveedores()
// =============================================================================
// Devuelve todos los operadores activos con la lista de servicios que atienden.
//
// CONTRATO con ea.js (que usa esta función internamente en obtenerDisponibilidadServicio):
//   p.id         → ID numérico del operador
//   p.firstName  → primer token del nombre (antes del primer espacio)
//   p.lastName   → resto del nombre (todo lo que viene después del primer espacio)
//   p.services   → array de IDs numéricos de servicios que atiende este operador
//
// La tabla 'usuarios' guarda el nombre completo en un solo campo VARCHAR.
// Lo partimos en firstName/lastName en JavaScript para respetar el contrato.
// Si el nombre es una sola palabra (sin espacio), lastName queda como string vacío.
//
// Los servicios se obtienen desde la tabla 'horarios': un operador atiende un
// servicio si tiene al menos un horario activo configurado para ese servicio.
// Usamos GROUP_CONCAT para traer todos los serviceId en una sola fila por operador.
async function obtenerProveedores() {
  // GROUP_CONCAT devuelve una string como "2,3,5" (o NULL si no hay horarios).
  // La convertimos a array de enteros en JavaScript más abajo.
  const [rows] = await db.query(`
    SELECT
      u.id,
      u.nombre,
      GROUP_CONCAT(DISTINCT h.servicio_id ORDER BY h.servicio_id) AS servicios_ids
    FROM usuarios u
    INNER JOIN horarios h ON h.usuario_id = u.id AND h.activo = TRUE
    INNER JOIN usuario_areas ua ON ua.usuario_id = u.id
    WHERE u.activo = TRUE
    GROUP BY u.id, u.nombre
    ORDER BY u.id
  `);

  // Transformamos cada fila al formato que espera el resto del sistema
  const proveedores = rows.map((row) => {
    // Partir el nombre completo en firstName y lastName
    const espacioIdx = row.nombre.indexOf(' ');
    const firstName  = espacioIdx === -1 ? row.nombre : row.nombre.substring(0, espacioIdx);
    const lastName   = espacioIdx === -1 ? ''         : row.nombre.substring(espacioIdx + 1);

    // Convertir "2,3,5" → [2, 3, 5]
    // Si no tiene horarios, GROUP_CONCAT devuelve NULL → usamos array vacío
    const services = row.servicios_ids
      ? row.servicios_ids.split(',').map(Number)
      : [];

    return { id: row.id, firstName, lastName, services };
  });

  logger.info(`[motor] obtenerProveedores: ${proveedores.length} operadores cargados`);
  return proveedores;
}


// =============================================================================
// FUNCIONES PENDIENTES — Fase 1 (continuación) y Fase 2
// =============================================================================
// Las siguientes funciones se implementan en la próxima sesión de desarrollo.
// Las exportamos como stubs que lanzan un error descriptivo para que sea
// fácil detectar si se las llama antes de estar implementadas.

async function obtenerDisponibilidad(serviceId, providerId, fecha) {
  serviceId  = parseInt(serviceId, 10);
  providerId = parseInt(providerId, 10);

  // --- PASO 1: Verificar feriado ---
  // La tabla feriados contiene tanto nacionales (de api.argentinadatos.com)
  // como locales (cargados a mano). Un solo SELECT alcanza para ambos casos.
  const [esFeriado] = await db.query(
    'SELECT 1 FROM feriados WHERE fecha = ? LIMIT 1',
    [fecha]
  );
  if (esFeriado.length > 0) {
    logger.info(`[motor] obtenerDisponibilidad: ${fecha} es feriado → sin slots`);
    return [];
  }

  // --- PASO 2: Calcular dia_semana ---
  // La BD usa 1=lunes...7=domingo. JavaScript usa 0=domingo...6=sábado.
  // Usamos T12:00:00 para fijar la hora al mediodía: así la conversión de
  // string a Date no cambia de día por el desfase horario de Argentina (UTC-3).
  const diaSemanaJS = new Date(`${fecha}T12:00:00`).getDay();
  const diaSemanaDB = diaSemanaJS === 0 ? 7 : diaSemanaJS;

  // --- PASOS 3 y 4: Horario del operador + duración del servicio (en paralelo) ---
  // Las dos queries son independientes entre sí, así que las lanzamos juntas
  // para no esperar una antes de la otra.
  const [[horarios], [servicios]] = await Promise.all([
    db.query(
      `SELECT hora_inicio, hora_fin
       FROM horarios
       WHERE usuario_id = ? AND servicio_id = ? AND dia_semana = ? AND activo = TRUE`,
      [providerId, serviceId, diaSemanaDB]
    ),
    db.query(
      'SELECT duracion_min, area_id FROM servicios WHERE id = ?',
      [serviceId]
    ),
  ]);

  // Si el operador no tiene horario ese día, o el servicio no existe, no hay slots
  if (horarios.length === 0 || servicios.length === 0) return [];

  const { hora_inicio: hIni, hora_fin: hFin } = horarios[0];
  const { duracion_min: duracion, area_id: areaId } = servicios[0];

  // --- PASO 4: Generar todos los slots posibles del horario ---
  let slotsDisponibles = generarSlots(hIni, hFin, duracion);

  // Si no hay slots (horario de 0 minutos o duración mayor al bloque), terminamos
  if (slotsDisponibles.length === 0) return [];

  // --- PASOS 5 y 6: Turnos ocupados + bloqueos (en paralelo) ---
  // Tampoco dependen entre sí, así que van juntas.
  const [[turnosOcupados], [bloqueos]] = await Promise.all([
    // Turnos ya reservados por este operador en esta fecha
    db.query(
      `SELECT hora_inicio, hora_fin
       FROM turnos
       WHERE operador_id = ? AND fecha = ? AND estado != 'cancelado'`,
      [providerId, fecha]
    ),
    // Bloqueos individuales del operador + bloqueos de oficina del área.
    // servicio_id IS NULL significa que el bloqueo afecta todos los servicios del área.
    db.query(
      `SELECT tipo, hora_inicio, hora_fin
       FROM bloqueos
       WHERE area_id = ?
         AND fecha_inicio <= ? AND fecha_fin >= ?
         AND (
           (tipo = 'individual' AND usuario_id = ?)
           OR tipo = 'oficina'
         )
         AND (servicio_id = ? OR servicio_id IS NULL)`,
      [areaId, fecha, fecha, providerId, serviceId]
    ),
  ]);

  // --- Restar turnos ocupados ---
  // Un slot se elimina si se superpone con cualquier turno existente.
  // Fórmula de superposición: A empieza antes de que B termine,
  // Y A termina después de que B empiece.
  if (turnosOcupados.length > 0) {
    slotsDisponibles = slotsDisponibles.filter((slot) => {
      const slotIni = horaAMinutos(slot);
      const slotFin = slotIni + duracion;
      return !turnosOcupados.some((t) => {
        const tIni = horaAMinutos(t.hora_inicio);
        const tFin = horaAMinutos(t.hora_fin);
        return slotIni < tFin && slotFin > tIni;
      });
    });
  }

  // --- Restar bloqueos ---
  for (const bloqueo of bloqueos) {
    // Si no quedan slots, no tiene sentido seguir evaluando bloqueos
    if (slotsDisponibles.length === 0) break;

    if (bloqueo.hora_inicio === null) {
      // Bloqueo de día completo → eliminar todos los slots de un saque
      slotsDisponibles = [];
    } else {
      // Bloqueo parcial → eliminar solo los slots que se superpongan con él.
      // Misma fórmula que para turnos: slot_inicio < bloqueo_fin AND slot_fin > bloqueo_inicio
      const bIni = horaAMinutos(bloqueo.hora_inicio);
      const bFin = horaAMinutos(bloqueo.hora_fin);
      slotsDisponibles = slotsDisponibles.filter((slot) => {
        const slotIni = horaAMinutos(slot);
        const slotFin = slotIni + duracion;
        return !(slotIni < bFin && slotFin > bIni);
      });
    }
  }

  logger.info(
    `[motor] obtenerDisponibilidad: serviceId=${serviceId} providerId=${providerId} ` +
    `fecha=${fecha} → ${slotsDisponibles.length} slots libres`
  );
  return slotsDisponibles;
}

async function obtenerDisponibilidadServicio(serviceId, fecha) {
  serviceId = parseInt(serviceId, 10);

  // --- PASO 1: Verificar feriado ---
  const [esFeriado] = await db.query(
    'SELECT 1 FROM feriados WHERE fecha = ? LIMIT 1',
    [fecha]
  );
  if (esFeriado.length > 0) {
    logger.info(`[motor] obtenerDisponibilidadServicio: ${fecha} es feriado → sin slots`);
    return { horariosLibres: [], mapaHorarioOperador: {} };
  }

  const diaSemanaJS = new Date(`${fecha}T12:00:00`).getDay();
  const diaSemanaDB = diaSemanaJS === 0 ? 7 : diaSemanaJS;

  // --- PASO 2: Operadores con horario para este servicio este día + datos del servicio ---
  const [[operadoresHorarios], [servicioRows]] = await Promise.all([
    db.query(
      // Solo incluir operadores con atiende_turnos = TRUE en el área del servicio.
      // Los encargados pueden tener horarios configurados pero no ocupan slots —
      // atiende_turnos = FALSE los excluye del cálculo de disponibilidad.
      `SELECT h.usuario_id AS id, h.hora_inicio, h.hora_fin
       FROM horarios h
       INNER JOIN usuarios u  ON u.id = h.usuario_id AND u.activo = TRUE
       INNER JOIN servicios s ON s.id = h.servicio_id
       INNER JOIN usuario_areas ua ON ua.usuario_id = h.usuario_id
                                   AND ua.area_id = s.area_id
                                   AND ua.atiende_turnos = TRUE
       WHERE h.servicio_id = ? AND h.dia_semana = ? AND h.activo = TRUE
       ORDER BY h.usuario_id`,
      [serviceId, diaSemanaDB]
    ),
    db.query('SELECT duracion_min, area_id FROM servicios WHERE id = ?', [serviceId]),
  ]);

  if (operadoresHorarios.length === 0 || servicioRows.length === 0) {
    logger.info(`[motor] obtenerDisponibilidadServicio: serviceId=${serviceId} sin operadores o servicio no encontrado`);
    return { horariosLibres: [], mapaHorarioOperador: {} };
  }

  const { duracion_min: duracion, area_id: areaId } = servicioRows[0];

  // --- PASO 3: Bloqueos de OFICINA que aplican a este servicio y fecha ---
  // Se obtienen una sola vez y se aplican a todos los operadores por igual.
  const [bloqueosOficina] = await db.query(
    `SELECT hora_inicio, hora_fin
     FROM bloqueos
     WHERE area_id = ? AND tipo = 'oficina'
       AND fecha_inicio <= ? AND fecha_fin >= ?
       AND (servicio_id = ? OR servicio_id IS NULL)`,
    [areaId, fecha, fecha, serviceId]
  );

  // Si hay un bloqueo de oficina de día completo, no hay disponibilidad para nadie
  if (bloqueosOficina.some((b) => b.hora_inicio === null)) {
    logger.info(`[motor] obtenerDisponibilidadServicio: bloqueo de oficina día completo → sin slots`);
    return { horariosLibres: [], mapaHorarioOperador: {} };
  }

  // --- PASO 4: Calcular slots libres de CADA operador en paralelo ---
  //
  // "Libre" = tiene el slot en su horario, no está bloqueado individualmente,
  // y el bloqueo de oficina (si lo hay) no cubre ese slot.
  // La lista de resultados es [{ slots: ["08:00", ...] }, ...] — los IDs no importan
  // porque en el nuevo modelo los turnos no pre-asignan operador.
  const resultados = await Promise.all(
    operadoresHorarios.map(async (op) => {
      let slots = generarSlots(op.hora_inicio, op.hora_fin, duracion);

      // Aplicar bloqueos de oficina parciales (hora específica)
      for (const b of bloqueosOficina) {
        if (slots.length === 0) break;
        const bIni = horaAMinutos(b.hora_inicio);
        const bFin = horaAMinutos(b.hora_fin);
        slots = slots.filter((s) => {
          const si = horaAMinutos(s);
          return !(si < bFin && (si + duracion) > bIni);
        });
      }

      // Aplicar bloqueos INDIVIDUALES del operador
      const [bloqueosInd] = await db.query(
        `SELECT hora_inicio, hora_fin
         FROM bloqueos
         WHERE tipo = 'individual' AND usuario_id = ? AND area_id = ?
           AND fecha_inicio <= ? AND fecha_fin >= ?
           AND (servicio_id = ? OR servicio_id IS NULL)`,
        [op.id, areaId, fecha, fecha, serviceId]
      );

      for (const b of bloqueosInd) {
        if (slots.length === 0) break;
        if (b.hora_inicio === null) { slots = []; break; }
        const bIni = horaAMinutos(b.hora_inicio);
        const bFin = horaAMinutos(b.hora_fin);
        slots = slots.filter((s) => {
          const si = horaAMinutos(s);
          return !(si < bFin && (si + duracion) > bIni);
        });
      }

      return slots;
    })
  );

  // --- PASO 5: Contar cuántos operadores tienen libre cada slot (oferta) ---
  const ofertaPorSlot = {};
  for (const slots of resultados) {
    for (const slot of slots) {
      ofertaPorSlot[slot] = (ofertaPorSlot[slot] || 0) + 1;
    }
  }

  const todosLosSlots = Object.keys(ofertaPorSlot);
  if (todosLosSlots.length === 0) {
    logger.info(`[motor] obtenerDisponibilidadServicio: serviceId=${serviceId} fecha=${fecha} sin slots de horario`);
    return { horariosLibres: [], mapaHorarioOperador: {} };
  }

  // --- PASO 6: Contar turnos ya creados por slot (demanda) ---
  //
  // Ya no filtramos por operador_id porque los turnos no tienen operador pre-asignado.
  // Filtramos por servicio + fecha + hora_inicio para conocer cuánto del cupo está ocupado.
  const [turnosExistentes] = await db.query(
    `SELECT hora_inicio, COUNT(*) AS cantidad
     FROM turnos
     WHERE servicio_id = ? AND fecha = ? AND estado != 'cancelado'
     GROUP BY hora_inicio`,
    [serviceId, fecha]
  );

  const demandaPorSlot = {};
  for (const t of turnosExistentes) {
    demandaPorSlot[t.hora_inicio.substring(0, 5)] = Number(t.cantidad);
  }

  // --- PASO 7: Un slot está disponible si la oferta supera la demanda ---
  //
  // Ejemplo: 2 operadores libres en 09:00 y 1 turno ya reservado → queda 1 lugar.
  // Ejemplo: 2 operadores libres en 09:30 y 2 turnos ya reservados → sin lugar.
  //
  // mapaHorarioOperador se mantiene por compatibilidad con el bot de WhatsApp,
  // pero ahora tiene null en todos los valores porque el operador NO se pre-asigna.
  // El operador se asigna cuando el vecino llega y el empleado ejecuta "Tomar turno".
  const slotsOrdenados = todosLosSlots.sort();
  const mapaHorarioOperador = {};

  for (const slot of slotsOrdenados) {
    const oferta  = ofertaPorSlot[slot]  || 0;
    const demanda = demandaPorSlot[slot] || 0;
    if (oferta > demanda) {
      mapaHorarioOperador[slot] = null; // null = sin operador pre-asignado
    }
  }

  const horariosLibres = Object.keys(mapaHorarioOperador);

  logger.info(
    `[motor] obtenerDisponibilidadServicio: serviceId=${serviceId} fecha=${fecha} ` +
    `→ ${horariosLibres.length} slots disponibles, ${operadoresHorarios.length} operador(es)`
  );

  return { horariosLibres, mapaHorarioOperador };
}

async function crearCita(datos) {
  // Desestructuramos con valores por defecto para los campos opcionales.
  // providerId se acepta por compatibilidad con el bot de WhatsApp (que todavía lo pasa
  // desde mapaHorarioOperador), pero ya no se usa para asignar el operador.
  // En el nuevo modelo, el operador se asigna cuando el vecino llega usando tomarTurno().
  const {
    serviceId,
    nombre,
    apellido  = '',
    dni,
    fechaHora,        // "YYYY-MM-DD HH:MM:SS"
    fechaHoraFin,     // "YYYY-MM-DD HH:MM:SS"
    notas     = '',
    telefono  = null,
    usuarioPanelId = null, // ID del empleado que carga el turno desde el panel (opcional)
  } = datos;

  const canalOrigen    = datos.canal || 'whatsapp';
  const canalAuditoria = { presencial: 'panel', web: 'web' }[canalOrigen] ?? 'bot';

  const fecha      = fechaHora.substring(0, 10);
  const horaInicio = fechaHora.substring(11, 16);
  const horaFin    = fechaHoraFin.substring(11, 16);

  const nombreCompleto = apellido ? `${nombre} ${apellido}`.trim() : nombre;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // --- PASO 1: UPSERT del vecino ---
    const [upsertResult] = await conn.query(
      `INSERT INTO vecinos (dni, nombre, telefono, canal_registro)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         id       = LAST_INSERT_ID(id),
         nombre   = VALUES(nombre),
         telefono = IF(VALUES(telefono) IS NOT NULL, VALUES(telefono), telefono)`,
      [dni, nombreCompleto, telefono || null, canalOrigen]
    );
    const vecinoId = upsertResult.insertId;

    // --- PASO 2: Obtener datos del servicio (duración y área) ---
    const [servicioRows] = await conn.query(
      'SELECT area_id, duracion_min FROM servicios WHERE id = ?',
      [parseInt(serviceId, 10)]
    );
    if (servicioRows.length === 0) {
      await conn.rollback();
      throw new Error(`Servicio ${serviceId} no encontrado.`);
    }
    const { area_id: areaId } = servicioRows[0];

    // --- PASO 3: Verificar capacidad del slot con SELECT FOR UPDATE ---
    //
    // SELECT FOR UPDATE bloquea las filas del slot (o el gap si no hay filas)
    // para prevenir race conditions: dos reservas simultáneas para el mismo slot.
    //
    // Contamos los turnos existentes del slot. Si ya alcanzaron el cupo
    // (definido por la cantidad de operadores con horario activo para ese slot),
    // rechazamos la reserva con un error claro.
    const [turnosDelSlot] = await conn.query(
      `SELECT id FROM turnos
       WHERE servicio_id = ? AND fecha = ? AND hora_inicio = ? AND estado != 'cancelado'
       FOR UPDATE`,
      [parseInt(serviceId, 10), fecha, horaInicio]
    );

    // Calcular cuántos operadores tienen este slot disponible en su horario
    // (no contamos bloqueos aquí porque la disponibilidad ya fue verificada antes).
    // Este conteo define el cupo máximo simultáneo del slot.
    const diaSemanaJS = new Date(`${fecha}T12:00:00`).getDay();
    const diaSemanaDB = diaSemanaJS === 0 ? 7 : diaSemanaJS;
    const [horariosSlot] = await conn.query(
      `SELECT COUNT(DISTINCT h.usuario_id) AS total
       FROM horarios h
       JOIN usuarios u ON u.id = h.usuario_id AND u.activo = TRUE
       WHERE h.servicio_id = ?
         AND h.dia_semana  = ?
         AND h.hora_inicio <= ?
         AND h.hora_fin    >= ?
         AND h.activo      = TRUE`,
      // La condición hora_fin >= horaFin garantiza que el slot cabe entero en el horario
      [parseInt(serviceId, 10), diaSemanaDB, horaInicio, horaFin]
    );
    const cupoMaximo = horariosSlot[0]?.total || 0;

    if (turnosDelSlot.length >= cupoMaximo) {
      await conn.rollback();
      throw new Error(
        `No hay disponibilidad para ese horario. ` +
        `El cupo del turno ${horaInicio} ya está completo.`
      );
    }

    // --- PASO 4: INSERT del turno SIN operador pre-asignado ---
    // operador_id queda NULL hasta que un empleado ejecute tomarTurno() al llegar el vecino.
    const [insertResult] = await conn.query(
      `INSERT INTO turnos
         (vecino_id, servicio_id, operador_id, fecha, hora_inicio, hora_fin, estado, canal_origen)
       VALUES (?, ?, NULL, ?, ?, ?, 'agendado', ?)`,
      [vecinoId, parseInt(serviceId, 10), fecha, horaInicio, horaFin, canalOrigen]
    );
    const turnoId = insertResult.insertId;

    // --- PASO 5: INSERT en auditoría ---
    // usuarioPanelId viene cuando la carga la hace un empleado desde el panel presencial.
    // Para WhatsApp y web, es NULL porque el vecino actúa directamente.
    await conn.query(
      `INSERT INTO auditoria
         (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal)
       VALUES (?, 'turno', ?, 'crear', ?, ?)`,
      [
        usuarioPanelId,
        turnoId,
        JSON.stringify({ dni, serviceId, fecha, horaInicio, horaFin, canal: canalOrigen }),
        canalAuditoria,
      ]
    );

    await conn.commit();

    logger.info(
      `[motor] crearCita: turno ${turnoId} creado (sin operador) | DNI: ${dni} | ` +
      `serviceId: ${serviceId} | ${fecha} ${horaInicio}`
    );

    return {
      id:        turnoId,
      start:     fechaHora,
      end:       fechaHoraFin,
      serviceId: parseInt(serviceId, 10),
      providerId: null,  // sin operador pre-asignado
      vecinoId,
      estado:    'agendado',
      canal:     canalOrigen,
    };

  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}


// =============================================================================
// FUNCIÓN 8: tomarTurno(turnoId, usuarioId)
// =============================================================================
// Asigna el operador a un turno que todavía está sin tomar (operador_id IS NULL).
// Se llama desde el panel cuando el vecino llega a la ventanilla y el empleado
// presiona "Tomar turno". Evita que dos operadores tomen el mismo turno.
//
// Si el turno ya tiene operador asignado, lanza un error descriptivo.
async function tomarTurno(turnoId, usuarioId) {
  turnoId   = parseInt(turnoId,   10);
  usuarioId = parseInt(usuarioId, 10);

  // UPDATE condicional: solo actualiza si operador_id es NULL y el estado es agendado.
  // Si otro operador ya lo tomó (race condition), affectedRows será 0.
  const [result] = await db.query(
    `UPDATE turnos
       SET operador_id = ?, updated_at = NOW()
     WHERE id = ? AND operador_id IS NULL AND estado = 'agendado'`,
    [usuarioId, turnoId]
  );

  if (result.affectedRows === 0) {
    throw new Error('Este turno ya fue tomado por otro operador, o no existe, o ya no está agendado.');
  }

  // Registrar en auditoría quién tomó el turno y cuándo
  await db.query(
    `INSERT INTO auditoria
       (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal)
     VALUES (?, 'turno', ?, 'modificar', ?, 'panel')`,
    [usuarioId, turnoId, JSON.stringify({ operador_asignado: usuarioId })]
  );

  logger.info(`[motor] tomarTurno: turno ${turnoId} tomado por operador ${usuarioId}`);
}


async function cancelarCita(appointmentId) {
  appointmentId = parseInt(appointmentId, 10);

  // Verificar que el turno existe y que no está ya cancelado.
  // Lo hacemos ANTES de la transacción para dar un error descriptivo rápido.
  const [turnos] = await db.query(
    'SELECT id, estado FROM turnos WHERE id = ?',
    [appointmentId]
  );

  if (turnos.length === 0) {
    throw new Error(`No existe ningún turno con ID ${appointmentId}`);
  }
  if (turnos[0].estado === 'cancelado') {
    throw new Error(`El turno ${appointmentId} ya está cancelado`);
  }

  // Usamos transacción para que el UPDATE y el INSERT en auditoría sean atómicos.
  // Si el INSERT en auditoría falla, el UPDATE se revierte (no perdemos trazabilidad).
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    await conn.query(
      `UPDATE turnos
       SET estado = 'cancelado', updated_at = NOW()
       WHERE id = ?`,
      [appointmentId]
    );

    await conn.query(
      `INSERT INTO auditoria
         (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal)
       VALUES (NULL, 'turno', ?, 'cancelar', ?, 'bot')`,
      [
        appointmentId,
        JSON.stringify({ estadoAnterior: turnos[0].estado }),
      ]
    );

    await conn.commit();

    logger.info(`[motor] cancelarCita: turno ${appointmentId} cancelado`);

  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function obtenerCitasDelCliente(email) {
  // --- PASO 1: Extraer el DNI del email ficticio ---
  // El formato siempre es "dni_XXXXXX@municipio.local".
  // Usamos regex para ser robustos ante variaciones de mayúsculas o espacios inesperados.
  const match = email.match(/^dni_(.+)@municipio\.local$/i);
  if (!match) {
    // Esto no debería ocurrir nunca en producción: todos los llamadores en index.js
    // construyen el email con `dni_${dni}@municipio.local`. Lo lanzamos igual para
    // que un error de programación futuro sea fácil de detectar.
    throw new Error(`[motor] obtenerCitasDelCliente: formato de email no reconocido: "${email}"`);
  }
  const dni = match[1];

  // --- PASO 2: Buscar el vecino por DNI ---
  // Si el vecino no existe, devolvemos vacío con nombreCliente=null.
  // index.js interpreta eso como "vecino nuevo" → pasa al estado ESPERANDO_NOMBRE.
  // No lanzamos error porque es un caso válido y esperado.
  const [vecinos] = await db.query(
    'SELECT id, nombre FROM vecinos WHERE dni = ?',
    [dni]
  );

  if (vecinos.length === 0) {
    logger.info(`[motor] obtenerCitasDelCliente: DNI ${dni} no registrado → vecino nuevo`);
    return { citas: [], nombreCliente: null };
  }

  const vecino = vecinos[0];

  // --- PASO 3: Obtener turnos agendados del vecino ---
  // Solo devolvemos los que están en estado 'agendado'.
  // index.js filtra los futuros con esCitaFutura() después de recibir este array,
  // pero ya excluimos cancelados, presentes, ausentes y atendidos desde la query.
  // ORDER BY para que la lista de turnos llegue ordenada cronológicamente.
  const [turnos] = await db.query(
    `SELECT t.id, t.fecha, t.hora_inicio, t.hora_fin, t.servicio_id
     FROM turnos t
     WHERE t.vecino_id = ? AND t.estado = 'agendado'
     ORDER BY t.fecha ASC, t.hora_inicio ASC`,
    [vecino.id]
  );

  // --- PASO 4: Mapear al formato que espera index.js ---
  // Campos críticos del contrato:
  //
  //   cita.id        → integer (para igualdad estricta con parseInt en callbacks)
  //   cita.start     → "YYYY-MM-DD HH:MM:SS" (para esCitaFutura, substring y startsWith)
  //   cita.serviceId → integer (para igualdad estricta === con TRAMITES_COMPLETOS[].id)
  //
  // Con dateStrings:true en db.js, t.fecha llega como "YYYY-MM-DD" y
  // t.hora_inicio como "HH:MM:SS", así que la concatenación da el formato exacto.
  const citas = turnos.map((t) => ({
    id:        t.id,                                   // INT de MySQL → number en JS ✓
    start:     `${t.fecha} ${t.hora_inicio}`,          // "YYYY-MM-DD HH:MM:SS" ✓
    end:       `${t.fecha} ${t.hora_fin}`,             // mismo formato, por coherencia
    serviceId: t.servicio_id,                          // INT de MySQL → number en JS ✓
  }));

  logger.info(
    `[motor] obtenerCitasDelCliente: DNI ${dni} → ${citas.length} turno(s) agendado(s)`
  );

  // nombreCliente es el nombre completo del vecino tal como está en la tabla.
  // index.js lo usa para saludar al vecino y como fallback en el menú de gestión.
  return { citas, nombreCliente: vecino.nombre };
}


// =============================================================================
// EXPORTACIONES
// =============================================================================
// Mismo contrato que ea.js — el orden no importa pero lo mantenemos igual
// para que cualquier diff futuro sea fácil de leer.
module.exports = {
  obtenerServicios,
  obtenerProveedores,
  obtenerDisponibilidad,
  obtenerDisponibilidadServicio,
  crearCita,
  cancelarCita,
  obtenerCitasDelCliente,
  tomarTurno,
};
