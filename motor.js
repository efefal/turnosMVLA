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

  // --- PASO 1: Obtener los operadores que atienden este servicio ese día ---
  //
  // Consultamos directamente la tabla horarios en lugar de llamar a
  // obtenerProveedores() porque necesitamos solo los IDs — no los nombres ni
  // la lista completa de servicios. Esto es más eficiente y preciso.
  //
  // La condición sobre usuarios.activo garantiza que no consultemos
  // la disponibilidad de empleados dados de baja.
  const [operadoresRows] = await db.query(
    `SELECT DISTINCT h.usuario_id AS id
     FROM horarios h
     INNER JOIN usuarios u ON u.id = h.usuario_id AND u.activo = TRUE
     WHERE h.servicio_id = ? AND h.activo = TRUE
     ORDER BY h.usuario_id`,
    [serviceId]
  );
  // ORDER BY garantiza que cuando dos operadores empatan en carga,
  // el de menor ID siempre gana el slot. Sin ORDER BY, el DISTINCT
  // puede devolver el array en diferente orden entre llamadas, haciendo
  // el desempate no determinístico (varía según el plan de ejecución de MySQL).

  // Si no hay operadores con horario para este servicio, no hay disponibilidad
  if (operadoresRows.length === 0) {
    logger.info(`[motor] obtenerDisponibilidadServicio: serviceId=${serviceId} sin operadores activos`);
    return { horariosLibres: [], mapaHorarioOperador: {} };
  }

  // --- PASO 2: Consultar disponibilidad de todos los operadores en paralelo ---
  //
  // Promise.all lanza todas las consultas al mismo tiempo. Si hay 3 operadores,
  // las 3 consultas viajan juntas en lugar de ir una por una — mucho más rápido.
  //
  // Estructura de resultado: [{ providerId, slots: ["08:00", ...] }, ...]
  const resultados = await Promise.all(
    operadoresRows.map(async (op) => {
      const slots = await obtenerDisponibilidad(serviceId, op.id, fecha);
      return { providerId: op.id, slots };
    })
  );

  // Si todos los operadores devolvieron arrays vacíos, no hay nada que armar
  const haySlots = resultados.some((r) => r.slots.length > 0);
  if (!haySlots) {
    logger.info(`[motor] obtenerDisponibilidadServicio: serviceId=${serviceId} fecha=${fecha} sin slots disponibles`);
    return { horariosLibres: [], mapaHorarioOperador: {} };
  }

  // --- PASO 3: Contar turnos activos de cada operador en esa fecha ---
  //
  // Este conteo es la base del round-robin por carga real.
  // En lugar de asignar al primero que aparezca (FIFO como hacía ea.js),
  // asignamos al que tiene menos turnos ese día.
  // Una sola query trae el conteo de todos los operadores juntos.
  const operadorIds = operadoresRows.map((op) => op.id);
  const [conteos] = await db.query(
    `SELECT operador_id, COUNT(*) AS total_turnos
     FROM turnos
     WHERE fecha = ?
       AND operador_id IN (?)
       AND estado != 'cancelado'
     GROUP BY operador_id`,
    [fecha, operadorIds]
  );

  // Construimos un mapa { providerId → cantidad de turnos } para acceso O(1)
  // Los operadores sin turnos ese día no aparecen en la query → los inicializamos en 0
  const cargaPorOperador = {};
  for (const op of operadoresRows) {
    cargaPorOperador[op.id] = 0;
  }
  for (const fila of conteos) {
    cargaPorOperador[fila.operador_id] = fila.total_turnos;
  }

  // --- PASO 4: Construir mapaHorarioOperador con round-robin por carga ---
  //
  // Para cada slot único disponible (en cualquier operador):
  //   1. Encontrar todos los operadores que tienen ese slot libre
  //   2. Elegir el que tiene menos turnos ese día
  //   3. Asignarle el slot en el mapa
  //   4. Incrementar su contador para que el SIGUIENTE slot empate se reparta
  //      al otro operador — así se distribuye la carga de forma equitativa
  //      aunque los datos de BD todavía no reflejen estos turnos nuevos.

  // Recolectamos todos los slots únicos de todos los operadores
  const todosLosSlots = new Set();
  for (const resultado of resultados) {
    for (const slot of resultado.slots) {
      todosLosSlots.add(slot);
    }
  }

  // Ordenamos cronológicamente antes de iterar para que el round-robin
  // asigne siempre en el mismo orden si se llama dos veces con los mismos datos
  const slotsOrdenados = [...todosLosSlots].sort();

  const mapaHorarioOperador = {};

  for (const slot of slotsOrdenados) {
    // Operadores que tienen este slot disponible
    const candidatos = resultados
      .filter((r) => r.slots.includes(slot))
      .map((r) => r.providerId);

    if (candidatos.length === 0) continue;

    // Elegir el candidato con menor carga actual
    // Si empatan en carga, reduce() queda con el primero que encontró
    // (que ya es el de menor ID por el ORDER BY del PASO 1)
    const elegido = candidatos.reduce((minId, pId) =>
      cargaPorOperador[pId] < cargaPorOperador[minId] ? pId : minId
    );

    mapaHorarioOperador[slot] = elegido;

    // Incrementar el contador del elegido para que el próximo slot
    // empate se distribuya a otro operador
    cargaPorOperador[elegido]++;
  }

  // horariosLibres son las claves del mapa — ya están ordenadas porque
  // iteramos slotsOrdenados y Object.keys() preserva el orden de inserción en V8
  const horariosLibres = Object.keys(mapaHorarioOperador);

  logger.info(
    `[motor] obtenerDisponibilidadServicio: serviceId=${serviceId} fecha=${fecha} ` +
    `→ ${horariosLibres.length} slots, ${operadoresRows.length} operador(es)`
  );

  return { horariosLibres, mapaHorarioOperador };
}

