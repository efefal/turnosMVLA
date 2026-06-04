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
  throw new Error('[motor] crearCita() aún no implementada (Fase 2)');
}

async function cancelarCita(appointmentId) {
  throw new Error('[motor] cancelarCita() aún no implementada (Fase 2)');
}

async function obtenerCitasDelCliente(email) {
  throw new Error('[motor] obtenerCitasDelCliente() aún no implementada (Fase 2)');
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
