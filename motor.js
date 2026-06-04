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
  throw new Error('[motor] obtenerDisponibilidad() aún no implementada (Fase 1)');
}

async function obtenerDisponibilidadServicio(serviceId, fecha) {
  throw new Error('[motor] obtenerDisponibilidadServicio() aún no implementada (Fase 1)');
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