async function crearCita(datos) {
  // Desestructuramos con valores por defecto para los campos opcionales.
  // El DNI viene siempre en datos.dni — no necesitamos extraerlo del email ficticio.
  const {
    serviceId,
    providerId,
    nombre,
    apellido  = '',
    dni,
    fechaHora,      // "YYYY-MM-DD HH:MM:SS"
    fechaHoraFin,   // "YYYY-MM-DD HH:MM:SS"
    notas     = '',
  } = datos;

  // El canal de origen viene en datos.canal si está definido, sino 'whatsapp'.
  // Los valores válidos en la columna canal_origen son: 'whatsapp', 'web', 'presencial'.
  const canalOrigen = datos.canal || 'whatsapp';

  // La columna auditoria.canal tiene un ENUM diferente: 'bot', 'panel', 'sistema'.
  // Las reservas por WhatsApp y web las maneja el sistema automatizado → 'bot'.
  // Las presenciales las carga un empleado desde el panel → 'panel'.
  const canalAuditoria = canalOrigen === 'presencial' ? 'panel' : 'bot';

  // Extraemos fecha y hora del string "YYYY-MM-DD HH:MM:SS"
  const fecha      = fechaHora.substring(0, 10);   // "YYYY-MM-DD"
  const horaInicio = fechaHora.substring(11, 16);  // "HH:MM"
  const horaFin    = fechaHoraFin.substring(11, 16); // "HH:MM"

  // El nombre que guardamos en vecinos es el nombre completo.
  // index.js pasa apellido: '' siempre, así que en la práctica es solo el nombre.
  const nombreCompleto = apellido ? `${nombre} ${apellido}`.trim() : nombre;

  // --- TRANSACCIÓN ---
  // Usamos pool.getConnection() porque la transacción necesita vivir en la
  // MISMA conexión de principio a fin. pool.query() podría usar conexiones
  // distintas para cada llamada, rompiendo la transacción.
  const conn = await db.getConnection();

  try {
    await conn.beginTransaction();

    // --- PASO 1: UPSERT del vecino ---
    // Si el vecino ya existe (mismo DNI), actualizamos el nombre por si cambió.
    // El truco LAST_INSERT_ID(id) hace que insertId siempre traiga el ID correcto,
    // tanto para inserts nuevos como para actualizaciones de duplicados.
    const [upsertResult] = await conn.query(
      `INSERT INTO vecinos (dni, nombre, canal_registro)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE
         id             = LAST_INSERT_ID(id),
         nombre         = VALUES(nombre)`,
      [dni, nombreCompleto, canalOrigen]
    );
    const vecinoId = upsertResult.insertId;

    // --- PASO 2: SELECT FOR UPDATE — verificar que el slot sigue libre ---
    // Esta es la pieza clave del anti-superposición concurrente.
    // SELECT FOR UPDATE coloca un bloqueo exclusivo sobre las filas leídas
    // y los gaps adyacentes, de modo que si otra transacción intenta leer
    // el mismo slot simultáneamente, queda bloqueada hasta que esta termine.
    //
    // NOTA: el bloqueo es más efectivo cuando existe un índice compuesto en
    // (operador_id, fecha, hora_inicio). Con los índices actuales (separados)
    // la ventana de race condition es muy pequeña pero no cero. Suficiente para el PoC.
    const [turnosExistentes] = await conn.query(
      `SELECT id FROM turnos
       WHERE operador_id = ?
         AND fecha       = ?
         AND hora_inicio = ?
         AND estado     != 'cancelado'
       FOR UPDATE`,
      [providerId, fecha, horaInicio]
    );

    if (turnosExistentes.length > 0) {
      // El slot fue tomado por otra reserva entre que el vecino eligió el horario
      // y presionó confirmar. Hacemos rollback y avisamos con un error claro.
      await conn.rollback();
      throw new Error(
        `El horario ${horaInicio} del ${fecha} ya fue reservado por otra persona. ` +
        `Elegí otro horario.`
      );
    }

    // --- PASO 3: INSERT del turno ---
    const [insertResult] = await conn.query(
      `INSERT INTO turnos
         (vecino_id, servicio_id, operador_id, fecha, hora_inicio, hora_fin, estado, canal_origen)
       VALUES (?, ?, ?, ?, ?, ?, 'agendado', ?)`,
      [vecinoId, serviceId, providerId, fecha, horaInicio, horaFin, canalOrigen]
    );
    const turnoId = insertResult.insertId;

    // --- PASO 4: INSERT en auditoría ---
    // Registramos la creación para tener trazabilidad completa.
    // usuario_id es NULL porque la acción la hace el sistema (bot o web), no un empleado.
    await conn.query(
      `INSERT INTO auditoria
         (usuario_id, entidad_tipo, entidad_id, accion, detalle, canal)
       VALUES (NULL, 'turno', ?, 'crear', ?, ?)`,
      [
        turnoId,
        JSON.stringify({ dni, serviceId, providerId, fecha, horaInicio, horaFin, canal: canalOrigen }),
        canalAuditoria,
      ]
    );

    await conn.commit();

    logger.info(
      `[motor] crearCita: turno ${turnoId} creado | DNI: ${dni} | ` +
      `serviceId: ${serviceId} | providerId: ${providerId} | ${fecha} ${horaInicio}`
    );

    // Retornamos el objeto con todos los campos que puede necesitar el selector web.
    // index.js solo lee cita.id (para el log del endpoint), pero res.json(cita)
    // envía el objeto completo al cliente web, así que incluimos los campos principales.
    return {
      id:          turnoId,
      start:       fechaHora,       // "YYYY-MM-DD HH:MM:SS" — formato que usa index.js
      end:         fechaHoraFin,    // "YYYY-MM-DD HH:MM:SS"
      serviceId:   parseInt(serviceId,  10),
      providerId:  parseInt(providerId, 10),
      vecinoId,
      estado:      'agendado',
      canal:       canalOrigen,
    };

  } catch (err) {
    // Si algo falló dentro de la transacción y no hicimos rollback explícito arriba,
    // lo hacemos acá para no dejar la transacción colgada.
    await conn.rollback();
    // Re-lanzamos el error para que index.js lo capture en su try/catch.
    throw err;
  } finally {
    // SIEMPRE devolver la conexión al pool, haya habido error o no.
    // Si no se libera, el pool se agota y el sistema se cuelga.
    conn.release();
  }
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
};
